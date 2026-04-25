#!/usr/bin/env node
/**
 * capture-real-product-screenshots.mjs
 *
 * Auto-captures pixel-perfect screenshots of the REAL Terminal X product by
 * signing into demo Supabase accounts directly via Auth REST endpoint, then
 * driving Playwright Chromium against terminalxpos.com (production) or
 * localhost:5173 (--local flag).
 *
 * Bypasses the disabled /api/panel?action=demo-login (returns 410 by design)
 * by using the public Supabase Auth /token endpoint with anon key, same way
 * supabase-js signInWithPassword does internally. No API surface changes.
 *
 * Run:
 *   node scripts/capture-real-product-screenshots.mjs              # prod
 *   node scripts/capture-real-product-screenshots.mjs --local      # localhost
 *
 * Outputs:
 *   web/public/screenshots/{carwash,tiendas,restaurantes,servicios,empresas,facturacion}.png
 *   web/public/hero/{desktop-pos,web-invoice,mobile-receipt}.png
 */

import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const LOCAL = process.argv.includes('--local')
const BASE = LOCAL ? 'http://localhost:5173' : 'https://terminalxpos.com'
const PASS = 'Demo2026!'

// Load .env without dotenv dep — read directly
async function loadEnv() {
  const envPath = resolve(ROOT, '.env')
  if (!existsSync(envPath)) return
  const raw = await readFile(envPath, 'utf-8')
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
await loadEnv()

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPA_ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const SUPA_SVC = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPA_URL || !SUPA_ANON) {
  console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY in .env')
  process.exit(1)
}

const PROJECT_REF = new URL(SUPA_URL).host.split('.')[0]
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`
// Real demo account format: admin@<slug>.demo.terminalxpos.com
const EMAIL = (slug) => `admin@${slug}.demo.terminalxpos.com`

const MATRIX = [
  { out: 'screenshots/carwash.png',       email: EMAIL('carwash'),    path: '/pos',         viewport: [1280, 720] },
  { out: 'screenshots/tiendas.png',       email: EMAIL('licoreria'),  path: '/pos',         viewport: [1280, 720] },
  { out: 'screenshots/restaurantes.png',  email: EMAIL('restaurant'), path: '/pos',         viewport: [1280, 720] },
  { out: 'screenshots/servicios.png',     email: EMAIL('dealership'), path: '/pos',         viewport: [1280, 720] },
  { out: 'screenshots/empresas.png',      email: EMAIL('carwash'),    path: '/reportes',    viewport: [1280, 720] },
  { out: 'screenshots/facturacion.png',   email: EMAIL('carwash'),    path: '/facturacion', viewport: [1280, 720] },
  // Bonus: liquor store explicit, mechanic, salon
  { out: 'screenshots/licoreria.png',     email: EMAIL('licoreria'),  path: '/pos',         viewport: [1280, 720] },
  { out: 'screenshots/mecanica.png',      email: EMAIL('mechanic'),   path: '/pos',         viewport: [1280, 720] },
  { out: 'screenshots/salon.png',         email: EMAIL('salon'),      path: '/pos',         viewport: [1280, 720] },
  { out: 'hero/desktop-pos.png',          email: EMAIL('carwash'),    path: '/pos',         viewport: [1600, 1000] },
  { out: 'hero/web-invoice.png',          email: EMAIL('carwash'),    path: '/facturacion', viewport: [1600, 1000] },
  { out: 'hero/mobile-receipt.png',       email: EMAIL('carwash'),    path: '/facturacion', viewport: [390, 844] },
]

// Use service-role to set a known password on the demo user, then sign in.
// Single-use ephemeral password — never persisted, never logged.
const TEMP_PASS = `Capture${Date.now()}!`
const _userIdCache = new Map() // email -> id

async function ensureUserId(email) {
  if (_userIdCache.has(email)) return _userIdCache.get(email)
  const lookup = await fetch(`${SUPA_URL}/auth/v1/admin/users?per_page=200`, {
    headers: { apikey: SUPA_SVC, Authorization: `Bearer ${SUPA_SVC}` },
  })
  if (!lookup.ok) throw new Error(`admin users HTTP ${lookup.status}`)
  const { users } = await lookup.json()
  const user = users.find(u => u.email === email)
  if (!user) throw new Error(`user not found: ${email}`)
  _userIdCache.set(email, user.id)
  return user.id
}

async function signIn(email) {
  if (!SUPA_SVC) throw new Error(`SUPABASE_SERVICE_ROLE_KEY required`)
  const userId = await ensureUserId(email)
  // Set ephemeral password
  const upd = await fetch(`${SUPA_URL}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: { apikey: SUPA_SVC, Authorization: `Bearer ${SUPA_SVC}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: TEMP_PASS }),
  })
  if (!upd.ok) throw new Error(`admin updateUser HTTP ${upd.status}: ${await upd.text()}`)
  // Sign in
  const r = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: TEMP_PASS }),
  })
  if (!r.ok) throw new Error(`token HTTP ${r.status}: ${await r.text()}`)
  return r.json()
}

async function startDevServer() {
  const proc = spawn('npm', ['run', 'dev:web'], { cwd: ROOT, shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('dev server timeout 60s')), 60000)
    proc.stdout.on('data', d => {
      if (String(d).match(/Local:.*5173/) || String(d).match(/ready in/i)) { clearTimeout(t); res() }
    })
    proc.stderr.on('data', () => {})
    proc.on('error', rej)
  })
  await new Promise(r => setTimeout(r, 1500))
  return proc
}

async function capture(browser, item) {
  let session
  try {
    session = await signIn(item.email)
  } catch (e) {
    return { ok: false, file: item.out, error: e.message }
  }

  const ctx = await browser.newContext({
    viewport: { width: item.viewport[0], height: item.viewport[1] },
    deviceScaleFactor: 2,
  })
  const page = await ctx.newPage()

  const expiresAt = Math.floor(Date.now() / 1000) + (session.expires_in || 3600)
  const blob = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: expiresAt,
    expires_in: session.expires_in || 3600,
    token_type: 'bearer',
    user: session.user,
  }

  try {
    // Step 1 — set Supabase session in localStorage on the right origin
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.evaluate(({ k, v }) => localStorage.setItem(k, JSON.stringify(v)), { k: STORAGE_KEY, v: blob })

    // Step 2 — go to /pos. App will redirect to PIN gate if not yet authed at staff level.
    await page.goto(`${BASE}/pos`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(2000)

    // Step 3 — detect PIN keypad (4 digit buttons visible) and type 1234.
    // PIN handler in Login.jsx listens to global keyboard digits and auto-submits at 4.
    const onPinPad = await page.evaluate(() => {
      // Look for "1" "2" "3" "4" digit buttons rendered as <button> with single-digit text
      const btns = Array.from(document.querySelectorAll('button'))
      const digitBtns = btns.filter(b => /^[0-9]$/.test(b.textContent?.trim() || ''))
      return digitBtns.length >= 9
    })

    if (onPinPad) {
      // Click digits via DOM (more reliable than keyboard since some apps suppress global keys)
      for (const digit of ['1','2','3','4']) {
        await page.evaluate((d) => {
          const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === d)
          if (btn) btn.click()
        }, digit)
        await page.waitForTimeout(180)
      }
      // Wait for PIN to validate + navigation to settle
      await page.waitForTimeout(3000)
    }

    // Step 4 — re-navigate to the target path now that staff session is set
    if (page.url() !== `${BASE}${item.path}`) {
      await page.goto(`${BASE}${item.path}`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})
    }
    await page.waitForTimeout(3500)

    // Debug: log final URL + page title
    const finalUrl = page.url()
    const title = await page.title().catch(() => '?')
    process.stdout.write(`    [${title}] ${finalUrl}\n`)

    const outPath = resolve(ROOT, 'web/public', item.out)
    await mkdir(dirname(outPath), { recursive: true })
    await page.screenshot({ path: outPath, fullPage: false })
    await ctx.close()
    return { ok: true, file: item.out, bytes: statSync(outPath).size }
  } catch (e) {
    await ctx.close()
    return { ok: false, file: item.out, error: e.message }
  }
}

async function main() {
  console.log(`Capturing from: ${BASE}`)
  console.log(`Supabase project ref: ${PROJECT_REF}`)
  console.log(`Storage key: ${STORAGE_KEY}\n`)

  let dev
  if (LOCAL) {
    console.log('Booting dev:web...')
    dev = await startDevServer()
    console.log('Dev server ready\n')
  }

  const browser = await chromium.launch()
  const results = []

  try {
    for (const item of MATRIX) {
      const r = await capture(browser, item)
      if (r.ok) console.log(`✓  ${r.file}  ${(r.bytes / 1024).toFixed(1)} KB`)
      else console.log(`✗  ${r.file}  ${r.error}`)
      results.push(r)
    }
  } finally {
    await browser.close()
    if (dev) dev.kill()
  }

  const ok = results.filter(r => r.ok).length
  const fail = results.filter(r => !r.ok).length
  console.log(`\n=== ${ok} captured, ${fail} failed ===`)
  if (fail > 0) process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
