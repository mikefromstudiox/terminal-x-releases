/**
 * ecf-sign.js — Vercel serverless function for server-side e-CF signing.
 *
 * Web clients cannot sign e-CFs because the .p12 private key must stay server-side.
 * This endpoint receives the pre-built invoice payload (same shape as IPC dgii:submit),
 * loads the business's cert from Supabase, signs the XML, submits to DGII, and returns the result.
 *
 * Auth: Supabase JWT (Bearer token) — validates user, resolves business_id.
 * Cert storage: businesses.settings.ecf_private_key_pem + ecf_certificate_pem
 *   (pushed by desktop during bizSync after cert installation)
 */

import { createClient } from '@supabase/supabase-js'
import { buildECFXml, buildRFCEXml } from '../lib/xml-builder.js'
import { signXML } from '../lib/xml-signer.js'
import { authenticate, submitECF, submitRFCE, pollStatus, checkStatus, buildQRUrl, clearTokenCache } from '../lib/dgii-client.js'

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xbmhtrdhbnkgdliuxcha.supabase.co'
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

function json(res, status, data) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  return res.status(status).json(data)
}

// businesses.settings is JSONB but historical rows may be JSON-encoded strings.
// Normalise either shape into a native object before reading cert PEMs.
function parseSettingsIfString(raw) {
  let s = raw
  for (let i = 0; i < 3; i++) {
    if (typeof s !== 'string') break
    try { s = JSON.parse(s) } catch { return {} }
  }
  return (s && typeof s === 'object' && !Array.isArray(s)) ? s : {}
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true })
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'POST only' })

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return json(res, 401, { ok: false, error: 'Missing auth token' })
  const token = authHeader.slice(7)

  if (!SUPABASE_SERVICE_KEY) return json(res, 500, { ok: false, error: 'Server config error' })

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Validate JWT and get user
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return json(res, 401, { ok: false, error: 'Invalid token' })

  const body = req.body
  if (!body?.business_id) return json(res, 400, { ok: false, error: 'Missing business_id' })

  // ── EN_PROCESO reconciler (web FIX-C7) ────────────────────────────────
  // Action: 'status' — re-poll DGII for a single trackId and return the
  // final verdict. Used by InvoiceDashboard to drain the pending queue
  // without keeping a DB cron just for facturación-tier customers.
  if (body.action === 'status') {
    const bid = body.business_id
    const trackId = body.trackId
    if (!trackId) return json(res, 400, { ok: false, error: 'Missing trackId' })
    const { data: staffRow } = await supabase.from('staff').select('id').eq('business_id', bid).eq('auth_user_id', user.id).single()
    if (!staffRow) return json(res, 403, { ok: false, error: 'No access to this business' })
    const { data: biz } = await supabase.from('businesses').select('settings').eq('id', bid).single()
    const s = parseSettingsIfString(biz?.settings)
    if (!s.ecf_private_key_pem || !s.ecf_certificate_pem) return json(res, 400, { ok: false, error: 'Certificado no configurado' })
    try {
      const env = s.dgii_environment || 'certecf'
      const token = await authenticate(env, s.ecf_private_key_pem, s.ecf_certificate_pem)
      const result = await checkStatus(trackId, token, env)
      return json(res, 200, { ok: true, data: { codigo: result.codigo, estado: result.estado, mensajes: result.mensajes || [] } })
    } catch (err) {
      return json(res, 200, { ok: false, error: err.message || 'Error consultando DGII' })
    }
  }

  // Auth test mode — just verify cert is configured and DGII auth works
  if (body.test) {
    const bid = body.business_id
    const { data: staffRow } = await supabase.from('staff').select('id').eq('business_id', bid).eq('auth_user_id', user.id).single()
    if (!staffRow) return json(res, 403, { ok: false, error: 'No access to this business' })
    const { data: biz } = await supabase.from('businesses').select('settings').eq('id', bid).single()
    const s = parseSettingsIfString(biz?.settings)
    if (!s.ecf_private_key_pem || !s.ecf_certificate_pem) return json(res, 200, { ok: false, error: 'Certificado no configurado' })
    try {
      const env = s.dgii_environment || 'certecf'
      await authenticate(env, s.ecf_private_key_pem, s.ecf_certificate_pem)
      return json(res, 200, { ok: true, message: 'Conexión DGII exitosa' })
    } catch (err) {
      return json(res, 200, { ok: false, error: err.message })
    }
  }

  if (!body?.payload || !body?.eNCF) return json(res, 400, { ok: false, error: 'Missing payload or eNCF' })

  const bid = body.business_id

  // Verify user belongs to this business
  const { data: staffRow } = await supabase.from('staff').select('id').eq('business_id', bid).eq('auth_user_id', user.id).single()
  if (!staffRow) return json(res, 403, { ok: false, error: 'No access to this business' })

  // Load cert from business settings
  const { data: biz } = await supabase.from('businesses').select('settings,rnc').eq('id', bid).single()
  if (!biz) return json(res, 404, { ok: false, error: 'Business not found' })

  const bizSettings = parseSettingsIfString(biz.settings)
  const privateKeyPem = bizSettings.ecf_private_key_pem
  const certificatePem = bizSettings.ecf_certificate_pem
  const dgiiEnv = bizSettings.dgii_environment || 'certecf'

  if (!privateKeyPem || !certificatePem) {
    return json(res, 400, { ok: false, error: 'Certificado e-CF no configurado. Instale el .p12 desde el escritorio.' })
  }

  try {
    const tipoECF = String(body.tipoECF)
    const eNCF = body.eNCF
    const montoTotal = Number(body.montoTotal || body.totales?.total || 0)
    const isRFCE = tipoECF === '32' && montoTotal < 250000

    // Step 1: Build XML
    const xml = buildECFXml(body.payload, eNCF)

    // Step 2: Sign
    const { signedXml, securityCode, signatureDate } = signXML(xml, privateKeyPem, certificatePem)

    // Step 3: Authenticate with DGII
    const dgiiToken = await authenticate(dgiiEnv, privateKeyPem, certificatePem)

    let trackId, status, dgiiCodigo

    if (isRFCE) {
      // E32 < 250K — build + sign RFCE summary, submit to fc.dgii.gov.do
      const rfceXml = buildRFCEXml({
        emisor: body.emisor,
        totales: {
          montoGravadoTotal: Number(body.totales.subtotal).toFixed(2),
          montoGravadoI1: Number(body.totales.subtotal).toFixed(2),
          totalITBIS: Number(body.totales.itbis).toFixed(2),
          totalITBIS1: Number(body.totales.itbis).toFixed(2),
          montoTotal: montoTotal.toFixed(2),
        },
        eNCF,
        tipoIngresos: body.tipoIngresos || '01',
        tipoPago: body.tipoPago || '1',
        comprador: body.comprador,
        fechaEmision: body.fechaEmision,
        securityCode,
      })

      const { signedXml: signedRFCE } = signXML(rfceXml, privateKeyPem, certificatePem)
      const rfceResult = await submitRFCE(signedRFCE, dgiiToken, dgiiEnv)
      trackId = rfceResult.encf || eNCF
      dgiiCodigo = rfceResult.codigo
      status = dgiiCodigo === 1 || dgiiCodigo === '1' ? 'ACEPTADO' : rfceResult.estado || 'EN_PROCESO'
    } else {
      // Standard e-CF — submit signed XML
      const submitResult = await submitECF(signedXml, dgiiToken, dgiiEnv)
      trackId = submitResult.trackId

      // Poll for status
      const pollResult = await pollStatus(trackId, dgiiToken, dgiiEnv, { maxRetries: 5, delayMs: 1000 })
      dgiiCodigo = pollResult.codigo
      status = pollResult.estado
    }

    // Build QR URL
    const qrLink = buildQRUrl({
      env: dgiiEnv,
      rncEmisor: body.emisor?.rnc,
      rncComprador: body.comprador?.rnc || '',
      eNCF,
      fechaEmision: body.fechaEmision,
      montoTotal,
      fechaFirma: signatureDate,
      codigoSeguridad: securityCode,
      isRFCE,
    })

    return json(res, 200, {
      ok: true,
      data: {
        eNCF,
        status,
        trackId,
        submittedAt: new Date().toISOString(),
        securityCode,
        signatureDate,
        qrLink,
        dgiiCodigo,
      },
    })
  } catch (err) {
    clearTokenCache()
    return json(res, 500, { ok: false, error: err.message || 'Error signing e-CF' })
  }
}
