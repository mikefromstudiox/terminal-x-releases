/**
 * perLicenseJwt.js — Per-license custom JWT lifecycle for the web bundle.
 *
 * Flow:
 *   1. Web app boots, finds `tx_license_key` in localStorage (set during
 *      signup/provisioning, see web/main.jsx:316).
 *   2. POSTs { license_key, machine_id } to the `mint-license-jwt` Supabase
 *      Edge Function. Server verifies the license is active + bound to the
 *      machine, then signs a short-lived JWT whose claims include
 *      business_id, plan_id, role='license_user'. RLS policies treat that
 *      JWT identically to a real Supabase Auth session (claim-based RLS).
 *   3. Cache JWT in localStorage so reload doesn't always re-mint.
 *   4. Attach JWT to the supabase-js client via `auth.setSession`. Because
 *      our custom JWT has no GoTrue refresh_token, we pass the access_token
 *      itself as the refresh_token — supabase-js requires both fields to be
 *      non-empty strings but never actually uses our refresh_token (we own
 *      the refresh logic via setInterval+getOrMintJwt({force:true})).
 *   5. Periodic refresher (caller wires setInterval) re-mints when the JWT
 *      enters its 5-minute expiry buffer, then re-attaches.
 *
 * Demo path is unaffected: demo accounts never have `tx_license_key` set,
 * so bootLicenseJwt() short-circuits and signInWithPassword owns the
 * session as before.
 */

export const JWT_REFRESH_BUFFER_MS = 5 * 60_000
export const JWT_CACHE_KEY = 'tx_license_jwt_v1'

function lsAvailable() {
  try { return typeof localStorage !== 'undefined' } catch { return false }
}

/**
 * POST to the `mint-license-jwt` Edge Function.
 * @returns {Promise<{access_token: string, expires_at: number, business_id: string, plan_id: string|null}>}
 * @throws if the network call fails or the function returns non-2xx.
 */
export async function mintJwt({ licenseKey, machineId, supabaseFunctionsUrl }) {
  if (!licenseKey)            throw new Error('mintJwt: licenseKey required')
  if (!machineId)             throw new Error('mintJwt: machineId required')
  if (!supabaseFunctionsUrl)  throw new Error('mintJwt: supabaseFunctionsUrl required')

  const url = supabaseFunctionsUrl.replace(/\/+$/, '') + '/mint-license-jwt'
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ license_key: licenseKey, machine_id: machineId }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`mintJwt ${res.status}: ${text || res.statusText}`)
  }
  const json = await res.json()
  // Normalise — server may return expires_at as ISO or seconds-epoch.
  let expires_at = json.expires_at
  if (typeof expires_at === 'string')      expires_at = Date.parse(expires_at)
  else if (typeof expires_at === 'number' && expires_at < 1e12) expires_at = expires_at * 1000
  if (!json.access_token || !expires_at)   throw new Error('mintJwt: malformed response')
  return {
    access_token: json.access_token,
    expires_at,
    business_id: json.business_id || null,
    plan_id:     json.plan_id     || null,
  }
}

export function loadCachedJwt() {
  if (!lsAvailable()) return null
  try {
    const raw = localStorage.getItem(JWT_CACHE_KEY)
    if (!raw) return null
    const bundle = JSON.parse(raw)
    if (!bundle || !bundle.access_token || !bundle.expires_at) return null
    // Already past the refresh buffer ⇒ treat as missing so caller re-mints.
    if (isExpiringSoon(bundle)) return null
    return bundle
  } catch { return null }
}

export function saveCachedJwt(jwtBundle) {
  if (!lsAvailable() || !jwtBundle) return
  try { localStorage.setItem(JWT_CACHE_KEY, JSON.stringify(jwtBundle)) } catch {}
}

export function clearCachedJwt() {
  if (!lsAvailable()) return
  try { localStorage.removeItem(JWT_CACHE_KEY) } catch {}
}

export function isExpiringSoon(jwtBundle, bufferMs = JWT_REFRESH_BUFFER_MS) {
  if (!jwtBundle || !jwtBundle.expires_at) return true
  return (jwtBundle.expires_at - Date.now()) < bufferMs
}

/**
 * Returns a valid (non-expiring-soon) JWT bundle.
 * - If `force` is false and a cached bundle is still fresh, returns it.
 * - Otherwise mints a new one, caches, and returns it.
 * Throws on mint failure — caller decides whether to fall back to a
 * different auth path (e.g. signInWithPassword) or surface the error.
 */
export async function getOrMintJwt({ licenseKey, machineId, supabaseFunctionsUrl, force = false }) {
  if (!force) {
    const cached = loadCachedJwt()
    if (cached) return cached
  }
  const fresh = await mintJwt({ licenseKey, machineId, supabaseFunctionsUrl })
  saveCachedJwt(fresh)
  return fresh
}

/**
 * Attach the per-license JWT to a supabase-js v2 client so all subsequent
 * PostgREST/Storage/RPC calls go out with `Authorization: Bearer <jwt>`.
 *
 * supabase-js v2's `auth.setSession` requires both access_token and
 * refresh_token to be non-empty strings. Our mint endpoint doesn't issue a
 * GoTrue refresh_token (we own refresh ourselves), so we pass the
 * access_token itself in the refresh_token slot — supabase-js never calls
 * its own refresh path for this token (refresh is driven externally by our
 * setInterval + getOrMintJwt({force:true}) loop), so this is safe.
 *
 * Returns true on success, false on failure (caller logs + decides).
 */
export async function attachJwtToSupabaseClient(client, jwtBundle) {
  if (!client || !client.auth || !jwtBundle?.access_token) return false
  try {
    const { error } = await client.auth.setSession({
      access_token:  jwtBundle.access_token,
      refresh_token: jwtBundle.access_token, // see comment above
    })
    if (error) {
      console.warn('[perLicenseJwt] setSession error:', error.message || error)
      return false
    }
    return true
  } catch (e) {
    console.warn('[perLicenseJwt] setSession threw:', e?.message || e)
    return false
  }
}
