#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import crypto from 'crypto'
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const BIZ = '334c7e17-f344-443b-b339-46f083b8ebfb'
await sb.from('accounting_comprobantes').delete().eq('business_id', BIZ).eq('source', 'manual').like('rnc_contraparte', '1311111%')

let _seq = 0
const baseRow = (rate, tipo_bs=1) => {
  _seq++
  return {
    supabase_id: crypto.randomUUID(), business_id: BIZ,
    kind: 'venta', source: 'manual', tipo_id: 'rnc',
    period_year: 2026, period_month: 5, fecha_comprobante: '2026-05-01',
    rnc_contraparte: '1311111' + String(_seq).padStart(4, '0'),
    ncf: 'B01' + String(_seq).padStart(8, '0'),
    itbis_rate: rate, tipo_bienes_servicios: tipo_bs,
    monto_facturado: 100, itbis_facturado: 18, monto_total: 118,
  }
}

let allPass = true
for (const [rate, shouldPass] of [[27, false], [25, false], [-5, false], [99, false], [0, true], [16, true], [18, true]]) {
  const r = await sb.from('accounting_comprobantes').insert(baseRow(rate)).select('id').single()
  const checkViolation = r.error && /chk_itbis_rate/i.test(r.error.message || '')
  const accepted = !r.error
  const passed = shouldPass ? accepted : checkViolation
  console.log(`${passed ? '✓' : '✗'} itbis_rate=${rate.toString().padStart(3)} ${accepted ? 'ACCEPTED' : (checkViolation ? 'REJECTED-itbis' : `OTHER-ERR:${r.error?.code}`)} ${passed ? '(correct)' : '(WRONG)'}`)
  if (!passed) allPass = false
}

for (const [bs, shouldPass] of [[0, false], [12, false], [99, false], [1, true], [5, true], [11, true]]) {
  const r = await sb.from('accounting_comprobantes').insert(baseRow(18, bs)).select('id').single()
  const checkViolation = r.error && /chk_tipo_bs/i.test(r.error.message || '')
  const accepted = !r.error
  const passed = shouldPass ? accepted : checkViolation
  console.log(`${passed ? '✓' : '✗'} tipo_bs=${bs.toString().padStart(3)}    ${accepted ? 'ACCEPTED' : (checkViolation ? 'REJECTED-tipo_bs' : `OTHER-ERR:${r.error?.code} ${r.error?.message?.slice(0,80)}`)} ${passed ? '(correct)' : '(WRONG)'}`)
  if (!passed) allPass = false
}

await sb.from('accounting_comprobantes').delete().eq('business_id', BIZ).like('rnc_contraparte', '1311111%')
console.log(allPass ? '\n✅ Fix H — PASS' : '\n✗ FAIL')
process.exit(allPass ? 0 : 1)
