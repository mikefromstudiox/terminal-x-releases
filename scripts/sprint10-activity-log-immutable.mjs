#!/usr/bin/env node
// Sprint 10 — Lock activity_log as append-only (MEDIUM sync-audit finding).
//
// Drops UPDATE/DELETE policies and installs a BEFORE UPDATE/DELETE trigger
// that raises feature_not_supported. Triggers fire for service_role too,
// so this is strict immutability — no bypass path from code.
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

const polBefore = await q(`
  SELECT polname, polcmd FROM pg_policy p
   JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.relname = 'activity_log'
   ORDER BY polname
`)
console.log('activity_log policies (before):')
for (const p of polBefore) console.log(`  ${p.polname.padEnd(36)} cmd=${p.polcmd}`)

const trgBefore = await q(`
  SELECT tgname FROM pg_trigger
   WHERE tgrelid = 'public.activity_log'::regclass
     AND tgname LIKE 'trg_activity_log_immutable%'
   ORDER BY tgname
`)
console.log('immutability triggers (before):', trgBefore)

// ── 2. Load migration ──────────────────────────────────────────────────────
const migPath = path.join(ROOT, 'supabase/migrations/20260420500000_activity_log_immutable.sql')
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

const polAfter = await q(`
  SELECT polname, polcmd FROM pg_policy p
   JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.relname = 'activity_log'
   ORDER BY polname
`)
console.log('activity_log policies (after):')
for (const p of polAfter) console.log(`  ${p.polname.padEnd(36)} cmd=${p.polcmd}`)

// Assert: no UPDATE/DELETE policies remain. polcmd codes: 'r'=SELECT, 'a'=INSERT, 'w'=UPDATE, 'd'=DELETE, '*'=ALL.
const bad = polAfter.filter(p => p.polcmd === 'w' || p.polcmd === 'd' || p.polcmd === '*')
if (bad.length) {
  console.error('FAIL — UPDATE/DELETE/ALL policies still present:', bad)
  process.exit(1)
}
console.log('OK — no UPDATE/DELETE/ALL policies remain.')

const trgAfter = await q(`
  SELECT tgname, tgtype FROM pg_trigger
   WHERE tgrelid = 'public.activity_log'::regclass
     AND tgname LIKE 'trg_activity_log_immutable%'
   ORDER BY tgname
`)
console.log('immutability triggers (after):', trgAfter)
if (trgAfter.length < 2) { console.error('FAIL — expected 2 triggers (upd + del)'); process.exit(1) }

// Smoke test: confirm UPDATE raises. Pick any existing row; if none, skip.
const sample = await q(`SELECT id FROM public.activity_log LIMIT 1`)
if (sample.length) {
  const testId = sample[0].id
  let raised = false
  try {
    await q(`UPDATE public.activity_log SET event_type = event_type WHERE id = '${testId}'`)
  } catch (e) {
    raised = /append-only/.test(e.message) || /feature_not_supported/.test(e.message)
    if (!raised) console.error('UPDATE raised, but not with expected message:', e.message)
  }
  console.log(`Smoke UPDATE blocked: ${raised ? 'OK' : 'FAIL'}`)
  if (!raised) process.exit(1)
} else {
  console.log('(no rows to smoke-test against; trigger existence verified above)')
}

console.log('\nOK — activity_log is now strictly append-only on prod.')
