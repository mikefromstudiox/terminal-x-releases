#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import crypto from 'crypto'
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const BIZ = 'b3ffb106-6a22-4107-bd1c-85f38af30028'

// Seed an item + ticket + ticket_item
const itemSid = crypto.randomUUID()
const itemRes = await sb.from('inventory_items').insert({
  id: crypto.randomUUID(), supabase_id: itemSid, business_id: BIZ,
  name: 'FIXJ test item ' + Date.now(), sku: 'FIXJ-SKU-' + Date.now(),
  price: 100, cost: 50, quantity: 10, active: true,
}).select('supabase_id').single()
if (itemRes.error) { console.error('inventory_item insert FAILED:', itemRes.error); process.exit(1) }
console.log('inventory_item inserted:', itemRes.data.supabase_id)

const tSid = crypto.randomUUID()
const tIns = await sb.from('tickets').insert({
  supabase_id: tSid, business_id: BIZ, doc_number: 'FIXJ-T1', total: 100, status: 'paid',
}).select('id').single()

const tiSid = crypto.randomUUID()
const tiRes = await sb.from('ticket_items').insert({
  supabase_id: tiSid, business_id: BIZ,
  ticket_id: tIns.data.id, ticket_supabase_id: tSid,
  inventory_item_supabase_id: itemSid,
  name: 'FIXJ test item (snap)', price: 100, quantity: 1,
}).select('supabase_id')
if (tiRes.error) { console.error('ticket_item insert FAILED:', tiRes.error); process.exit(1) }
console.log('ticket_item inserted')

// DELETE the inventory_item → FK SET NULL should fire
const delRes = await sb.from('inventory_items').delete().eq('supabase_id', itemSid)
if (delRes.error) { console.error('item delete failed:', delRes.error); process.exit(1) }

// Verify ticket_item.inventory_item_supabase_id is now NULL
const { data: ti } = await sb.from('ticket_items').select('inventory_item_supabase_id, name').eq('supabase_id', tiSid).single()
if (ti.inventory_item_supabase_id !== null) {
  console.error(`✗ FAIL — FK SET NULL didn't fire; inventory_item_supabase_id=${ti.inventory_item_supabase_id}`)
  process.exit(1)
}
if (!ti.name) { console.error('✗ FAIL — name snapshot lost'); process.exit(1) }
console.log(`✓ inventory_item_supabase_id set to NULL on delete; name snapshot preserved ("${ti.name}")`)

// Cleanup
await sb.from('ticket_items').delete().eq('supabase_id', tiSid)
await sb.from('tickets').delete().eq('supabase_id', tSid)
console.log('\n✅ Fix J — PASS')
