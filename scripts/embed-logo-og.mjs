#!/usr/bin/env node
// One-shot: embed packages/ui/assets/logo.png as base64 into web/public/og-image.svg
// Replaces the text-rendered "TERMINAL X" wordmark with the real brand logo PNG
// so the OG image (and Google Ads suggested images) shows the actual brand mark.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LOGO_PATH = resolve(ROOT, 'packages/ui/assets/logo.png')
const SVG_PATH = resolve(ROOT, 'web/public/og-image.svg')

const b64 = readFileSync(LOGO_PATH).toString('base64')
const dataUrl = `data:image/png;base64,${b64}`

const svg = readFileSync(SVG_PATH, 'utf8')

const oldGroup = `  <!-- Top-left wordmark + X-logo -->
  <g transform="translate(60,70)">
    <rect x="0" y="0" width="64" height="64" rx="12" fill="#ffffff"/>
    <text x="32" y="50" text-anchor="middle" font-family="Inter, Arial Black, sans-serif" font-weight="900" font-size="44" fill="#b3001e">X</text>
    <text x="84" y="48" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="800" font-size="34" fill="#ffffff" letter-spacing="3">TERMINAL X</text>
  </g>`

const newGroup = `  <!-- Top-left brand wordmark (embedded PNG, real brand X logo) -->
  <image x="60" y="60" width="420" height="199" href="${dataUrl}"/>`

if (!svg.includes(oldGroup)) {
  console.error('[embed-logo-og] could not find old wordmark group in SVG — already replaced?')
  process.exit(1)
}

writeFileSync(SVG_PATH, svg.replace(oldGroup, newGroup), 'utf8')
console.log('[embed-logo-og] OK — embedded', b64.length, 'bytes of base64 into og-image.svg')
