#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import crypto from 'crypto'
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const BIZ = '334c7e17-f344-443b-b339-46f083b8ebfb'
await sb.from('accounting_comprobantes').delete().eq('business_id', BIZ).like('rnc_contraparte', 'FIXI%')

// TEST 1: insert with WRONG period (claim May 2026 but date is March 2026)
const r1 = await sb.from('accounting_comprobantes').insert({
  supabase_id: crypto.randomUUID(), business_id: BIZ,
  kind: 'venta', source: 'manual', tipo_id: 'rnc',
  period_year: 2026, period_month: 5,             // CLIENT CLAIMS May
  fecha_comprobante: '2026-03-15',                // ACTUAL March
  rnc_contraparte: 'FIXI001', ncf: 'B0100099001',
  itbis_rate: 18, monto_facturado: 100, itbis_facturado: 18, monto_total: 118,
}).select('id, period_year, period_month, fecha_comprobante').single()
if (r1.error) { console.error('TEST 1 insert error:', r1.error); process.exit(1) }
if (r1.data.period_month !== 3 || r1.data.period_year !== 2026) {
  console.error(`✗ TEST 1 FAIL — period not overridden: got ${r1.data.period_year}-${r1.data.period_month}`)
  process.exit(1)
}
console.log(`✓ TEST 1 PASS — claimed 2026-05, fecha=2026-03-15 → period overridden to 2026-${r1.data.period_month}`)

// TEST 2: UPDATE fecha_comprobante → period auto-recalculates
const u = await sb.from('accounting_comprobantes').update({ fecha_comprobante: '2026-01-10' }).eq('id', r1.data.id).select('period_year, period_month').single()
if (u.data.period_month !== 1 || u.data.period_year !== 2026) {
  console.error(`✗ TEST 2 FAIL — update didn't recalc period: got ${u.data.period_year}-${u.data.period_month}`)
  process.exit(1)
}
console.log(`✓ TEST 2 PASS — UPDATE fecha=2026-01-10 → period 2026-${u.data.period_month}`)

// TEST 3: matching period (control)
const r3 = await sb.from('accounting_comprobantes').insert({
  supabase_id: crypto.randomUUID(), business_id: BIZ,
  kind: 'venta', source: 'manual', tipo_id: 'rnc',
  period_year: 2026, period_month: 4, fecha_comprobante: '2026-04-20',
  rnc_contraparte: 'FIXI002', ncf: 'B0100099002',
  itbis_rate: 18, monto_facturado: 100, itbis_facturado: 18, monto_total: 118,
}).select('period_year, period_month').single()
if (r3.data.period_month !== 4) { console.error('✗ TEST 3 FAIL'); process.exit(1) }
console.log(`✓ TEST 3 PASS — matching period unchanged (2026-04)`)

await sb.from('accounting_comprobantes').delete().eq('business_id', BIZ).like('rnc_contraparte', 'FIXI%')
console.log('\n✅ Fix I — PASS')
