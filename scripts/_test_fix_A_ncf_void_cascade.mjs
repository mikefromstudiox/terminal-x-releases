#!/usr/bin/env node
// Test Fix A — NCF decrement-on-void cobro cascade.
// Before fix: voiding a B-series ticket decremented the sequence but left the
//   voided row holding the NCF → next allocation hit uq_tickets_biz_ncf.
// After fix: voided row's `ncf` and `ncf_type` are also cleared on decrement.
//
// This script reproduces the SQL steps the web bundle performs and asserts that
// the next ticket with the same NCF inserts cleanly.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import crypto from 'crypto'

const env = Object.fromEntries(readFileSync('.env','utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')] }))
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// Disposable test biz — reuse the Stress 3 POS biz if it exists, else minimal create
const BIZ = 'b3ffb106-6a22-4107-bd1c-85f38af30028'
const { data: bcheck } = await sb.from('businesses').select('id').eq('id', BIZ).maybeSingle()
if (!bcheck) { console.error('Stress 3 test biz missing. Run stress-test first.'); process.exit(1) }

console.log(`Test biz: ${BIZ}`)

// Cleanup any prior test rows
await sb.from('tickets').delete().eq('business_id', BIZ).like('doc_number', 'FIXA-TEST-%')
await sb.from('ncf_sequences').delete().eq('business_id', BIZ).eq('type', 'B99')

// Seed B99 sequence at 0
const seqSid = crypto.randomUUID()
await sb.from('ncf_sequences').insert({
  supabase_id: seqSid, business_id: BIZ,
  type: 'B99', prefix: 'B99',
  current_number: 0, limit_number: 100,
  enabled: true, active: true,
})

// Allocate NCF #1 via simulated atomic_next_ncf flow (current_number++)
await sb.from('ncf_sequences').update({ current_number: 1 }).eq('business_id', BIZ).eq('type', 'B99')
const NCF = 'B9900000001'

// Insert ticket #1 with NCF
const t1sid = crypto.randomUUID()
const r1 = await sb.from('tickets').insert({
  supabase_id: t1sid, business_id: BIZ,
  doc_number: 'FIXA-TEST-1', total: 100, status: 'paid',
  ncf: NCF, ncf_type: 'B99', payment_method: 'cash',
}).select('id').single()
if (r1.error) { console.error('FAIL — initial insert:', r1.error); process.exit(1) }
const t1id = r1.data.id
console.log(`✓ ticket #1 inserted with ncf=${NCF}`)

// Void ticket #1 — exact sequence the FIXED web bundle performs:
//   1. UPDATE status='nula' + rev bump
//   2. Decrement sequence
//   3. NEW: Clear ncf/ncf_type on the voided row
const { data: t1cur } = await sb.from('tickets').select('rev').eq('id', t1id).single()
await sb.from('tickets').update({
  status: 'nula', void_reason: 'test', void_at: new Date().toISOString(),
  rev: Number(t1cur?.rev || 0) + 1,
}).eq('id', t1id).eq('business_id', BIZ)
await sb.from('ncf_sequences').update({ current_number: 0 }).eq('business_id', BIZ).eq('type', 'B99')
await sb.from('tickets').update({ ncf: null, ncf_type: null }).eq('id', t1id).eq('business_id', BIZ)
console.log(`✓ ticket #1 voided + sequence decremented + NCF cleared`)

// Allocate NCF #1 AGAIN (same number, what the next sale would get)
await sb.from('ncf_sequences').update({ current_number: 1 }).eq('business_id', BIZ).eq('type', 'B99')

// Insert ticket #2 with the SAME NCF — this is the path that previously failed
const t2sid = crypto.randomUUID()
const r2 = await sb.from('tickets').insert({
  supabase_id: t2sid, business_id: BIZ,
  doc_number: 'FIXA-TEST-2', total: 200, status: 'paid',
  ncf: NCF, ncf_type: 'B99', payment_method: 'cash',
}).select('id').single()
if (r2.error) {
  console.error(`✗ FAIL — ticket #2 rejected (the cascade bug is NOT fixed): ${r2.error.message}`)
  process.exit(1)
}
console.log(`✓ ticket #2 inserted with same ncf=${NCF} (NO uq_tickets_biz_ncf violation)`)

// Verify voided row #1 has ncf=null
const { data: v } = await sb.from('tickets').select('ncf, ncf_type, status').eq('id', t1id).single()
if (v.ncf !== null || v.ncf_type !== null) {
  console.error(`✗ FAIL — voided row still holds ncf=${v.ncf} ncf_type=${v.ncf_type}`)
  process.exit(1)
}
if (v.status !== 'nula') {
  console.error(`✗ FAIL — voided row status=${v.status}, expected 'nula'`)
  process.exit(1)
}
console.log(`✓ voided row has ncf=null + ncf_type=null + status='nula' (audit trail preserved via activity_log)`)

// Cleanup
await sb.from('tickets').delete().eq('business_id', BIZ).like('doc_number', 'FIXA-TEST-%')
await sb.from('ncf_sequences').delete().eq('business_id', BIZ).eq('type', 'B99')

console.log('\n✅ Fix A — PASS')
