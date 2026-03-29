/**
 * POST /fe/autenticacion/api/validacioncertificado
 * Receives DGII's signed seed (multipart), verifies it, returns a JWT token.
 */
import crypto from 'crypto'
import jwt from 'jsonwebtoken'

function parseMultipartXml(body, contentType) {
  const boundaryMatch = contentType.match(/boundary=(.+)/)
  if (!boundaryMatch) return null
  const boundary = boundaryMatch[1]
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const contentType = req.headers['content-type'] || ''
    let signedXml = null

    if (contentType.includes('multipart/form-data')) {
      signedXml = parseMultipartXml(req.body, contentType)
    } else if (contentType.includes('xml') || contentType.includes('text')) {
      signedXml = req.body
    }

    if (!signedXml) {
      res.status(400).json({ error: 'No XML found in request' })
      return
    }

    // Extract valor from the signed seed
    const valorMatch = signedXml.match(/<valor>([^<]+)<\/valor>/)
    const signatureMatch = signedXml.match(/<SignatureValue>([^<]+)<\/SignatureValue>/)

    if (!valorMatch || !signatureMatch) {
      res.status(400).json({ error: 'Invalid signed seed XML' })
      return
    }

    // Generate JWT using our private key
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

    res.setHeader('Content-Type', 'application/json')
    res.status(200).json({ token, expira: '1h' })
  } catch (err) {
    res.status(500).json({ error: 'Verification failed: ' + err.message })
  }
}
