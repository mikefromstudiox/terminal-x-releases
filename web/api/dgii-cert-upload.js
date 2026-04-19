/**
 * dgii-cert-upload.js — Web-only Viafirma .p12 installer.
 *
 * Lets a 100% web customer upload their DGII certificate, parse it server-side,
 * and stash the PEMs in `businesses.settings` so e-CF signing immediately works
 * without ever touching the desktop app.
 *
 * Endpoint:  POST /api/dgii-cert-upload
 * Auth:      Supabase JWT (Bearer)
 * Body:      multipart/form-data { cert: File, passphrase: string, business_id: uuid }
 * Response:  { ok: true, subject, expiry, expired }
 *
 * Security:
 *   - JWT validated via Supabase auth.getUser
 *   - Caller MUST be staff(role='owner') of the target business — checked against the
 *     staff table, not JWT claims (per project policy)
 *   - .p12 is parsed in memory only; nothing written to disk
 *   - Passphrase / .p12 bytes are discarded after PEM extraction
 *
 * Storage shape (businesses.settings JSONB):
 *   ecf_private_key_pem, ecf_certificate_pem, ecf_cert_subject,
 *   ecf_cert_expiry, ecf_cert_expired, dgii_environment (defaulted to 'certecf')
 */

import { createClient } from '@supabase/supabase-js'
import forge from 'node-forge'
import Busboy from 'busboy'

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xbmhtrdhbnkgdliuxcha.supabase.co'
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// Hard cap: a real Viafirma .p12 is ~5-15 KB; reject anything > 1 MB outright.
const MAX_BYTES = 1 * 1024 * 1024

export const config = {
  api: {
    bodyParser: false, // we parse multipart ourselves with busboy
  },
}

function json(res, status, data) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  return res.status(status).json(data)
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const headers = req.headers
    if (!headers['content-type']?.includes('multipart/form-data')) {
      return reject(new Error('Content-Type must be multipart/form-data'))
    }
    const bb = Busboy({ headers, limits: { fileSize: MAX_BYTES, files: 1, fields: 10 } })
    const fields = {}
    let fileBuf = null
    let fileTooBig = false

    bb.on('field', (name, value) => { fields[name] = value })
    bb.on('file', (name, stream, info) => {
      if (name !== 'cert') { stream.resume(); return }
      const chunks = []
      stream.on('data', c => chunks.push(c))
      stream.on('limit', () => { fileTooBig = true })
      stream.on('end', () => { fileBuf = Buffer.concat(chunks); fields.__filename = info?.filename || 'cert.p12' })
    })
    bb.on('error', reject)
    bb.on('finish', () => {
      if (fileTooBig) return reject(new Error('Archivo demasiado grande (máx 1MB)'))
      resolve({ fields, fileBuf })
    })
    req.pipe(bb)
  })
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true })
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'POST only' })

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return json(res, 401, { ok: false, error: 'Missing auth token' })
  const token = authHeader.slice(7)

  if (!SUPABASE_SERVICE_KEY) return json(res, 500, { ok: false, error: 'Server config error' })

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // 1. Validate JWT
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return json(res, 401, { ok: false, error: 'Invalid token' })

  // 2. Parse multipart payload
  let fields, fileBuf
  try {
    ({ fields, fileBuf } = await parseMultipart(req))
  } catch (err) {
    return json(res, 400, { ok: false, error: err.message || 'Invalid form data' })
  }

  const businessId = fields.business_id
  const passphrase = fields.passphrase ?? ''
  if (!businessId) return json(res, 400, { ok: false, error: 'Missing business_id' })
  if (!fileBuf || fileBuf.length === 0) return json(res, 400, { ok: false, error: 'Falta el archivo .p12' })

  // 3. Verify caller is owner of this business (staff table is canonical)
  const { data: staffRow, error: staffErr } = await supabase
    .from('staff')
    .select('id,role')
    .eq('business_id', businessId)
    .eq('auth_id', user.id)
    .maybeSingle()
  if (staffErr) return json(res, 500, { ok: false, error: 'Auth lookup failed' })
  if (!staffRow) return json(res, 403, { ok: false, error: 'No access to this business' })
  if (String(staffRow.role || '').toLowerCase() !== 'owner') {
    return json(res, 403, { ok: false, error: 'Solo el propietario puede instalar el certificado' })
  }

  // 4. Parse .p12 in memory
  let privateKeyPem, certificatePem, subject, expiryISO, expired
  try {
    const p12Der = forge.util.createBuffer(fileBuf.toString('binary'))
    const p12Asn1 = forge.asn1.fromDer(p12Der)
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, passphrase)

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]
    if (!certBags || !certBags.length) throw new Error('No se encontró certificado en el archivo .p12')
    const cert = certBags[0].cert

    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]
    if (!keyBags || !keyBags.length) throw new Error('No se encontró llave privada en el archivo .p12')
    const privateKey = keyBags[0].key

    certificatePem = forge.pki.certificateToPem(cert)
    privateKeyPem = forge.pki.privateKeyToPem(privateKey)
    subject = cert.subject.getField('CN')?.value || ''
    const validTo = cert.validity.notAfter
    expiryISO = validTo.toISOString()
    expired = validTo.getTime() < Date.now()
  } catch (err) {
    // node-forge throws a generic error for both wrong passphrase and corrupt files
    return json(res, 400, { ok: false, error: 'Contraseña incorrecta o archivo .p12 inválido' })
  } finally {
    // Best-effort scrub of sensitive bytes from memory
    if (fileBuf) fileBuf.fill(0)
  }

  // 5. Merge into businesses.settings without clobbering existing keys
  const { data: bizRow, error: bizErr } = await supabase
    .from('businesses')
    .select('settings')
    .eq('id', businessId)
    .single()
  if (bizErr) return json(res, 500, { ok: false, error: 'Business lookup failed: ' + bizErr.message })

  // settings can historically be a JSON-encoded string — normalise
  let currentSettings = bizRow?.settings
  for (let i = 0; i < 3 && typeof currentSettings === 'string'; i++) {
    try { currentSettings = JSON.parse(currentSettings) } catch { currentSettings = {}; break }
  }
  if (!currentSettings || typeof currentSettings !== 'object' || Array.isArray(currentSettings)) {
    currentSettings = {}
  }

  const merged = {
    ...currentSettings,
    ecf_private_key_pem: privateKeyPem,
    ecf_certificate_pem: certificatePem,
    ecf_cert_subject: subject,
    ecf_cert_expiry: expiryISO,
    ecf_cert_expired: expired,
    ecf_cert_installed_at: new Date().toISOString(),
    // Default env to test (certecf) ONLY on first install — preserve any existing prod choice
    dgii_environment: currentSettings.dgii_environment || 'certecf',
  }

  const { error: updErr } = await supabase
    .from('businesses')
    .update({ settings: merged })
    .eq('id', businessId)
  if (updErr) return json(res, 500, { ok: false, error: 'No se pudo guardar el certificado: ' + updErr.message })

  return json(res, 200, { ok: true, subject, expiry: expiryISO, expired })
}
