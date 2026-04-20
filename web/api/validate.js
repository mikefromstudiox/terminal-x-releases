import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

function hashHwid(h) {
  if (!h) return null
  try { return crypto.createHash('sha256').update(String(h)).digest('hex').slice(0, 16) } catch { return null }
}

// Upsert a pending rebind request for (license_id, requested_hwid). If an
// existing pending row is found, bump updated_at and extend the TTL window.
// Returns the row (or null on failure — never throws into the hot path).
async function upsertRebindRequest(supabase, licenseId, currentHwid, requestedHwid, ip) {
  try {
    const nowIso = new Date().toISOString()
    const expIso = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString()
    const { data: existing } = await supabase.from('license_rebind_requests')
      .select('*').eq('license_id', licenseId).eq('requested_hwid', requestedHwid).eq('status', 'pending').maybeSingle()
    if (existing) {
      const { data: bumped } = await supabase.from('license_rebind_requests')
        .update({ updated_at: nowIso, expires_at: expIso, current_hwid: currentHwid, ip })
        .eq('id', existing.id).select().single()
      return bumped || existing
    }
    const { data: inserted } = await supabase.from('license_rebind_requests').insert({
      license_id: licenseId, requested_hwid: requestedHwid, current_hwid: currentHwid,
      status: 'pending', expires_at: expIso, ip,
    }).select().single()
    return inserted
  } catch (e) {
    console.warn('[rebind.upsert]', e.message || e)
    return null
  }
}

// See panel.js for rationale — businesses.settings is JSONB but some historical
// rows were written as JSON-encoded strings. Normalise either shape.
function parseSettingsIfString(raw) {
  let s = raw
  for (let i = 0; i < 3; i++) {
    if (typeof s !== 'string') break
    try { s = JSON.parse(s) } catch { return {} }
  }
  return (s && typeof s === 'object' && !Array.isArray(s)) ? s : {}
}

const GRACE_DAYS = 3
const rateMap = new Map()
const ALLOWED_ORIGINS = ['https://terminalxpos.com', 'http://localhost:5173']

function getClient() {
  return createClient(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

function rateLimit(ip) {
  const now = Date.now()
  const entry = rateMap.get(ip)
  if (!entry || now - entry.start > 60000) { rateMap.set(ip, { start: now, count: 1 }); return true }
  entry.count++
  return entry.count <= 30
}

export default async function handler(req, res) {
  const origin = req.headers.origin || ''
  // Strict origin enforcement: if Origin header is present, it MUST be allow-listed.
  // Non-browser callers (desktop Electron IPC → remote.validate, server-to-server)
  // send no Origin header and pass through. Browser cross-origin attempts get 403.
  if (origin) {
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return res.status(403).json({ error: 'origin_not_allowed' })
    }
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown'
  if (!rateLimit(ip)) return res.status(429).json({ valid: false, status: 'rate_limited' })

  const { key, hwid, rnc, bizSync } = req.body || {}
  if (!key || !hwid) return res.status(400).json({ valid: false, status: 'invalid_request' })

  const supabase = getClient()

  try {
    const { data: license, error } = await supabase.from('licenses')
      .select('*, businesses!business_id(name, rnc, phone, address, logo_url, settings), plans!plan_id(name, display_name, features, max_users)')
      .eq('license_key', key.toUpperCase().trim()).maybeSingle()
    if (error) throw error
    if (!license) { await audit(supabase, null, key, hwid, 'validate', 'not_found', ip); return res.json({ valid: false, status: 'not_found' }) }

    const bizName = license.businesses?.name || '', bizRnc = license.businesses?.rnc || ''

    if (rnc) {
      const norm = s => (s || '').replace(/\D/g, '')
      if (norm(bizRnc) !== norm(rnc)) { await audit(supabase, license.id, key, hwid, 'validate', 'rnc_mismatch', ip); return res.json({ valid: false, status: 'rnc_mismatch' }) }
    }
    if (license.status === 'cancelled') { await audit(supabase, license.id, key, hwid, 'validate', 'inactive', ip); return res.json({ valid: false, status: 'inactive' }) }
    if (license.status === 'suspended') { await audit(supabase, license.id, key, hwid, 'validate', 'suspended', ip); return res.json({ valid: false, status: 'suspended' }) }
    const isWebClient = hwid === 'web-client'
    if (isWebClient) {
      const authHeader = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
      if (!authHeader) { await audit(supabase, license.id, key, hwid, 'validate', 'hardware_mismatch', ip); return res.json({ valid: false, status: 'hardware_mismatch' }) }
      const { data: { user: authUser }, error: authErr } = await supabase.auth.getUser(authHeader)
      if (authErr || !authUser) { await audit(supabase, license.id, key, hwid, 'validate', 'hardware_mismatch', ip); return res.json({ valid: false, status: 'hardware_mismatch' }) }
      if (license.business_id) {
        // Accept if authUser is business owner OR a linked staff member.
        const { data: biz } = await supabase.from('businesses').select('owner_id').eq('id', license.business_id).maybeSingle()
        const isOwner = biz?.owner_id && biz.owner_id === authUser.id
        let staff = null
        if (!isOwner) {
          const r = await supabase.from('staff').select('id').eq('business_id', license.business_id).eq('auth_user_id', authUser.id).maybeSingle()
          staff = r.data
        }
        if (!isOwner && !staff) { await audit(supabase, license.id, key, hwid, 'validate', 'hardware_mismatch', ip); return res.json({ valid: false, status: 'hardware_mismatch' }) }
      }
    }
    // S-H9: HWID rebind approval. If the license is already bound to a DIFFERENT
    // hwid, do NOT silently rebind (old TOFU behaviour) and do NOT just deny with
    // 'hardware_mismatch' either. Open a pending rebind request that an admin
    // must approve. The client gets 'rebind_required' and polls.
    if (license.hardware_id && license.hardware_id !== hwid && !isWebClient) {
      const rebind = await upsertRebindRequest(supabase, license.id, license.hardware_id, hwid, ip)
      await audit(supabase, license.id, key, hwid, 'rebind_requested', 'pending', ip, { prior_hwid: license.hardware_id, request_id: rebind?.id || null })
      return res.json({
        valid: false,
        status: 'rebind_required',
        pendingHwid: hashHwid(hwid),
        expiresAt: rebind?.expires_at || null,
      })
    }

    if (license.status === 'pending' && !license.hardware_id) {
      await audit(supabase, license.id, key, hwid, 'validate', 'pending', ip)
      return res.json({ valid: false, status: 'pending', businessName: bizName })
    }

    if (!license.hardware_id && !isWebClient) {
      await supabase.from('licenses').update({ hardware_id: hwid, activated_at: new Date().toISOString(), status: 'active', updated_at: new Date().toISOString() }).eq('id', license.id)
      license.status = 'active'
      await audit(supabase, license.id, key, hwid, 'activate', 'active', ip)
    } else if (!license.hardware_id && isWebClient) {
      if (license.status === 'pending') return res.json({ valid: false, status: 'pending', businessName: bizName })
      license.status = license.status || 'active'
    } else if (license.status === 'pending') {
      await supabase.from('licenses').update({ status: 'active', updated_at: new Date().toISOString() }).eq('id', license.id)
      license.status = 'active'
    }
    await supabase.from('licenses').update({ last_seen: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', license.id)
    await audit(supabase, license.id, key, hwid, 'validate', 'active', ip)

    const expiresAt = license.expires_at ? new Date(license.expires_at) : null
    const now = new Date()
    let status = license.status
    let valid = true, readOnly = false, warning = false, warningMsg = null, daysUntilExpiry = null

    if (expiresAt) {
      const diff = Math.floor((expiresAt - now) / 86400000)
      daysUntilExpiry = diff
      if (diff < -GRACE_DAYS) { status = 'expired'; valid = false; readOnly = true }
      else if (diff < 0) { status = 'grace'; warning = true; warningMsg = 'Licencia vencida. Periodo de gracia activo.' }
      else if (diff <= 30) { warning = true; warningMsg = 'Tu licencia vence en ' + diff + ' dias.' }
    }

    // Sync business settings from desktop → Supabase (if provided)
    if (valid && license.business_id && bizSync) {
      const updates = {}
      if (bizSync.name)    updates.name    = bizSync.name
      if (bizSync.address) updates.address = bizSync.address
      if (bizSync.phone)   updates.phone   = bizSync.phone
      if (bizSync.email)   updates.email   = bizSync.email
      if (bizSync.rnc)     updates.rnc     = bizSync.rnc
      if (Object.keys(updates).length) {
        updates.updated_at = new Date().toISOString()
        await supabase.from('businesses').update(updates).eq('id', license.business_id)
      }
      // Sync e-CF certificate status
      if (bizSync.ecf_cert_installed !== undefined) {
        const existingSettings = parseSettingsIfString(license.businesses?.settings)
        const ecfStatus = { ecf_cert_installed: bizSync.ecf_cert_installed, ecf_cert_subject: bizSync.ecf_cert_subject || null, ecf_cert_expiry: bizSync.ecf_cert_expiry || null, ecf_cert_expired: bizSync.ecf_cert_expired || false, ecf_environment: bizSync.ecf_environment || null, ecf_status_updated_at: new Date().toISOString(), ...(bizSync.ecf_private_key_pem ? { ecf_private_key_pem: bizSync.ecf_private_key_pem, ecf_certificate_pem: bizSync.ecf_certificate_pem } : {}) }
        await supabase.from('businesses').update({ settings: { ...existingSettings, ...ecfStatus }, updated_at: new Date().toISOString() }).eq('id', license.business_id)
      }
    }

    // Fetch remote config (app_settings) for this business to sync to desktop
    let remoteConfig = {}
    if (valid && license.business_id) {
      const { data: cfgRows } = await supabase.from('app_settings').select('key, value').eq('business_id', license.business_id)
      if (cfgRows) remoteConfig = Object.fromEntries(cfgRows.map(r => [r.key, r.value]))
    }
    const biz = license.businesses || {}
    // settings column is JSONB but some historical rows are JSON-encoded strings.
    // parseSettingsIfString normalises either shape and also survives the
    // corner case of a double-encoded string.
    const bizSettingsJson = parseSettingsIfString(biz.settings)
    const bizSettings = { name: biz.name, rnc: biz.rnc, phone: biz.phone, address: biz.address, logo: biz.logo_url, plan: license.plans?.name || 'pro', ...bizSettingsJson }
    const resp = { valid, readOnly, status, warning, warningMsg, daysUntilExpiry, plan: license.plans?.name || 'free', planDisplay: license.plans?.display_name || 'Free', features: license.plans?.features || [], expiresAt: license.expires_at, activatedAt: license.activated_at, maxUsers: license.plans?.max_users || license.max_users || 3, businessId: license.business_id, remoteConfig, bizSettings }
    if (valid) { resp.businessName = bizName; resp.businessRnc = bizRnc }
    if (status === 'expired' && daysUntilExpiry !== null) resp.daysExpired = -daysUntilExpiry
    return res.json(resp)
  } catch (err) { console.error('[validate]', err.message || err); return res.status(500).json({ valid: false, status: 'server_error' }) }
}

async function audit(supabase, licenseId, key, hwid, action, status, ip, extra) {
  try {
    const metadata = { key, hwid, ...(extra || {}) }
    await supabase.from('license_events').insert({ license_id: licenseId, action, status, ip, metadata })
  } catch (e) { console.warn('[audit]', e.message || e) }
}
