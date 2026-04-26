#!/usr/bin/env node
/**
 * audit-mechanic-schema.mjs — verify mechanic vertical schema on linked Supabase.
 *
 * Run: node scripts/audit-mechanic-schema.mjs
 *
 * Probes the production schema for every object the mechanic vertical expects.
 * Exit 0 + green table on full coverage. Exit 1 + red rows for any miss.
 *
 * Spans (intentional):
 *   - 20260417100000_mechanic_vertical.sql        (base tables)
 *   - 20260426100000_mechanic_v216_hardening.sql  (v2.16 hardening)
 *   - 20260426100001_mechanic_pgcron_reminders.sql
 *   - 20260428000000_mechanic_v216_safe.sql       (this sprint — M2 + H5)
 *
 * Explicitly does NOT touch empleados.comision_pct (Spanish name is canonical).
 */
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PROBE = `
SELECT
  -- M2 effects
  EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'parts_orders_supplier_supabase_fk'
  ) AS m2_fk_present,
  -- H5 effects
  EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'mechanic_commissions'
  ) AS h5_table_present,
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mechanic_commissions_business_supabase_uk'
  ) AS h5_uk_business_supabase,
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mechanic_commissions_wo_tech_uk'
  ) AS h5_uk_wo_tech,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'mechanic_commissions_biz_paid_idx'
  ) AS h5_idx_biz_paid,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'mechanic_commissions_tech_idx'
  ) AS h5_idx_tech,
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mechanic_commissions' AND policyname = 'mechanic_commissions_anon_select'
  ) AS h5_rls_select,
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mechanic_commissions' AND policyname = 'mechanic_commissions_anon_insert'
  ) AS h5_rls_insert,
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mechanic_commissions' AND policyname = 'mechanic_commissions_anon_update'
  ) AS h5_rls_update,
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mechanic_commissions' AND policyname = 'mechanic_commissions_anon_delete'
  ) AS h5_rls_delete,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'mechanic_commissions_set_updated_at' AND NOT tgisinternal
  ) AS h5_trigger_updated_at,
  -- Pre-existing mechanic vertical (sanity check the rest still in place)
  EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'work_orders'
  ) AS base_work_orders,
  EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'work_order_items'
  ) AS base_work_order_items,
  EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'parts_orders'
  ) AS base_parts_orders,
  EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'suppliers'
  ) AS base_suppliers,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'empleados' AND column_name = 'comision_pct'
  ) AS empleados_comision_pct,
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'empleados' AND column_name = 'commission_pct'
  ) AS empleados_no_english_column;
`

const tmp = join(tmpdir(), `tx-mechanic-probe-${Date.now()}.sql`)
writeFileSync(tmp, PROBE)

// Windows: execFileSync can't spawn .cmd shims without shell:true (EINVAL).
// Use execSync with a shell-quoted command instead — works on win32 + posix.
import { execSync } from 'node:child_process'
let raw
try {
  // Quote the file path for safety on Windows where it has spaces.
  const quoted = JSON.stringify(tmp)
  raw = execSync(
    `npx supabase db query --file ${quoted} --linked --agent=yes --output json`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
} catch (e) {
  console.error('FATAL: supabase db query failed:', e?.stderr || e?.message)
  try { unlinkSync(tmp) } catch {}
  process.exit(2)
}
try { unlinkSync(tmp) } catch {}

// Strip the leading "Initialising login role..." lines until first '{' or '['
const jsonStart = Math.min(
  raw.indexOf('{') === -1 ? Infinity : raw.indexOf('{'),
  raw.indexOf('[') === -1 ? Infinity : raw.indexOf('['),
)
if (!Number.isFinite(jsonStart)) {
  console.error('FATAL: could not locate JSON in supabase output:\n' + raw)
  process.exit(2)
}
const tail = raw.slice(jsonStart)
let parsed
try {
  parsed = JSON.parse(tail)
} catch {
  // Some CLI versions wrap JSON in {data: ..., warning: ...}; try to recover
  const m = tail.match(/\{[\s\S]*\}/)
  parsed = m ? JSON.parse(m[0]) : null
}
if (!parsed) {
  console.error('FATAL: could not parse JSON:\n' + tail)
  process.exit(2)
}

// Normalize — CLI returns either an array or {data: [...], warning?}
let row
if (Array.isArray(parsed)) row = parsed[0]
else if (parsed?.data && Array.isArray(parsed.data)) row = parsed.data[0]
else if (parsed?.rows && Array.isArray(parsed.rows)) row = parsed.rows[0]
else row = parsed

if (!row || typeof row !== 'object') {
  console.error('FATAL: unexpected shape:\n' + JSON.stringify(parsed, null, 2))
  process.exit(2)
}

const checks = [
  // 20260428000000 M2
  ['M2',  'parts_orders → suppliers FK',          'm2_fk_present'],
  // 20260428000000 H5
  ['H5',  'mechanic_commissions table',           'h5_table_present'],
  ['H5',  'UK (business_id, supabase_id)',        'h5_uk_business_supabase'],
  ['H5',  'UK (business, work_order, technician)', 'h5_uk_wo_tech'],
  ['H5',  'idx (business, paid, created_at)',     'h5_idx_biz_paid'],
  ['H5',  'idx (technician)',                     'h5_idx_tech'],
  ['H5',  'RLS select (anon)',                    'h5_rls_select'],
  ['H5',  'RLS insert (anon)',                    'h5_rls_insert'],
  ['H5',  'RLS update (anon)',                    'h5_rls_update'],
  ['H5',  'RLS delete (anon)',                    'h5_rls_delete'],
  ['H5',  'trigger updated_at',                   'h5_trigger_updated_at'],
  // Sanity
  ['base','work_orders table',                    'base_work_orders'],
  ['base','work_order_items table',               'base_work_order_items'],
  ['base','parts_orders table',                   'base_parts_orders'],
  ['base','suppliers table',                      'base_suppliers'],
  ['B3',  'empleados.comision_pct present',       'empleados_comision_pct'],
  ['B3',  'empleados.commission_pct ABSENT',      'empleados_no_english_column'],
]

const C_GREEN = '\x1b[32m', C_RED = '\x1b[31m', C_DIM = '\x1b[2m', C_RST = '\x1b[0m'
let pass = 0, fail = 0
for (const [block, label, key] of checks) {
  const ok = row[key] === true || row[key] === 't' || row[key] === 'true' || row[key] === 1
  if (ok) pass++
  else fail++
  const icon = ok ? `${C_GREEN}✓${C_RST}` : `${C_RED}✗${C_RST}`
  const blockTag = `${C_DIM}${block.padEnd(4)}${C_RST}`
  console.log(`  ${icon} ${blockTag}  ${label}`)
}
console.log('')
const summary = fail === 0
  ? `${C_GREEN}MECHANIC SCHEMA AUDIT — ${pass}/${pass + fail} checks passed (100% green)${C_RST}`
  : `${C_RED}MECHANIC SCHEMA AUDIT — ${pass}/${pass + fail} checks passed, ${fail} FAILED${C_RST}`
console.log(summary)
process.exit(fail === 0 ? 0 : 1)
