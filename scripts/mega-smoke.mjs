#!/usr/bin/env node
// scripts/mega-smoke.mjs — Layer 6 CLI runner.
//
// Thin wrapper around lib/mega-smoke-runner.js so the local harness and
// the cron handler in /api/panel?action=cron_mega_smoke run identical code.
//
// USAGE:
//   NODE_OPTIONS=--use-system-ca node scripts/mega-smoke.mjs
//   NODE_OPTIONS=--use-system-ca node scripts/mega-smoke.mjs --base=https://terminalxpos.com
//   NODE_OPTIONS=--use-system-ca node scripts/mega-smoke.mjs --json
//   NODE_OPTIONS=--use-system-ca node scripts/mega-smoke.mjs --category=infra
//
// EXITS:
//   0 — all scenarios pass (skipped counts as pass)
//   1 — one or more scenarios failed
//   2 — script could not run (network, env)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { runMegaSmoke } from '../lib/mega-smoke-runner.js'

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
const FILTER = (argv.find(a => a.startsWith('--category=')) || '').slice(11) || null
const SOURCE = argv.includes('--cron') ? 'cron' : 'local'

const TTY = process.stdout.isTTY && !JSON_MODE
const C = {
  reset: TTY ? '\x1b[0m' : '', red: TTY ? '\x1b[31m' : '', green: TTY ? '\x1b[32m' : '',
  yellow: TTY ? '\x1b[33m' : '', dim: TTY ? '\x1b[2m' : '', bold: TTY ? '\x1b[1m' : '',
  cyan: TTY ? '\x1b[36m' : '',
}
const PASS = TTY ? '✓' : 'PASS'
const FAIL = TTY ? '✗' : 'FAIL'
const SKIP = TTY ? '○' : 'SKIP'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[mega-smoke] missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(2)
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

if (!JSON_MODE) {
  console.log(`${C.bold}MEGA SMOKE${C.reset}  ${C.dim}Layer 6 — target=${BASE}  source=${SOURCE}${FILTER ? `  filter=${FILTER}` : ''}${C.reset}\n`)
}

const { results, total, passed, failed, skipped, duration_ms, demo_registry } = await runMegaSmoke({
  sb,
  base: BASE,
  pgToken: process.env.SUPABASE_ACCESS_TOKEN || null,
  vercelToken: process.env.VERCEL_TOKEN || null,
})

const filtered = FILTER ? results.filter(r => r.category === FILTER) : results

if (JSON_MODE) {
  console.log(JSON.stringify({ source: SOURCE, base: BASE, duration_ms, total, passed, failed, skipped, results: filtered, demo_registry }, null, 2))
} else {
  let curCat = null
  for (const r of filtered) {
    if (r.category !== curCat) {
      curCat = r.category
      console.log(`\n${C.cyan}${C.bold}── ${curCat} ──${C.reset}`)
    }
    const icon = r.skip ? `${C.yellow}${SKIP}${C.reset}`
                : r.ok ? `${C.green}${PASS}${C.reset}`
                       : `${C.red}${FAIL}${C.reset}`
    console.log(`  ${icon} ${C.bold}${r.id}${C.reset} ${C.dim}${r.name}${C.reset}${r.detail ? `  ${C.dim}${r.detail}${C.reset}` : ''}`)
    if (!r.ok && !r.skip) {
      if (r.expected) console.log(`     ${C.dim}expected:${C.reset} ${String(r.expected).slice(0, 240)}`)
      if (r.observed) console.log(`     ${C.dim}observed:${C.reset} ${String(r.observed).slice(0, 240)}`)
    }
  }
  console.log('')
  const totalColor = failed === 0 ? C.green : C.red
  console.log(`${C.bold}TOTAL: ${totalColor}${passed}/${total} pass${C.reset}${C.dim} (${skipped} skipped, ${failed} failed) — ${duration_ms}ms${C.reset}`)
  console.log(`${C.dim}Demo registry: ${demo_registry.length} businesses (${demo_registry.map(b => b.business_type).join(', ')})${C.reset}`)
}

process.exit(failed > 0 ? 1 : 0)
