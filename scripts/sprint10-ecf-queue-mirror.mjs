#!/usr/bin/env node
// Sprint 10 — ecf_queue cloud mirror (Recovery RTO HIGH finding).
//
// Aligns Supabase ecf_queue with local SQLite so the offline e-CF queue
// survives a PC death: sync.js pushes pending rows every 5 min; a fresh
// install pulls them and processDgiiQueue() resumes submission.
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

// ── 1. Pre-flight ──────────────────────────────────────────────────────────
console.log('\n── Pre-flight enumeration ──')

const colsBefore = await q(`
  SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='ecf_queue'
   ORDER BY ordinal_position
`)
console.log('ecf_queue columns (before):')
for (const c of colsBefore) console.log(`  ${c.column_name.padEnd(22)} ${c.data_type.padEnd(30)} nullable=${c.is_nullable}`)

// Count rows — but guard against the exact columns we're about to add.
const countAll = await q(`SELECT count(*)::int AS n FROM public.ecf_queue`)
console.log(`rows (before): ${countAll[0]?.n ?? 0}`)

// Only query status/encf if those columns already exist (second run).
const hasStatus = colsBefore.some(c => c.column_name === 'status')
if (hasStatus) {
  const pendingCount = await q(`SELECT count(*)::int AS n FROM public.ecf_queue WHERE status='pending'`)
  console.log(`pending (before): ${pendingCount[0]?.n ?? 0}`)
} else {
  console.log('pending (before): n/a — status column does not exist yet')
}

// ── 2. Load migration ──────────────────────────────────────────────────────
const migPath = path.join(ROOT, 'supabase/migrations/20260420800000_ecf_queue_cloud_mirror.sql')
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
   WHERE table_schema='public' AND table_name='ecf_queue'
   ORDER BY ordinal_position
`)
console.log('ecf_queue columns (after):')
for (const c of colsAfter) console.log(`  ${c.column_name.padEnd(22)} ${c.data_type.padEnd(30)} nullable=${c.is_nullable}`)

const required = ['supabase_id','ticket_supabase_id','encf','tipo_ecf','xml_signed','environment','status','track_id','submitted_at','updated_at']
const present = new Set(colsAfter.map(c => c.column_name))
const missing = required.filter(r => !present.has(r))
if (missing.length) { console.error('FAIL — missing:', missing); process.exit(1) }

const idxAfter = await q(`
  SELECT indexname FROM pg_indexes
   WHERE schemaname='public' AND tablename='ecf_queue'
   ORDER BY indexname
`)
console.log('indexes:', idxAfter.map(r => r.indexname))

const uqBiz = idxAfter.some(r => r.indexname === 'uq_ecf_queue_biz_supabase_id')
const uqEncf = idxAfter.some(r => r.indexname === 'uq_ecf_queue_biz_encf')
const idxPending = idxAfter.some(r => r.indexname === 'idx_ecf_queue_pending')
if (!uqBiz || !uqEncf || !idxPending) {
  console.error('FAIL — expected indexes:', { uqBiz, uqEncf, idxPending })
  process.exit(1)
}

const trgAfter = await q(`
  SELECT tgname FROM pg_trigger
   WHERE tgrelid='public.ecf_queue'::regclass AND tgname='trg_ecf_queue_touch'
`)
if (!trgAfter.length) { console.error('FAIL — updated_at trigger missing'); process.exit(1) }

const pendingAfter = await q(`SELECT count(*)::int AS n FROM public.ecf_queue WHERE status='pending'`)
console.log(`pending (after): ${pendingAfter[0]?.n ?? 0}`)

console.log('\nOK — ecf_queue is cloud-mirrored. Desktop will start pushing pending e-CFs on the next 5-min sync tick.')
