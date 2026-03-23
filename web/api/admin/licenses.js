const { createClient } = require('@supabase/supabase-js')

function getServiceClient() {
  return createClient(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

async function requireAdmin(req, minRole) {
  minRole = minRole || 'support'
  const token = (req.headers.authorization || '').replace('Bearer ', '')
  if (!token) return { error: 'No token', status: 401 }
  const supabase = getServiceClient()
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return { error: 'Invalid token', status: 401 }
  const { data: admin } = await supabase.from('admin_users')
    .select('id, role, name, active').eq('auth_user_id', user.id).eq('active', true).maybeSingle()
  if (!admin) return { error: 'Not an admin', status: 403 }
  const h = { super_admin: 3, admin: 2, support: 1 }
  if ((h[admin.role] || 0) < (h[minRole] || 0)) return { error: 'Insufficient permissions', status: 403 }
  return { admin, user, supabase }
}

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function generateKey() {
  const seg = () => Array.from({ length: 4 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('')
  return 'TXL-' + seg() + '-' + seg() + '-' + seg()
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const auth = await requireAdmin(req)
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    try {
      const { data, error } = await auth.supabase.from('licenses')
        .select('*, businesses!business_id(name, rnc, phone), plans!plan_id(name, display_name)')
        .order('created_at', { ascending: false }).limit(500)
      if (error) throw error
      return res.json({ data: data || [] })
    } catch (err) { return res.status(500).json({ error: err.message }) }
  }

  if (req.method === 'POST') {
    const auth = await requireAdmin(req, 'admin')
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    const { business_id, plan_id, platform, expires_at, max_users, notes } = req.body || {}
    if (!business_id) return res.status(400).json({ error: 'business_id required' })
    try {
      const key = (platform === 'desktop' || platform === 'both') ? generateKey() : null
      const { data, error } = await auth.supabase.from('licenses').insert({
        business_id, plan_id: plan_id || null, license_key: key, status: 'active',
        platform: platform || 'web', expires_at: expires_at || null,
        max_users: max_users || 3, notes: notes || null, activated_at: new Date().toISOString(),
      }).select().single()
      if (error) throw error
      return res.json({ data })
    } catch (err) { return res.status(500).json({ error: err.message }) }
  }

  if (req.method === 'PATCH') {
    const auth = await requireAdmin(req, 'admin')
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    const { id, ...updates } = req.body || {}
    if (!id) return res.status(400).json({ error: 'id required' })
    const allowed = ['status', 'plan_id', 'expires_at', 'max_users', 'notes', 'hardware_id', 'platform']
    const patch = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)))
    patch.updated_at = new Date().toISOString()
    try {
      const { data, error } = await auth.supabase.from('licenses').update(patch).eq('id', id).select().single()
      if (error) throw error
      return res.json({ data })
    } catch (err) { return res.status(500).json({ error: err.message }) }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
