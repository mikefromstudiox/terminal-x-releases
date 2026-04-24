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
