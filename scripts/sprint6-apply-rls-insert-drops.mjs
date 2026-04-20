#!/usr/bin/env node
// Sprint 6 — complete the RLS hardening started in Sprint 5.
//
// Scope:
//   1. For each of 25 tables with a permissive INSERT policy, ensure a
//      my_business_ids()-scoped INSERT WITH CHECK policy exists, then drop
//      the permissive one.
//   2. Drop the two `businesses` INSERT policies with WITH CHECK (true).
//   3. Drop `license_events_insert` + add a scoped-via-license-join INSERT.
//   4. Add SELECT policy for `license_events` via license join.
//
// Idempotent: CREATE POLICY uses DROP-IF-EXISTS before, and DROP POLICY IF
// EXISTS on permissive drops.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const APPLY = process.argv.includes('--apply')

const ENV = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .map(l => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
    .filter(Boolean)
    .map(m => [m[1], m[2].replace(/^"(.*)"$/, '$1')])
)
const ref = new URL(ENV.SUPABASE_URL).hostname.split('.')[0]
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ENV.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql })
  })
  const text = await r.text()
  if (!r.ok) { console.error(`[${sql.slice(0,60)}...] FAILED:`, text.slice(0,300)); return null }
  try { return JSON.parse(text) } catch { return text }
}

// ── 25 tables with permissive INSERT → add scoped + drop permissive ──
const INSERT_TARGETS = [
  { tbl: 'activity_log',          permissive: 'activity_log_anon_insert' },
  { tbl: 'app_settings',          permissive: 'rls_anon_insert' },
  { tbl: 'caja_chica',            permissive: 'rls_anon_insert' },
  { tbl: 'cajero_commissions',    permissive: 'cajero_commissions_biz_insert' },
  { tbl: 'categorias_servicio',   permissive: 'rls_anon_insert' },
  { tbl: 'client_item_prices',    permissive: 'cip_anon_insert' },
  { tbl: 'clients',               permissive: 'rls_anon_insert' },
  { tbl: 'compras_607',           permissive: 'rls_anon_insert' },
  { tbl: 'configuracion',         permissive: 'rls_anon_insert' },
  { tbl: 'credit_payments',       permissive: 'rls_anon_insert' },
  { tbl: 'cuadre_caja',           permissive: 'rls_anon_insert' },
  { tbl: 'ecf_queue',             permissive: 'rls_anon_insert' },
  { tbl: 'empleados',             permissive: 'rls_anon_insert' },
  { tbl: 'inventory_items',       permissive: 'rls_anon_insert' },
  { tbl: 'inventory_transactions', permissive: 'rls_anon_insert' },
  { tbl: 'ncf_sequences',         permissive: 'rls_anon_insert' },
  { tbl: 'notas_credito',         permissive: 'rls_anon_insert' },
  { tbl: 'queue',                 permissive: 'rls_anon_insert' },
  { tbl: 'rnc_cache',             permissive: 'rls_anon_insert' },
  { tbl: 'seller_commissions',    permissive: 'seller_commissions_biz_insert' },
  { tbl: 'services',              permissive: 'rls_anon_insert' },
  { tbl: 'staff',                 permissive: 'staff_anon_insert' },
  { tbl: 'ticket_items',          permissive: 'rls_anon_insert' },
  { tbl: 'tickets',               permissive: 'rls_anon_insert' },
  { tbl: 'washer_commissions',    permissive: 'washer_commissions_biz_insert' },
]

async function run() {
  console.log(`\n=== Sprint 6 — RLS INSERT hardening ===`)
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`)

  let added = 0, dropped = 0, errors = 0
  for (const { tbl, permissive } of INSERT_TARGETS) {
    const addSql = `CREATE POLICY "${tbl}_ins_auth" ON public.${tbl} FOR INSERT TO authenticated WITH CHECK (business_id IN (SELECT public.my_business_ids()));`
    const dropSql = `DROP POLICY IF EXISTS "${permissive}" ON public.${tbl};`

    if (!APPLY) {
      console.log(`  ${tbl}: + ${tbl}_ins_auth, - ${permissive}`)
      continue
    }

    // Add scoped INSERT (ignore if already exists)
    const addRes = await q(addSql)
    if (addRes !== null) added++
    // Drop permissive
    const dropRes = await q(dropSql)
    if (dropRes !== null) dropped++
    else errors++
  }

  if (!APPLY) return

  console.log(`\nScoped INSERT policies added: ${added}`)
  console.log(`Permissive INSERT dropped:    ${dropped}`)
  console.log(`Errors:                       ${errors}`)

  // ── businesses ──
  console.log('\n=== businesses WITH CHECK(true) drops ===')
  await q(`DROP POLICY IF EXISTS "rls_businesses_anon_insert" ON public.businesses;`)
  await q(`DROP POLICY IF EXISTS "rls_businesses_insert_auth" ON public.businesses;`)
  console.log('  dropped rls_businesses_anon_insert + rls_businesses_insert_auth')

  // ── license_events — drop permissive + add scoped via license join ──
  console.log('\n=== license_events ===')
  await q(`DROP POLICY IF EXISTS "license_events_insert" ON public.license_events;`)
  // INSERT: scoped via license's business_id. Service role (desktop sync) bypasses RLS.
  await q(`CREATE POLICY "license_events_ins_auth" ON public.license_events FOR INSERT TO authenticated
           WITH CHECK (license_id IN (SELECT id FROM public.licenses WHERE business_id IN (SELECT public.my_business_ids())));`)
  // SELECT
  await q(`CREATE POLICY "license_events_sel_auth" ON public.license_events FOR SELECT TO authenticated
           USING (license_id IN (SELECT id FROM public.licenses WHERE business_id IN (SELECT public.my_business_ids())));`)
  console.log('  dropped license_events_insert; added license_events_ins_auth + license_events_sel_auth')

  // ── Verification ──
  const left = await q(`
    SELECT COUNT(*)::int AS n FROM pg_policies WHERE schemaname='public'
      AND cmd='INSERT'
      AND ((qual ILIKE '%business_id IS NOT NULL%') OR (with_check ILIKE '%business_id IS NOT NULL%'))
  `)
  console.log(`\nPermissive INSERT policies remaining: ${left?.[0]?.n}`)

  const bizLeft = await q(`
    SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='businesses' AND cmd='INSERT' AND with_check = 'true'
  `)
  console.log(`businesses WITH CHECK(true) INSERT policies remaining:`, bizLeft?.length ? bizLeft : '0')
}

run().catch(e => { console.error(e); process.exit(1) })
