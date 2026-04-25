#!/usr/bin/env node
/**
 * build-social-assets.mjs
 *
 * Resizes captured demo screenshots into social-media-ready formats:
 *  - Instagram feed: 1080x1080 (square, content centered with crimson bars)
 *  - Instagram stories / reels: 1080x1920 (portrait, branded top + bottom bars)
 *  - Landscape: 1920x1080 (full-bleed for Twitter / LinkedIn / Facebook posts)
 *  - OG: 1200x630 (kept as-is — already that size)
 *
 * Sources (read):
 *   web/public/screenshots/*.png
 *   web/public/hero/*.png
 *
 * Outputs (write):
 *   social-posts/instagram/feed/*.jpg          — 1080x1080
 *   social-posts/instagram/stories/*.jpg       — 1080x1920
 *   social-posts/landscape/*.jpg               — 1920x1080
 *   social-posts/og/*.jpg                      — 1200x630 (mirror of og-image.png)
 *
 * Run: node scripts/build-social-assets.mjs
 *
 * Each output keeps brand crimson (#b3001e) bars on top + bottom of stories
 * format with "TERMINAL X" wordmark, "DGII Cert #42483" credential, and the
 * 20-day countdown to Ley 32-23 (May 15 2026).
 */

import sharp from 'sharp'
import { readdir, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SCREENSHOTS_DIR = path.join(ROOT, 'web/public/screenshots')
const HERO_DIR = path.join(ROOT, 'web/public/hero')
const OG_DIR = path.join(ROOT, 'web/public')
const OUT_FEED = path.join(ROOT, 'social-posts/instagram/feed')
const OUT_STORIES = path.join(ROOT, 'social-posts/instagram/stories')
const OUT_LANDSCAPE = path.join(ROOT, 'social-posts/landscape')
const OUT_OG = path.join(ROOT, 'social-posts/og')

const CRIMSON = { r: 179, g: 0, b: 30 }
const BLACK = { r: 0, g: 0, b: 0 }

async function ensureDirs() {
  for (const d of [OUT_FEED, OUT_STORIES, OUT_LANDSCAPE, OUT_OG]) {
    if (!existsSync(d)) await mkdir(d, { recursive: true })
  }
}

function daysUntilDeadline() {
  const target = new Date('2026-05-15T00:00:00-04:00').getTime()
  const now = Date.now()
  return Math.max(0, Math.ceil((target - now) / 86400000))
}

const days = daysUntilDeadline()

function brandedSvg(width, height, mode) {
  // mode: 'top' | 'bottom' | 'feed-overlay' | 'stories-top' | 'stories-bottom'
  const bgColor = '#b3001e'
  if (mode === 'stories-top') {
    return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="${bgColor}"/>
      <text x="60" y="${height / 2 + 18}" font-family="system-ui, -apple-system, sans-serif" font-size="56" font-weight="900" fill="#fff" letter-spacing="-1">TERMINAL X</text>
      <text x="${width - 60}" y="${height / 2 + 12}" font-family="system-ui" font-size="28" font-weight="600" fill="#fff" text-anchor="end" opacity="0.9">DGII Cert #42483</text>
    </svg>`)
  }
  if (mode === 'stories-bottom') {
    return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="#000"/>
      <text x="${width / 2}" y="${height / 2 - 30}" font-family="system-ui" font-size="44" font-weight="900" fill="#fff" text-anchor="middle">${days} DÍAS RESTANTES</text>
      <text x="${width / 2}" y="${height / 2 + 30}" font-family="system-ui" font-size="28" font-weight="600" fill="${bgColor}" text-anchor="middle">para Ley 32-23 · 15 mayo 2026</text>
      <text x="${width / 2}" y="${height / 2 + 90}" font-family="system-ui" font-size="24" font-weight="500" fill="#fff" text-anchor="middle" opacity="0.8">terminalxpos.com · Desde RD$995/mes</text>
    </svg>`)
  }
  if (mode === 'feed-overlay') {
    // Subtle crimson 100px tall band at bottom of square with brand
    return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="${bgColor}"/>
      <text x="60" y="${height / 2 + 12}" font-family="system-ui" font-size="36" font-weight="900" fill="#fff" letter-spacing="-1">TERMINAL X</text>
      <text x="${width - 60}" y="${height / 2 + 8}" font-family="system-ui" font-size="22" font-weight="600" fill="#fff" text-anchor="end" opacity="0.95">${days} días para Ley 32-23 →</text>
    </svg>`)
  }
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="${width}" height="${height}" fill="#000"/></svg>`)
}

async function processOne(srcPath, baseName) {
  console.log(`Processing: ${baseName}`)
  const meta = await sharp(srcPath).metadata()
  const w = meta.width
  const h = meta.height

  // 1) LANDSCAPE 1920x1080 — fit, pad with black
  await sharp(srcPath)
    .resize({ width: 1920, height: 1080, fit: 'contain', background: { r: 0, g: 0, b: 0 } })
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(path.join(OUT_LANDSCAPE, `${baseName}.jpg`))

  // 2) FEED 1080x1080 — square: black canvas, screenshot fitted in top 980px,
  //    crimson 100px band at bottom with brand + countdown
  const feedTop = await sharp(srcPath)
    .resize({ width: 1080, height: 980, fit: 'contain', background: BLACK })
    .toBuffer()
  const feedBand = await sharp(brandedSvg(1080, 100, 'feed-overlay')).png().toBuffer()
  await sharp({ create: { width: 1080, height: 1080, channels: 3, background: BLACK } })
    .composite([
      { input: feedTop, top: 0, left: 0 },
      { input: feedBand, top: 980, left: 0 },
    ])
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(path.join(OUT_FEED, `${baseName}.jpg`))

  // 3) STORIES 1080x1920 — top crimson 200px brand band, screenshot fitted
  //    in middle 1500px area, bottom black 220px with countdown CTA
  const storiesMid = await sharp(srcPath)
    .resize({ width: 1080, height: 1500, fit: 'contain', background: BLACK })
    .toBuffer()
  const topBand = await sharp(brandedSvg(1080, 200, 'stories-top')).png().toBuffer()
  const bottomBand = await sharp(brandedSvg(1080, 220, 'stories-bottom')).png().toBuffer()
  await sharp({ create: { width: 1080, height: 1920, channels: 3, background: BLACK } })
    .composite([
      { input: topBand, top: 0, left: 0 },
      { input: storiesMid, top: 200, left: 0 },
      { input: bottomBand, top: 1700, left: 0 },
    ])
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(path.join(OUT_STORIES, `${baseName}.jpg`))
}

async function main() {
  await ensureDirs()

  // Collect sources from screenshots/ and hero/
  const sources = []
  if (existsSync(SCREENSHOTS_DIR)) {
    const files = await readdir(SCREENSHOTS_DIR)
    for (const f of files) {
      if (/\.(png|jpe?g|webp)$/i.test(f)) {
        sources.push({ src: path.join(SCREENSHOTS_DIR, f), base: 'vertical-' + path.parse(f).name })
      }
    }
  }
  if (existsSync(HERO_DIR)) {
    const files = await readdir(HERO_DIR)
    for (const f of files) {
      if (/\.(png|jpe?g|webp)$/i.test(f)) {
        sources.push({ src: path.join(HERO_DIR, f), base: 'hero-' + path.parse(f).name })
      }
    }
  }

  if (sources.length === 0) {
    console.error('No source screenshots found. Run scripts/capture-demo-screenshots.mjs first.')
    process.exit(1)
  }

  for (const { src, base } of sources) {
    try {
      await processOne(src, base)
    } catch (err) {
      console.error(`Failed: ${base}`, err.message)
    }
  }

  // OG mirror
  const ogSrc = path.join(OG_DIR, 'og-image.png')
  if (existsSync(ogSrc)) {
    await sharp(ogSrc)
      .jpeg({ quality: 92, mozjpeg: true })
      .toFile(path.join(OUT_OG, 'og-image.jpg'))
    console.log('Mirrored: og-image.jpg')
  }

  // Summary
  console.log(`\nDone. Outputs in:`)
  console.log(`  ${OUT_LANDSCAPE} (1920x1080)`)
  console.log(`  ${OUT_FEED} (1080x1080 — IG feed)`)
  console.log(`  ${OUT_STORIES} (1080x1920 — IG stories/reels)`)
  console.log(`  ${OUT_OG} (1200x630)`)
  console.log(`\nDeadline countdown baked into stories: ${days} days remaining`)
}

main().catch(err => { console.error(err); process.exit(1) })
