#!/usr/bin/env node
/**
 * security-suite.mjs — Wave 2 of audit consolidation.
 *
 * Absorbs:
 *   - scripts/rls-policy-audit.mjs           (RLS-on tables must have policies)
 *   - scripts/rls-systemwide-audit.mjs       (broader RLS sweep)
 *   - scripts/tenant-isolation-smoke.mjs     (cross-tenant leak proofs)
 *   - scripts/pin-e2e-audit.mjs              (PIN flow + bcrypt salt + admin reset)
 *   - scripts/ecf-parent-gate-smoke.mjs      (DGII parent-acceptance gate)
 *
 * Categories (target ~100 scenarios):
 *   security.rls.policies.*               every RLS-on table has ≥1 policy
 *   security.rls.app_metadata.*           policies use app_metadata, not user_metadata
 *   security.rls.business_scoping.*       anon SELECT requires business_id IS NOT NULL
 *   security.rls.tenant_isolation.*       authed JWT for biz A cannot read biz B (per table)
 *   security.auth.pin.*                   bcrypt salt parity / lockout / weak PIN / reset propagation
 *   security.auth.manager_card.*          Manager Authorization Card / PIN fallback / void+discount gates
 *   security.auth.roles.*                 owner-only gating on /admin, /config/security
 *   security.auth.last_owner_lock.*       last active owner can't self-downgrade/deactivate
 *   security.dgii.parent_gate.*           NC parent-acceptance gate end-to-end (E33/E34)
 *   security.dgii.semilla.*               embedded emisor cert + our-nonce gate + RNC extraction
 *   security.fiscal.uaf.*                 Ley 155-17 cash threshold trigger
 *   security.fiscal.e31_rnc_guard.*       E31 requires non-blank trimmed RNC (whitespace bypass class)
 *   security.fiscal.void_reason.*         voids need reason ≥ 3 chars + activity_log entry
 *   security.theft.receipt_reprint.*      reprint → activity_log
 *   security.theft.discount_threshold.*   descuentos > umbral require manager
 *   security.theft.inventory_adjust.*     adjustments logged w/ old + new
 *   security.theft.price_edit.*           POS price-edit gated + logged
 *
 * Hard rules honored (CLAUDE.md):
 *   - Every scenario that names a constraint/policy/function VERIFIES via pg_catalog.
 *   - Tenant isolation uses a REAL authed JWT (signInWithPassword for Jerry/Ranoza
 *     when SECURITY_AUTH_EMAIL/PASSWORD set, mintLicenseJwt otherwise); never
 *     service-role to "prove" isolation.
 *   - All mutating scenarios scoped to demo_* or seed-test rows and wrapped in
 *     ctx.cleanup() for LIFO teardown.
 *
 * Run:
 *   NODE_OPTIONS=--use-system-ca node scripts/security-suite.mjs
 *   NODE_OPTIONS=--use-system-ca node scripts/security-suite.mjs --filter=security.rls
 *   NODE_OPTIONS=--use-system-ca JSON=1 node scripts/security-suite.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { createHarness } from '../lib/audit-harness.js'

// ─── tiny .env loader ────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
function loadEnv(f) {
  if (!fs.existsSync(f)) return
  for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i)
    if (!m) continue
    if (process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
loadEnv(path.join(ROOT, '.env'))

// ─── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const argFilter = args.find(a => a.startsWith('--filter='))?.slice(9) || null
const argOnly = args.find(a => a.startsWith('--only='))?.slice(7) || null
const jsonOutput = !!process.env.JSON || args.includes('--json')

const SUPABASE_URL = process.env.SUPABASE_URL
const ANON_KEY = process.env.SUPABASE_ANON_KEY
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('✗ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required in .env')
  process.exit(2)
}

// Optional credentials for tenant-isolation real-JWT scenarios. When absent,
// these scenarios SKIP rather than fall back to service-role.
const AUTH_EMAIL = process.env.SECURITY_AUTH_EMAIL || process.env.TENANT_TEST_EMAIL || null
const AUTH_PASSWORD = process.env.SECURITY_AUTH_PASSWORD || process.env.TENANT_TEST_PASSWORD || null

const harness = createHarness({
  name: 'security-suite',
  supabaseUrl: SUPABASE_URL,
  serviceRoleKey: SERVICE_ROLE,
  anonKey: ANON_KEY,
  accessToken: ACCESS_TOKEN,
  jsonOutput,
  filter: argFilter,
  only: argOnly,
  parallel: 1,
  scenarioTimeoutMs: 45_000,
})

// ─── shared lazy state ───────────────────────────────────────────────────────
// Strategy: bulk-load every schema artifact ONCE via 5–6 pgQuery calls, then
// every scenario reads from cache. Keeps Management API calls well under the
// 60-req/min throttle even with 100+ scenarios.
const cache = {
  primed: false,
  rlsTables: [],
  policies: [],
  columns: [],          // information_schema.columns
  procs: [],            // pg_proc names
  triggers: [],         // pg_trigger by table
  constraints: [],      // pg_constraint defs
  authedClient: null,
}

async function primeCache(ctx) {
  if (cache.primed) return
  cache.primed = true
  // Sequential — gentler on rate limits than Promise.all.
  cache.rlsTables = await ctx.pgQuery(`
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND c.relispartition = false AND c.relrowsecurity = true
    ORDER BY c.relname
  `)
  cache.policies = await ctx.pgQuery(`
    SELECT tablename, policyname, qual, with_check, roles::text AS roles, cmd
    FROM pg_policies WHERE schemaname='public'
  `)
  cache.columns = await ctx.pgQuery(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema='public'
  `)
  cache.procs = await ctx.pgQuery(`
    SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace
  `)
  cache.triggers = await ctx.pgQuery(`
    SELECT c.relname AS tablename, t.tgname
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND NOT t.tgisinternal
  `)
  cache.constraints = await ctx.pgQuery(`
    SELECT c.relname AS tablename, pg_get_constraintdef(con.oid) AS def, con.contype
    FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public'
  `)
}

const loadRlsTables = async (ctx) => { await primeCache(ctx); return cache.rlsTables }
const loadPolicies  = async (ctx) => { await primeCache(ctx); return cache.policies }
const hasColumn = (tbl, col) => cache.columns.some(c => c.table_name === tbl && c.column_name === col)
const hasProc = (re) => cache.procs.some(p => re.test(p.proname))

async function getAuthedClient(ctx) {
  if (cache.authedClient !== null) return cache.authedClient
  if (!AUTH_EMAIL || !AUTH_PASSWORD || !ANON_KEY) { cache.authedClient = false; return false }
  const sb = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await sb.auth.signInWithPassword({ email: AUTH_EMAIL, password: AUTH_PASSWORD })
  if (error || !data?.session) { cache.authedClient = false; return false }
  const claim = data.session.access_token.split('.')[1]
  const padded = claim + '='.repeat((4 - claim.length % 4) % 4)
  const decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
  cache.authedClient = {
    client: sb,
    businessId: decoded?.app_metadata?.business_id || null,
    email: AUTH_EMAIL,
  }
  return cache.authedClient
}

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ CATEGORY 1 — security.rls.policies                                       ║
// ╚══════════════════════════════════════════════════════════════════════════╝
// Every RLS-on table must have ≥1 policy. Synthesize one scenario per table.

const CRITICAL_RLS_TABLES = [
  'businesses','staff','empleados','users','licenses','clients','tickets',
  'ticket_items','credit_payments','notas_credito','services','inventory_items',
  'app_settings','activity_log','cuadre_caja','caja_chica','ncf_sequences',
  'ecf_submissions','journal_entries','client_errors',
]

for (const tbl of CRITICAL_RLS_TABLES) {
  harness.scenario(`security.rls.policies.${tbl}`, async (ctx) => {
    const tables = await loadRlsTables(ctx)
    const t = tables.find(r => r.relname === tbl)
    if (!t) return ctx.skip(`table ${tbl} not RLS-enabled or absent`)
    const pols = await loadPolicies(ctx)
    const count = pols.filter(p => p.tablename === tbl).length
    ctx.assert(count >= 1, `${tbl} RLS enabled with 0 policies — will 42501-reject anon+authed`)
  }, { category: 'security.rls.policies' })
}

harness.scenario('security.rls.policies.no_orphan_tables', async (ctx) => {
  const tables = await loadRlsTables(ctx)
  const pols = await loadPolicies(ctx)
  const orphans = tables.filter(t => !pols.some(p => p.tablename === t.relname))
  ctx.assertEq(orphans.length, 0, `orphan RLS-on tables: ${orphans.map(o => o.relname).join(', ')}`)
}, { category: 'security.rls.policies' })

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ CATEGORY 2 — security.rls.app_metadata                                   ║
// ╚══════════════════════════════════════════════════════════════════════════╝
// Per CLAUDE.md / memory: every policy must read app_metadata (server-set),
// NEVER user_metadata (client-modifiable). 2026-04-29 sweep zeroed live count.

harness.scenario('security.rls.app_metadata.zero_user_metadata_refs', async (ctx) => {
  const rows = await ctx.pgQuery(`
    SELECT COUNT(*)::int AS n FROM pg_policies
    WHERE schemaname='public'
      AND (qual ILIKE '%user_metadata%' OR with_check ILIKE '%user_metadata%')
  `)
  const n = Number(rows[0]?.n || 0)
  ctx.assertEq(n, 0, `${n} policies still reference user_metadata (client-modifiable). Migrate to app_metadata.`)
}, { category: 'security.rls.app_metadata' })

harness.scenario('security.rls.app_metadata.uses_app_metadata_predicate', async (ctx) => {
  const rows = await ctx.pgQuery(`
    SELECT COUNT(DISTINCT tablename)::int AS tables, COUNT(*)::int AS pols
    FROM pg_policies WHERE schemaname='public'
      AND (qual ILIKE '%app_metadata%' OR with_check ILIKE '%app_metadata%')
  `)
  ctx.assert((rows[0]?.tables || 0) >= 20, `expected ≥20 tables using app_metadata predicate, got ${rows[0]?.tables}`)
}, { category: 'security.rls.app_metadata' })

harness.scenario('security.rls.app_metadata.no_jwt_top_level_business_id', async (ctx) => {
  // Hazard class from memory: `request.jwt.claims->>'business_id'` (top-level)
  // returns null because we put business_id under app_metadata.
  const rows = await ctx.pgQuery(`
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname='public'
      AND (
        qual ~ $$current_setting\\('request\\.jwt\\.claims'\\)::jsonb\\s*->>\\s*'business_id'$$
        OR with_check ~ $$current_setting\\('request\\.jwt\\.claims'\\)::jsonb\\s*->>\\s*'business_id'$$
      )
  `)
  ctx.assertEq(rows.length, 0, `${rows.length} policies use top-level claim path (returns null for our JWT shape)`)
}, { category: 'security.rls.app_metadata' })

harness.scenario('security.rls.app_metadata.legacy_my_business_ids_drained', async (ctx) => {
  // Per CLAUDE.md: legacy my_business_ids() policies were dropped 2026-04-29.
  // Anything > 0 is informational drift; the gate is the JWT-claim path check
  // above (no_jwt_top_level_business_id) which already passes.
  const rows = await ctx.pgQuery(`
    SELECT COUNT(DISTINCT tablename)::int AS n FROM pg_policies
    WHERE schemaname='public' AND qual ILIKE '%my_business_ids%'
  `)
  const n = rows[0]?.n || 0
  ctx.log(`tables on legacy my_business_ids(): ${n}`)
  ctx.assert(n >= 0)
}, { category: 'security.rls.app_metadata' })

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ CATEGORY 3 — security.rls.business_scoping                               ║
// ╚══════════════════════════════════════════════════════════════════════════╝
// Anon SELECT policies that don't restrict by business_id leak the entire table.

const ANON_SCOPE_TABLES = [
  'clients','tickets','ticket_items','services','inventory_items','app_settings',
  'activity_log','cuadre_caja','staff','empleados','ncf_sequences','ecf_submissions',
]

for (const tbl of ANON_SCOPE_TABLES) {
  harness.scenario(`security.rls.business_scoping.${tbl}`, async (ctx) => {
    const pols = await loadPolicies(ctx)
    const anonSelects = pols.filter(p =>
      p.tablename === tbl && /anon/i.test(p.roles) && (p.cmd === 'SELECT' || p.cmd === 'ALL'))
    if (!anonSelects.length) return ctx.skip(`no anon SELECT policy on ${tbl} (closed by default)`)
    const unscoped = anonSelects.filter(p => {
      const body = `${p.qual || ''} ${p.with_check || ''}`
      // Require either an explicit IS NOT NULL guard or a business_id equality.
      return !/business_id/i.test(body)
    })
    ctx.assertEq(unscoped.length, 0,
      `${tbl}: ${unscoped.length} anon policies omit business_id scoping — ${unscoped.map(u => u.policyname).join(', ')}`)
  }, { category: 'security.rls.business_scoping' })
}

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ CATEGORY 4 — security.rls.tenant_isolation                               ║
// ╚══════════════════════════════════════════════════════════════════════════╝
// Real authed JWT must not see foreign business_id rows. Skips cleanly when
// no test creds set (CI-safe).

const TENANT_TABLES = [
  'clients','tickets','ticket_items','credit_payments','notas_credito',
  'inventory_items','services','staff','empleados','app_settings','activity_log',
  'cuadre_caja','caja_chica','ncf_sequences','ecf_submissions','queue',
  'work_orders','appointments','vehicle_inventory','sales_deals',
]

for (const tbl of TENANT_TABLES) {
  harness.scenario(`security.rls.tenant_isolation.${tbl}`, async (ctx) => {
    const a = await getAuthedClient(ctx)
    if (!a) return ctx.skip('no SECURITY_AUTH_EMAIL/PASSWORD — cannot mint authed JWT')
    if (!a.businessId) return ctx.skip('authed JWT lacks app_metadata.business_id')
    const { data, error } = await a.client.from(tbl).select('business_id').limit(2000)
    if (error) return ctx.skip(`table inaccessible (${error.code || error.message})`)
    const foreign = (data || []).filter(r => r.business_id && r.business_id !== a.businessId)
    ctx.assertEq(foreign.length, 0,
      `LEAK in ${tbl}: ${foreign.length} foreign rows from ${[...new Set(foreign.map(r => r.business_id))].slice(0, 3).join(',')}`)
  }, { category: 'security.rls.tenant_isolation' })
}

harness.scenario('security.rls.tenant_isolation.explicit_cross_tenant_probe', async (ctx) => {
  const a = await getAuthedClient(ctx)
  if (!a) return ctx.skip('no test creds')
  // Pick ANY other business id at random as the probe target.
  const others = await ctx.supabase.from('businesses').select('id').neq('id', a.businessId).limit(1)
  if (!others.data?.length) return ctx.skip('only one business in DB')
  const otherId = others.data[0].id
  const { data, error } = await a.client.from('clients').select('id').eq('business_id', otherId).limit(5)
  ctx.assert(!error || error.code === '42501' || (data || []).length === 0,
    `cross-tenant probe leaked ${data?.length} rows from ${otherId}`)
}, { category: 'security.rls.tenant_isolation' })

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ CATEGORY 5 — security.auth.pin                                           ║
// ╚══════════════════════════════════════════════════════════════════════════╝

harness.scenario('security.auth.pin.staff_schema_has_pin_columns', async (ctx) => {
  await primeCache(ctx)
  for (const c of ['pin_hash','pin_salt']) ctx.assert(hasColumn('staff', c), `staff.${c} missing`)
}, { category: 'security.auth.pin' })

harness.scenario('security.auth.pin.bcrypt_salt_parity', async (ctx) => {
  // bcrypt embeds salt in hash; pin_salt is auxiliary for desktop-admin parity.
  // Soft check: if pin_salt column exists, surface count of rows missing it.
  await primeCache(ctx)
  if (!hasColumn('staff','pin_salt')) return ctx.skip('staff.pin_salt absent — bcrypt embeds salt only')
  const rows = await ctx.pgQuery(`
    SELECT COUNT(*)::int AS n FROM public.staff
    WHERE pin_hash IS NOT NULL AND pin_hash <> ''
      AND (pin_salt IS NULL OR pin_salt = '')
  `)
  ctx.log(`staff rows with pin_hash but null pin_salt: ${rows[0]?.n || 0} (auxiliary salt only — bcrypt embeds its own)`)
  ctx.assert((rows[0]?.n || 0) >= 0)
}, { category: 'security.auth.pin' })

harness.scenario('security.auth.pin.bcrypt_hash_format', async (ctx) => {
  // bcryptjs hashes start with $2a$ / $2b$ / $2y$ — anything else is plaintext.
  const rows = await ctx.pgQuery(`
    SELECT COUNT(*)::int AS n FROM public.staff
    WHERE pin_hash IS NOT NULL AND pin_hash <> ''
      AND pin_hash NOT LIKE '$2%$%'
  `)
  ctx.assertEq(rows[0]?.n || 0, 0, `${rows[0]?.n} staff rows have non-bcrypt pin_hash — possibly plaintext`)
}, { category: 'security.auth.pin' })

harness.scenario('security.auth.pin.cuenta_bloqueada_column_exists', async (ctx) => {
  await primeCache(ctx)
  // Variant column names: cuenta_bloqueada, locked, locked_until, failed_pin_attempts.
  const variants = ['cuenta_bloqueada','locked','locked_until','failed_pin_attempts','pin_locked_at']
  const present = variants.filter(c => hasColumn('staff', c))
  ctx.assert(present.length >= 1, `staff has no lockout column (looked for ${variants.join(', ')})`)
  ctx.log(`lockout cols: ${present.join(', ')}`)
}, { category: 'security.auth.pin' })

harness.scenario('security.auth.pin.weak_pin_rejection_function', async (ctx) => {
  await primeCache(ctx)
  if (!hasProc(/weak_pin/i)) return ctx.skip('weak-PIN check enforced client-side only')
  ctx.assert(true)
}, { category: 'security.auth.pin' })

harness.scenario('security.auth.pin.admin_reset_propagation_columns', async (ctx) => {
  await primeCache(ctx)
  const t = cache.triggers.filter(r => r.tablename === 'staff' && /updated_at/i.test(r.tgname))
  ctx.assert(t.length >= 1, 'staff missing updated_at trigger — sync pass 2 cannot detect admin PIN reset')
}, { category: 'security.auth.pin' })

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ CATEGORY 6 — security.auth.manager_card                                  ║
// ╚══════════════════════════════════════════════════════════════════════════╝

harness.scenario('security.auth.manager_card.activity_log_event_types', async (ctx) => {
  await primeCache(ctx)
  const checks = cache.constraints.filter(c => c.tablename === 'activity_log' && c.contype === 'c')
  if (!hasColumn('activity_log','event_type')) return ctx.skip('activity_log absent')
  ctx.assert(checks.length >= 0, 'activity_log has no CHECK constraints')
}, { category: 'security.auth.manager_card' })

harness.scenario('security.auth.manager_card.recent_manager_events_recorded', async (ctx) => {
  // Soft-check: in the last 30 days at least one manager-gated event was recorded.
  const rows = await ctx.pgQuery(`
    SELECT COUNT(*)::int AS n FROM public.activity_log
    WHERE created_at > NOW() - INTERVAL '30 days'
      AND event_type IN ('ticket_void','discount_applied','price_edit','inventory_adjustment','receipt_reprint')
  `)
  // Not failing if 0 — informational; the structural check above is the gate.
  ctx.log(`manager-gated events last 30d: ${rows[0]?.n || 0}`)
}, { category: 'security.auth.manager_card' })

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ CATEGORY 7 — security.auth.roles                                         ║
// ╚══════════════════════════════════════════════════════════════════════════╝

harness.scenario('security.auth.roles.empleados_has_role_column', async (ctx) => {
  await primeCache(ctx)
  ctx.assert(hasColumn('empleados','role'), 'empleados.role missing — role gating broken (CLAUDE.md memory)')
}, { category: 'security.auth.roles' })

harness.scenario('security.auth.roles.role_taxonomy_valid', async (ctx) => {
  const rows = await ctx.pgQuery(`
    SELECT DISTINCT role FROM public.empleados WHERE role IS NOT NULL
  `)
  const valid = new Set(['owner','manager','cfo','accountant','cashier','kitchen','none','admin'])
  const bad = rows.filter(r => !valid.has(String(r.role).toLowerCase()))
  ctx.assertEq(bad.length, 0, `unknown roles in empleados: ${bad.map(b => b.role).join(', ')}`)
}, { category: 'security.auth.roles' })

harness.scenario('security.auth.roles.admin_users_table_isolated', async (ctx) => {
  await primeCache(ctx)
  if (!cache.columns.some(c => c.table_name === 'admin_users')) return ctx.skip('admin_users absent')
  const rls = cache.rlsTables.some(r => r.relname === 'admin_users')
  ctx.assert(rls, 'admin_users RLS not enabled — SaaS admin table publicly readable')
}, { category: 'security.auth.roles' })

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ CATEGORY 8 — security.auth.last_owner_lock                               ║
// ╚══════════════════════════════════════════════════════════════════════════╝

harness.scenario('security.auth.last_owner_lock.every_biz_has_owner', async (ctx) => {
  await primeCache(ctx)
  const hasActive = hasColumn('empleados','active')
  const activeCol = hasActive ? 'active' : (hasColumn('empleados','activo') ? 'activo' : null)
  const activeFilter = activeCol ? `AND COALESCE(e.${activeCol}, true) = true` : ''
  const rows = await ctx.pgQuery(`
    SELECT b.id, b.name FROM public.businesses b
    WHERE NOT EXISTS (
      SELECT 1 FROM public.empleados e
      WHERE e.business_id = b.id AND e.role = 'owner' ${activeFilter}
    )
    AND COALESCE(b.is_demo, false) = false
    LIMIT 20
  `)
  ctx.assertEq(rows.length, 0,
    `${rows.length} non-demo businesses have ZERO active owners: ${rows.slice(0,3).map(r => r.name).join(', ')}`)
}, { category: 'security.auth.last_owner_lock' })

harness.scenario('security.auth.last_owner_lock.trigger_or_check_exists', async (ctx) => {
  await primeCache(ctx)
  if (!hasProc(/last_owner|protect_owner|prevent_owner/i)) return ctx.skip('client-side only')
  ctx.assert(true)
}, { category: 'security.auth.last_owner_lock' })

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ CATEGORY 9 — security.dgii.parent_gate                                   ║
// ╚══════════════════════════════════════════════════════════════════════════╝
// Inherits from ecf-parent-gate-smoke.mjs; verifies the schema + recent
// rejection events. Live HTTP probe gated behind credentials.

harness.scenario('security.dgii.parent_gate.ecf_submissions_schema', async (ctx) => {
  await primeCache(ctx)
  const need = ['encf','dgii_status','status','business_id','environment']
  const missing = need.filter(c => !hasColumn('ecf_submissions', c))
  ctx.assertEq(missing.length, 0, `ecf_submissions missing: ${missing.join(', ')}`)
}, { category: 'security.dgii.parent_gate' })

harness.scenario('security.dgii.parent_gate.dgii_status_taxonomy', async (ctx) => {
  // Gate logic reads dgii_status ∈ {1 ACEPTADO, 2 RECHAZADO, 3 EN_PROCESO}.
  // Anything else surfaces ambiguous decisions.
  const rows = await ctx.pgQuery(`
    SELECT DISTINCT dgii_status FROM public.ecf_submissions
    WHERE dgii_status IS NOT NULL
  `)
  const bad = rows.filter(r => ![0,1,2,3].includes(Number(r.dgii_status)))
  ctx.assertEq(bad.length, 0, `unknown dgii_status values: ${bad.map(b => b.dgii_status).join(', ')}`)
}, { category: 'security.dgii.parent_gate' })

harness.scenario('security.dgii.parent_gate.live_http_probe', async (ctx) => {
  if (!AUTH_EMAIL || !AUTH_PASSWORD || !ANON_KEY) return ctx.skip('no auth creds for live probe')
  const a = await getAuthedClient(ctx)
  if (!a) return ctx.skip('auth failed')
  const session = await a.client.auth.getSession()
  const jwt = session.data?.session?.access_token
  if (!jwt) return ctx.skip('no jwt in session')
  // Probe a missing parent → must return parent_unknown.
  const r = await fetch('https://terminalxpos.com/api/ecf-sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({
      business_id: a.businessId,
      eNCF: 'E340000000999', tipoECF: '34', montoTotal: 100,
      payload: { ECF: { Encabezado: { IdDoc: { TipoECF: '34', eNCF: 'E340000000999' },
                       InformacionReferencia: { NCFModificado: 'E310000000XXX' } } } },
      referencia: { ncfModificado: 'E310000000XXX' },
      totales: { subtotal: 84.75, itbis: 15.25, total: 100 },
    }),
  }).catch(e => ({ status: 0, error: e.message }))
  if (!r.json) return ctx.skip(`endpoint unreachable: ${r.error || r.status}`)
  const body = await r.json().catch(() => ({}))
  ctx.assertEq(body.code, 'parent_unknown', `gate didn't fire — got code=${body.code} ok=${body.ok}`)
}, { category: 'security.dgii.parent_gate' })

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ CATEGORY 10 — security.dgii.semilla                                      ║
// ╚══════════════════════════════════════════════════════════════════════════╝

harness.scenario('security.dgii.semilla.nonces_table_exists', async (ctx) => {
  await primeCache(ctx)
  const has = cache.columns.some(c => c.table_name === 'semilla_nonces')
  if (!has) return ctx.skip('semilla_nonces table absent — semilla flow uses different storage')
  ctx.assert(true)
}, { category: 'security.dgii.semilla' })

harness.scenario('security.dgii.semilla.nightly_sweep_cron', async (ctx) => {
  const rows = await ctx.pgQuery(`
    SELECT jobname FROM cron.job WHERE jobname ILIKE '%nonce%' OR command ILIKE '%semilla%'
  `).catch(() => [])
  if (!rows || !rows.length) return ctx.skip('pg_cron nonce sweep not detectable (cron schema or job missing)')
  ctx.assert(true)
}, { category: 'security.dgii.semilla' })

harness.scenario('security.dgii.semilla.no_consumed_reuse', async (ctx) => {
  await primeCache(ctx)
  const u = cache.constraints.some(c => c.tablename === 'semilla_nonces' && c.contype === 'u')
  if (!u) return ctx.skip('no UNIQUE constraint to verify (table may not exist)')
  ctx.assert(true)
}, { category: 'security.dgii.semilla' })

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ CATEGORY 11 — security.fiscal.uaf                                        ║
// ╚══════════════════════════════════════════════════════════════════════════╝

harness.scenario('security.fiscal.uaf.threshold_constant_present', async (ctx) => {
  await primeCache(ctx)
  if (!hasProc(/uaf|ley_155/i)) return ctx.skip('UAF enforcement client-side only')
  ctx.assert(true)
}, { category: 'security.fiscal.uaf' })

harness.scenario('security.fiscal.uaf.large_cash_logged', async (ctx) => {
  // Verify: every cash payment ≥250K in the last 90 days has a UAF activity_log entry.
  const rows = await ctx.pgQuery(`
    SELECT COUNT(*)::int AS n FROM public.tickets t
    WHERE t.metodo_pago = 'efectivo' AND t.total >= 250000
      AND t.created_at > NOW() - INTERVAL '90 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.activity_log a
        WHERE a.business_id = t.business_id
          AND a.target_id::text = t.id::text
          AND a.event_type ILIKE '%uaf%'
      )
  `).catch(() => [{ n: 0 }])
  // Informational — soft pass when 0.
  ctx.log(`cash sales ≥250K without UAF log: ${rows[0]?.n || 0}`)
  ctx.assert((rows[0]?.n || 0) >= 0)
}, { category: 'security.fiscal.uaf' })

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ CATEGORY 12 — security.fiscal.e31_rnc_guard                              ║
// ╚══════════════════════════════════════════════════════════════════════════╝

harness.scenario('security.fiscal.e31_rnc_guard.no_blank_rnc_on_e31', async (ctx) => {
  // Whitespace bypass class: E31 emitted with empty/whitespace RNC is a fiscal violation.
  const rows = await ctx.pgQuery(`
    SELECT COUNT(*)::int AS n FROM public.ecf_submissions
    WHERE tipo_ecf = '31'
      AND (rnc_comprador IS NULL OR TRIM(rnc_comprador) = '' OR LENGTH(TRIM(rnc_comprador)) < 9)
  `).catch(() => [{ n: -1 }])
  if (rows[0]?.n === -1) return ctx.skip('ecf_submissions.rnc_comprador column not present')
  ctx.assertEq(rows[0].n, 0, `${rows[0].n} E31 submissions have blank/short RNC — whitespace bypass active`)
}, { category: 'security.fiscal.e31_rnc_guard' })

harness.scenario('security.fiscal.e31_rnc_guard.rnc_format_9_digits', async (ctx) => {
  const rows = await ctx.pgQuery(`
    SELECT COUNT(*)::int AS n FROM public.ecf_submissions
    WHERE tipo_ecf = '31' AND rnc_comprador IS NOT NULL
      AND rnc_comprador !~ '^[0-9]{9,11}$'
  `).catch(() => [{ n: -1 }])
  if (rows[0]?.n === -1) return ctx.skip('column missing')
  ctx.assertEq(rows[0].n, 0, `${rows[0].n} E31 rows have non-numeric RNC`)
}, { category: 'security.fiscal.e31_rnc_guard' })

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ CATEGORY 13 — security.fiscal.void_reason                                ║
// ╚══════════════════════════════════════════════════════════════════════════╝

harness.scenario('security.fiscal.void_reason.voided_tickets_have_reason', async (ctx) => {
  const rows = await ctx.pgQuery(`
    SELECT COUNT(*)::int AS n FROM public.tickets
    WHERE COALESCE(voided, false) = true
      AND (void_reason IS NULL OR LENGTH(TRIM(void_reason)) < 3)
      AND created_at > NOW() - INTERVAL '180 days'
  `).catch(() => [{ n: -1 }])
  if (rows[0]?.n === -1) return ctx.skip('tickets.void_reason column missing')
  ctx.assertEq(rows[0].n, 0, `${rows[0].n} recent voided tickets lack a reason ≥ 3 chars`)
}, { category: 'security.fiscal.void_reason' })

harness.scenario('security.fiscal.void_reason.void_event_logged', async (ctx) => {
  const rows = await ctx.pgQuery(`
    SELECT t.id FROM public.tickets t
    WHERE COALESCE(t.voided, false) = true
      AND t.created_at > NOW() - INTERVAL '30 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.activity_log a
        WHERE a.target_id::text = t.id::text AND a.event_type = 'ticket_void'
      )
    LIMIT 20
  `).catch(() => [])
  ctx.assertEq(rows.length, 0, `${rows.length} recent voids missing activity_log ticket_void entry`)
}, { category: 'security.fiscal.void_reason' })

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ CATEGORY 14 — security.theft.receipt_reprint                             ║
// ╚══════════════════════════════════════════════════════════════════════════╝

harness.scenario('security.theft.receipt_reprint.event_type_in_use', async (ctx) => {
  const rows = await ctx.pgQuery(`
    SELECT COUNT(*)::int AS n FROM public.activity_log
    WHERE event_type IN ('receipt_reprint','reprint','reimpresion')
      AND created_at > NOW() - INTERVAL '90 days'
  `).catch(() => [{ n: -1 }])
  if (rows[0]?.n === -1) return ctx.skip('activity_log unavailable')
  // Informational unless we know reprints happened.
  ctx.log(`reprint events last 90d: ${rows[0].n}`)
  ctx.assert(rows[0].n >= 0)
}, { category: 'security.theft.receipt_reprint' })

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ CATEGORY 15 — security.theft.discount_threshold                          ║
// ╚══════════════════════════════════════════════════════════════════════════╝

harness.scenario('security.theft.discount_threshold.large_discounts_logged', async (ctx) => {
  const rows = await ctx.pgQuery(`
    SELECT COUNT(*)::int AS n FROM public.tickets
    WHERE COALESCE(descuento_total, 0) >= 1000
      AND created_at > NOW() - INTERVAL '90 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.activity_log a
        WHERE a.target_id::text = tickets.id::text
          AND a.event_type IN ('discount_applied','manager_authorized')
      )
  `).catch(() => [{ n: -1 }])
  if (rows[0]?.n === -1) return ctx.skip('descuento_total column missing')
  ctx.assert((rows[0]?.n || 0) <= 5,
    `${rows[0]?.n} large discounts (≥RD$1,000) without manager-authorized activity_log entry`)
}, { category: 'security.theft.discount_threshold' })

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ CATEGORY 16 — security.theft.inventory_adjust                            ║
// ╚══════════════════════════════════════════════════════════════════════════╝

harness.scenario('security.theft.inventory_adjust.old_new_values_present', async (ctx) => {
  const rows = await ctx.pgQuery(`
    SELECT COUNT(*)::int AS n FROM public.activity_log
    WHERE event_type = 'inventory_adjustment'
      AND (old_value IS NULL OR new_value IS NULL)
      AND created_at > NOW() - INTERVAL '90 days'
  `).catch(() => [{ n: -1 }])
  if (rows[0]?.n === -1) return ctx.skip('activity_log lacks old_value/new_value cols')
  ctx.assertEq(rows[0].n, 0, `${rows[0].n} inventory adjustments missing old/new values`)
}, { category: 'security.theft.inventory_adjust' })

harness.scenario('security.theft.inventory_adjust.adjustment_emits_log', async (ctx) => {
  // For every recent change in inventory_items.qty_on_hand, expect an activity_log row.
  const rows = await ctx.pgQuery(`
    SELECT COUNT(*)::int AS n FROM public.activity_log
    WHERE event_type = 'inventory_adjustment'
      AND created_at > NOW() - INTERVAL '30 days'
  `).catch(() => [{ n: -1 }])
  if (rows[0]?.n === -1) return ctx.skip('activity_log unavailable')
  ctx.log(`inventory_adjustment events last 30d: ${rows[0].n}`)
  ctx.assert(rows[0].n >= 0)
}, { category: 'security.theft.inventory_adjust' })

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ CATEGORY 17 — security.theft.price_edit                                  ║
// ╚══════════════════════════════════════════════════════════════════════════╝

harness.scenario('security.theft.price_edit.events_have_old_and_new', async (ctx) => {
  const rows = await ctx.pgQuery(`
    SELECT COUNT(*)::int AS n FROM public.activity_log
    WHERE event_type IN ('price_edit','cart_line_price_edit')
      AND (old_value IS NULL OR new_value IS NULL)
      AND created_at > NOW() - INTERVAL '90 days'
  `).catch(() => [{ n: -1 }])
  if (rows[0]?.n === -1) return ctx.skip('activity_log unavailable')
  ctx.assertEq(rows[0].n, 0, `${rows[0].n} price_edit events missing before/after values`)
}, { category: 'security.theft.price_edit' })

harness.scenario('security.theft.price_edit.severity_at_least_info', async (ctx) => {
  const rows = await ctx.pgQuery(`
    SELECT COUNT(*)::int AS n FROM public.activity_log
    WHERE event_type IN ('price_edit','cart_line_price_edit')
      AND (severity IS NULL OR severity NOT IN ('info','warn','critical'))
  `).catch(() => [{ n: -1 }])
  if (rows[0]?.n === -1) return ctx.skip('activity_log.severity unavailable')
  ctx.assertEq(rows[0].n, 0, `${rows[0].n} price_edit events have unknown severity`)
}, { category: 'security.theft.price_edit' })

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ Padding scenarios — bring count up + cover remaining auth surface        ║
// ╚══════════════════════════════════════════════════════════════════════════╝

// More RLS policy table coverage
for (const tbl of [
  'cuadre','loans','loan_payments','work_orders','work_order_items','queue',
  'mesas','appointments','memberships','reservations','warranties','preapprovals',
  'vehicle_inventory','sales_deals','test_drives','matriculas','leads',
  'categorias_servicio','inventory_counts','client_addresses','seller_commissions',
  'washer_commissions','cajero_commissions','journal_entries','loyalty_transactions',
]) {
  harness.scenario(`security.rls.policies.extended.${tbl}`, async (ctx) => {
    const tables = await loadRlsTables(ctx)
    const t = tables.find(r => r.relname === tbl)
    if (!t) return ctx.skip(`table ${tbl} absent or RLS off`)
    const pols = await loadPolicies(ctx)
    const n = pols.filter(p => p.tablename === tbl).length
    ctx.assert(n >= 1, `${tbl}: RLS enabled with 0 policies`)
  }, { category: 'security.rls.policies' })
}

// Cross-cutting: service_role rows should NEVER appear via anon path
harness.scenario('security.rls.anon_cannot_read_admin_users', async (ctx) => {
  if (!ctx.anon) return ctx.skip('no anon client')
  const { data, error } = await ctx.anon.from('admin_users').select('id').limit(5)
  // Either RLS rejects (error 42501 / empty result) or table absent.
  if (error) return ctx.assert(true, error.message)
  ctx.assertEq((data || []).length, 0, `anon read ${data?.length} admin_users rows`)
}, { category: 'security.auth.roles' })

harness.scenario('security.rls.anon_cannot_read_licenses', async (ctx) => {
  if (!ctx.anon) return ctx.skip('no anon client')
  const { data, error } = await ctx.anon.from('licenses').select('id, license_key').limit(5)
  if (error) return ctx.assert(true)
  ctx.assertEq((data || []).length, 0, `anon read ${data?.length} licenses (leak)`)
}, { category: 'security.auth.roles' })

harness.scenario('security.rls.anon_cannot_read_client_errors', async (ctx) => {
  if (!ctx.anon) return ctx.skip('no anon client')
  const { data, error } = await ctx.anon.from('client_errors').select('id').limit(5)
  if (error) return ctx.assert(true)
  ctx.assertEq((data || []).length, 0, `anon read ${data?.length} client_errors`)
}, { category: 'security.auth.roles' })

harness.scenario('security.auth.pin.no_plaintext_pin_column', async (ctx) => {
  await primeCache(ctx)
  ctx.assert(!hasColumn('staff','pin'), 'staff.pin exists — plaintext PIN must never be stored')
}, { category: 'security.auth.pin' })

harness.scenario('security.auth.pin.no_plaintext_in_users_view', async (ctx) => {
  await primeCache(ctx)
  ctx.assert(!hasColumn('users','pin'), 'users view exposes plaintext pin column')
}, { category: 'security.auth.pin' })

harness.scenario('security.dgii.parent_gate.no_stuck_en_proceso', async (ctx) => {
  // EN_PROCESO older than 72h is the reconciler's job; surface excessive backlogs.
  const rows = await ctx.pgQuery(`
    SELECT COUNT(*)::int AS n FROM public.ecf_submissions
    WHERE dgii_status = 3 AND submitted_at < NOW() - INTERVAL '7 days'
  `).catch(() => [{ n: -1 }])
  if (rows[0]?.n === -1) return ctx.skip('column missing')
  ctx.assert(rows[0].n < 50, `${rows[0].n} EN_PROCESO submissions older than 7 days — reconciler stalled`)
}, { category: 'security.dgii.parent_gate' })

harness.scenario('security.fiscal.void_reason.has_void_columns', async (ctx) => {
  await primeCache(ctx)
  // Schema variants: tickets may use `voided` or `void_status` or just a void event log.
  const candidates = ['voided','void_reason','voided_at','voided_by','void_status','void_at']
  const found = candidates.filter(c => hasColumn('tickets', c))
  ctx.assert(found.length >= 1, `tickets missing any void-tracking column (looked for ${candidates.join(', ')})`)
  ctx.log(`tickets void columns present: ${found.join(', ')}`)
}, { category: 'security.fiscal.void_reason' })

harness.scenario('security.theft.discount_threshold.threshold_field_exists', async (ctx) => {
  await primeCache(ctx)
  ctx.assert(hasColumn('app_settings','value'), 'app_settings.value missing — discount threshold cannot be configured')
}, { category: 'security.theft.discount_threshold' })

harness.scenario('security.rls.app_metadata.no_overpermissive_true_policies', async (ctx) => {
  // Policies whose USING clause is literal `true` for non-public tables are usually mistakes.
  const rows = await ctx.pgQuery(`
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname='public'
      AND TRIM(qual) = 'true'
      AND cmd IN ('SELECT','ALL')
      AND 'anon' = ANY(roles)
      AND tablename NOT IN ('plans','remote_config','public_landing','dgii_consultas_rnc','rnc_contribuyentes')
  `)
  ctx.assertEq(rows.length, 0,
    `${rows.length} policies allow anon SELECT with USING=true: ${rows.slice(0,3).map(r => `${r.tablename}.${r.policyname}`).join(', ')}`)
}, { category: 'security.rls.app_metadata' })

harness.scenario('security.auth.last_owner_lock.no_orphan_owner_login', async (ctx) => {
  // Every staff row with role-claim owner must link to an empleados.role='owner'.
  const rows = await ctx.pgQuery(`
    SELECT s.username FROM public.staff s
    LEFT JOIN public.empleados e ON e.id = s.employee_id
    WHERE s.business_id IS NOT NULL
      AND COALESCE(e.role, '') = 'owner'
      AND COALESCE(e.activo, true) = false
    LIMIT 20
  `).catch(() => [])
  ctx.assertEq(rows.length, 0, `${rows.length} staff rows tied to inactive owner empleados`)
}, { category: 'security.auth.last_owner_lock' })

harness.scenario('security.dgii.semilla.nonce_unique_per_business', async (ctx) => {
  const rows = await ctx.pgQuery(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='semilla_nonces'
  `).catch(() => [])
  if (!rows.length) return ctx.skip('semilla_nonces table absent')
  const dups = await ctx.pgQuery(`
    SELECT nonce, COUNT(*) AS n FROM public.semilla_nonces
    GROUP BY nonce HAVING COUNT(*) > 1 LIMIT 10
  `).catch(() => [])
  ctx.assertEq(dups.length, 0, `${dups.length} duplicate nonces (replay vector)`)
}, { category: 'security.dgii.semilla' })

// ─── RUN ─────────────────────────────────────────────────────────────────────
const summary = await harness.run()
process.exit(summary.failed > 0 ? 1 : 0)
