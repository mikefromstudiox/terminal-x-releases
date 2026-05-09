import { createClient } from '@supabase/supabase-js'
import { withReporting } from '../../lib/report-server-error.js'

const ALLOWED_ORIGINS = ['https://terminalxpos.com', 'http://localhost:5173']

function getClient() {
  return createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

function isValidEmail(s) {
  if (typeof s !== 'string') return false
  const v = s.trim()
  if (v.length < 5 || v.length > 254) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

async function handler(req, res) {
  const origin = req.headers.origin || ''
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0])
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { email, business_name, rnc, phone, plan, business_type, utm_source, utm_medium, utm_campaign } = req.body || {}
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email' })

  const supabase = getClient()
  const emailNorm = String(email).trim().toLowerCase()

  try {
    const { data: existing } = await supabase
      .from('crm_leads')
      .select('id')
      .is('business_id', null)
      .ilike('email', emailNorm)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const payload = {
      email: emailNorm,
      phone: (phone || '').trim() || null,
      contact_name: (business_name || '').trim() || null,
      business_name: (business_name || '').trim() || null,
      rnc: (rnc || '').trim() || null,
      requested_plan: plan || null,
      business_type: business_type || null,
      utm_source: utm_source || null,
      utm_medium: utm_medium || null,
      utm_campaign: utm_campaign || null,
      source: 'signup',
      status: 'new',
    }

    if (existing?.id) {
      await supabase.from('crm_leads').update(payload).eq('id', existing.id)
      return res.json({ ok: true, lead_id: existing.id, mode: 'updated' })
    }

    const { data: row, error: insErr } = await supabase
      .from('crm_leads')
      .insert(payload)
      .select('id')
      .single()
    if (insErr) throw insErr
    return res.json({ ok: true, lead_id: row.id, mode: 'created' })
  } catch (err) {
    console.error('[signup/lead]', err?.message, err?.stack)
    try { (await import('../../lib/report-server-error.js')).reportServerError?.(err, { route: '/api/signup/lead' }) } catch {}
    return res.status(500).json({ error: 'Lead capture failed' })
  }
}

export default withReporting(handler, { route: '/api/signup/lead' })
