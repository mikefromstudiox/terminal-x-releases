/**
 * Persistent Supabase-backed rate limiter for public /api endpoints.
 *
 * Replaces the per-instance in-memory `Map` rate limiter that Vercel's cold
 * starts + multi-region deploy made ineffective. All buckets live in the
 * `api_rate_limits` table and the SECURITY DEFINER RPC `check_rate_limit`
 * atomically increments the (bucket, minute) slot and returns TRUE when the
 * request is below the cap.
 *
 * Semantics:
 *   - Fail OPEN on RPC / network error. A Supabase blip must never lock
 *     legitimate users out of license validation or the signup flow.
 *   - Fail CLOSED on an explicit `false` return from the RPC (over the limit).
 *   - `bucket` is free-form; callers SHOULD namespace per-endpoint, e.g.
 *       `validate:${ip}` / `register:${ip}` / `staff-verify:${ip}`
 *     so one endpoint's traffic cannot knock another endpoint out.
 */
import { createClient } from '@supabase/supabase-js'

function rlClient() {
  // Use the service role so RLS + search_path locks can't silently block the
  // RPC. The function body itself is SECURITY DEFINER, so any role with
  // EXECUTE works, but service-role is the one reliably present on the
  // serverless side.
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

/**
 * Allow this request? Returns `true` when allowed, `false` when rate-limited.
 *
 * @param {string} bucket           free-form identity (e.g. `validate:1.2.3.4`)
 * @param {number} maxPerMin        hard cap per 1-minute window
 * @returns {Promise<boolean>}
 */
export async function checkRateLimit(bucket, maxPerMin) {
  try {
    const supabase = rlClient()
    if (!supabase) return true // misconfigured env → fail open
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_bucket: String(bucket).slice(0, 200),
      p_max_per_min: maxPerMin | 0,
    })
    if (error) {
      console.warn('[rate-limit.rpc]', error.message || error)
      return true // fail OPEN on RPC error
    }
    return data !== false // `true` allows; `false` blocks; null/undef → allow
  } catch (e) {
    console.warn('[rate-limit.catch]', e?.message || e)
    return true // fail OPEN on network error
  }
}

/**
 * Convenience wrapper: extract the first x-forwarded-for IP (trimmed) with a
 * sane fallback for locally-run serverless. Never returns empty.
 */
export function callerIp(req) {
  const xff = String(req?.headers?.['x-forwarded-for'] || '')
  const first = xff.split(',')[0].trim()
  return first || 'unknown'
}
