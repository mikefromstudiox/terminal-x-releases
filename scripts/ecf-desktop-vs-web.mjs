/**
 * ecf-desktop-vs-web.mjs — Sign + submit the same factura through BOTH the
 * desktop signer and the web signer using STUDIO X SRL's cert (pulled from
 * Supabase). Whichever DGII accepts wins; the diff between the two signed
 * XMLs tells us why the other is rejected.
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { createRequire } from 'node:module'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const SUPA_URL = process.env.SUPABASE_URL
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY
const BID = '1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79'
const sb = createClient(SUPA_URL, SVC, { auth: { persistSession: false } })

console.log('=== Pulling cert from Supabase ===')
const { data: biz } = await sb.from('businesses').select('settings,rnc,name').eq('id', BID).single()
const settings = typeof biz.settings === 'string' ? JSON.parse(biz.settings) : biz.settings
const certPem = settings.ecf_certificate_pem
const keyPem = settings.ecf_private_key_pem
console.log('cert subject from settings:', settings.ecf_cert_subject)
console.log('cert pem length:', certPem.length)

console.log('\n=== Loading signers ===')
const desktopSigner = require('../electron/xml-signer.js')      // CJS
const desktopClient = require('../electron/dgii-client.js')      // CJS
const desktopBuilder = require('../electron/xml-builder.js')     // CJS

// Web ESM signer
const webSigner = await import('../web/lib/xml-signer.js')
const webClient = await import('../web/lib/dgii-client.js')
const webBuilder = await import('../web/lib/xml-builder.js')

// Reserve next eNCF
const { data: seq } = await sb.from('ncf_sequences')
  .select('current_number,prefix').eq('business_id', BID).eq('type', 'E31').single()
const next = (Number(seq.current_number) || 0) + 1
await sb.from('ncf_sequences').update({ current_number: next }).eq('business_id', BID).eq('type', 'E31')
const eNCF = `${seq.prefix || 'E31'}${String(next).padStart(10, '0')}`
console.log('eNCF reserved:', eNCF)

const fechaEmision = new Date().toISOString().slice(0, 10).split('-').reverse().join('-')
const payload = {
  ECF: {
    Encabezado: {
      Version: '1.0',
      IdDoc: { TipoeCF: '31', eNCF, FechaEmision: fechaEmision, IndicadorEnvioDiferido: '0', TipoIngresos: '01', TipoPago: '1' },
      Emisor: { RNCEmisor: (biz.rnc || '').replace(/\D/g, ''), RazonSocialEmisor: (biz.name || 'STUDIO X SRL').toUpperCase(), DireccionEmisor: 'Santo Domingo' },
      Comprador: { RNCComprador: '101000001', RazonSocialComprador: 'CLIENTE PRUEBA' },
      Totales: { MontoGravadoTotal: 100, MontoGravadoI1: 100, ITBIS1: 18, TotalITBIS: 18, TotalITBIS1: 18, MontoTotal: 118 },
    },
    DetallesItems: { Item: [{ NumeroLinea: 1, IndicadorFacturacion: '1', NombreItem: 'Servicio de prueba', IndicadorBienoServicio: '2', CantidadItem: 1, UnidadMedida: '43', PrecioUnitarioItem: 100, MontoItem: 100 }] },
  },
}

console.log('\n=== Building XML (desktop builder) ===')
const desktopXml = desktopBuilder.buildECFXml(payload, eNCF)
fs.writeFileSync('tmp/desktop-unsigned.xml', desktopXml)
console.log('desktop XML written: tmp/desktop-unsigned.xml  len:', desktopXml.length)

console.log('\n=== Building XML (web builder) ===')
// Reuse a fresh eNCF placeholder so both builders see the same input shape
const webPayload = JSON.parse(JSON.stringify(payload))
const webXml = webBuilder.buildECFXml(webPayload, eNCF)
fs.writeFileSync('tmp/web-unsigned.xml', webXml)
console.log('web XML written:     tmp/web-unsigned.xml      len:', webXml.length)

console.log('\n=== Diffing unsigned XMLs ===')
if (desktopXml === webXml) {
  console.log('  identical ✓')
} else {
  console.log('  DIFFERENT — see tmp/diff.txt')
  // Char-by-char first difference
  let i = 0
  while (i < Math.min(desktopXml.length, webXml.length) && desktopXml[i] === webXml[i]) i++
  console.log('  first divergence at char', i)
  console.log('  desktop:', JSON.stringify(desktopXml.slice(Math.max(0, i - 40), i + 80)))
  console.log('  web    :', JSON.stringify(webXml.slice(Math.max(0, i - 40), i + 80)))
}

console.log('\n=== Signing with desktop signer + submitting to DGII ===')
try {
  const { signedXml: ds } = desktopSigner.signXML(desktopXml, keyPem, certPem)
  fs.writeFileSync('tmp/desktop-signed.xml', ds)
  const tok = await desktopClient.authenticate('certecf', keyPem, certPem)
  console.log('  desktop auth token:', tok.slice(0, 30) + '...')
  const submitResult = await desktopClient.submitECF(ds, tok, 'certecf')
  console.log('  DESKTOP SUBMIT RESULT:', JSON.stringify(submitResult))
} catch (e) {
  console.log('  desktop submit FAILED:', e.message)
}

console.log('\n=== Signing with web signer + submitting to DGII ===')
try {
  const webEncf2 = (await sb.from('ncf_sequences').select('current_number').eq('business_id', BID).eq('type', 'E31').single()).data
  const next2 = (Number(webEncf2.current_number) || 0) + 1
  await sb.from('ncf_sequences').update({ current_number: next2 }).eq('business_id', BID).eq('type', 'E31')
  const eNCF2 = `E31${String(next2).padStart(10, '0')}`
  const webXml2 = webBuilder.buildECFXml(JSON.parse(JSON.stringify(payload)), eNCF2)
  const { signedXml: ws } = webSigner.signXML(webXml2, keyPem, certPem)
  fs.writeFileSync('tmp/web-signed.xml', ws)
  const tok2 = await webClient.authenticate('certecf', keyPem, certPem)
  const submitResult = await webClient.submitECF(ws, tok2, 'certecf')
  console.log('  WEB SUBMIT RESULT:', JSON.stringify(submitResult))
} catch (e) {
  console.log('  web submit FAILED:', e.message)
}
