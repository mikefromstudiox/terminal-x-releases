/**
 * POST /fe/recepcion/api/ecf
 * Receives an e-CF from DGII (multipart/form-data), validates it,
 * returns a signed ARECF (Acuse de Recibo).
 *
 * Only accepts: E31, E33, E34, E44 (as buyer/receiver)
 * Rejects: E32, E41, E43, E45, E46, E47 (not valid for receiver)
 */
import { SignedXml } from 'xml-crypto'
import { DOMParser } from '@xmldom/xmldom'
import jwt from 'jsonwebtoken'

const OUR_RNC = '133410321'
const VALID_TYPES = ['31', '33', '34', '44']

function parseEcfXml(body, contentType) {
  const boundaryMatch = contentType.match(/boundary=(.+?)(?:;|$)/)
  if (boundaryMatch) {
    const parts = body.split(boundaryMatch[1].trim())
    for (const part of parts) {
      const endIdx = part.lastIndexOf('</ECF>')
      if (endIdx === -1) continue
      let startIdx = part.indexOf('<?xml')
      if (startIdx === -1) startIdx = part.indexOf('<ECF')
      if (startIdx !== -1) return part.substring(startIdx, endIdx + '</ECF>'.length)
    }
  }
  const endIdx = body.lastIndexOf('</ECF>')
  if (endIdx !== -1) {
    let startIdx = body.indexOf('<?xml')
    if (startIdx === -1) startIdx = body.indexOf('<ECF')
    if (startIdx !== -1) return body.substring(startIdx, endIdx + '</ECF>'.length)
  }
  return null
}

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`))
  return m ? m[1] : null
}

function fmtDateTime() {
  const d = new Date()
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${dd}-${mm}-${yyyy} ${hh}:${mi}:${ss}`
}

function buildARECF(rncEmisor, rncComprador, encf, estado, codigoMotivo) {
  let xml = '<?xml version="1.0" encoding="utf-8"?>'
  xml += '<ARECF>'
  xml += '<DetalleAcusedeRecibo>'
  xml += '<Version>1.0</Version>'
  xml += `<RNCEmisor>${rncEmisor}</RNCEmisor>`
  xml += `<RNCComprador>${rncComprador}</RNCComprador>`
  xml += `<eNCF>${encf}</eNCF>`
  xml += `<Estado>${estado}</Estado>`
  if (codigoMotivo) xml += `<CodigoMotivoNoRecibido>${codigoMotivo}</CodigoMotivoNoRecibido>`
  xml += `<FechaHoraAcuseRecibo>${fmtDateTime()}</FechaHoraAcuseRecibo>`
  xml += '</DetalleAcusedeRecibo>'
  xml += '</ARECF>'
  return xml
}

function signXml(xml, rootTag, keyPem, certPem) {
  const sig = new SignedXml()
  sig.signingKey = keyPem
  sig.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'
  sig.canonicalizationAlgorithm = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
  sig.addReference(`//*[local-name()='${rootTag}']`, ['http://www.w3.org/2000/09/xmldsig#enveloped-signature'], 'http://www.w3.org/2001/04/xmlenc#sha256', null, null, null, true)
  const certB64 = certPem.replace(/-----BEGIN CERTIFICATE-----/g, '').replace(/-----END CERTIFICATE-----/g, '').replace(/\s/g, '')
  sig.keyInfoProvider = { getKeyInfo: () => `<X509Data><X509Certificate>${certB64}</X509Certificate></X509Data>` }
  sig.computeSignature(xml)
  return sig.getSignedXml()
}

export const config = { api: { bodyParser: false } }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const auth = req.headers['authorization'] || ''
  const token = auth.replace('Bearer ', '')
  if (!token) {
    res.status(401).json({ error: 'Missing authorization token' })
    return
  }

  const keyPem = (process.env.DGII_KEY_PEM || '').replace(/\\n/g, '\n')
  const certPem = (process.env.DGII_CERT_PEM || '').replace(/\\n/g, '\n')
  if (!keyPem || !certPem) {
    res.status(500).json({ error: 'Server certificate not configured' })
    return
  }

  try {
    jwt.verify(token, keyPem, { algorithms: ['RS256'] })
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
    return
  }

  try {
    const contentType = req.headers['content-type'] || ''
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const bodyStr = Buffer.concat(chunks).toString('utf8')
    const ecfXml = parseEcfXml(bodyStr, contentType)

    if (!ecfXml) {
      res.status(400).json({ error: 'No ECF XML found in request' })
      return
    }

    const rncEmisor = extractTag(ecfXml, 'RNCEmisor')
    const rncComprador = extractTag(ecfXml, 'RNCComprador')
    const encf = extractTag(ecfXml, 'eNCF')
    const tipoeCF = extractTag(ecfXml, 'TipoeCF')

    if (!rncEmisor || !encf || !tipoeCF) {
      res.status(400).json({ error: 'Missing required e-CF fields' })
      return
    }

    let estado = '0'  // Recibido
    let codigoMotivo = null

    if (!VALID_TYPES.includes(tipoeCF)) {
      estado = '1'
      codigoMotivo = '1'
    }

    if (rncComprador !== OUR_RNC) {
      estado = '1'
      codigoMotivo = '4'
    }

    const arecfXml = buildARECF(rncEmisor, rncComprador || OUR_RNC, encf, estado, codigoMotivo)
    const signedArecf = signXml(arecfXml, 'ARECF', keyPem, certPem)

    res.setHeader('Content-Type', 'application/xml')
    res.status(200).send(signedArecf)
  } catch (err) {
    res.status(500).json({ error: 'Processing failed: ' + err.message })
  }
}
