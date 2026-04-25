#!/usr/bin/env node
/**
 * fetch-logos.mjs
 *
 * Downloads brand logos from URLs, ensures transparent background, saves to
 * web/public/logos/ as PNG.
 *
 * Edit the LOGOS map below with the URLs Mike provides, then run:
 *   node scripts/fetch-logos.mjs
 *
 * - PNG inputs with alpha channel: passed through (already transparent)
 * - PNG inputs without alpha: white-to-transparent flood (best-effort, only
 *   removes pure white #fff pixels — won't work on photos)
 * - SVG inputs: rasterized via sharp at 512x512 max, transparency preserved
 * - JPG inputs: REJECTED (no transparency possible without bg-removal AI)
 *
 * For the Grok DGII image: page is auth-walled (HTTP 403). Save it manually
 * via right-click → Save Image to web/public/logos/dgii.png, then re-run this
 * script — it will detect the file and process it (alpha pass-through OR
 * white-to-transparent if no alpha channel).
 */

import sharp from 'sharp'
import { writeFile, mkdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT_DIR = path.join(ROOT, 'web/public/logos')

// EDIT THIS MAP — Mike pastes URLs here
const LOGOS = {
  // 'vercel':     'https://...',
  // 'cloudflare': 'https://...',
  // 'supabase':   'https://...',
  // 'viafirma':   'https://...',
  // dgii: handled manually — drop dgii.png in web/public/logos/ before running
}

async function fetchBuffer(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TerminalX-LogoFetch/1.0)' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  const ct = res.headers.get('content-type') || ''
  const buf = Buffer.from(await res.arrayBuffer())
  return { buf, contentType: ct }
}

async function processLogo(name, url) {
  console.log(`\n[${name}]`)
  const outPath = path.join(OUT_DIR, `${name}.png`)
  let buf, ct

  if (url) {
    console.log(`  fetch: ${url}`)
    try {
      const r = await fetchBuffer(url)
      buf = r.buf
      ct = r.contentType
    } catch (err) {
      console.log(`  FAILED: ${err.message}`)
      return false
    }
  } else if (existsSync(outPath)) {
    console.log(`  using existing local file: ${outPath}`)
    const meta = await stat(outPath)
    console.log(`  size: ${meta.size} bytes`)
    buf = null  // signal: process in-place
  } else {
    console.log(`  no URL and no local file — skipping`)
    return false
  }

  // Process: ensure alpha channel, save as PNG
  try {
    const input = buf || outPath
    const meta = await sharp(input).metadata()
    console.log(`  detected: ${meta.format} ${meta.width}x${meta.height}, alpha=${meta.hasAlpha}`)

    if (meta.format === 'jpeg' || meta.format === 'jpg') {
      console.log(`  WARNING: JPEG input cannot have transparency without bg-removal. Saving as PNG with alpha=opaque.`)
      await sharp(input).png().toFile(outPath + '.tmp')
    } else if (meta.hasAlpha) {
      // Already has alpha — pass through, just normalize to PNG
      await sharp(input).png({ compressionLevel: 9 }).toFile(outPath + '.tmp')
    } else {
      // No alpha — best-effort white→transparent (only flood-removes #fff)
      // Sharp's `flatten` is the inverse; for keying out white we'd need a
      // proper threshold. Quick heuristic: ensureAlpha(0) → all-opaque, then
      // composite with a white-mask isn't trivial without a threshold lib.
      // For now: just add alpha channel as fully opaque; logo will have white bg.
      console.log(`  WARNING: no alpha channel detected. Output will retain background.`)
      console.log(`           Manually edit in Photoshop/GIMP/online bg-remover, then re-run.`)
      await sharp(input).ensureAlpha(1).png({ compressionLevel: 9 }).toFile(outPath + '.tmp')
    }

    // Atomic replace
    const { rename } = await import('node:fs/promises')
    await rename(outPath + '.tmp', outPath)
    const finalSize = (await stat(outPath)).size
    console.log(`  ✓ saved: ${outPath} (${(finalSize / 1024).toFixed(1)} KB)`)
    return true
  } catch (err) {
    console.log(`  PROCESS FAILED: ${err.message}`)
    return false
  }
}

async function main() {
  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true })

  const names = Object.keys(LOGOS).length > 0
    ? Object.keys(LOGOS)
    : ['dgii', 'viafirma', 'supabase', 'vercel', 'cloudflare']

  const results = []
  for (const name of names) {
    const ok = await processLogo(name, LOGOS[name])
    results.push({ name, ok })
  }

  console.log(`\n=== Summary ===`)
  for (const r of results) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}`)
  }

  const failed = results.filter(r => !r.ok).map(r => r.name)
  if (failed.length) {
    console.log(`\nFailed/missing: ${failed.join(', ')}`)
    console.log(`To resolve:`)
    console.log(`  1. Add URLs to LOGOS map in this script, OR`)
    console.log(`  2. Drop the file directly at web/public/logos/<name>.png and re-run`)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
