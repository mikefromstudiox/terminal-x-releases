#!/usr/bin/env node
// Test Fix D — role-escalation guard via DB triggers.
// 1. Service-role bypass: confirms migrations / sync can still run.
// 2. Authenticated user with role='cashier' attempting to UPDATE staff.role='owner' → must fail.
// 3. Authenticated user with role='cashier' attempting UPDATE empleados.role='owner' → must fail.
// 4. Owner authenticated → can change roles (control).

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import crypto from 'crypto'

const env = Object.fromEntries(readFileSync('.env','utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')] }))

const adminSb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anonSb  = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY,         { auth: { persistSession: false } })

// Use a disposable biz — create if needed.
const TEST_EMAIL  = 'fixd-roleguard@demo.terminalxpos.com'
const TEST_PASS   = 'Demo2026!'
const CASHIER_EMAIL = 'fixd-cashier@demo.terminalxpos.com'

// Get-or-create owner auth user
let ownerUid
{
  const list = (await adminSb.auth.admin.listUsers({ page: 1, perPage: 1000 })).data
  const u = list.users.find(u => u.email === TEST_EMAIL)
  if (u) ownerUid = u.id
  else {
    const r = await adminSb.auth.admin.createUser({ email: TEST_EMAIL, password: TEST_PASS, email_confirm: true })
    ownerUid = r.data.user.id
  }
  await adminSb.auth.admin.updateUserById(ownerUid, { password: TEST_PASS, email_confirm: true })
}

// Get-or-create the test business with ownerUid as owner
let bizId
{
  const { data: ex } = await adminSb.from('businesses').select('id').eq('owner_id', ownerUid).maybeSingle()
  if (ex) {
    bizId = ex.id
    // Wipe prior staff for this biz to keep test idempotent
    await adminSb.from('staff').delete().eq('business_id', bizId)
  } else {
    const { data, error } = await adminSb.from('businesses').insert({
      id: crypto.randomUUID(), owner_id: ownerUid, name: 'Fix D Roleguard Test',
      plan: 'pro_max', is_demo: true,
      settings: { itbis_pct: 18, language: 'es' },
    }).select('id').single()
    if (error) throw error
    bizId = data.id
  }
  await adminSb.auth.admin.updateUserById(ownerUid, { app_metadata: { business_id: bizId } })
}

// Create cashier auth user
let cashierUid
{
  const list = (await adminSb.auth.admin.listUsers({ page: 1, perPage: 1000 })).data
  const u = list.users.find(u => u.email === CASHIER_EMAIL)
  if (u) { cashierUid = u.id; await adminSb.auth.admin.updateUserById(cashierUid, { password: TEST_PASS, app_metadata: { business_id: bizId } }) }
  else {
    const r = await adminSb.auth.admin.createUser({ email: CASHIER_EMAIL, password: TEST_PASS, email_confirm: true, app_metadata: { business_id: bizId } })
    cashierUid = r.data.user.id
  }
}

// Seed owner + cashier staff rows
const ownerStaffSid = crypto.randomUUID()
const cashierStaffSid = crypto.randomUUID()
await adminSb.from('staff').insert([
  { id: crypto.randomUUID(), supabase_id: ownerStaffSid,   business_id: bizId, auth_user_id: ownerUid,   name: 'Owner',   username: 'owner',   role: 'owner',   active: true },
  { id: crypto.randomUUID(), supabase_id: cashierStaffSid, business_id: bizId, auth_user_id: cashierUid, name: 'Cashier', username: 'cashier', role: 'cashier', active: true },
])

// Seed an empleado to test empleados.role guard too
const empSid = crypto.randomUUID()
const empIns = await adminSb.from('empleados').insert({
  id: crypto.randomUUID(), supabase_id: empSid, business_id: bizId,
  nombre: 'Target Empleado', role: 'cashier', tipo: 'cajero',
  start_date: '2026-01-01',
  active: true,
}).select('id, role')
if (empIns.error) { console.error('empleados insert failed:', empIns.error); process.exit(1) }
console.log(`empleado seeded: role=${empIns.data[0].role}`)

console.log('Setup done. Running tests…\n')

// TEST 1 — service_role bypass
{
  const { error } = await adminSb.from('staff').update({ role: 'owner' }).eq('supabase_id', cashierStaffSid)
  if (error) { console.error('✗ TEST 1 FAIL — service_role blocked:', error.message); process.exit(1) }
  console.log('✓ TEST 1 PASS — service_role can update staff.role (bypass works)')
  // Revert
  await adminSb.from('staff').update({ role: 'cashier' }).eq('supabase_id', cashierStaffSid)
}

// Get cashier's JWT
const cashierLogin = await anonSb.auth.signInWithPassword({ email: CASHIER_EMAIL, password: TEST_PASS })
if (cashierLogin.error) { console.error('cashier login failed:', cashierLogin.error); process.exit(1) }
const cashierSb = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${cashierLogin.data.session.access_token}` } },
})

// TEST 2 — cashier attempts to escalate self to owner via staff.role
{
  const { data, error } = await cashierSb.from('staff').update({ role: 'owner' }).eq('supabase_id', cashierStaffSid).select('id, role')
  // Either error fires OR no rows update (PostgREST silent zero-row on trigger raise).
  if (error) {
    if (/only_owner_can_assign|cannot_assign|caller_not|role_change_requires/.test(error.message)) {
      console.log(`✓ TEST 2 PASS — cashier escalation rejected: ${error.message.slice(0, 80)}`)
    } else {
      console.error(`✗ TEST 2 unexpected error: ${error.message}`)
      process.exit(1)
    }
  } else if (!data || data.length === 0) {
    console.log('✓ TEST 2 PASS — cashier escalation silent-rejected (0 rows updated)')
  } else if (data[0].role === 'owner') {
    console.error('✗ TEST 2 FAIL — cashier ESCALATED to owner via direct UPDATE')
    process.exit(1)
  } else {
    console.log('✓ TEST 2 PASS — role unchanged after attempted escalation')
  }
  // Verify the actual row is still cashier
  const { data: v } = await adminSb.from('staff').select('role').eq('supabase_id', cashierStaffSid).single()
  if (v.role !== 'cashier') { console.error(`✗ TEST 2 STATE FAIL — staff.role is now ${v.role}`); process.exit(1) }
}

// TEST 3 — cashier attempts to escalate empleado to owner
{
  const { data, error } = await cashierSb.from('empleados').update({ role: 'owner' }).eq('supabase_id', empSid).select('id, role')
  if (error && /only_owner_can_assign|cannot_assign|caller_not|role_change_requires/.test(error.message)) {
    console.log(`✓ TEST 3 PASS — empleados role escalation rejected: ${error.message.slice(0, 80)}`)
  } else if (!data || data.length === 0) {
    console.log('✓ TEST 3 PASS — empleados escalation silent-rejected')
  } else if (data[0].role === 'owner') {
    console.error('✗ TEST 3 FAIL — cashier escalated empleado to owner')
    process.exit(1)
  } else {
    console.log('✓ TEST 3 PASS — empleado role unchanged')
  }
  const { data: v } = await adminSb.from('empleados').select('role').eq('supabase_id', empSid).maybeSingle()
  if (v && v.role !== 'cashier') { console.error(`✗ TEST 3 STATE FAIL — empleados.role is now ${v.role}`); process.exit(1) }
}

// TEST 4 — owner login, can legitimately change role (control)
const ownerLogin = await anonSb.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASS })
if (ownerLogin.error) { console.error('owner login failed:', ownerLogin.error); process.exit(1) }
const ownerSb = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${ownerLogin.data.session.access_token}` } },
})

{
  const { data, error } = await ownerSb.from('staff').update({ role: 'manager' }).eq('supabase_id', cashierStaffSid).select('role')
  if (error) { console.error(`✗ TEST 4 FAIL — owner legitimate update blocked: ${error.message}`); process.exit(1) }
  if (!data || data.length === 0) { console.error('✗ TEST 4 FAIL — owner update silently dropped'); process.exit(1) }
  if (data[0].role !== 'manager') { console.error(`✗ TEST 4 FAIL — owner update didn't stick: ${data[0].role}`); process.exit(1) }
  console.log('✓ TEST 4 PASS — owner can legitimately update role to manager (control)')
}

// Cleanup
await adminSb.from('staff').delete().eq('business_id', bizId)
await adminSb.from('empleados').delete().eq('business_id', bizId)
console.log('\n✅ Fix D — PASS')
