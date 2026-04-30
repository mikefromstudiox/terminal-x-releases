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
import { buildECFXml, buildRFCEXml, buildARECFXml, buildACECFXml, buildANECFXml } from '../lib/xml-builder.js'
import { signXML } from '../lib/xml-signer.js'
import { authenticate, submitECF, submitRFCE, submitANECF, pollStatus, checkStatus, buildQRUrl, clearTokenCache } from '../lib/dgii-client.js'

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

  // ── Helper: resolve business + cert PEMs in one shot (DRY for action branches) ──
  async function loadBizCert(bid) {
    const { data: staffRow } = await supabase.from('staff').select('id').eq('business_id', bid).eq('auth_user_id', user.id).single()
    if (!staffRow) return { err: { status: 403, body: { ok: false, error: 'No access to this business' } } }
    const { data: biz } = await supabase.from('businesses').select('settings,rnc').eq('id', bid).single()
    if (!biz) return { err: { status: 404, body: { ok: false, error: 'Business not found' } } }
    const s = parseSettingsIfString(biz.settings)
    if (!s.ecf_private_key_pem || !s.ecf_certificate_pem) {
      return { err: { status: 400, body: { ok: false, error: 'Certificado e-CF no configurado. Instale el .p12 desde el escritorio.' } } }
    }
    return { biz, settings: s, env: s.dgii_environment || 'certecf' }
  }

  // ── Action: 'void' — sign + submit ANECF (Anulación de Rangos) to DGII ──
  // Body: { business_id, action:'void', rncEmisor, cantidadNCF, tipoECF,
  //         rangos?: [{ tipoECF?, ncfDesde, ncfHasta }],
  //         rangoDesde?, rangoHasta? }
  if (body.action === 'void') {
    const ctx = await loadBizCert(body.business_id)
    if (ctx.err) return json(res, ctx.err.status, ctx.err.body)
    try {
      const xml = buildANECFXml({
        rncEmisor: body.rncEmisor || ctx.biz.rnc,
        cantidadNCF: body.cantidadNCF,
        tipoECF: body.tipoECF,
        rangos: body.rangos,
        rangoDesde: body.rangoDesde,
        rangoHasta: body.rangoHasta,
      })
      const { signedXml } = signXML(xml, ctx.settings.ecf_private_key_pem, ctx.settings.ecf_certificate_pem)
      const dgiiToken = await authenticate(ctx.env, ctx.settings.ecf_private_key_pem, ctx.settings.ecf_certificate_pem)
      const result = await submitANECF(signedXml, dgiiToken, ctx.env)
      return json(res, 200, { ok: true, data: { codigo: result.codigo, mensajes: result.mensajes || [], nombre: result.nombre, signedXml } })
    } catch (err) {
      clearTokenCache()
      return json(res, 200, { ok: false, error: err.message || 'Error anulando rango' })
    }
  }

  // ── Action: 'arecf' — sign Acuse de Recibo (returned to caller) ──
  // ARECF/ACECF are peer-to-peer between issuer and receiver, NOT submitted
  // to DGII. We sign and return the XML; the caller forwards to the receiver.
  // Body: { business_id, action:'arecf', rncEmisor, eNCF, estado, fechaRecepcion? }
  if (body.action === 'arecf') {
    const ctx = await loadBizCert(body.business_id)
    if (ctx.err) return json(res, ctx.err.status, ctx.err.body)
    try {
      const xml = buildARECFXml({
        rncEmisor: body.rncEmisor || ctx.biz.rnc,
        eNCF: body.eNCF,
        estado: body.estado,
        fechaRecepcion: body.fechaRecepcion,
      })
      const { signedXml, securityCode, signatureDate } = signXML(xml, ctx.settings.ecf_private_key_pem, ctx.settings.ecf_certificate_pem)
      return json(res, 200, { ok: true, data: { signedXml, securityCode, signatureDate } })
    } catch (err) {
      return json(res, 200, { ok: false, error: err.message || 'Error firmando ARECF' })
    }
  }

  // ── Action: 'acecf' — sign Aprobación Comercial (returned to caller) ──
  // Body: { business_id, action:'acecf', rncEmisor, eNCF, estado, comentario?, fecha? }
  if (body.action === 'acecf') {
    const ctx = await loadBizCert(body.business_id)
    if (ctx.err) return json(res, ctx.err.status, ctx.err.body)
    try {
      const xml = buildACECFXml({
        rncEmisor: body.rncEmisor || ctx.biz.rnc,
        eNCF: body.eNCF,
        estado: body.estado,
        comentario: body.comentario,
        fecha: body.fecha,
      })
      const { signedXml, securityCode, signatureDate } = signXML(xml, ctx.settings.ecf_private_key_pem, ctx.settings.ecf_certificate_pem)
      return json(res, 200, { ok: true, data: { signedXml, securityCode, signatureDate } })
    } catch (err) {
      return json(res, 200, { ok: false, error: err.message || 'Error firmando ACECF' })
    }
  }

  // ── Action: 'sandbox-try' — public-ish demo of the e-CF emission flow ──
  // Anyone signed in (even on free trial / Pro base) can hit this to see a
  // realistic e-CF acceptance response. If the configured SANDBOX_BUSINESS_ID
  // has a cert installed, we sign + submit to DGII certecf for real.
  // Otherwise we return a synthetic-but-realistic response with a clear
  // _demo: true flag so the UI labels it accordingly.
  // Rate-limited to 10 calls / user / hour via api_rate_limits table.
  if (body.action === 'sandbox-try') {
    // Rate limit via the existing api_rate_limits bucket pattern. Bucket key
    // groups by user; window is top-of-hour; cap is 10 / user / hour.
    try {
      const hourStart = new Date(); hourStart.setMinutes(0, 0, 0)
      const bucket = `sandbox-try:${user.id}`
      const { data: rl } = await supabase.from('api_rate_limits')
        .select('count').eq('bucket', bucket).eq('window_start', hourStart.toISOString()).maybeSingle()
      const used = rl?.count || 0
      if (used >= 10) {
        return json(res, 200, { ok: false, error: 'Limite de pruebas alcanzado (10 por hora). Intente de nuevo en unos minutos.' })
      }
      // Increment best-effort.
      if (rl) {
        await supabase.from('api_rate_limits').update({ count: used + 1, updated_at: new Date().toISOString() })
          .eq('bucket', bucket).eq('window_start', hourStart.toISOString())
      } else {
        await supabase.from('api_rate_limits').insert({ bucket, window_start: hourStart.toISOString(), count: 1, updated_at: new Date().toISOString() })
      }
    } catch { /* non-fatal — better to allow than block on RL infra issue */ }

    const sandboxBid = process.env.SANDBOX_BUSINESS_ID || '1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79' // Studio X SRL fallback
    const { data: sandboxBiz } = await supabase.from('businesses').select('settings,rnc,name').eq('id', sandboxBid).single()
    const sandboxSettings = parseSettingsIfString(sandboxBiz?.settings)
    const hasCert = !!(sandboxSettings.ecf_private_key_pem && sandboxSettings.ecf_certificate_pem)

    // Build a deterministic "demo factura" — caller can pass an amount, we
    // default to RD$ 1,180 (RD$ 1,000 + 18% ITBIS).
    const demoAmount = Math.max(50, Math.min(50000, Number(body.amount) || 1000))
    const demoItbis = +(demoAmount * 0.18).toFixed(2)
    const demoTotal = +(demoAmount + demoItbis).toFixed(2)
    const demoEncf = `E32${String(Math.floor(Math.random() * 9999000000) + 1000000000).slice(-10)}`
    const fakeTrackId = `DEMO-${Date.now().toString(36).toUpperCase()}`
    const securityCode = Math.random().toString(36).slice(2, 8).toUpperCase()
    const fechaEmision = (() => {
      const d = new Date()
      return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`
    })()

    if (!hasCert) {
      // Synthetic response — clearly marked. Same shape as a real DGII accept.
      return json(res, 200, {
        ok: true,
        _sandbox: true,
        _demo: true,
        data: {
          eNCF: demoEncf,
          trackId: fakeTrackId,
          dgiiCodigo: 1,
          status: 'aceptado',
          mensajes: ['Comprobante aceptado'],
          securityCode,
          signatureDate: new Date().toISOString(),
          totales: { subtotal: demoAmount, itbis: demoItbis, total: demoTotal },
          emisor: { rnc: sandboxBiz?.rnc || '133410321', razon_social: sandboxBiz?.name || 'STUDIO X SRL' },
          fechaEmision,
          qrLink: `https://ecf.dgii.gov.do/certecf/ConsultaTimbre?RncEmisor=${sandboxBiz?.rnc || '133410321'}&ENCF=${demoEncf}&MontoTotal=${demoTotal}&CodigoSeguridad=${securityCode}`,
          _note: 'Modo demo: ningun e-CF fue enviado a DGII. Para ver la respuesta real de DGII, instale su certificado en /pos/dgii.',
        },
      })
    }

    // Real path: cert IS installed on the sandbox biz. Sign + submit to certecf.
    try {
      const env = 'certecf'
      const payload = {
        ECF: {
          Encabezado: {
            Version: '1.0',
            IdDoc: { TipoECF: '32', eNCF: demoEncf, FechaEmision: fechaEmision, IndicadorEnvioDiferido: '0', TipoIngresos: '01', TipoPago: '1' },
            Emisor: { RNCEmisor: (sandboxBiz?.rnc || '').replace(/\D/g, ''), RazonSocialEmisor: (sandboxBiz?.name || 'STUDIO X SRL').toUpperCase(), DireccionEmisor: 'Santo Domingo' },
            Totales: { MontoGravadoTotal: demoAmount, MontoGravadoI1: demoAmount, ITBIS1: demoItbis, TotalITBIS: demoItbis, TotalITBIS1: demoItbis, MontoTotal: demoTotal },
          },
          DetallesItems: { Item: [{ NumeroLinea: 1, IndicadorFacturacion: '1', NombreItem: 'Demo Terminal X', IndicadorBienoServicio: '2', CantidadItem: 1, UnidadMedida: '43', PrecioUnitarioItem: demoAmount, MontoItem: demoAmount }] },
        },
      }
      const xml = buildRFCEXml({
        emisor: payload.ECF.Encabezado.Emisor,
        totales: { montoGravadoTotal: demoAmount, montoGravadoI1: demoAmount, totalITBIS: demoItbis, totalITBIS1: demoItbis, montoTotal: demoTotal },
        eNCF: demoEncf, tipoIngresos: '01', tipoPago: '1', fechaEmision, securityCode,
      })
      const { signedXml } = signXML(xml, sandboxSettings.ecf_private_key_pem, sandboxSettings.ecf_certificate_pem)
      const dgiiToken = await authenticate(env, sandboxSettings.ecf_private_key_pem, sandboxSettings.ecf_certificate_pem)
      const result = await submitRFCE(signedXml, dgiiToken, env, { rncEmisor: sandboxBiz?.rnc, eNCF: demoEncf })
      return json(res, 200, {
        ok: true, _sandbox: true, _demo: false,
        data: {
          eNCF: demoEncf,
          trackId: result.trackId || fakeTrackId,
          dgiiCodigo: result.codigo === 0 ? 1 : result.codigo,
          status: result.estado || 'aceptado',
          mensajes: result.mensajes || ['Comprobante aceptado'],
          securityCode,
          signatureDate: new Date().toISOString(),
          totales: { subtotal: demoAmount, itbis: demoItbis, total: demoTotal },
          emisor: { rnc: sandboxBiz?.rnc, razon_social: sandboxBiz?.name },
          fechaEmision,
          qrLink: buildQRUrl({ env, rncEmisor: sandboxBiz?.rnc, rncComprador: '', eNCF: demoEncf, fechaEmision, montoTotal: String(demoTotal), fechaFirma: new Date().toISOString(), codigoSeguridad: securityCode, isRFCE: true }),
          _note: 'Respuesta real de DGII (entorno de pruebas certecf).',
        },
      })
    } catch (err) {
      clearTokenCache()
      return json(res, 200, { ok: false, _sandbox: true, error: err.message || 'Error en demo de DGII' })
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

  // Parent-acceptance gate for Notas de Crédito (E33/E34). Mirrors the
  // desktop checkParentAccepted() logic. Without this, a fast void on the
  // web POS can submit the NC before its parent factura's eNCF is
  // registered on DGII's side, the NC gets rejected with "comprobante no
  // encontrado", and the 607 mensual ends up out of sync with what DGII
  // actually has on file. We refuse to sign+submit until the parent
  // factura shows ecf_submissions.dgii_status IN (1, 4).
  {
    const tipo = String(body.tipoECF || body.payload?.ECF?.Encabezado?.IdDoc?.TipoECF || '')
    if (tipo === '33' || tipo === '34') {
      const parentEncf = body.payload?.ECF?.Encabezado?.InformacionReferencia?.NCFModificado
                       || body.referencia?.ncfModificado
                       || null
      if (!parentEncf) {
        return json(res, 200, { ok: false, code: 'parent_missing',
          error: 'Esta nota requiere referenciar la factura padre (NCFModificado).' })
      }
      const { data: parentRow } = await supabase
        .from('ecf_submissions')
        .select('dgii_status')
        .eq('business_id', bid)
        .eq('encf', String(parentEncf))
        .order('submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const ps = parentRow?.dgii_status
      if (ps !== 1 && ps !== 4) {
        const code = !parentRow ? 'parent_unknown'
                   : ps === 2   ? 'parent_rejected'
                                : 'parent_pending'
        const msg = code === 'parent_unknown'
          ? `Esperando que la factura ${parentEncf} sea registrada antes de enviar esta nota.`
          : code === 'parent_rejected'
          ? `La factura padre ${parentEncf} fue RECHAZADA por DGII. Resuelva esa factura antes de emitir nota de crédito sobre ella.`
          : `La factura padre ${parentEncf} sigue en proceso en DGII. Reintente en unos segundos.`
        return json(res, 200, { ok: false, code, parentEncf, error: msg })
      }
    }
  }

  // Cert presence check — runs AFTER the parent-acceptance gate so a
  // cashier emitting a too-early NC sees the gate message even on a
  // tenant whose cert isn't installed yet.
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
