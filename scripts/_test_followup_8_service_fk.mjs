#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import crypto from 'crypto'
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const BIZ = 'b3ffb106-6a22-4107-bd1c-85f38af30028'

// Test: insert ticket_item with ghost service_supabase_id → must reject
const tSid = crypto.randomUUID()
const t = await sb.from('tickets').insert({ supabase_id: tSid, business_id: BIZ, doc_number: 'FK-TEST', total: 100, status: 'open' }).select('id').single()
const r1 = await sb.from('ticket_items').insert({
  supabase_id: crypto.randomUUID(), business_id: BIZ,
  ticket_id: t.data.id, ticket_supabase_id: tSid,
  service_supabase_id: '00000000-0000-0000-0000-000000000000',  // ghost
  name: 'ghost', price: 100, quantity: 1,
}).select('id').single()
if (!r1.error || r1.error.code !== '23503') {
  console.error('✗ ghost service_supabase_id accepted:', r1.error?.message || 'OK')
  process.exit(1)
}
console.log('✓ ghost service_supabase_id rejected (FK 23503)')

// Real service → accept; then delete service → ticket_item.service_supabase_id SET NULL
const svcSid = crypto.randomUUID()
await sb.from('services').insert({ id: crypto.randomUUID(), supabase_id: svcSid, business_id: BIZ, name: 'FK test svc', price: 50, active: true })
const tiSid = crypto.randomUUID()
const r2 = await sb.from('ticket_items').insert({
  supabase_id: tiSid, business_id: BIZ,
  ticket_id: t.data.id, ticket_supabase_id: tSid,
  service_supabase_id: svcSid, name: 'real svc', price: 50, quantity: 1,
}).select('id').single()
if (r2.error) { console.error('valid FK rejected:', r2.error); process.exit(1) }
console.log('✓ valid service_supabase_id accepted')

await sb.from('services').delete().eq('supabase_id', svcSid)
const { data: ti } = await sb.from('ticket_items').select('service_supabase_id, name').eq('supabase_id', tiSid).single()
if (ti.service_supabase_id !== null) { console.error('✗ FK SET NULL failed; still', ti.service_supabase_id); process.exit(1) }
console.log(`✓ SET NULL fired on service delete; name snapshot preserved ("${ti.name}")`)

await sb.from('ticket_items').delete().eq('supabase_id', tiSid)
await sb.from('tickets').delete().eq('supabase_id', tSid)
console.log('\n✅ Followup #8 — PASS')
