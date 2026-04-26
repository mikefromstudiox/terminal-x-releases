#!/usr/bin/env node
// Applies supabase/migrations/20260426100002_create_loan_with_schedule_rpc.sql
// via Supabase Management API. Mirrors apply-prestamos-hardening.mjs.

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
const SQL_PATH = path.join(ROOT, 'supabase/migrations/20260426100002_create_loan_with_schedule_rpc.sql')
const SQL = fs.readFileSync(SQL_PATH, 'utf8')

const SB_URL = ENV.SUPABASE_URL
const TOKEN  = ENV.SUPABASE_ACCESS_TOKEN
if (!SB_URL || !TOKEN) { console.error('Missing SUPABASE_URL or SUPABASE_ACCESS_TOKEN'); process.exit(1) }
const ref = new URL(SB_URL).hostname.split('.')[0]

async function runQuery(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql })
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 600)}`)
  return text
}

console.log(`\n=== Applying create_loan_with_schedule RPC to ${ref} ===`)
try {
  await runQuery(SQL)
  console.log('  OK migration applied')
} catch (e) {
  console.log('  FAIL migration:', e.message)
  process.exit(2)
}

console.log('\n--- Verifying ---')
try {
  const r = await runQuery(`SELECT pg_get_functiondef(oid)::text AS def FROM pg_proc WHERE proname='create_loan_with_schedule'`)
  if (r && r.includes('create_loan_with_schedule')) console.log('  OK function exists')
  else console.log('  WARN function not found in pg_proc:', String(r).slice(0, 200))
} catch (e) { console.log('  FAIL verify:', e.message) }

console.log('\nDone.')
