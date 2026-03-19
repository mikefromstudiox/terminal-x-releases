/**
 * printer.js — Thermal receipt printing service
 *
 * Sends ESC/POS formatted commands to the configured thermal printer
 * via Electron IPC → main process → system printer.
 *
 * If no printer is found (dev mode or no hardware), falls back to
 * opening a browser print dialog with an HTML preview window.
 *
 * ESC/POS reference: https://reference.epson-biz.com/modules/ref_escpos/
 */

// ── ESC/POS command constants ─────────────────────────────────────────────────
const ESC  = '\x1B'
const GS   = '\x1D'
const LF   = '\x0A'
const INIT         = ESC + '@'          // Initialize printer
const ALIGN_LEFT   = ESC + 'a' + '\x00'
const ALIGN_CENTER = ESC + 'a' + '\x01'
const ALIGN_RIGHT  = ESC + 'a' + '\x02'
const BOLD_ON      = ESC + 'E' + '\x01'
const BOLD_OFF     = ESC + 'E' + '\x00'
const DOUBLE_ON    = GS  + '!' + '\x11' // Double width + height
const DOUBLE_OFF   = GS  + '!' + '\x00'
const UNDERLINE_ON = ESC + '-' + '\x01'
const UNDERLINE_OFF= ESC + '-' + '\x00'
const CUT          = GS  + 'V' + '\x41' + '\x03' // Partial cut
const DRAWER_KICK  = ESC + 'p' + '\x00' + '\x19' + '\xFA' // Kick cash drawer (pin 2)

const COL_WIDTH = 48  // Standard 80mm thermal paper ≈ 48 chars

// ── Formatting helpers ────────────────────────────────────────────────────────
function center(text, width = COL_WIDTH) {
  const t = String(text)
  const pad = Math.max(0, Math.floor((width - t.length) / 2))
  return ' '.repeat(pad) + t
}
function right(text, width = COL_WIDTH) {
  const t = String(text)
  return t.padStart(width)
}
function cols(left, right, width = COL_WIDTH) {
  const l = String(left)
  const r = String(right)
  const gap = Math.max(1, width - l.length - r.length)
  return l + ' '.repeat(gap) + r
}
function line(char = '─', width = COL_WIDTH) {
  return char.repeat(width)
}
function fmt(n) {
  return 'RD$' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(d = new Date()) {
  return d.toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })
}

// ── Business header ───────────────────────────────────────────────────────────
function buildHeader(biz) {
  return [
    INIT,
    ALIGN_CENTER,
    DOUBLE_ON,
    center(biz.name || 'CAR WASH EXPRESS'),
    LF,
    DOUBLE_OFF,
    center(biz.address || 'Av. Winston Churchill 1099'),
    LF,
    center(`Tel: ${biz.phone || '809-555-0123'}`),
    LF,
    center(`RNC: ${biz.rnc || '130-12345-6'}`),
    LF,
    ALIGN_LEFT,
    line(),
    LF,
  ].join('')
}

// ── Footer ────────────────────────────────────────────────────────────────────
function buildFooter() {
  return [
    LF,
    line(),
    LF,
    ALIGN_CENTER,
    BOLD_ON,
    center('¡GRACIAS POR PREFERIRNOS!'),
    LF,
    BOLD_OFF,
    center('Conserve este comprobante'),
    LF,
    LF,
    // Tiny attribution — very bottom only
    center('- Powered by Terminal X -'),
    LF,
    LF,
    CUT,
  ].join('')
}

// ── CLIENT RECEIPT ────────────────────────────────────────────────────────────
/**
 * Build ESC/POS string for the full client invoice receipt.
 *
 * @param {object} data
 * @param {string}  data.ncf            NCF or eNCF
 * @param {string}  data.ncfType        'E31'|'E32'|'B01'|'B02'
 * @param {string}  data.cajero         Cashier name
 * @param {string}  data.lavador        Washer name
 * @param {string}  data.docNo          Ticket / Doc number
 * @param {Date}    data.paidAt
 * @param {object}  data.client         { name, rnc, phone, address }
 * @param {string}  data.vehiclePlate
 * @param {string}  data.tipo           'contado'|'credito'
 * @param {string}  data.formaPago      'cash'|'card'|'transfer'|...
 * @param {Array}   data.services       [{ name, price, itbis, c }]
 * @param {number}  data.subtotal
 * @param {number}  data.descuento
 * @param {number}  data.itbis
 * @param {number}  data.ley
 * @param {number}  data.total
 * @param {string}  [data.qrUrl]        URL for QR verification (printed as text)
 * @param {object}  [data.biz]          Business info from settings
 */
export function buildClientReceipt(data) {
  const isCredito = ['E31', 'B01'].includes(data.ncfType)
  const factType  = isCredito ? 'FACTURA DE CRÉDITO FISCAL' : 'FACTURA PARA CONSUMIDOR FINAL'

  const lines = []

  // Header
  lines.push(buildHeader(data.biz || {}))

  // Doc info
  lines.push(ALIGN_LEFT)
  lines.push(cols('Fecha:',  fmtDate(data.paidAt)))
  lines.push(LF)
  lines.push(cols('NCF:',    data.ncf || '—'))
  lines.push(LF)
  lines.push(cols('Cajero:', data.cajero || '—'))
  lines.push(LF)
  lines.push(cols('Lavador:',data.lavador || '—'))
  lines.push(LF)
  lines.push(cols('Doc #:',  data.docNo  || '—'))
  lines.push(LF)
  lines.push(line())
  lines.push(LF)

  // Client info (if available)
  if (data.client?.name) {
    lines.push(cols('Cliente:', data.client.name))
    lines.push(LF)
    if (data.client.rnc) {
      lines.push(cols('RNC:',  data.client.rnc))
      lines.push(LF)
    }
    if (data.client.phone) {
      lines.push(cols('Tel:',  data.client.phone))
      lines.push(LF)
    }
  }
  if (data.vehiclePlate) {
    lines.push(cols('Vehículo:', data.vehiclePlate))
    lines.push(LF)
  }
  lines.push(cols('Tipo venta:', data.tipo === 'credito' ? 'Crédito' : 'Contado'))
  lines.push(LF)
  lines.push(cols('Forma pago:', formatFormaPago(data.formaPago)))
  lines.push(LF)
  lines.push(line())
  lines.push(LF)

  // Invoice type header
  lines.push(ALIGN_CENTER)
  lines.push(BOLD_ON)
  lines.push(center(factType))
  lines.push(LF)
  lines.push(BOLD_OFF)
  lines.push(ALIGN_LEFT)
  lines.push(line())
  lines.push(LF)

  // Column headers
  lines.push(BOLD_ON)
  lines.push(cols('DESCRIPCIÓN', 'ITBIS   TOTAL', COL_WIDTH))
  lines.push(LF)
  lines.push(BOLD_OFF)
  lines.push(line('·'))
  lines.push(LF)

  // Service lines
  const services = data.services || []
  services.forEach(s => {
    const itbisAmt = s.itbis != null ? fmt(s.itbis) : ''
    const totalAmt = fmt(s.price)
    // Wrap long names
    const name = String(s.name)
    if (name.length > 28) {
      lines.push(name.substring(0, COL_WIDTH))
      lines.push(LF)
      lines.push(right(`${itbisAmt}  ${totalAmt}`, COL_WIDTH))
    } else {
      const rightPart = `${itbisAmt}  ${totalAmt}`
      const gap = Math.max(1, COL_WIDTH - name.length - rightPart.length)
      lines.push(name + ' '.repeat(gap) + rightPart)
    }
    lines.push(LF)
  })

  // Totals
  lines.push(line())
  lines.push(LF)
  if (data.descuento > 0) {
    lines.push(cols('Descuento:',  `- ${fmt(data.descuento)}`))
    lines.push(LF)
  }
  lines.push(cols('Subtotal:',    fmt(data.subtotal)))
  lines.push(LF)
  lines.push(cols('ITBIS 18%:',  fmt(data.itbis)))
  lines.push(LF)
  if (data.ley > 0) {
    lines.push(cols('Ley 10%:',  fmt(data.ley)))
    lines.push(LF)
  }
  lines.push(line())
  lines.push(LF)
  lines.push(BOLD_ON)
  lines.push(DOUBLE_ON)
  lines.push(cols('TOTAL:',      fmt(data.total), COL_WIDTH - 8))
  lines.push(LF)
  lines.push(DOUBLE_OFF)
  lines.push(BOLD_OFF)

  // QR verification
  if (data.ncf && data.ncf.startsWith('E')) {
    lines.push(LF)
    lines.push(ALIGN_CENTER)
    lines.push(line())
    lines.push(LF)
    lines.push(BOLD_ON)
    lines.push(center('COMPROBANTE ELECTRÓNICO'))
    lines.push(LF)
    lines.push(BOLD_OFF)
    lines.push(center('Escanee para verificar en DGII:'))
    lines.push(LF)
    const verUrl = `ecf.dgii.gov.do/consulta?eNCF=${data.ncf}`
    lines.push(center(verUrl))
    lines.push(LF)
    // If printer supports QR (ESC/POS GS ( k command — model dependent)
    // This is included as a best-effort; printers that don't support it will skip
    lines.push(buildQRCommand(verUrl))
    lines.push(ALIGN_LEFT)
  }

  lines.push(buildFooter())
  return lines.join('')
}

// ── WASHER CONDUCE ────────────────────────────────────────────────────────────
/**
 * Build ESC/POS string for the washer dispatch slip (conduce).
 * Only includes commission-eligible services (c: true). No beverages/snacks.
 */
export function buildWasherConduce(data) {
  const washServices = (data.services || []).filter(s => s.c !== false)
  const commBase  = washServices.reduce((s, x) => s + x.price, 0)
  const commPct   = data.commPct || 20
  const commEarned = commBase / (1 + 0.18 + 0.10) * commPct / 100

  const lines = []
  lines.push(buildHeader(data.biz || {}))

  // Conduce title
  lines.push(ALIGN_CENTER)
  lines.push(DOUBLE_ON)
  lines.push(BOLD_ON)
  lines.push(center('CONDUCE DE DESPACHO'))
  lines.push(LF)
  lines.push(DOUBLE_OFF)
  lines.push(BOLD_OFF)
  lines.push(line())
  lines.push(LF)

  // Info
  lines.push(ALIGN_LEFT)
  lines.push(BOLD_ON)
  lines.push(cols('Doc #:',    data.docNo   || '—'))
  lines.push(LF)
  lines.push(cols('Lavador:',  data.lavador || '—'))
  lines.push(LF)
  lines.push(BOLD_OFF)
  lines.push(cols('Cajero:',   data.cajero  || '—'))
  lines.push(LF)
  lines.push(cols('Fecha:',    fmtDate(data.paidAt)))
  lines.push(LF)
  lines.push(cols('Cliente:',  data.client?.name || 'Consumidor Final'))
  lines.push(LF)
  if (data.vehiclePlate) {
    lines.push(cols('Placa:',  data.vehiclePlate))
    lines.push(LF)
  }
  lines.push(line())
  lines.push(LF)

  // Services section
  lines.push(BOLD_ON)
  lines.push('SERVICIOS ASIGNADOS')
  lines.push(LF)
  lines.push(BOLD_OFF)
  lines.push(line('·'))
  lines.push(LF)

  washServices.forEach(s => {
    lines.push(cols(s.name, fmt(s.price)))
    lines.push(LF)
  })

  if (washServices.length === 0) {
    lines.push('  (Sin servicios de lavado)')
    lines.push(LF)
  }

  // Commission box
  lines.push(LF)
  lines.push(line())
  lines.push(LF)
  lines.push(BOLD_ON)
  lines.push(center('COMISIÓN DEL LAVADOR'))
  lines.push(LF)
  lines.push(BOLD_OFF)
  lines.push(line('·'))
  lines.push(LF)
  lines.push(cols('Base s/ITBIS:', fmt(commBase / 1.28)))
  lines.push(LF)
  lines.push(cols('% Comisión:',  `${commPct}%`))
  lines.push(LF)
  lines.push(BOLD_ON)
  lines.push(cols('Tu comisión:', fmt(commEarned)))
  lines.push(LF)
  lines.push(BOLD_OFF)

  lines.push(buildFooter())
  return lines.join('')
}

// ── PRE-TICKET ────────────────────────────────────────────────────────────────
/**
 * Build ESC/POS string for the pre-ticket (printed before payment).
 */
export function buildPreTicket(data) {
  const lines = []
  lines.push(buildHeader(data.biz || {}))

  lines.push(ALIGN_CENTER)
  lines.push(BOLD_ON)
  lines.push(center('PRE-TICKET'))
  lines.push(LF)
  lines.push(BOLD_OFF)
  lines.push(line())
  lines.push(LF)

  lines.push(ALIGN_LEFT)
  lines.push(cols('Doc #:', data.docNo || '—'))
  lines.push(LF)
  lines.push(cols('Fecha:', fmtDate(new Date())))
  lines.push(LF)
  lines.push(cols('Lavador:', data.lavador || '—'))
  lines.push(LF)
  if (data.vehiclePlate) {
    lines.push(cols('Vehículo:', data.vehiclePlate))
    lines.push(LF)
  }
  lines.push(line())
  lines.push(LF)

  ;(data.services || []).forEach(s => {
    lines.push(cols(s.name, fmt(s.price)))
    lines.push(LF)
  })

  lines.push(line())
  lines.push(LF)
  lines.push(BOLD_ON)
  lines.push(cols('TOTAL ESTIMADO:', fmt(data.total)))
  lines.push(LF)
  lines.push(BOLD_OFF)
  lines.push(LF)
  lines.push(ALIGN_CENTER)
  lines.push(center('— PENDIENTE DE COBRO —'))
  lines.push(LF)

  lines.push(buildFooter())
  return lines.join('')
}

// ── CUADRE DE CAJA ────────────────────────────────────────────────────────────
/**
 * Build ESC/POS string for the end-of-day cash reconciliation report.
 */
export function buildCuadreCaja(data) {
  const lines = []
  lines.push(buildHeader(data.biz || {}))

  lines.push(ALIGN_CENTER)
  lines.push(BOLD_ON)
  lines.push(DOUBLE_ON)
  lines.push(center('CUADRE DE CAJA'))
  lines.push(LF)
  lines.push(DOUBLE_OFF)
  lines.push(BOLD_OFF)
  lines.push(center(fmtDate(new Date())))
  lines.push(LF)
  lines.push(center(`Cajero: ${data.cajero || '—'}`))
  lines.push(LF)
  lines.push(line())
  lines.push(LF)

  lines.push(ALIGN_LEFT)
  lines.push(BOLD_ON)
  lines.push('RESUMEN DEL DÍA')
  lines.push(LF)
  lines.push(BOLD_OFF)
  lines.push(line('·'))
  lines.push(LF)

  const day = data.day || {}
  const rows = [
    ['Efectivo',      day.efectivo],
    ['Tarjeta',       day.tarjeta],
    ['Documento',     day.documento],
    ['Cheque',        day.cheque],
    ['Transferencia', day.transferencia],
  ]
  rows.forEach(([label, val]) => {
    if (val) {
      lines.push(cols(label + ':', fmt(val)))
      lines.push(LF)
    }
  })
  lines.push(line())
  lines.push(LF)
  lines.push(BOLD_ON)
  lines.push(cols('Total vendido:',  fmt(day.totalVendido)))
  lines.push(LF)
  lines.push(cols('Total cobrado:',  fmt(day.totalCobrado)))
  lines.push(LF)
  lines.push(BOLD_OFF)
  lines.push(line())
  lines.push(LF)

  // Conteo efectivo
  lines.push(BOLD_ON)
  lines.push('CONTEO DE EFECTIVO')
  lines.push(LF)
  lines.push(BOLD_OFF)
  lines.push(line('·'))
  lines.push(LF)
  ;(data.denominaciones || []).forEach(d => {
    if (d.qty > 0) {
      lines.push(cols(`${d.label} × ${d.qty}:`, fmt(d.label_val * d.qty)))
      lines.push(LF)
    }
  })
  lines.push(line())
  lines.push(LF)
  lines.push(BOLD_ON)
  lines.push(cols('Efectivo neto:', fmt(data.efectivoNeto)))
  lines.push(LF)
  lines.push(cols('Cierre total:', fmt(data.cierreTotal)))
  lines.push(LF)
  lines.push(BOLD_OFF)

  // Difference
  const diff = data.diferencia || 0
  lines.push(line())
  lines.push(LF)
  if (Math.abs(diff) < 1) {
    lines.push(ALIGN_CENTER)
    lines.push(BOLD_ON)
    lines.push(center('✓ CAJA CUADRADA — RD$0.00'))
    lines.push(LF)
    lines.push(BOLD_OFF)
  } else {
    lines.push(BOLD_ON)
    lines.push(cols('DIFERENCIA:', (diff > 0 ? '+' : '') + fmt(diff)))
    lines.push(LF)
    lines.push(BOLD_OFF)
  }

  if (data.comentario) {
    lines.push(LF)
    lines.push(ALIGN_LEFT)
    lines.push('Comentario: ' + data.comentario)
    lines.push(LF)
  }

  lines.push(buildFooter())
  return lines.join('')
}

// ── QR code ESC/POS command (GS ( k) ─────────────────────────────────────────
function buildQRCommand(data) {
  // ESC/POS QR code — GS ( k — model-specific; EPSON TM-T20 supports this
  const d = String(data)
  const len = d.length + 3
  const pL  = len & 0xff
  const pH  = (len >> 8) & 0xff
  return [
    GS + '(k' + String.fromCharCode(4)  + '\x00\x31\x41\x32\x00', // Model 2
    GS + '(k' + String.fromCharCode(3)  + '\x00\x31\x43\x06',     // Size 6
    GS + '(k' + String.fromCharCode(3)  + '\x00\x31\x45\x30',     // Error correction L
    GS + '(k' + String.fromCharCode(pL) + String.fromCharCode(pH) + '\x31\x50\x30' + d,
    GS + '(k' + String.fromCharCode(3)  + '\x00\x31\x51\x30',     // Print
  ].join('')
}

// ── Forma de pago label ───────────────────────────────────────────────────────
function formatFormaPago(f) {
  const map = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', cheque: 'Cheque', credit: 'A crédito' }
  return map[f] || f || 'Efectivo'
}

// ── Public print functions (renderer side) ────────────────────────────────────

async function sendToPrinter(type, escposString, biz) {
  // If running in Electron with our IPC bridge
  if (window.electronAPI?.print) {
    try {
      const result = await window.electronAPI.print({ type, data: escposString })
      if (result?.success) return { success: true }
      // Fall through to HTML preview if IPC fails
    } catch {
      // Fall through to HTML preview
    }
  }
  // Fallback: open HTML print preview
  openPrintPreview(escposString, biz)
  return { success: true, fallback: true }
}

/**
 * Opens a new window with HTML receipt preview for dev/no-printer mode.
 * Shows business logo (if available) at top. No Terminal X branding in body.
 */
function openPrintPreview(escposText, biz = {}) {
  // Strip ESC/POS binary control codes for HTML display
  const text = escposText
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\x1B[@Eaem!\-]/g, '')
    .replace(/\x1D[!V(]/g, '')

  // Business logo or name header for HTML preview
  const logoHtml = biz.logo
    ? `<div class="biz-logo"><img src="${biz.logo}" alt="${escapeHtml(biz.name || '')}" style="max-height:60px;max-width:160px;object-fit:contain;display:block;margin:0 auto"></div>`
    : biz.name
      ? `<div class="biz-name">${escapeHtml(biz.name)}</div>`
      : ''

  const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Recibo — ${escapeHtml(biz.name || 'Terminal X')}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #e5e5e5; display: flex; justify-content: center; padding: 24px; font-family: monospace; }
  .receipt {
    background: white; width: 72mm; padding: 8mm;
    box-shadow: 0 4px 24px rgba(0,0,0,0.15);
    white-space: pre-wrap; font-size: 12px; line-height: 1.5;
    border-radius: 2px;
  }
  .biz-logo { text-align: center; padding-bottom: 8px; border-bottom: 1px dashed #ccc; margin-bottom: 8px; }
  .biz-name { text-align: center; font-weight: bold; font-size: 15px; padding-bottom: 8px; border-bottom: 1px dashed #ccc; margin-bottom: 8px; }
  @media print {
    body { background: white; padding: 0; }
    .receipt { box-shadow: none; width: 100%; }
  }
</style>
</head><body>
<div class="receipt">${logoHtml}${escapeHtml(text)}</div>
<script>setTimeout(() => { window.print() }, 400)</script>
</body></html>`

  const blob = new Blob([html], { type: 'text/html' })
  const url  = URL.createObjectURL(blob)
  window.open(url, '_blank', 'width=400,height=700,menubar=no,toolbar=no')
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Print the full client invoice receipt (kicks drawer automatically) */
export async function printClientReceipt(ticketData) {
  const escpos = DRAWER_KICK + buildClientReceipt(ticketData)
  return sendToPrinter('client-receipt', escpos, ticketData.biz)
}

/** Print the washer dispatch slip */
export async function printWasherConduce(ticketData) {
  const escpos = buildWasherConduce(ticketData)
  return sendToPrinter('washer-conduce', escpos, ticketData.biz)
}

/** Print a pre-ticket before payment is collected */
export async function printPreTicket(ticketData) {
  const escpos = buildPreTicket(ticketData)
  return sendToPrinter('pre-ticket', escpos, ticketData.biz)
}

/** Kick the cash drawer without printing anything */
export async function openCashDrawer() {
  return sendToPrinter('open-drawer', DRAWER_KICK, {})
}

/** Print end-of-day cash reconciliation report */
export async function printCuadreCaja(cuadreData) {
  const escpos = buildCuadreCaja(cuadreData)
  return sendToPrinter('cuadre-caja', escpos, cuadreData.biz)
}
