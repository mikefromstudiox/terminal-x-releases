/**
 * dgii-reports.js — DGII monthly report TXT generators.
 *
 * Produces pipe-delimited text files per DGII's Formato 606 (compras) and
 * 607 (ventas) specs so the client's accountant can upload directly to
 * DGII → Oficina Virtual → Envío de archivos without re-keying.
 *
 * Historical note on naming: Terminal X's codebase accidentally swapped the
 * table/IPC labels — `compras_607` actually holds PURCHASES (DGII 606), and
 * the `dgii:606` IPC pulls SALES (DGII 607). This module uses the OFFICIAL
 * DGII naming in its exports (Formato606 = purchases, Formato607 = sales).
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

// DGII fields are strict about formatting. Numbers with 2 decimals, no
// thousand separators. Empty optional fields are bare (no placeholder).
function num(n) {
  return Number(n || 0).toFixed(2)
}

// DGII date format: YYYYMMDD (no dashes)
function dgiiDate(d) {
  if (!d) return ''
  const dt = (d instanceof Date) ? d : new Date(
    typeof d === 'string' && !d.includes('T') ? d.replace(' ', 'T') + 'Z' : d
  )
  if (isNaN(dt.getTime())) return ''
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const day = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

// Strip RNC/cédula to digits only (DGII rejects dashes + spaces)
function cleanId(v) {
  return String(v || '').replace(/\D/g, '')
}

// Clean an NCF — StarSISA-imported synthesized "B02-LEGACY-..." values are NOT
// valid DGII comprobantes and must be excluded from exports.
function validNcf(ncf) {
  if (!ncf) return ''
  const s = String(ncf).trim().toUpperCase()
  if (s.includes('LEGACY')) return ''
  // DGII format: prefix (B or E) + 2-3 digit type + digits. Loose check.
  if (!/^[BE]\d{2,3}\d+$/.test(s.replace(/\s+/g, ''))) return ''
  return s
}

// Determine id type: 1=RNC (9 digits), 2=Cédula (11 digits), 3=Pasaporte.
// DGII: tipo 1 for suppliers/clients with RNC, tipo 2 for natural persons.
function idType(id) {
  const d = cleanId(id)
  if (d.length === 9) return '1'      // RNC
  if (d.length === 11) return '2'     // Cédula
  return ''                            // No ID → omit (Consumidor Final walk-in)
}

function periodString(year, month) {
  return `${year}${String(month).padStart(2, '0')}`
}

// ── Formato 606 — PURCHASES (proveedor invoices client paid) ────────────────
// Input: rows from compras_607 table. Spec (DGII circular R0110 2023):
//   RNC/Cédula | Tipo_ID | Bienes_Servicios | NCF | NCF_Modificado |
//   Fecha_Comprobante | Fecha_Pago | Monto_Servicios | Monto_Bienes | Total |
//   ITBIS_Facturado | ITBIS_Retenido | ITBIS_Sujeto_Proporcionalidad |
//   ITBIS_Llevado_Costo | ITBIS_Adelantar | ITBIS_Percibido | Tipo_Retencion |
//   Monto_Retencion_Renta | ISR_Percibido | Impuesto_Selectivo |
//   Otros_Impuestos | Monto_Propina_Legal | Forma_Pago
//
// "Bienes_Servicios" = '09' for services, '06' for goods. If both present,
// use '09' (services dominant for our carwash).
// Optional `businessId` is reserved for cross-firm work in Phase 3 (a contable
// targeting a specific tenant's data). Phase 1 ignores it — callers pass the
// already-filtered rows in `compras` so the generator stays stateless. Adding
// it here so future call sites compile without re-shaping the signature.
export function generateFormato606Txt(compras, rncEmisor, year, month, _businessId = null) {
  const period = periodString(year, month)
  const rows = (compras || []).filter(c => validNcf(c.ncf))

  const header = `606|${cleanId(rncEmisor)}|${period}|${rows.length}`
  const bodyLines = rows.map(c => {
    const bs = (Number(c.monto_servicios) || 0) >= (Number(c.monto_bienes) || 0) ? '09' : '06'
    return [
      cleanId(c.rnc_proveedor),      // RNC/Cédula proveedor
      idType(c.rnc_proveedor),        // Tipo_ID
      bs,                              // Bienes/Servicios
      c.ncf || '',                     // NCF
      c.ncf_modificado || '',          // NCF_Modificado
      dgiiDate(c.fecha_ncf),           // Fecha_Comprobante
      dgiiDate(c.fecha_pago),          // Fecha_Pago
      num(c.monto_servicios),          // Monto_Servicios
      num(c.monto_bienes),             // Monto_Bienes
      num(c.total),                    // Total
      num(c.itbis_facturado),          // ITBIS_Facturado
      num(c.itbis_retenido),           // ITBIS_Retenido
      '0.00',                          // ITBIS_Sujeto_Proporcionalidad
      '0.00',                          // ITBIS_Llevado_Costo
      '0.00',                          // ITBIS_Adelantar
      '0.00',                          // ITBIS_Percibido
      '',                              // Tipo_Retencion_ISR
      num(c.retencion_renta),          // Monto_Retencion_Renta
      '0.00',                          // ISR_Percibido
      '0.00',                          // Impuesto_Selectivo
      '0.00',                          // Otros_Impuestos
      '0.00',                          // Monto_Propina_Legal
      (c.forma_pago || '01').toString().slice(0, 2), // Forma_Pago (01-08)
    ].join('|')
  })

  return [header, ...bodyLines].join('\n') + '\n'
}

// ── Formato 607 — SALES (invoices we issued to clients) ─────────────────────
// Input: rows from tickets table. Spec:
//   RNC/Cédula_Cliente | Tipo_ID | NCF | NCF_Modificado | Tipo_Ingreso |
//   Fecha_Comprobante | Fecha_Retencion | Monto_Facturado | ITBIS_Facturado |
//   ITBIS_Retenido | ITBIS_Percibido | Retencion_Renta | ISR_Percibido |
//   Impuesto_Selectivo | Otros_Impuestos | Propina_Legal | Efectivo |
//   Cheque_Tx | Tarjeta | Credito | Bonos | Permuta | Otras_Formas
//
// Tipo_Ingreso: '01' = Ingresos por operaciones (default for carwash/retail).
// Forma de pago columns: split the Total across one bucket based on payment_method.
export function generateFormato607Txt(tickets, rncEmisor, year, month, _businessId = null) {
  const period = periodString(year, month)
  const rows = (tickets || []).filter(t => {
    if (t.status === 'nula' || t.status === 'anulado') return false
    return !!validNcf(t.ncf)
  })

  const header = `607|${cleanId(rncEmisor)}|${period}|${rows.length}`
  const bodyLines = rows.map(t => {
    const ncf = validNcf(t.ncf)
    const total = Number(t.total) || 0
    const pm = String(t.payment_method || 'cash').toLowerCase()
    // Split total into the 7 payment-method columns
    let efectivo = '0.00', cheque = '0.00', tarjeta = '0.00', credito = '0.00',
        bonos = '0.00', permuta = '0.00', otras = '0.00'
    if (t.tipo_venta === 'credito')            credito  = num(total)
    else if (pm === 'cash' || pm === 'efectivo') efectivo = num(total)
    else if (pm === 'card' || pm === 'tarjeta')  tarjeta  = num(total)
    else if (pm === 'transfer' || pm === 'transferencia' || pm === 'check' || pm === 'cheque') cheque = num(total)
    else                                          otras    = num(total)

    return [
      cleanId(t.client_rnc || t.rnc),            // RNC/Cédula cliente
      idType(t.client_rnc || t.rnc),              // Tipo_ID
      ncf,                                         // NCF
      t.ncf_modificado || '',                      // NCF_Modificado
      '01',                                        // Tipo_Ingreso (01 = Operaciones)
      dgiiDate(t.created_at || t.fecha),           // Fecha_Comprobante
      '',                                          // Fecha_Retencion
      num(total),                                  // Monto_Facturado (total bruto)
      num(t.itbis),                                // ITBIS_Facturado
      '0.00',                                      // ITBIS_Retenido
      '0.00',                                      // ITBIS_Percibido
      '0.00',                                      // Retencion_Renta
      '0.00',                                      // ISR_Percibido
      num(t.ley),                                  // Impuesto_Selectivo (or 0 for carwash)
      '0.00',                                      // Otros_Impuestos
      '0.00',                                      // Propina_Legal
      efectivo, cheque, tarjeta, credito, bonos, permuta, otras,
    ].join('|')
  })

  return [header, ...bodyLines].join('\n') + '\n'
}

// ── Convenience: trigger browser download with the TXT content ──────────────
export function downloadTxt(content, filename) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// ── Filename helpers per DGII convention ────────────────────────────────────
// DGII expects: DGII_F606_<RNC>_<YYYYMM>.txt / DGII_F607_<RNC>_<YYYYMM>.txt
export function filename606(rncEmisor, year, month) {
  return `DGII_F606_${cleanId(rncEmisor)}_${periodString(year, month)}.txt`
}
export function filename607(rncEmisor, year, month) {
  return `DGII_F607_${cleanId(rncEmisor)}_${periodString(year, month)}.txt`
}

// ════════════════════════════════════════════════════════════════════════════
// SLICE 2 — DGII generators for the Contabilidad suite.
//
// Every generator returns a uniform shape:
//   { filename, content, contentType, summary }
//   – content   : string for TXT/CSV; base64 for PDF.
//   – contentType: 'text/plain' or 'application/pdf'.
//   – summary   : { rowCount, totals, period, ... } for the UI confirmation card.
//
// Each function is PURE — it accepts the source rows in `data` so the caller
// (IPC handler on desktop, REST endpoint on web) is responsible for fetching
// the right data scoped by businessId/accountingClientId/period. This keeps
// the module identical between SQLite and Supabase without coupling.
//
// Every generator's docblock cites the DGII norm + retrieval URL.
// ════════════════════════════════════════════════════════════════════════════

// ── PDF helpers ─────────────────────────────────────────────────────────────
// pdf-lib is already a desktop dep (packages/services/pdf.js). We build A4
// portrait facsimiles with a header band, two-column key/value grid, and
// signature footer. Crimson #b3001e + black + white per brand.
const _PDF_BRAND = { crimson: [0.702, 0, 0.118], ink: [0, 0, 0], muted: [0.4, 0.4, 0.4] }

async function _loadPdfLib() {
  // Dynamic import keeps this file usable even where pdf-lib is absent
  // (e.g. a future serverless variant that only emits TXT). Caller will
  // catch the throw and surface "disponible en versión escritorio".
  const m = await import('pdf-lib')
  return m
}

function _money(n) {
  const v = Number(n) || 0
  return 'RD$ ' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function _periodLabel(year, month) {
  const m = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  return month ? `${m[month - 1]} ${year}` : `Año ${year}`
}

async function _pdfFacsimile({ formCode, formTitle, periodLabel, rncEmisor, razonSocial, rows, totals, sourceCitation }) {
  const { PDFDocument, StandardFonts, rgb } = await _loadPdfLib()
  const doc = await PDFDocument.create()
  const page = doc.addPage([595.28, 841.89]) // A4 portrait, pts
  const fontReg  = await doc.embedFont(StandardFonts.Helvetica)
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)
  const W = 595.28, MARGIN = 40
  let y = 800

  const draw = (txt, x, yy, { font = fontReg, size = 10, color = _PDF_BRAND.ink } = {}) =>
    page.drawText(String(txt ?? ''), { x, y: yy, size, font, color: rgb(color[0], color[1], color[2]) })

  // Crimson header band
  page.drawRectangle({ x: 0, y: 790, width: W, height: 40, color: rgb(..._PDF_BRAND.crimson) })
  draw(formCode, MARGIN, 805, { font: fontBold, size: 18, color: [1,1,1] })
  draw(formTitle, MARGIN + 80, 808, { font: fontBold, size: 12, color: [1,1,1] })
  draw('FACSÍMIL — Generado por Terminal X', MARGIN + 80, 794, { size: 8, color: [1,1,1] })

  y = 770
  draw('RNC Emisor:',   MARGIN, y, { font: fontBold }); draw(rncEmisor, MARGIN + 90, y)
  draw('Razón Social:', MARGIN + 260, y, { font: fontBold }); draw(razonSocial || '—', MARGIN + 340, y)
  y -= 16
  draw('Período:',      MARGIN, y, { font: fontBold }); draw(periodLabel, MARGIN + 90, y)
  draw('Generado:',     MARGIN + 260, y, { font: fontBold }); draw(new Date().toISOString().slice(0, 10), MARGIN + 340, y)
  y -= 20
  page.drawLine({ start: { x: MARGIN, y }, end: { x: W - MARGIN, y }, thickness: 0.5, color: rgb(..._PDF_BRAND.muted) })
  y -= 16

  // Detail rows
  for (const r of (rows || [])) {
    if (y < 80) {
      const np = doc.addPage([595.28, 841.89]); y = 800
      const _draw = (txt, x, yy, opts = {}) => np.drawText(String(txt ?? ''), {
        x, y: yy, size: opts.size || 10, font: opts.font || fontReg,
        color: rgb(...(opts.color || _PDF_BRAND.ink)),
      })
      _draw('(continuación)', MARGIN, y, { size: 9, color: _PDF_BRAND.muted })
      y -= 20
    }
    if (r.kind === 'section') {
      draw(r.label, MARGIN, y, { font: fontBold, size: 11, color: _PDF_BRAND.crimson })
      y -= 14
    } else if (r.kind === 'kv') {
      draw(r.label, MARGIN, y, { font: fontBold })
      draw(r.value, MARGIN + 240, y)
      y -= 13
    } else if (r.kind === 'sub') {
      draw(r.label, MARGIN + 16, y); draw(r.value, MARGIN + 240, y)
      y -= 12
    } else if (r.kind === 'sep') {
      page.drawLine({ start: { x: MARGIN, y: y + 4 }, end: { x: W - MARGIN, y: y + 4 }, thickness: 0.4, color: rgb(..._PDF_BRAND.muted) })
      y -= 8
    }
  }

  // Totals box
  if (totals) {
    y -= 6
    page.drawRectangle({ x: MARGIN, y: y - 60, width: W - MARGIN * 2, height: 60, borderColor: rgb(..._PDF_BRAND.crimson), borderWidth: 1, color: rgb(1,1,1) })
    let ty = y - 14
    for (const [label, val] of totals) {
      draw(label, MARGIN + 12, ty, { font: fontBold })
      draw(_money(val), W - MARGIN - 12 - fontReg.widthOfTextAtSize(_money(val), 10), ty)
      ty -= 14
    }
    y -= 70
  }

  // Footer
  draw(`Fuente: ${sourceCitation}`, MARGIN, 50, { size: 7, color: _PDF_BRAND.muted })
  draw('Este documento es un facsímil para revisión interna; la presentación oficial se realiza vía Oficina Virtual DGII.', MARGIN, 38, { size: 7, color: _PDF_BRAND.muted })

  const bytes = await doc.save()
  // Convert to base64 (works in both Node and browser).
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  // eslint-disable-next-line no-undef
  return btoa(bin)
}

// ── Formato 609 — Pagos al Exterior (TXT pipe) ──────────────────────────────
// DGII Norma General 07-2018 (vigente), 13 columnas. Layout consultado en
// https://siemprealdia.co/republica-dominicana/impuestos/desglosando-los-puntos-clave-del-formato-609/
// + comunidad oficial DGII https://ayuda.dgii.gov.do/conversations/discusiones/formato-de-envo-609/6751f736420cea4109410494
// Layout (orden):
//   1  RNC/Cédula del agente de retención (header)
//   2  Período YYYYMM (header)
//   3  Cantidad de registros (header)
//   Por línea:
//   1  Identificación del beneficiario (cédula/ID extranjero)
//   2  Tipo ID (1=Cédula, 2=ID extranjero)
//   3  Razón Social / Nombre
//   4  Tipo Renta (8 categorías Norma 07-18)
//   5  Fecha Pago         (YYYYMMDD)
//   6  Fecha Retención    (YYYYMMDD)
//   7  Monto Facturado    (decimal 2)
//   8  ISR Retenido       (decimal 2)
// (Las herramientas terceras añaden país y moneda como columnas 9–13;
// este generador escribe las 8 normativas + país + moneda + monto en moneda
// pago + tasa cambio + relacionado, manteniendo orden de la guía Norma 07-18.)
export function generateFormato609Txt(rows, rncEmisor, year, month) {
  const period = periodString(year, month)
  const list = (rows || []).filter(r => Number(r.isr_retenido) > 0 || Number(r.monto_local) > 0)
  const header = `609|${cleanId(rncEmisor)}|${period}|${list.length}`
  const body = list.map(r => [
    cleanId(r.beneficiario_id || r.beneficiario_rnc),
    (cleanId(r.beneficiario_id).length === 11 ? '1' : '2'),
    String(r.beneficiario_nombre || '').toUpperCase().slice(0, 75),
    String(r.tipo_renta || '01'),                    // 01–08
    dgiiDate(r.fecha),                                // Fecha pago
    dgiiDate(r.fecha_retencion || r.fecha),           // Fecha retención
    num(r.monto_local),                               // Monto facturado (RD$)
    num(r.isr_retenido),                              // ISR retenido
    String(r.beneficiario_pais || '').toUpperCase().slice(0, 3),
    String(r.moneda || 'USD').toUpperCase().slice(0, 3),
    num(r.monto_moneda_pago),
    num(r.tasa_cambio || 1),
    (r.relacionado ? '1' : '0'),
  ].join('|'))
  return [header, ...body].join('\n') + '\n'
}

export async function generate609({ rncEmisor, razonSocial, year, month, foreignPayments, _businessId, _accountingClientId } = {}) {
  const content = generateFormato609Txt(foreignPayments || [], rncEmisor, year, month)
  const totals = (foreignPayments || []).reduce((a, r) => ({
    monto:    a.monto    + (Number(r.monto_local)  || 0),
    retenido: a.retenido + (Number(r.isr_retenido) || 0),
  }), { monto: 0, retenido: 0 })
  return {
    filename:    `DGII_F609_${cleanId(rncEmisor)}_${periodString(year, month)}.txt`,
    content,
    contentType: 'text/plain;charset=utf-8',
    summary: {
      form: '609', period: periodString(year, month), rowCount: (foreignPayments || []).length,
      totals,
      source: 'DGII Norma General 07-2018, Formato 609',
    },
  }
}

// ── IT-1 — Declaración mensual ITBIS (PDF facsimile) ────────────────────────
// Form IT-1 se presenta vía Oficina Virtual DGII; no existe layout TXT público.
// Norma General 02-2005 + reformas (Ley 253-12). El generador computa los
// totales internamente a partir de las filas de 606 y 607 + retenciones, y
// emite un PDF facsímil con la misma estructura de los recuadros que muestra
// la OFV (ITBIS Facturado, ITBIS Retenido por Terceros, ITBIS Adelantado,
// Anticipos, Saldo a Pagar / Compensar). Fuentes:
//   https://dgii.gov.do/herramientas/formularios/Paginas/default.aspx (form IT-1)
//   https://dgii.gov.do/cicloContribuyente/obligacionesTributarias/principalesImpuestos/Paginas/itbis.aspx
export async function generateIT1({ rncEmisor, razonSocial, year, month, ventas, compras, retencionesRecibidas } = {}) {
  // Inputs are the same row shapes the existing 606/607 generators consume.
  const ventasRows  = (ventas  || []).filter(t => !(t.status === 'nula' || t.status === 'anulado'))
  const comprasRows = (compras || []).filter(c => validNcf(c.ncf))

  const itbisFacturado    = ventasRows.reduce((a, t) => a + (Number(t.itbis) || 0), 0)
  const itbisAdelantado   = comprasRows.reduce((a, c) => a + (Number(c.itbis_facturado) || 0), 0)
  const itbisRetenidoTer  = (retencionesRecibidas || []).reduce((a, r) => a + (Number(r.itbis_retenido) || 0), 0)
  const itbisRetenidoProp = comprasRows.reduce((a, c) => a + (Number(c.itbis_retenido) || 0), 0)
  const totalVentas       = ventasRows.reduce((a, t) => a + (Number(t.total) || 0), 0)
  const totalCompras      = comprasRows.reduce((a, c) => a + (Number(c.total) || 0), 0)
  const saldo             = Math.round((itbisFacturado - itbisAdelantado - itbisRetenidoTer) * 100) / 100

  const rows = [
    { kind: 'section', label: 'I. INGRESOS Y DÉBITO FISCAL' },
    { kind: 'kv', label: 'Total ventas del período',                value: _money(totalVentas) },
    { kind: 'kv', label: 'ITBIS facturado (operaciones gravadas)',  value: _money(itbisFacturado) },
    { kind: 'sep' },
    { kind: 'section', label: 'II. CRÉDITO FISCAL' },
    { kind: 'kv', label: 'Total compras del período',               value: _money(totalCompras) },
    { kind: 'kv', label: 'ITBIS adelantado en compras',             value: _money(itbisAdelantado) },
    { kind: 'kv', label: 'ITBIS retenido por terceros (a favor)',   value: _money(itbisRetenidoTer) },
    { kind: 'kv', label: 'ITBIS retenido por nosotros',             value: _money(itbisRetenidoProp) },
    { kind: 'sep' },
    { kind: 'section', label: 'III. LIQUIDACIÓN' },
    { kind: 'sub', label: 'Débito fiscal',                          value: _money(itbisFacturado) },
    { kind: 'sub', label: '(-) Crédito fiscal',                     value: _money(itbisAdelantado) },
    { kind: 'sub', label: '(-) Retenido por terceros',              value: _money(itbisRetenidoTer) },
  ]
  const totals = [
    [(saldo >= 0 ? 'Saldo a pagar' : 'Saldo a favor'), Math.abs(saldo)],
  ]

  const pdfB64 = await _pdfFacsimile({
    formCode: 'IT-1',
    formTitle: 'Declaración Mensual del ITBIS',
    periodLabel: _periodLabel(year, month),
    rncEmisor: cleanId(rncEmisor), razonSocial,
    rows, totals,
    sourceCitation: 'DGII — Formulario IT-1 rev. 2024 (OFV) + Norma General 02-2005',
  })

  return {
    filename:    `DGII_IT1_${cleanId(rncEmisor)}_${periodString(year, month)}.pdf`,
    content:     pdfB64,
    contentType: 'application/pdf;base64',
    summary: {
      form: 'IT-1', period: periodString(year, month),
      itbisFacturado: Math.round(itbisFacturado * 100) / 100,
      itbisAdelantado: Math.round(itbisAdelantado * 100) / 100,
      itbisRetenidoTer: Math.round(itbisRetenidoTer * 100) / 100,
      saldo,
      source: 'DGII Formulario IT-1',
    },
  }
}

// ── IR-3 — Retenciones a Asalariados (TXT) ──────────────────────────────────
// DGII "Instructivo Envío de Declaración IR-3" + Norma General 02-2011.
// Fuente:
//   https://dgii.gov.do/publicacionesOficiales/bibliotecaVirtual/contribuyentes/retencionesRetribucionesComplementarias/Documents/4-IR-3.pdf
// Encabezado: IR3|RNC|YYYYMM|Cantidad
// Detalle por empleado:
//   1  Cédula (11 dígitos)
//   2  Nombre completo
//   3  Salario bruto del período (decimal 2)
//   4  ISR retenido (decimal 2)
// (El instructivo pide adicionalmente otros ingresos y retribuciones
// complementarias; aquí emitimos las 4 columnas obligatorias mínimas y dejamos
// 0.00 para retribuciones complementarias hasta que el módulo soporte beneficios
// no salariales.)
export function generateFormatoIR3Txt(payrollLines, rncEmisor, year, month) {
  const period = periodString(year, month)
  const list = (payrollLines || []).filter(l => cleanId(l.employee_cedula).length === 11)
  const header = `IR3|${cleanId(rncEmisor)}|${period}|${list.length}`
  const body = list.map(l => [
    cleanId(l.employee_cedula),
    String(l.employee_name || '').toUpperCase().slice(0, 75),
    num(l.salario_base),
    num(l.isr),
    '0.00', // retribuciones complementarias (placeholder — futuro)
    '0.00', // ISR sobre retribuciones complementarias
  ].join('|'))
  return [header, ...body].join('\n') + '\n'
}

export async function generateIR3({ rncEmisor, razonSocial, year, month, payrollLines } = {}) {
  const content = generateFormatoIR3Txt(payrollLines || [], rncEmisor, year, month)
  const totals = (payrollLines || []).reduce((a, l) => ({
    salarios: a.salarios + (Number(l.salario_base) || 0),
    isr:      a.isr      + (Number(l.isr)         || 0),
  }), { salarios: 0, isr: 0 })
  return {
    filename:    `DGII_IR3_${cleanId(rncEmisor)}_${periodString(year, month)}.txt`,
    content,
    contentType: 'text/plain;charset=utf-8',
    summary: {
      form: 'IR-3', period: periodString(year, month), rowCount: (payrollLines || []).length,
      totals,
      source: 'DGII — Instructivo IR-3 + Norma General 02-2011',
    },
  }
}

// ── IR-17 — Otras Retenciones (TXT) ─────────────────────────────────────────
// DGII "Instructivo Envío de Declaración Jurada de Otras Retenciones y
// Retribuciones" (IR-17). Fuente:
//   https://dgii.gov.do/publicacionesOficiales/bibliotecaVirtual/contribuyentes/retencionesRetribucionesComplementarias/Documents/3-IR-17.pdf
// Encabezado: IR17|RNC|YYYYMM|Cantidad
// Detalle:
//   1  RNC/Cédula del beneficiario
//   2  Tipo ID (1=RNC, 2=Cédula)
//   3  Tipo retención (alquiler, honorarios, dividendos, servicios_no_dom, …)
//   4  Fecha de la retención (YYYYMMDD)
//   5  Base imponible (decimal 2)
//   6  Tasa aplicada (decimal 2 — porcentaje)
//   7  Monto retenido (decimal 2)
//   8  NCF emitido (si aplica)
const _IR17_TIPO_MAP = {
  alquiler:         '01',
  honorarios:       '02',
  dividendos:       '03',
  servicios_no_dom: '04',
}
export function generateFormatoIR17Txt(retentions, rncEmisor, year, month) {
  const period = periodString(year, month)
  const list = (retentions || []).filter(r => Number(r.retencion) > 0)
  const header = `IR17|${cleanId(rncEmisor)}|${period}|${list.length}`
  const body = list.map(r => [
    cleanId(r.beneficiario_rnc),
    idType(r.beneficiario_rnc) || '1',
    _IR17_TIPO_MAP[r.tipo] || '04',
    dgiiDate(r.fecha),
    num(r.base),
    num(r.tasa),
    num(r.retencion),
    String(r.ncf_emitido || ''),
  ].join('|'))
  return [header, ...body].join('\n') + '\n'
}

export async function generateIR17({ rncEmisor, razonSocial, year, month, retentions } = {}) {
  const content = generateFormatoIR17Txt(retentions || [], rncEmisor, year, month)
  const totals = (retentions || []).reduce((a, r) => ({
    base:      a.base      + (Number(r.base)      || 0),
    retenido:  a.retenido  + (Number(r.retencion) || 0),
  }), { base: 0, retenido: 0 })
  return {
    filename:    `DGII_IR17_${cleanId(rncEmisor)}_${periodString(year, month)}.txt`,
    content,
    contentType: 'text/plain;charset=utf-8',
    summary: {
      form: 'IR-17', period: periodString(year, month), rowCount: (retentions || []).length,
      totals,
      source: 'DGII — Instructivo IR-17',
    },
  }
}

// ── IR-1 — Declaración Anual Personas Físicas (PDF facsimile) ───────────────
// DGII Formulario IR-1 (rev. 2024). Computado a partir de journal_entries del
// año, retenciones recibidas, y aportes SDSS deducibles. Fuente:
//   https://dgii.gov.do/herramientas/formularios/formularioDeclaraciones/Paginas/impuestoSobreLaRenta.aspx
// Estructura del PDF replica las secciones del IR-1 OFV: Ingresos, Deducciones
// (exento + cotizaciones SDSS + gastos educativos hasta 10% renta neta art.287
// Código Tributario), ISR según escala anual, Anticipos pagados, Retenciones
// recibidas, Saldo a pagar / a favor.
export async function generateIR1({ rncEmisor, razonSocial, year, journalEntries, retencionesRecibidas, anticiposPagados, deducciones } = {}) {
  // Aggregate gross income from credit-side ingreso accounts. Caller decides
  // which COA codes are ingresos by passing `journalEntries[i].is_income=true`.
  const ingresos = (journalEntries || []).reduce((a, e) => a + (e.is_income ? (Number(e.amount) || 0) : 0), 0)
  const cotizSDSS = Number(deducciones?.sdss || 0)
  const gastosEduc = Math.min(Number(deducciones?.educativos || 0), ingresos * 0.10)
  const exento = 416220.00 // tramo 0% anual ISR-PF 2026
  const baseImponible = Math.max(0, ingresos - exento - cotizSDSS - gastosEduc)

  // Apply annual progressive scale.
  const brackets = [
    { from: 0,         to: 0,         rate: 0,    fixedAdd: 0 },
    { from: 208109.04, to: 451812.96, rate: 0.15, fixedAdd: 0 },
    { from: 451812.96, to: Infinity,  rate: 0.25, fixedAdd: 79776.00 - 31216.00 },
  ]
  // Re-use the canonical annual scale on top of (ingresos - deducibles), not
  // baseImponible-after-exempt. Simpler & matches DGII calculator output.
  const totalAnnual = Math.max(0, ingresos - cotizSDSS - gastosEduc)
  const isrEscalas = [
    { from: 0,         to: 416220.00, rate: 0,    fixedAdd: 0     },
    { from: 416220.00, to: 624329.04, rate: 0.15, fixedAdd: 0     },
    { from: 624329.04, to: 867123.00, rate: 0.20, fixedAdd: 31216.00 },
    { from: 867123.00, to: Infinity,  rate: 0.25, fixedAdd: 79776.00 },
  ]
  let isr = 0
  for (let i = isrEscalas.length - 1; i >= 0; i--) {
    const b = isrEscalas[i]
    if (totalAnnual > b.from) { isr = b.fixedAdd + (totalAnnual - b.from) * b.rate; break }
  }
  isr = Math.round(isr * 100) / 100
  // (silence unused warnings on intermediate brackets / baseImponible)
  void brackets; void baseImponible

  const anticipos = Number(anticiposPagados || 0)
  const retenciones = (retencionesRecibidas || []).reduce((a, r) => a + (Number(r.retencion) || 0), 0)
  const saldo = Math.round((isr - anticipos - retenciones) * 100) / 100

  const rows = [
    { kind: 'section', label: 'I. INGRESOS' },
    { kind: 'kv', label: 'Total ingresos brutos del año',          value: _money(ingresos) },
    { kind: 'sep' },
    { kind: 'section', label: 'II. DEDUCCIONES' },
    { kind: 'kv', label: 'Tramo exento (escala 2026)',             value: _money(exento) },
    { kind: 'kv', label: 'Cotizaciones SDSS (AFP+SFS empleado)',   value: _money(cotizSDSS) },
    { kind: 'kv', label: 'Gastos educativos (<=10% renta neta)',    value: _money(gastosEduc) },
    { kind: 'sep' },
    { kind: 'section', label: 'III. LIQUIDACIÓN' },
    { kind: 'sub', label: 'Renta gravable',                        value: _money(totalAnnual) },
    { kind: 'sub', label: 'ISR según escala',                      value: _money(isr) },
    { kind: 'sub', label: '(-) Anticipos pagados',                 value: _money(anticipos) },
    { kind: 'sub', label: '(-) Retenciones a su favor',            value: _money(retenciones) },
  ]
  const totals = [[saldo >= 0 ? 'Saldo a pagar' : 'Saldo a favor', Math.abs(saldo)]]

  const pdfB64 = await _pdfFacsimile({
    formCode: 'IR-1',
    formTitle: 'Declaración Anual de ISR — Personas Físicas',
    periodLabel: _periodLabel(year, 0),
    rncEmisor: cleanId(rncEmisor), razonSocial,
    rows, totals,
    sourceCitation: 'DGII — Formulario IR-1 rev. 2024 + Código Tributario art. 296 y 287',
  })

  return {
    filename:    `DGII_IR1_${cleanId(rncEmisor)}_${year}.pdf`,
    content:     pdfB64,
    contentType: 'application/pdf;base64',
    summary: {
      form: 'IR-1', period: String(year),
      ingresos: Math.round(ingresos * 100) / 100, isr, anticipos, retenciones, saldo,
      source: 'DGII Formulario IR-1',
    },
  }
}

// ── IR-2 — Declaración Anual Sociedades (PDF facsimile) ─────────────────────
// DGII Formulario IR-2 (rev. 2024). Tasa ISR persona jurídica 27% (art. 297
// Código Tributario, vigente 2026). Fuente:
//   https://dgii.gov.do/cicloContribuyente/obligacionesTributarias/principalesImpuestos/Paginas/impuestoSobreRenta.aspx
//   https://dgii.gov.do/herramientas/formularios/Paginas/default.aspx
export async function generateIR2({ rncEmisor, razonSocial, year, resultadoNeto, anticiposPagados, retencionesRecibidas, ajustes } = {}) {
  const utilidad = Number(resultadoNeto || 0)
  const ajustesPos = Number(ajustes?.no_deducibles || 0) // gastos no admitidos
  const ajustesNeg = Number(ajustes?.exentos || 0)        // ingresos exentos
  const baseImp = Math.max(0, utilidad + ajustesPos - ajustesNeg)
  const isr = Math.round(baseImp * 0.27 * 100) / 100
  const anticipos = Number(anticiposPagados || 0)
  const retenciones = (retencionesRecibidas || []).reduce((a, r) => a + (Number(r.retencion) || 0), 0)
  const saldo = Math.round((isr - anticipos - retenciones) * 100) / 100

  const rows = [
    { kind: 'section', label: 'I. RESULTADO CONTABLE' },
    { kind: 'kv', label: 'Resultado neto del ejercicio',           value: _money(utilidad) },
    { kind: 'kv', label: '(+) Gastos no deducibles',               value: _money(ajustesPos) },
    { kind: 'kv', label: '(-) Ingresos exentos',                   value: _money(ajustesNeg) },
    { kind: 'sep' },
    { kind: 'section', label: 'II. RENTA NETA IMPONIBLE' },
    { kind: 'kv', label: 'Base imponible',                         value: _money(baseImp) },
    { kind: 'kv', label: 'ISR 27% (Cód. Trib. art. 297)',          value: _money(isr) },
    { kind: 'sep' },
    { kind: 'section', label: 'III. LIQUIDACIÓN' },
    { kind: 'sub', label: '(-) Anticipos pagados',                 value: _money(anticipos) },
    { kind: 'sub', label: '(-) Retenciones a su favor',            value: _money(retenciones) },
  ]
  const totals = [[saldo >= 0 ? 'Saldo a pagar' : 'Saldo a favor', Math.abs(saldo)]]

  const pdfB64 = await _pdfFacsimile({
    formCode: 'IR-2',
    formTitle: 'Declaración Anual de ISR — Sociedades',
    periodLabel: _periodLabel(year, 0),
    rncEmisor: cleanId(rncEmisor), razonSocial,
    rows, totals,
    sourceCitation: 'DGII — Formulario IR-2 rev. 2024 + Código Tributario art. 297',
  })

  return {
    filename:    `DGII_IR2_${cleanId(rncEmisor)}_${year}.pdf`,
    content:     pdfB64,
    contentType: 'application/pdf;base64',
    summary: {
      form: 'IR-2', period: String(year),
      utilidad, baseImp, isr, anticipos, retenciones, saldo,
      source: 'DGII Formulario IR-2',
    },
  }
}

// ── Anexo A — Detalle de cuentas que acompaña el IR-2 (PDF facsimile) ──────
// DGII "Anexo A" del IR-2: detalle de cuentas de ingresos, costos, gastos y
// resultados que sustentan los totales del IR-2. Cada fila es una cuenta del
// COA con su saldo del año. Fuente:
//   https://dgii.gov.do/herramientas/formularios/Paginas/default.aspx
export async function generateAnexoA({ rncEmisor, razonSocial, year, accounts } = {}) {
  // accounts = [{ code, name, type, total }, ...] — total positivo (PG presenta
  // cuentas en valor absoluto agrupadas por tipo).
  const grouped = { ingreso: [], costo: [], gasto: [], otro: [] }
  for (const a of (accounts || [])) {
    const k = (a.type === 'ingreso' || a.type === 'costo' || a.type === 'gasto') ? a.type : 'otro'
    grouped[k].push(a)
  }
  const sumOf = (arr) => arr.reduce((s, x) => s + (Number(x.total) || 0), 0)
  const tIng = sumOf(grouped.ingreso), tCos = sumOf(grouped.costo), tGas = sumOf(grouped.gasto)

  const rows = []
  for (const [grp, label] of [['ingreso','I. INGRESOS'],['costo','II. COSTOS'],['gasto','III. GASTOS'],['otro','IV. OTROS']]) {
    if (!grouped[grp].length) continue
    rows.push({ kind: 'section', label })
    for (const a of grouped[grp].sort((x, y) => String(x.code).localeCompare(String(y.code)))) {
      rows.push({ kind: 'sub', label: `${a.code}  ${a.name}`, value: _money(a.total) })
    }
    rows.push({ kind: 'sep' })
  }
  const utilidad = Math.round((tIng - tCos - tGas) * 100) / 100
  const totals = [
    ['Total Ingresos', tIng],
    ['Total Costos',   tCos],
    ['Total Gastos',   tGas],
    ['Utilidad / Pérdida', utilidad],
  ]

  const pdfB64 = await _pdfFacsimile({
    formCode: 'IR-2 Anexo A',
    formTitle: 'Detalle de Cuentas — Estado de Resultados',
    periodLabel: _periodLabel(year, 0),
    rncEmisor: cleanId(rncEmisor), razonSocial,
    rows, totals,
    sourceCitation: 'DGII — Anexo A del Formulario IR-2 rev. 2024',
  })

  return {
    filename:    `DGII_AnexoA_${cleanId(rncEmisor)}_${year}.pdf`,
    content:     pdfB64,
    contentType: 'application/pdf;base64',
    summary: {
      form: 'IR-2-AnexoA', period: String(year),
      ingresos: tIng, costos: tCos, gastos: tGas, utilidad,
      source: 'DGII IR-2 Anexo A',
    },
  }
}

// Filename helpers for the new generators (used by UI `downloadTxt` /
// download-base64 helpers and IPC senders).
export function filename609 (rncEmisor, year, month) { return `DGII_F609_${cleanId(rncEmisor)}_${periodString(year, month)}.txt` }
export function filenameIT1 (rncEmisor, year, month) { return `DGII_IT1_${cleanId(rncEmisor)}_${periodString(year, month)}.pdf` }
export function filenameIR3 (rncEmisor, year, month) { return `DGII_IR3_${cleanId(rncEmisor)}_${periodString(year, month)}.txt` }
export function filenameIR17(rncEmisor, year, month) { return `DGII_IR17_${cleanId(rncEmisor)}_${periodString(year, month)}.txt` }
export function filenameIR1 (rncEmisor, year)        { return `DGII_IR1_${cleanId(rncEmisor)}_${year}.pdf` }
export function filenameIR2 (rncEmisor, year)        { return `DGII_IR2_${cleanId(rncEmisor)}_${year}.pdf` }
export function filenameAnexoA(rncEmisor, year)      { return `DGII_AnexoA_${cleanId(rncEmisor)}_${year}.pdf` }

// ── Smoke tests (deterministic, in-memory) ──────────────────────────────────
// Run with `node packages/services/dgii-reports.js` to see PASS/FAIL per form.
export async function _smokeAllGenerators() {
  const rncEmisor = '133410321'
  const razonSocial = 'STUDIO X DETAILING SRL'
  const out = []

  // 609
  {
    const r = await generate609({
      rncEmisor, razonSocial, year: 2026, month: 3,
      foreignPayments: [
        { fecha: '2026-03-15', beneficiario_id: '12345678901', beneficiario_nombre: 'Cloud Vendor LLC', beneficiario_pais: 'USA', tipo_renta: '02', moneda: 'USD', monto_moneda_pago: 200, tasa_cambio: 60, monto_local: 12000, isr_retenido: 3240 },
      ],
    })
    if (!r.content.startsWith('609|')) throw new Error('609 header mismatch')
    if (!r.content.includes('|3240.00|')) throw new Error('609 isr value missing')
    out.push({ form: '609', ok: true, len: r.content.length, summary: r.summary })
  }
  // IT-1
  {
    const r = await generateIT1({
      rncEmisor, razonSocial, year: 2026, month: 3,
      ventas:  [{ ncf: 'E310000000001', total: 11800, itbis: 1800, status: 'paid' }],
      compras: [{ ncf: 'B0100000001', total: 5900, itbis_facturado: 900, itbis_retenido: 0 }],
      retencionesRecibidas: [],
    })
    if (!r.content || r.content.length < 100) throw new Error('IT-1 PDF too small')
    if (r.summary.itbisFacturado !== 1800) throw new Error('IT-1 itbisFacturado wrong')
    out.push({ form: 'IT-1', ok: true, b64Len: r.content.length, summary: r.summary })
  }
  // IR-3
  {
    const r = await generateIR3({
      rncEmisor, razonSocial, year: 2026, month: 3,
      payrollLines: [
        { employee_cedula: '00112345678', employee_name: 'Juan Pérez', salario_base: 100000, isr: 12105.44 },
      ],
    })
    if (!r.content.startsWith('IR3|')) throw new Error('IR-3 header mismatch')
    if (!r.content.includes('|12105.44|')) throw new Error('IR-3 isr missing')
    out.push({ form: 'IR-3', ok: true, len: r.content.length, summary: r.summary })
  }
  // IR-17
  {
    const r = await generateIR17({
      rncEmisor, razonSocial, year: 2026, month: 3,
      retentions: [
        { fecha: '2026-03-20', beneficiario_rnc: '101234567', tipo: 'honorarios', base: 50000, tasa: 10, retencion: 5000, ncf_emitido: 'B1500000001' },
      ],
    })
    if (!r.content.startsWith('IR17|')) throw new Error('IR-17 header mismatch')
    if (!r.content.includes('|5000.00|')) throw new Error('IR-17 retention missing')
    out.push({ form: 'IR-17', ok: true, len: r.content.length, summary: r.summary })
  }
  // IR-1
  {
    const r = await generateIR1({
      rncEmisor, razonSocial, year: 2025,
      journalEntries: [{ is_income: true, amount: 1500000 }],
      retencionesRecibidas: [{ retencion: 35000 }],
      anticiposPagados: 50000,
      deducciones: { sdss: 88500, educativos: 80000 },
    })
    if (!r.content || r.content.length < 100) throw new Error('IR-1 PDF too small')
    if (r.summary.ingresos !== 1500000) throw new Error('IR-1 ingresos wrong')
    out.push({ form: 'IR-1', ok: true, b64Len: r.content.length, summary: r.summary })
  }
  // IR-2
  {
    const r = await generateIR2({
      rncEmisor, razonSocial, year: 2025,
      resultadoNeto: 2000000,
      anticiposPagados: 100000,
      retencionesRecibidas: [{ retencion: 50000 }],
      ajustes: { no_deducibles: 100000, exentos: 0 },
    })
    if (!r.content || r.content.length < 100) throw new Error('IR-2 PDF too small')
    const expectedIsr = Math.round(2100000 * 0.27 * 100) / 100
    if (Math.abs(r.summary.isr - expectedIsr) > 0.01) throw new Error('IR-2 isr math wrong: ' + r.summary.isr)
    out.push({ form: 'IR-2', ok: true, b64Len: r.content.length, summary: r.summary })
  }
  // Anexo A
  {
    const r = await generateAnexoA({
      rncEmisor, razonSocial, year: 2025,
      accounts: [
        { code: '4101', name: 'Ingresos por servicios', type: 'ingreso', total: 1500000 },
        { code: '5101', name: 'Costo de servicios',     type: 'costo',   total: 600000  },
        { code: '5201', name: 'Sueldos administrativos', type: 'gasto',   total: 400000  },
      ],
    })
    if (!r.content || r.content.length < 100) throw new Error('Anexo A PDF too small')
    if (r.summary.utilidad !== 500000) throw new Error('Anexo A utilidad wrong: ' + r.summary.utilidad)
    out.push({ form: 'Anexo A', ok: true, b64Len: r.content.length, summary: r.summary })
  }

  return out
}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('dgii-reports.js')) {
  _smokeAllGenerators().then(r => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(r, null, 2))
  }).catch(err => {
    // eslint-disable-next-line no-console
    console.error('SMOKE FAIL:', err.message); process.exit(1)
  })
}
