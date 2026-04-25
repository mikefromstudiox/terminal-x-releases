#!/usr/bin/env node
/**
 * Terminal X · OG image rasterizer
 *
 * Reads web/public/og-image.svg → writes web/public/og-image.png at 1200×630.
 *
 * Strategy (in order of preference, all optional deps):
 *   1) @resvg/resvg-js        — pure-Rust, fastest, no system deps
 *   2) sharp                  — libvips, ubiquitous
 *   3) puppeteer / playwright — chromium screenshot, heaviest
 *
 * If none are installed, prints a clear instruction and exits 0 (non-fatal).
 * The SVG itself is always served as a working fallback (vercel.json rewrite
 * + og:image:type negotiation are NOT needed because Slack/Twitter/Facebook
 * accept SVG poorly — Mike should rasterize manually if no dep available).
 *
 * Manual rasterization fallback:
 *   - Open web/public/og-image.svg in any browser
 *   - Take a 1200x630 screenshot (Chrome DevTools → Capture screenshot)
 *   - Save as web/public/og-image.png
 *
 * Or one-shot:
 *   npm i -D @resvg/resvg-js
 *   node scripts/gen-og-image.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SVG_PATH = resolve(ROOT, 'web/public/og-image.svg')
const PNG_PATH = resolve(ROOT, 'web/public/og-image.png')

const svg = readFileSync(SVG_PATH, 'utf8')

async function tryResvg() {
  const { Resvg } = await import('@resvg/resvg-js')
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 }, background: '#b3001e' })
  return r.render().asPng()
}

async function trySharp() {
  const sharp = (await import('sharp')).default
  return sharp(Buffer.from(svg)).resize(1200, 630).png().toBuffer()
}

async function tryPuppeteer() {
  const puppeteer = (await import('puppeteer')).default
  const browser = await puppeteer.launch()
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 })
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#b3001e}svg{display:block}</style>${svg}`)
  const buf = await page.screenshot({ type: 'png', omitBackground: false })
  await browser.close()
  return buf
}

const strategies = [
  { name: '@resvg/resvg-js', fn: tryResvg },
  { name: 'sharp', fn: trySharp },
  { name: 'puppeteer', fn: tryPuppeteer },
]

let buf = null
let usedName = null
for (const { name, fn } of strategies) {
  try {
    buf = await fn()
    usedName = name
    break
  } catch (err) {
    if (!/Cannot find package|MODULE_NOT_FOUND/i.test(String(err?.message || err))) {
      console.warn(`[og] ${name} failed:`, err?.message || err)
    }
  }
}

if (!buf) {
  console.log('[og] No rasterizer installed. og-image.svg ships as-is.')
  console.log('[og] To produce og-image.png:  npm i -D @resvg/resvg-js && node scripts/gen-og-image.mjs')
  console.log('[og] Or rasterize manually: open og-image.svg in Chrome → DevTools → Capture screenshot.')
  process.exit(0)
}

writeFileSync(PNG_PATH, buf)
console.log(`[og] Wrote ${PNG_PATH} (${buf.length} bytes) via ${usedName}`)
