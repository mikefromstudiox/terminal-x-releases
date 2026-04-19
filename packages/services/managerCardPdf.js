/**
 * managerCardPdf.js — Prints a CR80-sized Manager Authorization Card to PDF.
 *
 * Layout (per card, 85.6 × 54 mm, landscape):
 *   ┌───────────────────────────────────────────┐
 *   │  [LOGO]   TARJETA DE AUTORIZACIÓN         │
 *   │           Business name                    │
 *   │                                            │
 *   │   MANAGER NAME (bold, large)               │
 *   │   ROLE · RNC? · ID                         │
 *   │                                            │
 *   │   ███ █ ███ █ ████ █ ██ █ ███ █  (Code128) │
 *   │   XXXX-XXXX-XXXX-XXXX-XXXX                 │
 *   │                                            │
 *   │   CONFIDENCIAL · NO COMPARTIR              │
 *   └───────────────────────────────────────────┘
 *
 * Two cards per Letter page, stacked vertically, with subtle cut lines.
 * No emojis, no gray — only black / white / #b3001e per brand.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { encodeCode128B, totalModules } from './code128.js'
import { formatToken, normalizeToken } from './managerAuthToken.js'

const MM = 2.8346456693  // 1 mm in PDF points (72 / 25.4)
const CRIMSON = rgb(0.702, 0, 0.118) // #b3001e
const BLACK   = rgb(0, 0, 0)

// Card dims (CR80).
const CARD_W = 85.6 * MM
const CARD_H = 54   * MM

// Letter page: 8.5 × 11 in → 612 × 792 pt.
const PAGE_W = 612
const PAGE_H = 792

/**
 * @param {Object} opts
 * @param {string} opts.token        Raw 20-char token (no dashes).
 * @param {string} opts.managerName  "Michelle Felix"
 * @param {string} [opts.role]       "manager" / "owner"
 * @param {string} [opts.businessName]
 * @param {string} [opts.issuedAt]   ISO date for the footer.
 * @param {Uint8Array} [opts.logoPng] Optional PNG bytes for the header.
 * @returns {Promise<Uint8Array>} PDF bytes
 */
export async function buildManagerCardPDF({ token, managerName, role, businessName, issuedAt, logoPng }) {
  const raw = normalizeToken(token)
  if (raw.length < 8) throw new Error('managerCardPdf: token too short')

  const pdf  = await PDFDocument.create()
  const page = pdf.addPage([PAGE_W, PAGE_H])
  const font     = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  let logoImg = null
  if (logoPng && logoPng.byteLength) {
    try { logoImg = await pdf.embedPng(logoPng) } catch { logoImg = null }
  }

  // Center two cards vertically with a 10mm gutter.
  const gutter = 10 * MM
  const totalH = CARD_H * 2 + gutter
  const topY   = (PAGE_H - totalH) / 2 + totalH  // top of first card
  const cardY1 = topY - CARD_H
  const cardY2 = cardY1 - gutter - CARD_H
  const cardX  = (PAGE_W - CARD_W) / 2

  for (const cardY of [cardY1, cardY2]) {
    drawCard(page, { x: cardX, y: cardY, font, fontBold, logoImg,
      token: raw, managerName, role, businessName, issuedAt })
  }

  // Cut line between the two cards — tiny crimson tick marks at the edges.
  const cutY = cardY1 - gutter / 2
  const tick = 4 * MM
  page.drawLine({ start: { x: cardX - tick, y: cutY }, end: { x: cardX, y: cutY }, thickness: 0.4, color: CRIMSON })
  page.drawLine({ start: { x: cardX + CARD_W, y: cutY }, end: { x: cardX + CARD_W + tick, y: cutY }, thickness: 0.4, color: CRIMSON })

  const bytes = await pdf.save()
  return bytes
}

function drawCard(page, { x, y, font, fontBold, logoImg, token, managerName, role, businessName, issuedAt }) {
  // Border (black, 0.75pt) — no emoji, no gray.
  page.drawRectangle({ x, y, width: CARD_W, height: CARD_H, borderColor: BLACK, borderWidth: 0.75, color: undefined })

  const pad = 4 * MM

  // Header band (crimson) — top 10mm strip.
  const headerH = 9 * MM
  page.drawRectangle({ x, y: y + CARD_H - headerH, width: CARD_W, height: headerH, color: CRIMSON })
  if (logoImg) {
    const lh = headerH - 2 * MM
    const scale = lh / logoImg.height
    const lw = Math.min(logoImg.width * scale, 16 * MM)
    page.drawImage(logoImg, { x: x + pad, y: y + CARD_H - headerH + MM, width: lw, height: lh })
  }
  page.drawText('TARJETA DE AUTORIZACION', {
    x: x + pad + (logoImg ? 18 * MM : 0),
    y: y + CARD_H - headerH + 3.4 * MM,
    size: 9,
    font: fontBold,
    color: rgb(1, 1, 1),
  })
  if (businessName) {
    page.drawText(String(businessName).slice(0, 36), {
      x: x + pad + (logoImg ? 18 * MM : 0),
      y: y + CARD_H - headerH + 1.2 * MM,
      size: 6.5, font, color: rgb(1, 1, 1),
    })
  }

  // Manager block
  page.drawText(String(managerName || '').toUpperCase().slice(0, 30), {
    x: x + pad, y: y + CARD_H - headerH - 6 * MM,
    size: 13, font: fontBold, color: BLACK,
  })
  const subline = [role ? role.toUpperCase() : '', issuedAt ? 'EMITIDA ' + fmtDate(issuedAt) : '']
    .filter(Boolean).join('   ·   ')
  if (subline) {
    page.drawText(subline, {
      x: x + pad, y: y + CARD_H - headerH - 9.5 * MM,
      size: 7, font, color: BLACK,
    })
  }

  // Barcode row
  const barTop = y + 17 * MM
  const barH   = 11 * MM
  drawCode128(page, { token, x: x + pad, y: barTop, width: CARD_W - 2 * pad, height: barH })

  // Token text (human fallback)
  page.drawText(formatToken(token), {
    x: x + pad, y: y + 12 * MM,
    size: 10, font: fontBold, color: BLACK,
  })

  // Footer
  page.drawText('CONFIDENCIAL  ·  REVOCADA SI SE PIERDE  ·  NO COMPARTIR', {
    x: x + pad, y: y + 2.8 * MM,
    size: 6, font, color: CRIMSON,
  })
}

function drawCode128(page, { token, x, y, width, height }) {
  const widths = encodeCode128B(token)
  const modules = totalModules(widths)
  const mw = width / modules  // module width (in pt)
  let cx = x
  let isBar = true
  for (const w of widths) {
    if (isBar) {
      page.drawRectangle({ x: cx, y, width: mw * w, height, color: BLACK })
    }
    cx += mw * w
    isBar = !isBar
  }
}

function fmtDate(iso) {
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return '' }
}

/** Trigger a browser download of the PDF. Convenience wrapper. */
export async function downloadManagerCardPDF(opts, filename = 'tarjeta-autorizacion.pdf') {
  const bytes = await buildManagerCardPDF(opts)
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
