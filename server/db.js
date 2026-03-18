/**
 * db.js — Simple JSON file database for the Terminal X license server.
 * No native compilation required — works on any Node version.
 * For large deployments, swap this with a proper DB (Postgres, PlanetScale, etc.)
 */

const fs     = require('fs')
const path   = require('path')
const crypto = require('crypto')

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'licenses.json')

// ── Persistence helpers ───────────────────────────────────────────────────────

function read() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'))
  } catch {
    return { licenses: [] }
  }
}

function write(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8')
}

function init() {
  if (!fs.existsSync(DB_PATH)) write({ licenses: [] })
}

// ── CRUD operations ───────────────────────────────────────────────────────────

function generateKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const seg   = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  return `TXL-${seg()}-${seg()}-${seg()}`
}

function getLicenseByKey(key) {
  const { licenses } = read()
  return licenses.find(l => l.license_key === key.toUpperCase().trim()) || null
}

function getLicenseById(id) {
  const { licenses } = read()
  return licenses.find(l => l.id === id) || null
}

function getAllLicenses() {
  const { licenses } = read()
  return [...licenses].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
}

function createLicense(data) {
  const db      = read()
  const id      = crypto.randomUUID()
  const key     = (data.license_key || generateKey()).toUpperCase()
  const license = {
    id,
    license_key:   key,
    business_name: data.business_name,
    business_rnc:  data.business_rnc,
    hardware_id:   null,
    status:        'pending',
    plan:          data.plan       || 'standard',
    expires_at:    data.expires_at || null,
    activated_at:  null,
    last_seen:     null,
    created_at:    new Date().toISOString(),
    notes:         data.notes      || '',
    max_users:     data.max_users  || 10,
  }
  db.licenses.push(license)
  write(db)
  return license
}

function updateLicense(id, patch) {
  const ALLOWED = ['status','hardware_id','activated_at','expires_at','plan','notes','last_seen','max_users','business_name','business_rnc']
  const db = read()
  const idx = db.licenses.findIndex(l => l.id === id)
  if (idx === -1) return
  for (const key of Object.keys(patch)) {
    if (ALLOWED.includes(key)) db.licenses[idx][key] = patch[key]
  }
  write(db)
}

function deleteLicense(id) {
  updateLicense(id, { status: 'inactive', hardware_id: null })
}

module.exports = { init, generateKey, getLicenseByKey, getLicenseById, getAllLicenses, createLicense, updateLicense, deleteLicense }
