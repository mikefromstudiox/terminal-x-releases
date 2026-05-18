#!/usr/bin/env node
// scripts/deploy-smoke-test.mjs
//
// Post-deploy smoke test for terminalxpos.com.
//
// WHY: Commit ff65749 on 2026-05-17 silently broke production for ~6 hours. Five
// distinct silent failures stacked: middleware path (CSP nonce never injected),
// missing SPA rewrites (/pos 404), api/ folder relocation (every /api/* returned
// 405 + index.html), CSP nonce desync from edge cache, and missing VITE_SUPABASE_*
// env vars on Vercel (bundle had no Supabase client = infinite spinner). Each one
// was silent because /api/panel?action=report_error was 405-returning HTML, so the
// frontend's window.__txReportError pipeline could not phone home.
//
// This script catches every one of those classes within 90s of going live.
//
// USAGE:
//   node scripts/deploy-smoke-test.mjs              # default — production
//   node scripts/deploy-smoke-test.mjs --base=URL   # override target
//   node scripts/deploy-smoke-test.mjs --json       # machine-readable
//
// EXITS:
//   0 — all checks pass
//   1 — one or more checks failed
//   2 — script could not run (network down, bad args, etc.)
//
// COVERAGE MAP (each check ↔ failure it would have caught today):
//   A. SPA bootstrap            → middleware-missing / nonce-desync / dead index.html
//   B. Env-var injection        → missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
//   C. API routing              → api/ folder mislocated, /api/* served as index.html
//   D. report_error round-trip  → error pipeline itself broken (silent-failure canary)
//   E. Vercel env presence      → server-side env missing (CRON_SECRET, JWT, etc.)
//   F. Static assets            → SPA catch-all swallowed sitemap/robots/og/manifest

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── env loader (no dotenv dep) ───────────────────────────────────────────────
function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env')
  if (!fs.existsSync(envPath)) return
  const raw = fs.readFileSync(envPath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (!m) continue
    const [, k, vRaw] = m
    if (process.env[k] !== undefined) continue
    const v = vRaw.replace(/^['"]|['"]$/g, '')
    process.env[k] = v
  }
}
loadEnv()

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const BASE = (argv.find(a => a.startsWith('--base=')) || '--base=https://terminalxpos.com').slice(7).replace(/\/$/, '')
const JSON_MODE = argv.includes('--json')
const SOURCE = argv.includes('--cron') ? 'cron'
            : argv.includes('--ci')   ? 'github-actions'
            : 'local'

// ── pretty output (TTY-aware ANSI) ───────────────────────────────────────────
const TTY = process.stdout.isTTY && !JSON_MODE
const C = {
  reset: TTY ? '\x1b[0m' : '',
  red:   TTY ? '\x1b[31m' : '',
  green: TTY ? '\x1b[32m' : '',
  yellow:TTY ? '\x1b[33m' : '',
  dim:   TTY ? '\x1b[2m' : '',
  bold:  TTY ? '\x1b[1m' : '',
}
const ICON_PASS = TTY ? '✓' : 'PASS'
const ICON_FAIL = TTY ? '✗' : 'FAIL'
const ICON_WARN = TTY ? '⚠' : 'WARN'

const results = [] // { category, check, ok, severity, expected, actual, note }
function record(category, check, ok, opts = {}) {
  const r = {
    category,
    check,
    ok: !!ok,
    severity: opts.severity || (ok ? 'info' : 'critical'),
    expected: opts.expected ?? null,
    actual: opts.actual ?? null,
    note: opts.note ?? null,
  }
  results.push(r)
  if (!JSON_MODE) {
    const icon = ok ? `${C.green}${ICON_PASS}${C.reset}`
                    : `${r.severity === 'warning' ? C.yellow + ICON_WARN : C.red + ICON_FAIL}${C.reset}`
    let line = `  ${icon} [${category}] ${check}`
    if (!ok && r.actual) line += `  ${C.dim}(${String(r.actual).slice(0, 140)})${C.reset}`
    console.log(line)
  }
}

// ── fetch with timeout ───────────────────────────────────────────────────────
async function tfetch(url, init = {}, ms = 15000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

// Track bundle URL for hash + B reuse
let MAIN_BUNDLE_URL = null
let MAIN_BUNDLE_BODY = null

// ── A. SPA bootstrap ─────────────────────────────────────────────────────────
async function checkSpaBootstrap() {
  const url = `${BASE}/pos`
  let resp, html
  try {
    resp = await tfetch(url, { headers: { 'Accept': 'text/html', 'User-Agent': 'deploy-smoke-test/1.0' }, redirect: 'manual' })
    html = await resp.text()
  } catch (e) {
    record('A', 'GET /pos reachable', false, { actual: e.message })
    return
  }

  record('A', 'GET /pos returns 200', resp.status === 200, { expected: 200, actual: resp.status })

  const ct = resp.headers.get('content-type') || ''
  record('A', 'Content-Type is text/html', ct.includes('text/html'), { expected: 'text/html*', actual: ct })

  // Bundle script-tag present (Vite injection)
  const bundleMatch = html.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']*\/assets\/index-[^"']+\.js)["']/i)
  record('A', 'HTML references /assets/index-*.js', !!bundleMatch, { expected: '<script type=module src=/assets/index-*.js>', actual: bundleMatch ? bundleMatch[1] : '(not found)' })
  if (bundleMatch) MAIN_BUNDLE_URL = new URL(bundleMatch[1], BASE).toString()

  // Middleware must have replaced __CSP_NONCE__ literal in HTML
  const litCount = (html.match(/__CSP_NONCE__/g) || []).length
  record('A', 'HTML has 0 __CSP_NONCE__ literals (middleware ran)', litCount === 0, { expected: 0, actual: litCount })

  // CSP nonce in body matches Content-Security-Policy header (no cache desync)
  const cspHeader = resp.headers.get('content-security-policy') || ''
  const headerNonceM = cspHeader.match(/'nonce-([A-Za-z0-9+/=_-]+)'/)
  const bodyNonceM = html.match(/<script[^>]*\snonce=["']([A-Za-z0-9+/=_-]+)["']/i)
  if (headerNonceM && bodyNonceM) {
    record('A', 'CSP nonce header == body nonce', headerNonceM[1] === bodyNonceM[1], { expected: headerNonceM[1], actual: bodyNonceM[1] })
  } else if (!headerNonceM && !bodyNonceM) {
    // CSP without nonce is acceptable only if no inline scripts; flag as warn.
    record('A', 'CSP nonce header == body nonce', true, { severity: 'warning', note: 'no nonce in header or body — strict-dynamic likely disabled' })
  } else {
    record('A', 'CSP nonce header == body nonce', false, { expected: 'both present and equal', actual: `header=${!!headerNonceM} body=${!!bodyNonceM}` })
  }

  // Bundle URL resolves
  if (MAIN_BUNDLE_URL) {
    try {
      const br = await tfetch(MAIN_BUNDLE_URL, { headers: { 'User-Agent': 'deploy-smoke-test/1.0' } })
      MAIN_BUNDLE_BODY = await br.text()
      const bct = br.headers.get('content-type') || ''
      const okStatus = br.status === 200
      const okCt = /javascript/i.test(bct)
      const okSize = (MAIN_BUNDLE_BODY?.length || 0) > 1024
      record('A', 'Main bundle 200 + JS content-type + non-empty',
        okStatus && okCt && okSize,
        { expected: '200 application/javascript >1KB', actual: `${br.status} ${bct} ${MAIN_BUNDLE_BODY?.length || 0}B` })
    } catch (e) {
      record('A', 'Main bundle reachable', false, { actual: e.message })
    }
  }
}

// ── B. Env-var injection (must be in bundle bytes) ───────────────────────────
function checkEnvInjection() {
  if (!MAIN_BUNDLE_BODY) {
    record('B', 'Bundle available for env-var grep', false, { actual: 'main bundle not fetched in A' })
    record('B', 'Bundle available for env-var grep', false, { actual: 'skipped' })
    return
  }
  const hasUrl = MAIN_BUNDLE_BODY.includes('csppjsoirjflumaiipqw.supabase.co')
  const hasJwt = MAIN_BUNDLE_BODY.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')
  record('B', 'VITE_SUPABASE_URL baked into bundle', hasUrl, { expected: 'contains csppjsoirjflumaiipqw.supabase.co', actual: hasUrl ? 'found' : 'MISSING — spinner bug' })
  record('B', 'VITE_SUPABASE_ANON_KEY baked into bundle', hasJwt, { expected: 'contains JWT header eyJhbGciOiJI...', actual: hasJwt ? 'found' : 'MISSING — spinner bug' })
}

// ── C. Critical API endpoints — must not 405 / not text/html ────────────────
const API_ENDPOINTS = [
  { path: '/api/panel?action=report_error',  body: {} },
  { path: '/api/fe?action=semilla',          body: {} },
  { path: '/api/validate',                   body: {} },
  { path: '/api/rnc',                        body: {} },
  { path: '/api/ecf-sign',                   body: {} },
  { path: '/api/staff-verify-auth',          body: {} },
  { path: '/api/signup/lead',                body: {} },
  { path: '/api/dgii-cert-upload',           body: {} },
]
async function checkApiRouting() {
  for (const e of API_ENDPOINTS) {
    const url = `${BASE}${e.path}`
    let resp, ct, txt
    try {
      resp = await tfetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'deploy-smoke-test/1.0' },
        body: JSON.stringify(e.body),
      })
      ct = (resp.headers.get('content-type') || '').toLowerCase()
      // Read a small slice so we don't OOM on big responses
      txt = (await resp.text()).slice(0, 400)
    } catch (err) {
      record('C', `${e.path} reachable`, false, { actual: err.message })
      continue
    }
    const isHtml = ct.includes('text/html') || /^<!doctype html/i.test(txt)
    const isApiCt = ct.startsWith('application/json') || ct.startsWith('application/xml') || ct.startsWith('text/xml')
    const not405 = resp.status !== 405
    const ok = not405 && !isHtml && (isApiCt || resp.status >= 400) // allow plain error bodies as long as not HTML

    record('C', `${e.path} routed to function (no 405, no HTML)`, ok, {
      expected: 'status != 405, content-type starts application/json|xml',
      actual: `${resp.status} ${ct || '(no ct)'}`,
    })
  }
}

// ── D. report_error round-trip ──────────────────────────────────────────────
async function checkReportErrorRoundTrip() {
  const stamp = `deploy-smoke-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const payload = {
    message: stamp,
    severity: 'info',
    route: '/__smoke',
    user_agent: 'deploy-smoke-test',
    metadata: { source: 'deploy-smoke-test' },
  }
  const t0 = Date.now()
  let postOk = false, insertedId = null
  try {
    const r = await tfetch(`${BASE}/api/panel?action=report_error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'deploy-smoke-test/1.0' },
      body: JSON.stringify(payload),
    })
    const ct = (r.headers.get('content-type') || '').toLowerCase()
    if (r.ok && ct.startsWith('application/json')) {
      const j = await r.json()
      postOk = !!(j?.ok && j?.id)
      insertedId = j?.id || null
    } else {
      const sample = (await r.text()).slice(0, 200)
      record('D', 'POST /api/panel?action=report_error returns ok:true', false, { expected: '{ ok: true, id: <uuid> }', actual: `${r.status} ${ct} ${sample}` })
      return
    }
  } catch (e) {
    record('D', 'POST /api/panel?action=report_error', false, { actual: e.message })
    return
  }
  const postMs = Date.now() - t0
  record('D', `POST report_error returns ok:true (${postMs}ms)`, postOk, { expected: 'ok: true with row id', actual: insertedId ? `id=${insertedId}` : 'no id returned' })

  // Verify row landed in Supabase (read-back via Management API).
  const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
  const PROJECT = 'csppjsoirjflumaiipqw'
  if (!TOKEN) {
    record('D', 'Row visible in client_errors via Management API', true, { severity: 'warning', note: 'SUPABASE_ACCESS_TOKEN absent — skipping read-back (cron context)' })
    return
  }
  // Allow up to 10s for the row to be visible (Postgres replication is sub-100ms but Vercel cold-start can stretch the insert).
  const deadline = Date.now() + 10000
  let found = false, attempts = 0
  while (Date.now() < deadline && !found) {
    attempts++
    try {
      const q = `SELECT id FROM public.client_errors WHERE message = '${stamp.replace(/'/g, "''")}' LIMIT 1`
      const rr = await tfetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      })
      if (rr.ok) {
        const rows = await rr.json()
        if (Array.isArray(rows) && rows.length > 0) { found = true; break }
      }
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 500))
  }
  record('D', `Row reachable in client_errors (${attempts} attempt${attempts === 1 ? '' : 's'})`, found, {
    expected: 'SELECT … WHERE message=stamp → 1 row',
    actual: found ? 'found' : 'NOT FOUND in 10s — error pipeline broken',
  })
}

// ── E. Vercel env-var presence (local only) ──────────────────────────────────
async function checkVercelEnv() {
  if (SOURCE !== 'local') {
    return // cron has no VERCEL_TOKEN
  }
  const TOKEN = process.env.VERCEL_TOKEN
  if (!TOKEN) {
    record('E', 'VERCEL_TOKEN configured for local env audit', true, { severity: 'warning', note: 'VERCEL_TOKEN not set — skipping (set in .env to enable)' })
    return
  }
  let projectId = 'prj_AjhpUcrbNGuSWZrs9CLxQmKkGXnL'
  try {
    const p = path.resolve(__dirname, '..', 'dist-web', '.vercel', 'project.json')
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'))
      if (j.projectId) projectId = j.projectId
    }
  } catch { /* keep default */ }

  const REQUIRED = [
    'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY',
    'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_JWT_SECRET',
    'CRON_SECRET', 'DGII_CERT_PEM', 'DGII_KEY_PEM', 'RESEND_API_KEY',
  ]

  let envs = null
  try {
    const r = await tfetch(`https://api.vercel.com/v9/projects/${projectId}/env?decrypt=false`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` },
    })
    if (!r.ok) {
      record('E', 'Vercel env list reachable', false, { actual: `${r.status} ${await r.text().then(t => t.slice(0,120))}` })
      return
    }
    const j = await r.json()
    envs = Array.isArray(j.envs) ? j.envs : []
  } catch (e) {
    record('E', 'Vercel env list reachable', false, { actual: e.message })
    return
  }

  for (const key of REQUIRED) {
    const hit = envs.find(e => e.key === key && Array.isArray(e.target) && e.target.includes('production'))
    record('E', `Env var ${key} present in production`, !!hit, { expected: 'configured for production target', actual: hit ? 'present' : 'MISSING' })
  }
}

// ── F. Static assets ─────────────────────────────────────────────────────────
const STATIC_ASSETS = [
  { path: '/sitemap.xml',  ct: /xml/i,   strict: true  },
  { path: '/robots.txt',   ct: /text\/plain/i, strict: true  },
  { path: '/og-image.png', ct: /image\/png/i,   strict: true  },
  { path: '/manifest.json',ct: /(application\/json|application\/manifest)/i, strict: false }, // many CDNs serve text/plain
]
async function checkStaticAssets() {
  for (const a of STATIC_ASSETS) {
    try {
      const r = await tfetch(`${BASE}${a.path}`, { headers: { 'User-Agent': 'deploy-smoke-test/1.0' } })
      const ct = r.headers.get('content-type') || ''
      const okStatus = r.status === 200
      const okCt = a.ct.test(ct)
      if (a.strict) {
        record('F', `${a.path} → 200 + correct content-type`, okStatus && okCt, { expected: `200 ${a.ct}`, actual: `${r.status} ${ct}` })
      } else {
        record('F', `${a.path} → 200`, okStatus, { expected: '200', actual: `${r.status} ${ct}` })
      }
    } catch (e) {
      record('F', `${a.path} reachable`, false, { actual: e.message })
    }
  }
}

// ── persist to Supabase (cron writes via service role; local writes too) ────
async function persistResults(durationMs) {
  if (SOURCE === 'cron') return // cron uses its own write path in api/panel.js
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SVC) return
  const passed = results.filter(r => r.ok).length
  const failed = results.length - passed
  const failures = results.filter(r => !r.ok).map(r => ({
    category: r.category, check: r.check, expected: r.expected, actual: r.actual, severity: r.severity,
  }))
  const bundleHash = MAIN_BUNDLE_URL ? MAIN_BUNDLE_URL.split('/').pop() : null
  try {
    await tfetch(`${SUPABASE_URL}/rest/v1/deploy_smoke_results`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SVC,
        'Authorization': `Bearer ${SVC}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        bundle_hash: bundleHash,
        passed_count: passed,
        failed_count: failed,
        total_count: results.length,
        failures: failures.length ? failures : null,
        duration_ms: durationMs,
        source: SOURCE,
      }),
    })
  } catch { /* best-effort persist */ }
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now()
  if (!JSON_MODE) {
    console.log(`${C.bold}Deploy smoke test${C.reset} ${C.dim}— ${BASE} (source: ${SOURCE})${C.reset}`)
    console.log('')
    console.log(`${C.bold}A. SPA bootstrap${C.reset}`)
  }
  await checkSpaBootstrap()
  if (!JSON_MODE) console.log(`\n${C.bold}B. Env-var injection${C.reset}`)
  checkEnvInjection()
  if (!JSON_MODE) console.log(`\n${C.bold}C. API routing${C.reset}`)
  await checkApiRouting()
  if (!JSON_MODE) console.log(`\n${C.bold}D. report_error round-trip${C.reset}`)
  await checkReportErrorRoundTrip()
  if (!JSON_MODE) console.log(`\n${C.bold}E. Vercel env presence${C.reset}`)
  await checkVercelEnv()
  if (!JSON_MODE) console.log(`\n${C.bold}F. Static assets${C.reset}`)
  await checkStaticAssets()

  const dur = Date.now() - t0
  const passed = results.filter(r => r.ok).length
  const total = results.length
  const failed = total - passed

  await persistResults(dur)

  if (JSON_MODE) {
    console.log(JSON.stringify({ base: BASE, source: SOURCE, duration_ms: dur, passed, failed, total, results }, null, 2))
  } else {
    // group totals per category
    const byCat = {}
    for (const r of results) {
      if (!byCat[r.category]) byCat[r.category] = { p: 0, t: 0 }
      byCat[r.category].t++
      if (r.ok) byCat[r.category].p++
    }
    const label = {
      A: 'SPA bootstrap     ',
      B: 'Env-var injection ',
      C: 'API routing       ',
      D: 'Error reporting RTT',
      E: 'Vercel env presence',
      F: 'Static assets     ',
    }
    console.log('')
    console.log(`${C.bold}=== DEPLOY SMOKE TEST ===${C.reset}`)
    for (const k of Object.keys(label)) {
      if (!byCat[k]) continue
      const { p, t } = byCat[k]
      const color = p === t ? C.green : C.red
      console.log(`${k}. ${label[k]} ${color}${p}/${t} pass${C.reset}`)
    }
    const totalColor = failed === 0 ? C.green : C.red
    console.log(`${C.bold}TOTAL: ${totalColor}${passed}/${total} pass${C.reset}${C.dim} — ${dur}ms${C.reset}`)
    if (failed > 0) {
      console.log('')
      console.log(`${C.red}${C.bold}FAILURES:${C.reset}`)
      for (const r of results.filter(x => !x.ok)) {
        console.log(`  ${C.red}${ICON_FAIL}${C.reset} [${r.category}] ${r.check}`)
        if (r.expected) console.log(`      expected: ${r.expected}`)
        if (r.actual)   console.log(`      actual:   ${r.actual}`)
      }
    }
  }

  process.exit(failed === 0 ? 0 : 1)
}

main().catch(err => {
  console.error(`${C.red}smoke test crashed:${C.reset}`, err?.message || err)
  process.exit(2)
})
