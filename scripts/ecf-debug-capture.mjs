/**
 * ecf-debug-capture.mjs — call /api/ecf-sign with __debugXml=true to dump
 * the signed XML the web is producing right now, so we can see what DGII
 * is rejecting as "Archivo no válido".
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
if (typeof globalThis.window === 'undefined') globalThis.window = {}
const { buildECFPayload, formatDGIIDate } = await import('../packages/services/ecf.js')

const SUPA_URL = process.env.SUPABASE_URL
const ANON = process.env.SUPABASE_ANON_KEY
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY
const BID = '1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79'

const svc = createClient(SUPA_URL, SVC, { auth: { persistSession: false } })

async function mintJwt() {
  const { data } = await svc.auth.admin.generateLink({ type: 'magiclink', email: 'admin@studiox.com.do' })
  const tokenHash = data?.properties?.hashed_token
  const anon = createClient(SUPA_URL, ANON, { auth: { persistSession: false } })
  const { data: v } = await anon.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' })
  return v.session.access_token
}

const jwt = await mintJwt()
const { data: biz } = await svc.from('businesses').select('rnc,name').eq('id', BID).single()

const invoiceData = {
  tipoECF: '31',
  emisor: { rnc: (biz.rnc || '').replace(/\D/g, ''), nombre: (biz.name || '').toUpperCase(), direccion: 'Santo Domingo', email: 'admin@studiox.com.do' },
  comprador: { rnc: '101000001', nombre: 'CLIENTE PRUEBA' },
  items: [{ nombre: 'Servicio de prueba', cantidad: 1, precio: 100, indicadorFacturacion: '1', indicadorBienoServicio: '2' }],
  totales: { subtotal: 100, itbis: 18, total: 118 },
  metodoPago: 'efectivo',
  tipoIngresos: '01',
}
const payload = buildECFPayload(invoiceData)
payload.ECF.Encabezado.IdDoc.eNCF = 'E310000000999' // dummy

console.log('Calling API with __debugXml=true...')
const r = await fetch('https://terminalxpos.com/api/ecf-sign', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwt },
  body: JSON.stringify({
    business_id: BID,
    eNCF: 'E310000000999',
    tipoECF: '31',
    montoTotal: 118,
    payload,
    emisor: payload.ECF.Encabezado.Emisor,
    comprador: payload.ECF.Encabezado.Comprador,
    totales: { subtotal: 100, itbis: 18, total: 118 },
    fechaEmision: formatDGIIDate(),
    tipoIngresos: '01',
    tipoPago: '1',
    __debugXml: true,
  }),
})
const body = await r.json()
if (body?.debug?.unsignedXml) {
  fs.writeFileSync('tmp/web-current-unsigned.xml', body.debug.unsignedXml)
  fs.writeFileSync('tmp/web-current-signed.xml', body.debug.signedXml)
  console.log('Wrote tmp/web-current-unsigned.xml + signed.xml')
  console.log('\n--- UNSIGNED XML ---')
  console.log(body.debug.unsignedXml)
} else {
  console.log('No debug payload returned. Full response:', JSON.stringify(body).slice(0, 600))
}
