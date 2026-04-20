#!/usr/bin/env node
// Sprint 9 — Apply the anecf_queue table for auto-ANECF of voided e-CFs.
//
// Closes today's audit finding E-C6:
//   "Voided e-CFs never reported back to DGII via ANECF. The NCF sequence
//    stays advanced (correct per DGII) but the emitter never voids the
//    range, so DGII still considers the e-CF valid."
//
// Dry-run by default. Pass --apply to write.

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

const tblBefore = await q(`
  SELECT table_name FROM information_schema.tables
   WHERE table_schema='public' AND table_name='anecf_queue'
`)
console.log('anecf_queue table (before):', tblBefore.length ? 'EXISTS' : '<not present>')

const polBefore = await q(`
  SELECT polname FROM pg_policy p
   JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.relname = 'anecf_queue'
`)
console.log('anecf_queue policies (before):', polBefore)

// ── 2. Load the migration file ─────────────────────────────────────────────
const migPath = path.join(ROOT, 'supabase/migrations/20260420200000_anecf_queue.sql')
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

const colsAfter = await q(`
  SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='anecf_queue'
   ORDER BY ordinal_position
`)
console.log('anecf_queue columns (after):')
for (const c of colsAfter) console.log(`  ${c.column_name.padEnd(22)} ${c.data_type.padEnd(30)} nullable=${c.is_nullable}`)
if (!colsAfter.length) { console.error('FAIL — anecf_queue not found'); process.exit(1) }

const polAfter = await q(`
  SELECT polname, polcmd FROM pg_policy p
   JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.relname = 'anecf_queue'
   ORDER BY polname
`)
console.log('\nanecf_queue policies (after):', polAfter)
if (polAfter.length < 4) { console.error('FAIL — expected >=4 policies'); process.exit(1) }

const trgAfter = await q(`
  SELECT tgname FROM pg_trigger
   WHERE tgrelid = 'public.anecf_queue'::regclass
     AND tgname = 'trg_anecf_queue_touch'
`)
console.log('trg_anecf_queue_touch:', trgAfter)
if (!trgAfter.length) { console.error('FAIL — updated_at trigger missing'); process.exit(1) }

const idxAfter = await q(`
  SELECT indexname FROM pg_indexes
   WHERE schemaname='public' AND tablename='anecf_queue'
   ORDER BY indexname
`)
console.log('indexes:', idxAfter)

console.log('\nOK — anecf_queue is live on prod. Desktop will start auto-ANECFing voids on next boot.')
