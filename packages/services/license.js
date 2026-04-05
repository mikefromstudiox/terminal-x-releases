/**
 * license.js — Terminal X License Validation Service
 *
 * Validates licenses against the Terminal X License Server (Express + SQLite).
 * Set VITE_LICENSE_API in your .env to point to your deployed server.
 *
 * Server endpoints used:
 *   POST /api/validate  — validate key + rnc + hwid
 *
 * Offline grace: 72 hours cached validation
 * Grace period after expiry: 3 days
 * Warning window before expiry: 30 days
 */

// ── Config ────────────────────────────────────────────────────────────────────
const LICENSE_API  = import.meta.env.VITE_LICENSE_API || 'https://terminalxpos.com'
const CACHE_TTL_MS = 72 * 60 * 60 * 1000  // 72 hours offline grace
const GRACE_DAYS   = 3
const WARNING_DAYS = 30

// ── Storage keys ──────────────────────────────────────────────────────────────
const KEY_LICENSE    = 'tx_license_key'
const KEY_RNC        = 'tx_license_rnc'
const KEY_CACHE      = 'tx_license_cache'
const KEY_CACHE_TIME = 'tx_license_cache_ts'

// ── License key format helpers ────────────────────────────────────────────────

/** Generate a new random Terminal X license key: TXL-XXXX-XXXX-XXXX */
export function generateLicenseKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const seg   = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  return `TXL-${seg()}-${seg()}-${seg()}`
}

/** Basic format check (does not verify against server) */
export function isValidKeyFormat(key) {
  return /^TXL-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test((key || '').toUpperCase().trim())
}

// ── Local storage helpers ─────────────────────────────────────────────────────

export function getStoredLicenseKey() { return localStorage.getItem(KEY_LICENSE) || '' }
export function getStoredRnc()        { return localStorage.getItem(KEY_RNC)     || '' }

export function setStoredLicenseKey(key, rnc) {
  localStorage.setItem(KEY_LICENSE, key)
  if (rnc) localStorage.setItem(KEY_RNC, rnc)
}

export function clearStoredLicenseKey() {
  localStorage.removeItem(KEY_LICENSE)
  localStorage.removeItem(KEY_RNC)
  localStorage.removeItem(KEY_CACHE)
  localStorage.removeItem(KEY_CACHE_TIME)
}

function getCachedResult() {
  try {
    const ts   = parseInt(localStorage.getItem(KEY_CACHE_TIME) || '0')
    const data = localStorage.getItem(KEY_CACHE)
    if (data && Date.now() - ts < CACHE_TTL_MS) return JSON.parse(data)
  } catch {}
  return null
}

function setCachedResult(result) {
  localStorage.setItem(KEY_CACHE,      JSON.stringify(result))
  localStorage.setItem(KEY_CACHE_TIME, String(Date.now()))
}

// ── Core validation ───────────────────────────────────────────────────────────

/**
 * Validate a license key against the Terminal X license server.
 * Falls back to cached result on network failure (72h grace).
 *
 * @param {string} licenseKey
 * @param {string} hardwareId
 * @param {string} [rnc]
 * @returns {Promise<LicenseResult>}
 */
export async function validateLicense(licenseKey, hardwareId, rnc = '') {
  if (!isValidKeyFormat(licenseKey)) {
    return { valid: false, status: 'invalid_format', readOnly: true }
  }

  try {
    const payload = {
      key:  licenseKey.toUpperCase().trim(),
      hwid: hardwareId,
      rnc:  rnc || getStoredRnc(),
    }

    let data
    if (window.electronAPI?.remote) {
      // Desktop: use IPC (no CORS issues)
      data = await window.electronAPI.remote.validate(payload)
    } else {
      // Web: use fetch
      const response = await fetch(`${LICENSE_API}/api/validate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      })
      if (!response.ok) throw new Error(`Server error: ${response.status}`)
      data = await response.json()
    }

    // Rehydrate date strings from server
    const result = {
      ...data,
      expiresAt:   data.expiresAt   ? new Date(data.expiresAt)   : null,
      activatedAt: data.activatedAt ? new Date(data.activatedAt) : null,
    }

    if (result.valid) setCachedResult(result)
    return result

  } catch (err) {
    console.warn('[license] Server unreachable, falling back to cache:', err.message)

    const cached = getCachedResult()
    if (cached) {
      // Recompute time-based expiry against current date
      return applyTimeChecks(cached)
    }

    // No cache at all — deny access (never validated before)
    return {
      valid:      false,
      readOnly:   true,
      status:     'no_connection',
      warning:    true,
      warningMsg: 'No se pudo conectar para validar la licencia. Verifica tu conexion a internet.',
    }
  }
}

/** Re-apply expiry/grace logic against current date (used for cached results) */
function applyTimeChecks(result) {
  if (!result.expiresAt) return { ...result }

  const now       = new Date()
  const expiresAt = result.expiresAt instanceof Date ? result.expiresAt : new Date(result.expiresAt)
  const diffDays  = Math.floor((expiresAt - now) / (1000 * 60 * 60 * 24))

  if (diffDays < -GRACE_DAYS) {
    return { ...result, valid: false, readOnly: true, status: 'expired',
             daysExpired: -diffDays, daysUntilExpiry: diffDays }
  }

  if (diffDays < 0) {
    return { ...result, valid: true, readOnly: false, status: 'grace', warning: true,
             daysUntilExpiry: diffDays,
             warningMsg: `Licencia vencida hace ${-diffDays} días. Período de gracia: ${GRACE_DAYS + diffDays} días restantes.` }
  }

  return {
    ...result,
    daysUntilExpiry: diffDays,
    warning:         diffDays <= WARNING_DAYS,
    warningMsg:      diffDays <= WARNING_DAYS
      ? `Tu licencia vence en ${diffDays} días. Renueva pronto.`
      : null,
  }
}

// ── Admin session (in-app license admin) ─────────────────────────────────────

const ADMIN_SESSION_KEY = 'tx_license_admin_session'

export function isAdminSession() {
  try {
    const { exp } = JSON.parse(sessionStorage.getItem(ADMIN_SESSION_KEY) || '{}')
    return exp > Date.now()
  } catch { return false }
}

export function startAdminSession(adminKey) {
  sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({
    exp: Date.now() + 60 * 60 * 1000,
    key: adminKey || '',
  }))
}

export function endAdminSession() {
  sessionStorage.removeItem(ADMIN_SESSION_KEY)
}
