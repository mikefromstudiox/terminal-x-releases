#!/usr/bin/env node
// Test Fix E — Non-owner cannot change another staff's pin_hash via direct UPDATE.
// Reuses the Fix D test biz setup.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import crypto from 'crypto'

const env = Object.fromEntries(readFileSync('.env','utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')] }))

const adminSb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anonSb  = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } })

const TEST_EMAIL    = 'fixd-roleguard@demo.terminalxpos.com'
const TEST_PASS     = 'Demo2026!'
const CASHIER_EMAIL = 'fixd-cashier@demo.terminalxpos.com'

// Resolve setup from Fix D (same biz/users).
const { data: ownerAuth } = await adminSb.auth.admin.listUsers({ page: 1, perPage: 1000 })
const ownerU   = ownerAuth.users.find(u => u.email === TEST_EMAIL)
const cashierU = ownerAuth.users.find(u => u.email === CASHIER_EMAIL)
if (!ownerU || !cashierU) { console.error('Run Fix D test first to provision setup.'); process.exit(1) }
const { data: biz } = await adminSb.from('businesses').select('id').eq('owner_id', ownerU.id).maybeSingle()
const bizId = biz.id

// Re-seed staff (idempotent)
await adminSb.from('staff').delete().eq('business_id', bizId)
const ownerStaffSid   = crypto.randomUUID()
const cashierStaffSid = crypto.randomUUID()
const insRes = await adminSb.from('staff').insert([
  { id: crypto.randomUUID(), supabase_id: ownerStaffSid,   business_id: bizId, auth_user_id: ownerU.id,   name: 'Owner',   username: 'owner',   role: 'owner',   active: true, pin_hash: '$2a$10$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTU' },
  { id: crypto.randomUUID(), supabase_id: cashierStaffSid, business_id: bizId, auth_user_id: cashierU.id, name: 'Cashier', username: 'cashier', role: 'cashier', active: true, pin_hash: '$2a$10$abcdefghijklmnopqrstuvwxyz9876543210ABCDEFGHIJKLMNOPQRSTU' },
]).select('id, role')
if (insRes.error) { console.error('staff insert error:', insRes.error); process.exit(1) }
console.log('staff inserted:', insRes.data?.length)
const { data: rows } = await adminSb.from('staff').select('id, supabase_id, role').eq('business_id', bizId)
console.log('staff after insert:', rows?.length, rows?.map(r=>r.role))
const ownerStaff   = rows.find(r => r.role === 'owner')
const cashierStaff = rows.find(r => r.role === 'cashier')
if (!ownerStaff || !cashierStaff) { console.error('staff not found'); process.exit(1) }

// Cashier authenticates
const cashierLogin = await anonSb.auth.signInWithPassword({ email: CASHIER_EMAIL, password: TEST_PASS })
const cashierSb = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${cashierLogin.data.session.access_token}` } },
})

// TEST 1 — cashier tries to set owner's pin_hash (privilege escalation)
{
  const { data, error } = await cashierSb.from('staff').update({ pin_hash: '$2a$10$HIJACKEDHIJACKEDHIJACKEDHIJACKEDHIJACKEDHIJACKEDHIJACKED12' }).eq('id', ownerStaff.id).select('id, pin_hash')
  if (error && /only_owner_can_reset|pin_change_requires|caller_not/.test(error.message)) {
    console.log(`✓ TEST 1 PASS — cashier rejected: ${error.message.slice(0, 70)}`)
  } else if (!data || data.length === 0) {
    console.log('✓ TEST 1 PASS — silent-rejected (0 rows)')
  } else {
    console.error('✗ TEST 1 FAIL — cashier hijacked owner PIN'); process.exit(1)
  }
  // Confirm via admin
  const { data: v } = await adminSb.from('staff').select('pin_hash').eq('id', ownerStaff.id).single()
  if (v.pin_hash === '$2a$10$HIJACKEDHIJACKEDHIJACKEDHIJACKEDHIJACKEDHIJACKEDHIJACKED12') { console.error('✗ STATE FAIL — owner PIN was actually hijacked'); process.exit(1) }
}

// TEST 2 — cashier changes OWN pin_hash (allowed)
{
  const { data, error } = await cashierSb.from('staff').update({ pin_hash: '$2a$10$NEWCASHIERNEWCASHIERNEWCASHIERNEWCASHIERNEWCASHIERNEWCASH' }).eq('id', cashierStaff.id).select('pin_hash')
  // Self-PIN-change is allowed by trigger (oldPin verification happens in web.js, not here).
  if (error) { console.error(`✗ TEST 2 FAIL — cashier self-PIN-change blocked: ${error.message}`); process.exit(1) }
  if (!data || data.length === 0) { console.error('✗ TEST 2 FAIL — silent-dropped'); process.exit(1) }
  if (data[0].pin_hash !== '$2a$10$NEWCASHIERNEWCASHIERNEWCASHIERNEWCASHIERNEWCASHIERNEWCASH') { console.error('✗ TEST 2 FAIL — pin not updated'); process.exit(1) }
  console.log('✓ TEST 2 PASS — cashier can change own pin_hash')
}

// TEST 3 — owner resets cashier's pin_hash (allowed)
const ownerLogin = await anonSb.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASS })
const ownerSb = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${ownerLogin.data.session.access_token}` } },
})
{
  const { data, error } = await ownerSb.from('staff').update({ pin_hash: '$2a$10$RESETBYOWNERRESETBYOWNERRESETBYOWNERRESETBYOWNERRESETBY12' }).eq('id', cashierStaff.id).select('pin_hash')
  if (error) { console.error(`✗ TEST 3 FAIL — owner reset blocked: ${error.message}`); process.exit(1) }
  if (!data || data.length === 0) { console.error('✗ TEST 3 FAIL — owner reset silent-dropped'); process.exit(1) }
  if (data[0].pin_hash !== '$2a$10$RESETBYOWNERRESETBYOWNERRESETBYOWNERRESETBYOWNERRESETBY12') { console.error('✗ TEST 3 FAIL — pin not updated'); process.exit(1) }
  console.log('✓ TEST 3 PASS — owner can reset cashier pin_hash (control)')
}

// Cleanup
await adminSb.from('staff').delete().eq('business_id', bizId)
console.log('\n✅ Fix E — PASS')
