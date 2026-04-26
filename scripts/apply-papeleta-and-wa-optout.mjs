#!/usr/bin/env node
// Applies two compliance migrations:
//   1) 20260425700000_pawn_prestamista_signature.sql  (C9 — papeleta legal)
//   2) 20260425800000_clients_wa_optout.sql           (H8 — WA opt-out)
// Both are idempotent. Run when ready: node scripts/apply-papeleta-and-wa-optout.mjs

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
  'supabase/migrations/20260425700000_pawn_prestamista_signature.sql',
  'supabase/migrations/20260425800000_clients_wa_optout.sql',
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

console.log(`\n=== Applying papeleta + WA opt-out migrations to ${ref} ===`)
for (const rel of MIGRATIONS) {
  const sql = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  try {
    await runQuery(sql)
    console.log(`OK ${rel}`)
  } catch (e) {
    console.error(`FAIL ${rel}: ${e.message}`)
    process.exit(1)
  }
}

// Verify
try {
  const verify = `
    SELECT
      (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='pawn_items' AND column_name='prestamista_signature_dataurl') AS pawn_col,
      (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='clients'    AND column_name='wa_opt_out') AS wa_col;
  `
  const out = await runQuery(verify)
  console.log('Verify:', out)
} catch (e) {
  console.error('Verify failed:', e.message)
}
console.log('Done.')
