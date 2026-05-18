#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import crypto from 'crypto'
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const adminSb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anonSb = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } })

const BIZ = 'a2185a69-8135-4de4-a6ef-58f7224ce12c'
const ownerLogin = await anonSb.auth.signInWithPassword({ email: 'fixd-roleguard@demo.terminalxpos.com', password: 'Demo2026!' })
const ownerSb = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${ownerLogin.data.session.access_token}` } },
})

await adminSb.from('tickets').delete().eq('business_id', BIZ).like('doc_number', 'FIX-R-%')

// TEST 1: underpaid (parts sum 50 vs total 100) → REJECT
const r1 = await ownerSb.from('tickets').insert({
  supabase_id: crypto.randomUUID(), business_id: BIZ,
  doc_number: 'FIX-R-1', total: 100, status: 'paid', payment_method: 'cash',
  payment_parts: [{ method: 'cash', amount: 50 }],
}).select('id').single()
if (r1.error && /underpaid_sale/.test(r1.error.message)) console.log(`✓ underpaid rejected: ${r1.error.message.slice(0,80)}`)
else { console.error('✗ underpaid accepted:', r1.error?.message || 'OK'); process.exit(1) }

// TEST 2: exact match → ACCEPT
const r2 = await ownerSb.from('tickets').insert({
  supabase_id: crypto.randomUUID(), business_id: BIZ,
  doc_number: 'FIX-R-2', total: 100, status: 'paid', payment_method: 'cash',
  payment_parts: [{ method: 'cash', amount: 100 }],
}).select('id').single()
if (r2.error) { console.error('✗ exact match rejected:', r2.error.message); process.exit(1) }
console.log('✓ exact-match accepted')

// TEST 3: overpaid (change) → ACCEPT
const r3 = await ownerSb.from('tickets').insert({
  supabase_id: crypto.randomUUID(), business_id: BIZ,
  doc_number: 'FIX-R-3', total: 100, status: 'paid', payment_method: 'cash',
  payment_parts: [{ method: 'cash', amount: 150 }],
}).select('id').single()
if (r3.error) { console.error('✗ overpaid rejected:', r3.error.message); process.exit(1) }
console.log('✓ overpaid accepted (change given)')

// TEST 4: credit sale → skip enforcement
const r4 = await ownerSb.from('tickets').insert({
  supabase_id: crypto.randomUUID(), business_id: BIZ,
  doc_number: 'FIX-R-4', total: 100, status: 'paid', payment_method: 'credit',
  payment_parts: [{ method: 'cash', amount: 0 }],
}).select('id').single()
if (r4.error) { console.error('✗ credit sale rejected:', r4.error.message); process.exit(1) }
console.log('✓ credit sale exempt (settles later)')

// Cleanup
await adminSb.from('tickets').delete().eq('business_id', BIZ).like('doc_number', 'FIX-R-%')
console.log('\n✅ Fix R — PASS')
