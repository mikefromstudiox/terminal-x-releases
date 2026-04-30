/**
 * dupe-audit-targeted.mjs — focused dedupe candidates for master-data tables.
 * Only flags real bugs (not legitimate multi-row patterns).
 */
import 'dotenv/config'
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

// (table, columns) → "should be unique because…"
// Only listing tables where having two rows with the same key is ALWAYS wrong.
const CANDIDATES = [
  { table: 'services',           cols: ['business_id', 'name'],         note: 'service catalog item — same name on same business is dupe' },
  { table: 'empleados',          cols: ['business_id', 'cedula'],       note: 'one person = one cedula = one empleado row' },
  { table: 'inventory_items',    cols: ['business_id', 'sku'],          note: 'SKU is the natural primary key for stock' },
  { table: 'promotions',         cols: ['business_id', 'name'],         note: 'two ofertas with same name = customer confusion' },
  { table: 'modificadores',      cols: ['business_id', 'nombre'],       note: 'modifier catalog — same name twice is dupe' },
  { table: 'ncf_sequences',      cols: ['business_id', 'type'],         note: 'one sequence per type — DGII rule' },
  { table: 'categorias_servicio',cols: ['business_id', 'nombre'],       note: 'category catalog — same name twice is dupe' },
  { table: 'vehicle_inventory',  cols: ['business_id', 'vin'],          note: 'VIN is unique per vehicle worldwide' },
  { table: 'service_packages',   cols: ['business_id', 'name'],         note: 'package catalog — same name twice is dupe' },
  { table: 'wash_combos',        cols: ['business_id', 'name'],         note: 'combo catalog — same name twice is dupe' },
  { table: 'staff',              cols: ['business_id', 'auth_user_id'], note: 'one auth user = one staff row per business' },
  { table: 'payroll_settings',   cols: ['business_id'],                 note: 'one row of settings per business' },
  { table: 'app_settings',       cols: ['business_id', 'key'],          note: 'one value per (biz, key) — that IS the contract' },
  { table: 'mesas',              cols: ['business_id', 'name'],         note: 'mesa name is unique per restaurant' },
  { table: 'aseguradoras',       cols: ['business_id', 'rnc'],          note: 'one insurance company per RNC per dealership' },
  { table: 'suppliers',          cols: ['business_id', 'rnc'],          note: 'one supplier per RNC' },
  { table: 'service_bays',       cols: ['business_id', 'name'],         note: 'service bay name unique per shop' },
  { table: 'modifier_groups',    cols: ['business_id', 'name'],         note: 'modifier group name unique' },
  { table: 'rnc_contribuyentes', cols: ['business_id', 'rnc'],          note: 'RNC catalog cache' },
  { table: 'memberships',        cols: ['business_id', 'name'],         note: 'membership tier name unique' },
  { table: 'stylist_schedules',  cols: ['business_id', 'empleado_supabase_id', 'day_of_week'], note: 'one schedule per stylist per weekday' },
  { table: 'recurring_orders',   cols: ['business_id', 'client_supabase_id', 'name'], note: 'one recurring order with same name per client' },
  { table: 'doc_number_master',  cols: ['business_id', 'doc_type'],     note: 'one master row per doc_type' },
  { table: 'service_recipe_items', cols: ['business_id', 'service_supabase_id', 'inventory_item_supabase_id'], note: 'one recipe entry per (service, ingredient)' },
  { table: 'salary_changes',     cols: ['business_id', 'empleado_supabase_id', 'effective_date'], note: 'already done — sanity check' },
]

async function tableExists(table) {
  const r = await q(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='${table}'`)
  return Array.isArray(r) && r.length > 0
}
async function colsExist(table, cols) {
  const list = cols.map(c => `'${c}'`).join(',')
  const r = await q(`SELECT count(*) AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}' AND column_name IN (${list})`)
  return Number(r[0]?.n || 0) === cols.length
}
async function uniqueExists(table, cols) {
  const r = await q(`
    SELECT pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN pg_class c ON c.oid=con.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='${table}' AND con.contype='u'`)
  if (!Array.isArray(r)) return false
  return r.some(row => cols.every(c => new RegExp(`\\b${c}\\b`).test(row.def)))
}

console.log(`${'TABLE'.padEnd(28)}${'KEYS'.padEnd(70)}${'STATUS'.padEnd(18)}DUPES`)
console.log('-'.repeat(140))

for (const cand of CANDIDATES) {
  if (!await tableExists(cand.table)) {
    console.log(`${cand.table.padEnd(28)}${cand.cols.join(',').padEnd(70)}MISSING TABLE`)
    continue
  }
  if (!await colsExist(cand.table, cand.cols)) {
    console.log(`${cand.table.padEnd(28)}${cand.cols.join(',').padEnd(70)}MISSING COLUMN`)
    continue
  }
  const hasUnique = await uniqueExists(cand.table, cand.cols)
  const where = cand.cols.map(c => `${c} IS NOT NULL`).join(' AND ')
  const groupBy = cand.cols.join(', ')
  const sql = `SELECT count(*) AS dupe_groups, COALESCE(SUM(cnt-1),0) AS extra_rows FROM (SELECT ${groupBy}, count(*) AS cnt FROM public.${cand.table} WHERE ${where} GROUP BY ${groupBy} HAVING count(*) > 1) g`
  const r = await q(sql)
  const groups = Number(r?.[0]?.dupe_groups || 0)
  const extra = Number(r?.[0]?.extra_rows || 0)
  const status = hasUnique ? 'has UNIQUE ✓' : 'NO UNIQUE ⚠'
  const dupes = extra > 0 ? `${groups} groups, ${extra} extra` : '0'
  console.log(`${cand.table.padEnd(28)}(${cand.cols.join(',')})`.padEnd(98) + `${status.padEnd(18)}${dupes}`)
}
