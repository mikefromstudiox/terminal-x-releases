// StarSISA → Terminal X importer.
//
// Idempotent: safe to re-run. Rows written via this script are tagged
// `legacy_source='starsisa'` + `legacy_code=<StarSISA Codigo>`; re-running
// wipes only rows with that tag before re-importing, leaving real Terminal X
// data untouched.
//
// Usage:
//   node scripts/starsisa-import.js --csv-dir "C:/Users/post1/Desktop/Import" [--dry-run]
//
// Default CSV dir: C:/Users/post1/Desktop/Import
//
// Phases:
//   1. Schema additions (ALTER TABLE — no-op if already applied)
//   2. Parse all CSVs
//   3. Resolve FKs + build insert batches
//   4. If --dry-run: print summary + exit
//   5. Wipe prior starsisa-imported rows (scoped by legacy_source)
//   6. Insert in dependency order, single transaction
//   7. Bump ncf_sequences.current_number above max historical NCF
//   8. Print verification counts + sample rows

const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const csvDirIdx = args.indexOf('--csv-dir')
const CSV_DIR = csvDirIdx >= 0 ? args[csvDirIdx + 1] : path.join(os.homedir(), 'Desktop', 'Import')
const BUSINESS_ID = '1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79'
const DB_PATH = path.join(os.homedir(), 'AppData', 'Roaming', 'terminal-x', 'terminal-x.db')

const Database = require('better-sqlite3')
if (!fs.existsSync(DB_PATH)) { console.error('Terminal X DB not found:', DB_PATH); process.exit(1) }
if (!fs.existsSync(CSV_DIR)) { console.error('CSV dir not found:', CSV_DIR); process.exit(1) }

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = OFF') // speed; we enforce via correct insert order

// ────────────────────────────────────────────────────────────────────────────
// CSV parsing
// ────────────────────────────────────────────────────────────────────────────

// Minimal CSV parser with quote + escaped-quote handling.
function parseCsvRow(line) {
  const out = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') inQ = false
      else cur += c
    } else {
      if (c === '"') inQ = true
      else if (c === ',') { out.push(cur); cur = '' }
      else cur += c
    }
  }
  out.push(cur)
  return out
}

// Decode a file. cp1252 is a superset of latin1, so decode latin1 then fix
// mojibake characters specific to cp1252 (not bothering — Node supports latin1
// and Spanish chars in 0x80-0xFF round-trip correctly through latin1).
function readCsvFile(filepath) {
  const raw = fs.readFileSync(filepath)
  // UTF-8 BOM?
  if (raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF) {
    return raw.slice(3).toString('utf8')
  }
  // Heuristic: if high-byte chars decoded as UTF-8 produce replacement chars,
  // fall back to latin1 (cp1252 subset).
  const asUtf8 = raw.toString('utf8')
  if (asUtf8.includes('\uFFFD')) return raw.toString('latin1')
  return asUtf8
}

// Crystal Reports CSVs have ~10-20 preamble columns before the real data.
// Find the column index where the real header starts by locating "Codigo" in
// the header row, then slice every subsequent row from that column onward.
function parseCrystalCsv(filepath) {
  const txt = readCsvFile(filepath)
  const rawLines = txt.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (rawLines.length < 2) return { headers: [], rows: [] }

  // Find header row — first row with "Codigo" in it (case-insensitive).
  let headerLineIdx = -1, codigoCol = -1
  for (let i = 0; i < Math.min(rawLines.length, 50); i++) {
    const cols = parseCsvRow(rawLines[i])
    const idx = cols.findIndex(c => c.trim().toLowerCase() === 'codigo')
    if (idx >= 0) { headerLineIdx = i; codigoCol = idx; break }
  }
  if (headerLineIdx < 0) {
    console.warn('  [skip] no Codigo header in', path.basename(filepath))
    return { headers: [], rows: [] }
  }

  const headers = parseCsvRow(rawLines[headerLineIdx]).slice(codigoCol).map(h => h.trim())
  const rows = []
  const footerSignals = ['total general', 'cantidad de registros', 'cantidad total']
  for (let i = headerLineIdx + 1; i < rawLines.length; i++) {
    const cols = parseCsvRow(rawLines[i])
    const sliced = cols.slice(codigoCol).map(c => c.trim())
    // Skip footers
    const firstCell = (sliced[0] || '').toLowerCase()
    if (footerSignals.some(s => firstCell.includes(s))) continue
    // Skip rows where the Codigo column is empty or obviously not a code
    if (!sliced[0] || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(sliced[0])) continue
    // Build object keyed by header
    const row = {}
    headers.forEach((h, j) => { row[h] = sliced[j] != null ? sliced[j] : '' })
    rows.push(row)
  }
  return { headers, rows }
}

// Parse DR-local DD/MM/YYYY [HH:MM] → ISO-UTC string.
function parseDmyToIso(s) {
  if (!s || typeof s !== 'string') return null
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (!m) return null
  const [, d, mo, y, hh = '12', mm = '00', ss = '00'] = m
  // DR is UTC-4. Treat DD/MM/YYYY HH:MM as local DR time, convert to UTC by adding 4h.
  const dt = new Date(Date.UTC(+y, +mo - 1, +d, +hh + 4, +mm, +ss))
  if (isNaN(dt.getTime())) return null
  return dt.toISOString()
}

function parseNum(s) {
  if (s == null) return 0
  const cleaned = String(s).replace(/[^\d.\-]/g, '')
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : n
}

// ────────────────────────────────────────────────────────────────────────────
// 1. Schema additions
// ────────────────────────────────────────────────────────────────────────────

function addColumnIfMissing(table, col, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  if (cols.some(c => c.name === col)) return false
  db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run()
  return true
}

console.log('Phase 1: schema additions')
const added = []
if (addColumnIfMissing('tickets',         'legacy_source', 'TEXT')) added.push('tickets.legacy_source')
if (addColumnIfMissing('tickets',         'legacy_code',   'TEXT')) added.push('tickets.legacy_code')
if (addColumnIfMissing('ticket_items',    'legacy_code',   'TEXT')) added.push('ticket_items.legacy_code')
if (addColumnIfMissing('services',        'legacy_code',   'TEXT')) added.push('services.legacy_code')
if (addColumnIfMissing('inventory_items', 'legacy_code',   'TEXT')) added.push('inventory_items.legacy_code')
if (addColumnIfMissing('clients',         'legacy_source', 'TEXT')) added.push('clients.legacy_source')
if (addColumnIfMissing('clients',         'legacy_code',   'TEXT')) added.push('clients.legacy_code')
if (addColumnIfMissing('staff',           'legacy_source', 'TEXT')) added.push('staff.legacy_source')
db.prepare(`CREATE INDEX IF NOT EXISTS idx_tickets_legacy_code ON tickets(legacy_code) WHERE legacy_code IS NOT NULL`).run()
console.log('  added:', added.length ? added.join(', ') : '(all already present)')

// ────────────────────────────────────────────────────────────────────────────
// 2. Parse CSVs
// ────────────────────────────────────────────────────────────────────────────

console.log('\nPhase 2: parse CSVs in', CSV_DIR)

function findOne(pattern) {
  const files = fs.readdirSync(CSV_DIR).filter(f => pattern.test(f))
  return files.length ? path.join(CSV_DIR, files[0]) : null
}

const prodFile    = findOne(/^Productos\.csv$/i) || findOne(/^Productos/i)
const svcFile     = findOne(/^Servicios\.csv$/i) || findOne(/^Servicios/i)
const facFile     = findOne(/^Facturas.*\.csv$/i)
const ventasSvcFile = findOne(/^Ventas De Servicios.*\.csv$/i)
const ventasPrdFile = findOne(/^Ventas De Productos.*\.csv$/i)

console.log('  products file:', prodFile ? path.basename(prodFile) : 'MISSING')
console.log('  services file:', svcFile  ? path.basename(svcFile)  : 'MISSING')
console.log('  facturas file:', facFile  ? path.basename(facFile)  : 'MISSING')
console.log('  ventas-svc file:', ventasSvcFile ? path.basename(ventasSvcFile) : 'MISSING')
console.log('  ventas-prd file:', ventasPrdFile ? path.basename(ventasPrdFile) : 'MISSING')

const productos    = prodFile     ? parseCrystalCsv(prodFile).rows      : []
const servicios    = svcFile      ? parseCrystalCsv(svcFile).rows       : []
const facturas     = facFile      ? parseCrystalCsv(facFile).rows       : []
const ventasSvc    = ventasSvcFile? parseCrystalCsv(ventasSvcFile).rows : []
const ventasPrd    = ventasPrdFile? parseCrystalCsv(ventasPrdFile).rows : []

console.log('  parsed rows:',
  'productos=' + productos.length,
  'servicios=' + servicios.length,
  'facturas=' + facturas.length,
  'ventasSvc=' + ventasSvc.length,
  'ventasPrd=' + ventasPrd.length)

// Per-client filenames → canonical clients list.
const canonicalClients = fs.readdirSync(CSV_DIR)
  .filter(f => /^Ventas Cliente/i.test(f))
  .map(f => {
    const name = f.replace(/^Ventas Cliente\s*/i, '').replace(/\s*\d.*$/, '').replace(/\.csv$/i, '').trim()
    return name
  })
  .filter((v, i, a) => v && a.indexOf(v) === i)
  .map(name => ({ name, legacyCode: name.toLowerCase().replace(/\s+/g, '-') }))
console.log('  canonical clients:', canonicalClients.length)

// ────────────────────────────────────────────────────────────────────────────
// 3. Build insert plans
// ────────────────────────────────────────────────────────────────────────────

const invRows = productos.map(r => ({
  supabase_id:     crypto.randomUUID(),
  business_id:     BUSINESS_ID,
  name:            r['Referencia'] || 'Sin nombre',
  sku:             r['Codigo'],
  cost:            parseNum(r['Costo']),
  price:           parseNum(r['Precio + Itbis'] || r['Precio']),
  unit:            r['Medida'] || null,
  quantity:        0,
  min_stock:       0,
  aplica_itbis:    1,
  active:          1,
  legacy_source:   'starsisa',
  legacy_code:     r['Codigo'],
}))

const svcRows = servicios.map(r => ({
  supabase_id:     crypto.randomUUID(),
  business_id:     BUSINESS_ID,
  name:            r['Referencia'] || 'Sin nombre',
  cost:            parseNum(r['Costo']),
  price:           parseNum(r['Precio + Itbis'] || r['Precio']),
  is_wash:         1,
  aplica_itbis:    1,
  no_commission:   0,
  active:          1,
  legacy_source:   'starsisa',
  legacy_code:     r['Codigo'],
}))

// Synthetic staff row — so historical tickets show "StarSISA Import" as
// the cashier instead of "—". Inactive so nobody can log in as it.
const IMPORT_USER = {
  supabase_id: crypto.randomUUID(),
  business_id: BUSINESS_ID,
  name:        'StarSISA Import',
  username:    'starsisa_import',
  pin_hash:    null,           // no credentials — can't log in
  role:        'cashier',
  active:      0,
  legacy_source: 'starsisa',
}

const clientRows = canonicalClients.map(c => ({
  supabase_id:     crypto.randomUUID(),
  business_id:     BUSINESS_ID,
  name:            c.name,
  active:          1,
  legacy_source:   'starsisa',
  legacy_code:     c.legacyCode,
}))

// Client name matching — exact first, then 0.95 Levenshtein similarity fallback.
// Mike's 2026-04-18 call: stricter 0.95 threshold with only 20 canonical clients —
// prevents false positives like "AUTO MOV" ↛ "AUTO FREE".
const clientByName = new Map(clientRows.map(c => [c.name.trim().toLowerCase(), c]))
function levenshtein(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const v0 = new Array(b.length + 1), v1 = new Array(b.length + 1)
  for (let i = 0; i <= b.length; i++) v0[i] = i
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost)
    }
    for (let j = 0; j <= b.length; j++) v0[j] = v1[j]
  }
  return v1[b.length]
}
function similarity(a, b) {
  const max = Math.max(a.length, b.length)
  if (!max) return 1
  return 1 - (levenshtein(a, b) / max)
}
function matchClient(raw) {
  const key = raw.trim().toLowerCase()
  if (!key) return null
  const exact = clientByName.get(key)
  if (exact) return exact
  // Fuzzy fallback — only accept if >= 0.90 similarity and unique best match.
  let best = null, bestSim = 0
  for (const c of clientRows) {
    const s = similarity(key, c.name.toLowerCase())
    if (s >= 0.95 && s > bestSim) { best = c; bestSim = s }
  }
  return best
}

// Facturas → tickets
function deriveComprobante(ncf) {
  if (!ncf) return 'B02'
  const m = ncf.match(/^([BE])(\d{2})/i)
  if (!m) return 'B02'
  return (m[1] + m[2]).toUpperCase()
}

const ticketRows = facturas.map(r => {
  const codigo      = r['Codigo']
  const nombreCli   = (r['Nombre Cliente'] || '').trim()
  const clientRec   = matchClient(nombreCli)
  const total       = parseNum(r['Total'])
  const subtotal    = parseFloat((total / 1.18).toFixed(2))
  const itbis       = parseFloat((total - subtotal).toFixed(2))
  const ncfRaw      = (r['Compobante Gubernamental'] || r['Comprobante Gubernamental'] || '').trim()
  const ncf         = ncfRaw || `B02-LEGACY-${String(codigo).padStart(5, '0')}`
  const comprobante = deriveComprobante(ncfRaw)
  const condicion   = (r['Condicion'] || '').toLowerCase()
  const tipoVenta   = /credit/.test(condicion) ? 'credito' : 'contado'

  return {
    supabase_id:           crypto.randomUUID(),
    business_id:           BUSINESS_ID,
    doc_number:            `T-${String(codigo).padStart(5, '0')}`,
    client_id:             null,                           // resolved after client inserts
    client_supabase_id:    clientRec ? clientRec.supabase_id : null,
    vehicle_plate:         clientRec ? null : (nombreCli || null),
    subtotal, itbis, ley: 0, total,
    descuento:             0,
    beverage_subtotal:     0,
    payment_method:        'cash',
    comprobante_type:      comprobante,
    ncf,
    ecf_result:            '{}',
    tipo_venta:            tipoVenta,
    status:                'cobrado',
    cajero_id:             null,                      // resolved after staff insert
    cajero_supabase_id:    IMPORT_USER.supabase_id,
    created_at:            parseDmyToIso(r['Fecha']) || new Date().toISOString(),
    origin_hwid:           'starsisa-import',
    used_legacy_counter:   0,
    washer_empleado_supabase_ids: '[]',
    legacy_source:         'starsisa',
    legacy_code:           String(codigo),
    notes:                 null,
  }
})

const ticketByLegacy = new Map(ticketRows.map(t => [t.legacy_code, t]))
const svcByLegacy    = new Map(svcRows.map(s => [s.legacy_code, s]))
const invByLegacy    = new Map(invRows.map(i => [i.legacy_code, i]))

function buildItem(r, isService) {
  const ticket = ticketByLegacy.get(String(r['Fac. Cod.']))
  if (!ticket) return null
  const lookup  = isService ? svcByLegacy.get(r['Codigo']) : invByLegacy.get(r['Codigo'])
  return {
    supabase_id:                 crypto.randomUUID(),
    ticket_id:                   null, // set after ticket insert
    ticket_supabase_id:          ticket.supabase_id,
    service_id:                  null,
    service_supabase_id:         isService && lookup ? lookup.supabase_id : null,
    inventory_item_id:           null,
    inventory_item_supabase_id:  !isService && lookup ? lookup.supabase_id : null,
    name:                        r['Referencia'] || 'Sin nombre',
    price:                       parseNum(r['Precio']),
    cost:                        parseNum(r['Costo']),
    quantity:                    parseNum(r['Cantidad']) || 1,
    sku:                         null,
    is_wash:                     isService ? 1 : 0,
    aplica_itbis:                1,
    legacy_code:                 String(r['Codigo']),
  }
}

const itemRows = [
  ...ventasSvc.map(r => buildItem(r, true)),
  ...ventasPrd.map(r => buildItem(r, false)),
].filter(Boolean)

console.log('\nPhase 3: insert plan')
console.log('  inventory_items:', invRows.length)
console.log('  services:       ', svcRows.length)
console.log('  clients:        ', clientRows.length)
console.log('  tickets:        ', ticketRows.length)
console.log('  ticket_items:   ', itemRows.length)

if (DRY_RUN) {
  console.log('\n[dry-run] No writes performed. Pass without --dry-run to apply.')
  process.exit(0)
}

// ────────────────────────────────────────────────────────────────────────────
// 5-7. Write in a single transaction
// ────────────────────────────────────────────────────────────────────────────

console.log('\nPhase 5: wipe previous starsisa-imported rows (idempotency)')
db.prepare(`DELETE FROM ticket_items WHERE ticket_id IN (SELECT id FROM tickets WHERE legacy_source='starsisa')`).run()
db.prepare(`DELETE FROM tickets        WHERE legacy_source='starsisa'`).run()
db.prepare(`DELETE FROM clients        WHERE legacy_source='starsisa'`).run()
db.prepare(`DELETE FROM services       WHERE legacy_source='starsisa'`).run()
db.prepare(`DELETE FROM inventory_items WHERE legacy_source='starsisa'`).run()
try { db.prepare(`DELETE FROM staff    WHERE legacy_source='starsisa'`).run() } catch {}

console.log('Phase 6: insert in dependency order')

const tx = db.transaction(() => {
  // synthetic import user (so historical cajero_name isn't '—')
  try {
    db.prepare(`INSERT INTO staff (supabase_id, business_id, name, username, pin_hash, role, active, legacy_source)
                VALUES (@supabase_id, @business_id, @name, @username, @pin_hash, @role, @active, @legacy_source)`).run(IMPORT_USER)
  } catch (e) { console.warn('  [warn] staff insert failed — may lack business_id column:', e.message) }

  // inventory_items
  const invStmt = db.prepare(`INSERT INTO inventory_items
    (supabase_id, business_id, name, sku, cost, price, unit, quantity, min_stock, aplica_itbis, active, legacy_source, legacy_code)
    VALUES (@supabase_id,@business_id,@name,@sku,@cost,@price,@unit,@quantity,@min_stock,@aplica_itbis,@active,@legacy_source,@legacy_code)`)
  invRows.forEach(r => invStmt.run(r))

  // services
  const svcStmt = db.prepare(`INSERT INTO services
    (supabase_id, business_id, name, cost, price, is_wash, aplica_itbis, no_commission, active, legacy_source, legacy_code)
    VALUES (@supabase_id,@business_id,@name,@cost,@price,@is_wash,@aplica_itbis,@no_commission,@active,@legacy_source,@legacy_code)`)
  svcRows.forEach(r => svcStmt.run(r))

  // clients
  const cliStmt = db.prepare(`INSERT INTO clients
    (supabase_id, business_id, name, active, legacy_source, legacy_code)
    VALUES (@supabase_id,@business_id,@name,@active,@legacy_source,@legacy_code)`)
  clientRows.forEach(r => cliStmt.run(r))

  // Back-fill ticket.client_id from supabase_id
  const clientIdByUuid = new Map(
    db.prepare(`SELECT id, supabase_id FROM clients WHERE legacy_source='starsisa'`).all()
      .map(r => [r.supabase_id, r.id])
  )
  ticketRows.forEach(t => {
    if (t.client_supabase_id) t.client_id = clientIdByUuid.get(t.client_supabase_id) || null
  })

  // Back-fill ticket.cajero_id from synthetic user
  const importUserId = db.prepare(`SELECT id FROM staff WHERE supabase_id=? LIMIT 1`).get(IMPORT_USER.supabase_id)?.id
  if (importUserId) ticketRows.forEach(t => { t.cajero_id = importUserId })

  // tickets
  const tkStmt = db.prepare(`INSERT INTO tickets
    (supabase_id, business_id, doc_number, client_id, client_supabase_id, vehicle_plate,
     subtotal, itbis, ley, total, descuento, beverage_subtotal,
     payment_method, comprobante_type, ncf, ecf_result, tipo_venta, status,
     cajero_id, cajero_supabase_id, created_at, origin_hwid, used_legacy_counter,
     washer_empleado_supabase_ids, legacy_source, legacy_code, notes)
    VALUES (@supabase_id,@business_id,@doc_number,@client_id,@client_supabase_id,@vehicle_plate,
     @subtotal,@itbis,@ley,@total,@descuento,@beverage_subtotal,
     @payment_method,@comprobante_type,@ncf,@ecf_result,@tipo_venta,@status,
     @cajero_id,@cajero_supabase_id,@created_at,@origin_hwid,@used_legacy_counter,
     @washer_empleado_supabase_ids,@legacy_source,@legacy_code,@notes)`)
  ticketRows.forEach(r => tkStmt.run(r))

  // Back-fill ticket_item.ticket_id
  const ticketIdByUuid = new Map(
    db.prepare(`SELECT id, supabase_id FROM tickets WHERE legacy_source='starsisa'`).all()
      .map(r => [r.supabase_id, r.id])
  )
  itemRows.forEach(it => { it.ticket_id = ticketIdByUuid.get(it.ticket_supabase_id) || null })

  // ticket_items
  const itStmt = db.prepare(`INSERT INTO ticket_items
    (supabase_id, ticket_id, ticket_supabase_id,
     service_id, service_supabase_id, inventory_item_id, inventory_item_supabase_id,
     name, price, cost, quantity, sku, is_wash, aplica_itbis, legacy_code)
    VALUES (@supabase_id,@ticket_id,@ticket_supabase_id,
     @service_id,@service_supabase_id,@inventory_item_id,@inventory_item_supabase_id,
     @name,@price,@cost,@quantity,@sku,@is_wash,@aplica_itbis,@legacy_code)`)
  itemRows.filter(it => it.ticket_id).forEach(r => itStmt.run(r))
})
tx()

// ────────────────────────────────────────────────────────────────────────────
// 7. Bump NCF counter
// ────────────────────────────────────────────────────────────────────────────

console.log('Phase 7: NCF sequence bump review')
// Show max per real NCF type (skip B02-LEGACY synthetic prefixes)
const perType = db.prepare(`
  SELECT substr(ncf,1,3) as prefix, MAX(CAST(SUBSTR(ncf, 4) AS INTEGER)) as max_num, COUNT(*) as count
  FROM tickets
  WHERE legacy_source='starsisa' AND ncf NOT LIKE '%-LEGACY-%' AND ncf LIKE '[BE]%'
  GROUP BY prefix
  ORDER BY prefix
`).all()
if (perType.length === 0) {
  console.log('  no historical real NCFs found, skipping bump')
} else {
  console.log('\n  ⚠ NCF RANGE REVIEW — Terminal X will bump sequences ABOVE these historical maxes:')
  console.log('  ┌─────────┬──────────────┬───────┬──────────────┐')
  console.log('  │ prefix  │ max in import│ count │ will set to  │')
  console.log('  ├─────────┼──────────────┼───────┼──────────────┤')
  perType.forEach(r => {
    const next = r.max_num + 10
    console.log(`  │ ${r.prefix.padEnd(7)} │ ${String(r.max_num).padStart(12)} │ ${String(r.count).padStart(5)} │ ${String(next).padStart(12)} │`)
  })
  console.log('  └─────────┴──────────────┴───────┴──────────────┘')
  if (args.includes('--skip-ncf-bump')) {
    console.log('  [--skip-ncf-bump] NOT bumping sequences. Review manually + set via SQL if needed.')
  } else {
    perType.forEach(r => {
      const next = r.max_num + 10
      db.prepare(`UPDATE ncf_sequences SET current_number=MAX(current_number, ?) WHERE type=?`).run(next, r.prefix)
    })
    console.log('  ✓ ncf_sequences updated. Re-run with --skip-ncf-bump if you want to review first.')
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 8. Verification
// ────────────────────────────────────────────────────────────────────────────

console.log('\nPhase 8: verification counts')
const counts = {
  inventory_items:  db.prepare(`SELECT COUNT(*) c FROM inventory_items WHERE legacy_source='starsisa'`).get().c,
  services:         db.prepare(`SELECT COUNT(*) c FROM services WHERE legacy_source='starsisa'`).get().c,
  clients:          db.prepare(`SELECT COUNT(*) c FROM clients WHERE legacy_source='starsisa'`).get().c,
  tickets:          db.prepare(`SELECT COUNT(*) c FROM tickets WHERE legacy_source='starsisa'`).get().c,
  ticket_items:     db.prepare(`SELECT COUNT(*) c FROM ticket_items WHERE ticket_id IN (SELECT id FROM tickets WHERE legacy_source='starsisa')`).get().c,
}
console.log(' ', counts)

const sample = db.prepare(`SELECT doc_number, total, created_at, vehicle_plate, ncf FROM tickets WHERE legacy_source='starsisa' ORDER BY id DESC LIMIT 3`).all()
console.log('\n  sample tickets:', sample)

const orphanItems = db.prepare(`SELECT COUNT(*) c FROM ticket_items WHERE ticket_id IS NULL AND legacy_code IS NOT NULL`).get().c
if (orphanItems > 0) console.warn(`  WARNING: ${orphanItems} line items had no matching ticket (Fac. Cod. not in Facturas.csv)`)

console.log('\n✓ Import complete. Now run a manual Sincronizar in Terminal X to push to Supabase.')
db.close()
