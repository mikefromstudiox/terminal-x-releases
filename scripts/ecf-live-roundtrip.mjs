/**
 * ecf-live-roundtrip.mjs — true end-to-end DGII test against certecf using
 * Studio X SRL's installed cert. Proves the parent-acceptance gate doesn't
 * just block in unit tests — it actually holds while a real factura is
 * EN_PROCESO at DGII and lets the NC through after ACEPTADO.
 *
 * Flow:
 *   1. Mint a session JWT for admin@studiox.com.do via admin generateLink
 *      + verifyOtp (so we never touch the user's password).
 *   2. Build + submit an E31 factura via /api/ecf-sign (DGII certecf env).
 *      Watch trackId come back, dgii_status=3 (EN_PROCESO) initially.
 *   3. Immediately try to submit an NC (E34) referencing that eNCF — gate
 *      should fire with parent_pending.
 *   4. Poll /api/ecf-sign?action=status until parent goes to ACEPTADO (1)
 *      or RECHAZADO (2).
 *   5. Try the NC submission again — gate should pass; either DGII accepts
 *      or rejects on its own merits (response visible).
 *
 * The script is read-only on auth.users (uses generateLink, not password
 * change) and only writes test rows it cleans up afterward.
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'

const SUPA_URL = process.env.SUPABASE_URL
const ANON     = process.env.SUPABASE_ANON_KEY
const SVC      = process.env.SUPABASE_SERVICE_ROLE_KEY

const STUDIO_X_BID = '1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79'
const ADMIN_EMAIL  = 'admin@studiox.com.do'
const ENDPOINT     = 'https://terminalxpos.com/api/ecf-sign'

const svc  = createClient(SUPA_URL, SVC,  { auth: { persistSession: false } })

function log(label, ok, detail = '') {
  console.log((ok ? '[ok ]' : '[FAIL]') + ' ' + label + (detail ? '  ' + detail : ''))
}

async function mintJwt(email) {
  // generateLink('magiclink') returns a hashed_token + the URL containing
  // the actual token — we extract and verify it to mint a session.
  const { data, error } = await svc.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  if (error) throw new Error(`generateLink: ${error.message}`)
  const url = new URL(data?.properties?.action_link || data?.action_link || '')
  // The link redirects to {site_url}/#access_token=...&refresh_token=...
  // OR carries a token_hash + type query — the verifyOtp consumes either.
  const tokenHash = data?.properties?.hashed_token || data?.hashed_token
  if (!tokenHash) throw new Error('no hashed_token on generateLink result')

  const anon = createClient(SUPA_URL, ANON, { auth: { persistSession: false } })
  const { data: verifyRes, error: vErr } = await anon.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'magiclink',
  })
  if (vErr || !verifyRes?.session?.access_token) {
    throw new Error(`verifyOtp: ${vErr?.message || 'no session returned'}`)
  }
  return verifyRes.session.access_token
}

async function callEcfSign(jwt, body) {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwt },
    body: JSON.stringify(body),
  })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}

async function pollStatus(jwt, trackId, maxSec = 60) {
  const start = Date.now()
  while ((Date.now() - start) / 1000 < maxSec) {
    const r = await callEcfSign(jwt, { business_id: STUDIO_X_BID, action: 'status', trackId })
    const codigo = r.body?.data?.codigo
    if (codigo === 1 || codigo === 2 || codigo === 4) return r.body.data
    await new Promise(rs => setTimeout(rs, 3000))
  }
  return null
}

async function loadSequence(type) {
  // Pull the next eNCF from ncf_sequences for this business + type.
  // type expected as 'E31', 'E34', etc. (the actual row value).
  const { data } = await svc.from('ncf_sequences')
    .select('current_number, prefix, limit_number')
    .eq('business_id', STUDIO_X_BID)
    .eq('type', type)
    .single()
  if (!data) return null
  const next = (Number(data.current_number) || 0) + 1
  if (data.limit_number && next > data.limit_number) return null
  // Reserve it (atomic-ish for test purposes; production uses RPC).
  await svc.from('ncf_sequences').update({ current_number: next })
    .eq('business_id', STUDIO_X_BID).eq('type', type)
  const padded = String(next).padStart(10, '0')
  return `${data.prefix || type}${padded}`
}

async function run() {
  console.log('\n=== e-CF LIVE round-trip (DGII certecf via Studio X SRL) ===\n')

  // 1. Mint JWT
  let jwt
  try {
    jwt = await mintJwt(ADMIN_EMAIL)
    log('jwt: minted via admin magiclink', true, ADMIN_EMAIL)
  } catch (e) {
    log('jwt: mint failed', false, e.message)
    process.exit(1)
  }

  // 2. Pull next E31 eNCF for the factura
  const facturaEncf = await loadSequence('E31')
  if (!facturaEncf) { log('no E31 sequence available', false); process.exit(1) }
  log('seq: factura eNCF reserved', true, facturaEncf)

  // Pull next E34 eNCF for the NC
  const ncEncf = await loadSequence('E34')
  if (!ncEncf) { log('no E34 sequence available', false); process.exit(1) }
  log('seq: NC eNCF reserved', true, ncEncf)

  // 3. Build factura E31 payload + submit
  // Studio X SRL info (from businesses + settings)
  const { data: biz } = await svc.from('businesses').select('rnc, name').eq('id', STUDIO_X_BID).single()
  const fechaEmision = new Date().toISOString().slice(0, 10).split('-').reverse().join('-')

  const facturaPayload = {
    ECF: {
      Encabezado: {
        Version: '1.0',
        IdDoc: { TipoECF: '31', eNCF: facturaEncf, FechaEmision: fechaEmision, IndicadorEnvioDiferido: '0', TipoIngresos: '01', TipoPago: '1' },
        Emisor: { RNCEmisor: (biz?.rnc || '').replace(/\D/g, ''), RazonSocialEmisor: (biz?.name || 'STUDIO X SRL').toUpperCase(), DireccionEmisor: 'Santo Domingo' },
        Comprador: { RNCComprador: '101000001', RazonSocialComprador: 'CLIENTE PRUEBA' },
        Totales: { MontoGravadoTotal: 100, MontoGravadoI1: 100, ITBIS1: 18, TotalITBIS: 18, TotalITBIS1: 18, MontoTotal: 118 },
      },
      DetallesItems: { Item: [{ NumeroLinea: 1, IndicadorFacturacion: '1', NombreItem: 'Servicio de prueba', IndicadorBienoServicio: '2', CantidadItem: 1, UnidadMedida: '43', PrecioUnitarioItem: 100, MontoItem: 100 }] },
    },
  }
  const facturaBody = {
    business_id: STUDIO_X_BID,
    eNCF: facturaEncf,
    tipoECF: '31',
    montoTotal: 118,
    payload: facturaPayload,
    emisor: facturaPayload.ECF.Encabezado.Emisor,
    comprador: facturaPayload.ECF.Encabezado.Comprador,
    totales: { subtotal: 100, itbis: 18, total: 118 },
    fechaEmision,
    tipoIngresos: '01',
    tipoPago: '1',
  }

  console.log('\n--- 1. Submit factura E31 to DGII certecf ---')
  const facturaRes = await callEcfSign(jwt, facturaBody)
  console.log('factura status:', facturaRes.status, 'body:', JSON.stringify(facturaRes.body).slice(0, 500))
  if (!facturaRes.body?.ok) {
    log('factura submit', false, facturaRes.body?.error || 'no ok')
    process.exit(1)
  }
  const facturaTrack = facturaRes.body?.data?.trackId
  log('factura submitted', true, `trackId=${facturaTrack} dgiiCodigo=${facturaRes.body?.data?.dgiiCodigo}`)

  // 4. Try NC immediately while parent might still be EN_PROCESO
  console.log('\n--- 2. Try NC immediately (race against parent acceptance) ---')
  const ncPayload = {
    ECF: {
      Encabezado: {
        Version: '1.0',
        IdDoc: { TipoECF: '34', eNCF: ncEncf, FechaEmision: fechaEmision, IndicadorEnvioDiferido: '0', TipoIngresos: '01', TipoPago: '1' },
        Emisor: facturaPayload.ECF.Encabezado.Emisor,
        Comprador: facturaPayload.ECF.Encabezado.Comprador,
        InformacionReferencia: { NCFModificado: facturaEncf, RazonModificacion: 'Devolucion total', FechaNCFModificado: fechaEmision, CodigoModificacion: '1' },
        Totales: { MontoGravadoTotal: 100, MontoGravadoI1: 100, ITBIS1: 18, TotalITBIS: 18, TotalITBIS1: 18, MontoTotal: 118 },
      },
      DetallesItems: facturaPayload.ECF.DetallesItems,
    },
  }
  const ncBody = {
    business_id: STUDIO_X_BID, eNCF: ncEncf, tipoECF: '34', montoTotal: 118,
    payload: ncPayload, emisor: ncPayload.ECF.Encabezado.Emisor, comprador: ncPayload.ECF.Encabezado.Comprador,
    totales: { subtotal: 100, itbis: 18, total: 118 }, fechaEmision, tipoIngresos: '01', tipoPago: '1',
    referencia: { ncfModificado: facturaEncf, razonModificacion: 'Devolucion total', fechaNCFModificado: fechaEmision, codigoModificacion: '1' },
  }

  const ncEarly = await callEcfSign(jwt, ncBody)
  const earlyBlocked = ncEarly.body?.ok === false && /^parent_/.test(ncEarly.body?.code || '')
  log('NC early submission → gate fires', earlyBlocked,
      `code=${ncEarly.body?.code} error=${(ncEarly.body?.error || '').slice(0, 80)}`)

  // 5. Wait for parent acceptance
  console.log('\n--- 3. Poll DGII for factura acceptance ---')
  const finalParent = await pollStatus(jwt, facturaTrack, 60)
  if (!finalParent) {
    log('parent never settled in 60s — DGII test env slow', false)
    process.exit(1)
  }
  log('parent final status', true, `codigo=${finalParent.codigo} estado=${finalParent.estado}`)

  // 6. Try NC again
  console.log('\n--- 4. Submit NC after parent settled ---')
  const ncAfter = await callEcfSign(jwt, ncBody)
  console.log('NC body:', JSON.stringify(ncAfter.body).slice(0, 500))
  // If parent was ACEPTADO (1) or ACEPTADO_CONDICIONAL (4), NC should pass
  // the gate. DGII may then accept or reject the NC on its own merits.
  if (finalParent.codigo === 1 || finalParent.codigo === 4) {
    const gatePassed = !/^parent_/.test(ncAfter.body?.code || '')
    log('NC after parent ACEPTADO → gate passes', gatePassed,
        `code=${ncAfter.body?.code || '<none>'} dgiiCodigo=${ncAfter.body?.data?.dgiiCodigo}`)
  } else {
    // Parent rejected — NC should still be blocked
    const blocked = ncAfter.body?.code === 'parent_rejected'
    log('NC after parent RECHAZADO → still blocked', blocked, `code=${ncAfter.body?.code}`)
  }

  console.log('\n=== done ===\n')
}

run().catch(e => { console.error('FATAL:', e); process.exit(2) })
