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
  let body = '<Encabezado>'
  body += jsonToXml('Version', '1.0')
  body += jsonToXml('TipoeCF', '32')
  body += jsonToXml('eNCF', data.eNCF)
  body += jsonToXml('TipoIngresos', data.tipoIngresos || '01')
  body += jsonToXml('TipoPago', data.tipoPago || '1')

  // TablaFormasPago (optional)
  if (data.formasPago) {
    body += jsonToXml('TablaFormasPago', data.formasPago)
  }

  body += jsonToXml('RNCEmisor', data.emisor.rnc)
  body += jsonToXml('RazonSocialEmisor', data.emisor.nombre)
  body += jsonToXml('FechaEmision', data.fechaEmision)

  // Comprador (optional for < 250K)
  if (data.comprador?.rnc) {
    body += jsonToXml('RNCComprador', data.comprador.rnc)
    body += jsonToXml('RazonSocialComprador', data.comprador.nombre)
  }

  // Totales
  const t = data.totales
  if (t.montoGravadoTotal) body += jsonToXml('MontoGravadoTotal', t.montoGravadoTotal)
  if (t.montoGravadoI1) body += jsonToXml('MontoGravadoI1', t.montoGravadoI1)
  if (t.montoGravadoI2) body += jsonToXml('MontoGravadoI2', t.montoGravadoI2)
  if (t.montoGravadoI3) body += jsonToXml('MontoGravadoI3', t.montoGravadoI3)
  if (t.montoExento) body += jsonToXml('MontoExento', t.montoExento)
  if (t.totalITBIS) body += jsonToXml('TotalITBIS', t.totalITBIS)
  if (t.totalITBIS1) body += jsonToXml('TotalITBIS1', t.totalITBIS1)
  if (t.totalITBIS2) body += jsonToXml('TotalITBIS2', t.totalITBIS2)
  if (t.totalITBIS3) body += jsonToXml('TotalITBIS3', t.totalITBIS3)
  body += jsonToXml('MontoTotal', t.montoTotal || t.total)

  if (data.securityCode) body += jsonToXml('CodigoSeguridadeCF', data.securityCode)
  if (data.indicadorEnvioDiferido) body += jsonToXml('IndicadorEnvioDiferido', '1')

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
 * @param {object} data — { rncEmisor, cantidadNCF, rangoDesde, rangoHasta }
 * @returns {string} ANECF XML string (unsigned)
 */
function buildANECFXml(data) {
  let body = '<DetalleAnulacion>'
  body += jsonToXml('Version', '1.0')
  body += jsonToXml('RNCEmisor', data.rncEmisor)
  body += jsonToXml('CantidadNCFAnulados', String(data.cantidadNCF))
  body += jsonToXml('RangoDesde', data.rangoDesde)
  body += jsonToXml('RangoHasta', data.rangoHasta)
  body += '</DetalleAnulacion>'

  return `<?xml version="1.0" encoding="UTF-8"?><ANECF>${body}</ANECF>`
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
