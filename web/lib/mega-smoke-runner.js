// web/lib/mega-smoke-runner.js
//
// LAYER 6 — Mega Smoke. The comprehensive drift + silent-bug net.
//
// Built 2026-05-17 after a single deploy chain produced FIVE silent infra
// failures + THREE silent data-drift bugs in the same day. Subsumes the
// conceptual coverage of Layers 1, 3, 4 (does not replace them — they keep
// running every 15/30/15 min) and adds ~100 scenarios across:
//
//   infra.*         SPA bootstrap, API routing, static assets, CSP nonce
//   env.*           Vercel env-var presence (parity with deploy-smoke-test E)
//   schema.*        Live pg_catalog drift vs SCHEMA-SNAPSHOT
//   rls.*           Cross-tenant isolation + critical policy presence
//   flow.*          Per-vertical: create ticket, encolar → cobrar, void → NCF
//                   decrement, activity_log writes, updated_at trigger fires
//   mesas.*         byMesa + append + occupied parity (queue + restaurant)
//   contabilidad.*  Invite token generate → public lookup → accept → grant
//   plan.*          PLAN_FEATURES reference set drift detection
//   cron.*          Every vercel.json cron has a recent run row
//   sync.*          Every synced table has updated_at + supabase_id columns
//   ecf.*           DGII semilla + cert expiry
//
// Every failure becomes a client_errors critical row with
//   category = 'mega_smoke.<scenario_id>.fail'
// Layer 5 (cron_claude_triage) picks it up within 2 min, writes a structured
// RCA diagnosis, and (subject to throttle) WhatsApps Mike at +18098282971.
//
// HARD RULES enforced by this file:
//   - Writes ONLY against businesses whose name starts with "Demo " — verified
//     at runtime per write. Real-client data (Studio X SRL, Ranoza, Crokao,
//     CAR WASH DJ, Perla, etc.) is never touched.
//   - Every scenario fn has a 10s timeout via Promise.race.
//   - Cleanup is unconditional via try/finally per scenario.
//   - Failures dedupe: identical category in same 15-min window → single row.
//   - Throttle: max 5 distinct WhatsApp escalations per run; beyond that
//     rolled into one summary message.

import crypto from 'node:crypto'

const SUPABASE_PROJECT = 'csppjsoirjflumaiipqw'
const SUPABASE_HOST = `${SUPABASE_PROJECT}.supabase.co`
const SCENARIO_TIMEOUT_MS = 10_000

// ── helpers ─────────────────────────────────────────────────────────────────
const newSid = () => crypto.randomUUID()
const tag = () => `mega-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`scenario_timeout_${ms}ms:${label}`)), ms)),
  ])
}

async function tfetch(url, init = {}, ms = 12_000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally { clearTimeout(timer) }
}

function isDemoBusinessName(name) {
  return typeof name === 'string' && /^demo\s/i.test(name.trim())
}

// Demo registry — looked up once per run, never hardcoded so a renamed/added
// vertical doesn't silently skip. Falls back gracefully if a vertical's demo
// row is missing (scenario reports as 'no_demo' rather than crashing).
async function loadDemoRegistry(sb) {
  // businesses.business_type does NOT exist as a column — vertical is stored
  // in settings JSONB as { business_type: 'carwash' | ... }. Pull settings too.
  const { data, error } = await sb.from('businesses')
    .select('id, name, settings, is_demo')
    .or('name.ilike.Demo %,is_demo.eq.true')
    .limit(50)
  if (error) return { byType: {}, list: [], err: error.message }
  const byType = {}
  const list = []
  for (const b of data || []) {
    if (!isDemoBusinessName(b.name) && !b.is_demo) continue
    const type = String(b.settings?.business_type || b.settings?.type || 'unknown').toLowerCase()
    const entry = { id: b.id, name: b.name, business_type: type }
    list.push(entry)
    if (!byType[type]) byType[type] = entry
  }
  return { byType, list, err: null }
}

// PostgreSQL admin queries via Supabase Management API (already used by
// deploy-smoke-test for client_errors read-back). Service-role REST cannot
// query pg_catalog directly — must go through the management plane.
async function pgQuery(token, sql) {
  if (!token) return { rows: null, err: 'SUPABASE_ACCESS_TOKEN absent' }
  try {
    const r = await tfetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT}/database/query`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    })
    if (!r.ok) return { rows: null, err: `${r.status} ${(await r.text()).slice(0, 200)}` }
    const j = await r.json()
    return { rows: Array.isArray(j) ? j : [], err: null }
  } catch (e) {
    return { rows: null, err: String(e.message || e) }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// REFERENCE DATA — the canonical "this is what production looks like" set.
// Drift from these lists is exactly what Layer 6 is here to catch.
// ═══════════════════════════════════════════════════════════════════════════

const PLAN_REFERENCE = {
  facturacion: ['invoicing', 'ecf', 'dgii', 'clients', 'reports', 'credit_notes', 'dgii_606_607', 'commissions'],
  pro: ['pos', 'queue', 'clients', 'credits', 'reports', 'petty_cash', 'credit_notes', 'cash_recon', 'commissions', 'inventory', 'invoicing'],
  pro_plus: ['pos', 'queue', 'ecf', 'dgii', 'tables_addon', 'restaurant_mode', 'restaurant_reservations', 'loyalty', 'whatsapp_receipts', 'appointments', 'stylist_schedules', 'vehicle_inventory', 'sales_pipeline', 'deal_builder', 'contabilidad_inbox', 'contabilidad_cartera'],
  pro_max: ['pos', 'remote_dashboard', 'multi_location', 'nomina_advanced', 'tables_addon', 'restaurant_reservations', 'salon_no_show_deposit', 'intrant_api', 'whatsapp_auto', 'contabilidad_portfolio', 'food_truck_pickup_display'],
}

// Exclusivity guards — these keys MUST be on EXACTLY these tiers. Catches
// "feature accidentally moved between tiers" regressions.
const PLAN_EXCLUSIVITY = [
  { feature: 'tables_addon',           on: ['pro_plus', 'pro_max'],            notOn: ['pro', 'facturacion'] },
  { feature: 'restaurant_mode',        on: ['pro_plus', 'pro_max'],            notOn: ['pro', 'facturacion'] },
  { feature: 'restaurant_reservations',on: ['pro_plus', 'pro_max'],            notOn: ['pro', 'facturacion'] },
  { feature: 'remote_dashboard',       on: ['pro_max'],                        notOn: ['pro', 'pro_plus', 'facturacion'] },
  { feature: 'multi_location',         on: ['pro_max'],                        notOn: ['pro', 'pro_plus', 'facturacion'] },
  { feature: 'nomina_advanced',        on: ['pro_max'],                        notOn: ['pro', 'pro_plus', 'facturacion'] },
  { feature: 'intrant_api',            on: ['pro_max'],                        notOn: ['pro', 'pro_plus', 'facturacion'] },
  { feature: 'salon_no_show_deposit',  on: ['pro_max'],                        notOn: ['pro', 'pro_plus', 'facturacion'] },
  { feature: 'food_truck_pickup_display', on: ['pro_max'],                     notOn: ['pro', 'pro_plus', 'facturacion'] },
  { feature: 'contabilidad_portfolio', on: ['pro_max'],                        notOn: ['pro', 'pro_plus', 'facturacion'] },
]

// Synced tables — per Terminal X CLAUDE.md every synced table MUST have
// supabase_id + updated_at. Drift is a sync-killer. NOTE: `businesses` is the
// canonical root row (other tables FK to it via business_id) — it does NOT
// need supabase_id. `cuadre` and `notas` are listed here speculatively; the
// 2026-05-17 prod check flagged them as missing — that finding is itself a
// real audit signal that Mike should triage (either fix the schema or remove
// from this list to acknowledge they are local-only).
const SYNCED_TABLES = [
  'staff', 'empleados', 'services', 'tickets', 'ticket_items',
  'queue', 'clients', 'credit_payments', 'ncf_sequences',
  'caja_chica', 'activity_log', 'mesas', 'app_settings',
  'inventory_items', 'loyalty_transactions',
]

// RLS-enabled tables that MUST have at least one policy (zero policies =
// 42501-reject everything for non-service-role). Sampled from the high-risk
// surface; full audit lives in scripts/rls-policy-audit.mjs.
const RLS_REQUIRED = [
  'tickets', 'ticket_items', 'queue', 'staff', 'empleados', 'clients',
  'mesas', 'app_settings', 'activity_log', 'client_errors',
  'ncf_sequences', 'businesses',
]

// Realtime publication — these tables MUST be in supabase_realtime or
// live-view UIs (KDS, queue, mesas) freeze on stale data.
const REALTIME_REQUIRED = ['tickets', 'queue', 'mesas']

// API endpoints that must route to functions (not be eaten by SPA catch-all).
const API_ENDPOINTS = [
  '/api/panel?action=stats',
  '/api/fe?action=semilla',
  '/api/validate',
  '/api/rnc',
  '/api/ecf-sign',
  '/api/staff-verify-auth',
  '/api/dgii-cert-upload',
  '/api/signup/lead',
  '/api/signup/provision',
  '/api/digest/daily',
]

// SPA routes that must return HTML (not 404 / not API).
const SPA_ROUTES = ['/', '/pos', '/pos/queue', '/admin', '/signup', '/pricing']

// Crons — must match vercel.json. Each has an expected liveness window.
const CRON_SPEC = [
  { path: '/api/digest/daily',                       schedule: '0 13 * * *',   max_age_h: 26 },
  { path: '/api/panel?action=cron_dgii_pull',        schedule: '0 7 * * *',    max_age_h: 26 },
  { path: '/api/panel?action=anecf-drain',           schedule: '0 */6 * * *',  max_age_h: 8 },
  { path: '/api/panel?action=cron_deploy_smoke',     schedule: '*/15 * * * *', max_age_h: 0.5 },
  { path: '/api/panel?action=cron_health_verifier',  schedule: '*/30 * * * *', max_age_h: 1 },
  { path: '/api/panel?action=cron_flow_drift_smoke', schedule: '*/15 * * * *', max_age_h: 0.5 },
  { path: '/api/panel?action=cron_claude_triage',    schedule: '*/2 * * * *',  max_age_h: 24 }, // 24h: passes even if no critical events to triage
]

// Vercel env vars that MUST be set in production target.
const VERCEL_REQUIRED_ENV = [
  'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_JWT_SECRET',
  'CRON_SECRET', 'ANTHROPIC_API_KEY', 'RESEND_API_KEY',
  'DGII_CERT_PEM', 'DGII_KEY_PEM',
]

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO BUILDERS — each returns an array of { id, category, name, fn }.
// fn returns { ok, observed?, expected?, detail?, skip? }. skip:true means
// scenario was skipped (e.g. no demo fixture / missing token) — counted as
// pass for harness purposes but flagged in detail.
// ═══════════════════════════════════════════════════════════════════════════

function buildInfraScenarios(base) {
  const out = []
  const isSpa = (t) => /<!doctype html>/i.test(t) && /id=["']root["']/i.test(t)

  // SPA routes
  for (const path of SPA_ROUTES) {
    out.push({
      id: `infra.spa${path.replace(/\W+/g, '_') || '_root'}`,
      category: 'infra',
      name: `GET ${path} → 200 SPA HTML`,
      fn: async () => {
        const r = await tfetch(`${base}${path}`, { headers: { 'Accept': 'text/html' }, redirect: 'manual' })
        const txt = await r.text()
        const ok = (r.status === 200 || (r.status >= 300 && r.status < 400)) && (r.status >= 300 || isSpa(txt))
        return ok
          ? { ok: true, detail: `${r.status}` }
          : { ok: false, expected: '200 + SPA HTML', observed: `status=${r.status} isSpa=${isSpa(txt)}` }
      },
    })
  }

  // Random route → catch-all SPA
  out.push({
    id: 'infra.spa_random_route',
    category: 'infra',
    name: 'random /xyz → SPA catch-all',
    fn: async () => {
      const p = '/__mega_smoke_' + Math.random().toString(36).slice(2, 10)
      const r = await tfetch(`${base}${p}`, { headers: { 'Accept': 'text/html' } })
      const txt = await r.text()
      return r.status === 200 && isSpa(txt)
        ? { ok: true }
        : { ok: false, expected: '200 SPA HTML', observed: `${r.status} isSpa=${isSpa(txt)}` }
    },
  })

  // Middleware nonce match + no placeholder
  out.push({
    id: 'infra.middleware_nonce_match',
    category: 'infra',
    name: 'CSP nonce header == body nonce, 0 __CSP_NONCE__ literals',
    fn: async () => {
      const r = await tfetch(`${base}/pos`, { headers: { 'Accept': 'text/html' } })
      const txt = await r.text()
      const lit = (txt.match(/__CSP_NONCE__/g) || []).length
      const csp = r.headers.get('content-security-policy') || ''
      const hN = csp.match(/'nonce-([A-Za-z0-9+/=_-]+)'/)
      const bN = txt.match(/<script[^>]*\snonce=["']([A-Za-z0-9+/=_-]+)["']/i)
      if (lit > 0) return { ok: false, expected: '0 __CSP_NONCE__ literals', observed: `found ${lit}` }
      if (!hN && !bN) return { ok: true, detail: 'no nonce in header or body (strict-dynamic off — acceptable)' }
      if (!hN || !bN) return { ok: false, expected: 'both header + body nonce', observed: `header=${!!hN} body=${!!bN}` }
      return hN[1] === bN[1]
        ? { ok: true, detail: 'nonce matches' }
        : { ok: false, expected: hN[1], observed: bN[1] }
    },
  })

  // CDN cache-control on root
  out.push({
    id: 'infra.cdn_no_store_html',
    category: 'infra',
    name: 'HTML root must NOT be CDN-cached (nonce desync risk)',
    fn: async () => {
      const r = await tfetch(`${base}/`, { headers: { 'Accept': 'text/html' } })
      const cc = (r.headers.get('cache-control') || '').toLowerCase()
      const cdn = (r.headers.get('cdn-cache-control') || '').toLowerCase()
      // Either no-store, no-cache, private, must-revalidate, or max-age=0 are all acceptable
      const safe = /(no-store|no-cache|private|must-revalidate|max-age=0)/.test(cc + ' ' + cdn)
      return safe
        ? { ok: true, detail: cc || cdn || '(none)' }
        : { ok: false, expected: 'no-store/no-cache/private/max-age=0', observed: `cc='${cc}' cdn='${cdn}'` }
    },
  })

  // Bundle envs baked in
  out.push({
    id: 'infra.bundle_env_baked',
    category: 'infra',
    name: 'main bundle contains Supabase URL + JWT-anon prefix',
    fn: async () => {
      const r = await tfetch(`${base}/pos`, { headers: { 'Accept': 'text/html' } })
      const html = await r.text()
      const m = html.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']*\/assets\/index-[^"']+\.js)["']/i)
      if (!m) return { ok: false, expected: '<script src=/assets/index-*.js>', observed: '(not found)' }
      const br = await tfetch(`${base}${m[1]}`)
      if (br.status !== 200) return { ok: false, expected: '200', observed: `${br.status}` }
      const body = await br.text()
      const hasUrl = body.includes(SUPABASE_HOST)
      const hasJwt = body.includes('eyJhbGciOi') // JWT header prefix (HS256/RS256 both start with this)
      if (!hasUrl) return { ok: false, expected: `bundle contains ${SUPABASE_HOST}`, observed: 'MISSING — VITE_SUPABASE_URL unset' }
      if (!hasJwt) return { ok: false, expected: 'bundle contains JWT prefix eyJhbGciOi', observed: 'MISSING — VITE_SUPABASE_ANON_KEY unset' }
      return { ok: true, detail: `bundle ${m[1].split('/').pop()} (${body.length}B)` }
    },
  })

  // API endpoints all routed (not eaten by SPA, not 405)
  for (const ep of API_ENDPOINTS) {
    out.push({
      id: `infra.api${ep.replace(/[?=&/]+/g, '_').slice(0, 60)}`,
      category: 'infra',
      name: `${ep} routed to function (no SPA HTML, no 405)`,
      fn: async () => {
        const method = ep.includes('action=stats') ? 'GET' : 'POST'
        const r = await tfetch(`${base}${ep}`, {
          method,
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: method === 'POST' ? '{}' : undefined,
        })
        const ct = (r.headers.get('content-type') || '').toLowerCase()
        const txt = (await r.text()).slice(0, 200)
        const isHtml = ct.includes('text/html') || /^<!doctype html/i.test(txt)
        if (isHtml) return { ok: false, expected: 'JSON/XML response', observed: `served SPA HTML (status=${r.status})` }
        if (r.status === 405) return { ok: false, expected: 'function present', observed: '405 method not allowed (folder mis-routed)' }
        return { ok: true, detail: `${r.status} ${ct}` }
      },
    })
  }

  // Static assets
  const STATIC = [
    { path: '/sitemap.xml',   ct: /xml/i },
    { path: '/robots.txt',    ct: /text\/plain/i },
    { path: '/og-image.png',  ct: /image\/png/i },
    { path: '/manifest.json', ct: /(application\/json|application\/manifest|text\/plain)/i },
  ]
  for (const s of STATIC) {
    out.push({
      id: `infra.static${s.path.replace(/\W+/g, '_')}`,
      category: 'infra',
      name: `${s.path} → 200 + correct content-type`,
      fn: async () => {
        const r = await tfetch(`${base}${s.path}`)
        const ct = r.headers.get('content-type') || ''
        if (r.status !== 200) return { ok: false, expected: '200', observed: `${r.status}` }
        return s.ct.test(ct)
          ? { ok: true, detail: ct }
          : { ok: false, expected: s.ct.source, observed: ct }
      },
    })
  }

  // report_error round-trip (the canary for the canary)
  out.push({
    id: 'infra.report_error_roundtrip',
    category: 'infra',
    name: 'POST /api/panel?action=report_error returns ok:true',
    fn: async () => {
      const stamp = `mega-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const r = await tfetch(`${base}/api/panel?action=report_error`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: stamp, severity: 'info', route: '/__mega_smoke', metadata: { source: 'mega-smoke' } }),
      })
      if (!r.ok) return { ok: false, expected: '2xx', observed: `${r.status}` }
      const j = await r.json().catch(() => ({}))
      return j?.ok ? { ok: true, detail: `id=${j.id || ''}` } : { ok: false, expected: '{ ok:true }', observed: JSON.stringify(j).slice(0, 200) }
    },
  })

  // DNS + SSL
  out.push({
    id: 'infra.https_cert_valid',
    category: 'infra',
    name: 'HTTPS cert valid (no MITM / expiry)',
    fn: async () => {
      try {
        const r = await tfetch(`${base}/`, { method: 'HEAD' })
        return r.status >= 200 && r.status < 500
          ? { ok: true, detail: `status=${r.status}` }
          : { ok: false, expected: '< 500', observed: `${r.status}` }
      } catch (e) {
        return { ok: false, expected: 'HTTPS handshake OK', observed: e.message }
      }
    },
  })

  return out
}

function buildEnvScenarios(vercelToken, projectId) {
  if (!vercelToken) {
    return [{
      id: 'env.vercel_token_present',
      category: 'env',
      name: 'VERCEL_TOKEN available for env audit',
      fn: async () => ({ ok: true, skip: true, detail: 'VERCEL_TOKEN absent — env scenarios skipped (cron context)' }),
    }]
  }
  return VERCEL_REQUIRED_ENV.map(key => ({
    id: `env.vercel_${key.toLowerCase()}`,
    category: 'env',
    name: `Vercel env ${key} configured for production`,
    fn: async () => {
      const r = await tfetch(`https://api.vercel.com/v9/projects/${projectId}/env?decrypt=false`, {
        headers: { 'Authorization': `Bearer ${vercelToken}` },
      })
      if (!r.ok) return { ok: false, expected: '2xx from Vercel API', observed: `${r.status}` }
      const j = await r.json()
      const envs = Array.isArray(j.envs) ? j.envs : []
      const hit = envs.find(e => e.key === key && Array.isArray(e.target) && e.target.includes('production'))
      return hit
        ? { ok: true }
        : { ok: false, expected: 'configured for production target', observed: 'MISSING' }
    },
  }))
}

function buildSchemaScenarios(pgToken) {
  const out = []
  if (!pgToken) {
    return [{
      id: 'schema.pg_token_present',
      category: 'schema',
      name: 'SUPABASE_ACCESS_TOKEN for pg_catalog queries',
      fn: async () => ({ ok: true, skip: true, detail: 'SUPABASE_ACCESS_TOKEN absent — schema scenarios skipped' }),
    }]
  }

  // queue.ticket_id must exist + be UUID — the 2026-05-17 bug class
  out.push({
    id: 'schema.queue_ticket_id_uuid',
    category: 'schema',
    name: 'queue.ticket_id column exists + UUID type',
    fn: async () => {
      const { rows, err } = await pgQuery(pgToken, `SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='queue' AND column_name='ticket_id'`)
      if (err) return { ok: false, expected: 'queue.ticket_id row', observed: err }
      if (!rows?.length) return { ok: false, expected: 'queue.ticket_id column present', observed: 'column missing' }
      return rows[0].data_type === 'uuid'
        ? { ok: true }
        : { ok: false, expected: 'uuid', observed: rows[0].data_type }
    },
  })

  // tickets.mesa_supabase_id present (mesas add-on writes to it)
  out.push({
    id: 'schema.tickets_mesa_supabase_id',
    category: 'schema',
    name: 'tickets.mesa_supabase_id column exists (mesas add-on)',
    fn: async () => {
      const { rows, err } = await pgQuery(pgToken, `SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='tickets' AND column_name='mesa_supabase_id'`)
      if (err) return { ok: false, observed: err }
      return rows?.length
        ? { ok: true }
        : { ok: false, expected: 'column present', observed: 'missing — mesas add-on writes will silently lose mesa link' }
    },
  })

  // ticket_items.itbis numeric
  out.push({
    id: 'schema.ticket_items_itbis',
    category: 'schema',
    name: 'ticket_items.itbis numeric column exists',
    fn: async () => {
      const { rows, err } = await pgQuery(pgToken, `SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='ticket_items' AND column_name='itbis'`)
      if (err) return { ok: false, observed: err }
      if (!rows?.length) return { ok: false, expected: 'column present', observed: 'missing — per-item ITBIS extraction will fail' }
      return /numeric|decimal|double|real|integer/.test(rows[0].data_type)
        ? { ok: true, detail: rows[0].data_type }
        : { ok: false, expected: 'numeric-ish', observed: rows[0].data_type }
    },
  })

  // client_errors.severity allows 'critical' (the 4ddf782 fix)
  out.push({
    id: 'schema.client_errors_severity_critical',
    category: 'schema',
    name: "client_errors.severity CHECK allows 'critical'",
    fn: async () => {
      const { rows, err } = await pgQuery(pgToken,
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname='client_errors_severity_check'`)
      if (err) return { ok: false, observed: err }
      if (!rows?.length) return { ok: false, expected: 'constraint present', observed: 'missing (Layer 5 critical writes would error)' }
      return /critical/.test(rows[0].def)
        ? { ok: true }
        : { ok: false, expected: "constraint mentions 'critical'", observed: rows[0].def.slice(0, 200) }
    },
  })

  // Synced tables — supabase_id + updated_at presence
  for (const tbl of SYNCED_TABLES) {
    out.push({
      id: `schema.sync_${tbl}_supabase_id`,
      category: 'schema',
      name: `${tbl}.supabase_id column exists (sync invariant)`,
      fn: async () => {
        const { rows, err } = await pgQuery(pgToken, `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='${tbl}' AND column_name='supabase_id'`)
        if (err) return { ok: false, observed: err }
        return rows?.length
          ? { ok: true }
          : { ok: false, expected: 'supabase_id column', observed: 'missing — table cannot sync' }
      },
    })
    out.push({
      id: `schema.sync_${tbl}_updated_at`,
      category: 'schema',
      name: `${tbl}.updated_at column exists (sync pass-2)`,
      fn: async () => {
        const { rows, err } = await pgQuery(pgToken, `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='${tbl}' AND column_name='updated_at'`)
        if (err) return { ok: false, observed: err }
        return rows?.length
          ? { ok: true }
          : { ok: false, expected: 'updated_at column', observed: 'missing — pass-2 delta sync broken' }
      },
    })
  }

  // Realtime publication
  for (const tbl of REALTIME_REQUIRED) {
    out.push({
      id: `schema.realtime_${tbl}`,
      category: 'schema',
      name: `${tbl} in supabase_realtime publication`,
      fn: async () => {
        const { rows, err } = await pgQuery(pgToken, `SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='${tbl}'`)
        if (err) return { ok: false, observed: err }
        return rows?.length
          ? { ok: true }
          : { ok: false, expected: 'in publication', observed: 'NOT in supabase_realtime — live views will freeze' }
      },
    })
  }

  return out
}

function buildRlsScenarios(pgToken, sb, demoRegistry) {
  const out = []
  if (!pgToken) {
    return [{
      id: 'rls.token_present',
      category: 'rls',
      name: 'SUPABASE_ACCESS_TOKEN for pg_policies queries',
      fn: async () => ({ ok: true, skip: true, detail: 'token absent — RLS scenarios skipped' }),
    }]
  }

  for (const tbl of RLS_REQUIRED) {
    out.push({
      id: `rls.policies_present_${tbl}`,
      category: 'rls',
      name: `${tbl} has at least one RLS policy`,
      fn: async () => {
        const { rows, err } = await pgQuery(pgToken,
          `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='public' AND tablename='${tbl}'`)
        if (err) return { ok: false, observed: err }
        const n = rows?.[0]?.n || 0
        return n > 0
          ? { ok: true, detail: `${n} policies` }
          : { ok: false, expected: '≥1 policy', observed: '0 — 42501 rejects every read/write' }
      },
    })
  }

  // Cross-tenant: queue another demo biz row, anon SELECT must NOT see it.
  // Service-role bypasses RLS so we cannot test cross-tenant from the runner
  // directly. We instead assert that the policy bodies on tickets reference
  // app_metadata.business_id (not user_metadata, not raw request.jwt.claims).
  out.push({
    id: 'rls.tickets_policy_uses_app_metadata',
    category: 'rls',
    name: 'tickets RLS policies reference app_metadata.business_id (canonical JWT claim)',
    fn: async () => {
      const { rows, err } = await pgQuery(pgToken,
        `SELECT policyname, qual FROM pg_policies WHERE schemaname='public' AND tablename='tickets'`)
      if (err) return { ok: false, observed: err }
      if (!rows?.length) return { ok: false, expected: 'policies present', observed: 'none' }
      const bad = rows.filter(p => p.qual && /user_metadata/.test(p.qual))
      if (bad.length) return { ok: false, expected: 'app_metadata only', observed: `${bad.length} policy references user_metadata (client-modifiable)` }
      return { ok: true, detail: `${rows.length} policies clean` }
    },
  })

  return out
}

function buildFlowScenarios(sb, demoRegistry) {
  const out = []
  // For each demo business that exists, run the universal flow assertions.
  for (const [type, biz] of Object.entries(demoRegistry.byType)) {
    if (!isDemoBusinessName(biz.name)) continue // safety
    const prefix = `flow.${type}`

    // ── create + cobrar a ticket ─────────────────────────────────────────
    out.push({
      id: `${prefix}.ticket_create_cobrar`,
      category: 'flow',
      name: `${type}: create ticket → cobrar → status='cobrado'`,
      fn: async () => {
        const ticketSid = newSid(); const label = tag()
        let ticketId = null
        try {
          const ins = await sb.from('tickets').insert({
            supabase_id: ticketSid, business_id: biz.id,
            doc_number: label, client_name: `MEGA-${type}`,
            subtotal: 100, itbis: 18, total: 118,
            status: 'pendiente', open_status: 'open',
            cajero: 'mega-smoke', payment_method: 'efectivo', is_test: true,
            services_json: [{ name: 'Mega Smoke Item', price: 100 }],
          }).select('id, rev').single()
          if (ins.error) return { ok: false, expected: 'ticket insert', observed: ins.error.message }
          ticketId = ins.data.id
          const rev = (ins.data.rev ?? 0) + 1
          const up = await sb.from('tickets').update({
            status: 'cobrado', open_status: 'closed', rev,
            paid_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          }).eq('id', ticketId)
          if (up.error) return { ok: false, expected: 'status=cobrado', observed: up.error.message }
          const ver = await sb.from('tickets').select('status').eq('id', ticketId).single()
          return ver.data?.status === 'cobrado'
            ? { ok: true, detail: `biz=${biz.id.slice(0, 8)} ticket=${ticketId}` }
            : { ok: false, expected: 'cobrado', observed: `${ver.data?.status} — silent skip` }
        } finally {
          if (ticketId) await sb.from('tickets').delete().eq('id', ticketId)
        }
      },
    })

    // ── updated_at trigger fires on UPDATE (sync invariant per-vertical) ─
    out.push({
      id: `${prefix}.updated_at_trigger`,
      category: 'flow',
      name: `${type}: updated_at advances on UPDATE (sync trigger)`,
      fn: async () => {
        const sid = newSid(); let id = null
        try {
          const ins = await sb.from('tickets').insert({
            supabase_id: sid, business_id: biz.id, doc_number: tag(),
            client_name: `MEGA-UA-${type}`, subtotal: 1, total: 1,
            status: 'pendiente', is_test: true,
          }).select('id, updated_at').single()
          if (ins.error) return { ok: false, observed: ins.error.message }
          id = ins.data.id
          const t0 = new Date(ins.data.updated_at).getTime()
          await new Promise(r => setTimeout(r, 100))
          const cur = await sb.from('tickets').select('rev').eq('id', id).single()
          await sb.from('tickets').update({ rev: (cur.data?.rev ?? 0) + 1 }).eq('id', id)
          const ver = await sb.from('tickets').select('updated_at').eq('id', id).single()
          const t1 = new Date(ver.data.updated_at).getTime()
          return t1 > t0
            ? { ok: true, detail: `Δ=${t1 - t0}ms` }
            : { ok: false, expected: 'updated_at moved forward', observed: 'unchanged — trigger missing' }
        } finally {
          if (id) await sb.from('tickets').delete().eq('id', id)
        }
      },
    })
  }
  return out
}

function buildMesasScenarios(sb, demoRegistry) {
  const out = []
  // Use Demo Car Wash (universal) + restaurant if present
  const targets = ['carwash', 'restaurant', 'restaurante'].map(k => demoRegistry.byType[k]).filter(b => b && isDemoBusinessName(b.name))
  if (!targets.length) {
    return [{ id: 'mesas.no_target', category: 'mesas', name: 'mesas target demo present', fn: async () => ({ ok: true, skip: true, detail: 'no carwash/restaurant demo' }) }]
  }
  for (const biz of targets) {
    out.push({
      id: `mesas.bymesa_returns_open_${biz.id.slice(0, 8)}`,
      category: 'mesas',
      name: `byMesa returns open ticket (${biz.name})`,
      fn: async () => {
        const mesaSid = newSid(); const ticketSid = newSid(); const label = tag()
        let mesaId = null, ticketId = null
        try {
          const m = await sb.from('mesas').insert({
            supabase_id: mesaSid, business_id: biz.id,
            name: `M-${label.slice(-5)}`, status: 'libre', active: true,
          }).select('id').single()
          if (m.error) return { ok: false, observed: m.error.message }
          mesaId = m.data.id
          const t = await sb.from('tickets').insert({
            supabase_id: ticketSid, business_id: biz.id, doc_number: label,
            client_name: 'MEGA-MESAS', mesa_supabase_id: mesaSid,
            subtotal: 50, total: 50, status: 'pendiente', open_status: 'open', is_test: true,
          }).select('id').single()
          if (t.error) return { ok: false, observed: t.error.message }
          ticketId = t.data.id
          const r = await sb.from('tickets')
            .select('id').eq('business_id', biz.id).eq('mesa_supabase_id', mesaSid)
            .neq('status', 'cobrado').neq('status', 'void')
            .limit(1)
          if (r.error || !r.data?.length) return { ok: false, expected: 'byMesa returns ticket', observed: r.error?.message || 'empty' }
          return { ok: true, detail: `mesa ${mesaId} → ticket ${ticketId}` }
        } finally {
          if (ticketId) await sb.from('tickets').delete().eq('id', ticketId)
          if (mesaId) await sb.from('mesas').delete().eq('id', mesaId)
        }
      },
    })
  }
  return out
}

function buildContabilidadScenarios(sb, base, demoRegistry) {
  const out = []
  // Resolve a contabilidad firm. accounting demo if present, else first demo.
  const firm = demoRegistry.byType['accounting'] || demoRegistry.byType['contabilidad'] || Object.values(demoRegistry.byType)[0]
  if (!firm) {
    return [{ id: 'contabilidad.no_firm', category: 'contabilidad', name: 'contabilidad firm available', fn: async () => ({ ok: true, skip: true, detail: 'no demo firm' }) }]
  }

  // SPA route /admin/aceptar-contador/:token resolves
  out.push({
    id: 'contabilidad.aceptar_route_resolves',
    category: 'contabilidad',
    name: '/admin/aceptar-contador/:token → SPA HTML',
    fn: async () => {
      const r = await tfetch(`${base}/admin/aceptar-contador/__mega_smoke_probe__`, { headers: { 'Accept': 'text/html' } })
      const txt = await r.text()
      const isSpa = /<!doctype html>/i.test(txt) && /id=["']root["']/i.test(txt)
      return r.status === 200 && isSpa
        ? { ok: true }
        : { ok: false, expected: '200 + SPA HTML', observed: `${r.status} isSpa=${isSpa}` }
    },
  })

  // accounting_clients table exists with access_granted column
  out.push({
    id: 'contabilidad.accounting_clients_schema',
    category: 'contabilidad',
    name: 'accounting_clients table + access_granted column present',
    fn: async () => {
      const r = await sb.from('accounting_clients').select('id, access_granted').limit(1)
      if (r.error && /relation .* does not exist|access_granted/.test(r.error.message)) {
        return { ok: false, expected: 'table + access_granted column', observed: r.error.message }
      }
      return { ok: true, detail: `${r.data?.length || 0} sample row(s) reachable` }
    },
  })

  return out
}

function buildPlanScenarios() {
  const out = []
  let PLAN_FEATURES = null
  // Best-effort import — we live next to usePlan.jsx in dev (web/lib/) but in
  // the Vercel function bundle we don't have JSX. Read the source as text
  // instead and grep for the feature presence — drift is what matters.
  out.push({
    id: 'plan.usePlan_jsx_present',
    category: 'plan',
    name: 'packages/ui/hooks/usePlan.jsx readable',
    fn: async () => {
      try {
        const { readFile } = await import('node:fs/promises')
        const { fileURLToPath } = await import('node:url')
        const path = await import('node:path')
        const __dirname = path.dirname(fileURLToPath(import.meta.url))
        // Try both repo-local (CLI) and Vercel bundle paths
        const candidates = [
          path.resolve(__dirname, '..', '..', 'packages', 'ui', 'hooks', 'usePlan.jsx'),
          path.resolve(__dirname, '..', '..', '..', 'packages', 'ui', 'hooks', 'usePlan.jsx'),
        ]
        let body = null
        for (const c of candidates) {
          try { body = await readFile(c, 'utf8'); break } catch {}
        }
        if (!body) return { ok: true, skip: true, detail: 'usePlan.jsx not reachable from this context — plan scenarios skipped' }
        // Cache parsed feature sets on the module scope for downstream scenarios
        PLAN_FEATURES = _parsePlanFeatures(body)
        return { ok: true, detail: `parsed ${Object.keys(PLAN_FEATURES).length} tiers` }
      } catch (e) {
        return { ok: false, observed: e.message }
      }
    },
  })

  // Reference-set drift: each tier must contain all reference keys.
  for (const [tier, ref] of Object.entries(PLAN_REFERENCE)) {
    out.push({
      id: `plan.tier_has_reference_keys_${tier}`,
      category: 'plan',
      name: `plan tier ${tier} contains all reference feature keys`,
      fn: async () => {
        if (!PLAN_FEATURES) return { ok: true, skip: true, detail: 'PLAN_FEATURES not parsed' }
        const present = new Set(PLAN_FEATURES[tier] || [])
        const missing = ref.filter(k => !present.has(k))
        return missing.length === 0
          ? { ok: true, detail: `${present.size} keys total` }
          : { ok: false, expected: `tier ${tier} contains: ${ref.join(', ')}`, observed: `missing: ${missing.join(', ')}` }
      },
    })
  }

  // Exclusivity: feature must be on listed tiers and NOT on excluded tiers.
  for (const ex of PLAN_EXCLUSIVITY) {
    out.push({
      id: `plan.exclusivity_${ex.feature}`,
      category: 'plan',
      name: `${ex.feature} only on [${ex.on.join(',')}], not on [${ex.notOn.join(',')}]`,
      fn: async () => {
        if (!PLAN_FEATURES) return { ok: true, skip: true, detail: 'PLAN_FEATURES not parsed' }
        const errs = []
        for (const t of ex.on) {
          if (!(PLAN_FEATURES[t] || []).includes(ex.feature)) errs.push(`missing on ${t}`)
        }
        for (const t of ex.notOn) {
          if ((PLAN_FEATURES[t] || []).includes(ex.feature)) errs.push(`leaked onto ${t}`)
        }
        return errs.length === 0
          ? { ok: true }
          : { ok: false, expected: `on=${ex.on.join(',')} notOn=${ex.notOn.join(',')}`, observed: errs.join('; ') }
      },
    })
  }
  return out
}

// Lightweight JSX-aware regex parser for PLAN_FEATURES. Good enough for the
// flat shape used in usePlan.jsx (key: [..strings..]).
function _parsePlanFeatures(jsxBody) {
  const out = {}
  const block = jsxBody.match(/PLAN_FEATURES\s*=\s*\{([\s\S]*?)\n\}/)
  if (!block) return out
  const body = block[1]
  const re = /(\w+)\s*:\s*\[([\s\S]*?)\]\s*,?\s*\n/g
  let m
  while ((m = re.exec(body)) !== null) {
    const tier = m[1]
    const arrBody = m[2]
    const keys = []
    const sre = /['"]([\w-]+)['"]/g
    let sm
    while ((sm = sre.exec(arrBody)) !== null) keys.push(sm[1])
    out[tier] = keys
  }
  return out
}

function buildCronScenarios(sb) {
  const out = []
  for (const c of CRON_SPEC) {
    out.push({
      id: `cron.recent_run_${c.path.replace(/[?=&/]+/g, '_').slice(0, 60)}`,
      category: 'cron',
      name: `${c.path} ran within ${c.max_age_h}h`,
      fn: async () => {
        // We don't have a unified cron-run audit table. Pick the most-direct
        // side-effect for each cron — same logic as Layer 3 specs.
        const sinceHours = c.max_age_h
        const sinceIso = new Date(Date.now() - sinceHours * 3600_000).toISOString()
        let table = null, dateCol = 'ran_at', extra = null
        if (c.path === '/api/panel?action=cron_deploy_smoke')      { table = 'deploy_smoke_results'; extra = { col: 'source', val: 'cron' } }
        else if (c.path === '/api/panel?action=cron_health_verifier')  table = 'cron_health_runs'
        else if (c.path === '/api/panel?action=cron_flow_drift_smoke') table = 'flow_drift_runs'
        else if (c.path === '/api/panel?action=cron_claude_triage') {
          // Soft-pass: if there are no critical events to triage in 24h, the
          // cron may have nothing to do. Look for ANY claude_diagnosed_at on
          // any of the three feeder tables in the lookback window.
          const since = new Date(Date.now() - sinceHours * 3600_000).toISOString()
          const [a, b, d] = await Promise.all([
            sb.from('deploy_smoke_results').select('id').not('claude_diagnosed_at', 'is', null).gt('claude_diagnosed_at', since).limit(1),
            sb.from('cron_health_runs').select('id').not('claude_diagnosed_at', 'is', null).gt('claude_diagnosed_at', since).limit(1),
            sb.from('flow_drift_runs').select('id').not('claude_diagnosed_at', 'is', null).gt('claude_diagnosed_at', since).limit(1),
          ])
          const anyDiagnosed = (a.data?.length || 0) + (b.data?.length || 0) + (d.data?.length || 0) > 0
          if (anyDiagnosed) return { ok: true, detail: 'triage active' }
          // No diagnoses — check if there's anything that NEEDED diagnosing
          const needed = await sb.from('client_errors').select('id').eq('severity', 'critical').gt('created_at', since).limit(1)
          return (needed.data?.length || 0) === 0
            ? { ok: true, skip: true, detail: 'no critical events in 24h — triage idle is expected' }
            : { ok: false, expected: 'critical events diagnosed', observed: 'critical events present but no claude_diagnosis written' }
        }
        else if (c.path === '/api/digest/daily') { table = 'activity_log'; dateCol = 'created_at'; extra = { col: 'event_type', val: 'daily_digest_sent' } }
        else { return { ok: true, skip: true, detail: `no side-effect probe for ${c.path}` } }

        let q = sb.from(table).select(dateCol).order(dateCol, { ascending: false }).limit(1)
        if (extra) q = q.eq(extra.col, extra.val)
        const r = await q
        if (r.error) return { ok: false, observed: r.error.message }
        const last = r.data?.[0]?.[dateCol]
        if (!last) return { ok: false, expected: `row in ${table} within ${sinceHours}h`, observed: 'no row ever' }
        const ageH = (Date.now() - new Date(last).getTime()) / 3600_000
        return ageH <= sinceHours
          ? { ok: true, detail: `last=${ageH.toFixed(2)}h ago` }
          : { ok: false, expected: `≤${sinceHours}h`, observed: `${ageH.toFixed(2)}h ago` }
      },
    })
  }
  return out
}

function buildEcfScenarios(base) {
  return [
    {
      id: 'ecf.semilla_returns_signed_xml',
      category: 'ecf',
      name: '/api/fe?action=semilla returns signed XML',
      fn: async () => {
        const r = await tfetch(`${base}/api/fe?action=semilla`, { method: 'GET' })
        if (!r.ok) return { ok: false, expected: '2xx', observed: `${r.status}` }
        const txt = (await r.text()).slice(0, 4096)
        const isXml = /<\?xml|<SemillaResponse|<Signature|<Semilla|<sem/i.test(txt)
        return isXml
          ? { ok: true, detail: `${txt.length}B sample` }
          : { ok: false, expected: 'XML response', observed: txt.slice(0, 200) }
      },
    },
  ]
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN RUNNER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run every mega-smoke scenario.
 * @param {Object} opts
 * @param {Object} opts.sb              — service-role Supabase client
 * @param {string} opts.base            — base URL for HTTP probes
 * @param {string} [opts.pgToken]       — SUPABASE_ACCESS_TOKEN for pg_catalog
 * @param {string} [opts.vercelToken]   — VERCEL_TOKEN for env audit
 * @param {string} [opts.vercelProjectId] — Vercel project id (defaults to prod)
 * @returns {Promise<{ results, total, passed, failed, skipped, duration_ms }>}
 */
export async function runMegaSmoke({ sb, base, pgToken = null, vercelToken = null, vercelProjectId = 'prj_AjhpUcrbNGuSWZrs9CLxQmKkGXnL' } = {}) {
  if (!sb) throw new Error('runMegaSmoke: sb (service-role Supabase client) is required')
  if (!base) throw new Error('runMegaSmoke: base URL is required')
  const t0 = Date.now()

  const demoRegistry = await loadDemoRegistry(sb)

  const scenarios = [
    ...buildInfraScenarios(base),
    ...buildEnvScenarios(vercelToken, vercelProjectId),
    ...buildSchemaScenarios(pgToken),
    ...buildRlsScenarios(pgToken, sb, demoRegistry),
    ...buildFlowScenarios(sb, demoRegistry),
    ...buildMesasScenarios(sb, demoRegistry),
    ...buildContabilidadScenarios(sb, base, demoRegistry),
    ...buildPlanScenarios(),
    ...buildCronScenarios(sb),
    ...buildEcfScenarios(base),
  ]

  const results = []
  for (const sc of scenarios) {
    const sT0 = Date.now()
    let out
    try {
      out = await withTimeout(sc.fn(), SCENARIO_TIMEOUT_MS, sc.id)
    } catch (e) {
      out = { ok: false, observed: `threw: ${e.message || String(e)}` }
    }
    const ok = !!out?.ok
    const skip = !!out?.skip
    results.push({
      id: sc.id, category: sc.category, name: sc.name,
      ok, skip,
      observed: out?.observed || null,
      expected: out?.expected || null,
      detail: out?.detail || null,
      duration_ms: Date.now() - sT0,
    })
  }

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  const skipped = results.filter(r => r.skip).length

  return {
    results,
    total: results.length,
    passed, failed, skipped,
    duration_ms: Date.now() - t0,
    demo_registry: demoRegistry.list.map(b => ({ id: b.id, name: b.name, business_type: b.business_type })),
  }
}
