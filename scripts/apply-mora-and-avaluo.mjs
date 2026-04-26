#!/usr/bin/env node
// Applies two v2.16.2 prestamos compliance migrations:
//   C7) 20260425900000_business_mora_rate.sql      — businesses.mora_rate_daily column
//   C8) 20260426000003_pawn_listings_override.sql  — pawn_listings.list_price_override + override_reason
// Both are idempotent. Run when ready: node scripts/apply-mora-and-avaluo.mjs

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
  'supabase/migrations/20260425900000_business_mora_rate.sql',
  'supabase/migrations/20260426000003_pawn_listings_override.sql',
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

console.log(`\n=== Applying mora-rate + avalúo-override migrations to ${ref} ===`)
for (const rel of MIGRATIONS) {
  const sql = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  if (!sql.trim()) { console.error(`EMPTY ${rel}`); process.exit(1) }
  try {
    await runQuery(sql)
    console.log(`OK ${rel}`)
  } catch (e) {
    console.error(`FAIL ${rel}: ${e.message}`)
    process.exit(1)
  }
}

// Verify all three columns exist
try {
  const verify = `
    SELECT
      (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='businesses'    AND column_name='mora_rate_daily')     AS biz_mora,
      (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='pawn_listings' AND column_name='list_price_override') AS list_override,
      (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='pawn_listings' AND column_name='override_reason')     AS override_reason;
  `
  const out = await runQuery(verify)
  console.log('Verify:', out)
} catch (e) {
  console.error('Verify failed:', e.message)
}
console.log('Done.')
