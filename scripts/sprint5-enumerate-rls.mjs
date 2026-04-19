#!/usr/bin/env node
// Sprint 5 — Enumerate permissive anon RLS policies that use
// `(business_id IS NOT NULL)` as their only qual/check. These are the
// policies that break multi-tenant isolation per the 2026-04-19 audit.
//
// Read-only. Outputs a catalogue + DROP POLICY statements that can then be
// reviewed before applying.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

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

const rows = await q(`
  SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
    FROM pg_policies
   WHERE schemaname = 'public'
     AND (
       (qual IS NOT NULL       AND qual       ILIKE '%business_id IS NOT NULL%')
       OR
       (with_check IS NOT NULL AND with_check ILIKE '%business_id IS NOT NULL%')
     )
  ORDER BY tablename, policyname
`)

console.log(`\n=== Permissive anon policies (business_id IS NOT NULL) ===`)
console.log(`Count: ${rows.length}`)

const byTable = {}
for (const r of rows) {
  byTable[r.tablename] = byTable[r.tablename] || []
  byTable[r.tablename].push(r)
}

console.log('\nBy table:')
for (const [t, arr] of Object.entries(byTable)) {
  console.log(`  ${t.padEnd(40)} ${arr.length} polic${arr.length === 1 ? 'y' : 'ies'}`)
}

console.log('\nDROP statements:')
for (const r of rows) {
  console.log(`DROP POLICY IF EXISTS "${r.policyname}" ON public.${r.tablename};`)
}

// Also check for USING(true) policies on non-global tables (ecf_cert_* family + modifier_groups)
console.log(`\n=== USING(true) policies on ecf_cert_* family ===`)
const certRows = await q(`
  SELECT tablename, policyname, roles, cmd, qual, with_check
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('ecf_certifications','ecf_cert_documents','ecf_cert_notes','ecf_cert_step_data','ecf_cert_test_results','ecf_cert_commands')
     AND ((qual = 'true') OR (with_check = 'true'))
  ORDER BY tablename, policyname
`)
console.log(`Count: ${certRows.length}`)
for (const r of certRows) {
  console.log(`  ${r.tablename}.${r.policyname}  [${r.cmd}]  qual=${r.qual}  check=${r.with_check}`)
}

// modifier_groups RLS status
console.log(`\n=== modifier_groups RLS status ===`)
const mg = await q(`SELECT relname, relrowsecurity FROM pg_class WHERE relname='modifier_groups' AND relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')`)
console.log(mg)

// Sample: for a few hot tables, verify there's still a non-permissive policy
// that would cover legitimate access after the permissive ones drop.
console.log(`\n=== Non-permissive (my_business_ids / JWT-scoped) policies on hot tables ===`)
const hot = ['tickets','clients','staff','empleados','credit_payments','notas_credito','activity_log','washer_commissions','inventory_items']
for (const tbl of hot) {
  const r = await q(`SELECT policyname, cmd, qual FROM pg_policies WHERE schemaname='public' AND tablename='${tbl}' AND qual NOT ILIKE '%business_id IS NOT NULL%'`)
  console.log(`  ${tbl.padEnd(22)} ${r.length} non-permissive polic${r.length === 1 ? 'y' : 'ies'}`)
  for (const p of r) console.log(`    - ${p.policyname} [${p.cmd}] ${(p.qual || '').slice(0, 80)}`)
}

console.log('\nDone.')
