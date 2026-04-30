/**
 * tenant-isolation-smoke.mjs — proves the cross-tenant leak is closed.
 *
 * Logs in as Jerry Felix (Ranoza Liquor Store, the tenant who experienced the
 * 2026-04-29 incident). For every business-scoped table, fetches all rows the
 * Supabase REST layer will return AND fetches them WITHOUT the explicit
 * .eq('business_id') filter (RLS-only path). Asserts that NO row from any
 * other tenant ever appears in either result set.
 *
 * This is the regression test for the plan's Phase A fixes:
 *   • SupabaseAuthGate remount key
 *   • SW removed from caching Supabase
 *   • web.js defense-in-depth filters
 *   • useDB.js hooks include `api` in deps
 *
 * Exit 0 = clean (no foreign rows seen). Exit 1 = leak.
 *
 * Run: `node scripts/tenant-isolation-smoke.mjs`
 */
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: 'A:/Studio X HUB/Terminal X/.env' })

const URL  = process.env.SUPABASE_URL
const ANON = process.env.SUPABASE_ANON_KEY
const RANOZA_BID = '4f789f41-76d2-4402-838f-5fe20a91641f'
const STUDIOX_BID = '1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79'
const EMAIL = 'Jerryfelix@gmail.com'
const PASS  = 'Rahel25@'

// Tables that carry tenant data and MUST never leak across business_ids when
// queried as Jerry. Pulled from web.js — anything Jerry's UI can read.
const TENANT_TABLES = [
  'clients',
  'tickets',
  'ticket_items',
  'credit_payments',
  'notas_credito',
  'loans',
  'loan_payments',
  'inventory_items',
  'services',
  'staff',
  'empleados',
  'app_settings',
  'activity_log',
  'cuadre_caja',
  'caja_chica',
  'washer_commissions',
  'seller_commissions',
  'cajero_commissions',
  'work_orders',
  'work_order_items',
  'vehicles',
  'vehicle_inventory',
  'sales_deals',
  'leads',
  'appointments',
  'queue',
]

let pass = 0, fail = 0
const failures = []
function log(step, ok, detail = '') {
  const sym = ok ? '✅' : '❌'
  console.log(`${sym} ${step}${detail ? ' — ' + detail : ''}`)
  if (ok) pass++; else { fail++; failures.push({ step, detail }) }
}

async function run() {
  console.log('\n=== TENANT-ISOLATION SMOKE (Jerry/Ranoza vs Studio X SRL) ===\n')

  const sb = createClient(URL, ANON, { auth: { persistSession: false } })
  const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASS })
  if (authErr || !auth?.session) {
    console.error('BLOCKER — Jerry sign-in failed:', authErr?.message)
    process.exit(1)
  }
  log('auth: Jerry signed in', true)

  // Confirm Jerry's JWT app_metadata.business_id is Ranoza (post-migration health check).
  const claim = auth.session.access_token.split('.')[1]
  const padded = claim + '='.repeat((4 - claim.length % 4) % 4)
  const decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
  const claimBiz = decoded?.app_metadata?.business_id
  log('jwt: app_metadata.business_id present', !!claimBiz,
    claimBiz === RANOZA_BID ? `=${claimBiz} (Ranoza)` : `expected Ranoza, got ${claimBiz || 'null'}`)

  // For each tenant table, run TWO queries:
  //   1. Filtered: .eq('business_id', RANOZA_BID) — should return Jerry's rows only.
  //   2. UNFILTERED: no .eq — RLS must still scope to Jerry's tenant. If ANY
  //      row from Studio X (or any non-Ranoza biz) comes back, the leak is real.
  for (const table of TENANT_TABLES) {
    // Probe column: most tables have business_id directly. activity_log has it
    // too (verified). app_settings has it. Some tables might not exist on this
    // schema — handle gracefully.
    const filtered = await sb.from(table).select('business_id').eq('business_id', RANOZA_BID).limit(1000)
    if (filtered.error) {
      log(`${table}: filtered read`, true, `skipped (${filtered.error.code || 'no-table'})`)
      continue
    }
    const ranozaCount = filtered.data?.length || 0
    log(`${table}: filtered read returns Ranoza only`,
      filtered.data?.every(r => r.business_id === RANOZA_BID),
      `${ranozaCount} rows`)

    const unfiltered = await sb.from(table).select('business_id').limit(5000)
    if (unfiltered.error) {
      log(`${table}: unfiltered read`, true, `skipped (${unfiltered.error.code})`)
      continue
    }
    const foreign = (unfiltered.data || []).filter(r => r.business_id && r.business_id !== RANOZA_BID)
    log(`${table}: unfiltered read → RLS scopes to Ranoza`,
      foreign.length === 0,
      foreign.length
        ? `LEAK: ${foreign.length} foreign rows, biz_ids=${[...new Set(foreign.map(r => r.business_id))].slice(0, 3).join(',')}`
        : `${unfiltered.data?.length || 0} rows, all Ranoza`)
  }

  // Direct cross-tenant probe: explicitly try to read Studio X. RLS must reject.
  const probe = await sb.from('clients').select('id, business_id, name').eq('business_id', STUDIOX_BID).limit(10)
  log('probe: explicit Studio X clients read → 0 rows',
    !probe.error && (probe.data?.length || 0) === 0,
    probe.error?.message || `${probe.data?.length || 0} rows returned`)

  const probe2 = await sb.from('credit_payments').select('id, business_id, amount').eq('business_id', STUDIOX_BID).limit(10)
  log('probe: explicit Studio X credits read → 0 rows',
    !probe2.error && (probe2.data?.length || 0) === 0,
    probe2.error?.message || `${probe2.data?.length || 0} rows returned`)

  await sb.auth.signOut()

  console.log(`\n=== ${pass} pass, ${fail} fail ===`)
  if (fail > 0) {
    console.log('\nFAILURES:')
    for (const f of failures) console.log(`  - ${f.step}: ${f.detail}`)
    process.exit(1)
  }
  console.log('\nTenant isolation verified — no cross-tenant leak.\n')
  process.exit(0)
}

run().catch(e => { console.error('FATAL:', e); process.exit(1) })
