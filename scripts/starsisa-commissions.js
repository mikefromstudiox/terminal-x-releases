// StarSISA historical commission computation.
//
// Phase 1: adds commission_exclude column (idempotent)
// Phase 2: detects comprobante pairs (same client, matching line items,
//          comparable total, same month, NCF mismatch) and flags one of each.
// Phase 3: computes commissions:
//          - 7 lavadores: comision_pct × SUM(CSV Total per file)
//          - Wendy (cajera): 5% × SUM(her CSV Total) — snacks/drinks
//          - Jonnathan (vendedor): 5% × SUM(tickets ≥ RD$1,000 and !commission_exclude)
// Phase 4: dry-run by default — prints per-employee owed amount. Pass --apply
//          to write commission rows and the commission_exclude flags.
//
// Usage:
//   node scripts/starsisa-commissions.js [--csv-dir "..."] [--apply]

const fs   = require('fs')
const path = require('path')
const os   = require('os')
const crypto = require('crypto')

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const csvDirIdx = args.indexOf('--csv-dir')
const CSV_DIR = csvDirIdx >= 0 ? args[csvDirIdx + 1] : path.join(os.homedir(), 'Desktop', 'Import')
const DB_PATH = path.join(os.homedir(), 'AppData', 'Roaming', 'terminal-x', 'terminal-x.db')
const BUSINESS_ID = '1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79'
const VENDEDOR_THRESHOLD = 1000 // tickets >= this (gross) earn vendedor commission
const ITBIS_RATE = 0.18         // DR default; strip from gross to get net commission base

const Database = require('better-sqlite3')
if (!fs.existsSync(DB_PATH)) { console.error('Terminal X DB not found'); process.exit(1) }
if (!fs.existsSync(CSV_DIR)) { console.error('CSV dir not found:', CSV_DIR); process.exit(1) }

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

// ────────────────────────────────────────────────────────────────────────────
// Phase 1 — schema addition
// ────────────────────────────────────────────────────────────────────────────

function addColumnIfMissing(table, col, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  if (cols.some(c => c.name === col)) return false
  db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run()
  return true
}
console.log('Phase 1: schema')
if (addColumnIfMissing('tickets', 'commission_exclude', 'INTEGER DEFAULT 0')) {
  console.log('  added tickets.commission_exclude')
} else {
  console.log('  tickets.commission_exclude already present')
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 2 — comprobante-pair detection
// ────────────────────────────────────────────────────────────────────────────

console.log('\nPhase 2: comprobante-pair detection')

// Pull all starsisa tickets with their line items.
const tickets = db.prepare(`
  SELECT t.id, t.legacy_code, t.doc_number, t.client_id, t.vehicle_plate, t.total, t.ncf,
         strftime('%Y-%m', t.created_at) as ym,
         substr(t.created_at, 1, 10) as day,
         t.commission_exclude
  FROM tickets t
  WHERE t.legacy_source='starsisa'
`).all()

// Build items-by-ticket signature for comparison
const itemsByTicket = new Map()
const itemRows = db.prepare(`
  SELECT ticket_id, name, quantity, price
  FROM ticket_items
  WHERE ticket_id IN (SELECT id FROM tickets WHERE legacy_source='starsisa')
`).all()
for (const it of itemRows) {
  const arr = itemsByTicket.get(it.ticket_id) || []
  arr.push(`${(it.name||'').toLowerCase().trim()}|${Math.round((it.price||0)*100)}|${it.quantity||1}`)
  itemsByTicket.set(it.ticket_id, arr)
}
function sig(ticketId) {
  return (itemsByTicket.get(ticketId) || []).slice().sort().join(';')
}

// Group by (client_key, year-month)
function clientKey(t) {
  if (t.client_id) return 'c:' + t.client_id
  return 'v:' + (t.vehicle_plate || '').toLowerCase().trim()
}
const groups = new Map()
for (const t of tickets) {
  const k = clientKey(t) + '|' + t.ym
  if (!k.startsWith('c:') && !k.startsWith('v:') || k.startsWith('v:|')) continue // no client signal
  const arr = groups.get(k) || []
  arr.push(t)
  groups.set(k, arr)
}

const pairsToFlag = []
for (const [, group] of groups) {
  if (group.length < 2) continue
  // Within group, compare each pair
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const a = group[i], b = group[j]
      if (a.commission_exclude || b.commission_exclude) continue
      // Matching line items?
      const sa = sig(a.id), sb = sig(b.id)
      if (!sa || sa !== sb) continue
      // Comparable totals (within 5%)
      const ta = Number(a.total || 0), tb = Number(b.total || 0)
      if (Math.max(ta, tb) === 0) continue
      const diff = Math.abs(ta - tb) / Math.max(ta, tb)
      if (diff > 0.05) continue
      // NCF mismatch — one with real NCF, one with synthesized/B02
      const ncfA = (a.ncf || '').toUpperCase(), ncfB = (b.ncf || '').toUpperCase()
      const aIsFiscal = /^B01/.test(ncfA) && !ncfA.includes('LEGACY')
      const bIsFiscal = /^B01/.test(ncfB) && !ncfB.includes('LEGACY')
      if (aIsFiscal === bIsFiscal) continue // both or neither fiscal — not a pair
      // Flag the fiscal one (comprobante copy) as excluded; keep the wash ticket
      const dupe = aIsFiscal ? a : b
      pairsToFlag.push(dupe.id)
      a.commission_exclude = dupe === a ? 1 : 0
      b.commission_exclude = dupe === b ? 1 : 0
    }
  }
}

console.log(`  detected ${pairsToFlag.length} comprobante-pair duplicates`)

// ────────────────────────────────────────────────────────────────────────────
// Phase 3 — parse lavador + Wendy CSVs
// ────────────────────────────────────────────────────────────────────────────

console.log('\nPhase 3: parse commission CSVs')

function readCsv(filepath) {
  const raw = fs.readFileSync(filepath)
  if (raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF) return raw.slice(3).toString('utf8')
  const asUtf8 = raw.toString('utf8')
  if (asUtf8.includes('\uFFFD')) return raw.toString('latin1')
  return asUtf8
}
function parseCsvRow(line) {
  const out = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) { if (c === '"' && line[i+1] === '"') { cur += '"'; i++ } else if (c === '"') inQ = false; else cur += c }
    else { if (c === '"') inQ = true; else if (c === ',') { out.push(cur); cur = '' } else cur += c }
  }
  out.push(cur)
  return out
}
function repairThousandCommas(line) {
  let out = '', inQ = false, fieldStart = 0
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') { inQ = !inQ; out += c; continue }
    if (!inQ && c === ',') {
      const curField = out.slice(fieldStart)
      if (/^\d+(\.\d+)?$/.test(curField)) {
        const rest = line.slice(i + 1)
        if (/^\d{3}($|[,"\r\n])/.test(rest)) continue
      }
      out += c; fieldStart = out.length; continue
    }
    out += c
  }
  return out
}
function parseNum(s) {
  if (s == null) return 0
  const cleaned = String(s).replace(/[^\d.\-]/g, '')
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : n
}

// Each commission CSV has inline metadata + aggregated rows. We just need
// SUM(Total) across all data rows. Find by the "Codigo" label position and
// sum the Total column.
function sumCsvTotals(filepath) {
  const txt = readCsv(filepath)
  const lines = txt.split(/\r?\n/).filter(l => l.trim())
  let sum = 0, rowCount = 0
  for (const line of lines) {
    const cols = parseCsvRow(repairThousandCommas(line))
    // Find "Codigo" label column, then data column N+ should follow
    const codigoIdx = cols.findIndex(c => c.trim().toLowerCase() === 'codigo')
    if (codigoIdx < 0) continue
    // After "Codigo" the labels are [Codigo, Referencia, Cantidad, Costo, Total, Ganancia]
    // Data values come right after (N = 6).
    const dataStart = codigoIdx + 6
    if (cols.length < dataStart + 5) continue
    const dataCodigo = cols[dataStart]?.trim()
    const dataTotal  = cols[dataStart + 4]?.trim()
    if (!/^\d+$/.test(dataCodigo || '')) continue
    const t = parseNum(dataTotal)
    if (t > 0) { sum += t; rowCount++ }
  }
  return { sum, rowCount }
}

// Discover files
const files = fs.readdirSync(CSV_DIR)
const lavadorFiles = files.filter(f => /^Lavador /i.test(f))
const wendyFile    = files.find(f => /Wendy/i.test(f))
const jonnathanFile = files.find(f => /Jonnathan/i.test(f))

// Resolve employees
const empleados = db.prepare(`SELECT id, nombre, tipo, comision_pct, supabase_id FROM empleados WHERE active=1`).all()
function matchEmpleado(fileLabel) {
  // strip "Lavador "/"Cajera "/"Vendedor " + .csv
  const n = fileLabel.replace(/\.csv$/i, '').replace(/^(Lavador|Cajera|Vendedor)\s+/i, '').trim().toLowerCase()
  // prefer exact, then first-name exact, then fuzzy
  let best = empleados.find(e => e.nombre.trim().toLowerCase() === n)
  if (best) return best
  const first = n.split(/\s+/)[0]
  best = empleados.find(e => e.nombre.trim().toLowerCase().startsWith(first))
  return best || null
}

const report = []

const HAIRCUT = 0.922 // (1 − 559 pairs/7557 tickets)
const toNet = (gross) => gross / (1 + ITBIS_RATE)

// Per Mike: all StarSISA Totals include ITBIS — divide by 1.18 before applying
// commission %. This matches how the live Terminal X pipeline computes commission
// (electron/database.js:3356-3359 strips itbisFactor from gross before applying pct).

// Lavadores: comision_pct × (CSV Total × haircut / 1.18)
for (const file of lavadorFiles) {
  const emp = matchEmpleado(file)
  const { sum, rowCount } = sumCsvTotals(path.join(CSV_DIR, file))
  if (!emp) {
    report.push({ file, status: 'NO MATCH in empleados — add them first or skip', csv_sum: sum, rows: rowCount, commission: 0 })
    continue
  }
  const pct = Number(emp.comision_pct || 0)
  const netBase = toNet(sum * HAIRCUT)
  const comm = Math.round(netBase * (pct / 100) * 100) / 100
  report.push({ file, empleado_id: emp.id, empleado: emp.nombre, comision_pct: pct, csv_sum: sum, net_base: netBase, rows: rowCount, commission: comm, source: 'csv (net, 7.8% haircut)' })
}

// Wendy: 5% × (CSV Total × haircut / 1.18)
if (wendyFile) {
  const emp = matchEmpleado(wendyFile)
  const { sum, rowCount } = sumCsvTotals(path.join(CSV_DIR, wendyFile))
  const netBase = toNet(sum * HAIRCUT)
  const comm = Math.round(netBase * 0.05 * 100) / 100
  report.push({ file: wendyFile, empleado_id: emp?.id, empleado: emp?.nombre || '(not matched)', comision_pct: 5, csv_sum: sum, net_base: netBase, rows: rowCount, commission: comm, source: 'csv (net, 5%)' })
}

// Jonnathan: 5% × (sum(tickets.total) / 1.18) where total≥RD$1000 gross AND !commission_exclude
if (jonnathanFile) {
  const emp = matchEmpleado(jonnathanFile)
  const qualifyingSum = db.prepare(`
    SELECT COALESCE(SUM(total), 0) as s, COUNT(*) as c
    FROM tickets
    WHERE legacy_source='starsisa' AND total >= ? AND commission_exclude = 0
  `).get(VENDEDOR_THRESHOLD)
  const netBase = toNet(qualifyingSum.s)
  const comm = Math.round(netBase * 0.05 * 100) / 100
  report.push({ file: jonnathanFile, empleado_id: emp?.id, empleado: emp?.nombre || '(not matched)', comision_pct: 5, tickets_over_threshold: qualifyingSum.c, tickets_sum: qualifyingSum.s, net_base: netBase, commission: comm, source: `tickets net (≥${VENDEDOR_THRESHOLD} gross)` })
}

// ────────────────────────────────────────────────────────────────────────────
// Report
// ────────────────────────────────────────────────────────────────────────────

console.log('\n═══ Commission report ═══')
console.table(report.map(r => ({
  file: r.file,
  empleado: r.empleado || '—',
  pct: r.comision_pct || '—',
  source_sum: r.csv_sum != null ? r.csv_sum.toFixed(2) : (r.tickets_sum != null ? r.tickets_sum.toFixed(2) : '—'),
  rows_or_tickets: r.rows || r.tickets_over_threshold || '—',
  commission: (r.commission || 0).toFixed(2),
  source: r.source || '—',
  status: r.status || 'ok',
})))
const total = report.reduce((s, r) => s + (r.commission || 0), 0)
console.log(`\n  TOTAL COMMISSIONS OWED: RD$ ${total.toFixed(2)}`)
console.log(`  Comprobante-pair duplicates detected: ${pairsToFlag.length}`)

// ────────────────────────────────────────────────────────────────────────────
// Phase 4 — apply
// ────────────────────────────────────────────────────────────────────────────

if (!APPLY) {
  console.log('\n[dry-run] No writes. Pass --apply to set commission_exclude flags and write commission records.')
  db.close()
  process.exit(0)
}

console.log('\nPhase 4: applying')

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = (Math.random() * 16) | 0; const v = c === 'x' ? r : (r & 0x3) | 0x8; return v.toString(16) })
}

const nowIso = new Date().toISOString()

// Ensure the business_id column exists on the commission tables (desktop sync push key)
function ensureCol(table, col, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!cols.some(c => c.name === col)) {
    try { db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run() } catch {}
  }
}
for (const t of ['washer_commissions', 'seller_commissions', 'cajero_commissions']) {
  ensureCol(t, 'business_id', 'TEXT')
  ensureCol(t, 'updated_at',  'TEXT')
  ensureCol(t, 'supabase_id', 'TEXT')
  ensureCol(t, 'empleado_supabase_id', 'TEXT')
  ensureCol(t, 'source',      'TEXT')
}

// cajero_commissions has legacy NOT NULL on cajero_id + ticket_id. SQLite
// can't ALTER COLUMN, so rebuild the table if those constraints are present.
function relaxCajeroNotNull() {
  const info = db.prepare(`PRAGMA table_info(cajero_commissions)`).all()
  const cajeroCol = info.find(c => c.name === 'cajero_id')
  const ticketCol = info.find(c => c.name === 'ticket_id')
  if (!cajeroCol && !ticketCol) return
  const needsFix = (cajeroCol?.notnull === 1) || (ticketCol?.notnull === 1)
  if (!needsFix) return
  console.log('  relaxing cajero_commissions NOT NULL (rebuilding table)')
  db.exec(`
    CREATE TABLE cajero_commissions_new (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      cajero_id             INTEGER,
      ticket_id             INTEGER,
      base_amount           REAL NOT NULL,
      commission_pct        REAL NOT NULL,
      commission_amount     REAL NOT NULL,
      paid                  INTEGER NOT NULL DEFAULT 0,
      paid_at               TEXT,
      created_at            TEXT NOT NULL DEFAULT (datetime('now')),
      supabase_id           TEXT,
      ticket_supabase_id    TEXT,
      cajero_supabase_id    TEXT,
      empleado_supabase_id  TEXT,
      updated_at            TEXT,
      business_id           TEXT,
      source                TEXT
    );
    INSERT INTO cajero_commissions_new (id, cajero_id, ticket_id, base_amount, commission_pct, commission_amount, paid, paid_at, created_at, supabase_id, ticket_supabase_id, cajero_supabase_id, empleado_supabase_id, updated_at, business_id, source)
    SELECT id, cajero_id, ticket_id, base_amount, commission_pct, commission_amount, paid, paid_at, created_at,
      supabase_id, ticket_supabase_id, cajero_supabase_id,
      ${info.some(c=>c.name==='empleado_supabase_id') ? 'empleado_supabase_id' : 'NULL'},
      ${info.some(c=>c.name==='updated_at') ? 'updated_at' : 'NULL'},
      ${info.some(c=>c.name==='business_id') ? 'business_id' : 'NULL'},
      ${info.some(c=>c.name==='source') ? 'source' : 'NULL'}
    FROM cajero_commissions;
    DROP TABLE cajero_commissions;
    ALTER TABLE cajero_commissions_new RENAME TO cajero_commissions;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cajero_commissions_supabase_id ON cajero_commissions(supabase_id);
  `)
}
relaxCajeroNotNull()

const insWasher = db.prepare(`INSERT INTO washer_commissions (supabase_id, empleado_supabase_id, ticket_supabase_id, ticket_id, base_amount, commission_pct, commission_amount, paid, created_at, updated_at, business_id, source) VALUES (?, ?, NULL, NULL, ?, ?, ?, 0, ?, ?, ?, 'starsisa-import')`)
const insSeller = db.prepare(`INSERT INTO seller_commissions (supabase_id, empleado_supabase_id, ticket_supabase_id, ticket_id, base_amount, commission_pct, commission_amount, paid, created_at, updated_at, business_id, source) VALUES (?, ?, NULL, NULL, ?, ?, ?, 0, ?, ?, ?, 'starsisa-import')`)
const insCajero = db.prepare(`INSERT INTO cajero_commissions (supabase_id, empleado_supabase_id, ticket_supabase_id, ticket_id, base_amount, commission_pct, commission_amount, paid, created_at, updated_at, business_id, source) VALUES (?, ?, NULL, NULL, ?, ?, ?, 0, ?, ?, ?, 'starsisa-import')`)

// Wipe prior starsisa-import rows so re-runs are idempotent
function wipePrior() {
  try {
    const w = db.prepare(`DELETE FROM washer_commissions WHERE source='starsisa-import'`).run()
    const s = db.prepare(`DELETE FROM seller_commissions WHERE source='starsisa-import'`).run()
    const c = db.prepare(`DELETE FROM cajero_commissions WHERE source='starsisa-import'`).run()
    console.log(`  wiped prior imports — washers:${w.changes} sellers:${s.changes} cajeros:${c.changes}`)
  } catch (e) { console.error('  wipe error:', e.message) }
}

const tx = db.transaction(() => {
  if (pairsToFlag.length) {
    const stmt = db.prepare(`UPDATE tickets SET commission_exclude=1 WHERE id=?`)
    pairsToFlag.forEach(id => stmt.run(id))
    console.log(`  flagged ${pairsToFlag.length} dupes`)
  }

  wipePrior()

  let written = 0
  for (const r of report) {
    if (!r.empleado_id || !r.commission) continue
    const emp = empleados.find(e => e.id === r.empleado_id)
    if (!emp?.supabase_id) { console.log(`  SKIP ${r.empleado || r.file}: no supabase_id`); continue }
    const base = Number(r.net_base || 0)
    const pct  = Number(r.comision_pct || 0)
    const amt  = Number(r.commission || 0)
    const tipo = emp.tipo
    const args = [uuid(), emp.supabase_id, base, pct, amt, nowIso, nowIso, BUSINESS_ID]
    if (tipo === 'lavador' || tipo === 'hybrid') insWasher.run(...args)
    else if (tipo === 'vendedor')                 insSeller.run(...args)
    else if (tipo === 'cajero')                   insCajero.run(...args)
    else { console.log(`  SKIP ${emp.nombre}: unknown tipo=${tipo}`); continue }
    written++
    console.log(`  ✓ ${emp.nombre} (${tipo}) → RD$${amt.toFixed(2)}`)
  }
  console.log(`\n  wrote ${written} commission rows`)
})
tx()
console.log('\n✓ Applied. Commission rows written — next sync push will upload to Supabase.')
console.log('  Open Empleados → each person → Liquidación to see the number.')
db.close()
