/**
 * electron/licenseJwt.js — Per-license JWT helper (Electron main process).
 *
 * Mirrors the API of packages/services/perLicenseJwt.js but persists the
 * encrypted bundle through Electron's safeStorage (DPAPI on Windows,
 * Keychain on macOS, libsecret on Linux). All disk I/O is best-effort —
 * a missing/corrupt cache or unavailable keychain simply forces a re-mint
 * rather than throwing into the boot path.
 *
 * Bundle shape (returned by Edge Function `mint-license-jwt`):
 *   { access_token, expires_at, business_id, license_id, ... }
 * `expires_at` is epoch-millis. We treat anything within 5 min of expiry
 * as already expired so callers always get a comfortable refresh window.
 */

const { safeStorage, app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const REFRESH_SKEW_MS = 5 * 60_000

const CACHE_FILE = () => path.join(app.getPath('userData'), 'license_jwt.enc')

function loadCachedJwt() {
  try {
    const file = CACHE_FILE()
    if (!fs.existsSync(file)) return null
    if (!safeStorage.isEncryptionAvailable()) return null
    const buf = fs.readFileSync(file)
    const json = safeStorage.decryptString(buf)
    const bundle = JSON.parse(json)
    if (!bundle || !bundle.access_token || !bundle.expires_at) return null
    if (bundle.expires_at < Date.now() + REFRESH_SKEW_MS) return null
    return bundle
  } catch {
    return null
  }
}

function saveCachedJwt(bundle) {
  try {
    if (!safeStorage.isEncryptionAvailable()) return
    const buf = safeStorage.encryptString(JSON.stringify(bundle))
    fs.writeFileSync(CACHE_FILE(), buf)
  } catch { /* best-effort */ }
}

async function mintJwt({ licenseKey, machineId, supabaseUrl }) {
  if (!licenseKey || !machineId || !supabaseUrl) {
    throw new Error('mintJwt: missing licenseKey/machineId/supabaseUrl')
  }
  const url = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/mint-license-jwt`
  // Electron 41 exposes global fetch in main process.
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ license_key: licenseKey, machine_id: machineId }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`mint failed ${res.status}: ${body.slice(0, 200)}`)
  }
  const bundle = await res.json()
  if (!bundle || !bundle.access_token) {
    throw new Error('mint failed: response missing access_token')
  }
  // Normalize expires_at to epoch-millis if backend returned seconds.
  if (bundle.expires_at && bundle.expires_at < 1e12) {
    bundle.expires_at = bundle.expires_at * 1000
  }
  return bundle
}

async function getOrMintJwt({ licenseKey, machineId, supabaseUrl, force = false }) {
  if (!force) {
    const cached = loadCachedJwt()
    if (cached) return cached
  }
  const bundle = await mintJwt({ licenseKey, machineId, supabaseUrl })
  saveCachedJwt(bundle)
  return bundle
}

function clearCachedJwt() {
  try { fs.unlinkSync(CACHE_FILE()) } catch { /* ignore */ }
}

module.exports = { loadCachedJwt, saveCachedJwt, mintJwt, getOrMintJwt, clearCachedJwt }
