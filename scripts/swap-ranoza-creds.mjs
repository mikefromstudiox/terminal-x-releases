import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import dotenv from 'dotenv'
dotenv.config({ path: 'A:/Studio X HUB/Terminal X/.env' })

const SB = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
const uid = () => crypto.randomUUID()

const BUSINESS_ID = '4f789f41-76d2-4402-838f-5fe20a91641f'
const OLD_EMAIL   = 'ranoza@terminalxpos.com'

const NEW = {
  email:    'Jerryfelix@gmail.com',
  password: 'Rahel25@',
  bizName:  'Ranoza Liquor Store',
  rnc:      '132131681',
  phone:    '809-624-9192',
  address:  'Av. Camino Real, Plaza La Marquesa 2, Local #38',
  city:     'Ciudad Juan Bosch',
}

// Owner = Jerry (email holder). No PIN provided → 0000 placeholder; he logs in via email.
// Michelle = manager / main cajera.
// Dina + Cesar = cajeras on caja 1 + caja 2.
const STAFF = [
  { name: 'Jerry Felix',         username: 'owner',    pin: '0000', role: 'owner' },
  { name: 'Michelle Rodriguez',  username: 'michelle', pin: '1323', role: 'manager' },
  { name: 'Dina Encarnacion',    username: 'dina',     pin: '1313', role: 'cashier' },
  { name: 'Cesar Perez',         username: 'cesar',    pin: '1212', role: 'cashier' },
]

async function main() {
  console.log('1/6  Finding current auth user by email:', OLD_EMAIL)
  const { data: list } = await SB.auth.admin.listUsers({ page: 1, perPage: 500 })
  const current = list.users.find(u => u.email?.toLowerCase() === OLD_EMAIL.toLowerCase())
  if (!current) throw new Error(`auth user ${OLD_EMAIL} not found`)
  const authUserId = current.id
  console.log('   auth_user_id:', authUserId)

  console.log('2/6  Updating auth email + password →', NEW.email)
  const { error: authErr } = await SB.auth.admin.updateUserById(authUserId, {
    email: NEW.email, password: NEW.password, email_confirm: true,
  })
  if (authErr) throw authErr

  console.log('3/6  Updating business row…')
  const { data: bizRow } = await SB.from('businesses').select('settings').eq('id', BUSINESS_ID).single()
  const mergedSettings = {
    ...(bizRow?.settings || {}),
    biz_name: NEW.bizName, biz_rnc: NEW.rnc, biz_phone: NEW.phone,
    biz_city: NEW.city, ciudad: NEW.city, biz_address: NEW.address,
    business_type: 'tienda', biz_business_type: 'tienda',
  }
  const { error: bErr } = await SB.from('businesses').update({
    name: NEW.bizName, rnc: NEW.rnc, phone: NEW.phone,
    email: NEW.email, address: NEW.address, settings: mergedSettings,
  }).eq('id', BUSINESS_ID)
  if (bErr) throw bErr

  console.log('4/6  Upserting app_settings KV rows…')
  const kv = [
    ['business_type', 'tienda'], ['biz_business_type', 'tienda'],
    ['biz_name', NEW.bizName], ['biz_rnc', NEW.rnc],
    ['biz_phone', NEW.phone], ['biz_city', NEW.city],
    ['biz_address', NEW.address], ['itbis_pct', '18'],
  ]
  await SB.from('app_settings').upsert(
    kv.map(([k, v]) => ({ business_id: BUSINESS_ID, key: k, value: v })),
    { onConflict: 'business_id,key' },
  )

  console.log('5/6  Syncing staff: owner rename + 3 cajeras…')
  // Wipe any legacy placeholder staff for this business except the owner row
  const { data: existing } = await SB.from('staff').select('id, auth_user_id, username').eq('business_id', BUSINESS_ID)
  for (const row of (existing || [])) {
    if (row.username !== 'owner') {
      await SB.from('staff').delete().eq('id', row.id)
    }
  }
  // Update owner → Jerry
  await SB.from('staff').update({
    name: STAFF[0].name, pin_hash: sha256(STAFF[0].pin),
    role: STAFF[0].role, active: true,
  }).eq('business_id', BUSINESS_ID).eq('username', 'owner')
  // Insert the 3 cajeras
  for (const s of STAFF.slice(1)) {
    await SB.from('staff').insert({
      business_id: BUSINESS_ID, name: s.name, username: s.username,
      pin_hash: sha256(s.pin), role: s.role, active: true, supabase_id: uid(),
    })
  }

  console.log('6/6  Verifying…')
  const { data: staffFinal } = await SB.from('staff').select('name, username, role').eq('business_id', BUSINESS_ID).order('role')
  const { data: lic } = await SB.from('licenses').select('license_key, expires_at').eq('business_id', BUSINESS_ID).maybeSingle()
  const { count: invCount } = await SB.from('inventory_items').select('*', { count: 'exact', head: true }).eq('business_id', BUSINESS_ID)

  console.log('\n==== HANDOFF — RANOZA LIQUOR STORE ====')
  console.log('URL       : https://terminalxpos.com/pos')
  console.log('Email     :', NEW.email)
  console.log('Password  :', NEW.password)
  console.log('Business  :', NEW.bizName)
  console.log('RNC       :', NEW.rnc, '· Tel', NEW.phone)
  console.log('Dirección :', NEW.address, '—', NEW.city)
  console.log('Productos :', invCount)
  console.log('License   :', lic?.license_key, '| expires', lic?.expires_at)
  console.log('\nStaff / PINs:')
  for (const s of STAFF) {
    console.log(`  ${s.username.padEnd(10)} ${s.name.padEnd(22)} PIN ${s.pin}  (${s.role})`)
  }
  console.log('\nJerry has PIN 0000 (no PIN supplied) — change at first login under Empleados.')
}
main().catch(e => { console.error('FAILED:', e); process.exit(1) })
