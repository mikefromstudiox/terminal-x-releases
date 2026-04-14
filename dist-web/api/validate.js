import { createClient } from '@supabase/supabase-js'

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
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  } else {
    // Desktop Electron goes through IPC (remote:validate), not direct fetch
    // Allow non-browser callers but do NOT echo wildcard to browsers
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0] || 'https://terminalxpos.com')
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
        const { data: staff } = await supabase.from('staff').select('id').eq('business_id', license.business_id).eq('auth_user_id', authUser.id).maybeSingle()
        if (!staff) { await audit(supabase, license.id, key, hwid, 'validate', 'hardware_mismatch', ip); return res.json({ valid: false, status: 'hardware_mismatch' }) }
      }
    }
    if (license.hardware_id && license.hardware_id !== hwid && !isWebClient) { await audit(supabase, license.id, key, hwid, 'validate', 'hardware_mismatch', ip); return res.json({ valid: false, status: 'hardware_mismatch' }) }

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
        const existingSettings = license.businesses?.settings || {}
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
    const bizSettings = { name: biz.name, rnc: biz.rnc, phone: biz.phone, address: biz.address, logo: biz.logo_url, plan: license.plans?.name || 'pro', ...(biz.settings || {}) }
    const resp = { valid, readOnly, status, warning, warningMsg, daysUntilExpiry, plan: license.plans?.name || 'free', planDisplay: license.plans?.display_name || 'Free', features: license.plans?.features || [], expiresAt: license.expires_at, activatedAt: license.activated_at, maxUsers: license.plans?.max_users || license.max_users || 3, businessId: license.business_id, remoteConfig, bizSettings }
    if (valid) { resp.businessName = bizName; resp.businessRnc = bizRnc }
    if (status === 'expired' && daysUntilExpiry !== null) resp.daysExpired = -daysUntilExpiry
    return res.json(resp)
  } catch (err) { console.error('[validate]', err.message || err); return res.status(500).json({ valid: false, status: 'server_error' }) }
}

async function audit(supabase, licenseId, key, hwid, action, status, ip) {
  try { await supabase.from('license_events').insert({ license_id: licenseId, action, status, ip, metadata: { key, hwid } }) } catch (e) { console.warn('[audit]', e.message || e) }
}
