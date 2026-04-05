import { createClient } from '@supabase/supabase-js'

const ALLOWED_ORIGINS = ['https://terminalxpos.com', 'http://localhost:5173']

function cors(req, res) {
  const origin = req.headers.origin || ''
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  } else if (!origin || origin === 'null') {
    // Desktop Electron (file://) sends Origin: null; server-to-server has no origin
    res.setHeader('Access-Control-Allow-Origin', '*')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
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
  if (action === 'client_detail') return handleClientDetail(req, res)
  if (action === 'update_business') return handleUpdateBusiness(req, res)
  if (action === 'link_web_account') return handleLinkWebAccount(req, res)
  if (action === 'activity_feed') return handleActivityFeed(req, res)
  if (action === 'register') return handleRegister(req, res)
  if (action === 'client_config') return handleClientConfig(req, res)
  if (action === 'push_service') return handlePushService(req, res)
  if (action === 'cert_list') return handleCertList(req, res)
  if (action === 'cert_detail') return handleCertDetail(req, res)
  if (action === 'cert_create') return handleCertCreate(req, res)
  if (action === 'cert_update') return handleCertUpdate(req, res)
  if (action === 'cert_step') return handleCertStep(req, res)
  if (action === 'cert_notes') return handleCertNotes(req, res)
  if (action === 'cert_docs') return handleCertDocs(req, res)
  if (action === 'cert_stats') return handleCertStats(req, res)
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
        .select('*, businesses(name, rnc, phone), plans(name, display_name)')
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
  if (req.method === 'GET') {
    const auth = await requireAdmin(req)
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    try {
      const { data: businesses, error } = await auth.supabase.from('businesses')
        .select('id, name, rnc, phone, email, plan, logo_url, settings, created_at').order('created_at', { ascending: false }).limit(500)
      if (error) throw error
      const bids = (businesses || []).map(b => b.id)
      if (!bids.length) return res.json({ data: [] })
      const [{ data: licenses }, { data: staffRows }, { data: ticketRows }, { data: serviceRows }, { data: clientRows }, { data: configRows }] = await Promise.all([
        auth.supabase.from('licenses').select('business_id, status, platform, last_seen, plans(display_name)').in('business_id', bids),
        auth.supabase.from('staff').select('business_id, role, auth_user_id').in('business_id', bids).eq('active', true),
        auth.supabase.from('tickets').select('business_id').in('business_id', bids),
        auth.supabase.from('services').select('business_id').in('business_id', bids).eq('active', true),
        auth.supabase.from('clients').select('business_id').in('business_id', bids).eq('active', true),
        auth.supabase.from('configuracion').select('business_id, valor').in('business_id', bids).eq('clave', 'setup_complete'),
      ])
      const licenseMap = {}, staffMap = {}, ticketMap = {}, serviceMap = {}, clientMap = {}, configMap = {}, ownerLinkedMap = {}
      for (const l of (licenses || [])) licenseMap[l.business_id] = l
      for (const s of (staffRows || [])) {
        staffMap[s.business_id] = (staffMap[s.business_id] || 0) + 1
        if (s.role === 'owner' && s.auth_user_id) ownerLinkedMap[s.business_id] = true
      }
      for (const t of (ticketRows || [])) ticketMap[t.business_id] = (ticketMap[t.business_id] || 0) + 1
      for (const s of (serviceRows || [])) serviceMap[s.business_id] = (serviceMap[s.business_id] || 0) + 1
      for (const c of (clientRows || [])) clientMap[c.business_id] = (clientMap[c.business_id] || 0) + 1
      for (const c of (configRows || [])) configMap[c.business_id] = c.valor === '1'
      return res.json({ data: (businesses || []).map(b => {
        const onboarding = {
          business_info: !!(b.name && b.rnc),
          logo: !!b.logo_url,
          owner_linked: !!ownerLinkedMap[b.id],
          first_service: (serviceMap[b.id] || 0) > 0,
          first_client: (clientMap[b.id] || 0) > 0,
          first_sale: (ticketMap[b.id] || 0) > 0,
          fiscal_configured: !!(b.settings?.facturacion_mode),
          setup_complete: !!configMap[b.id],
        }
        const score = Object.values(onboarding).filter(Boolean).length
        const { settings, ...bizSafe } = b
        return { ...bizSafe, license: licenseMap[b.id] || null, staffCount: staffMap[b.id] || 0, ticketCount: ticketMap[b.id] || 0, onboarding, onboardingScore: score }
      }) })
    } catch (err) { return res.status(500).json({ error: err.message }) }
  }
  if (req.method === 'POST') {
    const auth = await requireAdmin(req, 'admin')
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    const { business_name, rnc, phone, email, password, plan, platform } = req.body || {}
    if (!business_name || !email || !password) return res.status(400).json({ error: 'business_name, email, password required' })
    try {
      const { data: authData, error: authErr } = await auth.supabase.auth.admin.createUser({
        email, password, email_confirm: true,
      })
      if (authErr) throw authErr
      const userId = authData.user.id
      const planName = plan || 'pro'
      const plat = platform || 'web'
      const { data: planRow } = await auth.supabase.from('plans').select('id, name, max_users').eq('name', planName).maybeSingle()
      const { data: biz, error: bizErr } = await auth.supabase.from('businesses').insert({
        owner_id: userId, name: business_name.trim(), rnc: (rnc || '').trim(),
        phone: (phone || '').trim(), plan: planName,
        settings: { itbis_pct: 18, ley_pct: 10, language: 'es', facturacion_mode: ['pro_plus', 'pro_max'].includes(planName) ? 'ecf' : 'b_series' },
      }).select('id').single()
      if (bizErr) throw bizErr
      await auth.supabase.from('staff').insert({
        business_id: biz.id, auth_user_id: userId, name: business_name.trim(),
        username: 'owner', role: 'owner', active: true,
      })
      const licenseKey = (plat === 'desktop' || plat === 'both') ? generateKey() : null
      await auth.supabase.from('licenses').insert({
        business_id: biz.id, plan_id: planRow?.id || null, license_key: licenseKey, status: 'active',
        platform: plat, activated_at: new Date().toISOString(), max_users: planRow?.max_users || 3,
      })
      const ncfTypes = ['B01', 'B02', 'B14', 'B15', 'E31', 'E32', 'E33', 'E34']
      for (const type of ncfTypes) {
        await auth.supabase.from('ncf_sequences').upsert({
          business_id: biz.id, type, prefix: type, next_number: 1, max_number: 999999999,
        }, { onConflict: 'business_id,type', ignoreDuplicates: true })
      }
      return res.json({ data: { business_id: biz.id, email, license_key: licenseKey } })
    } catch (err) { return res.status(500).json({ error: err.message }) }
  }
  if (req.method === 'PATCH' && req.body?.action === 'update_plan') {
    const auth = await requireAdmin(req, 'admin')
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    const { id, plan } = req.body || {}
    if (!id || !plan) return res.status(400).json({ error: 'id and plan required' })
    try {
      const { data: planRow } = await auth.supabase.from('plans').select('id, max_users').eq('name', plan).maybeSingle()
      await auth.supabase.from('businesses').update({ plan, updated_at: new Date().toISOString() }).eq('id', id)
      if (planRow) {
        await auth.supabase.from('licenses').update({ plan_id: planRow.id, max_users: planRow.max_users, updated_at: new Date().toISOString() }).eq('business_id', id)
      }
      return res.json({ ok: true })
    } catch (err) { return res.status(500).json({ error: err.message }) }
  }
  if (req.method === 'DELETE' || (req.method === 'PATCH' && req.body?.action === 'delete')) {
    const auth = await requireAdmin(req, 'admin')
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    const { id } = req.body || {}
    if (!id) return res.status(400).json({ error: 'id required' })
    try {
      await auth.supabase.from('licenses').delete().eq('business_id', id)
      await auth.supabase.from('staff').delete().eq('business_id', id)
      await auth.supabase.from('businesses').delete().eq('id', id)
      return res.json({ ok: true })
    } catch (err) { return res.status(500).json({ error: err.message }) }
  }
  return res.status(405).json({ error: 'Method not allowed' })
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

async function handlePushService(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req, 'admin')
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { business_id, name, name_en, price, is_wash, aplica_itbis } = req.body || {}
  if (!business_id || !name) return res.status(400).json({ error: 'business_id and name required' })
  try {
    await auth.supabase.from('services').insert({ business_id, name, name_en: name_en || '', price: price || 0, is_wash: is_wash ?? false, aplica_itbis: aplica_itbis ?? true, active: true })
    return res.json({ ok: true })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleClientConfig(req, res) {
  if (req.method === 'GET') {
    const auth = await requireAdmin(req)
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    const id = req.query.id
    if (!id) return res.status(400).json({ error: 'id required' })
    try {
      const [{ data: biz }, { data: cfgRows }] = await Promise.all([
        auth.supabase.from('businesses').select('settings, notes').eq('id', id).single(),
        auth.supabase.from('app_settings').select('key, value').eq('business_id', id),
      ])
      const appSettings = Object.fromEntries((cfgRows || []).map(r => [r.key, r.value]))
      return res.json({ data: { bizSettings: biz?.settings || {}, appSettings, notes: biz?.notes || '' } })
    } catch (err) { return res.status(500).json({ error: err.message }) }
  }
  if (req.method === 'PATCH') {
    const auth = await requireAdmin(req, 'admin')
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    const { id, bizSettings, appSettings, notes } = req.body || {}
    if (!id) return res.status(400).json({ error: 'id required' })
    try {
      if (bizSettings) {
        const { data: current } = await auth.supabase.from('businesses').select('settings').eq('id', id).single()
        const merged = { ...(current?.settings || {}), ...bizSettings }
        await auth.supabase.from('businesses').update({ settings: merged, updated_at: new Date().toISOString() }).eq('id', id)
      }
      if (appSettings) {
        for (const [key, value] of Object.entries(appSettings)) {
          await auth.supabase.from('app_settings').upsert({ business_id: id, key, value: String(value) }, { onConflict: 'business_id,key' })
        }
      }
      if (notes !== undefined) {
        await auth.supabase.from('businesses').update({ notes, updated_at: new Date().toISOString() }).eq('id', id)
      }
      return res.json({ ok: true })
    } catch (err) { return res.status(500).json({ error: err.message }) }
  }
  return res.status(405).json({ error: 'Method not allowed' })
}

const registerRateMap = new Map()
async function handleRegister(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown'
  const now = Date.now()
  const entry = registerRateMap.get(ip)
  if (entry && now - entry.start < 3600000 && entry.count >= 5) return res.status(429).json({ error: 'Too many registrations' })
  if (!entry || now - entry.start > 3600000) registerRateMap.set(ip, { start: now, count: 1 }); else entry.count++
  const { business_name, rnc, phone, email, address, hwid, language } = req.body || {}
  if (!business_name || !hwid) return res.status(400).json({ error: 'business_name and hwid required' })
  if (typeof hwid !== 'string' || !/^[a-f0-9]{16,64}$/i.test(hwid)) return res.status(400).json({ error: 'Invalid hardware ID' })
  try {
    const supabase = getClient()
    // Prevent duplicate registrations from same machine
    const { data: existing } = await supabase.from('licenses').select('id, business_id').eq('hardware_id', hwid).maybeSingle()
    if (existing) return res.json({ data: { business_id: existing.business_id, already_registered: true } })
    const { data: biz, error: bizErr } = await supabase.from('businesses').insert({
      name: business_name.trim(), rnc: (rnc || '').trim(), phone: (phone || '').trim(), email: (email || '').trim(), address: (address || '').trim(),
      plan: 'pro', settings: { itbis_pct: 18, ley_pct: 10, language: language || 'es', facturacion_mode: 'b_series' },
    }).select('id').single()
    if (bizErr) throw bizErr
    const key = generateKey()
    await supabase.from('licenses').insert({
      business_id: biz.id, license_key: key, hardware_id: hwid,
      status: 'pending', platform: 'desktop', max_users: 3,
    })
    const ncfTypes = ['B01', 'B02', 'B14', 'B15', 'E31', 'E32', 'E33', 'E34']
    for (const type of ncfTypes) {
      await supabase.from('ncf_sequences').upsert({
        business_id: biz.id, type, prefix: type, next_number: 1, max_number: 999999999,
      }, { onConflict: 'business_id,type', ignoreDuplicates: true })
    }
    return res.json({ data: { business_id: biz.id, license_key: key } })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleClientDetail(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const id = req.query.id
  if (!id) return res.status(400).json({ error: 'id required' })
  try {
    const [bizRes, licRes, staffRes, svcRes, clientRes, ticketRes, configRes] = await Promise.all([
      auth.supabase.from('businesses').select('*').eq('id', id).single(),
      auth.supabase.from('licenses').select('*, plans(name, display_name)').eq('business_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      auth.supabase.from('staff').select('id, name, username, role, auth_user_id, active, created_at').eq('business_id', id).order('created_at'),
      auth.supabase.from('services').select('id', { count: 'exact', head: true }).eq('business_id', id).eq('active', true),
      auth.supabase.from('clients').select('id', { count: 'exact', head: true }).eq('business_id', id).eq('active', true),
      auth.supabase.from('tickets').select('id, total, status, created_at').eq('business_id', id).neq('status', 'nula').order('created_at', { ascending: false }).limit(1000),
      auth.supabase.from('configuracion').select('valor').eq('business_id', id).eq('clave', 'setup_complete').maybeSingle(),
    ])
    if (bizRes.error) throw bizRes.error
    const biz = bizRes.data
    const staff = staffRes.data || []
    const tickets = ticketRes.data || []
    const serviceCount = svcRes.count || 0
    const clientCount = clientRes.count || 0
    const ticketCount = tickets.length
    const totalRevenue = tickets.reduce((sum, t) => sum + (parseFloat(t.total) || 0), 0)
    const lastSaleDate = tickets[0]?.created_at || null
    const onboarding = {
      business_info: !!(biz.name && biz.rnc),
      logo: !!biz.logo_url,
      owner_linked: staff.some(s => s.role === 'owner' && s.auth_user_id),
      first_service: serviceCount > 0,
      first_client: clientCount > 0,
      first_sale: ticketCount > 0,
      fiscal_configured: !!(biz.settings?.facturacion_mode),
      setup_complete: configRes.data?.valor === '1',
    }
    // Strip non-primitive fields to prevent React #310
    const bizSafe = {
      id: biz.id, name: biz.name || '', rnc: biz.rnc || '', phone: biz.phone || '',
      email: biz.email || '', address: biz.address || '', plan: biz.plan || '',
      logo_url: biz.logo_url || null, owner_id: biz.owner_id || null,
      created_at: biz.created_at,
    }
    const licSafe = licRes.data ? {
      ...licRes.data,
      plans: licRes.data.plans || null,
    } : null
    return res.json({
      business: bizSafe, license: licSafe, staff, onboarding,
      metrics: { ticketCount, totalRevenue, lastSaleDate, serviceCount, clientCount },
    })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleUpdateBusiness(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { id, name, rnc, phone, email, address } = req.body || {}
  if (!id) return res.status(400).json({ error: 'id required' })
  const patch = {}
  if (name !== undefined) patch.name = name.trim()
  if (rnc !== undefined) patch.rnc = rnc.trim()
  if (phone !== undefined) patch.phone = phone.trim()
  if (email !== undefined) patch.email = email.trim()
  if (address !== undefined) patch.address = address.trim()
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No fields to update' })
  try {
    const { error } = await auth.supabase.from('businesses').update(patch).eq('id', id)
    if (error) throw error
    return res.json({ ok: true })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleLinkWebAccount(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { business_id, email, password } = req.body || {}
  if (!business_id || !email || !password) return res.status(400).json({ error: 'business_id, email, and password required' })
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' })
  try {
    // Check business exists and has no owner yet
    const { data: biz } = await auth.supabase.from('businesses').select('id, owner_id, name').eq('id', business_id).single()
    if (!biz) return res.status(404).json({ error: 'Business not found' })
    if (biz.owner_id) return res.status(409).json({ error: 'Business already has a linked account' })
    // Create Supabase auth user (admin API)
    const { data: authData, error: authErr } = await auth.supabase.auth.admin.createUser({
      email: email.trim(),
      password,
      email_confirm: true,
    })
    if (authErr) throw authErr
    const userId = authData.user?.id
    if (!userId) throw new Error('Failed to create auth user')
    // Link business to auth user
    await auth.supabase.from('businesses').update({ owner_id: userId, email: email.trim() }).eq('id', business_id)
    // Create staff row for web access
    await auth.supabase.from('staff').upsert({
      business_id, auth_user_id: userId, name: biz.name,
      username: 'owner', role: 'owner', active: true,
    }, { onConflict: 'business_id,auth_user_id', ignoreDuplicates: true })
    return res.json({ ok: true, user_id: userId })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleActivityFeed(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  try {
    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString()
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 86400000).toISOString()
    const [signupsRes, expiringRes, eventsRes, bizTicketsRes] = await Promise.all([
      auth.supabase.from('businesses').select('id, name, created_at').order('created_at', { ascending: false }).limit(10),
      auth.supabase.from('licenses').select('id, business_id, expires_at, businesses!business_id(name)').eq('status', 'active').lte('expires_at', sevenDaysFromNow).gte('expires_at', now.toISOString()),
      auth.supabase.from('license_events').select('action, status, created_at, licenses!license_id(business_id, businesses!business_id(name))').order('created_at', { ascending: false }).limit(30),
      auth.supabase.from('businesses').select('id, name, created_at').order('created_at'),
    ])
    // Also get ticket counts and latest ticket per business for first-sale and inactive detection
    const allBids = (bizTicketsRes.data || []).map(b => b.id)
    let ticketAgg = []
    if (allBids.length) {
      const { data } = await auth.supabase.from('tickets').select('business_id, created_at').in('business_id', allBids).order('created_at', { ascending: false })
      ticketAgg = data || []
    }
    // Group tickets by business
    const ticketsByBiz = {}
    for (const t of ticketAgg) {
      if (!ticketsByBiz[t.business_id]) ticketsByBiz[t.business_id] = { count: 0, latest: t.created_at }
      ticketsByBiz[t.business_id].count++
    }

    const feed = []
    // Recent signups
    for (const b of (signupsRes.data || [])) {
      feed.push({ type: 'signup', business_id: b.id, business_name: b.name, date: b.created_at, detail: null })
    }
    // Expiring licenses
    for (const l of (expiringRes.data || [])) {
      const days = Math.ceil((new Date(l.expires_at) - now) / 86400000)
      feed.push({ type: 'expiring', business_id: l.business_id, business_name: l.businesses?.name || '?', date: l.expires_at, detail: `${days}d` })
    }
    // First sale milestones (businesses with exactly 1 ticket created in last 7 days)
    for (const b of (bizTicketsRes.data || [])) {
      const info = ticketsByBiz[b.id]
      if (info && info.count === 1 && info.latest >= sevenDaysAgo) {
        feed.push({ type: 'first_sale', business_id: b.id, business_name: b.name, date: info.latest, detail: null })
      }
    }
    // Inactive (created > 7 days ago, no tickets or last ticket > 7 days ago)
    for (const b of (bizTicketsRes.data || [])) {
      if (b.created_at > sevenDaysAgo) continue // too new
      const info = ticketsByBiz[b.id]
      if (!info || info.latest < sevenDaysAgo) {
        feed.push({ type: 'inactive', business_id: b.id, business_name: b.name, date: info?.latest || b.created_at, detail: null })
      }
    }
    // License events (suspend/activate)
    for (const e of (eventsRes.data || [])) {
      if (e.action === 'validate') continue
      feed.push({ type: e.action === 'suspend' ? 'suspended' : 'activated', business_id: e.licenses?.business_id, business_name: e.licenses?.businesses?.name || '?', date: e.created_at, detail: null })
    }
    // Sort by date desc, limit 30
    feed.sort((a, b) => new Date(b.date) - new Date(a.date))
    return res.json({ data: feed.slice(0, 30) })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

// ── e-CF Certification Service Handlers ──────────────────────────────────────

async function handleCertStats(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase } = auth
  try {
    const { data: certs } = await supabase.from('ecf_certifications').select('id, status, package_tier, price, amount_paid, payment_status')
    const active = (certs || []).filter(c => c.status === 'active').length
    const completed = (certs || []).filter(c => c.status === 'completed').length
    const paused = (certs || []).filter(c => c.status === 'paused').length
    const totalRevenue = (certs || []).reduce((s, c) => s + Number(c.amount_paid || 0), 0)
    const pendingRevenue = (certs || []).reduce((s, c) => s + (Number(c.price || 0) - Number(c.amount_paid || 0)), 0)
    const byTier = { advisory: 0, full: 0, full_plus_terminal: 0 }
    for (const c of (certs || [])) byTier[c.package_tier] = (byTier[c.package_tier] || 0) + 1
    return res.json({ active, completed, paused, total: (certs || []).length, totalRevenue, pendingRevenue, byTier })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleCertList(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase } = auth
  try {
    const { data, error } = await supabase.from('ecf_certifications')
      .select('id, business_name, rnc, contact_name, contact_phone, contact_email, package_tier, price, payment_status, amount_paid, current_step, steps_completed, status, started_at, completed_at, created_at')
      .order('created_at', { ascending: false })
    if (error) throw error
    return res.json({ data: data || [] })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleCertDetail(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase } = auth
  const id = req.query.id
  if (!id) return res.status(400).json({ error: 'Missing id' })
  try {
    const [certRes, notesRes, docsRes] = await Promise.all([
      supabase.from('ecf_certifications').select('*').eq('id', id).maybeSingle(),
      supabase.from('ecf_cert_notes').select('*').eq('certification_id', id).order('created_at', { ascending: false }).limit(50),
      supabase.from('ecf_cert_documents').select('*').eq('certification_id', id).order('uploaded_at', { ascending: false }),
    ])
    if (certRes.error) throw certRes.error
    if (!certRes.data) return res.status(404).json({ error: 'Certification not found' })
    return res.json({ certification: certRes.data, notes: notesRes.data || [], documents: docsRes.data || [] })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleCertCreate(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req, 'admin')
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase, admin } = auth
  const b = req.body || {}
  if (!b.business_name || !b.rnc || !b.contact_name) return res.status(400).json({ error: 'business_name, rnc, and contact_name are required' })
  const tierPrices = { advisory: 15000, full: 45000, full_plus_terminal: 55000 }
  const tier = b.package_tier || 'full'
  try {
    const { data, error } = await supabase.from('ecf_certifications').insert({
      business_name: b.business_name, rnc: b.rnc.replace(/\D/g, ''), nombre_comercial: b.nombre_comercial || null,
      contact_name: b.contact_name, contact_phone: b.contact_phone || null, contact_email: b.contact_email || null,
      address: b.address || null, municipio: b.municipio || null, provincia: b.provincia || null,
      package_tier: tier, price: tierPrices[tier] || 45000, status: 'active', current_step: 1, started_at: new Date().toISOString(),
    }).select().single()
    if (error) throw error
    await supabase.from('ecf_cert_notes').insert({ certification_id: data.id, author_name: admin.name, type: 'system', content: `Certificacion creada — paquete ${tier}`, visible_to_client: true })
    return res.json({ data })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleCertUpdate(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req, 'admin')
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase } = auth
  const { id, ...patch } = req.body || {}
  if (!id) return res.status(400).json({ error: 'Missing id' })
  const allowed = ['business_name', 'rnc', 'nombre_comercial', 'contact_name', 'contact_phone', 'contact_email', 'address', 'municipio', 'provincia', 'cert_p12_path', 'cert_pem_key', 'cert_pem_cert', 'cert_password', 'package_tier', 'price', 'payment_status', 'amount_paid', 'status', 'receiver_domain', 'receiver_vps', 'ecf_config']
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(clean).length) return res.status(400).json({ error: 'No valid fields to update' })
  clean.updated_at = new Date().toISOString()
  if (clean.status === 'completed') clean.completed_at = new Date().toISOString()
  try {
    const { data, error } = await supabase.from('ecf_certifications').update(clean).eq('id', id).select().single()
    if (error) throw error
    return res.json({ data })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleCertStep(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req, 'admin')
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase, admin } = auth
  const { id, step, action: stepAction, note } = req.body || {}
  if (!id || !step) return res.status(400).json({ error: 'Missing id or step' })
  try {
    const { data: cert, error } = await supabase.from('ecf_certifications').select('steps_completed, current_step').eq('id', id).single()
    if (error) throw error
    let steps = Array.isArray(cert.steps_completed) ? [...cert.steps_completed] : []
    if (stepAction === 'complete' && !steps.includes(step)) steps.push(step)
    if (stepAction === 'uncomplete') steps = steps.filter(s => s !== step)
    steps.sort((a, b) => a - b)
    const newCurrent = Math.max(step, cert.current_step)
    const update = { steps_completed: steps, current_step: newCurrent, updated_at: new Date().toISOString() }
    if (steps.length === 15) { update.status = 'completed'; update.completed_at = new Date().toISOString() }
    await supabase.from('ecf_certifications').update(update).eq('id', id)
    const STEP_NAMES = ['', 'Solicitud', 'Autorizacion', 'Configuracion', 'Pruebas Simulacion', 'Representacion Impresa', 'Revision DGII', 'URL Servicios Prueba', 'Inicio Prueba Recepcion', 'Recepcion e-CF', 'Inicio Prueba Aprobacion', 'Aprobacion Comercial', 'URL Servicios Produccion', 'Declaracion Jurada', 'Verificacion Estatus', 'Finalizado']
    await supabase.from('ecf_cert_notes').insert({ certification_id: id, author_name: admin.name, type: 'step_change', content: note || `Paso ${step} (${STEP_NAMES[step] || '?'}) ${stepAction === 'complete' ? 'completado' : 'desmarcado'}`, metadata: { step, action: stepAction }, visible_to_client: true })
    return res.json({ ok: true, steps_completed: steps, current_step: newCurrent })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleCertNotes(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase, admin } = auth
  if (req.method === 'GET') {
    const id = req.query.id
    if (!id) return res.status(400).json({ error: 'Missing id' })
    const { data, error } = await supabase.from('ecf_cert_notes').select('*').eq('certification_id', id).order('created_at', { ascending: false }).limit(100)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ data: data || [] })
  }
  if (req.method === 'POST') {
    const { id, content, type, visible_to_client } = req.body || {}
    if (!id || !content) return res.status(400).json({ error: 'Missing id or content' })
    const { data, error } = await supabase.from('ecf_cert_notes').insert({ certification_id: id, author_name: admin.name, author_id: admin.id, type: type || 'note', content, visible_to_client: visible_to_client || false }).select().single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ data })
  }
  return res.status(405).json({ error: 'Method not allowed' })
}

async function handleCertDocs(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase } = auth
  if (req.method === 'GET') {
    const id = req.query.id
    if (!id) return res.status(400).json({ error: 'Missing id' })
    const { data, error } = await supabase.from('ecf_cert_documents').select('*').eq('certification_id', id).order('uploaded_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ data: data || [] })
  }
  if (req.method === 'POST') {
    const { id, name, file_path, file_type, step, visible_to_client } = req.body || {}
    if (!id || !name || !file_path || !file_type) return res.status(400).json({ error: 'Missing required fields' })
    const { data, error } = await supabase.from('ecf_cert_documents').insert({ certification_id: id, name, file_path, file_type, step: step || null, visible_to_client: visible_to_client || false }).select().single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ data })
  }
  return res.status(405).json({ error: 'Method not allowed' })
}
