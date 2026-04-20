/**
 * POST /fe/autenticacion/api/validacioncertificado
 * Receives the emisor's signed seed (multipart or raw XML), verifies it,
 * returns a JWT.
 *
 * v2.13.0 (architectural correction, 2026-04-20):
 * -------------------------------------------------
 * Prior revision pinned a `DGII_PUBLIC_CERT_PEM` env. That was wrong —
 * DGII does not sign seeds. The correct model:
 *   1. /semilla issues an UNSIGNED seed and persists <valor> as OUTSTANDING.
 *   2. Emisor signs with their .p12 and posts back here.
 *   3. verifySeed()   — XMLDSIG crypto + emisor cert window + clock skew.
 *   4. requireIssuedNonce(valor) — we-issued-this check.
 *   5. consumeNonce(valor)       — atomic single-use transition.
 *   6. Mint JWT carrying the emisor's RNC (extracted from cert Subject).
 *
 * Known gap (TODO v2.14): cert-chain validation to trusted Dominican CA
 * (Camara de Comercio SD / Viafirma / Avansi). Requires pinning the CA
 * root certs as env (DOMINICAN_FE_CA_ROOTS) + chain validation via
 * node-forge or a dedicated PKIX lib. Current impl validates crypto
 * integrity + our-nonce-only, which is a meaningful uplift from the
 * pre-v2.13 "accept any XML" but still trusts emisor self-identification.
 *
 * Opaque failure codes keep probing adversaries blind. DGII_VERIFY_OPEN=1
 * disables gates entirely (emergency bypass).
 */
import jwt from 'jsonwebtoken'
import {
  verifySeed,
  requireIssuedNonce,
  consumeNonce,
} from '../../lib/dgii-seed-verify.js'

const _seedNonceTtl = 5 * 60 * 1000
const _seedSeen = new Map()   // valor -> { token, exp }
function sweepNonces() {
  const now = Date.now()
  for (const [k, v] of _seedSeen) if (v.exp <= now) _seedSeen.delete(k)
}

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

    const keyPem = process.env.DGII_KEY_PEM
    if (!keyPem) {
      res.status(500).json({ error: 'Server certificate not configured' })
      return
    }
    const key = keyPem.replace(/\\n/g, '\n')

    // 1) Crypto + cert-window + clock skew.
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

    // 2) Same-process idempotency — lets DGII double-posts re-mint the
    //    same JWT without a replay rejection from Supabase.
    sweepNonces()
    const cached = _seedSeen.get(valor)
    if (cached && cached.exp > Date.now()) {
      const nowIso = new Date().toISOString()
      const expiraIso = new Date(Date.now() + 3600000).toISOString()
      respondToken(req, res, cached.token, expiraIso, nowIso)
      return
    }

    // 3) We-issued-this gate.
    try {
      await requireIssuedNonce(valor)
    } catch (e) {
      const code = e?.message || 'SEED_NOT_ISSUED'
      res.status(401).json({ error: 'Seed not recognized', code })
      return
    }

    // 4) Atomic single-use consume.
    try {
      await consumeNonce(valor)
    } catch (e) {
      if (e?.message === 'SEED_REPLAY_OR_UNKNOWN') {
        res.status(401).json({ error: 'Seed already consumed', code: 'SEED_REPLAY_OR_UNKNOWN' })
        return
      }
      // any other error = fail-open inside consumeNonce (logged there)
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
  } catch (err) {
    res.status(500).json({ error: 'Verification failed' })
  }
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
