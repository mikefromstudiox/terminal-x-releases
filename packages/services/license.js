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
import { withRetry } from './retry.js'
import { humanizeLicenseError } from './networkError.js'

const LICENSE_API  = import.meta.env.VITE_LICENSE_API || 'https://terminalxpos.com'
const CACHE_TTL_MS = 72 * 60 * 60 * 1000  // 72 hours offline grace
const GRACE_DAYS   = 3
const WARNING_DAYS = 30

// ── Storage keys ──────────────────────────────────────────────────────────────
const KEY_LICENSE    = 'tx_license_key'
const KEY_RNC        = 'tx_license_rnc'
const KEY_CACHE      = 'tx_license_cache'
const KEY_CACHE_TIME = 'tx_license_cache_ts'

// S-H10: monotonic clock-rollback detection. performance.now() is monotonic
// *within a page session* (resets on full restart), and navigation.type /
// performance.timeOrigin give us a per-session baseline that can't be rolled
// back by the user's wall clock. We cross-check wall-delta against perf-delta
// plus the process start offset — if wall moves backward or moves far less
// than perf says it should, the clock was tampered with.
const KEY_CACHE_PERF  = 'tx_license_cache_perf'   // performance.now() at write
const KEY_CACHE_ORIGIN = 'tx_license_cache_origin' // performance.timeOrigin at write
// Tolerance: wall time is expected to advance by AT LEAST (perfDelta - 60s) —
// the 60s pad absorbs timer drift + sleep/hibernate. If wall-delta < threshold,
// clock rolled back, cache denied.
const ROLLBACK_SLACK_MS = 60 * 1000

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
  localStorage.removeItem(KEY_CACHE_PERF)
  localStorage.removeItem(KEY_CACHE_ORIGIN)
}

// Current monotonic timestamp in the same reference frame used at cache write.
// performance.timeOrigin + performance.now() == wall-clock of the perf mark,
// so (timeOrigin_now - timeOrigin_cached) + perf_now is comparable across
// page reloads within a session. On full app restart, timeOrigin changes and
// we gracefully fall back to wall-only checks.
function monotonicNow() {
  try {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return { perf: performance.now(), origin: performance.timeOrigin || 0 }
    }
  } catch {}
  return { perf: 0, origin: 0 }
}

function getCachedResult() {
  try {
    const ts       = parseInt(localStorage.getItem(KEY_CACHE_TIME)   || '0', 10)
    const perfAt   = parseFloat(localStorage.getItem(KEY_CACHE_PERF) || '0')
    const originAt = parseFloat(localStorage.getItem(KEY_CACHE_ORIGIN) || '0')
    const data     = localStorage.getItem(KEY_CACHE)
    if (!data || !ts) return null

    const nowWall = Date.now()
    const wallDelta = nowWall - ts

    // Hard rule: wall time must move forward. Negative delta = explicit rollback.
    if (wallDelta < 0) {
      console.warn('[license.cache] clock rollback detected (wall went backwards), denying cache')
      return null
    }

    // Monotonic cross-check: only valid if we still have the same performance
    // time origin (same page session). After a full restart, originAt changes
    // and we skip this check — the wall-clock rule + server re-validate cover it.
    const { perf: nowPerf, origin: nowOrigin } = monotonicNow()
    if (perfAt > 0 && originAt > 0 && nowOrigin === originAt && nowPerf > 0) {
      const perfDelta = nowPerf - perfAt
      // If perf has advanced materially more than wall, the user rolled the clock back.
      if (perfDelta - wallDelta > ROLLBACK_SLACK_MS) {
        console.warn('[license.cache] clock rollback detected (perf vs wall divergence), denying cache', { perfDelta, wallDelta })
        return null
      }
    }

    if (wallDelta < CACHE_TTL_MS) return JSON.parse(data)
  } catch {}
  return null
}

function setCachedResult(result) {
  const { perf, origin } = monotonicNow()
  localStorage.setItem(KEY_CACHE,        JSON.stringify(result))
  localStorage.setItem(KEY_CACHE_TIME,   String(Date.now()))
  localStorage.setItem(KEY_CACHE_PERF,   String(perf))
  localStorage.setItem(KEY_CACHE_ORIGIN, String(origin))
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
export async function validateLicense(licenseKey, hardwareId, rnc = '', bizSync = null) {
  if (!isValidKeyFormat(licenseKey)) {
    return { valid: false, status: 'invalid_format', readOnly: true }
  }

  try {
    const payload = {
      key:  licenseKey.toUpperCase().trim(),
      hwid: hardwareId,
      rnc:  rnc || getStoredRnc(),
    }
    if (bizSync) payload.bizSync = bizSync

    let data
    if (window.electronAPI?.remote) {
      // Desktop: use IPC (no CORS issues). Retry transient IPC/network errors.
      data = await withRetry(
        () => window.electronAPI.remote.validate(payload),
        { label: 'license.validate.ipc' },
      )
    } else {
      // Web: use fetch — include Supabase auth token for web-client HWID verification
      const hdrs = { 'Content-Type': 'application/json' }
      try {
        // Read auth token from Supabase's localStorage session (the main app's client stores it here)
        const storageKey = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
        if (storageKey) {
          const stored = JSON.parse(localStorage.getItem(storageKey) || '{}')
          if (stored?.access_token) hdrs['Authorization'] = `Bearer ${stored.access_token}`
        }
      } catch {}
      data = await withRetry(async () => {
        const response = await fetch(`${LICENSE_API}/api/validate`, {
          method:  'POST',
          headers: hdrs,
          body:    JSON.stringify(payload),
          signal: AbortSignal.timeout(10000),
        })
        if (!response.ok) {
          const e = new Error(`Server error: ${response.status}`)
          e.status = response.status
          throw e
        }
        return response.json()
      }, { label: 'license.validate.http' })
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
    const humanMsg = humanizeLicenseError(err, { context: 'license.validate' })

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
      warningMsg: humanMsg,
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
