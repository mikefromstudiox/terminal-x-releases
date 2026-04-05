/**
 * cert-step4-gen.js — PERSONAL REFERENCE (Studio X Tech RNC 133410321)
 *
 * Generates Step 4 simulation XMLs with Michael's real Studio X data. Used during
 * his own DGII certification (Steps 1-15 complete). Hardcoded paths below.
 *
 * For the reusable client-facing version, see tools/ecf-gen.js (config-driven).
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { Signature } = require('dgii-ecf')

const keyPem = fs.readFileSync('C:/Users/City/Downloads/dgii-key.pem', 'utf8')
const certPem = fs.readFileSync('C:/Users/City/Downloads/dgii-cert.pem', 'utf8')
const signer = new Signature(keyPem, certPem)

const DIR = path.join(__dirname, '../test-xmls/step4-sim')
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true })

function x(tag, val) { if (!val && val !== 0) return ''; return `<${tag}>${String(val).replace(/&/g,'&amp;').replace(/</g,'&lt;')}</${tag}>` }

const E = { rnc:'133410321', nombre:'STUDIO X SRL', comercial:'STUDIO X', dir:'TEODORO CHASSEROU, No. 20, MANGANAGUA', mun:'010100', prov:'010000', tel:'809-870-0712', email:'ADMIN@STUDIOX.COM.DO', fecha:'27-03-2026' }
const C = { rnc:'131880681', nombre:'DOCUMENTOS ELECTRONICOS DE 03', email:'test@test.com', dir:'Santo Domingo', mun:'010100', prov:'010000' }
const GOV = { rnc:'401007540', nombre:'DIRECCION GENERAL DE IMPUESTOS INTERNOS', dir:'Ave. Mexico, Santo Domingo', mun:'010100', prov:'010000' }

function emisor() {
  return '<Emisor>' + x('RNCEmisor',E.rnc) + x('RazonSocialEmisor',E.nombre) + x('NombreComercial',E.comercial) + x('DireccionEmisor',E.dir) + x('Municipio',E.mun) + x('Provincia',E.prov) + '<TablaTelefonoEmisor>' + x('TelefonoEmisor',E.tel) + '</TablaTelefonoEmisor>' + x('CorreoEmisor',E.email) + x('FechaEmision',E.fecha) + '</Emisor>'
}
function comp(c) { return '<Comprador>' + x('RNCComprador',c.rnc) + x('RazonSocialComprador',c.nombre) + (c.email?x('CorreoComprador',c.email):'') + x('DireccionComprador',c.dir) + x('MunicipioComprador',c.mun) + x('ProvinciaComprador',c.prov) + '</Comprador>' }
function items(arr) {
  let s = '<DetallesItems>'
  arr.forEach((it,i) => { s += '<Item>' + x('NumeroLinea',i+1) + x('IndicadorFacturacion',it.f||'1') + x('NombreItem',it.n) + x('IndicadorBienoServicio',it.b||'2') + x('CantidadItem',it.c) + x('UnidadMedida',it.u||'43') + x('PrecioUnitarioItem',it.p) + x('MontoItem',it.m) + '</Item>' })
  return s + '</DetallesItems>'
}
function ff() { const d=new Date(); return [String(d.getDate()).padStart(2,'0'),String(d.getMonth()+1).padStart(2,'0'),d.getFullYear()].join('-')+' '+[String(d.getHours()).padStart(2,'0'),String(d.getMinutes()).padStart(2,'0'),String(d.getSeconds()).padStart(2,'0')].join(':') }

const manifest = []
function signSave(tipo, encf, xmlStr, isRFCE) {
  const signed = signer.signXml(xmlStr, isRFCE ? 'RFCE' : 'ECF')
  const fn = (isRFCE ? 'RFCE_' : '') + E.rnc + encf + '.xml'
  fs.writeFileSync(path.join(DIR, fn), signed, 'utf8')
  manifest.push({ fileName: fn, encf, tipo: isRFCE ? 'RFCE' : tipo })
  console.log('OK ' + fn)
  return signed
}

// ── Items ──
const wash = [{n:'Lavado Premium Full',c:'2',p:'800.0000',m:'1600.00',b:'2'}]
const detail = [{n:'Detallado Interior Completo',c:'1',p:'2500.0000',m:'2500.00',b:'2'}]
const ceramic = [{n:'Ceramic Coating Pro',c:'1',p:'15000.0000',m:'15000.00',b:'2'}]
const big = [{n:'Paquete Corporativo Anual',c:'2',p:'150000.0000',m:'300000.00',b:'2'}]
const small = [{n:'Lavado Basico Express',c:'1',p:'500.0000',m:'500.00',b:'2'}]
const exp = [{n:'Terminal X POS License',c:'1',p:'5000.0000',m:'5000.00',b:'2',f:'3'}]
const supply = [{n:'Suministros Limpieza',c:'10',p:'500.0000',m:'5000.00',b:'1'}]

// Sequence offset — skip consumed sequences from failed attempts
const SEQ = { '31':1800, '32':1800, '33':1800, '34':1800, '41':1800, '43':1800, '44':1800, '45':1800, '46':1800, '47':1800 }

// ── 4x E31 ──
const e31items = [wash, wash, ceramic, detail]
const e31subs = ['1600.00','1600.00','15000.00','2500.00']
for (let i = 0; i < 4; i++) {
  const encf = 'E31' + String(SEQ['31']+i+1).padStart(10,'0')
  const sub = e31subs[i], itb = (Number(sub)*0.18).toFixed(2), tot = (Number(sub)*1.18).toFixed(2)
  const body = '<Encabezado>' + x('Version','1.0') + '<IdDoc>' + x('TipoeCF','31') + x('eNCF',encf) + x('FechaVencimientoSecuencia','31-12-2028') + x('IndicadorMontoGravado','0') + x('TipoIngresos','01') + x('TipoPago','1') + '</IdDoc>' + emisor() + comp(C) + '<Totales>' + x('MontoGravadoTotal',sub) + x('MontoGravadoI1',sub) + x('ITBIS1','18') + x('TotalITBIS',itb) + x('TotalITBIS1',itb) + x('MontoTotal',tot) + x('ValorPagar',tot) + '</Totales></Encabezado>' + items(e31items[i]) + x('FechaHoraFirma',ff())
  signSave('31', encf, '<?xml version="1.0" encoding="UTF-8"?><ECF>' + body + '</ECF>')
}

// ── 2x E32 >= 250K ──
for (let i = 0; i < 2; i++) {
  const encf = 'E32' + String(SEQ['32']+i+1).padStart(10,'0')
  const body = '<Encabezado>' + x('Version','1.0') + '<IdDoc>' + x('TipoeCF','32') + x('eNCF',encf) + x('IndicadorMontoGravado','0') + x('TipoIngresos','01') + x('TipoPago','1') + '</IdDoc>' + emisor() + comp(C) + '<Totales>' + x('MontoGravadoTotal','300000.00') + x('MontoGravadoI1','300000.00') + x('ITBIS1','18') + x('TotalITBIS','54000.00') + x('TotalITBIS1','54000.00') + x('MontoTotal','354000.00') + '</Totales></Encabezado>' + items(big) + x('FechaHoraFirma',ff())
  signSave('32', encf, '<?xml version="1.0" encoding="UTF-8"?><ECF>' + body + '</ECF>')
}

// ── 2x E41 (needs Comprador + Retencion in items) ──
for (let i = 0; i < 2; i++) {
  const encf = 'E41' + String(SEQ['41']+i+1).padStart(10,'0')
  const e41items = '<DetallesItems><Item>' + x('NumeroLinea','1') + x('IndicadorFacturacion','1') + '<Retencion>' + x('IndicadorAgenteRetencionoPercepcion','1') + x('MontoITBISRetenido','900.00') + x('MontoISRRetenido','500.00') + '</Retencion>' + x('NombreItem','Suministros Limpieza') + x('IndicadorBienoServicio','1') + x('CantidadItem','10') + x('UnidadMedida','43') + x('PrecioUnitarioItem','500.0000') + x('MontoItem','5000.00') + '</Item></DetallesItems>'
  const body = '<Encabezado>' + x('Version','1.0') + '<IdDoc>' + x('TipoeCF','41') + x('eNCF',encf) + x('FechaVencimientoSecuencia','31-12-2028') + x('IndicadorMontoGravado','0') + x('TipoPago','1') + '</IdDoc>' + emisor() + comp(C) + '<Totales>' + x('MontoGravadoTotal','5000.00') + x('MontoGravadoI1','5000.00') + x('ITBIS1','18') + x('TotalITBIS','900.00') + x('TotalITBIS1','900.00') + x('MontoTotal','5900.00') + x('ValorPagar','5900.00') + x('TotalITBISRetenido','900.00') + x('TotalISRRetencion','500.00') + '</Totales></Encabezado>' + e41items + x('FechaHoraFirma',ff())
  signSave('41', encf, '<?xml version="1.0" encoding="UTF-8"?><ECF>' + body + '</ECF>')
}

// ── 2x E43 (gastos menores — still needs DetallesItems) ──
const gastos = [{n:'Gastos Menores Oficina',c:'1',p:'1500.0000',m:'1500.00',b:'1',f:'4'}]
for (let i = 0; i < 2; i++) {
  const encf = 'E43' + String(SEQ['43']+i+1).padStart(10,'0')
  const body = '<Encabezado>' + x('Version','1.0') + '<IdDoc>' + x('TipoeCF','43') + x('eNCF',encf) + x('FechaVencimientoSecuencia','31-12-2028') + x('TipoPago','1') + '</IdDoc>' + emisor() + '<Totales>' + x('MontoExento','1500.00') + x('MontoTotal','1500.00') + '</Totales></Encabezado>' + items(gastos) + x('FechaHoraFirma',ff())
  signSave('43', encf, '<?xml version="1.0" encoding="UTF-8"?><ECF>' + body + '</ECF>')
}

// ── 2x E44 ──
const detailExento = [{n:'Detallado Interior Completo',c:'1',p:'2500.0000',m:'2500.00',b:'2',f:'4'}]
for (let i = 0; i < 2; i++) {
  const encf = 'E44' + String(SEQ['44']+i+1).padStart(10,'0')
  const body = '<Encabezado>' + x('Version','1.0') + '<IdDoc>' + x('TipoeCF','44') + x('eNCF',encf) + x('FechaVencimientoSecuencia','31-12-2028') + x('TipoIngresos','01') + x('TipoPago','2') + x('FechaLimitePago','30-06-2026') + '</IdDoc>' + emisor() + comp(C) + '<Totales>' + x('MontoExento','2500.00') + x('MontoTotal','2500.00') + x('ValorPagar','2500.00') + '</Totales></Encabezado>' + items(detailExento) + x('FechaHoraFirma',ff())
  signSave('44', encf, '<?xml version="1.0" encoding="UTF-8"?><ECF>' + body + '</ECF>')
}

// ── 2x E45 (gubernamental — modeled after Step 2 proven) ──
for (let i = 0; i < 2; i++) {
  const encf = 'E45' + String(SEQ['45']+i+1).padStart(10,'0')
  const body = '<Encabezado>' + x('Version','1.0') + '<IdDoc>' + x('TipoeCF','45') + x('eNCF',encf) + x('FechaVencimientoSecuencia','31-12-2028') + x('IndicadorMontoGravado','0') + x('TipoIngresos','01') + x('TipoPago','1') + '</IdDoc>' + emisor() + comp(C) + '<Totales>' + x('MontoGravadoTotal','2500.00') + x('MontoGravadoI1','2500.00') + x('ITBIS1','18') + x('TotalITBIS','450.00') + x('TotalITBIS1','450.00') + x('MontoTotal','2950.00') + x('ValorPagar','2950.00') + '</Totales></Encabezado>' + items(detail) + x('FechaHoraFirma',ff())
  signSave('45', encf, '<?xml version="1.0" encoding="UTF-8"?><ECF>' + body + '</ECF>')
}

// ── 2x E46 ──
for (let i = 0; i < 2; i++) {
  const encf = 'E46' + String(SEQ['46']+i+1).padStart(10,'0')
  const body = '<Encabezado>' + x('Version','1.0') + '<IdDoc>' + x('TipoeCF','46') + x('eNCF',encf) + x('FechaVencimientoSecuencia','31-12-2028') + x('TipoIngresos','01') + x('TipoPago','1') + '</IdDoc>' + emisor() + comp(C) + '<Totales>' + x('MontoGravadoTotal','5000.00') + x('MontoGravadoI3','5000.00') + x('ITBIS3','0') + x('TotalITBIS','0.00') + x('TotalITBIS3','0.00') + x('MontoTotal','5000.00') + x('ValorPagar','5000.00') + '</Totales></Encabezado>' + items(exp) + x('FechaHoraFirma',ff())
  signSave('46', encf, '<?xml version="1.0" encoding="UTF-8"?><ECF>' + body + '</ECF>')
}

// ── 2x E47 ──
for (let i = 0; i < 2; i++) {
  const encf = 'E47' + String(SEQ['47']+i+1).padStart(10,'0')
  const extComp = '<Comprador>' + x('IdentificadorExtranjero','US-EIN-987654321') + x('RazonSocialComprador','ACME INTERNATIONAL LLC') + '</Comprador>'
  const e47items = '<DetallesItems><Item>' + x('NumeroLinea','1') + x('IndicadorFacturacion','4') + '<Retencion>' + x('IndicadorAgenteRetencionoPercepcion','1') + x('MontoISRRetenido','500.00') + '</Retencion>' + x('NombreItem','Consulting Services International') + x('IndicadorBienoServicio','2') + x('CantidadItem','1') + x('UnidadMedida','43') + x('PrecioUnitarioItem','5000.0000') + x('MontoItem','5000.00') + '</Item></DetallesItems>'
  const body = '<Encabezado>' + x('Version','1.0') + '<IdDoc>' + x('TipoeCF','47') + x('eNCF',encf) + x('FechaVencimientoSecuencia','31-12-2028') + x('TipoPago','1') + '</IdDoc>' + emisor() + extComp + '<Totales>' + x('MontoExento','5000.00') + x('MontoTotal','5000.00') + x('ValorPagar','5000.00') + x('TotalISRRetencion','500.00') + '</Totales></Encabezado>' + e47items + x('FechaHoraFirma',ff())
  signSave('47', encf, '<?xml version="1.0" encoding="UTF-8"?><ECF>' + body + '</ECF>')
}

// ── 1x E33 ──
{
  const e33encf = 'E33' + String(SEQ['33']+1).padStart(10,'0')
  const e33ref = 'E31' + String(SEQ['31']+1).padStart(10,'0')
  const body = '<Encabezado>' + x('Version','1.0') + '<IdDoc>' + x('TipoeCF','33') + x('eNCF',e33encf) + x('FechaVencimientoSecuencia','31-12-2028') + x('IndicadorMontoGravado','0') + x('TipoIngresos','01') + x('TipoPago','1') + '</IdDoc>' + emisor() + comp(C) + '<Totales>' + x('MontoGravadoTotal','500.00') + x('MontoGravadoI1','500.00') + x('ITBIS1','18') + x('TotalITBIS','90.00') + x('TotalITBIS1','90.00') + x('MontoTotal','590.00') + '</Totales></Encabezado>' + items(small) + '<InformacionReferencia>' + x('NCFModificado',e33ref) + x('FechaNCFModificado','27-03-2026') + x('CodigoModificacion','3') + '</InformacionReferencia>' + x('FechaHoraFirma',ff())
  signSave('33', e33encf, '<?xml version="1.0" encoding="UTF-8"?><ECF>' + body + '</ECF>')
}

// ── 2x E34 ──
// E34 #1: Partial credit note (CodigoModificacion=3 = Corrige Montos) referencing E31 #1
// E31 #1 has MontoGravadoI1=1600, ITBIS=288, Total=1888 — E34 partial for 500+90=590
{
  const encf = 'E34' + String(SEQ['34']+1).padStart(10,'0')
  const refEncf = 'E31' + String(SEQ['31']+1).padStart(10,'0')
  const e34items = [{n:'Descuento Servicio',c:'1',p:'500.0000',m:'500.00',b:'2'}]
  const body = '<Encabezado>' + x('Version','1.0') + '<IdDoc>' + x('TipoeCF','34') + x('eNCF',encf) + x('IndicadorNotaCredito','0') + x('IndicadorMontoGravado','0') + x('TipoIngresos','01') + x('TipoPago','1') + '</IdDoc>' + emisor() + comp(C) + '<Totales>' + x('MontoGravadoTotal','500.00') + x('MontoGravadoI1','500.00') + x('ITBIS1','18') + x('TotalITBIS','90.00') + x('TotalITBIS1','90.00') + x('MontoTotal','590.00') + x('ValorPagar','590.00') + '</Totales></Encabezado>' + items(e34items) + '<InformacionReferencia>' + x('NCFModificado',refEncf) + x('FechaNCFModificado','27-03-2026') + x('CodigoModificacion','3') + '</InformacionReferencia>' + x('FechaHoraFirma',ff())
  signSave('34', encf, '<?xml version="1.0" encoding="UTF-8"?><ECF>' + body + '</ECF>')
}
// E34 #2: Full annulment (CodigoModificacion=1) referencing E44 #1 — exento, EXACT match
// E44 #1 has MontoExento=2500, MontoTotal=2500 — E34 must match exactly for code 1
{
  const encf = 'E34' + String(SEQ['34']+2).padStart(10,'0')
  const refEncf = 'E44' + String(SEQ['44']+1).padStart(10,'0')
  const e34items = [{n:'Anulacion Servicio',c:'1',p:'2500.0000',m:'2500.00',b:'2',f:'4'}]
  const body = '<Encabezado>' + x('Version','1.0') + '<IdDoc>' + x('TipoeCF','34') + x('eNCF',encf) + x('IndicadorNotaCredito','0') + x('IndicadorMontoGravado','0') + x('TipoIngresos','01') + x('TipoPago','1') + '</IdDoc>' + emisor() + comp(C) + '<Totales>' + x('MontoExento','2500.00') + x('MontoTotal','2500.00') + x('ValorPagar','2500.00') + '</Totales></Encabezado>' + items(e34items) + '<InformacionReferencia>' + x('NCFModificado',refEncf) + x('FechaNCFModificado','27-03-2026') + x('CodigoModificacion','1') + '</InformacionReferencia>' + x('FechaHoraFirma',ff())
  signSave('34', encf, '<?xml version="1.0" encoding="UTF-8"?><ECF>' + body + '</ECF>')
}

// ── 4x E32 < 250K + RFCE ──
for (let i = 0; i < 4; i++) {
  const encf = 'E32' + String(SEQ['32']+3+i).padStart(10,'0')
  const sub = '500.00', itb = '90.00', tot = '590.00'
  const body = '<Encabezado>' + x('Version','1.0') + '<IdDoc>' + x('TipoeCF','32') + x('eNCF',encf) + x('IndicadorMontoGravado','0') + x('TipoIngresos','01') + x('TipoPago','1') + '</IdDoc>' + emisor() + '<Totales>' + x('MontoGravadoTotal',sub) + x('MontoGravadoI1',sub) + x('ITBIS1','18') + x('TotalITBIS',itb) + x('TotalITBIS1',itb) + x('MontoTotal',tot) + '</Totales></Encabezado>' + items(small) + x('FechaHoraFirma',ff())
  const signedEcf = signSave('32', encf, '<?xml version="1.0" encoding="UTF-8"?><ECF>' + body + '</ECF>')

  // RFCE with security code from E32
  const sigMatch = signedEcf.match(/<SignatureValue>([^<]+)<\/SignatureValue>/)
  const secCode = sigMatch[1].replace(/\s/g, '').substring(0, 6)

  let rfce = '<Encabezado>' + x('Version','1.0') + '<IdDoc>' + x('TipoeCF','32') + x('eNCF',encf) + x('TipoIngresos','01') + x('TipoPago','1') + '</IdDoc>' + '<Emisor>' + x('RNCEmisor',E.rnc) + x('RazonSocialEmisor',E.nombre) + x('FechaEmision',E.fecha) + '</Emisor>' + '<Totales>' + x('MontoGravadoTotal',sub) + x('MontoGravadoI1',sub) + x('TotalITBIS',itb) + x('TotalITBIS1',itb) + x('MontoTotal',tot) + '</Totales>' + x('CodigoSeguridadeCF',secCode) + '</Encabezado>'
  signSave('32', encf, '<?xml version="1.0" encoding="UTF-8"?><RFCE>' + rfce + '</RFCE>', true)
}

fs.writeFileSync(path.join(DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log('\nTotal: ' + manifest.length + ' files')
