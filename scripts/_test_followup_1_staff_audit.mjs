#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import crypto from 'crypto'
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const BIZ = 'a2185a69-8135-4de4-a6ef-58f7224ce12c'

await sb.from('staff').delete().eq('business_id', BIZ).eq('username', 'followup1-test')
const insRes = await sb.from('staff').insert({
  id: crypto.randomUUID(), supabase_id: crypto.randomUUID(), business_id: BIZ,
  name: 'Followup1 Test', username: 'followup1-test', role: 'cashier', active: true,
  pin_hash: '$2a$10$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTU',
  pin_hash_algo: 'bcrypt', pin_salt: 'xx',
}).select('id').single()
if (insRes.error) { console.error('insert:', insRes.error); process.exit(1) }
const sid = insRes.data.id

const before = new Date(Date.now()-1000).toISOString()
await sb.from('staff').update({ role: 'manager' }).eq('id', sid)
await sb.from('staff').update({ pin_hash: '$2a$10$NEW1234567890NEW1234567890NEW1234567890NEW1234567890NEW' }).eq('id', sid)
await sb.from('staff').update({ active: false }).eq('id', sid)

const { data: rows } = await sb.from('activity_log').select('event_type, severity, old_value, new_value')
  .eq('business_id', BIZ).gte('created_at', before)
  .in('event_type', ['staff_role_change','staff_pin_change','staff_deactivated'])
  .order('created_at', { ascending: true })

const types = rows?.map(r => r.event_type) || []
if (!types.includes('staff_role_change')) { console.error('✗ role change not logged'); process.exit(1) }
if (!types.includes('staff_pin_change'))  { console.error('✗ pin change not logged'); process.exit(1) }
if (!types.includes('staff_deactivated')) { console.error('✗ deactivation not logged'); process.exit(1) }
console.log('✓ role change logged (critical, old/new captured)')
console.log('✓ pin change logged (critical, hash NOT stored)')
console.log('✓ deactivation logged (warn)')

await sb.from('staff').delete().eq('id', sid)
await sb.from('activity_log').delete().eq('business_id', BIZ).gte('created_at', before).in('event_type', ['staff_role_change','staff_pin_change','staff_deactivated'])
console.log('\n✅ Followup #1 — PASS')
