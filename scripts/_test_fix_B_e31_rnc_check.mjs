#!/usr/bin/env node
// Test Fix B — E31 ticket without client_rnc must be rejected at DB layer.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import crypto from 'crypto'

const env = Object.fromEntries(readFileSync('.env','utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')] }))
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const BIZ = 'b3ffb106-6a22-4107-bd1c-85f38af30028'
const NCF = 'E3100000099'

// Cleanup
await sb.from('tickets').delete().eq('business_id', BIZ).like('doc_number', 'FIXB-%')

// Attempt #1: E31 with NULL client_rnc — MUST FAIL
const t1 = await sb.from('tickets').insert({
  supabase_id: crypto.randomUUID(), business_id: BIZ,
  doc_number: 'FIXB-NULL-RNC', total: 100, status: 'paid',
  ncf: NCF, ncf_type: 'E31', client_rnc: null,
}).select('id').single()
if (!t1.error) {
  console.error('✗ FAIL — E31 with NULL client_rnc was ACCEPTED — constraint not enforced')
  await sb.from('tickets').delete().eq('business_id', BIZ).like('doc_number', 'FIXB-%')
  process.exit(1)
}
console.log(`✓ E31 with NULL client_rnc REJECTED: ${t1.error.code} ${t1.error.message?.slice(0, 100)}`)

// Attempt #2: E31 with EMPTY client_rnc — MUST FAIL
const t2 = await sb.from('tickets').insert({
  supabase_id: crypto.randomUUID(), business_id: BIZ,
  doc_number: 'FIXB-EMPTY-RNC', total: 100, status: 'paid',
  ncf: NCF, ncf_type: 'E31', client_rnc: '   ',
}).select('id').single()
if (!t2.error) {
  console.error('✗ FAIL — E31 with empty/whitespace client_rnc was ACCEPTED')
  await sb.from('tickets').delete().eq('business_id', BIZ).like('doc_number', 'FIXB-%')
  process.exit(1)
}
console.log(`✓ E31 with whitespace client_rnc REJECTED: ${t2.error.code}`)

// Attempt #3: E31 with valid client_rnc — MUST PASS
const t3 = await sb.from('tickets').insert({
  supabase_id: crypto.randomUUID(), business_id: BIZ,
  doc_number: 'FIXB-VALID', total: 100, status: 'paid',
  ncf: NCF, ncf_type: 'E31', client_rnc: '131234567',
}).select('id').single()
if (t3.error) {
  console.error(`✗ FAIL — E31 with valid RNC was REJECTED: ${t3.error.message}`)
  process.exit(1)
}
console.log(`✓ E31 with valid RNC=131234567 ACCEPTED`)

// Attempt #4: B01 with NULL client_rnc — MUST PASS (constraint scoped to E31)
const t4 = await sb.from('tickets').insert({
  supabase_id: crypto.randomUUID(), business_id: BIZ,
  doc_number: 'FIXB-B01', total: 100, status: 'paid',
  ncf: 'B0100099991', ncf_type: 'B01', client_rnc: null,
}).select('id').single()
if (t4.error) {
  console.error(`✗ FAIL — B01 ticket without RNC was REJECTED (constraint over-reaches): ${t4.error.message}`)
  process.exit(1)
}
console.log(`✓ B01 with NULL client_rnc ACCEPTED (B-series unaffected)`)

// Cleanup
await sb.from('tickets').delete().eq('business_id', BIZ).like('doc_number', 'FIXB-%')
console.log('\n✅ Fix B — PASS')
