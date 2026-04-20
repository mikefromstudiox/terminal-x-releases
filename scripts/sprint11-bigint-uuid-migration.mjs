#!/usr/bin/env node
// Sprint 11 — apply bigint->uuid migration for memberships + wash_combos
// via Supabase Management API. Reports pre-row-counts, applies the SQL
// file atomically, then verifies post-state (column types + policies).
//
// Usage: node scripts/sprint11-bigint-uuid-migration.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '..', '.env') })

const PROJECT_REF = 'csppjsoirjflumaiipqw'
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
if (!TOKEN) {
  console.error('Missing SUPABASE_ACCESS_TOKEN in .env')
  process.exit(1)
}

const MIGRATION_PATH = path.resolve(
  __dirname, '..', 'supabase', 'migrations',
  '20260421000000_bigint_business_id_to_uuid.sql'
)

async function runSQL(query) {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    }
  )
  const text = await r.text()
  if (!r.ok) throw new Error(`${r.status} ${text}`)
  try { return JSON.parse(text) } catch { return text }
}

async function main() {
  console.log('[sprint11] pre-migration row counts…')
  const pre = await runSQL(`
    SELECT
      (SELECT COUNT(*) FROM public.memberships)    AS memberships,
      (SELECT COUNT(*) FROM public.wash_combos)    AS wash_combos,
      (SELECT COUNT(*) FROM public.license_events) AS license_events;
  `)
  console.log('  ', pre)
  const { memberships, wash_combos } = pre[0]
  if (memberships > 0 || wash_combos > 0) {
    console.error(
      `ABORT: memberships=${memberships}, wash_combos=${wash_combos}. ` +
      `Tables must be empty before type conversion.`
    )
    process.exit(2)
  }

  console.log('[sprint11] applying migration SQL…')
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8')
  await runSQL(sql)
  console.log('  applied OK')

  console.log('[sprint11] verifying column types…')
  const types = await runSQL(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name IN ('memberships','wash_combos')
      AND column_name='business_id'
    ORDER BY table_name;
  `)
  console.table(types)

  console.log('[sprint11] verifying RLS policies…')
  const pols = await runSQL(`
    SELECT tablename, policyname, cmd
    FROM pg_policies
    WHERE schemaname='public'
      AND tablename IN ('memberships','wash_combos')
    ORDER BY tablename, cmd;
  `)
  console.table(pols)

  console.log('[sprint11] done')
}

main().catch(e => { console.error(e); process.exit(1) })
