#!/usr/bin/env node
// One-shot client activation: CRM lead → Clients with Pro MAX 7-day trial + PIN.
// Usage: node scripts/activate-client.mjs --email=X --password=Y --pin=1234 [--name=...] [--plan=pro_max]

import { createClient } from '@supabase/supabase-js'
import bcryptjs from 'bcryptjs'
import crypto from 'crypto'
import { readFileSync } from 'fs'

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))

const argv = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]
}))

const email = argv.email
const password = argv.password
const pin = argv.pin
const planName = argv.plan || 'pro_max'
const overrideName = argv.name

if (!email || !password || !pin) { console.error('Required: --email, --password, --pin'); process.exit(1) }
if (!/^\d{4,6}$/.test(pin)) { console.error('PIN must be 4-6 digits'); process.exit(1) }
if (password.length < 6) { console.error('Password min 6 chars'); process.exit(1) }

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

console.log(`→ Looking up CRM lead for ${email}…`)
const { data: lead } = await supabase.from('crm_leads').select('id, business_name, contact_name, rnc, phone, status, requested_plan').eq('email', email).maybeSingle()
if (lead) console.log(`  found lead ${lead.id} (${lead.business_name || lead.contact_name}, status=${lead.status})`)
else console.log('  no CRM lead — proceeding with provided/derived business name')

const business_name = overrideName || lead?.business_name || lead?.contact_name || email.split('@')[0]
const rnc = lead?.rnc || ''
const phone = lead?.phone || ''

console.log(`→ Provisioning "${business_name}" with plan=${planName}…`)

// Auth user
const { data: authData, error: authErr } = await supabase.auth.admin.createUser({ email, password, email_confirm: true })
if (authErr) { console.error('auth.admin.createUser:', authErr); process.exit(1) }
const userId = authData.user.id
console.log(`  ✓ auth user ${userId}`)

// Plan
const { data: planRow } = await supabase.from('plans').select('id, name, max_users').eq('name', planName).maybeSingle()

// Business — 7-day trial
const now = new Date()
const trialEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
const facturacion_mode = ['pro_plus', 'pro_max'].includes(planName) ? 'ecf' : 'b_series'
const { data: biz, error: bizErr } = await supabase.from('businesses').insert({
  owner_id: userId, name: business_name.trim(), rnc, phone, email: email.trim(),
  plan: planName, is_demo: false,
  settings: { itbis_pct: 18, ley_pct: 10, language: 'es', facturacion_mode, trial_end: trialEnd, requested_plan: planName },
}).select('id').single()
if (bizErr) { console.error('businesses.insert:', bizErr); process.exit(1) }
console.log(`  ✓ business ${biz.id}`)

// app_metadata
await supabase.auth.admin.updateUserById(userId, { app_metadata: { business_id: biz.id } })
console.log(`  ✓ app_metadata.business_id set`)

// Staff (owner) with PIN
const pinSalt = crypto.randomBytes(24).toString('base64')
const staffRow = {
  business_id: biz.id, auth_user_id: userId, name: business_name.trim(),
  username: 'owner', role: 'owner', active: true,
  pin_hash: bcryptjs.hashSync(String(pin) + pinSalt, 10),
  pin_salt: pinSalt,
  pin_hash_algo: 'bcrypt',
}
const { error: staffErr } = await supabase.from('staff').insert(staffRow)
if (staffErr) { console.error('staff.insert:', staffErr); process.exit(1) }
console.log(`  ✓ staff owner created with PIN`)

// License (web — uses TXL-XXXX-XXXX-XXXX key shape per provision.js)
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const seg = () => Array.from({ length: 4 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('')
const licenseKey = 'TXL-' + seg() + '-' + seg() + '-' + seg()
const { error: licErr } = await supabase.from('licenses').insert({
  business_id: biz.id, plan_id: planRow?.id || null, license_key: licenseKey,
  status: 'active', platform: 'web', activated_at: now.toISOString(),
  expires_at: trialEnd, max_users: planRow?.max_users || 999,
})
if (licErr) { console.error('licenses.insert:', licErr); process.exit(1) }
console.log(`  ✓ license active (web, expires ${trialEnd.slice(0, 10)})`)

// NCF sequences
const ncfTypes = ['B01', 'B02', 'B14', 'B15', 'E31', 'E32', 'E33', 'E34']
for (const type of ncfTypes) {
  await supabase.from('ncf_sequences').upsert({
    supabase_id: crypto.randomUUID(),
    business_id: biz.id, type, prefix: type,
    current_number: 0, limit_number: 500,
    enabled: false, active: true,
  }, { onConflict: 'business_id,type', ignoreDuplicates: true })
}
console.log(`  ✓ ncf_sequences seeded (${ncfTypes.length} types, disabled)`)

// CRM update
if (lead?.id) {
  await supabase.from('crm_leads').update({ status: 'won', updated_at: now.toISOString() }).eq('id', lead.id)
  console.log(`  ✓ CRM lead ${lead.id} → status=won`)
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log(`✅ DONE`)
console.log(`   business_id: ${biz.id}`)
console.log(`   email:       ${email}`)
console.log(`   plan:        ${planName} (7-day trial → ${trialEnd.slice(0, 10)})`)
console.log(`   PIN set:     yes`)
console.log(`   CRM status:  ${lead ? 'won' : 'n/a (no lead)'}`)
console.log('\n   Next: node scripts/seed-carwash-bar-starter.mjs --business-id=' + biz.id)
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
