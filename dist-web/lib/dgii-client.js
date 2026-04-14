/**
 * dgii-client.mjs — ESM port of electron/dgii-client.js
 * Direct DGII API client for e-CF submission (server-side only).
 */

import https from 'https'
import crypto from 'crypto'
import { signSeed } from './xml-signer.js'

export const ENVIRONMENTS = {
  testecf: { ecf: 'ecf.dgii.gov.do', fc: 'fc.dgii.gov.do', prefix: '/testecf', qrPrefix: '/TesteCF' },
  certecf: { ecf: 'ecf.dgii.gov.do', fc: 'fc.dgii.gov.do', prefix: '/certecf', qrPrefix: '/CerteCF' },
  ecf:     { ecf: 'ecf.dgii.gov.do', fc: 'fc.dgii.gov.do', prefix: '/ecf',     qrPrefix: '/eCF' },
}

export const DGII_STATUS = { 0: 'NO_ENCONTRADO', 1: 'ACEPTADO', 2: 'RECHAZADO', 3: 'EN_PROCESO', 4: 'ACEPTADO_CONDICIONAL' }

let _tokenCache = { token: null, expiresAt: 0, env: null }

function httpsRequest({ hostname, path, method = 'GET', headers = {}, body = null, timeout = 30000 }) {
  return new Promise((resolve, reject) => {
    const opts = { hostname, port: 443, path, method, headers, timeout }
    const req = https.request(opts, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('DGII request timeout')) })
    if (body) req.write(body)
    req.end()
  })
}

function wrapMultipart(xmlString) {
  const boundary = '----DGIIBoundary' + crypto.randomBytes(8).toString('hex')
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="xml"; filename="signed.xml"\r\nContent-Type: application/xml\r\n\r\n${xmlString}\r\n--${boundary}--\r\n`
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}

export async function authenticate(env, privateKeyPem, certificatePem) {
  if (_tokenCache.token && _tokenCache.env === env && Date.now() < _tokenCache.expiresAt - 300000) {
    return _tokenCache.token
  }
  const e = ENVIRONMENTS[env]
  if (!e) throw new Error(`Entorno DGII inválido: ${env}`)

  const seedRes = await httpsRequest({
    hostname: e.ecf,
    path: `${e.prefix}/autenticacion/api/autenticacion/semilla`,
    headers: { 'Accept': 'application/xml' },
  })
  if (seedRes.status !== 200) throw new Error(`DGII semilla failed (${seedRes.status}): ${seedRes.body.substring(0, 200)}`)

  const signedSeed = signSeed(seedRes.body, privateKeyPem, certificatePem)
  const { body: multipartBody, contentType } = wrapMultipart(signedSeed)

  const validateRes = await httpsRequest({
    hostname: e.ecf,
    path: `${e.prefix}/autenticacion/api/autenticacion/validarsemilla`,
    method: 'POST',
    headers: { 'Content-Type': contentType, 'Content-Length': String(Buffer.byteLength(multipartBody, 'utf8')) },
    body: multipartBody,
  })
  if (validateRes.status !== 200) throw new Error(`DGII validarsemilla failed (${validateRes.status}): ${validateRes.body.substring(0, 200)}`)

  let token = validateRes.body.trim()
  if (token.startsWith('"') && token.endsWith('"')) token = token.slice(1, -1)
  try { const p = JSON.parse(token); if (p.token) token = p.token } catch {}

  _tokenCache = { token, expiresAt: Date.now() + 3600000, env }
  return token
}

export function clearTokenCache() { _tokenCache = { token: null, expiresAt: 0, env: null } }

export async function submitECF(signedXml, token, env) {
  const e = ENVIRONMENTS[env]
  const res = await httpsRequest({
    hostname: e.ecf,
    path: `${e.prefix}/recepcion/api/facturaselectronicas`,
    method: 'POST',
    headers: { 'Content-Type': 'application/xml', 'Authorization': `Bearer ${token}`, 'Content-Length': String(Buffer.byteLength(signedXml, 'utf8')) },
    body: signedXml,
  })
  if (res.status === 401) { clearTokenCache(); throw new Error('DGII token expirado') }

  let parsed
  try { parsed = JSON.parse(res.body) } catch {
    const m = res.body.match(/<trackId>([^<]+)<\/trackId>/i)
    if (m) return { trackId: m[1] }
    throw new Error(`DGII respuesta inesperada (${res.status}): ${res.body.substring(0, 300)}`)
  }
  if (parsed.trackId) return parsed
  if (parsed.error || parsed.mensaje) throw new Error(`DGII rechazó e-CF: ${parsed.mensaje || parsed.error}`)
  return parsed
}

export async function submitRFCE(signedXml, token, env) {
  const e = ENVIRONMENTS[env]
  const res = await httpsRequest({
    hostname: e.fc,
    path: `${e.prefix}/recepcionfc/api/recepcion/ecf`,
    method: 'POST',
    headers: { 'Content-Type': 'application/xml', 'Authorization': `Bearer ${token}`, 'Content-Length': String(Buffer.byteLength(signedXml, 'utf8')) },
    body: signedXml,
  })
  if (res.status === 401) { clearTokenCache(); throw new Error('DGII token expirado') }
  let parsed
  try { parsed = JSON.parse(res.body) } catch { throw new Error(`DGII RFCE inesperada (${res.status}): ${res.body.substring(0, 300)}`) }
  return parsed
}

export async function checkStatus(trackId, token, env) {
  const e = ENVIRONMENTS[env]
  const res = await httpsRequest({
    hostname: e.ecf,
    path: `${e.prefix}/consultaresultado/api/consultas/estado?trackid=${encodeURIComponent(trackId)}`,
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
  })
  let parsed
  try { parsed = JSON.parse(res.body) } catch { throw new Error(`DGII status check failed (${res.status})`) }
  return { ...parsed, estado: DGII_STATUS[parsed.codigo] || 'DESCONOCIDO' }
}

export async function pollStatus(trackId, token, env, { maxRetries = 10, delayMs = 2000 } = {}) {
  for (let i = 0; i < maxRetries; i++) {
    const result = await checkStatus(trackId, token, env)
    if (result.codigo === 1 || result.codigo === 2 || result.codigo === 4) return result
    if (i < maxRetries - 1) await new Promise(r => setTimeout(r, delayMs))
  }
  return { codigo: 3, estado: 'EN_PROCESO', mensajes: ['Timeout — DGII aún procesando'] }
}

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

export function buildQRUrl(params) {
  const e = ENVIRONMENTS[params.env || 'ecf']
  const encode = encodeURIComponent
  const monto = Number(params.montoTotal || 0).toFixed(2)
  const envPath = (params.env || 'ecf').toLowerCase()

  if (params.isRFCE) {
    return `https://${e.fc}/${envPath}/consultatimbrefc?rncemisor=${encode(params.rncEmisor)}&encf=${encode(params.eNCF)}&montototal=${encode(monto)}&codigoseguridad=${encode(params.codigoSeguridad)}`
  }
  const fechaFirma = params.fechaFirma ? fmtFirmaDate(params.fechaFirma) : ''
  const encf = params.eNCF || ''
  const omitComprador = /E4[37]/i.test(encf)
  const compradorParam = omitComprador ? '' : `RncComprador=${encode(params.rncComprador || '')}&`
  return `https://${e.ecf}/${envPath}/consultatimbre?rncemisor=${encode(params.rncEmisor)}&${compradorParam}encf=${encode(encf)}&fechaemision=${encode(params.fechaEmision)}&montototal=${encode(monto)}&fechafirma=${encode(fechaFirma)}&codigoseguridad=${encode(params.codigoSeguridad)}`
}
