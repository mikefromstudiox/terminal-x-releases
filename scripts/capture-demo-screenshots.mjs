#!/usr/bin/env node
/**
 * capture-demo-screenshots.mjs
 *
 * Boots `npm run dev:web` in the background, opens each /demo/<vertical> URL
 * in headless Chromium, hides the demo banner, and screenshots into
 * web/public/{hero,screenshots}/ as WebP (with PNG fallback).
 *
 * Usage:  node scripts/capture-demo-screenshots.mjs
 *
 * Targets:
 *   - 3 hero shots: desktop POS, web invoice, mobile receipt-with-modal
 *   - 6 vertical tabs: carwash, tiendas, restaurantes, servicios, empresas, facturacion
 *   - 1 OG image (PNG, 1200×630, rendered from web/public/og-image.svg)
 */

import { spawn } from 'node:child_process'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import http from 'node:http'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DEV_URL = 'http://localhost:5173'
const HERO_DIR = join(ROOT, 'web', 'public', 'hero')
const SHOT_DIR = join(ROOT, 'web', 'public', 'screenshots')
const OG_PATH  = join(ROOT, 'web', 'public', 'og-image.png')

// ─── Capture matrix ─────────────────────────────────────────────────────────
const SHOTS = [
  { name: 'desktop-pos',     url: '/demo/carwash?lang=es',       width: 1600, height: 1000, dir: HERO_DIR, hero: true,
    waitFor: '.min-h-\\[calc\\(100vh-44px\\)\\], main, [role="main"]', extraWait: 1800 },
  { name: 'web-invoice',     url: '/demo/facturacion?lang=es',   width: 1600, height: 1000, dir: HERO_DIR, hero: true, extraWait: 1800 },
  { name: 'mobile-receipt',  url: '/demo/facturacion?lang=es',   width: 390,  height: 844,  dir: HERO_DIR, hero: true, openCobrar: true, extraWait: 1800 },

  { name: 'carwash',         url: '/demo/carwash?lang=es',       width: 1280, height: 720, dir: SHOT_DIR },
  { name: 'tiendas',         url: '/demo/licoreria?lang=es',     width: 1280, height: 720, dir: SHOT_DIR },
  { name: 'restaurantes',    url: '/demo/restaurante?lang=es',   width: 1280, height: 720, dir: SHOT_DIR },
  { name: 'servicios',       url: '/demo/concesionario?lang=es', width: 1280, height: 720, dir: SHOT_DIR },
  { name: 'empresas',        url: '/demo/nomina?lang=es',        width: 1280, height: 720, dir: SHOT_DIR },
  { name: 'facturacion',     url: '/demo/facturacion?lang=es',   width: 1280, height: 720, dir: SHOT_DIR },
]

// ─── Helpers ────────────────────────────────────────────────────────────────
function pingPort(url, timeoutMs = 60_000) {
  return new Promise((res, rej) => {
    const start = Date.now()
    const tick = () => {
      const req = http.get(url, r => { r.resume(); res(true) })
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) return rej(new Error(`Timeout waiting for ${url}`))
        setTimeout(tick, 500)
      })
      req.setTimeout(2000, () => req.destroy())
    }
    tick()
  })
}

function startDevServer() {
  console.log('▶ Starting Vite dev server (npm run dev:web)…')
  const child = spawn('npm', ['run', 'dev:web'], {
    cwd: ROOT,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none', FORCE_COLOR: '0' },
  })
  child.stdout.on('data', d => {
    const s = d.toString()
    if (s.includes('error') || s.includes('Error')) process.stderr.write(`[vite] ${s}`)
  })
  child.stderr.on('data', d => process.stderr.write(`[vite-err] ${d}`))
  return child
}

async function ensureDirs() {
  await mkdir(HERO_DIR, { recursive: true })
  await mkdir(SHOT_DIR, { recursive: true })
}

async function fileSize(p) {
  try { return (await stat(p)).size } catch { return 0 }
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  await ensureDirs()

  // Lazy import playwright
  let chromium
  try {
    ({ chromium } = await import('playwright'))
  } catch (e) {
    try {
      ({ chromium } = await import('@playwright/test'))
    } catch {
      console.error('✘ playwright not installed. Run: npm i -D playwright && npx playwright install chromium')
      process.exit(1)
    }
  }

  const dev = startDevServer()
  let cleanup = false
  const killDev = () => {
    if (cleanup) return
    cleanup = true
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(dev.pid), '/T', '/F'], { stdio: 'ignore', shell: true })
      } else {
        dev.kill('SIGTERM')
      }
    } catch {}
  }
  process.on('SIGINT', () => { killDev(); process.exit(130) })
  process.on('exit', killDev)

  try {
    await pingPort(DEV_URL, 60_000)
    console.log('✓ Dev server up')
  } catch (e) {
    killDev()
    console.error('✘ Dev server never came up:', e.message)
    process.exit(1)
  }

  await sleep(1500) // give Vite time to settle plugins

  console.log('▶ Launching headless Chromium…')
  let browser
  try {
    browser = await chromium.launch({ headless: true })
  } catch (e) {
    console.error('✘ Could not launch Chromium. Try: npx playwright install chromium')
    console.error(e.message)
    killDev()
    process.exit(1)
  }

  const results = []

  for (const shot of SHOTS) {
    const ext = 'webp'
    const outFile = join(shot.dir, `${shot.name}.${ext}`)
    const pngFallback = join(shot.dir, `${shot.name}.png`)
    process.stdout.write(`  · ${shot.name.padEnd(18)} ${shot.url.padEnd(34)} ${shot.width}×${shot.height} … `)

    const ctx = await browser.newContext({
      viewport: { width: shot.width, height: shot.height },
      deviceScaleFactor: 2,
    })
    const page = await ctx.newPage()
    let saved = ''
    let err = null

    try {
      await page.goto(`${DEV_URL}${shot.url}`, { waitUntil: 'networkidle', timeout: 30_000 })
      // Hide the sticky demo banner so the screenshot looks like the real product
      await page.addStyleTag({ content: '[data-demo-banner]{display:none!important;} html{scrollbar-width:none!important;} ::-webkit-scrollbar{display:none!important;}' })

      if (shot.openCobrar) {
        // Try to click any button containing "Cobrar"
        try {
          await page.locator('button:has-text("Cobrar")').first().click({ timeout: 5_000 })
          await sleep(700)
        } catch {}
      }

      await sleep(shot.extraWait || 1500)

      // Try webp first
      try {
        await page.screenshot({ path: outFile, type: 'webp', quality: 85, fullPage: false })
        saved = outFile
      } catch {
        await page.screenshot({ path: pngFallback, type: 'png', fullPage: false })
        saved = pngFallback
      }
    } catch (e) {
      err = e
    } finally {
      await ctx.close()
    }

    if (err) {
      console.log(`✘ ${err.message.split('\n')[0]}`)
      results.push({ shot, ok: false, error: err.message })
    } else {
      const sz = await fileSize(saved)
      console.log(`✓ ${(sz / 1024).toFixed(1)} KB`)
      results.push({ shot, ok: true, file: saved, size: sz })
    }
  }

  // ─── OG image: render the SVG directly to PNG 1200×630 ────────────────────
  process.stdout.write(`  · ${'og-image'.padEnd(18)} ${'(file://og-image.svg)'.padEnd(34)} 1200×630 … `)
  try {
    const svgPath = join(ROOT, 'web', 'public', 'og-image.svg')
    if (!existsSync(svgPath)) {
      console.log('✘ og-image.svg not found, skipping')
      results.push({ shot: { name: 'og-image' }, ok: false, error: 'og-image.svg missing' })
    } else {
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
      const page = await ctx.newPage()
      const fileUrl = 'file:///' + svgPath.replace(/\\/g, '/')
      await page.goto(fileUrl, { waitUntil: 'networkidle' })
      await sleep(500)
      await page.screenshot({ path: OG_PATH, type: 'png', fullPage: false, clip: { x: 0, y: 0, width: 1200, height: 630 } })
      await ctx.close()
      const sz = await fileSize(OG_PATH)
      console.log(`✓ ${(sz / 1024).toFixed(1)} KB`)
      results.push({ shot: { name: 'og-image' }, ok: true, file: OG_PATH, size: sz })
    }
  } catch (e) {
    console.log(`✘ ${e.message.split('\n')[0]}`)
    results.push({ shot: { name: 'og-image' }, ok: false, error: e.message })
  }

  await browser.close()
  killDev()

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('\n─── SUMMARY ─────────────────────────────────────────────────')
  console.log('NAME             │  SIZE (KB)  │  DIMENSIONS  │  PATH')
  console.log('─────────────────┼─────────────┼──────────────┼─────────────────────')
  for (const r of results) {
    const name = (r.shot.name || '?').padEnd(16)
    if (!r.ok) {
      console.log(`${name} │  FAILED      │  —            │  ${r.error}`)
      continue
    }
    const dims = r.shot.width ? `${r.shot.width}×${r.shot.height}` : '1200×630'
    const sz = (r.size / 1024).toFixed(1).padStart(8)
    console.log(`${name} │  ${sz} KB │  ${dims.padEnd(11)} │  ${r.file.replace(ROOT, '.')}`)
  }
  const failed = results.filter(r => !r.ok)
  if (failed.length) {
    console.log(`\n✘ ${failed.length} capture(s) failed`)
    process.exitCode = 1
  } else {
    console.log(`\n✓ All ${results.length} captures saved`)
  }
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
