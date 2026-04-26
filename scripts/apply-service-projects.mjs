#!/usr/bin/env node
// Applies supabase/migrations/20260426200000_service_projects.sql via Supabase Management API.

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
const SQL = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20260426200000_service_projects.sql'), 'utf8')

const SB_URL = ENV.SUPABASE_URL
const TOKEN = ENV.SUPABASE_ACCESS_TOKEN
if (!SB_URL || !TOKEN) { console.error('Missing SUPABASE_URL or SUPABASE_ACCESS_TOKEN'); process.exit(1) }
const ref = new URL(SB_URL).hostname.split('.')[0]

async function runQuery(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql })
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 600)}`)
  return text
}

console.log(`\n=== Applying service_projects migration to ${ref} ===`)
try {
  await runQuery(SQL)
  console.log('  ✅ migration applied OK')
} catch (e) {
  console.log('  ❌ migration FAILED:', e.message)
  process.exit(2)
}

console.log('\n--- Verifying ---')
let pass = 0, fail = 0
function assert(label, ok, detail = '') {
  if (ok) { console.log(`  ✅ ${label}${detail ? ' — ' + detail : ''}`); pass++ }
  else { console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); fail++ }
}

try {
  const r = await runQuery(`SELECT 1 FROM information_schema.tables WHERE table_name='service_projects' AND table_schema='public'`)
  assert('table service_projects exists', /\b1\b/.test(r))
} catch (e) { assert('table service_projects exists', false, e.message) }

try {
  const r = await runQuery(`SELECT policyname FROM pg_policies WHERE tablename='service_projects' ORDER BY policyname`)
  assert('policy service_projects_jwt_select present', /service_projects_jwt_select/.test(r))
  assert('policy service_projects_jwt_modify present', /service_projects_jwt_modify/.test(r))
} catch (e) { assert('RLS policies', false, e.message) }

try {
  const r = await runQuery(`SELECT relrowsecurity FROM pg_class WHERE relname='service_projects'`)
  assert('RLS enabled on service_projects', /\bt\b/.test(r) || /true/i.test(r))
} catch (e) { assert('RLS enabled', false, e.message) }

try {
  const r = await runQuery(`SELECT tgname FROM pg_trigger WHERE tgname='trg_service_projects_updated_at'`)
  assert('trigger trg_service_projects_updated_at present', /trg_service_projects_updated_at/.test(r))
} catch (e) { assert('updated_at trigger', false, e.message) }

try {
  const r = await runQuery(`SELECT conname FROM pg_constraint WHERE conrelid='public.service_projects'::regclass AND contype='c'`)
  assert('CHECK constraints present (status/billing_type)', /service_projects_status_check/.test(r) && /service_projects_billing_type_check/.test(r))
} catch (e) { assert('CHECK constraints', false, e.message) }

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed.`)
process.exit(fail === 0 ? 0 : 3)
