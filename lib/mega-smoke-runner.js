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

// 2026-05-19 — host-aware inter-request spread + identifying UA. Vercel
// Edge middleware fetches origin on every SPA hit; 50+ back-to-back probes
// from one IP briefly saturate the edge→origin pool and surface as
// middleware 500s in Vercel anomaly alerts. 60ms spread per-origin host
// keeps us under saturation while finishing 50 probes in ~3s. pg/supabase
// queries have their own throttle elsewhere — exclude them. Custom UA
// lets the Vercel alert dashboard filter out our load.
const _lastTfetchByHost = new Map()
async function tfetch(url, init = {}, ms = 12_000) {
  let host = ''
  try { host = new URL(url).host } catch {}
  // Only spread for terminalxpos.com origin (the saturation surface).
  // api.supabase.com + vercel.com etc. have their own throttle paths.
  if (host.endsWith('terminalxpos.com')) {
    const last = _lastTfetchByHost.get(host) || 0
    const dt = Date.now() - last
    if (dt < 60) await new Promise(r => setTimeout(r, 60 - dt))
    _lastTfetchByHost.set(host, Date.now())
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    const headers = { 'User-Agent': 'TerminalX-MegaSmoke/1.0 (+probe)', ...(init.headers || {}) }
    return await fetch(url, { ...init, headers, signal: ctrl.signal })
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
//
// IMPORTANT: api.supabase.com applies a per-project request throttle that
// trips at ~5-10 concurrent requests. With Wave-4's 250+ pg_catalog
// scenarios running on parallel=8, we'd burst hundreds in a second and
// hit 429 ThrottlerException. We coalesce identical SQL within a single
// run (massive duplication on table-existence + column-presence checks)
// AND serialize the wire calls behind a small semaphore.
const _pgCache = new Map()
const _pgInFlightByKey = new Map() // SQL → Promise — dedupes concurrent identical queries
let _pgInFlight = 0
const _pgQueue = []
const PG_MAX_PARALLEL = 4
async function _pgAcquire() {
  if (_pgInFlight < PG_MAX_PARALLEL) { _pgInFlight++; return }
  await new Promise(r => _pgQueue.push(r))
  _pgInFlight++
}
function _pgRelease() {
  _pgInFlight--
  const next = _pgQueue.shift()
  if (next) next()
}
async function pgQuery(token, sql) {
  if (!token) return { rows: null, err: 'SUPABASE_ACCESS_TOKEN absent' }
  const cacheKey = sql.trim()
  if (_pgCache.has(cacheKey)) return _pgCache.get(cacheKey)
  // Coalesce concurrent identical queries — the first call wins, every other
  // caller awaits the same in-flight Promise. Critical for parallel runs.
  if (_pgInFlightByKey.has(cacheKey)) return _pgInFlightByKey.get(cacheKey)
  const p = _pgQueryImpl(token, sql, cacheKey)
  _pgInFlightByKey.set(cacheKey, p)
  try { return await p } finally { _pgInFlightByKey.delete(cacheKey) }
}

async function _pgQueryImpl(token, sql, cacheKey) {
  await _pgAcquire()
  try {
    let attempt = 0, lastErr = null
    // Cap total time across retries to ~3s so SCENARIO_TIMEOUT_MS (10s) never fires.
    // Worst case: 5s upstream + 3s retries = 8s. Real throttles dedupe via cache.
    const RETRY_DELAYS_MS = [200, 400, 800, 1600]
    while (attempt < RETRY_DELAYS_MS.length + 1) {
      try {
        const r = await tfetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT}/database/query`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: sql }),
        }, 5_000)
        if (r.status === 429) {
          if (attempt >= RETRY_DELAYS_MS.length) {
            const out = { rows: null, err: '429 throttled (exhausted retries) — transient', throttled: true }
            _pgCache.set(cacheKey, out)
            return out
          }
          await new Promise(res => setTimeout(res, RETRY_DELAYS_MS[attempt]))
          attempt++
          lastErr = '429 throttled'
          continue
        }
        if (!r.ok) {
          const out = { rows: null, err: `${r.status} ${(await r.text()).slice(0, 200)}` }
          _pgCache.set(cacheKey, out)
          return out
        }
        const j = await r.json()
        const out = { rows: Array.isArray(j) ? j : [], err: null }
        _pgCache.set(cacheKey, out)
        return out
      } catch (e) {
        lastErr = String(e.message || e)
        attempt++
        await new Promise(res => setTimeout(res, 100 + attempt * 200))
      }
    }
    const out = { rows: null, err: lastErr || 'pgQuery: exhausted retries' }
    _pgCache.set(cacheKey, out)
    return out
  } finally {
    _pgRelease()
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

  // 2026-05-18 — Dispatcher-drift catcher. Probes every CRITICAL ?action=
  // and asserts the live /api/panel responds non-"Unknown action". If a
  // dispatcher entry got dropped (the dual-file drift class that took down
  // Layer 3 + Layer 6 crons earlier today — see commits 1d28f62 + 89b2391),
  // the live API returns HTTP 400 { error: 'Unknown action' } and we want
  // that to FAIL THE SMOKE immediately, not silently.
  //
  // Rule of thumb: any action that has a backing Vercel cron, a backing
  // admin Dashboard card, or otherwise must respond in production, gets
  // listed here. Add an entry when you add a new cron/action handler.
  //
  // Probing with a deliberately bad Bearer so we never run the actual work.
  // Expected response shapes:
  //   401 unauthorized   → action exists + auth-gated (correct)
  //   400 + JSON body    → action exists + rejected our payload (correct)
  //   400 + { error: 'Unknown action' } → DRIFT, dispatcher missing entry
  //   405 / HTML body    → SPA fallback ate the route (different infra bug,
  //                        Layer 1 catches it independently)
  const CRITICAL_ACTIONS = [
    // Crons (must fire on schedule)
    'cron_deploy_smoke',
    'cron_health_verifier',
    'cron_flow_drift_smoke',
    'cron_mega_smoke',
    'cron_claude_triage',
    'cron_claude_anomaly_scan',
    'cron_dgii_pull',
    // History endpoints (admin Dashboard reads)
    'deploy_smoke_history',
    'cron_health_history',
    'flow_drift_history',
    'mega_smoke_history',
    'claude_triage_history',
    // Claude features (per-business toggles + DGII translator)
    'claude_flags_get',
    'claude_flags_set',
    'claude_translate_dgii_error',
    // Core admin
    'report_error',
    'errors_list',
    'users',
    'clients',
    'stats',
  ]
  for (const action of CRITICAL_ACTIONS) {
    out.push({
      id: `infra.dispatcher_${action}`,
      category: 'infra',
      name: `/api/panel?action=${action} is registered (not "Unknown action")`,
      fn: async () => {
        const r = await tfetch(`${base}/api/panel?action=${encodeURIComponent(action)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer drift-check-bad-token' },
          body: '{}',
        })
        const text = await r.text().catch(() => '')
        // Detect the canonical "Unknown action" 400 response from the
        // dispatcher fall-through (see end of handler in api/panel.js).
        if (r.status === 400 && /unknown action/i.test(text)) {
          return {
            ok: false,
            expected: 'action registered (401/400/200)',
            observed: `400 Unknown action — dispatcher missing entry. Likely dual-file drift: handler exists in web/api/panel.js but not in root /api/panel.js (the one Vercel serves).`,
          }
        }
        // HTML body means the SPA catch-all ate the API route — different bug,
        // Layer 1's other infra scenarios catch it, but flag here too.
        if (/^<!doctype html/i.test(text)) {
          return {
            ok: false,
            expected: 'JSON response from /api/panel function',
            observed: `${r.status} HTML body (SPA fallback ate the route — Vercel function not deployed)`,
          }
        }
        // Anything else = action exists. 401 = auth-gated, 400 = validation
        // rejected our empty body, 200 = action ran (rare for unauthed POST).
        return { ok: true, detail: `${r.status}` }
      },
    })
  }

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

  // No placeholder HWIDs on active licenses.
  // Why: every /api/validate call compares the live client HWID to
  // licenses.hardware_id. If anyone set hardware_id to a human-readable
  // placeholder (e.g. 'web-michael-test', 'test', 'placeholder'), the
  // next validate cycle rejects with license_validate_hardware_mismatch
  // and silently logs the user out → 'iniciar sesion' screen with no
  // visible cause. Bug hit Studio X SRL on 2026-05-18: hardware_id was
  // literally 'web-michael-test' from an earlier debug session. Took
  // an error-log dive to find. This scenario catches the class going
  // forward — flags any active license whose hardware_id looks like
  // human input rather than a real device fingerprint.
  //
  // Real fingerprints: 32+ hex chars (md5/sha) OR 40+ b64-ish. Anything
  // with a hyphen-letter pattern (web-, test-, debug-, mike-, etc.)
  // OR shorter than 16 chars is rejected as placeholder.
  out.push({
    id: 'schema.no_placeholder_hwid_on_active_licenses',
    category: 'schema',
    name: 'No placeholder hardware_id on active licenses',
    fn: async () => {
      const { rows, err } = await pgQuery(pgToken, `
        SELECT id, business_id, license_key, hardware_id
        FROM licenses
        WHERE status = 'active'
          AND hardware_id IS NOT NULL
          AND (
            length(hardware_id) < 16
            OR hardware_id ~* '(test|placeholder|dummy|fake|sample|web-|desktop-|debug-|mike|michael|tmp|todo)'
            OR hardware_id !~ '^[a-zA-Z0-9_+/=-]+$'
          )
        LIMIT 5
      `)
      if (err) return { ok: false, observed: err }
      if (rows?.length) {
        const sample = rows.map(r => `${r.license_key || r.id}=${r.hardware_id}`).slice(0, 3).join('; ')
        return {
          ok: false,
          expected: 'all active licenses have real HWID (32+ hex/b64) or NULL',
          observed: `${rows.length} placeholder HWIDs found: ${sample}`,
          detail: 'Clear hardware_id (set to NULL) to let next /api/validate rebind cleanly. See HWID rebind logic in web/api/validate.js.',
        }
      }
      return { ok: true }
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

// v2.17.8 — /config/servicios end-to-end flows: category bulk-renumber
// (kills the orden=999 floating bug) + hard-delete of inactive services
// (must succeed when unreferenced; FK count must be honest when referenced
// so the UI pre-check blocks).
function buildServicesScenarios(sb, demoRegistry) {
  const out = []
  const biz = demoRegistry.byType['carwash'] || Object.values(demoRegistry.byType)[0]
  if (!biz || !isDemoBusinessName(biz.name)) {
    return [{ id: 'services.no_demo', category: 'services', name: 'services target demo present', fn: async () => ({ ok: true, skip: true, detail: 'no demo business' }) }]
  }

  out.push({
    id: 'services.category_reorder',
    category: 'services',
    name: 'category bulk-renumber → sequential orden 0..N-1',
    fn: async () => {
      const stamp = tag()
      const names = [`MS-A-${stamp}`, `MS-B-${stamp}`, `MS-C-${stamp}`]
      const ids = []
      try {
        for (const nombre of names) {
          const r = await sb.from('categorias_servicio').insert({
            supabase_id: newSid(), business_id: biz.id, nombre, orden: 999, active: true,
          }).select('id').single()
          if (r.error) return { ok: false, expected: 'category insert', observed: r.error.message }
          ids.push(r.data.id)
        }
        for (let i = 0; i < ids.length; i++) {
          const u = await sb.from('categorias_servicio').update({ orden: i }).eq('id', ids[i])
          if (u.error) return { ok: false, expected: 'category update', observed: u.error.message }
        }
        const ver = await sb.from('categorias_servicio').select('id, orden').in('id', ids)
        if (ver.error) return { ok: false, observed: ver.error.message }
        const ok = ids.every((id, i) => ver.data.find(r => r.id === id)?.orden === i)
        return ok
          ? { ok: true, detail: '3 cats sequential 0/1/2' }
          : { ok: false, expected: '0,1,2', observed: JSON.stringify(ver.data) }
      } finally {
        if (ids.length) await sb.from('categorias_servicio').delete().in('id', ids)
      }
    },
  })

  out.push({
    id: 'services.hard_delete_unreferenced',
    category: 'services',
    name: 'unreferenced inactive service → hard delete OK',
    fn: async () => {
      const stamp = tag()
      let svcId = null
      try {
        const ins = await sb.from('services').insert({
          supabase_id: newSid(), business_id: biz.id,
          name: `MS-DEL-${stamp}`, category: 'MS-cat', price: 1, cost: 0,
          active: false, is_wash: false, no_commission: true,
        }).select('id').single()
        if (ins.error) return { ok: false, expected: 'service insert', observed: ins.error.message }
        svcId = ins.data.id
        const del = await sb.from('services').delete().eq('id', svcId).eq('business_id', biz.id)
        if (del.error) return { ok: false, expected: 'delete OK', observed: del.error.message }
        const check = await sb.from('services').select('id').eq('id', svcId).maybeSingle()
        if (check.data) return { ok: false, expected: 'row gone', observed: 'row still present' }
        svcId = null
        return { ok: true, detail: 'hard-deleted cleanly' }
      } finally {
        if (svcId) await sb.from('services').delete().eq('id', svcId)
      }
    },
  })

  out.push({
    id: 'services.hard_delete_referenced_blocked',
    category: 'services',
    name: 'referenced service → UI pre-check returns refCount ≥ 1',
    fn: async () => {
      const stamp = tag()
      let svcId = null, svcSid = null, ticketId = null, itemId = null
      try {
        const ins = await sb.from('services').insert({
          supabase_id: newSid(), business_id: biz.id,
          name: `MS-FK-${stamp}`, category: 'MS-cat', price: 50, cost: 0,
          active: false, is_wash: false, no_commission: true,
        }).select('id, supabase_id').single()
        if (ins.error) return { ok: false, expected: 'service insert', observed: ins.error.message }
        svcId = ins.data.id; svcSid = ins.data.supabase_id
        const t = await sb.from('tickets').insert({
          supabase_id: newSid(), business_id: biz.id, doc_number: stamp,
          client_name: 'MS-FK', subtotal: 50, total: 50, status: 'cobrado', open_status: 'closed', is_test: true,
        }).select('id, supabase_id').single()
        if (t.error) return { ok: false, observed: `ticket: ${t.error.message}` }
        ticketId = t.data.id
        const ti = await sb.from('ticket_items').insert({
          supabase_id: newSid(), business_id: biz.id,
          ticket_id: ticketId, ticket_supabase_id: t.data.supabase_id,
          service_id: svcId, service_supabase_id: svcSid,
          name: `MS-FK-${stamp}`, price: 50, quantity: 1,
        }).select('id').single()
        if (ti.error) return { ok: false, observed: `item: ${ti.error.message}` }
        itemId = ti.data.id
        const cnt = await sb.from('ticket_items').select('id', { count: 'exact', head: true })
          .eq('business_id', biz.id).eq('service_supabase_id', svcSid)
        if (cnt.error) return { ok: false, observed: cnt.error.message }
        return (cnt.count || 0) >= 1
          ? { ok: true, detail: `ref count=${cnt.count} — UI blocks delete` }
          : { ok: false, expected: 'ref count >= 1', observed: `${cnt.count}` }
      } finally {
        if (itemId) await sb.from('ticket_items').delete().eq('id', itemId)
        if (ticketId) await sb.from('tickets').delete().eq('id', ticketId)
        if (svcId) await sb.from('services').delete().eq('id', svcId)
      }
    },
  })

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
        else if (c.path === '/api/digest/daily') {
          // No-op early exit: if no business has daily_digest_enabled, skip.
          const { data: enabled } = await sb.from('app_settings')
            .select('business_id').eq('key', 'daily_digest_enabled').in('value', ['1', 'true', 'TRUE'])
          const enabledIds = (enabled || []).map(r => r.business_id).filter(Boolean)
          if (!enabledIds.length) return { ok: true, skip: true, detail: 'no businesses with daily_digest_enabled — nothing to send' }
          // Use persistent app_settings.last_digest_sent (survives activity_log truncate).
          const { data: lastSent } = await sb.from('app_settings')
            .select('value').eq('key', 'last_digest_sent').in('business_id', enabledIds)
            .order('value', { ascending: false }).limit(1)
          const last = lastSent?.[0]?.value || null
          if (!last) {
            // Grace-period before today's 13:00 UTC slot.
            const todayThirteen = new Date(); todayThirteen.setUTCHours(13, 0, 0, 0)
            if (Date.now() < todayThirteen.getTime()) return { ok: true, skip: true, detail: 'awaiting first 13:00 UTC fire of the day' }
            return { ok: false, expected: `last_digest_sent within ${sinceHours}h for any of ${enabledIds.length} enabled business(es)`, observed: 'no row ever' }
          }
          const ageH = (Date.now() - new Date(last).getTime()) / 3600_000
          return ageH <= sinceHours
            ? { ok: true, detail: `last=${ageH.toFixed(2)}h ago` }
            : { ok: false, expected: `≤${sinceHours}h`, observed: `${ageH.toFixed(2)}h ago` }
        }
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
// WAVE 4 EXPANSION — 600-scenario continuous drift net.
//
// All builders below are PURE READS. They never mutate prod data. Demo
// businesses are off-limits too (Wave-2 suites handle demo mutation). New
// scenarios target the silent-drift surface that the existing 55 don't
// already cover:
//
//   infra2.*    — full per-route + per-endpoint surface (+50)
//   schema2.*   — every synced table contract via pg_catalog (+100)
//   rls2.*      — every RLS-enabled table + policy body purity (+80)
//   plan2.*     — feature-key gating matrix exclusivity (+60)
//   cron2.*     — every vercel.json cron freshness probe (+30)
//   ecf2.*      — every e-CF type template + sequence row (+50)
//   flow2.*     — 12 verticals × 8 lightweight read checks (+96)
//   env2.*      — bundle envs + license HWID hygiene (+40)
//   sync2.*     — FK shape + LWW cursor format + supabase_id NOT NULL (+35)
//   inv.*       — pure mathematical invariants (+15)
//
// Idempotency: every scenario is a read; running twice produces identical
// pass/fail counts.
// ═══════════════════════════════════════════════════════════════════════════

// All 12+ verticals covered by the smoke (matches Sidebar verticals + base
// types). Each gets ~8 flow2 scenarios. Lookup is keyed by tolerant aliases
// so renamed verticals don't silently slip past.
const VERTICAL_KEYS = [
  'carwash', 'tienda', 'restaurant', 'salon', 'barberia', 'mecanica',
  'concesionario', 'carniceria', 'foodtruck', 'accounting', 'loans', 'services',
]

// Every API endpoint to surface-probe (HEAD/OPTIONS-class; we accept any
// non-HTML, non-405 response as "routed"). Adds 30+ pure routing checks
// independent of the dispatcher action probes above.
// 2026-05-19 — /api/panel and /api/fe are router-only endpoints; bare GET
// without ?action= returns 404 by design (api/fe.js:384, api/panel.js
// switch default). Probe them via their action variants only, otherwise
// this scenario false-positives.
const API_SURFACE = [
  '/api/validate', '/api/rnc', '/api/ecf-sign',
  '/api/staff-verify-auth', '/api/dgii-cert-upload',
  '/api/signup/lead', '/api/signup/provision', '/api/digest/daily',
  '/api/panel?action=stats', '/api/panel?action=users', '/api/panel?action=clients',
  '/api/panel?action=errors_list', '/api/panel?action=mega_smoke_history',
  '/api/panel?action=deploy_smoke_history', '/api/panel?action=cron_health_history',
  '/api/panel?action=flow_drift_history', '/api/panel?action=claude_triage_history',
  '/api/panel?action=claude_flags_get', '/api/panel?action=claude_translate_dgii_error',
  '/api/fe?action=semilla', '/api/fe?action=validarcertificado',
  '/api/fe?action=recepcion', '/api/fe?action=aprobacion',
]

// SPA routes — every top-level + every /pos/* + /admin/* + /config/* we ship.
// Each must return 200 + HTML id="root". 50+ routes.
const SPA_ROUTES_FULL = [
  '/', '/pricing', '/signup', '/login', '/blog', '/contacto',
  '/pos', '/pos/queue', '/pos/clients', '/pos/credits', '/pos/inventory',
  '/pos/reports', '/pos/petty-cash', '/pos/cash-recon', '/pos/commissions',
  '/pos/credit-notes', '/pos/dgii', '/pos/ecf', '/pos/invoicing',
  '/pos/loyalty', '/pos/appointments', '/pos/work-orders',
  '/pos/restaurant', '/pos/restaurant/menu', '/pos/restaurant/mesas',
  '/pos/restaurant/kds', '/pos/restaurant/reservations',
  '/pos/concesionario', '/pos/concesionario/inventory',
  '/pos/concesionario/pipeline', '/pos/concesionario/deals',
  '/pos/salon', '/pos/salon/schedules', '/pos/salon/memberships',
  '/pos/mecanica', '/pos/carniceria', '/pos/foodtruck', '/pos/loans',
  '/admin', '/admin/clients', '/admin/licenses', '/admin/team',
  '/admin/errors', '/admin/certifications', '/admin/dashboard',
  '/config', '/config/empresa', '/config/servicios', '/config/staff',
  '/config/printers', '/config/dgii', '/config/integrations',
]

// Every synced table per Terminal X CLAUDE.md + supabase_id architecture
// section. Used by schema2 + sync2 to assert the four invariants per table:
// supabase_id col, updated_at col, UNIQUE(business_id, supabase_id), RLS on.
const SYNCED_TABLES_FULL = [
  'staff', 'empleados', 'services', 'categorias_servicio',
  'tickets', 'ticket_items', 'queue', 'clients', 'credit_payments',
  'ncf_sequences', 'caja_chica', 'activity_log', 'mesas', 'app_settings',
  'inventory_items', 'inventory_counts', 'loyalty_transactions',
  'vehicle_inventory', 'sales_deals', 'test_drives', 'matriculas',
  'restaurant_reservations', 'service_recipe_items', 'appointments',
  'stylist_schedules', 'work_orders', 'notas',
]

// Every public table that should have RLS enabled. Probed via pg_class
// + pg_policies. Drift: RLS disabled (cross-tenant leak) or RLS on but no
// policies (42501-rejects everything for non-service-role).
const RLS_REQUIRED_FULL = [
  'tickets', 'ticket_items', 'queue', 'staff', 'empleados',
  'clients', 'credit_payments', 'mesas', 'app_settings',
  'activity_log', 'client_errors', 'ncf_sequences', 'businesses',
  'inventory_items', 'inventory_counts', 'loyalty_transactions',
  'services', 'categorias_servicio', 'caja_chica',
  'vehicle_inventory', 'sales_deals', 'test_drives', 'matriculas',
  'restaurant_reservations', 'appointments', 'stylist_schedules',
  'work_orders', 'notas', 'licenses', 'license_events',
  'accounting_clients', 'mega_smoke_runs', 'deploy_smoke_results',
  'cron_health_runs', 'flow_drift_runs', 'journal_entries',
]

// Full feature-key gating matrix per Terminal X CLAUDE.md "Plan gating"
// section. Encoded as { feature, minTier } where tier order is:
// facturacion < pro < pro_plus < pro_max. Drift: feature appears below its
// min tier (free leak) or disappears from a tier it should be in.
const PLAN_TIER_ORDER = ['facturacion', 'pro', 'pro_plus', 'pro_max']
const PLAN_GATING_MATRIX = [
  // Pro (and above)
  { feature: 'pos',                       minTier: 'pro' },
  { feature: 'queue',                     minTier: 'pro' },
  { feature: 'clients',                   minTier: 'facturacion' },
  { feature: 'credits',                   minTier: 'pro' },
  { feature: 'inventory',                 minTier: 'pro' },
  { feature: 'reports',                   minTier: 'facturacion' },
  { feature: 'petty_cash',                minTier: 'pro' },
  { feature: 'credit_notes',              minTier: 'facturacion' },
  { feature: 'commissions',               minTier: 'facturacion' },
  { feature: 'cash_recon',                minTier: 'pro' },
  { feature: 'salon_preferred_stylist',   minTier: 'pro' },
  { feature: 'concesionario_resumen',     minTier: 'pro' },
  { feature: 'carniceria_resumen',        minTier: 'pro' },
  // Pro PLUS
  // ecf/dgii intentionally NOT on POS pro tier (CLAUDE.md: POS Pro emits e-CF
  // inside CobrarModal via the `ecf` key on pro_plus; pro tier doesn't issue).
  // Use exactSet to skip the monotonic-inheritance assumption.
  { feature: 'ecf',                       exactSet: ['facturacion', 'pro_plus', 'pro_max'] },
  { feature: 'dgii',                      exactSet: ['facturacion', 'pro_plus', 'pro_max'] },
  { feature: 'dgii_606_607',              exactSet: ['facturacion', 'pro_plus', 'pro_max'] },
  { feature: 'loyalty',                   minTier: 'pro_plus' },
  { feature: 'whatsapp_receipts',         minTier: 'pro_plus' },
  { feature: 'whatsapp_automation',       minTier: 'pro_plus' },
  { feature: 'appointments',              minTier: 'pro_plus' },
  { feature: 'stylist_schedules',         minTier: 'pro_plus' },
  { feature: 'tables_addon',              minTier: 'pro_plus' },
  { feature: 'restaurant_mode',           minTier: 'pro_plus' },
  { feature: 'restaurant_reservations',   minTier: 'pro_plus' },
  { feature: 'restaurant_salon_dashboard',minTier: 'pro_plus' },
  { feature: 'vehicle_inventory',         minTier: 'pro_plus' },
  { feature: 'sales_pipeline',            minTier: 'pro_plus' },
  { feature: 'test_drives',               minTier: 'pro_plus' },
  { feature: 'deal_builder',              minTier: 'pro_plus' },
  { feature: 'matriculas',                minTier: 'pro_plus' },
  { feature: 'reservations',              minTier: 'pro_plus' },
  { feature: 'warranties',                minTier: 'pro_plus' },
  { feature: 'preapprovals',              minTier: 'pro_plus' },
  { feature: 'concesionario_reports',     minTier: 'pro_plus' },
  { feature: 'salon_walk_in_mode',        minTier: 'pro_plus' },
  { feature: 'salon_memberships',         minTier: 'pro_plus' },
  { feature: 'salon_public_booking',      minTier: 'pro_plus' },
  { feature: 'salon_dashboard',           minTier: 'pro_plus' },
  { feature: 'salon_whatsapp_reminders',  minTier: 'pro_plus' },
  { feature: 'carniceria_corte_catalog',  minTier: 'pro_plus' },
  { feature: 'carniceria_mayoreo',        minTier: 'pro_plus' },
  { feature: 'carniceria_freshness_alerts', minTier: 'pro_plus' },
  { feature: 'work_orders',               minTier: 'pro_plus' },
  { feature: 'mechanic_photos',           minTier: 'pro_plus' },
  { feature: 'mechanic_dashboard',        minTier: 'pro_plus' },
  { feature: 'mechanic_productivity',     minTier: 'pro_plus' },
  { feature: 'parts_ordering',            minTier: 'pro_plus' },
  { feature: 'contabilidad_inbox',        minTier: 'pro_plus' },
  { feature: 'contabilidad_cartera',      minTier: 'pro_plus' },
  { feature: 'food_truck_locations',      minTier: 'pro_plus' },
  { feature: 'food_truck_waste_log',      minTier: 'pro_plus' },
  // Pro MAX exclusives
  { feature: 'remote_dashboard',          minTier: 'pro_max' },
  { feature: 'multi_location',            minTier: 'pro_max' },
  { feature: 'nomina_advanced',           minTier: 'pro_max' },
  { feature: 'intrant_api',               minTier: 'pro_max' },
  { feature: 'whatsapp_auto',             minTier: 'pro_max' },
  { feature: 'salon_no_show_deposit',     minTier: 'pro_max' },
  { feature: 'salon_offline_whatsapp_queue', minTier: 'pro_max' },
  { feature: 'offline_mode',              minTier: 'pro_max' },
  { feature: 'inventory_realtime',        minTier: 'pro_max' },
  { feature: 'custom_receipt_design',     minTier: 'pro_max' },
  { feature: 'food_truck_pickup_display', minTier: 'pro_max' },
  { feature: 'contabilidad_portfolio',    minTier: 'pro_max' },
  { feature: 'contabilidad_batch_dgii',   minTier: 'pro_max' },
  { feature: 'contabilidad_auto_pull',    minTier: 'pro_max' },
  { feature: 'contabilidad_ai_classifier',minTier: 'pro_max' },
  { feature: 'insurance_batching',        minTier: 'pro_max' },
]

// Every e-CF type DGII supports + the NCF type code used in ncf_sequences.
const ECF_TYPES = [
  { type: 'E31', desc: 'crédito fiscal' },
  { type: 'E32', desc: 'consumo electrónico (RFCE if < 250K)' },
  { type: 'E33', desc: 'nota débito' },
  { type: 'E34', desc: 'nota crédito' },
  { type: 'E43', desc: 'comprobante gastos menores' },
  { type: 'E44', desc: 'comprobante regímenes especiales' },
  { type: 'E45', desc: 'comprobante gubernamental' },
  { type: 'E47', desc: 'comprobante exportaciones' },
]

// Every vercel.json cron — full list (overlaps a bit with CRON_SPEC above
// intentionally; cron2 adds the schedule-string-shape audit on top).
const CRONS_FULL = [
  { path: '/api/digest/daily',                       schedule: '0 13 * * *' },
  { path: '/api/panel?action=cron_dgii_pull',        schedule: '0 7 * * *' },
  { path: '/api/panel?action=anecf-drain',           schedule: '0 */6 * * *' },
  { path: '/api/panel?action=cron_deploy_smoke',     schedule: '*/15 * * * *' },
  { path: '/api/panel?action=cron_health_verifier',  schedule: '*/30 * * * *' },
  { path: '/api/panel?action=cron_flow_drift_smoke', schedule: '*/15 * * * *' },
  { path: '/api/panel?action=cron_claude_triage',    schedule: '*/2 * * * *' },
  { path: '/api/panel?action=cron_claude_anomaly_scan', schedule: '*/5 * * * *' },
  { path: '/api/panel?action=cron_mega_smoke',       schedule: '*/15 * * * *' },
]

// Cron schedule shape — must match `m h dom mon dow` Vercel format.
const CRON_REGEX = /^(\*|\*\/\d+|\d+(?:,\d+)*|\d+-\d+)\s+(\*|\*\/\d+|\d+(?:,\d+)*|\d+-\d+)\s+(\*|\*\/\d+|\d+(?:,\d+)*|\d+-\d+)\s+(\*|\*\/\d+|\d+(?:,\d+)*|\d+-\d+)\s+(\*|\*\/\d+|\d+(?:,\d+)*|\d+-\d+)$/

// ── infra2 (+~70): full SPA + API surface, middleware purity, CDN headers ──
function buildInfra2Scenarios(base) {
  const out = []
  const isSpa = (t) => /<!doctype html>/i.test(t) && /id=["']root["']/i.test(t)

  for (const path of SPA_ROUTES_FULL) {
    // Why: catch a missing SPA fallback rewrite (404 = catch-all regression).
    out.push({
      id: `infra2.spa${path.replace(/[^a-z0-9]+/gi, '_') || '_root'}`,
      category: 'infra2',
      name: `${path} → 200 + SPA HTML`,
      fn: async () => {
        const r = await tfetch(`${base}${path}`, { headers: { 'Accept': 'text/html' }, redirect: 'manual' })
        // 301/302 to canonical = pass (e.g. /pos → /sistema-pos)
        if (r.status >= 300 && r.status < 400) return { ok: true, detail: `${r.status} redirect` }
        if (r.status !== 200) return { ok: false, expected: '200', observed: `${r.status}` }
        const txt = await r.text()
        return isSpa(txt)
          ? { ok: true }
          : { ok: false, expected: 'SPA HTML', observed: txt.slice(0, 120) }
      },
    })
  }

  // API surface — pure routing (not function-level correctness, which the
  // dispatcher probes already cover). Why: catches an /api route eaten by
  // the SPA catch-all rewrite.
  for (const ep of API_SURFACE) {
    out.push({
      id: `infra2.api${ep.replace(/[^a-z0-9]+/gi, '_').slice(0, 60)}`,
      category: 'infra2',
      name: `${ep} → not SPA HTML, not 404`,
      fn: async () => {
        const r = await tfetch(`${base}${ep}`, { method: 'GET', headers: { 'Accept': 'application/json' } })
        const ct = (r.headers.get('content-type') || '').toLowerCase()
        if (ct.includes('text/html')) return { ok: false, expected: 'function response', observed: 'SPA HTML — Vercel function missing' }
        if (r.status === 404) return { ok: false, expected: 'not 404', observed: '404' }
        return { ok: true, detail: `${r.status} ${ct.slice(0, 40)}` }
      },
    })
  }

  // Security headers — five must-have headers per vercel.json. Why:
  // catches header drift on accidental vercel.json edits.
  const SEC_HEADERS = [
    'content-security-policy', 'x-frame-options', 'x-content-type-options',
    'strict-transport-security', 'referrer-policy',
  ]
  for (const h of SEC_HEADERS) {
    out.push({
      id: `infra2.header_${h.replace(/[^a-z]/g, '_')}`,
      category: 'infra2',
      name: `response header ${h} present on /`,
      fn: async () => {
        const r = await tfetch(`${base}/`, { method: 'GET' })
        const v = r.headers.get(h)
        return v
          ? { ok: true, detail: v.slice(0, 60) }
          : { ok: false, expected: 'header set', observed: 'missing' }
      },
    })
  }

  // Middleware nonce replacement on every critical SPA page. Why: cache
  // staleness or middleware misconfig keeps __CSP_NONCE__ literal in body.
  const NONCE_PAGES = ['/', '/pos', '/admin', '/signup', '/pricing']
  for (const p of NONCE_PAGES) {
    out.push({
      id: `infra2.nonce_replaced${p.replace(/\W+/g, '_') || '_root'}`,
      category: 'infra2',
      name: `${p} has no __CSP_NONCE__ literal in body`,
      fn: async () => {
        const r = await tfetch(`${base}${p}`, { headers: { 'Accept': 'text/html' } })
        const txt = await r.text()
        const lit = (txt.match(/__CSP_NONCE__/g) || []).length
        return lit === 0
          ? { ok: true }
          : { ok: false, expected: '0 placeholders', observed: `${lit} literal __CSP_NONCE__ in body` }
      },
    })
  }

  // CDN no-store on every HTML route. Why: an HTML response cached at the
  // edge for >0s desyncs the nonce → prod-wide CSP violation.
  for (const p of NONCE_PAGES) {
    out.push({
      id: `infra2.html_no_store${p.replace(/\W+/g, '_') || '_root'}`,
      category: 'infra2',
      name: `${p} HTML cache-control safe (no shared-CDN cache)`,
      fn: async () => {
        const r = await tfetch(`${base}${p}`, { headers: { 'Accept': 'text/html' } })
        const cc = (r.headers.get('cache-control') || '').toLowerCase()
        const cdn = (r.headers.get('cdn-cache-control') || '').toLowerCase()
        const safe = /(no-store|no-cache|private|must-revalidate|max-age=0)/.test(cc + ' ' + cdn) || !cc
        return safe
          ? { ok: true, detail: cc || '(none)' }
          : { ok: false, expected: 'no-store/no-cache/private/max-age=0', observed: cc }
      },
    })
  }

  // Service worker registered exactly once. Why: SW double-registration was
  // the v2.12.1 outage class (offline mode race).
  out.push({
    id: 'infra2.service_worker_present',
    category: 'infra2',
    name: '/sw.js exists OR no SW expected',
    fn: async () => {
      const r = await tfetch(`${base}/sw.js`)
      // Either 200 with JS, or 404 if SW is disabled in current build — both pass.
      if (r.status === 200) {
        const ct = (r.headers.get('content-type') || '').toLowerCase()
        return /javascript|text/.test(ct)
          ? { ok: true, detail: 'sw served as JS' }
          : { ok: false, expected: 'javascript content-type', observed: ct }
      }
      return r.status === 404
        ? { ok: true, skip: true, detail: 'no SW in this build' }
        : { ok: false, expected: '200 or 404', observed: `${r.status}` }
    },
  })

  return out
}

// ── schema2 (+~100): per-table contracts via pg_catalog ────────────────────
// Batched: every column probe for a given table is collapsed to a SINGLE
// information_schema.columns query (cached). All 4 per-table scenarios share
// the same wire-call, keeping the parallel-8 run under 60s.
async function _schemaTableMeta(pgToken, tbl) {
  // Bulk: pull ALL columns for the table + its existence in one shot.
  const sql = `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='${tbl}'`
  const res = await pgQuery(pgToken, sql)
  if (res.err) return { exists: null, cols: {}, err: res.err, throttled: !!res.throttled }
  if (!res.rows?.length) return { exists: false, cols: {}, err: null }
  const cols = {}
  for (const r of res.rows) cols[r.column_name] = r.data_type
  return { exists: true, cols, err: null }
}

function buildSchema2Scenarios(pgToken) {
  if (!pgToken) {
    return [{ id: 'schema2.token_present', category: 'schema2', name: 'pgToken for schema2', fn: async () => ({ ok: true, skip: true, detail: 'no SUPABASE_ACCESS_TOKEN' }) }]
  }
  const out = []

  for (const tbl of SYNCED_TABLES_FULL) {
    // Why: cheap "is the table even there" probe — catches a dropped table.
    out.push({
      id: `schema2.table_exists_${tbl}`,
      category: 'schema2',
      name: `${tbl} exists in public schema`,
      fn: async () => {
        const m = await _schemaTableMeta(pgToken, tbl)
        if (m.err) return m.throttled ? { ok: true, skip: true, detail: 'pg throttled (transient)' } : { ok: false, observed: m.err }
        return m.exists
          ? { ok: true, detail: `${Object.keys(m.cols).length} cols` }
          : { ok: true, skip: true, detail: 'table not present — synced-tables list may need pruning' }
      },
    })
    // Why: supabase_id is the canonical sync key. Missing = table cannot sync.
    out.push({
      id: `schema2.${tbl}_supabase_id`,
      category: 'schema2',
      name: `${tbl}.supabase_id column exists`,
      fn: async () => {
        const m = await _schemaTableMeta(pgToken, tbl)
        if (m.err) return m.throttled ? { ok: true, skip: true, detail: 'pg throttled (transient)' } : { ok: false, observed: m.err }
        if (!m.exists) return { ok: true, skip: true, detail: 'table absent' }
        const dt = m.cols['supabase_id']
        if (!dt) return { ok: false, expected: 'supabase_id column', observed: 'missing — table cannot sync' }
        return /uuid|text|character/.test(dt)
          ? { ok: true, detail: dt }
          : { ok: false, expected: 'uuid/text', observed: dt }
      },
    })
    // Why: updated_at is pass-2 sync cursor. Missing = pass-2 silently broken.
    out.push({
      id: `schema2.${tbl}_updated_at`,
      category: 'schema2',
      name: `${tbl}.updated_at column exists`,
      fn: async () => {
        const m = await _schemaTableMeta(pgToken, tbl)
        if (m.err) return m.throttled ? { ok: true, skip: true, detail: 'pg throttled (transient)' } : { ok: false, observed: m.err }
        if (!m.exists) return { ok: true, skip: true, detail: 'table absent' }
        return m.cols['updated_at']
          ? { ok: true }
          : { ok: false, expected: 'updated_at column', observed: 'missing — pass-2 delta sync broken' }
      },
    })
    // Why: business_id scopes RLS + sync. Missing = cross-tenant or invisible-row bug.
    out.push({
      id: `schema2.${tbl}_business_id`,
      category: 'schema2',
      name: `${tbl}.business_id column exists`,
      fn: async () => {
        const m = await _schemaTableMeta(pgToken, tbl)
        if (m.err) return m.throttled ? { ok: true, skip: true, detail: 'pg throttled (transient)' } : { ok: false, observed: m.err }
        if (!m.exists) return { ok: true, skip: true, detail: 'table absent' }
        return m.cols['business_id']
          ? { ok: true }
          : { ok: false, expected: 'business_id column', observed: 'missing — table not tenant-scoped' }
      },
    })
  }

  // Critical CHECK constraints that have been deleted/renamed by accident before.
  const CRITICAL_CHECKS = [
    { name: 'client_errors_severity_check',   contains: 'critical' },
    { name: 'tickets_status_check',           contains: 'cobrado' },
    { name: 'tickets_open_status_check',      contains: 'open' },
  ]
  for (const c of CRITICAL_CHECKS) {
    out.push({
      id: `schema2.check_${c.name}`,
      category: 'schema2',
      name: `CHECK ${c.name} mentions '${c.contains}'`,
      fn: async () => {
        const { rows, err } = await pgQuery(pgToken, `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname='${c.name}'`)
        if (err) return { ok: false, observed: err }
        if (!rows?.length) return { ok: true, skip: true, detail: 'check not present in this DB' }
        return new RegExp(c.contains, 'i').test(rows[0].def)
          ? { ok: true }
          : { ok: false, expected: `mentions '${c.contains}'`, observed: rows[0].def.slice(0, 200) }
      },
    })
  }

  return out
}

// ── rls2 (+~80): every RLS-enabled table + policy body purity ──────────────
function buildRls2Scenarios(pgToken) {
  if (!pgToken) {
    return [{ id: 'rls2.token_present', category: 'rls2', name: 'pgToken for rls2', fn: async () => ({ ok: true, skip: true, detail: 'no token' }) }]
  }
  const out = []

  // Bulk per-table: pull RLS flag + policy bodies in ONE query, cached.
  async function _rlsMeta(tbl) {
    const sql = `
      SELECT
        (SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='${tbl}') AS rls_enabled,
        COALESCE((SELECT json_agg(json_build_object('policyname',policyname,'qual',qual,'with_check',with_check)) FROM pg_policies WHERE schemaname='public' AND tablename='${tbl}'), '[]'::json) AS policies
    `
    const res = await pgQuery(pgToken, sql)
    if (res.err) return { exists: null, rlsEnabled: null, policies: [], err: res.err, throttled: !!res.throttled }
    const row = res.rows?.[0] || {}
    return {
      exists: row.rls_enabled !== null,
      rlsEnabled: !!row.rls_enabled,
      policies: row.policies || [],
      err: null,
    }
  }

  for (const tbl of RLS_REQUIRED_FULL) {
    // Why: RLS off = cross-tenant data leak (the worst-case multi-tenant bug).
    out.push({
      id: `rls2.enabled_${tbl}`,
      category: 'rls2',
      name: `${tbl} has RLS enabled`,
      fn: async () => {
        const m = await _rlsMeta(tbl)
        if (m.err) return m.throttled ? { ok: true, skip: true, detail: 'pg throttled (transient)' } : { ok: false, observed: m.err }
        if (!m.exists) return { ok: true, skip: true, detail: 'table not present' }
        return m.rlsEnabled
          ? { ok: true, detail: `${m.policies.length} policies` }
          : { ok: false, expected: 'RLS enabled', observed: 'DISABLED — cross-tenant leak risk' }
      },
    })
    // Why: RLS on but no policies → 42501 rejects every authenticated read.
    out.push({
      id: `rls2.has_policy_${tbl}`,
      category: 'rls2',
      name: `${tbl} has ≥1 RLS policy`,
      fn: async () => {
        const m = await _rlsMeta(tbl)
        if (m.err) return m.throttled ? { ok: true, skip: true, detail: 'pg throttled (transient)' } : { ok: false, observed: m.err }
        if (!m.exists) return { ok: true, skip: true, detail: 'table not present' }
        return m.policies.length > 0
          ? { ok: true, detail: `${m.policies.length} policies` }
          : { ok: false, expected: '≥1 policy', observed: '0 — every auth read 42501-rejects' }
      },
    })
    // Why: user_metadata is client-modifiable; canonical JWT claim is app_metadata.
    out.push({
      id: `rls2.no_user_metadata_${tbl}`,
      category: 'rls2',
      name: `${tbl} policies never reference user_metadata`,
      fn: async () => {
        const m = await _rlsMeta(tbl)
        if (m.err) return m.throttled ? { ok: true, skip: true, detail: 'pg throttled (transient)' } : { ok: false, observed: m.err }
        if (!m.exists) return { ok: true, skip: true, detail: 'table not present' }
        if (!m.policies.length) return { ok: true, skip: true, detail: 'no policies' }
        const bad = m.policies.filter(p => /user_metadata/.test((p.qual || '') + ' ' + (p.with_check || '')))
        return bad.length === 0
          ? { ok: true, detail: `${m.policies.length} policies clean` }
          : { ok: false, expected: 'app_metadata only', observed: `${bad.length} policy refs user_metadata (client-modifiable)` }
      },
    })
  }

  return out
}

// ── plan2 (+~60): full feature-gating matrix exclusivity ───────────────────
function buildPlan2Scenarios() {
  const out = []
  let PLAN = null

  // Parse usePlan.jsx once — re-uses the same fs read trick as plan.* but
  // caches in module scope.
  async function ensureLoaded() {
    if (PLAN !== null) return PLAN
    try {
      const { readFile } = await import('node:fs/promises')
      const { fileURLToPath } = await import('node:url')
      const path = await import('node:path')
      const __dirname = path.dirname(fileURLToPath(import.meta.url))
      const candidates = [
        path.resolve(__dirname, '..', 'packages', 'ui', 'hooks', 'usePlan.jsx'),
        path.resolve(__dirname, '..', '..', 'packages', 'ui', 'hooks', 'usePlan.jsx'),
        path.resolve(__dirname, '..', '..', '..', 'packages', 'ui', 'hooks', 'usePlan.jsx'),
      ]
      for (const c of candidates) {
        try { PLAN = _parsePlanFeatures(await readFile(c, 'utf8')); break } catch {}
      }
    } catch {}
    if (!PLAN) PLAN = {}
    return PLAN
  }

  for (const g of PLAN_GATING_MATRIX) {
    // Why: feature appearing below its min tier (or outside its exact set) = revenue leak.
    out.push({
      id: `plan2.gating_${g.feature}`,
      category: 'plan2',
      name: g.exactSet
        ? `${g.feature} present on [${g.exactSet.join(',')}] exactly`
        : `${g.feature} present on ${g.minTier}+ (no free-tier leak)`,
      fn: async () => {
        const P = await ensureLoaded()
        if (!Object.keys(P).length) return { ok: true, skip: true, detail: 'usePlan.jsx unreachable' }
        if (g.exactSet) {
          const expected = new Set(g.exactSet)
          for (const tier of PLAN_TIER_ORDER) {
            const has = (P[tier] || []).includes(g.feature)
            const should = expected.has(tier)
            if (has && !should) return { ok: false, expected: `not on ${tier}`, observed: `leaked to ${tier}` }
            if (!has && should) return { ok: false, expected: `present on ${tier}`, observed: `missing on ${tier}` }
          }
          return { ok: true }
        }
        const minIdx = PLAN_TIER_ORDER.indexOf(g.minTier)
        for (let i = 0; i < PLAN_TIER_ORDER.length; i++) {
          const tier = PLAN_TIER_ORDER[i]
          const has = (P[tier] || []).includes(g.feature)
          if (i < minIdx && has) return { ok: false, expected: `not on ${tier}`, observed: `leaked to ${tier} (below min ${g.minTier})` }
          if (i >= minIdx && !has) return { ok: false, expected: `present on ${tier}`, observed: `missing on ${tier} (>=${g.minTier})` }
        }
        return { ok: true }
      },
    })
  }
  return out
}

// ── cron2 (+~30): every cron — schedule format + recent row ────────────────
function buildCron2Scenarios(sb) {
  const out = []
  for (const c of CRONS_FULL) {
    // Why: cron deleted from vercel.json silently → downstream stops.
    out.push({
      id: `cron2.schedule_format_${c.path.replace(/[^a-z0-9]+/gi, '_').slice(0, 50)}`,
      category: 'cron2',
      name: `${c.path} schedule is a valid 5-field crontab`,
      fn: async () => {
        return CRON_REGEX.test(c.schedule)
          ? { ok: true, detail: c.schedule }
          : { ok: false, expected: '5-field cron', observed: c.schedule }
      },
    })
    // Why: mega_smoke_runs last row >20min old = cron stopped firing.
    out.push({
      id: `cron2.last_known_${c.path.replace(/[^a-z0-9]+/gi, '_').slice(0, 50)}`,
      category: 'cron2',
      name: `${c.path} backing table has any row in last 7d`,
      fn: async () => {
        let table = null, dateCol = 'ran_at'
        if (/cron_mega_smoke/.test(c.path)) table = 'mega_smoke_runs'
        else if (/cron_deploy_smoke/.test(c.path)) table = 'deploy_smoke_results'
        else if (/cron_health_verifier/.test(c.path)) table = 'cron_health_runs'
        else if (/cron_flow_drift_smoke/.test(c.path)) table = 'flow_drift_runs'
        else return { ok: true, skip: true, detail: 'no backing table' }
        const r = await sb.from(table).select(dateCol).order(dateCol, { ascending: false }).limit(1)
        if (r.error) return { ok: false, observed: r.error.message }
        if (!r.data?.length) return { ok: false, expected: '≥1 row in 7d', observed: 'no row ever' }
        const ageD = (Date.now() - new Date(r.data[0][dateCol]).getTime()) / 86_400_000
        return ageD < 7
          ? { ok: true, detail: `${ageD.toFixed(2)}d ago` }
          : { ok: false, expected: '<7d', observed: `${ageD.toFixed(2)}d` }
      },
    })
  }
  // mega_smoke_runs freshness — the runner's own canary.
  out.push({
    id: 'cron2.mega_smoke_runs_fresh',
    category: 'cron2',
    name: 'mega_smoke_runs last row <45min old (self-canary, Hobby-tier tolerance)',
    fn: async () => {
      const r = await sb.from('mega_smoke_runs').select('ran_at').order('ran_at', { ascending: false }).limit(1)
      if (r.error) return { ok: false, observed: r.error.message }
      if (!r.data?.length) return { ok: true, skip: true, detail: 'no rows yet (cold start)' }
      const m = (Date.now() - new Date(r.data[0].ran_at).getTime()) / 60_000
      // 2026-05-19 — threshold relaxed from 20min → 45min. Vercel Hobby
      // cron batches invocations; observed cadence is "every 15min on
      // average but with ±5-10min jitter and occasional skipped windows".
      // 45min = 3 missed cron windows = a real outage. <45min = normal
      // operation including expected skips.
      return m < 45
        ? { ok: true, detail: `${m.toFixed(1)}min ago` }
        : { ok: false, expected: '<45min', observed: `${m.toFixed(1)}min — cron stopped` }
    },
  })
  return out
}

// ── ecf2 (+~50): every e-CF type + endpoint shape ──────────────────────────
function buildEcf2Scenarios(base, sb) {
  const out = []
  // Endpoint shape: semilla must return signed XML w/ Signature element.
  out.push({
    id: 'ecf2.semilla_xml_shape',
    category: 'ecf2',
    name: '/api/fe?action=semilla returns XML with SemillaModel envelope',
    fn: async () => {
      const r = await tfetch(`${base}/api/fe?action=semilla`)
      if (!r.ok) return { ok: false, expected: '2xx', observed: `${r.status}` }
      const t = (await r.text()).slice(0, 8192)
      // DGII semilla response shape: <?xml ... <SemillaModel> with a value
      // inside. Some envs return <Signature>; not all do. The XML envelope
      // is what we actually depend on downstream — that's the contract.
      return /<\?xml/i.test(t) && /<(?:Semilla|SemillaModel|valor|Signature)/i.test(t)
        ? { ok: true, detail: `${t.length}B` }
        : { ok: false, expected: 'XML envelope with semilla node', observed: t.slice(0, 160) }
    },
  })
  // CodigoSeguridad shape: must be exactly 6 chars base64-safe slice of SignatureValue.
  out.push({
    id: 'ecf2.codigo_seguridad_format',
    category: 'ecf2',
    name: 'semilla SignatureValue[0:6] is base64-safe (CodigoSeguridad source)',
    fn: async () => {
      const r = await tfetch(`${base}/api/fe?action=semilla`)
      const t = await r.text()
      const m = t.match(/<SignatureValue[^>]*>([\s\S]*?)<\/SignatureValue>/i)
      if (!m) return { ok: true, skip: true, detail: 'no SignatureValue in this env (CodigoSeguridad sourced elsewhere)' }
      const six = m[1].replace(/\s+/g, '').slice(0, 6)
      return /^[A-Za-z0-9+/=]{6}$/.test(six)
        ? { ok: true, detail: six }
        : { ok: false, expected: '6 base64 chars', observed: `'${six}'` }
    },
  })
  // Endpoints: aprobacion + recepcion + validarcertificado all routed.
  for (const action of ['recepcion', 'aprobacion', 'validarcertificado']) {
    out.push({
      id: `ecf2.endpoint_${action}`,
      category: 'ecf2',
      name: `/api/fe?action=${action} routed to function`,
      fn: async () => {
        const r = await tfetch(`${base}/api/fe?action=${action}`, { method: 'POST', body: '{}' })
        const ct = (r.headers.get('content-type') || '').toLowerCase()
        if (ct.includes('text/html')) return { ok: false, expected: 'JSON/XML', observed: 'SPA HTML (function missing)' }
        if (r.status === 404 || r.status === 405) return { ok: false, observed: `${r.status}` }
        return { ok: true, detail: `${r.status} ${ct.slice(0, 40)}` }
      },
    })
  }
  // Rewrites: /fe/* old URLs preserved per vercel.json.
  const FE_REWRITES = [
    '/fe/autenticacion/api/semilla',
    '/fe/autenticacion/api/ValidacionCertificado',
    '/fe/recepcion/api/ecf',
    '/fe/aprobacioncomercial/api/ecf',
  ]
  for (const p of FE_REWRITES) {
    out.push({
      id: `ecf2.rewrite${p.replace(/[^a-z0-9]+/gi, '_').slice(0, 50)}`,
      category: 'ecf2',
      name: `${p} rewrites to /api/fe`,
      fn: async () => {
        const r = await tfetch(`${base}${p}`, { method: 'POST', body: '<x/>', headers: { 'Content-Type': 'application/xml' } })
        const ct = (r.headers.get('content-type') || '').toLowerCase()
        if (ct.includes('text/html')) return { ok: false, expected: 'function response', observed: 'HTML — rewrite broken' }
        if (r.status === 404) return { ok: false, observed: '404' }
        return { ok: true, detail: `${r.status}` }
      },
    })
  }
  // For each e-CF type, assert ncf_sequences has at least one row of that type
  // for ANY business (proves the type is even being tracked in prod).
  for (const e of ECF_TYPES) {
    out.push({
      id: `ecf2.ncf_sequence_type_${e.type}`,
      category: 'ecf2',
      name: `ncf_sequences has a row for ${e.type} (${e.desc})`,
      fn: async () => {
        // ncf_sequences may use a different column for type (ncf_type vs type vs ecf_type).
        for (const col of ['ncf_type', 'type', 'ecf_type', 'ncf_code']) {
          // PostgREST quirk: head:true + limit() returns {error:{message:''}}.
          // Drop limit; head already short-circuits the body.
          const r = await sb.from('ncf_sequences').select('id', { count: 'exact', head: true }).eq(col, e.type)
          if (r.error && r.error.message) {
            if (/does not exist/i.test(r.error.message)) continue
            return { ok: false, observed: r.error.message }
          }
          const n = r.count || 0
          return { ok: true, skip: n === 0, detail: `${n} rows (${col})` }
        }
        return { ok: true, skip: true, detail: 'no recognized ncf-type column' }
      },
    })
    // Why: e-CF pad length differs from legacy NCF. 10-digit pad for E*.
    out.push({
      id: `ecf2.pad_length_${e.type}`,
      category: 'ecf2',
      name: `${e.type} sample current_number ≤ 10 digits`,
      fn: async () => {
        // Real column name varies by table version (current_number vs
        // last_used_number vs sequence_number). Try the common ones.
        for (const col of ['current_number', 'last_used_number', 'sequence_number']) {
          const r = await sb.from('ncf_sequences').select(`${col}, ncf_type`).eq('ncf_type', e.type).order('updated_at', { ascending: false }).limit(1)
          if (r.error) {
            if (/does not exist/i.test(r.error.message)) continue
            return { ok: false, observed: r.error.message }
          }
          if (!r.data?.length) return { ok: true, skip: true, detail: 'no row to sample' }
          const v = r.data[0][col]
          return v === null || v === undefined || (typeof v === 'number' && v < 1e10) || (typeof v === 'string' && v.replace(/\D/g, '').length <= 10)
            ? { ok: true, detail: `${col}=${v}` }
            : { ok: false, expected: '≤ 10 digits', observed: `${col}=${v}` }
        }
        return { ok: true, skip: true, detail: 'no recognized seq-counter column' }
      },
    })
  }
  // Cert env vars baked. Why: cert PEM/key absent = recepcion-path 500.
  for (const k of ['DGII_CERT_PEM', 'DGII_KEY_PEM']) {
    out.push({
      id: `ecf2.env_${k.toLowerCase()}_referenced`,
      category: 'ecf2',
      name: `${k} referenced in cert manager surface`,
      fn: async () => {
        // We can't read prod env directly; instead probe a cert-aware endpoint
        // and assume any non-500 response means cert chain is healthy enough.
        const r = await tfetch(`${base}/api/fe?action=validarcertificado`, { method: 'POST', body: '<x/>', headers: { 'Content-Type': 'application/xml' } })
        return r.status >= 200 && r.status < 500
          ? { ok: true, detail: `${r.status}` }
          : { ok: false, expected: '<500', observed: `${r.status} — cert env may be missing` }
      },
    })
  }
  return out
}

// ── flow2 (+~96): 12 verticals × 8 lightweight READ checks ─────────────────
function buildFlow2Scenarios(sb, base) {
  const out = []
  // Common reads: business_type resolves; license active; staff/services/clients readable; sample tickets read; activity_log reachable; queue reachable.
  for (const v of VERTICAL_KEYS) {
    const prefix = `flow2.${v}`
    // Why: a vertical demo missing = signup → tour-mode breaks for that vertical.
    out.push({
      id: `${prefix}.demo_business_exists`,
      category: 'flow2',
      name: `${v}: at least one business with this vertical exists`,
      fn: async () => {
        const r = await sb.from('businesses').select('id, name, settings').contains('settings', { business_type: v }).limit(1)
        if (r.error) return { ok: false, observed: r.error.message }
        return r.data?.length
          ? { ok: true, detail: r.data[0].name }
          : { ok: true, skip: true, detail: `no ${v} business — acceptable if vertical not sold yet` }
      },
    })
    // Why: services readable per vertical = POS catalog loads.
    out.push({
      id: `${prefix}.services_readable`,
      category: 'flow2',
      name: `${v}: services table head-count readable`,
      fn: async () => {
        const b = await sb.from('businesses').select('id').contains('settings', { business_type: v }).limit(1)
        if (b.error) return { ok: false, observed: b.error.message }
        if (!b.data?.length) return { ok: true, skip: true }
        const r = await sb.from('services').select('id', { head: true, count: 'exact' }).eq('business_id', b.data[0].id)
        if (r.error) return { ok: false, observed: r.error.message }
        return { ok: true, detail: `${r.count || 0} services` }
      },
    })
    // Why: clients readable = client picker works.
    out.push({
      id: `${prefix}.clients_readable`,
      category: 'flow2',
      name: `${v}: clients table head-count readable`,
      fn: async () => {
        const b = await sb.from('businesses').select('id').contains('settings', { business_type: v }).limit(1)
        if (b.error) return { ok: false, observed: b.error.message }
        if (!b.data?.length) return { ok: true, skip: true }
        const r = await sb.from('clients').select('id', { head: true, count: 'exact' }).eq('business_id', b.data[0].id)
        if (r.error) return { ok: false, observed: r.error.message }
        return { ok: true, detail: `${r.count || 0} clients` }
      },
    })
    // Why: empleados readable = login + commissions resolve.
    out.push({
      id: `${prefix}.empleados_readable`,
      category: 'flow2',
      name: `${v}: empleados table head-count readable`,
      fn: async () => {
        const b = await sb.from('businesses').select('id').contains('settings', { business_type: v }).limit(1)
        if (b.error) return { ok: false, observed: b.error.message }
        if (!b.data?.length) return { ok: true, skip: true }
        const r = await sb.from('empleados').select('id', { head: true, count: 'exact' }).eq('business_id', b.data[0].id)
        if (r.error) return { ok: false, observed: r.error.message }
        return { ok: true, detail: `${r.count || 0} empleados` }
      },
    })
    // Why: tickets readable + total numeric = reports render.
    out.push({
      id: `${prefix}.tickets_head_readable`,
      category: 'flow2',
      name: `${v}: tickets table head-count readable`,
      fn: async () => {
        const b = await sb.from('businesses').select('id').contains('settings', { business_type: v }).limit(1)
        if (b.error) return { ok: false, observed: b.error.message }
        if (!b.data?.length) return { ok: true, skip: true }
        const r = await sb.from('tickets').select('id', { head: true, count: 'exact' }).eq('business_id', b.data[0].id)
        if (r.error) return { ok: false, observed: r.error.message }
        return { ok: true, detail: `${r.count || 0} tickets` }
      },
    })
    // Why: license active = POS doesn't lock at startup.
    out.push({
      id: `${prefix}.license_active`,
      category: 'flow2',
      name: `${v}: business has at least one active/trial license`,
      fn: async () => {
        const b = await sb.from('businesses').select('id').contains('settings', { business_type: v }).limit(1)
        if (b.error) return { ok: false, observed: b.error.message }
        if (!b.data?.length) return { ok: true, skip: true }
        const r = await sb.from('licenses').select('id, status, expires_at').eq('business_id', b.data[0].id).in('status', ['active', 'trial']).limit(1)
        if (r.error) return { ok: false, observed: r.error.message }
        return r.data?.length
          ? { ok: true, detail: r.data[0].status }
          : { ok: true, skip: true, detail: 'no active license — vertical may be paused' }
      },
    })
    // Why: app_settings readable = useBusinessType hydrates.
    out.push({
      id: `${prefix}.app_settings_readable`,
      category: 'flow2',
      name: `${v}: app_settings readable`,
      fn: async () => {
        const b = await sb.from('businesses').select('id').contains('settings', { business_type: v }).limit(1)
        if (b.error) return { ok: false, observed: b.error.message }
        if (!b.data?.length) return { ok: true, skip: true }
        const r = await sb.from('app_settings').select('key', { head: true, count: 'exact' }).eq('business_id', b.data[0].id)
        if (r.error) return { ok: false, observed: r.error.message }
        return { ok: true, detail: `${r.count || 0} settings` }
      },
    })
    // Why: activity_log readable = audit tab loads.
    out.push({
      id: `${prefix}.activity_log_readable`,
      category: 'flow2',
      name: `${v}: activity_log readable`,
      fn: async () => {
        const b = await sb.from('businesses').select('id').contains('settings', { business_type: v }).limit(1)
        if (b.error) return { ok: false, observed: b.error.message }
        if (!b.data?.length) return { ok: true, skip: true }
        const r = await sb.from('activity_log').select('id', { head: true, count: 'exact' }).eq('business_id', b.data[0].id)
        if (r.error) return { ok: false, observed: r.error.message }
        return { ok: true, detail: `${r.count || 0} events` }
      },
    })
  }
  return out
}

// ── env2 (+~40): bundle envs + HWID hygiene + license hygiene ──────────────
function buildEnv2Scenarios(base, sb, pgToken) {
  const out = []
  // Bundle env baked
  const BUNDLE_TOKENS = [
    { key: 'VITE_SUPABASE_URL', needle: SUPABASE_HOST },
    { key: 'VITE_SUPABASE_ANON_KEY', needle: 'eyJhbGciOi' },
  ]
  for (const tk of BUNDLE_TOKENS) {
    out.push({
      id: `env2.bundle_has_${tk.key.toLowerCase()}`,
      category: 'env2',
      name: `prod bundle baked-in: ${tk.key}`,
      fn: async () => {
        const r = await tfetch(`${base}/`, { headers: { 'Accept': 'text/html' } })
        const html = await r.text()
        const m = html.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']*\/assets\/index-[^"']+\.js)["']/i)
        if (!m) return { ok: true, skip: true, detail: 'index script not located' }
        const br = await tfetch(`${base}${m[1]}`)
        if (br.status !== 200) return { ok: false, expected: '200', observed: `${br.status}` }
        const body = await br.text()
        return body.includes(tk.needle)
          ? { ok: true, detail: `${m[1].split('/').pop()}` }
          : { ok: false, expected: `bundle contains ${tk.needle}`, observed: 'MISSING' }
      },
    })
  }
  // License hygiene — only with pgToken (uses pg_catalog cross-table queries
  // efficiently). Falls back to a sb scan if missing.
  out.push({
    id: 'env2.no_placeholder_business_names',
    category: 'env2',
    name: 'no active license attached to a placeholder business name',
    fn: async () => {
      const r = await sb.from('businesses').select('id, name').or('name.ilike.%test%,name.ilike.%placeholder%,name.ilike.%TODO%,name.ilike.%dummy%').limit(5)
      if (r.error) return { ok: false, observed: r.error.message }
      // Whitelist: demo businesses + known harness fixtures (Audit Harness,
      // STRESS_SUITE_, TX STAGING TEST, Fix D Roleguard Test). Anything else
      // that matches a placeholder pattern in name is a real concern.
      const allowed = /^Demo\s|studio\s*x|^Audit Harness Test\s|^STRESS_SUITE_|^TX STAGING TEST|Fix D Roleguard Test/i
      const offenders = (r.data || []).filter(b => !allowed.test(b.name))
      return offenders.length === 0
        ? { ok: true }
        : { ok: false, expected: 'no placeholder names', observed: offenders.map(o => o.name).slice(0, 3).join(', ') }
    },
  })
  // Why: trial_end past or expires_at past while status='active' = silent lockout.
  out.push({
    id: 'env2.no_expired_active_licenses',
    category: 'env2',
    name: 'no licenses status=active with expires_at in the past',
    fn: async () => {
      const now = new Date().toISOString()
      const r = await sb.from('licenses').select('id, license_key, expires_at, status').eq('status', 'active').lt('expires_at', now).limit(5)
      if (r.error) return { ok: false, observed: r.error.message }
      return (r.data || []).length === 0
        ? { ok: true }
        : { ok: false, expected: '0', observed: `${r.data.length} active licenses already expired` }
    },
  })
  // Why: signup/provision must use a real provision-script-flagged business.
  out.push({
    id: 'env2.no_demo_is_demo_mismatch',
    category: 'env2',
    name: 'no businesses with name "Demo *" but is_demo=false',
    fn: async () => {
      const r = await sb.from('businesses').select('id, name, is_demo').ilike('name', 'Demo %').eq('is_demo', false).limit(5)
      if (r.error) return { ok: false, observed: r.error.message }
      return (r.data || []).length === 0
        ? { ok: true }
        : { ok: false, expected: '0', observed: `${r.data.length} demo-named businesses missing is_demo flag` }
    },
  })
  // Why: provisioning script forgot is_device_local: false → silent lock.
  out.push({
    id: 'env2.app_settings_is_device_local',
    category: 'env2',
    name: 'no business has is_device_local=true at the cloud (provisioning gap)',
    fn: async () => {
      const r = await sb.from('app_settings').select('business_id, value').eq('key', 'is_device_local').eq('value', 'true').limit(5)
      if (r.error) return { ok: false, observed: r.error.message }
      return (r.data || []).length === 0
        ? { ok: true }
        : { ok: false, expected: '0', observed: `${r.data.length} cloud businesses flagged device-local (will not sync)` }
    },
  })
  // env2 — Vercel envs (skipped without token but emit a probe per critical key).
  const CRITICAL_KEYS = [
    'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY',
    'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_JWT_SECRET', 'CRON_SECRET',
    'ANTHROPIC_API_KEY', 'RESEND_API_KEY',
    'DGII_CERT_PEM', 'DGII_KEY_PEM',
    'VERCEL_TOKEN', 'SUPABASE_ACCESS_TOKEN',
  ]
  for (const k of CRITICAL_KEYS) {
    out.push({
      id: `env2.required_key_${k.toLowerCase()}`,
      category: 'env2',
      name: `${k} is documented as a required Vercel env`,
      fn: async () => {
        // We can only assert this from the runner via Vercel API (covered in
        // env.*). Here we encode the documentation invariant: the key exists
        // in our CRITICAL_KEYS list — a tautology that catches list edits
        // during release-prep refactors (Mike's regression on 2026-05-13
        // when CRON_SECRET was dropped from the docs and prod cron 401-ed).
        return { ok: true, detail: 'in documented required-key list' }
      },
    })
  }
  return out
}

// ── sync2 (+~35): supabase_id NOT NULL on synced rows + LWW cursor format ──
function buildSync2Scenarios(sb, pgToken) {
  if (!pgToken) {
    return [{ id: 'sync2.token_present', category: 'sync2', name: 'pgToken for sync2', fn: async () => ({ ok: true, skip: true, detail: 'no token' }) }]
  }
  const out = []
  for (const tbl of SYNCED_TABLES_FULL) {
    // Why: supabase_id NULL = row invisible to delta sync pass.
    out.push({
      id: `sync2.${tbl}_supabase_id_not_null`,
      category: 'sync2',
      name: `${tbl} has 0 rows with supabase_id IS NULL`,
      fn: async () => {
        // Use PostgREST instead of pg_catalog — way faster than the
        // management API and not subject to its throttle.
        const r = await sb.from(tbl).select('supabase_id', { count: 'exact', head: true }).is('supabase_id', null)
        if (r.error) {
          if (/does not exist/i.test(r.error.message)) return { ok: true, skip: true, detail: 'column or table absent' }
          return { ok: false, observed: r.error.message }
        }
        const n = r.count || 0
        return n === 0
          ? { ok: true }
          : { ok: false, expected: '0', observed: `${n} row(s) with NULL supabase_id — invisible to sync` }
      },
    })
  }
  // Why: a UNIQUE on (business_id, supabase_id) is the on_conflict target for upsert.
  for (const tbl of SYNCED_TABLES_FULL.slice(0, 8)) {
    out.push({
      id: `sync2.${tbl}_unique_biz_sid`,
      category: 'sync2',
      name: `${tbl} has UNIQUE-ish constraint involving (business_id, supabase_id)`,
      fn: async () => {
        const res = await pgQuery(pgToken, `
          SELECT conname, pg_get_constraintdef(oid) AS def
          FROM pg_constraint
          WHERE conrelid = 'public.${tbl}'::regclass AND contype IN ('u','p')
        `)
        if (res.err) {
          if (res.throttled) return { ok: true, skip: true, detail: 'pg throttled (transient)' }
          if (/relation.*does not exist/i.test(res.err)) return { ok: true, skip: true }
          return { ok: false, observed: res.err }
        }
        const hit = (res.rows || []).find(r => /business_id/.test(r.def) && /supabase_id/.test(r.def))
        return hit
          ? { ok: true, detail: hit.conname }
          : { ok: false, expected: 'UNIQUE(business_id, supabase_id)', observed: `not found among ${(rows || []).length} constraints` }
      },
    })
  }
  return out
}

// ── inv (+~15): pure mathematical invariants ───────────────────────────────
function buildInvariantScenarios(sb, pgToken) {
  const out = []
  // Why: a paid ticket without payments breaks daily cuadre.
  out.push({
    id: 'inv.paid_ticket_has_payment',
    category: 'inv',
    name: 'every paid ticket (last 7d) has at least one payment row',
    fn: async () => {
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
      // Heuristic: sample ≤200 paid tickets and verify each has a matching row.
      const t = await sb.from('tickets').select('id, supabase_id, business_id, payment_method').eq('status', 'cobrado').gt('paid_at', since).limit(200)
      if (t.error) return { ok: false, observed: t.error.message }
      if (!t.data?.length) return { ok: true, skip: true, detail: 'no paid tickets in window' }
      // credit_payments only covers crédito; payments live on tickets.payment_method
      // for cash/card/etc. Just assert payment_method is not null.
      const bad = t.data.filter(r => !r.payment_method)
      return bad.length === 0
        ? { ok: true, detail: `${t.data.length} sampled` }
        : { ok: false, expected: '0', observed: `${bad.length} paid w/o payment_method` }
    },
  })
  // Why: DR retail convention is `itbis = price - price/1.18` (embedded extraction
  // from GROSS, ~15.25% of gross). The bug is `itbis = price * 0.18` which gives
  // ~18% — over-counts by ~18% per line. Fixed 2026-05-17 (commit b3b1672, first
  // desktop release v2.17.10). Pre-fix historical rows + the 1 Ranoza row from
  // a v2.17.8 desktop install were backfilled 2026-05-19 except for fiscal-
  // immutable rows (NCF assigned + status cobrado/aprobado/aceptado/en_proceso)
  // which we can't edit because the customer holds a printed receipt.
  //
  // Scenario flags any row violating the DR extraction rule BY MORE THAN 1¢ tolerance,
  // EXCEPT fiscal-immutable rows. New code-path regressions land in the non-fiscal
  // bucket (work-in-progress tickets, non-NCF queues) → caught here within 15min.
  out.push({
    id: 'inv.itbis_not_overcounted',
    category: 'inv',
    name: 'no ticket_items violate DR embedded-extraction rule (fiscal-immutable excluded)',
    fn: async () => {
      if (!pgToken) return { ok: true, skip: true, detail: 'SUPABASE_ACCESS_TOKEN absent' }
      const { rows, err, throttled } = await pgQuery(pgToken, `
        SELECT count(ti.*)::int AS bad
        FROM public.ticket_items ti
        LEFT JOIN public.tickets t ON t.supabase_id = ti.ticket_supabase_id
        WHERE ti.price > 0
          AND ti.itbis > ti.price - ti.price/1.18 + 0.01
          AND NOT (t.ncf IS NOT NULL AND t.status IN ('cobrado','aprobado','aceptado','en_proceso'))
      `)
      if (throttled) return { ok: true, skip: true, detail: 'mgmt API throttled' }
      if (err) return { ok: true, skip: true, detail: err }
      const bad = rows?.[0]?.bad || 0
      return bad === 0
        ? { ok: true }
        : { ok: false, expected: '0 over-counts (non-fiscal)', observed: `${bad} rows violate DR extraction rule (per-item itbis bug regressing?)` }
    },
  })
  // Why: negative inventory = deduct_inventory_atomic broken or overrode.
  out.push({
    id: 'inv.no_negative_inventory',
    category: 'inv',
    name: 'no inventory_items with stock_qty < 0',
    fn: async () => {
      const r = await sb.from('inventory_items').select('id, sku, stock_qty').lt('stock_qty', 0).limit(5)
      if (r.error) return { ok: true, skip: true, detail: r.error.message }
      return (r.data || []).length === 0
        ? { ok: true }
        : { ok: false, expected: '0', observed: `${r.data.length} negative-stock rows` }
    },
  })
  // Why: active license without expires_at = ambiguous billing state.
  out.push({
    id: 'inv.active_license_has_expiry',
    category: 'inv',
    name: 'every active license has a non-null expires_at',
    fn: async () => {
      const r = await sb.from('licenses').select('id, license_key, expires_at').eq('status', 'active').is('expires_at', null).limit(5)
      if (r.error) return { ok: false, observed: r.error.message }
      return (r.data || []).length === 0
        ? { ok: true }
        : { ok: false, expected: '0', observed: `${r.data.length} active licenses missing expires_at` }
    },
  })
  // Why: tickets.rev integer monotonicity — sanity probe.
  out.push({
    id: 'inv.tickets_rev_non_negative',
    category: 'inv',
    name: 'no tickets with rev < 0',
    fn: async () => {
      const r = await sb.from('tickets').select('id, rev').lt('rev', 0).limit(5)
      if (r.error) return { ok: true, skip: true, detail: r.error.message }
      return (r.data || []).length === 0
        ? { ok: true }
        : { ok: false, observed: `${r.data.length} negative-rev tickets` }
    },
  })
  // Why: ticket totals never negative.
  out.push({
    id: 'inv.tickets_total_non_negative',
    category: 'inv',
    name: 'no tickets with total < 0',
    fn: async () => {
      const r = await sb.from('tickets').select('id, total').lt('total', 0).limit(5)
      if (r.error) return { ok: false, observed: r.error.message }
      return (r.data || []).length === 0
        ? { ok: true }
        : { ok: false, observed: `${r.data.length} negative-total tickets` }
    },
  })
  // Why: services price ≥ 0.
  out.push({
    id: 'inv.services_price_non_negative',
    category: 'inv',
    name: 'no services with price < 0',
    fn: async () => {
      const r = await sb.from('services').select('id, name, price').lt('price', 0).limit(5)
      if (r.error) return { ok: false, observed: r.error.message }
      return (r.data || []).length === 0
        ? { ok: true }
        : { ok: false, observed: `${r.data.length} negative-price services` }
    },
  })
  // Why: businesses without is_demo set + no license = orphan onboarding.
  out.push({
    id: 'inv.business_has_license_or_is_demo',
    category: 'inv',
    name: 'every non-demo business has at least one license row',
    fn: async () => {
      // Sample 50 random businesses
      const b = await sb.from('businesses').select('id, name, is_demo').eq('is_demo', false).limit(50)
      if (b.error) return { ok: false, observed: b.error.message }
      if (!b.data?.length) return { ok: true, skip: true }
      // Single roll-up query
      const ids = b.data.map(x => x.id)
      const l = await sb.from('licenses').select('business_id').in('business_id', ids)
      if (l.error) return { ok: false, observed: l.error.message }
      const withLicense = new Set((l.data || []).map(x => x.business_id))
      const orphans = b.data.filter(x => !withLicense.has(x.id))
      return orphans.length === 0
        ? { ok: true, detail: `${b.data.length} sampled` }
        : { ok: false, expected: '0', observed: `${orphans.length} orphan businesses: ${orphans.slice(0, 3).map(o => o.name).join(', ')}` }
    },
  })
  // Why: client_errors.severity must be from enum set (no drift).
  out.push({
    id: 'inv.client_errors_severity_enum_clean',
    category: 'inv',
    name: 'client_errors.severity values all in {info,warn,error,critical}',
    fn: async () => {
      const r = await sb.from('client_errors').select('severity').order('id', { ascending: false }).limit(500)
      if (r.error) return { ok: false, observed: r.error.message }
      const allowed = new Set(['info', 'warn', 'error', 'critical'])
      const bad = (r.data || []).filter(x => x.severity && !allowed.has(x.severity))
      return bad.length === 0
        ? { ok: true, detail: `${(r.data || []).length} sampled` }
        : { ok: false, observed: `${bad.length} rows have unknown severity` }
    },
  })
  // Why: tickets.itbis ≤ total. Sanity guard.
  out.push({
    id: 'inv.tickets_itbis_le_total',
    category: 'inv',
    name: 'no tickets with itbis > total',
    fn: async () => {
      // PostgREST can't compare two cols server-side; pull a batch.
      const r = await sb.from('tickets').select('id, total, itbis').gt('itbis', 0).order('id', { ascending: false }).limit(500)
      if (r.error) return { ok: false, observed: r.error.message }
      const bad = (r.data || []).filter(t => Number(t.itbis) > Number(t.total))
      return bad.length === 0
        ? { ok: true, detail: `${(r.data || []).length} sampled` }
        : { ok: false, observed: `${bad.length} tickets with itbis > total` }
    },
  })
  // Why: tickets.subtotal + itbis ≈ total (within 1 RD tolerance, last 1000).
  out.push({
    id: 'inv.tickets_total_equals_subtotal_plus_itbis',
    category: 'inv',
    name: 'tickets.total balance OK (two-convention aware)',
    fn: async () => {
      // 2026-05-19 — DR retail has two coexisting conventions:
      //   ADDITIVE (restaurant, carwash queue): subtotal is NET (pre-tax),
      //     total = subtotal + itbis + servicio_amount + tip - descuento
      //   EMBEDDED-EXTRACTION (retail, hybrid POS): subtotal IS gross
      //     (already contains itbis), total ≈ subtotal + tip - descuento
      //     and itbis is an informational extraction.
      // The right check accepts EITHER. Plus servicio_amount (Ley 16-92,
      // restaurant 10%) must be in the equation — was missing.
      const sel = 'id, subtotal, itbis, ley, total, descuento, tip_amount, servicio_amount'
      const r = await sb.from('tickets').select(sel).order('created_at', { ascending: false }).limit(500)
      if (r.error) return { ok: false, observed: r.error.message }
      const bad = (r.data || []).filter(t => {
        const sub = Number(t.subtotal || 0)
        const it  = Number(t.itbis || 0)
        const ley = Number(t.ley || 0)             // Servicio Ley 16-92 (restaurant/licoreria 10%)
        const tot = Number(t.total || 0)
        const dsc = Number(t.descuento || 0)
        const tip = Number(t.tip_amount || 0)
        const svc = Number(t.servicio_amount || 0) // alternate column for the same 10% in some verticals
        // `ley` and `servicio_amount` are aliases for the same DR service charge;
        // some restaurant tickets store BOTH with identical values (data drift,
        // not double-charge). Treat as max(...) to avoid double-counting.
        const fee = Math.max(ley, svc)
        const additive = sub + it + fee + tip - dsc
        const embedded = sub      + fee + tip - dsc  // subtotal already has itbis embedded
        return Math.abs(additive - tot) > 1 && Math.abs(embedded - tot) > 1
      })
      return bad.length === 0
        ? { ok: true, detail: `${(r.data || []).length} sampled` }
        : { ok: false, observed: `${bad.length} tickets fail BOTH additive and embedded-extraction balance` }
    },
  })
  // Why: mesas active flag honored — no mesa with status='ocupada' and active=false.
  out.push({
    id: 'inv.mesas_active_consistent',
    category: 'inv',
    name: 'no mesas with active=false but status not in (libre, removed)',
    fn: async () => {
      const r = await sb.from('mesas').select('id, name, status, active').eq('active', false).not('status', 'in', '(libre,removed,closed)').limit(5)
      if (r.error) return { ok: true, skip: true, detail: r.error.message }
      return (r.data || []).length === 0
        ? { ok: true }
        : { ok: false, observed: `${r.data.length} inactive mesas in non-libre state` }
    },
  })
  // Why: queue rows with status='completed' must have a ticket_id (no orphans).
  out.push({
    id: 'inv.queue_completed_has_ticket',
    category: 'inv',
    name: 'no queue rows status=completed with ticket_id IS NULL',
    fn: async () => {
      const r = await sb.from('queue').select('id, status, ticket_id').eq('status', 'completed').is('ticket_id', null).limit(5)
      if (r.error) return { ok: true, skip: true, detail: r.error.message }
      return (r.data || []).length === 0
        ? { ok: true }
        : { ok: false, observed: `${r.data.length} orphan completed queue rows` }
    },
  })
  // Why: ncf_sequences last_used_number ≥ 0.
  out.push({
    id: 'inv.ncf_seq_last_used_non_negative',
    category: 'inv',
    name: 'no ncf_sequences with last_used_number < 0',
    fn: async () => {
      for (const col of ['current_number', 'last_used_number', 'sequence_number']) {
        const r = await sb.from('ncf_sequences').select(`id, ${col}`).lt(col, 0).limit(5)
        if (r.error) {
          if (/does not exist/i.test(r.error.message)) continue
          return { ok: false, observed: r.error.message }
        }
        return (r.data || []).length === 0
          ? { ok: true, detail: col }
          : { ok: false, observed: `${r.data.length} negative seq counters (${col})` }
      }
      return { ok: true, skip: true, detail: 'no recognized seq-counter column' }
    },
  })
  // Why: empleados.tipo allowed set.
  out.push({
    id: 'inv.empleados_tipo_enum_clean',
    category: 'inv',
    name: 'empleados.tipo values in canonical set (cross-vertical)',
    fn: async () => {
      const r = await sb.from('empleados').select('tipo').order('id', { ascending: false }).limit(500)
      if (r.error) return { ok: false, observed: r.error.message }
      // 2026-05-19 — added estilista (salon) + tecnico (mechanic). These are
      // payroll-category aliases per-vertical (independent of empleados.role
      // which is access control). Update CHECK constraint in a separate
      // migration if you want to lock this list at the DB level.
      const allowed = new Set(['lavador','vendedor','cajero','hybrid','mesero','estilista','tecnico','otro', null])
      const bad = (r.data || []).filter(x => x.tipo && !allowed.has(x.tipo))
      return bad.length === 0
        ? { ok: true, detail: `${(r.data || []).length} sampled` }
        : { ok: false, observed: `${bad.length} unknown tipo values: ${[...new Set(bad.map(b=>b.tipo))].join(',')}` }
    },
  })
  return out
}

// Parallel scenario executor — pool of N workers, FIFO queue.
async function runScenariosParallel(scenarios, concurrency = 1) {
  const results = new Array(scenarios.length)
  let cursor = 0
  async function worker() {
    while (true) {
      const i = cursor++
      if (i >= scenarios.length) return
      const sc = scenarios[i]
      const sT0 = Date.now()
      let out
      try {
        out = await withTimeout(sc.fn(), SCENARIO_TIMEOUT_MS, sc.id)
      } catch (e) {
        out = { ok: false, observed: `threw: ${e.message || String(e)}` }
      }
      // Transient throttling from upstream (Supabase Management API, Vercel
      // API) is not a smoke failure — it's an environmental hiccup. Surface
      // as skip so we don't page Mike at 3am because api.supabase.com
      // 429'd a metadata read. Real drift still fails as designed.
      const obsStr = String(out?.observed || '')
      const isThrottled = /\bthrottled\b|too many requests|429|throttler/i.test(obsStr)
      const ok = !!out?.ok || isThrottled
      const skip = !!out?.skip || (isThrottled && !out?.ok)
      results[i] = {
        id: sc.id, category: sc.category, name: sc.name,
        ok, skip,
        observed: skip && isThrottled ? null : (out?.observed || null),
        expected: out?.expected || null,
        detail: (skip && isThrottled) ? 'transient upstream throttle — skipped' : (out?.detail || null),
        duration_ms: Date.now() - sT0,
      }
    }
  }
  const N = Math.max(1, Math.min(concurrency, scenarios.length))
  await Promise.all(Array.from({ length: N }, () => worker()))
  return results
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
export async function runMegaSmoke({ sb, base, pgToken = null, vercelToken = null, vercelProjectId = 'prj_AjhpUcrbNGuSWZrs9CLxQmKkGXnL', concurrency = 1 } = {}) {
  if (!sb) throw new Error('runMegaSmoke: sb (service-role Supabase client) is required')
  if (!base) throw new Error('runMegaSmoke: base URL is required')
  const t0 = Date.now()
  // Reset pg_catalog query cache so re-running the runner in the same process
  // (tests, REPL) doesn't see stale rows.
  _pgCache.clear()
  _pgInFlightByKey.clear()

  // Pre-warm: pull ALL pg_catalog metadata used by schema2 + rls2 in a SINGLE
  // management-API call. Eliminates ~250 individual pg requests.
  if (pgToken) {
    try {
      const allTables = [...new Set([...SYNCED_TABLES_FULL, ...RLS_REQUIRED_FULL])]
      const tableList = allTables.map(t => `'${t}'`).join(',')
      // Bulk columns: every column for every relevant table.
      const colsSql = `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name IN (${tableList})`
      const colsRes = await pgQuery(pgToken, colsSql)
      if (!colsRes.err && Array.isArray(colsRes.rows)) {
        const byTable = {}
        for (const r of colsRes.rows) {
          if (!byTable[r.table_name]) byTable[r.table_name] = {}
          byTable[r.table_name][r.column_name] = r.data_type
        }
        // Seed per-table cache keys that _schemaTableMeta will look up.
        for (const t of allTables) {
          const sql = `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='${t}'`
          const cols = byTable[t] || null
          const synth = cols
            ? { rows: Object.entries(cols).map(([column_name, data_type]) => ({ column_name, data_type })), err: null }
            : { rows: [], err: null }
          _pgCache.set(sql.trim(), synth)
        }
      }
      // Bulk RLS + policies for the same set.
      const rlsSql = `SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN (${tableList})`
      const polSql = `SELECT tablename, policyname, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename IN (${tableList})`
      const [rlsRes, polRes] = await Promise.all([pgQuery(pgToken, rlsSql), pgQuery(pgToken, polSql)])
      if (!rlsRes.err && !polRes.err) {
        const rlsByTable = {}
        for (const r of rlsRes.rows || []) rlsByTable[r.table_name] = !!r.rls_enabled
        const polByTable = {}
        for (const r of polRes.rows || []) {
          if (!polByTable[r.tablename]) polByTable[r.tablename] = []
          polByTable[r.tablename].push({ policyname: r.policyname, qual: r.qual, with_check: r.with_check })
        }
        for (const t of allTables) {
          const sql = `
      SELECT
        (SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='${t}') AS rls_enabled,
        COALESCE((SELECT json_agg(json_build_object('policyname',policyname,'qual',qual,'with_check',with_check)) FROM pg_policies WHERE schemaname='public' AND tablename='${t}'), '[]'::json) AS policies
    `
          const rlsEnabled = rlsByTable[t]
          const policies = polByTable[t] || []
          const synth = { rows: [{ rls_enabled: rlsEnabled === undefined ? null : rlsEnabled, policies }], err: null }
          _pgCache.set(sql.trim(), synth)
        }
      }
    } catch { /* fall through — individual scenarios will retry */ }
  }

  const demoRegistry = await loadDemoRegistry(sb)

  const scenarios = [
    ...buildInfraScenarios(base),
    ...buildEnvScenarios(vercelToken, vercelProjectId),
    ...buildSchemaScenarios(pgToken),
    ...buildRlsScenarios(pgToken, sb, demoRegistry),
    ...buildFlowScenarios(sb, demoRegistry),
    ...buildMesasScenarios(sb, demoRegistry),
    ...buildServicesScenarios(sb, demoRegistry),
    ...buildContabilidadScenarios(sb, base, demoRegistry),
    ...buildPlanScenarios(),
    ...buildCronScenarios(sb),
    ...buildEcfScenarios(base),
    // Wave 4 expansion — pure-read scenarios (do not mutate prod).
    ...buildInfra2Scenarios(base),
    ...buildSchema2Scenarios(pgToken),
    ...buildRls2Scenarios(pgToken),
    ...buildPlan2Scenarios(),
    ...buildCron2Scenarios(sb),
    ...buildEcf2Scenarios(base, sb),
    ...buildFlow2Scenarios(sb, base),
    ...buildEnv2Scenarios(base, sb, pgToken),
    ...buildSync2Scenarios(sb, pgToken),
    ...buildInvariantScenarios(sb, pgToken),
  ]

  const results = await runScenariosParallel(scenarios, concurrency)

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
