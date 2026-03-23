/**
 * pdf.js — Receipt PDF generation using pdf-lib
 *
 * Generates a receipt PDF and saves it to userData/receipts/ via Electron IPC.
 * Files are named by ticket number: T-001.pdf, E320000001.pdf, etc.
 * Supports embedded QR codes for e-CF receipts.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import QRCode from 'qrcode'

// 80mm receipt width in pts (1mm ≈ 2.835 pts). Height is dynamic.
const PAGE_W  = 226   // 80mm in pts
const MARGIN  = 12
const COL_W   = PAGE_W - MARGIN * 2
const LINE_H  = 13
const SMALL   = 8
const NORMAL  = 9
const LARGE   = 13
const QR_SIZE = 90

function fmtDate(d = new Date()) {
  return d.toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })
}

function fmtRD(n) {
  return 'RD$ ' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Generate a QR code PNG as a data URL, then extract the base64 portion.
 * Returns null if generation fails or no eNCF provided.
 */
async function generateQRPng(eNCF) {
  if (!eNCF) return null
  try {
    const verificationUrl = `https://ecf.dgii.gov.do/consultatimbre?eNCF=${encodeURIComponent(eNCF)}`
    const dataUrl = await QRCode.toDataURL(verificationUrl, { width: QR_SIZE * 2, margin: 1 })
    // Strip the data:image/png;base64, prefix
    return dataUrl.split(',')[1]
  } catch {
    return null
  }
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
    qrPngBase64 = await generateQRPng(data.ncf)
  }

  // Try to embed business logo
  let logoImage = null
  const LOGO_H = 40
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

  const logoBlockH = logoImage ? LOGO_H + 6 : 0
  const qrBlockH = qrPngBase64 ? QR_SIZE + 20 : 0
  const pageH = MARGIN * 2 + logoBlockH + lines.reduce((h, l) => h + l.height, 0) + qrBlockH + 10

  const page = doc.addPage([PAGE_W, pageH])
  const { width, height } = page.getSize()

  let y = height - MARGIN

  // Draw logo at top center
  if (logoImage) {
    const aspect = logoImage.width / logoImage.height
    const logoW = Math.min(LOGO_H * aspect, COL_W * 0.6)
    const logoX = MARGIN + (COL_W - logoW) / 2
    page.drawImage(logoImage, { x: logoX, y: y - LOGO_H, width: logoW, height: LOGO_H })
    y -= LOGO_H + 6
  }

  for (const line of lines) {
    y -= line.height
    if (line.type === 'rule') {
      page.drawLine({
        start: { x: MARGIN, y: y + line.height / 2 },
        end:   { x: width - MARGIN, y: y + line.height / 2 },
        thickness: 0.5,
        color: rgb(0.8, 0.8, 0.8),
      })
    } else if (line.type === 'text') {
      const f    = line.bold ? fontB : font
      const size = line.size || NORMAL
      const text = String(line.text || '')
      const x = line.right
        ? MARGIN + COL_W - f.widthOfTextAtSize(text, size)
        : line.center
          ? MARGIN + (COL_W - f.widthOfTextAtSize(text, size)) / 2
          : MARGIN
      page.drawText(text, { x, y, size, font: f, color: rgb(0, 0, 0) })
      if (line.right2) {
        const t2 = String(line.right2)
        const x2 = MARGIN + COL_W - f.widthOfTextAtSize(t2, size)
        page.drawText(t2, { x: x2, y, size, font: f, color: rgb(0.3, 0.3, 0.3) })
      }
    } else if (line.type === 'cols') {
      const f    = line.bold ? fontB : font
      const size = line.size || NORMAL
      page.drawText(String(line.left || ''),  { x: MARGIN, y, size, font: f, color: rgb(0.3, 0.3, 0.3) })
      const right = String(line.right || '')
      const xr = MARGIN + COL_W - f.widthOfTextAtSize(right, size)
      page.drawText(right, { x: xr, y, size, font: f, color: rgb(0, 0, 0) })
    }
  }

  // Embed QR code for e-CF receipts
  if (qrPngBase64) {
    const qrBytes = Uint8Array.from(atob(qrPngBase64), c => c.charCodeAt(0))
    const qrImage = await doc.embedPng(qrBytes)
    y -= 6
    const qrX = MARGIN + (COL_W - QR_SIZE) / 2
    page.drawImage(qrImage, { x: qrX, y: y - QR_SIZE, width: QR_SIZE, height: QR_SIZE })
    y -= QR_SIZE + 2
    const label = 'Verificar en DGII'
    const labelW = font.widthOfTextAtSize(label, 7)
    page.drawText(label, { x: MARGIN + (COL_W - labelW) / 2, y: y - 8, size: 7, font, color: rgb(0.4, 0.4, 0.4) })
  }

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

function buildLines(data) {
  const lines = []

  function text(t, opts = {})   { lines.push({ type: 'text', text: t, height: LINE_H, ...opts }) }
  function cols(l, r, opts = {}) { lines.push({ type: 'cols', left: l, right: r, height: LINE_H, ...opts }) }
  function rule()               { lines.push({ type: 'rule', height: 8 }) }
  function gap(h = 4)           { lines.push({ type: 'rule', height: h }) } // invisible spacer

  const biz = data.biz || {}
  // Header
  text(biz.name || 'CAR WASH', { bold: true, size: LARGE, center: true })
  if (biz.address) text(biz.address, { size: SMALL, center: true })
  if (biz.phone)   text('Tel: ' + biz.phone, { size: SMALL, center: true })
  if (biz.rnc)     text('RNC: ' + biz.rnc, { size: SMALL, center: true })
  rule()

  const isCredito = ['E31', 'B01'].includes(data.ncfType)
  text(isCredito ? 'FACTURA DE CREDITO FISCAL' : 'FACTURA CONSUMIDOR FINAL', { bold: true, center: true, size: SMALL })
  gap()

  cols('Fecha:', fmtDate(data.paidAt))
  cols('NCF:', data.ncf || '-')
  cols('Doc:', data.docNo || '-')
  if (data.cajero)  cols('Cajero:', data.cajero)
  if (data.lavador) cols('Lavador:', data.lavador)
  if (data.vehiclePlate) cols('Vehiculo:', data.vehiclePlate)
  if (data.client?.name) cols('Cliente:', data.client.name)
  if (data.client?.rnc)  cols('RNC:', data.client.rnc)
  rule()

  // Services
  for (const svc of data.services || []) {
    cols(svc.name, fmtRD(svc.price))
  }
  rule()

  // Totals
  cols('Subtotal:', fmtRD(data.subtotal))
  cols('ITBIS (18%):', fmtRD(data.itbis))
  cols('Ley (10%):', fmtRD(data.ley))
  if (data.descuento > 0) cols('Descuento:', '-' + fmtRD(data.descuento))
  gap(2)
  cols('TOTAL:', fmtRD(data.total), { bold: true, size: LARGE })
  gap()
  cols('Forma de pago:', data.formaPago || 'Efectivo')
  rule()

  text('Gracias por preferirnos!', { center: true, size: SMALL })
  text('Conserve este comprobante', { center: true, size: SMALL })
  gap()
  text('- Powered by Terminal X -', { center: true, size: 7 })

  return lines
}
