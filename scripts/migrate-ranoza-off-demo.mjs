import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import dotenv from 'dotenv'
dotenv.config({ path: 'A:/Studio X HUB/Terminal X/.env' })

const SB = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const uid = () => crypto.randomUUID()
const genSalt = () => crypto.randomBytes(24).toString('base64url').slice(0, 32)
const bcryptHash = (pin, salt) => bcrypt.hashSync(String(pin) + salt, 10)

const OLD_BIZ = 'bdbd4efd-8dce-4dca-bfc0-a89846d96754'   // retail demo slot currently holding Ranoza
const DEMO_EMAIL = 'admin@retail.demo.terminalxpos.com'   // stays with the demo — will be re-seeded

// New dedicated Ranoza account
const NEW_EMAIL = 'ranoza@terminalxpos.com'
const NEW_PASSWORD = 'Ranoza2026!'
const NEW_NAME = 'Licoreria Ranoza (TEST)'
const NEW_PHONE = '+1 809 000 0000'
const NEW_CITY = 'Santo Domingo'
const OWNER_PIN = '1234'
const CAJERA_PIN = '1234'

async function main() {
  console.log('1/6  Creating Ranoza auth user…')
  let newAuthId
  const { data: created, error: cErr } = await SB.auth.admin.createUser({
    email: NEW_EMAIL, password: NEW_PASSWORD, email_confirm: true,
    user_metadata: { client: 'ranoza', business_type: 'tienda' },
  })
  if (cErr) {
    if (!/registered|exists|duplicate/i.test(cErr.message)) throw cErr
    const { data: list } = await SB.auth.admin.listUsers({ page: 1, perPage: 500 })
    newAuthId = list.users.find(u => u.email === NEW_EMAIL)?.id
    if (!newAuthId) throw new Error('could not find existing user')
    await SB.auth.admin.updateUserById(newAuthId, { password: NEW_PASSWORD, email_confirm: true })
    console.log('   reused existing auth user:', newAuthId)
  } else {
    newAuthId = created.user.id
    console.log('   created new auth user:', newAuthId)
  }

  console.log('2/6  Creating new business for Ranoza…')
  const newBizId = uid()
  const settings = {
    itbis_pct: 18, ley_pct: 0, language: 'es',
    facturacion_mode: 'ncf', business_type: 'tienda', biz_business_type: 'tienda',
    ciudad: NEW_CITY, biz_city: NEW_CITY,
    biz_name: NEW_NAME, biz_phone: NEW_PHONE, biz_rnc: '',
    whatsapp_receipts: true,
  }
  const { error: bizErr } = await SB.from('businesses').insert({
    id: newBizId, owner_id: newAuthId, name: NEW_NAME,
    phone: NEW_PHONE, email: NEW_EMAIL, plan: 'pro_max', settings,
    address: 'Santo Domingo',
  })
  if (bizErr) throw bizErr
  console.log('   new business_id:', newBizId)

  console.log('3/6  Creating staff (owner + cajera) for new biz…')
  const ownerSalt = genSalt()
  const cajSalt = genSalt()
  await SB.from('staff').insert([
    {
      business_id: newBizId, auth_user_id: newAuthId, name: 'Dueño Ranoza',
      username: 'owner', pin_hash: bcryptHash(OWNER_PIN, ownerSalt),
      pin_hash_algo: 'bcrypt', pin_salt: ownerSalt,
      role: 'owner', active: true, supabase_id: uid(),
    },
    {
      business_id: newBizId, name: 'Cajera Demo', username: 'cajera1',
      pin_hash: bcryptHash(CAJERA_PIN, cajSalt),
      pin_hash_algo: 'bcrypt', pin_salt: cajSalt,
      role: 'cashier', active: true, supabase_id: uid(),
    },
  ])

  console.log('4/6  License + ncf sequences…')
  const { data: plan } = await SB.from('plans').select('id, max_users').eq('name', 'pro_max').maybeSingle()
  const CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const seg = () => Array.from({ length: 4 }, () => CH[Math.floor(Math.random() * CH.length)]).join('')
  const licenseKey = `TXL-${seg()}-${seg()}-${seg()}`
  const trialEnd = new Date(Date.now() + 30 * 86400000).toISOString()
  await SB.from('licenses').insert({
    business_id: newBizId, plan_id: plan?.id || null, license_key: licenseKey,
    status: 'active', platform: 'web', activated_at: new Date().toISOString(),
    max_users: plan?.max_users || 999, expires_at: trialEnd,
  })
  for (const type of ['B01','B02','B14','B15','E31','E32','E33','E34']) {
    await SB.from('ncf_sequences').upsert({
      business_id: newBizId, type, prefix: type, next_number: 1, max_number: 999999999,
    }, { onConflict: 'business_id,type', ignoreDuplicates: true })
  }

  console.log('4b/6 Seeding app_settings KV (business_type + biz_*) so useBusinessType picks up tienda…')
  const kv = [
    { business_id: newBizId, key: 'business_type', value: 'tienda' },
    { business_id: newBizId, key: 'biz_business_type', value: 'tienda' },
    { business_id: newBizId, key: 'biz_name', value: NEW_NAME },
    { business_id: newBizId, key: 'biz_city', value: NEW_CITY },
    { business_id: newBizId, key: 'biz_phone', value: NEW_PHONE },
    { business_id: newBizId, key: 'itbis_pct', value: '18' },
  ]
  await SB.from('app_settings').upsert(kv, { onConflict: 'business_id,key' })

  console.log('5/6  Migrating inventory_items from demo slot to new Ranoza biz…')
  const { data: moved, error: movErr } = await SB.from('inventory_items')
    .update({ business_id: newBizId }).eq('business_id', OLD_BIZ).select('id')
  if (movErr) throw movErr
  console.log('   moved', moved.length, 'products')

  console.log('6/6  Deleting old demo-slot Ranoza business (cascades everything else)…')
  const { error: delErr } = await SB.from('businesses').delete().eq('id', OLD_BIZ)
  if (delErr) throw delErr
  console.log('   deleted old business', OLD_BIZ)

  console.log('\n==== HANDOFF (Ranoza / Licoreria) ====')
  console.log('URL       : https://terminalxpos.com/pos')
  console.log('Email     :', NEW_EMAIL)
  console.log('Password  :', NEW_PASSWORD)
  console.log('PIN       :', OWNER_PIN)
  console.log('Business  :', NEW_NAME, '(', newBizId, ')')
  console.log('License   :', licenseKey)
  console.log('Products  :', moved.length)
  console.log('\nNEXT: run `node scripts/seedDemoBusinesses.js` to restore fresh tienda demo.')
  console.log('Demo auth user', DEMO_EMAIL, 'is now orphaned — seed script reuses it and creates a new Demo Tienda business.')
}
main().catch(e => { console.error('FAILED:', e); process.exit(1) })
