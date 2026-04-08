/**
 * electron/sync.js — One-way cloud backup: SQLite -> Supabase
 *
 * Runs in the Electron main process. Pushes local data to Supabase
 * so the web POS (terminalxpos.com/pos) always has current data.
 * Uses the Supabase REST API directly (no SDK import — avoids ESM/CJS issues).
 *
 * Architecture: Every synced row carries a `supabase_id` (UUID) assigned at
 * creation time in SQLite. Foreign keys are stored as `*_supabase_id` columns.
 * The Supabase unique constraint is on (business_id, supabase_id).
 *
 * Usage in main.js:
 *   const sync = require('./sync')
 *   sync.init(db, { supabaseUrl, supabaseKey })
 *   sync.startAutoSync(30 * 60 * 1000)
 */

const https = require('https')

// -- State --------------------------------------------------------------------
let _db = null
let _url = ''
let _key = ''
let _businessId = null
let _intervalId = null
let _syncing = false
let _pendingSync = false
let _status = { state: 'idle', lastSync: null, tables: {}, error: null }

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
      sort_order: r.sort_order,
      created_at: r.created_at || new Date().toISOString(),
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
    }),
  },
  {
    name: 'sellers',
    cols: r => ({
      supabase_id: r.supabase_id,
      name: r.name,
      commission_pct: r.commission_pct,
      phone: r.phone,
      active: r.active,
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
    }),
  },
  {
    name: 'inventory_items',
    cols: r => ({
      supabase_id: r.supabase_id,
      name: r.name,
      sku: r.sku,
      category: r.category,
      unit_cost: r.unit_cost,
      current_stock: r.current_stock,
      min_stock: r.min_stock,
      supplier: r.supplier,
      active: r.active,
      created_at: r.created_at || new Date().toISOString(),
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
    }),
  },
  {
    name: 'empleados',
    cols: r => ({
      supabase_id: r.supabase_id,
      nombre: r.nombre,
      cedula: r.cedula,
      telefono: r.telefono,
      tipo: r.tipo,
      salario_base: r.salario_base,
      fecha_entrada: r.fecha_entrada,
      fecha_salida: r.fecha_salida,
      activo: r.activo,
      ref_id: r.ref_id,
      ref_type: r.ref_type,
      puesto: r.puesto,
      email: r.email,
      bank_account: r.bank_account,
      tss_id: r.tss_id,
      created_at: r.created_at || new Date().toISOString(),
    }),
  },
  {
    name: 'categorias_servicio',
    cols: r => ({
      supabase_id: r.supabase_id,
      nombre: r.nombre,
      orden: r.orden,
    }),
  },

  // Phase 2 — depend on phase 1 entities
  {
    name: 'tickets',
    cols: r => ({
      supabase_id: r.supabase_id,
      doc_number: r.doc_number,
      client_supabase_id: r.client_supabase_id || null,
      washer_ids: r.washer_ids,
      seller_supabase_id: r.seller_supabase_id || null,
      cajero_supabase_id: r.cajero_supabase_id || null,
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
      vehicle_plate: r.vehicle_plate,
      vehicle_color: r.vehicle_color,
      vehicle_make: r.vehicle_make,
      notes: r.notes,
      created_at: r.created_at || new Date().toISOString(),
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
      inventory_item_supabase_id: r.inventory_item_supabase_id || null,
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
    }),
  },
  {
    name: 'notas_credito',
    cols: r => ({
      supabase_id: r.supabase_id,
      ncf: r.ncf,
      client_supabase_id: r.client_supabase_id || null,
      original_ticket_supabase_id: r.original_ticket_supabase_id,
      motivo: r.motivo,
      amount: r.amount,
      itbis_revertido: r.itbis_revertido,
      forma_devolucion: r.forma_devolucion,
      comentario: r.comentario,
      cajero_supabase_id: r.cajero_supabase_id || null,
      created_at: r.created_at || new Date().toISOString(),
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
    }),
  },
  {
    name: 'compras_607',
    cols: r => ({
      supabase_id: r.supabase_id,
      rnc_cedula: r.rnc_cedula,
      tipo_id: r.tipo_id,
      tipo_bienes: r.tipo_bienes,
      ncf: r.ncf,
      ncf_modificado: r.ncf_modificado,
      fecha: r.fecha,
      monto_facturado: r.monto_facturado,
      itbis_facturado: r.itbis_facturado,
      itbis_retenido: r.itbis_retenido,
      monto_pagado: r.monto_pagado,
      retencion_renta: r.retencion_renta,
      forma_pago: r.forma_pago,
      created_at: r.created_at || new Date().toISOString(),
    }),
  },
]

// -- Init ---------------------------------------------------------------------
function init(db, { supabaseUrl, supabaseKey }) {
  _db = db
  _url = (supabaseUrl || '').replace(/\/$/, '')
  _key = supabaseKey || ''

  if (!_url || !_key) {
    console.log('[sync] No Supabase credentials — cloud sync disabled')
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
      console.log('[sync] Dropped and recreated sync_log for supabase_id migration')
    }
  } catch (e) {
    console.error('[sync] sync_v2_reset error:', e.message)
  }

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
  } catch (e) { console.error('[sync] diag write error:', e.message) }

  console.log('[sync] Initialized — cloud backup enabled, url:', _url?.substring(0, 30), 'key:', _key ? 'SET' : 'EMPTY')
}

// -- Supabase REST upsert -----------------------------------------------------
const SYNC_TIMEOUT_MS = 30_000

function supabaseUpsert(table, rows) {
  if (!rows.length) return Promise.resolve({ ok: true, count: 0 })

  const request$ = new Promise((resolve, reject) => {
    const reqUrl = new URL(`${_url}/rest/v1/${table}`)
    const body = JSON.stringify(rows)

    const request = https.request({
      hostname: reqUrl.hostname,
      path: reqUrl.pathname,
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
    request.write(body)
    request.end()
  })

  const timeout$ = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Supabase ${table} request timed out after ${SYNC_TIMEOUT_MS / 1000}s`)), SYNC_TIMEOUT_MS)
  )

  return Promise.race([request$, timeout$])
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
          console.log('[sync] Resolved business_id from HWID:', _businessId)
          return _businessId
        }
      }
    }
  } catch (e) { console.warn('[sync] Business ID lookup failed:', e.message) }
  return null
}

// -- Get last synced ID for a table -------------------------------------------
function getLastSyncedId(tableName) {
  try {
    const row = _db.rawPrepare('SELECT last_synced_id FROM sync_log WHERE table_name = ?').get(tableName)
    return row?.last_synced_id || 0
  } catch { return 0 }
}

// -- Update sync log ----------------------------------------------------------
function updateSyncLog(tableName, lastId, rowCount, error) {
  try {
    _db.rawPrepare(`INSERT INTO sync_log (table_name, last_synced_id, row_count, error, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(table_name) DO UPDATE SET
        last_synced_id = excluded.last_synced_id,
        row_count = excluded.row_count,
        error = excluded.error,
        updated_at = datetime('now')
    `).run(tableName, lastId, rowCount, error)
  } catch {}
}

// -- Sync a single table ------------------------------------------------------
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

  _status.tables[name] = { synced: true, rows: totalSynced, lastId: cursor }
  return totalSynced
}

// -- Full sync cycle ----------------------------------------------------------
async function syncNow() {
  if (_syncing) {
    _pendingSync = true
    return _status
  }
  if (!_url || !_key) {
    console.error('[sync] No URL or key — url:', !!_url, 'key:', !!_key)
    return _status
  }
  let bizId
  try { bizId = await resolveBusinessId() } catch (e) { console.error('[sync] resolveBusinessId failed:', e.message) }
  if (!bizId) {
    _status.state = 'no_business_id'
    console.error('[sync] No business_id found')
    return _status
  }
  console.log('[sync] Starting sync for business:', bizId)

  _syncing = true
  _pendingSync = false
  _status.state = 'syncing'
  _status.error = null
  let totalRows = 0

  try {
    for (const table of SYNC_TABLES) {
      try {
        const count = await syncTable(table)
        totalRows += count
      } catch (e) {
        console.error(`[sync] ${table.name}:`, e.message)
        updateSyncLog(table.name, getLastSyncedId(table.name), 0, e.message)
        _status.tables[table.name] = { synced: false, error: e.message }
      }
    }
    _status.state = 'idle'
    _status.lastSync = new Date().toISOString()
    _status.totalRows = totalRows
    console.log(`[sync] Complete — ${totalRows} rows pushed`)
  } catch (e) {
    _status.state = 'error'
    _status.error = e.message
    console.error('[sync] Fatal:', e.message)
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
  console.log(`[sync] Auto-sync every ${Math.round(intervalMs / 60000)} min`)
}

function stopAutoSync() {
  if (_intervalId) { clearInterval(_intervalId); _intervalId = null }
}

function getStatus() {
  return { ..._status }
}

module.exports = { init, startAutoSync, stopAutoSync, syncNow, getStatus }
