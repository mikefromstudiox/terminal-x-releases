#!/usr/bin/env node
/**
 * Terminal X · OG image rasterizer
 *
 * Reads web/public/og-image.svg + og-square.svg → writes matching PNGs.
 *
 * Strategy (in order of preference, all optional deps):
 *   1) @resvg/resvg-js        — pure-Rust, fastest, no system deps
 *   2) sharp                  — libvips, ubiquitous
 *   3) puppeteer / playwright — chromium screenshot, heaviest
 *
 * If none are installed, prints a clear instruction and exits 0 (non-fatal).
 *
 * Manual rasterization fallback:
 *   - Open the .svg in any browser
 *   - Take a 1200xN screenshot (Chrome DevTools → Capture screenshot)
 *   - Save as the matching .png
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

const TARGETS = [
  { svg: 'web/public/og-image.svg',  png: 'web/public/og-image.png',  w: 1200, h: 630  },
  { svg: 'web/public/og-square.svg', png: 'web/public/og-square.png', w: 1200, h: 1200 },
]

async function tryResvg(svgText, w) {
  const { Resvg } = await import('@resvg/resvg-js')
  const r = new Resvg(svgText, { fitTo: { mode: 'width', value: w }, background: '#b3001e' })
  return r.render().asPng()
}

async function trySharp(svgText, w, h) {
  const sharp = (await import('sharp')).default
  return sharp(Buffer.from(svgText)).resize(w, h).png().toBuffer()
}

async function tryPuppeteer(svgText, w, h) {
  const puppeteer = (await import('puppeteer')).default
  const browser = await puppeteer.launch()
  const page = await browser.newPage()
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 })
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#b3001e}svg{display:block}</style>${svgText}`)
  const buf = await page.screenshot({ type: 'png', omitBackground: false })
  await browser.close()
  return buf
}

const strategies = [
  { name: '@resvg/resvg-js', fn: tryResvg },
  { name: 'sharp',           fn: trySharp },
  { name: 'puppeteer',       fn: tryPuppeteer },
]

let anyFailed = false
for (const t of TARGETS) {
  const svgPath = resolve(ROOT, t.svg)
  const pngPath = resolve(ROOT, t.png)
  const svgText = readFileSync(svgPath, 'utf8')

  let buf = null
  let usedName = null
  for (const { name, fn } of strategies) {
    try {
      buf = await fn(svgText, t.w, t.h)
      usedName = name
      break
    } catch (err) {
      if (!/Cannot find package|MODULE_NOT_FOUND/i.test(String(err?.message || err))) {
        console.warn(`[og] ${name} failed on ${t.svg}:`, err?.message || err)
      }
    }
  }

  if (!buf) {
    console.log(`[og] No rasterizer installed for ${t.svg}. SVG ships as-is.`)
    console.log('[og] To produce PNGs:  npm i -D @resvg/resvg-js && node scripts/gen-og-image.mjs')
    anyFailed = true
    continue
  }

  writeFileSync(pngPath, buf)
  console.log(`[og] Wrote ${pngPath} (${buf.length} bytes) via ${usedName}`)
}

if (anyFailed) process.exit(0)
