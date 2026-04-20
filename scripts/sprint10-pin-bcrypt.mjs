#!/usr/bin/env node
// Sprint 10 — PIN hash hardening (S-H4/S-H5/S-H6)
//
// 1. Adds pin_hash_algo / pin_salt / pin_failed_attempts / pin_locked_until to
//    the staff table (idempotent).
// 2. Normalises any NULL algo to 'sha256' so the app-side dispatch never has
//    to special-case NULL.
// 3. Verifies the columns exist post-apply and prints row counts.
//
// Usage:
//   node scripts/sprint10-pin-bcrypt.mjs            # dry-run (prints SQL)
//   node scripts/sprint10-pin-bcrypt.mjs --apply    # apply to prod

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

const MIGRATION_FILENAME = '20260420400000_pin_bcrypt_migration.sql'
const MIGRATION_PATH = path.join(ROOT, 'supabase', 'migrations', MIGRATION_FILENAME)

async function run() {
  console.log(`\n=== Sprint 10 — PIN bcrypt migration ===`)
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`)

  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8')
  console.log(`Loaded ${MIGRATION_FILENAME} (${sql.length} bytes)`)

  if (!APPLY) {
    console.log('\n-- SQL --\n')
    console.log(sql)
    console.log('\nDry-run complete. Re-run with --apply to execute.')
    return
  }

  // BEFORE — which columns already exist?
  const before = await q(`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='staff'
       AND column_name IN ('pin_hash_algo','pin_salt','pin_failed_attempts','pin_locked_until')
     ORDER BY column_name;
  `)
  console.log(`\nBEFORE: existing hardening columns on staff = ${before?.length ?? 0}`)
  for (const r of (before || [])) console.log(`  - ${r.column_name}`)

  console.log('\nApplying migration...')
  const res = await q(sql)
  if (res === null) { console.error('Apply FAILED.'); process.exit(1) }
  console.log('Apply OK.')

  const after = await q(`
    SELECT column_name, data_type, column_default
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='staff'
       AND column_name IN ('pin_hash_algo','pin_salt','pin_failed_attempts','pin_locked_until')
     ORDER BY column_name;
  `)
  console.log(`\nAFTER: hardening columns = ${after?.length ?? 0}/4`)
  for (const r of (after || [])) console.log(`  - ${r.column_name} ${r.data_type} default=${r.column_default ?? 'NULL'}`)

  // Row-level sanity — how many rows still flagged sha256?
  const rows = await q(`SELECT pin_hash_algo, COUNT(*)::int AS n FROM staff GROUP BY pin_hash_algo ORDER BY pin_hash_algo;`)
  console.log(`\nstaff rows by pin_hash_algo:`)
  for (const r of (rows || [])) console.log(`  - ${r.pin_hash_algo ?? 'NULL'}: ${r.n}`)

  const locked = await q(`SELECT COUNT(*)::int AS n FROM staff WHERE pin_locked_until IS NOT NULL AND pin_locked_until > now();`)
  console.log(`\ncurrently locked: ${locked?.[0]?.n ?? 0}`)
}

run().catch(e => { console.error(e); process.exit(1) })
