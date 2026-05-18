#!/usr/bin/env node
/**
 * IG Carousel Renderer — portable beast.
 * Renders a daily Instagram carousel from a structured day brief.
 * Receipt-style template: white thermal paper on black canvas, perforated edges,
 * real Terminal X brand wordmark + business info header, hero TOTAL number.
 *
 * Usage:
 *   node scripts/ig-carousel.mjs                 → render next day (auto-pick by counter)
 *   node scripts/ig-carousel.mjs --day 3         → render specific day number
 *   node scripts/ig-carousel.mjs --no-bump       → render but DON'T increment counter
 *   node scripts/ig-carousel.mjs --preview       → render only slide 1
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, copyFileSync } from 'node:fs'
import { resolve, dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
function flag(name)  { return args.includes(`--${name}`) }
function valueOf(name) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : null
}

const CONFIG_PATH = resolve(ROOT, valueOf('config') || 'promo/ig-series/config.json')
if (!existsSync(CONFIG_PATH)) { console.error('[ig-carousel] config not found:', CONFIG_PATH); process.exit(1) }
const CFG = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))

const COUNTER_PATH = resolve(ROOT, CFG.counterFile)
const DAYS_DIR     = resolve(ROOT, CFG.daysDir)
const OUTPUT_DIR   = resolve(ROOT, CFG.outputDir)
const FONTS_DIR    = resolve(ROOT, CFG.fontsDir)

const dayArg     = valueOf('day')
const noBump     = flag('no-bump')
const previewOnly = flag('preview')

function readCounter() {
  if (!existsSync(COUNTER_PATH)) { writeFileSync(COUNTER_PATH, '1\n', 'utf8'); return 1 }
  const n = parseInt(readFileSync(COUNTER_PATH, 'utf8').trim(), 10)
  return Number.isFinite(n) && n >= 1 ? n : 1
}
function writeCounter(n) { writeFileSync(COUNTER_PATH, `${n}\n`, 'utf8') }

const currentCounter = readCounter()
const targetDay = dayArg ? parseInt(dayArg, 10) : currentCounter
if (!Number.isFinite(targetDay) || targetDay < 1) { console.error('[ig-carousel] invalid day:', dayArg); process.exit(1) }

const padded = String(targetDay).padStart(3, '0')
const dayFiles = readdirSync(DAYS_DIR).filter(f => f.startsWith(`${padded}-`) && f.endsWith('.json'))
if (dayFiles.length === 0) { console.error(`[ig-carousel] no day brief found at ${DAYS_DIR}/${padded}-*.json`); process.exit(1) }
if (dayFiles.length > 1) { console.error(`[ig-carousel] multiple briefs for day ${padded}:`, dayFiles); process.exit(1) }
const dayPath = join(DAYS_DIR, dayFiles[0])
const day = JSON.parse(readFileSync(dayPath, 'utf8'))
console.log(`[ig-carousel] day ${padded} · ${day.slug} · ${day.pillar}`)

const FONTS = {}
const FONT_FILES = []
for (const [role, def] of Object.entries(CFG.fonts)) {
  const fontPath = join(FONTS_DIR, def.file)
  if (!existsSync(fontPath)) { console.error(`[ig-carousel] missing font: ${fontPath}`); process.exit(1) }
  FONTS[role] = { ...def, path: fontPath }
  FONT_FILES.push(fontPath)
}

const BRAND_LOGO_PATH = resolve(ROOT, 'packages/ui/assets/logo.png')
const BRAND_LOGO_DATAURL = existsSync(BRAND_LOGO_PATH)
  ? `data:image/png;base64,${readFileSync(BRAND_LOGO_PATH).toString('base64')}`
  : null
const BRAND_LOGO_RATIO = 2831 / 1343

const W = CFG.canvas.width
const H = CFG.canvas.height
const SAFE = CFG.safeArea
const C = CFG.colors

function escapeXml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')
}
function colorOf(name) { if (!name) return C.black; if (name.startsWith('#')) return name; return C[name] || C.black }
function wrapText(text, maxCharsPerLine) {
  const words = String(text).split(/\s+/); const lines = []; let cur = ''
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxCharsPerLine) { if (cur) lines.push(cur); cur = w }
    else cur = (cur + ' ' + w).trim()
  }
  if (cur) lines.push(cur)
  return lines
}
function tspans(lines, x, baseY, lineHeight) {
  return lines.map((l, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : lineHeight}">${escapeXml(l)}</tspan>`).join('')
}

function brandLogo(x, y, width, opacity = 1) {
  if (!BRAND_LOGO_DATAURL) return ''
  const height = width / BRAND_LOGO_RATIO
  return `<image x="${x}" y="${y}" width="${width}" height="${height}" href="${BRAND_LOGO_DATAURL}" opacity="${opacity}" preserveAspectRatio="xMidYMid meet"/>`
}

function signatureSvg(counter, bg) {
  const fg = (bg === 'black' || bg === 'crimson') ? C.white : C.black
  const accent = bg === 'crimson' ? C.white : C.crimson
  const text = CFG.signature.text.replace('{counter}', String(counter).padStart(3, '0'))
  const [series, num] = text.split(' · ')
  const sz = CFG.signature.size
  const fam = FONTS[CFG.signature.font].family
  return `
    <text x="${SAFE}" y="${SAFE + sz}" font-family="${fam}" font-size="${sz}" letter-spacing="2">
      <tspan fill="${accent}">${escapeXml(series)}</tspan>
      <tspan fill="${fg}"> · ${escapeXml(num)}</tspan>
    </text>`
}

function slideIndicatorSvg(i, total, bg, skip) {
  if (skip) return ''
  const onDark = bg === 'black' || bg === 'crimson'
  const fg = onDark ? C.white : C.black
  const accent = bg === 'crimson' ? C.white : C.crimson
  const idx = String(i).padStart(2, '0'); const tot = String(total).padStart(2, '0')
  const sz = CFG.signature.size; const fam = FONTS[CFG.signature.font].family
  return `
    <text x="${W - SAFE}" y="${SAFE + sz}" text-anchor="end" font-family="${fam}" font-size="${sz}" letter-spacing="2">
      <tspan fill="${accent}">${idx}</tspan>
      <tspan fill="${fg}" opacity="0.6"> / ${tot}</tspan>
    </text>`
}

function ctaHeadlineSize(headline) {
  const n = String(headline || '').length
  if (n <= 10) return 130
  if (n <= 13) return 110
  if (n <= 16) return 90
  if (n <= 20) return 72
  return 60
}
function heroSize(hero) {
  const n = String(hero || '').length
  if (n <= 2) return 300
  if (n === 3) return 260
  if (n === 4) return 230
  if (n === 5) return 200
  return 180
}
function heroSpacing(hero) {
  return /^[0-9]+$/.test(String(hero || '')) ? -12 : 0
}
function contrastSize(label) {
  const s = String(label || ''); const n = s.length
  if (n <= 7) return 200
  if (n === 8) return 175
  return 155
}
function contrastSpacing(label) {
  const s = String(label || ''); const n = s.length
  const isDigit = /^[0-9]+$/.test(s)
  if (isDigit) { if (n <= 2) return -8; if (n === 3) return -12; return -16 }
  if (n <= 4) return -4
  if (n === 5) return -6
  if (n === 6) return -8
  return -10
}

function receiptCard(innerSvgFn) {
  const pw = 760; const px = (W - pw) / 2
  const ptop = 120; const pbot = H - 120; const ph = pbot - ptop
  const tri = 24; const triW = pw / tri; const triH = 22
  const topPath = []
  for (let i = 0; i < tri; i++) {
    topPath.push(`${px + (i + 0.5) * triW},${ptop}`)
    topPath.push(`${px + (i + 1) * triW},${ptop + triH}`)
  }
  const botPath = []
  for (let i = tri - 1; i >= 0; i--) {
    botPath.push(`${px + (i + 1) * triW},${pbot - triH}`)
    botPath.push(`${px + (i + 0.5) * triW},${pbot}`)
  }
  botPath.push(`${px},${pbot - triH}`)
  const points = [`${px},${ptop + triH}`, ...topPath, `${px + pw},${pbot - triH}`, ...botPath, `${px},${ptop + triH}`].join(' ')
  const shadow = `<rect x="${px + 12}" y="${ptop + 12}" width="${pw}" height="${ph - 24}" fill="#000" opacity="0.5"/>`
  return `
    ${shadow}
    <polygon points="${points}" fill="${C.white}"/>
    ${innerSvgFn({ px, ptop: ptop + triH, pw, pbot: pbot - triH, ph: ph - 2 * triH })}`
}

function receiptHeader(px, ptop, pw) {
  const cx = px + pw / 2
  const date = '2026-05-19'; const time = '6:00 PM'
  const wordmarkH = 64; const logoH = wordmarkH * 1.15; const logoW = logoH * BRAND_LOGO_RATIO
  const wordmarkTextW = 252; const wordmarkGap = 4
  const wordmarkW = wordmarkTextW + wordmarkGap + logoW
  const yWordmarkTop = ptop + 40
  const yWordmarkBaseline = yWordmarkTop + wordmarkH
  const wordmarkLeft = cx - wordmarkW / 2
  const textStartX = wordmarkLeft
  const logoX = wordmarkLeft + wordmarkTextW + wordmarkGap
  const logoY = yWordmarkBaseline - logoH + 6
  const yRnc = yWordmarkBaseline + 50
  const yLocale = yRnc + 28; const yPhone = yLocale + 28
  const yRule1 = yPhone + 30; const yDate = yRule1 + 36; const yRule2 = yDate + 26
  return `
    <text x="${textStartX}" y="${yWordmarkBaseline}" font-family="${FONTS.header.family}" font-size="72" fill="${C.black}" letter-spacing="4">TERMINAL</text>
    ${brandLogo(logoX, logoY, logoW, 1)}
    <text x="${cx}" y="${yRnc}" text-anchor="middle" font-family="${FONTS.body.family}" font-size="18" fill="${C.black}" opacity="0.7">RNC 133410321  ·  Santo Domingo, RD</text>
    <text x="${cx}" y="${yLocale}" text-anchor="middle" font-family="${FONTS.body.family}" font-size="18" fill="${C.black}" opacity="0.7">terminalxpos.com</text>
    <text x="${cx}" y="${yPhone}" text-anchor="middle" font-family="${FONTS.body.family}" font-size="18" fill="${C.black}" opacity="0.7">WhatsApp +1 809-828-2971</text>
    <line x1="${px + 40}" y1="${yRule1}" x2="${px + pw - 40}" y2="${yRule1}" stroke="${C.black}" stroke-width="2" opacity="0.5"/>
    <text x="${px + 40}" y="${yDate}" font-family="${FONTS.body.family}" font-size="22" fill="${C.black}" opacity="0.75">CIERRE · ${escapeXml(date)}</text>
    <text x="${px + pw - 40}" y="${yDate}" text-anchor="end" font-family="${FONTS.body.family}" font-size="22" fill="${C.black}" opacity="0.75">${escapeXml(time)}</text>
    <line x1="${px + 40}" y1="${yRule2}" x2="${px + pw - 40}" y2="${yRule2}" stroke="${C.black}" stroke-width="2" opacity="0.5"/>`
}

function receiptFooter(px, pbot, pw) {
  const cx = px + pw / 2
  return `
    <text x="${cx}" y="${pbot - 70}" text-anchor="middle" font-family="${FONTS.body.family}" font-size="16" fill="${C.black}" opacity="0.55" letter-spacing="2">${escapeXml(CFG.seriesTagline)}</text>
    <text x="${cx}" y="${pbot - 40}" text-anchor="middle" font-family="${FONTS.body.family}" font-size="14" fill="${C.black}" opacity="0.4" letter-spacing="3">GRACIAS POR LEER</text>`
}

function bgRect(bg) { return `<rect width="${W}" height="${H}" fill="${colorOf(bg)}"/>` }

function renderHook(slide, counter, i, total) {
  const heroColor = slide.heroColor ? colorOf(slide.heroColor) : C.crimson
  const inner = ({ px, ptop, pw, pbot }) => {
    const cx = px + pw / 2
    const ySubhero = ptop + 390
    const yHero = ptop + 720
    const yPromiseRule1 = ptop + 800
    const yPromise = ptop + 870
    const yPromiseRule2 = ptop + 910
    return `
      ${receiptHeader(px, ptop, pw)}
      <text x="${cx}" y="${ySubhero}" text-anchor="middle" font-family="${FONTS.header.family}" font-size="48" fill="${C.black}" letter-spacing="4">${escapeXml(slide.subhero)}</text>
      <text x="${cx}" y="${yHero}" text-anchor="middle" font-family="${FONTS.hook.family}" font-size="${heroSize(slide.hero)}" fill="${heroColor}" letter-spacing="${heroSpacing(slide.hero)}">${escapeXml(slide.hero)}</text>
      <line x1="${px + 40}" y1="${yPromiseRule1}" x2="${px + pw - 40}" y2="${yPromiseRule1}" stroke="${C.black}" stroke-width="2" opacity="0.5"/>
      <text x="${cx}" y="${yPromise}" text-anchor="middle" font-family="${FONTS.header.family}" font-size="44" fill="${heroColor}" letter-spacing="2">${escapeXml(slide.promise)}</text>
      <line x1="${px + 40}" y1="${yPromiseRule2}" x2="${px + pw - 40}" y2="${yPromiseRule2}" stroke="${C.black}" stroke-width="2" opacity="0.5"/>
      ${receiptFooter(px, pbot, pw)}`
  }
  return `${bgRect('black')}${signatureSvg(counter, 'black')}${slideIndicatorSvg(i, total, 'black', true)}${receiptCard(inner)}`
}

function renderContext(slide, counter, i, total) {
  const header = escapeXml(slide.header)
  const len = String(slide.body || '').length
  const tier = len < 80 ? 0 : len < 130 ? 1 : len < 180 ? 2 : 3
  const size = [54, 44, 36, 30][tier]; const lineH = [64, 54, 46, 40][tier]; const wrapAt = [24, 28, 32, 38][tier]
  const bodyLines = wrapText(slide.body, wrapAt)
  const inner = ({ px, ptop, pw, pbot }) => {
    const cx = px + pw / 2
    return `
      ${receiptHeader(px, ptop, pw)}
      <text x="${cx}" y="${ptop + 410}" text-anchor="middle" font-family="${FONTS.body.family}" font-size="22" fill="${C.black}" opacity="0.7" letter-spacing="6">PREGUNTA</text>
      <text x="${cx}" y="${ptop + 510}" text-anchor="middle" font-family="${FONTS.header.family}" font-size="84" fill="${C.crimson}" letter-spacing="2">${header}</text>
      <line x1="${px + 60}" y1="${ptop + 560}" x2="${px + pw - 60}" y2="${ptop + 560}" stroke="${C.black}" stroke-width="2" opacity="0.5"/>
      <text x="${cx}" y="${ptop + 620}" text-anchor="middle" font-family="${FONTS.body.family}" font-size="22" fill="${C.black}" opacity="0.7" letter-spacing="6">RESPUESTA</text>
      <text x="${cx}" y="${ptop + 700}" text-anchor="middle" font-family="${FONTS.header.family}" font-size="${size}" fill="${C.black}" letter-spacing="1">
        ${tspans(bodyLines, cx, 0, lineH)}
      </text>
      ${receiptFooter(px, pbot, pw)}`
  }
  return `${bgRect('black')}${signatureSvg(counter, 'black')}${slideIndicatorSvg(i, total, 'black')}${receiptCard(inner)}`
}

function renderData(slide, counter, i, total) {
  const labelLines = wrapText(slide.label, 26)
  const sourceLines = wrapText(slide.source || '', 50)
  const inner = ({ px, ptop, pw, pbot }) => {
    const cx = px + pw / 2
    return `
      ${receiptHeader(px, ptop, pw)}
      <text x="${cx}" y="${ptop + 420}" text-anchor="middle" font-family="${FONTS.header.family}" font-size="48" fill="${C.black}" letter-spacing="3">
        ${tspans(labelLines, cx, 0, 58)}
      </text>
      <text x="${cx}" y="${ptop + 800}" text-anchor="middle" font-family="${FONTS.hook.family}" font-size="340" fill="${C.crimson}" letter-spacing="-10">${escapeXml(slide.number)}</text>
      <line x1="${px + 60}" y1="${ptop + 870}" x2="${px + pw - 60}" y2="${ptop + 870}" stroke="${C.black}" stroke-width="2" opacity="0.5"/>
      <text x="${cx}" y="${ptop + 920}" text-anchor="middle" font-family="${FONTS.body.family}" font-size="20" fill="${C.black}" opacity="0.7">
        ${tspans(sourceLines, cx, 0, 28)}
      </text>
      ${receiptFooter(px, pbot, pw)}`
  }
  return `${bgRect('black')}${signatureSvg(counter, 'black')}${slideIndicatorSvg(i, total, 'black')}${receiptCard(inner)}`
}

function renderContrast(slide, counter, i, total) {
  const inner = ({ px, ptop, pw, pbot }) => {
    const cx = px + pw / 2
    const topSize = contrastSize(slide.topLabel); const botSize = contrastSize(slide.bottomLabel)
    const topTrack = contrastSpacing(slide.topLabel); const botTrack = contrastSpacing(slide.bottomLabel)
    const yTopLabel = ptop + 400; const yTopNumber = ptop + 600; const yMidRule = ptop + 670
    const yBotLabel = ptop + 740; const yBotNumber = ptop + 940
    return `
      ${receiptHeader(px, ptop, pw)}
      <text x="${cx}" y="${yTopLabel}" text-anchor="middle" font-family="${FONTS.body.family}" font-size="22" fill="${C.black}" opacity="0.7" letter-spacing="6">${escapeXml(slide.topBody)}</text>
      <text x="${cx}" y="${yTopNumber}" text-anchor="middle" font-family="${FONTS.hook.family}" font-size="${topSize}" fill="${C.black}" letter-spacing="${topTrack}">${escapeXml(slide.topLabel)}</text>
      <line x1="${px + 60}" y1="${yMidRule}" x2="${px + pw - 60}" y2="${yMidRule}" stroke="${C.black}" stroke-width="2" opacity="0.5"/>
      <text x="${cx}" y="${yBotLabel}" text-anchor="middle" font-family="${FONTS.body.family}" font-size="22" fill="${C.crimson}" letter-spacing="6">${escapeXml(slide.bottomBody)}</text>
      <text x="${cx}" y="${yBotNumber}" text-anchor="middle" font-family="${FONTS.hook.family}" font-size="${botSize}" fill="${C.crimson}" letter-spacing="${botTrack}">${escapeXml(slide.bottomLabel)}</text>
      ${receiptFooter(px, pbot, pw)}`
  }
  return `${bgRect('black')}${signatureSvg(counter, 'black')}${slideIndicatorSvg(i, total, 'black')}${receiptCard(inner)}`
}

function renderBullet(slide, counter, i, total) {
  const bullets = slide.bullets || []
  const count = bullets.length
  const maxLen = bullets.reduce((m, b) => Math.max(m, String(b).length), 0)
  const lineH = count <= 6 ? 80 : 70
  const baseSize = count <= 6 ? 60 : 50
  const itemSize = maxLen > 20 ? Math.round(baseSize * 0.62) : maxLen > 14 ? Math.round(baseSize * 0.78) : maxLen > 10 ? Math.round(baseSize * 0.9) : baseSize
  const inner = ({ px, ptop, pw, pbot }) => {
    const cx = px + pw / 2
    const yHeader = ptop + 420; const yRuleTop = ptop + 470; const startY = ptop + 540
    const items = bullets.map((b, idx) => {
      const y = startY + idx * lineH
      return `
        <text x="${px + 80}" y="${y}" font-family="${FONTS.header.family}" font-size="${itemSize}" fill="${C.black}" letter-spacing="2">${escapeXml(b)}</text>
        <text x="${px + pw - 80}" y="${y}" text-anchor="end" font-family="${FONTS.header.family}" font-size="${itemSize}" fill="${C.crimson}" letter-spacing="2">${String(idx + 1).padStart(2, '0')}</text>`
    }).join('')
    return `
      ${receiptHeader(px, ptop, pw)}
      <text x="${cx}" y="${yHeader}" text-anchor="middle" font-family="${FONTS.header.family}" font-size="56" fill="${C.crimson}" letter-spacing="2">${escapeXml(slide.header)}</text>
      <line x1="${px + 60}" y1="${yRuleTop}" x2="${px + pw - 60}" y2="${yRuleTop}" stroke="${C.black}" stroke-width="2" opacity="0.5"/>
      ${items}
      <line x1="${px + 60}" y1="${startY + (count - 1) * lineH + 30}" x2="${px + pw - 60}" y2="${startY + (count - 1) * lineH + 30}" stroke="${C.black}" stroke-width="2" opacity="0.5"/>
      ${receiptFooter(px, pbot, pw)}`
  }
  return `${bgRect('black')}${signatureSvg(counter, 'black')}${slideIndicatorSvg(i, total, 'black')}${receiptCard(inner)}`
}

function renderQuote(slide, counter, i, total) {
  const quoteLines = wrapText(`"${slide.quote}"`, 22)
  const inner = ({ px, ptop, pw, pbot }) => {
    const cx = px + pw / 2
    return `
      ${receiptHeader(px, ptop, pw)}
      <text x="${cx}" y="${ptop + 400}" text-anchor="middle" font-family="${FONTS.body.family}" font-size="22" fill="${C.black}" opacity="0.7" letter-spacing="6">CITA</text>
      <text x="${cx}" y="${ptop + 540}" text-anchor="middle" font-family="${FONTS.italic.family}" font-style="italic" font-weight="900" font-size="60" fill="${C.crimson}">
        ${tspans(quoteLines, cx, 0, 74)}
      </text>
      <line x1="${px + 60}" y1="${pbot - 180}" x2="${px + pw - 60}" y2="${pbot - 180}" stroke="${C.black}" stroke-width="2" opacity="0.5"/>
      <text x="${cx}" y="${pbot - 130}" text-anchor="middle" font-family="${FONTS.body.family}" font-size="22" fill="${C.black}" opacity="0.75">— ${escapeXml(slide.attribution)}</text>
      ${receiptFooter(px, pbot, pw)}`
  }
  return `${bgRect('black')}${signatureSvg(counter, 'black')}${slideIndicatorSvg(i, total, 'black')}${receiptCard(inner)}`
}

function renderCta(slide, counter, i, total) {
  const urlSize = slide.url && slide.url.length > 30 ? 26 : slide.url && slide.url.length > 25 ? 30 : 36
  const inner = ({ px, ptop, pw, pbot }) => {
    const cx = px + pw / 2
    return `
      ${receiptHeader(px, ptop, pw)}
      <text x="${cx}" y="${ptop + 410}" text-anchor="middle" font-family="${FONTS.body.family}" font-size="22" fill="${C.black}" opacity="0.7" letter-spacing="6">SIGUIENTE PASO</text>
      <text x="${cx}" y="${ptop + 540}" text-anchor="middle" font-family="${FONTS.header.family}" font-size="${ctaHeadlineSize(slide.headline)}" fill="${C.crimson}" letter-spacing="2">${escapeXml(slide.headline)}</text>
      <line x1="${px + 60}" y1="${ptop + 600}" x2="${px + pw - 60}" y2="${ptop + 600}" stroke="${C.black}" stroke-width="2" opacity="0.5"/>
      <text x="${cx}" y="${ptop + 680}" text-anchor="middle" font-family="${FONTS.body.family}" font-size="22" fill="${C.black}" opacity="0.6" letter-spacing="4">VISITA</text>
      <text x="${cx}" y="${ptop + 740}" text-anchor="middle" font-family="${FONTS.body.family}" font-size="${urlSize}" fill="${C.black}">${escapeXml(slide.url)}</text>
      <text x="${cx}" y="${ptop + 830}" text-anchor="middle" font-family="${FONTS.body.family}" font-size="22" fill="${C.black}" opacity="0.6" letter-spacing="4">O ESCRIBE</text>
      <text x="${cx}" y="${ptop + 890}" text-anchor="middle" font-family="${FONTS.body.family}" font-size="36" fill="${C.black}">WhatsApp ${escapeXml(slide.whatsapp)}</text>
      <line x1="${px + 60}" y1="${ptop + 950}" x2="${px + pw - 60}" y2="${ptop + 950}" stroke="${C.black}" stroke-width="2" opacity="0.5"/>
      ${receiptFooter(px, pbot, pw)}`
  }
  return `${bgRect('black')}${signatureSvg(counter, 'black')}${slideIndicatorSvg(i, total, 'black')}${receiptCard(inner)}`
}

const RENDERERS = { hook: renderHook, context: renderContext, data: renderData, contrast: renderContrast, bullet: renderBullet, quote: renderQuote, cta: renderCta }

function svgWrap(inner) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${inner}
</svg>`
}

async function rasterize(svg) {
  const r = new Resvg(svg, {
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: FONTS.body.family },
    fitTo: { mode: 'width', value: W },
    background: 'rgba(255,255,255,0)',
  })
  return r.render().asPng()
}

const slides = previewOnly ? [day.slides[0]] : day.slides
const outDir = join(OUTPUT_DIR, `day-${padded}`)
mkdirSync(outDir, { recursive: true })
console.log(`[ig-carousel] rendering ${slides.length} slide(s) to ${outDir}`)

const totalSlides = day.slides.length
for (let i = 0; i < slides.length; i++) {
  const slide = slides[i]
  const renderer = RENDERERS[slide.type]
  if (!renderer) { console.error(`[ig-carousel] unknown slide type: ${slide.type} (slide ${i+1})`); process.exit(1) }
  const svg = svgWrap(renderer(slide, targetDay, i + 1, totalSlides))
  const pngPath = join(outDir, `slide-${i+1}.png`)
  const buf = await rasterize(svg)
  writeFileSync(pngPath, buf)
  console.log(`  · slide ${i+1}/${totalSlides} (${slide.type}) → ${basename(pngPath)}`)
}

writeFileSync(join(outDir, 'caption.txt'), day.caption + '\n', 'utf8')
copyFileSync(dayPath, join(outDir, 'manifest.json'))

if (!noBump && !previewOnly && !dayArg) {
  writeCounter(targetDay + 1)
  console.log(`[ig-carousel] counter bumped: ${targetDay} → ${targetDay + 1}`)
}
console.log(`[ig-carousel] done. open ${outDir}`)
