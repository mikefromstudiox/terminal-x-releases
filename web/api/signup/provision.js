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

  const { business_name, rnc, phone, plan, business_type, utm_source, utm_medium, utm_campaign } = req.body || {}
  if (!business_name || !business_name.trim()) return res.status(400).json({ error: 'Business name required' })

  try {
    const { data: existing } = await supabase.from('businesses').select('id').eq('owner_id', user.id).maybeSingle()
    if (existing) return res.status(409).json({ error: 'Business already exists', business_id: existing.id })

    // All signups get 7-day free trial on Pro MAX
    const trialPlan = 'pro_max'
    const trialDays = 7
    const trialEnd = new Date(Date.now() + trialDays * 86400000).toISOString()
    const validPlans = ['pro', 'pro_plus', 'pro_max', 'facturacion']
    const requestedPlan = validPlans.includes(plan) ? plan : 'pro'

    const { data: planRow } = await supabase.from('plans').select('id, name, max_users').eq('name', trialPlan).maybeSingle()

    const bizType = (business_type || '').trim() || null
    const { data: biz, error: bizErr } = await supabase.from('businesses').insert({
      owner_id: user.id, name: business_name.trim(), rnc: (rnc || '').trim(),
      phone: (phone || '').trim(), plan: trialPlan, is_demo: false,
      settings: {
        itbis_pct: 18, ley_pct: 10, language: 'es', facturacion_mode: 'ecf',
        trial_end: trialEnd, requested_plan: requestedPlan,
        ...(bizType ? { business_type: bizType, biz_type: bizType, biz_business_type: bizType } : {}),
      },
    }).select('id').single()
    if (bizErr) throw bizErr

    await supabase.from('staff').insert({
      business_id: biz.id, auth_user_id: user.id, name: business_name.trim(),
      username: 'owner', role: 'owner', active: true,
    })

    const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    const seg = () => Array.from({ length: 4 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('')
    const licenseKey = 'TXL-' + seg() + '-' + seg() + '-' + seg()

    await supabase.from('licenses').insert({
      business_id: biz.id, plan_id: planRow?.id || null, license_key: licenseKey, status: 'active',
      platform: 'web', activated_at: new Date().toISOString(), max_users: planRow?.max_users || 999,
      expires_at: trialEnd, trial_end: trialEnd,
    })

    // NCF set: contabilidad clients only need E-series (e-CF). POS verticals
    // also get B01/B02 (legacy paper) + B14/B15 (gov/special) for fallback.
    const ncfTypes = bizType === 'contabilidad'
      ? ['E31', 'E32', 'E33', 'E34']
      : ['B01', 'B02', 'B14', 'B15', 'E31', 'E32', 'E33', 'E34']
    for (const type of ncfTypes) {
      const { error: ncfErr } = await supabase.from('ncf_sequences').upsert({
        business_id: biz.id, type, prefix: type, next_number: 1, max_number: 999999999,
      }, { onConflict: 'business_id,type', ignoreDuplicates: true })
      if (ncfErr && !ncfErr.message?.includes('duplicate')) throw ncfErr
    }

    // Seed business_type into app_settings KV so useBusinessType()
    // resolves correctly on first launch (it reads app_settings before
    // falling back to businesses.settings JSON).
    if (bizType) {
      try {
        await supabase.from('app_settings').upsert({
          business_id: biz.id, key: 'business_type', value: bizType, device_hwid: null,
          is_device_local: false, supabase_id: crypto.randomUUID(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'business_id,key,device_hwid' })
      } catch (_) { /* non-fatal */ }
    }

    // Seed sync engine feature flags so every new business gets the modern
    // sync path from day one. sync_use_merge_v17 collapses N per-cycle
    // PostgREST GETs into 1 RPC; was opt-in until 2026-04-29 when verified
    // safe under load. New signups inherit it ON.
    try {
      await supabase.from('app_settings').upsert({
        business_id: biz.id, key: 'sync_use_merge_v17', value: '1', device_hwid: null,
        is_device_local: false, supabase_id: crypto.randomUUID(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'business_id,key,device_hwid' })
    } catch (_) { /* non-fatal */ }

    // CRM lead row — non-fatal. Admin panel uses this for sales follow-up.
    // If an anonymous lead with the same email already exists (created on
    // step 1 of the signup form), promote it to this business_id instead of
    // creating a duplicate row.
    try {
      const leadEmail = (user.email || '').toLowerCase()
      const leadPayload = {
        business_id: biz.id,
        email: user.email || null,
        phone: (phone || '').trim() || null,
        contact_name: business_name.trim(),
        business_name: business_name.trim(),
        rnc: (rnc || '').trim() || null,
        requested_plan: requestedPlan,
        business_type: business_type || null,
        utm_source: utm_source || null,
        utm_medium: utm_medium || null,
        utm_campaign: utm_campaign || null,
        source: 'signup',
        status: 'new',
      }
      let promoted = false
      if (leadEmail) {
        const { data: existingLead } = await supabase
          .from('crm_leads')
          .select('id')
          .is('business_id', null)
          .ilike('email', leadEmail)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (existingLead?.id) {
          await supabase.from('crm_leads').update(leadPayload).eq('id', existingLead.id)
          promoted = true
        }
      }
      if (!promoted) {
        await supabase.from('crm_leads').upsert(leadPayload, { onConflict: 'business_id' })
      }
    } catch (_) { /* non-fatal — provisioning succeeds even if CRM insert fails */ }

    return res.json({ ok: true, business_id: biz.id })
  } catch (err) {
    return res.status(500).json({ error: 'Provisioning failed' })
  }
}
