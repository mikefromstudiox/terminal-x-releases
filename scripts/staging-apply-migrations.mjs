/**
 * staging-apply-migrations.mjs — applies all supabase/migrations/*.sql to the
 * terminal-x-staging project in order. Idempotent-ish (migrations use IF NOT
 * EXISTS / CREATE OR REPLACE where possible).
 *
 *   node scripts/staging-apply-migrations.mjs
 */
import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'

const envPath = resolve(import.meta.dirname, '..', '.env.staging')
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].trim()
}

const REF   = process.env.SUPABASE_PROJECT_REF
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
if (!REF || !TOKEN) { console.error('Missing SUPABASE_PROJECT_REF or SUPABASE_ACCESS_TOKEN'); process.exit(1) }

async function runSQL(sql, label) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const body = await res.text()
  if (!res.ok) {
    console.error(`[${label}] HTTP ${res.status}: ${body.slice(0, 500)}`)
    return false
  }
  return true
}

const dir = resolve(import.meta.dirname, '..', 'supabase', 'migrations')
const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()

console.log(`[staging] applying ${files.length} migrations to project ${REF}\n`)

let ok = 0, failed = 0
for (const f of files) {
  const sql = readFileSync(join(dir, f), 'utf8').trim()
  if (!sql) { console.log(`  [skip] ${f} (empty)`); continue }
  process.stdout.write(`  [${f}] ... `)
  const success = await runSQL(sql, f)
  if (success) { ok++; console.log('OK') }
  else { failed++; console.log('FAIL') }
}

console.log(`\n[staging] done: ${ok} ok / ${failed} failed of ${files.length}`)
