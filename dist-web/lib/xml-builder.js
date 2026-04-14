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
  let body = '<Encabezado>'
  body += jsonToXml('Version', '1.0')
  body += jsonToXml('TipoeCF', '32')
  body += jsonToXml('eNCF', data.eNCF)
  body += jsonToXml('TipoIngresos', data.tipoIngresos || '01')
  body += jsonToXml('TipoPago', data.tipoPago || '1')
  if (data.formasPago) body += jsonToXml('TablaFormasPago', data.formasPago)
  body += jsonToXml('RNCEmisor', data.emisor.rnc)
  body += jsonToXml('RazonSocialEmisor', data.emisor.nombre)
  body += jsonToXml('FechaEmision', data.fechaEmision)
  if (data.comprador?.rnc) {
    body += jsonToXml('RNCComprador', data.comprador.rnc)
    body += jsonToXml('RazonSocialComprador', data.comprador.nombre)
  }
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

  return `<?xml version="1.0" encoding="UTF-8"?><RFCE>${body}</RFCE>`
}
