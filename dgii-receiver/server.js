/**
 * DGII e-CF Receiver Server
 * Handles Steps 8-11: semilla, validarcertificado, recepcion, aprobacion
 *
 * Run: node server.js
 * Listens on port 3100
 */
const express = require('express')
const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const { SignedXml } = require('xml-crypto')
const { DOMParser } = require('@xmldom/xmldom')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = 3100
const OUR_RNC = '133410321'

// Load certificates
const keyPem = fs.readFileSync(path.join(__dirname, 'dgii-key.pem'), 'utf8')
const certPem = fs.readFileSync(path.join(__dirname, 'dgii-cert.pem'), 'utf8')

// Raw body for all requests
app.use((req, res, next) => {
  const chunks = []
  req.on('data', c => chunks.push(c))
  req.on('end', () => { req.rawBody = Buffer.concat(chunks).toString('utf8'); next() })
})

// ── Semilla ──
app.all('/fe/autenticacion/api/semilla', (req, res) => {
  const randomValue = crypto.randomBytes(128).toString('base64')
  const date = new Date()
  const offset = -4
  const localDate = new Date(date.getTime() + offset * 3600 * 1000)
  const formattedDate = localDate.toISOString().replace('Z', '-04:00')
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<SemillaModel xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
    <valor>${randomValue}</valor>
    <fecha>${formattedDate}</fecha>
</SemillaModel>`
  console.log(`[${new Date().toISOString()}] ${req.method} /semilla → 200`)
  res.set('Content-Type', 'application/xml').send(xml)
})

// ── ValidacionCertificado ──
app.all('/fe/autenticacion/api/ValidacionCertificado', handleValidacion)
app.all('/fe/autenticacion/api/validacioncertificado', handleValidacion)

function handleValidacion(req, res) {
  try {
    const body = req.rawBody
    const contentType = req.headers['content-type'] || ''
    let signedXml = null

    if (contentType.includes('multipart')) {
      signedXml = parseMultipartXml(body, contentType, 'SemillaModel')
    }
    if (!signedXml && body && body.includes('<SemillaModel')) {
      const start = body.indexOf('<?xml')
      const end = body.lastIndexOf('</SemillaModel>')
      if (start >= 0 && end >= 0) signedXml = body.substring(start, end + '</SemillaModel>'.length)
    }
    if (!signedXml) signedXml = body

    if (!signedXml || !signedXml.includes('<SemillaModel')) {
      console.log(`[${new Date().toISOString()}] POST /ValidacionCertificado → 400 no XML`)
      return res.status(400).json({ error: 'Invalid signed seed' })
    }

    const valorMatch = signedXml.match(/<valor>([^<]+)<\/valor>/i)
    const signatureMatch = signedXml.match(/<SignatureValue>([^<]+)<\/SignatureValue>/)

    if (!valorMatch || !signatureMatch) {
      console.log(`[${new Date().toISOString()}] POST /ValidacionCertificado → 400 invalid seed`)
      return res.status(400).json({ error: 'Invalid signed seed' })
    }

    const token = jwt.sign(
      { valor: valorMatch[1], timestamp: new Date().toISOString() },
      keyPem,
      { algorithm: 'RS256', expiresIn: '1h' }
    )

    const now = new Date()
    const expira = new Date(now.getTime() + 3600000).toISOString()
    const expedido = now.toISOString()
    console.log(`[${new Date().toISOString()}] POST /ValidacionCertificado → 200 token issued`)

    const accept = req.headers['accept'] || ''
    if (accept.includes('application/json')) {
      res.json({ token, expira, expedido })
    } else {
      res.set('Content-Type', 'application/xml').send(
        `<?xml version="1.0" encoding="utf-8"?>\n<AutenticacionResponse>\n  <token>${token}</token>\n  <expira>${expira}</expira>\n  <expedido>${expedido}</expedido>\n</AutenticacionResponse>`
      )
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] POST /ValidacionCertificado → 500`, err.message)
    res.status(500).json({ error: err.message })
  }
}

// ── Recepcion e-CF ──
app.post('/fe/recepcion/api/ecf', (req, res) => {
  const auth = (req.headers['authorization'] || '').replace('Bearer ', '')
  if (!auth) {
    console.log(`[${new Date().toISOString()}] POST /recepcion → 401 no token`)
    return res.status(401).json({ error: 'Missing token' })
  }

  try { jwt.verify(auth, keyPem, { algorithms: ['RS256'] }) }
  catch {
    console.log(`[${new Date().toISOString()}] POST /recepcion → 401 invalid token`)
    return res.status(401).json({ error: 'Invalid token' })
  }

  try {
    const contentType = req.headers['content-type'] || ''
    const ecfXml = parseMultipartXml(req.rawBody, contentType, 'ECF')
    if (!ecfXml) {
      console.log(`[${new Date().toISOString()}] POST /recepcion → 400 no XML`)
      return res.status(400).json({ error: 'No ECF XML found' })
    }

    const rncEmisor = tag(ecfXml, 'RNCEmisor')
    const rncComprador = tag(ecfXml, 'RNCComprador')
    const encf = tag(ecfXml, 'eNCF')
    const tipoeCF = tag(ecfXml, 'TipoeCF')

    let estado = '0', codigoMotivo = null
    if (!['31', '33', '34', '44'].includes(tipoeCF)) { estado = '1'; codigoMotivo = '1' }
    if (rncComprador && rncComprador !== OUR_RNC) { estado = '1'; codigoMotivo = '4' }

    const arecf = buildARECF(rncEmisor, rncComprador || OUR_RNC, encf, estado, codigoMotivo)
    const signed = signXml(arecf, 'ARECF')

    console.log(`[${new Date().toISOString()}] POST /recepcion → 200 E${tipoeCF} ${encf} estado=${estado}`)
    res.set('Content-Type', 'application/xml').send(signed)
  } catch (err) {
    console.error(`[${new Date().toISOString()}] POST /recepcion → 500`, err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Aprobacion Comercial ──
app.post('/fe/aprobacioncomercial/api/ecf', (req, res) => {
  const auth = (req.headers['authorization'] || '').replace('Bearer ', '')
  if (!auth) {
    console.log(`[${new Date().toISOString()}] POST /aprobacion → 401 no token`)
    return res.status(401).json({ error: 'Missing token' })
  }

  try { jwt.verify(auth, keyPem, { algorithms: ['RS256'] }) }
  catch {
    console.log(`[${new Date().toISOString()}] POST /aprobacion → 401 invalid token`)
    return res.status(401).json({ error: 'Invalid token' })
  }

  try {
    const contentType = req.headers['content-type'] || ''
    const ecfXml = parseMultipartXml(req.rawBody, contentType, 'ECF')
    if (!ecfXml) {
      console.log(`[${new Date().toISOString()}] POST /aprobacion → 400 no XML`)
      return res.status(400).json({ error: 'No ECF XML found' })
    }

    const rncEmisor = tag(ecfXml, 'RNCEmisor')
    const encf = tag(ecfXml, 'eNCF')
    const fechaEmision = tag(ecfXml, 'FechaEmision')
    const montoTotal = tag(ecfXml, 'MontoTotal')
    const rncComprador = tag(ecfXml, 'RNCComprador') || OUR_RNC

    const acecf = buildACECF(rncEmisor, encf, fechaEmision || '', montoTotal || '0', rncComprador)
    const signed = signXml(acecf, 'ACECF')

    console.log(`[${new Date().toISOString()}] POST /aprobacion → 200 ${encf} approved`)
    res.set('Content-Type', 'application/xml').send(signed)
  } catch (err) {
    console.error(`[${new Date().toISOString()}] POST /aprobacion → 500`, err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Helpers ──
function tag(xml, t) { const m = xml.match(new RegExp(`<${t}>([^<]+)</${t}>`)); return m ? m[1] : null }

function parseMultipartXml(body, contentType, rootTag) {
  if (!body) return null
  const boundaryMatch = contentType.match(/boundary=(.+?)(?:;|$)/)
  if (boundaryMatch) {
    const parts = body.split(boundaryMatch[1].trim())
    for (const part of parts) {
      const xmlStart = part.indexOf('<?xml')
      if (xmlStart !== -1) {
        const endTag = `</${rootTag}>`
        const xmlEnd = part.lastIndexOf(endTag)
        if (xmlEnd !== -1) return part.substring(xmlStart, xmlEnd + endTag.length)
      }
    }
  }
  if (body.includes('<?xml')) return body
  return null
}

function fmtDateTime() {
  const d = new Date()
  return [String(d.getDate()).padStart(2,'0'), String(d.getMonth()+1).padStart(2,'0'), d.getFullYear()].join('-') + ' ' + [String(d.getHours()).padStart(2,'0'), String(d.getMinutes()).padStart(2,'0'), String(d.getSeconds()).padStart(2,'0')].join(':')
}

function buildARECF(rncEmisor, rncComprador, encf, estado, codigoMotivo) {
  let xml = '<?xml version="1.0" encoding="utf-8"?><ARECF><DetalleAcusedeRecibo><Version>1.0</Version>'
  xml += `<RNCEmisor>${rncEmisor}</RNCEmisor><RNCComprador>${rncComprador}</RNCComprador><eNCF>${encf}</eNCF>`
  xml += `<Estado>${estado}</Estado>`
  if (codigoMotivo) xml += `<CodigoMotivoNoRecibido>${codigoMotivo}</CodigoMotivoNoRecibido>`
  xml += `<FechaHoraAcuseRecibo>${fmtDateTime()}</FechaHoraAcuseRecibo></DetalleAcusedeRecibo></ARECF>`
  return xml
}

function buildACECF(rncEmisor, encf, fechaEmision, montoTotal, rncComprador) {
  let xml = '<?xml version="1.0" encoding="utf-8"?><ACECF><DetalleAprobacionComercial><Version>1.0</Version>'
  xml += `<RNCEmisor>${rncEmisor}</RNCEmisor><eNCF>${encf}</eNCF>`
  xml += `<FechaEmision>${fechaEmision}</FechaEmision><MontoTotal>${montoTotal}</MontoTotal>`
  xml += `<RNCComprador>${rncComprador}</RNCComprador><Estado>1</Estado>`
  xml += `<FechaHoraAprobacionComercial>${fmtDateTime()}</FechaHoraAprobacionComercial></DetalleAprobacionComercial></ACECF>`
  return xml
}

function signXml(xml, rootTag) {
  const sig = new SignedXml()
  sig.signingKey = keyPem
  sig.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'
  sig.canonicalizationAlgorithm = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
  sig.addReference(`//*[local-name()='${rootTag}']`, ['http://www.w3.org/2000/09/xmldsig#enveloped-signature'], 'http://www.w3.org/2001/04/xmlenc#sha256')
  const certB64 = certPem.replace(/-----BEGIN CERTIFICATE-----/g, '').replace(/-----END CERTIFICATE-----/g, '').replace(/\s/g, '')
  sig.keyInfoProvider = { getKeyInfo: () => `<X509Data><X509Certificate>${certB64}</X509Certificate></X509Data>` }
  sig.computeSignature(xml)
  return sig.getSignedXml()
}

app.listen(PORT, '0.0.0.0', () => console.log(`DGII Receiver listening on 0.0.0.0:${PORT}`))
