/**
 * ecf-gen.js — Generate Step 4 simulation XMLs from client config
 *
 * Usage: node tools/ecf-gen.js <config.json>
 * Example: node tools/ecf-gen.js tools/ecf-client-config.example.json
 *
 * Generates all 21 e-CFs + 4 RFCEs required for DGII Step 4 certification.
 */
const fs = require('fs')
const path = require('path')
const { Signature } = require('dgii-ecf')

const configPath = process.argv[2]
if (!configPath) { console.error('Usage: node tools/ecf-gen.js <config.json>'); process.exit(1) }

const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'))
const keyPem = fs.readFileSync(cfg.keyPemPath, 'utf8')
const certPem = fs.readFileSync(cfg.certPemPath, 'utf8')
const signer = new Signature(keyPem, certPem)

const DIR = path.join(path.dirname(configPath), `ecf-output-${cfg.rnc}`)
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true })

function x(tag, val) { if (!val && val !== 0) return ''; return `<${tag}>${String(val).replace(/&/g,'&amp;').replace(/</g,'&lt;')}</${tag}>` }

const E = cfg
const C = { rnc: cfg.testBuyerRnc, nombre: cfg.testBuyerName, email: 'test@test.com', dir: 'Santo Domingo', mun: '010100', prov: '010000' }
const GOV = { rnc: cfg.govBuyerRnc, nombre: cfg.govBuyerName, dir: 'Ave. Mexico, Santo Domingo', mun: '010100', prov: '010000' }

const fecha = new Date()
const fechaStr = [String(fecha.getDate()).padStart(2,'0'), String(fecha.getMonth()+1).padStart(2,'0'), fecha.getFullYear()].join('-')

function emisor() {
  return '<Emisor>' + x('RNCEmisor',E.rnc) + x('RazonSocialEmisor',E.razonSocial) + x('NombreComercial',E.nombreComercial) + x('DireccionEmisor',E.direccion) + x('Municipio',E.municipio) + x('Provincia',E.provincia) + '<TablaTelefonoEmisor>' + x('TelefonoEmisor',E.telefono) + '</TablaTelefonoEmisor>' + x('CorreoEmisor',E.email) + x('FechaEmision',fechaStr) + '</Emisor>'
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

// Build items from config
const it = cfg.items
const svc1 = [{n:it.service1.name, c:it.service1.qty, p:it.service1.price, m:it.service1.amount, b:it.service1.type}]
const svc2 = [{n:it.service2.name, c:it.service2.qty, p:it.service2.price, m:it.service2.amount, b:it.service2.type}]
const big = [{n:it.bigTicket.name, c:it.bigTicket.qty, p:it.bigTicket.price, m:it.bigTicket.amount, b:it.bigTicket.type}]
const small = [{n:it.smallTicket.name, c:it.smallTicket.qty, p:it.smallTicket.price, m:it.smallTicket.amount, b:it.smallTicket.type}]
const supply = [{n:it.supply.name, c:it.supply.qty, p:it.supply.price, m:it.supply.amount, b:it.supply.type}]
const exp = [{n:it.export.name, c:it.export.qty, p:it.export.price, m:it.export.amount, b:it.export.type, f:'3'}]

const SEQ_BASE = cfg.seqOffset || 1
const SEQ = { '31':SEQ_BASE, '32':SEQ_BASE, '33':SEQ_BASE, '34':SEQ_BASE, '41':SEQ_BASE, '43':SEQ_BASE, '44':SEQ_BASE, '45':SEQ_BASE, '46':SEQ_BASE, '47':SEQ_BASE }
const EXPIRY = cfg.seqExpiry || '31-12-2028'

// ── 4x E31 ──
const e31items = [svc1, svc1, svc2, svc2]
for (let i = 0; i < 4; i++) {
  const encf = 'E31' + String(SEQ['31']+i+1).padStart(10,'0')
  const sub = e31items[i][0].m, itb = (Number(sub)*0.18).toFixed(2), tot = (Number(sub)*1.18).toFixed(2)
  const body = '<Encabezado>' + x('Version','1.0') + '<IdDoc>' + x('TipoeCF','31') + x('eNCF',encf) + x('FechaVencimientoSecuencia',EXPIRY) + x('IndicadorMontoGravado','0') + x('TipoIngresos','01') + x('TipoPago','1') + '</IdDoc>' + emisor() + comp(C) + '<Totales>' + x('MontoGravadoTotal',sub) + x('MontoGravadoI1',sub) + x('ITBIS1','18') + x('TotalITBIS',itb) + x('TotalITBIS1',itb) + x('MontoTotal',tot) + x('ValorPagar',tot) + '</Totales></Encabezado>' + items(e31items[i]) + x('FechaHoraFirma',ff())
  signSave('31', encf, '<?xml version="1.0" encoding="UTF-8"?><ECF>' + body + '</ECF>')
}

// ── 2x E32 >= 250K ──
for (let i = 0; i < 2; i++) {
  const encf = 'E32' + String(SEQ['32']+i+1).padStart(10,'0')
  const body = '<Encabezado>' + x('Version','1.0') + '<IdDoc>' + x('TipoeCF','32') + x('eNCF',encf) + x('IndicadorMontoGravado','0') + x('TipoIngresos','01') + x('TipoPago','1') + '</IdDoc>' + emisor() + comp(C) + '<Totales>' + x('MontoGravadoTotal','300000.00') + x('MontoGravadoI1','300000.00') + x('ITBIS1','18') + x('TotalITBIS','54000.00') + x('TotalITBIS1','54000.00') + x('MontoTotal','354000.00') + '</Totales></Encabezado>' + items(big) + x('FechaHoraFirma',ff())
  signSave('32', encf, '<?xml version="1.0" encoding="UTF-8"?><ECF>' + body + '</ECF>')
}

// ── 2x E41 (Compras with Retencion) ──
for (let i = 0; i < 2; i++) {
  const encf = 'E41' + String(SEQ['41']+i+1).padStart(10,'0')
  const supplyAmt = supply[0].m
  const itb41 = (Number(supplyAmt)*0.18).toFixed(2)
  const tot41 = (Number(supplyAmt)*1.18).toFixed(2)
  const e41items = '<DetallesItems><Item>' + x('NumeroLinea','1') + x('IndicadorFacturacion','1') + '<Retencion>' + x('IndicadorAgenteRetencionoPercepcion','1') + x('MontoITBISRetenido',itb41) + x('MontoISRRetenido','500.00') + '</Retencion>' + x('NombreItem',supply[0].n) + x('IndicadorBienoServicio','1') + x('CantidadItem',supply[0].c) + x('UnidadMedida','43') + x('PrecioUnitarioItem',supply[0].p) + x('MontoItem',supplyAmt) + '</Item></DetallesItems>'
  const body = '<Encabezado>' + x('Version','1.0') + '<IdDoc>' + x('TipoeCF','41') + x('eNCF',encf) + x('FechaVencimientoSecuencia',EXPIRY) + x('IndicadorMontoGravado','0') + x('TipoPago','1') + '</IdDoc>' + emisor() + comp(C) + '<Totales>' + x('MontoGravadoTotal',supplyAmt) + x('MontoGravadoI1',supplyAmt) + x('ITBIS1','18') + x('TotalITBIS',itb41) + x('TotalITBIS1',itb41) + x('MontoTotal',tot41) + x('ValorPagar',tot41) + x('TotalITBISRetenido',itb41) + x('TotalISRRetencion','500.00') + '</Totales></Encabezado>' + e41items + x('FechaHoraFirma',ff())
  signSave('41', encf, '<?xml version="1.0" encoding="UTF-8"?><ECF>' + body + '</ECF>')
}

// ── 2x E43 (gastos menores — NO Comprador) ──
const gastos = [{n:'Gastos Menores Oficina',c:'1',p:'1500.0000',m:'1500.00',b:'1',f:'4'}]
for (let i = 0; i < 2; i++) {
  const encf = 'E43' + String(SEQ['43']+i+1).padStart(10,'0')
  const body = '<Encabezado>' + x('Version','1.0') + '<IdDoc>' + x('TipoeCF','43') + x('eNCF',encf) + x('FechaVencimientoSecuencia',EXPIRY) + x('TipoPago','1') + '</IdDoc>' + emisor() + '<Totales>' + x('MontoExento','1500.00') + x('MontoTotal','1500.00') + '</Totales></Encabezado>' + items(gastos) + x('FechaHoraFirma',ff())
  signSave('43', encf, '<?xml version="1.0" encoding="UTF-8"?><ECF>' + body + '</ECF>')
}

// ── 2x E44 (regimenes especiales) ──
const exentoItem = [{n:svc2[0].n,c:'1',p:svc2[0].p,m:svc2[0].m,b:'2',f:'4'}]
for (let i = 0; i < 2; i++) {
  const encf = 'E44' + String(SEQ['44']+i+1).padStart(10,'0')
  const body = '<Encabezado>' + x('Version','1.0') + '<IdDoc>' + x('TipoeCF','44') + x('eNCF',encf) + x('FechaVencimientoSecuencia',EXPIRY) + x('TipoIngresos','01') + x('TipoPago','2') + x('FechaLimitePago','30-06-2027') + '</IdDoc>' + emisor() + comp(C) + '<Totales>' + x('MontoExento',svc2[0].m) + x('MontoTotal',svc2[0].m) + x('ValorPagar',svc2[0].m) + '</Totales></Encabezado>' + items(exentoItem) + x('FechaHoraFirma',ff())
  signSave('44', encf, '<?xml version="1.0" encoding="UTF-8"?><ECF>' + body + '</ECF>')
}

// ── 2x E45 (gubernamental) ──
for (let i = 0; i < 2; i++) {
  const encf = 'E45' + String(SEQ['45']+i+1).padStart(10,'0')
  const sub = svc2[0].m, itb = (Number(sub)*0.18).toFixed(2), tot = (Number(sub)*1.18).toFixed(2)
  const body = '<Encabezado>' + x('Version','1.0') + '<IdDoc>' + x('TipoeCF','45') + x('eNCF',encf) + x('FechaVencimientoSecuencia',EXPIRY) + x('IndicadorMontoGravado','0') + x('TipoIngresos','01') + x('TipoPago','1') + '</IdDoc>' + emisor() + comp(C) + '<Totales>' + x('MontoGravadoTotal',sub) + x('MontoGravadoI1',sub) + x('ITBIS1','18') + x('TotalITBIS',itb) + x('TotalITBIS1',itb) + x('MontoTotal',tot) + x('ValorPagar',tot) + '</Totales></Encabezado>' + items(svc2) + x('FechaHoraFirma',ff())
  signSave('45', encf, '<?xml version="1.0" encoding="UTF-8"?><ECF>' + body + '</ECF>')
}

// ── 2x E46 (exportaciones) ──
for (let i = 0; i < 2; i++) {
  const encf = 'E46' + String(SEQ['46']+i+1).padStart(10,'0')
  const body = '<Encabezado>' + x('Version','1.0') + '<IdDoc>' + x('TipoeCF','46') + x('eNCF',encf) + x('FechaVencimientoSecuencia',EXPIRY) + x('TipoIngresos','01') + x('TipoPago','1') + '</IdDoc>' + emisor() + comp(C) + '<Totales>' + x('MontoGravadoTotal',exp[0].m) + x('MontoGravadoI3',exp[0].m) + x('ITBIS3','0') + x('TotalITBIS','0.00') + x('TotalITBIS3','0.00') + x('MontoTotal',exp[0].m) + x('ValorPagar',exp[0].m) + '</Totales></Encabezado>' + items(exp) + x('FechaHoraFirma',ff())
  signSave('46', encf, '<?xml version="1.0" encoding="UTF-8"?><ECF>' + body + '</ECF>')
}

// ── 2x E47 (pagos al exterior) ──
for (let i = 0; i < 2; i++) {
  const encf = 'E47' + String(SEQ['47']+i+1).padStart(10,'0')
  const extComp = '<Comprador>' + x('IdentificadorExtranjero','US-EIN-987654321') + x('RazonSocialComprador','ACME INTERNATIONAL LLC') + '</Comprador>'
  const e47items = '<DetallesItems><Item>' + x('NumeroLinea','1') + x('IndicadorFacturacion','4') + '<Retencion>' + x('IndicadorAgenteRetencionoPercepcion','1') + x('MontoISRRetenido','500.00') + '</Retencion>' + x('NombreItem','Consulting Services International') + x('IndicadorBienoServicio','2') + x('CantidadItem','1') + x('UnidadMedida','43') + x('PrecioUnitarioItem','5000.0000') + x('MontoItem','5000.00') + '</Item></DetallesItems>'
  const body = '<Encabezado>' + x('Version','1.0') + '<IdDoc>' + x('TipoeCF','47') + x('eNCF',encf) + x('FechaVencimientoSecuencia',EXPIRY) + x('TipoPago','1') + '</IdDoc>' + emisor() + extComp + '<Totales>' + x('MontoExento','5000.00') + x('MontoTotal','5000.00') + x('ValorPagar','5000.00') + x('TotalISRRetencion','500.00') + '</Totales></Encabezado>' + e47items + x('FechaHoraFirma',ff())
  signSave('47', encf, '<?xml version="1.0" encoding="UTF-8"?><ECF>' + body + '</ECF>')
}

// ── 1x E33 (nota de debito → references E31 #1) ──
{
  const e33encf = 'E33' + String(SEQ['33']+1).padStart(10,'0')
  const e33ref = 'E31' + String(SEQ['31']+1).padStart(10,'0')
  const body = '<Encabezado>' + x('Version','1.0') + '<IdDoc>' + x('TipoeCF','33') + x('eNCF',e33encf) + x('FechaVencimientoSecuencia',EXPIRY) + x('IndicadorMontoGravado','0') + x('TipoIngresos','01') + x('TipoPago','1') + '</IdDoc>' + emisor() + comp(C) + '<Totales>' + x('MontoGravadoTotal',small[0].m) + x('MontoGravadoI1',small[0].m) + x('ITBIS1','18') + x('TotalITBIS',(Number(small[0].m)*0.18).toFixed(2)) + x('TotalITBIS1',(Number(small[0].m)*0.18).toFixed(2)) + x('MontoTotal',(Number(small[0].m)*1.18).toFixed(2)) + '</Totales></Encabezado>' + items(small) + '<InformacionReferencia>' + x('NCFModificado',e33ref) + x('FechaNCFModificado',fechaStr) + x('CodigoModificacion','3') + '</InformacionReferencia>' + x('FechaHoraFirma',ff())
  signSave('33', e33encf, '<?xml version="1.0" encoding="UTF-8"?><ECF>' + body + '</ECF>')
}

// ── 2x E34 (nota de credito) ──
// E34 #1: Partial (CodigoModificacion=3) referencing E31 #1
{
  const encf = 'E34' + String(SEQ['34']+1).padStart(10,'0')
  const refEncf = 'E31' + String(SEQ['31']+1).padStart(10,'0')
  const e34items = [{n:'Descuento Servicio',c:'1',p:small[0].p,m:small[0].m,b:'2'}]
  const itb34 = (Number(small[0].m)*0.18).toFixed(2), tot34 = (Number(small[0].m)*1.18).toFixed(2)
  const body = '<Encabezado>' + x('Version','1.0') + '<IdDoc>' + x('TipoeCF','34') + x('eNCF',encf) + x('IndicadorNotaCredito','0') + x('IndicadorMontoGravado','0') + x('TipoIngresos','01') + x('TipoPago','1') + '</IdDoc>' + emisor() + comp(C) + '<Totales>' + x('MontoGravadoTotal',small[0].m) + x('MontoGravadoI1',small[0].m) + x('ITBIS1','18') + x('TotalITBIS',itb34) + x('TotalITBIS1',itb34) + x('MontoTotal',tot34) + x('ValorPagar',tot34) + '</Totales></Encabezado>' + items(e34items) + '<InformacionReferencia>' + x('NCFModificado',refEncf) + x('FechaNCFModificado',fechaStr) + x('CodigoModificacion','3') + '</InformacionReferencia>' + x('FechaHoraFirma',ff())
  signSave('34', encf, '<?xml version="1.0" encoding="UTF-8"?><ECF>' + body + '</ECF>')
}
// E34 #2: Full annulment (CodigoModificacion=1) referencing E44 #1 — amounts MUST match exactly
{
  const encf = 'E34' + String(SEQ['34']+2).padStart(10,'0')
  const refEncf = 'E44' + String(SEQ['44']+1).padStart(10,'0')
  const e34items = [{n:'Anulacion Servicio',c:'1',p:svc2[0].p,m:svc2[0].m,b:'2',f:'4'}]
  const body = '<Encabezado>' + x('Version','1.0') + '<IdDoc>' + x('TipoeCF','34') + x('eNCF',encf) + x('IndicadorNotaCredito','0') + x('IndicadorMontoGravado','0') + x('TipoIngresos','01') + x('TipoPago','1') + '</IdDoc>' + emisor() + comp(C) + '<Totales>' + x('MontoExento',svc2[0].m) + x('MontoTotal',svc2[0].m) + x('ValorPagar',svc2[0].m) + '</Totales></Encabezado>' + items(e34items) + '<InformacionReferencia>' + x('NCFModificado',refEncf) + x('FechaNCFModificado',fechaStr) + x('CodigoModificacion','1') + '</InformacionReferencia>' + x('FechaHoraFirma',ff())
  signSave('34', encf, '<?xml version="1.0" encoding="UTF-8"?><ECF>' + body + '</ECF>')
}

// ── 4x E32 < 250K + RFCE ──
for (let i = 0; i < 4; i++) {
  const encf = 'E32' + String(SEQ['32']+3+i).padStart(10,'0')
  const sub = small[0].m, itb = (Number(sub)*0.18).toFixed(2), tot = (Number(sub)*1.18).toFixed(2)
  const body = '<Encabezado>' + x('Version','1.0') + '<IdDoc>' + x('TipoeCF','32') + x('eNCF',encf) + x('IndicadorMontoGravado','0') + x('TipoIngresos','01') + x('TipoPago','1') + '</IdDoc>' + emisor() + '<Totales>' + x('MontoGravadoTotal',sub) + x('MontoGravadoI1',sub) + x('ITBIS1','18') + x('TotalITBIS',itb) + x('TotalITBIS1',itb) + x('MontoTotal',tot) + '</Totales></Encabezado>' + items(small) + x('FechaHoraFirma',ff())
  const signedEcf = signSave('32', encf, '<?xml version="1.0" encoding="UTF-8"?><ECF>' + body + '</ECF>')

  const sigMatch = signedEcf.match(/<SignatureValue>([^<]+)<\/SignatureValue>/)
  const secCode = sigMatch[1].replace(/\s/g, '').substring(0, 6)

  let rfce = '<Encabezado>' + x('Version','1.0') + '<IdDoc>' + x('TipoeCF','32') + x('eNCF',encf) + x('TipoIngresos','01') + x('TipoPago','1') + '</IdDoc>' + '<Emisor>' + x('RNCEmisor',E.rnc) + x('RazonSocialEmisor',E.razonSocial) + x('FechaEmision',fechaStr) + '</Emisor>' + '<Totales>' + x('MontoGravadoTotal',sub) + x('MontoGravadoI1',sub) + x('TotalITBIS',itb) + x('TotalITBIS1',itb) + x('MontoTotal',tot) + '</Totales>' + x('CodigoSeguridadeCF',secCode) + '</Encabezado>'
  signSave('32', encf, '<?xml version="1.0" encoding="UTF-8"?><RFCE>' + rfce + '</RFCE>', true)
}

fs.writeFileSync(path.join(DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log('\nTotal: ' + manifest.length + ' files → ' + DIR)
console.log('\nNext steps:')
console.log('1. node tools/ecf-submit.js ' + configPath)
console.log('2. node tools/ecf-pdf.js ' + configPath)
