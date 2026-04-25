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
  const FOOTER_H = 46 // X mark + powered by + grace lines
  const bodyH = lines.reduce((h, l) => h + l.height, 0)
  const pageH = HEADER_BAND_H + 10 + bodyH + TOTAL_BOX_H + 8 + qrBlockH + FOOTER_H + MARGIN

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
