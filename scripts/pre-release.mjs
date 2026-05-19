#!/usr/bin/env node
// scripts/pre-release.mjs
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  AETHERCODE — PRE-RELEASE GATE                                           ║
// ║  NASA / SpaceX-grade ship gate for Terminal X.                           ║
// ║  ONE command. ALL signal. ZERO ambiguity.                                ║
// ║                                                                          ║
// ║  Wave 3 of the audit-consolidation programme. Replaces the ad-hoc        ║
// ║  "run every harness by hand and squint at the output" workflow.          ║
// ║                                                                          ║
// ║  Run:                                                                    ║
// ║    NODE_OPTIONS=--use-system-ca node scripts/pre-release.mjs             ║
// ║                                                                          ║
// ║  Verdict:                                                                ║
// ║    exit 0  → GREEN LIGHT — ship it.                                      ║
// ║    exit 1  → DO NOT SHIP — at least one suite failed or                  ║
// ║              unresolved findings exist (override with --allow-findings). ║
// ║    exit 2  → PRE-FLIGHT FAILURE — env / build / git tree problem.        ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// Suites orchestrated (each as its own child process for memory isolation):
//   - vertical-suite     116 scenarios   per-vertical E2E
//   - schema-suite       709 scenarios   pg_catalog drift + constraint shape
//   - security-suite     125 scenarios   RLS / PII / JWT / token safety
//   - stress-suite       589 scenarios   load + adversarial + property tests
//   - rls-policy-audit             1     legacy bridge (zero-policy guard)
//   - mega-smoke         ~55           one tick — infra + flow + cron + ecf
//
// CLI flags:
//   --allow-dirty       skip git clean check
//   --allow-branch      skip main-branch check
//   --allow-version     skip version-bump check
//   --allow-findings    treat suite failures as warnings (override green light)
//   --skip-build        skip `npm run build:web`
//   --only=a,b,c        run subset (vertical,schema,security,stress,rls,mega)
//   --parallel=N        concurrent suites (default = all in parallel)
//   --json              single-line JSON aggregate to stdout
//   --bail              stop scheduling new suites on first failure

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { reportServerError } from '../lib/report-server-error.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// ── .env loader ─────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.resolve(ROOT, '.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (!m || process.env[m[1]] !== undefined) continue
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
}
loadEnv()

// Force system CA on Windows (Mike's network — see memory).
if (!process.env.NODE_OPTIONS || !process.env.NODE_OPTIONS.includes('use-system-ca')) {
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} --use-system-ca`.trim()
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const has = (flag) => argv.includes(flag)
const val = (key) => {
  const a = argv.find(x => x.startsWith(`--${key}=`))
  return a ? a.slice(key.length + 3) : null
}

const FLAGS = {
  allowDirty:    has('--allow-dirty'),
  allowBranch:   has('--allow-branch'),
  allowVersion:  has('--allow-version'),
  allowFindings: has('--allow-findings'),
  skipBuild:     has('--skip-build'),
  json:          has('--json'),
  bail:          has('--bail'),
  only:          val('only'),
  parallel:      Number(val('parallel') || 0),
}

const ALL_SUITES = ['vertical', 'schema', 'security', 'stress', 'rls', 'mega']
const SELECTED = FLAGS.only
  ? FLAGS.only.split(',').map(s => s.trim()).filter(Boolean)
  : ALL_SUITES
const PARALLEL = FLAGS.parallel > 0 ? FLAGS.parallel : SELECTED.length

// ── pretty / json output helpers ────────────────────────────────────────────
const useColor = !FLAGS.json && process.stdout.isTTY
const c = useColor
  ? { red:s=>`\x1b[31m${s}\x1b[0m`, green:s=>`\x1b[32m${s}\x1b[0m`,
      yellow:s=>`\x1b[33m${s}\x1b[0m`, cyan:s=>`\x1b[36m${s}\x1b[0m`,
      dim:s=>`\x1b[2m${s}\x1b[0m`, bold:s=>`\x1b[1m${s}\x1b[0m`,
      bgRed:s=>`\x1b[41;97m${s}\x1b[0m`, bgGreen:s=>`\x1b[42;30m${s}\x1b[0m` }
  : { red:s=>s, green:s=>s, yellow:s=>s, cyan:s=>s, dim:s=>s, bold:s=>s, bgRed:s=>s, bgGreen:s=>s }

const log = (...a) => { if (!FLAGS.json) console.log(...a) }
const warn = (...a) => { if (!FLAGS.json) console.error(...a) }

// ── pre-flight ──────────────────────────────────────────────────────────────
async function preflight() {
  const issues = []

  // env vars
  const envReq = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_ANON_KEY']
  for (const k of envReq) {
    if (!process.env[k] && !process.env[k.replace('VITE_', '')]) {
      issues.push({ kind: 'env', fatal: true, msg: `missing ${k} in .env` })
    }
  }

  // git working tree
  const status = await sh('git', ['status', '--porcelain']).catch(() => null)
  if (status && status.stdout.trim()) {
    issues.push({
      kind: 'git_dirty',
      fatal: !FLAGS.allowDirty,
      msg: `git working tree has uncommitted changes (${status.stdout.trim().split('\n').length} files). Pass --allow-dirty to override.`,
    })
  }

  // branch
  const branch = await sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => null)
  if (branch && branch.stdout.trim() !== 'main') {
    issues.push({
      kind: 'git_branch',
      fatal: !FLAGS.allowBranch,
      msg: `not on main branch (on '${branch.stdout.trim()}'). Pass --allow-branch to override.`,
    })
  }

  // version vs latest tag
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    const tag = await sh('git', ['describe', '--tags', '--abbrev=0']).catch(() => ({ stdout: '' }))
    const latestTag = (tag.stdout || '').trim().replace(/^v/, '')
    if (latestTag && pkg.version === latestTag) {
      issues.push({
        kind: 'version_unbumped',
        fatal: !FLAGS.allowVersion,
        msg: `package.json version (${pkg.version}) matches latest tag (v${latestTag}) — bump before shipping. Pass --allow-version to override.`,
      })
    }
  } catch (e) {
    issues.push({ kind: 'version_check', fatal: false, msg: `version check skipped: ${e.message}` })
  }

  return issues
}

// ── build step ──────────────────────────────────────────────────────────────
async function build() {
  const t0 = Date.now()
  log(c.cyan('▸ npm run build:web'))
  const r = await sh('npm', ['run', 'build:web'], { inherit: !FLAGS.json })
  const ms = Date.now() - t0
  let size = null
  try {
    const distWeb = path.join(ROOT, 'dist-web')
    if (fs.existsSync(distWeb)) size = dirSize(distWeb)
  } catch {}
  return { ok: r.code === 0, ms, sizeBytes: size, stderr: r.stderr?.slice(-2000) || '' }
}

function dirSize(p) {
  let total = 0
  for (const ent of fs.readdirSync(p, { withFileTypes: true })) {
    const full = path.join(p, ent.name)
    if (ent.isDirectory()) total += dirSize(full)
    else { try { total += fs.statSync(full).size } catch {} }
  }
  return total
}

// ── suite runner (child process, JSON=1) ────────────────────────────────────
const SUITE_SPECS = {
  vertical: { script: 'scripts/vertical-suite.mjs', label: 'vertical-suite' },
  schema:   { script: 'scripts/schema-suite.mjs',   label: 'schema-suite' },
  security: { script: 'scripts/security-suite.mjs', label: 'security-suite' },
  stress:   { script: 'scripts/stress-suite.mjs',   label: 'stress-suite' },
  rls:      { script: 'scripts/rls-policy-audit.mjs', label: 'rls-policy-audit', legacy: true },
  mega:     { inline: 'mega', label: 'mega-smoke' },
}

function runSuiteChild(key) {
  const spec = SUITE_SPECS[key]
  return new Promise((resolve) => {
    const t0 = Date.now()
    const args = [spec.script]
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: { ...process.env, JSON: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = '', stderr = ''
    child.stdout.on('data', d => { stdout += d.toString() })
    child.stderr.on('data', d => { stderr += d.toString() })
    child.on('close', (code) => {
      const ms = Date.now() - t0
      // Parse last non-empty JSON line.
      let summary = null
      const lines = stdout.split(/\r?\n/).filter(Boolean)
      for (let i = lines.length - 1; i >= 0; i--) {
        const ln = lines[i].trim()
        if (ln.startsWith('{') && ln.endsWith('}')) {
          try { summary = JSON.parse(ln); break } catch {}
        }
      }
      // Legacy bridge: rls-policy-audit prints human text — synthesise summary.
      if (!summary && spec.legacy) {
        const violationMatch = stdout.match(/(\d+)\s+tabla\(s\)\s+con\s+RLS/i)
        const failed = code === 0 ? 0 : (violationMatch ? Number(violationMatch[1]) : 1)
        summary = {
          suite: spec.label,
          total: 1, passed: code === 0 ? 1 : 0, failed, skipped: 0,
          durationMs: ms,
          scenarios: code === 0 ? [] : [{
            id: 'rls.zero_policy_tables', category: 'rls', name: 'RLS policy coverage',
            status: 'fail', error: stdout.split('\n').filter(l => l.startsWith('✗')).slice(0, 10).join(' | '),
            timing: { ms },
          }],
        }
      }
      resolve({ key, code, ms, summary, stdout, stderr })
    })
  })
}

// Mega Smoke runs in-process (no separate script) via harness re-export.
async function runMegaInline() {
  const t0 = Date.now()
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const { runMegaSmoke } = await import('../lib/mega-smoke-runner.js')
    const sb = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } },
    )
    const base = process.env.PRE_RELEASE_BASE_URL || 'https://terminalxpos.com'
    const r = await runMegaSmoke({
      sb, base,
      pgToken: process.env.SUPABASE_ACCESS_TOKEN || null,
      vercelToken: process.env.VERCEL_TOKEN || null,
    })
    const scenarios = (r.results || []).map(x => ({
      id: x.id, category: x.category, name: x.name,
      status: x.skip ? 'skip' : (x.ok ? 'pass' : 'fail'),
      error: x.ok ? null : (x.observed || x.detail || 'fail'),
      timing: { ms: x.duration_ms || 0 },
    }))
    const summary = {
      suite: 'mega-smoke',
      total: r.total, passed: r.passed, failed: r.failed, skipped: r.skipped,
      durationMs: r.duration_ms,
      scenarios,
    }
    return { key: 'mega', code: r.failed > 0 ? 1 : 0, ms: Date.now() - t0, summary, stdout: '', stderr: '' }
  } catch (e) {
    return {
      key: 'mega', code: 2, ms: Date.now() - t0,
      summary: {
        suite: 'mega-smoke', total: 1, passed: 0, failed: 1, skipped: 0, durationMs: Date.now() - t0,
        scenarios: [{ id: 'mega.bootstrap', category: 'bootstrap', name: 'runMegaSmoke bootstrap',
                      status: 'fail', error: e.message, timing: { ms: Date.now() - t0 } }],
      },
      stdout: '', stderr: e.stack || String(e),
    }
  }
}

// ── concurrency driver ──────────────────────────────────────────────────────
async function runAllSuites(keys) {
  const results = []
  let abort = false
  let nextIdx = 0
  const inflight = new Set()
  const slot = Math.max(1, Math.min(PARALLEL, keys.length))

  function startOne(key) {
    const p = (key === 'mega' ? runMegaInline() : runSuiteChild(key)).then(res => {
      inflight.delete(p)
      results.push(res)
      const s = res.summary || { passed: 0, failed: 0, skipped: 0, total: 0 }
      log(`  ${badge(res)} ${SUITE_SPECS[key].label.padEnd(20)} ${pad(s.passed, 4)} pass · ${pad(s.failed, 3)} fail · ${pad(s.skipped, 3)} skip · ${pad(res.ms, 6)}ms`)
      if (FLAGS.bail && (s.failed > 0 || res.code === 2)) abort = true
    })
    inflight.add(p)
  }

  while (nextIdx < keys.length || inflight.size > 0) {
    while (!abort && inflight.size < slot && nextIdx < keys.length) {
      startOne(keys[nextIdx++])
    }
    if (inflight.size === 0) break
    await Promise.race(inflight)
  }
  return results
}

function badge(res) {
  const s = res.summary
  if (!s || res.code === 2) return c.bgRed(' CRASH ')
  if (s.failed > 0) return c.red('  FAIL ')
  if (s.skipped > 0 && s.passed === 0) return c.yellow('  SKIP ')
  return c.green('  PASS ')
}
function pad(n, w) { return String(n ?? 0).padStart(w, ' ') }

// ── aggregate report ────────────────────────────────────────────────────────
function aggregate(results) {
  let total = 0, passed = 0, failed = 0, skipped = 0
  const allScenarios = []
  for (const r of results) {
    const s = r.summary
    if (!s) continue
    total += s.total || 0
    passed += s.passed || 0
    failed += s.failed || 0
    skipped += s.skipped || 0
    for (const sc of (s.scenarios || [])) allScenarios.push({ ...sc, suite: s.suite })
  }
  const failures = allScenarios.filter(x => x.status === 'fail')
  const slowest = [...allScenarios].sort((a, b) => (b.timing?.ms || 0) - (a.timing?.ms || 0)).slice(0, 10)
  const failuresBySuite = {}
  for (const f of failures) {
    failuresBySuite[f.suite] = failuresBySuite[f.suite] || []
    failuresBySuite[f.suite].push(f)
  }
  return { total, passed, failed, skipped, failures, failuresBySuite, slowest }
}

function renderReport(results, agg, preflightIssues, buildInfo, walltimeMs) {
  log('')
  log(c.bold('═══════════════════════════════════════════════════════════════════'))
  log(c.bold('                    PRE-RELEASE GATE — REPORT'))
  log(c.bold('═══════════════════════════════════════════════════════════════════'))
  log('')

  // Pre-flight
  log(c.bold('PRE-FLIGHT'))
  if (!preflightIssues.length) log(`  ${c.green('✓')} clean — env, git tree, branch, version`)
  for (const i of preflightIssues) {
    const icon = i.fatal ? c.red('✗') : c.yellow('!')
    log(`  ${icon} ${i.kind.padEnd(20)} ${i.msg}`)
  }
  log('')

  // Build
  if (buildInfo) {
    log(c.bold('BUILD'))
    const ok = buildInfo.ok ? c.green('✓') : c.red('✗')
    const sz = buildInfo.sizeBytes ? `${(buildInfo.sizeBytes / 1024 / 1024).toFixed(2)} MB` : 'n/a'
    log(`  ${ok} npm run build:web — ${buildInfo.ms}ms, dist-web ${sz}`)
    if (!buildInfo.ok) log(c.dim('    stderr tail: ' + buildInfo.stderr.slice(-600)))
    log('')
  }

  // Per-suite
  log(c.bold('SUITES'))
  for (const r of results) {
    const s = r.summary || { passed: 0, failed: 0, skipped: 0, total: 0 }
    log(`  ${badge(r)} ${SUITE_SPECS[r.key].label.padEnd(20)} ${pad(s.passed, 4)} pass · ${pad(s.failed, 3)} fail · ${pad(s.skipped, 3)} skip · ${pad(r.ms, 6)}ms`)
  }
  log('')

  // Findings
  if (agg.failed > 0) {
    log(c.bold(c.red('FINDINGS (' + agg.failed + ')')))
    for (const [suite, fails] of Object.entries(agg.failuresBySuite)) {
      log(c.cyan(`  ▸ ${suite}  (${fails.length})`))
      for (const f of fails.slice(0, 5)) {
        log(`    ${c.red('✗')} ${f.id}`)
        if (f.error) log(c.dim(`      ${String(f.error).slice(0, 200)}`))
      }
      if (fails.length > 5) log(c.dim(`    … and ${fails.length - 5} more`))
    }
    log('')
  }

  // Slowest
  if (agg.slowest.length && agg.slowest[0].timing?.ms > 200) {
    log(c.bold('TOP-10 SLOWEST'))
    for (const s of agg.slowest) {
      log(`  ${pad(s.timing?.ms || 0, 6)}ms  ${(s.suite || '').padEnd(18)} ${s.id}`)
    }
    log('')
  }

  // Wall clock
  log(c.bold('TOTAL'))
  log(`  ${agg.total} scenarios — ${c.green(agg.passed + ' passed')}  ${agg.failed ? c.red(agg.failed + ' failed') : c.dim('0 failed')}  ${agg.skipped ? c.yellow(agg.skipped + ' skipped') : c.dim('0 skipped')}`)
  log(`  wall clock: ${(walltimeMs / 1000).toFixed(1)}s`)
  log('')

  // Verdict — BIG TEXT
  const verdictGreen = agg.failed === 0 && !preflightIssues.some(i => i.fatal) && (!buildInfo || buildInfo.ok)
  log(c.bold('═══════════════════════════════════════════════════════════════════'))
  if (verdictGreen) {
    log('  ' + c.bgGreen('   GREEN LIGHT — SHIP IT.   '))
  } else if (FLAGS.allowFindings && (!buildInfo || buildInfo.ok) && !preflightIssues.some(i => i.fatal)) {
    log('  ' + c.yellow('⚠  --allow-findings IN EFFECT — ' + agg.failed + ' UNRESOLVED — OVERRIDE SHIP'))
  } else {
    log('  ' + c.bgRed('   DO NOT SHIP — GATE BLOCKED.   '))
  }
  log(c.bold('═══════════════════════════════════════════════════════════════════'))
  log('')
}

// ── shell helper ────────────────────────────────────────────────────────────
function sh(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      env: process.env,
      shell: process.platform === 'win32',
      stdio: opts.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    })
    let stdout = '', stderr = ''
    if (!opts.inherit) {
      child.stdout?.on('data', d => { stdout += d.toString() })
      child.stderr?.on('data', d => { stderr += d.toString() })
    }
    child.on('close', code => resolve({ code, stdout, stderr }))
    child.on('error', reject)
  })
}

// ── escalation ──────────────────────────────────────────────────────────────
async function escalate(results) {
  const shouldEscalate = !!process.env.CI || process.env.PRE_RELEASE_ESCALATE === '1'
  if (!shouldEscalate) return
  for (const r of results) {
    const s = r.summary
    if (!s || s.failed === 0) continue
    await reportServerError(
      new Error(`[pre-release] ${s.suite}: ${s.failed} scenario(s) failed`),
      {
        route: 'pre-release',
        action: s.suite,
        severity: 'critical',
        extra: {
          suite: s.suite, failed: s.failed, passed: s.passed, total: s.total,
          failures: (s.scenarios || []).filter(x => x.status === 'fail')
            .slice(0, 10).map(x => ({ id: x.id, error: String(x.error).slice(0, 300) })),
        },
      },
    ).catch(() => {})
  }
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now()
  log(c.bold(`\n┌─ PRE-RELEASE GATE — Terminal X v${readVersion()} ─┐`))
  log(c.dim(`  suites: ${SELECTED.join(', ')} · parallel=${PARALLEL} · ${new Date().toISOString()}`))
  log('')

  // 1. Pre-flight
  log(c.cyan('▸ pre-flight'))
  const preflightIssues = await preflight()
  const fatal = preflightIssues.filter(i => i.fatal)
  if (fatal.length) {
    for (const i of fatal) warn(c.red(`  ✗ ${i.msg}`))
    if (FLAGS.json) emitJson({ verdict: 'preflight_failed', preflightIssues, walltimeMs: Date.now() - t0 })
    else log(c.bgRed('\n  PRE-FLIGHT FAILED — exit 2\n'))
    process.exit(2)
  }
  for (const i of preflightIssues) warn(c.yellow(`  ! ${i.msg}`))

  // 2. Build
  let buildInfo = null
  if (!FLAGS.skipBuild) {
    buildInfo = await build()
    if (!buildInfo.ok) {
      warn(c.red(`  ✗ build failed (${buildInfo.ms}ms)`))
      if (FLAGS.json) emitJson({ verdict: 'build_failed', buildInfo, walltimeMs: Date.now() - t0 })
      else log(c.bgRed('\n  BUILD FAILED — exit 2\n'))
      process.exit(2)
    }
    log(`  ${c.green('✓')} build ok (${buildInfo.ms}ms)`)
  } else {
    log(c.dim('  · build skipped (--skip-build)'))
  }
  log('')

  // 3. Suites
  log(c.cyan(`▸ running ${SELECTED.length} suite(s)`))
  const results = await runAllSuites(SELECTED)

  // 4. Aggregate + render
  const agg = aggregate(results)
  const walltimeMs = Date.now() - t0

  if (FLAGS.json) {
    emitJson({
      verdict: agg.failed === 0 ? 'green' : (FLAGS.allowFindings ? 'override' : 'block'),
      total: agg.total, passed: agg.passed, failed: agg.failed, skipped: agg.skipped,
      suites: results.map(r => ({
        key: r.key, label: SUITE_SPECS[r.key].label,
        ...(r.summary ? { passed: r.summary.passed, failed: r.summary.failed, skipped: r.summary.skipped, total: r.summary.total } : { error: 'no_summary' }),
        durationMs: r.ms,
      })),
      preflightIssues, buildInfo, walltimeMs,
      failures: agg.failures.slice(0, 50).map(f => ({ suite: f.suite, id: f.id, error: String(f.error).slice(0, 400) })),
    })
  } else {
    renderReport(results, agg, preflightIssues, buildInfo, walltimeMs)
  }

  // 5. Escalate critical
  await escalate(results)

  // 6. Exit
  if (agg.failed > 0 && !FLAGS.allowFindings) process.exit(1)
  process.exit(0)
}

function emitJson(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}
function readVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version } catch { return '?' }
}

main().catch(e => {
  if (FLAGS.json) emitJson({ verdict: 'crashed', error: e.message })
  else console.error(c.bgRed('\n  PRE-RELEASE CRASHED:'), e.stack || e.message)
  process.exit(2)
})
