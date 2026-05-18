#!/usr/bin/env node
// scripts/flow-drift-smoke.mjs
//
// LAYER 4 — Flow-drift smoke CLI runner. Thin wrapper around
// lib/flow-drift-runner.js so the harness and the cron handler in
// api/panel.js?action=cron_flow_drift_smoke run identical code paths.
//
// WHY: On 2026-05-17 queue.ticket_id stayed NULL on web-created queue rows.
// markPaid was silently skipped, every "cobrar a queued ticket" appeared to
// succeed while the DB row stayed pendiente. Layers 1/2/3 could not see it.
//
// USAGE:
//   NODE_OPTIONS=--use-system-ca node scripts/flow-drift-smoke.mjs
//   NODE_OPTIONS=--use-system-ca node scripts/flow-drift-smoke.mjs --base=https://terminalxpos.com
//   NODE_OPTIONS=--use-system-ca node scripts/flow-drift-smoke.mjs --json
//
// EXITS:
//   0 — all scenarios pass
//   1 — one or more scenarios failed
//   2 — script could not run (network, env, etc.)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { runFlowDrift } from '../lib/flow-drift-runner.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env')
  if (!fs.existsSync(envPath)) return
  const raw = fs.readFileSync(envPath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (!m) continue
    const [, k, vRaw] = m
    if (process.env[k] !== undefined) continue
    process.env[k] = vRaw.replace(/^['"]|['"]$/g, '')
  }
}
loadEnv()

const argv = process.argv.slice(2)
const BASE = (argv.find(a => a.startsWith('--base=')) || '--base=https://terminalxpos.com').slice(7).replace(/\/$/, '')
const JSON_MODE = argv.includes('--json')
const SOURCE = argv.includes('--cron') ? 'cron' : 'local'

const TTY = process.stdout.isTTY && !JSON_MODE
const C = {
  reset: TTY ? '\x1b[0m' : '', red: TTY ? '\x1b[31m' : '', green: TTY ? '\x1b[32m' : '',
  dim: TTY ? '\x1b[2m' : '', bold: TTY ? '\x1b[1m' : '',
}
const PASS = TTY ? '✓' : 'PASS'
const FAIL = TTY ? '✗' : 'FAIL'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[flow-drift] missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(2)
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

if (!JSON_MODE) {
  console.log(`${C.bold}flow-drift smoke${C.reset}  ${C.dim}target=${BASE}  source=${SOURCE}${C.reset}\n`)
}

const { results, duration_ms } = await runFlowDrift({ sb, base: BASE })

const passed = results.filter(r => r.ok).length
const failed = results.length - passed

if (JSON_MODE) {
  console.log(JSON.stringify({ passed, failed, total: results.length, duration_ms, source: SOURCE, results }, null, 2))
} else {
  for (const r of results) {
    const icon = r.ok ? `${C.green}${PASS}${C.reset}` : `${C.red}${FAIL}${C.reset}`
    console.log(`  ${icon} ${C.bold}${r.scenario}${C.reset}${r.detail ? `  ${C.dim}${r.detail}${C.reset}` : ''}`)
    if (!r.ok) {
      if (r.expected) console.log(`     ${C.dim}expected:${C.reset} ${String(r.expected).slice(0, 240)}`)
      if (r.observed) console.log(`     ${C.dim}observed:${C.reset} ${String(r.observed).slice(0, 240)}`)
    }
  }
  console.log(`\n${C.bold}${passed}/${results.length} passed${C.reset}  ${C.dim}${duration_ms}ms${C.reset}`)
}

process.exit(failed > 0 ? 1 : 0)
