#!/usr/bin/env node
// Sprint 8 — Apply tickets.rev optimistic concurrency guard.
//
// Closes today's sync-integrity audit finding Y-H6:
//   "tickets has no rev/version column → concurrent voids last-writer-wins
//    and void_reason/void_by silently overwrite each other across POS
//    terminals."
//
// Mirrors the mesas.rev pattern shipped in v2.3.33.
//
// Dry-run by default. Pass --apply to write.
//
// Safety:
//   - Desktop sync uses service_role key → RLS bypassed → unaffected.
//   - The guard only fires on UPDATEs where `status` changes. Normal metadata
//     edits (notes/descuento/ecf_result/etc.) pass through untouched.
//   - The migration file itself is idempotent.

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
   WHERE table_schema='public' AND table_name='tickets' AND column_name='rev'
`)
console.log('tickets.rev column (before):', colBefore.length ? colBefore : '<not present>')

const trgBefore = await q(`
  SELECT tgname, tgenabled
    FROM pg_trigger
   WHERE tgrelid = 'public.tickets'::regclass
     AND tgname = 'trg_tickets_rev_guard'
`)
console.log('trg_tickets_rev_guard (before):', trgBefore.length ? trgBefore : '<not attached>')

// ── 2. Load the migration file ─────────────────────────────────────────────
const migPath = path.join(ROOT, 'supabase/migrations/20260420000000_tickets_rev_guard.sql')
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
   WHERE table_schema='public' AND table_name='tickets' AND column_name='rev'
`)
console.log('tickets.rev column (after):', colAfter)
if (!colAfter.length) { console.error('FAIL — rev column not found'); process.exit(1) }

const trgAfter = await q(`
  SELECT tgname, tgenabled, pg_get_triggerdef(oid) AS def
    FROM pg_trigger
   WHERE tgrelid = 'public.tickets'::regclass
     AND tgname = 'trg_tickets_rev_guard'
`)
console.log('trg_tickets_rev_guard (after):', trgAfter)
if (!trgAfter.length) { console.error('FAIL — trigger not attached'); process.exit(1) }

const fnExists = await q(`
  SELECT proname FROM pg_proc WHERE proname='trg_tickets_rev_guard'
`)
console.log('trg_tickets_rev_guard function:', fnExists)

console.log('\nOK — tickets.rev optimistic concurrency guard is live.')
