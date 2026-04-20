// One-shot — stamp Ranoza Liquor Store with tienda_subtype='licoreria'
// in both businesses.settings JSON and app_settings KV row.
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: 'A:/Studio X HUB/Terminal X/.env' })

const SB = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const BUSINESS_ID = '4f789f41-76d2-4402-838f-5fe20a91641f'

async function main() {
  console.log('1/3  Reading business…')
  const { data: biz, error: bizErr } = await SB.from('businesses').select('id, name, settings').eq('id', BUSINESS_ID).single()
  if (bizErr) throw bizErr
  console.log('   business:', biz.name)

  console.log('2/3  Patching businesses.settings.tienda_subtype = "licoreria"…')
  const mergedSettings = { ...(biz.settings || {}), tienda_subtype: 'licoreria' }
  const { error: uErr } = await SB.from('businesses').update({ settings: mergedSettings }).eq('id', BUSINESS_ID)
  if (uErr) throw uErr

  console.log('3/3  Upserting app_settings row (business_id,key=tienda_subtype)…')
  const { error: kErr } = await SB.from('app_settings').upsert(
    { business_id: BUSINESS_ID, key: 'tienda_subtype', value: 'licoreria' },
    { onConflict: 'business_id,key' },
  )
  if (kErr) throw kErr

  // Verify
  const { data: verify } = await SB.from('app_settings').select('key,value').eq('business_id', BUSINESS_ID).eq('key', 'tienda_subtype').maybeSingle()
  console.log('\nDONE — tienda_subtype:', verify?.value)
}
main().catch(e => { console.error('FAILED:', e); process.exit(1) })
