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
const { isBusinessSetting } = require('./settingsWhitelist')

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

function safeParseJson(s) { try { return JSON.parse(s) } catch { return null } }

// -- State --------------------------------------------------------------------
let _db = null
let _url = ''
let _key = ''
let _businessId = null
let _intervalId = null
let _syncing = false
let _pendingSync = false
let _status = { state: 'idle', lastSync: null, tables: {}, error: null }
let _errorLogSink = null
function setErrorLogSink(fn) { _errorLogSink = typeof fn === 'function' ? fn : null }
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
      happy_hour_price: r.happy_hour_price != null ? r.happy_hour_price : null,
      happy_hour_start: r.happy_hour_start || null,
      happy_hour_end:   r.happy_hour_end   || null,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  // v2.1: washers + sellers sync entries removed — consolidated into `empleados`.
  // All lavador/vendedor cross-device movement now rides the empleados entry
  // further down in this array.
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
      // v2.4 — Salon: loyalty + stylist preference + allergies
      loyalty_points: r.loyalty_points ?? 0,
      allergies: r.allergies || null,
      preferred_stylist_supabase_id: r.preferred_stylist_supabase_id || null,
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
      sold_by_weight: !!(r.sold_by_weight || 0),
      unit: r.unit || null,
      price_per_unit: r.price_per_unit != null ? r.price_per_unit : null,
      bottle_deposit: r.bottle_deposit != null ? r.bottle_deposit : null,
      tare_default: r.tare_default != null ? r.tare_default : null,
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

  // Phase 1 (cont.) — multi-vertical root entities
  {
    name: 'vehicles',
    cols: r => ({
      supabase_id: r.supabase_id,
      vin: r.vin,
      plate: r.plate,
      make: r.make,
      model: r.model,
      year: r.year,
      color: r.color,
      mileage: r.mileage,
      odometer_km: r.odometer_km,
      last_service_km: r.last_service_km,
      last_service_at: r.last_service_at,
      next_service_km: r.next_service_km,
      next_service_at: r.next_service_at,
      client_supabase_id: r.client_supabase_id || null,
      notes: r.notes,
      active: !!(r.active ?? 1),
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'service_bays',
    cols: r => ({
      supabase_id: r.supabase_id,
      name: r.name,
      status: r.status,
      current_work_order_supabase_id: r.current_work_order_supabase_id || null,
      capacity: r.capacity,
      bay_type: r.bay_type,
      active: !!(r.active ?? 1),
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'stylist_schedules',
    cols: r => ({
      supabase_id: r.supabase_id,
      empleado_supabase_id: r.empleado_supabase_id,
      day_of_week: r.day_of_week,
      start_time: r.start_time,
      end_time: r.end_time,
      active: !!(r.active ?? 1),
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },

  {
    name: 'users',
    supabaseTable: 'staff', // users is a VIEW on staff — can't INSERT with ON CONFLICT on views
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
        // v2.1: legacy washer_ids (INT array as JSON) replaced by JSON array of empleado UUIDs.
        // seller_supabase_id keeps its name on the wire but now resolves against empleados (tipo='vendedor').
        washer_empleado_supabase_ids: r.washer_empleado_supabase_ids || '[]',
        seller_empleado_supabase_id: r.seller_empleado_supabase_id || null,
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
        mode: r.mode || null,
        converted_from_mesa_supabase_id: r.converted_from_mesa_supabase_id || null,
        converted_from_ticket_supabase_id: r.converted_from_ticket_supabase_id || null,
        payment_parts: r.payment_parts
          ? (typeof r.payment_parts === 'string' ? JSON.parse(r.payment_parts) : r.payment_parts)
          : null,
        split_bill: !!(r.split_bill || 0),
        paid_at: r.status === 'cobrado' ? (r.created_at || new Date().toISOString()) : null,
        created_at: r.created_at || new Date().toISOString(),
        updated_at: r.updated_at || null,
      }
    },
  },

  // Phase 2 (cont.) — multi-vertical dependent entities
  {
    name: 'work_orders',
    cols: r => ({
      supabase_id: r.supabase_id,
      vehicle_supabase_id: r.vehicle_supabase_id || null,
      client_supabase_id: r.client_supabase_id || null,
      technician_empleado_supabase_id: r.technician_empleado_supabase_id || null,
      bay_supabase_id: r.bay_supabase_id || null,
      status: r.status,
      estimated_total: r.estimated_total,
      actual_total: r.actual_total,
      labor_total: r.labor_total,
      parts_total: r.parts_total,
      itbis: r.itbis,
      total: r.total,
      inspection_json: typeof r.inspection_json === 'string' ? safeParseJson(r.inspection_json) : (r.inspection_json || null),
      estimate_approved_at: r.estimate_approved_at,
      customer_signature_url: r.customer_signature_url,
      customer_approval_token: r.customer_approval_token,
      expected_parts_arrival: r.expected_parts_arrival,
      odometer_in_km: r.odometer_in_km,
      odometer_out_km: r.odometer_out_km,
      promised_date: r.promised_date,
      completed_date: r.completed_date,
      notes: r.notes,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'appointments',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_supabase_id: r.client_supabase_id || null,
      empleado_supabase_id: r.empleado_supabase_id || null,
      date: r.date,
      start_time: r.start_time,
      end_time: r.end_time,
      status: r.status,
      services: r.services,
      notes: r.notes,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'loans',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_supabase_id: r.client_supabase_id || null,
      principal: r.principal,
      term_months: r.term_months,
      interest_rate: r.interest_rate,
      monthly_payment: r.monthly_payment,
      status: r.status,
      disbursed_at: r.disbursed_at,
      next_due_date: r.next_due_date,
      total_paid: r.total_paid,
      total_interest: r.total_interest,
      method: r.method || 'french',
      mora_rate_daily: r.mora_rate_daily ?? 0.005,
      days_late: r.days_late ?? 0,
      mora_amount: r.mora_amount ?? 0,
      notes: r.notes,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
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
      weight: r.weight != null ? r.weight : null,
      unit: r.unit || null,
      price_per_unit: r.price_per_unit != null ? r.price_per_unit : null,
      inventory_item_supabase_id: r.inventory_item_supabase_id || null,
      course:        r.course || null,
      kds_fired_at:  r.kds_fired_at || null,
      guest_number:  r.guest_number != null ? r.guest_number : null,
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
      // v2.1: washer_supabase_id column dropped — pushes empleado_supabase_id instead.
      empleado_supabase_id: r.empleado_supabase_id || null,
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
      // v2.1: washer_supabase_id replaced by empleado_supabase_id (lavador/hybrid).
      empleado_supabase_id: r.empleado_supabase_id,
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
      // v2.1: seller_supabase_id replaced by empleado_supabase_id (vendedor/hybrid).
      empleado_supabase_id: r.empleado_supabase_id,
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

  // Phase 4 — payroll + adelantos + e-CF submissions + audit logs (depend on empleados/tickets)
  {
    name: 'adelantos',
    cols: r => ({
      supabase_id: r.supabase_id,
      empleado_supabase_id: r.empleado_supabase_id,
      amount: r.amount,
      date: r.date,
      notes: r.notes,
      status: r.status,
      deducted_at: r.deducted_at,
      approved_by: r.approved_by,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
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
  // v2.4 — Carwash memberships + wash_combos (resolve vehicle + client FKs on push)
  {
    name: 'memberships',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_supabase_id: r.client_supabase_id,
      vehicle_supabase_id: r.vehicle_supabase_id,
      plan_name: r.plan_name,
      plan_price: r.plan_price,
      wash_quota_per_month: r.wash_quota_per_month,
      washes_used_this_period: r.washes_used_this_period,
      period_start: r.period_start,
      period_end: r.period_end,
      start_date: r.start_date,
      end_date: r.end_date,
      status: r.status,
      notes: r.notes,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'wash_combos',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_supabase_id: r.client_supabase_id,
      vehicle_supabase_id: r.vehicle_supabase_id,
      combo_name: r.combo_name,
      total_washes: r.total_washes,
      used_washes: r.used_washes,
      purchase_price: r.purchase_price,
      purchased_at: r.purchased_at,
      expires_at: r.expires_at,
      status: r.status,
      notes: r.notes,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  // v2.6 — Service vertical
  {
    name: 'subscriptions',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_supabase_id: r.client_supabase_id || null,
      service_supabase_id: r.service_supabase_id || null,
      plan_name: r.plan_name,
      interval_days: r.interval_days,
      amount: r.amount,
      start_date: r.start_date,
      next_billing_date: r.next_billing_date,
      last_billed_at: r.last_billed_at,
      status: r.status,
      notes: r.notes,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'service_packages',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_supabase_id: r.client_supabase_id || null,
      service_supabase_id: r.service_supabase_id || null,
      package_name: r.package_name,
      total_sessions: r.total_sessions,
      used_sessions: r.used_sessions,
      purchase_price: r.purchase_price,
      purchased_at: r.purchased_at,
      expires_at: r.expires_at,
      status: r.status,
      notes: r.notes,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'projects',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_supabase_id: r.client_supabase_id || null,
      name: r.name,
      description: r.description,
      status: r.status,
      total_billed: r.total_billed,
      closed_at: r.closed_at,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'client_service_rates',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_supabase_id: r.client_supabase_id,
      service_supabase_id: r.service_supabase_id,
      custom_price: r.custom_price,
      notes: r.notes,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  // Prestamos — phase 2 push shapers
  {
    name: 'loan_payments',
    cols: r => ({
      supabase_id: r.supabase_id,
      loan_supabase_id: r.loan_supabase_id,
      amount: r.amount,
      principal_portion: r.principal_portion || 0,
      interest_portion: r.interest_portion || 0,
      late_fee: r.late_fee || 0,
      payment_date: r.payment_date,
      due_date: r.due_date || null,
      status: r.status || 'on_time',
      notes: r.notes,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'pawn_items',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_supabase_id: r.client_supabase_id || null,
      loan_supabase_id: r.loan_supabase_id || null,
      description: r.description,
      estimated_value: r.estimated_value || 0,
      storage_location: r.storage_location,
      status: r.status || 'held',
      redeem_deadline: r.redeem_deadline,
      ticket_code: r.ticket_code || null,
      redemption_date: r.redemption_date || null,
      notes: r.notes,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'loan_schedule',
    cols: r => ({
      supabase_id: r.supabase_id,
      loan_supabase_id: r.loan_supabase_id,
      installment_no: r.installment_no,
      due_date: r.due_date,
      principal_due: r.principal_due || 0,
      interest_due: r.interest_due || 0,
      total_due: r.total_due || 0,
      paid_amount: r.paid_amount || 0,
      paid_at: r.paid_at || null,
      status: r.status || 'pending',
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'collections_log',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_supabase_id: r.client_supabase_id || null,
      loan_supabase_id: r.loan_supabase_id || null,
      channel: r.channel,
      outcome: r.outcome,
      notes: r.notes,
      contacted_at: r.contacted_at || new Date().toISOString(),
      next_contact_date: r.next_contact_date || null,
      created_by_staff_id: r.created_by_staff_id || null,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },

  // v2.3 — app_settings (business-level keys only — whitelist-driven).
  // Device-only keys (printer, print_*, hwid, sync internals) are filtered
  // out via rowFilter so they never leak to the cloud. See
  // electron/settingsWhitelist.js for the full key classification.
  {
    name: 'app_settings',
    naturalKey: 'key',
    rowFilter: (r) => isBusinessSetting(r.key),
    cols: r => ({
      supabase_id: r.supabase_id,
      key: r.key,
      value: r.value,
      updated_at: r.updated_at || new Date().toISOString(),
    }),
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
        updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
        last_synced_at TEXT,
        last_pull_at   TEXT
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
  const doPost = (payload) => new Promise((resolve, reject) => {
    const reqUrl = new URL(`${_url}/rest/v1/${table}?on_conflict=business_id,supabase_id`)
    const body = JSON.stringify(payload)
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
          resolve({ ok: true, count: payload.length })
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

  try {
    return await doPost(cleaned)
  } catch (e) {
    // 409 = unique constraint violation (e.g. natural key conflict on entity tables).
    // Retry individual rows so one bad row doesn't block the whole batch.
    if (e.message?.includes('409') && cleaned.length > 1) {
      let ok = 0
      for (const row of cleaned) {
        try { await doPost([row]); ok++ } catch (e2) {
          // 409/23505 = natural key duplicate — row exists under different supabase_id, skip
          if (e2.message?.includes('23505') || e2.message?.includes('409')) {
            log.warn(`[sync] ${table}: skipped duplicate natural key for ${row.supabase_id}`)
          } else {
            log.error(`[sync] ${table}: row ${row.supabase_id} failed:`, e2.message)
          }
        }
      }
      return { ok: true, count: ok }
    }
    throw e
  }
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
  // v2.3.9 — mirror sync errors into the main error.log so they're visible to
  // users / support without having to query sync_log. Silent sync failures
  // cost us hours on the activity_log RLS bug.
  if (error && _errorLogSink) {
    try { _errorLogSink(`sync-push:${tableName}`, new Error(String(error).slice(0, 500)), [{ lastId, rowCount }]) } catch {}
  }
  try {
    // v2.0.2 — use ISO 8601 UTC format so last_synced_at is lexicographically
    // comparable to updated_at (which the v2 triggers also write in ISO).
    // Previously datetime('now') produced SQL-space format ('YYYY-MM-DD HH:MM:SS')
    // while updated_at was ISO ('YYYY-MM-DDTHH:MM:SS.fffZ'). String compare ranked
    // every pulled row's updated_at ABOVE last_synced_at (T > space), causing
    // Pass 2 to re-push every pulled row on every cycle — the sync loop.
    _db.rawPrepare(`INSERT INTO sync_log (table_name, last_synced_id, row_count, error, updated_at, last_synced_at)
      VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(table_name) DO UPDATE SET
        last_synced_id = excluded.last_synced_id,
        row_count = excluded.row_count,
        error = excluded.error,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        last_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
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
// v2.1: washer_ids → washer_empleado_supabase_ids (JSON array of empleado UUIDs).
const JSON_COLUMNS = new Set(['ecf_result', 'washer_empleado_supabase_ids', 'ticket_ids', 'denominaciones', 'services_json', 'metadata', 'services'])

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
  { name: 'services', strategy: 'lww', naturalKey: 'name', cols: ['name','name_en','category','price','cost','aplica_itbis','active','is_wash','no_commission','commission_washer','commission_seller','commission_cashier','sort_order','printer_route','is_menu_item','course','station','happy_hour_price','happy_hour_start','happy_hour_end','updated_at'] },
  // v2.1: washers + sellers PULL entries removed — consolidated into `empleados`
  // (tipo='lavador'/'vendedor'). Their data is now part of the empleados pull below.
  { name: 'clients', strategy: 'lww', naturalKey: 'name', cols: ['name','rnc','phone','email','address','credit_limit','balance','visits','total_spent','notes','active','loyalty_points','allergies','created_at','updated_at'],
    fkCols: { preferred_stylist_supabase_id: 'empleados' } },
  { name: 'inventory_items', strategy: 'lww', naturalKey: 'name', cols: ['name','sku','barcode','category','price','cost','quantity','min_quantity','aplica_itbis','sold_by_weight','unit','price_per_unit','bottle_deposit','tare_default','active','updated_at'] },
  { name: 'mesas', strategy: 'lww', naturalKey: 'name', cols: ['name','zone','capacity','status','guests_count','seated_at','sort_order','active','created_at','updated_at'],
    fkCols: { waiter_empleado_supabase_id: 'empleados' } },
  { name: 'modificadores', strategy: 'lww', naturalKey: 'name', cols: ['name','group_name','price_delta','min_select','max_select','default_selected','sort_order','active','created_at','updated_at'] },
  { name: 'service_modificadores', strategy: 'lww', cols: ['is_required','created_at','updated_at'],
    fkCols: { service_supabase_id: 'services', modificador_supabase_id: 'modificadores' } },
  { name: 'ncf_sequences', strategy: 'lww', cols: ['type','prefix','current_number','limit_number','valid_until','active','enabled','updated_at'] },
  { name: 'empleados', strategy: 'lww', naturalKey: 'nombre', cols: ['nombre','cedula','phone','tipo','salary','start_date','active','ref_id','puesto','email','bank_account','tss_id','role','comision_pct','updated_at'] },
  { name: 'categorias_servicio', strategy: 'lww', naturalKey: 'nombre', cols: ['nombre','orden','updated_at'] },
  // `users` is a VIEW on `staff` in Supabase — PostgREST can't upsert into a
  // view without INSTEAD OF triggers. Route push to the base `staff` table.
  // Without this, every PIN/username/role change on desktop was silently lost.
  { name: 'users', supabaseTable: 'staff', strategy: 'lww', naturalKey: 'username', cols: ['name','username','pin_hash','role','discount_pct','commission_pct','cedula','start_date','employee_id','active','created_at','updated_at'] },

  // Phase 1 (cont.) — multi-vertical root entities
  { name: 'vehicles', strategy: 'lww', naturalKey: 'vin', cols: ['vin','plate','make','model','year','color','mileage','odometer_km','last_service_km','last_service_at','next_service_km','next_service_at','notes','active','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients' } },
  { name: 'service_bays', strategy: 'lww', naturalKey: 'name', cols: ['name','status','current_work_order_supabase_id','capacity','bay_type','active','created_at','updated_at'] },
  { name: 'stylist_schedules', strategy: 'lww', cols: ['day_of_week','start_time','end_time','active','created_at','updated_at'],
    fkCols: { empleado_supabase_id: 'empleados' } },

  // NOTE on `'users'` refTable in fkCols below (cajero_supabase_id / user_supabase_id /
  // approved_by_supabase_id): on Supabase, `users` is a VIEW over the `staff` base table
  // (re-created post-v2.1 schema consolidation so PostgREST FK resolution keeps working).
  // On the desktop SQLite, the physical table is `users` (no `staff` table exists locally),
  // and the local resolver below does `SELECT id FROM ${refTable} WHERE supabase_id = ?`,
  // so the value MUST stay as `'users'` — switching to `'staff'` would silently break local
  // FK integer backfill on every desktop install. If a future migration drops the Supabase
  // `users` view permanently AND adds a local `staff` table, change all six entries below
  // to `'staff'` in lockstep with that migration.

  // Phase 2 — tickets + dependents
  { name: 'tickets', strategy: 'fww',
    // v2.1: washer_ids legacy INT-array column dropped → washer_empleado_supabase_ids JSON of UUIDs.
    // seller_supabase_id is still the column name on the wire, but it now points at empleados.supabase_id
    // (tipo='vendedor'/'hybrid'); explicitly resolved against empleados below.
    cols: ['doc_number','subtotal','descuento','itbis','ley','total','beverage_subtotal','payment_method','comprobante_type','ncf','ecf_result','tipo_venta','status','void_reason','void_by','void_at','vehicle_plate','vehicle_color','vehicle_make','notes','washer_empleado_supabase_ids','tip_amount','fulfillment_type','mesa_supabase_id','mode','converted_from_mesa_supabase_id','converted_from_ticket_supabase_id','payment_parts','split_bill','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients', seller_empleado_supabase_id: 'empleados', cajero_supabase_id: 'users' },
    statusSync: ['status', 'void_reason', 'void_by', 'void_at', 'updated_at'] },
  { name: 'ticket_items', strategy: 'fww',
    cols: ['name','price','cost','itbis','is_wash','quantity','sku','weight','unit','price_per_unit','course','kds_fired_at','guest_number','created_at','updated_at'],
    fkCols: { ticket_supabase_id: 'tickets', service_supabase_id: 'services', inventory_item_supabase_id: 'inventory_items' } },
  { name: 'queue', strategy: 'lww',
    cols: ['status','assigned_at','completed_at','created_at','updated_at'],
    // v2.1: washer_supabase_id column dropped → empleado_supabase_id (lavador/hybrid).
    fkCols: { ticket_supabase_id: 'tickets', empleado_supabase_id: 'empleados' } },
  { name: 'ticket_item_modificadores', strategy: 'fww',
    cols: ['name_snapshot','price_delta_snapshot','created_at','updated_at'],
    fkCols: { ticket_item_supabase_id: 'ticket_items', modificador_supabase_id: 'modificadores' } },
  { name: 'kds_events', strategy: 'fww',
    cols: ['station','status','fired_at','started_at','ready_at','bumped_at','created_at','updated_at'],
    fkCols: { ticket_item_supabase_id: 'ticket_items', mesa_supabase_id: 'mesas' } },

  // Phase 2 (cont.) — multi-vertical dependent entities
  { name: 'work_orders', strategy: 'lww',
    cols: ['status','estimated_total','actual_total','labor_total','parts_total','itbis','total','inspection_json','estimate_approved_at','customer_signature_url','customer_approval_token','expected_parts_arrival','odometer_in_km','odometer_out_km','promised_date','completed_date','notes','created_at','updated_at'],
    fkCols: { vehicle_supabase_id: 'vehicles', client_supabase_id: 'clients', technician_empleado_supabase_id: 'empleados', bay_supabase_id: 'service_bays' } },
  { name: 'appointments', strategy: 'lww',
    cols: ['date','start_time','end_time','status','services','notes','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients', empleado_supabase_id: 'empleados' } },
  { name: 'loans', strategy: 'lww',
    cols: ['principal','term_months','interest_rate','monthly_payment','status','disbursed_at','next_due_date','total_paid','total_interest','method','mora_rate_daily','days_late','mora_amount','notes','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients' } },

  // Phase 3 — financial (FWW)
  { name: 'washer_commissions', strategy: 'fww',
    cols: ['base_amount','commission_pct','commission_amount','paid','paid_at','created_at','updated_at'],
    // v2.1: washer_supabase_id (→ washers) replaced by empleado_supabase_id (→ empleados, tipo='lavador').
    fkCols: { empleado_supabase_id: 'empleados', ticket_supabase_id: 'tickets' } },
  { name: 'seller_commissions', strategy: 'fww',
    cols: ['base_amount','commission_pct','commission_amount','paid','paid_at','created_at','updated_at'],
    fkCols: { empleado_supabase_id: 'empleados', ticket_supabase_id: 'tickets' } },
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

  // Phase 3 (cont.) — multi-vertical child entities
  { name: 'work_order_items', strategy: 'fww',
    cols: ['type','name','description','quantity','unit_price','total','warranty_months','created_at','updated_at'],
    fkCols: { work_order_supabase_id: 'work_orders', inventory_item_supabase_id: 'inventory_items' } },
  { name: 'loan_payments', strategy: 'fww',
    cols: ['amount','principal_portion','interest_portion','late_fee','payment_date','due_date','status','notes','created_at','updated_at'],
    fkCols: { loan_supabase_id: 'loans' } },
  { name: 'pawn_items', strategy: 'lww',
    cols: ['description','estimated_value','storage_location','status','redeem_deadline','ticket_code','redemption_date','notes','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients', loan_supabase_id: 'loans' } },
  { name: 'loan_schedule', strategy: 'fww',
    cols: ['installment_no','due_date','principal_due','interest_due','total_due','paid_amount','paid_at','status','created_at','updated_at'],
    fkCols: { loan_supabase_id: 'loans' } },
  { name: 'collections_log', strategy: 'fww',
    cols: ['channel','outcome','notes','contacted_at','next_contact_date','created_by_staff_id','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients', loan_supabase_id: 'loans' } },

  // Phase 4 — payroll audit trail + adelantos (FWW — financial records, never overwritten)
  // Note: ecf_submissions is push-only (desktop-authored per-device, no pull) — column name
  // mismatch between SQLite `dgii_status INTEGER` and Supabase `status TEXT` makes pulling unsafe.
  // Note: queue_deletions is push-only (append-only log, desktop-authored).
  { name: 'adelantos', strategy: 'lww',
    cols: ['amount','date','notes','status','deducted_at','approved_by','created_at','updated_at'],
    fkCols: { empleado_supabase_id: 'empleados' } },
  { name: 'payroll_runs', strategy: 'fww',
    cols: ['period_start','period_end','base','commissions','bonuses','sfs_employee','afp_employee','isr','other_deductions','deductions','sfs_employer','afp_employer','infotep_employer','net','notes','paid_at','created_at','updated_at'],
    fkCols: { empleado_supabase_id: 'empleados' } },
  { name: 'salary_changes', strategy: 'fww',
    cols: ['old_salary','new_salary','effective_date','reason','created_at','updated_at'],
    fkCols: { empleado_supabase_id: 'empleados' } },

  // Activity log — FWW (append-only audit feed)
  { name: 'activity_log', strategy: 'fww',
    cols: ['event_type','severity','actor_supabase_id','actor_name','actor_role','target_type','target_id','target_name','amount','old_value','new_value','reason','metadata','created_at','updated_at'] },

  // v2.4 — Carwash memberships + wash_combos (LWW — desktop is edit-heavy source of truth)
  { name: 'memberships', strategy: 'lww',
    cols: ['plan_name','plan_price','wash_quota_per_month','washes_used_this_period',
           'period_start','period_end','start_date','end_date','status','notes','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients', vehicle_supabase_id: 'vehicles' } },
  { name: 'wash_combos', strategy: 'lww',
    cols: ['combo_name','total_washes','used_washes','purchase_price','purchased_at',
           'expires_at','status','notes','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients', vehicle_supabase_id: 'vehicles' } },

  // v2.6 — Service vertical
  { name: 'subscriptions', strategy: 'lww',
    cols: ['plan_name','interval_days','amount','start_date','next_billing_date','last_billed_at',
           'status','notes','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients', service_supabase_id: 'services' } },
  { name: 'service_packages', strategy: 'lww',
    cols: ['package_name','total_sessions','used_sessions','purchase_price','purchased_at',
           'expires_at','status','notes','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients', service_supabase_id: 'services' } },
  { name: 'projects', strategy: 'lww',
    cols: ['name','description','status','total_billed','closed_at','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients' } },
  { name: 'client_service_rates', strategy: 'lww',
    cols: ['custom_price','notes','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients', service_supabase_id: 'services' } },

  // v2.3 — app_settings pull (whitelist-guarded, handled by pullAppSettings()).
  // cols/strategy are informational only — the pull path short-circuits at the
  // top of pullTable() for this name.
  { name: 'app_settings', strategy: 'lww', naturalKey: 'key',
    cols: ['key','value','updated_at'] },
]

// -- Pull upsert: Supabase row -> SQLite row ----------------------------------
function pullUpsertRow(tableName, row, strategy, cols, fkCols, statusSync, naturalKey) {
  if (!row.supabase_id) return

  // 1. Try match by supabase_id (primary identity)
  // Note: not all tables have `active` — use COALESCE via a safe query
  let existing
  try {
    existing = _db.rawPrepare(`SELECT id, updated_at, supabase_id, active FROM ${tableName} WHERE supabase_id = ?`).get(row.supabase_id)
  } catch {
    // Table lacks `active` column — query without it
    existing = _db.rawPrepare(`SELECT id, updated_at, supabase_id FROM ${tableName} WHERE supabase_id = ?`).get(row.supabase_id)
  }

  // 2. If no match and table has a natural key, try match by natural key.
  //    This handles DB rebuilds where the local supabase_id was lost/regenerated.
  //    "Healing": adopt the server's supabase_id so future syncs match correctly.
  //    SAFETY: only heal if EXACTLY ONE local row matches — multiple matches means
  //    the name is ambiguous (e.g. two clients named "Juan"), so skip healing to
  //    avoid overwriting the wrong record. The row will INSERT as a new local entry.
  if (!existing && naturalKey && row[naturalKey]) {
    try {
      let matches
      try {
        matches = _db.rawPrepare(
          `SELECT id, updated_at, supabase_id, active FROM ${tableName} WHERE ${naturalKey} = ?`
        ).all(row[naturalKey])
      } catch {
        matches = _db.rawPrepare(
          `SELECT id, updated_at, supabase_id FROM ${tableName} WHERE ${naturalKey} = ?`
        ).all(row[naturalKey])
      }
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

    // LWW: only update if remote is newer.
    // CRITICAL — compare as numeric ms, NEVER as strings. SQLite historically
    // stored `'YYYY-MM-DD HH:MM:SS'` (space separator) while Supabase returns
    // `'YYYY-MM-DDTHH:MM:SS.µµµ+00:00'` (T separator). String compare treats
    // ' ' (0x20) < 'T' (0x54) so remote ALWAYS sorted higher regardless of
    // actual wall-clock time, causing every pull to clobber every local edit.
    // v2.0 migration rewrites existing SQLite rows to ISO-8601 so the two
    // shapes become identical, but this guard defends against any stray row
    // that slipped through (old migration flag set + some table missed).
    if (existing.updated_at && row.updated_at) {
      const localRaw  = String(existing.updated_at)
      const remoteRaw = String(row.updated_at)
      // Normalize the SQLite "YYYY-MM-DD HH:MM:SS" shape to ISO before Date.parse
      // so Date.parse doesn't silently NaN on some Electron/Chromium builds.
      const localIso  = localRaw.includes('T')  ? localRaw  : localRaw.replace(' ', 'T') + (localRaw.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(localRaw) ? '' : 'Z')
      const remoteIso = remoteRaw.includes('T') ? remoteRaw : remoteRaw.replace(' ', 'T') + (remoteRaw.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(remoteRaw) ? '' : 'Z')
      const localMs  = Date.parse(localIso)
      const remoteMs = Date.parse(remoteIso)
      if (Number.isFinite(localMs) && Number.isFinite(remoteMs) && remoteMs <= localMs) return
    }

    // Guard: if locally soft-deleted (active=0) and remote says active, local delete wins.
    // Desktop is authoritative for deletions — pull must never resurrect deleted rows.
    if (existing.active === 0 && (row.active === true || row.active === 1)) return

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

  // Special-case: app_settings is keyed by TEXT `key` and we only accept
  // whitelisted business-level keys on pull. Device keys (printer, print_*)
  // on this device MUST NEVER be clobbered by cloud state.
  if (name === 'app_settings') {
    return await pullAppSettings(bizId)
  }

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
      if (ok && row.updated_at) {
        if (!latestUpdatedAt) {
          latestUpdatedAt = row.updated_at
        } else {
          const rMs = Date.parse(String(row.updated_at).includes('T') ? row.updated_at : String(row.updated_at).replace(' ', 'T') + 'Z')
          const lMs = Date.parse(String(latestUpdatedAt).includes('T') ? latestUpdatedAt : String(latestUpdatedAt).replace(' ', 'T') + 'Z')
          if (Number.isFinite(rMs) && Number.isFinite(lMs) && rMs > lMs) latestUpdatedAt = row.updated_at
          else if (!Number.isFinite(lMs)) latestUpdatedAt = row.updated_at
        }
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

// -- app_settings pull (whitelist-guarded, keyed by TEXT) --------------------
// Pulls business-level keys from Supabase into local SQLite. Device-local keys
// are defended at TWO layers: (1) the whitelist check here drops any rogue
// cloud row whose key is classified device-only, and (2) the web writer in
// packages/data/web.js refuses to upsert device keys in the first place.
async function pullAppSettings(bizId) {
  const lastPull = getLastPullAt('app_settings')
  const FETCH_SIZE = 500
  let totalPulled = 0
  let latestUpdatedAt = lastPull
  let offset = 0

  const upsert = _db.rawPrepare(`
    INSERT INTO app_settings(key, value, business_id, supabase_id, updated_at)
    VALUES(?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value       = excluded.value,
      business_id = excluded.business_id,
      supabase_id = COALESCE(app_settings.supabase_id, excluded.supabase_id),
      updated_at  = excluded.updated_at
    WHERE excluded.updated_at >= COALESCE(app_settings.updated_at, '')
  `)

  while (true) {
    const params = {
      'business_id': `eq.${bizId}`,
      'order': 'updated_at.asc',
      'limit': String(FETCH_SIZE),
      'offset': String(offset),
      'supabase_id': 'not.is.null',
    }
    if (lastPull) params['updated_at'] = `gte.${lastPull}`

    let rows
    try { rows = await supabaseFetch('app_settings', params) }
    catch (e) { log.error('[sync-pull] app_settings: fetch failed:', e.message); break }
    if (!rows.length) break

    for (const row of rows) {
      if (!row.supabase_id || !row.key) continue
      if (!isBusinessSetting(row.key)) continue // device keys rejected defensively
      try {
        upsert.run(row.key, row.value ?? '', row.business_id || bizId, row.supabase_id, row.updated_at || new Date().toISOString())
      } catch (e) {
        log.error('[sync-pull] app_settings: upsert failed for', row.key, ':', e.message)
      }
      if (row.updated_at) latestUpdatedAt = row.updated_at
    }

    totalPulled += rows.length
    offset += FETCH_SIZE
    if (rows.length < FETCH_SIZE) break
  }

  if (latestUpdatedAt) updatePullLog('app_settings', latestUpdatedAt)
  if (totalPulled > 0) log.info(`[sync-pull] app_settings: pulled ${totalPulled} business-level rows`)
  return totalPulled
}

// -- Multi-biz orphan guard ---------------------------------------------------
// If the resolved business_id ever changes (license re-keyed to a different
// account, hardware moved, manual SUPABASE_BUSINESS_ID swap), the existing
// local rows belong to the OLD tenant and would now be invisible from the new
// tenant's pull cursor. Instead of silently mixing two tenants' data — or
// destroying it with a DELETE — we copy each synced table into a dated
// archive_<table>_<yyyymmdd> table on first pull under the new biz_id, then
// truncate the live table so the next pull rebuilds clean. This is destructive
// but recoverable: archives stay forever, support can restore on demand.
function archiveAndResetForBizSwap(newBizId) {
  try {
    const stamp = new Date().toISOString().slice(0,10).replace(/-/g,'')
    const lastBizRow = _db.rawPrepare("SELECT value FROM app_settings WHERE key='last_pulled_business_id'").get()
    const lastBiz = lastBizRow?.value || null
    if (!lastBiz) {
      // First pull ever — just record the biz_id, nothing to archive.
      _db.rawPrepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('last_pulled_business_id',?)").run(String(newBizId))
      return
    }
    if (String(lastBiz) === String(newBizId)) return // same tenant — nothing to do

    log.warn(`[sync-pull] business_id changed: ${lastBiz} → ${newBizId} — archiving local data for safety`)
    const archivedTables = []
    for (const pt of PULL_TABLES) {
      const t = pt.name
      try {
        // Skip if local table has zero rows (no data to archive).
        const cnt = _db.rawPrepare(`SELECT COUNT(*) AS n FROM ${t}`).get()?.n || 0
        if (cnt === 0) continue
        const archive = `archived_${t}_${stamp}`
        // CTAS: copy all rows into a dated snapshot. Idempotent — if the same
        // dated archive already exists from a same-day re-trigger, we append.
        _db.rawPrepare(`CREATE TABLE IF NOT EXISTS ${archive} AS SELECT * FROM ${t} WHERE 0`).run()
        _db.rawPrepare(`INSERT INTO ${archive} SELECT * FROM ${t}`).run()
        _db.rawPrepare(`DELETE FROM ${t}`).run()
        // Reset pull cursor so the new tenant's rows pull from the beginning.
        try { _db.rawPrepare(`DELETE FROM sync_log WHERE table_name=?`).run(t) } catch {}
        archivedTables.push(`${archive}(${cnt})`)
      } catch (e) {
        log.error(`[sync-pull] archive ${t} failed:`, e.message)
      }
    }
    _db.rawPrepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('business_id_changed_at',?)").run(new Date().toISOString())
    _db.rawPrepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('last_pulled_business_id',?)").run(String(newBizId))
    log.warn(`[sync-pull] biz-swap archive complete:`, archivedTables.join(', '))
  } catch (e) {
    log.error('[sync-pull] archiveAndResetForBizSwap failed:', e.message)
  }
}

// -- Pull all tables ----------------------------------------------------------
async function pullNow() {
  if (!_url || !_key) return { pulled: 0 }
  const bizId = await resolveBusinessId()
  if (!bizId) return { pulled: 0 }
  // v2.1: guard against pulling a different tenant's data on top of an existing
  // local DB — archive into archived_<table>_<yyyymmdd> instead of merging.
  archiveAndResetForBizSwap(bizId)

  const { BrowserWindow } = require('electron')
  const sendProgress = (payload) => {
    try {
      const w = BrowserWindow.getAllWindows()[0]
      if (w) w.webContents.send('sync:pull-progress', payload)
    } catch {}
  }

  // F16 — Total includes every PULL_TABLES entry + the business meta pull at the end.
  const totalSteps = PULL_TABLES.length + 1
  let step = 0
  let totalPulled = 0

  sendProgress({ stage: 'starting', done: 0, total: totalSteps, table: null })

  for (const pt of PULL_TABLES) {
    step += 1
    sendProgress({ stage: 'pulling', done: step - 1, total: totalSteps, table: pt.name })
    try {
      const count = await pullTable(pt)
      totalPulled += count
    } catch (e) {
      log.error(`[sync-pull] ${pt.name}:`, e.message)
    }
    sendProgress({ stage: 'pulling', done: step, total: totalSteps, table: pt.name })
  }

  // F15 — pull business meta (name/rnc/logo/settings) so ciudad/whatsapp/etc.
  // propagate across devices. Counts as one step for UI progress.
  step += 1
  sendProgress({ stage: 'pulling', done: step - 1, total: totalSteps, table: 'businesses' })
  try {
    await pullBusinessMeta(bizId)
  } catch (e) {
    log.error('[sync-pull] businesses:', e.message)
  }
  sendProgress({ stage: 'pulling', done: step, total: totalSteps, table: 'businesses' })

  // Reconcile deletes: owner-deletable tables. If a row was deleted in
  // Supabase (from web or another device), mirror the delete locally.
  try { await reconcileDeletes() } catch (e) { log.warn('[sync-pull] reconcile failed:', e.message) }

  log.info(`[sync-pull] Manual pull complete — ${totalPulled} rows`)

  // Notify renderer
  sendProgress({ stage: 'done', done: totalSteps, total: totalSteps, table: null })
  try {
    const w = BrowserWindow.getAllWindows()[0]
    if (w) w.webContents.send('sync:pull-complete', { pulled: totalPulled })
  } catch {}

  return { pulled: totalPulled, tables: totalSteps }
}

// -- Sync a single table (PUSH) -----------------------------------------------
async function syncTable(tableConfig) {
  const { name, cols, rowFilter } = tableConfig
  const pushTable = tableConfig.supabaseTable || name // VIEW override (e.g. users → staff)
  const bizId = await resolveBusinessId()
  if (!bizId) throw new Error('No business_id')

  const FETCH_SIZE = 500
  // app_settings has no `id INTEGER` column — it's keyed by TEXT `key`.
  // Use rowid as the cursor surrogate so pagination still works.
  const isKeyedTable = (name === 'app_settings')
  const idExpr = isKeyedTable ? 'rowid AS id' : 'id'
  let cursor = getLastSyncedId(name)
  let totalSynced = 0

  // Pagination loop — keep fetching until no more rows
  while (true) {
    let rows
    try {
      rows = _db.rawPrepare(`SELECT *, ${idExpr} FROM ${name} WHERE ${isKeyedTable ? 'rowid' : 'id'} > ? ORDER BY ${isKeyedTable ? 'rowid' : 'id'} LIMIT ?`).all(cursor, FETCH_SIZE)
    } catch (e) {
      throw new Error(`SQLite read ${name}: ${e.message}`)
    }

    if (!rows.length) break

    // Apply rowFilter (business-setting whitelist, etc.) BEFORE supabase_id
    // stamping so we don't generate UUIDs on rows we'd immediately discard.
    let filtered = rowFilter ? rows.filter(rowFilter) : rows

    // Stamp supabase_id on rows that lack it (e.g. app_settings rows created
    // before the v2.3 backfill). Persist locally so the next push is a no-op.
    if (filtered.length && (name === 'app_settings')) {
      const stampStmt = _db.rawPrepare('UPDATE app_settings SET supabase_id = ? WHERE key = ?')
      for (const r of filtered) {
        if (!r.supabase_id) {
          const uuid = crypto.randomUUID()
          try { stampStmt.run(uuid, r.key); r.supabase_id = uuid } catch {}
        }
      }
    }

    // Map rows to Supabase format, skip rows without supabase_id (pre-migration)
    const mapped = filtered.map(r => ({ business_id: bizId, ...cols(r) })).filter(r => r.supabase_id)

    // Batch upsert (500 at a time)
    if (mapped.length) {
      for (let i = 0; i < mapped.length; i += FETCH_SIZE) {
        const batch = mapped.slice(i, i + FETCH_SIZE)
        await supabaseUpsert(pushTable, batch)
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
      const orderCol = isKeyedTable ? 'rowid' : 'id'
      const updatedRows = _db.rawPrepare(
        `SELECT * FROM ${name} WHERE updated_at > ? AND supabase_id IS NOT NULL ORDER BY ${orderCol} LIMIT 2000`
      ).all(lastSyncedAt)
      const passTwoFiltered = rowFilter ? updatedRows.filter(rowFilter) : updatedRows
      if (passTwoFiltered.length) {
        const mapped = passTwoFiltered.map(r => ({ business_id: bizId, ...cols(r) })).filter(r => r.supabase_id)
        if (mapped.length) {
          for (let i = 0; i < mapped.length; i += FETCH_SIZE) {
            const batch = mapped.slice(i, i + FETCH_SIZE)
            await supabaseUpsert(pushTable, batch)
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
        // Storage RLS blocks anon key — warn once, not every cycle
        if (e.message?.includes('403') || e.message?.includes('Unauthorized')) {
          log.warn('[sync] Logo upload skipped (storage RLS — needs service role key)')
        } else {
          log.error('[sync] Logo upload failed:', e.message)
        }
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
    // Push the settings JSON (ciudad / biz_city / biz_type / whatsapp_* / fiscal cert
    // fields) so user edits in Mi Empresa actually survive a desktop wipe + re-pull.
    if (emp.settings) {
      try { updates.settings = typeof emp.settings === 'string' ? JSON.parse(emp.settings) : emp.settings } catch {}
    }
    if (!Object.keys(updates).length) return 0

    // ISO-8601 UTC — same shape the v2 SQLite migration produces, so LWW compares cleanly
    updates.updated_at = new Date().toISOString()

    // F12 — Prefer the server-side JSONB merge RPC when we're touching `settings`,
    // so concurrent writers (desktop-A's biz_city edit vs desktop-B's WhatsApp
    // edit vs validate.js's cert-status patch) stack additively instead of
    // clobbering one another. Falls back to the legacy full-PATCH path if the
    // RPC isn't available (older Supabase rev pre-v2 migration).
    if (updates.settings && typeof updates.settings === 'object') {
      const patchObj = updates.settings
      // Attempt merge RPC first
      try {
        const rpcBody = JSON.stringify({ p_business_id: bizId, p_patch: patchObj })
        const rpcOk = await new Promise((resolve) => {
          const reqUrl = new URL(`${_url}/rest/v1/rpc/merge_business_settings`)
          const req = https.request({
            hostname: reqUrl.hostname, path: reqUrl.pathname + reqUrl.search, method: 'POST',
            headers: {
              'apikey': _key, 'Authorization': `Bearer ${_key}`,
              'Content-Type': 'application/json', 'Prefer': 'return=minimal',
              'Content-Length': Buffer.byteLength(rpcBody),
            },
          }, (r) => {
            let data = ''
            r.on('data', c => data += c.toString())
            r.on('end', () => resolve(r.statusCode >= 200 && r.statusCode < 300))
          })
          req.on('error', () => resolve(false))
          req.setTimeout(SYNC_TIMEOUT_MS, () => { try { req.destroy() } catch {}; resolve(false) })
          req.write(rpcBody)
          req.end()
        })
        if (rpcOk) {
          // Merge RPC handled settings — drop it from the PATCH so we don't full-replace.
          delete updates.settings
          if (!Object.keys(updates).filter(k => k !== 'updated_at').length) return 1
        }
      } catch { /* fall through to legacy PATCH */ }
    }

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

// -- Pull business meta (F15) -------------------------------------------------
// Counterpart to pushBusinessMeta. Fetches `name, rnc, phone, address, email,
// logo_url, settings, plan` from Supabase and writes them to the local
// `businesses` row via db.empresaSave (same flat+JSON.stringify(settings)
// shape LicenseContext uses). This is the only path by which Device B ever
// sees Device A's ciudad / whatsapp / logo edits.
async function pullBusinessMeta(bizId) {
  if (!_url || !_key || !bizId) return 0
  try {
    const params = new URLSearchParams({
      'id': `eq.${bizId}`,
      'select': 'name,rnc,phone,address,email,logo_url,settings,plan,updated_at',
    })
    const rows = await new Promise((resolve, reject) => {
      const reqUrl = new URL(`${_url}/rest/v1/businesses?${params.toString()}`)
      https.get({
        hostname: reqUrl.hostname, path: reqUrl.pathname + reqUrl.search,
        headers: { 'apikey': _key, 'Authorization': `Bearer ${_key}` },
      }, (r) => {
        let data = ''
        r.on('data', c => data += c.toString())
        r.on('end', () => {
          if (r.statusCode >= 200 && r.statusCode < 300) {
            try { resolve(JSON.parse(data)) } catch { resolve([]) }
          } else reject(new Error(`businesses GET ${r.statusCode}: ${data.substring(0, 200)}`))
        })
      }).on('error', reject).setTimeout?.(SYNC_TIMEOUT_MS, function () { try { this.destroy() } catch {} })
    }).catch(e => { log.warn('[sync] pullBusinessMeta fetch:', e.message); return [] })

    const biz = Array.isArray(rows) && rows[0] ? rows[0] : null
    if (!biz) return 0

    // LWW check against local businesses.updated_at — only apply if remote is newer.
    try {
      const local = _db.rawPrepare('SELECT updated_at FROM businesses WHERE id=1').get()
      if (local?.updated_at && biz.updated_at) {
        const localRaw = String(local.updated_at)
        const remoteRaw = String(biz.updated_at)
        const localIso  = localRaw.includes('T')  ? localRaw  : localRaw.replace(' ', 'T') + (localRaw.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(localRaw) ? '' : 'Z')
        const remoteIso = remoteRaw.includes('T') ? remoteRaw : remoteRaw.replace(' ', 'T') + (remoteRaw.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(remoteRaw) ? '' : 'Z')
        const lMs = Date.parse(localIso)
        const rMs = Date.parse(remoteIso)
        if (Number.isFinite(lMs) && Number.isFinite(rMs) && rMs <= lMs) return 0
      }
    } catch {}

    // Build the same flat+settings payload shape empresaSave expects.
    // Settings JSONB → stringify for SQLite TEXT column (empresaSave will accept either).
    const payload = {}
    if (biz.name)    payload.name    = biz.name
    if (biz.rnc)     payload.rnc     = biz.rnc
    if (biz.phone)   payload.phone   = biz.phone
    if (biz.address) payload.address = biz.address
    if (biz.email)   payload.email   = biz.email
    if (biz.plan)    payload.plan    = biz.plan

    if (biz.settings) {
      let settingsObj = biz.settings
      if (typeof settingsObj === 'string') {
        try { settingsObj = JSON.parse(settingsObj) } catch { settingsObj = null }
      }
      if (settingsObj && typeof settingsObj === 'object' && !Array.isArray(settingsObj)) {
        // Merge with existing local settings so we don't drop keys that
        // haven't made the round-trip yet (e.g. device-local PEM cache).
        try {
          const localRow = _db.rawPrepare('SELECT settings FROM businesses WHERE id=1').get()
          let localObj = {}
          if (localRow?.settings) {
            try { localObj = typeof localRow.settings === 'string' ? JSON.parse(localRow.settings) : localRow.settings } catch {}
          }
          payload.settings = JSON.stringify({ ...localObj, ...settingsObj })
        } catch {
          payload.settings = JSON.stringify(settingsObj)
        }
      }
    }

    if (!Object.keys(payload).length) return 0

    // Delegate to the DB layer (which handles INSERT-if-missing, allowed-list filter, etc.)
    try {
      const dbMod = require('./database')
      if (dbMod && typeof dbMod.empresaSave === 'function') dbMod.empresaSave(payload)
    } catch (e) {
      log.warn('[sync] pullBusinessMeta empresaSave:', e.message)
    }
    log.info('[sync-pull] businesses: meta refreshed from Supabase')
    return 1
  } catch (e) {
    log.error('[sync] pullBusinessMeta failed:', e.message)
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
    // F15 — also pull business meta so multi-device edits propagate
    try { await pullBusinessMeta(bizId) } catch (e) { log.error('[sync-pull] businesses:', e.message) }
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
        // v2.0.2 — ISO 8601 UTC so cursor is lexicographically comparable to
        // updated_at (both formats must match or every pulled row "looks newer").
        _db.rawPrepare(`UPDATE sync_log SET last_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE table_name = ?`).run(table.name)
      } catch (e) { log.error(`[sync] post-pull cursor advance ${table.name}:`, e.message) }
    }

    // v2.3 — multi-POS: drain pending inventory deducts (oversell detect)
    // and refill NCF/doc blocks whenever they dip below threshold. Both are
    // no-ops when multi_pos_enabled=0.
    try { await processPendingDeducts() } catch (e) { log.warn('[multipos] processPendingDeducts:', e.message) }
    try { await ensureBlocks()          } catch (e) { log.warn('[multipos] ensureBlocks:', e.message) }

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
  // v2.3 — block refill scheduler. No-op if multi_pos_enabled=0.
  try { startMultiPosRefill() } catch (e) { log.warn('[multipos] startMultiPosRefill:', e.message) }
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
    // v2.1: washers + sellers tables dropped — empleados covers both verticals.
    'services','clients','inventory_items','ncf_sequences',
    'empleados','categorias_servicio','staff','tickets','ticket_items','queue',
    'washer_commissions','seller_commissions','cajero_commissions',
    'credit_payments','cuadre_caja','caja_chica','notas_credito',
    'inventory_transactions','compras_607','adelantos','payroll_runs','salary_changes',
    'activity_log',
    'vehicles','service_bays','work_orders','work_order_items','appointments',
    'stylist_schedules','loans','loan_payments','pawn_items',
    'memberships','wash_combos',
    'subscriptions','service_packages','projects','client_service_rates',
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

// Hard-delete a single row in Supabase by supabase_id. Used by mutation IPCs
// where the owner explicitly erases a record (salary_changes, adelantos, etc.)
// and we do NOT want the next upsert to resurrect the row.
async function supabaseDelete(table, supabaseId, businessId) {
  if (!_url || !_key || !table || !supabaseId) return { ok: false, error: 'missing args' }
  const bizId = businessId || await resolveBusinessId().catch(() => null)
  if (!bizId) return { ok: false, error: 'no business_id' }
  const reqUrl = new URL(`${_url}/rest/v1/${table}?business_id=eq.${bizId}&supabase_id=eq.${supabaseId}`)
  return new Promise((resolve) => {
    const request = https.request({
      hostname: reqUrl.hostname,
      path: reqUrl.pathname + reqUrl.search,
      method: 'DELETE',
      headers: {
        'apikey': _key,
        'Authorization': `Bearer ${_key}`,
        'Prefer': 'return=minimal',
      },
    }, (response) => {
      response.on('data', () => {})
      response.on('end', () => {
        const ok = response.statusCode >= 200 && response.statusCode < 300
        if (!ok) log.warn(`[sync] supabaseDelete ${table} ${supabaseId}: HTTP ${response.statusCode}`)
        resolve({ ok, status: response.statusCode })
      })
    })
    request.on('error', (err) => { log.warn(`[sync] supabaseDelete ${table}: ${err.message}`); resolve({ ok: false, error: err.message }) })
    request.end()
  })
}

// Pull-time reconciliation for owner-deletable tables: fetch every supabase_id
// from Supabase and hard-delete any local rows whose supabase_id is not in the
// remote set. Ensures a delete performed in web or another desktop propagates
// to this desktop on next pull.
const RECONCILE_TABLES = ['salary_changes', 'adelantos', 'caja_chica', 'notas_credito']

async function reconcileDeletes() {
  if (!_db || !_url || !_key) return
  const bizId = await resolveBusinessId().catch(() => null)
  if (!bizId) return
  for (const table of RECONCILE_TABLES) {
    try {
      // Skip if table doesn't exist locally (older DBs)
      const has = _db.rawPrepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)
      if (!has) continue
      const remote = await supabaseFetch(table, `select=supabase_id&business_id=eq.${bizId}&limit=20000`)
      if (!Array.isArray(remote)) continue
      const remoteSet = new Set(remote.map(r => r.supabase_id).filter(Boolean))
      const localRows = _db.rawPrepare(`SELECT id, supabase_id FROM ${table} WHERE business_id = ? AND supabase_id IS NOT NULL`).all(bizId)
      const toDelete = localRows.filter(r => !remoteSet.has(r.supabase_id))
      if (toDelete.length === 0) continue
      const stmt = _db.rawPrepare(`DELETE FROM ${table} WHERE id = ?`)
      for (const r of toDelete) { try { stmt.run(r.id) } catch (e) { log.warn(`[sync] reconcile delete ${table} id=${r.id}: ${e.message}`) } }
      log.info(`[sync] reconcile ${table}: deleted ${toDelete.length} local row(s) not present in Supabase`)
    } catch (e) {
      log.warn(`[sync] reconcile ${table} failed: ${e.message}`)
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Multi-POS — Block refill + oversell-aware deduct (v2.3)
// See docs/MULTI-POS-ARCHITECTURE.md §1–§3 and migration
// 20260418000000_multipos_blocks.sql. All of this is gated by
// app_settings.multi_pos_enabled; when OFF the functions return silently so
// single-POS installs carry no network overhead.
// ═══════════════════════════════════════════════════════════════════════════════

const MULTIPOS = {
  NCF_REFILL_THRESHOLD:  100,
  NCF_BLOCK_SIZE:        500,
  DOC_REFILL_THRESHOLD:  50,
  DOC_BLOCK_SIZE:        200,
  REFILL_INTERVAL_MS:    10 * 60 * 1000,
  // Every NCF/e-CF type we may need a block for. Only allocated on demand if
  // the type is "enabled" (i.e. has a row in ncf_sequences with enabled=1)
  // or is a directly-requested e-CF type.
  KNOWN_NCF_TYPES: ['B01','B02','B14','B15','E31','E32','E33','E34','E41','E43','E44','E47'],
}

let _multiposInterval = null

function _mpEnabled() {
  try { return (_db.rawPrepare("SELECT value FROM app_settings WHERE key='multi_pos_enabled'").get()?.value || '0') === '1' }
  catch { return false }
}

function _mpHwid() {
  try {
    const row = _db.rawPrepare("SELECT value FROM app_settings WHERE key='hwid'").get()
    if (row?.value) return row.value
  } catch {}
  try {
    const { app } = require('electron')
    const fs = require('fs')
    const path = require('path')
    const hwidPath = path.join(app.getPath('userData'), 'hwid.json')
    const j = JSON.parse(fs.readFileSync(hwidPath, 'utf8'))
    const hwid = j.id || j.hwid
    if (hwid) {
      try { _db.rawPrepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('hwid',?)").run(hwid) } catch {}
      return hwid
    }
  } catch {}
  return null
}

function _enabledNcfTypes() {
  try {
    const rows = _db.rawPrepare("SELECT type FROM ncf_sequences WHERE active=1 AND (enabled=1 OR enabled IS NULL)").all()
    const set = new Set(rows.map(r => r.type).filter(Boolean))
    // Always include the common e-CF types so clients never hit "no block"
    // mid-sale for a type the cashier just opted into in the POS dropdown.
    for (const t of ['E31','E32','B01','B02']) set.add(t)
    return [...set]
  } catch { return ['B01','B02','E31','E32'] }
}

// POST to Supabase RPC and parse JSON. Returns null on failure (caller retries
// on next tick — never throws into the ticket path).
function _rpcPost(fnName, payload) {
  return new Promise((resolve) => {
    if (!_url || !_key) return resolve(null)
    const body = JSON.stringify(payload)
    const reqUrl = new URL(`${_url}/rest/v1/rpc/${fnName}`)
    const req = https.request({
      hostname: reqUrl.hostname,
      path: reqUrl.pathname + reqUrl.search,
      method: 'POST',
      headers: {
        'apikey': _key,
        'Authorization': `Bearer ${_key}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk.toString() })
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data || 'null')) } catch { resolve(null) }
        } else {
          log.warn(`[multipos] rpc ${fnName} HTTP ${res.statusCode}: ${String(data).slice(0,200)}`)
          resolve(null)
        }
      })
    })
    req.on('error', (e) => { log.warn(`[multipos] rpc ${fnName} err: ${e.message}`); resolve(null) })
    req.setTimeout(20_000, () => { req.destroy(new Error('rpc timeout')); resolve(null) })
    req.write(body)
    req.end()
  })
}

async function _allocateNcfBlock(bizId, hwid, ncfType, size) {
  const row = await _rpcPost('allocate_ncf_block', {
    p_business_id: bizId,
    p_hwid:        hwid,
    p_ncf_type:    ncfType,
    p_size:        size,
  })
  if (!row) return null
  // RPC may return a single row object or an array — normalise.
  const r = Array.isArray(row) ? row[0] : row
  if (!r) return null
  try {
    const db = require('./database')
    db.ncfBlockInsert({
      supabase_id:    r.supabase_id || r.id,
      business_id:    r.business_id || bizId,
      hwid:           r.hwid || hwid,
      ncf_type:       r.ncf_type || ncfType,
      prefix:         r.prefix || ncfType,
      range_start:    Number(r.range_start),
      range_end:      Number(r.range_end),
      next_available: Number(r.next_available),
      size:           Number(r.size || (r.range_end - r.range_start + 1)),
      allocated_at:   r.allocated_at,
      exhausted_at:   r.exhausted_at,
      last_used_at:   r.last_used_at,
    })
    return r
  } catch (e) { log.warn('[multipos] ncfBlockInsert failed:', e.message); return null }
}

async function _allocateDocBlock(bizId, hwid, size) {
  const row = await _rpcPost('allocate_doc_number_block', {
    p_business_id: bizId,
    p_hwid:        hwid,
    p_scope:       'ticket',
    p_size:        size,
  })
  if (!row) return null
  const r = Array.isArray(row) ? row[0] : row
  if (!r) return null
  try {
    const db = require('./database')
    db.docNumberBlockInsert({
      supabase_id:    r.supabase_id || r.id,
      business_id:    r.business_id || bizId,
      hwid:           r.hwid || hwid,
      scope:          r.scope || 'ticket',
      range_start:    Number(r.range_start),
      range_end:      Number(r.range_end),
      next_available: Number(r.next_available),
      size:           Number(r.size || (r.range_end - r.range_start + 1)),
      allocated_at:   r.allocated_at,
      exhausted_at:   r.exhausted_at,
    })
    return r
  } catch (e) { log.warn('[multipos] docNumberBlockInsert failed:', e.message); return null }
}

async function ensureBlocks() {
  if (!_mpEnabled()) return { ok: true, skipped: true }
  if (!_url || !_key) return { ok: false, reason: 'no_supabase' }
  const bizId = await resolveBusinessId()
  if (!bizId) return { ok: false, reason: 'no_business_id' }
  const hwid  = _mpHwid()
  if (!hwid)  return { ok: false, reason: 'no_hwid' }

  const db = require('./database')
  const ncfSize = Number(_db.rawPrepare("SELECT value FROM app_settings WHERE key='ncf_block_size'").get()?.value) || MULTIPOS.NCF_BLOCK_SIZE
  const docSize = Number(_db.rawPrepare("SELECT value FROM app_settings WHERE key='doc_block_size'").get()?.value) || MULTIPOS.DOC_BLOCK_SIZE

  let allocated = 0
  for (const t of _enabledNcfTypes()) {
    const remaining = db.ncfBlockAvailableCount({ businessId: bizId, hwid, ncfType: t })
    if (remaining < MULTIPOS.NCF_REFILL_THRESHOLD) {
      const r = await _allocateNcfBlock(bizId, hwid, t, ncfSize)
      if (r) allocated++
    }
  }
  const docRemaining = db.docNumberBlockAvailableCount({ businessId: bizId, hwid, scope: 'ticket' })
  if (docRemaining < MULTIPOS.DOC_REFILL_THRESHOLD) {
    const r = await _allocateDocBlock(bizId, hwid, docSize)
    if (r) allocated++
  }
  return { ok: true, allocated }
}

async function processPendingDeducts() {
  if (!_mpEnabled()) return { ok: true, skipped: true }
  if (!_url || !_key) return { ok: false, reason: 'no_supabase' }
  const bizId = await resolveBusinessId()
  if (!bizId) return { ok: false, reason: 'no_business_id' }
  const db = require('./database')
  const hwid = _mpHwid()

  const queue = db.pendingDeductList()
  if (!queue.length) return { ok: true, processed: 0 }

  let processed = 0
  for (const row of queue) {
    let items = []
    try { items = JSON.parse(row.items_json || '[]') } catch {}
    if (!items.length) { db.pendingDeductMarkPushed(row.id); continue }
    const result = await _rpcPost('deduct_inventory_atomic', {
      p_business_id: bizId,
      p_ticket_sid:  row.ticket_supabase_id,
      p_hwid:        hwid,
      p_items:       items,
    })
    if (result === null) {
      db.pendingDeductMarkFailed(row.id, 'rpc_null')
      // Don't break — try the rest, Supabase may have rejected one payload.
      continue
    }
    const rows = Array.isArray(result) ? result : (result?.rows || [])
    for (const r of rows) {
      if (r && r.oversold === true) {
        const item = items.find(i => i.item_supabase_id === r.item_supabase_id)
        db.oversellRecord({
          businessId:        bizId,
          ticketSupabaseId:  row.ticket_supabase_id,
          itemSupabaseId:    r.item_supabase_id,
          itemName:          item?.name || null,
          requested:         Number(r.requested || item?.qty || 0),
          actual:            Number(r.actual || 0),
        })
      }
    }
    db.pendingDeductMarkPushed(row.id)
    processed++
  }
  return { ok: true, processed }
}

async function resolveOversellRemote({ supabase_id, resolution_type, notes, resolved_by }) {
  if (!_url || !_key) return { ok: false, reason: 'no_supabase' }
  const result = await _rpcPost('resolve_oversell', {
    p_supabase_id:      supabase_id,
    p_resolution_type:  resolution_type || null,
    p_notes:            notes || null,
    p_resolved_by:      resolved_by || null,
  })
  // Regardless of remote outcome, stamp locally so the UI badge clears
  // immediately — next pull will merge FWW.
  try { require('./database').oversellResolveLocal({ supabase_id, resolution_type, notes, resolved_by }) } catch {}
  return { ok: result !== null, remote: result }
}

function startMultiPosRefill() {
  if (_multiposInterval) clearInterval(_multiposInterval)
  // Fire once ~30s after boot so ensureBlocks() runs after the first syncNow
  // has had a chance to resolve business_id, then every 10 min.
  setTimeout(() => {
    ensureBlocks().catch(e => log.warn('[multipos] ensureBlocks:', e.message))
    processPendingDeducts().catch(e => log.warn('[multipos] processPendingDeducts:', e.message))
  }, 30_000)
  _multiposInterval = setInterval(() => {
    ensureBlocks().catch(e => log.warn('[multipos] ensureBlocks:', e.message))
    processPendingDeducts().catch(e => log.warn('[multipos] processPendingDeducts:', e.message))
  }, MULTIPOS.REFILL_INTERVAL_MS)
}

function stopMultiPosRefill() {
  if (_multiposInterval) { clearInterval(_multiposInterval); _multiposInterval = null }
}

function blocksStatus() {
  const db = require('./database')
  const bizId = _businessId
  const hwid  = _mpHwid()
  const out = {
    enabled: _mpEnabled(),
    businessId: bizId,
    hwid,
    ncf: {},
    doc_number: 0,
  }
  if (!bizId || !hwid) return out
  for (const t of _enabledNcfTypes()) {
    out.ncf[t] = db.ncfBlockAvailableCount({ businessId: bizId, hwid, ncfType: t })
  }
  out.doc_number = db.docNumberBlockAvailableCount({ businessId: bizId, hwid, scope: 'ticket' })
  return out
}

module.exports = {
  init, startAutoSync, stopAutoSync, syncNow, pullNow, getStatus,
  supabaseDelete, reconcileDeletes, setErrorLogSink,
  // Multi-POS
  ensureBlocks, processPendingDeducts, resolveOversellRemote,
  startMultiPosRefill, stopMultiPosRefill, blocksStatus,
}
