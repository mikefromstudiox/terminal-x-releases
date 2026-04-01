/**
 * POST /fe/autenticacion/api/validacioncertificado
 * Receives DGII's signed seed (multipart), verifies it, returns a JWT token.
 */
import jwt from 'jsonwebtoken'

function parseMultipartXml(body, contentType) {
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

export const config = { api: { bodyParser: false } }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const contentType = req.headers['content-type'] || ''
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const bodyStr = Buffer.concat(chunks).toString('utf8')
    console.log('[validarcertificado] Content-Type:', contentType)
    console.log('[validarcertificado] Body length:', bodyStr.length, 'has xml:', bodyStr.includes('<?xml'), 'has SemillaModel:', bodyStr.includes('SemillaModel'))
    let signedXml = null

    if (contentType.includes('multipart')) {
      signedXml = parseMultipartXml(bodyStr, contentType)
    }
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

    const valorMatch = signedXml.match(/<valor>([^<]+)<\/valor>/i)
    const signatureMatch = signedXml.match(/<SignatureValue>([^<]+)<\/SignatureValue>/)

    if (!valorMatch || !signatureMatch) {
      res.status(400).json({ error: 'Invalid signed seed XML' })
      return
    }

    const keyPem = process.env.DGII_KEY_PEM
    if (!keyPem) {
      res.status(500).json({ error: 'Server certificate not configured' })
      return
    }

    const key = keyPem.replace(/\\n/g, '\n')
    const token = jwt.sign(
      { valor: valorMatch[1], timestamp: new Date().toISOString() },
      key,
      { algorithm: 'RS256', expiresIn: '1h' }
    )

    const now = new Date()
    const expira = new Date(now.getTime() + 3600000).toISOString()
    const expedido = now.toISOString()

    const accept = req.headers['accept'] || ''
    if (accept.includes('application/json')) {
      res.setHeader('Content-Type', 'application/json')
      res.status(200).json({ token, expira, expedido })
    } else {
      const tokenXml = `<?xml version="1.0" encoding="utf-8"?>\n<AutenticacionResponse>\n  <token>${token}</token>\n  <expira>${expira}</expira>\n  <expedido>${expedido}</expedido>\n</AutenticacionResponse>`
      res.setHeader('Content-Type', 'application/xml')
      res.status(200).send(tokenXml)
    }
  } catch (err) {
    res.status(500).json({ error: 'Verification failed: ' + err.message })
  }
}
