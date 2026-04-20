#!/usr/bin/env node
// Sprint 11 — persistent Supabase-backed rate limiter for /api (v2.11.2).
//
// Applies migrations/20260420900000_api_rate_limits.sql via Supabase
// Management API. Verifies table + both RPCs exist post-apply and smoke-tests
// the check_rate_limit() function with a throwaway bucket.
//
// Usage:
//   node scripts/sprint11-rate-limits.mjs            # dry-run (prints SQL)
//   node scripts/sprint11-rate-limits.mjs --apply    # apply to the project

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
    headers: {
      Authorization: `Bearer ${ENV.SUPABASE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })
  const text = await r.text()
  if (!r.ok) {
    console.error(`SQL FAILED:\n${sql.slice(0, 300)}\n-> ${text.slice(0, 400)}`)
    return null
  }
  try { return JSON.parse(text) } catch { return text }
}

const MIGRATION_FILENAME = '20260420900000_api_rate_limits.sql'
const MIGRATION_PATH = path.join(ROOT, 'supabase', 'migrations', MIGRATION_FILENAME)

async function run() {
  console.log(`\n=== Sprint 11 — persistent /api rate limiter ===`)
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`)
  console.log(`Project ref: ${ref}`)

  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8')
  console.log(`Loaded ${MIGRATION_FILENAME} (${sql.length} bytes)`)

  if (!APPLY) {
    console.log('\n-- SQL --\n')
    console.log(sql)
    console.log('\nDry-run complete. Re-run with --apply to execute.')
    return
  }

  const before = await q(`
    SELECT
      (SELECT COUNT(*)::int FROM information_schema.tables
         WHERE table_schema='public' AND table_name='api_rate_limits') AS t,
      (SELECT COUNT(*)::int FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname='public' AND p.proname='check_rate_limit') AS f1,
      (SELECT COUNT(*)::int FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname='public' AND p.proname='purge_stale_rate_limits') AS f2;
  `)
  console.log(`\nBEFORE: table=${before?.[0]?.t ?? 0} rpc1=${before?.[0]?.f1 ?? 0} rpc2=${before?.[0]?.f2 ?? 0}`)

  console.log('\nApplying migration...')
  const res = await q(sql)
  if (res === null) { console.error('Apply FAILED.'); process.exit(1) }
  console.log('Apply OK.')

  const after = await q(`
    SELECT
      (SELECT COUNT(*)::int FROM information_schema.tables
         WHERE table_schema='public' AND table_name='api_rate_limits') AS t,
      (SELECT COUNT(*)::int FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname='public' AND p.proname='check_rate_limit') AS f1,
      (SELECT COUNT(*)::int FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname='public' AND p.proname='purge_stale_rate_limits') AS f2;
  `)
  console.log(`\nAFTER: table=${after?.[0]?.t ?? 0} rpc1=${after?.[0]?.f1 ?? 0} rpc2=${after?.[0]?.f2 ?? 0}`)

  // Smoke test — burn a unique bucket, call the RPC 5 times with max=3.
  const smokeBucket = `sprint11-smoke-${Date.now()}`
  console.log(`\nSmoke-test bucket: ${smokeBucket}`)
  const rows = await q(`
    SELECT
      public.check_rate_limit('${smokeBucket}', 3) AS r1,
      public.check_rate_limit('${smokeBucket}', 3) AS r2,
      public.check_rate_limit('${smokeBucket}', 3) AS r3,
      public.check_rate_limit('${smokeBucket}', 3) AS r4,
      public.check_rate_limit('${smokeBucket}', 3) AS r5;
  `)
  const r = rows?.[0] || {}
  console.log(`  r1=${r.r1} r2=${r.r2} r3=${r.r3} r4=${r.r4} r5=${r.r5}`)
  const ok = r.r1 === true && r.r2 === true && r.r3 === true && r.r4 === false && r.r5 === false
  console.log(`  expected: true,true,true,false,false → ${ok ? 'PASS' : 'FAIL'}`)

  await q(`DELETE FROM public.api_rate_limits WHERE bucket='${smokeBucket}';`)

  // Preview row counts
  const sz = await q(`SELECT COUNT(*)::int AS n FROM public.api_rate_limits;`)
  console.log(`\napi_rate_limits row count: ${sz?.[0]?.n ?? 0}`)

  if (!ok) process.exit(2)
}

run().catch(e => { console.error(e); process.exit(1) })
