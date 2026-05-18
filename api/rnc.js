import { withReporting } from '../lib/report-server-error.js'

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { rnc } = req.body || {}
  const clean = (rnc || '').replace(/[\s-]/g, '')

  if (!/^\d{9,11}$/.test(clean)) {
    return res.status(400).json({ error: 'Invalid RNC format' })
  }

  try {
    const resp = await fetch(`https://rnc.megaplus.com.do/api/consulta?rnc=${clean}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    })

    if (!resp.ok) {
      return res.status(404).json({ error: 'RNC not found' })
    }

    const data = await resp.json()
    const name = data.nombre_razon_social || data.nombre || data.name || ''
    const status = data.estado || 'ACTIVO'

    if (!name) {
      return res.status(404).json({ error: 'RNC not found' })
    }

    return res.status(200).json({ rnc: clean, name, status })
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Lookup failed' })
  }
}

export default withReporting(handler, { route: '/api/rnc' })
