import { createClient } from '@supabase/supabase-js'

const ALLOWED_ORIGINS = ['https://terminalxpos.com', 'http://localhost:5173']

function getClient() {
  return createClient(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export default async function handler(req, res) {
  const origin = req.headers.origin || ''
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  } else {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0] || 'https://terminalxpos.com')
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabase = getClient()
  const token = (req.headers.authorization || '').replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'No token' })

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' })

  const { business_name, rnc, phone, plan } = req.body || {}
  if (!business_name || !business_name.trim()) return res.status(400).json({ error: 'Business name required' })

  try {
    const { data: existing } = await supabase.from('businesses').select('id').eq('owner_id', user.id).maybeSingle()
    if (existing) return res.status(409).json({ error: 'Business already exists', business_id: existing.id })

    // All signups get 7-day free trial on Pro MAX
    const trialPlan = 'pro_max'
    const trialDays = 7
    const trialEnd = new Date(Date.now() + trialDays * 86400000).toISOString()
    const requestedPlan = plan || 'pro'

    const { data: planRow } = await supabase.from('plans').select('id, name, max_users').eq('name', trialPlan).maybeSingle()

    const { data: biz, error: bizErr } = await supabase.from('businesses').insert({
      owner_id: user.id, name: business_name.trim(), rnc: (rnc || '').trim(),
      phone: (phone || '').trim(), plan: trialPlan,
      settings: { itbis_pct: 18, ley_pct: 10, language: 'es', facturacion_mode: 'ecf', trial_end: trialEnd, requested_plan: requestedPlan },
    }).select('id').single()
    if (bizErr) throw bizErr

    await supabase.from('staff').insert({
      business_id: biz.id, auth_user_id: user.id, name: business_name.trim(),
      username: 'owner', role: 'owner', active: true,
    })

    await supabase.from('licenses').insert({
      business_id: biz.id, plan_id: planRow?.id || null, status: 'active',
      platform: 'web', activated_at: new Date().toISOString(), max_users: planRow?.max_users || 999,
      expires_at: trialEnd,
    })

    const ncfTypes = ['B01', 'B02', 'B14', 'B15', 'E31', 'E32', 'E33', 'E34']
    for (const type of ncfTypes) {
      const { error: ncfErr } = await supabase.from('ncf_sequences').upsert({
        business_id: biz.id, type, prefix: type, next_number: 1, max_number: 999999999,
      }, { onConflict: 'business_id,type', ignoreDuplicates: true })
      if (ncfErr && !ncfErr.message?.includes('duplicate')) throw ncfErr
    }

    return res.json({ ok: true, business_id: biz.id })
  } catch (err) {
    return res.status(500).json({ error: 'Provisioning failed' })
  }
}
