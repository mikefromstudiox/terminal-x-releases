// lib/audit-harness.js
//
// AUDIT HARNESS — single foundation that Wave 2's vertical/schema/security/
// stress suites and the expanded Mega Smoke all consume. Replaces the
// hand-rolled boilerplate in scripts/{ranoza,restaurant,concesionario}-e2e-smoke.mjs
// + scripts/demo-vertical-audit.mjs + scripts/tenant-isolation-smoke.mjs etc.
//
// Design rules:
//   - ESM, Node 22, zero new npm deps (uses @supabase/supabase-js + node:crypto only).
//   - Service-role client for admin queries. Anon client for RLS-denial tests.
//   - Per-business authed client minted via the existing Edge Function
//     `mint-license-jwt` (see packages/services/perLicenseJwt.js). Scenarios
//     that need it pass a licenseKey/machineId pair OR a license row to query.
//   - LIFO cleanup per scenario + global orphan drain at end-of-run.
//   - Pretty or JSON reporter (JSON=true env var or jsonOutput:true).
//   - Parallel: categories run concurrently up to `parallel`; scenarios within
//     a category run sequentially (state-sharing safety).
//   - Filter: prefix match by default, /regex/ literal supported, `only` exact id.
//   - Cron-aware: when MEGA_SMOKE_CRON=1, writes summary to mega_smoke_runs and
//     escalates failures to client_errors via reportServerError.
//
// PUBLIC API — see createHarness() below.

import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { reportServerError } from './report-server-error.js'

const SCENARIO_TIMEOUT_MS = 30_000
const HARNESS_VERSION = '1.0.0'

// ─── FIXTURES REGISTRY ───────────────────────────────────────────────────────
// Well-known business names → stable handles. We resolve by name once per run
// (cached on the harness instance) so a renamed/missing row is a fatal-skip,
// not a silent zero-row query. Every later suite references these by alias.
//
// NOTE: do NOT hardcode UUIDs here — they vary across environments. Resolve
// from `businesses.name` at boot.
const FIXTURE_SPECS = {
  // Real clients
  perla:        { match: ['Contabilidad Perla Lugo'],     real: true,  vertical: 'accounting' },
  ranoza:       { match: ['Ranoza Liquor Store'],         real: true,  vertical: 'tienda' },
  crokao:       { match: ['Crokao'],                      real: true,  vertical: 'restaurant' },
  carwash_dj:   { match: ['CAR WASH DJ'],                 real: true,  vertical: 'carwash_hybrid' },
  sxad:         { match: ['STUDIO X SRL'],                real: true,  vertical: 'master' },
  // Demo businesses (shared sandbox tenants)
  demo_carwash:     { match: ['Demo Car Wash'],                 real: false, vertical: 'carwash' },
  demo_retail:      { match: ['Demo Tienda'],                   real: false, vertical: 'tienda' },
  demo_salon:       { match: ['Demo Salon de Belleza'],         real: false, vertical: 'salon' },
  demo_restaurant:  { match: ['Demo Restaurante'],              real: false, vertical: 'restaurant' },
  demo_mechanic:    { match: ['Demo Taller Mecanico'],          real: false, vertical: 'mecanica' },
  demo_dealership:  { match: ['Demo Concesionario'],            real: false, vertical: 'concesionario' },
  demo_foodtruck:   { match: ['Demo Food Truck'],               real: false, vertical: 'foodtruck' },
  demo_loans:       { match: ['Demo Prestamos'],                real: false, vertical: 'loans' },
  demo_services:    { match: ['Demo Servicios Profesionales'],  real: false, vertical: 'services' },
  demo_accounting:  { match: ['Demo Contabilidad'],             real: false, vertical: 'accounting' },
  demo_licoreria:   { match: ['Licoreria Demo'],                real: false, vertical: 'tienda' },
  demo_carniceria:  { match: ['Carniceria Demo'],               real: false, vertical: 'meat_market' },
}

// ─── INTERNAL UTILS ──────────────────────────────────────────────────────────
const newSid = () => crypto.randomUUID()
const nowIso = () => new Date().toISOString()

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`scenario_timeout_${ms}ms:${label}`)), ms)),
  ])
}

// Tiny p-map: run async fn over items with concurrency cap, no dep.
async function pMap(items, fn, concurrency = 1) {
  if (concurrency <= 1) {
    const out = []
    for (const it of items) out.push(await fn(it))
    return out
  }
  const out = new Array(items.length)
  let next = 0
  async function worker() {
    while (true) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return out
}

function compileFilter(spec) {
  if (!spec) return () => true
  const s = String(spec).trim()
  // /regex/ literal
  if (s.length > 1 && s.startsWith('/') && s.endsWith('/')) {
    const re = new RegExp(s.slice(1, -1))
    return id => re.test(id)
  }
  // prefix match
  return id => id === s || id.startsWith(s + '.') || id.startsWith(s)
}

// Class of assertion failures — distinct from runtime throws so the reporter
// can render them differently.
class AssertionError extends Error {
  constructor(msg, opts = {}) { super(msg); this.name = 'AssertionError'; this.expected = opts.expected; this.observed = opts.observed }
}

// ─── HARNESS FACTORY ─────────────────────────────────────────────────────────
/**
 * Create an audit harness. Register scenarios with .scenario(), then await .run().
 *
 * @param {Object}   opts
 * @param {string}   opts.name              — suite name (printed + stored in mega_smoke_runs).
 * @param {string}   opts.supabaseUrl       — required.
 * @param {string}   opts.serviceRoleKey    — required for admin queries / writes against demo data.
 * @param {string}   [opts.anonKey]         — required for RLS-denial scenarios.
 * @param {string}   [opts.accessToken]     — SUPABASE_ACCESS_TOKEN for pg_catalog queries.
 * @param {string}   [opts.functionsUrl]    — base URL for Supabase Edge Functions (for license JWT mint).
 * @param {boolean}  [opts.jsonOutput=false]— true → JSON to stdout, false → pretty text.
 * @param {boolean}  [opts.failFast=false]  — stop at first failure.
 * @param {number}   [opts.parallel=1]      — concurrent CATEGORIES (scenarios inside a category run sequentially).
 * @param {string}   [opts.filter]          — prefix or /regex/ to subset.
 * @param {string}   [opts.only]            — exact scenario id (overrides filter).
 * @param {boolean}  [opts.reportCritical=false] — escalate failures to client_errors (cron).
 * @param {number}   [opts.scenarioTimeoutMs] — override per-scenario timeout (default 30s).
 * @param {object}   [opts.logger]          — { info, warn, error }; defaults to console.
 */
export function createHarness(opts = {}) {
  const {
    name = 'unnamed-suite',
    supabaseUrl,
    serviceRoleKey,
    anonKey,
    accessToken,
    functionsUrl,
    jsonOutput = (process.env.JSON === 'true' || process.env.JSON === '1'),
    failFast = false,
    parallel = 1,
    filter,
    only,
    reportCritical = false,
    scenarioTimeoutMs = SCENARIO_TIMEOUT_MS,
    logger = console,
  } = opts

  if (!supabaseUrl) throw new Error('createHarness: supabaseUrl required')
  if (!serviceRoleKey) throw new Error('createHarness: serviceRoleKey required')

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  const anon = anonKey ? createClient(supabaseUrl, anonKey, { auth: { persistSession: false } }) : null

  const scenarios = []                // [{id, category, name, fn, opts}]
  const fixtures = {}                 // alias → { id, name, real, vertical, settings } (resolved at run())
  const orphanCleanups = []           // global cleanup queue for crashed scenarios
  const filterFn = compileFilter(only || filter)

  // Pretty colors only if TTY and not JSON mode.
  const useColor = !jsonOutput && process.stdout.isTTY
  const c = useColor
    ? { red: s => `\x1b[31m${s}\x1b[0m`, green: s => `\x1b[32m${s}\x1b[0m`, yellow: s => `\x1b[33m${s}\x1b[0m`, dim: s => `\x1b[2m${s}\x1b[0m`, bold: s => `\x1b[1m${s}\x1b[0m`, cyan: s => `\x1b[36m${s}\x1b[0m` }
    : { red: s => s, green: s => s, yellow: s => s, dim: s => s, bold: s => s, cyan: s => s }

  // ── pg_catalog admin query helper (Management API) ────────────────────────
  async function pgQuery(sql) {
    if (!accessToken) throw new Error('pgQuery: SUPABASE_ACCESS_TOKEN required')
    const projectMatch = supabaseUrl.match(/https?:\/\/([^.]+)\.supabase\.co/)
    if (!projectMatch) throw new Error(`pgQuery: cannot extract project ref from ${supabaseUrl}`)
    const projectRef = projectMatch[1]
    const r = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    })
    if (!r.ok) throw new Error(`pgQuery ${r.status}: ${(await r.text()).slice(0, 240)}`)
    const j = await r.json()
    return Array.isArray(j) ? j : []
  }

  // ── Fixture loader. Verifies each known business exists at run() boot. ────
  async function loadFixtures() {
    // Pull every business once, then resolve aliases locally — one round-trip
    // instead of 12 ilike queries.
    const { data, error } = await supabase
      .from('businesses')
      .select('id, name, settings, is_demo')
      .limit(500)
    if (error) throw new Error(`fixture loader: ${error.message}`)
    const all = data || []
    const missing = []
    for (const [alias, spec] of Object.entries(FIXTURE_SPECS)) {
      const hit = all.find(b => spec.match.some(m => (b.name || '').toLowerCase().trim() === m.toLowerCase().trim()))
      if (hit) {
        fixtures[alias] = {
          id: hit.id,
          name: hit.name,
          real: !hit.is_demo && spec.real,
          vertical: spec.vertical,
          settings: hit.settings || {},
        }
      } else {
        missing.push({ alias, tried: spec.match })
      }
    }
    return { resolved: Object.keys(fixtures).length, missing }
  }

  // ── License JWT mint (Edge Function passthrough) ──────────────────────────
  async function mintLicenseJwt(licenseKey, machineId) {
    if (!functionsUrl) throw new Error('mintLicenseJwt: functionsUrl not configured on harness')
    if (!anonKey) throw new Error('mintLicenseJwt: anonKey required on harness')
    if (!licenseKey || !machineId) throw new Error('mintLicenseJwt: licenseKey + machineId required')
    const url = functionsUrl.replace(/\/+$/, '') + '/mint-license-jwt'
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: anonKey, authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({ license_key: licenseKey, machine_id: machineId }),
    })
    if (!r.ok) throw new Error(`mintLicenseJwt ${r.status}: ${(await r.text()).slice(0, 240)}`)
    const j = await r.json()
    if (!j.access_token) throw new Error('mintLicenseJwt: malformed response')
    return j
  }

  // ── Per-business authed client (uses license JWT under the hood) ──────────
  // Caller responsibility: provide a license_key + machine_id for this business,
  // OR provide an existing access_token. Falls back to throwing — scenarios
  // that want this MUST opt in explicitly to avoid surprise auth state.
  async function businessClient({ licenseKey, machineId, accessToken: explicitToken } = {}) {
    let token = explicitToken
    if (!token) {
      const bundle = await mintLicenseJwt(licenseKey, machineId)
      token = bundle.access_token
    }
    const client = createClient(supabaseUrl, anonKey || serviceRoleKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    return client
  }

  // ── Scenario context factory ─────────────────────────────────────────────
  function makeContext(scenarioId) {
    const startedAt = Date.now()
    const cleanups = []
    const logs = []
    const skipBox = { skipped: false, reason: null }

    const ctx = {
      // clients
      supabase,
      anon,
      env: () => ({ supabaseUrl, anonKey, accessToken, functionsUrl }),

      // helpers
      uuid: newSid,
      timestamp: nowIso,
      timing: () => ({ ms: Date.now() - startedAt }),
      log: (msg) => { logs.push({ t: Date.now() - startedAt, msg: String(msg) }); if (!jsonOutput) logger.info(c.dim(`     · ${msg}`)) },

      // fixtures
      fixture: (alias) => {
        const f = fixtures[alias]
        if (!f) throw new AssertionError(`fixture missing: ${alias} — run harness with fixtures loaded`, { expected: alias, observed: 'absent' })
        return f
      },
      fixtures: () => ({ ...fixtures }),

      // auth helpers
      mintLicenseJwt,
      businessClient,

      // admin
      pgQuery,

      // cleanups (LIFO)
      cleanup: (fn) => { if (typeof fn === 'function') cleanups.push(fn) },

      // skip
      skip: (reason) => { skipBox.skipped = true; skipBox.reason = reason || 'skipped' },

      // assertions
      assert: (cond, msg = 'assertion failed') => {
        if (!cond) throw new AssertionError(msg, { expected: 'truthy', observed: cond })
      },
      assertEq: (a, b, msg) => {
        const eq = (typeof a === 'object' || typeof b === 'object') ? JSON.stringify(a) === JSON.stringify(b) : a === b
        if (!eq) throw new AssertionError(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`, { expected: b, observed: a })
      },
      assertNotNull: (v, msg = 'expected non-null') => {
        if (v === null || v === undefined) throw new AssertionError(msg, { expected: 'non-null', observed: v })
      },
      assertSchema: (row, requiredCols, msg) => {
        if (!row || typeof row !== 'object') throw new AssertionError(msg || `assertSchema: row not object`, { expected: requiredCols, observed: row })
        const missing = requiredCols.filter(k => !(k in row))
        if (missing.length) throw new AssertionError(msg || `missing columns: ${missing.join(', ')}`, { expected: requiredCols, observed: Object.keys(row) })
      },
      expectError: async (fn, pattern, msg = 'expected error not thrown') => {
        let threw = null
        try { await fn() } catch (e) { threw = e }
        if (!threw) throw new AssertionError(msg, { expected: `throw matching ${pattern}`, observed: 'no throw' })
        const text = String(threw.message || threw)
        if (pattern instanceof RegExp && !pattern.test(text)) {
          throw new AssertionError(`${msg} — error did not match ${pattern}: ${text.slice(0, 200)}`, { expected: pattern.source, observed: text })
        }
        if (typeof pattern === 'string' && !text.includes(pattern)) {
          throw new AssertionError(`${msg} — error did not contain "${pattern}": ${text.slice(0, 200)}`, { expected: pattern, observed: text })
        }
        return threw
      },

      // run-mega-smoke hook (re-export, lets pre-release.mjs invoke from harness)
      runMegaSmokeTick: async ({ base, vercelToken, vercelProjectId } = {}) => {
        const { runMegaSmoke } = await import('./mega-smoke-runner.js')
        return runMegaSmoke({ sb: supabase, base, pgToken: accessToken, vercelToken, vercelProjectId })
      },
    }

    return { ctx, cleanups, logs, skipBox, startedAt }
  }

  // ── Public registration API ───────────────────────────────────────────────
  function scenario(id, fn, scenOpts = {}) {
    if (typeof id !== 'string' || !id) throw new Error('scenario: id required (string)')
    if (typeof fn !== 'function') throw new Error(`scenario ${id}: fn required (async function)`)
    const category = scenOpts.category || id.split('.')[0] || 'misc'
    scenarios.push({ id, category, name: scenOpts.name || id, fn, opts: scenOpts })
  }

  // ── Runner ────────────────────────────────────────────────────────────────
  async function run() {
    const t0 = Date.now()

    // 1. Load fixtures (fatal-soft if Supabase unreachable).
    let fixtureSummary = { resolved: 0, missing: [] }
    try {
      fixtureSummary = await loadFixtures()
    } catch (e) {
      if (!jsonOutput) logger.warn(c.yellow(`[harness] fixture load failed: ${e.message} — scenarios needing fixtures will skip`))
    }

    // 2. Apply filter.
    const selected = scenarios.filter(s => filterFn(s.id))
    if (!jsonOutput) {
      logger.info(c.bold(`\n═══ ${name} ═══`))
      logger.info(c.dim(`harness v${HARNESS_VERSION} | ${selected.length}/${scenarios.length} scenarios | fixtures: ${fixtureSummary.resolved}/${Object.keys(FIXTURE_SPECS).length} resolved`))
      if (fixtureSummary.missing?.length) {
        logger.info(c.dim(`  missing fixtures: ${fixtureSummary.missing.map(m => m.alias).join(', ')}`))
      }
      logger.info('')
    }

    // 3. Group by category for parallel-by-category execution.
    const byCat = new Map()
    for (const s of selected) {
      if (!byCat.has(s.category)) byCat.set(s.category, [])
      byCat.get(s.category).push(s)
    }
    const categories = Array.from(byCat.keys())

    const allResults = []
    let abort = false

    async function runOne(sc) {
      const sT0 = Date.now()
      const { ctx, cleanups, logs, skipBox } = makeContext(sc.id)
      let status = 'pass'
      let error = null
      let errorMeta = null

      try {
        await withTimeout(Promise.resolve(sc.fn(ctx)), scenarioTimeoutMs, sc.id)
      } catch (e) {
        if (e instanceof AssertionError) {
          status = 'fail'
          error = e.message
          errorMeta = { expected: e.expected, observed: e.observed }
        } else {
          status = 'fail'
          error = (e && e.message) || String(e)
          errorMeta = { stack: (e && e.stack) ? String(e.stack).slice(0, 1200) : null }
        }
      }
      if (skipBox.skipped && status === 'pass') {
        status = 'skip'
        error = skipBox.reason
      }

      // LIFO cleanup — always runs.
      for (let i = cleanups.length - 1; i >= 0; i--) {
        try { await cleanups[i]() }
        catch (e) {
          if (!jsonOutput) logger.warn(c.yellow(`   ⚠ cleanup error in ${sc.id}: ${e.message}`))
        }
      }

      const res = {
        id: sc.id, category: sc.category, name: sc.name, status,
        error, errorMeta, logs,
        timing: { ms: Date.now() - sT0 },
      }
      allResults.push(res)

      // Pretty line.
      if (!jsonOutput) {
        const icon = status === 'pass' ? c.green('✅') : status === 'fail' ? c.red('❌') : c.yellow('⏭')
        const ms = c.dim(`(${res.timing.ms}ms)`)
        logger.info(`  ${icon} ${sc.id} ${ms}${status !== 'pass' && error ? c.dim(' — ' + String(error).slice(0, 140)) : ''}`)
      }

      // Escalate critical failures (cron mode).
      if (status === 'fail' && reportCritical) {
        await reportServerError(new Error(`[${name}] ${sc.id}: ${error}`), {
          route: `harness/${name}`,
          action: sc.id,
          severity: 'critical',
          extra: { suite: name, scenario: sc.id, expected: errorMeta?.expected, observed: errorMeta?.observed },
        }).catch(() => {})
      }

      if (failFast && status === 'fail') abort = true
      return res
    }

    async function runCategory(cat) {
      const list = byCat.get(cat) || []
      if (!jsonOutput) logger.info(c.cyan(`▸ ${cat}  ${c.dim('(' + list.length + ')')}`))
      for (const sc of list) {
        if (abort) break
        await runOne(sc)
      }
    }

    // 4. Drive execution.
    if (parallel > 1 && categories.length > 1) {
      await pMap(categories, runCategory, parallel)
    } else {
      for (const cat of categories) {
        if (abort) break
        await runCategory(cat)
      }
    }

    // 5. Drain orphan cleanups (registered globally before scenario crashed before adding).
    for (let i = orphanCleanups.length - 1; i >= 0; i--) {
      try { await orphanCleanups[i]() }
      catch (e) { if (!jsonOutput) logger.warn(c.yellow(`[harness] orphan cleanup error: ${e.message}`)) }
    }

    // 6. Compute summary.
    const passed = allResults.filter(r => r.status === 'pass').length
    const failed = allResults.filter(r => r.status === 'fail').length
    const skipped = allResults.filter(r => r.status === 'skip').length
    const durationMs = Date.now() - t0

    const summary = {
      suite: name,
      harness_version: HARNESS_VERSION,
      total: allResults.length,
      passed, failed, skipped,
      durationMs,
      fixturesResolved: fixtureSummary.resolved,
      fixturesMissing: fixtureSummary.missing || [],
      scenarios: allResults,
    }

    // 7. Reporter.
    if (jsonOutput) {
      process.stdout.write(JSON.stringify(summary) + '\n')
    } else {
      const slowest = [...allResults].sort((a, b) => b.timing.ms - a.timing.ms).slice(0, 5)
      const failures = allResults.filter(r => r.status === 'fail')
      logger.info('')
      logger.info(c.bold(`── ${name} summary ──`))
      logger.info(`  ${c.green(passed + ' passed')}  ${failed ? c.red(failed + ' failed') : c.dim('0 failed')}  ${skipped ? c.yellow(skipped + ' skipped') : c.dim('0 skipped')}  ${c.dim(durationMs + 'ms')}`)
      if (failures.length) {
        logger.info('')
        logger.info(c.bold('  failures:'))
        for (const f of failures.slice(0, 10)) {
          logger.info(`    ${c.red('✗')} ${f.id} — ${f.error}`)
          if (f.errorMeta?.expected !== undefined) logger.info(c.dim(`        expected: ${JSON.stringify(f.errorMeta.expected)?.slice(0, 200)}`))
          if (f.errorMeta?.observed !== undefined) logger.info(c.dim(`        observed: ${JSON.stringify(f.errorMeta.observed)?.slice(0, 200)}`))
        }
      }
      if (slowest.length && slowest[0].timing.ms > 200) {
        logger.info('')
        logger.info(c.bold('  slowest:'))
        for (const s of slowest) logger.info(`    ${s.timing.ms}ms  ${s.id}`)
      }
      logger.info('')
    }

    // 8. Cron logging — best effort, never throw.
    if (process.env.MEGA_SMOKE_CRON === '1') {
      try {
        await supabase.from('mega_smoke_runs').insert({
          suite: name,
          total: summary.total, passed, failed, skipped,
          duration_ms: durationMs,
          summary, // jsonb
        })
      } catch { /* table optional; ignore */ }
    }

    return summary
  }

  return {
    scenario,
    run,
    // expose internals for advanced suites (Wave 2)
    _fixtures: () => fixtures,
    _supabase: () => supabase,
    _anon: () => anon,
    _pgQuery: pgQuery,
    _mintLicenseJwt: mintLicenseJwt,
    _businessClient: businessClient,
  }
}

export { HARNESS_VERSION, FIXTURE_SPECS, AssertionError }
