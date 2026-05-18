/**
 * POST /api/staff-verify-auth
 *
 * Server-side verification of a Manager Authorization Card token. Hash never
 * leaves the server: client POSTs the raw scanned token, we hash it with
 * SHA-256, and match against `staff.manager_auth_hash` filtered to the
 * caller's business.
 *
 * Auth: Supabase JWT (Bearer). Caller must be active staff of `businessId`.
 *
 * Response:
 *   200 { match: { id, name, username, role, supabase_id, rotatedAt } | null }
 *   401 unauthorised (missing/bad JWT)
 *   403 caller not a staff member of the business
 *   400 malformed request
 */
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import { checkRateLimit, callerIp } from '../lib/rate-limit.js'
import { withReporting } from '../lib/report-server-error.js'

const SUPABASE_URL         = process.env.SUPABASE_URL || 'https://xbmhtrdhbnkgdliuxcha.supabase.co'
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

function hashToken(token) {
  const raw = String(token || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex')
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing' })
  }

  // Persistent per-IP rate limit (30/min). Manager-card tokens carry ~100 bits
  // of entropy so brute-force is already impractical, but belt + suspenders:
  // a rate cap also curbs online guessing/DoS noise. Fails OPEN on RPC error.
  const rlIp = callerIp(req)
  if (!(await checkRateLimit(`staff-verify:${rlIp}`, 30))) {
    return res.status(429).json({ error: 'rate_limited' })
  }

  // Parse body (Vercel Edge defaults to JSON body parsing for Node runtime).
  const body = typeof req.body === 'string' ? safeJson(req.body) : (req.body || {})
  const { token, businessId } = body || {}
  if (!token || !businessId) return res.status(400).json({ error: 'Missing token or businessId' })

  const raw = String(token).toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (raw.length < 8 || raw.length > 64) return res.status(400).json({ error: 'Invalid token length' })

  // JWT gate
  const authHeader = req.headers.authorization || req.headers.Authorization || ''
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!jwt) return res.status(401).json({ error: 'Missing Bearer token' })

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Validate JWT → user → caller is staff of this business.
  const { data: userData, error: uerr } = await admin.auth.getUser(jwt)
  if (uerr || !userData?.user?.id) return res.status(401).json({ error: 'Invalid token' })
  const authUserId = userData.user.id

  const { data: callerStaff } = await admin
    .from('staff')
    .select('id, role, active')
    .eq('business_id', businessId)
    .or(`auth_user_id.eq.${authUserId},supabase_id.eq.${authUserId}`)
    .limit(1)
    .maybeSingle()

  if (!callerStaff) {
    // Softer path — JWT user might be the business owner (businesses.owner_id).
    const { data: biz } = await admin.from('businesses').select('id').eq('id', businessId).eq('owner_id', authUserId).maybeSingle()
    if (!biz) return res.status(403).json({ error: 'Caller not a member of this business' })
  } else if (callerStaff.active === false) {
    return res.status(403).json({ error: 'Caller inactive' })
  }

  const hash = hashToken(raw)
  const { data: match, error: merr } = await admin
    .from('staff')
    .select('id, name, username, role, supabase_id, manager_auth_rotated_at')
    .eq('business_id', businessId)
    .eq('active', true)
    .eq('manager_auth_hash', hash)
    .in('role', ['owner', 'manager'])
    .limit(1)
    .maybeSingle()

  if (merr) return res.status(500).json({ error: merr.message })
  if (!match) return res.status(200).json({ match: null })

  return res.status(200).json({
    match: {
      id: match.id,
      name: match.name,
      username: match.username,
      role: match.role,
      supabase_id: match.supabase_id,
      rotatedAt: match.manager_auth_rotated_at,
    },
  })
}

function safeJson(s) { try { return JSON.parse(s) } catch { return {} } }

export default withReporting(handler, { route: '/api/staff-verify-auth' })
