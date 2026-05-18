#!/usr/bin/env node
// Embed packages/ui/assets/logo.png as base64 into the SVG OG variants.
// Replaces the text-rendered "TERMINAL X" wordmark with the real brand logo
// so the OG image (and Google Ads suggested images) shows the actual brand
// mark. Idempotent — re-runs cleanly because it looks for stable anchors.
//
// Targets:
//   web/public/og-image.svg   (1200x630 horizontal)
//   web/public/og-square.svg  (1200x1200 square)
//
// After running, rasterize via: node scripts/gen-og-image.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LOGO_PATH = resolve(ROOT, 'packages/ui/assets/logo.png')
const b64 = readFileSync(LOGO_PATH).toString('base64')
const dataUrl = `data:image/png;base64,${b64}`

const tasks = [
  {
    file: 'web/public/og-image.svg',
    placeholder: /<!-- Top-left wordmark \+ X-logo -->[\s\S]*?<\/g>/,
    fallback: /<!-- Top-left brand wordmark[\s\S]*?\/>/,
    replacement: `<!-- Top-left brand wordmark (embedded PNG, real brand X logo) -->
  <image x="60" y="60" width="420" height="199" href="${dataUrl}"/>`,
  },
  {
    file: 'web/public/og-square.svg',
    placeholder: /<!-- LOGO_PLACEHOLDER -->/,
    fallback: /<!-- Top brand wordmark embedded[\s\S]*?\/>/,
    replacement: `<!-- Top brand wordmark embedded (real brand X PNG) -->
  <image x="80" y="100" width="560" height="265" href="${dataUrl}"/>`,
  },
]

for (const t of tasks) {
  const p = resolve(ROOT, t.file)
  let svg = readFileSync(p, 'utf8')
  if (t.placeholder.test(svg)) {
    svg = svg.replace(t.placeholder, t.replacement)
  } else if (t.fallback.test(svg)) {
    svg = svg.replace(t.fallback, t.replacement)
  } else {
    console.error(`[embed-logo-og] no anchor found in ${t.file} — skipping`)
    continue
  }
  writeFileSync(p, svg, 'utf8')
  console.log(`[embed-logo-og] OK ${t.file}`)
}

console.log(`[embed-logo-og] base64 bytes embedded: ${b64.length}`)
