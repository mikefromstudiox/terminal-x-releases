#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// apply-per-license-jwt.mjs
//
// 1) Applies supabase/migrations/20260427000000_per_license_jwt_lockdown.sql
//    via the Supabase Management API.
// 2) Verifies the audit table exists and the new <tbl>_jwt_select /
//    <tbl>_jwt_modify policies landed.
// 3) Deploys the mint-license-jwt edge function via `supabase functions
//    deploy` (if the Supabase CLI is on PATH); otherwise prints the exact
//    manual command + endpoint URL.
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

function parseEnv(file) {
  const txt = fs.readFileSync(file, 'utf8')
  const out = {}
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
  }
  return out
}

const ENV = parseEnv(path.join(ROOT, '.env'))
const SB_URL = ENV.SUPABASE_URL
const TOKEN  = ENV.SUPABASE_ACCESS_TOKEN
if (!SB_URL || !TOKEN) {
  console.error('Missing SUPABASE_URL or SUPABASE_ACCESS_TOKEN in .env')
  process.exit(1)
}
const ref = new URL(SB_URL).hostname.split('.')[0]

const MIGRATION = 'supabase/migrations/20260427000000_per_license_jwt_lockdown.sql'
const FUNCTION_DIR = 'supabase/functions/mint-license-jwt'

async function runQuery(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql })
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 1200)}`)
  return text
}

let pass = 0, fail = 0
function gate(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
  ok ? pass++ : fail++
}

// ── 1) Apply migration ───────────────────────────────────────────────────────
console.log(`\n=== Applying per-license JWT lockdown to ${ref} ===`)
{
  const sqlPath = path.join(ROOT, MIGRATION)
  const sql = fs.readFileSync(sqlPath, 'utf8')
  try {
    await runQuery(sql)
    gate(`apply ${MIGRATION}`, true, `${sql.length} chars`)
  } catch (e) {
    gate(`apply ${MIGRATION}`, false, e.message)
    process.exit(2)
  }
}

// ── 2) Verify audit table ────────────────────────────────────────────────────
console.log('\n--- Verifying license_jwt_audit table ---')
try {
  const r = await runQuery(
    `SELECT 1 AS ok FROM information_schema.tables
     WHERE table_schema='public' AND table_name='license_jwt_audit'`
  )
  gate('table license_jwt_audit exists', r.includes('"ok"') || r.includes('1'))
} catch (e) {
  gate('table license_jwt_audit exists', false, e.message)
}

// ── 3) Verify a representative slice of <tbl>_jwt_* policies ─────────────────
console.log('\n--- Verifying <tbl>_jwt_select / <tbl>_jwt_modify on key tables ---')
const SAMPLE_TABLES = [
  'tickets','ticket_items','clients','vehicles','work_orders',
  'loans','loan_payments','pawn_items','pawn_documents','pawn_listings',
  'inventory_items','inventory_transactions','app_settings','activity_log',
  'ecf_queue','ecf_submissions','memberships','services'
]
for (const t of SAMPLE_TABLES) {
  for (const suffix of ['jwt_select', 'jwt_modify']) {
    const pname = `${t}_${suffix}`
    try {
      const r = await runQuery(
        `SELECT 1 AS ok FROM pg_policies
         WHERE schemaname='public' AND tablename='${t}' AND policyname='${pname}'`
      )
      gate(`policy ${pname}`, r.includes('"ok"') || r.includes('1'))
    } catch (e) {
      gate(`policy ${pname}`, false, e.message)
    }
  }
}

// ── 4) Verify carve-outs intact ─────────────────────────────────────────────
console.log('\n--- Verifying public tienda carve-outs intact ---')
for (const pname of [
  'pawn_listings_public_published',
  'pawn_items_public_published',
  'pawn_documents_public_foto',
]) {
  try {
    const r = await runQuery(
      `SELECT 1 AS ok FROM pg_policies WHERE schemaname='public' AND policyname='${pname}'`
    )
    gate(`policy ${pname}`, r.includes('"ok"') || r.includes('1'))
  } catch (e) {
    gate(`policy ${pname}`, false, e.message)
  }
}

// ── 5) Verify legacy rls_anon_sync_* policies were removed ──────────────────
console.log('\n--- Verifying legacy rls_anon_sync_* policies are gone ---')
try {
  const r = await runQuery(
    `SELECT count(*)::int AS n FROM pg_policies
     WHERE schemaname='public' AND policyname LIKE 'rls_anon_sync_%'`
  )
  const m = r.match(/"n"\s*:\s*(\d+)/) || r.match(/(\d+)/)
  const n = m ? Number(m[1]) : -1
  gate('zero rls_anon_sync_* policies remain', n === 0, `count=${n}`)
} catch (e) {
  gate('zero rls_anon_sync_* policies remain', false, e.message)
}

// ── 6) Deploy edge function ─────────────────────────────────────────────────
console.log('\n--- Deploying edge function mint-license-jwt ---')
const cliCheck = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['supabase'], {
  encoding: 'utf8',
})
const haveCli = cliCheck.status === 0 && cliCheck.stdout.trim().length > 0

const endpointUrl = `${SB_URL.replace(/\/$/, '')}/functions/v1/mint-license-jwt`

if (haveCli) {
  const dep = spawnSync(
    'supabase',
    ['functions', 'deploy', 'mint-license-jwt', '--project-ref', ref, '--no-verify-jwt'],
    { cwd: ROOT, encoding: 'utf8', stdio: 'inherit', shell: process.platform === 'win32' },
  )
  gate('supabase functions deploy mint-license-jwt', dep.status === 0,
    dep.status === 0 ? '' : `exit=${dep.status}`)
} else {
  console.log('  Supabase CLI not on PATH. Deploy manually:')
  console.log(`    cd "${ROOT}"`)
  console.log(`    supabase functions deploy mint-license-jwt --project-ref ${ref} --no-verify-jwt`)
  gate('supabase functions deploy mint-license-jwt', false, 'CLI not installed — manual step required')
}

console.log('\n--- Edge function endpoint ---')
console.log(`  POST ${endpointUrl}`)
console.log(`  body: { "license_key": "<key>", "machine_id": "<optional>" }`)
console.log(`  required env vars on the function:`)
console.log(`    SUPABASE_URL              (auto-injected)`)
console.log(`    SUPABASE_SERVICE_ROLE_KEY (auto-injected)`)
console.log(`    SUPABASE_JWT_SECRET       (auto-injected)`)

console.log(`\n${pass} pass / ${fail} fail`)
process.exit(fail ? 1 : 0)
