require('dotenv').config()
const express  = require('express')
const cors     = require('cors')
const path     = require('path')
const db       = require('./db')

const app       = express()
const PORT      = process.env.PORT      || 3000
const ADMIN_KEY = process.env.ADMIN_KEY || 'changeme-set-in-env'
const GRACE_DAYS = 3

app.use(cors())
app.use(express.json())

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ ok: true, service: 'Terminal X License Server' }))

// ── Admin dashboard (static HTML) ────────────────────────────────────────────
app.get('/admin', (_, res) => res.sendFile(path.join(__dirname, 'admin.html')))

// ── Admin auth middleware ─────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

// ── POST /api/validate ────────────────────────────────────────────────────────
// Validates a license key. Binds hardware ID on first use.
app.post('/api/validate', (req, res) => {
  try {
    const { key, rnc, hwid } = req.body || {}
    if (!key || !hwid) {
      return res.status(400).json({ valid: false, status: 'invalid_request' })
    }

    const license = db.getLicenseByKey(key)
    if (!license) return res.json({ valid: false, status: 'not_found' })

    // Optional RNC verification (normalize: digits only)
    if (rnc) {
      const normalizeRnc = s => (s || '').replace(/\D/g, '')
      if (normalizeRnc(license.business_rnc) !== normalizeRnc(rnc)) {
        return res.json({ valid: false, status: 'rnc_mismatch' })
      }
    }

    if (license.status === 'inactive') {
      return res.json({ valid: false, status: 'inactive', businessName: license.business_name })
    }
    if (license.status === 'suspended') {
      return res.json({ valid: false, status: 'suspended', businessName: license.business_name })
    }

    // Hardware binding check
    if (license.hardware_id && license.hardware_id !== hwid) {
      return res.json({ valid: false, status: 'hardware_mismatch', businessName: license.business_name })
    }

    // First activation: bind hwid
    if (!license.hardware_id) {
      db.updateLicense(license.id, {
        hardware_id:  hwid,
        activated_at: new Date().toISOString(),
        status:       'active',
      })
    }

    // Update last seen
    db.updateLicense(license.id, { last_seen: new Date().toISOString() })

    // Compute expiry
    const expiresAt = license.expires_at ? new Date(license.expires_at) : null
    const now       = new Date()
    let status      = license.status === 'pending' ? 'active' : license.status
    let valid       = true
    let readOnly    = false
    let warning     = false
    let warningMsg  = null
    let daysUntilExpiry = null

    if (expiresAt) {
      const diffDays = Math.floor((expiresAt - now) / 86400000)
      daysUntilExpiry = diffDays

      if (diffDays < -GRACE_DAYS) {
        status   = 'expired'
        valid    = false
        readOnly = true
      } else if (diffDays < 0) {
        status     = 'grace'
        warning    = true
        warningMsg = `Licencia vencida hace ${-diffDays} día(s). Período de gracia: ${GRACE_DAYS + diffDays} día(s) restantes.`
      } else if (diffDays <= 30) {
        warning    = true
        warningMsg = `Tu licencia vence en ${diffDays} días. Renueva pronto.`
      }
    }

    return res.json({
      valid,
      readOnly,
      status,
      warning,
      warningMsg,
      daysUntilExpiry,
      daysExpired:  (status === 'expired' && daysUntilExpiry !== null) ? -daysUntilExpiry : undefined,
      businessName: license.business_name,
      businessRnc:  license.business_rnc,
      plan:         license.plan,
      expiresAt:    license.expires_at,
      activatedAt:  license.activated_at,
      maxUsers:     license.max_users,
    })
  } catch (err) {
    console.error('[POST /api/validate]', err)
    res.status(500).json({ valid: false, status: 'server_error' })
  }
})

// ── GET /api/licenses (admin) ────────────────────────────────────────────────
app.get('/api/licenses', requireAdmin, (req, res) => {
  try {
    res.json({ data: db.getAllLicenses() })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/licenses (admin) ───────────────────────────────────────────────
app.post('/api/licenses', requireAdmin, (req, res) => {
  try {
    const { business_name, business_rnc, plan, months, max_users, notes } = req.body
    if (!business_name || !business_rnc) {
      return res.status(400).json({ error: 'business_name and business_rnc are required' })
    }
    const expires_at = months
      ? new Date(Date.now() + Number(months) * 30 * 86400000).toISOString()
      : null
    const license = db.createLicense({ business_name, business_rnc, plan, expires_at, max_users, notes })
    res.json({ data: license })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── PATCH /api/licenses/:id (admin) ─────────────────────────────────────────
app.patch('/api/licenses/:id', requireAdmin, (req, res) => {
  try {
    db.updateLicense(req.params.id, req.body)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── DELETE /api/licenses/:id (admin) ────────────────────────────────────────
app.delete('/api/licenses/:id', requireAdmin, (req, res) => {
  try {
    db.deleteLicense(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Start ─────────────────────────────────────────────────────────────────────
db.init()
app.listen(PORT, () => {
  console.log(`Terminal X License Server running on port ${PORT}`)
  console.log(`Admin dashboard: http://localhost:${PORT}/admin`)
})
