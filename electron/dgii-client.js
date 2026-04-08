/**
 * dgii-client.js — Direct DGII API client for e-CF submission
 *
 * Handles:
 *   1. Authentication (seed dance: GET semilla → sign → POST validarsemilla → JWT)
 *   2. e-CF submission (POST facturaselectronicas → trackId)
 *   3. RFCE submission (POST recepcionfc for E32 < 250K)
 *   4. Status check (GET consultas/estado → accepted/rejected/processing)
 *   5. e-NCF status lookup by RNC + eNCF
 *
 * Environments:
 *   testecf  — pre-certification testing
 *   certecf  — certification process
 *   ecf      — production
 *
 * Ref: "Descripcion-tecnica-de-facturacion-electronica.pdf"
 */

const https = require('https')
const crypto = require('crypto')
const { signSeed } = require('./xml-signer')

// ── Environment URLs ──────────────────────────────────────────────────────────

const ENVIRONMENTS = {
  testecf: {
    ecf: 'ecf.dgii.gov.do',
    fc:  'fc.dgii.gov.do',
    prefix: '/testecf',
    qrPrefix: '/TesteCF',
  },
  certecf: {
    ecf: 'ecf.dgii.gov.do',
    fc:  'fc.dgii.gov.do',
    prefix: '/certecf',
    qrPrefix: '/CerteCF',
  },
  ecf: {
    ecf: 'ecf.dgii.gov.do',
    fc:  'fc.dgii.gov.do',
    prefix: '/ecf',
    qrPrefix: '/eCF',
  },
}

// ── Token cache ───────────────────────────────────────────────────────────────

let _tokenCache = { token: null, expiresAt: 0, env: null }

// ── HTTP helper ───────────────────────────────────────────────────────────────

function httpsRequest({ hostname, path, method = 'GET', headers = {}, body = null, timeout = 30000 }) {
  return new Promise((resolve, reject) => {
    const opts = { hostname, port: 443, path, method, headers, timeout }
    const req = https.request(opts, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body: data })
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('DGII request timeout')) })
    if (body) req.write(body)
    req.end()
  })
}

/**
 * wrapMultipart — wraps XML in multipart/form-data body for DGII endpoints.
 * Returns { body, contentType } ready for httpsRequest headers.
 */
function wrapMultipart(xmlString) {
  const boundary = '----DGIIBoundary' + crypto.randomBytes(8).toString('hex')
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="xml"; filename="signed.xml"\r\nContent-Type: application/xml\r\n\r\n${xmlString}\r\n--${boundary}--\r\n`
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}

// ── Authentication ────────────────────────────────────────────────────────────

/**
 * authenticate — performs the DGII seed dance to obtain a JWT token.
 *
 * 1. GET /autenticacion/api/autenticacion/semilla → XML seed
 * 2. Sign the seed XML with our certificate
 * 3. POST /autenticacion/api/autenticacion/validarsemilla → JWT token (1h)
 *
 * @param {string} env — "testecf" | "certecf" | "ecf"
 * @param {string} privateKeyPem
 * @param {string} certificatePem
 * @returns {string} JWT token
 */
async function authenticate(env, privateKeyPem, certificatePem) {
  // Return cached token if still valid (with 5 min buffer)
  if (_tokenCache.token && _tokenCache.env === env && Date.now() < _tokenCache.expiresAt - 300000) {
    return _tokenCache.token
  }

  const e = ENVIRONMENTS[env]
  if (!e) throw new Error(`Entorno DGII inválido: ${env}`)

  // Step 1: GET semilla
  const seedRes = await httpsRequest({
    hostname: e.ecf,
    path: `${e.prefix}/autenticacion/api/autenticacion/semilla`,
    method: 'GET',
    headers: { 'Accept': 'application/xml' },
  })

  if (seedRes.status !== 200) {
    throw new Error(`DGII semilla failed (${seedRes.status}): ${seedRes.body.substring(0, 200)}`)
  }

  const seedXml = seedRes.body

  // Step 2: Sign the seed
  const signedSeed = signSeed(seedXml, privateKeyPem, certificatePem)

  // Step 3: POST validarsemilla as multipart/form-data (DGII requires file upload format)
  const { body: multipartBody, contentType } = wrapMultipart(signedSeed)

  const validateRes = await httpsRequest({
    hostname: e.ecf,
    path: `${e.prefix}/autenticacion/api/autenticacion/validarsemilla`,
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(Buffer.byteLength(multipartBody, 'utf8')),
    },
    body: multipartBody,
  })

  if (validateRes.status !== 200) {
    throw new Error(`DGII validarsemilla failed (${validateRes.status}): ${validateRes.body.substring(0, 200)}`)
  }

  // Response body is the JWT token (plain text or JSON)
  let token = validateRes.body.trim()
  // Sometimes wrapped in quotes
  if (token.startsWith('"') && token.endsWith('"')) {
    token = token.slice(1, -1)
  }
  // Sometimes wrapped in JSON
  try {
    const parsed = JSON.parse(token)
    if (parsed.token) token = parsed.token
  } catch { /* not JSON — use as-is */ }

  // Cache for 1 hour
  _tokenCache = { token, expiresAt: Date.now() + 3600000, env }

  return token
}

/**
 * clearTokenCache — forces re-authentication on next call.
 */
function clearTokenCache() {
  _tokenCache = { token: null, expiresAt: 0, env: null }
}

// ── e-CF Submission ───────────────────────────────────────────────────────────

/**
 * submitECF — sends a signed e-CF XML to DGII.
 * Used for: E31, E33, E34, E41, E43, E44, E45, E46, E47, and E32 >= RD$250K.
 *
 * @param {string} signedXml — signed e-CF XML
 * @param {string} token — JWT from authenticate()
 * @param {string} env — "testecf" | "certecf" | "ecf"
 * @returns {{ trackId: string, mensaje?: string }}
 */
async function submitECF(signedXml, token, env) {
  const e = ENVIRONMENTS[env]

  const res = await httpsRequest({
    hostname: e.ecf,
    path: `${e.prefix}/recepcion/api/facturaselectronicas`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/xml',
      'Authorization': `Bearer ${token}`,
      'Content-Length': String(Buffer.byteLength(signedXml, 'utf8')),
    },
    body: signedXml,
  })

  if (res.status === 401) {
    clearTokenCache()
    throw new Error('DGII token expirado — reintentando autenticación')
  }

  let parsed
  try {
    parsed = JSON.parse(res.body)
  } catch {
    // Response might be XML
    const trackMatch = res.body.match(/<trackId>([^<]+)<\/trackId>/i)
    if (trackMatch) return { trackId: trackMatch[1] }
    throw new Error(`DGII respuesta inesperada (${res.status}): ${res.body.substring(0, 300)}`)
  }

  if (parsed.trackId) return parsed
  if (parsed.error || parsed.mensaje) {
    throw new Error(`DGII rechazó e-CF: ${parsed.mensaje || parsed.error}`)
  }

  return parsed
}

/**
 * submitRFCE — sends a signed RFCE summary to DGII for E32 < RD$250K.
 * Goes to fc.dgii.gov.do domain.
 *
 * @param {string} signedXml — signed RFCE XML
 * @param {string} token — JWT from authenticate()
 * @param {string} env
 * @returns {{ codigo, estado, mensajes?, encf, secuenciaUtilizada }}
 */
async function submitRFCE(signedXml, token, env) {
  const e = ENVIRONMENTS[env]

  const res = await httpsRequest({
    hostname: e.fc,
    path: `${e.prefix}/recepcionfc/api/recepcion/ecf`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/xml',
      'Authorization': `Bearer ${token}`,
      'Content-Length': String(Buffer.byteLength(signedXml, 'utf8')),
    },
    body: signedXml,
  })

  if (res.status === 401) {
    clearTokenCache()
    throw new Error('DGII token expirado — reintentando autenticación')
  }

  let parsed
  try { parsed = JSON.parse(res.body) } catch {
    throw new Error(`DGII RFCE respuesta inesperada (${res.status}): ${res.body.substring(0, 300)}`)
  }

  return parsed
}

// ── Status Check ──────────────────────────────────────────────────────────────

/**
 * DGII status codes:
 *   0 = No encontrado
 *   1 = Aceptado
 *   2 = Rechazado
 *   3 = En Proceso
 *   4 = Aceptado Condicional
 */
const DGII_STATUS = {
  0: 'NO_ENCONTRADO',
  1: 'ACEPTADO',
  2: 'RECHAZADO',
  3: 'EN_PROCESO',
  4: 'ACEPTADO_CONDICIONAL',
}

/**
 * checkStatus — checks the status of a submitted e-CF by trackId.
 *
 * @param {string} trackId
 * @param {string} token — JWT
 * @param {string} env
 * @returns {{ codigo: number, estado: string, mensajes?: string[] }}
 */
async function checkStatus(trackId, token, env) {
  const e = ENVIRONMENTS[env]

  const res = await httpsRequest({
    hostname: e.ecf,
    path: `${e.prefix}/consultaresultado/api/consultas/estado?trackid=${encodeURIComponent(trackId)}`,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
  })

  let parsed
  try { parsed = JSON.parse(res.body) } catch {
    throw new Error(`DGII status check failed (${res.status}): ${res.body.substring(0, 200)}`)
  }

  return {
    ...parsed,
    estado: DGII_STATUS[parsed.codigo] || DGII_STATUS[parsed.estado] || 'DESCONOCIDO',
  }
}

/**
 * checkStatusByNCF — checks e-CF status by RNC + eNCF + security code.
 *
 * @param {{ rncEmisor, eNCF, rncComprador?, codigoSeguridad? }} params
 * @param {string} token — JWT
 * @param {string} env
 */
async function checkStatusByNCF(params, token, env) {
  const e = ENVIRONMENTS[env]
  const qs = new URLSearchParams({
    rncemisor: params.rncEmisor,
    ncfelectronico: params.eNCF,
    ...(params.rncComprador ? { rnccomprador: params.rncComprador } : {}),
    ...(params.codigoSeguridad ? { codigoseguridad: params.codigoSeguridad } : {}),
  }).toString()

  const res = await httpsRequest({
    hostname: e.ecf,
    path: `${e.prefix}/consultaestado/api/consultas/estado?${qs}`,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
  })

  let parsed
  try { parsed = JSON.parse(res.body) } catch {
    throw new Error(`DGII NCF status check failed: ${res.body.substring(0, 200)}`)
  }

  return {
    ...parsed,
    estado: DGII_STATUS[parsed.codigo] || DGII_STATUS[parsed.estado] || 'DESCONOCIDO',
  }
}

/**
 * pollStatus — polls checkStatus until accepted/rejected (max retries).
 * Average DGII validation: 200ms, but we poll with delay for safety.
 *
 * @param {string} trackId
 * @param {string} token
 * @param {string} env
 * @param {{ maxRetries?: number, delayMs?: number }} opts
 * @returns {{ codigo: number, estado: string }}
 */
async function pollStatus(trackId, token, env, { maxRetries = 10, delayMs = 2000 } = {}) {
  for (let i = 0; i < maxRetries; i++) {
    const result = await checkStatus(trackId, token, env)
    // 1=accepted, 2=rejected, 4=conditional — all are final states
    if (result.codigo === 1 || result.codigo === 2 || result.codigo === 4) {
      return result
    }
    // 3=processing — wait and retry
    if (i < maxRetries - 1) {
      await new Promise(r => setTimeout(r, delayMs))
    }
  }
  return { codigo: 3, estado: 'EN_PROCESO', mensajes: ['Timeout — DGII aún procesando'] }
}

// ── QR URL builder ────────────────────────────────────────────────────────────

/**
 * buildQRUrl — constructs the DGII QR verification URL.
 *
 * @param {object} params — { env, rncEmisor, rncComprador, eNCF, fechaEmision, montoTotal, fechaFirma, codigoSeguridad, isRFCE }
 * @returns {string} full URL for QR code
 */
function fmtFirmaDate(isoStr) {
  const d = new Date(isoStr)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${dd}-${mm}-${yyyy} ${hh}:${mi}:${ss}`
}

function buildQRUrl(params) {
  const e = ENVIRONMENTS[params.env || 'ecf']
  const encode = encodeURIComponent
  const monto = Number(params.montoTotal || 0).toFixed(2)

  // Use lowercase env prefix and paths per dgii-ecf reference implementation
  const envPath = (params.env || 'ecf').toLowerCase()
  if (params.isRFCE) {
    // Consumer invoice < 250K — fc.dgii.gov.do
    return `https://${e.fc}/${envPath}/consultatimbrefc?rncemisor=${encode(params.rncEmisor)}&encf=${encode(params.eNCF)}&montototal=${encode(monto)}&codigoseguridad=${encode(params.codigoSeguridad)}`
  }

  const fechaFirma = params.fechaFirma ? fmtFirmaDate(params.fechaFirma) : ''
  // E43 (gastos menores) and E47 (pagos al exterior) — omit RncComprador
  const encf = params.eNCF || ''
  const omitComprador = /E4[37]/i.test(encf)
  const compradorParam = omitComprador ? '' : `RncComprador=${encode(params.rncComprador || '')}&`
  // Standard e-CF >= 250K or non-E32 types
  return `https://${e.ecf}/${envPath}/consultatimbre?rncemisor=${encode(params.rncEmisor)}&${compradorParam}encf=${encode(encf)}&fechaemision=${encode(params.fechaEmision)}&montototal=${encode(monto)}&fechafirma=${encode(fechaFirma)}&codigoseguridad=${encode(params.codigoSeguridad)}`
}

module.exports = {
  ENVIRONMENTS,
  DGII_STATUS,
  authenticate,
  clearTokenCache,
  submitECF,
  submitRFCE,
  checkStatus,
  checkStatusByNCF,
  pollStatus,
  buildQRUrl,
}
