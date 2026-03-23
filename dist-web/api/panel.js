import { createClient } from '@supabase/supabase-js'

const ALLOWED_ORIGINS = ['https://terminalxpos.com', 'http://localhost:5173']

function cors(req, res) {
  const origin = req.headers.origin || ''
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
  if (req.method === 'OPTIONS') { res.status(204).end(); return true }
  return false
}

function getClient() {
  return createClient(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

async function requireAdmin(req, minRole) {
  minRole = minRole || 'support'
  const token = (req.headers.authorization || '').replace('Bearer ', '')
  if (!token) return { error: 'No token', status: 401 }
  const supabase = getClient()
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

export default async function handler(req, res) {
  if (cors(req, res)) return
  const action = req.query.action || 'stats'

  if (action === 'stats') return handleStats(req, res)
  if (action === 'licenses') return handleLicenses(req, res)
  if (action === 'clients') return handleClients(req, res)
  if (action === 'users') return handleUsers(req, res)
  return res.status(400).json({ error: 'Unknown action' })
}

async function handleStats(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase } = auth
  try {
    const [r1, r2, r3, r4, r5, r6] = await Promise.all([
      supabase.from('businesses').select('id', { count: 'exact', head: true }),
      supabase.from('licenses').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('licenses').select('id', { count: 'exact', head: true }).eq('status', 'suspended'),
      supabase.from('licenses').select('id', { count: 'exact', head: true }).eq('status', 'expired'),
      supabase.from('businesses').select('id, name, created_at').order('created_at', { ascending: false }).limit(10),
      supabase.from('licenses').select('plan_id, plans(name)'),
    ])
    const byPlan = {}
    for (const l of (r6.data || [])) { const p = l.plans?.name || 'free'; byPlan[p] = (byPlan[p] || 0) + 1 }
    return res.json({ totalClients: r1.count || 0, activeLicenses: r2.count || 0, suspendedLicenses: r3.count || 0, expiredLicenses: r4.count || 0, recentSignups: r5.data || [], byPlan })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleLicenses(req, res) {
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

async function handleClients(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  try {
    const { data: businesses, error } = await auth.supabase.from('businesses')
      .select('id, name, rnc, phone, plan, created_at').order('created_at', { ascending: false }).limit(500)
    if (error) throw error
    const bids = (businesses || []).map(b => b.id)
    if (!bids.length) return res.json({ data: [] })
    const [{ data: licenses }, { data: staffRows }, { data: ticketRows }] = await Promise.all([
      auth.supabase.from('licenses').select('business_id, status, platform, last_seen, plans!plan_id(display_name)').in('business_id', bids),
      auth.supabase.from('staff').select('business_id').in('business_id', bids).eq('active', true),
      auth.supabase.from('tickets').select('business_id').in('business_id', bids),
    ])
    const licenseMap = {}, staffMap = {}, ticketMap = {}
    for (const l of (licenses || [])) licenseMap[l.business_id] = l
    for (const s of (staffRows || [])) staffMap[s.business_id] = (staffMap[s.business_id] || 0) + 1
    for (const t of (ticketRows || [])) ticketMap[t.business_id] = (ticketMap[t.business_id] || 0) + 1
    return res.json({ data: (businesses || []).map(b => ({ ...b, license: licenseMap[b.id] || null, staffCount: staffMap[b.id] || 0, ticketCount: ticketMap[b.id] || 0 })) })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleUsers(req, res) {
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
    const { data, error } = await auth.supabase.from('admin_users').insert({ auth_user_id: authUser.id, name, role: role || 'support' }).select().single()
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
