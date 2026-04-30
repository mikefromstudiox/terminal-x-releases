/**
 * countSheetPdf.js — Conteo Fisico (v2.5)
 *
 * Generates two PDFs for physical inventory counts:
 *   1. Blank count sheet — printed BEFORE a count so the cashier walks the
 *      aisle and writes in the counted quantity by hand.
 *   2. Variance report — printed AFTER completion. Cost + price variance,
 *      sorted by |cost loss| desc, plus a summary box on page 1.
 *
 * Both render as letter-size (8.5x11in) A4-compatible portrait pages using
 * pdf-lib. Styling matches the brand palette: crimson/black/white only. No
 * gray, no emojis, no filler — production-grade reports only.
 *
 * Exports:
 *   - buildCountSheetPDF(data)      → { pdfBytes, filename }
 *   - buildVarianceReportPDF(data)  → { pdfBytes, filename }
 *   - saveCountSheetPDF(data, api)  → saves via Electron IPC or browser download
 *   - saveVarianceReportPDF(data, api)
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

// Letter size (US standard) in pts — 8.5in × 11in.
const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 40

const CRIMSON  = rgb(0.702, 0, 0.118)   // #b3001e
const INK      = rgb(0, 0, 0)
const PAPER    = rgb(1, 1, 1)
const HAIRLINE = rgb(0, 0, 0)

function fmtDate(d = new Date()) {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`
}

function fmtRD(n) {
  const v = Number(n || 0)
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (v < 0 ? '-RD$ ' : 'RD$ ') + s
}

function fmtQty(n) {
  if (n === null || n === undefined) return ''
  const v = Number(n)
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

function todayStamp() {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`
}

function sanitizeFilename(s) {
  return String(s || 'conteo').replace(/[^\w\-]+/g, '_').slice(0, 60)
}

// Group items by category in stable SKU-walk order.
function groupByCategory(items) {
  const groups = new Map()
  for (const it of items) {
    const k = (it.category && String(it.category).trim()) || 'Sin categoria'
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(it)
  }
  for (const arr of groups.values()) {
    arr.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'))
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'))
}

// Truncate a string to a pt-width budget. Rough heuristic — adequate for
// Helvetica at body sizes.
function clip(font, str, size, maxW) {
  let s = String(str || '')
  let w = font.widthOfTextAtSize(s, size)
  if (w <= maxW) return s
  while (w > maxW && s.length > 1) {
    s = s.slice(0, -1)
    w = font.widthOfTextAtSize(s + '…', size)
  }
  return s + '…'
}

// ── Blank count sheet ────────────────────────────────────────────────────────

export async function buildCountSheetPDF({ count, biz }) {
  const pdf = await PDFDocument.create()
  const font     = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const groups = groupByCategory(count?.items || [])

  let page = pdf.addPage([PAGE_W, PAGE_H])
  let y = PAGE_H - MARGIN

  function newPage() {
    page = pdf.addPage([PAGE_W, PAGE_H])
    y = PAGE_H - MARGIN
    drawHeader()
  }

  function drawHeader() {
    const title = 'HOJA DE CONTEO FISICO'
    page.drawText(biz?.name || 'Empresa', { x: MARGIN, y: y - 12, size: 12, font: fontBold, color: INK })
    const sub = [biz?.rnc ? `RNC: ${biz.rnc}` : null, fmtDate()].filter(Boolean).join('   |   ')
    page.drawText(sub, { x: MARGIN, y: y - 26, size: 8, font, color: INK })

    page.drawText(title, { x: MARGIN, y: y - 48, size: 16, font: fontBold, color: CRIMSON })
    page.drawText(count?.title || '—', { x: MARGIN, y: y - 64, size: 10, font, color: INK })
    if (count?.counted_by_name) {
      page.drawText(`Contado por: ${count.counted_by_name}`, { x: MARGIN, y: y - 78, size: 9, font, color: INK })
    }

    // Column headers
    const rowY = y - 100
    page.drawRectangle({ x: MARGIN, y: rowY - 4, width: PAGE_W - MARGIN * 2, height: 16, color: CRIMSON })
    const cols = [
      { label: 'SKU',            x: MARGIN + 6,   w: 80 },
      { label: 'PRODUCTO',       x: MARGIN + 92,  w: 280 },
      { label: 'CANT. ESPERADA', x: MARGIN + 376, w: 80 },
      { label: 'CONTADO',        x: MARGIN + 462, w: 70 },
    ]
    for (const c of cols) {
      page.drawText(c.label, { x: c.x, y: rowY, size: 8, font: fontBold, color: PAPER })
    }
    y = rowY - 16
  }

  drawHeader()

  const ROW_H = 22
  for (const [category, items] of groups) {
    if (y < MARGIN + ROW_H * 3) newPage()
    // Category header bar
    page.drawRectangle({ x: MARGIN, y: y - 16, width: PAGE_W - MARGIN * 2, height: 14, color: INK })
    page.drawText(category.toUpperCase(), { x: MARGIN + 6, y: y - 13, size: 8, font: fontBold, color: PAPER })
    y -= 18

    for (const it of items) {
      if (y < MARGIN + ROW_H) newPage()
      // Row hairline
      page.drawLine({ start: { x: MARGIN, y: y - ROW_H + 2 }, end: { x: PAGE_W - MARGIN, y: y - ROW_H + 2 }, thickness: 0.3, color: HAIRLINE })
      page.drawText(clip(font, it.sku || '', 9, 78),  { x: MARGIN + 6,   y: y - 14, size: 9, font, color: INK })
      page.drawText(clip(font, it.name, 10, 276),      { x: MARGIN + 92,  y: y - 14, size: 10, font, color: INK })
      page.drawText(fmtQty(it.expected_qty),            { x: MARGIN + 376, y: y - 14, size: 10, font, color: INK })
      // Blank contado box — hand-write in
      page.drawRectangle({ x: MARGIN + 462, y: y - 18, width: 70, height: 16, borderColor: INK, borderWidth: 0.8, color: PAPER })
      y -= ROW_H
    }
    y -= 6
  }

  // Footer on every page
  const pageCount = pdf.getPageCount()
  for (let i = 0; i < pageCount; i++) {
    const p = pdf.getPage(i)
    const footer = `Pagina ${i + 1} de ${pageCount}    |    Firma: ____________________________    |    Fecha: ____________`
    p.drawText(footer, { x: MARGIN, y: 20, size: 8, font, color: INK })
  }

  const pdfBytes = await pdf.save()
  const filename = `conteo-hoja-${sanitizeFilename(count?.title || '')}-${todayStamp()}.pdf`
  return { pdfBytes, filename }
}

// ── Variance report (post-completion) ───────────────────────────────────────

export async function buildVarianceReportPDF({ count, biz }) {
  const pdf = await PDFDocument.create()
  const font     = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  // v2.14 — Variance math subtracts sales-during-count so shrinkage reflects
  // true loss, not sales. `_adj_expected` = expected_qty - sold_during_count
  // and drives every downstream number on the report.
  const items = (count?.items || []).map(it => {
    const exp = Number(it.expected_qty) || 0
    const sold = Number(it.sold_during_count) || 0
    const adj = exp - sold
    const cnt = (it.counted_qty === null || it.counted_qty === undefined) ? adj : Number(it.counted_qty)
    const dq  = cnt - adj
    return {
      ...it,
      _adj_expected: adj,
      _sold_during: sold,
      _counted_qty_effective: cnt,
      _variance_qty:   dq,
      _variance_cost:  dq * (Number(it.unit_cost)  || 0),
      _variance_price: dq * (Number(it.unit_price) || 0),
      _was_counted:    it.counted_qty !== null && it.counted_qty !== undefined,
    }
  }).filter(it => it._variance_qty !== 0)
   .sort((a, b) => Math.abs(b._variance_cost) - Math.abs(a._variance_cost))

  const totals = (count?.items || []).reduce((acc, it) => {
    const exp = Number(it.expected_qty) || 0
    const sold = Number(it.sold_during_count) || 0
    const adj = exp - sold
    const cnt = (it.counted_qty === null || it.counted_qty === undefined) ? adj : Number(it.counted_qty)
    const cost  = Number(it.unit_cost)  || 0
    const price = Number(it.unit_price) || 0
    acc.expCost   += exp * cost
    acc.cntCost   += cnt * cost
    acc.varCost   += (cnt - adj) * cost
    acc.expPrice  += exp * price
    acc.cntPrice  += cnt * price
    acc.varPrice  += (cnt - adj) * price
    acc.soldQty   += sold
    return acc
  }, { expCost: 0, cntCost: 0, varCost: 0, expPrice: 0, cntPrice: 0, varPrice: 0, soldQty: 0 })

  let page = pdf.addPage([PAGE_W, PAGE_H])
  let y = PAGE_H - MARGIN

  function drawHeader() {
    page.drawText(biz?.name || 'Empresa', { x: MARGIN, y: y - 12, size: 12, font: fontBold, color: INK })
    const sub = [biz?.rnc ? `RNC: ${biz.rnc}` : null, fmtDate()].filter(Boolean).join('   |   ')
    page.drawText(sub, { x: MARGIN, y: y - 26, size: 8, font, color: INK })

    const dateStr = count?.completed_at ? fmtDate(new Date(count.completed_at)) : fmtDate(new Date(count?.started_at))
    page.drawText(`REPORTE DE VARIANZA — CONTEO DEL ${dateStr}`, {
      x: MARGIN, y: y - 50, size: 14, font: fontBold, color: CRIMSON,
    })
    page.drawText(count?.title || '—', { x: MARGIN, y: y - 66, size: 10, font, color: INK })
    if (count?.counted_by_name) {
      page.drawText(`Contado por: ${count.counted_by_name}`, { x: MARGIN, y: y - 80, size: 9, font, color: INK })
    }
    y -= 100
  }

  drawHeader()

  // Summary box
  const boxH = 90
  page.drawRectangle({ x: MARGIN, y: y - boxH, width: PAGE_W - MARGIN * 2, height: boxH, borderColor: INK, borderWidth: 0.8, color: PAPER })
  page.drawRectangle({ x: MARGIN, y: y - 18, width: PAGE_W - MARGIN * 2, height: 18, color: INK })
  page.drawText('RESUMEN DE VARIANZA', { x: MARGIN + 8, y: y - 13, size: 9, font: fontBold, color: PAPER })

  const col1X = MARGIN + 10
  const col2X = MARGIN + 210
  const col3X = MARGIN + 410
  const lineY1 = y - 36
  const lineY2 = y - 52
  const lineY3 = y - 68

  page.drawText('VALOR ESPERADO (costo)', { x: col1X, y: lineY1, size: 8, font: fontBold, color: INK })
  page.drawText(fmtRD(totals.expCost),      { x: col1X, y: lineY1 - 12, size: 10, font, color: INK })

  page.drawText('VALOR CONTADO (costo)',   { x: col2X, y: lineY1, size: 8, font: fontBold, color: INK })
  page.drawText(fmtRD(totals.cntCost),      { x: col2X, y: lineY1 - 12, size: 10, font, color: INK })

  page.drawText('VARIANZA (costo)',         { x: col3X, y: lineY1, size: 8, font: fontBold, color: INK })
  page.drawText(fmtRD(totals.varCost),      { x: col3X, y: lineY1 - 12, size: 11, font: fontBold, color: totals.varCost < 0 ? CRIMSON : INK })

  page.drawText('VALOR ESPERADO (precio)', { x: col1X, y: lineY3, size: 8, font: fontBold, color: INK })
  page.drawText(fmtRD(totals.expPrice),     { x: col1X, y: lineY3 - 12, size: 9, font, color: INK })

  page.drawText('VALOR CONTADO (precio)',  { x: col2X, y: lineY3, size: 8, font: fontBold, color: INK })
  page.drawText(fmtRD(totals.cntPrice),     { x: col2X, y: lineY3 - 12, size: 9, font, color: INK })

  page.drawText('VARIANZA (precio)',        { x: col3X, y: lineY3, size: 8, font: fontBold, color: INK })
  page.drawText(fmtRD(totals.varPrice),     { x: col3X, y: lineY3 - 12, size: 9, font, color: totals.varPrice < 0 ? CRIMSON : INK })

  y -= boxH + 24

  // Table header
  function tableHeader() {
    page.drawRectangle({ x: MARGIN, y: y - 16, width: PAGE_W - MARGIN * 2, height: 16, color: CRIMSON })
    const labels = [
      { x: MARGIN + 6,   label: 'SKU' },
      { x: MARGIN + 78,  label: 'PRODUCTO' },
      { x: MARGIN + 278, label: 'INICIO' },
      { x: MARGIN + 318, label: 'VENDIDOS' },
      { x: MARGIN + 370, label: 'ESPERADO' },
      { x: MARGIN + 418, label: 'CONTADO' },
      { x: MARGIN + 466, label: 'DIF.' },
      { x: MARGIN + 500, label: 'COSTO' },
      { x: MARGIN + 548, label: 'PRECIO' },
    ]
    for (const l of labels) page.drawText(l.label, { x: l.x, y: y - 12, size: 7, font: fontBold, color: PAPER })
    y -= 18
  }

  tableHeader()

  if (items.length === 0) {
    page.drawText('Sin variaciones — el conteo coincide con el inventario esperado.',
      { x: MARGIN, y: y - 16, size: 10, font, color: INK })
    y -= 30
  } else {
    const ROW_H = 14
    for (const it of items) {
      if (y < MARGIN + ROW_H + 40) {
        page = pdf.addPage([PAGE_W, PAGE_H])
        y = PAGE_H - MARGIN
        drawHeader()
        tableHeader()
      }
      const lossColor = it._variance_cost < 0 ? CRIMSON : INK

      page.drawText(clip(font, it.sku || '', 8, 68),            { x: MARGIN + 6,   y: y - 10, size: 8, font, color: INK })
      page.drawText(clip(font, it.name, 9, 196),                { x: MARGIN + 78,  y: y - 10, size: 9, font, color: INK })
      page.drawText(fmtQty(it.expected_qty),                    { x: MARGIN + 278, y: y - 10, size: 9, font, color: INK })
      page.drawText(fmtQty(it._sold_during),                    { x: MARGIN + 318, y: y - 10, size: 9, font, color: INK })
      page.drawText(fmtQty(it._adj_expected),                   { x: MARGIN + 370, y: y - 10, size: 9, font, color: INK })
      page.drawText(fmtQty(it._counted_qty_effective),          { x: MARGIN + 418, y: y - 10, size: 9, font, color: INK })
      page.drawText((it._variance_qty > 0 ? '+' : '') + fmtQty(it._variance_qty),
                                                                { x: MARGIN + 466, y: y - 10, size: 9, font: fontBold, color: lossColor })
      page.drawText(fmtRD(it._variance_cost),                   { x: MARGIN + 500, y: y - 10, size: 8, font: fontBold, color: lossColor })
      page.drawText(fmtRD(it._variance_price),                  { x: MARGIN + 548, y: y - 10, size: 7, font, color: lossColor })
      // hairline
      page.drawLine({ start: { x: MARGIN, y: y - 13 }, end: { x: PAGE_W - MARGIN, y: y - 13 }, thickness: 0.2, color: HAIRLINE })
      y -= ROW_H
    }
  }

  // v2.14 — Signature block. If the count was signed (Ranoza requirement), we
  // embed the PNG dataURL on the last page above the footer. Falls back to a
  // plain line-and-label if no signature is on file (legacy counts).
  if (y < MARGIN + 120) {
    page = pdf.addPage([PAGE_W, PAGE_H])
    y = PAGE_H - MARGIN
  }
  y -= 24
  const sigBoxW = 260
  const sigBoxH = 80
  if (count?.signature_dataurl && typeof count.signature_dataurl === 'string' && count.signature_dataurl.startsWith('data:image/')) {
    try {
      const base64 = count.signature_dataurl.split(',')[1] || ''
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
      const isPng = count.signature_dataurl.includes('image/png')
      const img = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
      const scale = Math.min(sigBoxW / img.width, sigBoxH / img.height)
      const w = img.width * scale
      const h = img.height * scale
      page.drawImage(img, { x: MARGIN, y: y - h, width: w, height: h })
      page.drawLine({ start: { x: MARGIN, y: y - h - 4 }, end: { x: MARGIN + sigBoxW, y: y - h - 4 }, thickness: 0.6, color: INK })
      page.drawText('Firma del responsable', { x: MARGIN, y: y - h - 16, size: 8, font, color: INK })
      if (count?.counted_by_name) {
        page.drawText(count.counted_by_name, { x: MARGIN, y: y - h - 28, size: 9, font: fontBold, color: INK })
      }
    } catch {
      page.drawLine({ start: { x: MARGIN, y: y - 48 }, end: { x: MARGIN + sigBoxW, y: y - 48 }, thickness: 0.6, color: INK })
      page.drawText('Firma del responsable', { x: MARGIN, y: y - 60, size: 8, font, color: INK })
    }
  } else {
    page.drawLine({ start: { x: MARGIN, y: y - 48 }, end: { x: MARGIN + sigBoxW, y: y - 48 }, thickness: 0.6, color: INK })
    page.drawText('Firma del responsable', { x: MARGIN, y: y - 60, size: 8, font, color: INK })
    if (count?.counted_by_name) {
      page.drawText(count.counted_by_name, { x: MARGIN, y: y - 72, size: 9, font: fontBold, color: INK })
    }
  }

  // Footer
  const pageCount = pdf.getPageCount()
  for (let i = 0; i < pageCount; i++) {
    const p = pdf.getPage(i)
    p.drawText(`Pagina ${i + 1} de ${pageCount}`, { x: MARGIN, y: 24, size: 7, font, color: INK })
    if (count?.counted_by_name) {
      p.drawText(`Contado por: ${count.counted_by_name}`, { x: MARGIN, y: 14, size: 7, font, color: INK })
    }
  }

  const pdfBytes = await pdf.save()
  const filename = `conteo-varianza-${sanitizeFilename(count?.title || '')}-${todayStamp()}.pdf`
  return { pdfBytes, filename }
}

// ── Save helpers (electron IPC → disk, or browser download) ─────────────────

function bytesToBase64(bytes) {
  // Chunked to avoid "Maximum call stack size exceeded" — spreading a large
  // Uint8Array into String.fromCharCode crashes on PDFs >~100KB (Ranoza's
  // 976-product count sheet hit this and silently aborted the print flow).
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

async function persistPDF({ pdfBytes, filename }, api) {
  // Electron-only: route through IPC so the file lands on disk via dialog.
  // Web's api.pdf.save also exists but its contract is { buffer, filename }
  // (browser Blob download), NOT { base64, filename } — passing the wrong
  // shape silently returned "No buffer provided" and nothing happened on
  // screen. Detect Electron specifically to avoid that contract mismatch.
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.pdf?.save
  if (isElectron) {
    const base64 = bytesToBase64(pdfBytes)
    const result = await window.electronAPI.pdf.save({ filename, base64 })
    return result || { ok: false, error: 'IPC unavailable' }
  }
  // Browser: trigger a direct download via Blob URL. No base64 round-trip.
  try {
    const blob = new Blob([pdfBytes], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    return { ok: true, filePath: filename }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

export async function saveCountSheetPDF(data, api) {
  try {
    const out = await buildCountSheetPDF(data)
    return await persistPDF(out, api)
  } catch (err) { return { ok: false, error: err.message } }
}

export async function saveVarianceReportPDF(data, api) {
  try {
    const out = await buildVarianceReportPDF(data)
    return await persistPDF(out, api)
  } catch (err) { return { ok: false, error: err.message } }
}
