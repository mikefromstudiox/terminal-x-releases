#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import crypto from 'crypto'
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const BIZ = 'b3ffb106-6a22-4107-bd1c-85f38af30028'

let seq = 0
const row = (overrides) => ({
  id: crypto.randomUUID(), supabase_id: crypto.randomUUID(), business_id: BIZ,
  name: 'FIXK item ' + (++seq) + ' ' + Date.now(), sku: 'FIXK-SKU-' + seq + '-' + Date.now(),
  price: 100, cost: 50, quantity: 10, min_quantity: 1, active: true,
  ...overrides,
})

const cases = [
  ['negative price',       { price: -1 },                /chk_inventory_price_nonneg/,    false],
  ['negative cost',        { cost: -5 },                 /chk_inventory_cost_nonneg/,     false],
  ['negative quantity',    { quantity: -10 },            /chk_inventory_quantity_nonneg/, false],
  ['negative min_qty',     { min_quantity: -1 },         /chk_inventory_minqty_nonneg/,   false],
  ['empty name',           { name: '' },                 /chk_inventory_name_not_blank/,  false],
  ['whitespace name',      { name: '   ' },              /chk_inventory_name_not_blank/,  false],
  ['valid item',           {},                            null,                            true],
  ['zero price (free)',    { price: 0 },                  null,                            true],
]

let pass = 0, fail = 0
for (const [name, override, errPattern, shouldAccept] of cases) {
  const r = await sb.from('inventory_items').insert(row(override)).select('id').single()
  if (shouldAccept) {
    if (r.error) { console.log(`✗ ${name}: rejected unexpectedly: ${r.error.message?.slice(0,80)}`); fail++ }
    else { console.log(`✓ ${name}: accepted`); pass++ }
  } else {
    if (r.error && errPattern.test(r.error.message || '')) { console.log(`✓ ${name}: rejected (${r.error.code})`); pass++ }
    else if (r.error) { console.log(`✗ ${name}: wrong error: ${r.error.message?.slice(0,80)}`); fail++ }
    else { console.log(`✗ ${name}: ACCEPTED (should reject)`); fail++ }
  }
}

// Cleanup
await sb.from('inventory_items').delete().eq('business_id', BIZ).like('name', 'FIXK item%')
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
