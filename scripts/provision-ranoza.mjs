import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import fs from 'node:fs'
import dotenv from 'dotenv'
dotenv.config({ path: 'A:/Studio X HUB/Terminal X/.env' })

const SB = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const uid = () => crypto.randomUUID()

// Repurpose retail demo -> Ranoza (placeholder, swap when client sends real info)
const EMAIL = 'admin@retail.demo.terminalxpos.com'
const PASSWORD = 'Demo2026!'        // unchanged
const PIN = '1234'                    // unchanged
const BIZ_NAME = 'Licoreria Ranoza (TEST)'
const BIZ_PHONE = '+1 809 000 0000'
const BIZ_CITY = 'Santo Domingo'

async function main() {
  console.log('1/5  Finding auth user for', EMAIL)
  const { data: list } = await SB.auth.admin.listUsers({ page: 1, perPage: 500 })
  const user = list.users.find(u => u.email === EMAIL)
  if (!user) throw new Error('retail demo user not found')
  console.log('   auth_user_id:', user.id)

  console.log('2/5  Finding business via staff + renaming…')
  const { data: staffRow } = await SB.from('staff').select('business_id').eq('auth_user_id', user.id).limit(1).maybeSingle()
  if (!staffRow) throw new Error('no staff row for demo user')
  const { data: biz } = await SB.from('businesses').select('id, settings').eq('id', staffRow.business_id).single()
  const businessId = biz.id
  const settings = {
    ...(biz.settings || {}),
    business_type: 'tienda',
    tienda_subtype: 'licoreria',
    biz_name: BIZ_NAME, biz_phone: BIZ_PHONE,
    ciudad: BIZ_CITY, biz_city: BIZ_CITY,
    language: 'es',
  }
  await SB.from('businesses').update({
    name: BIZ_NAME, phone: BIZ_PHONE, settings,
  }).eq('id', businessId)
  console.log('   business_id:', businessId)

  console.log('3/5  Wiping old demo data (tickets, inventory, activity, commissions, clients)…')
  for (const t of [
    'ticket_items','commissions','credit_payments','credit_notes',
    'tickets','inventory_items','clients','activity_log',
    'cuadre','caja_chica','nomina_pagos','nomina_adelantos','nomina_ajustes',
  ]) {
    const { error } = await SB.from(t).delete().eq('business_id', businessId)
    if (error && !String(error.message).includes('does not exist')) console.log('   warn', t, error.message)
  }

  console.log('4/5  Importing 979 Ranoza products…')
  const csv = fs.readFileSync('C:/Users/City/Downloads/ranoza-terminalx-import.csv', 'utf8').split(/\r?\n/)
  csv.shift()
  const rows = csv.filter(Boolean).map(line => {
    const cols = []
    let cur = '', q = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') { q = !q; continue }
      if (c === ',' && !q) { cols.push(cur); cur = ''; continue }
      cur += c
    }
    cols.push(cur)
    const [sku, barcode, name, category, price, cost, stock, min_qty] = cols
    const id = uid()
    return {
      id, business_id: businessId, supabase_id: id,
      sku, barcode, name, category: category || 'General',
      price: Number(price) || 0, cost: Number(cost) || 0,
      quantity: parseInt(stock, 10) || 0, min_quantity: parseInt(min_qty, 10) || 5,
      active: true, aplica_itbis: 1,
    }
  })
  // Dedupe by name (uq_inventory_natural = business_id+name)
  const seen = new Set()
  const deduped = []
  for (const r of rows) {
    const k = r.name.toLowerCase().trim()
    if (seen.has(k)) continue
    seen.add(k); deduped.push(r)
  }
  console.log(`   ${rows.length} rows -> ${deduped.length} after dedupe`)
  // wipe any residual items for this business first
  await SB.from('inventory_items').delete().eq('business_id', businessId)
  const CHUNK = 500
  for (let i = 0; i < deduped.length; i += CHUNK) {
    const slice = deduped.slice(i, i + CHUNK)
    const { error } = await SB.from('inventory_items').insert(slice)
    if (error) throw error
    console.log(`   inserted ${Math.min(i + CHUNK, deduped.length)}/${deduped.length}`)
  }

  console.log('5/5  Verifying…')
  const { count } = await SB.from('inventory_items').select('*', { count: 'exact', head: true }).eq('business_id', businessId)
  const { data: lic } = await SB.from('licenses').select('license_key, expires_at, status').eq('business_id', businessId).maybeSingle()

  console.log('\n==== HANDOFF (Ranoza / Licoreria) ====')
  console.log('URL       : https://terminalxpos.com/pos')
  console.log('Email     :', EMAIL)
  console.log('Password  :', PASSWORD)
  console.log('PIN       :', PIN)
  console.log('Business  :', BIZ_NAME, '(', businessId, ')')
  console.log('Products  :', count)
  console.log('License   :', lic?.license_key, '| status:', lic?.status, '| expires:', lic?.expires_at)
}
main().catch(e => { console.error('FAILED:', e); process.exit(1) })
