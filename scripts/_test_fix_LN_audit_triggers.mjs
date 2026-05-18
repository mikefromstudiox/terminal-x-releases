#!/usr/bin/env node
// Test Fixes L (inventory price/cost audit) + N (empleados salary/role audit).
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import crypto from 'crypto'
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const BIZ = 'b3ffb106-6a22-4107-bd1c-85f38af30028'

// FIX L — inventory price change
const itemSid = crypto.randomUUID()
const r1 = await sb.from('inventory_items').insert({
  id: crypto.randomUUID(), supabase_id: itemSid, business_id: BIZ,
  name: 'FIX-L item ' + Date.now(), sku: 'FIX-L-' + Date.now(),
  price: 100, cost: 50, quantity: 5, min_quantity: 1, active: true,
}).select('id').single()
if (r1.error) { console.error('insert fail:', r1.error); process.exit(1) }

const before = new Date(Date.now() - 1000).toISOString()
await sb.from('inventory_items').update({ price: 150, cost: 70 }).eq('supabase_id', itemSid)

const { data: l1 } = await sb.from('activity_log').select('event_type, old_value, new_value, target_name')
  .eq('business_id', BIZ).eq('event_type', 'inventory_price_cost_change').gte('created_at', before).limit(5)
if (!l1?.length) { console.error('✗ FIX L FAIL — no activity_log row'); process.exit(1) }
console.log(`✓ FIX L PASS — inventory_price_cost_change logged: old=${l1[0].old_value} new=${l1[0].new_value}`)

// FIX N — empleados salary change
const empId = crypto.randomUUID()
const r2 = await sb.from('empleados').insert({
  id: empId, supabase_id: crypto.randomUUID(), business_id: BIZ,
  nombre: 'FIX-N empleado ' + Date.now(), role: 'cashier', tipo: 'cajero',
  start_date: '2026-01-01', salary: 25000, active: true,
}).select('id').single()
if (r2.error) { console.error('emp insert fail:', r2.error); process.exit(1) }

const before2 = new Date(Date.now() - 1000).toISOString()
await sb.from('empleados').update({ salary: 30000 }).eq('id', empId)
const { data: l2 } = await sb.from('activity_log').select('event_type, old_value, new_value, amount')
  .eq('business_id', BIZ).eq('event_type', 'empleado_salary_change').gte('created_at', before2).limit(5)
if (!l2?.length) { console.error('✗ FIX N FAIL — salary change not logged'); process.exit(1) }
console.log(`✓ FIX N PASS — empleado_salary_change logged: ${l2[0].old_value} → ${l2[0].new_value} (amount=${l2[0].amount})`)

// role change audit
const before3 = new Date(Date.now() - 1000).toISOString()
await sb.from('empleados').update({ role: 'manager' }).eq('id', empId)
const { data: l3 } = await sb.from('activity_log').select('event_type, old_value, new_value')
  .eq('business_id', BIZ).eq('event_type', 'empleado_role_change').gte('created_at', before3).limit(5)
if (!l3?.length) { console.error('✗ FIX N (role) FAIL — role change not logged'); process.exit(1) }
console.log(`✓ FIX N (role) PASS — empleado_role_change logged: ${l3[0].old_value} → ${l3[0].new_value}`)

// Cleanup
await sb.from('inventory_items').delete().eq('supabase_id', itemSid)
await sb.from('empleados').delete().eq('id', empId)
await sb.from('activity_log').delete().eq('business_id', BIZ).in('event_type', ['inventory_price_cost_change','empleado_salary_change','empleado_role_change'])
console.log('\n✅ Fixes L + N — PASS')
