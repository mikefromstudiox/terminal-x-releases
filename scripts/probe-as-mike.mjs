/**
 * probe-as-mike.mjs — mint a fresh user JWT for Mike, run the same
 * supabase-js queries the web POS issues, see if commissions return.
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const SUPA_URL = process.env.SUPABASE_URL
const ANON = process.env.SUPABASE_ANON_KEY
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY
const BID = '1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79'
const EMAIL = 'michaelmmejia@icloud.com'

const svc = createClient(SUPA_URL, SVC, { auth: { persistSession: false } })

console.log('Minting magiclink JWT for', EMAIL)
const { data, error } = await svc.auth.admin.generateLink({ type: 'magiclink', email: EMAIL })
if (error) { console.error('generateLink:', error.message); process.exit(1) }
const tokenHash = data?.properties?.hashed_token || data?.hashed_token
const anon = createClient(SUPA_URL, ANON, { auth: { persistSession: false } })
const { data: v, error: vErr } = await anon.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' })
if (vErr) { console.error('verifyOtp:', vErr.message); process.exit(1) }
const jwt = v.session.access_token
console.log('JWT minted, length', jwt.length)

// Decode JWT payload
const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'))
console.log('JWT app_metadata:', JSON.stringify(payload.app_metadata))
console.log('JWT user_metadata:', JSON.stringify(payload.user_metadata))
console.log('JWT sub:', payload.sub)

// Now query washer_commissions as Mike via supabase-js client
const mike = createClient(SUPA_URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } })

const probes = [
  { table: 'washer_commissions', cols: 'empleado_supabase_id, commission_amount, created_at, paid' },
  { table: 'seller_commissions', cols: 'empleado_supabase_id, commission_amount, created_at, paid' },
  { table: 'cajero_commissions', cols: 'empleado_supabase_id, commission_amount, created_at, paid' },
  { table: 'empleados',          cols: 'nombre, tipo, supabase_id, active' },
  { table: 'services',           cols: 'name, price' },
]

console.log('\nQuerying as Mike (auth user JWT, anon key + Bearer override):\n')
for (const p of probes) {
  const { data, error } = await mike.from(p.table).select(p.cols).eq('business_id', BID).limit(2)
  if (error) {
    console.log(`  ${p.table.padEnd(22)} ERROR: ${error.message}`)
  } else {
    console.log(`  ${p.table.padEnd(22)} returned ${data?.length || 0} rows  (sample: ${JSON.stringify(data?.[0] || null).slice(0,120)})`)
  }
}
