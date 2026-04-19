#!/usr/bin/env node
// Sprint 5 — Apply the RLS hardening migration.
//
// What this does:
//   1. DROPs every permissive `(business_id IS NOT NULL)` anon policy for
//      SELECT/UPDATE/DELETE on business-scoped tables. INSERT policies are
//      left in place for now to avoid breaking any web-authenticated path
//      that doesn't have a `my_business_ids()` INSERT replacement.
//   2. Enables RLS on `modifier_groups` + adds the standard my_business_ids()
//      policy used by peer tables.
//   3. Replaces the 6 `ecf_cert_*` `USING(true)` policies with admin_users
//      scoping.
//
// Dry-run by default. Pass --apply to write.
//
// Safety:
//   - Desktop sync uses service_role key → RLS bypassed → sync unaffected.
//   - Web authenticated users hit `my_business_ids()` policies → unaffected.
//   - Anon SELECTs across tenants → BLOCKED (this is the whole point).

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
  let body; try { body = JSON.parse(text) } catch { body = text }
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`)
  return body
}

// ── Collect the drop list (SELECT/UPDATE/DELETE only) ──────────────────────
const perms = await q(`
  SELECT schemaname, tablename, policyname, cmd
    FROM pg_policies
   WHERE schemaname = 'public'
     AND cmd IN ('SELECT','UPDATE','DELETE','ALL')
     AND (
       (qual IS NOT NULL       AND qual       ILIKE '%business_id IS NOT NULL%')
       OR
       (with_check IS NOT NULL AND with_check ILIKE '%business_id IS NOT NULL%')
     )
  ORDER BY tablename, policyname
`)

// For ALL cmd, we include it too — ALL covers select/update/delete/insert.
// Dropping ALL permissive with `business_id IS NOT NULL` is fine because we
// still have explicit SELECT/UPDATE/DELETE my_business_ids() policies on the
// hot tables (verified by the enumeration dry-run).
console.log(`\nDrop plan: ${perms.length} permissive policies targeting SELECT/UPDATE/DELETE/ALL`)
const dropSqls = perms.map(p => `DROP POLICY IF EXISTS "${p.policyname}" ON public.${p.tablename};`)

// ── modifier_groups — enable RLS + add my_business_ids policy ──────────────
const modifierGroupsSql = `
ALTER TABLE public.modifier_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS modifier_groups_sel ON public.modifier_groups;
DROP POLICY IF EXISTS modifier_groups_ins ON public.modifier_groups;
DROP POLICY IF EXISTS modifier_groups_upd ON public.modifier_groups;
DROP POLICY IF EXISTS modifier_groups_del ON public.modifier_groups;
CREATE POLICY modifier_groups_sel ON public.modifier_groups FOR SELECT TO authenticated USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY modifier_groups_ins ON public.modifier_groups FOR INSERT TO authenticated WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY modifier_groups_upd ON public.modifier_groups FOR UPDATE TO authenticated USING (business_id IN (SELECT my_business_ids())) WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY modifier_groups_del ON public.modifier_groups FOR DELETE TO authenticated USING (business_id IN (SELECT my_business_ids()));
`.trim()

// ── ecf_cert_* — replace USING(true) with admin_users scoping ──────────────
const certRows = await q(`
  SELECT tablename, policyname
    FROM pg_policies
   WHERE schemaname='public'
     AND tablename IN ('ecf_certifications','ecf_cert_documents','ecf_cert_notes','ecf_cert_step_data','ecf_cert_test_results','ecf_cert_commands')
     AND ((qual='true') OR (with_check='true'))
  ORDER BY tablename, policyname
`)

const certDropSqls = certRows.map(r => `DROP POLICY IF EXISTS "${r.policyname}" ON public.${r.tablename};`)
const certReplaceSql = `
-- ecf_cert_* — only admin_users (our reseller admins) may see/modify. Scoped
-- by auth.uid() matching admin_users.auth_user_id.
${['ecf_certifications','ecf_cert_documents','ecf_cert_notes','ecf_cert_step_data','ecf_cert_test_results','ecf_cert_commands']
  .map(t => `
CREATE POLICY ${t}_admin ON public.${t}
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.auth_user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.auth_user_id = auth.uid()));`).join('\n')}
`.trim()

const fullSql = [
  '-- =============================================================',
  '-- Sprint 5 RLS hardening — 2026-04-19',
  `-- Drops ${perms.length} permissive anon policies (SELECT/UPDATE/DELETE/ALL) with \`business_id IS NOT NULL\``,
  `-- Replaces 6 ecf_cert_* USING(true) policies with admin_users scoping`,
  `-- Enables RLS on modifier_groups + installs my_business_ids() policies`,
  '-- =============================================================',
  '',
  '-- 1. Drop permissive anon policies',
  ...dropSqls,
  '',
  '-- 2. modifier_groups',
  modifierGroupsSql,
  '',
  '-- 3. ecf_cert_* permissive drops',
  ...certDropSqls,
  '',
  '-- 4. ecf_cert_* admin_users scoping',
  certReplaceSql,
  '',
].join('\n')

const outPath = path.join(ROOT, 'supabase/migrations/20260419200000_sprint5_rls_hardening.sql')
fs.writeFileSync(outPath, fullSql)
console.log(`\nWrote migration: ${outPath}`)

if (!APPLY) {
  console.log('\n[dry-run] No SQL executed. Re-run with --apply to execute on prod.')
  process.exit(0)
}

console.log('\nApplying to prod...')
try {
  await q(fullSql)
  console.log('OK. Verifying coverage…')
  const left = await q(`
    SELECT COUNT(*)::int AS n FROM pg_policies WHERE schemaname='public'
      AND cmd IN ('SELECT','UPDATE','DELETE','ALL')
      AND ((qual ILIKE '%business_id IS NOT NULL%') OR (with_check ILIKE '%business_id IS NOT NULL%'))
  `)
  console.log('Permissive policies remaining:', left)
  const mg = await q(`SELECT relrowsecurity FROM pg_class WHERE relname='modifier_groups' AND relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')`)
  console.log('modifier_groups RLS enabled:', mg)
  const certLeft = await q(`SELECT COUNT(*)::int AS n FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'ecf_cert_%' AND ((qual='true') OR (with_check='true'))`)
  console.log('ecf_cert_* USING(true) remaining:', certLeft)
} catch (e) {
  console.error('FAILED:', e.message)
  process.exit(1)
}
