#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import crypto from 'crypto'
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const BIZ = 'b3ffb106-6a22-4107-bd1c-85f38af30028'

await sb.from('tickets').delete().eq('business_id', BIZ).like('doc_number', 'FIX-Q-%')
await sb.from('cuadre_caja').delete().eq('business_id', BIZ).eq('status', 'abierto')

// Open a cuadre
const cuadreSid = crypto.randomUUID()
const cRes = await sb.from('cuadre_caja').insert({
  supabase_id: cuadreSid, business_id: BIZ,
  date: new Date().toISOString().slice(0,10),
  fondo: 2000, status: 'abierto',
}).select('id').single()
if (cRes.error) { console.error('cuadre insert:', cRes.error); process.exit(1) }

// TEST 1 — insert ticket without specifying cuadre_supabase_id; trigger auto-stamps
const t1 = await sb.from('tickets').insert({
  supabase_id: crypto.randomUUID(), business_id: BIZ,
  doc_number: 'FIX-Q-1', total: 100, status: 'paid', payment_method: 'cash',
}).select('id, cuadre_supabase_id').single()
if (t1.error) { console.error('ticket insert:', t1.error); process.exit(1) }
if (t1.data.cuadre_supabase_id !== cuadreSid) {
  console.error(`✗ TEST 1 FAIL — cuadre_supabase_id=${t1.data.cuadre_supabase_id}, expected ${cuadreSid}`)
  process.exit(1)
}
console.log('✓ TEST 1 PASS — ticket auto-stamped with open cuadre supabase_id')

// TEST 2 — close cuadre, insert ticket; new ticket should NOT have cuadre_supabase_id
await sb.from('cuadre_caja').update({ status: 'cerrado', closed_at: new Date().toISOString() }).eq('supabase_id', cuadreSid)
const t2 = await sb.from('tickets').insert({
  supabase_id: crypto.randomUUID(), business_id: BIZ,
  doc_number: 'FIX-Q-2', total: 100, status: 'paid', payment_method: 'cash',
}).select('id, cuadre_supabase_id').single()
if (t2.error) { console.error('ticket 2 insert:', t2.error); process.exit(1) }
if (t2.data.cuadre_supabase_id !== null) {
  console.error(`✗ TEST 2 FAIL — ticket got cuadre_supabase_id=${t2.data.cuadre_supabase_id} after cuadre closed`)
  process.exit(1)
}
console.log('✓ TEST 2 PASS — no open cuadre → ticket left unstamped (correct)')

// Cleanup
await sb.from('tickets').delete().eq('business_id', BIZ).like('doc_number', 'FIX-Q-%')
await sb.from('cuadre_caja').delete().eq('business_id', BIZ).eq('supabase_id', cuadreSid)
console.log('\n✅ Fix Q — PASS')
