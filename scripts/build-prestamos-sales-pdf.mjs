/**
 * build-prestamos-sales-pdf.mjs
 *
 * Genera el PDF de ventas/operaciones de Préstamos & Casa de Empeño
 * para Terminal X. Salida:
 *   docs/prestamos-cómo-funciona-y-cómo-vender.pdf
 *
 * Tamaño: Letter (612x792). Helvetica + Helvetica-Bold.
 * Banda crimson superior 36pt en cada página.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')
const OUT  = path.join(ROOT, 'docs', 'prestamos-cómo-funciona-y-cómo-vender.pdf')

// Brand palette
const CRIMSON  = rgb(0.702, 0, 0.118) // #b3001e
const INK      = rgb(0, 0, 0)
const WHITE    = rgb(1, 1, 1)
const MUTED    = rgb(0.42, 0.42, 0.42)
const SOFT     = rgb(0.93, 0.93, 0.93)
const HAIRLINE = rgb(0.78, 0.78, 0.78)

// Page geometry
const PAGE_W = 612
const PAGE_H = 792
const BAND_H = 36
const MARGIN_X = 50
const MARGIN_TOP = BAND_H + 30 // content starts below band
const MARGIN_BOTTOM = 50

// Helvetica (WinAnsi) cannot encode some chars. We sanitize.
function san(s) {
  if (s == null) return ''
  return String(s)
    // Smart quotes -> straight
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    // dashes
    .replace(/[–—]/g, '-')
    // ellipsis
    .replace(/…/g, '...')
    // bullet & arrows -> ascii
    .replace(/[•●■]/g, '·')
    .replace(/[→➜➤➔]/g, '->')
    .replace(/[←]/g, '<-')
    // non-breaking space
    .replace(/ /g, ' ')
    // remove anything outside latin-1
    .replace(/[^\x00-\xFF]/g, '?')
}

let pdf, fontReg, fontBold

const state = {
  page: null,
  cursorY: 0,
  pageNumber: 0,
  sectionTitle: '',
}

function newPage(sectionTitle) {
  state.sectionTitle = sectionTitle || state.sectionTitle
  state.page = pdf.addPage([PAGE_W, PAGE_H])
  state.pageNumber += 1
  state.cursorY = PAGE_H - MARGIN_TOP
  drawHeaderBand(state.page, state.sectionTitle)
  drawFooter(state.page, state.pageNumber)
  return state.page
}

function drawHeaderBand(page, title) {
  // crimson band
  page.drawRectangle({
    x: 0, y: PAGE_H - BAND_H, width: PAGE_W, height: BAND_H,
    color: CRIMSON,
  })
  // Logo-style "TERMINAL X" left
  page.drawText('TERMINAL X', {
    x: MARGIN_X, y: PAGE_H - BAND_H + 12,
    size: 14, font: fontBold, color: WHITE,
  })
  // Section title right
  if (title) {
    const t = san(title).toUpperCase()
    const w = fontBold.widthOfTextAtSize(t, 11)
    page.drawText(t, {
      x: PAGE_W - MARGIN_X - w, y: PAGE_H - BAND_H + 13,
      size: 11, font: fontBold, color: WHITE,
    })
  }
}

function drawFooter(page, n) {
  const left = 'Terminal X - Préstamos v2.16.2'
  page.drawText(san(left), {
    x: MARGIN_X, y: 24, size: 9, font: fontReg, color: MUTED,
  })
  const right = `Página ${n}`
  const w = fontReg.widthOfTextAtSize(san(right), 9)
  page.drawText(san(right), {
    x: PAGE_W - MARGIN_X - w, y: 24, size: 9, font: fontReg, color: MUTED,
  })
  // hairline above footer
  page.drawLine({
    start: { x: MARGIN_X, y: 40 },
    end:   { x: PAGE_W - MARGIN_X, y: 40 },
    thickness: 0.5, color: HAIRLINE,
  })
}

function ensureSpace(needed) {
  if (state.cursorY - needed < MARGIN_BOTTOM + 10) {
    newPage(state.sectionTitle)
  }
}

function moveDown(n) { state.cursorY -= n }

function drawText(text, opts = {}) {
  const {
    size = 11, font = fontReg, color = INK, x = MARGIN_X, lineHeight = 16,
    maxWidth = PAGE_W - MARGIN_X * 2,
  } = opts
  const lines = wrap(san(text), font, size, maxWidth)
  for (const line of lines) {
    ensureSpace(lineHeight)
    state.page.drawText(line, { x, y: state.cursorY - size, size, font, color })
    state.cursorY -= lineHeight
  }
}

function wrap(text, font, size, maxWidth) {
  const out = []
  for (const rawLine of text.split('\n')) {
    if (!rawLine.trim()) { out.push(''); continue }
    const words = rawLine.split(' ')
    let cur = ''
    for (const w of words) {
      const trial = cur ? cur + ' ' + w : w
      if (font.widthOfTextAtSize(trial, size) <= maxWidth) {
        cur = trial
      } else {
        if (cur) out.push(cur)
        // word too long? hard-split
        if (font.widthOfTextAtSize(w, size) > maxWidth) {
          let chunk = ''
          for (const ch of w) {
            if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth) {
              out.push(chunk); chunk = ch
            } else chunk += ch
          }
          cur = chunk
        } else {
          cur = w
        }
      }
    }
    if (cur) out.push(cur)
  }
  return out
}

function h1(text) {
  ensureSpace(40)
  moveDown(6)
  drawText(text, { size: 22, font: fontBold, color: CRIMSON, lineHeight: 26 })
  moveDown(6)
}

function h2(text) {
  ensureSpace(30)
  moveDown(8)
  drawText(text, { size: 14, font: fontBold, color: CRIMSON, lineHeight: 18 })
  moveDown(2)
}

function h3(text) {
  ensureSpace(22)
  moveDown(6)
  drawText(text, { size: 12, font: fontBold, color: INK, lineHeight: 16 })
  moveDown(1)
}

function p(text) {
  drawText(text, { size: 11, font: fontReg, color: INK, lineHeight: 16 })
  moveDown(4)
}

function bullet(text) {
  ensureSpace(16)
  // crimson dot
  state.page.drawCircle({
    x: MARGIN_X + 4, y: state.cursorY - 6, size: 2.2, color: CRIMSON,
  })
  drawText(text, {
    size: 11, font: fontReg, color: INK, lineHeight: 16,
    x: MARGIN_X + 16, maxWidth: PAGE_W - MARGIN_X * 2 - 16,
  })
  moveDown(2)
}

function numBullet(num, text) {
  ensureSpace(16)
  state.page.drawText(san(`${num}.`), {
    x: MARGIN_X, y: state.cursorY - 11,
    size: 11, font: fontBold, color: CRIMSON,
  })
  drawText(text, {
    size: 11, font: fontReg, color: INK, lineHeight: 16,
    x: MARGIN_X + 18, maxWidth: PAGE_W - MARGIN_X * 2 - 18,
  })
  moveDown(2)
}

function quoteBox(text) {
  const padding = 12
  const innerW = PAGE_W - MARGIN_X * 2 - padding * 2
  const lines = wrap(san(text), fontReg, 11, innerW)
  const boxH = lines.length * 16 + padding * 2
  ensureSpace(boxH + 8)
  // bg
  state.page.drawRectangle({
    x: MARGIN_X, y: state.cursorY - boxH,
    width: PAGE_W - MARGIN_X * 2, height: boxH,
    color: SOFT,
  })
  // crimson left bar
  state.page.drawRectangle({
    x: MARGIN_X, y: state.cursorY - boxH,
    width: 4, height: boxH, color: CRIMSON,
  })
  let y = state.cursorY - padding
  for (const line of lines) {
    state.page.drawText(line, {
      x: MARGIN_X + padding + 6, y: y - 11,
      size: 11, font: fontReg, color: INK,
    })
    y -= 16
  }
  state.cursorY -= boxH + 6
}

/**
 * Tabla simple. cols = [{ header, width, align? }], rows = [[c, c, c]]
 */
function table(cols, rows) {
  const totalW = PAGE_W - MARGIN_X * 2
  const widths = cols.map(c => c.width)
  // normalize widths to total
  const sum = widths.reduce((a, b) => a + b, 0)
  const scale = totalW / sum
  const w = widths.map(x => x * scale)

  const headerH = 24
  const padX = 6
  const lineH = 14
  const fontSize = 10

  // measure rows height
  const rowHeights = rows.map(row => {
    let max = 1
    row.forEach((cell, i) => {
      const lines = wrap(san(cell), fontReg, fontSize, w[i] - padX * 2)
      if (lines.length > max) max = lines.length
    })
    return max * lineH + 8
  })

  // ensure
  const totalH = headerH + rowHeights.reduce((a, b) => a + b, 0)
  ensureSpace(totalH + 6)

  let y = state.cursorY
  // header
  state.page.drawRectangle({
    x: MARGIN_X, y: y - headerH, width: totalW, height: headerH, color: CRIMSON,
  })
  let x = MARGIN_X
  cols.forEach((c, i) => {
    state.page.drawText(san(c.header), {
      x: x + padX, y: y - 16, size: 10, font: fontBold, color: WHITE,
    })
    x += w[i]
  })
  y -= headerH

  // rows
  rows.forEach((row, ri) => {
    const rh = rowHeights[ri]
    // border box
    state.page.drawRectangle({
      x: MARGIN_X, y: y - rh, width: totalW, height: rh,
      borderColor: HAIRLINE, borderWidth: 0.5,
    })
    let cx = MARGIN_X
    row.forEach((cell, i) => {
      const lines = wrap(san(cell), fontReg, fontSize, w[i] - padX * 2)
      let cy = y - 14
      lines.forEach(line => {
        state.page.drawText(line, {
          x: cx + padX, y: cy - fontSize,
          size: fontSize, font: fontReg, color: INK,
        })
        cy -= lineH
      })
      cx += w[i]
    })
    // vertical separators
    let sx = MARGIN_X
    for (let i = 0; i < cols.length - 1; i++) {
      sx += w[i]
      state.page.drawLine({
        start: { x: sx, y: y }, end: { x: sx, y: y - rh },
        thickness: 0.5, color: HAIRLINE,
      })
    }
    y -= rh
  })
  state.cursorY = y - 6
}

/** flow diagram boxes (simple horizontal/vertical wrap) */
function flowDiagram(steps) {
  const boxW = (PAGE_W - MARGIN_X * 2 - 20) / 2
  const boxH = 38
  const gapX = 20
  const gapY = 14
  const cols = 2

  const rowsNeeded = Math.ceil(steps.length / cols)
  const totalH = rowsNeeded * (boxH + gapY)
  ensureSpace(totalH + 10)

  let i = 0
  for (let r = 0; r < rowsNeeded; r++) {
    for (let c = 0; c < cols; c++) {
      if (i >= steps.length) break
      const x = MARGIN_X + c * (boxW + gapX)
      const y = state.cursorY - boxH
      state.page.drawRectangle({
        x, y, width: boxW, height: boxH,
        borderColor: CRIMSON, borderWidth: 1, color: WHITE,
      })
      // number badge
      state.page.drawRectangle({
        x, y: y + boxH - 16, width: 22, height: 16, color: CRIMSON,
      })
      state.page.drawText(String(i + 1), {
        x: x + 7, y: y + boxH - 13, size: 10, font: fontBold, color: WHITE,
      })
      // label
      const lines = wrap(san(steps[i]), fontBold, 10, boxW - 30)
      let ty = y + boxH - 14
      lines.slice(0, 2).forEach(line => {
        state.page.drawText(line, {
          x: x + 28, y: ty - 10, size: 10, font: fontBold, color: INK,
        })
        ty -= 12
      })
      i++
    }
    state.cursorY -= boxH + gapY
  }
  state.cursorY -= 4
}

// =====================================================================
// BUILD
// =====================================================================

async function build() {
  pdf = await PDFDocument.create()
  fontReg  = await pdf.embedFont(StandardFonts.Helvetica)
  fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  // ============ PORTADA ============
  const cover = pdf.addPage([PAGE_W, PAGE_H])
  state.page = cover
  state.pageNumber = 1
  // crimson top band (taller for cover)
  cover.drawRectangle({ x: 0, y: PAGE_H - 90, width: PAGE_W, height: 90, color: CRIMSON })
  cover.drawText('TERMINAL X', {
    x: MARGIN_X, y: PAGE_H - 55, size: 32, font: fontBold, color: WHITE,
  })
  cover.drawText(san('Punto de Venta · DGII Emisor #42483'), {
    x: MARGIN_X, y: PAGE_H - 78, size: 11, font: fontReg, color: WHITE,
  })

  // Title block (mid page)
  cover.drawText(san('Préstamos & Casa de Empeño'), {
    x: MARGIN_X, y: PAGE_H - 230, size: 30, font: fontBold, color: INK,
  })
  cover.drawLine({
    start: { x: MARGIN_X, y: PAGE_H - 245 },
    end:   { x: MARGIN_X + 80, y: PAGE_H - 245 },
    thickness: 3, color: CRIMSON,
  })
  cover.drawText(san('Cómo funciona el sistema'), {
    x: MARGIN_X, y: PAGE_H - 285, size: 18, font: fontReg, color: INK,
  })
  cover.drawText(san('y cómo venderlo a un cliente'), {
    x: MARGIN_X, y: PAGE_H - 310, size: 18, font: fontReg, color: INK,
  })

  // version block
  cover.drawText(san('Versión v2.16.2'), {
    x: MARGIN_X, y: 180, size: 12, font: fontBold, color: CRIMSON,
  })
  cover.drawText(san('Abril 2026'), {
    x: MARGIN_X, y: 162, size: 11, font: fontReg, color: INK,
  })
  cover.drawText(san('Audiencia: operador de casa de empeño + vendedor Studio X'), {
    x: MARGIN_X, y: 144, size: 10, font: fontReg, color: MUTED,
  })

  // bottom crimson band footer
  cover.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 50, color: CRIMSON })
  cover.drawText('terminalxpos.com', {
    x: MARGIN_X, y: 22, size: 12, font: fontBold, color: WHITE,
  })
  const certTxt = san('Certificación DGII Emisor #42483 - Único POS en RD certificado directo')
  const cw = fontReg.widthOfTextAtSize(certTxt, 9)
  cover.drawText(certTxt, {
    x: PAGE_W - MARGIN_X - cw, y: 24, size: 9, font: fontReg, color: WHITE,
  })

  // ============ PÁGINA 1 — El problema ============
  newPage('El problema que resolvemos')
  h1('El problema que resolvemos')
  p('La casa de empeño promedio en República Dominicana opera hoy con un cóctel peligroso: hojas de Excel que solo el dueño entiende, mensajes de WhatsApp para cobrar, cuadernos a mano, efectivo sin trazabilidad y contratos firmados en papel que después se pierden cuando más se necesitan.')
  h2('Riesgos reales del día a día')
  bullet('Incumplimiento ante la Superintendencia de Bancos: sin reportes de cartera, sin aging de mora, sin tasa anual equivalente declarada.')
  bullet('Contratos extraviados en disputas legales. Sin firma digital ni copia encriptada, una demanda se pierde antes de empezar.')
  bullet('Sin visibilidad de mora. El dueño no sabe quién debe cuánto hasta que abre el cuaderno.')
  bullet('Cobranza reactiva: solo se llama cuando alguien se acuerda. Resultado: cartera tóxica creciendo en silencio.')
  bullet('Prendas vencidas que se acumulan sin liquidar. Capital muerto en una vitrina sin canal de venta.')
  bullet('Venta de prendas sin e-CF: multa DGII a la vuelta de la esquina.')
  h2('La promesa Terminal X')
  quoteBox('Terminal X reemplaza Excel + WhatsApp + cuadernos + papel + caja + tienda online en una sola pantalla. Con certificación DGII directa, contrato firmado digital, dashboard en tiempo real y tienda pública para liquidar prendas vencidas con e-CF.')

  // ============ PÁGINA 2 — Visión general ============
  newPage('Cómo funciona: visión general')
  h1('Cómo funciona: visión general')
  p('El flujo completo del negocio en 8 pasos, desde que entra el cliente hasta la venta final de la prenda vencida vía e-CF DGII.')
  flowDiagram([
    'Cliente llega al local',
    'Crear préstamo o empeño',
    'Firma touch + foto cédula',
    'Contrato PDF + ticket impreso',
    'Cobranza diaria automatizada',
    'Renovación o redención',
    'Si vence: publicar en Tienda',
    'Venta vía e-CF DGII directo',
  ])
  h2('La diferencia')
  p('Cada uno de estos pasos hoy vive en una herramienta distinta (o en la cabeza del dueño). Terminal X los une en un solo flujo, con la data persistida, encriptada y reportable. El cajero ejecuta. El dueño supervisa. El sistema cumple.')

  // ============ PÁGINA 3 — Préstamos personales ============
  newPage('Préstamos personales')
  h1('Préstamos personales')
  h2('Tres modos de amortización')
  bullet('Solo Intereses (default): el cliente paga intereses cada mes y el capital al final. Es el modo más usado en casas de empeño en RD.')
  bullet('Cuota Fija (sistema francés): mismo monto cada mes, intereses al inicio, capital al final.')
  bullet('Capital Fijo (sistema alemán): capital constante, intereses decrecientes. Cuotas que bajan mes a mes.')
  h2('Cumplimiento Superintendencia de Bancos')
  p('La tasa siempre se expresa como "X.XX% mensual (equivalente Y.YY% anual)" en pantalla, contrato y ticket. No hay forma de generar un préstamo sin la tasa anual equivalente declarada.')
  h2('Tabla de amortización')
  bullet('Auto-generada al crear el préstamo, con fecha exacta de cada cuota.')
  bullet('Editable antes de firmar (caso especial, tasa negociada, gracia).')
  bullet('Adjunta como segunda página del contrato PDF.')
  h2('Mora y renovación')
  bullet('Mora diaria configurable por % o monto fijo. Se calcula automática al pasar la fecha.')
  bullet('Renovación con un click: el cliente paga intereses, se extiende la fecha de vencimiento, se mantiene el mismo loan_id y un contador "Renovado N veces" queda en su historial para análisis de riesgo.')

  // ============ PÁGINA 4 — Contrato PDF ============
  newPage('Contrato de préstamo PDF')
  h1('Contrato de préstamo PDF')
  p('El contrato deja de ser un papel suelto. Es un PDF de 3 páginas, firmado digitalmente, con cédula adjunta, encriptado en bucket privado y compartible al instante.')
  h2('Cláusulas SB incluidas automáticamente')
  bullet('Monto del préstamo y desembolso.')
  bullet('Tasa mensual + tasa anual equivalente (TAE).')
  bullet('Fecha de vencimiento y calendario de cuotas.')
  bullet('Cláusula de mora con porcentaje diario.')
  bullet('Garantía (en empeño, descripción de la prenda).')
  bullet('Jurisdicción y domicilio legal.')
  h2('Captura del cliente')
  bullet('Firma touch directo en pantalla del POS o tablet del cajero.')
  bullet('Foto de cédula vía cámara directa o subida de archivo.')
  bullet('Datos básicos: nombre, cédula, teléfono, dirección.')
  h2('PDF resultante')
  bullet('Página 1: contrato con cláusulas y datos.')
  bullet('Página 2: tabla de amortización con todas las cuotas.')
  bullet('Página 3: anexo con firma del cliente y foto de cédula.')
  bullet('Almacenado encriptado en bucket privado, URL firmada con vencimiento de 1 año.')
  bullet('Listo para impresión inmediata o envío por WhatsApp con un click.')

  // ============ PÁGINA 5 — Casa de empeño ============
  newPage('Casa de empeño')
  h1('Casa de empeño')
  p('Para empeño con prenda física, Terminal X agrega valoración, foto múltiple, ticket con código y alertas de vencimiento.')
  h2('Valoración de la prenda')
  bullet('Foto múltiple desde cámara del dispositivo (frente, atrás, detalles, número de serie).')
  bullet('Descripción libre + categoría (joyería, electrónica, vehículo, electrodoméstico).')
  bullet('Valor estimado de mercado.')
  bullet('Porcentaje ofrecido al empeñador (default 60%, configurable por categoría).')
  bullet('Monto prestado auto-calculado en base al valor x porcentaje.')
  h2('Documentación legal')
  bullet('Firma del empeñador + foto de cédula (igual que préstamo personal).')
  bullet('Documentos extra: matrícula del vehículo, contrato adicional, factura original, etc.')
  bullet('Todo guardado en bucket privado con URL firmada.')
  h2('Ticket impreso')
  bullet('Código único de 6 dígitos para entrega de prenda.')
  bullet('Fecha de vencimiento destacada.')
  bullet('Monto a redimir y monto de mora diaria.')
  h2('Estados de la prenda')
  p('Activo -> Redimido (cliente pagó y se llevó la prenda) | Vencido (no pagó, pasó fecha) | Publicado (visible en Tienda Empeños) | Vendido (ya se cerró con e-CF).')
  bullet('Alerta automática 3 días antes del vencimiento al cliente y al cajero.')

  // ============ PÁGINA 6 — Cobranza diaria ============
  newPage('Cobranza diaria')
  h1('Cobranza diaria')
  p('La cobranza deja de ser una tarea reactiva y se convierte en una cola de trabajo priorizada. El cajero abre la pantalla, ve qué cobrar hoy y trabaja la cola.')
  h2('Cola priorizada')
  bullet('Ordenable por días de mora, monto adeudado, último contacto.')
  bullet('Filtros: solo mora, solo vencen hoy, por sucursal, por cobrador.')
  bullet('Cada fila muestra: cliente, teléfono, monto, días vencido, último intento.')
  h2('Resultado de cada intento (un click)')
  bullet('Llamé')
  bullet('Prometió pago (con fecha)')
  bullet('Pagó (genera recibo)')
  bullet('No contestó')
  bullet('Rechazó / no pagará')
  h2('Notas y seguimiento')
  bullet('Campo de notas libre por intento.')
  bullet('Próximo seguimiento programado en el calendario.')
  bullet('Historial completo: cada préstamo guarda todos los intentos, fechas, resultados, notas.')
  h2('WhatsApp template')
  quoteBox('"Hola [nombre], le recordamos su pago vencido de RD$[monto] correspondiente al préstamo del [fecha]. Puede pagar pasando por el local o por transferencia. Saludos, [negocio]."')
  p('El template se rellena con datos reales del préstamo y se abre en WhatsApp con un click. Cero copy-paste.')

  // ============ PÁGINA 7 — Tienda Empeños ============
  newPage('Tienda de Empeños pública')
  h1('Tienda de Empeños pública')
  p('Cuando una prenda vence, deja de ser un problema y se convierte en inventario líquido. Un toggle la publica en una tienda online pública, el cliente final llega vía WhatsApp, y la venta se cierra con e-CF DGII directo.')
  h2('Cómo funciona')
  bullet('Toggle "Publicar para Venta" en cualquier prenda vencida.')
  bullet('URL pública: terminalxpos.com/tienda-empenos/[su-negocio]/[slug-de-la-prenda]')
  bullet('No requiere login para el cliente final. Comparte el link y vende.')
  bullet('Cards con foto, descripción y precio.')
  bullet('Filtros por categoría y rango de precio.')
  h2('Cierre de venta')
  bullet('Botón "WhatsApp" pre-llena el mensaje: "Hola, me interesa el artículo X (RD$ Y)".')
  bullet('El cliente llega al local o coordina entrega.')
  bullet('La venta se procesa en el POS normal con e-CF DGII (NCF E32 o E31).')
  bullet('La prenda pasa a estado Vendido y sale del inventario público automáticamente.')
  h2('Resultado')
  p('Cero capital muerto. Cada prenda vencida tiene un canal de venta con foto, precio y CTA directo a WhatsApp, certificado fiscal DGII.')

  // ============ PÁGINA 8 — Dashboard ============
  newPage('Resumen / Dashboard')
  h1('Resumen / Dashboard')
  p('La pantalla que el dueño abre cada mañana antes del primer café. Estado del negocio en una sola vista.')
  h2('5 KPI tiles')
  bullet('Cartera Activa: total prestado vivo en RD$.')
  bullet('Intereses por Cobrar: lo que vas a ganar este mes si todos pagan.')
  bullet('Mora Actual %: cartera vencida / cartera total.')
  bullet('Redenciones del Mes: cuántos préstamos cerraron pagando.')
  bullet('Tasa de Default %: préstamos que terminaron sin pago vs total.')
  h2('3 tarjetas de alerta')
  bullet('Préstamos en mora hoy (cuántos, cuánto, lista).')
  bullet('Empeños que vencen en 3 días o menos.')
  bullet('Renovaciones recientes (señal de riesgo: cliente que renueva 3+ veces).')
  h2('Vista 1-pantalla')
  p('Sin scroll. Sin reportes que correr. El dueño mira el dashboard 30 segundos y sabe cómo está parado el negocio. Si algo está rojo, hace click y entra al detalle.')

  // ============ PÁGINA 9 — Reporte SB ============
  newPage('Reporte Superintendencia de Bancos')
  h1('Reporte Superintendencia de Bancos')
  p('La SB exige reportes mensuales a casas de préstamo y empeño. Terminal X los genera automáticos.')
  h2('Exportación CSV mensual')
  bullet('Cartera Activa: lista completa de préstamos vivos con cliente, monto, tasa, fecha.')
  bullet('Mora Aging: cartera vencida agrupada por 1-30, 31-60, 61-90, 90+ días.')
  bullet('Redenciones: préstamos cerrados en el mes con detalle de pago.')
  h2('PDF formato oficial SB')
  bullet('Plantilla en desarrollo, pendiente de entrega oficial por SB.')
  bullet('Mientras tanto: CSV ready-to-import en cualquier plantilla.')
  h2('Compliance ready')
  p('Cada documento exportado incluye tasa mensual + tasa anual equivalente (TAE) calculada automáticamente. La auditoría SB ya no es un evento, es un download.')

  // ============ PÁGINA 10 — DGII e-CF ============
  newPage('Cumplimiento DGII (e-CF)')
  h1('Cumplimiento DGII (e-CF)')
  quoteBox('Terminal X es el ÚNICO POS en República Dominicana certificado como emisor directo ante DGII. Certificación #42483.')
  h2('¿Qué significa "emisor directo"?')
  p('Significa que cuando vendes una prenda vencida, el e-CF se firma con tu certificado, se envía directo a DGII desde tu POS, y el NCF entra en tu reporte 606/607 sin intermediarios.')
  h2('Sin terceros')
  bullet('Sin pagar a BHD, Carvajal o Wally.')
  bullet('Sin colas de aprobación de un proveedor externo.')
  bullet('Sin doble-comisión por cada e-CF emitido.')
  h2('Cola offline 72 horas')
  p('Si se cae internet, si el cliente se va sin red, si el local pierde conexión: el e-CF se firma local, queda en cola, y se reenvía automático cuando vuelve la conexión usando el flag IndicadorEnvioDiferido de DGII. El negocio no para nunca.')
  h2('Para casa de empeño esto importa porque...')
  bullet('Cada venta de prenda vencida = un e-CF.')
  bullet('Si no estás en regla, la SB y la DGII te encuentran.')
  bullet('Terminal X cumple por defecto. No hay forma de vender sin generar el comprobante correcto.')

  // ============ PÁGINA 11 — Pricing ============
  newPage('Pricing')
  h1('Pricing')
  p('Dos planes. Sin contratos largos. Sin setup fee. Activación el mismo día.')
  table(
    [
      { header: 'Plan', width: 1.2 },
      { header: 'Precio', width: 1.3 },
      { header: 'Para quién', width: 2.5 },
    ],
    [
      ['Pro PLUS', 'RD$5,490 / mes', '1 sucursal, hasta 3 usuarios. Ideal para casa de empeño individual.'],
      ['Pro MAX',  'RD$9,990 / mes', 'Multi-sucursal, usuarios ilimitados, soporte prioritario WhatsApp directo.'],
    ],
  )
  h2('Comparación vs alternativas')
  table(
    [
      { header: 'Opción', width: 1.5 },
      { header: 'Costo', width: 1.2 },
      { header: 'Problema', width: 2.3 },
    ],
    [
      ['Excel + papel', 'RD$0', 'Caos legal. Contratos perdidos. Sin reporte SB. Sin e-CF.'],
      ['SaaS genérico', 'RD$3-8k/mes', 'No certificado DGII. Pagas terceros por cada e-CF. No tiene módulo de empeño.'],
      ['Terminal X', 'desde RD$5,490', 'Todo-en-uno. Certificado DGII directo. Contrato + cobranza + tienda + e-CF.'],
    ],
  )
  h2('ROI rápido')
  p('Una sola mora cobrada extra al mes paga el plan. Un contrato disputado en tribunal cuesta 10x más que un año entero del sistema.')

  // ============ PÁGINA 12 — Cómo vender ============
  newPage('Cómo vender (script Studio X)')
  h1('Cómo vender (script para el rep de Studio X)')
  h2('Calificación: 5 preguntas')
  numBullet(1, '¿Cuántos préstamos activos manejas hoy?')
  numBullet(2, '¿Cómo registras los contratos? (Excel, papel, sistema)')
  numBullet(3, '¿Has tenido problemas con la SB o disputas legales por contratos perdidos?')
  numBullet(4, '¿Cómo cobras la mora: manual o sistema?')
  numBullet(5, '¿Vendes prendas vencidas? ¿Cómo manejas el e-CF?')

  h2('Pitch en 60 segundos')
  quoteBox('"Tienes [N] préstamos activos. Ahora mismo cada uno depende de un papel firmado que puede perderse, una hoja de Excel que solo tú entiendes, y mensajes de WhatsApp para cobrar. Terminal X te da el contrato firmado digital con foto de cédula guardado encriptado, la cobranza con un click por WhatsApp, el dashboard con tu mora en tiempo real, y cuando una prenda vence la publicas en una tienda online y la vendes con e-CF DGII directo - todo por RD$5,490 al mes. Eso es menos de lo que pierdes en una sola disputa legal por un contrato extraviado."')

  // ============ PÁGINA 13 — Objeciones ============
  newPage('Objeciones + Demo flow')
  h1('Objeciones comunes + respuestas')
  h3('"Es caro."')
  p('RD$5,490 = RD$150/día. Una sola mora cobrada extra paga el mes. Un solo contrato disputado en tribunal cuesta 10x más.')
  h3('"Yo uso WhatsApp y me funciona."')
  p('WhatsApp no te da contrato firmado, no es evidencia legal SB, y no te genera el reporte mensual de cartera. Cuando viene la auditoría, ¿qué les muestras? ¿Capturas de pantalla?')
  h3('"Mi cliente no sabe usar tablets."')
  p('Lo opera tu cajero. El cliente solo firma con el dedo. Igual que firmar en papel pero queda en PDF, encriptado y respaldado.')
  h3('"¿Qué pasa si se cae internet?"')
  p('Cola offline de 72 horas. Sigues vendiendo. El sistema sincroniza solo cuando vuelve internet. Único POS en RD con esto certificado por DGII.')
  h3('"Necesito pensarlo."')
  p('Te dejo demo gratis 7 días con tu data real. Si después no te sirve, no pasas a pago. Sin tarjeta de crédito.')

  h2('Demo flow (15 minutos)')
  numBullet(1, 'Crear préstamo de RD$10,000 a 6 meses al 5% mensual con firma touch (3 min).')
  numBullet(2, 'Mostrar contrato PDF generado al instante (1 min).')
  numBullet(3, 'Crear empeño con foto + valoración + ticket impreso (3 min).')
  numBullet(4, 'Mostrar cobranza diaria con WhatsApp template (2 min).')
  numBullet(5, 'Mostrar dashboard con mora % y alertas (2 min).')
  numBullet(6, 'Mostrar Tienda Empeños pública en el celular del prospecto (2 min).')
  numBullet(7, 'Cierre: pricing + sign-up (2 min).')

  h2('Cierre')
  bullet('Llamada-acción: "Activamos hoy mismo, mañana en la mañana arrancas con tu primer préstamo digital."')
  bullet('Demo gratis 7 días, sin tarjeta de crédito.')
  bullet('Soporte WhatsApp directo durante el onboarding.')

  // ============ ÚLTIMA — Contacto ============
  newPage('Contacto')
  h1('Contacto')
  p('Listo para activar Terminal X en tu casa de empeño o para presentarlo a tu próximo cliente:')
  moveDown(8)

  h3('Web')
  p('terminalxpos.com')

  h3('WhatsApp')
  p('Disponible 7 días en el portal del cliente y durante onboarding.')

  h3('Email')
  p('hola@terminalxpos.com')

  moveDown(20)
  // certification badge
  const badgeY = state.cursorY - 80
  state.page.drawRectangle({
    x: MARGIN_X, y: badgeY, width: PAGE_W - MARGIN_X * 2, height: 80,
    color: CRIMSON,
  })
  state.page.drawText('CERTIFICACIÓN DGII EMISOR #42483', {
    x: MARGIN_X + 20, y: badgeY + 50,
    size: 14, font: fontBold, color: WHITE,
  })
  state.page.drawText(san('Único POS en República Dominicana certificado emisor directo.'), {
    x: MARGIN_X + 20, y: badgeY + 28,
    size: 11, font: fontReg, color: WHITE,
  })
  state.page.drawText(san('Sin BHD. Sin Carvajal. Sin Wally. Sin terceros.'), {
    x: MARGIN_X + 20, y: badgeY + 12,
    size: 11, font: fontReg, color: WHITE,
  })
  state.cursorY = badgeY - 20

  h3('Cross-ecosystem Studio X')
  bullet('Studio X Car Wash - operación de car wash y detallado.')
  bullet('Studio X Media - branding, fotografía y contenido.')
  bullet('Studio X RD Tech - infraestructura y desarrollo a medida.')

  // ===========================================
  const bytes = await pdf.save()
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, bytes)
  return { path: OUT, size: bytes.length, pages: pdf.getPageCount() }
}

build().then(({ path: p, size, pages }) => {
  const kb = (size / 1024).toFixed(1)
  console.log('OK PDF generado')
  console.log('  Path:  ' + p)
  console.log('  Size:  ' + kb + ' KB (' + size + ' bytes)')
  console.log('  Pages: ' + pages)
}).catch(err => {
  console.error('ERROR:', err)
  process.exit(1)
})
