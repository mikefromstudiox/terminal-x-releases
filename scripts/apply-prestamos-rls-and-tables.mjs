#!/usr/bin/env node
// Applies the two prestamos migrations sequentially via the Supabase
// Management API, then verifies tables + new policies exist.
//
//   1) 20260425600000_lending_sync_completeness.sql   (creates loan_schedule, collections_log)
//   2) 20260425500000_prestamos_rls_tighten.sql       (tightens anon RLS — runs AFTER tables exist)
//
// NOTE: Despite filename ordering, we intentionally apply the table-creation
// migration FIRST so that the RLS migration's loop finds the new tables and
// scopes them too. Both are idempotent.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
if (!SB_URL || !TOKEN) { console.error('Missing SUPABASE_URL or SUPABASE_ACCESS_TOKEN'); process.exit(1) }
const ref = new URL(SB_URL).hostname.split('.')[0]

const MIGRATIONS = [
  'supabase/migrations/20260425600000_lending_sync_completeness.sql',
  'supabase/migrations/20260425500000_prestamos_rls_tighten.sql',
]

async function runQuery(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql })
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 800)}`)
  return text
}

let pass = 0, fail = 0
function gate(name, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
  ok ? pass++ : fail++
}

console.log(`\n=== Applying prestamos RLS + tables to ${ref} ===`)
for (const rel of MIGRATIONS) {
  const sql = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  try {
    await runQuery(sql)
    gate(`apply ${rel}`, true, `${sql.length} chars`)
  } catch (e) {
    gate(`apply ${rel}`, false, e.message)
    process.exit(2)
  }
}

console.log('\n--- Verifying tables ---')
for (const t of ['loan_schedule', 'collections_log']) {
  try {
    const r = await runQuery(
      `SELECT 1 AS ok FROM information_schema.tables WHERE table_schema='public' AND table_name='${t}'`
    )
    gate(`table ${t} exists`, r.includes('"ok"') || r.includes('1'))
  } catch (e) {
    gate(`table ${t} exists`, false, e.message)
  }
}

console.log('\n--- Verifying tightened policies ---')
const POLICY_TABLES = [
  'loans','loan_payments','pawn_items',
  'loan_contracts','loan_renewals','pawn_documents','pawn_listings','collections_attempts',
  'loan_schedule','collections_log',
]
for (const t of POLICY_TABLES) {
  for (const suffix of ['anon_select', 'anon_modify']) {
    const pname = `${t}_${suffix}`
    try {
      const r = await runQuery(
        `SELECT 1 AS ok FROM pg_policies WHERE schemaname='public' AND tablename='${t}' AND policyname='${pname}'`
      )
      gate(`policy ${pname}`, r.includes('"ok"') || r.includes('1'))
    } catch (e) {
      gate(`policy ${pname}`, false, e.message)
    }
  }
}

console.log('\n--- Verifying public tienda carve-outs ---')
for (const pname of ['pawn_listings_public_published','pawn_items_public_published','pawn_documents_public_foto']) {
  try {
    const r = await runQuery(
      `SELECT 1 AS ok FROM pg_policies WHERE schemaname='public' AND policyname='${pname}'`
    )
    gate(`policy ${pname}`, r.includes('"ok"') || r.includes('1'))
  } catch (e) {
    gate(`policy ${pname}`, false, e.message)
  }
}

console.log(`\n${pass} pass / ${fail} fail`)
process.exit(fail ? 1 : 0)
