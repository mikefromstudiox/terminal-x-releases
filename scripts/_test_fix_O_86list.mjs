#!/usr/bin/env node
// Test Fix O — 86-listed service rejected at DB layer for non-service_role caller.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import crypto from 'crypto'
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const adminSb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anonSb  = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } })

const BIZ = 'a2185a69-8135-4de4-a6ef-58f7224ce12c'   // Fix D Roleguard Test biz
const TEST_EMAIL = 'fixd-roleguard@demo.terminalxpos.com'
const TEST_PASS  = 'Demo2026!'

// Login as owner of that biz (service_role bypasses guard, so we need an authed session)
const ownerLogin = await anonSb.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASS })
if (ownerLogin.error) { console.error('login failed:', ownerLogin.error); process.exit(1) }
const ownerSb = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${ownerLogin.data.session.access_token}` } },
})

// Seed an out-of-stock service + a ticket
const svcSid = crypto.randomUUID()
await adminSb.from('services').insert({
  id: crypto.randomUUID(), supabase_id: svcSid, business_id: BIZ,
  name: 'FIX-O 86-listed service', price: 100, in_stock: false, active: true,
})

const tSid = crypto.randomUUID()
const tRes = await adminSb.from('tickets').insert({
  supabase_id: tSid, business_id: BIZ, doc_number: 'FIX-O', total: 100, status: 'open',
}).select('id').single()
if (tRes.error) { console.error('ticket insert err:', tRes.error); process.exit(1) }

// TEST 1: owner session tries to add 86-listed service to ticket → MUST FAIL
const r1 = await ownerSb.from('ticket_items').insert({
  supabase_id: crypto.randomUUID(), business_id: BIZ,
  ticket_id: tRes.data.id, ticket_supabase_id: tSid,
  service_supabase_id: svcSid,
  name: 'FIX-O 86-listed service', price: 100, quantity: 1,
}).select('id').single()
if (!r1.error || !/service_out_of_stock_86_listed/.test(r1.error.message)) {
  console.error('✗ TEST 1 FAIL — 86-listed item was accepted:', r1.error?.message)
  process.exit(1)
}
console.log(`✓ TEST 1 PASS — 86-listed service rejected: ${r1.error.message.slice(0,80)}`)

// TEST 2: in-stock service via same session → MUST PASS (control)
const svc2Sid = crypto.randomUUID()
await adminSb.from('services').insert({
  id: crypto.randomUUID(), supabase_id: svc2Sid, business_id: BIZ,
  name: 'FIX-O in-stock service', price: 100, in_stock: true, active: true,
})
const r2 = await ownerSb.from('ticket_items').insert({
  supabase_id: crypto.randomUUID(), business_id: BIZ,
  ticket_id: tRes.data.id, ticket_supabase_id: tSid,
  service_supabase_id: svc2Sid,
  name: 'FIX-O in-stock', price: 100, quantity: 1,
}).select('id').single()
if (r2.error) { console.error('✗ TEST 2 FAIL — in-stock service rejected:', r2.error.message); process.exit(1) }
console.log('✓ TEST 2 PASS — in-stock service accepted (control)')

// TEST 3: service_role can bypass (e.g. sync replay)
const r3 = await adminSb.from('ticket_items').insert({
  supabase_id: crypto.randomUUID(), business_id: BIZ,
  ticket_id: tRes.data.id, ticket_supabase_id: tSid,
  service_supabase_id: svcSid,
  name: 'FIX-O 86-listed (service_role)', price: 100, quantity: 1,
}).select('id').single()
if (r3.error) { console.error('✗ TEST 3 FAIL — service_role bypass blocked:', r3.error.message); process.exit(1) }
console.log('✓ TEST 3 PASS — service_role bypasses (sync/scripts work)')

// Cleanup
await adminSb.from('ticket_items').delete().eq('business_id', BIZ).eq('ticket_supabase_id', tSid)
await adminSb.from('tickets').delete().eq('supabase_id', tSid)
await adminSb.from('services').delete().in('supabase_id', [svcSid, svc2Sid])
console.log('\n✅ Fix O — PASS')
