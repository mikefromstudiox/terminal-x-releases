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

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const auth = await requireAdmin(req, 'admin')
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    const { data, error } = await auth.supabase.from('admin_users').select('*').order('created_at')
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ data: data || [] })
  }

  if (req.method === 'POST') {
    const auth = await requireAdmin(req, 'super_admin')
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    const { email, name, role } = req.body || {}
    if (!email || !name) return res.status(400).json({ error: 'email and name required' })
    const { data: { users }, error: listErr } = await auth.supabase.auth.admin.listUsers()
    if (listErr) return res.status(500).json({ error: listErr.message })
    const authUser = (users || []).find(u => u.email === email)
    if (!authUser) return res.status(404).json({ error: 'No auth user with that email.' })
    const { data, error } = await auth.supabase.from('admin_users').insert({
      auth_user_id: authUser.id, name, role: role || 'support',
    }).select().single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ data })
  }

  if (req.method === 'PATCH') {
    const auth = await requireAdmin(req, 'super_admin')
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    const { id, ...updates } = req.body || {}
    if (!id) return res.status(400).json({ error: 'id required' })
    const allowed = ['role', 'name', 'active']
    const patch = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)))
    const { data, error } = await auth.supabase.from('admin_users').update(patch).eq('id', id).select().single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ data })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
