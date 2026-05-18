// Server-side error reporter — writes to client_errors via service-role client.
// Mirrors /api/panel?action=report_error but for backend crashes.
import { createClient } from '@supabase/supabase-js'

const _recent = new Set()
let _sb = null
function sb() {
  if (_sb) return _sb
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  _sb = createClient(url, key, { auth: { persistSession: false } })
  return _sb
}

export async function reportServerError(err, { route, action, businessId = null, severity = 'error', extra = null } = {}) {
  try {
    const message = String((err && err.message) || err || 'unknown error')
    const sig = (route || '') + ':' + (action || '') + ':' + message.slice(0, 200)
    if (_recent.has(sig)) return
    _recent.add(sig)
    setTimeout(() => _recent.delete(sig), 60000)
    const client = sb()
    if (!client) return
    await client.from('client_errors').insert({
      business_id: businessId,
      message, stack: (err && err.stack) || null,
      route: route || null, severity,
      metadata: { platform: 'api', action: action || null, ...(extra || {}) },
    })
  } catch {}
}

// Wrap a route-level handler so any uncaught throw is reported and returned 500.
export function withReporting(handler, { route }) {
  return async (req, res) => {
    try { return await handler(req, res) }
    catch (err) {
      const action = (req.query && req.query.action) || null
      const businessId = (req.body && req.body.business_id) || (req.headers && req.headers['x-business-id']) || null
      await reportServerError(err, { route, action, businessId })
      if (!res.headersSent) res.status(500).json({ error: err.message || 'server error' })
    }
  }
}
