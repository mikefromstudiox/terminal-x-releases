const { createClient } = require('@supabase/supabase-js')

function getServiceClient() {
  return createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
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
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase } = auth

  try {
    const [
      { count: totalClients },
      { count: activeLicenses },
      { count: suspendedLicenses },
      { count: expiredLicenses },
      { data: recentSignups },
      { data: planCounts },
    ] = await Promise.all([
      supabase.from('businesses').select('id', { count: 'exact', head: true }),
      supabase.from('licenses').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('licenses').select('id', { count: 'exact', head: true }).eq('status', 'suspended'),
      supabase.from('licenses').select('id', { count: 'exact', head: true }).eq('status', 'expired'),
      supabase.from('businesses').select('id, name, created_at').order('created_at', { ascending: false }).limit(10),
      supabase.from('licenses').select('plans!plan_id(name)').eq('status', 'active'),
    ])

    const byPlan = {}
    for (const l of (planCounts || [])) {
      const p = l.plans?.name || 'free'
      byPlan[p] = (byPlan[p] || 0) + 1
    }

    return res.json({
      totalClients: totalClients || 0,
      activeLicenses: activeLicenses || 0,
      suspendedLicenses: suspendedLicenses || 0,
      expiredLicenses: expiredLicenses || 0,
      recentSignups: recentSignups || [],
      byPlan,
    })
  } catch (err) {
    console.error('[admin/stats]', err)
    return res.status(500).json({ error: 'Failed to load stats' })
  }
}
