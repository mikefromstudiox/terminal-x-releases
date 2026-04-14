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
const CHARSET_858  = ESC + '\x74\x10'  // Code Page 858 — covers n a e i o u ! ?
const ALIGN_LEFT   = ESC + 'a' + '\x00'
const ALIGN_CENTER = ESC + 'a' + '\x01'
const ALIGN_RIGHT  = ESC + 'a' + '\x02'
const BOLD_ON      = ESC + 'E' + '\x01'
const BOLD_OFF     = ESC + 'E' + '\x00'
// ESC ! 0x38 = bold + double-height + double-width for TOTAL line
const LARGE_ON     = ESC + '!' + '\x38'
const LARGE_OFF    = ESC + '!' + '\x00'
const DOUBLE_ON    = GS  + '!' + '\x11' // Double width + height (titles)
const DOUBLE_OFF   = GS  + '!' + '\x00'
const UNDERLINE_ON = ESC + '-' + '\x01'
const UNDERLINE_OFF= ESC + '-' + '\x00'
const CUT          = GS  + 'V' + '\x41' + '\x03' // Partial cut
const DRAWER_KICK  = ESC + 'p' + '\x00' + '\x19' + '\xFA' // Kick cash drawer (pin 2)

const COL_WIDTH = 42  // 80mm thermal paper @ Font A = 42 chars per line
const SEP       = '-'.repeat(COL_WIDTH) // ASCII separator — no unicode

// ── Formatting helpers ────────────────────────────────────────────────────────
function center(text, width = COL_WIDTH) {
  const t = String(text)
  if (t.length >= width) return t.substring(0, width)
  const pad = Math.floor((width - t.length) / 2)
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
// Word-wrap a string into lines of at most `width` chars
function wrapText(text, width = COL_WIDTH) {
  const t = String(text)
  if (t.length <= width) return [t]
  const idx = t.lastIndexOf(' ', width)
  if (idx > 0) return [t.substring(0, idx), ...wrapText(t.substring(idx + 1), width)]
  return [t.substring(0, width), ...wrapText(t.substring(width), width)]
}
function fmt(n) {
  return 'RD$' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(d = new Date()) {
  return d.toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })
}

function fmtFirmaDateESC(isoStr) {
  const d = new Date(isoStr)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${dd}-${mm}-${yyyy} ${hh}:${mi}:${ss}`
}

function buildQRUrlESC(data) {
  const enc = encodeURIComponent
  const ncf = data.ncf || ''
  const rnc = data.biz?.rnc || ''
  const isConsumerUnder250K = ncf.startsWith('E32') && (data.total || 0) < 250000
  if (isConsumerUnder250K) {
    return `https://fc.dgii.gov.do/eCF/ConsultaTimbreFC?RncEmisor=${enc(rnc)}&ENCF=${enc(ncf)}&MontoTotal=${enc(Number(data.total || 0).toFixed(2))}&CodigoSeguridad=${enc(data.securityCode || '')}`
  }
  const fechaEmision = fmtFirmaDateESC(data.paidAt || new Date()).split(' ')[0]
  const fechaFirma = data.signatureDate ? fmtFirmaDateESC(data.signatureDate) : ''
  // E43 (gastos menores) and E47 (pagos al exterior) — omit RncComprador
  const omitComprador = ncf.startsWith('E43') || ncf.startsWith('E47')
  const compradorParam = omitComprador ? '' : `&RncComprador=${enc(data.client?.rnc || '')}`
  return `https://ecf.dgii.gov.do/eCF/ConsultaTimbre?RncEmisor=${enc(rnc)}${compradorParam}&ENCF=${enc(ncf)}&FechaEmision=${enc(fechaEmision)}&MontoTotal=${enc(Number(data.total || 0).toFixed(2))}&FechaFirma=${enc(fechaFirma)}&CodigoSeguridad=${enc(data.securityCode || '')}`
}

// ── ESC/POS logo bitmap (GS v 0) ─────────────────────────────────────────────
// Converts a logo image URL to an ESC/POS GS v 0 raster command string.
// Target width is ~200px for 80mm paper. Returns '' on error or no logo.
// Normalize logo input to a browser-loadable URL. Accepts:
//   - A string URL (http, https, file, data:image/...)    → returned as-is
//   - A Node Buffer / Uint8Array / plain object-with-numeric-keys (from IPC)
//     → detected by magic bytes and wrapped in a data: URL
function logoInputToUrl(logo) {
  if (!logo) return ''
  if (typeof logo === 'string') return logo
  // Electron IPC serializes Buffers as { type: 'Buffer', data: [...] } OR Uint8Array.
  let bytes
  if (logo instanceof Uint8Array) {
    bytes = logo
  } else if (Array.isArray(logo?.data)) {
    bytes = new Uint8Array(logo.data)
  } else if (typeof logo === 'object') {
    // Plain object with numeric keys (rare IPC fallback)
    try { bytes = new Uint8Array(Object.values(logo)) } catch { return '' }
  }
  if (!bytes || !bytes.length) return ''
  // Detect mime from magic bytes
  let mime = 'image/png'
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) mime = 'image/jpeg'
  else if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) mime = 'image/gif'
  else if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45) mime = 'image/webp'
  // btoa requires binary string — chunk to avoid call-stack limits
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return `data:${mime};base64,${btoa(bin)}`
}

async function buildLogoEscPos(logoInput) {
  const logoUrl = logoInputToUrl(logoInput)
  if (!logoUrl) return ''
  return new Promise(resolve => {
    try {
      const TARGET_WIDTH = 200
      const img = new Image()
      img.onload = () => {
        try {
          const scale = Math.min(1, TARGET_WIDTH / img.naturalWidth)
          const w = Math.round(img.naturalWidth  * scale)
          const h = Math.round(img.naturalHeight * scale)

          const canvas = document.createElement('canvas')
          canvas.width  = w
          canvas.height = h
          const ctx = canvas.getContext('2d')
          ctx.fillStyle = '#FFFFFF'
          ctx.fillRect(0, 0, w, h)
          ctx.drawImage(img, 0, 0, w, h)

          const imgData      = ctx.getImageData(0, 0, w, h)
          const bytesPerRow  = Math.ceil(w / 8)
          const bitmap       = new Uint8Array(bytesPerRow * h)

          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const i = (y * w + x) * 4
              const gray = imgData.data[i] * 0.299 + imgData.data[i+1] * 0.587 + imgData.data[i+2] * 0.114
              if (gray < 128) {
                bitmap[y * bytesPerRow + Math.floor(x / 8)] |= (0x80 >> (x % 8))
              }
            }
          }

          const xL = bytesPerRow & 0xFF
          const xH = (bytesPerRow >> 8) & 0xFF
          const yL = h & 0xFF
          const yH = (h >> 8) & 0xFF

          let cmd = '\x1D\x76\x30\x00'  // GS v 0, normal (1x)
          cmd += String.fromCharCode(xL, xH, yL, yH)
          for (let i = 0; i < bitmap.length; i++) cmd += String.fromCharCode(bitmap[i])
          resolve(cmd)
        } catch { resolve('') }
      }
      img.onerror = () => resolve('')
      img.src = logoUrl
    } catch { resolve('') }
  })
}

// ── Business header ───────────────────────────────────────────────────────────
// logoBytes: optional pre-computed ESC/POS bitmap string (from buildLogoEscPos)
function buildHeader(biz, logoBytes = '') {
  const nameLines = wrapText(biz.name || '', COL_WIDTH)
  const parts = [
    INIT,
    CHARSET_858,
    ALIGN_CENTER,
  ]
  if (logoBytes) {
    parts.push(logoBytes)
    parts.push(LF)
  }
  parts.push(BOLD_ON, DOUBLE_ON)
  nameLines.forEach(l => { parts.push(l); parts.push(LF) })
  parts.push(DOUBLE_OFF, BOLD_OFF)
  if (biz.address) parts.push(biz.address, LF)
  if (biz.phone) parts.push('Tel: ' + biz.phone, LF)
  if (biz.rnc) parts.push('RNC: ' + biz.rnc, LF)
  parts.push(ALIGN_LEFT, SEP, LF)
  return parts.join('')
}

// ── Footer ────────────────────────────────────────────────────────────────────
function buildFooter() {
  return [
    LF,
    SEP,
    LF,
    ALIGN_CENTER,
    BOLD_ON,
    '!GRACIAS POR PREFERIRNOS!',
    LF,
    BOLD_OFF,
    'Conserve este comprobante',
    LF,
    LF,
    '- Powered by Terminal X -',
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
export function buildClientReceipt(data, logoBytes = '') {
  const isCredito = ['E31', 'B01'].includes(data.ncfType)
  const factType  = isCredito ? 'FACTURA DE CREDITO FISCAL' : 'FACTURA CONSUMIDOR FINAL'

  const lines = []

  // Header
  lines.push(buildHeader(data.biz || {}, logoBytes))

  // Doc info
  lines.push(ALIGN_LEFT)
  lines.push(cols('Fecha:',    fmtDate(data.paidAt)))
  lines.push(LF)
  lines.push(cols('NCF:',      data.ncf || '-'))
  lines.push(LF)
  lines.push(cols('Cajero:',   data.cajero  || '-'))
  lines.push(LF)
  lines.push(cols('Lavador:',  data.lavador || '-'))
  lines.push(LF)
  lines.push(cols('Doc #:',    data.docNo   || '-'))
  lines.push(LF)
  lines.push(SEP)
  lines.push(LF)

  // Client info (if available)
  if (data.client?.name) {
    lines.push(cols('Cliente:', data.client.name))
    lines.push(LF)
    if (data.client.rnc) {
      lines.push(cols('RNC:', data.client.rnc))
      lines.push(LF)
    }
    if (data.client.phone) {
      lines.push(cols('Tel:', data.client.phone))
      lines.push(LF)
    }
  }
  if (data.vehiclePlate) {
    lines.push(cols('Vehiculo:', data.vehiclePlate))
    lines.push(LF)
  }
  lines.push(cols('Tipo venta:', data.tipo === 'credito' ? 'Credito' : 'Contado'))
  lines.push(LF)
  lines.push(cols('Forma pago:', formatFormaPago(data.formaPago)))
  lines.push(LF)
  lines.push(SEP)
  lines.push(LF)

  // Invoice type header — centered, framed by separators
  lines.push(ALIGN_CENTER)
  lines.push(BOLD_ON)
  lines.push(factType)
  lines.push(LF)
  lines.push(BOLD_OFF)
  lines.push(ALIGN_LEFT)
  lines.push(SEP)
  lines.push(LF)

  // Column headers
  lines.push(BOLD_ON)
  lines.push(cols('DESCRIPCION', 'ITBIS   TOTAL', COL_WIDTH))
  lines.push(LF)
  lines.push(BOLD_OFF)
  lines.push(SEP)
  lines.push(LF)

  // Service lines
  const services = data.services || []
  services.forEach(s => {
    const qty = s.qty || s.quantity || 1
    const lineTotal = s.price * qty
    const itbisAmt = s.itbis != null ? fmt(s.itbis * qty) : ''
    const totalAmt = fmt(lineTotal)
    const name = qty > 1 ? `${qty}x ${s.name}` : String(s.name)
    const rightPart = itbisAmt ? `${itbisAmt}  ${totalAmt}` : totalAmt
    if (name.length + rightPart.length + 1 > COL_WIDTH) {
      // Name too long — print name on its own line, amounts right-aligned below
      wrapText(name, COL_WIDTH).forEach(l => { lines.push(l); lines.push(LF) })
      lines.push(right(rightPart, COL_WIDTH))
    } else {
      lines.push(cols(name, rightPart, COL_WIDTH))
    }
    lines.push(LF)
  })

  // Totals
  lines.push(SEP)
  lines.push(LF)
  if (data.descuento > 0) {
    lines.push(cols('Descuento:', '- ' + fmt(data.descuento)))
    lines.push(LF)
  }
  lines.push(cols('Subtotal:', fmt(data.subtotal)))
  lines.push(LF)
  lines.push(cols('ITBIS 18%:', fmt(data.itbis)))
  lines.push(LF)
  if (data.ley > 0) {
    lines.push(cols('Ley 10%:', fmt(data.ley)))
    lines.push(LF)
  }
  lines.push(SEP)
  lines.push(LF)
  // TOTAL — bold + large (ESC ! 0x38)
  lines.push(BOLD_ON)
  lines.push(LARGE_ON)
  lines.push(cols('TOTAL:', fmt(data.total), COL_WIDTH))
  lines.push(LF)
  lines.push(LARGE_OFF)
  lines.push(BOLD_OFF)

  // QR / e-CF verification
  if (data.ncf && data.ncf.startsWith('E')) {
    lines.push(LF)
    lines.push(ALIGN_CENTER)
    lines.push(SEP)
    lines.push(LF)
    lines.push(BOLD_ON)
    lines.push('COMPROBANTE ELECTRONICO')
    lines.push(LF)
    lines.push(BOLD_OFF)
    lines.push('Escanee para verificar en DGII:')
    lines.push(LF)
    const verUrl = data.qrLink || buildQRUrlESC(data)
    lines.push(buildQRCommand(verUrl))
    if (data.securityCode) {
      lines.push(LF)
      lines.push(`Cod. Seguridad: ${data.securityCode}`)
      lines.push(LF)
    }
    if (data.signatureDate) {
      const firmaStr = fmtFirmaDateESC(data.signatureDate)
      lines.push('Fecha de Firma Digital:')
      lines.push(LF)
      lines.push(firmaStr)
      lines.push(LF)
    }
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
export function buildWasherConduce(data, logoBytes = '') {
  const washServices = (data.services || []).filter(s => s.c !== false)
  const rawBase    = washServices.reduce((s, x) => s + x.price, 0)
  const commBase   = rawBase / 1.18  // strip embedded 18% ITBIS
  const commPct    = data.commPct || 20
  const commEarned = commBase * commPct / 100

  const lines = []
  // Washer conduce: no business header/logo, no footer — just the dispatch slip
  lines.push(INIT)
  lines.push(CHARSET_858)

  // Conduce title — centered, large
  lines.push(ALIGN_CENTER)
  lines.push(BOLD_ON)
  lines.push(DOUBLE_ON)
  lines.push('CONDUCE DE DESPACHO')
  lines.push(LF)
  lines.push(DOUBLE_OFF)
  lines.push(BOLD_OFF)
  lines.push(SEP)
  lines.push(LF)

  // Doc info
  lines.push(ALIGN_LEFT)
  lines.push(BOLD_ON)
  lines.push(cols('Doc #:',   data.docNo   || '-'))
  lines.push(LF)
  lines.push(cols('Lavador:', data.lavador || '-'))
  lines.push(LF)
  lines.push(BOLD_OFF)
  lines.push(cols('Cajero:',  data.cajero  || '-'))
  lines.push(LF)
  lines.push(cols('Fecha:',   fmtDate(data.paidAt)))
  lines.push(LF)
  lines.push(cols('Cliente:', data.client?.name || 'Consumidor Final'))
  lines.push(LF)
  if (data.vehiclePlate) {
    lines.push(cols('Placa:', data.vehiclePlate))
    lines.push(LF)
  }
  lines.push(SEP)
  lines.push(LF)

  // Services section header — centered, framed
  lines.push(ALIGN_CENTER)
  lines.push(BOLD_ON)
  lines.push('SERVICIOS ASIGNADOS')
  lines.push(LF)
  lines.push(BOLD_OFF)
  lines.push(ALIGN_LEFT)
  lines.push(SEP)
  lines.push(LF)

  washServices.forEach(s => {
    lines.push(cols(s.name, fmt(s.price)))
    lines.push(LF)
  })

  if (washServices.length === 0) {
    lines.push('  (Sin servicios de lavado)')
    lines.push(LF)
  }

  lines.push(LF)
  lines.push(LF)
  lines.push(CUT)
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
  lines.push('PRE-TICKET')
  lines.push(LF)
  lines.push(BOLD_OFF)
  lines.push(SEP)
  lines.push(LF)

  lines.push(ALIGN_LEFT)
  lines.push(cols('Doc #:',    data.docNo   || '-'))
  lines.push(LF)
  lines.push(cols('Fecha:',    fmtDate(new Date())))
  lines.push(LF)
  lines.push(cols('Lavador:',  data.lavador || '-'))
  lines.push(LF)
  if (data.vehiclePlate) {
    lines.push(cols('Vehiculo:', data.vehiclePlate))
    lines.push(LF)
  }
  lines.push(SEP)
  lines.push(LF)

  ;(data.services || []).forEach(s => {
    lines.push(cols(s.name, fmt(s.price)))
    lines.push(LF)
  })

  lines.push(SEP)
  lines.push(LF)
  lines.push(BOLD_ON)
  lines.push(cols('TOTAL ESTIMADO:', fmt(data.total)))
  lines.push(LF)
  lines.push(BOLD_OFF)
  lines.push(LF)
  lines.push(ALIGN_CENTER)
  lines.push('-- PENDIENTE DE COBRO --')
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
  lines.push('CUADRE DE CAJA')
  lines.push(LF)
  lines.push(DOUBLE_OFF)
  lines.push(BOLD_OFF)
  lines.push(fmtDate(new Date()))
  lines.push(LF)
  lines.push('Cajero: ' + (data.cajero || '-'))
  lines.push(LF)
  lines.push(SEP)
  lines.push(LF)

  lines.push(ALIGN_CENTER)
  lines.push(BOLD_ON)
  lines.push('RESUMEN DEL DIA')
  lines.push(LF)
  lines.push(BOLD_OFF)
  lines.push(ALIGN_LEFT)
  lines.push(SEP)
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
  lines.push(SEP)
  lines.push(LF)
  lines.push(BOLD_ON)
  lines.push(cols('Total vendido:', fmt(day.totalVendido)))
  lines.push(LF)
  lines.push(cols('Total cobrado:', fmt(day.totalCobrado)))
  lines.push(LF)
  lines.push(BOLD_OFF)
  lines.push(SEP)
  lines.push(LF)

  // Conteo efectivo
  lines.push(ALIGN_CENTER)
  lines.push(BOLD_ON)
  lines.push('CONTEO DE EFECTIVO')
  lines.push(LF)
  lines.push(BOLD_OFF)
  lines.push(ALIGN_LEFT)
  lines.push(SEP)
  lines.push(LF)
  ;(data.denominaciones || []).forEach(d => {
    if (d.qty > 0) {
      lines.push(cols(`${d.label} x ${d.qty}:`, fmt(d.label_val * d.qty)))
      lines.push(LF)
    }
  })
  lines.push(SEP)
  lines.push(LF)
  lines.push(BOLD_ON)
  lines.push(cols('Efectivo neto:', fmt(data.efectivoNeto)))
  lines.push(LF)
  lines.push(cols('Cierre total:', fmt(data.cierreTotal)))
  lines.push(LF)
  lines.push(BOLD_OFF)

  // Difference
  const diff = data.diferencia || 0
  lines.push(SEP)
  lines.push(LF)
  if (Math.abs(diff) < 1) {
    lines.push(ALIGN_CENTER)
    lines.push(BOLD_ON)
    lines.push('OK CAJA CUADRADA -- RD$0.00')
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
    lines.push('Comentario: ' + String(data.comentario).substring(0, COL_WIDTH))
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
  const map = {
    cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', cheque: 'Cheque', credit: 'A credito',
    efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia',
  }
  return map[f] || (f ? f.charAt(0).toUpperCase() + f.slice(1) : 'Efectivo')
}

// ── Public print functions (renderer side) ────────────────────────────────────

async function sendToPrinter(type, escposString, biz, api) {
  const eApi = api || window.electronAPI
  // If running in Electron with our IPC bridge, always try the native print
  // path first — the main process picks the system default when printerName
  // is undefined. Only fall back to HTML preview if the IPC itself fails
  // (e.g. no printer installed at all).
  if (eApi?.print) {
    try {
      let printerName
      try {
        const cfg = await eApi.settings.get()
        printerName = cfg?.printer || undefined
      } catch {}
      const result = await eApi.print({ type, data: escposString, printerName })
      if (result?.success) return { success: true }
      // IPC returned failure — fall through to HTML preview so the receipt
      // is at least visible / re-printable from a normal print dialog.
    } catch {
      // IPC threw — fall through
    }
  }
  // Fallback: open HTML print preview (web browser or no printer at all)
  openPrintPreview(escposString, biz)
  return { success: true, fallback: true }
}

/**
 * Opens a new window with HTML receipt preview for dev/no-printer mode.
 * Shows business logo (if available) at top. No Terminal X branding in body.
 */
function openPrintPreview(escposText, biz = {}) {
  // Parse ESC/POS alignment commands before stripping, to mark centered lines
  // ESC a 0=left, 1=center, 2=right
  let align = 'left'
  const processed = escposText.replace(/\x1Ba([\x00-\x02])/g, (_, code) => {
    align = code === '\x01' ? 'center' : code === '\x02' ? 'right' : 'left'
    return `\x00ALIGN:${align}\x00`
  })

  // Strip ALL ESC/POS binary control codes for clean HTML display
  const text = processed
    .replace(/\x1B\x70[\s\S]{0,3}/g, '')     // ESC p — drawer kick
    .replace(/\x1B@/g, '')                     // ESC @ — initialize
    .replace(/\x1Bt./g, '')                    // ESC t — charset select
    .replace(/\x1BE./g, '')                    // ESC E — bold on/off
    .replace(/\x1B!./g, '')                    // ESC ! — print mode (large)
    .replace(/\x1B-./g, '')                    // ESC - — underline
    .replace(/\x1D!./g, '')                    // GS ! — character size
    .replace(/\x1DV[\s\S]{0,2}/g, '')         // GS V — paper cut
    .replace(/\x1D\([\s\S]*?\x1D\\/g, '')     // GS ( — QR code commands
    .replace(/\x1Dv0[\s\S]*?\n/g, '')         // GS v 0 — raster bitmap
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '') // remaining control chars
    .replace(/\x1B[\x20-\x7E][\s\S]?/g, '')  // catch-all ESC sequences
    .replace(/\x1D[\x20-\x7E][\s\S]?/g, '')  // catch-all GS sequences

  // Business logo
  const logoHtml = biz.logo
    ? `<img src="${escapeHtml(biz.logo)}" style="max-height:60px;max-width:160px;object-fit:contain;display:block;margin:0 auto 8px">`
    : ''

  const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Recibo — ${escapeHtml(biz.name || 'Terminal X')}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #1a1a1a; display: flex; flex-direction: column; align-items: center; padding: 24px; font-family: system-ui, sans-serif; min-height: 100vh; }
  .toolbar { display: flex; gap: 10px; margin-bottom: 20px; }
  .toolbar button { padding: 10px 20px; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; }
  .btn-print { background: #b3001e; color: #fff; }
  .btn-print:hover { background: #8c0017; }
  .btn-wa { background: #25D366; color: #fff; }
  .btn-wa:hover { background: #1fb855; }
  .btn-close { background: #333; color: #fff; }
  .btn-close:hover { background: #555; }
  .receipt-wrap { background: white; width: 80mm; padding: 10mm 8mm; box-shadow: 0 8px 40px rgba(0,0,0,0.4); border-radius: 2px; }
  .receipt { white-space: pre-wrap; font-family: 'Courier New', monospace; font-size: 12px; line-height: 1.5; color: #000; }
  .receipt .line-bold { font-weight: bold; }
  .receipt .line-large { font-size: 16px; font-weight: bold; }
  .receipt .line-center { text-align: center; }
  .receipt .line-double { font-size: 18px; font-weight: bold; text-align: center; }
  @media print {
    body { background: white; padding: 0; }
    .toolbar { display: none; }
    .receipt-wrap { box-shadow: none; width: 80mm; margin: 0; }
  }
</style>
</head><body>
<div class="toolbar">
  <button class="btn-print" onclick="window.print()">🖨 Imprimir</button>
  <button class="btn-wa" onclick="sendWhatsApp()">💬 WhatsApp</button>
  <button class="btn-close" onclick="window.close()">Cerrar</button>
</div>
<div class="receipt-wrap">
  ${logoHtml}
  <div class="receipt">${formatReceiptHtml(text)}</div>
</div>
<script>
function sendWhatsApp() {
  var text = document.querySelector('.receipt').innerText;
  var url = 'https://wa.me/?text=' + encodeURIComponent(text);
  window.open(url, '_blank');
}
</script>
</body></html>`

  const w = window.open('', '_blank', 'width=420,height=700')
  if (w) {
    w.document.write(html)
    w.document.close()
  }
}

function formatReceiptHtml(text) {
  // Convert plain text receipt into styled HTML, using ALIGN markers from preprocessing
  let currentAlign = 'left'
  return escapeHtml(text)
    .split('\n')
    .map(line => {
      // Check for alignment markers
      const alignMatch = line.match(/ALIGN:(left|center|right)/)
      if (alignMatch) {
        currentAlign = alignMatch[1]
        line = line.replace(/ALIGN:(left|center|right)/g, '').trim()
        if (!line) return ''
      }
      const trimmed = line.trim()
      if (!trimmed) return line
      const isCentered = currentAlign === 'center'
      // Detect separator lines
      if (/^-{10,}$/.test(trimmed)) return `<span style="color:#999">${line}</span>`
      // Detect TOTAL lines (all caps with RD$)
      if (/TOTAL/.test(trimmed) && /RD\$/.test(trimmed)) return `<span class="line-large">${line}</span>`
      // Detect title lines (centered, all caps, short)
      if (isCentered && trimmed === trimmed.toUpperCase() && trimmed.length > 3 && !/RD\$/.test(trimmed) && !/[-]{3,}/.test(trimmed))
        return `<span class="line-bold line-center">${trimmed}</span>`
      // Regular centered lines
      if (isCentered) return `<span class="line-center">${trimmed}</span>`
      return line
    })
    .join('\n')
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Print the full client invoice receipt (kicks drawer only for cash/check) */
export async function printClientReceipt(ticketData, api, printerApi) {
  const logoBytes = await buildLogoEscPos(ticketData.biz?.logo || '').catch(() => '')
  const isCash = ['cash', 'efectivo', 'cheque'].includes((ticketData.formaPago || '').toLowerCase())
  const escpos = (isCash ? DRAWER_KICK : '') + buildClientReceipt(ticketData, logoBytes)
  return sendToPrinter('client-receipt', escpos, ticketData.biz, api)
}

/** Print the washer dispatch slip */
export async function printWasherConduce(ticketData, api, printerApi) {
  const logoBytes = await buildLogoEscPos(ticketData.biz?.logo || '').catch(() => '')
  const escpos = buildWasherConduce(ticketData, logoBytes)
  return sendToPrinter('washer-conduce', escpos, ticketData.biz, api)
}

/** Print a pre-ticket before payment is collected */
export async function printPreTicket(ticketData, api, printerApi) {
  const escpos = buildPreTicket(ticketData)
  return sendToPrinter('pre-ticket', escpos, ticketData.biz, api)
}

/** Kick the cash drawer without printing anything */
export async function openCashDrawer(printerApi) {
  const pApi = printerApi || window.printerAPI
  if (pApi?.openDrawer) {
    try { return await pApi.openDrawer() } catch { return false }
  }
  return false
}

/** Print end-of-day cash reconciliation report */
export async function printCuadreCaja(cuadreData, api, printerApi) {
  const escpos = buildCuadreCaja(cuadreData)
  return sendToPrinter('cuadre-caja', escpos, cuadreData.biz, api)
}

// ── CREDIT PAYMENT RECEIPT ─────────────────────────────────────────────────────
/**
 * Build ESC/POS string for a credit payment receipt (abono de credito).
 *
 * @param {object} data
 * @param {object}  data.biz
 * @param {object}  data.client      { name, rnc }
 * @param {string}  data.formaPago   'cash'|'card'|'transfer'|'check'
 * @param {string}  [data.ncfType]   'E32'|'E31'
 * @param {Array}   [data.tickets]   tickets that were paid [{ doc_number, total }]
 * @param {number}  data.amount      total amount collected
 * @param {string}  [data.comentario]
 */
export function buildCreditPaymentReceipt(data) {
  const lines = []
  lines.push(buildHeader(data.biz || {}))

  lines.push(ALIGN_CENTER)
  lines.push(BOLD_ON)
  lines.push(DOUBLE_ON)
  lines.push('RECIBO DE COBRO')
  lines.push(LF)
  lines.push(DOUBLE_OFF)
  lines.push(BOLD_OFF)
  lines.push(SEP)
  lines.push(LF)

  lines.push(ALIGN_LEFT)
  lines.push(cols('Fecha:', fmtDate(new Date())))
  lines.push(LF)
  if (data.ncfType) {
    lines.push(cols('Tipo NCF:', data.ncfType))
    lines.push(LF)
  }
  lines.push(SEP)
  lines.push(LF)

  lines.push(BOLD_ON)
  lines.push(cols('Cliente:', data.client?.name || 'Consumidor Final'))
  lines.push(LF)
  lines.push(BOLD_OFF)
  if (data.client?.rnc) {
    lines.push(cols('RNC:', data.client.rnc))
    lines.push(LF)
  }
  lines.push(cols('Forma pago:', formatFormaPago(data.formaPago)))
  lines.push(LF)
  lines.push(SEP)
  lines.push(LF)

  if (data.tickets && data.tickets.length > 0) {
    lines.push(ALIGN_CENTER)
    lines.push(BOLD_ON)
    lines.push('TICKETS ABONADOS')
    lines.push(LF)
    lines.push(BOLD_OFF)
    lines.push(ALIGN_LEFT)
    lines.push(SEP)
    lines.push(LF)

    data.tickets.forEach(t => {
      // Ticket header
      lines.push(BOLD_ON)
      lines.push(cols(t.doc_number || String(t.id), fmt(t.total || 0)))
      lines.push(LF)
      lines.push(BOLD_OFF)

      // Vehicle info
      const vehicle = [t.vehicle_make, t.vehicle_color, t.vehicle_plate].filter(Boolean).join(' - ')
      if (vehicle) {
        lines.push('  Vehiculo: ' + vehicle.substring(0, COL_WIDTH - 12))
        lines.push(LF)
      }

      // Items detail
      if (t.items && t.items.length > 0) {
        t.items.forEach(item => {
          const itemName = '  ' + (item.name || '').substring(0, COL_WIDTH - 14)
          lines.push(cols(itemName, fmt(item.price || 0)))
          lines.push(LF)
        })
      }

      // NCF / Comprobante
      if (t.ncf) {
        lines.push('  NCF: ' + t.ncf)
        lines.push(LF)
      }

      // QR code for e-CF
      if (t.ncf && t.ncf.startsWith('E')) {
        lines.push(ALIGN_CENTER)
        const verUrl = `ecf.dgii.gov.do/consulta?eNCF=${t.ncf}`
        lines.push(buildQRCommand(verUrl))
        lines.push(ALIGN_LEFT)
      }

      lines.push(SEP)
      lines.push(LF)
    })
  }

  lines.push(BOLD_ON)
  lines.push(LARGE_ON)
  lines.push(cols('TOTAL ABONADO:', fmt(data.amount), COL_WIDTH))
  lines.push(LF)
  lines.push(LARGE_OFF)
  lines.push(BOLD_OFF)

  if (data.comentario) {
    lines.push(LF)
    lines.push(ALIGN_LEFT)
    lines.push('Notas: ' + String(data.comentario).substring(0, COL_WIDTH))
    lines.push(LF)
  }

  lines.push(buildFooter())
  return lines.join('')
}

/** Print a credit payment (abono) receipt */
export async function printCreditPayment(data, api, printerApi) {
  const escpos = DRAWER_KICK + buildCreditPaymentReceipt(data)
  return sendToPrinter('credit-payment', escpos, data.biz, api)
}
