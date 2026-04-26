/**
 * pdfContracts.js — Loan contract PDF builder using pdf-lib.
 *
 * Page 1: contract clauses (Spanish, formal tone, mandatory SB clauses)
 * Page 2: amortization schedule table
 * Page 3: client signature image + DPI photo
 *
 * Brand: Terminal X / Studio X — black/white/crimson #b3001e
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { formatAPR } from './apr.js'

const PAGE_W = 612    // US Letter
const PAGE_H = 792
const MARGIN = 54
const COL_W  = PAGE_W - MARGIN * 2

const CRIMSON  = rgb(0.702, 0, 0.118)
const INK      = rgb(0, 0, 0)
const MUTED    = rgb(0.42, 0.42, 0.42)
const HAIRLINE = rgb(0.78, 0.78, 0.78)
const PAPER    = rgb(1, 1, 1)

function fmtRD(n) {
  return 'RD$ ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(d) {
  if (!d) return '---'
  return new Date(d).toLocaleDateString('es-DO', { day: '2-digit', month: 'long', year: 'numeric' })
}
function fmtDateShort(d) {
  if (!d) return '---'
  return new Date(d).toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Wrap text into lines that fit within `maxWidth` at given size
function wrapLines(text, font, size, maxWidth) {
  const words = String(text || '').split(/\s+/)
  const out = []
  let line = ''
  for (const w of words) {
    const trial = line ? line + ' ' + w : w
    if (font.widthOfTextAtSize(trial, size) > maxWidth && line) {
      out.push(line); line = w
    } else {
      line = trial
    }
  }
  if (line) out.push(line)
  return out
}

async function tryEmbedImage(doc, dataUrl) {
  if (!dataUrl) return null
  try {
    if (typeof dataUrl !== 'string') return null
    const isPng  = dataUrl.startsWith('data:image/png')
    const isJpeg = dataUrl.startsWith('data:image/jp')
    if (!isPng && !isJpeg) return null
    const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), c => c.charCodeAt(0))
    return isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
  } catch { return null }
}

/**
 * Build the loan contract PDF.
 * @param {object} args
 * @param {object} args.loan      { principal, term_months, interest_rate, monthly_payment, mora_rate_daily, next_due_date, disbursed_at, notes }
 * @param {object} args.client    { full_name | name, dpi | rnc, phone, address }
 * @param {object} args.business  { legal_name | name, rnc, address, phone }
 * @param {Array}  args.schedule  amortization rows: { number, due_date, principal_portion, interest_portion, payment, balance }
 * @param {string} args.signatureDataUrl  PNG dataURL
 * @param {string} args.dpiDataUrl        PNG/JPEG dataURL
 * @param {string} [args.garantiaText]
 * @returns {Promise<Uint8Array>}
 */
export async function buildLoanContractPDF({
  loan, client, business, schedule = [], signatureDataUrl, dpiDataUrl, garantiaText,
}) {
  const doc   = await PDFDocument.create()
  const font  = await doc.embedFont(StandardFonts.Helvetica)
  const fontB = await doc.embedFont(StandardFonts.HelveticaBold)

  const principal       = Number(loan?.principal) || 0
  const termMonths      = Number(loan?.term_months) || 0
  const monthlyRate     = (Number(loan?.interest_rate) || 0) / 100
  const monthlyPayment  = Number(loan?.monthly_payment) || 0
  // C7 — pull from loan, then business default, then DR-typical 0.5%/day fallback (decimal).
  // `mora_rate_daily` is stored as a decimal everywhere (0.005 = 0.5%/día). Display as percent.
  const moraRateDecimal = (loan?.mora_rate_daily != null ? Number(loan.mora_rate_daily)
                           : business?.mora_rate_daily != null ? Number(business.mora_rate_daily)
                           : 0.005)
  const moraRatePct     = (moraRateDecimal * 100).toFixed(2)
  const nextDueDate     = loan?.next_due_date || (schedule[schedule.length - 1]?.due_date)

  const clientName = client?.full_name || client?.name || '—'
  const clientDpi  = client?.dpi || client?.rnc || client?.cedula || '—'
  const bizName    = business?.legal_name || business?.name || 'TERMINAL X'
  const bizRnc     = business?.rnc || '—'
  const today      = new Date()

  // ════════════════════════════════════════════════════════════════════════════
  // PAGE 1 — CONTRACT
  // ════════════════════════════════════════════════════════════════════════════
  let page = doc.addPage([PAGE_W, PAGE_H])

  // Crimson header band
  const HEADER_H = 60
  page.drawRectangle({ x: 0, y: PAGE_H - HEADER_H, width: PAGE_W, height: HEADER_H, color: CRIMSON })
  const title = 'CONTRATO DE PRÉSTAMO PERSONAL'
  const titleW = fontB.widthOfTextAtSize(title, 18)
  page.drawText(title, {
    x: (PAGE_W - titleW) / 2, y: PAGE_H - HEADER_H + 22,
    size: 18, font: fontB, color: PAPER,
  })

  let y = PAGE_H - HEADER_H - 28

  // Intro
  const intro =
    `Entre ${bizName}, RNC ${bizRnc} (en adelante "EL ACREEDOR"), ` +
    `y ${clientName}, cédula ${clientDpi} (en adelante "EL DEUDOR"), ` +
    `se acuerdan las siguientes cláusulas:`
  for (const ln of wrapLines(intro, font, 11, COL_W)) {
    page.drawText(ln, { x: MARGIN, y, size: 11, font, color: INK }); y -= 15
  }
  y -= 8

  const clauses = [
    {
      title: 'PRIMERO — MONTO',
      body: `EL ACREEDOR otorga a EL DEUDOR la suma de ${fmtRD(principal)} en calidad de préstamo personal, recibida a su entera satisfacción a la fecha de la firma del presente contrato.`,
    },
    {
      title: 'SEGUNDO — TASA DE INTERÉS',
      body: `La tasa pactada es de ${formatAPR(monthlyRate)}. Esta tasa se aplica sobre el saldo de capital adeudado y se devenga mensualmente.`,
    },
    {
      title: 'TERCERO — PLAZO Y CUOTA',
      body: `El plazo del préstamo es de ${termMonths} meses, con cuota mensual de ${fmtRD(monthlyPayment)} y vencimiento final al ${fmtDate(nextDueDate)}. EL DEUDOR se obliga a pagar puntualmente cada cuota conforme a la tabla de amortización anexa.`,
    },
    {
      title: 'CUARTO — MORA',
      body: `En caso de atraso en cualquier pago, se aplicará una mora de ${moraRatePct}% diaria sobre el saldo vencido, sin perjuicio del derecho del ACREEDOR de exigir el pago total anticipado del préstamo.`,
    },
    {
      title: 'QUINTO — GARANTÍA',
      body: garantiaText && garantiaText.trim() ? garantiaText.trim() : 'Sin garantía específica. El presente préstamo se otorga con la sola firma de EL DEUDOR.',
    },
    {
      title: 'SEXTO — JURISDICCIÓN',
      body: 'Las partes se someten a los tribunales competentes de la República Dominicana, renunciando a cualquier otro fuero que pudiera corresponderles.',
    },
    {
      title: 'SÉPTIMO — ACEPTACIÓN',
      body: 'Las partes declaran haber leído íntegramente este contrato, comprenderlo y aceptarlo en todos sus términos, firmando en señal de conformidad.',
    },
  ]

  for (const c of clauses) {
    if (y < MARGIN + 80) { page = doc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN }
    page.drawText(c.title, { x: MARGIN, y, size: 11, font: fontB, color: CRIMSON }); y -= 14
    for (const ln of wrapLines(c.body, font, 10.5, COL_W)) {
      if (y < MARGIN + 60) { page = doc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN }
      page.drawText(ln, { x: MARGIN, y, size: 10.5, font, color: INK }); y -= 14
    }
    y -= 6
  }

  // Footer block — signing line
  if (y < MARGIN + 100) { page = doc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN }
  y -= 10
  const firmaLine = `Firmado en _________________________, a los ${fmtDate(today)}.`
  page.drawText(firmaLine, { x: MARGIN, y, size: 10.5, font, color: INK }); y -= 40

  // Two signature columns
  const sigColW = (COL_W - 40) / 2
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + sigColW, y }, thickness: 0.6, color: INK })
  page.drawLine({ start: { x: MARGIN + sigColW + 40, y }, end: { x: MARGIN + COL_W, y }, thickness: 0.6, color: INK })
  y -= 12
  page.drawText('EL DEUDOR', { x: MARGIN, y, size: 9, font: fontB, color: INK })
  page.drawText('EL ACREEDOR', { x: MARGIN + sigColW + 40, y, size: 9, font: fontB, color: INK })
  y -= 12
  page.drawText(clientName, { x: MARGIN, y, size: 9, font, color: MUTED })
  page.drawText(bizName,    { x: MARGIN + sigColW + 40, y, size: 9, font, color: MUTED })
  y -= 11
  page.drawText(`Cédula: ${clientDpi}`, { x: MARGIN, y, size: 8.5, font, color: MUTED })
  page.drawText(`RNC: ${bizRnc}`,       { x: MARGIN + sigColW + 40, y, size: 8.5, font, color: MUTED })

  // Annex notes
  y -= 28
  page.drawText('Anexo: Tabla de amortización (página siguiente)', { x: MARGIN, y, size: 8.5, font, color: MUTED }); y -= 11
  page.drawText('Anexo: Firma del deudor y cédula (última página)', { x: MARGIN, y, size: 8.5, font, color: MUTED })

  // ════════════════════════════════════════════════════════════════════════════
  // PAGE 2 — AMORTIZATION SCHEDULE
  // ════════════════════════════════════════════════════════════════════════════
  page = doc.addPage([PAGE_W, PAGE_H])
  page.drawRectangle({ x: 0, y: PAGE_H - 40, width: PAGE_W, height: 40, color: CRIMSON })
  const t2 = 'TABLA DE AMORTIZACIÓN'
  const t2W = fontB.widthOfTextAtSize(t2, 14)
  page.drawText(t2, { x: (PAGE_W - t2W) / 2, y: PAGE_H - 27, size: 14, font: fontB, color: PAPER })

  y = PAGE_H - 60
  page.drawText(`${clientName}  •  ${formatAPR(monthlyRate)}  •  ${termMonths} meses`, {
    x: MARGIN, y, size: 9.5, font, color: MUTED,
  })
  y -= 18

  // Table header
  const cols = [
    { label: '#',        x: MARGIN,           w: 26,  align: 'left'  },
    { label: 'Fecha',    x: MARGIN + 28,      w: 80,  align: 'left'  },
    { label: 'Capital',  x: MARGIN + 110,     w: 90,  align: 'right' },
    { label: 'Interés',  x: MARGIN + 205,     w: 90,  align: 'right' },
    { label: 'Cuota',    x: MARGIN + 300,     w: 95,  align: 'right' },
    { label: 'Balance',  x: MARGIN + 400,     w: 100, align: 'right' },
  ]
  page.drawRectangle({ x: MARGIN - 2, y: y - 4, width: COL_W + 4, height: 18, color: rgb(0.96, 0.96, 0.96) })
  for (const c of cols) {
    const w = fontB.widthOfTextAtSize(c.label, 9)
    const x = c.align === 'right' ? c.x + c.w - w : c.x
    page.drawText(c.label, { x, y, size: 9, font: fontB, color: INK })
  }
  y -= 16

  for (const row of schedule) {
    if (y < MARGIN + 24) {
      page = doc.addPage([PAGE_W, PAGE_H])
      y = PAGE_H - MARGIN
    }
    const vals = [
      String(row.number ?? ''),
      fmtDateShort(row.due_date),
      fmtRD(row.principal_portion),
      fmtRD(row.interest_portion),
      fmtRD(row.payment),
      fmtRD(row.balance),
    ]
    cols.forEach((c, i) => {
      const v = vals[i] || ''
      const tw = font.widthOfTextAtSize(v, 9)
      const x  = c.align === 'right' ? c.x + c.w - tw : c.x
      page.drawText(v, { x, y, size: 9, font, color: INK })
    })
    page.drawLine({
      start: { x: MARGIN, y: y - 3 }, end: { x: MARGIN + COL_W, y: y - 3 },
      thickness: 0.3, color: HAIRLINE,
    })
    y -= 14
  }

  // Totals row
  const totalPay      = schedule.reduce((s, r) => s + (Number(r.payment) || 0), 0)
  const totalInterest = schedule.reduce((s, r) => s + (Number(r.interest_portion) || 0), 0)
  if (y < MARGIN + 30) { page = doc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN }
  y -= 6
  page.drawRectangle({ x: MARGIN - 2, y: y - 4, width: COL_W + 4, height: 18, color: CRIMSON })
  page.drawText('TOTALES', { x: MARGIN, y, size: 9.5, font: fontB, color: PAPER })
  const tIntStr = fmtRD(totalInterest)
  const tPayStr = fmtRD(totalPay)
  page.drawText(tIntStr, { x: MARGIN + 205 + 90 - fontB.widthOfTextAtSize(tIntStr, 9.5), y, size: 9.5, font: fontB, color: PAPER })
  page.drawText(tPayStr, { x: MARGIN + 300 + 95 - fontB.widthOfTextAtSize(tPayStr, 9.5), y, size: 9.5, font: fontB, color: PAPER })

  // ════════════════════════════════════════════════════════════════════════════
  // PAGE 3 — SIGNATURE + DPI
  // ════════════════════════════════════════════════════════════════════════════
  page = doc.addPage([PAGE_W, PAGE_H])
  page.drawRectangle({ x: 0, y: PAGE_H - 40, width: PAGE_W, height: 40, color: CRIMSON })
  const t3 = 'ANEXO — IDENTIFICACIÓN Y FIRMA'
  const t3W = fontB.widthOfTextAtSize(t3, 14)
  page.drawText(t3, { x: (PAGE_W - t3W) / 2, y: PAGE_H - 27, size: 14, font: fontB, color: PAPER })

  y = PAGE_H - 70
  page.drawText('FIRMA DEL DEUDOR', { x: MARGIN, y, size: 10, font: fontB, color: CRIMSON }); y -= 14

  const sigImg = await tryEmbedImage(doc, signatureDataUrl)
  const sigBoxW = COL_W
  const sigBoxH = 140
  page.drawRectangle({
    x: MARGIN, y: y - sigBoxH, width: sigBoxW, height: sigBoxH,
    borderColor: HAIRLINE, borderWidth: 0.6, color: PAPER,
  })
  if (sigImg) {
    const ar = sigImg.width / sigImg.height
    let w = sigBoxW - 20, h = w / ar
    if (h > sigBoxH - 20) { h = sigBoxH - 20; w = h * ar }
    page.drawImage(sigImg, {
      x: MARGIN + (sigBoxW - w) / 2,
      y: y - sigBoxH + (sigBoxH - h) / 2,
      width: w, height: h,
    })
  }
  y -= sigBoxH + 10
  page.drawText(`${clientName}  •  Cédula: ${clientDpi}`, { x: MARGIN, y, size: 9.5, font, color: MUTED })

  y -= 28
  page.drawText('CÉDULA DE IDENTIDAD', { x: MARGIN, y, size: 10, font: fontB, color: CRIMSON }); y -= 14

  const dpiImg = await tryEmbedImage(doc, dpiDataUrl)
  const dpiBoxW = COL_W
  const dpiBoxH = Math.min(360, y - MARGIN - 40)
  page.drawRectangle({
    x: MARGIN, y: y - dpiBoxH, width: dpiBoxW, height: dpiBoxH,
    borderColor: HAIRLINE, borderWidth: 0.6, color: PAPER,
  })
  if (dpiImg) {
    const ar = dpiImg.width / dpiImg.height
    let w = dpiBoxW - 20, h = w / ar
    if (h > dpiBoxH - 20) { h = dpiBoxH - 20; w = h * ar }
    page.drawImage(dpiImg, {
      x: MARGIN + (dpiBoxW - w) / 2,
      y: y - dpiBoxH + (dpiBoxH - h) / 2,
      width: w, height: h,
    })
  }

  // Footer
  page.drawText(`Generado el ${fmtDate(today)} — ${bizName}`, {
    x: MARGIN, y: MARGIN - 10, size: 8, font, color: MUTED,
  })

  return await doc.save()
}
