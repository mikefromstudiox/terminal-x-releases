#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import crypto from 'crypto'
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const adminSb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anonSb = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const BIZ = 'a2185a69-8135-4de4-a6ef-58f7224ce12c'

await adminSb.from('staff').delete().eq('business_id', BIZ)
const ownerLogin = await anonSb.auth.signInWithPassword({ email: 'fixd-roleguard@demo.terminalxpos.com', password: 'Demo2026!' })
const ownerUid = ownerLogin.data.user.id
const ownerSid = crypto.randomUUID()
await adminSb.from('staff').insert({
  id: crypto.randomUUID(), supabase_id: ownerSid, business_id: BIZ, auth_user_id: ownerUid,
  name: 'Owner', username: 'owner', role: 'owner', active: true,
  pin_hash: '$2a$10$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTU', pin_hash_algo: 'bcrypt', pin_salt: 'xx',
}).select('id, role').single()
const { data: owner } = await adminSb.from('staff').select('id').eq('supabase_id', ownerSid).single()

const ownerSb = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${ownerLogin.data.session.access_token}` } },
})

// TEST 1: only owner tries self-downgrade → reject
const r1 = await ownerSb.from('staff').update({ role: 'manager' }).eq('id', owner.id).select('role')
if (r1.error && /last_owner_cannot_self_downgrade/.test(r1.error.message)) { console.log('✓ self-downgrade rejected:', r1.error.message.slice(0,70)) }
else { console.error('✗ self-downgrade was allowed:', r1.error?.message || 'OK'); process.exit(1) }

// TEST 2: only owner tries self-deactivate → reject
const r2 = await ownerSb.from('staff').update({ active: false }).eq('id', owner.id).select('active')
if (r2.error && /last_owner_cannot_deactivate/.test(r2.error.message)) { console.log('✓ self-deactivate rejected:', r2.error.message.slice(0,70)) }
else { console.error('✗ self-deactivate was allowed:', r2.error?.message || 'OK'); process.exit(1) }

// TEST 3: add another owner via service-role bypass, then self-downgrade should work
await adminSb.from('staff').insert({
  id: crypto.randomUUID(), supabase_id: crypto.randomUUID(), business_id: BIZ,
  name: 'Owner2', username: 'owner2', role: 'owner', active: true,
  pin_hash: '$2a$10$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTU', pin_hash_algo: 'bcrypt', pin_salt: 'xx',
})
const r3 = await ownerSb.from('staff').update({ role: 'manager' }).eq('id', owner.id).select('role')
if (r3.error) { console.error('✗ downgrade with co-owner blocked:', r3.error.message); process.exit(1) }
console.log('✓ downgrade allowed when another owner exists (control)')

await adminSb.from('staff').delete().eq('business_id', BIZ)
console.log('\n✅ last_owner_lock — PASS')
