#!/usr/bin/env node
// Apply the 2026-04-19 migrations (users VIEW fix + restaurant sync hardening)
// to prod via Supabase Management API.

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
const SB_URL = ENV.SUPABASE_URL || ENV.VITE_SUPABASE_URL
const TOKEN = ENV.SUPABASE_ACCESS_TOKEN
if (!SB_URL || !TOKEN) { console.error('Missing SUPABASE_URL or SUPABASE_ACCESS_TOKEN'); process.exit(1) }
const ref = new URL(SB_URL).hostname.split('.')[0]

async function runSql(label, sqlFile) {
  const sql = fs.readFileSync(sqlFile, 'utf8')
  console.log(`\n=== ${label} ===`)
  console.log(`  ${path.basename(sqlFile)} (${sql.length} bytes)`)
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql })
  })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  if (!res.ok) {
    console.error(`  FAILED: HTTP ${res.status}`)
    console.error(typeof body === 'string' ? body : JSON.stringify(body, null, 2))
    process.exit(1)
  }
  console.log(`  OK — ${Array.isArray(body) ? body.length + ' rows' : 'no rows'}`)
}

await runSql('users_view_auth_fix', path.join(ROOT, 'supabase/migrations/20260419000000_users_view_auth_fix.sql'))
await runSql('restaurant_sync_hardening', path.join(ROOT, 'supabase/migrations/20260419100000_restaurant_sync_hardening.sql'))

// Verify
async function verify(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql })
  })
  return await res.json()
}

console.log('\n=== Verification ===')
const rev = await verify(`SELECT column_name FROM information_schema.columns WHERE table_name='mesas' AND column_name='rev'`)
console.log(`  mesas.rev present: ${Array.isArray(rev) && rev.length > 0}`)
const trig = await verify(`SELECT tgname FROM pg_trigger WHERE tgname='trg_mesas_rev_guard'`)
console.log(`  trg_mesas_rev_guard present: ${Array.isArray(trig) && trig.length > 0}`)
const uniqs = await verify(`SELECT conname FROM pg_constraint WHERE conname IN ('ncf_sequences_business_type_prefix_key','service_modificadores_natural_key','ticket_item_modificadores_natural_key','stylist_schedules_natural_key')`)
console.log(`  UNIQUE constraints found: ${Array.isArray(uniqs) ? uniqs.length : 0}/4`)
console.log('\nDone.')
