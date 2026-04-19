#!/usr/bin/env node
// Applies supabase/migrations/20260418000000_multipos_blocks.sql to prod + staging
// via the Supabase Management API. Verifies tables + RPCs exist. Smoke-tests
// allocate_ncf_block against the real Studio X Car Wash business_id.

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

const ENV_PROD = parseEnv(path.join(ROOT, '.env'))
const ENV_STG  = parseEnv(path.join(ROOT, '.env.staging'))
const SQL = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20260418000000_multipos_blocks.sql'), 'utf8')

function refFromUrl(url) {
  return new URL(url).hostname.split('.')[0]
}

async function runQuery(ref, token, sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql })
  })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`)
    err.status = res.status; err.body = body
    throw err
  }
  return body
}

async function apply(label, url, token) {
  const ref = refFromUrl(url)
  console.log(`\n=== ${label} (${ref}) ===`)
  if (!token) { console.log('  no access token, skipping'); return null }

  // 1) Apply migration in one shot
  try {
    await runQuery(ref, token, SQL)
    console.log('  migration applied OK')
  } catch (e) {
    console.log('  migration FAILED:', e.message.slice(0, 400))
    return { ref, ok: false, error: e.message }
  }

  // 2) Verify tables
  const tables = await runQuery(ref, token,
    `SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('ncf_blocks','doc_number_blocks','inventory_oversells','ncf_sequences_master','doc_number_master')
      ORDER BY table_name`)
  console.log('  tables:', tables.map(r => r.table_name).join(', '))

  const routines = await runQuery(ref, token,
    `SELECT routine_name FROM information_schema.routines
      WHERE routine_name IN ('allocate_ncf_block','allocate_doc_number_block','deduct_inventory_atomic','resolve_oversell')
      ORDER BY routine_name`)
  console.log('  rpcs:  ', routines.map(r => r.routine_name).join(', '))

  return { ref, ok: true, tables, routines }
}

async function smokeTest(ref, token) {
  console.log(`\n=== smoke test on ${ref} ===`)
  // Find Studio X Car Wash (or any business with an ncf_sequences row)
  const biz = await runQuery(ref, token,
    `SELECT b.id, b.name
       FROM businesses b
       JOIN ncf_sequences s ON s.business_id = b.id
      WHERE b.name ILIKE '%car wash%' OR b.name ILIKE '%studio x%'
      ORDER BY b.created_at DESC
      LIMIT 1`)
  if (!biz.length) {
    const any = await runQuery(ref, token,
      `SELECT b.id, b.name FROM businesses b JOIN ncf_sequences s ON s.business_id=b.id LIMIT 1`)
    if (!any.length) { console.log('  no business with ncf_sequences — skipping smoke'); return }
    biz.push(any[0])
  }
  const business_id = biz[0].id
  const ncfType = await runQuery(ref, token,
    `SELECT type FROM ncf_sequences WHERE business_id='${business_id}' ORDER BY type LIMIT 1`)
  const type = ncfType[0]?.type
  console.log(`  biz=${biz[0].name} (${business_id}) type=${type}`)

  const hwid = 'SMOKETEST-' + Math.random().toString(36).slice(2, 10)
  const r = await runQuery(ref, token,
    `SELECT allocate_ncf_block('${business_id}'::uuid, '${hwid}', '${type}', 10) AS blk`)
  const blk = r[0]?.blk
  console.log('  allocate_ncf_block returned:', JSON.stringify({
    range_start: blk?.range_start, range_end: blk?.range_end,
    next_available: blk?.next_available, size: blk?.size, prefix: blk?.prefix
  }))

  // Cleanup: delete the test block + rewind master
  if (blk?.id) {
    await runQuery(ref, token,
      `DELETE FROM ncf_blocks WHERE id='${blk.id}';
       UPDATE ncf_sequences_master SET next_global = ${blk.range_start}, exhausted=false
        WHERE business_id='${business_id}' AND ncf_type='${type}';`)
    console.log('  smoke cleanup OK')
  }
}

const results = {}
results.prod    = await apply('PROD',    ENV_PROD.SUPABASE_URL,    ENV_PROD.SUPABASE_ACCESS_TOKEN)
results.staging = await apply('STAGING', ENV_STG.SUPABASE_URL,     ENV_STG.SUPABASE_ACCESS_TOKEN)

if (results.prod?.ok) {
  try { await smokeTest(results.prod.ref, ENV_PROD.SUPABASE_ACCESS_TOKEN) }
  catch (e) { console.log('  smoke FAILED:', e.message.slice(0, 400)) }
}

console.log('\nDone.')
