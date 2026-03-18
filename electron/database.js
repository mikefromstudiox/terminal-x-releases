/**
 * database.js — SQLite database layer for Terminal X POS
 *
 * Uses better-sqlite3 (synchronous API — safe for main process).
 * All public functions are synchronous; IPC handlers wrap them.
 *
 * DB file location: app.getPath('userData') / terminal-x.db
 * Schema:    db/schema.sql  (auto-applied on first run)
 * Seed data: db/seed.js     (runs once when tables are empty)
 */

const path    = require('path')
const fs      = require('fs')
const crypto  = require('crypto')

let Database
try {
  Database = require('better-sqlite3')
} catch {
  console.error('[db] better-sqlite3 not available — using in-memory stub')
  Database = null
}

let db = null

// ── Initialise ────────────────────────────────────────────────────────────────
function init(userDataPath) {
  if (!Database) return false

  const dbPath     = path.join(userDataPath, 'terminal-x.db')
  const schemaPath = path.join(__dirname, '../db/schema.sql')
  const seedPath   = path.join(__dirname, '../db/seed.js')

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Apply schema
  const schema = fs.readFileSync(schemaPath, 'utf8')
  db.exec(schema)

  // Schema migrations — safe to run multiple times (ignored if column exists)
  const migrations = [
    'ALTER TABLE washers ADD COLUMN start_date TEXT',
    'ALTER TABLE sellers ADD COLUMN phone TEXT',
  ]
  for (const sql of migrations) {
    try { db.exec(sql) } catch { /* column already exists */ }
  }

  // Seed if empty
  const userCount = db.prepare('SELECT COUNT(*) as n FROM users').get()
  if (userCount.n === 0 && fs.existsSync(seedPath)) {
    const seed = require(seedPath)
    seed(db)
  }

  console.log('[db] SQLite ready:', dbPath)
  return true
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex')
}
function getSetting(key) {
  if (!db) return null
  const row = db.prepare('SELECT value FROM app_settings WHERE key=?').get(key)
  return row?.value ?? null
}
function setSetting(key, value) {
  if (!db) return
  db.prepare('INSERT OR REPLACE INTO app_settings(key,value) VALUES(?,?)').run(key, String(value))
}

// ── SETTINGS ──────────────────────────────────────────────────────────────────
function settingsGet() {
  if (!db) return {}
  const rows = db.prepare('SELECT key,value FROM app_settings').all()
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
}
function settingsUpdate(obj) {
  if (!db) return
  const stmt = db.prepare('INSERT OR REPLACE INTO app_settings(key,value) VALUES(?,?)')
  const run  = db.transaction(() => {
    for (const [k, v] of Object.entries(obj)) stmt.run(k, String(v))
  })
  run()
}

// ── USERS / AUTH ──────────────────────────────────────────────────────────────
function authByPin(pin) {
  if (!db) return null
  const hash = sha256(pin)
  return db.prepare('SELECT id,name,username,role,discount_pct FROM users WHERE pin_hash=? AND active=1').get(hash)
}
function usersGetAll() {
  if (!db) return []
  return db.prepare('SELECT id,name,username,role,discount_pct,active FROM users ORDER BY id').all()
}
function userCreate(data) {
  if (!db) return null
  return db.prepare(`INSERT INTO users(name,username,pin_hash,role,discount_pct,active)
    VALUES(@name,@username,@pin_hash,@role,@discount_pct,1)`).run({
    ...data,
    pin_hash: sha256(data.pin || '0000'),
  })
}
function userUpdate(id, data) {
  if (!db) return
  const { pin, ...rest } = data
  if (pin) rest.pin_hash = sha256(pin)
  const fields = Object.keys(rest).filter(k => k !== 'id').map(k => `${k}=@${k}`).join(',')
  if (!fields) return
  db.prepare(`UPDATE users SET ${fields} WHERE id=@id`).run({ ...rest, id })
}

// ── SERVICES ──────────────────────────────────────────────────────────────────
function servicesGetAll() {
  if (!db) return []
  return db.prepare('SELECT * FROM services WHERE active=1 ORDER BY category, sort_order, id').all()
}
function servicesGetAllAdmin() {
  if (!db) return []
  return db.prepare('SELECT * FROM services ORDER BY category, sort_order, id').all()
}
function serviceCreate(data) {
  if (!db) return null
  const r = db.prepare(`INSERT INTO services(name,name_en,category,price,is_wash,active,sort_order)
    VALUES(@name,@name_en,@category,@price,@is_wash,1,COALESCE(@sort_order,0))`).run(data)
  return { id: r.lastInsertRowid }
}
function serviceUpdate(id, data) {
  if (!db) return
  const allowed = ['name','name_en','category','price','is_wash','active','sort_order']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(patch).length) return
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE services SET ${fields} WHERE id=@id`).run({ ...patch, id })
}

// ── WASHERS ───────────────────────────────────────────────────────────────────
function washersGetAll() {
  if (!db) return []
  return db.prepare('SELECT * FROM washers WHERE active=1 ORDER BY name').all()
}
function washersGetAllAdmin() {
  if (!db) return []
  return db.prepare('SELECT * FROM washers ORDER BY name').all()
}
function washerCreate(data) {
  if (!db) return null
  const r = db.prepare(`INSERT INTO washers(name,phone,cedula,commission_pct,start_date,active)
    VALUES(@name,@phone,@cedula,@commission_pct,@start_date,1)`).run({
    name: data.name, phone: data.phone || null, cedula: data.cedula || null,
    commission_pct: data.commission_pct || 20, start_date: data.start_date || null,
  })
  return { id: r.lastInsertRowid }
}
function washerUpdate(id, data) {
  if (!db) return
  const allowed = ['name','phone','cedula','commission_pct','start_date','active']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(patch).length) return
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE washers SET ${fields} WHERE id=@id`).run({ ...patch, id })
}

// ── SELLERS ───────────────────────────────────────────────────────────────────
function sellersGetAll() {
  if (!db) return []
  return db.prepare('SELECT * FROM sellers WHERE active=1 ORDER BY name').all()
}
function sellersGetAllAdmin() {
  if (!db) return []
  return db.prepare('SELECT * FROM sellers ORDER BY name').all()
}
function sellerCreate(data) {
  if (!db) return null
  const r = db.prepare('INSERT INTO sellers(name,commission_pct,phone,active) VALUES(?,?,?,1)')
    .run(data.name, data.commission_pct || 5, data.phone || null)
  return { id: r.lastInsertRowid }
}
function sellerUpdate(id, data) {
  if (!db) return
  const allowed = ['name','commission_pct','phone','active']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(patch).length) return
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE sellers SET ${fields} WHERE id=@id`).run({ ...patch, id })
}

// ── CLIENTS ───────────────────────────────────────────────────────────────────
function clientsGetAll() {
  if (!db) return []
  return db.prepare('SELECT * FROM clients WHERE active=1 ORDER BY name').all()
}
function clientGetById(id) {
  if (!db) return null
  return db.prepare('SELECT * FROM clients WHERE id=?').get(id)
}
function clientCreate(data) {
  if (!db) return null
  return db.prepare(`INSERT INTO clients(name,rnc,phone,email,address,credit_limit,balance)
    VALUES(@name,@rnc,@phone,@email,@address,@credit_limit,0)`).run(data)
}
function clientUpdate(id, data) {
  if (!db) return
  const allowed = ['name','rnc','phone','email','address','credit_limit','balance','visits','total_spent','active']
  const patch   = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (Object.keys(patch).length === 0) return
  const fields  = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE clients SET ${fields} WHERE id=@id`).run({ ...patch, id })
}
function clientUpdateBalance(id, delta) {
  if (!db) return
  db.prepare('UPDATE clients SET balance=balance+@delta WHERE id=@id').run({ id, delta })
}
function clientGetOpenTickets(clientId) {
  if (!db) return []
  const rows = db.prepare(
    `SELECT t.*,
       json_group_array(
         json_object('name', ti.name, 'price', ti.price, 'is_wash', ti.is_wash)
       ) as items_json
     FROM tickets t
     LEFT JOIN ticket_items ti ON ti.ticket_id = t.id
     WHERE t.client_id=? AND t.tipo_venta='credito' AND t.status='pendiente'
     GROUP BY t.id ORDER BY t.created_at ASC`
  ).all(clientId)
  return rows.map(r => {
    let items = []
    try {
      const parsed = JSON.parse(r.items_json || '[]')
      items = parsed.filter(i => i.name != null)
    } catch {}
    return { ...r, items }
  })
}
function collectCredit({ clientId, ticketIds, amount, paymentMethod, ncf, notes, cajeroId }) {
  if (!db) return null
  return db.transaction(() => {
    const updTicket = db.prepare("UPDATE tickets SET status='cobrado', payment_method=? WHERE id=?")
    for (const tid of ticketIds) updTicket.run(paymentMethod, tid)
    db.prepare('UPDATE clients SET balance=MAX(0,balance-?) WHERE id=?').run(amount, clientId)
    const r = db.prepare(
      `INSERT INTO credit_payments(client_id,ticket_ids,amount,payment_method,ncf,notes,cajero_id)
       VALUES(?,?,?,?,?,?,?)`
    ).run(clientId, JSON.stringify(ticketIds), amount, paymentMethod, ncf||null, notes||null, cajeroId||null)
    return { id: r.lastInsertRowid }
  })()
}

// ── TICKETS ───────────────────────────────────────────────────────────────────
function ticketsGetAll({ dateFrom, dateTo, status, limit = 200 } = {}) {
  if (!db) return []
  let sql  = `SELECT t.*, c.name as client_name, c.rnc as client_rnc,
                     u.name as cajero_name
              FROM tickets t
              LEFT JOIN clients c ON c.id = t.client_id
              LEFT JOIN users u ON u.id = t.cajero_id
              WHERE 1=1`
  const params = []
  if (dateFrom) { sql += ' AND t.created_at >= ?'; params.push(dateFrom) }
  if (dateTo)   { sql += ' AND t.created_at <= ?'; params.push(dateTo)   }
  if (status)   { sql += ' AND t.status = ?';      params.push(status)   }
  sql += ' ORDER BY t.created_at DESC LIMIT ?'
  params.push(limit)
  return db.prepare(sql).all(...params)
}
function ticketGetById(id) {
  if (!db) return null
  const ticket = db.prepare(
    `SELECT t.*, c.name as client_name, c.rnc as client_rnc, u.name as cajero_name
     FROM tickets t
     LEFT JOIN clients c ON c.id=t.client_id
     LEFT JOIN users u ON u.id=t.cajero_id
     WHERE t.id=?`
  ).get(id)
  if (ticket) {
    ticket.items = db.prepare('SELECT * FROM ticket_items WHERE ticket_id=?').all(id)
    try { ticket.ecf_result = JSON.parse(ticket.ecf_result || '{}') } catch { ticket.ecf_result = {} }
    try { ticket.washer_ids = JSON.parse(ticket.washer_ids || '[]') } catch { ticket.washer_ids = [] }
  }
  return ticket
}
function ticketCreate(data) {
  if (!db) return null

  const tx = db.transaction(() => {
    // Get next doc number
    const last = db.prepare('SELECT doc_number FROM tickets ORDER BY id DESC LIMIT 1').get()
    let nextNum = 1
    if (last?.doc_number) {
      const m = last.doc_number.match(/T-(\d+)/)
      if (m) nextNum = parseInt(m[1]) + 1
    }
    const docNumber = `T-${String(nextNum).padStart(4, '0')}`

    // Get next NCF
    const ncfRow = db.prepare('SELECT * FROM ncf_sequences WHERE type=? AND active=1').get(data.comprobante_type || 'B02')
    let ncf = null
    if (ncfRow) {
      const nextNCF = ncfRow.current_number + 1
      ncf = `${ncfRow.prefix}${String(nextNCF).padStart(8, '0')}`
      db.prepare('UPDATE ncf_sequences SET current_number=? WHERE type=?').run(nextNCF, ncfRow.type)
    }

    const result = db.prepare(`INSERT INTO tickets
      (doc_number,client_id,washer_ids,seller_id,cajero_id,subtotal,descuento,itbis,ley,total,
       payment_method,comprobante_type,ncf,ecf_result,tipo_venta,status,vehicle_plate,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`).run(
      docNumber,
      data.client_id || null,
      JSON.stringify(data.washer_ids || []),
      data.seller_id || null,
      data.cajero_id || 1,
      data.subtotal,
      data.descuento || 0,
      data.itbis,
      data.ley || 0,
      data.total,
      data.payment_method || 'cash',
      data.comprobante_type || 'B02',
      ncf,
      JSON.stringify(data.ecf_result || {}),
      data.tipo_venta || 'contado',
      data.status || (data.payment_method === 'credit' ? 'pendiente' : 'cobrado'),
      data.vehicle_plate || null,
    )
    const ticketId = result.lastInsertRowid

    // Insert items
    const insItem = db.prepare(`INSERT INTO ticket_items(ticket_id,service_id,name,price,itbis,is_wash)
      VALUES(?,?,?,?,?,?)`)
    for (const item of (data.items || [])) {
      insItem.run(ticketId, item.service_id || null, item.name, item.price,
        parseFloat((item.price * 0.18).toFixed(2)), item.is_wash ?? 1)
    }

    // Update client balance if credit
    if (data.client_id && data.tipo_venta === 'credito') {
      db.prepare('UPDATE clients SET balance=balance+?,visits=visits+1,total_spent=total_spent+? WHERE id=?')
        .run(data.total, data.total, data.client_id)
    } else if (data.client_id) {
      db.prepare('UPDATE clients SET visits=visits+1,total_spent=total_spent+? WHERE id=?')
        .run(data.total, data.client_id)
    }

    // Washer commissions
    const itbisRate = parseFloat(getSetting('itbis_pct') || '18') / 100
    const leyRate   = parseFloat(getSetting('ley_pct')   || '10') / 100
    const divisor   = 1 + itbisRate + leyRate
    for (const wid of (data.washer_ids || [])) {
      const washer  = db.prepare('SELECT commission_pct FROM washers WHERE id=?').get(wid)
      if (!washer) continue
      const commBase   = (data.subtotal - (data.beverage_subtotal || 0)) / divisor
      const commAmount = parseFloat((commBase * washer.commission_pct / 100).toFixed(2))
      db.prepare(`INSERT INTO washer_commissions
        (washer_id,ticket_id,base_amount,commission_pct,commission_amount,paid)
        VALUES(?,?,?,?,?,0)`).run(wid, ticketId, parseFloat(commBase.toFixed(2)), washer.commission_pct, commAmount)
    }

    // Add to queue — seed with first washer so it shows immediately on Cola de Espera
    const firstWasherId = (data.washer_ids || [])[0] || null
    db.prepare(`INSERT INTO queue(ticket_id,status,washer_id) VALUES(?,?,?)`).run(ticketId, 'waiting', firstWasherId)

    return { ticketId, docNumber, ncf }
  })

  return tx()
}
function ticketMarkPaid(id, { paymentMethod, ncf, ecfResult, cajeroId, tipoVenta, clientId } = {}) {
  if (!db) return null
  db.transaction(() => {
    // Credit tickets stay 'pendiente' so they appear in Cuentas x Cobrar.
    // Only mark 'cobrado' when collected as contado/cash/card/transfer.
    const newStatus = tipoVenta === 'credito' ? 'pendiente' : 'cobrado'

    db.prepare(`UPDATE tickets SET status=?,
      payment_method=COALESCE(?,payment_method),
      ncf=COALESCE(?,ncf),
      ecf_result=COALESCE(?,ecf_result),
      cajero_id=COALESCE(?,cajero_id)
      WHERE id=?`).run(
      newStatus,
      paymentMethod || null, ncf || null,
      ecfResult ? JSON.stringify(ecfResult) : null,
      cajeroId || null, id)

    if (tipoVenta === 'credito' && clientId) {
      // Fetch original tipo_venta to avoid double-counting if ticket was already posted as credit
      const row = db.prepare('SELECT total, tipo_venta FROM tickets WHERE id=?').get(id)
      if (row && row.tipo_venta !== 'credito') {
        const amount = row.total || 0
        db.prepare('UPDATE tickets SET tipo_venta=?,client_id=? WHERE id=?')
          .run('credito', clientId, id)
        db.prepare('UPDATE clients SET balance=balance+?,visits=visits+1,total_spent=total_spent+? WHERE id=?')
          .run(amount, amount, clientId)
      }
    }
  })()
  return { id }
}
function ticketVoid(id, reason, voidById) {
  if (!db) return
  db.transaction(() => {
    const ticket = db.prepare('SELECT * FROM tickets WHERE id=?').get(id)
    if (!ticket) return
    db.prepare(`UPDATE tickets SET status='nula',void_reason=?,void_by=?,void_at=datetime('now') WHERE id=?`)
      .run(reason, voidById || null, id)
    // Reverse client balance if it was a credit ticket
    if (ticket.client_id && ticket.tipo_venta === 'credito') {
      db.prepare('UPDATE clients SET balance=balance-? WHERE id=?').run(ticket.total, ticket.client_id)
    }
  })()
}
function ticketGetByDateRange(dateFrom, dateTo) {
  return ticketsGetAll({ dateFrom, dateTo })
}

// ── QUEUE ─────────────────────────────────────────────────────────────────────
function queueGetActive() {
  if (!db) return []
  return db.prepare(
    `SELECT q.*, t.doc_number, t.total, t.vehicle_plate, t.created_at as ticket_created,
            c.name as client_name,
            GROUP_CONCAT(ti.name, ' + ') as services,
            w.name as washer_name
     FROM queue q
     JOIN tickets t ON t.id = q.ticket_id
     LEFT JOIN clients c ON c.id = t.client_id
     LEFT JOIN ticket_items ti ON ti.ticket_id = t.id
     LEFT JOIN washers w ON w.id = q.washer_id
     WHERE q.status != 'done'
     GROUP BY q.id
     ORDER BY q.created_at ASC`
  ).all()
}
function queueUpdateStatus(id, status, washerId = null) {
  if (!db) return
  const now = new Date().toISOString()
  if (status === 'in_progress') {
    db.prepare(`UPDATE queue SET status=?,washer_id=?,assigned_at=? WHERE id=?`).run(status, washerId, now, id)
  } else if (status === 'done') {
    db.prepare(`UPDATE queue SET status=?,completed_at=? WHERE id=?`).run(status, now, id)
  } else {
    db.prepare(`UPDATE queue SET status=? WHERE id=?`).run(status, id)
  }
}

// ── COMMISSIONS ───────────────────────────────────────────────────────────────
function commissionsGetByWasher(washerId, dateFrom, dateTo) {
  if (!db) return []
  let sql = `SELECT wc.*, t.doc_number, t.created_at as ticket_date, t.vehicle_plate,
                    w.name as washer_name, w.commission_pct,
                    GROUP_CONCAT(ti.name, ' + ') as services
             FROM washer_commissions wc
             JOIN tickets t ON t.id = wc.ticket_id
             JOIN washers w ON w.id = wc.washer_id
             LEFT JOIN ticket_items ti ON ti.ticket_id = t.id AND ti.is_wash=1
             WHERE wc.washer_id=? AND t.status='cobrado'`
  const params = [washerId]
  if (dateFrom) { sql += ' AND t.created_at >= ?'; params.push(dateFrom) }
  if (dateTo)   { sql += ' AND t.created_at <= ?'; params.push(dateTo)   }
  sql += ' GROUP BY wc.id ORDER BY t.created_at DESC'
  return db.prepare(sql).all(...params)
}
function commissionsGetByPeriod(dateFrom, dateTo) {
  if (!db) return []
  return db.prepare(
    `SELECT wc.washer_id, w.name as washer_name, w.commission_pct,
            COUNT(wc.id) as ticket_count,
            SUM(wc.base_amount) as total_base,
            SUM(wc.commission_amount) as total_commission
     FROM washer_commissions wc
     JOIN tickets t ON t.id = wc.ticket_id
     JOIN washers w ON w.id = wc.washer_id
     WHERE t.status='cobrado'
       AND t.created_at >= ? AND t.created_at <= ?
     GROUP BY wc.washer_id ORDER BY total_commission DESC`
  ).all(dateFrom || '2000-01-01', dateTo || '2099-12-31')
}
function commissionsMarkPaid(washerCommissionIds) {
  if (!db) return
  const stmt = db.prepare(`UPDATE washer_commissions SET paid=1,paid_at=datetime('now') WHERE id=?`)
  db.transaction(() => washerCommissionIds.forEach(id => stmt.run(id)))()
}

// ── CUADRE DE CAJA ────────────────────────────────────────────────────────────
function cuadreCreate(data) {
  if (!db) return null
  return db.prepare(`INSERT INTO cuadre_caja
    (cajero_id,date,fondo,efectivo_conteo,efectivo_sistema,tarjeta,transferencia,
     cheque,creditos,salidas,total_vendido,total_cobrado,cierre_total,diferencia,
     comentario,denominaciones)
    VALUES(@cajero_id,@date,@fondo,@efectivo_conteo,@efectivo_sistema,@tarjeta,
           @transferencia,@cheque,@creditos,@salidas,@total_vendido,@total_cobrado,
           @cierre_total,@diferencia,@comentario,@denominaciones)`).run({
    ...data,
    denominaciones: JSON.stringify(data.denominaciones || {}),
  })
}
function cuadreGetHistory(limit = 20) {
  if (!db) return []
  return db.prepare(
    `SELECT c.*, u.name as cajero_name FROM cuadre_caja c
     LEFT JOIN users u ON u.id=c.cajero_id
     ORDER BY c.closed_at DESC LIMIT ?`
  ).all(limit)
}
function cuadreDailySummary(date) {
  if (!db) return {}
  const d = date || new Date().toISOString().slice(0, 10)
  const from = `${d}T00:00:00`
  const to   = `${d}T23:59:59`
  const rows = db.prepare(
    `SELECT payment_method, SUM(total) as sum FROM tickets
     WHERE status='cobrado' AND created_at BETWEEN ? AND ?
     GROUP BY payment_method`
  ).all(from, to)
  const result = { efectivo:0, tarjeta:0, transferencia:0, cheque:0, credito:0 }
  for (const r of rows) result[r.payment_method] = r.sum || 0
  const totals = db.prepare(
    `SELECT SUM(total) as vendido,
            SUM(CASE WHEN payment_method != 'credit' THEN total ELSE 0 END) as cobrado,
            COUNT(*) as count
     FROM tickets WHERE status='cobrado' AND created_at BETWEEN ? AND ?`
  ).get(from, to)
  return { ...result, totalVendido: totals?.vendido||0, totalCobrado: totals?.cobrado||0, count: totals?.count||0 }
}

// ── NCF ───────────────────────────────────────────────────────────────────────
function ncfGetSequences() {
  if (!db) return []
  return db.prepare('SELECT * FROM ncf_sequences ORDER BY type').all()
}
function ncfGetNext(type) {
  if (!db) return null
  const row = db.prepare('SELECT * FROM ncf_sequences WHERE type=? AND active=1').get(type)
  if (!row) return null
  const next = row.current_number + 1
  db.prepare('UPDATE ncf_sequences SET current_number=? WHERE type=?').run(next, type)
  return `${row.prefix}${String(next).padStart(8, '0')}`
}
function ncfUpdateSequence(type, data) {
  if (!db) return
  const fields = Object.keys(data).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE ncf_sequences SET ${fields} WHERE type=@type`).run({ ...data, type })
}

// ── CAJA CHICA ────────────────────────────────────────────────────────────────
function cajaChicaGetAll() {
  if (!db) return []
  return db.prepare(
    `SELECT cc.*, u.name as approved_name FROM caja_chica cc
     LEFT JOIN users u ON u.id=cc.approved_by
     ORDER BY cc.created_at DESC LIMIT 100`
  ).all()
}
function cajaChicaCreate(data) {
  if (!db) return null
  return db.prepare(`INSERT INTO caja_chica(description,category,type,amount,recibo,status,cajero_id)
    VALUES(@description,@category,@type,@amount,@recibo,@status,@cajero_id)`).run(data)
}
function cajaChicaUpdateStatus(id, status, approvedBy) {
  if (!db) return
  db.prepare(`UPDATE caja_chica SET status=?,approved_by=? WHERE id=?`).run(status, approvedBy, id)
}

// ── NOTAS DE CREDITO ──────────────────────────────────────────────────────────
function notasGetAll() {
  if (!db) return []
  return db.prepare(
    `SELECT n.*, c.name as client_name FROM notas_credito n
     LEFT JOIN clients c ON c.id=n.client_id
     ORDER BY n.created_at DESC LIMIT 100`
  ).all()
}
function notaCreate(data) {
  if (!db) return null
  return db.prepare(`INSERT INTO notas_credito
    (ncf,client_id,original_ticket_id,motivo,amount,itbis_revertido,forma_devolucion,comentario,cajero_id)
    VALUES(@ncf,@client_id,@original_ticket_id,@motivo,@amount,@itbis_revertido,@forma_devolucion,@comentario,@cajero_id)`
  ).run(data)
}

// ── EXPORT ALL (for backup) ───────────────────────────────────────────────────
function exportAll() {
  if (!db) return {}
  const tables = ['tickets','ticket_items','clients','credit_payments','queue',
    'cuadre_caja','caja_chica','notas_credito','washer_commissions','ncf_sequences','app_settings']
  const snap = { exported_at: new Date().toISOString(), version: '1.0.0', tables: {} }
  for (const t of tables) {
    try { snap.tables[t] = db.prepare(`SELECT * FROM ${t}`).all() }
    catch { snap.tables[t] = [] }
  }
  return snap
}
function exportSince(since) {
  if (!db) return { tickets:[], clients:[], payments:[] }
  return {
    tickets: db.prepare(`SELECT * FROM tickets WHERE created_at > ?`).all(since),
    clients: db.prepare(`SELECT * FROM clients WHERE created_at > ?`).all(since),
    payments: db.prepare(`SELECT * FROM credit_payments WHERE created_at > ?`).all(since),
  }
}

// ── DGII data ─────────────────────────────────────────────────────────────────
function get606Data(dateFrom, dateTo) {
  if (!db) return []
  return db.prepare(
    `SELECT t.id, t.ncf, t.comprobante_type as tipo, t.created_at as fecha,
            t.subtotal, t.itbis, t.ley, t.total, t.status as estado,
            c.name as client_name, c.rnc as client_rnc
     FROM tickets t
     LEFT JOIN clients c ON c.id=t.client_id
     WHERE t.created_at BETWEEN ? AND ?
     ORDER BY t.created_at DESC`
  ).all(dateFrom || '2000-01-01', dateTo || '2099-12-31')
}

// ── Public API ────────────────────────────────────────────────────────────────
module.exports = {
  init,
  // Settings
  settingsGet, settingsUpdate, getSetting, setSetting,
  // Auth
  authByPin, usersGetAll, userCreate, userUpdate,
  // Services
  servicesGetAll, servicesGetAllAdmin, serviceCreate, serviceUpdate,
  // Washers
  washersGetAll, washersGetAllAdmin, washerCreate, washerUpdate,
  // Sellers
  sellersGetAll, sellersGetAllAdmin, sellerCreate, sellerUpdate,
  // Clients
  clientsGetAll, clientGetById, clientCreate, clientUpdate, clientUpdateBalance, clientGetOpenTickets, collectCredit,
  // Tickets
  ticketsGetAll, ticketGetById, ticketCreate, ticketMarkPaid, ticketVoid, ticketGetByDateRange,
  // Queue
  queueGetActive, queueUpdateStatus,
  // Commissions
  commissionsGetByWasher, commissionsGetByPeriod, commissionsMarkPaid,
  // Cuadre
  cuadreCreate, cuadreGetHistory, cuadreDailySummary,
  // NCF
  ncfGetSequences, ncfGetNext, ncfUpdateSequence,
  // Caja chica
  cajaChicaGetAll, cajaChicaCreate, cajaChicaUpdateStatus,
  // Notas
  notasGetAll, notaCreate,
  // Backup / export
  exportAll, exportSince,
  // DGII
  get606Data,
}
