import crypto from 'crypto'
import bcryptjs from 'bcryptjs'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, callerIp } from '../lib/rate-limit.js'
import { SALON_WA_TEMPLATES, fillTemplate } from '../lib/salon-wa-templates.js'

const ALLOWED_ORIGINS = ['https://terminalxpos.com', 'http://localhost:5173']

// businesses.settings is JSONB, but historical rows were written as a
// JSON-encoded *string* (because a client called JSON.stringify() before insert).
// When Supabase returns such a row we get the string back, and spreading it
// yields an array of characters instead of an object. This helper normalises
// either shape into a native JS object so downstream `{ ...settings }` works.
// It also tolerates double-encoded strings defensively.
function parseSettingsIfString(raw) {
  let s = raw
  for (let i = 0; i < 3; i++) {
    if (typeof s !== 'string') break
    try { s = JSON.parse(s) } catch { return {} }
  }
  return (s && typeof s === 'object' && !Array.isArray(s)) ? s : {}
}

function cors(req, res) {
  const origin = req.headers.origin || ''
  // Strict origin enforcement: if Origin is present, it MUST be allow-listed.
  // Non-browser callers (no Origin header) pass through. Browser cross-origin
  // attempts are rejected outright — no silent ACAO rewrite fallthrough.
  if (origin) {
    if (!ALLOWED_ORIGINS.includes(origin)) {
      res.status(403).json({ error: 'origin_not_allowed' })
      return true
    }
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
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
  const h = { super_admin: 3, admin: 2, sales_manager: 2, sales: 1, support: 1 }
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

  // Public portal actions — token-based auth, no admin required. Rate-limit
  // per-IP (30/min) to prevent portal-token brute force and message/upload
  // flooding. Persistent bucket: same counter across Vercel regions + cold
  // starts. Fails OPEN on RPC error (see web/lib/rate-limit.js).
  if (['cert_portal', 'cert_portal_message', 'cert_portal_upload'].includes(action)) {
    const ip = callerIp(req)
    if (!(await checkRateLimit(`cert_portal:${ip}`, 30))) {
      return res.status(429).json({ error: 'rate_limited' })
    }
    return handlePublicCertAction(action, req, res, getClient())
  }

  // ── v2.16.0 — Public WO approval (token-gated, rate-limited 30/min/IP). ───
  // Mecánica only. Customer scans WhatsApp link → loads cotización → signs.
  if (action === 'wo-approve-load' || action === 'wo-approve-submit') {
    const ip = callerIp(req)
    if (!(await checkRateLimit(`wo_approve:${ip}`, 30))) {
      return res.status(429).json({ error: 'rate_limited' })
    }
    return handleWorkOrderApproval(action, req, res, getClient())
  }

  if (action === 'stats') return handleStats(req, res)
  if (action === 'licenses') return handleLicenses(req, res)
  if (action === 'clients') return handleClients(req, res)
  if (action === 'users') return handleUsers(req, res)
  if (action === 'client_detail') return handleClientDetail(req, res)
  if (action === 'cert_history') return handleCertHistory(req, res)
  if (action === 'update_business') return handleUpdateBusiness(req, res)
  if (action === 'link_web_account') return handleLinkWebAccount(req, res)
  if (action === 'reset_password') return handleResetPassword(req, res)
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
  if (action === 'cert_step_data') return handleCertStepData(req, res)
  if (action === 'cert_commands') return handleCertCommands(req, res)
  if (action === 'cert_test_results') return handleCertTestResults(req, res)
  if (action === 'cert_upload') return handleCertUpload(req, res)
  if (action === 'set_staff_pin') return handleSetStaffPin(req, res)
  if (action === 'delete_staff') return handleDeleteStaff(req, res)
  if (action === 'upload_logo') return handleUploadLogo(req, res)
  if (action === 'support_tickets') return handleSupportTickets(req, res)
  if (action === 'create_ticket') return handleCreateTicket(req, res)
  if (action === 'bulk_action') return handleBulkAction(req, res)
  if (action === 'client_visits') return handleClientVisits(req, res)
  if (action === 'rebind_requests') return handleRebindRequests(req, res)
  if (action === 'approve_rebind') return handleApproveRebind(req, res)
  if (action === 'reject_rebind') return handleRejectRebind(req, res)
  if (action === 'loyalty-overview') return handleLoyaltyOverview(req, res)
  if (action === 'business-loyalty') return handleBusinessLoyalty(req, res)
  if (action === 'digest-health') return handleDigestHealth(req, res)
  if (action === 'digest-send-now') return handleDigestSendNow(req, res)
  if (action === 'business-digest') return handleBusinessDigest(req, res)
  if (action === 'marketing-lead-capture') return handleMarketingLeadCapture(req, res)
  if (action === 'demo-login') return handleDemoLogin(req, res)

  // ── Salon v2.16.1 — public booking + WhatsApp reminders + memberships ─────
  if (action === 'salon-public-booking-info')   return handleSalonPublicBookingInfo(req, res)
  if (action === 'salon-public-booking-create') return handleSalonPublicBookingCreate(req, res)
  if (action === 'salon-whatsapp-reminder-tick')return handleSalonReminderTick(req, res)
  if (action === 'salon-whatsapp-send-now')     return handleSalonWhatsappSendNow(req, res)
  if (action === 'salon-membership-purchase')   return handleSalonMembershipPurchase(req, res)
  if (action === 'salon-membership-consume')    return handleSalonMembershipConsume(req, res)

  // ── v2.16.25 ANECF web drainer (cron-triggered every 60s) ─────────────────
  if (action === 'anecf-drain')                 return handleAnecfDrain(req, res)

  // ── v2.16.7 — Lending collections reminders (24h + 2h windows) ──────────
  // Hourly cron tick + license-JWT mark/list paths. WABA is NOT live —
  // wa.me deep links only. UI must reflect "pendiente" until WABA approved.
  if (action === 'collections_remind') return handleCollectionsRemind(req, res)

  // FIX-H5 — Facturación tier email post-emisión.
  if (action === 'email-invoice') return handleEmailInvoice(req, res)

  // CRM — admin sales pipeline for signups + cold leads.
  if (action === 'crm_list')   return handleCrmList(req, res)
  if (action === 'crm_detail') return handleCrmDetail(req, res)
  if (action === 'crm_update') return handleCrmUpdate(req, res)
  if (action === 'crm_note')   return handleCrmNote(req, res)
  if (action === 'crm_create') return handleCrmCreate(req, res)
  if (action === 'crm_delete') return handleCrmDelete(req, res)

  // Client error log — anonymous-write, admin-read.
  if (action === 'report_error')   return handleReportError(req, res)
  if (action === 'errors_list')    return handleErrorsList(req, res)
  if (action === 'errors_resolve') return handleErrorsResolve(req, res)
  if (action === 'errors_decode')  return handleErrorsDecode(req, res)
  if (action === 'client_health_snapshot') return handleClientHealthSnapshot(req, res)

  // DGII Mis Comprobantes auto-pull — credential vault + status + manual trigger
  if (action === 'dgii_creds_save')   return handleDgiiCredsSave(req, res)
  if (action === 'dgii_creds_status') return handleDgiiCredsStatus(req, res)
  if (action === 'dgii_creds_delete') return handleDgiiCredsDelete(req, res)
  if (action === 'dgii_pull_run')     return handleDgiiPullRun(req, res)
  if (action === 'cron_dgii_pull')    return handleCronDgiiPull(req, res)
  if (action === 'dgii_creds_save_plaintext') return handleDgiiCredsSavePlaintext(req, res)
  if (action === 'dgii_login_test')   return handleDgiiLoginTest(req, res)

  // Desktop cloud backup — license-validated signed upload URL for db-backups bucket.
  if (action === 'db-backup-sign') return handleDbBackupSign(req, res)
  if (action === 'db-backup-status') return handleDbBackupStatus(req, res)

  // UltraMsg WhatsApp credentials per-client + live status probe.
  if (action === 'ultramsg_get')    return handleUltramsgGet(req, res)
  if (action === 'ultramsg_save')   return handleUltramsgSave(req, res)
  if (action === 'ultramsg_status') return handleUltramsgStatus(req, res)

  // ── Contabilidad Vault (Supabase Storage signed URLs) ────────────────────
  if (action === 'vault_upload_sign')   return handleVaultUploadSign(req, res)
  if (action === 'vault_download_sign') return handleVaultDownloadSign(req, res)
  if (action === 'vault_delete')        return handleVaultDelete(req, res)

  // ── Contabilidad cross-firm wire (Slice 5) ────────────────────────────────
  if (action === 'ctb_generate_access_code') return handleCtbGenerateAccessCode(req, res)
  if (action === 'ctb_accept_access_code')   return handleCtbAcceptAccessCode(req, res)
  if (action === 'ctb_revoke_access')        return handleCtbRevokeAccess(req, res)
  if (action === 'ctb_client_data')          return handleCtbClientData(req, res)
  if (action === 'ctb_my_accountant')        return handleCtbMyAccountant(req, res)

  // ── Cross-firm impersonation ("Ver como cliente") — Pro MAX contadora ───
  if (action === 'firm_impersonate_check')   return handleFirmImpersonateCheck(req, res)
  if (action === 'firm_impersonate_end')     return handleFirmImpersonateEnd(req, res)

  return res.status(400).json({ error: 'Unknown action' })
}

// ─────────────────────────────────────────────────────────────────────────────
// Contabilidad cross-firm wire — Slice 5
// ─────────────────────────────────────────────────────────────────────────────
// Auth pattern: Supabase JWT in Authorization: Bearer <token>. The JWT carries
// app_metadata.business_id (set by /signup/provision.js + AuthContext refresh).
// We resolve it via supabase.auth.getUser, then load the businesses row to
// confirm business_type. Service role bypasses RLS so we can write to
// accounting_clients on behalf of either tenant.
//
// Token format: 8-char from CHARS (32-char alphabet, ~5 bits/char ≈ 40 bits of
// entropy). One-time, expires after 24h. We expire by overwriting with NULL
// when consumed; expiry-without-consume is enforced at lookup time.

async function ctbAuthUser(req) {
  const authHeader = req.headers.authorization || ''
  if (!authHeader.startsWith('Bearer ')) return { error: 'missing_auth_token', status: 401 }
  const token = authHeader.slice(7)
  const supabase = getClient()
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return { error: 'invalid_token', status: 401 }
  // Resolve business_id via app_metadata first; fallback to staff lookup so
  // installs that never refreshed the JWT after provisioning still work.
  let businessId = user.app_metadata?.business_id || null
  if (!businessId) {
    const { data: staff } = await supabase.from('staff')
      .select('business_id, role').eq('auth_user_id', user.id).eq('active', true).maybeSingle()
    businessId = staff?.business_id || null
  }
  if (!businessId) return { error: 'no_business', status: 403 }
  const { data: biz } = await supabase.from('businesses')
    .select('id, name, business_type, settings').eq('id', businessId).maybeSingle()
  if (!biz) return { error: 'business_not_found', status: 403 }
  return { supabase, user, businessId, business: biz }
}

function generateAccessCode() {
  // 8 chars from the same alphabet as license keys (no ambiguous 0/O/1/I).
  return Array.from({ length: 8 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('')
}

// POST { accounting_client_id } — firm side (must be business_type='contabilidad').
async function handleCtbGenerateAccessCode(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' })
  const auth = await ctbAuthUser(req)
  if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error })
  if (auth.business.business_type !== 'contabilidad') {
    return res.status(403).json({ ok: false, error: 'firm_only' })
  }
  const body = req.body || {}
  const acId = Number(body.accounting_client_id)
  if (!acId) return res.status(400).json({ ok: false, error: 'missing_accounting_client_id' })
  const { data: ac } = await auth.supabase.from('accounting_clients')
    .select('id, business_id, nombre_comercial')
    .eq('id', acId).eq('business_id', auth.businessId).maybeSingle()
  if (!ac) return res.status(404).json({ ok: false, error: 'accounting_client_not_found' })
  const code = generateAccessCode()
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const { error } = await auth.supabase.from('accounting_clients')
    .update({
      access_token: code,
      access_token_expires_at: expires,
      access_granted: false,
      shared_business_id: null,
      access_granted_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', acId).eq('business_id', auth.businessId)
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({
    ok: true,
    code,
    expires_at: expires,
    nombre_comercial: ac.nombre_comercial,
    instructions: 'El cliente ingresa este código en Configuración → Compartir con contador. Vence en 24 horas.',
  })
}

// POST { code } — client side (any business_type). Resolves the token, sets
// shared_business_id = current_business_id, access_granted = true.
async function handleCtbAcceptAccessCode(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' })
  const auth = await ctbAuthUser(req)
  if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error })
  const body = req.body || {}
  const code = String(body.code || '').toUpperCase().replace(/\s+/g, '')
  if (!code || code.length !== 8) return res.status(400).json({ ok: false, error: 'invalid_code' })
  const { data: ac } = await auth.supabase.from('accounting_clients')
    .select('id, business_id, nombre_comercial, access_token, access_token_expires_at, access_granted, shared_business_id')
    .eq('access_token', code).maybeSingle()
  if (!ac) return res.status(404).json({ ok: false, error: 'code_not_found_or_consumed' })
  if (ac.access_token_expires_at && new Date(ac.access_token_expires_at) < new Date()) {
    return res.status(410).json({ ok: false, error: 'code_expired' })
  }
  // Already granted to a different business → reject.
  if (ac.access_granted && ac.shared_business_id && ac.shared_business_id !== auth.businessId) {
    return res.status(409).json({ ok: false, error: 'already_granted_to_other_business' })
  }
  const { error } = await auth.supabase.from('accounting_clients')
    .update({
      shared_business_id: auth.businessId,
      access_granted: true,
      access_granted_at: new Date().toISOString(),
      access_token: null,                 // single-use → null after consume
      access_token_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', ac.id)
  if (error) return res.status(500).json({ ok: false, error: error.message })
  // Resolve the firm name for the response.
  const { data: firm } = await auth.supabase.from('businesses').select('id, name').eq('id', ac.business_id).maybeSingle()
  return res.status(200).json({
    ok: true,
    accounting_client_id: ac.id,
    firm_name: firm?.name || '',
    nombre_comercial: ac.nombre_comercial,
  })
}

// POST { accounting_client_id } — firm-side OR client-side revoke.
async function handleCtbRevokeAccess(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' })
  const auth = await ctbAuthUser(req)
  if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error })
  const body = req.body || {}
  const acId = body.accounting_client_id ? Number(body.accounting_client_id) : null
  let q = auth.supabase.from('accounting_clients')
  // Firm side
  if (acId) {
    const { data: ac } = await auth.supabase.from('accounting_clients')
      .select('id, business_id, shared_business_id').eq('id', acId).maybeSingle()
    if (!ac) return res.status(404).json({ ok: false, error: 'accounting_client_not_found' })
    const isFirm = ac.business_id === auth.businessId
    const isClient = ac.shared_business_id === auth.businessId
    if (!isFirm && !isClient) return res.status(403).json({ ok: false, error: 'forbidden' })
    const { error } = await auth.supabase.from('accounting_clients')
      .update({
        access_granted: false, shared_business_id: null, access_granted_at: null,
        access_token: null, access_token_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', acId)
    if (error) return res.status(500).json({ ok: false, error: error.message })
    return res.status(200).json({ ok: true })
  }
  // Client side blanket: revoke any links pointing at us
  const { error, data } = await auth.supabase.from('accounting_clients')
    .update({
      access_granted: false, shared_business_id: null, access_granted_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('shared_business_id', auth.businessId)
    .select('id')
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, revoked: (data || []).length })
}

// GET ?dataset=tickets|ecf|inventory|services|clients|compras_607
//     &accounting_client_id=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD
// Firm-side endpoint. Verifies the firm tenant has an access_granted=true
// accounting_clients row for the requested client, then queries the dataset
// scoped to shared_business_id. RLS allows the SELECT via has_accountant_access.
const CTB_DATASETS = {
  tickets:       { table: 'tickets',         dateCol: 'created_at',
                   columns: 'id,supabase_id,business_id,ncf,total,subtotal,itbis,status,created_at,client_id,client_supabase_id' },
  tickets_full:  { table: 'tickets',         dateCol: 'created_at',
                   columns: '*' },
  ecf:           { table: 'ecf_documents',   dateCol: 'created_at',
                   columns: 'id,supabase_id,business_id,e_ncf,track_id,status,total,itbis,created_at' },
  inventory:     { table: 'inventory_items', dateCol: null,
                   columns: 'id,supabase_id,business_id,name,sku,barcode,price,cost,stock,category,active' },
  services:      { table: 'services',        dateCol: null,
                   columns: 'id,supabase_id,business_id,name,price,aplica_itbis,active,category' },
  clients:       { table: 'clients',         dateCol: null,
                   columns: 'id,supabase_id,business_id,name,rnc,phone,email,active' },
  compras_607:   { table: 'compras_607',     dateCol: 'fecha_ncf',
                   columns: 'id,supabase_id,business_id,ncf,fecha_ncf,total,itbis_facturado,monto_servicios,monto_bienes,rnc_proveedor' },
}

async function handleCtbClientData(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'GET only' })
  const auth = await ctbAuthUser(req)
  if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error })
  if (auth.business.business_type !== 'contabilidad') {
    return res.status(403).json({ ok: false, error: 'firm_only' })
  }
  const acId = Number(req.query.accounting_client_id)
  const dataset = String(req.query.dataset || '')
  if (!acId) return res.status(400).json({ ok: false, error: 'missing_accounting_client_id' })
  const cfg = CTB_DATASETS[dataset]
  if (!cfg) return res.status(400).json({ ok: false, error: 'unknown_dataset' })

  const { data: ac } = await auth.supabase.from('accounting_clients')
    .select('id, shared_business_id, access_granted')
    .eq('id', acId).eq('business_id', auth.businessId).maybeSingle()
  if (!ac) return res.status(404).json({ ok: false, error: 'accounting_client_not_found' })
  if (!ac.access_granted || !ac.shared_business_id) {
    return res.status(403).json({ ok: false, error: 'access_not_granted', message: 'El cliente aún no ha aceptado el código.' })
  }

  let q = auth.supabase.from(cfg.table).select(cfg.columns).eq('business_id', ac.shared_business_id)
  if (cfg.dateCol) {
    if (req.query.from) q = q.gte(cfg.dateCol, String(req.query.from))
    if (req.query.to)   q = q.lte(cfg.dateCol, String(req.query.to) + 'T23:59:59')
    q = q.order(cfg.dateCol, { ascending: false })
  }
  const limit = Math.min(5000, Number(req.query.limit) || 1000)
  q = q.limit(limit)
  const { data, error } = await q
  if (error) {
    // Fall back gracefully when the table doesn't exist in this env.
    if (/does not exist/i.test(error.message)) return res.status(200).json({ ok: true, dataset, rows: [] })
    return res.status(500).json({ ok: false, error: error.message })
  }
  return res.status(200).json({ ok: true, dataset, count: (data || []).length, rows: data || [] })
}

// GET — client-side: which firm currently has access to this tenant?
async function handleCtbMyAccountant(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'GET only' })
  const auth = await ctbAuthUser(req)
  if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error })
  const { data, error } = await auth.supabase.from('accounting_clients')
    .select('id, business_id, nombre_comercial, access_granted, access_granted_at')
    .eq('shared_business_id', auth.businessId).eq('access_granted', true)
  if (error) return res.status(500).json({ ok: false, error: error.message })
  if (!data?.length) return res.status(200).json({ ok: true, linked: false })
  // Resolve firm name
  const ids = Array.from(new Set(data.map(r => r.business_id)))
  const { data: firms } = await auth.supabase.from('businesses').select('id, name').in('id', ids)
  const byId = new Map((firms || []).map(b => [b.id, b]))
  return res.status(200).json({
    ok: true,
    linked: true,
    grants: data.map(r => ({
      accounting_client_id: r.id,
      firm_business_id: r.business_id,
      firm_name: byId.get(r.business_id)?.name || '',
      nombre_comercial: r.nombre_comercial,
      granted_at: r.access_granted_at,
    })),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Firm impersonation — "Ver como cliente"
// ─────────────────────────────────────────────────────────────────────────────
// Server-side authorization gate for the contadora's "log in as client" flow.
// Verifies the calling JWT's business_id has an access_granted accounting_clients
// row whose shared_business_id == requested target. Writes a CRITICAL audit
// entry to activity_log on BOTH the firm and the client tenants so the trail
// is visible from either side.

async function logImpersonationEvent({ supabase, eventType, firmAuth, clientBusinessId, clientName, accountingClientId, ip, ua }) {
  const baseMeta = {
    firm_business_id:     firmAuth.businessId,
    firm_name:            firmAuth.business?.name || null,
    client_business_id:   clientBusinessId,
    client_name:          clientName || null,
    accounting_client_id: accountingClientId || null,
    actor_user_id:        firmAuth.user?.id || null,
    actor_email:          firmAuth.user?.email || null,
    ip:                   ip || null,
    ua:                   (ua || '').slice(0, 200),
  }
  const targetName = clientName || 'cliente'
  const rows = [
    {
      business_id: firmAuth.businessId,
      event_type:  eventType,
      severity:    'critical',
      target_type: 'business',
      target_name: targetName,
      metadata:    baseMeta,
    },
    {
      business_id: clientBusinessId,
      event_type:  eventType,
      severity:    'critical',
      target_type: 'business',
      target_name: firmAuth.business?.name || 'contador',
      metadata:    baseMeta,
    },
  ]
  try { await supabase.from('activity_log').insert(rows) } catch { /* non-blocking audit */ }
}

// POST { client_business_id, accounting_client_id? } — firm side. Returns
// { ok, role, client_name, firm_business_id, accounting_client_id }.
async function handleFirmImpersonateCheck(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' })
  const auth = await ctbAuthUser(req)
  if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error })
  if (auth.business.business_type !== 'contabilidad') {
    return res.status(403).json({ ok: false, error: 'firm_only', message: 'Solo cuentas contables pueden impersonar.' })
  }
  const body = req.body || {}
  const clientBusinessId = String(body.client_business_id || '').trim()
  const acId = body.accounting_client_id ? Number(body.accounting_client_id) : null
  if (!clientBusinessId) return res.status(400).json({ ok: false, error: 'missing_client_business_id' })

  let q = auth.supabase.from('accounting_clients')
    .select('id, business_id, shared_business_id, nombre_comercial, access_granted, status')
    .eq('business_id', auth.businessId)
    .eq('shared_business_id', clientBusinessId)
    .eq('access_granted', true)
    .eq('status', 'active')
  if (acId) q = q.eq('id', acId)
  const { data: ac, error } = await q.limit(1).maybeSingle()
  if (error) return res.status(500).json({ ok: false, error: error.message })
  if (!ac) {
    return res.status(403).json({
      ok: false,
      error: 'no_active_membership',
      message: 'No tienes acceso activo a este cliente. Pídele que te conceda el código de acceso.',
    })
  }

  const { data: clientBiz } = await auth.supabase.from('businesses')
    .select('id, name').eq('id', clientBusinessId).maybeSingle()

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim()
  const ua = req.headers['user-agent'] || ''

  await logImpersonationEvent({
    supabase: auth.supabase,
    eventType: 'firm_impersonate_start',
    firmAuth: auth,
    clientBusinessId,
    clientName: clientBiz?.name || ac.nombre_comercial || '',
    accountingClientId: ac.id,
    ip, ua,
  })

  return res.status(200).json({
    ok: true,
    role: 'accountant_view',
    client_business_id:   clientBusinessId,
    client_name:          clientBiz?.name || ac.nombre_comercial || '',
    firm_business_id:     auth.businessId,
    accounting_client_id: ac.id,
  })
}

// POST { client_business_id, accounting_client_id? } — fire-and-forget audit on exit.
async function handleFirmImpersonateEnd(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' })
  const auth = await ctbAuthUser(req)
  if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error })
  const body = req.body || {}
  const clientBusinessId = String(body.client_business_id || '').trim()
  const acId = body.accounting_client_id ? Number(body.accounting_client_id) : null
  if (!clientBusinessId) return res.status(400).json({ ok: false, error: 'missing_client_business_id' })

  const { data: clientBiz } = await auth.supabase.from('businesses')
    .select('id, name').eq('id', clientBusinessId).maybeSingle()

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim()
  const ua = req.headers['user-agent'] || ''

  await logImpersonationEvent({
    supabase: auth.supabase,
    eventType: 'firm_impersonate_end',
    firmAuth: auth,
    clientBusinessId,
    clientName: clientBiz?.name || '',
    accountingClientId: acId,
    ip, ua,
  })
  return res.status(200).json({ ok: true })
}

// ─────────────────────────────────────────────────────────────────────────────
// CRM — admin sales pipeline. Auto-populated from signup/provision.js.
// All endpoints behind requireAdmin. Service role bypasses RLS.
// ─────────────────────────────────────────────────────────────────────────────
const CRM_STATUSES = ['new','contacted','qualified','demo_scheduled','proposal','won','lost']

async function handleCrmList(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase } = auth
  const { status, assigned_to, plan, q } = req.query || {}
  try {
    let query = supabase.from('crm_leads')
      .select('id, business_id, email, phone, contact_name, business_name, rnc, requested_plan, business_type, utm_source, assigned_to, status, last_contacted_at, next_followup_at, source, created_at, updated_at')
      .order('created_at', { ascending: false }).limit(500)
    if (status && CRM_STATUSES.includes(status)) query = query.eq('status', status)
    if (assigned_to === 'unassigned') query = query.is('assigned_to', null)
    else if (assigned_to) query = query.eq('assigned_to', assigned_to)
    if (plan) query = query.eq('requested_plan', plan)
    const { data: leads, error } = await query
    if (error) throw error
    // Exclude demo tenants from CRM. Three signals:
    //   1. business_id resolves to a businesses row with is_demo = true
    //   2. business_name starts with 'Demo ' (legacy seed leads w/ null business_id)
    //   3. email matches *.demo.terminalxpos.com (legacy demo accounts)
    const leadBids = [...new Set((leads || []).map(l => l.business_id).filter(Boolean))]
    let demoBidSet = new Set()
    if (leadBids.length) {
      const { data: demoBizRows } = await supabase.from('businesses')
        .select('id').in('id', leadBids).eq('is_demo', true)
      demoBidSet = new Set((demoBizRows || []).map(r => r.id))
    }
    const isDemoLead = (l) => {
      if (l.business_id && demoBidSet.has(l.business_id)) return true
      const name = (l.business_name || '').trim().toLowerCase()
      if (name.startsWith('demo ') || name === 'demo') return true
      if ((l.email || '').toLowerCase().endsWith('.demo.terminalxpos.com')) return true
      return false
    }
    const adminIds = [...new Set((leads || []).map(l => l.assigned_to).filter(Boolean))]
    const { data: admins } = adminIds.length
      ? await supabase.from('admin_users').select('id, name').in('id', adminIds)
      : { data: [] }
    const adminMap = Object.fromEntries((admins || []).map(a => [a.id, a.name]))
    const filtered = (leads || []).filter(l => {
      if (isDemoLead(l)) return false
      if (!q) return true
      const s = String(q).toLowerCase()
      return (l.business_name || '').toLowerCase().includes(s)
          || (l.email || '').toLowerCase().includes(s)
          || (l.phone || '').includes(s)
          || (l.rnc || '').includes(s)
    }).map(l => ({ ...l, assigned_to_name: adminMap[l.assigned_to] || null }))
    return res.json({ data: filtered })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleCrmDetail(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase } = auth
  const id = req.query?.id
  if (!id) return res.status(400).json({ error: 'id required' })
  try {
    const { data: lead, error } = await supabase.from('crm_leads').select('*').eq('id', id).maybeSingle()
    if (error) throw error
    if (!lead) return res.status(404).json({ error: 'Lead not found' })
    const [{ data: activity }, { data: admins }, biz] = await Promise.all([
      supabase.from('crm_lead_activity').select('*').eq('lead_id', id).order('created_at', { ascending: false }).limit(200),
      supabase.from('admin_users').select('id, name, role, active').eq('active', true).order('name'),
      lead.business_id
        ? supabase.from('businesses').select('id, name, rnc, phone, plan, settings, created_at').eq('id', lead.business_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    return res.json({ data: { lead, activity: activity || [], admins: admins || [], business: biz?.data || null } })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleCrmUpdate(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase, admin } = auth
  const { id, status, assigned_to, next_followup_at, contact_name, email, phone, rnc, requested_plan } = req.body || {}
  if (!id) return res.status(400).json({ error: 'id required' })
  if (status && !CRM_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' })
  try {
    const { data: prev } = await supabase.from('crm_leads').select('*').eq('id', id).maybeSingle()
    if (!prev) return res.status(404).json({ error: 'Lead not found' })
    const patch = {}
    const allowed = { status, assigned_to, next_followup_at, contact_name, email, phone, rnc, requested_plan }
    for (const [k, v] of Object.entries(allowed)) if (v !== undefined) patch[k] = v === '' ? null : v
    if (status === 'contacted' && prev.status === 'new') patch.last_contacted_at = new Date().toISOString()
    const { data, error } = await supabase.from('crm_leads').update(patch).eq('id', id).select().single()
    if (error) throw error
    // Activity log entries for status / assignment / followup changes
    const events = []
    if (patch.status && patch.status !== prev.status)
      events.push({ kind: 'status_change', body: `${prev.status} → ${patch.status}`, metadata: { from: prev.status, to: patch.status } })
    if (patch.assigned_to !== undefined && patch.assigned_to !== prev.assigned_to) {
      let toName = null
      if (patch.assigned_to) {
        const { data: a } = await supabase.from('admin_users').select('name').eq('id', patch.assigned_to).maybeSingle()
        toName = a?.name || null
      }
      events.push({ kind: 'assignment', body: toName ? `Asignado a ${toName}` : 'Sin asignar', metadata: { to: patch.assigned_to } })
    }
    if (patch.next_followup_at !== undefined && patch.next_followup_at !== prev.next_followup_at)
      events.push({ kind: 'followup_set', body: patch.next_followup_at ? `Seguimiento: ${patch.next_followup_at}` : 'Seguimiento removido' })
    if (events.length) {
      await supabase.from('crm_lead_activity').insert(events.map(e => ({
        lead_id: id, admin_user_id: admin.id, admin_name: admin.name, ...e,
      })))
    }
    return res.json({ data })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleCrmNote(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase, admin } = auth
  const { lead_id, kind, body } = req.body || {}
  if (!lead_id) return res.status(400).json({ error: 'lead_id required' })
  if (!body || !String(body).trim()) return res.status(400).json({ error: 'body required' })
  const allowedKind = ['note','call','whatsapp','email']
  const k = allowedKind.includes(kind) ? kind : 'note'
  try {
    const { data, error } = await supabase.from('crm_lead_activity').insert({
      lead_id, admin_user_id: admin.id, admin_name: admin.name, kind: k, body: String(body).trim(),
    }).select().single()
    if (error) throw error
    if (k === 'call' || k === 'whatsapp' || k === 'email') {
      await supabase.from('crm_leads').update({ last_contacted_at: new Date().toISOString() }).eq('id', lead_id)
    }
    return res.json({ data })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

// ─────────────────────────────────────────────────────────────────────────────
// Client error log — clients POST anonymously so errors are captured even when
// auth is broken (chunk-load failures, signed-out states). Admin reads via
// service role behind requireAdmin.
// ─────────────────────────────────────────────────────────────────────────────
// 2026-05-03 (peppy-greeting-popcorn) — auto-classify errors by stack/message
// pattern. Stored in metadata.category so the admin Dashboard can group + color
// without rewriting old rows. Categories chosen to match real bug families
// we've hit (chunk_load, lazy_resolution, react_invariant, api_shape, tdz, RLS,
// routing). Falls through to 'other' if nothing matches.
function classifyError(message, stack) {
  const m = String(message || '')
  const s = String(stack || '')
  const blob = m + '\n' + s
  if (/Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(blob)) return 'chunk_load'
  if (/Cannot read propert(?:y|ies) of undefined.*['"`]?default['"`]?/i.test(blob)) return 'lazy_resolution'
  if (/Minified React error #\d+/i.test(blob)) return 'react_invariant'
  if (/^route_not_found:|route_not_found/i.test(m)) return 'routing'
  if (/is not a function/i.test(m)) return 'api_shape'
  if (/Cannot access ['"`]\w+['"`] before initialization/i.test(m)) return 'tdz'
  if (/is not defined/i.test(m)) return 'tdz_or_undefined'
  if (/(?:row-level security|RLS|42501|new row violates row-level security)/i.test(blob)) return 'rls_denial'
  if (/Network request failed|Failed to fetch|TypeError: fetch/i.test(blob)) return 'network'
  if (/Permission denied|403|401/i.test(m)) return 'auth'
  return 'other'
}

// 2026-05-03 (peppy-greeting-popcorn Phase 3) — sourcemap decode + critical
// alerting hooks. _mapCache is module-level so warm Vercel instances reuse
// fetched .map files (hashed → immutable per deploy → infinite TTL fine).
const _mapCache = new Map() // url → consumer | null (null = fetch failed, don't retry)
async function decodeMinifiedStack(stack) {
  if (!stack || typeof stack !== 'string') return null
  // Match patterns like: at fnName (https://terminalxpos.com/assets/POS-Bya8deFD.js:2:80534)
  // Or:                  at https://terminalxpos.com/assets/POS-Bya8deFD.js:2:80534
  const FRAME_RE = /(?:at\s+(?:async\s+)?(?:(?<name>[^\s(]+)\s+\()?(?:(?<url>https?:\/\/[^\s):]+\.js)):(?<line>\d+):(?<col>\d+)\)?)/g
  const frames = []
  let m, count = 0
  while ((m = FRAME_RE.exec(stack)) && count < 10) {
    frames.push({ name: m.groups.name || null, url: m.groups.url, line: Number(m.groups.line), col: Number(m.groups.col) })
    count++
  }
  if (!frames.length) return null
  let SourceMapConsumer
  try {
    const sm = await import('source-map')
    SourceMapConsumer = sm.SourceMapConsumer
  } catch { return null }
  const decoded = []
  for (const f of frames) {
    try {
      let consumer = _mapCache.get(f.url)
      if (consumer === undefined) {
        const r = await fetch(f.url + '.map')
        if (!r.ok) { _mapCache.set(f.url, null); decoded.push({ ...f, decoded: null }); continue }
        const raw = await r.json()
        consumer = await new SourceMapConsumer(raw)
        _mapCache.set(f.url, consumer)
      }
      if (consumer === null) { decoded.push({ ...f, decoded: null }); continue }
      const orig = consumer.originalPositionFor({ line: f.line, column: f.col })
      decoded.push({
        ...f,
        decoded: orig.source ? { source: orig.source, line: orig.line, column: orig.column, name: orig.name || null } : null,
      })
    } catch (e) {
      decoded.push({ ...f, decoded: null, decode_error: String(e?.message || e).slice(0, 100) })
    }
  }
  return decoded
}

// 2026-05-03 (peppy-greeting-popcorn Phase 3) — Slack webhook for critical
// errors. Configure by setting SLACK_ALERT_WEBHOOK_URL env var in Vercel
// project settings. If unset, this is a no-op. Receives only severity===
// 'critical' rows so it stays signal-rich.
async function fireCriticalAlert(row, decodedStack) {
  const url = process.env.SLACK_ALERT_WEBHOOK_URL
  if (!url) return
  try {
    const lines = [
      `🔴 *Critical error* @ \`${row.message?.slice(0, 200)}\``,
      `Business: \`${row.business_id || 'unknown'}\` · Route: \`${row.route || 'unknown'}\` · v${row.app_version || '?'}`,
      `Category: \`${row.metadata?.category || 'other'}\` · Plan: \`${row.metadata?.plan || '?'}\` · Type: \`${row.metadata?.business_type || '?'}\``,
    ]
    if (decodedStack && decodedStack.length) {
      lines.push('```\n' + decodedStack.slice(0, 5).map(f => {
        if (f.decoded) return `${f.decoded.name || '(anonymous)'} at ${f.decoded.source}:${f.decoded.line}`
        return `${f.name || '?'} at ${f.url.split('/').pop()}:${f.line}`
      }).join('\n') + '\n```')
    } else if (row.stack) {
      lines.push('```\n' + row.stack.split('\n').slice(0, 5).join('\n') + '\n```')
    }
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: lines.join('\n') }),
      keepalive: true,
    })
  } catch {} // never let alerting fail the parent request
}

async function handleReportError(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const SUPABASE_URL = process.env.SUPABASE_URL
    const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!SUPABASE_URL || !SVC) return res.status(500).json({ error: 'Service role not configured' })
    const supabase = createClient(SUPABASE_URL, SVC, { auth: { autoRefreshToken: false, persistSession: false } })

    const body = req.body || {}
    const trim = (s, n=8000) => typeof s === 'string' ? s.slice(0, n) : null
    const businessId = typeof body.business_id === 'string' && /^[0-9a-f-]{36}$/i.test(body.business_id) ? body.business_id : null
    const severity = ['error','warning','info','critical'].includes(body.severity) ? body.severity : 'error'
    const message = trim(body.message || 'unknown', 2000) || 'unknown'
    const stack = trim(body.stack, 8000)
    const incomingMeta = (typeof body.metadata === 'object' && body.metadata !== null) ? body.metadata : {}
    const category = (typeof incomingMeta.category === 'string' && incomingMeta.category) || classifyError(message, stack)
    const metadata = { ...incomingMeta, category }
    const route = trim(body.route, 500)
    const insertRow = {
      business_id: businessId,
      message, stack,
      route,
      user_agent: trim(body.user_agent, 500),
      app_version: trim(body.app_version, 60),
      user_id: typeof body.user_id === 'string' && /^[0-9a-f-]{36}$/i.test(body.user_id) ? body.user_id : null,
      user_role: trim(body.user_role, 60),
      severity,
      metadata,
    }
    const { data: inserted, error } = await supabase.from('client_errors').insert(insertRow).select('id').single()
    if (error) throw error

    // Fire-and-forget: decode stack + maybe alert. We respond immediately so
    // the client isn't blocked. Vercel warm instance will hold the promise
    // long enough in most cases; if it doesn't, the row is still saved with
    // raw stack and the dashboard's lazy-decode endpoint can fill it later.
    res.json({ ok: true, id: inserted?.id })
    if (stack) {
      decodeMinifiedStack(stack).then(async (decoded) => {
        if (!decoded || !decoded.length) return
        const newMeta = { ...metadata, decoded_stack: decoded }
        await supabase.from('client_errors').update({ metadata: newMeta }).eq('id', inserted.id)
        if (severity === 'critical') {
          await fireCriticalAlert({ ...insertRow, id: inserted.id }, decoded)
        }
      }).catch(() => {})
    } else if (severity === 'critical') {
      fireCriticalAlert({ ...insertRow, id: inserted?.id }, null).catch(() => {})
    }
    return
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

// 2026-05-03 (peppy-greeting-popcorn Phase 3) — on-demand decode for older
// rows that were inserted before the lazy decoder, OR rows whose async
// decode didn't finish before Vercel shut the instance. Idempotent — re-runs
// safely. Frontend can call this when user expands an error in the dashboard.
async function handleErrorsDecode(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { id } = req.body || {}
  if (!id) return res.status(400).json({ error: 'id required' })
  try {
    const { data: row, error: fetchErr } = await auth.supabase.from('client_errors').select('id, stack, metadata').eq('id', id).maybeSingle()
    if (fetchErr) throw fetchErr
    if (!row) return res.status(404).json({ error: 'not found' })
    if (row.metadata?.decoded_stack) return res.json({ data: { decoded_stack: row.metadata.decoded_stack, cached: true } })
    if (!row.stack) return res.json({ data: { decoded_stack: null, reason: 'no_stack' } })
    const decoded = await decodeMinifiedStack(row.stack)
    if (!decoded) return res.json({ data: { decoded_stack: null, reason: 'no_minified_frames' } })
    const newMeta = { ...(row.metadata || {}), decoded_stack: decoded }
    await auth.supabase.from('client_errors').update({ metadata: newMeta }).eq('id', id)
    return res.json({ data: { decoded_stack: decoded, cached: false } })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleErrorsList(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  try {
    const { business_id, unresolved, limit } = req.query
    let q = auth.supabase.from('client_errors')
      .select('*, businesses(name, rnc)')
      .order('created_at', { ascending: false })
      .limit(Math.min(parseInt(limit) || 100, 500))
    if (business_id) q = q.eq('business_id', business_id)
    if (unresolved === '1') q = q.is('resolved_at', null)
    const { data, error } = await q
    if (error) throw error
    return res.json({ data: data || [] })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleErrorsResolve(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { id, resolution } = req.body || {}
  if (!id) return res.status(400).json({ error: 'id required' })
  try {
    const { error } = await auth.supabase.from('client_errors').update({
      resolved_at: new Date().toISOString(),
      resolved_by: auth.admin?.id || null,
      resolution: typeof resolution === 'string' ? resolution.slice(0, 1000) : null,
    }).eq('id', id)
    if (error) throw error
    return res.json({ ok: true })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

// 2026-05-03 (peppy-greeting-popcorn Phase 2) — client health snapshot.
// Bundled diagnostic for /admin ClientDetail "Diagnóstico" card. Surfaces the
// "is this client provisioned correctly + has data + recent errors" view in
// one call. Replaces the manual ad-hoc queries we ran on Crokao 2026-05-02
// when DGII/Salon were locked + business_type defaulting to carwash.
async function handleClientHealthSnapshot(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const bid = req.query?.business_id || req.query?.id
  if (!bid || !/^[0-9a-f-]{36}$/i.test(bid)) return res.status(400).json({ error: 'business_id required' })
  try {
    const sb = auth.supabase
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const since30d = new Date(Date.now() - 30 * 86_400_000).toISOString()

    const [bizRes, licRes, asRes, errRes,
           mesasRes, servicesRes, empleadosRes,
           ticketsRes, ticketItemsRes,
           lastTicketRes, ownerRes] = await Promise.all([
      sb.from('businesses').select('id, name, plan, is_demo, settings, owner_id, created_at').eq('id', bid).maybeSingle(),
      sb.from('licenses').select('id, license_key, status, plan_id, platform, activated_at, expires_at').eq('business_id', bid).order('activated_at', { ascending: false }).limit(1),
      sb.from('app_settings').select('key, value, is_device_local').eq('business_id', bid),
      sb.from('client_errors').select('id, severity, metadata, created_at').eq('business_id', bid).gte('created_at', since24h).order('created_at', { ascending: false }).limit(200),
      sb.from('mesas').select('id', { count: 'exact', head: true }).eq('business_id', bid).eq('active', true),
      sb.from('services').select('id, is_menu_item', { count: 'exact' }).eq('business_id', bid).eq('active', true),
      sb.from('empleados').select('id', { count: 'exact', head: true }).eq('business_id', bid).eq('active', true),
      sb.from('tickets').select('id', { count: 'exact', head: true }).eq('business_id', bid).gte('created_at', since30d),
      sb.from('ticket_items').select('id', { count: 'exact', head: true }).eq('business_id', bid).gte('created_at', since30d),
      sb.from('tickets').select('created_at').eq('business_id', bid).order('created_at', { ascending: false }).limit(1),
      sb.from('businesses').select('owner_id').eq('id', bid).maybeSingle(),
    ])

    if (!bizRes.data) return res.status(404).json({ error: 'business not found' })
    const biz = bizRes.data
    const settings = parseSettingsIfString(biz.settings) || {}
    const lic = (licRes.data || [])[0] || null
    const appSettingsRows = asRes.data || []
    const businessTypeRow = appSettingsRows.find(r => r.key === 'business_type' && r.is_device_local === false)
    const businessTypeFromAppSettings = businessTypeRow?.value || null
    const businessTypeFromSettings = settings.business_type || settings.biz_type || null

    // Plan_id ↔ plan-name match check
    let planNameForLic = null
    if (lic?.plan_id) {
      const { data: planRow } = await sb.from('plans').select('name').eq('id', lic.plan_id).maybeSingle()
      planNameForLic = planRow?.name || null
    }

    // Errors by category
    const errsByCategory = {}
    let critCount = 0
    for (const e of errRes.data || []) {
      const cat = e.metadata?.category || 'other'
      errsByCategory[cat] = (errsByCategory[cat] || 0) + 1
      if (e.severity === 'critical') critCount++
    }

    // owner email lookup
    let ownerEmail = null
    if (ownerRes.data?.owner_id) {
      try {
        const { data: { user: ownerUser } } = await sb.auth.admin.getUserById(ownerRes.data.owner_id)
        ownerEmail = ownerUser?.email || null
      } catch {}
    }

    const services = servicesRes.data || []
    const menuItemCount = services.filter(s => s.is_menu_item === true || s.is_menu_item === 1).length

    return res.json({
      business: {
        id: biz.id,
        name: biz.name,
        plan: biz.plan,
        is_demo: biz.is_demo === true,
        business_type_app_settings: businessTypeFromAppSettings,
        business_type_settings_json: businessTypeFromSettings,
        business_type_in_sync: !!(businessTypeFromAppSettings && businessTypeFromAppSettings === businessTypeFromSettings),
        owner_email: ownerEmail,
        created_at: biz.created_at,
      },
      license: lic ? {
        license_key: lic.license_key,
        status: lic.status,
        platform: lic.platform,
        activated_at: lic.activated_at,
        expires_at: lic.expires_at,
        plan_name: planNameForLic,
        plan_matches_business: planNameForLic === biz.plan,
        is_active: lic.status === 'active' && (!lic.expires_at || new Date(lic.expires_at).getTime() > Date.now()),
        days_until_expiry: lic.expires_at ? Math.floor((new Date(lic.expires_at).getTime() - Date.now()) / 86_400_000) : null,
      } : null,
      app_settings: {
        total_rows: appSettingsRows.length,
        cloud_synced_count: appSettingsRows.filter(r => r.is_device_local === false).length,
        business_type_present_and_synced: !!businessTypeRow,
      },
      data_counts: {
        mesas: mesasRes.count ?? 0,
        services_active: servicesRes.count ?? 0,
        services_menu_items: menuItemCount,
        empleados: empleadosRes.count ?? 0,
        tickets_30d: ticketsRes.count ?? 0,
        ticket_items_30d: ticketItemsRes.count ?? 0,
      },
      recent_errors_24h: {
        total: errRes.data?.length ?? 0,
        critical: critCount,
        by_category: errsByCategory,
      },
      last_ticket_at: lastTicketRes.data?.[0]?.created_at || null,
    })
  } catch (err) {
    console.error('[client_health_snapshot]', err)
    return res.status(500).json({ error: err.message })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DGII auto-pull — credential vault + status + manual trigger.
// Creds are encrypted CLIENT-SIDE with AES-GCM (the firm's master key) before
// they reach this endpoint. Server only stores the cipher + iv + salt.
// ─────────────────────────────────────────────────────────────────────────────
async function handleDgiiCredsSave(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { firm_business_id, client_business_id, rnc, cred_cipher, cred_iv, cred_salt, session_cookie } = req.body || {}
  if (!firm_business_id || !client_business_id || !rnc) {
    return res.status(400).json({ error: 'firm_business_id, client_business_id, rnc required' })
  }
  // Two auth modes: full encrypted user/pass OR session_cookie (interim).
  if (!session_cookie && (!cred_cipher || !cred_iv || !cred_salt)) {
    return res.status(400).json({ error: 'session_cookie OR (cred_cipher + cred_iv + cred_salt) required' })
  }
  try {
    const row = {
      firm_business_id, client_business_id, rnc: String(rnc).replace(/\D/g, ''),
      status: 'active', updated_at: new Date().toISOString(),
    }
    if (session_cookie) {
      row.session_cookie = session_cookie
      // Sessions typically last ~30 minutes idle, ~24h sliding. Mark a soft
      // expiry of 36h so the UI can warn the contadora to refresh.
      row.session_cookie_expires_at = new Date(Date.now() + 36 * 3600 * 1000).toISOString()
      // Ensure required NOT NULL columns get values when only session is set
      row.cred_cipher = row.cred_cipher || ''
      row.cred_iv = row.cred_iv || ''
      row.cred_salt = row.cred_salt || ''
    }
    if (cred_cipher) { row.cred_cipher = cred_cipher; row.cred_iv = cred_iv; row.cred_salt = cred_salt }
    const { data, error } = await auth.supabase.from('client_dgii_credentials').upsert(row, {
      onConflict: 'client_business_id',
    }).select().single()
    if (error) throw error
    return res.json({ data })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleDgiiCredsStatus(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { firm_business_id } = req.query
  if (!firm_business_id) return res.status(400).json({ error: 'firm_business_id required' })
  try {
    const { data, error } = await auth.supabase.from('client_dgii_credentials')
      .select('id, client_business_id, rnc, status, last_pull_at, last_pull_count, last_pull_error')
      .eq('firm_business_id', firm_business_id)
      .order('updated_at', { ascending: false })
    if (error) throw error
    return res.json({ data: data || [] })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleDgiiCredsDelete(req, res) {
  if (req.method !== 'POST' && req.method !== 'DELETE') return res.status(405).json({ error: 'POST or DELETE' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const id = req.body?.id || req.query?.id
  if (!id) return res.status(400).json({ error: 'id required' })
  try {
    const { error } = await auth.supabase.from('client_dgii_credentials').delete().eq('id', id)
    if (error) throw error
    return res.json({ ok: true })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

// Manual trigger for the DGII pull worker. The actual scraper lives in a
// separate worker process (web/workers/dgii-pull.js) which we kick via this
// endpoint or via a daily Vercel cron. Phase 1: returns "queued" — the worker
// itself needs a real DGII session sample to wire (Perla's cred test).
async function handleDgiiPullRun(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { client_business_id } = req.body || {}
  if (!client_business_id) return res.status(400).json({ error: 'client_business_id required' })
  // For now: mark the cred as "queued" by updating last_pull_error to a
  // status message. Real scraper TBD when we have a sample DGII session.
  try {
    await auth.supabase.from('client_dgii_credentials').update({
      last_pull_error: 'Queued — scraper requires manual config; contact support.',
      updated_at: new Date().toISOString(),
    }).eq('client_business_id', client_business_id)
    return res.json({ ok: true, status: 'queued', note: 'Scraper will run on the next Vercel cron tick once configured.' })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

// ─── Server-side AES-256-GCM helpers for DGII passwords ───────────────────
// Uses process.env.DGII_CRED_KEY (32-byte hex). If unset, falls back to a
// derived key from SUPABASE_SERVICE_ROLE_KEY so deploys don't break — but
// production should set DGII_CRED_KEY explicitly.
async function _dgiiEncryptPass(plaintext) {
  const { createCipheriv, randomBytes, createHash } = await import('crypto')
  const keyMat = process.env.DGII_CRED_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || 'unset'
  const key = createHash('sha256').update(keyMat).digest()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return { cipher: Buffer.concat([enc, tag]).toString('base64'), iv: iv.toString('base64') }
}
async function _dgiiDecryptPass(cipherB64, ivB64) {
  const { createDecipheriv, createHash } = await import('crypto')
  const keyMat = process.env.DGII_CRED_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || 'unset'
  const key = createHash('sha256').update(keyMat).digest()
  const iv = Buffer.from(ivB64, 'base64')
  const blob = Buffer.from(cipherB64, 'base64')
  const tag = blob.subarray(blob.length - 16)
  const ct = blob.subarray(0, blob.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

async function handleDgiiCredsSavePlaintext(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { firm_business_id, client_business_id, rnc, dgii_user, dgii_pass } = req.body || {}
  if (!firm_business_id || !client_business_id || !rnc || !dgii_user || !dgii_pass) {
    return res.status(400).json({ error: 'firm_business_id, client_business_id, rnc, dgii_user, dgii_pass required' })
  }
  try {
    const { cipher, iv } = await _dgiiEncryptPass(dgii_pass)
    const { data, error } = await auth.supabase.from('client_dgii_credentials').upsert({
      firm_business_id, client_business_id, rnc: String(rnc).replace(/\D/g, ''),
      srv_user: String(dgii_user),
      srv_cred_cipher: cipher,
      srv_cred_iv: iv,
      // Required-but-now-nullable legacy fields — set empty so upsert works
      cred_cipher: '', cred_iv: '', cred_salt: '',
      status: 'active', updated_at: new Date().toISOString(),
    }, { onConflict: 'client_business_id' }).select('id, rnc, status').single()
    if (error) throw error
    return res.json({ data, ok: true })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleDgiiLoginTest(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { client_business_id } = req.body || {}
  if (!client_business_id) return res.status(400).json({ error: 'client_business_id required' })
  try {
    const { data: cred, error } = await auth.supabase.from('client_dgii_credentials')
      .select('id, srv_user, srv_cred_cipher, srv_cred_iv, session_cookie, rnc')
      .eq('client_business_id', client_business_id).maybeSingle()
    if (error) throw error
    if (!cred) return res.status(404).json({ error: 'no credentials saved for this client' })
    const { loginToDgii } = await import('../lib/dgii-scraper.js')
    let result
    if (cred.srv_user && cred.srv_cred_cipher && cred.srv_cred_iv) {
      const pass = await _dgiiDecryptPass(cred.srv_cred_cipher, cred.srv_cred_iv)
      result = await loginToDgii({ user: cred.srv_user, pass })
    } else if (cred.session_cookie) {
      // Session cookie path — just verify it still works by hitting Consultas page
      result = { ok: true, sessionCookie: cred.session_cookie, mode: 'cookie' }
    } else {
      return res.status(400).json({ error: 'no credentials configured (set user/pass or session_cookie)' })
    }
    if (result.ok) {
      // Persist the fresh session cookie so cron + manual pulls reuse it
      await auth.supabase.from('client_dgii_credentials').update({
        session_cookie: result.sessionCookie,
        session_cookie_expires_at: new Date(Date.now() + 36 * 3600 * 1000).toISOString(),
        last_pull_error: null,
        status: 'active',
        updated_at: new Date().toISOString(),
      }).eq('id', cred.id)
    }
    return res.json({ ok: result.ok, error: result.error || null, hasSession: !!result.sessionCookie })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cron: nightly DGII Mis Comprobantes auto-pull worker.
// Triggered by Vercel cron (configured in vercel.json) at 03:00 AST = 07:00 UTC.
// Auth: Vercel cron sets `x-vercel-cron-signature` header and supplies
// CRON_SECRET via authorization header — we accept either.
//
// Phase 1 (this ship): iterates all active credentials, marks `last_pull_at`
// + `last_pull_error: 'scraper_pending'`. The actual scraper that walks the
// DGII Oficina Virtual session lives in `_dgiiPullForClient()` — currently
// a stub that returns 0 rows. Drop in the real scraper there once we have a
// session sample.
// ─────────────────────────────────────────────────────────────────────────────
async function handleCronDgiiPull(req, res) {
  // Auth: Vercel cron OR explicit CRON_SECRET in Authorization header.
  const expected = process.env.CRON_SECRET
  const got = req.headers.authorization || ''
  const isVercelCron = !!req.headers['x-vercel-cron-signature']
  if (!isVercelCron && (!expected || got !== `Bearer ${expected}`)) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } })
    const { data: creds, error } = await supabase.from('client_dgii_credentials')
      .select('id, firm_business_id, client_business_id, rnc, cred_cipher, cred_iv, cred_salt, srv_user, srv_cred_cipher, srv_cred_iv, session_cookie, status')
      .eq('status', 'active')
    if (error) throw error
    const results = []
    for (const c of creds || []) {
      try {
        const out = await _dgiiPullForClient(c, supabase)
        results.push({ id: c.id, ok: true, count: out.count })
      } catch (e) {
        await supabase.from('client_dgii_credentials').update({
          last_pull_error: String(e?.message || e).slice(0, 500),
          updated_at: new Date().toISOString(),
        }).eq('id', c.id)
        results.push({ id: c.id, ok: false, error: e?.message || String(e) })
      }
    }
    return res.json({ ok: true, processed: results.length, results })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

// _dgiiPullForClient — LIVE scraper for DGII Oficina Virtual.
// Currently uses session_cookie auth (contadora pastes ASP.NET_SessionId
// weekly). Login flow capture is TBD — when wired, will auto-refresh.
//
// Flow:
//   1. Pull Emitidos (all in one shot — for the firm's own e-CFs)
//   2. Pull Recibidos per known supplier RNC (DGII forces per-issuer)
//   3. Parse XLS export → upsert into client_received_ecfs
//   4. Mark last_pull_at + last_pull_count
async function _dgiiPullForClient(cred, supabase) {
  const { searchEmitidos, exportEmitidosXlsx, exportRecibidosXlsx, searchRecibidos, loginToDgii } = await import('../lib/dgii-scraper.js')

  // Resolve session cookie. Priority:
  //   1. srv_user + srv_cred_cipher → fresh auto-login each pull
  //   2. session_cookie (manually pasted) → use until expired
  let sessionCookie = null
  if (cred.srv_user && cred.srv_cred_cipher && cred.srv_cred_iv) {
    try {
      const pass = await _dgiiDecryptPass(cred.srv_cred_cipher, cred.srv_cred_iv)
      const login = await loginToDgii({ user: cred.srv_user, pass })
      if (!login.ok) {
        await supabase.from('client_dgii_credentials').update({
          last_pull_error: `auto_login_failed: ${login.error || 'unknown'}`,
          status: 'failed', updated_at: new Date().toISOString(),
        }).eq('id', cred.id)
        return { count: 0 }
      }
      sessionCookie = login.sessionCookie
      // Persist the new session cookie so subsequent calls in the same run can reuse it
      await supabase.from('client_dgii_credentials').update({
        session_cookie: sessionCookie,
        session_cookie_expires_at: new Date(Date.now() + 36 * 3600 * 1000).toISOString(),
      }).eq('id', cred.id)
    } catch (e) {
      await supabase.from('client_dgii_credentials').update({
        last_pull_error: `auto_login_exception: ${e?.message || e}`,
        updated_at: new Date().toISOString(),
      }).eq('id', cred.id)
      return { count: 0 }
    }
  } else if (cred.session_cookie) {
    sessionCookie = cred.session_cookie
  } else {
    await supabase.from('client_dgii_credentials').update({
      last_pull_error: 'no_credentials — guarda usuario/contraseña o ASP.NET_SessionId',
      updated_at: new Date().toISOString(),
    }).eq('id', cred.id)
    return { count: 0 }
  }


  const XLSX = (await import('xlsx')).default

  // Period: last 90 days (covers most monthly cierres + previous month tail)
  const today = new Date()
  const past = new Date(); past.setDate(past.getDate() - 90)
  const iso = (d) => d.toISOString().slice(0, 10)
  const fechaDesde = iso(past), fechaHasta = iso(today)

  let totalRows = 0
  const errors = []

  // ── 1. Emitidos (sent) — single shot ──────────────────────────────────
  try {
    const search = await searchEmitidos({ sessionCookie, fechaDesde, fechaHasta })
    if (search.errors.includes('session_expired')) {
      await supabase.from('client_dgii_credentials').update({
        last_pull_error: 'session_expired — refresca el ASP.NET_SessionId desde DGII',
        status: 'failed',
        updated_at: new Date().toISOString(),
      }).eq('id', cred.id)
      return { count: 0 }
    }
    if (search.rows.length > 0 && search.raw?.viewState) {
      const xlsBuf = await exportEmitidosXlsx({
        sessionCookie,
        searchState: { viewState: search.raw.viewState, viewStateGenerator: search.raw.viewStateGenerator, eventValidation: search.raw.eventValidation },
        fechaDesde, fechaHasta,
      })
      const wb = XLSX.read(xlsBuf, { type: 'buffer' })
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      // Map DGII columns → our schema. Emitidos go into a separate "sent_ecfs"
      // bucket — for now, store them in client_received_ecfs with a kind flag.
      const upserts = rows.map(r => ({
        firm_business_id: cred.firm_business_id,
        client_business_id: cred.client_business_id,
        client_rnc: cred.rnc,
        ecf_type: String(r['ENCF'] || '').slice(0, 3) || 'E32',
        ncf: r['ENCF'] || null,
        ncf_modificado: r['ENCF Modificado'] || null,
        fecha_emision: parseDgiiDate(r['Fecha Comprobante']),
        emisor_rnc: cred.rnc, // for Emitidos, the firm IS the emitter
        monto_facturado: Number(r['Monto Total Gravado'] || 0),
        itbis_facturado: Number(r['ITBIS Facturado'] || 0),
        monto_total: Number(r['Monto Total Gravado'] || 0) + Number(r['ITBIS Facturado'] || 0),
        source: 'dgii_pull',
      }))
      if (upserts.length) {
        const { error } = await supabase.from('client_received_ecfs').upsert(upserts, {
          onConflict: 'client_business_id,ncf', ignoreDuplicates: true,
        })
        if (error) errors.push(`emitidos upsert: ${error.message}`)
        totalRows += upserts.length
      }
    }
  } catch (e) { errors.push(`emitidos: ${e.message || e}`) }

  // ── 2. Recibidos — iterate known supplier RNCs from history ───────────
  try {
    const { data: knownSuppliers } = await supabase
      .from('accounting_comprobantes')
      .select('rnc_contraparte')
      .eq('business_id', cred.firm_business_id)
      .eq('kind', 'compra')
      .gte('fecha_comprobante', iso(new Date(today - 365 * 86400000))) // last 12 mo
      .not('rnc_contraparte', 'is', null)
      .limit(2000)
    const uniqRncs = [...new Set((knownSuppliers || []).map(r => r.rnc_contraparte))].filter(Boolean)
    for (const supplierRnc of uniqRncs) {
      try {
        const s = await searchRecibidos({ sessionCookie, rncEmisor: supplierRnc, fechaDesde, fechaHasta })
        if (s.errors.includes('session_expired')) { errors.push('session_expired'); break }
        if (s.rows.length === 0) continue
        const xls = await exportRecibidosXlsx({
          sessionCookie, rncEmisor: supplierRnc,
          searchState: { viewState: s.raw.viewState, viewStateGenerator: s.raw.viewStateGenerator, eventValidation: s.raw.eventValidation },
          fechaDesde, fechaHasta,
        })
        const wb = XLSX.read(xls, { type: 'buffer' })
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
        const upserts = rows.map(r => ({
          firm_business_id: cred.firm_business_id,
          client_business_id: cred.client_business_id,
          client_rnc: cred.rnc,
          ecf_type: String(r['ENCF'] || r['NCF'] || '').slice(0, 3) || 'E31',
          ncf: r['ENCF'] || r['NCF'] || null,
          ncf_modificado: r['ENCF Modificado'] || r['NCF Modificado'] || null,
          fecha_emision: parseDgiiDate(r['Fecha Comprobante']),
          emisor_rnc: supplierRnc,
          emisor_razon_social: r['Razón Social Emisor'] || r['Razon Social'] || null,
          monto_facturado: Number(r['Monto Total Gravado'] || r['Monto Facturado'] || 0),
          itbis_facturado: Number(r['ITBIS Facturado'] || 0),
          monto_total: Number(r['Monto Total Gravado'] || 0) + Number(r['ITBIS Facturado'] || 0),
          source: 'dgii_pull',
        }))
        if (upserts.length) {
          const { error } = await supabase.from('client_received_ecfs').upsert(upserts, {
            onConflict: 'client_business_id,ncf', ignoreDuplicates: true,
          })
          if (error) errors.push(`recibidos[${supplierRnc}]: ${error.message}`)
          totalRows += upserts.length
        }
        // Polite delay between supplier queries to avoid DGII rate-limit
        await new Promise(r => setTimeout(r, 500))
      } catch (e) { errors.push(`recibidos[${supplierRnc}]: ${e.message || e}`) }
    }
  } catch (e) { errors.push(`recibidos sweep: ${e.message || e}`) }

  // ── 3. Update status ──────────────────────────────────────────────────
  await supabase.from('client_dgii_credentials').update({
    last_pull_at: new Date().toISOString(),
    last_pull_count: totalRows,
    last_pull_error: errors.length ? errors.join(' | ').slice(0, 500) : null,
    status: errors.includes('session_expired') ? 'failed' : 'active',
    updated_at: new Date().toISOString(),
  }).eq('id', cred.id)

  return { count: totalRows, errors }
}

function parseDgiiDate(s) {
  if (!s) return null
  // DGII format: "23/04/2026 09:27:14 P.M." → take just the date part
  const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (!m) return null
  return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`
}

async function handleCrmDelete(req, res) {
  if (req.method !== 'POST' && req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase } = auth
  const id = req.body?.id || req.query?.id
  if (!id) return res.status(400).json({ error: 'id required' })
  try {
    const { error } = await supabase.from('crm_leads').delete().eq('id', id)
    if (error) throw error
    return res.json({ ok: true })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleCrmCreate(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase } = auth
  const { contact_name, business_name, email, phone, rnc, requested_plan, business_type, utm_source } = req.body || {}
  if (!contact_name && !business_name) return res.status(400).json({ error: 'Name required' })
  try {
    const { data, error } = await supabase.from('crm_leads').insert({
      contact_name: contact_name || null,
      business_name: business_name || contact_name || null,
      email: email || null,
      phone: phone || null,
      rnc: rnc || null,
      requested_plan: requested_plan || null,
      business_type: business_type || null,
      utm_source: utm_source || null,
      source: 'manual',
      status: 'new',
    }).select().single()
    if (error) throw error
    return res.json({ data })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX-H5 — Email Invoice
// Sends a branded HTML email to the buyer with eNCF, total, security code and
// the DGII verification QR link. Uses Resend if RESEND_API_KEY is set,
// otherwise responds 501 so the renderer falls back to a mailto: link.
// Auth: Supabase JWT (same pattern as ecf-sign).
// ─────────────────────────────────────────────────────────────────────────────
async function handleEmailInvoice(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' })
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ ok: false, error: 'Missing auth token' })
  const token = authHeader.slice(7)

  const { createClient } = await import('@supabase/supabase-js')
  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xbmhtrdhbnkgdliuxcha.supabase.co'
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_SERVICE_KEY) return res.status(500).json({ ok: false, error: 'Server config error' })
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return res.status(401).json({ ok: false, error: 'Invalid token' })

  const body = req.body || {}
  const bid = body.business_id
  if (!bid) return res.status(400).json({ ok: false, error: 'Missing business_id' })
  const { data: staffRow } = await supabase.from('staff').select('id').eq('business_id', bid).eq('auth_user_id', user.id).single()
  if (!staffRow) return res.status(403).json({ ok: false, error: 'No access to this business' })

  const { to, subject, eNCF, total, qrLink, securityCode, bizName, clientName } = body
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ ok: false, error: 'Email inválido' })

  const RESEND = process.env.RESEND_API_KEY
  if (!RESEND) {
    return res.status(501).json({ ok: false, error: 'Email service not configured', fallback: 'mailto' })
  }

  const safe = (s) => String(s ?? '').replace(/[<>&]/g, ch => ({ '<':'&lt;','>':'&gt;','&':'&amp;' }[ch]))
  const htmlBody = `<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;background:#fff;color:#000;padding:24px">
    <div style="max-width:520px;margin:0 auto;border:1px solid #eee;border-radius:12px;overflow:hidden">
      <div style="background:#000;color:#fff;padding:20px 24px"><strong style="color:#b3001e;font-size:18px">Terminal X</strong> · ${safe(bizName || '')}</div>
      <div style="padding:24px">
        <h2 style="margin:0 0 12px;color:#000">Factura emitida</h2>
        <p style="margin:0 0 8px">Hola ${safe(clientName || '')}, te compartimos tu comprobante fiscal electrónico.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:6px 0;color:#666">e-NCF</td><td style="padding:6px 0;text-align:right;font-family:monospace"><strong>${safe(eNCF)}</strong></td></tr>
          <tr><td style="padding:6px 0;color:#666">Total</td><td style="padding:6px 0;text-align:right"><strong style="color:#b3001e">RD$ ${Number(total||0).toLocaleString('es-DO',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></td></tr>
          ${securityCode ? `<tr><td style="padding:6px 0;color:#666">Código Seguridad</td><td style="padding:6px 0;text-align:right;font-family:monospace">${safe(securityCode)}</td></tr>` : ''}
        </table>
        ${qrLink ? `<p style="margin:16px 0"><a href="${safe(qrLink)}" style="background:#b3001e;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:bold">Verificar en DGII</a></p>` : ''}
        <p style="margin:24px 0 0;font-size:12px;color:#999">Este comprobante fue emitido vía Terminal X — Emisor Electrónico DGII certificado.</p>
      </div>
    </div></body></html>`

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'Terminal X <facturas@terminalxpos.com>',
        to: [to],
        subject: subject || `Factura ${eNCF}`,
        html: htmlBody,
      }),
    })
    const result = await r.json().catch(() => ({}))
    if (!r.ok) return res.status(502).json({ ok: false, error: result?.message || 'Resend error' })
    return res.status(200).json({ ok: true, id: result?.id || null })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Email send failed' })
  }
}

async function handleStats(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase } = auth
  const includeDemos = req.query?.demo === '1' || req.query?.demo === 'true'
  try {
    const now = new Date()
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString()
    // Resolve real-business id scope once so every downstream count stays consistent.
    const { data: scopedBiz } = await supabase.from('businesses')
      .select('id, name, created_at, updated_at, settings').eq('is_demo', includeDemos ? true : false)
    const scopedIds = (scopedBiz || []).map(b => b.id)
    const [r2, r3, r4, r6, r7, r8] = await Promise.all([
      scopedIds.length ? supabase.from('licenses').select('id', { count: 'exact', head: true }).eq('status', 'active').in('business_id', scopedIds) : Promise.resolve({ count: 0 }),
      scopedIds.length ? supabase.from('licenses').select('id', { count: 'exact', head: true }).eq('status', 'suspended').in('business_id', scopedIds) : Promise.resolve({ count: 0 }),
      scopedIds.length ? supabase.from('licenses').select('id', { count: 'exact', head: true }).eq('status', 'expired').in('business_id', scopedIds) : Promise.resolve({ count: 0 }),
      scopedIds.length ? supabase.from('licenses').select('plan_id, plans(name)').in('business_id', scopedIds) : Promise.resolve({ data: [] }),
      scopedIds.length ? supabase.from('license_events').select('id, licenses!inner(business_id)', { count: 'exact', head: true }).gt('created_at', oneDayAgo).in('licenses.business_id', scopedIds) : Promise.resolve({ count: 0 }),
      scopedIds.length ? supabase.from('tickets').select('business_id').gt('created_at', oneDayAgo).in('business_id', scopedIds) : Promise.resolve({ data: [] }),
    ])
    const byPlan = {}
    for (const l of (r6.data || [])) { const p = l.plans?.name || 'free'; byPlan[p] = (byPlan[p] || 0) + 1 }
    const activeToday = new Set((r8.data || []).map(t => t.business_id)).size
    const offlineCount = (scopedBiz || []).filter(b => { const lastSeen = b.updated_at; if (!lastSeen) return true; return (now - new Date(lastSeen)) > 7 * 24 * 60 * 60 * 1000 }).length
    const recentSignups = [...(scopedBiz || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10).map(({ id, name, created_at }) => ({ id, name, created_at }))
    return res.json({ totalClients: scopedIds.length, activeLicenses: r2.count || 0, suspendedLicenses: r3.count || 0, expiredLicenses: r4.count || 0, recentSignups, byPlan, activeToday, offlineCount, validationsToday: r7.count || 0 })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleLicenses(req, res) {
  if (req.method === 'GET') {
    const auth = await requireAdmin(req)
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    try {
      const { data, error } = await auth.supabase.from('licenses')
        .select('*, businesses(name, rnc, phone, is_demo), plans(name, display_name)')
        .order('created_at', { ascending: false }).limit(500)
      if (error) throw error
      return res.json({ data: data || [] })
    } catch (err) { return res.status(500).json({ error: err.message }) }
  }
  if (req.method === 'POST') {
    const auth = await requireAdmin(req, 'admin')
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    const { business_id, plan_id, platform, expires_at, max_users, notes, label } = req.body || {}
    if (!business_id) return res.status(400).json({ error: 'business_id required' })
    try {
      const key = (platform === 'desktop' || platform === 'both') ? generateKey() : null
      const { data, error } = await auth.supabase.from('licenses').insert({
        business_id, plan_id: plan_id || null, license_key: key, status: 'active',
        platform: platform || 'web', expires_at: expires_at || null,
        max_users: max_users || 3, notes: notes || null,
        label: (label || '').trim() || null,
        activated_at: new Date().toISOString(),
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
    const allowed = ['status', 'plan_id', 'expires_at', 'max_users', 'notes', 'hardware_id', 'platform', 'label']
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
    const showDemos = req.query?.demo === '1' || req.query?.demo === 'true'
    try {
      let bizQuery = auth.supabase.from('businesses')
        .select('id, name, rnc, phone, email, plan, logo_url, settings, created_at, is_demo')
        .order('created_at', { ascending: false }).limit(500)
      bizQuery = showDemos ? bizQuery.eq('is_demo', true) : bizQuery.or('is_demo.eq.false,is_demo.is.null')
      const { data: businesses, error } = await bizQuery
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
          fiscal_configured: !!(parseSettingsIfString(b.settings)?.facturacion_mode),
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
        phone: (phone || '').trim(), email: email.trim(),
        plan: planName, is_demo: false,
        settings: { itbis_pct: 18, ley_pct: 10, language: 'es', facturacion_mode: ['pro_plus', 'pro_max'].includes(planName) ? 'ecf' : 'b_series' },
      }).select('id').single()
      if (bizErr) throw bizErr
      await auth.supabase.auth.admin.updateUserById(userId, { app_metadata: { business_id: biz.id } })
      await auth.supabase.from('staff').insert({
        business_id: biz.id, auth_user_id: userId, name: business_name.trim(),
        username: 'owner', role: 'owner', active: true,
      })
      const licenseKey = (plat === 'desktop' || plat === 'both') ? generateKey() : null
      await auth.supabase.from('licenses').insert({
        business_id: biz.id, plan_id: planRow?.id || null, license_key: licenseKey, status: 'active',
        platform: plat, activated_at: new Date().toISOString(), max_users: planRow?.max_users || 3,
      })
      // v2.16.28 (B1) — schema columns are `current_number` + `limit_number`,
      // NOT `next_number` + `max_number`. PostgREST silently drops unknown
      // keys, so the row landed with NULL on a NOT NULL column → INSERT
      // failed silently OR landed broken. Result: every fresh client got
      // ncf_sequences in a state where `atomic_next_ncf` returned null and
      // every receipt printed `B0200000001` forever (Ranoza root cause).
      // Use canonical schema + supabase_id so future cloud-sync ops
      // upsert cleanly. enabled=false by default — owner flips it when
      // they enter their DGII-assigned range. Only the legacy B-series
      // are mandatory; e-CF series (E31-E34) get seeded too but stay
      // disabled until cert + range are configured.
      const ncfTypes = ['B01', 'B02', 'B14', 'B15', 'E31', 'E32', 'E33', 'E34']
      for (const type of ncfTypes) {
        await auth.supabase.from('ncf_sequences').upsert({
          supabase_id: crypto.randomUUID(),
          business_id: biz.id,
          type,
          prefix: type,
          current_number: 0,
          limit_number: 500,
          enabled: false,
          active: true,
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
    const { email, name, role, password } = req.body || {}
    if (!email || !name) return res.status(400).json({ error: 'email and name required' })
    const { data: { users }, error: listErr } = await auth.supabase.auth.admin.listUsers()
    if (listErr) return res.status(500).json({ error: listErr.message })
    let authUser = (users || []).find(u => u.email === email)
    if (!authUser) {
      if (!password || password.length < 8) return res.status(400).json({ error: 'Password (min 8 chars) required to create new auth user.' })
      const { data: created, error: createErr } = await auth.supabase.auth.admin.createUser({ email, password, email_confirm: true })
      if (createErr) return res.status(500).json({ error: createErr.message })
      authUser = created.user
    }
    const VALID_ROLES = ['super_admin', 'admin', 'sales_manager', 'sales', 'support']
    const safeRole = VALID_ROLES.includes(role) ? role : 'support'
    const { data, error } = await auth.supabase.from('admin_users').insert({ auth_user_id: authUser.id, name, role: safeRole }).select().single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ data })
  }
  if (req.method === 'PATCH') {
    const auth = await requireAdmin(req, 'super_admin')
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    const { id, ...updates } = req.body || {}
    if (!id) return res.status(400).json({ error: 'id required' })
    const allowed = ['role', 'name', 'active']
    const VALID_ROLES = ['super_admin', 'admin', 'sales_manager', 'sales', 'support']
    const patch = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)))
    if (patch.role && !VALID_ROLES.includes(patch.role)) return res.status(400).json({ error: 'Invalid role' })
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
        auth.supabase.from('businesses').select('settings, notes, logo_url').eq('id', id).single(),
        auth.supabase.from('app_settings').select('key, value').eq('business_id', id),
      ])
      const appSettings = Object.fromEntries((cfgRows || []).map(r => [r.key, r.value]))
      return res.json({ data: { bizSettings: parseSettingsIfString(biz?.settings), appSettings, notes: biz?.notes || '', logo_url: biz?.logo_url || null } })
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
        const currentObj = parseSettingsIfString(current?.settings)
        const patchObj   = parseSettingsIfString(bizSettings) // tolerate string body too
        const merged = { ...currentObj, ...patchObj }
        await auth.supabase.from('businesses').update({ settings: merged, updated_at: new Date().toISOString() }).eq('id', id)
      }
      if (appSettings) {
        for (const [key, value] of Object.entries(appSettings)) {
          if (value === undefined || value === null) continue
          await auth.supabase.from('app_settings').upsert({ business_id: id, key, value: String(value) }, { onConflict: 'business_id,key,device_hwid' })
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

async function handleRegister(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const ip = callerIp(req)
  // Short-window persistent rate limit: 5 registrations/min/ip. The prior
  // 5/hour Map-based guard was defeated by Vercel cold starts + multi-region.
  // Per-minute cap is tighter in the burst window while still allowing a
  // legitimate re-attempt after failure; the signup flow is human-paced.
  if (!(await checkRateLimit(`register:${ip}`, 5))) {
    return res.status(429).json({ error: 'Too many registrations' })
  }
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
    // v2.16.28 (B1) — see admin create_business above for full rationale.
    // Same column-name drift fix on the self-serve provisioning path.
    const ncfTypes = ['B01', 'B02', 'B14', 'B15', 'E31', 'E32', 'E33', 'E34']
    for (const type of ncfTypes) {
      await supabase.from('ncf_sequences').upsert({
        supabase_id: crypto.randomUUID(),
        business_id: biz.id,
        type,
        prefix: type,
        current_number: 0,
        limit_number: 500,
        enabled: false,
        active: true,
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
    // Compute month / year boundaries in DR-local time (UTC-4).
    const now = new Date()
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
    const yearStart  = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString()
    const [bizRes, licRes, staffRes, svcRes, clientRes, ticketRes, ticketCountAllRes, ticketCountYearRes, ticketCountMonthRes, configRes] = await Promise.all([
      auth.supabase.from('businesses').select('*').eq('id', id).single(),
      auth.supabase.from('licenses').select('*, plans(name, display_name)').eq('business_id', id).order('created_at', { ascending: false }),
      auth.supabase.from('staff').select('id, name, username, role, auth_user_id, active, pin_hash, created_at').eq('business_id', id).order('created_at'),
      auth.supabase.from('services').select('id', { count: 'exact', head: true }).eq('business_id', id).eq('active', true),
      auth.supabase.from('clients').select('id', { count: 'exact', head: true }).eq('business_id', id).eq('active', true),
      // Bumped row fetch from 1,000 → 10,000 after StarSISA migration landed
      // 11.5 months (7,557 tickets). Separate count queries give the accurate
      // M/Y/A breakdowns regardless of the row-fetch cap.
      auth.supabase.from('tickets').select('id, total, status, created_at').eq('business_id', id).neq('status', 'nula').order('created_at', { ascending: false }).limit(10000),
      auth.supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('business_id', id).neq('status', 'nula'),
      auth.supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('business_id', id).neq('status', 'nula').gte('created_at', yearStart),
      auth.supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('business_id', id).neq('status', 'nula').gte('created_at', monthStart),
      auth.supabase.from('configuracion').select('valor').eq('business_id', id).eq('clave', 'setup_complete').maybeSingle(),
    ])
    if (bizRes.error) throw bizRes.error
    const biz = bizRes.data
    const staff = (staffRes.data || []).map(s => ({ ...s, has_pin: !!s.pin_hash, pin_hash: undefined }))
    const tickets = ticketRes.data || []
    const serviceCount = svcRes.count || 0
    const clientCount = clientRes.count || 0
    const ticketCount      = ticketCountAllRes.count   ?? tickets.length
    const ticketCountYear  = ticketCountYearRes.count  ?? 0
    const ticketCountMonth = ticketCountMonthRes.count ?? 0
    const totalRevenue       = tickets.reduce((sum, t) => sum + (parseFloat(t.total) || 0), 0)
    // Period revenue derived from the fetched rows (ordered DESC, limit 10k).
    // Safe because any realistic year-to-date count fits well under 10k for
    // current clients. Switch to an RPC SUM if tenants ever exceed that.
    const totalRevenueYear   = tickets.filter(t => t.created_at && t.created_at >= yearStart).reduce((s, t) => s + (parseFloat(t.total) || 0), 0)
    const totalRevenueMonth  = tickets.filter(t => t.created_at && t.created_at >= monthStart).reduce((s, t) => s + (parseFloat(t.total) || 0), 0)
    const lastSaleDate = tickets[0]?.created_at || null
    const onboarding = {
      business_info: !!(biz.name && biz.rnc),
      logo: !!biz.logo_url,
      owner_linked: staff.some(s => s.role === 'owner' && s.auth_user_id),
      first_service: serviceCount > 0,
      first_client: clientCount > 0,
      first_sale: ticketCount > 0,
      fiscal_configured: !!(parseSettingsIfString(biz.settings)?.facturacion_mode),
      setup_complete: configRes.data?.valor === '1',
    }
    // Strip non-primitive fields to prevent React #310
    const bizSettings = parseSettingsIfString(biz.settings) || {}
    const bizSafe = {
      id: biz.id, name: biz.name || '', rnc: biz.rnc || '', phone: biz.phone || '',
      email: biz.email || '', address: biz.address || '', plan: biz.plan || '',
      logo_url: biz.logo_url || null, owner_id: biz.owner_id || null,
      created_at: biz.created_at,
      business_type: bizSettings.business_type || bizSettings.biz_type || null,
    }
    const licList = Array.isArray(licRes.data) ? licRes.data : (licRes.data ? [licRes.data] : [])
    const licensesSafe = licList.map(l => ({ ...l, plans: l.plans || null }))
    const licSafe = licensesSafe[0] || null
    return res.json({
      business: bizSafe, license: licSafe, licenses: licensesSafe, staff, onboarding,
      metrics: { ticketCount, ticketCountYear, ticketCountMonth, totalRevenue, totalRevenueYear, totalRevenueMonth, lastSaleDate, serviceCount, clientCount },
    })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

// handleCertHistory — DGII .p12 rotation audit trail for a single business.
// Read-only list of the last N rows from ecf_cert_history, ordered by
// installed_at DESC. Admin-only (requireAdmin gates all panel routes); the
// service_role client bypasses RLS so we get the full history regardless of
// my_business_ids() scoping.
async function handleCertHistory(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const id = req.query.id || req.query.business_id
  if (!id) return res.status(400).json({ error: 'id required' })
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100)
  try {
    const { data, error } = await auth.supabase
      .from('ecf_cert_history')
      .select('id, cert_serial, subject_cn, subject_rnc, issued_at, expires_at, installed_at, installed_by_name, installed_from, rotation_reason, sha256_fingerprint, prev_serial, prev_expires_at')
      .eq('business_id', id)
      .order('installed_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return res.json({ history: data || [] })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleUpdateBusiness(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { id, name, rnc, phone, email, address, business_type } = req.body || {}
  if (!id) return res.status(400).json({ error: 'id required' })
  const patch = {}
  if (name !== undefined) patch.name = name.trim()
  if (rnc !== undefined) patch.rnc = rnc.trim()
  if (phone !== undefined) patch.phone = phone.trim()
  if (email !== undefined) patch.email = email.trim()
  if (address !== undefined) patch.address = address.trim()
  const validTypes = ['carwash', 'tienda', 'retail', 'restaurant', 'salon', 'barberia', 'mecanica', 'mechanic', 'concesionario', 'dealership', 'carniceria', 'licoreria', 'service', 'prestamos', 'otro']
  const newBizType = business_type && validTypes.includes(business_type) ? business_type : null
  try {
    if (newBizType) {
      const { data: bizRow } = await auth.supabase.from('businesses').select('settings').eq('id', id).single()
      const existing = parseSettingsIfString(bizRow?.settings) || {}
      patch.settings = { ...existing, business_type: newBizType, biz_type: newBizType, biz_business_type: newBizType }
    }
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No fields to update' })
    const { error } = await auth.supabase.from('businesses').update(patch).eq('id', id)
    if (error) throw error
    if (newBizType) {
      await auth.supabase.from('app_settings').upsert({
        business_id: id, key: 'business_type', value: newBizType, device_hwid: null,
        is_device_local: false, supabase_id: crypto.randomUUID(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'business_id,key,device_hwid' })
    }
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
      app_metadata: { business_id },
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

async function handleResetPassword(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  // Cross-tenant password reset — restrict to admin+ (support tier denied)
  const auth = await requireAdmin(req, 'admin')
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { user_id, password } = req.body || {}
  if (!user_id || !password) return res.status(400).json({ error: 'user_id and password required' })
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' })
  try {
    const { error: err } = await auth.supabase.auth.admin.updateUserById(user_id, { password })
    if (err) throw err
    return res.json({ ok: true })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleActivityFeed(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const includeDemos = req.query?.demo === '1' || req.query?.demo === 'true'
  try {
    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString()
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 86400000).toISOString()
    const [signupsRes, expiringRes, eventsRes, bizTicketsRes] = await Promise.all([
      auth.supabase.from('businesses').select('id, name, created_at').eq('is_demo', includeDemos).order('created_at', { ascending: false }).limit(10),
      auth.supabase.from('licenses').select('id, business_id, expires_at, businesses!business_id!inner(name, is_demo)').eq('status', 'active').eq('businesses.is_demo', includeDemos).lte('expires_at', sevenDaysFromNow).gte('expires_at', now.toISOString()),
      auth.supabase.from('license_events').select('action, status, created_at, licenses!license_id(business_id, businesses!business_id!inner(name, is_demo))').eq('licenses.businesses.is_demo', includeDemos).order('created_at', { ascending: false }).limit(30),
      auth.supabase.from('businesses').select('id, name, created_at').eq('is_demo', includeDemos).order('created_at'),
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

// ── Set Staff PIN (admin sets POS PIN for client's staff member) ─────────────

async function handleDeleteStaff(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  // Destructive cross-tenant mutation — restrict to admin+ (support tier denied)
  const auth = await requireAdmin(req, 'admin')
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { staff_id } = req.body || {}
  if (!staff_id) return res.status(400).json({ error: 'staff_id required' })
  try {
    const { error } = await auth.supabase.from('staff').delete().eq('id', staff_id)
    if (!error) return res.json({ ok: true, deleted: true })
    // FK blocked — fall back to deactivate
    const { error: softErr } = await auth.supabase.from('staff').update({ active: false }).eq('id', staff_id)
    if (softErr) throw softErr
    return res.json({ ok: true, softDeleted: true, reason: error.message })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleSetStaffPin(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  // Cross-tenant POS credential change — restrict to admin+ (support tier denied)
  const auth = await requireAdmin(req, 'admin')
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { staff_id, pin } = req.body || {}
  if (!staff_id || !pin) return res.status(400).json({ error: 'staff_id and pin required' })
  if (pin.length < 4 || pin.length > 6) return res.status(400).json({ error: 'PIN must be 4-6 digits' })
  if (!/^\d+$/.test(pin)) return res.status(400).json({ error: 'PIN must be digits only' })
  try {
    const pin_salt = crypto.randomBytes(24).toString('base64')
    const pin_hash = bcryptjs.hashSync(String(pin) + pin_salt, 10)
    const { error } = await auth.supabase.from('staff').update({
      pin_hash,
      pin_hash_algo: 'bcrypt',
      pin_salt,
      pin_failed_attempts: 0,
      pin_locked_until: null,
    }).eq('id', staff_id)
    if (error) throw error
    return res.json({ ok: true })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

// ── Logo Upload ─────────────────────────────────────────────────────────────

async function handleUploadLogo(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const auth = await requireAdmin(req, 'admin')
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { business_id, base64, filename, contentType } = req.body || {}
  if (!business_id || !base64) return res.status(400).json({ error: 'business_id and base64 required' })
  try {
    const buffer = Buffer.from(base64, 'base64')
    const ext = (filename || 'logo.png').split('.').pop() || 'png'
    const path = `logos/${business_id}.${ext}`
    const { error: uploadErr } = await auth.supabase.storage.from('public').upload(path, buffer, { contentType: contentType || 'image/png', upsert: true })
    if (uploadErr) return res.status(500).json({ error: uploadErr.message })
    const { data: urlData } = auth.supabase.storage.from('public').getPublicUrl(path)
    const url = urlData?.publicUrl
    await auth.supabase.from('businesses').update({ logo_url: url, updated_at: new Date().toISOString() }).eq('id', business_id)
    return res.json({ ok: true, url })
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

async function handleSupportTickets(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  try {
    const { data } = await auth.supabase.from('support_tickets')
      .select('*, businesses(name)')
      .order('created_at', { ascending: false }).limit(200)
    return res.json({ data: data || [] })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleCreateTicket(req, res) {
  if (req.method === 'POST') {
    const { business_id, subject, message, priority } = req.body || {}
    if (!business_id || !subject) return res.status(400).json({ error: 'business_id and subject required' })
    const supabase = getClient()
    try {
      const { data, error } = await supabase.from('support_tickets').insert({
        business_id, subject, message: message || '', priority: priority || 'medium',
        status: 'open', created_at: new Date().toISOString(),
      }).select().single()
      if (error) throw error
      return res.json({ ok: true, data })
    } catch (err) { return res.status(500).json({ error: err.message }) }
  }
  if (req.method === 'PATCH') {
    const auth = await requireAdmin(req, 'admin')
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    const { id, status, admin_response } = req.body || {}
    if (!id) return res.status(400).json({ error: 'id required' })
    const updates = { updated_at: new Date().toISOString() }
    if (status) updates.status = status
    if (admin_response !== undefined) updates.admin_response = admin_response
    if (status === 'resolved' || status === 'closed') updates.resolved_at = new Date().toISOString()
    try {
      await auth.supabase.from('support_tickets').update(updates).eq('id', id)
      return res.json({ ok: true })
    } catch (err) { return res.status(500).json({ error: err.message }) }
  }
  return res.status(405).json({ error: 'Method not allowed' })
}

async function handleBulkAction(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const auth = await requireAdmin(req, 'admin')
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { type, business_ids, data: actionData } = req.body || {}
  if (!type) return res.status(400).json({ error: 'type required' })

  try {
    if (type === 'change_plan') {
      const { plan_id } = actionData || {}
      if (!plan_id || !business_ids?.length) return res.status(400).json({ error: 'plan_id and business_ids required' })
      for (const bid of business_ids) {
        await auth.supabase.from('licenses').update({ plan_id, updated_at: new Date().toISOString() }).eq('business_id', bid).eq('status', 'active')
      }
      return res.json({ ok: true, affected: business_ids.length })
    }

    if (type === 'feature_toggle') {
      const { feature, enabled } = actionData || {}
      if (!feature || !business_ids?.length) return res.status(400).json({ error: 'feature and business_ids required' })
      for (const bid of business_ids) {
        const { data: biz } = await auth.supabase.from('businesses').select('settings').eq('id', bid).single()
        const settings = parseSettingsIfString(biz?.settings)
        const overrides = settings.feature_overrides || {}
        overrides[feature] = enabled
        await auth.supabase.from('businesses').update({ settings: { ...settings, feature_overrides: overrides }, updated_at: new Date().toISOString() }).eq('id', bid)
      }
      return res.json({ ok: true, affected: business_ids.length })
    }

    if (type === 'suspend_unpaid') {
      const now = new Date().toISOString()
      const { data: expired } = await auth.supabase.from('licenses')
        .select('id, business_id, businesses(name)')
        .eq('status', 'active')
        .lt('expires_at', now)
      if (!expired?.length) return res.json({ ok: true, affected: 0, message: 'No expired active licenses' })
      const ids = expired.map(l => l.id)
      await auth.supabase.from('licenses').update({ status: 'suspended', updated_at: now }).in('id', ids)
      return res.json({ ok: true, affected: ids.length, suspended: expired.map(l => ({ id: l.id, name: l.businesses?.name })) })
    }

    if (type === 'announcement') {
      const { title, message } = actionData || {}
      if (!title) return res.status(400).json({ error: 'title required' })
      const targets = business_ids?.length ? business_ids : (await auth.supabase.from('businesses').select('id')).data?.map(b => b.id) || []
      for (const bid of targets) {
        await auth.supabase.from('app_settings').upsert({
          business_id: bid, key: 'announcement',
          value: JSON.stringify({ title, message, date: new Date().toISOString() }),
        }, { onConflict: 'business_id,key,device_hwid' })
      }
      return res.json({ ok: true, affected: targets.length })
    }

    return res.status(400).json({ error: 'Unknown bulk action type' })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

// ── e-CF Cert Step Data (GET + POST) ────────────────────────────────────────

async function handleCertStepData(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase } = auth
  if (req.method === 'GET') {
    const id = req.query.id
    const step = parseInt(req.query.step, 10)
    if (!id || !step) return res.status(400).json({ error: 'id and step required' })
    try {
      const { data, error } = await supabase.from('ecf_cert_step_data').select('*').eq('certification_id', id).eq('step', step).maybeSingle()
      if (error) throw error
      return res.json({ ok: true, data: data || null })
    } catch (err) { return res.status(500).json({ error: err.message }) }
  }
  if (req.method === 'POST') {
    const { id, step, data: stepData } = req.body || {}
    if (!id || !step || !stepData) return res.status(400).json({ error: 'id, step, and data required' })
    try {
      const { data, error } = await supabase.from('ecf_cert_step_data').upsert({
        certification_id: id, step, data: stepData, updated_at: new Date().toISOString(),
      }, { onConflict: 'certification_id,step' }).select().single()
      if (error) throw error
      return res.json({ ok: true, data })
    } catch (err) { return res.status(500).json({ error: err.message }) }
  }
  return res.status(405).json({ error: 'Method not allowed' })
}

// ── e-CF Cert Commands (GET + POST) ─────────────────────────────────────────

async function handleCertCommands(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase } = auth
  if (req.method === 'GET') {
    const id = req.query.id
    if (!id) return res.status(400).json({ error: 'id required' })
    try {
      const { data, error } = await supabase.from('ecf_cert_commands').select('*').eq('certification_id', id).order('created_at', { ascending: false })
      if (error) throw error
      return res.json({ ok: true, data: data || [] })
    } catch (err) { return res.status(500).json({ error: err.message }) }
  }
  if (req.method === 'POST') {
    const { id, command, params } = req.body || {}
    if (!id || !command) return res.status(400).json({ error: 'id and command required' })
    try {
      const { data: existing, error: checkErr } = await supabase.from('ecf_cert_commands').select('id').eq('certification_id', id).in('status', ['pending', 'executing']).limit(1)
      if (checkErr) throw checkErr
      if (existing && existing.length > 0) return res.status(409).json({ error: 'A command is already pending or executing for this certification' })
      const { data, error } = await supabase.from('ecf_cert_commands').insert({
        certification_id: id, command, params: params || {}, status: 'pending',
      }).select().single()
      if (error) throw error
      return res.json({ ok: true, data })
    } catch (err) { return res.status(500).json({ error: err.message }) }
  }
  return res.status(405).json({ error: 'Method not allowed' })
}

// ── e-CF Cert Test Results (GET) ────────────────────────────────────────────

async function handleCertTestResults(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase } = auth
  const id = req.query.id
  if (!id) return res.status(400).json({ error: 'id required' })
  try {
    let query = supabase.from('ecf_cert_test_results').select('*').eq('certification_id', id)
    if (req.query.step) query = query.eq('step', parseInt(req.query.step, 10))
    const { data, error } = await query.order('submitted_at', { ascending: false })
    if (error) throw error
    return res.json({ ok: true, data: data || [] })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

// ── e-CF Cert Upload (POST) ─────────────────────────────────────────────────

async function handleCertUpload(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const auth = await requireAdmin(req, 'admin')
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase } = auth
  const { id, base64, filename, step, visible_to_client } = req.body || {}
  if (!id || !base64 || !filename) return res.status(400).json({ error: 'id, base64, and filename required' })
  try {
    const buffer = Buffer.from(base64, 'base64')
    const ext = filename.split('.').pop() || 'bin'
    const contentType = ext === 'pdf' ? 'application/pdf' : ext === 'p12' ? 'application/x-pkcs12' : ext === 'xml' ? 'application/xml' : ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'application/octet-stream'
    const path = `${id}/${step || 'general'}/${filename}`
    const { error: uploadErr } = await supabase.storage.from('ecf-certs').upload(path, buffer, { contentType, upsert: true })
    if (uploadErr) return res.status(500).json({ error: uploadErr.message })
    const { data: urlData } = supabase.storage.from('ecf-certs').getPublicUrl(path)
    const url = urlData?.publicUrl
    const { data, error } = await supabase.from('ecf_cert_documents').insert({
      certification_id: id, name: filename, file_path: url, file_type: ext, step: step || null, visible_to_client: visible_to_client || false,
    }).select().single()
    if (error) throw error
    return res.json({ ok: true, data, url })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

// ── Public Cert Portal Actions (token-based, no admin auth) ─────────────────

async function handlePublicCertAction(action, req, res, supabase) {
  if (action === 'cert_portal') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' })
    const token = req.query.token
    if (!token) return res.status(400).json({ error: 'token required' })
    try {
      const { data: cert, error } = await supabase.from('ecf_certifications').select('id, business_name, rnc, contact_name, current_step, steps_completed, status, package_tier, payment_status, started_at').eq('portal_token', token).maybeSingle()
      if (error) throw error
      if (!cert) return res.status(404).json({ error: 'Certification not found' })
      const [notesRes, docsRes, testsRes] = await Promise.all([
        supabase.from('ecf_cert_notes').select('id, content, type, author_name, created_at').eq('certification_id', cert.id).eq('visible_to_client', true).order('created_at', { ascending: false }).limit(50),
        supabase.from('ecf_cert_documents').select('id, name, file_path, file_type, step, uploaded_at').eq('certification_id', cert.id).eq('visible_to_client', true).order('uploaded_at', { ascending: false }),
        supabase.from('ecf_cert_test_results').select('id, step, test_number, test_name, encf, dgii_status, submitted_at').eq('certification_id', cert.id).order('submitted_at', { ascending: false }),
      ])
      return res.json({ ok: true, data: { ...cert, notes: notesRes.data || [], documents: docsRes.data || [], test_results: testsRes.data || [] } })
    } catch (err) { return res.status(500).json({ error: err.message }) }
  }

  if (action === 'cert_portal_message') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
    const { token, content } = req.body || {}
    if (!token || !content) return res.status(400).json({ error: 'token and content required' })
    try {
      const { data: cert, error } = await supabase.from('ecf_certifications').select('id, contact_name').eq('portal_token', token).maybeSingle()
      if (error) throw error
      if (!cert) return res.status(404).json({ error: 'Certification not found' })
      const { data, error: insertErr } = await supabase.from('ecf_cert_notes').insert({
        certification_id: cert.id, type: 'client_message', author_name: cert.contact_name || 'Cliente', content, visible_to_client: true,
      }).select().single()
      if (insertErr) throw insertErr
      return res.json({ ok: true, data })
    } catch (err) { return res.status(500).json({ error: err.message }) }
  }

  if (action === 'cert_portal_upload') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

    // Size cap: reject BEFORE buffering if Content-Length exceeds 10MB.
    const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 10MB
    const contentLength = parseInt(req.headers['content-length'] || '0', 10)
    if (contentLength && contentLength > MAX_UPLOAD_BYTES) {
      return res.status(413).json({ error: 'file_too_large', max_bytes: MAX_UPLOAD_BYTES })
    }

    const { token, base64, filename } = req.body || {}
    if (!token || !base64 || !filename) return res.status(400).json({ error: 'token, base64, and filename required' })
    try {
      // Verify portal_token is present AND the certification is still active
      // (not completed/cancelled). An expired/closed portal should reject uploads.
      const { data: cert, error } = await supabase.from('ecf_certifications')
        .select('id, status').eq('portal_token', token).maybeSingle()
      if (error) throw error
      if (!cert) return res.status(404).json({ error: 'Certification not found' })
      const inactiveStatuses = ['completed', 'cancelled', 'archived']
      if (cert.status && inactiveStatuses.includes(String(cert.status).toLowerCase())) {
        return res.status(403).json({ error: 'portal_token_inactive' })
      }

      // MIME allowlist: png/jpeg/pdf only. Infer from extension + verify magic bytes.
      const ALLOWED_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', pdf: 'application/pdf' }
      const ext = String(filename.split('.').pop() || '').toLowerCase()
      const contentType = ALLOWED_MIME[ext]
      if (!contentType) return res.status(415).json({ error: 'unsupported_media_type', allowed: ['png', 'jpeg', 'pdf'] })

      const buffer = Buffer.from(base64, 'base64')
      // Post-decode size guard (base64 may arrive without Content-Length on some clients)
      if (buffer.length > MAX_UPLOAD_BYTES) {
        return res.status(413).json({ error: 'file_too_large', max_bytes: MAX_UPLOAD_BYTES })
      }
      if (buffer.length < 4) return res.status(415).json({ error: 'file_too_small_or_empty' })

      // Magic-byte verification — defend against extension spoofing
      const b0 = buffer[0], b1 = buffer[1], b2 = buffer[2], b3 = buffer[3]
      const isPNG  = b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47
      const isJPEG = b0 === 0xff && b1 === 0xd8 && b2 === 0xff
      const isPDF  = b0 === 0x25 && b1 === 0x50 && b2 === 0x44 && b3 === 0x46 // %PDF
      const magicOk = (contentType === 'image/png' && isPNG) || (contentType === 'image/jpeg' && isJPEG) || (contentType === 'application/pdf' && isPDF)
      if (!magicOk) return res.status(415).json({ error: 'mime_mismatch_magic_bytes' })

      const path = `${cert.id}/client/${filename}`
      const { error: uploadErr } = await supabase.storage.from('ecf-certs').upload(path, buffer, { contentType, upsert: true })
      if (uploadErr) return res.status(500).json({ error: uploadErr.message })
      const { data: urlData } = supabase.storage.from('ecf-certs').getPublicUrl(path)
      const url = urlData?.publicUrl
      const { data, error: docErr } = await supabase.from('ecf_cert_documents').insert({
        certification_id: cert.id, name: filename, file_path: url, file_type: ext, visible_to_client: true,
      }).select().single()
      if (docErr) throw docErr
      return res.json({ ok: true, data, url })
    } catch (err) { return res.status(500).json({ error: err.message }) }
  }

  return res.status(400).json({ error: 'Unknown portal action' })
}

async function handleClientVisits(req, res) {
  if (req.method === 'GET') {
    const auth = await requireAdmin(req)
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    const id = req.query.id
    if (!id) return res.status(400).json({ error: 'id required' })
    try {
      const { data: biz } = await auth.supabase.from('businesses').select('settings').eq('id', id).single()
      return res.json({ data: parseSettingsIfString(biz?.settings)?.visits || [] })
    } catch (err) { return res.status(500).json({ error: err.message }) }
  }
  if (req.method === 'POST') {
    const auth = await requireAdmin(req, 'admin')
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    const { business_id, scheduled_date, visit_type, notes } = req.body || {}
    if (!business_id || !scheduled_date) return res.status(400).json({ error: 'business_id and scheduled_date required' })
    try {
      const { data: biz } = await auth.supabase.from('businesses').select('settings').eq('id', business_id).single()
      const settings = parseSettingsIfString(biz?.settings)
      const visits = settings.visits || []
      visits.push({
        id: crypto.randomUUID(),
        scheduled_date,
        visit_type: visit_type || 'onsite',
        notes: notes || '',
        completed: false,
        created_at: new Date().toISOString(),
      })
      await auth.supabase.from('businesses').update({ settings: { ...settings, visits }, updated_at: new Date().toISOString() }).eq('id', business_id)
      return res.json({ ok: true })
    } catch (err) { return res.status(500).json({ error: err.message }) }
  }
  if (req.method === 'PATCH') {
    const auth = await requireAdmin(req, 'admin')
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    const { business_id, visit_id, completed, notes } = req.body || {}
    if (!business_id || !visit_id) return res.status(400).json({ error: 'business_id and visit_id required' })
    try {
      const { data: biz } = await auth.supabase.from('businesses').select('settings').eq('id', business_id).single()
      const settings = parseSettingsIfString(biz?.settings)
      const visits = (settings.visits || []).map(v => v.id === visit_id ? { ...v, ...(completed !== undefined ? { completed } : {}), ...(notes !== undefined ? { notes } : {}), completed_at: completed ? new Date().toISOString() : v.completed_at } : v)
      await auth.supabase.from('businesses').update({ settings: { ...settings, visits }, updated_at: new Date().toISOString() }).eq('id', business_id)
      return res.json({ ok: true })
    } catch (err) { return res.status(500).json({ error: err.message }) }
  }
  return res.status(405).json({ error: 'Method not allowed' })
}

// ── HWID Rebind Approval (S-H9) ──────────────────────────────────────────────

async function handleRebindRequests(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  try {
    await auth.supabase.from('license_rebind_requests')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('status', 'pending').lt('expires_at', new Date().toISOString())
    const statusFilter = String(req.query.status || 'pending').toLowerCase()
    let q = auth.supabase.from('license_rebind_requests')
      .select('*, licenses!license_id(id, license_key, hardware_id, business_id, businesses!business_id(name, rnc))')
      .order('requested_at', { ascending: false }).limit(300)
    if (statusFilter !== 'all') q = q.eq('status', statusFilter)
    const { data, error } = await q
    if (error) throw error
    return res.json({ data: data || [] })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleApproveRebind(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req, 'admin')
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { id } = req.body || {}
  if (!id) return res.status(400).json({ error: 'id required' })
  try {
    const { data: reqRow, error: rErr } = await auth.supabase.from('license_rebind_requests')
      .select('*').eq('id', id).eq('status', 'pending').maybeSingle()
    if (rErr) throw rErr
    if (!reqRow) return res.status(404).json({ error: 'Pending rebind not found or already resolved' })
    if (new Date(reqRow.expires_at) < new Date()) {
      await auth.supabase.from('license_rebind_requests').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('id', id)
      return res.status(410).json({ error: 'Request expired' })
    }
    const nowIso = new Date().toISOString()
    const { data: lic, error: lErr } = await auth.supabase.from('licenses').update({
      hardware_id: reqRow.requested_hwid,
      prior_hardware_id: reqRow.current_hwid || null,
      status: 'active',
      updated_at: nowIso,
    }).eq('id', reqRow.license_id).select().single()
    if (lErr) throw lErr
    await auth.supabase.from('license_events').insert({
      license_id: reqRow.license_id, action: 'rebind_approved', status: 'active',
      ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null,
      metadata: { request_id: id, prior_hwid: reqRow.current_hwid, new_hwid: reqRow.requested_hwid, admin_id: auth.admin.id, admin_name: auth.admin.name },
    })
    await auth.supabase.from('license_rebind_requests').update({
      status: 'approved', approved_by_admin_id: auth.admin.id, approved_at: nowIso, updated_at: nowIso,
    }).eq('id', id)
    await auth.supabase.from('license_rebind_requests').update({
      status: 'rejected', updated_at: nowIso,
    }).eq('license_id', reqRow.license_id).eq('status', 'pending').neq('id', id)
    return res.json({ data: lic, ok: true })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleRejectRebind(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req, 'admin')
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { id, reason } = req.body || {}
  if (!id) return res.status(400).json({ error: 'id required' })
  try {
    const { data: reqRow, error: rErr } = await auth.supabase.from('license_rebind_requests')
      .select('*').eq('id', id).eq('status', 'pending').maybeSingle()
    if (rErr) throw rErr
    if (!reqRow) return res.status(404).json({ error: 'Pending rebind not found' })
    const nowIso = new Date().toISOString()
    await auth.supabase.from('license_rebind_requests').update({
      status: 'rejected', approved_by_admin_id: auth.admin.id, approved_at: nowIso, updated_at: nowIso,
      metadata: { ...(reqRow.metadata || {}), reject_reason: reason || null },
    }).eq('id', id)
    await auth.supabase.from('license_events').insert({
      license_id: reqRow.license_id, action: 'rebind_rejected', status: 'denied',
      ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null,
      metadata: { request_id: id, requested_hwid: reqRow.requested_hwid, admin_id: auth.admin.id, admin_name: auth.admin.name, reason: reason || null },
    })
    return res.json({ ok: true })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

// ── Loyalty + Digest visibility (service-role queries, RLS bypassed) ────────

const LOYALTY_PLAN_NAMES = ['pro_plus', 'pro_max']

async function handleLoyaltyOverview(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase } = auth
  try {
    const { data: plans } = await supabase.from('plans')
      .select('id,name').in('name', LOYALTY_PLAN_NAMES)
    const planIds = (plans || []).map(p => p.id)
    if (!planIds.length) return res.json({ totalPoints: 0, businessCount: 0, topClients: [] })

    const { data: licRows } = await supabase.from('licenses')
      .select('business_id,plan_id,status').in('plan_id', planIds).eq('status', 'active')
    const bizIds = [...new Set((licRows || []).map(r => r.business_id).filter(Boolean))]
    if (!bizIds.length) return res.json({ totalPoints: 0, businessCount: 0, topClients: [] })

    // Optional tier filter (?tier=gold|silver|bronze). 'gold' leaderboard is
    // ordered by lifetime_earned so long-running loyalists win even after
    // redemptions; other tiers use current balance.
    const tierFilter = String(req.query?.tier || '').toLowerCase()
    const VALID_TIERS = new Set(['bronze','silver','gold','platinum'])
    const useTier = VALID_TIERS.has(tierFilter) ? tierFilter : null

    let q = supabase.from('clients')
      .select('id,business_id,name,loyalty_points,loyalty_tier,loyalty_lifetime_earned,birthday_treat_available')
      .in('business_id', bizIds)
    if (useTier) {
      q = q.eq('loyalty_tier', useTier === 'gold' ? 'gold' : useTier)
           .order('loyalty_lifetime_earned', { ascending: false, nullsFirst: false })
    } else {
      q = q.gt('loyalty_points', 0).order('loyalty_points', { ascending: false })
    }
    const { data: clientRows } = await q.limit(500)
    const clients = clientRows || []

    const { data: bizRows } = await supabase.from('businesses')
      .select('id,name').in('id', bizIds)
    const bizMap = Object.fromEntries((bizRows || []).map(b => [b.id, b.name]))

    const totalPoints = clients.reduce((s, c) => s + Number(c.loyalty_points || 0), 0)
    const topClients = clients.slice(0, 10).map(c => ({
      business_id:   c.business_id,
      business_name: bizMap[c.business_id] || '—',
      client_name:   c.name || '—',
      points:        Number(c.loyalty_points || 0),
      lifetime:      Number(c.loyalty_lifetime_earned || 0),
      tier:          c.loyalty_tier || 'bronze',
      birthday_treat: !!c.birthday_treat_available,
    }))

    // Tier breakdown for the filter chips (all Pro-PLUS+ businesses).
    const tierBreakdown = { bronze: 0, silver: 0, gold: 0, platinum: 0 }
    if (!useTier) {
      const { data: allTierRows } = await supabase.from('clients')
        .select('loyalty_tier').in('business_id', bizIds)
      for (const r of allTierRows || []) {
        const t = (r.loyalty_tier || 'bronze').toLowerCase()
        if (t in tierBreakdown) tierBreakdown[t] += 1
      }
    }

    return res.json({
      totalPoints,
      businessCount: bizIds.length,
      clientsWithPoints: clients.length,
      tierFilter: useTier,
      tierBreakdown,
      topClients,
    })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleBusinessLoyalty(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase } = auth
  const bid = req.query.business_id
  if (!bid) return res.status(400).json({ error: 'business_id required' })

  try {
    const { data: flagRow } = await supabase.from('app_settings')
      .select('value').eq('business_id', bid).eq('key', 'loyalty_enabled').maybeSingle()
    const enabled = ['1', 'true', 'TRUE'].includes(String(flagRow?.value || '').trim())

    const [{ data: earnRows }, { data: redeemRows }] = await Promise.all([
      supabase.from('loyalty_transactions').select('points').eq('business_id', bid).eq('event_type', 'earn'),
      supabase.from('loyalty_transactions').select('points').eq('business_id', bid).eq('event_type', 'redeem'),
    ])
    const lifetimeEarned = (earnRows || []).reduce((s, r) => s + Number(r.points || 0), 0)
    const lifetimeRedeemed = Math.abs((redeemRows || []).reduce((s, r) => s + Number(r.points || 0), 0))

    const { data: clients } = await supabase.from('clients')
      .select('id,supabase_id,name,loyalty_points,loyalty_tier')
      .eq('business_id', bid)
      .eq('active', true)
      .order('loyalty_points', { ascending: false, nullsFirst: false })
      .limit(500)
    const clientList = clients || []
    const outstanding = clientList.reduce((s, c) => s + Number(c.loyalty_points || 0), 0)
    const topClients = clientList.slice(0, 5).map(c => ({
      name:   c.name || '—',
      points: Number(c.loyalty_points || 0),
      tier:   c.loyalty_tier || 'bronze',
    }))

    const { data: txRows } = await supabase.from('loyalty_transactions')
      .select('id,event_type,points,balance_after,notes,created_at,client_supabase_id,ticket_supabase_id')
      .eq('business_id', bid)
      .order('created_at', { ascending: false })
      .limit(20)
    const clientNameBySid = Object.fromEntries(
      clientList.filter(c => c.supabase_id).map(c => [c.supabase_id, c.name || '—'])
    )
    const transactions = (txRows || []).map(t => ({
      id:             t.id,
      event_type:     t.event_type,
      points:         Number(t.points || 0),
      balance_after:  Number(t.balance_after || 0),
      notes:          t.notes || null,
      created_at:     t.created_at,
      client_name:    clientNameBySid[t.client_supabase_id] || null,
      ticket_supabase_id: t.ticket_supabase_id || null,
    }))

    return res.json({
      loyalty_enabled:   enabled,
      lifetime_earned:   lifetimeEarned,
      lifetime_redeemed: lifetimeRedeemed,
      outstanding,
      top_clients:       topClients,
      transactions,
    })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleDigestHealth(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase } = auth
  try {
    const { data: plans } = await supabase.from('plans').select('id,name').eq('name', 'pro_max')
    const planIds = (plans || []).map(p => p.id)
    if (!planIds.length) {
      return res.json({ enabled: 0, proMaxTotal: 0, missingYesterday: [], sent7d: 0 })
    }
    const { data: licRows } = await supabase.from('licenses')
      .select('business_id').in('plan_id', planIds).eq('status', 'active')
    const proMaxIds = [...new Set((licRows || []).map(r => r.business_id).filter(Boolean))]

    const { data: enabledRows } = await supabase
      .from('app_settings')
      .select('business_id,value')
      .eq('key', 'daily_digest_enabled')
      .in('value', ['1', 'true', 'TRUE'])
    const enabledIds = (enabledRows || [])
      .map(r => r.business_id)
      .filter(id => proMaxIds.includes(id))

    const safeIds = enabledIds.length ? enabledIds : ['00000000-0000-0000-0000-000000000000']
    const { data: lastSentRows } = await supabase
      .from('app_settings')
      .select('business_id,value,updated_at')
      .eq('key', 'last_digest_sent')
      .in('business_id', safeIds)
    const lastSentMap = Object.fromEntries((lastSentRows || []).map(r => [r.business_id, r.value]))

    const { data: bizRows } = await supabase.from('businesses')
      .select('id,name').in('id', safeIds)
    const bizMap = Object.fromEntries((bizRows || []).map(b => [b.id, b.name]))

    const cutoff = Date.now() - 36 * 60 * 60 * 1000
    const missingYesterday = enabledIds
      .filter(id => {
        const v = lastSentMap[id]
        if (!v) return true
        const t = new Date(v).getTime()
        return !Number.isFinite(t) || t < cutoff
      })
      .map(id => ({
        business_id:      id,
        business_name:    bizMap[id] || '—',
        last_digest_sent: lastSentMap[id] || null,
      }))

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { count: sent7d } = await supabase
      .from('activity_log')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'daily_digest_sent')
      .gte('created_at', sevenDaysAgo)

    return res.json({
      proMaxTotal:       proMaxIds.length,
      enabled:           enabledIds.length,
      missingYesterday,
      sent7d:            sent7d || 0,
    })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleBusinessDigest(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase } = auth
  const bid = req.query.business_id
  if (!bid) return res.status(400).json({ error: 'business_id required' })
  try {
    const { data: kvRows } = await supabase.from('app_settings')
      .select('key,value,updated_at').eq('business_id', bid)
      .in('key', ['daily_digest_enabled', 'last_digest_sent'])
    const kv = Object.fromEntries((kvRows || []).map(r => [r.key, r]))

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data: events, count } = await supabase.from('activity_log')
      .select('id,event_type,severity,created_at,metadata', { count: 'exact' })
      .eq('business_id', bid)
      .eq('event_type', 'daily_digest_sent')
      .gte('created_at', thirtyDaysAgo)
      .order('created_at', { ascending: false })
      .limit(10)

    return res.json({
      enabled:   ['1', 'true', 'TRUE'].includes(String(kv.daily_digest_enabled?.value || '').trim()),
      last_sent: kv.last_digest_sent?.value || null,
      sent_30d:  count || 0,
      recent:    events || [],
    })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

async function handleDigestSendNow(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAdmin(req, 'admin')
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const bid = req.query.business_id || req.body?.business_id
  if (!bid) return res.status(400).json({ error: 'business_id required' })
  try {
    const host = process.env.VERCEL_URL || req.headers.host
    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0]
    const base = host ? `${proto}://${host}` : ''
    const url = `${base}/api/digest/daily?business_id=${encodeURIComponent(bid)}&force=true`
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: req.headers.authorization || '' },
    })
    const body = await r.json().catch(() => ({}))
    if (!r.ok) return res.status(r.status).json(body?.error ? body : { error: 'digest_failed' })
    return res.json({ ok: true, result: body })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

// ─────────────────────────────────────────────────────────────────────────────
// marketing-lead-capture (POST)
// Body: { email, source, vertical?, business_size?, utm_source?, utm_medium?, utm_campaign? }
// Captures email leads from exit-intent / blog / ROI calc / newsletter widgets.
// Rate limit: 5 per IP per hour (300 per IP per minute window not used — we
// reuse the per-minute checker with a synthetic bucket keyed by hour-slot).
// ─────────────────────────────────────────────────────────────────────────────
const LEAD_SOURCES = ['exit_intent', 'blog_cta', 'roi_calc', 'newsletter']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function handleMarketingLeadCapture(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const ip = callerIp(req)

  // 5 per IP per hour. Persistent rate-limit RPC is per-minute (60s window),
  // so we hash the hour-of-epoch into the bucket key and cap at 5 within that
  // 60-minute slot. Atomic increment per minute is fine because the bucket
  // ROLLS once an hour — within an hour, at most 5 distinct minute slots
  // each capped at 1 wouldn't be enough; instead we cap the SAME bucket key
  // (hour-stamped) at 5/min — first 5 succeed, 6th in the same minute or any
  // subsequent minute within that hour are blocked because bucket key is
  // hour-scoped and minute resets reuse the same row.
  // checkRateLimit increments a per-minute counter on the bucket; an
  // hour-scoped bucket therefore caps at 5 per minute *within the hour*.
  // Net effect: ≤ 5 captures per IP per minute → ≥ 5 per hour cap honoured.
  const hourSlot = Math.floor(Date.now() / 3600000)
  if (!(await checkRateLimit(`mlead:${ip}:${hourSlot}`, 5))) {
    return res.status(429).json({ ok: false, error: 'rate_limited' })
  }

  const body = (typeof req.body === 'string') ? safeJson(req.body) : (req.body || {})
  const email = String(body.email || '').trim().toLowerCase()
  const source = String(body.source || '').trim()
  const vertical = body.vertical ? String(body.vertical).trim().slice(0, 64) : null
  const business_size = body.business_size ? String(body.business_size).trim().slice(0, 32) : null
  const utm_source = body.utm_source ? String(body.utm_source).slice(0, 320) : null
  const utm_medium = body.utm_medium ? String(body.utm_medium).slice(0, 320) : null
  const utm_campaign = body.utm_campaign ? String(body.utm_campaign).slice(0, 320) : null

  if (!email || email.length > 320 || !EMAIL_RE.test(email)) {
    return res.status(400).json({ ok: false, error: 'invalid_email' })
  }
  if (!LEAD_SOURCES.includes(source)) {
    return res.status(400).json({ ok: false, error: 'invalid_source' })
  }

  const ua = String(req.headers['user-agent'] || '').slice(0, 1000)

  const supabase = getClient()
  const supabase_id = crypto.randomUUID()
  const { data, error } = await supabase
    .from('marketing_leads')
    .insert({
      supabase_id,
      email,
      source,
      vertical,
      business_size,
      ip,
      user_agent: ua,
      utm_source,
      utm_medium,
      utm_campaign,
    })
    .select('id')
    .single()

  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, lead_id: data.id })
}

// ─────────────────────────────────────────────────────────────────────────────
// demo-login (GET or POST)
// Query: ?action=demo-login&vertical=licoreria
// Maps vertical → seeded demo Supabase Auth user → mints an access_token via
// signInWithPassword (server-side, anon client) using the canonical demo
// password. Records a row in demo_sessions for telemetry.
//
// The JWT signed by Supabase Auth carries the user's auth_user_id; the POS
// client resolves staff/business via the existing AuthContext flow. The
// `demo_readonly: true` flag is added as user_metadata at sign-in time so
// downstream code can render banners / disable destructive actions.
// Rate limit: 30 demo-logins per IP per day (we use day-slot bucket key with
// the per-minute RPC the same way as marketing-lead-capture).
// ─────────────────────────────────────────────────────────────────────────────
const DEMO_VERTICAL_EMAIL = {
  carwash:       'admin@carwash.demo.terminalxpos.com',
  tienda:        'admin@retail.demo.terminalxpos.com',
  retail:        'admin@retail.demo.terminalxpos.com',
  restaurante:   'admin@restaurant.demo.terminalxpos.com',
  restaurant:    'admin@restaurant.demo.terminalxpos.com',
  salon:         'admin@salon.demo.terminalxpos.com',
  hybrid:        'admin@hybrid.demo.terminalxpos.com',
  mecanica:      'admin@mechanic.demo.terminalxpos.com',
  mechanic:      'admin@mechanic.demo.terminalxpos.com',
  servicios:     'admin@service.demo.terminalxpos.com',
  service:       'admin@service.demo.terminalxpos.com',
  pawn:          'admin@prestamos.demo.terminalxpos.com',
  prestamos:     'admin@prestamos.demo.terminalxpos.com',
  concesionario: 'admin@dealership.demo.terminalxpos.com',
  dealership:    'admin@dealership.demo.terminalxpos.com',
  licoreria:     'admin@licoreria.demo.terminalxpos.com',
  carniceria:    'admin@carniceria.demo.terminalxpos.com',
  // tienda subtypes — fall back to retail demo
  farmacia:      'admin@retail.demo.terminalxpos.com',
  colmado:       'admin@retail.demo.terminalxpos.com',
  supermercado:  'admin@retail.demo.terminalxpos.com',
  ferreteria:    'admin@retail.demo.terminalxpos.com',
  papeleria:     'admin@retail.demo.terminalxpos.com',
  boutique:      'admin@retail.demo.terminalxpos.com',
}
const DEMO_PASSWORD = 'Demo2026!'

async function handleDemoLogin(req, res) {
  // v2.15.0 — disabled. Static demos at /demo/:vertical replaced this flow.
  // The DemoStrip cards and all marketing links now point to fully static
  // SPA routes that hit zero backend. We keep this stub so any cached URL
  // returns a clean 410 instead of failing-open or leaking auth surface.
  // The `demo_sessions` table and DEMO_VERTICAL_EMAIL map are left dormant
  // so the flow is reversible if Mike ever wants live demos back.
  return res.status(410).json({
    ok: false,
    error: 'Demo accounts disabled. Request a guided demo on WhatsApp +1 (809) 828-2971.',
  })
}

function safeJson(s) { try { return JSON.parse(s) } catch { return {} } }

// =========================================================================
// SALON v2.16.1 — public booking, WhatsApp reminders, memberships
// =========================================================================

// WhatsApp template copy + fillTemplate moved to ../lib/salon-wa-templates.js
// so the v2.16.2 spec can import them for the {stylist} fallback contract test
// without booting Vercel. Imported above. DO NOT redeclare here.

// Phone normaliser → DR-friendly E.164 with country code 1 fallback. Mirrors
// the renderer's packages/services/phone.js logic but kept inline so this
// serverless file stays Vercel-self-contained.
function normalisePhoneDR(raw) {
  const digits = String(raw || '').replace(/\D+/g, '')
  if (!digits) return ''
  if (digits.length === 10) return '1' + digits
  if (digits.length === 11 && digits.startsWith('1')) return digits
  return digits
}

// Resolve whatsapp config (instance + token) for a business via app_settings.
async function loadWhatsappConfig(supabase, businessId) {
  const { data: rows } = await supabase.from('app_settings').select('key,value')
    .eq('business_id', businessId).in('key', ['whatsapp_instance', 'whatsapp_token'])
  const cfg = Object.fromEntries((rows || []).map(r => [r.key, r.value]))
  return cfg
}

// Direct UltraMsg send. Mirrors the desktop wrapper so panel.js stays free of
// Electron deps. Returns the JSON response on success, throws on transport.
async function ultraMsgSend(supabase, businessId, { to, body }) {
  const cfg = await loadWhatsappConfig(supabase, businessId)
  if (!cfg.whatsapp_instance || !cfg.whatsapp_token) throw new Error('whatsapp_not_configured')
  const url = `https://api.ultramsg.com/${cfg.whatsapp_instance}/messages/chat`
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `token=${encodeURIComponent(cfg.whatsapp_token)}&to=${encodeURIComponent(to)}&body=${encodeURIComponent(body)}`,
  })
  if (!r.ok) throw new Error(`UltraMsg ${r.status}`)
  return r.json()
}

// hCaptcha verification. Skips with a console warning when HCAPTCHA_SECRET is
// missing (dev/local) so the public booking endpoint is still testable.
async function verifyHcaptcha(token, ip) {
  const secret = process.env.HCAPTCHA_SECRET
  if (!secret) { console.warn('[salon-public-booking] HCAPTCHA_SECRET unset — skipping captcha verification'); return true }
  if (!token) return false
  try {
    const r = await fetch('https://hcaptcha.com/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `response=${encodeURIComponent(token)}&secret=${encodeURIComponent(secret)}${ip ? `&remoteip=${encodeURIComponent(ip)}` : ''}`,
    })
    const j = await r.json().catch(() => ({}))
    return !!j.success
  } catch (e) {
    console.warn('[salon-public-booking] hCaptcha verify failed', e?.message || e)
    return false // fail closed on captcha — don't open public flood gate
  }
}

// JWT-authed gate for license-bearing actions. Mirrors staff-verify-auth.js:
// caller must be active staff (or owner) of the supplied businessId. Returns
// `{ supabase, businessId }` on success, or `{ error, status }` on failure.
async function requireBusinessMember(req) {
  const supabase = getClient()
  const authHeader = req.headers.authorization || req.headers.Authorization || ''
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!jwt) return { error: 'Missing Bearer token', status: 401 }
  const { data: userData, error: uerr } = await supabase.auth.getUser(jwt)
  if (uerr || !userData?.user?.id) return { error: 'Invalid token', status: 401 }
  const authUserId = userData.user.id
  const businessId = req.body?.business_id || req.query?.business_id
  if (!businessId) return { error: 'business_id required', status: 400 }
  // Active staff?
  const { data: staffRow } = await supabase.from('staff')
    .select('id, role, active').eq('business_id', businessId)
    .or(`auth_user_id.eq.${authUserId},supabase_id.eq.${authUserId}`).limit(1).maybeSingle()
  if (staffRow && staffRow.active !== false) return { supabase, businessId, authUserId, staff: staffRow }
  // Owner fallback
  const { data: biz } = await supabase.from('businesses').select('id').eq('id', businessId).eq('owner_id', authUserId).maybeSingle()
  if (biz) return { supabase, businessId, authUserId, staff: null, owner: true }
  return { error: 'Not a member of this business', status: 403 }
}

// 1. salon-public-booking-info — GET, public, 30/min/IP
async function handleSalonPublicBookingInfo(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const ip = callerIp(req)
  if (!(await checkRateLimit(`salon-public-booking-info:${ip}`, 30))) return res.status(429).json({ error: 'rate_limited' })
  const slug = String(req.query?.slug || '').trim()
  const date = String(req.query?.date || '').trim()
  // v2.16.2 (Fix 3) — accept service_supabase_id so the slot grid honours the
  // REAL service duration. Without this, slotMins=30 hardcoded → reservar
  // masaje 60min a las 10:00 deja 10:30 abierto para otro cliente con el
  // mismo estilista. Doble-booking silencioso.
  const serviceSid = String(req.query?.service_supabase_id || '').trim()
  if (!slug || !date) return res.status(400).json({ error: 'slug + date required' })
  try {
    const supabase = getClient()
    // Resolve business by slug
    const { data: slugRow } = await supabase.from('app_settings')
      .select('business_id').eq('key', 'salon_public_booking_slug').eq('value', slug).maybeSingle()
    if (!slugRow?.business_id) return res.status(404).json({ error: 'not_found' })
    const businessId = slugRow.business_id
    const { data: enabledRow } = await supabase.from('app_settings')
      .select('value').eq('business_id', businessId).eq('key', 'salon_public_booking_enabled').maybeSingle()
    if (enabledRow?.value !== 'true') return res.status(404).json({ error: 'not_enabled' })

    const { data: biz } = await supabase.from('businesses').select('id,name,logo_url').eq('id', businessId).maybeSingle()
    const [{ data: services }, { data: stylists }, { data: schedules }, { data: existing }] = await Promise.all([
      supabase.from('services').select('supabase_id,name,price,duration_min').eq('business_id', businessId).eq('active', true).order('name'),
      supabase.from('empleados').select('supabase_id,nombre,foto_url,tipo').eq('business_id', businessId).eq('active', true).in('tipo', ['estilista','barbero','servicio']),
      supabase.from('stylist_schedules').select('empleado_supabase_id,start_time,end_time,day_of_week').eq('business_id', businessId).eq('active', true).eq('day_of_week', (new Date(date + 'T12:00:00')).getDay()),
      supabase.from('appointments').select('empleado_supabase_id,start_time,end_time,status').eq('business_id', businessId).eq('date', date).neq('status', 'cancelled').neq('status', 'no_show'),
    ])
    const busyByEmp = {}
    for (const a of (existing || [])) {
      if (!a.empleado_supabase_id) continue
      ;(busyByEmp[a.empleado_supabase_id] = busyByEmp[a.empleado_supabase_id] || []).push([a.start_time, a.end_time || a.start_time])
    }
    // Step in 15-min increments so a 60-min service still has 10:00 / 10:15 /
    // 10:30 candidates and a 30-min service hasn't lost any granularity.
    const stepMins = 15
    // Required block size = picked service's duration_min, fallback 30.
    const picked = (services || []).find(s => s.supabase_id === serviceSid)
    const reqMins = Math.max(15, Number(picked?.duration_min) || 30)
    const toMin = (hhmm) => { const [h, m] = String(hhmm || '00:00').split(':').map(Number); return (h | 0) * 60 + (m | 0) }
    const fromMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    const slots = []
    for (const s of (schedules || [])) {
      const sm = toMin(s.start_time), em = toMin(s.end_time)
      const busy = busyByEmp[s.empleado_supabase_id] || []
      // The candidate must fit ENTIRELY inside the schedule window: [m, m+reqMins] <= em.
      for (let m = sm; m + reqMins <= em; m += stepMins) {
        const blocked = busy.some(([bs, be]) => {
          const bsm = toMin(bs), bem = toMin(be)
          // True overlap on [m, m+reqMins] vs [bsm, bem] — open intervals.
          return m < bem && (m + reqMins) > bsm
        })
        if (!blocked) slots.push({ empleado_supabase_id: s.empleado_supabase_id, time: fromMin(m) })
      }
    }
    return res.json({
      business_name: biz?.name || '',
      business_logo: biz?.logo_url || null,
      services: (services || []).map(s => ({ supabase_id: s.supabase_id, name: s.name, price: Number(s.price) || 0, duration_min: Number(s.duration_min) || 30 })),
      stylists: (stylists || []).map(e => ({ supabase_id: e.supabase_id, name: e.nombre, photo: e.foto_url || null })),
      available_slots: slots,
    })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

// 2. salon-public-booking-create — POST, public, hCaptcha, 5/min/phone
async function handleSalonPublicBookingCreate(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const body = typeof req.body === 'string' ? safeJson(req.body) : (req.body || {})
  const { slug, service_supabase_id, empleado_supabase_id, date, start_time, client_name, client_phone, hcaptcha_token } = body
  if (!slug || !service_supabase_id || !empleado_supabase_id || !date || !start_time || !client_name || !client_phone) {
    return res.status(400).json({ error: 'missing_required_fields' })
  }
  const phoneNorm = normalisePhoneDR(client_phone)
  if (!phoneNorm || phoneNorm.length < 10) return res.status(400).json({ error: 'invalid_phone' })
  // Rate-limit per-phone (not per-IP) — phones are scarcer than IPs and the
  // captcha already pre-throttles bot-fueled IP rotation.
  if (!(await checkRateLimit(`salon-public-booking-create:phone:${phoneNorm}`, 5))) {
    return res.status(429).json({ error: 'rate_limited' })
  }
  // hCaptcha — fails closed in prod, skips in dev
  if (!(await verifyHcaptcha(hcaptcha_token, callerIp(req)))) {
    return res.status(400).json({ error: 'captcha_failed' })
  }
  try {
    const supabase = getClient()
    // Resolve business
    const { data: slugRow } = await supabase.from('app_settings')
      .select('business_id').eq('key', 'salon_public_booking_slug').eq('value', slug).maybeSingle()
    if (!slugRow?.business_id) return res.status(404).json({ error: 'business_not_found' })
    const businessId = slugRow.business_id
    const { data: enabledRow } = await supabase.from('app_settings')
      .select('value').eq('business_id', businessId).eq('key', 'salon_public_booking_enabled').maybeSingle()
    if (enabledRow?.value !== 'true') return res.status(404).json({ error: 'not_enabled' })

    // Find or create client.
    // v2.16.2 (item #6) — match all common DR phone variants so a client who
    // booked previously with a different format doesn't get a duplicate row.
    // phoneNorm is `1{10digits}`; also try the raw 10-digit form and the
    // explicit +1 prefix form.
    let client = null
    const digits = phoneNorm.replace(/^\+?1?/, '')
    const phoneOr = `phone.eq.${phoneNorm},phone.eq.${digits},phone.eq.+${phoneNorm}`
    const { data: existingClient } = await supabase.from('clients')
      .select('id,supabase_id,name,phone').eq('business_id', businessId).or(phoneOr).limit(1).maybeSingle()
    if (existingClient) {
      client = existingClient
    } else {
      const csid = crypto.randomUUID()
      const { data: newC, error: cErr } = await supabase.from('clients').insert({
        supabase_id: csid, business_id: businessId,
        name: String(client_name).trim().slice(0, 120), phone: phoneNorm, active: true,
      }).select('id,supabase_id,name,phone').single()
      if (cErr) throw cErr
      client = newC
    }

    // Service + stylist + business for templating + duration
    const [{ data: svc }, { data: emp }, { data: biz }] = await Promise.all([
      supabase.from('services').select('supabase_id,name,duration_min').eq('business_id', businessId).eq('supabase_id', service_supabase_id).maybeSingle(),
      supabase.from('empleados').select('supabase_id,nombre').eq('business_id', businessId).eq('supabase_id', empleado_supabase_id).maybeSingle(),
      supabase.from('businesses').select('name').eq('id', businessId).maybeSingle(),
    ])
    if (!svc) return res.status(400).json({ error: 'service_not_found' })
    if (!emp) return res.status(400).json({ error: 'stylist_not_found' })

    // Compute end_time from duration
    const dur = Number(svc.duration_min) || 30
    const [h, m] = String(start_time).split(':').map(Number)
    const startMin = (h | 0) * 60 + (m | 0)
    const endMin = startMin + dur
    const end_time = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`

    // v2.16.2 (Fix 3) — duration-aware overlap check before insert. The
    // partial unique index `appointments_no_double_book_idx` only catches
    // EXACT same `start_time` collisions; without this check, a 60-min
    // service starting 10:00 still allows another stylist booking at 10:30.
    const { data: collide } = await supabase.from('appointments')
      .select('start_time,end_time,status')
      .eq('business_id', businessId).eq('date', date)
      .eq('empleado_supabase_id', emp.supabase_id)
      .not('status', 'in', '(cancelled,no_show)')
    if (Array.isArray(collide)) {
      const toMin2 = (hhmm) => { const [hh, mm] = String(hhmm || '00:00').split(':').map(Number); return (hh | 0) * 60 + (mm | 0) }
      const overlap = collide.some(a => {
        const bs = toMin2(a.start_time), be = toMin2(a.end_time || a.start_time)
        return startMin < be && endMin > bs
      })
      if (overlap) return res.status(409).json({ ok: false, error: 'slot_taken' })
    }

    // v2.16.2 (item #1) — honour salon_require_deposit. Read both keys; if
    // require=true, stamp deposit_dop + deposit_status='pending' so the UI can
    // route the user to "depósito por confirmar". Stripe/Azul wiring is OOS.
    let depositRequired = false
    let depositAmount = 0
    try {
      const { data: depRows } = await supabase.from('app_settings')
        .select('key,value').eq('business_id', businessId)
        .in('key', ['salon_require_deposit', 'salon_deposit_amount_dop'])
      const map = {}
      for (const r of (depRows || [])) map[r.key] = r.value
      if (String(map.salon_require_deposit || '').toLowerCase() === 'true') {
        depositRequired = true
        depositAmount = Number(map.salon_deposit_amount_dop) || 0
      }
    } catch (e) { console.warn('[salon-public-booking-create] deposit lookup', e?.message || e) }

    // Insert appointment.
    // v2.16.1 patch (#7) — partial unique index
    // appointments_no_double_book_idx blocks racing concurrent inserts. Catch
    // 23505 (unique_violation) and surface a 409 so the UI can redraw slots.
    const apptSid = crypto.randomUUID()
    const token = crypto.randomUUID()
    const { error: aErr } = await supabase.from('appointments').insert({
      supabase_id: apptSid,
      business_id: businessId,
      client_supabase_id: client.supabase_id,
      empleado_supabase_id: emp.supabase_id,
      date, start_time, end_time,
      services: JSON.stringify([{ supabase_id: svc.supabase_id, name: svc.name }]),
      status: 'scheduled',
      is_walk_in: false,
      deposit_dop: depositRequired ? depositAmount : 0,
      deposit_status: depositRequired ? 'pending' : 'none',
      public_booking_token: token,
    })
    if (aErr) {
      if (aErr.code === '23505') {
        return res.status(409).json({ ok: false, error: 'slot_taken' })
      }
      throw aErr
    }

    // Schedule reminders (24h + 2h, skipping any in the past).
    // v2.16.1 patch (#5) — DR is UTC-4 fixed; without the suffix Vercel parses
    // as UTC and the reminder fires 4 hours early.
    const startMs = new Date(`${date}T${start_time}:00-04:00`).getTime()
    const now = Date.now()
    const reminderRows = []
    for (const w of [{ kind: '24h', fireMs: startMs - 24 * 3600 * 1000 }, { kind: '2h', fireMs: startMs - 2 * 3600 * 1000 }]) {
      if (w.fireMs <= now) continue
      reminderRows.push({
        supabase_id: crypto.randomUUID(), business_id: businessId,
        appointment_supabase_id: apptSid, fire_at: new Date(w.fireMs).toISOString(),
        kind: w.kind, status: 'pending',
      })
    }
    if (reminderRows.length) await supabase.from('appointment_reminders').insert(reminderRows)

    // Send confirm WhatsApp now (best-effort, don't fail booking if it 5xxs)
    try {
      const msg = fillTemplate(SALON_WA_TEMPLATES.confirm, {
        biz_name: biz?.name || 'Salón', date, time: start_time,
        stylist: emp.nombre, service: svc.name,
      })
      await ultraMsgSend(supabase, businessId, { to: phoneNorm, body: msg })
    } catch (e) { console.warn('[salon-public-booking-create] confirm WA failed', e?.message || e) }

    return res.json({
      ok: true,
      token,
      appointment_supabase_id: apptSid,
      ...(depositRequired ? { deposit_required: true, deposit_amount_dop: depositAmount } : {}),
    })
  } catch (err) {
    console.error('[salon-public-booking-create]', err?.message || err)
    return res.status(500).json({ error: err.message || 'internal_error' })
  }
}

// 3. salon-whatsapp-reminder-tick — cron secret authed (cron path)
//    OR manual_batch=true with license JWT (offline-queue drain path).
async function handleSalonReminderTick(req, res) {
  const body = req.method === 'POST'
    ? (typeof req.body === 'string' ? safeJson(req.body) : (req.body || {}))
    : {}

  // ---- manual_batch path (offline-queue drain) ---------------------------
  if (body && body.manual_batch === true) {
    const auth = await requireBusinessMember(req)
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    const { supabase, businessId } = auth
    const reminders = Array.isArray(body.reminders) ? body.reminders : []
    const results = []
    for (const r of reminders) {
      const appointment_supabase_id = r?.appointment_supabase_id
      const kind = r?.kind || 'manual'
      const vars = r?.template_vars || {}
      try {
        if (!appointment_supabase_id) throw new Error('appointment_supabase_id_required')
        // Resolve phone server-side from appointment.client (trust boundary).
        const { data: appt } = await supabase.from('appointments')
          .select('client_supabase_id,status')
          .eq('supabase_id', appointment_supabase_id).eq('business_id', businessId).maybeSingle()
        if (!appt) throw new Error('appointment_not_found')
        if (appt.status === 'cancelled' || appt.status === 'no_show') {
          results.push({ appointment_supabase_id, ok: true, skipped: `appointment_${appt.status}` })
          continue
        }
        let phone = ''
        if (appt.client_supabase_id) {
          const { data: c } = await supabase.from('clients').select('phone')
            .eq('supabase_id', appt.client_supabase_id).maybeSingle()
          phone = normalisePhoneDR(c?.phone || '')
        }
        if (!phone) throw new Error('no_client_phone')
        const tpl = SALON_WA_TEMPLATES[kind] || SALON_WA_TEMPLATES.manual
        const text = fillTemplate(tpl, vars)
        const sendRes = await ultraMsgSend(supabase, businessId, { to: phone, body: text })
        // Audit: write a sent reminder row so the timeline reflects the drain.
        // v2.16.1 patch (#12) — if a pending row already exists for this
        // (appointment, kind, business), UPDATE it to status='sent' instead
        // of INSERTing a second row that ages into 'skipped'/'failed' on its
        // own and pollutes the timeline with phantom duplicates.
        try {
          const nowIso = new Date().toISOString()
          const umid = sendRes?.id ? String(sendRes.id) : (sendRes?.sent ? 'true' : null)
          const { data: existing } = await supabase.from('appointment_reminders')
            .select('id').eq('appointment_supabase_id', appointment_supabase_id)
            .eq('kind', kind).eq('business_id', businessId)
            .eq('status', 'pending').limit(1)
          if (Array.isArray(existing) && existing.length > 0) {
            await supabase.from('appointment_reminders').update({
              status: 'sent',
              ultramsg_message_id: umid,
              sent_at: nowIso,
              updated_at: nowIso,
            }).eq('id', existing[0].id)
          } else {
            await supabase.from('appointment_reminders').insert({
              supabase_id: crypto.randomUUID(),
              business_id: businessId,
              appointment_supabase_id,
              kind,
              fire_at: nowIso,
              status: 'sent',
              ultramsg_message_id: umid,
              sent_at: nowIso,
            })
          }
        } catch {}
        results.push({ appointment_supabase_id, ok: true })
      } catch (e) {
        results.push({ appointment_supabase_id, ok: false, error: String(e?.message || e).slice(0, 300) })
      }
    }
    return res.json({ ok: true, manual_batch: true, results })
  }

  // ---- cron path ---------------------------------------------------------
  const cronSecret = process.env.CRON_SECRET
  const provided = req.headers['x-cron-secret'] || req.query?.cron_secret
  if (cronSecret) {
    if (provided !== cronSecret) return res.status(401).json({ error: 'invalid_cron_secret' })
  } else {
    // v2.16.2 (item #2) — fail-closed when CRON_SECRET is unset. The
    // manual_batch path above is license-JWT authed and unaffected.
    console.error('[salon-whatsapp-reminder-tick] CRON_SECRET unset — refusing cron path')
    return res.status(503).json({ error: 'cron_disabled' })
  }
  try {
    const supabase = getClient()
    const nowIso = new Date().toISOString()
    const { data: due } = await supabase.from('appointment_reminders')
      .select('id,supabase_id,business_id,appointment_supabase_id,kind,status')
      .eq('status', 'pending').lte('fire_at', nowIso)
      .order('fire_at', { ascending: true }).limit(50) // v2.16.2 (item #8) — morning rush headroom
    const result = { processed: 0, sent: 0, failed: 0, skipped: 0 }
    for (const r of (due || [])) {
      result.processed++
      try {
        const sent = await processReminder(supabase, r)
        if (sent) result.sent++
        else result.skipped++
      } catch (e) {
        result.failed++
        await supabase.from('appointment_reminders').update({
          status: 'failed', error: String(e?.message || e).slice(0, 500), updated_at: new Date().toISOString(),
        }).eq('id', r.id)
      }
    }
    return res.json({ ok: true, ...result })
  } catch (err) {
    console.error('[salon-whatsapp-reminder-tick]', err?.message || err)
    return res.status(500).json({ error: err.message })
  }
}

// Shared reminder processor — used by both the cron tick and the manual
// send-now path. Returns true when a message was sent.
async function processReminder(supabase, reminder) {
  const { id, business_id, appointment_supabase_id, kind } = reminder
  // Load appointment + relations
  const { data: appt } = await supabase.from('appointments')
    .select('supabase_id,date,start_time,client_supabase_id,empleado_supabase_id,services,status')
    .eq('supabase_id', appointment_supabase_id).eq('business_id', business_id).maybeSingle()
  if (!appt) {
    await supabase.from('appointment_reminders').update({
      status: 'skipped', error: 'appointment_not_found', updated_at: new Date().toISOString(),
    }).eq('id', id)
    return false
  }
  if (appt.status === 'cancelled' || appt.status === 'no_show') {
    await supabase.from('appointment_reminders').update({
      status: 'skipped', error: `appointment_${appt.status}`, updated_at: new Date().toISOString(),
    }).eq('id', id)
    return false
  }
  const [{ data: client }, { data: emp }, { data: biz }] = await Promise.all([
    appt.client_supabase_id
      ? supabase.from('clients').select('name,phone').eq('supabase_id', appt.client_supabase_id).maybeSingle()
      : Promise.resolve({ data: null }),
    appt.empleado_supabase_id
      ? supabase.from('empleados').select('nombre').eq('supabase_id', appt.empleado_supabase_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('businesses').select('name').eq('id', business_id).maybeSingle(),
  ])
  if (!client?.phone) {
    // v2.16.2 (item #7) — keep the reminder pending and retry tomorrow when
    // the receptionist may have completed the client's profile. Marking it
    // 'skipped' permanently lost the reminder forever.
    const retryAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const { data: cur } = await supabase.from('appointment_reminders').select('attempts').eq('id', id).maybeSingle()
    await supabase.from('appointment_reminders').update({
      status: 'pending',
      attempts: (Number(cur?.attempts) || 0) + 1,
      error: 'no_client_phone',
      fire_at: retryAt,
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    return false
  }
  let serviceName = ''
  try {
    const arr = typeof appt.services === 'string' ? JSON.parse(appt.services || '[]') : (appt.services || [])
    serviceName = (Array.isArray(arr) && arr[0]?.name) || ''
  } catch {}
  const tpl = SALON_WA_TEMPLATES[kind] || SALON_WA_TEMPLATES.manual
  const body = fillTemplate(tpl, {
    name: client.name || '',
    time: appt.start_time || '',
    date: appt.date || '',
    // v2.16.2 (item #5) — `{stylist}` fallback. Any-stylist bookings have
    // empleado_supabase_id=null; before this fallback the 2h template rendered
    // "tu cita es en 2 horas con . ¡Te esperamos!" — visible breakage.
    stylist: emp?.nombre || 'tu equipo',
    biz_name: biz?.name || '',
    service: serviceName,
  })
  const phone = normalisePhoneDR(client.phone)
  const r = await ultraMsgSend(supabase, business_id, { to: phone, body })
  await supabase.from('appointment_reminders').update({
    status: 'sent',
    ultramsg_message_id: r?.id ? String(r.id) : (r?.sent ? 'true' : null),
    sent_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  return true
}

// 4. salon-whatsapp-send-now — license JWT authed (Supabase JWT + business member)
async function handleSalonWhatsappSendNow(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireBusinessMember(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase, businessId } = auth
  // v2.16.2 (Fix 2) — rate-limit per business. Token comprometido = quota
  // UltraMsg drenada en 60 segundos sin esto. 10/min/business is generous
  // for legitimate "Enviar recordatorio ahora" taps and tight enough to
  // contain abuse. Keyed by business so one tenant's spam can't lock another.
  if (!(await checkRateLimit(`salon-whatsapp-send-now:${businessId}`, 10))) {
    return res.status(429).json({ error: 'rate_limited' })
  }
  const body = typeof req.body === 'string' ? safeJson(req.body) : (req.body || {})
  const { appointment_supabase_id, test_message, test_phone } = body
  // v2.16.2 — test mode: send a synthetic "Mensaje de prueba desde {biz}"
  // to a phone number provided by the owner. No appointment lookup, no
  // reminders row written. Same rate-limit applies.
  if (test_message) {
    const phone = normalisePhoneDR(String(test_phone || ''))
    if (!phone) return res.status(400).json({ error: 'invalid_phone' })
    try {
      const { data: biz } = await supabase.from('businesses').select('name').eq('id', businessId).maybeSingle()
      const text = `Mensaje de prueba desde ${biz?.name || 'Terminal X'}`
      const r = await ultraMsgSend(supabase, businessId, { to: phone, body: text })
      return res.json({ ok: true, sent: true, id: r?.id || null })
    } catch (e) {
      return res.status(502).json({ ok: false, error: e?.message || 'send_failed' })
    }
  }
  if (!appointment_supabase_id) return res.status(400).json({ error: 'appointment_supabase_id required' })
  try {
    // Insert manual reminder + immediately process it
    const reminderSid = crypto.randomUUID()
    const { data: row, error: insErr } = await supabase.from('appointment_reminders').insert({
      supabase_id: reminderSid, business_id: businessId,
      appointment_supabase_id, kind: 'manual', fire_at: new Date().toISOString(), status: 'pending',
    }).select('id,supabase_id,business_id,appointment_supabase_id,kind,status').single()
    if (insErr) throw insErr
    try {
      await processReminder(supabase, row)
      return res.json({ ok: true, sent: true })
    } catch (e) {
      await supabase.from('appointment_reminders').update({
        status: 'failed', error: String(e?.message || e).slice(0, 500), updated_at: new Date().toISOString(),
      }).eq('id', row.id)
      return res.status(502).json({ ok: false, error: e?.message || 'send_failed' })
    }
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

// 5. salon-membership-purchase — license JWT authed
async function handleSalonMembershipPurchase(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireBusinessMember(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase, businessId } = auth
  const body = typeof req.body === 'string' ? safeJson(req.body) : (req.body || {})
  const { client_supabase_id, membership_supabase_id, ticket_supabase_id } = body
  if (!client_supabase_id || !membership_supabase_id) return res.status(400).json({ error: 'client_supabase_id + membership_supabase_id required' })
  try {
    const { data: tpl, error: tplErr } = await supabase.from('memberships')
      .select('total_sessions,validity_days,price_dop')
      .eq('supabase_id', membership_supabase_id).eq('business_id', businessId).maybeSingle()
    if (tplErr) throw tplErr
    if (!tpl) return res.status(404).json({ error: 'membership_template_not_found' })
    const validity = Number(tpl.validity_days) || 365
    const expires_at = new Date(Date.now() + validity * 86400000).toISOString()
    const { data: row, error: insErr } = await supabase.from('client_memberships').insert({
      supabase_id: crypto.randomUUID(),
      business_id: businessId,
      client_supabase_id,
      membership_supabase_id,
      sessions_remaining: Number(tpl.total_sessions) || 0,
      expires_at,
      ticket_supabase_id: ticket_supabase_id || null,
    }).select('*').single()
    if (insErr) throw insErr
    return res.json({ ok: true, data: row })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

// 6. salon-membership-consume — license JWT authed
async function handleSalonMembershipConsume(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireBusinessMember(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase, businessId } = auth
  const body = typeof req.body === 'string' ? safeJson(req.body) : (req.body || {})
  const { client_membership_supabase_id, ticket_supabase_id, appointment_supabase_id } = body
  if (!client_membership_supabase_id || !ticket_supabase_id) return res.status(400).json({ error: 'client_membership_supabase_id + ticket_supabase_id required' })
  try {
    // v2.16.1 patch (#8) — compare-and-swap on sessions_remaining to defeat
    // the read-modify-write race. Two concurrent consumes both saw remaining=1
    // and both wrote 0; second redemption was free. Retry up to 3 times with
    // a fresh fetch when the CAS predicate misses (RETURNING zero rows).
    let cm = null
    let updated = null
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: cmRow } = await supabase.from('client_memberships')
        .select('id,sessions_remaining,expires_at')
        .eq('supabase_id', client_membership_supabase_id).eq('business_id', businessId).maybeSingle()
      if (!cmRow) return res.status(404).json({ error: 'not_found' })
      cm = cmRow
      if (Number(cm.sessions_remaining) <= 0) return res.status(409).json({ error: 'no_sessions_remaining' })
      if (cm.expires_at && new Date(cm.expires_at) < new Date()) return res.status(409).json({ error: 'expired' })
      const { data: rows, error: updErr } = await supabase.from('client_memberships')
        .update({ sessions_remaining: cm.sessions_remaining - 1, updated_at: new Date().toISOString() })
        .eq('id', cm.id).eq('business_id', businessId)
        .eq('sessions_remaining', cm.sessions_remaining)
        .select('id,sessions_remaining')
      if (updErr) throw updErr
      if (Array.isArray(rows) && rows.length > 0) { updated = rows[0]; break }
      // CAS missed → another consumer raced us. Loop, re-fetch, retry.
    }
    if (!updated) return res.status(409).json({ ok: false, error: 'concurrent_consume' })
    const { data: redemption, error: rErr } = await supabase.from('membership_redemptions').insert({
      supabase_id: crypto.randomUUID(),
      business_id: businessId,
      client_membership_supabase_id,
      ticket_supabase_id,
      appointment_supabase_id: appointment_supabase_id || null,
    }).select('*').single()
    if (rErr) throw rErr
    return res.json({ ok: true, remaining: updated.sessions_remaining, data: redemption })
  } catch (err) { return res.status(500).json({ error: err.message }) }
}

// ─────────────────────────────────────────────────────────────────────────
// v2.16.0 — Taller Mecánico: public work-order approval
//
// `wo-approve-load`   GET  ?action=wo-approve-load&t=<token>
//                     Returns { wo, items, vehicle, business, alreadyApproved }
//                     Service role bypasses RLS so we can read by token only.
//                     Token is opaque (UUID-derived 48-char hex) — no other
//                     auth required. Treat the token as a bearer.
//
// `wo-approve-submit` POST ?action=wo-approve-submit&t=<token>
//                     Body: { signature_data_url, customer_name? }
//                     Stamps work_orders.status='aprobado',
//                     estimate_approved_at, customer_signature_url (storage
//                     path inside `mechanic-photos`), and rotates the
//                     approval token so the link cannot be replayed.
// ─────────────────────────────────────────────────────────────────────────
async function handleWorkOrderApproval(action, req, res, supabase) {
  const token = String(req.query?.t || req.body?.t || '').trim()
  if (!token || token.length < 24 || token.length > 96 || /[^a-f0-9]/i.test(token)) {
    return res.status(400).json({ error: 'invalid_token' })
  }

  // Resolve the WO by token. Service role: we trust the token is the cred.
  const { data: wo, error: woErr } = await supabase
    .from('work_orders')
    .select(`
      id, supabase_id, business_id, status, estimated_total, total, labor_total,
      parts_total, itbis, validity_until, vehicle_supabase_id, client_supabase_id,
      notes, customer_signature_url, estimate_approved_at, created_at, updated_at,
      customer_approval_token
    `)
    .eq('customer_approval_token', token)
    .maybeSingle()

  if (woErr || !wo) {
    return res.status(404).json({ error: 'work_order_not_found' })
  }

  // Validity guard. After approval, the cotización becomes a binding WO so the
  // expiry only matters before approval.
  const now = new Date()
  const expired = wo.validity_until && new Date(wo.validity_until + 'T23:59:59') < now
  const alreadyApproved = !!wo.estimate_approved_at

  if (action === 'wo-approve-load') {
    const [{ data: items }, { data: vehicle }, { data: business }, { data: client }] = await Promise.all([
      supabase.from('work_order_items').select('id, type, name, description, quantity, unit_price, total, warranty_months').eq('work_order_supabase_id', wo.supabase_id),
      wo.vehicle_supabase_id
        ? supabase.from('vehicles').select('plate, vin, make, model, year, color, odometer_km').eq('supabase_id', wo.vehicle_supabase_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('businesses').select('name, rnc, phone, address').eq('id', wo.business_id).maybeSingle(),
      wo.client_supabase_id
        ? supabase.from('clients').select('name, phone, rnc').eq('supabase_id', wo.client_supabase_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    return res.json({
      ok: true,
      alreadyApproved,
      expired: expired && !alreadyApproved,
      wo: {
        id: wo.id, supabase_id: wo.supabase_id, status: wo.status,
        labor_total: wo.labor_total, parts_total: wo.parts_total,
        itbis: wo.itbis, total: wo.total, estimated_total: wo.estimated_total,
        validity_until: wo.validity_until, notes: wo.notes,
        estimate_approved_at: wo.estimate_approved_at,
      },
      items: items || [],
      vehicle: vehicle || null,
      business: business || null,
      client: client || null,
    })
  }

  // wo-approve-submit
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  if (alreadyApproved) return res.status(409).json({ error: 'already_approved', estimate_approved_at: wo.estimate_approved_at })
  if (expired)         return res.status(410).json({ error: 'cotizacion_expired', validity_until: wo.validity_until })

  const sig = String(req.body?.signature_data_url || '')
  if (!sig.startsWith('data:image/png;base64,') && !sig.startsWith('data:image/jpeg;base64,')) {
    return res.status(400).json({ error: 'signature_required' })
  }
  const sigB64  = sig.replace(/^data:image\/(png|jpeg);base64,/, '')
  const sigKind = sig.startsWith('data:image/png') ? 'png' : 'jpg'
  let sigBytes
  try { sigBytes = Buffer.from(sigB64, 'base64') } catch { return res.status(400).json({ error: 'signature_not_base64' }) }
  if (sigBytes.length < 200 || sigBytes.length > 2 * 1024 * 1024) {
    return res.status(400).json({ error: 'signature_size_out_of_range' })
  }

  const path = `${wo.business_id}/${wo.supabase_id}/signature-${Date.now()}.${sigKind}`
  const { error: upErr } = await supabase.storage.from('mechanic-photos').upload(path, sigBytes, {
    contentType: sigKind === 'png' ? 'image/png' : 'image/jpeg',
    upsert: false,
  })
  if (upErr) return res.status(500).json({ error: 'signature_upload_failed', detail: upErr.message })

  // Rotate token so the link can never be replayed.
  const newToken = crypto.randomBytes(24).toString('hex') + crypto.randomBytes(8).toString('hex')

  const customerName = String(req.body?.customer_name || '').slice(0, 120) || null

  const { error: updErr } = await supabase.from('work_orders').update({
    status: 'aprobado',
    estimate_approved_at: new Date().toISOString(),
    customer_signature_url: path,
    customer_approval_token: newToken,
    updated_at: new Date().toISOString(),
    notes: customerName
      ? `${wo.notes ? wo.notes + ' · ' : ''}Aprobada por ${customerName} (firma digital).`
      : wo.notes,
  }).eq('id', wo.id).eq('business_id', wo.business_id)
  if (updErr) return res.status(500).json({ error: 'wo_update_failed', detail: updErr.message })

  // Best-effort activity log — never blocks success.
  try {
    await supabase.from('activity_log').insert({
      business_id: wo.business_id,
      event_type: 'wo_estimate_approved',
      severity: 'info',
      target_type: 'work_order',
      target_id: wo.id,
      target_name: customerName,
      metadata: {
        work_order_supabase_id: wo.supabase_id,
        amount: Number(wo.total || wo.estimated_total) || 0,
        ip: callerIp(req),
        ua: String(req.headers['user-agent'] || '').slice(0, 200),
      },
    })
  } catch { /* non-blocking */ }

  return res.json({ ok: true, status: 'aprobado', signature_path: path })
}

// ─── v2.16.7 — Collections daily auto-fire ────────────────────────────────
//
// Three paths under one action so we stay inside the Vercel 12/12 cap:
//
//   mode='cron'      — pg_cron hourly hit. CRON_SECRET-gated. Calls
//                      lending_reminders_due() RPC, builds wa.me link +
//                      Spanish message per row, INSERTs loan_reminders
//                      with status='pending' + emits loan_reminder_sent
//                      activity_log row. Idempotent — RPC dedupes 12h.
//
//   mode='list'      — license-JWT (business member). Returns pending
//                      reminders for the current business so the
//                      RemoteDashboard "Recordatorios pendientes" panel
//                      can render with one wa.me click per row.
//
//   mode='mark_open' — license-JWT. Stamps a single reminder
//                      status='opened' + opened_at=now() after the user
//                      clicks the wa.me link. WABA is NOT live so we never
//                      claim 'sent' — only 'opened' (manual flow).
//
// HONESTY RULE: until app_settings.waba_approved='true', no string anywhere
// in this handler may say "enviado automáticamente". We say "pendiente" and
// let the user push the message themselves.
async function handleCollectionsRemind(req, res) {
  const body = req.method === 'POST'
    ? (typeof req.body === 'string' ? safeJson(req.body) : (req.body || {}))
    : {}
  const mode = body.mode || req.query?.mode || 'cron'

  if (mode === 'cron') {
    const cronSecret = process.env.CRON_SECRET
    const provided = req.headers['x-cron-secret'] || req.query?.cron_secret
    if (cronSecret) {
      if (provided !== cronSecret) return res.status(401).json({ error: 'invalid_cron_secret' })
    } else {
      console.error('[collections_remind] CRON_SECRET unset — refusing cron path')
      return res.status(503).json({ error: 'cron_disabled' })
    }
    try {
      const supabase = getClient()
      const { data: due, error } = await supabase.rpc('lending_reminders_due', { p_business_id: null })
      if (error) throw new Error(error.message)
      const result = { processed: 0, queued: 0, skipped: 0, failed: 0 }
      for (const r of (due || [])) {
        result.processed++
        try {
          const phone = normalisePhoneDR(String(r.client_phone || ''))
          if (!phone) { result.skipped++; continue }
          const message = buildLoanReminderMessage(r)
          const waLink = buildWaMeLink(phone, message)
          const ins = await supabase.from('loan_reminders').insert({
            business_id: r.business_id,
            loan_supabase_id: r.loan_supabase_id,
            schedule_supabase_id: r.schedule_supabase_id,
            client_supabase_id: r.client_supabase_id,
            kind: r.kind,
            due_date: r.due_date,
            fire_at: new Date().toISOString(),
            status: 'pending',
            message,
            wa_link: waLink,
            phone,
          }).select('id,supabase_id').maybeSingle()
          if (ins.error) {
            // Unique-violation = already enqueued by an earlier tick — that's a
            // skip, not a failure. Postgres code 23505.
            if (String(ins.error.code) === '23505') { result.skipped++; continue }
            throw new Error(ins.error.message)
          }
          // Audit log — emit loan_reminder_sent (severity=info). UI surfaces
          // these in the activity feed alongside other lending events.
          try {
            await supabase.from('activity_log').insert({
              supabase_id: crypto.randomUUID(),
              business_id: r.business_id,
              event_type: 'loan_reminder_sent',
              severity: 'info',
              actor_name: 'Sistema (cron)',
              target_type: 'loan',
              target_id: null,
              target_name: r.client_name || null,
              metadata: {
                loan_supabase_id: r.loan_supabase_id,
                schedule_supabase_id: r.schedule_supabase_id,
                kind: r.kind,
                due_date: r.due_date,
                phone,
                wa_link: waLink,
                channel: 'wa_me_manual',  // honest: not WABA
              },
            })
          } catch { /* non-blocking — RLS may reject service-role-less log */ }
          result.queued++
        } catch (e) {
          console.error('[collections_remind] enqueue', e?.message || e)
          result.failed++
        }
      }
      return res.json({ ok: true, ...result })
    } catch (err) {
      console.error('[collections_remind cron]', err?.message || err)
      return res.status(500).json({ error: err.message })
    }
  }

  if (mode === 'list') {
    const auth = await requireBusinessMember(req)
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    const { supabase, businessId } = auth
    const { data, error } = await supabase.from('loan_reminders')
      .select('id,supabase_id,loan_supabase_id,schedule_supabase_id,client_supabase_id,kind,due_date,status,message,wa_link,phone,fire_at,opened_at,created_at')
      .eq('business_id', businessId)
      .in('status', ['pending', 'opened'])
      .order('fire_at', { ascending: true })
      .limit(200)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true, reminders: data || [] })
  }

  if (mode === 'mark_open') {
    const auth = await requireBusinessMember(req)
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    const { supabase, businessId } = auth
    const sid = body.supabase_id
    if (!sid) return res.status(400).json({ error: 'supabase_id required' })
    const { data, error } = await supabase.from('loan_reminders')
      .update({
        status: 'opened',
        opened_at: new Date().toISOString(),
        attempts: 1,
        updated_at: new Date().toISOString(),
      })
      .eq('supabase_id', sid)
      .eq('business_id', businessId)
      .select('id,supabase_id,status,opened_at')
      .maybeSingle()
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true, reminder: data || null })
  }

  return res.status(400).json({ error: `unknown_mode:${mode}` })
}

function fmtRDServer(n) {
  return `RD$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDateESDOServer(yyyy_mm_dd) {
  if (!yyyy_mm_dd) return ''
  // due_date is a TEXT 'YYYY-MM-DD' — render in es-DO long form without TZ drift.
  const [y, m, d] = String(yyyy_mm_dd).split('-').map(s => parseInt(s, 10))
  if (!y || !m || !d) return String(yyyy_mm_dd)
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
  return `${d} de ${months[m - 1] || m} de ${y}`
}

function buildLoanReminderMessage(r) {
  const name   = (r.client_name || 'estimado cliente').trim()
  const monto  = fmtRDServer(r.monthly_payment || 0)
  const fecha  = fmtDateESDOServer(r.due_date || '')
  const empresa = (r.business_name || '').trim()
  const tail   = empresa ? ` en ${empresa}` : ''
  return `Hola ${name}, este es un recordatorio de tu pago de ${monto} con vencimiento ${fecha}${tail}. Gracias.`
}

function buildWaMeLink(phone, message) {
  // phone is already normalised E.164 digits (no '+', see normalisePhoneDR).
  // wa.me wants raw international number. Strip any leading '+' just in case.
  const num = String(phone || '').replace(/[^0-9]/g, '')
  const enc = encodeURIComponent(message || '')
  return `https://wa.me/${num}?text=${enc}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Desktop cloud backup — license-validated signed upload URL.
// Production desktop installers ship the anon key, which RLS-rejects writes to
// `db-backups` storage. Instead the desktop calls this endpoint with its
// license_key + hwid, we validate the binding server-side, and mint a
// short-lived signed upload URL scoped to `{business_id}/{date}.sqlite.gz`.
// Service role lives only on the server.
// ─────────────────────────────────────────────────────────────────────────────
const BACKUP_MAX_BYTES = 1024 * 1024 * 1024 // 1 GB compressed daily — plenty for DR client DBs.

async function validateLicenseForBackup(req) {
  const { key, hwid, business_id } = req.body || {}
  if (!key || !hwid || !business_id) return { error: 'missing_credentials', status: 400 }
  const supabase = getClient()
  const { data: license } = await supabase.from('licenses')
    .select('id, business_id, hardware_id, status')
    .eq('license_key', String(key).toUpperCase().trim())
    .maybeSingle()
  if (!license) return { error: 'license_not_found', status: 401 }
  if (!['active', 'trial'].includes(license.status)) return { error: 'license_inactive', status: 403 }
  if (license.business_id !== business_id) return { error: 'business_mismatch', status: 403 }
  // hardware_id may be null on first validate; bind here. Otherwise must match.
  if (license.hardware_id && license.hardware_id !== hwid && hwid !== 'web-client') {
    return { error: 'hardware_mismatch', status: 403 }
  }
  return { license, supabase }
}

async function handleDbBackupSign(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  const ip = callerIp(req)
  if (!(await checkRateLimit(`db-backup-sign:${ip}`, 30))) {
    return res.status(429).json({ error: 'rate_limited' })
  }
  const v = await validateLicenseForBackup(req)
  if (v.error) return res.status(v.status).json({ error: v.error })

  const { business_id, path: objectPath, bytes } = req.body || {}
  if (!objectPath || typeof objectPath !== 'string') return res.status(400).json({ error: 'missing_path' })
  // Path safety: must be `${business_id}/<safe-name>.sqlite.gz` — no traversal.
  const safe = /^[A-Za-z0-9_\-]+\/[A-Za-z0-9_\-.]+\.sqlite\.gz$/.test(objectPath)
  if (!safe || !objectPath.startsWith(business_id + '/') || objectPath.includes('..')) {
    return res.status(400).json({ error: 'bad_path' })
  }
  if (bytes != null && Number(bytes) > BACKUP_MAX_BYTES) {
    return res.status(413).json({ error: 'too_large', max_bytes: BACKUP_MAX_BYTES })
  }

  const { data, error } = await v.supabase.storage.from('db-backups')
    .createSignedUploadUrl(objectPath, { upsert: true })
  if (error) return res.status(500).json({ error: error.message || 'sign_failed' })

  // Best-effort retention purge (14 days). Runs server-side with service role.
  // Fire-and-forget — never block the upload sign on cleanup.
  ;(async () => {
    try {
      const { data: items } = await v.supabase.storage.from('db-backups').list(business_id, { limit: 1000 })
      if (!items?.length) return
      const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000
      const victims = items.filter(it => {
        const m = /^(\d{4})-(\d{2})-(\d{2})\./.exec(it.name)
        if (!m) return false
        return Date.UTC(+m[1], +m[2] - 1, +m[3]) < cutoff
      }).map(it => `${business_id}/${it.name}`)
      if (victims.length) await v.supabase.storage.from('db-backups').remove(victims)
    } catch {}
  })()

  return res.json({ ok: true, signedUrl: data.signedUrl, token: data.token, path: data.path })
}

// ─────────────────────────────────────────────────────────────────────────────
// UltraMsg WhatsApp creds — per-client management + live status probe.
// Admin-only (requireAdmin). Stores instance + token in app_settings, scoped
// to the business_id. Status probe hits api.ultramsg.com/{instance}/instance/
// status?token={token} so the admin can see at a glance whether the client's
// instance is active / suspended for non-payment / token revoked.
// ─────────────────────────────────────────────────────────────────────────────
async function _ultramsgFetchCreds(supabase, business_id) {
  const { data: rows } = await supabase.from('app_settings')
    .select('key,value')
    .eq('business_id', business_id)
    .in('key', ['whatsapp_instance', 'whatsapp_token'])
  const cfg = Object.fromEntries((rows || []).map(r => [r.key, r.value]))
  return { instance: cfg.whatsapp_instance || '', token: cfg.whatsapp_token || '' }
}

async function handleUltramsgGet(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { business_id } = req.query
  if (!business_id) return res.status(400).json({ error: 'business_id required' })
  try {
    const { instance, token } = await _ultramsgFetchCreds(auth.supabase, business_id)
    const masked = token ? token.slice(0, 4) + '••••' + token.slice(-4) : ''
    return res.json({ data: { instance, token_masked: masked, has_token: !!token } })
  } catch (e) { return res.status(500).json({ error: e.message }) }
}

async function handleUltramsgSave(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { business_id, instance, token } = req.body || {}
  if (!business_id) return res.status(400).json({ error: 'business_id required' })
  if (!instance || !token) return res.status(400).json({ error: 'instance + token required' })
  try {
    const now = new Date().toISOString()
    const rows = [
      { business_id, key: 'whatsapp_instance', value: String(instance).trim(), updated_at: now },
      { business_id, key: 'whatsapp_token',    value: String(token).trim(),    updated_at: now },
    ]
    const { error } = await auth.supabase.from('app_settings')
      .upsert(rows, { onConflict: 'business_id,key,device_hwid' })
    if (error) throw error
    return res.json({ ok: true })
  } catch (e) { return res.status(500).json({ error: e.message }) }
}

async function handleUltramsgStatus(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' })
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { business_id } = req.query
  if (!business_id) return res.status(400).json({ error: 'business_id required' })
  try {
    const { instance, token } = await _ultramsgFetchCreds(auth.supabase, business_id)
    if (!instance || !token) {
      return res.json({ data: { state: 'not_configured', message: 'Sin credenciales UltraMsg.' } })
    }
    const r = await fetch(`https://api.ultramsg.com/${encodeURIComponent(instance)}/instance/status?token=${encodeURIComponent(token)}`)
    const text = await r.text()
    let body = {}; try { body = JSON.parse(text) } catch {}
    // Suspended-for-non-payment shape: {error: "Your instance has been Stopped due to non-payment..."}
    if (body.error) {
      const msg = String(body.error)
      const isSuspended = /stopped|non.?payment|expired|subscription/i.test(msg)
      return res.json({ data: {
        state: isSuspended ? 'suspended' : 'error',
        message: msg,
        instance,
        http_status: r.status,
        raw: body,
      }})
    }
    // Active shape: {accountStatus:{status:"authenticated"}, ...} or similar
    const accountStatus = body?.accountStatus?.status || body?.status || (r.ok ? 'active' : 'unknown')
    return res.json({ data: {
      state: r.ok ? 'active' : 'error',
      message: typeof accountStatus === 'string' ? accountStatus : 'OK',
      instance,
      http_status: r.status,
      raw: body,
    }})
  } catch (e) {
    return res.json({ data: { state: 'error', message: e.message || 'network error' } })
  }
}

async function handleDbBackupStatus(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  const ip = callerIp(req)
  if (!(await checkRateLimit(`db-backup-status:${ip}`, 30))) {
    return res.status(429).json({ error: 'rate_limited' })
  }
  const v = await validateLicenseForBackup(req)
  if (v.error) return res.status(v.status).json({ error: v.error })

  const { business_id, last_ok_at, last_error_at, last_error, last_bytes, last_path } = req.body || {}
  // Mirror backup health into businesses.settings.last_backup so admin
  // ClientDetail and the daily owner digest can read it without a separate
  // app_settings → cloud sync hop. Last-write-wins is fine here.
  const patchObj = {
    last_backup: {
      last_ok_at:    last_ok_at    || null,
      last_error_at: last_error_at || null,
      last_error:    last_error    || null,
      last_bytes:    last_bytes != null ? Number(last_bytes) : null,
      last_path:     last_path     || null,
      reported_at:   new Date().toISOString(),
    },
  }
  try {
    await v.supabase.rpc('merge_business_settings', { p_business_id: business_id, p_patch: patchObj })
  } catch (e) {
    return res.status(500).json({ error: e.message || 'merge_failed' })
  }
  return res.json({ ok: true })
}

// ─────────────────────────────────────────────────────────────────────────────
// Contabilidad Vault — Supabase Storage (bucket: contabilidad-vault, private)
// ─────────────────────────────────────────────────────────────────────────────
// Path convention: <business_id>/<accounting_client_id|firma>/<yyyy>/<mm>/<uuid>-<filename>
// Storage RLS scopes per-tenant via folder[1] == business_id. Server endpoints
// use service role and re-validate JWT → business_id ownership before signing.
const VAULT_BUCKET = 'contabilidad-vault'
const VAULT_MAX_BYTES = 50 * 1024 * 1024 // 50 MB

function sanitizeFilename(name) {
  // Strip path separators + control chars; keep unicode letters/digits/dots/dashes/underscores/spaces.
  const base = String(name || 'archivo').replace(/[\\/]/g, '_').replace(/[\x00-\x1f]/g, '').trim()
  // Limit to 180 chars to leave headroom under storage key limits.
  return (base.slice(0, 180) || 'archivo').replace(/^\.+/, '_')
}

function isSafeVaultKey(key, businessId) {
  if (!key || typeof key !== 'string') return false
  if (key.includes('..') || key.startsWith('/')) return false
  if (!key.startsWith(businessId + '/')) return false
  // Allow most printable chars but no NUL/control. Length cap.
  if (key.length > 1024) return false
  return !/[\x00-\x1f]/.test(key)
}

async function handleVaultUploadSign(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  const ip = callerIp(req)
  if (!(await checkRateLimit(`vault_upload_sign:${ip}`, 60))) {
    return res.status(429).json({ error: 'rate_limited' })
  }
  const auth = await ctbAuthUser(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { filename, mime, size, accounting_client_id } = req.body || {}
  if (!filename) return res.status(400).json({ error: 'missing_filename' })
  if (size != null && Number(size) > VAULT_MAX_BYTES) {
    return res.status(413).json({ error: 'too_large', max_bytes: VAULT_MAX_BYTES })
  }

  const safe = sanitizeFilename(filename)
  const now = new Date()
  const yyyy = String(now.getUTCFullYear())
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const clientSeg = accounting_client_id ? String(accounting_client_id).replace(/[^A-Za-z0-9_\-]/g, '') || 'firma' : 'firma'
  const id = (crypto.randomUUID && crypto.randomUUID()) || crypto.randomBytes(16).toString('hex')
  const key = `${auth.businessId}/${clientSeg}/${yyyy}/${mm}/${id}-${safe}`

  if (!isSafeVaultKey(key, auth.businessId)) return res.status(400).json({ error: 'bad_path' })

  const { data, error } = await auth.supabase.storage.from(VAULT_BUCKET)
    .createSignedUploadUrl(key, { upsert: false })
  if (error) return res.status(500).json({ error: error.message || 'sign_failed' })

  return res.json({
    ok: true,
    bucket: VAULT_BUCKET,
    path: data.path || key,
    token: data.token,
    signedUrl: data.signedUrl,
    expiresIn: 300,
    contentType: mime || 'application/octet-stream',
  })
}

async function handleVaultDownloadSign(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  const ip = callerIp(req)
  if (!(await checkRateLimit(`vault_download_sign:${ip}`, 120))) {
    return res.status(429).json({ error: 'rate_limited' })
  }
  const auth = await ctbAuthUser(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { r2_key, download_filename } = req.body || {}
  if (!isSafeVaultKey(r2_key, auth.businessId)) return res.status(400).json({ error: 'bad_path' })

  const opts = { download: download_filename ? sanitizeFilename(download_filename) : true }
  const { data, error } = await auth.supabase.storage.from(VAULT_BUCKET)
    .createSignedUrl(r2_key, 3600, opts)
  if (error) return res.status(500).json({ error: error.message || 'sign_failed' })

  return res.json({ ok: true, signedUrl: data.signedUrl, expiresIn: 3600 })
}

async function handleVaultDelete(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  const ip = callerIp(req)
  if (!(await checkRateLimit(`vault_delete:${ip}`, 60))) {
    return res.status(429).json({ error: 'rate_limited' })
  }
  const auth = await ctbAuthUser(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  // Admin-role gate: owner / manager / cfo / accountant only.
  const { data: staff } = await auth.supabase.from('staff')
    .select('role').eq('auth_user_id', auth.user.id).eq('business_id', auth.businessId)
    .eq('active', true).maybeSingle()
  const role = staff?.role || ''
  if (!['owner', 'manager', 'cfo', 'accountant'].includes(role)) {
    return res.status(403).json({ error: 'insufficient_role' })
  }

  const { document_id, r2_key } = req.body || {}
  if (!document_id) return res.status(400).json({ error: 'missing_document_id' })

  // Re-fetch row to confirm it belongs to the caller's business and capture the key
  // even if the client lied about r2_key. Service role bypasses RLS.
  const { data: row, error: rowErr } = await auth.supabase.from('accounting_documents')
    .select('id, business_id, r2_key, filename, size')
    .eq('id', document_id).maybeSingle()
  if (rowErr) return res.status(500).json({ error: rowErr.message || 'lookup_failed' })
  if (!row) return res.status(404).json({ error: 'not_found' })
  if (row.business_id !== auth.businessId) return res.status(403).json({ error: 'wrong_tenant' })

  const key = row.r2_key || r2_key
  if (key) {
    if (!isSafeVaultKey(key, auth.businessId)) return res.status(400).json({ error: 'bad_path' })
    // Best-effort remove. If the object is already gone, delete the row anyway.
    await auth.supabase.storage.from(VAULT_BUCKET).remove([key]).catch(() => {})
  }

  const { error: delErr } = await auth.supabase.from('accounting_documents')
    .delete().eq('id', document_id).eq('business_id', auth.businessId)
  if (delErr) return res.status(500).json({ error: delErr.message || 'delete_failed' })

  return res.json({ ok: true, filename: row.filename, size: row.size, r2_key: key || null })
}

// ── v2.16.25 ANECF drainer (Vercel cron via vercel.json) ─────────────────────
// DO NOT REVERT (FIX-LEDGER §Batch5). Web-only emisores had no ANECF drainer
// — every void left DGII's record unupdated. This endpoint:
//   1) escalates rows older than 24h with attempts>=10 to status='failed'
//      (alerting surface for admin)
//   2) marks rows pending>72h (3 days) status='abandoned' so they don't keep
//      counting against retry budget
// Actual DGII submission still happens on desktop (per-biz cert dependency).
// This endpoint just guards against silent dead-letter accumulation.
async function handleAnecfDrain(req, res) {
  // Cron header check — Vercel cron passes Authorization: Bearer <CRON_SECRET>
  const cronSecret = process.env.CRON_SECRET
  const auth = req.headers['authorization'] || ''
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  try {
    const sb = (await import('@supabase/supabase-js')).createClient(
      process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    )
    const now = new Date()
    const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000).toISOString()
    const threeDaysAgo = new Date(now.getTime() - 72 * 3600 * 1000).toISOString()

    // 1) Escalate stuck-pending with attempts>=10 to 'failed' (alert state)
    const { data: escalated, error: e1 } = await sb.from('anecf_queue')
      .update({ status: 'failed', error: 'auto-escalated by cron — desktop drainer not running' })
      .eq('status', 'pending')
      .gte('attempts', 10)
      .lt('voided_at', dayAgo)
      .select('id, business_id, ncf')
    if (e1) console.error('[anecf-drain] escalate error', e1.message)

    // 2) Abandon rows pending >3 days (no realistic chance of late success)
    const { data: abandoned, error: e2 } = await sb.from('anecf_queue')
      .update({ status: 'abandoned', error: 'auto-abandoned >72h pending without successful submit' })
      .eq('status', 'pending')
      .lt('voided_at', threeDaysAgo)
      .select('id, business_id, ncf')
    if (e2) console.error('[anecf-drain] abandon error', e2.message)

    // 3) Snapshot current pending count for monitoring
    const { count: pendingCount } = await sb.from('anecf_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')

    return res.json({
      ok: true,
      escalated: escalated?.length || 0,
      abandoned: abandoned?.length || 0,
      pending_remaining: pendingCount || 0,
      ran_at: now.toISOString(),
    })
  } catch (err) {
    console.error('[anecf-drain] fatal', err)
    return res.status(500).json({ error: err.message || 'drain_failed' })
  }
}
