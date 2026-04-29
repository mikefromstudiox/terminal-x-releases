// build-contabilidad-pdfs.mjs — Generates two Spanish PDFs for the contabilidad
// product launch:
//   1. terminal-x-contabilidad-ventas.pdf   — 1-pager hand-out for the salesperson
//   2. terminal-x-contabilidad-guia.pdf      — full user/feature guide for prospects
//
// Run with: node scripts/build-contabilidad-pdfs.mjs
// Output lands in docs/sales/

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '..', 'docs', 'sales')
mkdirSync(OUT_DIR, { recursive: true })

const CRIMSON  = rgb(0.702, 0, 0.118)
const BLACK    = rgb(0, 0, 0)
const WHITE    = rgb(1, 1, 1)
const GREY     = rgb(0.45, 0.45, 0.45)
const LIGHT    = rgb(0.93, 0.93, 0.93)
const SOFT     = rgb(0.97, 0.97, 0.97)

const PAGE_W = 612, PAGE_H = 792
const M_X = 54, M_TOP = 54, M_BOT = 54

const sanitize = (s) => String(s)
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/[—–]/g, "-").replace(/…/g, "...")
  .replace(/[→⟶]/g, "->").replace(/[←⟵]/g, "<-")
  .replace(/[✓✔]/g, "OK").replace(/[✗✘✕]/g, "X")
  .replace(/×/g, "x").replace(/·/g, "-")
  .replace(/[    ]/g, " ")

// ─── Shared layout helpers ─────────────────────────────────────────────────
function makePdfBuilder() {
  return PDFDocument.create().then(async (doc) => {
    const fontReg = await doc.embedFont(StandardFonts.Helvetica)
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)
    const fontItal = await doc.embedFont(StandardFonts.HelveticaOblique)
    return { doc, fontReg, fontBold, fontItal }
  })
}

function wrapLines(text, font, size, maxWidth) {
  const words = sanitize(text).split(/\s+/)
  const lines = []
  let cur = ''
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w
    const wlen = font.widthOfTextAtSize(test, size)
    if (wlen > maxWidth && cur) { lines.push(cur); cur = w }
    else cur = test
  }
  if (cur) lines.push(cur)
  return lines
}

// ─── PDF #1: Sales 1-pager ─────────────────────────────────────────────────
async function buildSalesPager() {
  const { doc, fontReg, fontBold } = await makePdfBuilder()
  const page = doc.addPage([PAGE_W, PAGE_H])
  let y = PAGE_H - M_TOP

  // Crimson banner
  page.drawRectangle({ x: 0, y: PAGE_H - 90, width: PAGE_W, height: 90, color: CRIMSON })
  page.drawText(sanitize('TERMINAL X · CONTABILIDAD'), { x: M_X, y: PAGE_H - 45, size: 11, font: fontBold, color: WHITE })
  page.drawText(sanitize('La herramienta que va a transformar tu portafolio'), { x: M_X, y: PAGE_H - 65, size: 22, font: fontBold, color: WHITE })
  page.drawText(sanitize('Llevas tu contabilidad sin chasing manual. Tus clientes te pagan más rápido.'), { x: M_X, y: PAGE_H - 80, size: 10, font: fontReg, color: WHITE })

  y = PAGE_H - 120

  // Hook
  page.drawText(sanitize('¿Por qué tu colega contadora ya cambió a Terminal X?'), { x: M_X, y, size: 14, font: fontBold, color: BLACK })
  y -= 22
  const hookLines = [
    'Maneja 32 clientes desde UNA sola pantalla. Color rojo = vencido. Verde = radicado.',
    'Genera 606, 607, 608, 609, IR-17 e IR-13 de TODOS sus clientes con UN click. ZIP listo para DGII.',
    'El portal DGII se conecta solo y baja todos los e-CFs recibidos por cliente cada manana.',
    'Conciliacion automatica 606 vs DGII detecta NCFs que faltan grabar.',
    'Drag-and-drop de XML e-CF: el sistema lo postea solo al cliente correcto.',
    'IT-1 mensual con casillas listas. Anticipo ISR PJ calculado por Art. 314.',
    'Activos fijos con flujo de venta/baja y asiento contable automatico.',
    'Nomina con archivo de pago masivo BHD Leon, Banreservas y CSV generico.',
    'Mora automatica en honorarios atrasados, sin calcular a mano.',
    "'Ver como cliente' impersonacion auditada para soporte directo.",
    'Vault con almacenamiento real (S3): subir, descargar, eliminar con audit log.',
    'Bandeja: arrastra el XML, el sistema lee el RNC y lo postea al cliente correcto.',
    'WhatsApp con NCFs faltantes especificos. Antes 3 dias. Ahora 4 horas.',
  ]
  for (const l of hookLines) {
    const wrapped = wrapLines(l, fontReg, 10.5, PAGE_W - M_X * 2 - 14)
    for (let i = 0; i < wrapped.length; i++) {
      if (i === 0) page.drawText('•', { x: M_X, y, size: 11, font: fontBold, color: CRIMSON })
      page.drawText(sanitize(wrapped[i]), { x: M_X + 12, y, size: 10.5, font: fontReg, color: BLACK })
      y -= 14
    }
    y -= 2
  }

  y -= 8

  // Big number block
  page.drawRectangle({ x: M_X, y: y - 80, width: PAGE_W - M_X * 2, height: 80, color: SOFT, borderColor: BLACK, borderWidth: 1 })
  page.drawText(sanitize('AHORRO REAL'), { x: M_X + 16, y: y - 22, size: 9, font: fontBold, color: GREY })
  page.drawText(sanitize('2 días por cierre × 12 meses = 24 días/año recuperados'), { x: M_X + 16, y: y - 40, size: 13, font: fontBold, color: BLACK })
  page.drawText(sanitize('A RD$1,500/hora facturable = RD$288,000/año en horas que vuelves a vender'), { x: M_X + 16, y: y - 58, size: 11, font: fontReg, color: BLACK })
  page.drawText(sanitize('Pro MAX = RD$9,990/mes · ROI año 1: 24x'), { x: M_X + 16, y: y - 72, size: 11, font: fontBold, color: CRIMSON })
  y -= 100

  // Plans grid
  page.drawText(sanitize('PLANES'), { x: M_X, y, size: 10, font: fontBold, color: GREY })
  y -= 18
  const plans = [
    { name: 'Pro', price: 'RD$2,990/mes', desc: 'Para tu propia firma. Plan de cuentas + libro mayor + 606/607/608.' },
    { name: 'Pro PLUS', price: 'RD$5,490/mes', desc: 'Hasta 10 clientes. Bancos BHD/Banreservas. ITBIS proporcionalidad. WhatsApp.' },
    { name: 'Pro MAX', price: 'RD$9,990/mes', desc: 'Clientes ilimitados. Portfolio cockpit + auto-pull DGII + clasificador AI.' },
  ]
  for (const p of plans) {
    const colW = (PAGE_W - M_X * 2 - 16) / 3
    const idx = plans.indexOf(p)
    const x = M_X + idx * (colW + 8)
    const isMax = p.name === 'Pro MAX'
    page.drawRectangle({ x, y: y - 90, width: colW, height: 90, color: isMax ? BLACK : SOFT, borderColor: isMax ? CRIMSON : BLACK, borderWidth: isMax ? 2 : 1 })
    page.drawText(sanitize(p.name), { x: x + 12, y: y - 22, size: 13, font: fontBold, color: isMax ? CRIMSON : BLACK })
    page.drawText(sanitize(p.price), { x: x + 12, y: y - 38, size: 11, font: fontBold, color: isMax ? WHITE : BLACK })
    const wrapped = wrapLines(p.desc, fontReg, 9, colW - 24)
    let yy = y - 54
    for (const ln of wrapped) {
      page.drawText(sanitize(ln), { x: x + 12, y: yy, size: 9, font: fontReg, color: isMax ? WHITE : BLACK })
      yy -= 12
    }
  }
  y -= 110

  // Pitch script
  page.drawText(sanitize('GUIÓN DE 30 SEGUNDOS'), { x: M_X, y, size: 10, font: fontBold, color: GREY })
  y -= 18
  const pitch = '"¿Cuántas horas pierdes cada cierre bajando comprobantes del portal DGII cliente por cliente? Terminal X te conecta una vez y los baja todos automáticamente cada mañana. El 606 y 607 los genera con un click para todos tus clientes a la vez. Si un cliente no te ha enviado un comprobante, le mandas WhatsApp con el NCF exacto desde el sistema. Pro MAX RD$9,990 al mes. Si te ahorra dos días al cierre, ya pagaste el año."'
  const pl = wrapLines(pitch, fontReg, 10, PAGE_W - M_X * 2 - 14)
  for (const l of pl) { page.drawText(sanitize(l), { x: M_X, y, size: 10, font: fontReg, color: BLACK }); y -= 13 }

  y -= 8

  // Objection handlers
  page.drawText(sanitize('OBJECIONES'), { x: M_X, y, size: 10, font: fontBold, color: GREY })
  y -= 16
  const obj = [
    ['"Es muy caro"',                    'Saca cuenta: 24 días/año recuperados a RD$1,500/hora = RD$288k. RD$120k al año en plan paga 2.4x sólo de tiempo.'],
    ['"Ya uso Alegra/Indexa/Excel"',     'Alegra es por negocio, no por portafolio. Indexa no tiene auto-pull DGII. Excel no escala. Ninguno tiene el cockpit.'],
    ['"Tengo que migrar todo"',          'No. Cada cliente sigue llevando su POS donde tenga. Tú sólo agregas su RNC y empiezas a recibir sus comprobantes.'],
    ['"DGII no permite eso"',            'Sí permite. Es la misma sesión que ya usas tú a mano cada día — sólo automatizada con tus credenciales.'],
  ]
  for (const [q, a] of obj) {
    page.drawText(sanitize(q), { x: M_X, y, size: 10, font: fontBold, color: CRIMSON })
    y -= 13
    const wrapped = wrapLines(a, fontReg, 9.5, PAGE_W - M_X * 2 - 14)
    for (const ln of wrapped) { page.drawText(sanitize(ln), { x: M_X + 12, y, size: 9.5, font: fontReg, color: BLACK }); y -= 12 }
    y -= 4
  }

  // Footer
  const footY = M_BOT - 14
  page.drawLine({ start: { x: M_X, y: footY + 20 }, end: { x: PAGE_W - M_X, y: footY + 20 }, thickness: 0.5, color: LIGHT })
  page.drawText(sanitize('terminalxpos.com  ·  +1 (809) 828-2971  ·  Studio X SRL · RNC 133410321'), { x: M_X, y: footY, size: 8.5, font: fontReg, color: GREY })
  page.drawText(sanitize('Certificado DGII como Emisor Electrónico directo · sin PSFE'), { x: M_X, y: footY - 12, size: 8.5, font: fontReg, color: GREY })

  return doc.save()
}

// ─── PDF #2: Full user/feature guide ──────────────────────────────────────
async function buildUserGuide() {
  const { doc, fontReg, fontBold, fontItal } = await makePdfBuilder()
  let page = doc.addPage([PAGE_W, PAGE_H])
  let y = PAGE_H - M_TOP

  function addPage() {
    page = doc.addPage([PAGE_W, PAGE_H])
    y = PAGE_H - M_TOP
    page.drawRectangle({ x: 0, y: PAGE_H - 28, width: PAGE_W, height: 28, color: CRIMSON })
    page.drawText(sanitize('TERMINAL X · CONTABILIDAD · GUÍA COMPLETA'), { x: M_X, y: PAGE_H - 19, size: 9, font: fontBold, color: WHITE })
    y = PAGE_H - 60
  }
  function ensure(n) { if (y - n < M_BOT) addPage() }
  function h1(t) { ensure(40); page.drawText(sanitize(t), { x: M_X, y, size: 18, font: fontBold, color: CRIMSON }); y -= 26 }
  function h2(t) { ensure(28); page.drawText(sanitize(t), { x: M_X, y, size: 13, font: fontBold, color: BLACK }); y -= 18 }
  function h3(t) { ensure(20); page.drawText(sanitize(t), { x: M_X, y, size: 11, font: fontBold, color: CRIMSON }); y -= 15 }
  function p(t, opts = {}) {
    const size = opts.size || 10
    const font = opts.bold ? fontBold : (opts.italic ? fontItal : fontReg)
    const color = opts.color || BLACK
    const wrapped = wrapLines(t, font, size, PAGE_W - M_X * 2)
    for (const l of wrapped) { ensure(size + 4); page.drawText(sanitize(l), { x: M_X, y, size, font, color }); y -= size + 3 }
    y -= 3
  }
  function bullet(t) {
    const wrapped = wrapLines(t, fontReg, 10, PAGE_W - M_X * 2 - 14)
    for (let i = 0; i < wrapped.length; i++) {
      ensure(14)
      if (i === 0) page.drawText('•', { x: M_X, y, size: 11, font: fontBold, color: CRIMSON })
      page.drawText(sanitize(wrapped[i]), { x: M_X + 12, y, size: 10, font: fontReg, color: BLACK })
      y -= 13
    }
    y -= 2
  }
  function spacer(n = 8) { y -= n }

  // Cover
  page.drawRectangle({ x: 0, y: PAGE_H - 200, width: PAGE_W, height: 200, color: BLACK })
  page.drawRectangle({ x: 0, y: PAGE_H - 220, width: PAGE_W, height: 20, color: CRIMSON })
  page.drawText(sanitize('TERMINAL X'), { x: M_X, y: PAGE_H - 80, size: 11, font: fontBold, color: CRIMSON })
  page.drawText(sanitize('Contabilidad'), { x: M_X, y: PAGE_H - 130, size: 36, font: fontBold, color: WHITE })
  page.drawText(sanitize('Guía completa de planes y funcionalidades'), { x: M_X, y: PAGE_H - 165, size: 14, font: fontReg, color: WHITE })
  page.drawText(sanitize('Versión 2026.04 · Studio X SRL · RNC 133410321'), { x: M_X, y: PAGE_H - 188, size: 9, font: fontReg, color: WHITE })
  y = PAGE_H - 280

  h1('Resumen ejecutivo')
  p('Terminal X Contabilidad es la primera plataforma diseñada específicamente para contadoras dominicanas que manejan portafolios de clientes. Conecta directo a la DGII como Emisor Electrónico certificado (Cert #42483 · Ley 32-23) — sin intermediarios PSFE, sin costo por comprobante.')
  spacer()
  p('A diferencia de Alegra, Indexa o Xubio (que están diseñados para que UN negocio lleve sus propios libros), Terminal X te da un cockpit unificado: todos tus clientes en una sola pantalla, todos los formularios DGII generados con un click, y una conexión automática al portal de la DGII para bajar los comprobantes recibidos por cliente.', { italic: true })
  spacer(14)

  // Plans
  h1('Planes y precios')
  h2('Pro · RD$2,990/mes')
  p('Para una sola firma — tu propia contabilidad personal o de tu negocio.')
  bullet('Plan de cuentas + asientos + libro mayor + balanza de comprobación')
  bullet('Estados financieros: Balance General, Estado de Resultados, Flujo de efectivo')
  bullet('Comprobantes 606 / 607 / 608 / 609 (entrada manual o CSV)')
  bullet('Calendario fiscal con TODAS las obligaciones DGII (IT-1, IR-3, IR-17, TSS, anticipos, etc.)')
  bullet('Bandeja de documentos con OCR y clasificación')
  bullet('Vault de archivos por categoría y vencimiento')
  bullet('Honorarios — facturación de servicios profesionales con e-CF')
  spacer()

  h2('Pro PLUS · RD$5,490/mes')
  p('Para una contadora con hasta 10 clientes en su portafolio.')
  p('Incluye TODO el plan Pro, más:', { bold: true })
  bullet('Cartera de clientes con régimen (ordinario / RST / sin operaciones) y tipo persona (PF / PJ / EIRL)')
  bullet('Generación automática de obligaciones por cliente según su régimen — un click crea el calendario anual')
  bullet('Importación masiva CSV de comprobantes (606 / 607) con detección automática de columnas')
  bullet('ITBIS proporcionalidad (Norma 06-23): facturado, retenido, sujeto a proporcionalidad, llevado al costo')
  bullet('Detección automática 30% / 100% retención ITBIS según RNC formal o supplier informal')
  bullet('Conciliación bancaria con BHD León, Banreservas, Banco Popular y Scotiabank (CSV/OFX)')
  bullet('Nómina TSS / AFP / SFS / INFOTEP / ISR con escalas y topes 2026 oficiales')
  bullet('Activos fijos con depreciación línea recta automática (3 categorías DGII)')
  bullet('Tareas con kanban y vinculación a obligaciones')
  bullet('Reportes ejecutivos (P&L, Balance General, aging) exportables a PDF')
  bullet('Recordatorios WhatsApp a clientes — vencimientos, honorarios pendientes, estados listos')
  spacer()

  h2('Pro MAX · RD$9,990/mes — Plan estrella')
  p('Clientes ilimitados. Diseñado para firmas con 25+ clientes activos.')
  p('Incluye TODO el plan Pro PLUS, más:', { bold: true })
  bullet('Portfolio Cockpit — Una sola pantalla con todos tus clientes y su estado en cada obligación: verde radicado, ámbar listo, rojo vencido, gris no aplica. Drill-down con un click.')
  bullet('Generación batch — Genera 606, 607, 608 y 609 de TODOS tus clientes con un solo click. Resultado: un ZIP listo para subir al portal DGII.')
  bullet('Auto-pull DGII Mis Comprobantes — Conecta una vez por cliente y el sistema baja automáticamente todos los e-CFs recibidos cada mañana.')
  bullet('Clasificador inteligente Norma 07-18 — Categoriza automáticamente cada compra en las 11 categorías DGII (gastos personal, servicios, arrendamientos, activos, representación, financieros, seguros, regalías, impuestos, importación, otros) con override manual.')
  bullet('Conciliacion 606 vs DGII — Compara automaticamente tu registro local con los e-CFs que el portal DGII tiene registrados. Encuentra NCFs faltantes en uno u otro lado y diferencias de monto. Importa los faltantes con un click.')
  bullet('Drag-and-drop XML e-CF — Arrastra cualquier XML e-CF a la Bandeja y el sistema lo parsea, identifica el cliente por RNC, y lo postea automaticamente como comprobante con todos los campos llenos.')
  bullet('IT-1 calculadora mensual — Casillas C1 a C13 calculadas en tiempo real desde tus 606/607/608. Boton Copiar TSV para pegar directo al portal DGII.')
  bullet('IR-17 e IR-13 generators — Otras retenciones mensuales (IR-17) y resumen anual (IR-13) en formato TXT pipe-delimitado listo para subir a DGII.')
  bullet('Anticipos ISR PJ (Art. 314) — Calculadora automatica del 1.5% sobre ingresos brutos previos vs 100% del ISR previo dividido entre 12. Schedule mensual visible en el calendario.')
  bullet('Activos fijos con flujo de venta y baja — Boton "Vender / dar de baja" genera asiento contable automatico (DR efectivo + DR depreciacion acumulada / CR costo + DR/CR ganancia o perdida). Piso de valor residual enforzado en depreciacion.')
  bullet('Honorarios con mora automatica — % configurable y dias de gracia por cliente. Calculo automatico al marcar pagado tarde. Boton "Reaplicar mora" muestra proyeccion de cobranza pendiente.')
  bullet('Pago masivo BHD Leon / Banreservas / CSV generico — Genera el archivo de nomina listo para subir al banco. Formato CSV con columnas oficiales BHD o pipe-delimitado para Banreservas. Excluye empleados sin cuenta y avisa.')
  bullet('"Ver como cliente" impersonacion — Auditada via activity_log en ambas tenants (firma + cliente). Banner crimson sticky muestra el modo activo. Toda accion queda registrada.')
  bullet('Vault con almacenamiento real (Supabase Storage) — Sube PDFs, XMLs, XLSs hasta 50MB. Carpetas por cliente y periodo. Solo tu firma ve sus archivos (RLS). Audit log en cada upload/download/delete.')
  bullet('Doc-chase WhatsApp — Detecta NCFs en el portal DGII que el cliente no te ha enviado y genera mensaje WhatsApp con el listado exacto faltante.')
  bullet('"Ver como cliente" — Modo impersonación auditado para resolver dudas sin pedirle al cliente que te dé acceso a su sesión.')
  bullet('Reportes cross-firm — Compara P&L y márgenes entre todos tus clientes en un dashboard agregado.')
  bullet('Exportación masiva XLS/PDF de balanza, mayor y estados — un archivo por cliente.')
  spacer()

  // Comparison
  h1('Comparación con la competencia')
  const comparisons = [
    ['Característica',                      'Terminal X',  'Alegra',   'Indexa',   'Excel'],
    ['Precio por mes',                      'RD$9,990',    'USD$129',  'RD$5,000', 'Gratis'],
    ['Cockpit multi-cliente',               'Sí',          'No',       'Limitado', 'No'],
    ['Generar 606/607 todos los clientes',  '1 click',     'Por cliente', 'Por cliente', 'Manual'],
    ['Auto-pull DGII Mis Comprobantes',     'Sí',          'No',       'No',       'No'],
    ['Clasificación AI Norma 07-18',        'Sí',          'No',       'No',       'No'],
    ['e-CF directo DGII (sin PSFE)',        'Sí',          'No',       'No',       'No'],
    ['Bancos DR (BHD, Banreservas, etc.)',  'Todos',       'Manual',   'Limitado', 'Manual'],
    ['WhatsApp doc-chase',                  'Sí',          'No',       'No',       'No'],
  ]
  const colWidths = [180, 80, 70, 80, 70]
  for (let row = 0; row < comparisons.length; row++) {
    ensure(20)
    let x = M_X
    const isHeader = row === 0
    for (let c = 0; c < comparisons[row].length; c++) {
      const w = colWidths[c]
      page.drawRectangle({ x, y: y - 14, width: w, height: 16, color: isHeader ? BLACK : (row % 2 === 0 ? SOFT : WHITE), borderColor: BLACK, borderWidth: 0.4 })
      page.drawText(sanitize(comparisons[row][c]), { x: x + 4, y: y - 10, size: 9, font: isHeader ? fontBold : (c === 1 ? fontBold : fontReg), color: isHeader ? WHITE : (c === 1 ? CRIMSON : BLACK) })
      x += w
    }
    y -= 16
  }
  spacer(20)

  // Workflow
  addPage()
  h1('Flujo de trabajo típico (mensual)')
  h3('Día 1-3 — Recepción de documentos')
  bullet('Pro MAX: el sistema descarga automáticamente todos los e-CFs del portal DGII cada noche. Cero acción manual.')
  bullet('Pro PLUS: el cliente envía sus PDFs/XMLs por WhatsApp y los subes a la Bandeja con drag-and-drop.')
  bullet('Si falta algún comprobante: clic derecho → "Pedir por WhatsApp" → mensaje generado con el listado exacto.')

  h3('Día 5-10 — Clasificación y registro')
  bullet('Pro MAX: el clasificador inteligente asigna automáticamente las categorías Norma 07-18 a cada compra.')
  bullet('Tú revisas las que tengan baja confianza (marcadas en ámbar) y ajustas.')
  bullet('Las retenciones ITBIS 30%/100% se asignan automáticamente según el RNC del proveedor.')

  h3('Día 11-14 — Generación de formularios')
  bullet('Vas al Portfolio cockpit. Ves el estado de los 32 clientes en una sola pantalla.')
  bullet('Clic en "Generar 606 todos" → ZIP con un archivo TXT por cliente, listo para subir.')
  bullet('Repites para 607, 608 y 609. Total: 4 clicks. Tiempo: 90 segundos.')

  h3('Día 15 — Cierre y radicación')
  bullet('Subes los TXT al portal DGII. Marcas cada obligación como "radicado" en el cockpit.')
  bullet('El sistema cambia el color de cada celda a verde. Tu portfolio queda 100% al día.')
  bullet('Mandas el reporte ejecutivo a cada cliente por WhatsApp con un click desde Reportes.')

  // Detailed feature reference
  addPage()
  h1('Referencia detallada de funciones')

  h2('1. Bandeja')
  p('Centro de recepción de documentos. Soporta PDF, XML (e-CF), JPG, PNG. Cada documento pasa por OCR + clasificación automática (factura, retención, estado bancario, TSS, contrato, otro). Después de clasificar, se "postea" generando el asiento contable automático según las reglas configuradas.')

  h2('2. Cartera')
  p('Roster de clientes de la firma. Cada cliente tiene: RNC/cédula, tipo de persona (PF/PJ/EIRL), régimen (ordinario/RST/sin operaciones), día de cierre mensual, honorarios mensuales, status (active/paused/archived). Botón "Generar año" crea las 12 meses de obligaciones automáticamente según el régimen.')

  h2('3. Calendario fiscal')
  p('Vista de las próximas 30 días de obligaciones DGII de todos los clientes. Filtro por cliente. 20 plantillas DGII registradas: IT-1, 606, 607, 608, 609, IR-3, IR-17, TSS, DGT-4, ANT-IR2, ANT-RST, IR-1, IR-2, Anexo A, IR-13, DGT-3, ANT-IR1 (1ra/2da/3ra cuota), RST-1. Cada obligación tiene fecha de vencimiento exacta y estado.')

  h2('4. Tareas')
  p('Kanban con 4 columnas: Pendiente, En progreso, En revisión, Hecho. Cada tarea puede vincularse a una obligación específica para tracking. Asignable a usuarios del equipo.')

  h2('5. Comprobantes')
  p('Registro principal de compras (606), ventas (607) y anulados (608) por cliente. Acepta entrada manual o importación masiva CSV. La importación CSV detecta automáticamente: separador (coma/pipe/tab), formato fecha (dd/mm/yyyy o yyyy-mm-dd), decimales US (1,234.56) o EU (1.234,56), columnas de débito/crédito separadas o monto firmado. Cada fila tiene 4 columnas de ITBIS por Norma 06-23. Tipo de Bienes y Servicios (1-11) se asigna automáticamente con el clasificador.')

  h2('6. Libro Mayor')
  p('Plan de cuentas configurable (Catálogo Único DR 2026 pre-cargado). Asientos manuales o automáticos (auto-post rules). Balanza de comprobación, mayor por cuenta, estado de resultados, balance general — todos en tiempo real desde el navegador. Exportación PDF con marca de agua.')

  h2('7. Banco')
  p('Conciliación bancaria. Conecta cuentas BHD León, Banreservas, Banco Popular, Scotiabank (más "Otro" para CSV genérico). Importa CSV o OFX exportado del portal del banco. Match automático con asientos contables. Alertas de partidas no conciliadas.')

  h2('8. Nómina')
  p('Períodos quincenales o mensuales. Cálculo automático de TSS (AFP 2.87% empleado / 7.10% empleador, SFS 3.04% / 7.09% — caps 2026 en RD$464,460 AFP y RD$232,230 SFS), INFOTEP 1% empleador, ISR progresivo (escalas DGII 2026), riesgos laborales 1.10%. Genera IR-3 mensual para subir a DGII y planilla TSS lista para SUIRPLUS.')

  h2('9. Activos fijos')
  p('3 categorías DGII (Cat 1: 5% inmuebles, Cat 2: 25% mobiliario y vehículos, Cat 3: 50% maquinaria y software). Depreciación línea recta automática con asiento contable mensual. Tracking de venta y baja por write-off.')

  h2('10. Reportes')
  p('Dashboards ejecutivos: P&L, Balance General, aging de cuentas por cobrar, cobertura DGII (% de obligaciones radicadas a tiempo). Exportación PDF para enviar a clientes por correo o WhatsApp.')

  h2('11. Vault')
  p('Repositorio de documentos por cliente (contratos, certificaciones, constancias, facturas). Categorización + tracking de vencimiento (ej. RNC vence en 11/2027 → alerta a los 30 días).')

  h2('12. Honorarios')
  p('Plan de facturación por cliente (monto mensual + día de corte + tipo e-CF E31/E32). Genera la factura electrónica automáticamente cada mes. Tracking de cobranza con aging y recordatorios WhatsApp.')

  // FAQ
  addPage()
  h1('Preguntas frecuentes')

  h3('¿Tengo que migrar todos mis clientes a Terminal X?')
  p('No. Tus clientes pueden seguir llevando sus operaciones donde tengan (otro POS, Excel, lo que sea). Tú sólo agregas su RNC en Cartera y empiezas a recibir sus e-CFs y declaraciones desde tu Terminal X.')

  h3('¿Cómo funciona el auto-pull de la DGII?')
  p('Configuras una vez tus credenciales DGII Oficina Virtual por cliente (encriptadas con AES-GCM en reposo). Cada noche, un worker se conecta al portal de cada cliente y descarga los nuevos e-CFs recibidos. Llegan a tu Bandeja clasificados y listos para postear.')

  h3('¿Qué pasa si la DGII cambia su portal?')
  p('Mantenemos el scraper actualizado como parte del servicio. Si DGII cambia algo, parcheamos en cuestión de horas. Es nuestra responsabilidad mantener la integración funcionando.')

  h3('¿Mis credenciales están seguras?')
  p('Sí. Se encriptan con AES-GCM usando una clave derivada por HKDF de tu master key + salt único por cliente. Nunca las almacenamos en texto plano. Solo el worker autorizado puede desencriptarlas en el momento de la sincronización.')

  h3('¿Puedo cambiar de plan en cualquier momento?')
  p('Sí. Subes o bajas de plan desde el panel admin. El cambio se aplica de inmediato. No hay penalización ni período mínimo.')

  h3('¿Hay descuento por contrato anual?')
  p('Sí. 15% de descuento si pagas el año completo. Pro MAX queda en RD$8,491/mes.')

  h3('¿Tengo soporte directo?')
  p('Pro MAX incluye ejecutivo de cuenta dedicado y soporte prioritario por WhatsApp. Pro PLUS tiene soporte WhatsApp en horario laboral. Pro tiene autoservicio con guías + email.')

  h3('¿Qué pasa si me canceló DGII el certificado?')
  p('Terminal X te avisa con banner rojo 30 días antes del vencimiento del .p12 y bloquea la emisión el día que vence. Cuando lo renuevas con Viafirma, lo subes al panel y todo continúa. Sin sorpresas, sin multas.')

  // CTA
  addPage()
  page.drawRectangle({ x: 0, y: PAGE_H - 200, width: PAGE_W, height: 200, color: CRIMSON })
  page.drawText(sanitize('Listo para empezar?'), { x: M_X, y: PAGE_H - 80, size: 28, font: fontBold, color: WHITE })
  page.drawText(sanitize('Prueba gratis 7 días — Pro MAX completo, sin tarjeta'), { x: M_X, y: PAGE_H - 110, size: 14, font: fontReg, color: WHITE })
  page.drawText(sanitize('terminalxpos.com/signup'), { x: M_X, y: PAGE_H - 145, size: 18, font: fontBold, color: WHITE })
  page.drawText(sanitize('WhatsApp directo: +1 (809) 828-2971'), { x: M_X, y: PAGE_H - 170, size: 12, font: fontReg, color: WHITE })

  y = PAGE_H - 240
  h2('Próximos pasos')
  bullet('Crea tu cuenta en terminalxpos.com/signup — selecciona business type "Contabilidad"')
  bullet('Importa tu cartera de clientes con CSV (RNC, nombre, régimen, persona)')
  bullet('Genera el calendario anual de obligaciones para cada cliente con un click')
  bullet('Conecta tus credenciales DGII para activar el auto-pull (Pro MAX)')
  bullet('Importa tu primer 606 desde CSV — el sistema clasifica automáticamente')
  bullet('Empieza a usar el Portfolio cockpit el primer cierre')

  spacer(20)
  p('Studio X SRL · RNC 133410321 · Santo Domingo, República Dominicana', { italic: true, color: GREY })
  p('Terminal X es una marca registrada. Certificado DGII como Emisor Electrónico directo (Cert #42483).', { italic: true, color: GREY })

  return doc.save()
}

// ─── Build both ────────────────────────────────────────────────────────────
const sales = await buildSalesPager()
const guide = await buildUserGuide()

const salesPath = resolve(OUT_DIR, 'terminal-x-contabilidad-ventas.pdf')
const guidePath = resolve(OUT_DIR, 'terminal-x-contabilidad-guia.pdf')

writeFileSync(salesPath, sales)
writeFileSync(guidePath, guide)

console.log(`✅ Sales 1-pager: ${salesPath} (${(sales.length / 1024).toFixed(1)} KB)`)
console.log(`✅ User guide:    ${guidePath} (${(guide.length / 1024).toFixed(1)} KB)`)
