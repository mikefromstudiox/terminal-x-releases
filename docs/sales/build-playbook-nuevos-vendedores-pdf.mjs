/**
 * Builds docs/sales/playbook-nuevos-vendedores.pdf
 *
 * Field manual for new sales hires: what Terminal X is, what makes it
 * different, the pricing tiers, common objections, and a tight demo flow.
 * Designed to read fast on a phone while waiting outside a client's shop.
 *
 * Brand: black / white / #b3001e crimson. No emojis. Spanish primary.
 * Run: node docs/sales/build-playbook-nuevos-vendedores-pdf.mjs
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PAGE_W = 612, PAGE_H = 792
const M = 42
const CRIMSON = rgb(0.702, 0, 0.118)
const INK     = rgb(0, 0, 0)
const PAPER   = rgb(1, 1, 1)
const FAINT   = rgb(0.55, 0.55, 0.55)

async function build() {
  const pdf = await PDFDocument.create()
  const body  = await pdf.embedFont(StandardFonts.Helvetica)
  const ital  = await pdf.embedFont(StandardFonts.HelveticaOblique)
  const bold  = await pdf.embedFont(StandardFonts.HelveticaBold)
  const sans  = await pdf.embedFont(StandardFonts.HelveticaBold)

  function wrap(text, font, size, maxW) {
    const words = String(text || '').split(/\s+/)
    const lines = []; let cur = ''
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w
      if (font.widthOfTextAtSize(test, size) > maxW) { if (cur) lines.push(cur); cur = w }
      else cur = test
    }
    if (cur) lines.push(cur)
    return lines
  }

  let page, y
  function newPage(showHeader = true) {
    page = pdf.addPage([PAGE_W, PAGE_H])
    y = PAGE_H - M
    if (showHeader) {
      // Crimson left rail (asymmetric — same brand language as the Perla letter).
      page.drawRectangle({ x: 0, y: 0, width: 12, height: PAGE_H, color: CRIMSON })
      // Tiny letterhead top-right
      page.drawText('TERMINAL X', { x: PAGE_W - M - sans.widthOfTextAtSize('TERMINAL X', 9), y: PAGE_H - M, size: 9, font: sans, color: CRIMSON })
      page.drawText('Playbook Vendedores', { x: PAGE_W - M - body.widthOfTextAtSize('Playbook Vendedores', 7), y: PAGE_H - M - 10, size: 7, font: body, color: FAINT })
      y = PAGE_H - M - 30
    }
  }
  function draw(text, x, yPos, font, size, color = INK) {
    page.drawText(String(text), { x, y: yPos, size, font, color })
  }
  function H1(text) {
    if (y < 200) newPage()
    y -= 4
    page.drawRectangle({ x: M, y: y - 22, width: PAGE_W - M * 2, height: 22, color: CRIMSON })
    draw(text, M + 10, y - 14, bold, 13, PAPER)
    y -= 32
  }
  function H2(text) {
    if (y < 80) newPage()
    draw(text, M, y, bold, 11, INK)
    y -= 4
    page.drawLine({ start: { x: M, y: y }, end: { x: M + 60, y: y }, thickness: 1.2, color: CRIMSON })
    y -= 14
  }
  function P(text, opts = {}) {
    const f = opts.italic ? ital : opts.bold ? bold : body
    const size = opts.size || 9.5
    const w = PAGE_W - M * 2 - (opts.indent || 0)
    for (const line of wrap(text, f, size, w)) {
      if (y < M + 24) newPage()
      draw(line, M + (opts.indent || 0), y, f, size, opts.color || INK)
      y -= size + 2.5
    }
    y -= 3
  }
  function bullet(text, opts = {}) {
    const size = opts.size || 9.5
    const f = opts.bold ? bold : body
    const w = PAGE_W - M * 2 - 14
    const lines = wrap(text, f, size, w)
    for (let i = 0; i < lines.length; i++) {
      if (y < M + 24) newPage()
      if (i === 0) page.drawCircle({ x: M + 4, y: y + 3, size: 2, color: CRIMSON })
      draw(lines[i], M + 14, y, f, size)
      y -= size + 2.5
    }
    y -= 1
  }
  function quote(text) {
    if (y < 80) newPage()
    page.drawRectangle({ x: M, y: y - 4, width: 3, height: 18, color: CRIMSON })
    const lines = wrap(text, ital, 10, PAGE_W - M * 2 - 14)
    for (let i = 0; i < lines.length; i++) {
      if (y < M + 24) newPage()
      if (i > 0) page.drawRectangle({ x: M, y: y - 4, width: 3, height: 14, color: CRIMSON })
      draw(lines[i], M + 14, y, ital, 10, INK)
      y -= 13
    }
    y -= 4
  }

  // ── Page 1 — Cover + Mission ─────────────────────────────────────────────
  page = pdf.addPage([PAGE_W, PAGE_H])
  y = PAGE_H
  // Big crimson band
  page.drawRectangle({ x: 0, y: PAGE_H - 200, width: PAGE_W, height: 200, color: CRIMSON })
  page.drawText('TERMINAL X', { x: M, y: PAGE_H - 90, size: 36, font: bold, color: PAPER })
  page.drawText('PLAYBOOK PARA VENDEDORES', { x: M, y: PAGE_H - 120, size: 14, font: sans, color: PAPER })
  page.drawText('Edicion 2026-04-30  ·  Confidencial', { x: M, y: PAGE_H - 138, size: 9, font: ital, color: PAPER })
  page.drawText('Como vender el unico POS DGII-CERTIFICADO de Republica Dominicana', { x: M, y: PAGE_H - 175, size: 11, font: body, color: PAPER })
  y = PAGE_H - 230
  H2('La mision en una linea')
  P('Cada negocio en RD merece un POS que NO se duplique, NO se cuelgue y NO le rompa el 607. Terminal X es el unico que lo cumple por diseno — y es el unico CERTIFICADO directamente por la DGII (RNC 133410321).')
  H2('Por que existe Terminal X')
  P('La DGII obliga a todo negocio a emitir e-CFs antes del 15 de mayo de 2026. Los sistemas existentes en el mercado fueron disenados antes de la Ley 32-23 y le ponen parches. Terminal X fue construido despues de la ley — desde cero, certificado, con cada proteccion que la regulacion exige. Eso es nuestra diferencia.')
  H2('A quien le vendemos')
  bullet('Negocios de cualquier vertical con RNC y DGII postulado (o que quieran postular con Tech X).')
  bullet('Carwash, tienda, licoreria, restaurante, salon/barberia, mecanica, concesionario, prestamos, contabilidad. 9 verticales en una sola plataforma.')
  bullet('Contadoras y contadores que manejan portafolios de clientes — bonus enorme: el modulo Contabilidad reduce su trabajo mensual en horas.')
  bullet('Cliente que ya tiene otro POS y se queja de duplicados, colgados o "no me cuadra el 607". Esos son los mas faciles de cerrar.')

  // ── Page 2 — Diferenciadores e-CF ────────────────────────────────────────
  newPage()
  H1('Los 4 problemas que solo Terminal X resuelve')
  P('Esto es el corazon del pitch. Memoricelos. Cuando un cliente diga "ya tengo POS", usted le pregunta cual de estos 4 problemas tiene — y casi siempre tiene al menos uno.', { italic: true })

  H2('1. Duplicados en la DGII')
  P('Otros sistemas firman, mandan, pierden la respuesta y vuelven a mandar — DGII queda con duplicados. Terminal X es idempotente: cada e-CF lleva un UUID unico que se firma UNA sola vez. Imposible duplicar.')

  H2('2. Colisiones de NCF entre cajas')
  P('En negocios con varias registradoras, dos cajeras agarran el mismo NCF al mismo tiempo y la segunda queda colgada. Terminal X reparte rangos de NCF por dispositivo automaticamente — no existe forma matematica de que choquen.')

  H2('3. Submisiones colgadas en el aire')
  P('A las 72 horas, Terminal X marca cualquier submision pendiente como "envio diferido" — un mecanismo que la propia Ley 32-23 contempla — la firma de nuevo y la reenvia. La cajera no hace absolutamente nada.')

  H2('4. Notas de credito antes que la factura padre')
  P('La cajera factura y al minuto emite la nota de credito. Si los dos van al mismo tiempo a la DGII y la NC llega primero, la DGII rechaza la NC y deja el 607 roto. Terminal X simplemente no deja salir la NC hasta que la factura padre este ACEPTADA. Cero notas huerfanas.')

  H2('La frase que cierra ventas')
  quote('Tus colegas tienen ese problema porque sus sistemas fueron certificados antes de la ley. Terminal X fue certificado DESPUES de la ley. Por eso nosotros no tenemos esos problemas.')

  // ── Page 3 — Planes + objeciones + demo ──────────────────────────────────
  newPage()
  H1('Planes y precios')
  bullet('Pro — RD$ 2,490/mes — POS basico, inventario, reportes diarios. SIN e-CF. (Ideal para informales transitando.)', { bold: true })
  bullet('Facturacion — Tier dedicado solo a e-CF + 606/607 — para negocios que ya tienen POS y solo necesitan emitir.', { bold: true })
  bullet('Pro PLUS — RD$ 4,490/mes — incluye e-CF, comisiones, multi-vertical (restaurante/salon/concesionario/licoreria/etc.), WhatsApp, todas las herramientas.', { bold: true })
  bullet('Pro MAX — RD$ 6,990/mes — todo lo anterior + multi-sucursal, dashboard remoto, AI Contabilidad, modo offline. Para los grandes.', { bold: true })
  bullet('15% OFF en plan anual.')
  bullet('7 dias de prueba GRATIS automaticos en signup — Pro MAX completo, sin tarjeta.')

  H2('Objeciones comunes y como responder')

  P('"Eso esta caro."', { bold: true })
  P('Comparenos con StarSISA: ellos cobran ~RD$ 12,500/mes minimo. Pro PLUS de Terminal X es 64% mas barato y trae mas. Y el cliente promedio recupera el costo en una sola venta de RD$ 5,000.')

  P('"Yo ya tengo otro POS."', { bold: true })
  P('Perfecto — pregunteles si tienen los 4 problemas que listamos. La respuesta casi siempre es "si, alguno". Eso le abre la puerta para hacerle ver lo que se esta perdiendo.')

  P('"No tengo certificado DGII todavia."', { bold: true })
  P('Tech X (nuestra empresa hermana) hace la certificacion completa por usted. RD$ 15K-55K segun el caso, todo incluido. Si firma con nosotros antes del 1 de mayo, lo metemos en la cola de Tech X sin lista de espera.')

  P('"Necesito probarlo primero."', { bold: true })
  P('Excelente. Vaya a terminalxpos.com, hace signup en 60 segundos, le aparece un boton "Probar emision" que le muestra una factura electronica completa con QR de DGII. Sin instalar nada. 7 dias de Pro MAX gratis para que la pruebe en serio.')

  P('"Y si no funciona?"', { bold: true })
  P('Soporte por WhatsApp directo al fundador. +1 (809) 828-2971. No call centers, no tickets. Yo personalmente respondo.')

  H2('La demo en 3 minutos')
  bullet('Abra terminalxpos.com en su telefono delante del cliente.')
  bullet('Haga signup con datos suyos. Demora 60 segundos.')
  bullet('Vaya a /pos/dgii. Aparece el panel "Probar emision". Aprieta el boton.')
  bullet('Le sale eNCF + trackId + QR de DGII en 2 segundos. Eso es exactamente lo que sus competidores tardan dias en lograr instalar.')
  bullet('Luego dele a "Cargar certificado". 30 segundos. Listo.')
  bullet('Cierre: "Esto que le mostre tomo 3 minutos. Su sistema actual tomo 3 semanas. Cuanto le vale el tiempo?"')

  // ── Page 4 — Recursos y contacto ─────────────────────────────────────────
  newPage()
  H1('Recursos para usted')
  bullet('Sitio: terminalxpos.com')
  bullet('Demo en vivo: terminalxpos.com/pos (signup -> /pos/dgii -> boton Probar)')
  bullet('PDF de protecciones e-CF (compartir con prospects): docs/sales/ecf-protecciones-terminal-x.pdf')
  bullet('Comparacion vs StarSISA: docs/sales/terminal-x-vs-starsisa.pdf')
  bullet('Guia para Restaurantes: docs/sales/guia-venta-restaurante-terminal-x.pdf')
  bullet('Guia para Concesionarios: docs/sales/terminal-x-concesionario.pdf')
  bullet('Guia para Contabilidad: docs/sales/terminal-x-contabilidad-ventas.pdf')

  H2('Comisiones para usted')
  bullet('25% de la mensualidad de cada cliente que cierre, recurrente durante los primeros 12 meses. Pagado el dia 5 de cada mes.', { bold: true })
  bullet('RD$ 5,000 cash el dia que el cliente firma y paga el primer mes.', { bold: true })
  bullet('Sin tope de clientes referidos.')
  bullet('Bonus trimestral de RD$ 25,000 si cierra 10+ clientes en el trimestre.')

  H2('Contacto interno')
  P('Cualquier duda tecnica, pregunta de cliente, cita con un prospect — escribame directo:')
  P('Michael M. Mejia — Fundador, Studio X SRL', { bold: true })
  P('WhatsApp +1 (809) 828-2971')
  P('Email michaelmmejia@icloud.com')

  H2('Recordatorio final')
  quote('La urgencia no la tenemos nosotros — la tiene la DGII. Mayo 15 de 2026 es ley. Cada negocio sin e-CF para esa fecha pierde su validez fiscal. Usted no esta vendiendo un POS — esta vendiendo cumplimiento legal antes de la fecha.')

  // Footer on each page (after all pages added)
  const pages = pdf.getPages()
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]
    p.drawText(`Terminal X · Studio X SRL · RNC 133410321 · terminalxpos.com · WhatsApp +1 (809) 828-2971 · Pagina ${i + 1} de ${pages.length}`,
      { x: M, y: 22, size: 7, font: body, color: FAINT })
  }

  const bytes = await pdf.save()
  const out = resolve(__dirname, 'playbook-nuevos-vendedores.pdf')
  writeFileSync(out, bytes)
  console.log('Wrote:', out, '|', bytes.length, 'bytes,', pages.length, 'pages')
}

build().catch(e => { console.error(e); process.exit(1) })
