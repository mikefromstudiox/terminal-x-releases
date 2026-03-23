const { createClient } = require('@supabase/supabase-js')

function getServiceClient() {
  return createClient(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

async function requireAdmin(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '')
  if (!token) return { error: 'No token', status: 401 }
  const supabase = getServiceClient()
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return { error: 'Invalid token', status: 401 }
  const { data: admin } = await supabase.from('admin_users')
    .select('id, role, name, active').eq('auth_user_id', user.id).eq('active', true).maybeSingle()
  if (!admin) return { error: 'Not an admin', status: 403 }
  return { admin, user, supabase }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase } = auth

  try {
    const { data: businesses, error } = await supabase.from('businesses')
      .select('id, name, rnc, phone, plan, created_at').order('created_at', { ascending: false }).limit(500)
    if (error) throw error

    const bids = (businesses || []).map(b => b.id)
    if (!bids.length) return res.json({ data: [] })

    const [{ data: licenses }, { data: staffRows }, { data: ticketRows }] = await Promise.all([
      supabase.from('licenses').select('business_id, status, platform, last_seen, plans!plan_id(display_name)').in('business_id', bids),
      supabase.from('staff').select('business_id').in('business_id', bids).eq('active', true),
      supabase.from('tickets').select('business_id').in('business_id', bids),
    ])

    const licenseMap = {}, staffMap = {}, ticketMap = {}
    for (const l of (licenses || [])) licenseMap[l.business_id] = l
    for (const s of (staffRows || [])) staffMap[s.business_id] = (staffMap[s.business_id] || 0) + 1
    for (const t of (ticketRows || [])) ticketMap[t.business_id] = (ticketMap[t.business_id] || 0) + 1

    return res.json({
      data: (businesses || []).map(b => ({
        ...b, license: licenseMap[b.id] || null,
        staffCount: staffMap[b.id] || 0, ticketCount: ticketMap[b.id] || 0,
      }))
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
