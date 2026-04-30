/**
 * Test using dgii-ecf Signature class for full e-CF signing — this is what
 * cert-step4-gen.js (which DGII accepted during certification) used.
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

const { data: biz } = await sb.from('businesses').select('settings,rnc,name').eq('id', BID).single()
const settings = typeof biz.settings === 'string' ? JSON.parse(biz.settings) : biz.settings
const certPem = settings.ecf_certificate_pem
const keyPem = settings.ecf_private_key_pem

// Reserve next eNCF
const { data: seq } = await sb.from('ncf_sequences')
  .select('current_number,prefix').eq('business_id', BID).eq('type', 'E31').single()
const next = (Number(seq.current_number) || 0) + 1
await sb.from('ncf_sequences').update({ current_number: next }).eq('business_id', BID).eq('type', 'E31')
const eNCF = `E31${String(next).padStart(10, '0')}`
console.log('eNCF:', eNCF)

// Build XML in cert-step4 style
function x(tag, val) { if (!val && val !== 0) return ''; return `<${tag}>${String(val).replace(/&/g,'&amp;').replace(/</g,'&lt;')}</${tag}>` }
function ff() { const d=new Date(); return [String(d.getDate()).padStart(2,'0'),String(d.getMonth()+1).padStart(2,'0'),d.getFullYear()].join('-')+' '+[String(d.getHours()).padStart(2,'0'),String(d.getMinutes()).padStart(2,'0'),String(d.getSeconds()).padStart(2,'0')].join(':') }
const fecha = (() => { const d=new Date(); return [String(d.getDate()).padStart(2,'0'),String(d.getMonth()+1).padStart(2,'0'),d.getFullYear()].join('-') })()

const body =
  '<Encabezado>' + x('Version','1.0') +
  '<IdDoc>' + x('TipoeCF','31') + x('eNCF',eNCF) + x('FechaVencimientoSecuencia','31-12-2028') + x('IndicadorMontoGravado','0') + x('TipoIngresos','01') + x('TipoPago','1') + '</IdDoc>' +
  '<Emisor>' + x('RNCEmisor','133410321') + x('RazonSocialEmisor','STUDIO X SRL') + x('NombreComercial','STUDIO X SRL') + x('DireccionEmisor','Santo Domingo') + x('Municipio','010100') + x('Provincia','010000') + x('CorreoEmisor','admin@studiox.com.do') + x('FechaEmision',fecha) + '</Emisor>' +
  '<Comprador>' + x('RNCComprador','101000001') + x('RazonSocialComprador','CLIENTE PRUEBA') + x('DireccionComprador','Santo Domingo') + x('MunicipioComprador','010100') + x('ProvinciaComprador','010000') + '</Comprador>' +
  '<Totales>' + x('MontoGravadoTotal','100.00') + x('MontoGravadoI1','100.00') + x('ITBIS1','18') + x('TotalITBIS','18.00') + x('TotalITBIS1','18.00') + x('MontoTotal','118.00') + x('ValorPagar','118.00') + '</Totales></Encabezado>' +
  '<DetallesItems><Item>' + x('NumeroLinea','1') + x('IndicadorFacturacion','1') + x('NombreItem','Servicio de prueba') + x('IndicadorBienoServicio','2') + x('CantidadItem','1') + x('UnidadMedida','43') + x('PrecioUnitarioItem','100.0000') + x('MontoItem','100.00') + '</Item></DetallesItems>' +
  x('FechaHoraFirma',ff())

const unsigned = '<?xml version="1.0" encoding="UTF-8"?><ECF>' + body + '</ECF>'
fs.writeFileSync('tmp/dgiiecf-unsigned.xml', unsigned)

// Sign with dgii-ecf
const { Signature, ECF, ENVIRONMENT } = require('dgii-ecf')
const signer = new Signature(keyPem, certPem)
const signed = signer.signXml(unsigned, 'ECF')
fs.writeFileSync('tmp/dgiiecf-signed.xml', signed)
console.log('Signed XML length:', signed.length)

// Submit via dgii-ecf ECF class
const ecf = new ECF({ key: keyPem, cert: certPem }, ENVIRONMENT.CERT)
console.log('Authenticating with DGII certecf...')
const auth = await ecf.authenticate()
console.log('Auth OK, token len:', auth?.length || JSON.stringify(auth).length)

console.log('Submitting...')
try {
  const result = await ecf.sendInvoice(signed)
  console.log('SUBMIT RESULT:', JSON.stringify(result, null, 2))
} catch (e) {
  console.log('SUBMIT FAILED:', e.message)
  console.log('Detail:', JSON.stringify(e.response?.data || e.cause || e.detail || ''))
}
