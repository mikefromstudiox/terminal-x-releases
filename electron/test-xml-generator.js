/**
 * test-xml-generator.js — Generates DGII certification test XML sets
 *
 * Produces all required signed XMLs for DGII certification Steps 2-4:
 *   Step 2: 21 e-CF XMLs + 4 RFCE summaries (Pruebas de Datos)
 *   Step 3: 11 Aprobación Comercial XMLs
 *   Step 4: Simulation set (real-structure, sent via API)
 *
 * All XMLs are signed with the installed .p12 certificate and saved to
 * userData/test-xmls/{step}/ with DGII-compliant filenames.
 *
 * Usage from IPC: electronAPI.dgii_ecf.generateTestSet(step)
 * Usage from CLI: node electron/test-xml-generator.js [step] [certPath] [passphrase] [outputDir]
 */

const fs   = require('fs')
const path = require('path')

// ── Studio X SRL emisor data ─────────────────────────────────────────────────

const EMISOR = {
  rnc:              '133410321',
  nombre:           'STUDIO X SRL',
  nombreComercial:  'STUDIO X',
  direccion:        'TEODORO CHASSEROU, No. 20, MANGANAGUA',
  municipio:        '32100',
  provincia:        '32000',
  email:            'ADMIN@STUDIOX.COM.DO',
}

// ── Test compradores ─────────────────────────────────────────────────────────

const COMPRADORES = [
  { rnc: '131212199', nombre: 'EMPRESA PRUEBA A SRL',   email: 'test-a@example.com', direccion: 'Ave. 27 de Febrero, Santo Domingo',          municipio: '010100', provincia: '010000' },
  { rnc: '101567890', nombre: 'COMERCIAL TEST B SRL',   email: 'test-b@example.com', direccion: 'Calle El Conde #45, Zona Colonial',           municipio: '010100', provincia: '010000' },
  { rnc: '130987654', nombre: 'SERVICIOS DELTA SRL',    email: 'delta@example.com',  direccion: 'Ave. Abraham Lincoln, Piantini',              municipio: '010100', provincia: '010000' },
  { rnc: '401234567',  nombre: 'JUAN PEREZ',            email: 'juan@example.com',   direccion: 'Santiago de los Caballeros',                  municipio: '250100', provincia: '250000' },
]

const GOV_COMPRADOR = { rnc: '401000106', nombre: 'DIRECCION GENERAL DE IMPUESTOS INTERNOS', email: 'info@dgii.gov.do', direccion: 'Ave. Mexico, Santo Domingo', municipio: '010100', provincia: '010000' }
const EXTRANJERO    = { identificadorExtranjero: 'US-EIN-123456789', nombre: 'ACME INTERNATIONAL LLC' }

// ── Test items ───────────────────────────────────────────────────────────────

const ITEMS_SERVICE = [
  { nombre: 'Lavado Premium Full',        precio: 800,  cantidad: 1, indicadorFacturacion: '1', indicadorBienoServicio: '2', unidadMedida: '43' },
  { nombre: 'Detallado Interior',         precio: 500,  cantidad: 1, indicadorFacturacion: '1', indicadorBienoServicio: '2', unidadMedida: '43' },
]

const ITEMS_LARGE = [
  { nombre: 'Paquete Corporativo Mensual', precio: 150000, cantidad: 2, indicadorFacturacion: '1', indicadorBienoServicio: '2', unidadMedida: '43' },
]

const ITEMS_EXPORT = [
  { nombre: 'Software License - Terminal X POS', precio: 2500, cantidad: 1, indicadorFacturacion: '3', indicadorBienoServicio: '2', unidadMedida: '43' },
]

const ITEMS_SMALL = [
  { nombre: 'Lavado Basico', precio: 350, cantidad: 1, indicadorFacturacion: '1', indicadorBienoServicio: '2', unidadMedida: '43' },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d = new Date()) {
  return [String(d.getDate()).padStart(2, '0'), String(d.getMonth() + 1).padStart(2, '0'), d.getFullYear()].join('-')
}

function calcTotales18(items) {
  const subtotal = items.reduce((s, i) => s + (i.precio * (i.cantidad || 1)), 0)
  const itbis = Math.round(subtotal * 0.18 * 100) / 100
  return { subtotal: subtotal.toFixed(2), itbis: itbis.toFixed(2), total: (subtotal + itbis).toFixed(2) }
}

function calcTotalesExento(items) {
  const total = items.reduce((s, i) => s + (i.precio * (i.cantidad || 1)), 0)
  return { subtotal: total.toFixed(2), itbis: '0.00', total: total.toFixed(2) }
}

// ── Payload builders (mirror ecf.js structure) ──────────────────────────────

function makeE31(comprador, items, tipoPago = '1') {
  const t = calcTotales18(items)
  return {
    tipoECF: '31', emisor: EMISOR, comprador, items, totales: t,
    metodoPago: tipoPago === '3' ? 'tarjeta' : tipoPago === '2' ? 'transferencia' : 'efectivo',
    fechaVencimiento: '31-12-2028', tipoIngresos: '01',
  }
}

function makeE32(comprador, items, tipoPago = '1') {
  const t = calcTotales18(items)
  return {
    tipoECF: '32', emisor: EMISOR, comprador, items, totales: t,
    metodoPago: tipoPago === '3' ? 'tarjeta' : 'efectivo',
    fechaLimitePago: formatDate(), tipoIngresos: '01',
  }
}

function makeE33(referencedNCF, comprador, items) {
  const t = calcTotales18(items)
  return {
    tipoECF: '33', emisor: EMISOR, comprador, items, totales: t,
    metodoPago: 'efectivo', tipoIngresos: '01',
    referencia: { ncfModificado: referencedNCF, razonModificacion: 'Ajuste de precio por diferencia', fechaNCFModificado: formatDate(), codigoModificacion: '3' },
  }
}

function makeE34(referencedNCF, comprador, items) {
  const t = calcTotales18(items)
  return {
    tipoECF: '34', emisor: EMISOR, comprador, items, totales: t,
    metodoPago: 'efectivo', tipoIngresos: '01',
    referencia: { ncfModificado: referencedNCF, razonModificacion: 'Devolucion parcial de servicio', fechaNCFModificado: formatDate(), codigoModificacion: '1' },
  }
}

function makeE41() {
  return {
    tipoECF: '41', emisor: EMISOR, comprador: null, items: [], metodoPago: 'efectivo',
    fechaVencimiento: '31-12-2028',
    totales: { subtotal: '0.00', itbis: '0.00', total: '5000.00' },
    retencion: { montoItbisRetenido: '900.00', montoIsrRetenido: '500.00', indicador: '1' },
  }
}

function makeE43() {
  return {
    tipoECF: '43', emisor: EMISOR, comprador: null, items: [], metodoPago: 'efectivo',
    fechaVencimiento: '31-12-2028',
    totales: { subtotal: '0.00', itbis: '0.00', total: '1500.00' },
  }
}

function makeE44(comprador) {
  return {
    tipoECF: '44', emisor: EMISOR, comprador, items: ITEMS_SERVICE, metodoPago: 'transferencia',
    fechaVencimiento: '31-12-2028', tipoIngresos: '01',
    totales: calcTotalesExento(ITEMS_SERVICE),
    banco: { tipoCuenta: 'CT', numeroCuenta: '1234567890', nombre: 'BANCO POPULAR DOMINICANO' },
  }
}

function makeE45(items) {
  const t = calcTotales18(items)
  return {
    tipoECF: '45', emisor: EMISOR, comprador: GOV_COMPRADOR, items, totales: t,
    metodoPago: 'transferencia', fechaVencimiento: '31-12-2028', tipoIngresos: '01',
  }
}

function makeE46(comprador) {
  const t = calcTotalesExento(ITEMS_EXPORT)
  return {
    tipoECF: '46', emisor: EMISOR, comprador, items: ITEMS_EXPORT, totales: t,
    metodoPago: 'transferencia', fechaVencimiento: '31-12-2028', tipoIngresos: '01',
    fechaLimitePago: formatDate(),
    informacionesAdicionales: { FechaEmbarque: formatDate() },
    transporte: { numeroAlbaran: 'ALB-2026-001' },
  }
}

function makeE47() {
  return {
    tipoECF: '47', emisor: EMISOR,
    comprador: { identificadorExtranjero: EXTRANJERO.identificadorExtranjero, nombre: EXTRANJERO.nombre },
    items: [], metodoPago: 'transferencia', fechaVencimiento: '31-12-2028',
    totales: { subtotal: '0.00', itbis: '0.00', total: '3000.00', totalIsrRetencion: '300.00' },
    otraMoneda: { tipoMoneda: 'USD', tipoCambio: '58.50', monto: '51.28' },
  }
}

// ── Build payload using the same ecf.js logic ───────────────────────────────

function buildPayload(d) {
  // Inline minimal payload builders (same logic as ecf.js)
  const tipo = String(d.tipoECF)
  const mapTP = (m) => ({ efectivo:'1', transferencia:'2', tarjeta:'3', credito:'4' }[(m||'').toLowerCase()] || '1')
  const mkEmisor = (e, geo = true) => ({
    RNCEmisor: e.rnc, RazonSocialEmisor: e.nombre, NombreComercial: e.nombreComercial || e.nombre,
    DireccionEmisor: e.direccion, ...(geo ? { Municipio: e.municipio || '010100', Provincia: e.provincia || '010000' } : {}),
    CorreoEmisor: e.email, FechaEmision: formatDate(),
  })
  const mkComp = (c) => c?.rnc ? { RNCComprador: c.rnc, RazonSocialComprador: c.nombre, CorreoComprador: c.email || '', DireccionComprador: c.direccion || '', MunicipioComprador: c.municipio || '010100', ProvinciaComprador: c.provincia || '010000' } : null
  const mkItems = (items) => ({ Item: items.map((it, i) => ({ NumeroLinea: String(i+1), IndicadorFacturacion: it.indicadorFacturacion || '1', NombreItem: it.nombre, IndicadorBienoServicio: it.indicadorBienoServicio || '2', CantidadItem: String(it.cantidad || 1), UnidadMedida: it.unidadMedida || '43', PrecioUnitarioItem: Number(it.precio).toFixed(2), MontoItem: (Number(it.precio) * Number(it.cantidad || 1)).toFixed(2) })) })
  const t18 = (t) => ({ MontoGravadoTotal: Number(t.subtotal).toFixed(2), MontoGravadoI1: Number(t.subtotal).toFixed(2), ITBIS1: '18', TotalITBIS: Number(t.itbis).toFixed(2), TotalITBIS1: Number(t.itbis).toFixed(2), MontoTotal: Number(t.total).toFixed(2) })

  const comp = mkComp(d.comprador)
  const tp = mapTP(d.metodoPago)

  switch (tipo) {
    case '31': return { ECF: { Encabezado: { Version: '1.0', IdDoc: { TipoeCF: '31', FechaVencimientoSecuencia: d.fechaVencimiento || '31-12-2028', IndicadorMontoGravado: '0', TipoIngresos: d.tipoIngresos || '01', TipoPago: tp }, Emisor: mkEmisor(d.emisor), Comprador: comp, Totales: t18(d.totales) }, DetallesItems: mkItems(d.items) } }
    case '32': {
      const above = Number(d.totales.total) >= 250000
      return { ECF: { Encabezado: { Version: '1.0', IdDoc: { TipoeCF: '32', IndicadorMontoGravado: '0', TipoIngresos: d.tipoIngresos || '01', TipoPago: tp, FechaLimitePago: d.fechaLimitePago || formatDate() }, Emisor: mkEmisor(d.emisor), ...(above && comp ? { Comprador: comp } : {}), Totales: t18(d.totales) }, DetallesItems: mkItems(d.items) } }
    }
    case '33': return { ECF: { Encabezado: { Version: '1.0', IdDoc: { TipoeCF: '33', TipoIngresos: d.tipoIngresos || '01', TipoPago: tp }, Emisor: mkEmisor(d.emisor), ...(comp ? { Comprador: comp } : {}), InformacionReferencia: { NCFModificado: d.referencia.ncfModificado, RazonModificacion: d.referencia.razonModificacion, FechaNCFModificado: d.referencia.fechaNCFModificado, CodigoModificacion: d.referencia.codigoModificacion }, Totales: t18(d.totales) }, DetallesItems: mkItems(d.items || []) } }
    case '34': return { ECF: { Encabezado: { Version: '1.0', IdDoc: { TipoeCF: '34', IndicadorNotaCredito: '0', IndicadorMontoGravado: '0', TipoIngresos: d.tipoIngresos || '01', TipoPago: tp }, Emisor: mkEmisor(d.emisor), ...(comp ? { Comprador: comp } : {}), InformacionReferencia: { NCFModificado: d.referencia.ncfModificado, RazonModificacion: d.referencia.razonModificacion, FechaNCFModificado: d.referencia.fechaNCFModificado, CodigoModificacion: d.referencia.codigoModificacion }, Totales: t18(d.totales) }, DetallesItems: mkItems(d.items || []) } }
    case '41': { const ret = d.retencion || {}; return { ECF: { Encabezado: { Version: '1.0', IdDoc: { TipoeCF: '41', FechaVencimientoSecuencia: d.fechaVencimiento || '31-12-2028', IndicadorMontoGravado: '0', TipoPago: tp }, Totales: { TotalITBISRetenido: Number(ret.montoItbisRetenido||0).toFixed(2), TotalISRRetencion: Number(ret.montoIsrRetenido||0).toFixed(2), MontoTotal: Number(d.totales.total).toFixed(2) } }, DetallesItems: { Item: [{ Retencion: { IndicadorAgenteRetencionoPercepcion: ret.indicador||'1', MontoITBISRetenido: Number(ret.montoItbisRetenido||0).toFixed(2), MontoISRRetenido: Number(ret.montoIsrRetenido||0).toFixed(2) } }] } } } }
    case '43': return { ECF: { Encabezado: { Version: '1.0', IdDoc: { TipoeCF: '43', FechaVencimientoSecuencia: d.fechaVencimiento || '31-12-2028', TipoPago: tp }, Totales: { MontoExento: Number(d.totales.total).toFixed(2), MontoTotal: Number(d.totales.total).toFixed(2) } } } }
    case '44': { const b = d.banco || {}; return { ECF: { Encabezado: { Version: '1.0', IdDoc: { TipoeCF: '44', FechaVencimientoSecuencia: d.fechaVencimiento || '31-12-2028', TipoIngresos: d.tipoIngresos || '01', TipoPago: tp, ...(b.tipoCuenta ? { TipoCuentaPago: b.tipoCuenta } : {}), ...(b.numeroCuenta ? { NumeroCuentaPago: b.numeroCuenta } : {}), ...(b.nombre ? { BancoPago: b.nombre } : {}) }, Emisor: mkEmisor(d.emisor), ...(comp ? { Comprador: comp } : {}), Totales: { MontoExento: Number(d.totales.subtotal ?? d.totales.total).toFixed(2), MontoTotal: Number(d.totales.total).toFixed(2), ValorPagar: Number(d.totales.total).toFixed(2) } }, DetallesItems: mkItems(d.items || []) } } }
    case '45': return { ECF: { Encabezado: { Version: '1.0', IdDoc: { TipoeCF: '45', FechaVencimientoSecuencia: d.fechaVencimiento || '31-12-2028', IndicadorMontoGravado: '0', TipoIngresos: d.tipoIngresos || '01', TipoPago: tp }, Emisor: mkEmisor(d.emisor), Comprador: mkComp(GOV_COMPRADOR), Totales: { ...t18(d.totales), ValorPagar: Number(d.totales.total).toFixed(2) } }, DetallesItems: mkItems(d.items) } }
    case '46': { const inf = d.informacionesAdicionales || {}; const tr = d.transporte || {}; return { ECF: { Encabezado: { Version: '1.0', IdDoc: { TipoeCF: '46', FechaVencimientoSecuencia: d.fechaVencimiento || '31-12-2028', TipoIngresos: d.tipoIngresos || '01', TipoPago: tp, FechaLimitePago: d.fechaLimitePago || formatDate() }, Emisor: mkEmisor(d.emisor, false), ...(comp ? { Comprador: comp } : {}), ...(Object.keys(inf).length ? { InformacionesAdicionales: inf } : {}), ...(tr.numeroAlbaran ? { Transporte: { NumeroAlbaran: tr.numeroAlbaran } } : {}), Totales: { MontoGravadoTotal: Number(d.totales.subtotal).toFixed(2), MontoGravadoI3: Number(d.totales.subtotal).toFixed(2), ITBIS3: '0', TotalITBIS: '0.00', TotalITBIS3: '0.00', MontoTotal: Number(d.totales.total).toFixed(2) } }, DetallesItems: mkItems(d.items) } } }
    case '47': { const ext = d.comprador || {}; const om = d.otraMoneda || {}; return { ECF: { Encabezado: { Version: '1.0', IdDoc: { TipoeCF: '47', FechaVencimientoSecuencia: d.fechaVencimiento || '31-12-2028' }, Comprador: { IdentificadorExtranjero: ext.identificadorExtranjero || ext.rnc || '', RazonSocialComprador: ext.nombre || '' }, Totales: { MontoExento: Number(d.totales.total).toFixed(2), MontoTotal: Number(d.totales.total).toFixed(2), ...(d.totales.totalIsrRetencion ? { TotalISRRetencion: Number(d.totales.totalIsrRetencion).toFixed(2) } : {}) }, ...(om.tipoMoneda ? { OtraMoneda: { TipoMoneda: om.tipoMoneda, TipoCambio: String(om.tipoCambio || '1.0000'), MontoExentoOtraMoneda: Number(om.monto || 0).toFixed(2) } } : {}) } } } }
    default: throw new Error(`Tipo no soportado: ${tipo}`)
  }
}

// ── Step 2: Pruebas de Datos (21 XMLs + 4 RFCE) ─────────────────────────────

function generateStep2Set() {
  let seq = 1
  const nextNCF = (tipo) => `E${tipo}${String(seq++).padStart(10, '0')}`
  const results = []

  // 4x E31 — varying compradores and payment types
  results.push({ data: makeE31(COMPRADORES[0], ITEMS_SERVICE, '1'),  eNCF: nextNCF('31') })
  results.push({ data: makeE31(COMPRADORES[1], ITEMS_SERVICE, '2'),  eNCF: nextNCF('31') })
  results.push({ data: makeE31(COMPRADORES[2], ITEMS_SERVICE, '3'),  eNCF: nextNCF('31') })
  results.push({ data: makeE31(COMPRADORES[3], ITEMS_SMALL, '1'),    eNCF: nextNCF('31') })

  // 4x E32 >= 250K (with comprador)
  results.push({ data: makeE32(COMPRADORES[0], ITEMS_LARGE, '1'),    eNCF: nextNCF('32') })
  results.push({ data: makeE32(COMPRADORES[1], ITEMS_LARGE, '3'),    eNCF: nextNCF('32') })
  results.push({ data: makeE32(COMPRADORES[2], ITEMS_LARGE, '2'),    eNCF: nextNCF('32') })
  results.push({ data: makeE32(COMPRADORES[3], ITEMS_LARGE, '1'),    eNCF: nextNCF('32') })

  // 4x E32 < 250K (no comprador needed — also generates RFCE)
  results.push({ data: makeE32(null, ITEMS_SERVICE, '1'),  eNCF: nextNCF('32'), rfce: true })
  results.push({ data: makeE32(null, ITEMS_SMALL, '3'),    eNCF: nextNCF('32'), rfce: true })
  results.push({ data: makeE32(null, ITEMS_SERVICE, '1'),  eNCF: nextNCF('32'), rfce: true })
  results.push({ data: makeE32(null, ITEMS_SMALL, '1'),    eNCF: nextNCF('32'), rfce: true })

  // 1x E33 (references first E31)
  results.push({ data: makeE33(results[0].eNCF, COMPRADORES[0], ITEMS_SMALL), eNCF: nextNCF('33') })

  // 2x E34 (references E31s)
  results.push({ data: makeE34(results[1].eNCF, COMPRADORES[1], ITEMS_SMALL), eNCF: nextNCF('34') })
  results.push({ data: makeE34(results[2].eNCF, COMPRADORES[2], ITEMS_SMALL), eNCF: nextNCF('34') })

  // 2x E41
  results.push({ data: makeE41(), eNCF: nextNCF('41') })
  results.push({ data: makeE41(), eNCF: nextNCF('41') })

  // 1x E43
  results.push({ data: makeE43(), eNCF: nextNCF('43') })

  // 1x E44
  results.push({ data: makeE44(COMPRADORES[0]), eNCF: nextNCF('44') })

  // 1x E45
  results.push({ data: makeE45(ITEMS_SERVICE), eNCF: nextNCF('45') })

  // 1x E46
  results.push({ data: makeE46(COMPRADORES[1]), eNCF: nextNCF('46') })

  // 1x E47
  results.push({ data: makeE47(), eNCF: nextNCF('47') })

  return results
}

// ── Step 3: Aprobación Comercial (11 XMLs) ───────────────────────────────────

function generateStep3Set() {
  const results = []
  // 11 approval XMLs for different e-NCFs (references from step 2)
  for (let i = 1; i <= 11; i++) {
    results.push({
      type: 'ACECF',
      data: {
        rncEmisor: EMISOR.rnc,
        eNCF: `E31${String(i).padStart(10, '0')}`,
        estado: 1,
        comentario: `Aprobacion comercial de prueba #${i}`,
        fecha: new Date().toISOString(),
      },
    })
  }
  return results
}

// ── Generate and sign all XMLs ──────────────────────────────────────────────

function generateAndSign(step, certData, outputDir) {
  const { buildECFXml, buildRFCEXml, buildACECFXml, getFileName } = require('./xml-builder')
  const { signXML } = require('./xml-signer')

  const stepDir = path.join(outputDir, `step${step}`)
  if (!fs.existsSync(stepDir)) fs.mkdirSync(stepDir, { recursive: true })

  const { privateKeyPem, certificatePem } = certData
  const manifest = []

  if (step === 2 || step === '2') {
    const set = generateStep2Set()
    for (const item of set) {
      const payload = buildPayload(item.data)
      const xml = buildECFXml(payload, item.eNCF)
      const { signedXml, securityCode } = signXML(xml, privateKeyPem, certificatePem)

      const fileName = getFileName(EMISOR.rnc, item.eNCF)
      fs.writeFileSync(path.join(stepDir, fileName), signedXml, 'utf8')
      manifest.push({ fileName, eNCF: item.eNCF, tipo: item.data.tipoECF, securityCode })

      // Generate RFCE for E32 < 250K
      if (item.rfce) {
        const t = item.data.totales
        const rfceXml = buildRFCEXml({
          emisor: EMISOR,
          totales: { montoGravadoTotal: t.subtotal, montoGravadoI1: t.subtotal, totalITBIS: t.itbis, totalITBIS1: t.itbis, montoTotal: t.total },
          eNCF: item.eNCF,
          tipoIngresos: '01',
          tipoPago: '1',
          fechaEmision: formatDate(),
          securityCode,
        })
        const signedRFCE = signXML(rfceXml, privateKeyPem, certificatePem)
        const rfceName = `RFCE_${EMISOR.rnc}${item.eNCF}.xml`
        fs.writeFileSync(path.join(stepDir, rfceName), signedRFCE.signedXml, 'utf8')
        manifest.push({ fileName: rfceName, eNCF: item.eNCF, tipo: 'RFCE', securityCode: signedRFCE.securityCode })
      }
    }
  } else if (step === 3 || step === '3') {
    const set = generateStep3Set()
    for (const item of set) {
      const xml = buildACECFXml(item.data)
      const { signedXml, securityCode } = signXML(xml, privateKeyPem, certificatePem)

      const fileName = `ACECF_${EMISOR.rnc}${item.data.eNCF}.xml`
      fs.writeFileSync(path.join(stepDir, fileName), signedXml, 'utf8')
      manifest.push({ fileName, eNCF: item.data.eNCF, tipo: 'ACECF', securityCode })
    }
  }

  // Write manifest
  const manifestPath = path.join(stepDir, 'manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

  return { outputDir: stepDir, count: manifest.length, manifest }
}

// ── CLI mode ────────────────────────────────────────────────────────────────

if (require.main === module) {
  const [,, step = '2', certPath, passphrase, outputDir] = process.argv

  if (!certPath || !passphrase) {
    console.log('Usage: node test-xml-generator.js <step> <certPath> <passphrase> [outputDir]')
    console.log('  step: 2 or 3')
    console.log('  certPath: path to .p12 file')
    console.log('  passphrase: certificate passphrase')
    console.log('  outputDir: output directory (default: ./test-xmls)')
    process.exit(1)
  }

  const forge = require('node-forge')
  const raw = fs.readFileSync(certPath)
  const p12Der = forge.util.decode64(raw.toString('base64'))
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(p12Der), false, passphrase)
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })
  const cert = certBags[forge.pki.oids.certBag][0].cert
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })
  const key = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag][0].key

  const certData = {
    privateKeyPem: forge.pki.privateKeyToPem(key),
    certificatePem: forge.pki.certificateToPem(cert),
  }

  const outDir = outputDir || path.join(process.cwd(), 'test-xmls')
  const result = generateAndSign(step, certData, outDir)
  console.log(`Generated ${result.count} XMLs in ${result.outputDir}`)
  console.log('Files:')
  result.manifest.forEach(m => console.log(`  ${m.fileName} (${m.tipo}, security: ${m.securityCode})`))
}

module.exports = { generateAndSign, generateStep2Set, generateStep3Set, EMISOR }
