// Shared PII scrubber for Sentry beforeSend hook.
// CommonJS module (works in Electron main + CJS require). ESM callers use
// default-interop (`import scrub from '.../sentry-scrub.js'`) which resolves
// to the same object via Vite's CJS compat.

const SECRET_KEYS = [
  'pin', 'password', 'passwd', 'pwd',
  'access_token', 'refresh_token', 'id_token', 'auth_token', 'bearer',
  'authorization', 'api_key', 'apikey', 'secret', 'client_secret',
  'passphrase', 'cert_passphrase', 'p12_passphrase',
  'p12', 'pkcs12', 'privatekey', 'private_key', 'cert_pem', 'cert_key',
  'cedula', 'rnc', 'license_key', 'hwid',
]

const SECRET_RX     = new RegExp('\\b(' + SECRET_KEYS.join('|') + ')\\b', 'i')
const P12_RX        = /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g
const JWT_RX        = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g
const BASE64_P12_RX = /[A-Za-z0-9+/]{200,}={0,2}/g
const REDACTED      = '[REDACTED]'

function scrubString(s) {
  if (typeof s !== 'string' || !s) return s
  return s.replace(P12_RX, REDACTED).replace(JWT_RX, REDACTED).replace(BASE64_P12_RX, REDACTED)
}

function scrubValue(v, depth) {
  depth = depth || 0
  if (v == null || depth > 6) return v
  if (typeof v === 'string') return scrubString(v)
  if (Array.isArray(v)) return v.map(function (x) { return scrubValue(x, depth + 1) })
  if (typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v)) {
      if (SECRET_RX.test(k)) { out[k] = REDACTED; continue }
      try { out[k] = scrubValue(v[k], depth + 1) }
      catch { out[k] = '[Unserializable]' }
    }
    return out
  }
  return v
}

function scrubEvent(event) {
  if (!event) return event
  try {
    if (event.request) {
      if (event.request.data)    event.request.data    = scrubValue(event.request.data)
      if (event.request.headers) event.request.headers = scrubValue(event.request.headers)
      if (event.request.cookies) event.request.cookies = REDACTED
      if (event.request.query_string && SECRET_RX.test(event.request.query_string)) {
        event.request.query_string = REDACTED
      }
    }
    if (event.extra) event.extra = scrubValue(event.extra)
    if (event.contexts) {
      for (const k of Object.keys(event.contexts)) {
        if (k === 'trace') continue
        event.contexts[k] = scrubValue(event.contexts[k])
      }
    }
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.map(function (b) {
        if (!b) return b
        if (b.data)    b.data    = scrubValue(b.data)
        if (b.message) b.message = scrubString(b.message)
        return b
      })
    }
    if (event.exception && event.exception.values) {
      for (const ex of event.exception.values) {
        if (ex.value) ex.value = scrubString(ex.value)
      }
    }
    if (event.message) event.message = scrubString(event.message)
  } catch { /* never throw from beforeSend */ }
  return event
}

module.exports = { scrubEvent, scrubValue, scrubString, SECRET_KEYS }
