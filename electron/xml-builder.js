/**
 * xml-builder.js — DGII-compliant e-CF XML generation
 *
 * Converts JSON invoice objects (same shape as ecf.js buildEXX() output)
 * into proper XML strings ready for signing. Handles all 10 e-CF types
 * plus RFCE (Resumen Factura Consumo Electrónica) for E32 < RD$250K.
 *
 * Rules:
 *   - UTF-8 encoding, no BOM
 *   - No empty tags — omit optional elements if no value
 *   - Element order must match DGII XSD
 *   - File naming: {RNCEmisor}{eNCF}.xml
 *   - Numeric: up to 16 integer + 2 decimal, period separator, no thousands separator
 *
 * Ref: "Formato Comprobante Fiscal Electrónico (e-CF) V1.0.pdf"
 */

/**
 * jsonToXml — recursively converts a JSON object into XML string.
 * Skips null/undefined values (no empty tags per DGII rules).
 *
 * @param {string} tagName — element name
 * @param {*} value — string, number, object, or array
 * @returns {string} XML fragment
 */
function jsonToXml(tagName, value) {
  if (value === null || value === undefined || value === '') return ''

  if (Array.isArray(value)) {
    return value.map(item => jsonToXml(tagName, item)).join('')
  }

  if (typeof value === 'object') {
    const inner = Object.entries(value)
      .map(([k, v]) => jsonToXml(k, v))
      .filter(Boolean)
      .join('')
    if (!inner) return ''
    return `<${tagName}>${inner}</${tagName}>`
  }

  return `<${tagName}>${escapeXml(String(value))}</${tagName}>`
}

/**
 * escapeXml — escapes special XML characters per DGII spec.
 */
function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * buildECFXml — takes the JSON payload from ecf.js buildEXX() and produces XML.
 *
 * @param {object} payload — { ECF: { Encabezado: {...}, DetallesItems: {...} } }
 * @param {string} eNCF — e-NCF number (e.g., "E310000000001")
 * @returns {string} complete XML string (unsigned)
 */
function buildECFXml(payload, eNCF) {
  const ecf = payload.ECF
  if (!ecf) throw new Error('Payload must have ECF root')

  const enc = ecf.Encabezado
  if (!enc) throw new Error('ECF must have Encabezado')

  // Inject eNCF into IdDoc — must come right after TipoeCF per XSD
  if (enc.IdDoc) {
    const idDoc = {}
    idDoc.TipoeCF = enc.IdDoc.TipoeCF
    idDoc.eNCF = eNCF
    // Copy remaining fields in order
    for (const [k, v] of Object.entries(enc.IdDoc)) {
      if (k !== 'TipoeCF') idDoc[k] = v
    }
    enc.IdDoc = idDoc
  }

  // Build XML body
  let body = ''

  // Encabezado — preserve element order per XSD:
  // Version, IdDoc, Emisor, Comprador, InformacionReferencia, Totales, OtraMoneda
  body += '<Encabezado>'
  body += jsonToXml('Version', enc.Version)
  body += jsonToXml('IdDoc', enc.IdDoc)
  body += jsonToXml('Emisor', enc.Emisor)
  if (enc.Comprador) body += jsonToXml('Comprador', enc.Comprador)
  if (enc.InformacionReferencia) body += jsonToXml('InformacionReferencia', enc.InformacionReferencia)
  body += jsonToXml('Totales', enc.Totales)
  if (enc.OtraMoneda) body += jsonToXml('OtraMoneda', enc.OtraMoneda)
  if (enc.InformacionesAdicionales) body += jsonToXml('InformacionesAdicionales', enc.InformacionesAdicionales)
  if (enc.Transporte) body += jsonToXml('Transporte', enc.Transporte)
  body += '</Encabezado>'

  // DetallesItems
  if (ecf.DetallesItems) {
    body += jsonToXml('DetallesItems', ecf.DetallesItems)
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?><ECF>${body}</ECF>`
  return xml
}

/**
 * buildRFCEXml — builds Resumen Factura Consumo Electrónica for E32 < RD$250K.
 * These go to fc.dgii.gov.do instead of ecf.dgii.gov.do.
 *
 * @param {object} data — { emisor, totales, eNCF, tipoIngresos, tipoPago, comprador?, fechaEmision, securityCode }
 * @returns {string} RFCE XML string (unsigned)
 */
function buildRFCEXml(data) {
  // DGII RFCE schema requires NESTED groupings: IdDoc, Emisor, Totales,
  // each wrapping their respective fields. A flat layout is rejected with
  // "Archivo no válido" (codigo 001). This matches the structure the
  // tools/cert-step4-gen.js certification-pass generator produced.
  let body = '<Encabezado>'
  body += jsonToXml('Version', '1.0')

  // IdDoc — document identification
  let idDoc = ''
  idDoc += jsonToXml('TipoeCF', '32')
  idDoc += jsonToXml('eNCF', data.eNCF)
  idDoc += jsonToXml('TipoIngresos', data.tipoIngresos || '01')
  idDoc += jsonToXml('TipoPago', data.tipoPago || '1')
  if (data.formasPago) idDoc += jsonToXml('TablaFormasPago', data.formasPago)
  if (data.indicadorEnvioDiferido) idDoc += jsonToXml('IndicadorEnvioDiferido', '1')
  body += `<IdDoc>${idDoc}</IdDoc>`

  // Emisor — issuer
  let emisor = ''
  emisor += jsonToXml('RNCEmisor', data.emisor.rnc)
  emisor += jsonToXml('RazonSocialEmisor', data.emisor.nombre)
  emisor += jsonToXml('FechaEmision', data.fechaEmision)
  body += `<Emisor>${emisor}</Emisor>`

  // Comprador (optional) — only when a buyer RNC is present
  if (data.comprador?.rnc) {
    let comprador = ''
    comprador += jsonToXml('RNCComprador', data.comprador.rnc)
    comprador += jsonToXml('RazonSocialComprador', data.comprador.nombre)
    body += `<Comprador>${comprador}</Comprador>`
  }

  // Totales. DGII wants fixed 2-decimal format (e.g. '1800.00' not '1800').
  // cert-step4-gen.js passes pre-formatted strings; here we normalize numbers.
  const fmt = (n) => {
    const x = Number(n)
    return Number.isFinite(x) ? x.toFixed(2) : null
  }
  const t = data.totales
  let totales = ''
  const mgt = fmt(t.montoGravadoTotal); if (mgt != null && Number(mgt) > 0) totales += jsonToXml('MontoGravadoTotal', mgt)
  const mg1 = fmt(t.montoGravadoI1);    if (mg1 != null && Number(mg1) > 0) totales += jsonToXml('MontoGravadoI1', mg1)
  const mg2 = fmt(t.montoGravadoI2);    if (mg2 != null && Number(mg2) > 0) totales += jsonToXml('MontoGravadoI2', mg2)
  const mg3 = fmt(t.montoGravadoI3);    if (mg3 != null && Number(mg3) > 0) totales += jsonToXml('MontoGravadoI3', mg3)
  const mex = fmt(t.montoExento);       if (mex != null && Number(mex) > 0) totales += jsonToXml('MontoExento', mex)
  const ti  = fmt(t.totalITBIS);        if (ti  != null && Number(ti)  > 0) totales += jsonToXml('TotalITBIS', ti)
  const ti1 = fmt(t.totalITBIS1);       if (ti1 != null && Number(ti1) > 0) totales += jsonToXml('TotalITBIS1', ti1)
  const ti2 = fmt(t.totalITBIS2);       if (ti2 != null && Number(ti2) > 0) totales += jsonToXml('TotalITBIS2', ti2)
  const ti3 = fmt(t.totalITBIS3);       if (ti3 != null && Number(ti3) > 0) totales += jsonToXml('TotalITBIS3', ti3)
  totales += jsonToXml('MontoTotal', fmt(t.montoTotal || t.total))
  body += `<Totales>${totales}</Totales>`

  // CodigoSeguridadeCF lives at the Encabezado level, AFTER Totales
  if (data.securityCode) body += jsonToXml('CodigoSeguridadeCF', data.securityCode)

  body += '</Encabezado>'

  const xml = `<?xml version="1.0" encoding="UTF-8"?><RFCE>${body}</RFCE>`
  return xml
}

/**
 * buildARECFXml — builds Acuse de Recibo XML (for receiver endpoints).
 *
 * @param {object} data — { rncEmisor, eNCF, estado (0=recibido, 1=aprobado, 2=rechazado), fechaRecepcion }
 * @returns {string} ARECF XML string (unsigned)
 */
function buildARECFXml(data) {
  let body = '<DetalleAcusedeRecibo>'
  body += jsonToXml('Version', '1.0')
  body += jsonToXml('RNCEmisor', data.rncEmisor)
  body += jsonToXml('eNCF', data.eNCF)
  body += jsonToXml('Estado', String(data.estado ?? 0))
  body += jsonToXml('FechaHoraAcuseRecibo', data.fechaRecepcion || new Date().toISOString())
  body += '</DetalleAcusedeRecibo>'

  return `<?xml version="1.0" encoding="UTF-8"?><ARECF>${body}</ARECF>`
}

/**
 * buildACECFXml — builds Aprobación Comercial XML (for receiver endpoints).
 *
 * @param {object} data — { rncEmisor, eNCF, estado (1=aprobado, 2=rechazado), comentario?, fecha }
 * @returns {string} ACECF XML string (unsigned)
 */
function buildACECFXml(data) {
  let body = '<DetalleAprobacionComercial>'
  body += jsonToXml('Version', '1.0')
  body += jsonToXml('RNCEmisor', data.rncEmisor)
  body += jsonToXml('eNCF', data.eNCF)
  body += jsonToXml('Estado', String(data.estado ?? 1))
  if (data.comentario) body += jsonToXml('ComentarioAprobacion', data.comentario)
  body += jsonToXml('FechaHoraAprobacionComercial', data.fecha || new Date().toISOString())
  body += '</DetalleAprobacionComercial>'

  return `<?xml version="1.0" encoding="UTF-8"?><ACECF>${body}</ACECF>`
}

/**
 * buildANECFXml — builds Anulación de Rangos XML.
 *
 * Schema (confirmed via DGII rejection errors 2026-04-24):
 *   ANECF
 *     Encabezado
 *       Version, RncEmisor, CantidadeNCFAnulados        ← no FechaHoraAnulacion
 *     DetalleAnulacion
 *       Anulacion (1..N)
 *         NoLinea, TipoeCF, NCFDesde, NCFHasta         ← TipoeCF, not TipoAnulacion
 *
 * TipoeCF is the e-CF type being voided: 31, 32, 33, etc. (numeric — the
 * 'E' prefix stripped). A single ANECF can void one or multiple ranges;
 * if the ranges span different tipos, pass rangos[] with per-line tipoECF.
 *
 * @param {object} data — {
 *   rncEmisor,                                                    // 9-digit RNC
 *   cantidadNCF,                                                  // total count
 *   tipoECF,                                                      // '31' | '32' | ...
 *   rangos?: [{ tipoECF?, ncfDesde, ncfHasta }],                  // multi-range
 *   rangoDesde, rangoHasta                                        // legacy single-range
 * }
 * @returns {string} ANECF XML string (unsigned)
 */
function buildANECFXml(data) {
  const rncClean = String(data.rncEmisor || '').replace(/[-\s]/g, '')

  // Accept either rangos[] or legacy single-range shape.
  const rangos = Array.isArray(data.rangos) && data.rangos.length
    ? data.rangos
    : [{ tipoECF: data.tipoECF, ncfDesde: data.rangoDesde, ncfHasta: data.rangoHasta }]

  // Normalize tipoECF: strip leading 'E', ensure 2-digit string.
  const normTipoeCF = (t) => {
    const s = String(t || '').replace(/^E/i, '').padStart(2, '0')
    return s.slice(0, 2)
  }

  // FechaHoraAnulacioneNCF — DGII format dd-MM-yyyy HH:mm:ss
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  const fecha = `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

  // Per-range count — sum from NCFDesde/NCFHasta numeric diff.
  const rangeCount = (r) => {
    const a = parseInt(String(r.ncfDesde || '').replace(/[^\d]/g, ''), 10)
    const b = parseInt(String(r.ncfHasta || '').replace(/[^\d]/g, ''), 10)
    return (Number.isFinite(a) && Number.isFinite(b) && b >= a) ? (b - a + 1) : 0
  }

  let encabezado = '<Encabezado>'
  encabezado += jsonToXml('Version', '1.0')
  encabezado += jsonToXml('RncEmisor', rncClean)
  encabezado += jsonToXml('CantidadeNCFAnulados', String(data.cantidadNCF))
  encabezado += jsonToXml('FechaHoraAnulacioneNCF', fecha)
  encabezado += '</Encabezado>'

  let detalle = '<DetalleAnulacion>'
  rangos.forEach((r, i) => {
    detalle += '<Anulacion>'
    detalle += jsonToXml('NoLinea', String(i + 1))
    detalle += jsonToXml('TipoeCF', normTipoeCF(r.tipoECF || data.tipoECF))
    detalle += '<TablaRangoSecuenciasAnuladaseNCF>'
    detalle += '<Secuencias>'
    detalle += jsonToXml('SecuenciaeNCFDesde', r.ncfDesde)
    detalle += jsonToXml('SecuenciaeNCFHasta', r.ncfHasta)
    detalle += '</Secuencias>'
    detalle += '</TablaRangoSecuenciasAnuladaseNCF>'
    detalle += jsonToXml('CantidadeNCFAnulados', String(rangeCount(r) || data.cantidadNCF))
    detalle += '</Anulacion>'
  })
  detalle += '</DetalleAnulacion>'

  return `<?xml version="1.0" encoding="UTF-8"?><ANECF>${encabezado}${detalle}</ANECF>`
}

/**
 * getFileName — returns the DGII-compliant filename for an e-CF XML.
 * Format: {RNCEmisor}{eNCF}.xml
 */
function getFileName(rncEmisor, eNCF) {
  return `${rncEmisor.replace(/[-\s]/g, '')}${eNCF}.xml`
}

module.exports = {
  buildECFXml,
  buildRFCEXml,
  buildARECFXml,
  buildACECFXml,
  buildANECFXml,
  getFileName,
  jsonToXml,
  escapeXml,
}
