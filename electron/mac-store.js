/**
 * mac-store.js — in-memory Manager Authorization Card approval tokens.
 *
 * When a cashier scans a valid Manager Card, the renderer calls
 * `window.electronAPI.mac.issue({scan_token, action, target_id})`. The main
 * process validates the scanned token against `staff.manager_auth_hash` via
 * `db.staffVerifyAuthToken`, then issues a short-lived jti bound to
 * (action, target_id, exp=60s). The jti is returned to the renderer.
 *
 * On the subsequent protected IPC (e.g. `tickets:void`), the renderer
 * includes `{..., mac_jti}` in the payload. `guardMac(action)` in auth-guard
 * looks up the jti, validates action match + not expired, and consumes it
 * (one-time use). Missing / expired / mismatched = 403.
 *
 * Store lives in the main process memory only — never written to disk.
 * Process restart = all outstanding approvals invalidated (fail-safe).
 */

const crypto = require('crypto')

const DEFAULT_TTL_MS = 60 * 1000   // 60s — covers the scan → action round-trip
const MAX_STORE_SIZE = 500         // cap to bound memory under a spam-issue DoS
const _store = new Map()           // jti -> { staff_id, role, action, target_id, exp }

// Cheap periodic sweep. Runs only when ops are active.
function sweep() {
  const now = Date.now()
  for (const [jti, rec] of _store) if (rec.exp <= now) _store.delete(jti)
  // If sweep didn't reclaim enough, evict oldest (FIFO via Map insertion order).
  while (_store.size > MAX_STORE_SIZE) {
    const firstKey = _store.keys().next().value
    if (firstKey === undefined) break
    _store.delete(firstKey)
  }
}

/**
 * Issue a one-time MAC approval.
 * @param {{ staff_id: any, role: string, action: string, target_id?: any, ttlMs?: number }} p
 * @returns {{ jti: string, exp: number }}
 */
function issue({ staff_id, role, action, target_id = null, ttlMs = DEFAULT_TTL_MS }) {
  sweep()
  const jti = crypto.randomUUID()
  const exp = Date.now() + ttlMs
  _store.set(jti, {
    staff_id,
    role,
    action: String(action || ''),
    target_id: target_id != null ? String(target_id) : null,
    exp,
  })
  return { jti, exp }
}

/**
 * Validate + consume a jti. Returns the approval record on success, null on
 * failure (missing / expired / wrong action / wrong target).
 * @param {string} jti
 * @param {string} action
 * @param {string|number|null} target_id
 */
function consume(jti, action, target_id = null) {
  sweep()
  if (!jti) return null
  const rec = _store.get(jti)
  if (!rec) return null
  _store.delete(jti)  // one-time use — consume regardless of validation outcome
  if (rec.exp <= Date.now()) return null
  if (String(rec.action || '') !== String(action || '')) return null
  // If the approval was bound to a target, enforce the match.
  if (rec.target_id != null && target_id != null && String(rec.target_id) !== String(target_id)) return null
  return rec
}

/**
 * Peek without consuming — used by guards that want to surface why a
 * mutation was denied (expired vs wrong action vs missing).
 */
function peek(jti) {
  sweep()
  return _store.get(jti) || null
}

function size() { return _store.size }

module.exports = { issue, consume, peek, size, DEFAULT_TTL_MS }
