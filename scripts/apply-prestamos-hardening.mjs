#!/usr/bin/env node
// Applies supabase/migrations/20260425200000_prestamos_hardening.sql via Supabase Management API.

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
const SQL = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20260425200000_prestamos_hardening.sql'), 'utf8')

const SB_URL = ENV.SUPABASE_URL
const TOKEN = ENV.SUPABASE_ACCESS_TOKEN
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

console.log(`\n=== Applying prestamos hardening migration to ${ref} ===`)
try {
  await runQuery(SQL)
  console.log('  ✅ migration applied OK')
} catch (e) {
  console.log('  ❌ migration FAILED:', e.message)
  process.exit(2)
}

console.log('\n--- Verifying ---')
const expectedTables = ['loan_contracts','loan_renewals','pawn_documents','pawn_listings','collections_attempts']
for (const t of expectedTables) {
  try {
    await runQuery(`SELECT 1 FROM information_schema.tables WHERE table_name='${t}' AND table_schema='public'`)
    console.log(`  ✅ table ${t} exists`)
  } catch (e) { console.log(`  ❌ ${t}: ${e.message}`) }
}
const expectedBuckets = ['pawn-photos','pawn-documents','loan-documents']
for (const b of expectedBuckets) {
  try {
    const r = await runQuery(`SELECT id FROM storage.buckets WHERE id='${b}'`)
    console.log(`  ✅ bucket ${b} exists`)
  } catch (e) { console.log(`  ❌ ${b}: ${e.message}`) }
}
console.log('\nDone.')
