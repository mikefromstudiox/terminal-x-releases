/**
 * electron/sync.js — Bidirectional sync: SQLite <-> Supabase
 *
 * Runs in the Electron main process. Pushes local data to Supabase
 * AND pulls remote changes back into SQLite.
 * Uses the Supabase REST API directly (no SDK import — avoids ESM/CJS issues).
 *
 * Architecture: Every synced row carries a `supabase_id` (UUID) assigned at
 * creation time in SQLite. Foreign keys are stored as `*_supabase_id` columns.
 * The Supabase unique constraint is on (business_id, supabase_id).
 *
 * Conflict resolution:
 *   - LWW (last-write-wins) for entity tables: services, clients, washers, etc.
 *   - FWW (first-write-wins) for financial tables: tickets, commissions, etc.
 *   - Ticket status/void_reason can still be pulled (selective status sync).
 *
 * Usage in main.js:
 *   const sync = require('./sync')
 *   sync.init(db, { supabaseUrl, supabaseKey })
 *   sync.startAutoSync(5 * 60 * 1000)
 */

const https = require('https')
const crypto = require('crypto')

// Route all sync log output through electron-log so it lands in
// %APPDATA%/terminal-x/logs/main.log where support can actually see it.
// Fall back to console if electron-log isn't available (e.g. tests).
let _log
try {
  _log = require('electron-log').scope('sync')
} catch {
  _log = { info: console.log, warn: console.warn, error: console.error }
}
const log = {
  info:  (...a) => _log.info(...a),
  warn:  (...a) => _log.warn(...a),
  error: (...a) => _log.error(...a),
}

// -- State --------------------------------------------------------------------
let _db = null
let _url = ''
let _key = ''
let _businessId = null
let _intervalId = null
let _syncing = false
let _pendingSync = false
let _status = { state: 'idle', lastSync: null, tables: {}, error: null }
let _realtimeClient = null
let _realtimeChannel = null
let _realtimeDebounce = null

// -- Table definitions in dependency order ------------------------------------
// Phase 1: no FK deps -> Phase 2: depend on phase 1 -> Phase 3: depend on phase 2
// Rows without a supabase_id are skipped (pre-migration data).

const SYNC_TABLES = [
  // Phase 1 — root entities
  {
    name: 'services',
    cols: r => ({
      supabase_id: r.supabase_id,
      name: r.name,
      name_en: r.name_en,
      category: r.category,
      price: r.price,
      cost: r.cost,
      aplica_itbis: r.aplica_itbis,
      active: r.active,
      is_wash: r.is_wash,
      no_commission: !!(r.no_commission || 0),
      commission_washer: !!(r.commission_washer ?? 1),
      commission_seller: !!(r.commission_seller ?? 1),
      commission_cashier: !!(r.commission_cashier ?? 1),
      sort_order: r.sort_order,
      printer_route: r.printer_route,
      is_menu_item: !!(r.is_menu_item || 0),
      course: r.course,
      station: r.station,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'washers',
    cols: r => ({
      supabase_id: r.supabase_id,
      name: r.name,
      phone: r.phone,
      cedula: r.cedula,
      commission_pct: r.commission_pct,
      active: r.active,
      start_date: r.start_date,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'sellers',
    cols: r => ({
      supabase_id: r.supabase_id,
      name: r.name,
      commission_pct: r.commission_pct,
      phone: r.phone,
      cedula: r.cedula,
      start_date: r.start_date,
      active: r.active,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'clients',
    cols: r => ({
      supabase_id: r.supabase_id,
      name: r.name,
      rnc: r.rnc,
      phone: r.phone,
      email: r.email,
      address: r.address,
      credit_limit: r.credit_limit,
      balance: r.balance,
      visits: r.visits,
      total_spent: r.total_spent,
      notes: r.notes,
      active: r.active,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'inventory_items',
    cols: r => ({
      supabase_id: r.supabase_id,
      name: r.name,
      sku: r.sku,
      barcode: r.barcode,
      category: r.category,
      price: r.price,
      cost: r.cost,
      quantity: r.quantity,
      min_quantity: r.min_quantity,
      aplica_itbis: r.aplica_itbis,
      active: r.active,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'ncf_sequences',
    cols: r => ({
      supabase_id: r.supabase_id,
      type: r.type,
      prefix: r.prefix,
      current_number: r.current_number,
      limit_number: r.limit_number,
      valid_until: r.valid_until,
      active: r.active,
      enabled: r.enabled,
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'empleados',
    cols: r => ({
      supabase_id: r.supabase_id,
      nombre: r.nombre,
      cedula: r.cedula,
      phone: r.phone,
      tipo: r.tipo,
      salary: r.salary,
      start_date: r.start_date,
      active: r.active,
      ref_id: r.ref_id,
      puesto: r.puesto,
      email: r.email,
      bank_account: r.bank_account,
      tss_id: r.tss_id,
      role: r.role || 'none',
      comision_pct: r.comision_pct != null ? r.comision_pct : 0,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'categorias_servicio',
    cols: r => ({
      supabase_id: r.supabase_id,
      nombre: r.nombre,
      orden: r.orden,
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'mesas',
    cols: r => ({
      supabase_id: r.supabase_id,
      name: r.name,
      zone: r.zone,
      capacity: r.capacity,
      status: r.status,
      waiter_empleado_supabase_id: r.waiter_empleado_supabase_id,
      guests_count: r.guests_count,
      seated_at: r.seated_at,
      sort_order: r.sort_order,
      active: !!(r.active ?? 1),
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'modificadores',
    cols: r => ({
      supabase_id: r.supabase_id,
      name: r.name,
      group_name: r.group_name,
      price_delta: r.price_delta,
      min_select: r.min_select,
      max_select: r.max_select,
      default_selected: !!(r.default_selected || 0),
      sort_order: r.sort_order,
      active: !!(r.active ?? 1),
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },

  {
    name: 'users',
    cols: r => ({
      supabase_id: r.supabase_id,
      name: r.name,
      username: r.username,
      pin_hash: r.pin_hash || null,
      role: r.role,
      discount_pct: r.discount_pct,
      commission_pct: r.commission_pct,
      cedula: r.cedula,
      start_date: r.start_date,
      employee_id: r.employee_id != null ? r.employee_id : null,
      active: r.active,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },

  {
    name: 'activity_log',
    cols: r => ({
      supabase_id: r.supabase_id,
      event_type: r.event_type,
      severity: r.severity || 'info',
      actor_supabase_id: r.actor_supabase_id || null,
      actor_name: r.actor_name || null,
      actor_role: r.actor_role || null,
      target_type: r.target_type || null,
      target_id: r.target_id || null,
      target_name: r.target_name || null,
      amount: r.amount != null ? Number(r.amount) : null,
      old_value: r.old_value || null,
      new_value: r.new_value || null,
      reason: r.reason || null,
      metadata: r.metadata ? (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata) : null,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || r.created_at || new Date().toISOString(),
    }),
  },

  // Phase 2 — depend on phase 1 entities
  {
    name: 'service_modificadores',
    cols: r => ({
      supabase_id: r.supabase_id,
      service_supabase_id: r.service_supabase_id,
      modificador_supabase_id: r.modificador_supabase_id,
      is_required: !!(r.is_required || 0),
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'tickets',
    cols: r => {
      // Build services_json from ticket_items for Remote Dashboard compatibility
      let services_json = null
      try {
        const items = _db.rawPrepare('SELECT name, price, quantity FROM ticket_items WHERE ticket_id = ?').all(r.id)
        if (items.length) services_json = items.map(i => ({ name: i.name, price: i.price, qty: i.quantity || 1 }))
      } catch {}
      // Resolve cajero name for dashboard display
      let cajero_name = null
      try {
        if (r.cajero_id) {
          const u = _db.rawPrepare('SELECT name FROM users WHERE id = ?').get(r.cajero_id)
          if (u) cajero_name = u.name
        }
      } catch {}
      // Resolve client name
      let client_name = null
      try {
        if (r.client_id) {
          const c = _db.rawPrepare('SELECT name FROM clients WHERE id = ?').get(r.client_id)
          if (c) client_name = c.name
        }
      } catch {}
      return {
        supabase_id: r.supabase_id,
        doc_number: r.doc_number,
        client_supabase_id: r.client_supabase_id || null,
        client_name: client_name,
        washer_ids: r.washer_ids,
        seller_supabase_id: r.seller_supabase_id || null,
        cajero_supabase_id: r.cajero_supabase_id || null,
        cajero_name: cajero_name,
        services_json: services_json,
        subtotal: r.subtotal,
        descuento: r.descuento,
        itbis: r.itbis,
        ley: r.ley,
        total: r.total,
        beverage_subtotal: r.beverage_subtotal || 0,
        payment_method: r.payment_method,
        comprobante_type: r.comprobante_type,
        ncf: r.ncf,
        ecf_result: r.ecf_result,
        tipo_venta: r.tipo_venta,
        status: r.status,
        void_reason: r.void_reason,
        void_by: r.void_by || null,
        void_at: r.void_at || null,
        vehicle_plate: r.vehicle_plate,
        vehicle_color: r.vehicle_color,
        vehicle_make: r.vehicle_make,
        notes: r.notes,
        tip_amount: r.tip_amount,
        fulfillment_type: r.fulfillment_type,
        mesa_supabase_id: r.mesa_supabase_id,
        paid_at: r.status === 'cobrado' ? (r.created_at || new Date().toISOString()) : null,
        created_at: r.created_at || new Date().toISOString(),
        updated_at: r.updated_at || null,
      }
    },
  },

  // Phase 3 — depend on tickets and other phase 1/2 entities
  {
    name: 'ticket_items',
    cols: r => ({
      supabase_id: r.supabase_id,
      ticket_supabase_id: r.ticket_supabase_id,
      service_supabase_id: r.service_supabase_id || null,
      name: r.name,
      price: r.price,
      cost: r.cost || 0,
      itbis: r.itbis,
      is_wash: r.is_wash,
      quantity: r.quantity || 1,
      sku: r.sku || null,
      inventory_item_supabase_id: r.inventory_item_supabase_id || null,
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'ticket_item_modificadores',
    cols: r => ({
      supabase_id: r.supabase_id,
      ticket_item_supabase_id: r.ticket_item_supabase_id,
      modificador_supabase_id: r.modificador_supabase_id,
      name_snapshot: r.name_snapshot,
      price_delta_snapshot: r.price_delta_snapshot,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'kds_events',
    cols: r => ({
      supabase_id: r.supabase_id,
      ticket_item_supabase_id: r.ticket_item_supabase_id,
      mesa_supabase_id: r.mesa_supabase_id,
      station: r.station,
      status: r.status,
      fired_at: r.fired_at,
      started_at: r.started_at,
      ready_at: r.ready_at,
      bumped_at: r.bumped_at,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'queue',
    cols: r => ({
      supabase_id: r.supabase_id,
      ticket_supabase_id: r.ticket_supabase_id,
      status: r.status,
      washer_supabase_id: r.washer_supabase_id || null,
      assigned_at: r.assigned_at,
      completed_at: r.completed_at,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'washer_commissions',
    cols: r => ({
      supabase_id: r.supabase_id,
      washer_supabase_id: r.washer_supabase_id,
      ticket_supabase_id: r.ticket_supabase_id,
      base_amount: r.base_amount,
      commission_pct: r.commission_pct,
      commission_amount: r.commission_amount,
      paid: r.paid === 1,
      paid_at: r.paid_at,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'seller_commissions',
    cols: r => ({
      supabase_id: r.supabase_id,
      seller_supabase_id: r.seller_supabase_id,
      ticket_supabase_id: r.ticket_supabase_id,
      base_amount: r.base_amount,
      commission_pct: r.commission_pct,
      commission_amount: r.commission_amount,
      paid: r.paid === 1,
      paid_at: r.paid_at,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'cajero_commissions',
    cols: r => ({
      supabase_id: r.supabase_id,
      cajero_supabase_id: r.cajero_supabase_id,
      ticket_supabase_id: r.ticket_supabase_id,
      base_amount: r.base_amount,
      commission_pct: r.commission_pct,
      commission_amount: r.commission_amount,
      paid: r.paid === 1,
      paid_at: r.paid_at,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'credit_payments',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_supabase_id: r.client_supabase_id,
      ticket_ids: r.ticket_ids,
      amount: r.amount,
      payment_method: r.payment_method,
      ncf: r.ncf,
      notes: r.notes,
      cajero_supabase_id: r.cajero_supabase_id || null,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'cuadre_caja',
    cols: r => ({
      supabase_id: r.supabase_id,
      cajero_supabase_id: r.cajero_supabase_id,
      date: r.date,
      fondo: r.fondo,
      efectivo_conteo: r.efectivo_conteo,
      efectivo_sistema: r.efectivo_sistema,
      tarjeta: r.tarjeta,
      transferencia: r.transferencia,
      cheque: r.cheque,
      creditos: r.creditos,
      salidas: r.salidas,
      total_vendido: r.total_vendido,
      total_cobrado: r.total_cobrado,
      cierre_total: r.cierre_total,
      diferencia: r.diferencia,
      comentario: r.comentario,
      denominaciones: r.denominaciones,
      closed_at: r.closed_at,
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'caja_chica',
    cols: r => ({
      supabase_id: r.supabase_id,
      description: r.description,
      category: r.category,
      type: r.type,
      amount: r.amount,
      recibo: r.recibo,
      status: r.status,
      approved_by_supabase_id: r.approved_by_supabase_id || null,
      cajero_supabase_id: r.cajero_supabase_id || null,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'notas_credito',
    cols: r => ({
      supabase_id: r.supabase_id,
      ncf: r.ncf,
      client_supabase_id: r.client_supabase_id || null,
      original_ticket_supabase_id: r.ticket_supabase_id,
      motivo: r.motivo,
      amount: r.amount,
      itbis_revertido: r.itbis_revertido,
      forma_devolucion: r.forma_devolucion,
      comentario: r.comentario,
      cajero_supabase_id: r.cajero_supabase_id || null,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'inventory_transactions',
    cols: r => ({
      supabase_id: r.supabase_id,
      item_supabase_id: r.item_supabase_id,
      type: r.type,
      delta: r.delta,
      notes: r.notes,
      user_supabase_id: r.user_supabase_id || null,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'compras_607',
    cols: r => ({
      supabase_id: r.supabase_id,
      rnc_proveedor: r.rnc_proveedor,
      nombre_proveedor: r.nombre_proveedor,
      ncf: r.ncf,
      ncf_modificado: r.ncf_modificado,
      fecha_ncf: r.fecha_ncf,
      total: r.total,
      itbis_facturado: r.itbis_facturado,
      itbis_retenido: r.itbis_retenido,
      retencion_renta: r.retencion_renta,
      forma_pago: r.forma_pago,
      tipo_ncf: r.tipo_ncf,
      fecha_pago: r.fecha_pago,
      monto_servicios: r.monto_servicios,
      monto_bienes: r.monto_bienes,
      notas: r.notas,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },

  // Phase 4 — payroll + e-CF submissions + audit logs (depend on empleados/tickets)
  {
    name: 'payroll_runs',
    cols: r => ({
      supabase_id: r.supabase_id,
      empleado_supabase_id: r.empleado_supabase_id,
      period_start: r.period_start,
      period_end: r.period_end,
      base: r.base,
      commissions: r.commissions,
      bonuses: r.bonuses,
      sfs_employee: r.sfs_employee,
      afp_employee: r.afp_employee,
      isr: r.isr,
      other_deductions: r.other_deductions,
      deductions: r.deductions,
      sfs_employer: r.sfs_employer,
      afp_employer: r.afp_employer,
      infotep_employer: r.infotep_employer,
      net: r.net,
      notes: r.notes,
      paid_at: r.paid_at,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'salary_changes',
    cols: r => ({
      supabase_id: r.supabase_id,
      empleado_supabase_id: r.empleado_supabase_id,
      old_salary: r.old_salary,
      new_salary: r.new_salary,
      effective_date: r.effective_date,
      reason: r.reason,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'ecf_submissions',
    cols: r => ({
      supabase_id: r.supabase_id,
      ticket_supabase_id: r.ticket_supabase_id,
      encf: r.encf,
      tipo_ecf: r.tipo_ecf,
      track_id: r.track_id,
      status: typeof r.dgii_status === 'number' ? String(r.dgii_status) : (r.status || null),
      environment: r.environment,
      submitted_at: r.submitted_at || new Date().toISOString(),
      created_at: r.submitted_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'queue_deletions',
    cols: r => {
      // Resolve local INTEGER FKs to UUIDs for Supabase
      let queue_sid = null
      let ticket_sid = null
      try {
        if (r.queue_id) {
          const row = _db.rawPrepare('SELECT supabase_id FROM queue WHERE id = ?').get(r.queue_id)
          queue_sid = row?.supabase_id || null
        }
      } catch {}
      try {
        if (r.ticket_id) {
          const row = _db.rawPrepare('SELECT supabase_id FROM tickets WHERE id = ?').get(r.ticket_id)
          ticket_sid = row?.supabase_id || null
        }
      } catch {}
      return {
        supabase_id: r.supabase_id,
        queue_id: queue_sid,
        ticket_id: ticket_sid,
        deleted_by: r.deleted_by,
        deleted_at: r.deleted_at,
        reason: r.reason,
        created_at: r.deleted_at || new Date().toISOString(),
        updated_at: r.updated_at || null,
      }
    },
  },
]

// -- Init ---------------------------------------------------------------------
function init(db, { supabaseUrl, supabaseKey }) {
  _db = db
  _url = (supabaseUrl || '').replace(/\/$/, '')
  _key = supabaseKey || ''

  if (!_url || !_key) {
    log.info('[sync] No Supabase credentials — cloud sync disabled')
    return
  }

  // Create sync_log table
  try {
    _db.rawExec(`CREATE TABLE IF NOT EXISTS sync_log (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name     TEXT NOT NULL UNIQUE,
      last_synced_id INTEGER NOT NULL DEFAULT 0,
      row_count      INTEGER NOT NULL DEFAULT 0,
      error          TEXT,
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
  } catch (e) {
    // table already exists or db not ready
    try { _db.rawPrepare('SELECT 1 FROM sync_log LIMIT 1').get() } catch { /* ignore */ }
  }

  // Add last_synced_at column for update tracking (v1.9)
  try { _db.rawExec("ALTER TABLE sync_log ADD COLUMN last_synced_at TEXT") } catch { /* already exists */ }

  // Add last_pull_at column for bidirectional sync pull cursor (v1.9)
  try { _db.rawExec("ALTER TABLE sync_log ADD COLUMN last_pull_at TEXT") } catch { /* already exists */ }

  // One-time reset: when migrating from local_id to supabase_id sync, reset all cursors
  // so every row is re-synced with its new supabase_id
  try {
    const stmt = _db.rawPrepare("SELECT value FROM app_settings WHERE key = 'sync_v3_supabase_id'")
    const marker = stmt ? stmt.get() : null
    if (!marker) {
      _db.rawExec("DROP TABLE IF EXISTS sync_log")
      _db.rawExec(`CREATE TABLE sync_log (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name     TEXT NOT NULL UNIQUE,
        last_synced_id INTEGER NOT NULL DEFAULT 0,
        row_count      INTEGER NOT NULL DEFAULT 0,
        error          TEXT,
        updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
      )`)
      const ins = _db.rawPrepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('sync_v3_supabase_id','1')")
      if (ins) ins.run()
      log.info('[sync] Dropped and recreated sync_log for supabase_id migration')
    }
  } catch (e) {
    log.error('[sync] sync_v2_reset error:', e.message)
  }

  // v1.9 — one-time re-sync of tickets to backfill services_json, cajero_name, client_name, paid_at
  try {
    const marker = _db.rawPrepare("SELECT value FROM app_settings WHERE key = 'sync_v4_ticket_resync'")?.get()
    if (!marker) {
      _db.rawPrepare("DELETE FROM sync_log WHERE table_name = 'tickets'").run()
      _db.rawPrepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('sync_v4_ticket_resync','1')").run()
      log.info('[sync] Reset tickets cursor for services_json/cajero backfill')
    }
  } catch (e) { log.error('[sync] v4 ticket resync marker:', e.message) }

  // Write diagnostic file
  try {
    const fs = require('fs')
    const path = require('path')
    const { app } = require('electron')
    const logPath = path.join(app.getPath('userData'), 'sync-diag.json')
    const stmt2 = _db.rawPrepare("SELECT COUNT(*) as n FROM sync_log")
    const logCount = stmt2 ? stmt2.get()?.n : -1
    const stmt3 = _db.rawPrepare("SELECT table_name, last_synced_id FROM sync_log")
    const logRows = stmt3 ? stmt3.all() : []
    fs.writeFileSync(logPath, JSON.stringify({ init: true, url: !!_url, key: !!_key, sync_log_count: logCount, sync_log: logRows, ts: new Date().toISOString() }))
  } catch (e) { log.error('[sync] diag write error:', e.message) }

  log.info('[sync] Initialized — cloud backup enabled, url:', _url?.substring(0, 30), 'key:', _key ? 'SET' : 'EMPTY')

  // v1.9.11 — one-time reset of pull cursors so every PULL_TABLES entry
  // re-fetches from scratch on first boot of 1.9.11. Fixes the case where
  // a stale cursor was silently skipping backfilled rows on Supabase.
  try {
    const marker = _db.rawPrepare("SELECT value FROM app_settings WHERE key='pull_reset_version'").get()
    if (!marker || marker.value !== '1.9.11') {
      _db.rawPrepare("UPDATE sync_log SET last_pull_at = NULL").run()
      _db.rawPrepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('pull_reset_version','1.9.11')").run()
      log.info('[sync] v1.9.11 pull cursors reset — next pull re-fetches everything')
    }
  } catch (e) { log.error('[sync] pull cursor reset failed:', e.message) }
}

// -- Supabase REST upsert -----------------------------------------------------
const SYNC_TIMEOUT_MS = 30_000

async function supabaseUpsert(table, rows) {
  if (!rows.length) return { ok: true, count: 0 }

  // Coalesce null/undefined timestamps so Supabase NOT NULL columns accept them.
  // Also drop any remaining undefined fields (they'd break upsert merge).
  const nowIso = new Date().toISOString()
  const cleaned = rows.map(r => {
    const out = {}
    for (const [k, v] of Object.entries(r)) {
      if (v === undefined) continue
      if ((k === 'updated_at' || k === 'created_at') && v == null) { out[k] = nowIso; continue }
      out[k] = v
    }
    if (!out.updated_at) out.updated_at = nowIso
    return out
  })

  // Supabase has real UNIQUE (business_id, supabase_id) constraints on every
  // sync table (created 2026-04-11 — previously these were partial indexes
  // which PostgREST can't use as on_conflict targets). Clean upsert works.
  return new Promise((resolve, reject) => {
    const reqUrl = new URL(`${_url}/rest/v1/${table}?on_conflict=business_id,supabase_id`)
    const body = JSON.stringify(cleaned)
    const request = https.request({
      hostname: reqUrl.hostname,
      path: reqUrl.pathname + reqUrl.search,
      method: 'POST',
      headers: {
        'apikey': _key,
        'Authorization': `Bearer ${_key}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (response) => {
      let data = ''
      response.on('data', chunk => { data += chunk.toString() })
      response.on('end', () => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve({ ok: true, count: rows.length })
        } else {
          reject(new Error(`Supabase ${response.statusCode}: ${data}`))
        }
      })
    })
    request.on('error', reject)
    request.setTimeout(SYNC_TIMEOUT_MS, () => { request.destroy(new Error(`Supabase ${table} timed out after ${SYNC_TIMEOUT_MS / 1000}s`)) })
    request.write(body)
    request.end()
  })
}

// -- Resolve business_id ------------------------------------------------------
async function resolveBusinessId() {
  if (_businessId) return _businessId
  // Try local settings first
  try {
    const row = _db.rawPrepare("SELECT value FROM app_settings WHERE key = 'supabase_business_id'").get()
    if (row?.value) {
      _businessId = row.value
      return _businessId
    }
  } catch {}
  // Fallback: look up from HWID in Supabase licenses table
  try {
    if (_url && _key) {
      const fs = require('fs')
      const path = require('path')
      const { app } = require('electron')
      let hwid = null
      try {
        const hwidPath = path.join(app.getPath('userData'), 'hwid.json')
        const hwidData = JSON.parse(fs.readFileSync(hwidPath, 'utf8'))
        hwid = hwidData.id || hwidData.hwid
      } catch {}
      if (hwid) {
        const reqUrl = new URL(`${_url}/rest/v1/licenses?select=business_id&hardware_id=eq.${encodeURIComponent(hwid)}&status=eq.active&limit=1`)
        const result = await new Promise((resolve, reject) => {
          https.get({
            hostname: reqUrl.hostname,
            path: reqUrl.pathname + reqUrl.search,
            headers: { 'apikey': _key, 'Authorization': `Bearer ${_key}` },
          }, res => {
            let data = ''
            res.on('data', chunk => { data += chunk.toString() })
            res.on('end', () => { try { resolve(JSON.parse(data)) } catch { reject(new Error('parse')) } })
          }).on('error', reject)
        })
        if (result?.[0]?.business_id) {
          _businessId = result[0].business_id
          try { _db.rawPrepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('supabase_business_id',?)").run(_businessId) } catch {}
          log.info('[sync] Resolved business_id from HWID:', _businessId)
          return _businessId
        }
      }
    }
  } catch (e) { log.warn('[sync] Business ID lookup failed:', e.message) }
  return null
}

// -- Get last synced ID for a table -------------------------------------------
function getLastSyncedId(tableName) {
  try {
    const row = _db.rawPrepare('SELECT last_synced_id FROM sync_log WHERE table_name = ?').get(tableName)
    return row?.last_synced_id || 0
  } catch { return 0 }
}

function getLastSyncedAt(tableName) {
  try {
    const row = _db.rawPrepare('SELECT last_synced_at FROM sync_log WHERE table_name = ?').get(tableName)
    return row?.last_synced_at || null
  } catch { return null }
}

// -- Update sync log ----------------------------------------------------------
function updateSyncLog(tableName, lastId, rowCount, error) {
  try {
    _db.rawPrepare(`INSERT INTO sync_log (table_name, last_synced_id, row_count, error, updated_at, last_synced_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(table_name) DO UPDATE SET
        last_synced_id = excluded.last_synced_id,
        row_count = excluded.row_count,
        error = excluded.error,
        updated_at = datetime('now'),
        last_synced_at = datetime('now')
    `).run(tableName, lastId, rowCount, error)
  } catch (e) { log.error('[sync] updateSyncLog failed:', e.message) }
}

// -- Supabase REST fetch (GET) ------------------------------------------------
function supabaseFetch(table, queryParams) {
  return new Promise((resolve, reject) => {
    const reqUrl = new URL(`${_url}/rest/v1/${table}`)
    for (const [k, v] of Object.entries(queryParams)) reqUrl.searchParams.set(k, v)
    const request = https.get({
      hostname: reqUrl.hostname,
      path: reqUrl.pathname + reqUrl.search,
      headers: { 'apikey': _key, 'Authorization': `Bearer ${_key}` },
    }, (response) => {
      let data = ''
      response.on('data', chunk => { data += chunk.toString() })
      response.on('end', () => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          try { resolve(JSON.parse(data)) } catch { resolve([]) }
        } else {
          reject(new Error(`Supabase GET ${table} ${response.statusCode}: ${data.substring(0, 200)}`))
        }
      })
    })
    request.on('error', reject)
    setTimeout(() => request.destroy(new Error(`Supabase GET ${table} timed out`)), SYNC_TIMEOUT_MS)
  })
}

// -- Pull cursor helpers ------------------------------------------------------
function getLastPullAt(tableName) {
  try {
    const row = _db.rawPrepare('SELECT last_pull_at FROM sync_log WHERE table_name = ?').get(tableName)
    return row?.last_pull_at || null
  } catch { return null }
}

function updatePullLog(tableName, lastPullAt) {
  try {
    _db.rawPrepare(`INSERT INTO sync_log (table_name, last_synced_id, row_count, error, updated_at, last_pull_at)
      VALUES (?, 0, 0, NULL, datetime('now'), ?)
      ON CONFLICT(table_name) DO UPDATE SET last_pull_at = excluded.last_pull_at, updated_at = datetime('now')
    `).run(tableName, lastPullAt)
  } catch (e) { log.error('[sync] updatePullLog failed:', e.message) }
}

// -- JSON columns that need stringify when inserting into SQLite ---------------
const JSON_COLUMNS = new Set(['ecf_result', 'washer_ids', 'ticket_ids', 'denominaciones', 'services_json', 'metadata'])

function sqliteValue(col, val) {
  if (val == null) return null
  if (JSON_COLUMNS.has(col) && typeof val === 'object') return JSON.stringify(val)
  // better-sqlite3 rejects JS booleans — Supabase returns active:true/false, SQLite uses 0/1
  if (typeof val === 'boolean') return val ? 1 : 0
  // Any leftover object (e.g. jsonb column we don't expect) — stringify so the bind works
  if (typeof val === 'object') return JSON.stringify(val)
  return val
}

// -- Pull table definitions (Supabase -> SQLite) ------------------------------
// strategy: 'lww' = last-write-wins (entities), 'fww' = first-write-wins (financial)
const PULL_TABLES = [
  // Phase 1 — root entities (LWW)
  // NOTE: `created_at` only included for tables whose local SQLite schema actually has
  // that column. db/schema.sql: services/sellers/inventory_items/empleados/categorias_servicio
  // never declared created_at, so including it in the pull causes "no such column" failures.
  { name: 'services', strategy: 'lww', naturalKey: 'name', cols: ['name','name_en','category','price','cost','aplica_itbis','active','is_wash','no_commission','commission_washer','commission_seller','commission_cashier','sort_order','printer_route','is_menu_item','course','station','updated_at'] },
  { name: 'washers', strategy: 'lww', naturalKey: 'name', cols: ['name','phone','cedula','commission_pct','active','start_date','created_at','updated_at'] },
  { name: 'sellers', strategy: 'lww', naturalKey: 'name', cols: ['name','commission_pct','phone','cedula','start_date','active','updated_at'] },
  { name: 'clients', strategy: 'lww', naturalKey: 'name', cols: ['name','rnc','phone','email','address','credit_limit','balance','visits','total_spent','notes','active','created_at','updated_at'] },
  { name: 'inventory_items', strategy: 'lww', naturalKey: 'name', cols: ['name','sku','barcode','category','price','cost','quantity','min_quantity','aplica_itbis','active','updated_at'] },
  { name: 'mesas', strategy: 'lww', naturalKey: 'name', cols: ['name','zone','capacity','status','guests_count','seated_at','sort_order','active','created_at','updated_at'],
    fkCols: { waiter_empleado_supabase_id: 'empleados' } },
  { name: 'modificadores', strategy: 'lww', naturalKey: 'name', cols: ['name','group_name','price_delta','min_select','max_select','default_selected','sort_order','active','created_at','updated_at'] },
  { name: 'service_modificadores', strategy: 'lww', cols: ['is_required','created_at','updated_at'],
    fkCols: { service_supabase_id: 'services', modificador_supabase_id: 'modificadores' } },
  { name: 'ncf_sequences', strategy: 'lww', cols: ['type','prefix','current_number','limit_number','valid_until','active','enabled','updated_at'] },
  { name: 'empleados', strategy: 'lww', naturalKey: 'nombre', cols: ['nombre','cedula','phone','tipo','salary','start_date','active','ref_id','puesto','email','bank_account','tss_id','role','comision_pct','updated_at'] },
  { name: 'categorias_servicio', strategy: 'lww', naturalKey: 'nombre', cols: ['nombre','orden','updated_at'] },
  { name: 'users', strategy: 'lww', naturalKey: 'username', cols: ['name','username','pin_hash','role','discount_pct','commission_pct','cedula','start_date','employee_id','active','created_at','updated_at'] },

  // Phase 2 — tickets + dependents
  { name: 'tickets', strategy: 'fww',
    cols: ['doc_number','subtotal','descuento','itbis','ley','total','beverage_subtotal','payment_method','comprobante_type','ncf','ecf_result','tipo_venta','status','void_reason','void_by','void_at','vehicle_plate','vehicle_color','vehicle_make','notes','washer_ids','tip_amount','fulfillment_type','mesa_supabase_id','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients', seller_supabase_id: 'sellers', cajero_supabase_id: 'users' },
    statusSync: ['status', 'void_reason', 'void_by', 'void_at', 'updated_at'] },
  { name: 'ticket_items', strategy: 'fww',
    cols: ['name','price','cost','itbis','is_wash','quantity','sku','created_at','updated_at'],
    fkCols: { ticket_supabase_id: 'tickets', service_supabase_id: 'services', inventory_item_supabase_id: 'inventory_items' } },
  { name: 'queue', strategy: 'lww',
    cols: ['status','assigned_at','completed_at','created_at','updated_at'],
    fkCols: { ticket_supabase_id: 'tickets', washer_supabase_id: 'washers' } },
  { name: 'ticket_item_modificadores', strategy: 'fww',
    cols: ['name_snapshot','price_delta_snapshot','created_at','updated_at'],
    fkCols: { ticket_item_supabase_id: 'ticket_items', modificador_supabase_id: 'modificadores' } },
  { name: 'kds_events', strategy: 'fww',
    cols: ['station','status','fired_at','started_at','ready_at','bumped_at','created_at','updated_at'],
    fkCols: { ticket_item_supabase_id: 'ticket_items', mesa_supabase_id: 'mesas' } },

  // Phase 3 — financial (FWW)
  { name: 'washer_commissions', strategy: 'fww',
    cols: ['base_amount','commission_pct','commission_amount','paid','paid_at','created_at','updated_at'],
    fkCols: { washer_supabase_id: 'washers', ticket_supabase_id: 'tickets' } },
  { name: 'seller_commissions', strategy: 'fww',
    cols: ['base_amount','commission_pct','commission_amount','paid','paid_at','created_at','updated_at'],
    fkCols: { seller_supabase_id: 'sellers', ticket_supabase_id: 'tickets' } },
  { name: 'cajero_commissions', strategy: 'fww',
    cols: ['base_amount','commission_pct','commission_amount','paid','paid_at','created_at','updated_at'],
    fkCols: { cajero_supabase_id: 'users', ticket_supabase_id: 'tickets' } },
  { name: 'credit_payments', strategy: 'fww',
    cols: ['ticket_ids','amount','payment_method','ncf','notes','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients', cajero_supabase_id: 'users' } },
  { name: 'cuadre_caja', strategy: 'fww',
    cols: ['date','fondo','efectivo_conteo','efectivo_sistema','tarjeta','transferencia','cheque','creditos','salidas','total_vendido','total_cobrado','cierre_total','diferencia','comentario','denominaciones','closed_at','updated_at'],
    fkCols: { cajero_supabase_id: 'users' } },
  { name: 'caja_chica', strategy: 'fww',
    cols: ['description','category','type','amount','recibo','status','created_at','updated_at'],
    fkCols: { approved_by_supabase_id: 'users', cajero_supabase_id: 'users' } },
  { name: 'notas_credito', strategy: 'fww',
    cols: ['ncf','motivo','amount','itbis_revertido','forma_devolucion','comentario','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients', original_ticket_supabase_id: 'tickets', cajero_supabase_id: 'users' } },
  { name: 'inventory_transactions', strategy: 'fww',
    cols: ['type','delta','notes','created_at','updated_at'],
    fkCols: { item_supabase_id: 'inventory_items', user_supabase_id: 'users' } },
  { name: 'compras_607', strategy: 'fww',
    cols: ['rnc_proveedor','nombre_proveedor','ncf','ncf_modificado','fecha_ncf','total','itbis_facturado','itbis_retenido','retencion_renta','forma_pago','tipo_ncf','fecha_pago','monto_servicios','monto_bienes','notas','created_at','updated_at'] },

  // Phase 4 — payroll audit trail (FWW — financial records, never overwritten)
  // Note: ecf_submissions is push-only (desktop-authored per-device, no pull) — column name
  // mismatch between SQLite `dgii_status INTEGER` and Supabase `status TEXT` makes pulling unsafe.
  // Note: queue_deletions is push-only (append-only log, desktop-authored).
  { name: 'payroll_runs', strategy: 'fww',
    cols: ['period_start','period_end','base','commissions','bonuses','sfs_employee','afp_employee','isr','other_deductions','deductions','sfs_employer','afp_employer','infotep_employer','net','notes','paid_at','created_at','updated_at'],
    fkCols: { empleado_supabase_id: 'empleados' } },
  { name: 'salary_changes', strategy: 'fww',
    cols: ['old_salary','new_salary','effective_date','reason','created_at','updated_at'],
    fkCols: { empleado_supabase_id: 'empleados' } },

  // Activity log — FWW (append-only audit feed)
  { name: 'activity_log', strategy: 'fww',
    cols: ['event_type','severity','actor_supabase_id','actor_name','actor_role','target_type','target_id','target_name','amount','old_value','new_value','reason','metadata','created_at','updated_at'] },
]

// -- Pull upsert: Supabase row -> SQLite row ----------------------------------
function pullUpsertRow(tableName, row, strategy, cols, fkCols, statusSync, naturalKey) {
  if (!row.supabase_id) return

  // 1. Try match by supabase_id (primary identity)
  let existing = _db.rawPrepare(`SELECT id, updated_at, supabase_id FROM ${tableName} WHERE supabase_id = ?`).get(row.supabase_id)

  // 2. If no match and table has a natural key, try match by natural key.
  //    This handles DB rebuilds where the local supabase_id was lost/regenerated.
  //    "Healing": adopt the server's supabase_id so future syncs match correctly.
  //    SAFETY: only heal if EXACTLY ONE local row matches — multiple matches means
  //    the name is ambiguous (e.g. two clients named "Juan"), so skip healing to
  //    avoid overwriting the wrong record. The row will INSERT as a new local entry.
  if (!existing && naturalKey && row[naturalKey]) {
    try {
      const matches = _db.rawPrepare(
        `SELECT id, updated_at, supabase_id FROM ${tableName} WHERE ${naturalKey} = ?`
      ).all(row[naturalKey])
      if (matches.length === 1) {
        const byName = matches[0]
        _db.rawPrepare(`UPDATE ${tableName} SET supabase_id = ? WHERE id = ?`).run(row.supabase_id, byName.id)
        log.info(`[sync-pull] ${tableName}: healed supabase_id for "${row[naturalKey]}" (${byName.supabase_id} → ${row.supabase_id})`)
        existing = byName
        existing.supabase_id = row.supabase_id
      } else if (matches.length > 1) {
        log.warn(`[sync-pull] ${tableName}: skipped naturalKey heal for "${row[naturalKey]}" — ${matches.length} local matches (ambiguous)`)
      }
    } catch {} // naturalKey column may not exist — skip gracefully
  }

  if (existing) {
    // Row exists locally
    if (strategy === 'fww') {
      // First-write-wins: only sync status updates for tickets
      if (statusSync && tableName === 'tickets') {
        const localRow = _db.rawPrepare('SELECT status FROM tickets WHERE id = ?').get(existing.id)
        if (localRow?.status !== row.status && row.status) {
          const updates = statusSync.filter(c => row[c] != null).map(c => `${c} = ?`)
          if (updates.length) {
            const vals = statusSync.filter(c => row[c] != null).map(c => sqliteValue(c, row[c]))
            _db.rawPrepare(`UPDATE tickets SET ${updates.join(', ')} WHERE id = ?`).run(...vals, existing.id)
          }
        }
      }
      // FWW: don't overwrite existing records beyond status
      return
    }

    // LWW: only update if remote is newer
    if (existing.updated_at && row.updated_at && row.updated_at <= existing.updated_at) return

    // Build UPDATE
    const setClauses = []
    const setVals = []
    for (const col of cols) {
      if (row[col] !== undefined) {
        setClauses.push(`${col} = ?`)
        setVals.push(sqliteValue(col, row[col]))
      }
    }
    // Resolve FK columns
    if (fkCols) {
      for (const [fkCol, refTable] of Object.entries(fkCols)) {
        if (row[fkCol]) {
          setClauses.push(`${fkCol} = ?`)
          setVals.push(row[fkCol])
          // Also resolve to local integer ID
          const localCol = fkCol.replace('_supabase_id', '_id')
          try {
            const refRow = _db.rawPrepare(`SELECT id FROM ${refTable} WHERE supabase_id = ?`).get(row[fkCol])
            if (refRow) {
              setClauses.push(`${localCol} = ?`)
              setVals.push(refRow.id)
            }
          } catch { /* ref table may not have the row yet */ }
        }
      }
    }
    if (setClauses.length) {
      setVals.push(existing.id)
      _db.rawPrepare(`UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE id = ?`).run(...setVals)
    }
  } else {
    // Row doesn't exist locally — INSERT
    const insertCols = ['supabase_id']
    const insertVals = [row.supabase_id]

    for (const col of cols) {
      if (row[col] !== undefined) {
        insertCols.push(col)
        insertVals.push(sqliteValue(col, row[col]))
      }
    }
    // Resolve FK columns
    if (fkCols) {
      for (const [fkCol, refTable] of Object.entries(fkCols)) {
        if (row[fkCol]) {
          insertCols.push(fkCol)
          insertVals.push(row[fkCol])
          const localCol = fkCol.replace('_supabase_id', '_id')
          try {
            const refRow = _db.rawPrepare(`SELECT id FROM ${refTable} WHERE supabase_id = ?`).get(row[fkCol])
            if (refRow) {
              insertCols.push(localCol)
              insertVals.push(refRow.id)
            }
          } catch { /* ref table may not have the row yet */ }
        }
      }
    }

    const placeholders = insertCols.map(() => '?').join(',')
    try {
      _db.rawPrepare(`INSERT INTO ${tableName} (${insertCols.join(',')}) VALUES (${placeholders})`).run(...insertVals)
    } catch (e) {
      // Unique constraint violation = row already exists (race condition) — skip
      if (!e.message?.includes('UNIQUE constraint')) throw e
    }
  }
}

// -- Pull a single table from Supabase ----------------------------------------
async function pullTable(tableConfig) {
  const { name, strategy, cols, fkCols, statusSync } = tableConfig
  const bizId = await resolveBusinessId()
  if (!bizId) throw new Error('No business_id')

  const lastPull = getLastPullAt(name)
  const FETCH_SIZE = 500
  let totalPulled = 0
  let latestUpdatedAt = lastPull

  // Paginated pull
  let offset = 0
  while (true) {
    const params = {
      'business_id': `eq.${bizId}`,
      'order': 'updated_at.asc',
      'limit': String(FETCH_SIZE),
      'offset': String(offset),
      'supabase_id': 'not.is.null',
    }
    // `gte` (not `gt`) so the row at exactly lastPull gets re-fetched on the next
    // pass. Otherwise rows whose updated_at equals the stored cursor are orphaned
    // forever — hit this on 2026-04-11 when an INSERT failure advanced the cursor
    // past a row that never made it into local SQLite.
    if (lastPull) params['updated_at'] = `gte.${lastPull}`

    let rows
    try {
      rows = await supabaseFetch(name, params)
    } catch (e) {
      log.error(`[sync-pull] ${name}: fetch failed:`, e.message)
      break
    }

    if (!rows.length) break

    // Upsert each row into SQLite. Only advance the cursor for rows that
    // actually succeeded — if an INSERT/UPDATE fails, we need the next pull
    // to try this row again, not skip it. (Fixed 2026-04-11 after asdadad
    // got stranded when v1.9.12's `no such column` error advanced the cursor
    // past a row that never made it into local SQLite.)
    for (const row of rows) {
      let ok = false
      try {
        pullUpsertRow(name, row, strategy, cols, fkCols, statusSync, tableConfig.naturalKey)
        ok = true
      } catch (e) {
        log.error(`[sync-pull] ${name}: upsert failed for ${row.supabase_id}:`, e.message)
      }
      if (ok && row.updated_at && (!latestUpdatedAt || row.updated_at > latestUpdatedAt)) {
        latestUpdatedAt = row.updated_at
      }
    }

    totalPulled += rows.length
    offset += FETCH_SIZE
    if (rows.length < FETCH_SIZE) break
  }

  // Update pull cursor
  if (latestUpdatedAt) {
    updatePullLog(name, latestUpdatedAt)
  }

  if (totalPulled > 0) log.info(`[sync-pull] ${name}: pulled ${totalPulled} rows`)
  return totalPulled
}

// -- Pull all tables ----------------------------------------------------------
async function pullNow() {
  if (!_url || !_key) return { pulled: 0 }
  const bizId = await resolveBusinessId()
  if (!bizId) return { pulled: 0 }

  let totalPulled = 0
  for (const pt of PULL_TABLES) {
    try {
      const count = await pullTable(pt)
      totalPulled += count
    } catch (e) {
      log.error(`[sync-pull] ${pt.name}:`, e.message)
    }
  }
  log.info(`[sync-pull] Manual pull complete — ${totalPulled} rows`)

  // Notify renderer
  try {
    const { BrowserWindow } = require('electron')
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.webContents.send('sync:pull-complete', { pulled: totalPulled })
  } catch {}

  return { pulled: totalPulled }
}

// -- Sync a single table (PUSH) -----------------------------------------------
async function syncTable(tableConfig) {
  const { name, cols } = tableConfig
  const bizId = await resolveBusinessId()
  if (!bizId) throw new Error('No business_id')

  const FETCH_SIZE = 500
  let cursor = getLastSyncedId(name)
  let totalSynced = 0

  // Pagination loop — keep fetching until no more rows
  while (true) {
    let rows
    try {
      rows = _db.rawPrepare(`SELECT * FROM ${name} WHERE id > ? ORDER BY id LIMIT ?`).all(cursor, FETCH_SIZE)
    } catch (e) {
      throw new Error(`SQLite read ${name}: ${e.message}`)
    }

    if (!rows.length) break

    // Map rows to Supabase format, skip rows without supabase_id (pre-migration)
    const mapped = rows.map(r => ({ business_id: bizId, ...cols(r) })).filter(r => r.supabase_id)

    // Batch upsert (500 at a time)
    if (mapped.length) {
      for (let i = 0; i < mapped.length; i += FETCH_SIZE) {
        const batch = mapped.slice(i, i + FETCH_SIZE)
        await supabaseUpsert(name, batch)
        totalSynced += batch.length
      }
    }

    cursor = rows[rows.length - 1].id
    updateSyncLog(name, cursor, totalSynced, null)

    // If we got fewer rows than the fetch size, we're done
    if (rows.length < FETCH_SIZE) break
  }

  // Pass 2 — re-sync rows that were UPDATED since last sync
  // This catches balance changes, status updates, stock adjustments, etc.
  const lastSyncedAt = getLastSyncedAt(name)
  if (lastSyncedAt) {
    try {
      const updatedRows = _db.rawPrepare(
        `SELECT * FROM ${name} WHERE updated_at > ? AND supabase_id IS NOT NULL ORDER BY id LIMIT 2000`
      ).all(lastSyncedAt)
      if (updatedRows.length) {
        const mapped = updatedRows.map(r => ({ business_id: bizId, ...cols(r) })).filter(r => r.supabase_id)
        if (mapped.length) {
          for (let i = 0; i < mapped.length; i += FETCH_SIZE) {
            const batch = mapped.slice(i, i + FETCH_SIZE)
            await supabaseUpsert(name, batch)
            totalSynced += batch.length
          }
          log.info(`[sync] ${name}: re-synced ${mapped.length} updated rows`)
        }
      }
    } catch (e) {
      // updated_at column may not exist on all tables — skip gracefully
      if (!e.message?.includes('no such column')) {
        log.error(`[sync] ${name} update-pass:`, e.message)
      }
    }
  }

  _status.tables[name] = { synced: true, rows: totalSynced, lastId: cursor }
  return totalSynced
}

// -- Push business meta (name, rnc, phone, address, logo) --------------------
// Runs as part of every sync cycle. Logo is uploaded to Supabase Storage only
// if its SHA-256 hash has changed since last push (idempotent, offline-safe).
async function pushBusinessMeta(bizId) {
  try {
    const emp = _db.rawPrepare('SELECT name, rnc, phone, address, email, logo, settings FROM businesses LIMIT 1').get()
    if (!emp) return 0

    // Compute logo hash (if present)
    let logoHash = null
    if (emp.logo && Buffer.isBuffer(emp.logo) && emp.logo.length > 0) {
      logoHash = crypto.createHash('sha256').update(emp.logo).digest('hex')
    }

    const lastHashRow = _db.rawPrepare("SELECT value FROM app_settings WHERE key = 'logo_synced_hash'").get()
    const lastLogoUrlRow = _db.rawPrepare("SELECT value FROM app_settings WHERE key = 'logo_synced_url'").get()
    const lastHash = lastHashRow?.value || null
    let logoUrl = lastLogoUrlRow?.value || null

    // Upload logo to Supabase Storage if changed
    if (logoHash && logoHash !== lastHash) {
      try {
        // Detect MIME from magic bytes (simple check)
        let ext = 'png', mime = 'image/png'
        const b = emp.logo
        if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) { ext = 'jpg'; mime = 'image/jpeg' }
        else if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) { ext = 'gif'; mime = 'image/gif' }
        else if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[8] === 0x57 && b[9] === 0x45) { ext = 'webp'; mime = 'image/webp' }

        const objectPath = `${bizId}/logo.${ext}`
        logoUrl = await uploadToStorage('business-logos', objectPath, b, mime)

        // Persist hash + URL locally so we don't re-upload
        _db.rawPrepare("INSERT OR REPLACE INTO app_settings(key, value) VALUES('logo_synced_hash', ?)").run(logoHash)
        _db.rawPrepare("INSERT OR REPLACE INTO app_settings(key, value) VALUES('logo_synced_url', ?)").run(logoUrl)
        log.info('[sync] Logo uploaded to Storage:', logoUrl)
      } catch (e) {
        log.error('[sync] Logo upload failed:', e.message)
      }
    }

    // Build update payload (only non-empty values)
    const updates = {}
    if (emp.name)    updates.name    = emp.name
    if (emp.rnc)     updates.rnc     = emp.rnc
    if (emp.phone)   updates.phone   = emp.phone
    if (emp.address) updates.address = emp.address
    if (emp.email)   updates.email   = emp.email
    if (logoUrl)     updates.logo_url = logoUrl
    if (!Object.keys(updates).length) return 0

    updates.updated_at = new Date().toISOString()

    // PATCH businesses row
    const body = JSON.stringify(updates)
    await new Promise((resolve, reject) => {
      const reqUrl = new URL(`${_url}/rest/v1/businesses?id=eq.${encodeURIComponent(bizId)}`)
      const req = https.request({
        hostname: reqUrl.hostname, path: reqUrl.pathname + reqUrl.search, method: 'PATCH',
        headers: { 'apikey': _key, 'Authorization': `Bearer ${_key}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal', 'Content-Length': Buffer.byteLength(body) },
      }, (r) => {
        let data = ''
        r.on('data', c => data += c.toString())
        r.on('end', () => r.statusCode >= 200 && r.statusCode < 300 ? resolve() : reject(new Error(`businesses PATCH ${r.statusCode}: ${data}`)))
      })
      req.on('error', reject)
      req.write(body)
      req.end()
    })
    return 1
  } catch (e) {
    log.error('[sync] pushBusinessMeta failed:', e.message)
    return 0
  }
}

// -- Upload binary to Supabase Storage ----------------------------------------
function uploadToStorage(bucket, objectPath, buffer, contentType) {
  return new Promise((resolve, reject) => {
    const reqUrl = new URL(`${_url}/storage/v1/object/${bucket}/${encodeURI(objectPath)}`)
    const req = https.request({
      hostname: reqUrl.hostname, path: reqUrl.pathname, method: 'POST',
      headers: { 'apikey': _key, 'Authorization': `Bearer ${_key}`, 'Content-Type': contentType || 'application/octet-stream', 'x-upsert': 'true', 'Content-Length': buffer.length },
    }, (r) => {
      let data = ''
      r.on('data', c => data += c.toString())
      r.on('end', () => {
        if (r.statusCode >= 200 && r.statusCode < 300) {
          // Return public URL (cache-bust with timestamp so client refreshes)
          resolve(`${_url}/storage/v1/object/public/${bucket}/${encodeURI(objectPath)}?v=${Date.now()}`)
        } else {
          reject(new Error(`Storage ${r.statusCode}: ${data}`))
        }
      })
    })
    req.on('error', reject)
    req.write(buffer)
    req.end()
  })
}

// -- Full sync cycle ----------------------------------------------------------
async function syncNow() {
  if (_syncing) {
    _pendingSync = true
    return _status
  }
  if (!_url || !_key) {
    log.error('[sync] No URL or key — url:', !!_url, 'key:', !!_key)
    return _status
  }
  let bizId
  try { bizId = await resolveBusinessId() } catch (e) { log.error('[sync] resolveBusinessId failed:', e.message) }
  if (!bizId) {
    _status.state = 'no_business_id'
    log.error('[sync] No business_id found')
    return _status
  }
  log.info('[sync] Starting sync for business:', bizId)

  _syncing = true
  _pendingSync = false
  _status.state = 'syncing'
  _status.error = null
  let totalRows = 0

  try {
    // Phase 0 — push business meta (name, logo, etc.) before anything else
    try { await pushBusinessMeta(bizId) } catch (e) { log.error('[sync] pushBusinessMeta:', e.message) }

    for (const table of SYNC_TABLES) {
      try {
        const count = await syncTable(table)
        totalRows += count
      } catch (e) {
        log.error(`[sync] ${table.name}:`, e.message)
        updateSyncLog(table.name, getLastSyncedId(table.name), 0, e.message)
        _status.tables[table.name] = { synced: false, error: e.message }
      }
    }
    // ── Pull phase: Supabase → SQLite ────────────────────────────────────
    let totalPulled = 0
    for (const pt of PULL_TABLES) {
      try {
        const count = await pullTable(pt)
        totalPulled += count
      } catch (e) {
        log.error(`[sync-pull] ${pt.name}:`, e.message)
      }
    }
    if (totalPulled > 0) log.info(`[sync] Pull complete — ${totalPulled} rows pulled`)

    // ── Anti-resurrection: advance last_synced_at to NOW (post-pull) ───
    // Without this, last_synced_at is set during the push phase (BEFORE
    // pull). Pulled rows get their Supabase updated_at written locally.
    // If that timestamp >= the push-time last_synced_at, Pass 2's
    // `WHERE updated_at > lastSyncedAt` matches them and re-pushes stale
    // desktop data over the newer Supabase state — the resurrection bug.
    // By advancing the cursor to post-pull time, pulled rows' timestamps
    // are guaranteed older than lastSyncedAt, so they won't re-push.
    for (const table of SYNC_TABLES) {
      try {
        _db.rawPrepare(`UPDATE sync_log SET last_synced_at = datetime('now') WHERE table_name = ?`).run(table.name)
      } catch (e) { log.error(`[sync] post-pull cursor advance ${table.name}:`, e.message) }
    }

    _status.state = 'idle'
    _status.lastSync = new Date().toISOString()
    _status.totalRows = totalRows
    _status.totalPulled = totalPulled
    log.info(`[sync] Complete — ${totalRows} rows pushed, ${totalPulled} rows pulled`)
  } catch (e) {
    _status.state = 'error'
    _status.error = e.message
    log.error('[sync] Fatal:', e.message)
  } finally {
    _syncing = false
  }

  // Notify renderer
  try {
    const { BrowserWindow } = require('electron')
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.webContents.send('sync:status-update', _status)
  } catch {}

  // Re-run if a sync was requested while we were busy
  if (_pendingSync) {
    _pendingSync = false
    return syncNow()
  }

  return _status
}

// -- Auto sync interval -------------------------------------------------------
function startAutoSync(intervalMs = 30 * 60 * 1000) {
  if (_intervalId) clearInterval(_intervalId)
  // First sync after 60 seconds (let app boot fully)
  setTimeout(() => syncNow().catch(() => {}), 60 * 1000)
  _intervalId = setInterval(() => syncNow().catch(() => {}), intervalMs)
  log.info(`[sync] Auto-sync every ${Math.round(intervalMs / 60000)} min`)
  // Kick off realtime listener so web writes land on desktop within seconds
  // instead of waiting up to intervalMs. Fires in the background; failures
  // degrade gracefully to the polling interval.
  startRealtime().catch(e => log.warn('[sync] realtime start failed:', e.message))
}

function stopAutoSync() {
  if (_intervalId) { clearInterval(_intervalId); _intervalId = null }
  stopRealtime()
}

// -- Realtime (Supabase WebSocket) --------------------------------------------
// Listens for INSERT/UPDATE/DELETE on this business's rows across every synced
// table and kicks a debounced pullNow() so local SQLite catches up immediately.
async function startRealtime() {
  if (!_url || !_key || _realtimeChannel) return
  const bizId = await resolveBusinessId().catch(() => null)
  if (!bizId) { log.warn('[sync] realtime skipped — no business_id'); return }

  let createClient
  try { ({ createClient } = require('@supabase/supabase-js')) }
  catch (e) { log.warn('[sync] realtime unavailable — @supabase/supabase-js not installed'); return }

  _realtimeClient = createClient(_url, _key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 5 } },
  })

  const onChange = (payload) => {
    const tbl = payload?.table || '?'
    if (_realtimeDebounce) clearTimeout(_realtimeDebounce)
    _realtimeDebounce = setTimeout(() => {
      log.info(`[sync] realtime → pullNow() (triggered by ${tbl})`)
      pullNow().catch(e => log.error('[sync] realtime pull failed:', e.message))
    }, 1500)
  }

  // Subscribe to the base tables only — Supabase realtime does not broadcast
  // from views, so we listen on `staff` (the real table underneath the
  // `users` view) and rely on the pull's view-backed SELECT to upsert locally.
  const tables = [
    'services','washers','sellers','clients','inventory_items','ncf_sequences',
    'empleados','categorias_servicio','staff','tickets','ticket_items','queue',
    'washer_commissions','seller_commissions','cajero_commissions',
    'credit_payments','cuadre_caja','caja_chica','notas_credito',
    'inventory_transactions','compras_607','payroll_runs','salary_changes',
    'activity_log',
  ]

  _realtimeChannel = _realtimeClient.channel(`tx-sync-${bizId}`)
  for (const t of tables) {
    _realtimeChannel.on('postgres_changes', {
      event: '*', schema: 'public', table: t, filter: `business_id=eq.${bizId}`,
    }, onChange)
  }

  _realtimeChannel.subscribe(status => {
    log.info('[sync] realtime status:', status)
  })
}

function stopRealtime() {
  if (_realtimeDebounce) { clearTimeout(_realtimeDebounce); _realtimeDebounce = null }
  if (_realtimeChannel && _realtimeClient) {
    try { _realtimeClient.removeChannel(_realtimeChannel) } catch {}
  }
  _realtimeChannel = null
  _realtimeClient = null
}

function getStatus() {
  return { ..._status }
}

module.exports = { init, startAutoSync, stopAutoSync, syncNow, pullNow, getStatus }
