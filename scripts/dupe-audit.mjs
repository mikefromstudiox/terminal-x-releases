/**
 * dupe-audit.mjs — find duplicate rows on natural keys for every multi-tenant
 * table. Looks for tables with `business_id` + a likely natural key column
 * (name, nombre, sku, license_key, encf, ...) where there is NO existing
 * UNIQUE constraint covering that natural key, and counts duplicate rows.
 *
 * Output: tmp/dupe-audit-<date>.json with one entry per affected table.
 */
import 'dotenv/config'
import fs from 'node:fs'

const TOK = process.env.SUPABASE_ACCESS_TOKEN
const REF = new URL(process.env.SUPABASE_URL).hostname.split('.')[0]

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + TOK, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  return r.json()
}

// Candidate natural-key columns ranked by likelihood of being the right key.
// We test each combination (cols + business_id) against current rows.
const KEY_CANDIDATES = [
  ['name'],
  ['nombre'],
  ['sku'],
  ['license_key'],
  ['encf'],
  ['cedula'],
  ['rnc'],
  ['email'],
  ['vehicle_plate'],
  ['plate'],
  ['vin'],
  ['type'],
  ['key'],
  ['empleado_supabase_id', 'effective_date'],
  ['empleado_supabase_id', 'date'],
  ['empleado_supabase_id', 'fecha'],
  ['client_supabase_id', 'service_supabase_id'],
  ['ticket_supabase_id', 'name'],
  ['titulo'],
  ['title'],
  ['doc_number'],
  ['number'],
  ['period'],
  ['vehicle_supabase_id'],
]

const skipTables = /^(activity_log|activity_log_p_|sync_|migration|spatial_ref_sys|pg_)/

console.log('Listing multi-tenant tables…')
const tables = await q(`
  SELECT t.table_name,
         array_agg(c.column_name ORDER BY c.ordinal_position) AS cols
  FROM information_schema.tables t
  JOIN information_schema.columns c ON c.table_name=t.table_name AND c.table_schema=t.table_schema
  WHERE t.table_schema='public' AND t.table_type='BASE TABLE'
    AND EXISTS (SELECT 1 FROM information_schema.columns c2 WHERE c2.table_name=t.table_name AND c2.table_schema='public' AND c2.column_name='business_id')
  GROUP BY t.table_name
  ORDER BY t.table_name`)
// PostgREST returns array_agg as a {col1,col2} string — parse it.
function parsePgArray(s) {
  if (Array.isArray(s)) return s
  if (typeof s !== 'string') return []
  return s.replace(/^\{|\}$/g, '').split(',').map(x => x.replace(/^"|"$/g, ''))
}
for (const t of tables) t.cols = parsePgArray(t.cols)
const tableMap = new Map(tables.map(t => [t.table_name, t.cols]))

console.log('Loading existing UNIQUE constraints…')
const existingUniques = await q(`
  SELECT c.relname AS table_name,
         con.conname AS conname,
         pg_get_constraintdef(con.oid) AS def
  FROM pg_constraint con
  JOIN pg_class c ON c.oid=con.conrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND con.contype='u'`)
const uniqByTable = {}
for (const r of existingUniques) {
  if (!uniqByTable[r.table_name]) uniqByTable[r.table_name] = []
  uniqByTable[r.table_name].push(r.def)
}

console.log(`Found ${tables.length} multi-tenant tables. Auditing each for natural-key duplicates…\n`)

const findings = []
let scanned = 0

for (const t of tables) {
  if (skipTables.test(t.table_name)) continue
  const cols = new Set(t.cols)
  const matchingKeys = KEY_CANDIDATES.filter(k => k.every(c => cols.has(c)))
  if (matchingKeys.length === 0) continue

  for (const keyCols of matchingKeys) {
    const allCols = ['business_id', ...keyCols]
    // Skip if an existing UNIQUE constraint already covers all these cols
    const existing = uniqByTable[t.table_name] || []
    const covered = existing.some(def => allCols.every(c => new RegExp(`\\b${c}\\b`).test(def)))
    if (covered) continue

    // Count duplicates
    const select = allCols.join(', ')
    const groupBy = allCols.join(', ')
    const where = allCols.map(c => `${c} IS NOT NULL`).join(' AND ')
    const sql = `
      SELECT count(*) AS dupe_groups,
             COALESCE(SUM(cnt - 1), 0) AS extra_rows,
             COALESCE(MAX(cnt), 0) AS worst_group_size
      FROM (
        SELECT ${groupBy}, count(*) AS cnt
        FROM public.${t.table_name}
        WHERE ${where}
        GROUP BY ${groupBy}
        HAVING count(*) > 1
      ) g`
    const r = await q(sql)
    if (Array.isArray(r) && r[0] && Number(r[0].extra_rows) > 0) {
      findings.push({
        table: t.table_name,
        natural_key: allCols,
        dupe_groups: Number(r[0].dupe_groups),
        extra_rows: Number(r[0].extra_rows),
        worst_group_size: Number(r[0].worst_group_size),
      })
      console.log(`  ⚠ ${t.table_name.padEnd(35)} keys=(${allCols.join(',')}) dupe_groups=${r[0].dupe_groups} extra_rows=${r[0].extra_rows} worst=${r[0].worst_group_size}`)
    }
  }
  scanned++
}

console.log(`\nScanned ${scanned} tables. ${findings.length} natural-key duplicates found.`)
const out = `tmp/dupe-audit-${new Date().toISOString().slice(0,10)}.json`
fs.writeFileSync(out, JSON.stringify(findings, null, 2))
console.log(`Saved findings → ${out}`)
