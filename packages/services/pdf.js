/**
 * pdf.js — Receipt PDF generation using pdf-lib
 *
 * Generates a receipt PDF and saves it to userData/receipts/ via Electron IPC.
 * Files are named by ticket number: T-001.pdf, E320000001.pdf, etc.
 * Supports embedded QR codes for e-CF receipts.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import QRCode from 'qrcode'
import { formatPhoneForReceipt } from './phone.js'

// 80mm receipt width in pts (1mm ≈ 2.835 pts). Height is dynamic.
const PAGE_W  = 226   // 80mm in pts
const MARGIN  = 14
const COL_W   = PAGE_W - MARGIN * 2
const LINE_H  = 13
const SMALL   = 8
const NORMAL  = 9
const LARGE   = 13
const QR_SIZE = 90

// Brand palette
const CRIMSON  = [0.702, 0, 0.118]   // #b3001e
const INK      = [0, 0, 0]
const MUTED    = [0.42, 0.42, 0.42]
const HAIRLINE = [0.78, 0.78, 0.78]
const PAPER    = [1, 1, 1]
const RGB = (c) => rgb(c[0], c[1], c[2])

function fmtDate(d = new Date()) {
  return d.toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })
}

function fmtFirmaDate(isoStr) {
  const d = new Date(isoStr)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${dd}-${mm}-${yyyy} ${hh}:${mi}:${ss}`
}

function fmtRD(n) {
  return 'RD$ ' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Generate a QR code PNG as a data URL, then extract the base64 portion.
 * Returns null if generation fails or no eNCF provided.
 */
async function generateQRPng(url) {
  if (!url) return null
  try {
    const dataUrl = await QRCode.toDataURL(url, { width: QR_SIZE * 2, margin: 1 })
    return dataUrl.split(',')[1]
  } catch {
    return null
  }
}

function buildQRUrl(data) {
  const enc = encodeURIComponent
  const ncf = data.ncf || ''
  const rnc = data.biz?.rnc || ''
  const isConsumerUnder250K = ncf.startsWith('E32') && (data.total || 0) < 250000
  if (isConsumerUnder250K) {
    return `https://fc.dgii.gov.do/ecf/ConsultaTimbreFC?RncEmisor=${enc(rnc)}&ENCF=${enc(ncf)}&MontoTotal=${enc(Number(data.total || 0).toFixed(2))}&CodigoSeguridad=${enc(data.securityCode || '')}`
  }
  const fechaEmision = fmtFirmaDate(data.paidAt || new Date()).split(' ')[0]
  const fechaFirma = data.signatureDate ? fmtFirmaDate(data.signatureDate) : ''
  return `https://ecf.dgii.gov.do/ecf/ConsultaTimbre?RncEmisor=${enc(rnc)}&RncComprador=${enc(data.client?.rnc || '')}&ENCF=${enc(ncf)}&FechaEmision=${enc(fechaEmision)}&MontoTotal=${enc(Number(data.total || 0).toFixed(2))}&FechaFirma=${enc(fechaFirma)}&CodigoSeguridad=${enc(data.securityCode || '')}`
}

/**
 * Core PDF builder — returns { pdfBytes, filename }
 * Used by both saveReceiptPDF (disk save) and buildReceiptPDFBase64 (WhatsApp).
 *
 * @param {object} data  Same shape as printClientReceipt data object
 * @param {string} [qrUrl]  Optional QR image URL (from ef2.do or generated)
 */
async function buildPDF(data) {
  const doc   = await PDFDocument.create()
  const font  = await doc.embedFont(StandardFonts.Helvetica)
  const fontB = await doc.embedFont(StandardFonts.HelveticaBold)

  // Build content lines first to calculate height
  const lines = buildLines(data)
  const isECF = data.ncf && data.ncf.startsWith('E')

  // Generate QR for e-CF receipts
  let qrPngBase64 = null
  if (isECF) {
    const qrUrl = data.qrLink || buildQRUrl(data)
    qrPngBase64 = await generateQRPng(qrUrl)
  }

  // ── Embed business logo (optional — drawn INSIDE the crimson header band) ──
  let logoImage = null
  const LOGO_H = 36
  const logoUrl = data.biz?.logo || ''
  if (logoUrl) {
    try {
      let logoBytes
      if (logoUrl.startsWith('data:image/png')) {
        logoBytes = Uint8Array.from(atob(logoUrl.split(',')[1]), c => c.charCodeAt(0))
        logoImage = await doc.embedPng(logoBytes)
      } else if (logoUrl.startsWith('data:image/jp')) {
        logoBytes = Uint8Array.from(atob(logoUrl.split(',')[1]), c => c.charCodeAt(0))
        logoImage = await doc.embedJpg(logoBytes)
      } else if (logoUrl.endsWith('.png') || logoUrl.includes('.png')) {
        const resp = await fetch(logoUrl)
        logoBytes = new Uint8Array(await resp.arrayBuffer())
        logoImage = await doc.embedPng(logoBytes)
      } else if (logoUrl.endsWith('.jpg') || logoUrl.endsWith('.jpeg') || logoUrl.includes('.jpg')) {
        const resp = await fetch(logoUrl)
        logoBytes = new Uint8Array(await resp.arrayBuffer())
        logoImage = await doc.embedJpg(logoBytes)
      }
    } catch { logoImage = null }
  }

  // ── Height calculation ──
  const biz = data.biz || {}
  const bizName = (biz.name || 'TERMINAL X').toUpperCase()
  // Header band: logo (if any) + name + 2 lines of contact info
  let addrFull = biz.address || ''
  try {
    const s = typeof biz.settings === 'string' ? JSON.parse(biz.settings) : (biz.settings || {})
    if (s.ciudad || s.biz_city) addrFull = (addrFull ? addrFull + ', ' : '') + (s.ciudad || s.biz_city)
  } catch {}
  const headerLogoH = logoImage ? LOGO_H + 4 : 0
  const HEADER_BAND_H = 14 + headerLogoH + 18 + (addrFull ? 11 : 0) + ((biz.phone || biz.rnc) ? 11 : 0) + 10

  const TOTAL_BOX_H = 34
  const secCodeH = (qrPngBase64 && data.securityCode) ? 11 : 0
  const firmaH   = (qrPngBase64 && data.signatureDate) ? 11 : 0
  const qrBlockH = qrPngBase64 ? QR_SIZE + 26 + secCodeH + firmaH : 0
  // FOOTER_H reserves vertical space for: X mark + grace lines + custom footer
  // (up to 3 lines × 9pt) + powered-by tagline.
  const customFooterRaw = (data.customFooter || data.biz?.invoice_footer || '').toString().trim()
  const customFooterLines = customFooterRaw ? Math.min(3, Math.ceil(customFooterRaw.length / 64)) : 0
  const FOOTER_H = 46 + customFooterLines * 9
  const bodyH = lines.reduce((h, l) => h + l.height, 0)
  // v2.16.0 — extra height for photo evidence grid (2 rows × cell + caption + heading)
  const photoCount = Array.isArray(data.photoEvidence) ? Math.min(data.photoEvidence.length, 4) : 0
  const photoCell = photoCount ? ((PAGE_W - MARGIN * 2 - 6) / 2) : 0
  const photoBlockH = photoCount ? (Math.ceil(photoCount / 2) * (photoCell + 12) + 22) : 0
  const pageH = HEADER_BAND_H + 10 + bodyH + TOTAL_BOX_H + 8 + qrBlockH + photoBlockH + FOOTER_H + MARGIN

  const page = doc.addPage([PAGE_W, pageH])
  const { width, height } = page.getSize()

  // ═══ CRIMSON HEADER BAND ═══════════════════════════════════════════════════
  page.drawRectangle({
    x: 0, y: height - HEADER_BAND_H,
    width: PAGE_W, height: HEADER_BAND_H,
    color: RGB(CRIMSON),
  })

  let y = height - 14

  if (logoImage) {
    const aspect = logoImage.width / logoImage.height
    const logoW = Math.min(LOGO_H * aspect, COL_W * 0.55)
    const logoX = MARGIN + (COL_W - logoW) / 2
    page.drawImage(logoImage, { x: logoX, y: y - LOGO_H, width: logoW, height: LOGO_H })
    y -= LOGO_H + 4
  }

  // Business name — white on crimson, bold, letter-spaced feel via uppercase
  const nameSize = 13
  const nameW = fontB.widthOfTextAtSize(bizName, nameSize)
  if (nameW <= COL_W) {
    page.drawText(bizName, {
      x: MARGIN + (COL_W - nameW) / 2, y: y - nameSize,
      size: nameSize, font: fontB, color: RGB(PAPER),
    })
    y -= nameSize + 4
  } else {
    // Scale down if too long
    const sz = Math.max(9, Math.floor(nameSize * COL_W / nameW))
    const w = fontB.widthOfTextAtSize(bizName, sz)
    page.drawText(bizName, { x: MARGIN + (COL_W - w) / 2, y: y - sz, size: sz, font: fontB, color: RGB(PAPER) })
    y -= sz + 4
  }

  // Contact info — white muted (0.88 white), small
  const headerMuted = rgb(1, 1, 1)
  if (addrFull) {
    const w = font.widthOfTextAtSize(addrFull, SMALL)
    if (w <= COL_W) {
      page.drawText(addrFull, { x: MARGIN + (COL_W - w) / 2, y: y - SMALL, size: SMALL, font, color: headerMuted, opacity: 0.88 })
    } else {
      // truncate
      let t = addrFull
      while (font.widthOfTextAtSize(t + '...', SMALL) > COL_W && t.length > 4) t = t.slice(0, -1)
      t += '...'
      const w2 = font.widthOfTextAtSize(t, SMALL)
      page.drawText(t, { x: MARGIN + (COL_W - w2) / 2, y: y - SMALL, size: SMALL, font, color: headerMuted, opacity: 0.88 })
    }
    y -= 11
  }
  const contactParts = []
  if (biz.phone) contactParts.push(formatPhoneForReceipt(biz.phone))
  if (biz.rnc)   contactParts.push('RNC ' + biz.rnc)
  if (contactParts.length) {
    const t = contactParts.join('   ')
    const w = font.widthOfTextAtSize(t, SMALL)
    page.drawText(t, { x: MARGIN + (COL_W - w) / 2, y: y - SMALL, size: SMALL, font, color: headerMuted, opacity: 0.88 })
    y -= 11
  }

  // ═══ BODY ══════════════════════════════════════════════════════════════════
  y = height - HEADER_BAND_H - 12

  for (const line of lines) {
    y -= line.height
    if (line.type === 'rule') {
      page.drawLine({
        start: { x: MARGIN, y: y + line.height / 2 },
        end:   { x: width - MARGIN, y: y + line.height / 2 },
        thickness: 0.5,
        color: RGB(HAIRLINE),
      })
    } else if (line.type === 'pill') {
      // Small inverted caption (black block, white text) — invoice type
      const size = line.size || SMALL
      const t = String(line.text || '')
      const tw = fontB.widthOfTextAtSize(t, size)
      const padX = 6, padY = 3
      const pw = tw + padX * 2, ph = size + padY * 2
      const px = MARGIN + (COL_W - pw) / 2
      page.drawRectangle({ x: px, y: y - padY + 1, width: pw, height: ph, color: RGB(INK) })
      page.drawText(t, { x: px + padX, y: y + 2, size, font: fontB, color: RGB(PAPER) })
    } else if (line.type === 'text') {
      const f    = line.bold ? fontB : font
      const size = line.size || NORMAL
      const color = line.muted ? RGB(MUTED) : RGB(INK)
      const text = String(line.text || '')
      const x = line.right
        ? MARGIN + COL_W - f.widthOfTextAtSize(text, size)
        : line.center
          ? MARGIN + (COL_W - f.widthOfTextAtSize(text, size)) / 2
          : MARGIN
      page.drawText(text, { x, y, size, font: f, color })
    } else if (line.type === 'cols') {
      const f    = line.bold ? fontB : font
      const size = line.size || NORMAL
      const leftColor  = line.boldLeft ? RGB(INK) : RGB(MUTED)
      const leftFont   = line.boldLeft ? fontB : font
      const leftLabel  = line.upper ? String(line.left || '').toUpperCase() : String(line.left || '')
      page.drawText(leftLabel,  { x: MARGIN, y, size, font: leftFont, color: leftColor })
      const right = String(line.right || '')
      const xr = MARGIN + COL_W - f.widthOfTextAtSize(right, size)
      page.drawText(right, { x: xr, y, size, font: f, color: RGB(INK) })
    }
  }

  // ═══ CRIMSON TOTAL BOX ═════════════════════════════════════════════════════
  y -= 6
  const totalBoxY = y - TOTAL_BOX_H
  page.drawRectangle({
    x: MARGIN, y: totalBoxY,
    width: COL_W, height: TOTAL_BOX_H,
    color: RGB(CRIMSON),
  })
  const totalLabel = 'TOTAL'
  const totalAmt   = fmtRD(data.total)
  page.drawText(totalLabel, {
    x: MARGIN + 12, y: totalBoxY + (TOTAL_BOX_H - 14) / 2,
    size: 14, font: fontB, color: RGB(PAPER),
  })
  const amtW = fontB.widthOfTextAtSize(totalAmt, 15)
  page.drawText(totalAmt, {
    x: MARGIN + COL_W - 12 - amtW, y: totalBoxY + (TOTAL_BOX_H - 15) / 2,
    size: 15, font: fontB, color: RGB(PAPER),
  })
  y = totalBoxY - 10

  // ═══ QR VERIFICATION (e-CF only) ═══════════════════════════════════════════
  if (qrPngBase64) {
    const qrBytes = Uint8Array.from(atob(qrPngBase64), c => c.charCodeAt(0))
    const qrImage = await doc.embedPng(qrBytes)
    const header = 'COMPROBANTE FISCAL ELECTRONICO'
    const hw = fontB.widthOfTextAtSize(header, 7.5)
    page.drawText(header, { x: MARGIN + (COL_W - hw) / 2, y: y - 8, size: 7.5, font: fontB, color: RGB(INK) })
    y -= 16
    const qrX = MARGIN + (COL_W - QR_SIZE) / 2
    page.drawImage(qrImage, { x: qrX, y: y - QR_SIZE, width: QR_SIZE, height: QR_SIZE })
    y -= QR_SIZE + 4
    const label = 'Verifique en DGII'
    const labelW = font.widthOfTextAtSize(label, 7)
    page.drawText(label, { x: MARGIN + (COL_W - labelW) / 2, y: y - 7, size: 7, font, color: RGB(MUTED) })
    y -= 11
    if (data.securityCode) {
      const scLabel = `Codigo Seguridad  ${data.securityCode}`
      const scW = font.widthOfTextAtSize(scLabel, 6.5)
      page.drawText(scLabel, { x: MARGIN + (COL_W - scW) / 2, y: y - 7, size: 6.5, font, color: RGB(MUTED) })
      y -= 11
    }
    if (data.signatureDate) {
      const firmaStr = fmtFirmaDate(data.signatureDate)
      const firmaLabel = `Firma Digital  ${firmaStr}`
      const firmaW = font.widthOfTextAtSize(firmaLabel, 6.5)
      page.drawText(firmaLabel, { x: MARGIN + (COL_W - firmaW) / 2, y: y - 7, size: 6.5, font, color: RGB(MUTED) })
      y -= 11
    }
  }

  // ═══ EVIDENCIA FOTOGRÁFICA (v2.16.0 — mecánica) ════════════════════════════
  // data.photoEvidence: optional array of { phase: 'antes'|'despues', base64: 'data:image/jpeg;base64,...', caption }
  // Up to 4 photos rendered in a 2x2 grid. JPEG and PNG both accepted.
  if (Array.isArray(data.photoEvidence) && data.photoEvidence.length) {
    y -= 6
    const evHeader = 'EVIDENCIA FOTOGRAFICA'
    const evW = fontB.widthOfTextAtSize(evHeader, 7.5)
    page.drawText(evHeader, { x: MARGIN + (COL_W - evW) / 2, y: y - 8, size: 7.5, font: fontB, color: RGB(INK) })
    y -= 14
    const photos = data.photoEvidence.slice(0, 4)
    const cell = (COL_W - 6) / 2
    const rows = Math.ceil(photos.length / 2)
    for (let r = 0; r < rows; r++) {
      for (let cIdx = 0; cIdx < 2; cIdx++) {
        const idx = r * 2 + cIdx
        if (idx >= photos.length) continue
        const p = photos[idx]
        if (!p?.base64) continue
        try {
          const b64 = String(p.base64).replace(/^data:image\/(jpeg|jpg|png);base64,/, '')
          const bytes = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0))
          const isPng = String(p.base64).startsWith('data:image/png') || p.kind === 'png'
          const img = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
          const px = MARGIN + cIdx * (cell + 6)
          const py = y - (r * (cell + 12)) - cell
          page.drawImage(img, { x: px, y: py, width: cell, height: cell })
          const cap = (p.phase === 'despues' ? 'DESPUES' : 'ANTES') + (p.caption ? ' - ' + String(p.caption).slice(0, 18) : '')
          page.drawText(cap, { x: px, y: py - 8, size: 6.5, font, color: RGB(MUTED) })
        } catch { /* skip bad image silently */ }
      }
    }
    y -= rows * (cell + 12) + 8
  }

  // ═══ FOOTER — X logo mark + gracias + powered by ═══════════════════════════
  y -= 8
  const graceA = 'GRACIAS POR SU PREFERENCIA'
  const gaW = fontB.widthOfTextAtSize(graceA, 8)
  page.drawText(graceA, { x: MARGIN + (COL_W - gaW) / 2, y: y - 8, size: 8, font: fontB, color: RGB(INK) })
  y -= 12
  const graceB = 'Conserve este comprobante'
  const gbW = font.widthOfTextAtSize(graceB, 7)
  page.drawText(graceB, { x: MARGIN + (COL_W - gbW) / 2, y: y - 7, size: 7, font, color: RGB(MUTED) })
  y -= 16

  // X logo mark — vector, crimson: circle + two crossed lines
  const xCy = y - 6
  const xCx = PAGE_W / 2
  const xR  = 6
  page.drawCircle({ x: xCx, y: xCy, size: xR, borderColor: RGB(CRIMSON), borderWidth: 0.9, color: RGB(PAPER) })
  const d = xR * 0.58
  page.drawLine({ start: { x: xCx - d, y: xCy - d }, end: { x: xCx + d, y: xCy + d }, thickness: 1.1, color: RGB(CRIMSON) })
  page.drawLine({ start: { x: xCx - d, y: xCy + d }, end: { x: xCx + d, y: xCy - d }, thickness: 1.1, color: RGB(CRIMSON) })
  y -= (xR * 2 + 4)

  // Custom footer (Facturación tier custom branding) — owner-defined string
  // shown above the "Powered by" tagline. Wraps on COL_W. Up to 3 lines.
  const customFooter = (data.customFooter || data.biz?.invoice_footer || '').toString().trim()
  if (customFooter) {
    const cfSize = 6.5
    const wrap = (txt, maxW, sz) => {
      const words = txt.split(/\s+/)
      const out = []
      let cur = ''
      for (const w of words) {
        const test = cur ? cur + ' ' + w : w
        if (font.widthOfTextAtSize(test, sz) > maxW) { if (cur) out.push(cur); cur = w } else { cur = test }
      }
      if (cur) out.push(cur)
      return out
    }
    const lines2 = wrap(customFooter, COL_W, cfSize).slice(0, 3)
    for (const cl of lines2) {
      const w = font.widthOfTextAtSize(cl, cfSize)
      page.drawText(cl, { x: MARGIN + (COL_W - w) / 2, y: y - 7, size: cfSize, font, color: RGB(MUTED) })
      y -= 9
    }
    y -= 2
  }

  const tagline = 'Powered by Terminal X'
  const tw = font.widthOfTextAtSize(tagline, 6.5)
  page.drawText(tagline, { x: MARGIN + (COL_W - tw) / 2, y: y - 7, size: 6.5, font, color: RGB(MUTED) })

  const pdfBytes = await doc.save()
  const filename = `${(data.docNo || 'recibo').replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`
  return { pdfBytes, filename }
}

/**
 * Builds a receipt PDF and saves it to userData/receipts/{docNo}.pdf
 *
 * @param {object} data  Same shape as printClientReceipt data object
 * @returns {Promise<{ok: boolean, filePath?: string, error?: string}>}
 */
export async function saveReceiptPDF(data, api) {
  try {
    const { pdfBytes, filename } = await buildPDF(data)
    const base64 = btoa(String.fromCharCode(...pdfBytes))

    // Electron: save via IPC
    const pdfApi = api?.pdf || window.electronAPI?.pdf
    if (pdfApi?.save) {
      const result = await pdfApi.save({ filename, base64 })
      return result || { ok: false, error: 'IPC unavailable' }
    }

    // Web: download as file
    const byteChars = atob(base64)
    const byteArray = new Uint8Array(byteChars.length)
    for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i)
    const blob = new Blob([byteArray], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    return { ok: true, filePath: filename }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/**
 * Builds a receipt PDF and returns { base64, filename }.
 * Used for WhatsApp sending — does NOT save to disk.
 */
export async function buildReceiptPDFBase64(data) {
  const { pdfBytes, filename } = await buildPDF(data)
  const base64 = btoa(String.fromCharCode(...pdfBytes))
  return { base64, filename }
}

// ─────────────────────────────────────────────────────────────────────────
// FIX-M5 — Hoja técnica para aseguradora (Mapfre BHD / Universal / La Colonial).
//
// Letter-size diagnostic sheet that DR insurance adjusters sign off on before
// approving a claim. Layout is intentionally close to the carbon-copy form
// the adjusters were used to before going digital — taller name + RNC, the
// vehicle block, the inspection findings table, the parts/labor breakdown,
// and a signature row at the bottom.
//
// Inputs (all optional except wo):
//   wo:           { id, plate, make, model, year, vin, odometer_in_km,
//                   labor_total, parts_total, itbis, total, items[], notes,
//                   poliza_no, reclamo_no, aseguradora_status, inspection_json }
//   business:     { name, rnc, phone, address }
//   aseguradora:  { nombre, rnc, contacto_telefono }
//   client:       { name, rnc, phone }
//   inspection:   parsed inspection_json (optional override)
//   photos:       [{ phase, base64, caption }] — up to 4, embedded in the
//                 footer evidence grid
// ─────────────────────────────────────────────────────────────────────────
export async function buildInspectionReportPdf({
  wo, business = {}, aseguradora = {}, client = null, inspection = null, photos = [],
}) {
  const PW = 612, PH = 792, M = 36     // Letter US, 0.5" margins
  const doc   = await PDFDocument.create()
  const font  = await doc.embedFont(StandardFonts.Helvetica)
  const fontB = await doc.embedFont(StandardFonts.HelveticaBold)
  const page  = doc.addPage([PW, PH])
  const W     = PW - 2 * M
  let y = PH - M

  const wrap = (s, w, size, f) => {
    const out = []
    if (!s) return out
    const words = String(s).split(/\s+/)
    let line = ''
    for (const w_ of words) {
      const t = line ? line + ' ' + w_ : w_
      if (f.widthOfTextAtSize(t, size) > w) { if (line) out.push(line); line = w_ }
      else line = t
    }
    if (line) out.push(line)
    return out
  }

  // ── Header band ──
  page.drawRectangle({ x: 0, y: y - 56, width: PW, height: 56, color: RGB(CRIMSON) })
  page.drawText('HOJA TECNICA · ASEGURADORA', { x: M, y: y - 22, size: 11, font: fontB, color: RGB(PAPER) })
  page.drawText(String(business.name || 'TALLER MECANICO').toUpperCase(),
    { x: M, y: y - 40, size: 16, font: fontB, color: RGB(PAPER) })
  if (business.rnc) {
    page.drawText(`RNC ${business.rnc}`, { x: M, y: y - 52, size: 8, font, color: RGB(PAPER) })
  }
  // WO number — top right, big
  const woStr = `WO-${String(wo?.id ?? '').replace(/\D/g, '').padStart(4, '0')}`
  const woW = fontB.widthOfTextAtSize(woStr, 18)
  page.drawText(woStr, { x: PW - M - woW, y: y - 30, size: 18, font: fontB, color: RGB(PAPER) })
  page.drawText(fmtDate(new Date()), {
    x: PW - M - font.widthOfTextAtSize(fmtDate(new Date()), 8),
    y: y - 48, size: 8, font, color: RGB(PAPER),
  })
  y -= 70

  // ── Aseguradora + cliente block (two columns) ──
  const colW = (W - 12) / 2
  const drawLabel = (x, yy, label, value) => {
    page.drawText(String(label).toUpperCase(), { x, y: yy, size: 7, font: fontB, color: RGB(MUTED) })
    page.drawText(String(value || '—'), { x, y: yy - 11, size: 10.5, font: fontB, color: RGB(INK) })
  }
  drawLabel(M, y, 'Aseguradora', aseguradora.nombre || '—')
  drawLabel(M, y - 28, 'RNC Aseguradora', aseguradora.rnc || '—')
  drawLabel(M, y - 56, 'Póliza', wo?.poliza_no || '—')
  drawLabel(M, y - 84, 'Reclamo #', wo?.reclamo_no || '—')

  drawLabel(M + colW + 12, y, 'Cliente', client?.name || '—')
  drawLabel(M + colW + 12, y - 28, 'Teléfono cliente', client?.phone || '—')
  drawLabel(M + colW + 12, y - 56, 'Estado del reclamo', String(wo?.aseguradora_status || 'pendiente').toUpperCase())
  drawLabel(M + colW + 12, y - 84, 'Fecha de servicio', fmtDate(new Date()))
  y -= 104

  page.drawLine({ start: { x: M, y }, end: { x: PW - M, y }, thickness: 0.6, color: RGB(INK) })
  y -= 14

  // ── Vehicle block ──
  page.drawText('VEHICULO', { x: M, y, size: 8, font: fontB, color: RGB(CRIMSON) })
  y -= 14
  const vehGrid = [
    ['Placa',    wo?.plate || '—'],
    ['Marca',    wo?.make  || '—'],
    ['Modelo',   wo?.model || '—'],
    ['Año',      wo?.year  || '—'],
    ['VIN',      wo?.vin   ? String(wo.vin).slice(0, 22) : '—'],
    ['Kilometraje', wo?.odometer_in_km != null ? `${Number(wo.odometer_in_km).toLocaleString('en-US')} km` : '—'],
  ]
  const cellW = W / 3
  for (let i = 0; i < vehGrid.length; i++) {
    const col = i % 3
    const row = Math.floor(i / 3)
    const cx = M + col * cellW
    const cy = y - row * 26
    page.drawText(vehGrid[i][0].toUpperCase(), { x: cx, y: cy, size: 7, font: fontB, color: RGB(MUTED) })
    page.drawText(String(vehGrid[i][1]), { x: cx, y: cy - 11, size: 10, font, color: RGB(INK) })
  }
  y -= 60

  page.drawLine({ start: { x: M, y }, end: { x: PW - M, y }, thickness: 0.6, color: RGB(INK) })
  y -= 14

  // ── Diagnóstico (inspection) ──
  page.drawText('DIAGNOSTICO TECNICO', { x: M, y, size: 8, font: fontB, color: RGB(CRIMSON) })
  y -= 12
  const insp = inspection || (() => {
    try { return typeof wo?.inspection_json === 'string' ? JSON.parse(wo.inspection_json || '{}') : (wo?.inspection_json || {}) }
    catch { return {} }
  })()
  const inspItems = insp?.items || {}
  const inspKeys = Object.keys(inspItems).slice(0, 14)
  if (inspKeys.length === 0) {
    page.drawText('Sin inspección registrada.', { x: M, y, size: 9, font, color: RGB(MUTED) })
    y -= 14
  } else {
    // Two-column inspection list
    const colWidth = (W - 12) / 2
    inspKeys.forEach((key, idx) => {
      const it = inspItems[key] || {}
      const col = idx % 2
      const row = Math.floor(idx / 2)
      const cx = M + col * (colWidth + 12)
      const cy = y - row * 16
      const status = (it.status || '?').toUpperCase()
      const statusColor = status === 'PASS' ? [0.1, 0.5, 0.2]
                       : status === 'WARN' ? [0.78, 0.55, 0.05]
                       : status === 'FAIL' ? CRIMSON
                       : MUTED
      // Status pill
      page.drawRectangle({ x: cx, y: cy - 2, width: 32, height: 10, color: RGB(statusColor) })
      page.drawText(status.slice(0, 4), { x: cx + 3, y: cy, size: 6.5, font: fontB, color: RGB(PAPER) })
      // Label
      page.drawText(String(key).slice(0, 32), { x: cx + 38, y: cy, size: 9, font: fontB, color: RGB(INK) })
      if (it.note) {
        page.drawText(String(it.note).slice(0, 36), { x: cx + 38, y: cy - 8, size: 7, font, color: RGB(MUTED) })
      }
    })
    y -= Math.ceil(inspKeys.length / 2) * 16 + 6
  }

  page.drawLine({ start: { x: M, y }, end: { x: PW - M, y }, thickness: 0.6, color: RGB(INK) })
  y -= 14

  // ── Items + totals ──
  page.drawText('TRABAJO REALIZADO', { x: M, y, size: 8, font: fontB, color: RGB(CRIMSON) })
  y -= 14
  // Header row
  page.drawRectangle({ x: M, y: y - 2, width: W, height: 14, color: RGB(INK) })
  page.drawText('TIPO', { x: M + 6,  y: y + 2, size: 7.5, font: fontB, color: RGB(PAPER) })
  page.drawText('DESCRIPCION', { x: M + 60, y: y + 2, size: 7.5, font: fontB, color: RGB(PAPER) })
  const colCantX  = PW - M - 200
  const colPriceX = PW - M - 130
  const colTotalX = PW - M - 60
  page.drawText('CANT', { x: colCantX,  y: y + 2, size: 7.5, font: fontB, color: RGB(PAPER) })
  page.drawText('PRECIO',{ x: colPriceX, y: y + 2, size: 7.5, font: fontB, color: RGB(PAPER) })
  page.drawText('TOTAL', { x: colTotalX, y: y + 2, size: 7.5, font: fontB, color: RGB(PAPER) })
  y -= 14

  const items = Array.isArray(wo?.items) ? wo.items : []
  for (const it of items) {
    const typeLabel = it.type === 'part' ? 'REPUESTO' : it.type === 'service' ? 'SERVICIO' : 'MANO DE OBRA'
    const desc = String(it.name || '—').slice(0, 50)
    const qty = Number(it.qty ?? it.quantity ?? 1)
    const price = Number(it.unit_price || 0)
    const total = it.total != null ? Number(it.total) : qty * price
    page.drawText(typeLabel, { x: M + 6, y, size: 7.5, font, color: RGB(MUTED) })
    page.drawText(desc, { x: M + 60, y, size: 9, font, color: RGB(INK) })
    page.drawText(String(qty), { x: colCantX, y, size: 9, font, color: RGB(INK) })
    page.drawText(fmtRD(price), { x: colPriceX, y, size: 9, font, color: RGB(INK) })
    page.drawText(fmtRD(total), { x: colTotalX, y, size: 9, font: fontB, color: RGB(INK) })
    y -= 13
    page.drawLine({ start: { x: M, y: y + 4 }, end: { x: PW - M, y: y + 4 }, thickness: 0.2, color: RGB(HAIRLINE) })
    if (y < M + 220) break
  }
  y -= 6

  // Totals box
  const totalsY = y
  const drawTotalRow = (label, value, bold = false) => {
    page.drawText(label, { x: PW - M - 200, y, size: 9, font: bold ? fontB : font, color: RGB(INK) })
    page.drawText(fmtRD(value), { x: PW - M - 90, y, size: bold ? 11 : 9, font: bold ? fontB : font, color: bold ? RGB(CRIMSON) : RGB(INK) })
    y -= 12
  }
  drawTotalRow('Mano de obra', wo?.labor_total)
  drawTotalRow('Repuestos',    wo?.parts_total)
  drawTotalRow('ITBIS 18%',    wo?.itbis)
  page.drawLine({ start: { x: PW - M - 200, y: y + 4 }, end: { x: PW - M, y: y + 4 }, thickness: 0.6, color: RGB(INK) })
  drawTotalRow('TOTAL',        wo?.total ?? wo?.estimated_total, true)
  y -= 6

  // ── Photo evidence (if any) ──
  if (Array.isArray(photos) && photos.length) {
    page.drawText('EVIDENCIA FOTOGRAFICA', { x: M, y, size: 8, font: fontB, color: RGB(CRIMSON) })
    y -= 12
    const slots = photos.slice(0, 4)
    const cell = (W - 12) / 2
    for (let i = 0; i < slots.length; i++) {
      const p = slots[i]
      if (!p?.base64) continue
      try {
        const b64 = String(p.base64).replace(/^data:image\/(jpeg|jpg|png);base64,/, '')
        const bytes = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0))
        const isPng = String(p.base64).startsWith('data:image/png')
        const img = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
        const col = i % 2
        const row = Math.floor(i / 2)
        const px = M + col * (cell + 12)
        const py = y - (row + 1) * (cell * 0.6) - row * 14
        page.drawImage(img, { x: px, y: py, width: cell, height: cell * 0.6 })
        const cap = (p.phase === 'despues' ? 'DESPUES' : 'ANTES') + (p.caption ? ' · ' + String(p.caption).slice(0, 20) : '')
        page.drawText(cap, { x: px, y: py - 10, size: 7, font, color: RGB(MUTED) })
      } catch { /* skip bad image */ }
    }
    y -= Math.ceil(slots.length / 2) * (cell * 0.6 + 14) + 6
  }

  // ── Notes ──
  if (wo?.notes) {
    page.drawText('NOTAS', { x: M, y, size: 8, font: fontB, color: RGB(CRIMSON) })
    y -= 12
    const wrapped = wrap(String(wo.notes), W, 9, font).slice(0, 4)
    for (const ln of wrapped) {
      page.drawText(ln, { x: M, y, size: 9, font, color: RGB(INK) })
      y -= 11
    }
    y -= 4
  }

  // ── Signature row (bottom of page) ──
  const sigY = M + 60
  page.drawLine({ start: { x: M, y: sigY }, end: { x: M + 220, y: sigY }, thickness: 0.6, color: RGB(INK) })
  page.drawText('FIRMA TECNICO', { x: M, y: sigY - 12, size: 7, font: fontB, color: RGB(MUTED) })

  page.drawLine({ start: { x: PW - M - 220, y: sigY }, end: { x: PW - M, y: sigY }, thickness: 0.6, color: RGB(INK) })
  page.drawText('FIRMA AJUSTADOR ASEGURADORA', { x: PW - M - 220, y: sigY - 12, size: 7, font: fontB, color: RGB(MUTED) })

  page.drawText(`Powered by Terminal X · DGII Emisor #42483`, {
    x: M, y: M + 18, size: 7, font, color: RGB(MUTED),
  })
  totalsY // referenced to silence linter; geometry intentionally fixed.

  const pdfBytes = await doc.save()
  const filename = `${woStr}_hoja_tecnica.pdf`
  const base64 = btoa(String.fromCharCode(...pdfBytes))
  return { pdfBytes, base64, filename }
}

function formatFormaPagoPDF(f) {
  const map = {
    cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', cheque: 'Cheque', credit: 'A credito',
    efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia',
  }
  return map[f] || (f ? f.charAt(0).toUpperCase() + f.slice(1) : 'Efectivo')
}

function buildLines(data) {
  const lines = []

  function text(t, opts = {})   { lines.push({ type: 'text', text: t, height: LINE_H, ...opts }) }
  function cols(l, r, opts = {}) { lines.push({ type: 'cols', left: l, right: r, height: LINE_H, ...opts }) }
  function pill(t, opts = {})   { lines.push({ type: 'pill', text: t, height: 18, ...opts }) }
  function rule()               { lines.push({ type: 'rule', height: 8 }) }
  function gap(h = 4)           { lines.push({ type: 'rule', height: h }) }

  const isCredito = ['E31', 'B01'].includes(data.ncfType)
  pill(isCredito ? 'FACTURA DE CREDITO FISCAL' : 'FACTURA CONSUMIDOR FINAL', { size: SMALL })
  gap(6)

  // Metadata — small caps labels, bold right-values
  cols('FECHA', fmtDate(data.paidAt), { upper: true, size: SMALL })
  cols('DOC',   data.docNo || '-',    { upper: true, size: SMALL })
  cols('NCF',   data.ncf || '-',      { upper: true, size: SMALL })
  if (data.cajero)       cols('CAJERO',   data.cajero,       { upper: true, size: SMALL })
  if (data.lavador)      cols('LAVADOR',  data.lavador,      { upper: true, size: SMALL })
  if (data.vehiclePlate) cols('VEHICULO', data.vehiclePlate, { upper: true, size: SMALL })
  // v2.16.0 — mecánica vehicle block extension
  if (data.vehicleVin) cols('VIN', String(data.vehicleVin).slice(0, 26), { upper: true, size: SMALL })
  if (data.vehicleMake || data.vehicleModel) {
    const mm = [data.vehicleMake, data.vehicleModel].filter(Boolean).join(' ').slice(0, 26)
    cols('MARCA/MODELO', mm, { upper: true, size: SMALL })
  }
  if (data.vehicleKm != null && data.vehicleKm !== '') {
    cols('KILOMETRAJE', `${Number(data.vehicleKm).toLocaleString('en-US')} KM`, { upper: true, size: SMALL })
  }

  if (data.client?.name || data.client?.rnc || data.client?.phone) {
    gap(4)
    if (data.client?.name) cols('CLIENTE', data.client.name, { upper: true, size: SMALL })
    if (data.client?.rnc)  cols('RNC',     data.client.rnc,  { upper: true, size: SMALL })
    if (data.client?.phone) cols('TEL',    formatPhoneForReceipt(data.client.phone), { upper: true, size: SMALL })
  }

  if (Array.isArray(data.payment_parts) && data.payment_parts.length > 1) {
    cols('FORMA PAGO', 'MIXTO', { upper: true, size: SMALL })
    data.payment_parts.forEach(p => {
      const amt = Number(p?.amount) || 0
      const label = '  ' + (formatFormaPagoPDF(p?.method) || '').toString()
      cols(label, `RD$ ${amt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, { upper: true, size: SMALL })
    })
  } else {
    cols('FORMA PAGO', formatFormaPagoPDF(data.formaPago), { upper: true, size: SMALL })
  }
  if (data.tipo === 'credito') cols('TIPO VENTA', 'Credito', { upper: true, size: SMALL })

  rule()

  // Column header
  cols('DESCRIPCION', 'TOTAL', { bold: true, boldLeft: true, upper: true, size: SMALL })
  gap(4)

  // Items
  for (const svc of data.services || []) {
    const qty = svc.qty || svc.quantity || 1
    const name = qty > 1 ? `${qty}x ${svc.name}` : svc.name
    cols(name, fmtRD(svc.price * qty), { boldLeft: true, size: NORMAL })
  }

  rule()

  // Fiscal breakdown (hidden for B02/walk-in)
  const ncfStr = String(data.ncf || '').toUpperCase()
  const isFiscal = /^B01/.test(ncfStr) || /^B14/.test(ncfStr) || /^B15/.test(ncfStr) || /^E\d/.test(ncfStr)
  if (data.descuento > 0) cols('Descuento', '-' + fmtRD(data.descuento), { size: SMALL })
  if (isFiscal) {
    cols('Subtotal',    fmtRD(data.subtotal), { size: SMALL })
    cols('ITBIS',       fmtRD(data.itbis),    { size: SMALL })
  }
  if (data.ley > 0) cols('Ley 10%', fmtRD(data.ley), { size: SMALL })

  return lines
}
