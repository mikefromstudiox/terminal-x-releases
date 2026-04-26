/**
 * xml-builder.mjs — ESM port of electron/xml-builder.js
 * DGII-compliant e-CF XML generation for server-side signing proxy.
 */

export function jsonToXml(tagName, value) {
  if (value === null || value === undefined || value === '') return ''
  if (Array.isArray(value)) return value.map(item => jsonToXml(tagName, item)).join('')
  if (typeof value === 'object') {
    const inner = Object.entries(value).map(([k, v]) => jsonToXml(k, v)).filter(Boolean).join('')
    if (!inner) return ''
    return `<${tagName}>${inner}</${tagName}>`
  }
  return `<${tagName}>${escapeXml(String(value))}</${tagName}>`
}

export function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

export function buildECFXml(payload, eNCF) {
  const ecf = payload.ECF
  if (!ecf) throw new Error('Payload must have ECF root')
  const enc = ecf.Encabezado
  if (!enc) throw new Error('ECF must have Encabezado')

  if (enc.IdDoc) {
    const idDoc = {}
    idDoc.TipoeCF = enc.IdDoc.TipoeCF
    idDoc.eNCF = eNCF
    for (const [k, v] of Object.entries(enc.IdDoc)) {
      if (k !== 'TipoeCF') idDoc[k] = v
    }
    enc.IdDoc = idDoc
  }

  let body = '<Encabezado>'
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

  if (ecf.DetallesItems) body += jsonToXml('DetallesItems', ecf.DetallesItems)

  return `<?xml version="1.0" encoding="UTF-8"?><ECF>${body}</ECF>`
}

export function buildRFCEXml(data) {
  // NESTED IdDoc/Emisor/Totales groupings per DGII XSD — flat layout gets
  // rejected 'Archivo no válido' (codigo 001). Mirrors electron builder.
  let body = '<Encabezado>'
  body += jsonToXml('Version', '1.0')

  let idDoc = ''
  idDoc += jsonToXml('TipoeCF', '32')
  idDoc += jsonToXml('eNCF', data.eNCF)
  idDoc += jsonToXml('TipoIngresos', data.tipoIngresos || '01')
  idDoc += jsonToXml('TipoPago', data.tipoPago || '1')
  if (data.formasPago) idDoc += jsonToXml('TablaFormasPago', data.formasPago)
  if (data.indicadorEnvioDiferido) idDoc += jsonToXml('IndicadorEnvioDiferido', '1')
  body += `<IdDoc>${idDoc}</IdDoc>`

  let emisor = ''
  emisor += jsonToXml('RNCEmisor', data.emisor.rnc)
  emisor += jsonToXml('RazonSocialEmisor', data.emisor.nombre)
  emisor += jsonToXml('FechaEmision', data.fechaEmision)
  body += `<Emisor>${emisor}</Emisor>`

  if (data.comprador?.rnc) {
    let comprador = ''
    comprador += jsonToXml('RNCComprador', data.comprador.rnc)
    comprador += jsonToXml('RazonSocialComprador', data.comprador.nombre)
    body += `<Comprador>${comprador}</Comprador>`
  }

  const t = data.totales
  let totales = ''
  if (t.montoGravadoTotal) totales += jsonToXml('MontoGravadoTotal', t.montoGravadoTotal)
  if (t.montoGravadoI1) totales += jsonToXml('MontoGravadoI1', t.montoGravadoI1)
  if (t.montoGravadoI2) totales += jsonToXml('MontoGravadoI2', t.montoGravadoI2)
  if (t.montoGravadoI3) totales += jsonToXml('MontoGravadoI3', t.montoGravadoI3)
  if (t.montoExento) totales += jsonToXml('MontoExento', t.montoExento)
  if (t.totalITBIS) totales += jsonToXml('TotalITBIS', t.totalITBIS)
  if (t.totalITBIS1) totales += jsonToXml('TotalITBIS1', t.totalITBIS1)
  if (t.totalITBIS2) totales += jsonToXml('TotalITBIS2', t.totalITBIS2)
  if (t.totalITBIS3) totales += jsonToXml('TotalITBIS3', t.totalITBIS3)
  totales += jsonToXml('MontoTotal', t.montoTotal || t.total)
  body += `<Totales>${totales}</Totales>`

  if (data.securityCode) body += jsonToXml('CodigoSeguridadeCF', data.securityCode)
  body += '</Encabezado>'

  return `<?xml version="1.0" encoding="UTF-8"?><RFCE>${body}</RFCE>`
}

/**
 * buildARECFXml — builds Acuse de Recibo XML (for receiver endpoints).
 * @param {object} data — { rncEmisor, eNCF, estado (0|1|2), fechaRecepcion? }
 */
export function buildARECFXml(data) {
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
 * @param {object} data — { rncEmisor, eNCF, estado (1|2), comentario?, fecha? }
 */
export function buildACECFXml(data) {
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
 * Schema parity with electron/xml-builder.js (verified via DGII rejection
 * errors 2026-04-24): Encabezado(Version, RncEmisor, CantidadeNCFAnulados,
 * FechaHoraAnulacioneNCF) + DetalleAnulacion(Anulacion[NoLinea, TipoeCF,
 * TablaRangoSecuenciasAnuladaseNCF(Secuencias[SecuenciaeNCFDesde,
 * SecuenciaeNCFHasta]), CantidadeNCFAnulados]).
 *
 * Accepts either rangos[] (multi-range) or legacy single-range
 * { rangoDesde, rangoHasta, tipoECF }.
 *
 * @param {object} data — {
 *   rncEmisor, cantidadNCF, tipoECF,
 *   rangos?: [{ tipoECF?, ncfDesde, ncfHasta }],
 *   rangoDesde?, rangoHasta?
 * }
 */
export function buildANECFXml(data) {
  const rncClean = String(data.rncEmisor || '').replace(/[-\s]/g, '')

  const rangos = Array.isArray(data.rangos) && data.rangos.length
    ? data.rangos
    : [{ tipoECF: data.tipoECF, ncfDesde: data.rangoDesde, ncfHasta: data.rangoHasta }]

  const normTipoeCF = (t) => {
    const s = String(t || '').replace(/^E/i, '').padStart(2, '0')
    return s.slice(0, 2)
  }

  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  const fecha = `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

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
 * getFileName — DGII-compliant filename: {RNCEmisor}{eNCF}.xml
 */
export function getFileName(rncEmisor, eNCF) {
  return `${String(rncEmisor || '').replace(/[-\s]/g, '')}${eNCF}.xml`
}
