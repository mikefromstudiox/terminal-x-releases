#!/usr/bin/env node
// Sprint 9 — Apply tickets.payment_parts JSONB column on Supabase.
//
// Closes today's audit finding E-C3:
//   "RestaurantPOS/SplitBillModal produce payment_parts in-memory but the
//    column is never persisted → cuadre + DGII 606 mis-bucket split cash/card."
//
// Dry-run by default. Pass --apply to write.
//
// Safety:
//   - ADD COLUMN IF NOT EXISTS — idempotent, can't break existing rows.
//   - No default, no constraint — older desktop clients pushing without the
//     column get NULL and keep working.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const APPLY = process.argv.includes('--apply')

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

// ── 1. Enumerate current state ─────────────────────────────────────────────
console.log('\n── Pre-flight enumeration ──')

const colBefore = await q(`
  SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='tickets' AND column_name='payment_parts'
`)
console.log('tickets.payment_parts (before):', colBefore.length ? colBefore : '<not present>')

// ── 2. Load the migration file ─────────────────────────────────────────────
const migPath = path.join(ROOT, 'supabase/migrations/20260420100000_tickets_payment_parts.sql')
const migSql = fs.readFileSync(migPath, 'utf8')
console.log(`\nMigration file: ${migPath} (${migSql.length} bytes)`)

if (!APPLY) {
  console.log('\n[dry-run] No SQL executed. Re-run with --apply to execute on prod.')
  process.exit(0)
}

// ── 3. Apply ───────────────────────────────────────────────────────────────
console.log('\nApplying to prod…')
try {
  await q(migSql)
  console.log('OK.')
} catch (e) {
  console.error('FAILED:', e.message)
  process.exit(1)
}

// ── 4. Verify ──────────────────────────────────────────────────────────────
console.log('\n── Post-apply verification ──')

const colAfter = await q(`
  SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='tickets' AND column_name='payment_parts'
`)
console.log('tickets.payment_parts (after):', colAfter)
if (!colAfter.length) { console.error('FAIL — payment_parts column not found'); process.exit(1) }
if (colAfter[0].data_type !== 'jsonb') { console.error('FAIL — expected jsonb, got', colAfter[0].data_type); process.exit(1) }

console.log('\nOK — tickets.payment_parts is live (JSONB, nullable).')
