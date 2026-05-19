#!/usr/bin/env node
// scripts/schema-suite.mjs
//
// Wave 2 — single harness consolidating every schema / data-integrity audit:
//   fresh-install-schema-audit.mjs, dupe-audit.mjs, dupe-audit-targeted.mjs,
//   audit-carniceria-deep.mjs, audit-mechanic-schema.mjs, pg17-audit-inspect.mjs,
//   scale-test-audit.mjs, and the schema-contract / LWW / RLS slices of
//   audit-flows.mjs.
//
// 100% read-only against prod. Every assertion that names a constraint, RLS
// policy, function, trigger or column verifies live via pg_catalog /
// information_schema (CLAUDE.md HARD RULE — code-grep alone lies).
//
// Run:
//   NODE_OPTIONS=--use-system-ca node scripts/schema-suite.mjs
//   NODE_OPTIONS=--use-system-ca node scripts/schema-suite.mjs --filter=schema.constraints
//   JSON=true node scripts/schema-suite.mjs
//
// Categories (filter prefix):
//   schema.tables        — every expected public table exists
//   schema.constraints   — UNIQUE / PK / FK / CHECK / NOT NULL shapes
//   schema.indexes       — required indexes, BRIN/Btree sanity, no-unused
//   schema.realtime      — realtime publication membership
//   schema.sync          — supabase_id + updated_at + LWW invariants
//   schema.dupes         — natural-key duplicate row sweep
//   schema.contracts     — payload-shape ↔ table column parity (PostgREST drop catch)
//   schema.rls           — every policy reads app_metadata (not user_metadata)
//   schema.pg17          — extensions + autovacuum + transaction_timeout
//   schema.scale         — spine row size + count assumptions
//   schema.vertical.*    — vertical-specific schema (carniceria, mechanic, …)
//   schema.fresh_install — local SQLite (virgin) ↔ Supabase parity
//
// Filter usage: --filter=schema.rls or --filter=/schema\.(rls|sync)/
//
import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
dotenv.config({ path: path.resolve(ROOT, '.env') })

const { createHarness } = await import('../lib/audit-harness.js')

const argv = process.argv.slice(2)
const arg = (k) => { const m = argv.find(a => a.startsWith(`--${k}=`)); return m ? m.split('=')[1] : undefined }

// ─── Inventory: every synced table the codebase expects in Supabase ─────────
// Pulled from electron/sync.js PULL_TABLES names. Names below are the
// SUPABASE table name (so the 'users' descriptor maps to 'staff'). Includes
// every table that ships rows through bidirectional sync.
const SYNCED_TABLES = [
  'services','clients','inventory_items','ncf_sequences','empleados',
  'categorias_servicio','mesas','modificadores','vehicles','service_bays',
  'stylist_schedules','vehicle_inventory','sales_deals','leads','test_drives',
  'vehicle_documents','vehicle_titulo','vehicle_reservations','bank_preapprovals',
  'vehicle_warranties','staff','activity_log','journal_entries',
  'service_modificadores','service_recipe_items','ofertas','oferta_items',
  'tickets','work_orders','appointments','loans','ticket_items',
  'ticket_item_modificadores','kds_events','restaurant_reservations','queue',
  'washer_commissions','seller_commissions','cajero_commissions',
  'mechanic_commissions','credit_payments','cuadre_caja','caja_chica',
  'notas_credito','inventory_transactions','inventory_oversells','compras_607',
  'adelantos','payroll_runs','salary_changes','ecf_submissions','ecf_queue',
  'queue_deletions','memberships','client_memberships','membership_redemptions',
  'appointment_reminders','wash_combos','subscriptions','service_packages',
  'projects','client_service_rates','client_item_prices','loyalty_transactions',
  'loan_payments','pawn_items','loan_schedule','collections_log',
  'inventory_counts','inventory_count_items','app_settings',
  'carniceria_corte_categories','inventory_freshness_log','inventory_discards',
  'recurring_orders','carniceria_scales','promotions','promotion_items',
  'aseguradoras','suppliers','parts_orders','work_order_photos',
  'insurance_batches',
  'accounting_clients','accounting_inbox','accounting_obligations_calendar',
  'accounting_documents','accounting_billing_plans','accounting_billing_invoices',
  'accounting_csv_mappings','accounting_chart_of_accounts',
  'accounting_journal_entries','accounting_journal_lines',
  'accounting_coa_auto_post_rules','accounting_bank_accounts',
  'accounting_bank_statement_lines','accounting_fixed_assets',
  'accounting_retentions_emitidas','accounting_retentions_recibidas',
  'accounting_payroll_periods','accounting_payroll_lines',
  'accounting_tss_filings','accounting_tasks','accounting_foreign_payments',
]

// Tables that should be in the supabase_realtime publication (hot multi-device).
const REALTIME_REQUIRED = [
  'tickets','ticket_items','mesas','kds_events','queue',
  'inventory_items','services','ofertas','oferta_items','ncf_sequences',
]

// Natural-key dupe candidates — same as scripts/dupe-audit-targeted.mjs.
const DUPE_CANDIDATES = [
  { table: 'services',           cols: ['business_id','name'] },
  { table: 'empleados',          cols: ['business_id','cedula'] },
  { table: 'inventory_items',    cols: ['business_id','sku'] },
  { table: 'promotions',         cols: ['business_id','name'] },
  // 2026-05-19 — resolved decisions for the 5 deferred tables
  // (migration `2026_05_19_deferred_unique_constraints.sql`):
  //   modificadores → COVERED by uq_modificadores_natural unique INDEX on
  //     (business_id, name, group_name). group_name is the legacy text col,
  //     equivalent in practice to modifier_group_supabase_id (every row has
  //     both, modifiers don't migrate between groups). Live data confirms 0
  //     dupes on EITHER shape — no second redundant index added.
  //   service_packages → SKIPPED. Per-client purchase record. Repeat
  //     purchases of the same package_name by the same client are legal.
  //     No natural key beyond (business_id, supabase_id).
  //   wash_combos → SKIPPED. Same per-purchase shape as service_packages.
  //   memberships → TWO partial unique indexes:
  //     uq_memberships_template_natural ON (business_id, plan_name)
  //       WHERE active_template = true AND client_supabase_id IS NULL
  //     uq_memberships_active_client_plan ON
  //       (business_id, client_supabase_id, plan_name)
  //       WHERE status='active' AND client_supabase_id IS NOT NULL
  //   recurring_orders → uq_recurring_orders_biz_client_nombre UNIQUE
  //     (business_id, client_supabase_id, nombre). All NOT NULL, no partial.
  //
  // `where` (optional) — partial-index predicate. When present the dupes
  // sweep gets the same WHERE clause and the constraints scenario also
  // accepts a unique INDEX (with matching WHERE) rather than requiring a
  // full UNIQUE CONSTRAINT (which can't be partial in Postgres).
  { table: 'modificadores',      cols: ['business_id','name','group_name'] },
  { table: 'recurring_orders',   cols: ['business_id','client_supabase_id','nombre'] },
  { table: 'memberships',        cols: ['business_id','plan_name'],
    where: 'active_template = true AND client_supabase_id IS NULL',
    label: 'template' },
  { table: 'memberships',        cols: ['business_id','client_supabase_id','plan_name'],
    where: "status = 'active' AND client_supabase_id IS NOT NULL",
    label: 'active_client' },
  // service_packages + wash_combos intentionally absent — per-purchase
  // tables with no natural-key dedup expected. See migration for reasoning.
  { table: 'ncf_sequences',      cols: ['business_id','type'] },
  { table: 'categorias_servicio',cols: ['business_id','nombre'] },
  { table: 'vehicle_inventory',  cols: ['business_id','vin'] },
  { table: 'staff',              cols: ['business_id','auth_user_id'] },
  { table: 'payroll_settings',   cols: ['business_id'] },
  { table: 'app_settings',       cols: ['business_id','key'] },
  { table: 'mesas',              cols: ['business_id','name'] },
  { table: 'aseguradoras',       cols: ['business_id','rnc'] },
  { table: 'suppliers',          cols: ['business_id','rnc'] },
  { table: 'service_bays',       cols: ['business_id','name'] },
  { table: 'modifier_groups',    cols: ['business_id','name'] },
  { table: 'stylist_schedules',  cols: ['business_id','empleado_supabase_id','day_of_week'] },
  { table: 'service_recipe_items', cols: ['business_id','service_supabase_id','inventory_item_supabase_id'] },
  { table: 'salary_changes',     cols: ['business_id','empleado_supabase_id','effective_date'] },
]

// Expected PG extensions (verified live).
const REQUIRED_EXTENSIONS = ['pgcrypto','uuid-ossp','pg_cron','pg_stat_statements']

// Spine scaling assumptions (per project_journal_entries_spine memory).
const SPINE_MAX_ROWS_PER_SALE = 4 // 1 header + 3 lines avg, ≤4 tolerable
const SPINE_TARGET_TIER_ROWS = 50_000_000 // Pro/Micro headroom

// Vertical-specific schema fingerprints (live verification).
const VERTICAL_SCHEMA = {
  carniceria: {
    tables: ['carniceria_corte_categories','inventory_freshness_log','inventory_discards','recurring_orders','carniceria_scales','promotions','promotion_items'],
    columns: {
      inventory_items: ['sold_by_weight','prepacked','expires_at','received_at','price_per_unit','unit','corte_category_supabase_id'],
      inventory_discards: ['is_post_sale','related_ticket_supabase_id','e33_encf'],
      ticket_items: ['preparation_notes'],
    },
  },
  mechanic: {
    tables: ['work_orders','work_order_items','parts_orders','suppliers','mechanic_commissions','work_order_photos'],
    constraints: [
      'parts_orders_supplier_supabase_fk',
      'mechanic_commissions_business_supabase_uk',
      'mechanic_commissions_wo_tech_uk',
    ],
    columns: {
      empleados: { present: ['comision_pct'], absent: ['commission_pct'] },
    },
  },
  concesionario: {
    tables: ['vehicle_inventory','sales_deals','leads','test_drives','vehicle_documents','vehicle_titulo','vehicle_reservations','bank_preapprovals','vehicle_warranties'],
  },
  restaurant: {
    tables: ['mesas','kds_events','restaurant_reservations','service_recipe_items','modificadores','modifier_groups','ticket_item_modificadores'],
  },
  salon: {
    tables: ['appointments','stylist_schedules','memberships','client_memberships','membership_redemptions','appointment_reminders'],
  },
  accounting: {
    tables: ['accounting_clients','accounting_chart_of_accounts','accounting_journal_entries','accounting_journal_lines','accounting_billing_plans','accounting_billing_invoices'],
  },
}

// ─── Harness boot ───────────────────────────────────────────────────────────
const h = createHarness({
  name: 'schema-suite',
  supabaseUrl: process.env.SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  anonKey: process.env.SUPABASE_ANON_KEY,
  accessToken: process.env.SUPABASE_ACCESS_TOKEN,
  jsonOutput: (process.env.JSON === 'true' || process.env.JSON === '1'),
  filter: arg('filter'),
  only: arg('only'),
  parallel: Number(arg('parallel') || 1),
  failFast: false,
  scenarioTimeoutMs: 45_000,
})

// Shared caches — eager bulk-prefetched so we don't hit Management API
// throttle (429 ThrottlerException). One query per category, not per scenario.
const cache = {
  pubTables: null,
  policies: null,
  uniques: null,
  indexes: null,
  extensions: null,
  triggers: null,
  realtimePub: null,
  rls: null,
  columnsByTable: null, // Map<table, [{column_name, data_type, is_nullable, udt_name}]>
  constraintsByName: null,
  rolesConfig: null,
  procNames: null,
  reloptions: null,
  classApprox: null,
}

async function prefetch(pgQuery) {
  if (cache.pubTables) return
  // Serial — Management API throttles around 10 req/sec; 13 parallel = 429.
  const queries = [
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`,
    `SELECT schemaname, tablename, policyname, qual, with_check FROM pg_policies WHERE schemaname='public'`,
    `SELECT c.relname AS table_name, con.conname, pg_get_constraintdef(con.oid) AS def FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND con.contype IN ('u','p')`,
    `SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public'`,
    `SELECT extname, extversion FROM pg_extension`,
    `SELECT event_object_table AS table_name, trigger_name, action_timing, event_manipulation FROM information_schema.triggers WHERE trigger_schema='public'`,
    `SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname='supabase_realtime'`,
    `SELECT table_name, column_name, data_type, is_nullable, udt_name, ordinal_position FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position`,
    `SELECT c.relname AS table_name, c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'`,
    `SELECT rolname, rolconfig FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')`,
    `SELECT proname FROM pg_proc WHERE pronamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')`,
    `SELECT c.relname AS table_name, c.reloptions FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'`,
    `SELECT c.relname AS table_name, c.reltuples::bigint AS approx, pg_total_relation_size(c.oid) AS bytes FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'`,
  ]
  const results = []
  for (const q of queries) results.push(await pgQuery(q))
  const [pubTables, policies, uniques, indexes, extensions, triggers, realtimePub, columns, rls, rolesConfig, procNames, reloptions, classApprox] = results
  cache.pubTables = pubTables
  cache.policies = policies
  cache.uniques = uniques
  cache.indexes = indexes
  cache.extensions = extensions
  cache.triggers = triggers
  cache.realtimePub = realtimePub
  cache.rls = rls
  cache.rolesConfig = rolesConfig
  cache.procNames = procNames
  cache.reloptions = reloptions
  cache.classApprox = classApprox
  const colsMap = new Map()
  for (const row of columns) {
    if (!colsMap.has(row.table_name)) colsMap.set(row.table_name, [])
    colsMap.get(row.table_name).push(row)
  }
  cache.columnsByTable = colsMap
}

function getPublicTables() { return cache.pubTables || [] }
function getPolicies() { return cache.policies || [] }
function getUniques() { return cache.uniques || [] }
function getIndexes() { return cache.indexes || [] }
function getExtensions() { return cache.extensions || [] }
function getTriggers() { return cache.triggers || [] }
function getRealtimePub() { return cache.realtimePub || [] }
function getColumns(table) { return cache.columnsByTable?.get(table) || [] }
function getRls(table) { return (cache.rls || []).find(r => r.table_name === table)?.rls }
function hasProc(name) { return (cache.procNames || []).some(r => r.proname === name) }
function getReloptions(table) { return (cache.reloptions || []).find(r => r.table_name === table)?.reloptions }
function getApprox(table) { return (cache.classApprox || []).find(r => r.table_name === table) }
function getRolesConfig() { return cache.rolesConfig || [] }

// Prefetch hook — first scenario to run triggers the bulk fetch.
async function ensurePrefetch(ctx) { await prefetch(ctx.pgQuery) }

// ─── schema.tables.* — every synced table exists ────────────────────────────
for (const t of SYNCED_TABLES) {
  h.scenario(`schema.tables.${t}.exists`, async (ctx) => {
    const tbls = getPublicTables()
    const hit = tbls.some(r => r.table_name === t)
    ctx.assert(hit, `table "${t}" missing from public schema — verify: SELECT 1 FROM information_schema.tables WHERE table_name='${t}'`)
  })
}

// ─── schema.sync.supabase_id.* — every synced table has supabase_id UUID UNIQUE
for (const t of SYNCED_TABLES) {
  // staff has supabase_id; users is the view. journal_entries is append-only no supabase_id.
  if (t === 'journal_entries') continue
  h.scenario(`schema.sync.supabase_id.${t}`, async (ctx) => {
    const cols = getColumns(t)
    if (!cols.length) return ctx.skip(`table ${t} not present`)
    const sid = cols.find(c => c.column_name === 'supabase_id')
    ctx.assertNotNull(sid, `${t}.supabase_id missing — verify: SELECT column_name FROM information_schema.columns WHERE table_name='${t}' AND column_name='supabase_id'`)
    ctx.assert(sid.udt_name === 'uuid', `${t}.supabase_id must be UUID, got ${sid.udt_name}`)
    const uniques = getUniques()
    const hasUq = uniques.some(u => u.table_name === t && /\bsupabase_id\b/.test(u.def))
    ctx.assert(hasUq, `${t} missing UNIQUE on supabase_id — verify: SELECT conname,pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.${t}'::regclass AND contype IN ('u','p')`)
  })
}

// ─── schema.sync.updated_at.* — every synced table has updated_at + trigger ─
for (const t of SYNCED_TABLES) {
  if (t === 'activity_log' || t === 'journal_entries') continue // append-only
  h.scenario(`schema.sync.updated_at.${t}`, async (ctx) => {
    const cols = getColumns(t)
    if (!cols.length) return ctx.skip(`table ${t} not present`)
    const ua = cols.find(c => c.column_name === 'updated_at')
    ctx.assertNotNull(ua, `${t}.updated_at column required for LWW sync — verify: SELECT column_name FROM information_schema.columns WHERE table_name='${t}' AND column_name='updated_at'`)
  })
}

// ─── schema.sync.lww.* — updated_at is timestamptz (ISO-comparable) ─────────
for (const t of SYNCED_TABLES) {
  if (t === 'activity_log' || t === 'journal_entries') continue
  h.scenario(`schema.sync.lww.${t}.tz`, async (ctx) => {
    const cols = getColumns(t)
    if (!cols.length) return ctx.skip(`table ${t} not present`)
    const ua = cols.find(c => c.column_name === 'updated_at')
    if (!ua) return ctx.skip('no updated_at column')
    ctx.assert(/timestamp/i.test(ua.data_type), `${t}.updated_at must be timestamp/timestamptz, got ${ua.data_type} — LWW comparison breaks on space-fmt vs ISO mix unless tz-aware`)
  })
}

// ─── schema.constraints.* — every dupe-candidate has UNIQUE coverage ────────
// Dual-coverage pattern (mirrors stress-suite commit 4cd3a44): accept EITHER
// a UNIQUE constraint (pg_constraint) OR a UNIQUE INDEX (pg_indexes), since
// partial unique indexes (Postgres can't represent these as constraints) are
// equally enforcing at INSERT.
for (const c of DUPE_CANDIDATES) {
  const suffix = c.label || c.cols.slice(-1)[0]
  h.scenario(`schema.constraints.${c.table}.unique_${suffix}`, async (ctx) => {
    const tbls = getPublicTables()
    if (!tbls.some(r => r.table_name === c.table)) return ctx.skip(`table ${c.table} missing`)
    const matchCols = (def) => c.cols.every(col => new RegExp(`\\b${col}\\b`).test(def))
    // Partial-index case: also require the WHERE predicate to appear in indexdef.
    // Postgres re-prints indexdef with normalized parens/casing/operator order
    // (e.g. `((active_template = true) AND (client_supabase_id IS NULL))`), so
    // we tokenize the candidate WHERE on AND/OR and check each fragment as a
    // substring after collapsing whitespace + lowercasing.
    const matchWhere = (def) => {
      if (!c.where) return true
      const norm = (s) => String(s).toLowerCase().replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim()
      const haystack = norm(def)
      const fragments = String(c.where).split(/\s+and\s+|\s+or\s+/i).map(norm).filter(Boolean)
      return fragments.every(f => haystack.includes(f))
    }
    const uniqueConstraints = getUniques()
      .filter(u => u.table_name === c.table)
      .filter(u => matchCols(u.def))
    const uniqueIndexes = getIndexes()
      .filter(i => i.tablename === c.table && /unique/i.test(i.indexdef))
      .filter(i => matchCols(i.indexdef) && matchWhere(i.indexdef))
    // Partial indexes can't be expressed as constraints — only count indexes for those.
    const covered = c.where ? uniqueIndexes.length > 0 : (uniqueConstraints.length + uniqueIndexes.length) > 0
    ctx.assert(covered, `${c.table} lacks UNIQUE on (${c.cols.join(',')})${c.where ? ` WHERE ${c.where}` : ''} — verify: SELECT conname,pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.${c.table}'::regclass AND contype='u'; SELECT indexname,indexdef FROM pg_indexes WHERE tablename='${c.table}' AND indexdef ILIKE '%UNIQUE%'`)
  })
}

// ─── schema.dupes.* — natural-key duplicate row sweep ───────────────────────
for (const c of DUPE_CANDIDATES) {
  const suffix = c.label || c.cols.slice(-1)[0]
  h.scenario(`schema.dupes.${c.table}.${suffix}`, async (ctx) => {
    const tbls = getPublicTables()
    if (!tbls.some(r => r.table_name === c.table)) return ctx.skip(`table ${c.table} missing`)
    // Confirm cols present (from prefetch cache, no extra query).
    const allCols = c.cols
    const tableColNames = new Set(getColumns(c.table).map(x => x.column_name))
    if (!allCols.every(x => tableColNames.has(x))) return ctx.skip(`columns missing on ${c.table}`)
    // 2026-05-19 — app_settings has per-device scoping; the real natural key is
    // (business_id, key, device_hwid). A row with device_hwid=null is the
    // business-wide value; a row with a non-null hwid is a terminal-local
    // override. Both can legitimately coexist. Enforced by the partial unique
    // indexes uq_app_settings_biz_key_device + uq_app_settings_biz_key_global.
    const expandedCols = (c.table === 'app_settings' && tableColNames.has('device_hwid'))
      ? [...allCols, `COALESCE(device_hwid, '<global>')`]
      : allCols
    // Compose WHERE: NOT-NULL guard on every key column AND, when the
    // candidate is partial-index-scoped, the candidate's WHERE predicate.
    const notNullWhere = allCols.map(col => `${col} IS NOT NULL`).join(' AND ')
    const where = c.where ? `(${notNullWhere}) AND (${c.where})` : notNullWhere
    const groupBy = expandedCols.join(', ')
    const sql = `SELECT count(*) AS dupe_groups, COALESCE(SUM(cnt-1),0) AS extra FROM (SELECT ${groupBy}, count(*) AS cnt FROM public.${c.table} WHERE ${where} GROUP BY ${groupBy} HAVING count(*)>1) g`
    const r = await ctx.pgQuery(sql)
    const extra = Number(r[0]?.extra || 0)
    ctx.assertEq(extra, 0, `${c.table} has ${extra} extra rows duplicating natural key (${expandedCols.join(',')}) — verify: ${sql}`)
  })
}

// ─── schema.realtime.* — hot tables must be in supabase_realtime publication
for (const t of REALTIME_REQUIRED) {
  h.scenario(`schema.realtime.${t}`, async (ctx) => {
    const pub = getRealtimePub()
    const hit = pub.some(r => r.tablename === t)
    ctx.assert(hit, `${t} missing from supabase_realtime publication — verify: SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='${t}'`)
  })
}

// ─── schema.rls.* — every policy reads app_metadata, not user_metadata ──────
h.scenario('schema.rls.no_user_metadata_refs', async (ctx) => {
  const pols = getPolicies()
  const offenders = pols.filter(p => /user_metadata/.test(p.qual || '') || /user_metadata/.test(p.with_check || ''))
  ctx.assertEq(offenders.length, 0, `${offenders.length} policies still reference user_metadata (client-modifiable claim) — verify: SELECT tablename,policyname FROM pg_policies WHERE schemaname='public' AND (qual LIKE '%user_metadata%' OR with_check LIKE '%user_metadata%')`)
})

h.scenario('schema.rls.uses_app_metadata', async (ctx) => {
  const pols = getPolicies()
  const tenantPols = pols.filter(p => /business_id/.test(p.qual || '') || /business_id/.test(p.with_check || ''))
  ctx.assert(tenantPols.length > 50, `Only ${tenantPols.length} business_id-scoped policies seen — expected >50; suggests massive RLS regression`)
  const appMetaPols = tenantPols.filter(p => /app_metadata/.test(p.qual || '') || /app_metadata/.test(p.with_check || ''))
  ctx.assert(appMetaPols.length >= tenantPols.length * 0.5, `Only ${appMetaPols.length}/${tenantPols.length} tenant policies use app_metadata path`)
})

h.scenario('schema.rls.no_top_level_jwt_claim_typo', async (ctx) => {
  // project_rls_jwt_claim_fix_20260503 — top-level current_setting('request.jwt.claims')::jsonb ->> 'business_id'
  // returns NULL because business_id lives under app_metadata only.
  const pols = getPolicies()
  const offenders = pols.filter(p => {
    const q = (p.qual || '') + (p.with_check || '')
    return /request\.jwt\.claims['"]\s*\)\s*::jsonb\s*->>\s*'business_id'/.test(q)
  })
  ctx.assertEq(offenders.length, 0, `${offenders.length} policies still use top-level claim path — verify: SELECT tablename,policyname,qual FROM pg_policies WHERE schemaname='public'`)
})

// Per-table RLS-enabled check on synced tables.
for (const t of SYNCED_TABLES) {
  h.scenario(`schema.rls.${t}.has_policy`, async (ctx) => {
    const tbls = getPublicTables()
    if (!tbls.some(r => r.table_name === t)) return ctx.skip(`table ${t} missing`)
    if (!getRls(t)) return ctx.skip(`${t} has RLS disabled (service-role-only)`)
    const pols = getPolicies()
    const tablePols = pols.filter(p => p.tablename === t)
    ctx.assert(tablePols.length > 0, `${t} has RLS enabled but ZERO policies — anon/authed reads will 42501-reject. Verify: SELECT policyname FROM pg_policies WHERE tablename='${t}'`)
  })
}

// ─── schema.contracts.* — payload-shape parity for hot tables ──────────────
// Critical columns sync.js push descriptors expect to exist in Supabase.
// 2026-05-19 — Real column names confirmed against information_schema.
//   tickets.doc_number   (was 'ticket_number' — wrong)
//   ticket_items.quantity (was 'qty'         — wrong)
//   journal_entries has NO entry_type/amount — it's a double-entry ledger
//     using account + debit + credit + currency (CLAUDE.md hard rule §20).
const SYNC_PUSH_CONTRACTS = {
  services: ['name','category','price','cost','aplica_itbis','active','supabase_id','updated_at'],
  clients: ['name','rnc','phone','email','balance','supabase_id','updated_at'],
  inventory_items: ['name','sku','barcode','price','cost','quantity','supabase_id','updated_at'],
  tickets: ['business_id','doc_number','total','status','supabase_id','updated_at','rev'],
  ticket_items: ['ticket_id','ticket_supabase_id','service_id','service_supabase_id','price','quantity','itbis','supabase_id','updated_at'],
  mesas: ['name','status','rev','supabase_id','updated_at'],
  ncf_sequences: ['type','current_number','active','enabled','supabase_id','updated_at'],
  empleados: ['nombre','cedula','role','active','supabase_id','updated_at'],
  journal_entries: ['business_id','account','debit','credit','currency','supabase_id','created_at'],
}
for (const [t, requiredCols] of Object.entries(SYNC_PUSH_CONTRACTS)) {
  h.scenario(`schema.contracts.${t}`, async (ctx) => {
    const cols = getColumns(t)
    if (!cols.length) return ctx.skip(`${t} missing`)
    const have = new Set(cols.map(c => c.column_name))
    const missing = requiredCols.filter(c => !have.has(c))
    ctx.assertEq(missing.length, 0, `${t} missing sync-payload columns: ${missing.join(',')} — PostgREST will silently drop them. Verify: SELECT column_name FROM information_schema.columns WHERE table_name='${t}'`)
  })
}

// ─── schema.fk.* — dual-key FK columns present where expected ──────────────
const FK_PAIR_TABLES = [
  ['ticket_items', 'ticket_supabase_id'],
  ['ticket_items', 'service_supabase_id'],
  // credit_payments stores ticket linkage as an ARRAY (ticket_ids) not a
  // singular FK — one payment can settle multiple tickets (partial credit
  // settlement). Excluded from the dual-key pattern. client_supabase_id
  // remains the singular FK we DO expect.
  ['credit_payments', 'client_supabase_id'],
  ['washer_commissions', 'ticket_supabase_id'],
  ['seller_commissions', 'ticket_supabase_id'],
  ['cajero_commissions', 'ticket_supabase_id'],
  ['mechanic_commissions', 'work_order_supabase_id'],
  ['notas_credito', 'original_ticket_supabase_id'],
  ['inventory_freshness_log', 'inventory_item_supabase_id'],
  ['recurring_orders', 'client_supabase_id'],
  ['oferta_items', 'oferta_supabase_id'],
  ['service_recipe_items', 'service_supabase_id'],
  ['service_recipe_items', 'inventory_item_supabase_id'],
  ['ticket_item_modificadores', 'ticket_item_supabase_id'],
]
for (const [t, fkCol] of FK_PAIR_TABLES) {
  h.scenario(`schema.fk.${t}.${fkCol}`, async (ctx) => {
    const cols = getColumns(t)
    if (!cols.length) return ctx.skip(`${t} missing`)
    const hit = cols.find(c => c.column_name === fkCol)
    ctx.assertNotNull(hit, `${t}.${fkCol} missing — sync.pull INSERT will explode on NOT NULL or fall back to integer ID lookup`)
    ctx.assert(hit.udt_name === 'uuid', `${t}.${fkCol} must be UUID, got ${hit.udt_name}`)
  })
}

// ─── schema.indexes.* — every supabase_id has a covering index ─────────────
const INDEX_REQUIRED_TABLES = ['tickets','ticket_items','clients','services','inventory_items','empleados','mesas','journal_entries','vehicle_inventory','sales_deals','work_orders','appointments']
for (const t of INDEX_REQUIRED_TABLES) {
  h.scenario(`schema.indexes.${t}.business_id`, async (ctx) => {
    const tbls = getPublicTables()
    if (!tbls.some(r => r.table_name === t)) return ctx.skip(`${t} missing`)
    const idx = getIndexes()
    const tableIdx = idx.filter(i => i.tablename === t)
    const hasBusinessIdx = tableIdx.some(i => /\bbusiness_id\b/.test(i.indexdef))
    ctx.assert(hasBusinessIdx, `${t} missing index on business_id — every multi-tenant scan will seq-scan. Verify: SELECT indexname,indexdef FROM pg_indexes WHERE tablename='${t}'`)
  })
}

// Spine: BRIN→Btree swap on created_at (v2.16.8 PG17 sprint).
h.scenario('schema.indexes.journal_entries.created_at_btree', async (ctx) => {
  const tbls = getPublicTables()
  if (!tbls.some(r => r.table_name === 'journal_entries')) return ctx.skip('journal_entries not present')
  const idx = getIndexes()
  const created = idx.filter(i => i.tablename === 'journal_entries' && /created_at/.test(i.indexdef))
  ctx.assert(created.length > 0, 'journal_entries.created_at unindexed — spine reads will scan')
  const hasBtree = created.some(i => /USING\s+btree/i.test(i.indexdef))
  ctx.assert(hasBtree, `journal_entries.created_at needs a Btree index (BRIN→Btree swap from v2.16.8). Verify: SELECT indexdef FROM pg_indexes WHERE tablename='journal_entries' AND indexdef LIKE '%created_at%'`)
})

// ─── schema.pg17.* — extensions + autovacuum ──────────────────────────────
for (const ext of REQUIRED_EXTENSIONS) {
  h.scenario(`schema.pg17.ext.${ext}`, async (ctx) => {
    const exts = getExtensions()
    ctx.assert(exts.some(e => e.extname === ext), `Extension ${ext} not enabled — verify: SELECT extname FROM pg_extension WHERE extname='${ext}'`)
  })
}

h.scenario('schema.pg17.version', async (ctx) => {
  const v = await ctx.pgQuery(`SELECT current_setting('server_version_num')::int AS n`)
  const n = Number(v[0]?.n || 0)
  ctx.assert(n >= 170000, `Postgres major < 17 (current ${n}). PG17 optimizations rely on this.`)
})

h.scenario('schema.pg17.tickets_autovacuum_tuned', async (ctx) => {
  const opts = (getReloptions('tickets') || []).join(',')
  // We don't enforce specific values; just that autovacuum has been touched on
  // hot tables. Empty reloptions on a 1M-row table is suspicious.
  if (!opts) return ctx.skip('tickets has no reloptions yet — informational, run v2.16.8 sprint script')
  ctx.assert(/autovacuum/i.test(opts), `tickets reloptions present but no autovacuum tuning — verify: SELECT reloptions FROM pg_class WHERE relname='tickets'`)
})

h.scenario('schema.pg17.transaction_timeout_set', async (ctx) => {
  const r = getRolesConfig()
  const offenders = r.filter(row => {
    const cfg = (row.rolconfig || []).join(',')
    return row.rolname !== 'service_role' && !/transaction_timeout/i.test(cfg)
  })
  if (offenders.length === r.length) return ctx.skip('no per-role transaction_timeout yet — informational')
  ctx.assert(offenders.length === 0, `Roles without transaction_timeout: ${offenders.map(o => o.rolname).join(',')}`)
})

// ─── schema.scale.* — spine row-volume assumption ─────────────────────────
h.scenario('schema.scale.journal_entries.row_count', async (ctx) => {
  const approx = getApprox('journal_entries')
  const n = Number(approx?.approx || 0)
  ctx.assert(n < SPINE_TARGET_TIER_ROWS, `journal_entries approx ${n} rows exceeds Pro/Micro headroom (${SPINE_TARGET_TIER_ROWS}). Tier upgrade pending — verify: SELECT count(*) FROM journal_entries`)
})

h.scenario('schema.scale.journal_entries.rows_per_ticket', async (ctx) => {
  const r = await ctx.pgQuery(`WITH t AS (SELECT (SELECT count(*) FROM tickets WHERE created_at > now() - interval '30 days') AS tk, (SELECT count(*) FROM journal_entries WHERE created_at > now() - interval '30 days') AS je) SELECT tk, je FROM t`)
  const tk = Number(r[0]?.tk || 0)
  const je = Number(r[0]?.je || 0)
  if (tk < 10) return ctx.skip(`only ${tk} tickets in last 30d — insufficient sample`)
  const ratio = je / tk
  ctx.assert(ratio < SPINE_MAX_ROWS_PER_SALE * 4, `journal_entries ${ratio.toFixed(1)} rows/ticket exceeds ${SPINE_MAX_ROWS_PER_SALE * 4} — write amplification regression`)
})

h.scenario('schema.scale.top_table_size_caps', async (ctx) => {
  const huge = (cache.classApprox || []).filter(row => Number(row.bytes) > 5_000_000_000)
  ctx.assertEq(huge.length, 0, `Tables exceeding 5GB: ${huge.map(h => h.table_name + ':' + (Number(h.bytes)/1e9).toFixed(1) + 'GB').join(', ')} — partition or archive`)
})

// ─── schema.vertical.* — per-vertical schema fingerprints ──────────────────
for (const [vname, spec] of Object.entries(VERTICAL_SCHEMA)) {
  for (const t of spec.tables || []) {
    h.scenario(`schema.vertical.${vname}.tables.${t}`, async (ctx) => {
      const tbls = getPublicTables()
      ctx.assert(tbls.some(r => r.table_name === t), `${vname} vertical missing table ${t}`)
    })
  }
  for (const [tbl, cols] of Object.entries(spec.columns || {})) {
    if (Array.isArray(cols)) {
      h.scenario(`schema.vertical.${vname}.cols.${tbl}`, async (ctx) => {
        const have = (getColumns(tbl)).map(c => c.column_name)
        const missing = cols.filter(c => !have.includes(c))
        ctx.assertEq(missing.length, 0, `${tbl} missing ${vname} columns: ${missing.join(',')}`)
      })
    } else {
      // { present:[], absent:[] }
      h.scenario(`schema.vertical.${vname}.cols.${tbl}`, async (ctx) => {
        const have = (getColumns(tbl)).map(c => c.column_name)
        for (const c of cols.present || []) ctx.assert(have.includes(c), `${tbl}.${c} required for ${vname}`)
        for (const c of cols.absent || []) ctx.assert(!have.includes(c), `${tbl}.${c} should NOT exist (legacy column)`)
      })
    }
  }
  for (const conName of spec.constraints || []) {
    h.scenario(`schema.vertical.${vname}.constraint.${conName}`, async (ctx) => {
      const hit = getUniques().some(u => u.conname === conName) || (cache.procNames || []).some(p => p.proname === conName)
      // FKs aren't in our unique-cache; fall through to one targeted live query.
      if (hit) return
      const r = await ctx.pgQuery(`SELECT conname FROM pg_constraint WHERE conname='${conName}'`)
      ctx.assert(r.length > 0, `${vname} constraint ${conName} missing — verify: SELECT conname FROM pg_constraint WHERE conname='${conName}'`)
    })
  }
}

// ─── schema.fresh_install.* — virgin local SQLite ↔ Supabase parity ────────
// Ports the high-value layer of fresh-install-schema-audit.mjs. Parses
// electron/sync.js PULL_TABLES, asserts every supabase column referenced by
// cols[] / fkCols exists in cloud information_schema.
function loadPullTables() {
  const syncJs = fs.readFileSync(path.join(ROOT, 'electron/sync.js'), 'utf8')
  const startIdx = syncJs.indexOf('const PULL_TABLES = [')
  if (startIdx < 0) return []
  let depth = 0, endIdx = -1
  for (let i = startIdx + 'const PULL_TABLES = '.length; i < syncJs.length; i++) {
    const ch = syncJs[i]
    if (ch === '[') depth++
    else if (ch === ']') { depth--; if (depth === 0) { endIdx = i; break } }
  }
  const block = syncJs.slice(startIdx, endIdx + 1)
  const descriptors = []
  let depthBrace = 0, descStart = -1
  for (let i = 0; i < block.length; i++) {
    const ch = block[i]
    if (ch === '{') { if (depthBrace === 0) descStart = i; depthBrace++ }
    else if (ch === '}') {
      depthBrace--
      if (depthBrace === 0 && descStart >= 0) {
        const text = block.slice(descStart, i + 1)
        const nameMatch = text.match(/name:\s*'([^']+)'/)
        if (!nameMatch) { descStart = -1; continue }
        const name = nameMatch[1]
        const supMatch = text.match(/supabaseTable:\s*'([^']+)'/)
        const supabaseTable = supMatch ? supMatch[1] : name
        let cols = []
        const colsIdx = text.indexOf('cols:')
        if (colsIdx >= 0) {
          let bd = 0, cs = -1, ce = -1
          for (let j = colsIdx; j < text.length; j++) {
            if (text[j] === '[') { if (bd === 0) cs = j + 1; bd++ }
            else if (text[j] === ']') { bd--; if (bd === 0) { ce = j; break } }
          }
          if (cs >= 0 && ce > cs) cols = [...text.slice(cs, ce).matchAll(/'([^']+)'/g)].map(x => x[1])
        }
        descriptors.push({ name, supabaseTable, cols })
        descStart = -1
      }
    }
  }
  return descriptors
}

let PULL = []
try { PULL = loadPullTables() } catch { PULL = [] }
const FRESH_SAMPLE = PULL.slice(0, 30) // cap so we don't explode scenario count
for (const d of FRESH_SAMPLE) {
  h.scenario(`schema.fresh_install.${d.supabaseTable}.cols_parity`, async (ctx) => {
    const cloud = getColumns(d.supabaseTable)
    if (!cloud.length) return ctx.skip(`${d.supabaseTable} not in Supabase`)
    const have = new Set(cloud.map(c => c.column_name))
    const missing = (d.cols || []).filter(c => !have.has(c))
    ctx.assertEq(missing.length, 0, `${d.supabaseTable}: sync.js cols[] references ${missing.join(',')} but Supabase lacks them — PostgREST will drop on push. Verify: SELECT column_name FROM information_schema.columns WHERE table_name='${d.supabaseTable}'`)
  })
}

// Also: every PULL descriptor name must exist as a Supabase table.
h.scenario('schema.fresh_install.all_descriptors_have_supabase_table', async (ctx) => {
  const tbls = new Set((getPublicTables()).map(r => r.table_name))
  const missing = PULL.filter(d => !tbls.has(d.supabaseTable)).map(d => d.supabaseTable)
  ctx.assertEq(missing.length, 0, `sync.js PULL descriptors reference missing Supabase tables: ${missing.join(',')}`)
})

// ─── schema.triggers.* — updated_at auto-update triggers ───────────────────
const TRIGGER_REQUIRED_TABLES = ['services','clients','inventory_items','tickets','ticket_items','mesas','empleados']
for (const t of TRIGGER_REQUIRED_TABLES) {
  h.scenario(`schema.triggers.${t}.updated_at`, async (ctx) => {
    const trigs = getTriggers()
    const tableTrigs = trigs.filter(tr => tr.table_name === t)
    const hasUpdatedAt = tableTrigs.some(tr => /updated_at|set_updated|touch/i.test(tr.trigger_name))
    ctx.assert(hasUpdatedAt, `${t} missing updated_at trigger — manual writes won't bump updated_at, LWW sync will keep older value. Verify: SELECT trigger_name FROM information_schema.triggers WHERE event_object_table='${t}'`)
  })
}

// rev guard triggers for mesas + tickets.
for (const t of ['mesas','tickets']) {
  h.scenario(`schema.triggers.${t}.rev_guard`, async (ctx) => {
    const hit = hasProc(`trg_${t}_rev_guard`) || hasProc(`trg_${t.slice(0,-1)}_rev_guard`)
    if (!hit) return ctx.skip(`no rev guard fn for ${t} — informational`)
    ctx.assert(hit, `${t} rev guard function expected — verify: SELECT proname FROM pg_proc WHERE proname LIKE 'trg_${t}%rev_guard'`)
  })
}

// ─── Run ─────────────────────────────────────────────────────────────────────
// Prefetch all pg_catalog data in one parallel burst BEFORE scenarios start
// so per-scenario reads are in-memory map lookups, not 600 HTTP calls that
// trip the Management API throttle (429 ThrottlerException). Replicates the
// "one query per category" pattern from pg17-audit-inspect.mjs.
{
  const projectMatch = (process.env.SUPABASE_URL || '').match(/https?:\/\/([^.]+)\.supabase\.co/)
  if (!projectMatch) { console.error('schema-suite: cannot extract Supabase project ref from SUPABASE_URL'); process.exit(2) }
  const projectRef = projectMatch[1]
  const pgQuery = async (sql, attempt = 0) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    })
    if (r.status === 429 && attempt < 5) {
      const wait = 1500 * (attempt + 1)
      await new Promise(res => setTimeout(res, wait))
      return pgQuery(sql, attempt + 1)
    }
    if (!r.ok) throw new Error(`pgQuery ${r.status}: ${(await r.text()).slice(0, 240)}`)
    const j = await r.json()
    return Array.isArray(j) ? j : []
  }
  const jsonMode = (process.env.JSON === 'true' || process.env.JSON === '1')
  if (!jsonMode) console.log('[schema-suite] prefetching pg_catalog snapshots…')
  const t0 = Date.now()
  await prefetch(pgQuery)
  if (!jsonMode) console.log(`[schema-suite] prefetch complete (${Date.now() - t0}ms)`)
}

const result = await h.run()
process.exit(result.failed > 0 ? 1 : 0)
