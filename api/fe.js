/**
 * /api/fe?action=<name> — consolidated DGII receiver router
 *
 * Vercel Hobby caps us at 12 serverless functions. Pre-v2.16.3 we burned
 * 4 of them on /api/fe/{semilla,validarcertificado,recepcion,aprobacion}.
 * This single file routes all four via ?action=<name>, dropping us from
 * 12 → 9 functions while preserving every public URL through vercel.json
 * rewrites — DGII's existing config keeps working with zero changes.
 *
 * action whitelist:
 *   semilla              → unsigned <SemillaModel> + persist OUTSTANDING nonce
 *   validarcertificado   → verify signed seed → mint JWT (multipart or raw XML)
 *   recepcion            → receive e-CF, return signed ARECF
 *   aprobacion           → receive e-CF, return signed ACECF
 *
 * Each branch preserves its original method gate, body parser config, and
 * response semantics. The exported `config.api.bodyParser = false` is the
 * superset (raw bodies for the 3 POST branches; semilla doesn't read req).
 */
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { SignedXml } from 'xml-crypto'
import { DOMParser } from '@xmldom/xmldom'
import {
  persistIssuedNonce,
  verifySeed,
  requireIssuedNonce,
  consumeNonce,
} from '../lib/dgii-seed-verify.js'
import { withReporting } from '../lib/report-server-error.js'

export const config = { api: { bodyParser: false } }

const OUR_RNC = '133410321'
const VALID_TYPES = ['31', '33', '34', '44']

// ── shared helpers ──────────────────────────────────────────────────────────
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
function parseSeedMultipart(body, contentType) {
  const boundaryMatch = contentType.match(/boundary=(.+?)(?:;|$)/)
  if (!boundaryMatch) return null
  const boundary = boundaryMatch[1].trim()
  const parts = body.split(boundary)
  for (const part of parts) {
    const xmlStart = part.indexOf('<?xml')
    if (xmlStart !== -1) {
      const xmlEnd = part.lastIndexOf('</SemillaModel>')
      if (xmlEnd !== -1) return part.substring(xmlStart, xmlEnd + '</SemillaModel>'.length)
    }
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
function buildACECF(rncEmisor, encf, fechaEmision, montoTotal, rncComprador) {
  let xml = '<?xml version="1.0" encoding="utf-8"?>'
  xml += '<ACECF>'
  xml += '<DetalleAprobacionComercial>'
  xml += '<Version>1.0</Version>'
  xml += `<RNCEmisor>${rncEmisor}</RNCEmisor>`
  xml += `<eNCF>${encf}</eNCF>`
  xml += `<FechaEmision>${fechaEmision}</FechaEmision>`
  xml += `<MontoTotal>${montoTotal}</MontoTotal>`
  xml += `<RNCComprador>${rncComprador}</RNCComprador>`
  xml += '<Estado>1</Estado>'
  xml += `<FechaHoraAprobacionComercial>${fmtDateTime()}</FechaHoraAprobacionComercial>`
  xml += '</DetalleAprobacionComercial>'
  xml += '</ACECF>'
  return xml
}
function signXml(xml, rootTag, keyPem, certPem) {
  const certB64 = certPem.replace(/-----BEGIN CERTIFICATE-----/g, '').replace(/-----END CERTIFICATE-----/g, '').replace(/\s/g, '')
  const sig = new SignedXml({
    privateKey: keyPem,
    publicCert: certPem,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    getKeyInfoContent: () => `<X509Data><X509Certificate>${certB64}</X509Certificate></X509Data>`,
  })
  sig.addReference({
    xpath: `//*[local-name()='${rootTag}']`,
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature'],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    isEmptyUri: true,
  })
  sig.computeSignature(xml)
  return sig.getSignedXml()
}
async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

// ── action: semilla ─────────────────────────────────────────────────────────
async function handleSemilla(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const randomValue = crypto.randomBytes(128).toString('base64')
  const date = new Date()
  const offset = -4
  const localDate = new Date(date.getTime() + offset * 3600 * 1000)
  const formattedDate = localDate.toISOString().replace('Z', '-04:00')
  try { await persistIssuedNonce(randomValue) } catch {}
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<SemillaModel xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
    <valor>${randomValue}</valor>
    <fecha>${formattedDate}</fecha>
</SemillaModel>`
  res.setHeader('Content-Type', 'application/xml')
  res.status(200).send(xml)
}

// ── action: validarcertificado ──────────────────────────────────────────────
const _seedNonceTtl = 5 * 60 * 1000
const _seedSeen = new Map()
function sweepNonces() {
  const now = Date.now()
  for (const [k, v] of _seedSeen) if (v.exp <= now) _seedSeen.delete(k)
}
function respondToken(req, res, token, expira, expedido) {
  const accept = req.headers['accept'] || ''
  if (accept.includes('application/json')) {
    res.setHeader('Content-Type', 'application/json')
    res.status(200).json({ token, expira, expedido })
  } else {
    const tokenXml = `<?xml version="1.0" encoding="utf-8"?>\n<AutenticacionResponse>\n  <token>${token}</token>\n  <expira>${expira}</expira>\n  <expedido>${expedido}</expedido>\n</AutenticacionResponse>`
    res.setHeader('Content-Type', 'application/xml')
    res.status(200).send(tokenXml)
  }
}
async function handleValidarCertificado(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  try {
    const contentType = req.headers['content-type'] || ''
    const bodyStr = await readBody(req)
    let signedXml = null
    if (contentType.includes('multipart')) signedXml = parseSeedMultipart(bodyStr, contentType)
    if (!signedXml && bodyStr.includes('<SemillaModel')) {
      const start = bodyStr.indexOf('<?xml')
      const end = bodyStr.lastIndexOf('</SemillaModel>')
      if (start >= 0 && end >= 0) signedXml = bodyStr.substring(start, end + '</SemillaModel>'.length)
    }
    if (!signedXml) signedXml = bodyStr
    if (!signedXml || !signedXml.includes('<SemillaModel')) {
      res.status(400).json({ error: 'Invalid signed seed XML' })
      return
    }
    const keyPem = process.env.DGII_KEY_PEM
    if (!keyPem) {
      res.status(500).json({ error: 'Server certificate not configured' })
      return
    }
    const key = keyPem.replace(/\\n/g, '\n')
    let valor, fecha, emisorCert
    try {
      const parsed = verifySeed(signedXml)
      valor = parsed.valor
      fecha = parsed.fecha
      emisorCert = parsed.emisorCert || {}
    } catch (e) {
      const code = e?.message || 'SEED_INVALID'
      res.status(401).json({ error: 'Invalid signed seed', code })
      return
    }
    sweepNonces()
    const cached = _seedSeen.get(valor)
    if (cached && cached.exp > Date.now()) {
      const nowIso = new Date().toISOString()
      const expiraIso = new Date(Date.now() + 3600000).toISOString()
      respondToken(req, res, cached.token, expiraIso, nowIso)
      return
    }
    try {
      await requireIssuedNonce(valor)
    } catch (e) {
      const code = e?.message || 'SEED_NOT_ISSUED'
      res.status(401).json({ error: 'Seed not recognized', code })
      return
    }
    try {
      await consumeNonce(valor)
    } catch (e) {
      if (e?.message === 'SEED_REPLAY_OR_UNKNOWN') {
        res.status(401).json({ error: 'Seed already consumed', code: 'SEED_REPLAY_OR_UNKNOWN' })
        return
      }
    }
    const rnc = emisorCert?.rnc || null
    const token = jwt.sign(
      {
        valor,
        timestamp: new Date().toISOString(),
        fecha,
        rnc,
        emisor: {
          rnc,
          subject: emisorCert?.subject || null,
          fingerprint: emisorCert?.fingerprint || null,
          notAfter: emisorCert?.notAfter || null,
        },
      },
      key,
      { algorithm: 'RS256', expiresIn: '1h' }
    )
    _seedSeen.set(valor, { token, exp: Date.now() + _seedNonceTtl })
    const nowIso = new Date().toISOString()
    const expiraIso = new Date(Date.now() + 3600000).toISOString()
    respondToken(req, res, token, expiraIso, nowIso)
  } catch {
    res.status(500).json({ error: 'Verification failed' })
  }
}

// ── action: recepcion ───────────────────────────────────────────────────────
async function handleRecepcion(req, res) {
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
    const { createPublicKey } = await import('node:crypto')
    const publicKey = createPublicKey(certPem)
    jwt.verify(token, publicKey, { algorithms: ['RS256'] })
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
    return
  }
  try {
    const contentType = req.headers['content-type'] || ''
    const bodyStr = await readBody(req)
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
    let estado = '0'
    let codigoMotivo = null
    if (!VALID_TYPES.includes(tipoeCF)) { estado = '1'; codigoMotivo = '1' }
    if (rncComprador !== OUR_RNC)       { estado = '1'; codigoMotivo = '4' }
    const arecfXml = buildARECF(rncEmisor, rncComprador || OUR_RNC, encf, estado, codigoMotivo)
    const signedArecf = signXml(arecfXml, 'ARECF', keyPem, certPem)
    res.setHeader('Content-Type', 'application/xml')
    res.status(200).send(signedArecf)
  } catch (err) {
    res.status(500).json({ error: 'Processing failed: ' + err.message })
  }
}

// ── action: aprobacion ──────────────────────────────────────────────────────
async function handleAprobacion(req, res) {
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
    const { createPublicKey } = await import('node:crypto')
    const publicKey = createPublicKey(certPem)
    jwt.verify(token, publicKey, { algorithms: ['RS256'] })
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
    return
  }
  try {
    const contentType = req.headers['content-type'] || ''
    const bodyStr = await readBody(req)
    const ecfXml = parseEcfXml(bodyStr, contentType)
    if (!ecfXml) {
      res.status(400).json({ error: 'No ECF XML found in request' })
      return
    }
    const rncEmisor = extractTag(ecfXml, 'RNCEmisor')
    const encf = extractTag(ecfXml, 'eNCF')
    const fechaEmision = extractTag(ecfXml, 'FechaEmision')
    const montoTotal = extractTag(ecfXml, 'MontoTotal')
    const rncComprador = extractTag(ecfXml, 'RNCComprador') || OUR_RNC
    if (!rncEmisor || !encf) {
      res.status(400).json({ error: 'Missing required e-CF fields' })
      return
    }
    const acecfXml = buildACECF(rncEmisor, encf, fechaEmision || '', montoTotal || '0', rncComprador)
    const signedAcecf = signXml(acecfXml, 'ACECF', keyPem, certPem)
    res.setHeader('Content-Type', 'application/xml')
    res.status(200).send(signedAcecf)
  } catch (err) {
    res.status(500).json({ error: 'Processing failed: ' + err.message })
  }
}

// ── router ──────────────────────────────────────────────────────────────────
async function handler(req, res) {
  // For POST bodies we don't want to parse, but we need to peek at ?action=
  // first. Vercel populates req.query from the URL regardless of bodyParser.
  const action = String(req.query?.action || '').toLowerCase()
  switch (action) {
    case 'semilla':            return handleSemilla(req, res)
    case 'validarcertificado': return handleValidarCertificado(req, res)
    case 'recepcion':          return handleRecepcion(req, res)
    case 'aprobacion':         return handleAprobacion(req, res)
    default:
      res.status(404).json({ error: `Unknown fe action: ${action}` })
  }
}

export default withReporting(handler, { route: '/api/fe' })
