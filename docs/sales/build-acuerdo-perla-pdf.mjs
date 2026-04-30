/**
 * Builds docs/sales/acuerdo-cofundadora-perla.pdf — partnership letter to Perla.
 *
 * Voice: Mike's, first person, written for Perla specifically. Reads like a
 * letter that happens to be a binding agreement, not a contract template.
 * Brand: black / white / #b3001e crimson. No gray. No emojis.
 * Run: node docs/sales/build-acuerdo-perla-pdf.mjs
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PAGE_W = 612, PAGE_H = 792
const M = 48
const CRIMSON = rgb(0.702, 0, 0.118)
const INK     = rgb(0, 0, 0)
const PAPER   = rgb(1, 1, 1)

async function build() {
  const pdf = await PDFDocument.create()
  const body  = await pdf.embedFont(StandardFonts.TimesRoman)
  const ital  = await pdf.embedFont(StandardFonts.TimesRomanItalic)
  const bold  = await pdf.embedFont(StandardFonts.TimesRomanBold)
  const sans  = await pdf.embedFont(StandardFonts.HelveticaBold)
  const page = pdf.addPage([PAGE_W, PAGE_H])

  // Helper — wrap a paragraph at given width
  function wrap(text, font, size, maxW) {
    const words = text.split(/\s+/)
    const lines = []
    let cur = ''
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w
      if (font.widthOfTextAtSize(test, size) > maxW) {
        if (cur) lines.push(cur)
        cur = w
      } else cur = test
    }
    if (cur) lines.push(cur)
    return lines
  }
  function draw(text, x, yPos, font, size, color = INK) {
    page.drawText(text, { x, y: yPos, size, font, color })
  }
  function drawWrapped(text, x, yStart, font, size, maxW, lineHeight, color = INK) {
    let yy = yStart
    for (const ln of wrap(text, font, size, maxW)) {
      draw(ln, x, yy, font, size, color)
      yy -= lineHeight
    }
    return yy
  }

  // Crimson left rail — narrow, asymmetric (not a banner)
  page.drawRectangle({ x: 0, y: 0, width: 18, height: PAGE_H, color: CRIMSON })

  // Letterhead — small, tight, top-right
  draw('TERMINAL X', PAGE_W - M - sans.widthOfTextAtSize('TERMINAL X', 11), PAGE_H - M, sans, 11, CRIMSON)
  draw('Studio X SRL  ·  Santo Domingo  ·  RNC 133410321',
       PAGE_W - M - body.widthOfTextAtSize('Studio X SRL  ·  Santo Domingo  ·  RNC 133410321', 8),
       PAGE_H - M - 12, body, 8)

  let y = PAGE_H - M - 50

  // Salutation
  draw('Para Perla Lugo Garcia', M, y, bold, 12)
  y -= 14
  draw('Contabilidad Perla Lugo  ·  Santo Domingo', M, y, ital, 10)
  y -= 28

  // Title — slightly larger, no all-caps
  draw('Acuerdo de Cofundadora', M, y, bold, 18, CRIMSON)
  y -= 16
  draw('Modulo de Contabilidad — Terminal X', M, y, ital, 11)

  y -= 26

  // Opening — Mike's voice
  const W = PAGE_W - 2 * M
  y = drawWrapped(
    'Perla, despues de nuestra conversacion del 30 de abril, donde me contaste que tus colegas estan teniendo problemas con e-CFs duplicados y submisiones colgadas, me quedo claro que tu no eres solo una cliente — eres la persona indicada para ayudarme a hacer del modulo de contabilidad de Terminal X EL modulo de contabilidad de Republica Dominicana.',
    M, y, body, 10.5, W, 13
  )
  y -= 6
  y = drawWrapped(
    'Esta carta es nuestro acuerdo. Es directo, sin letra chiquita, y vale para los proximos 12 meses.',
    M, y, body, 10.5, W, 13
  )

  y -= 18
  // What I commit (Mike's voice)
  draw('Lo que yo me comprometo contigo:', M, y, bold, 11.5)
  y -= 16

  const commits = [
    ['Pro MAX gratis de por vida.',
     'Para tu firma y para los primeros 20 clientes que migres o refieras a Terminal X. Cero pesos al mes mientras dure este acuerdo.'],
    ['25% recurrente sobre cada contadora que tu refieras.',
     'Sobre la mensualidad real cobrada, durante los primeros 12 meses de esa contadora. Te transfiero el dia 5 de cada mes, sin que tengas que pedirlo.'],
    ['RD$ 5,000 cash el dia que esa contadora firma.',
     'Bono de activacion. Una vez por cliente. Pagado al confirmar el primer mes facturado.'],
    ['Acceso 48 horas antes que nadie a cada release del modulo.',
     'Si encuentras algo que no funciona, no sale en publico hasta que tu lo apruebes.'],
    ['Tu nombre en el material de Terminal X. El nombre Terminal X en el tuyo.',
     'Co-marketing. Caso de exito oficial. Tu firma listada como Partner Cofundadora.'],
  ]

  for (const [t, d] of commits) {
    // Crimson bullet
    page.drawCircle({ x: M + 4, y: y + 4, size: 2.4, color: CRIMSON })
    draw(t, M + 14, y, bold, 10.5)
    y -= 13
    y = drawWrapped(d, M + 14, y, body, 10, W - 14, 12)
    y -= 6
  }

  y -= 4

  // What I ask of you
  draw('Lo que te pido a cambio:', M, y, bold, 11.5)
  y -= 16

  const asks = [
    'Una llamada de 30 minutos por semana — WhatsApp video, el dia que te quede mejor — donde me cuentes que viste, que falto, que te pidieron tus clientes.',
    'Meta concreta: 5 contadoras referidas y firmadas en los proximos 90 dias.',
    'Una o dos demos por mes a contadoras prospecto, presentadas como cliente real, no como pitch de venta.',
    'Discrecion mutua sobre roadmap, precios negociados y datos de clientes. Lo que se hable entre nosotros queda entre nosotros.',
  ]
  for (const a of asks) {
    page.drawCircle({ x: M + 4, y: y + 4, size: 2.4, color: CRIMSON })
    y = drawWrapped(a, M + 14, y, body, 10, W - 14, 12)
    y -= 5
  }

  y -= 6

  // Salida
  draw('Si esto no funciona:', M, y, bold, 11.5)
  y -= 14
  y = drawWrapped(
    'Cualquiera de los dos puede terminar el acuerdo con 30 dias de aviso. Las comisiones de los clientes que ya me referiste se te siguen pagando hasta completar los 12 meses de cada uno. Tu cuenta y las cuentas que migraste siguen operativas. No hay sorpresas ni penalidades.',
    M, y, body, 10, W, 12
  )

  // Atribucion — small footnote-style
  y -= 12
  draw('Como contamos un referido:', M, y, ital, 9, CRIMSON)
  y -= 11
  y = drawWrapped(
    'La contadora se considera referida por ti si te menciona en el signup, o si tu me la presentas por escrito antes de que firme. La comision aplica sobre el pago real recibido (neto de impuestos y reembolsos), no sobre el precio de lista.',
    M, y, ital, 9, W, 11
  )

  // Signatures — handwritten feel: just two lines, no big "FIRMAS" header
  y -= 30
  // Left: Mike
  page.drawLine({ start: { x: M, y }, end: { x: M + 230, y }, thickness: 0.7, color: INK })
  draw('Michael M. Mejia', M, y - 12, bold, 10)
  draw('Fundador  ·  Studio X SRL  ·  Terminal X', M, y - 24, body, 9)
  draw('Fecha:  ____ / ____ / 2026', M, y - 38, body, 9)

  // Right: Perla
  const rx = M + 290
  page.drawLine({ start: { x: rx, y }, end: { x: rx + 220, y }, thickness: 0.7, color: INK })
  draw('Perla Lugo Garcia', rx, y - 12, bold, 10)
  draw('Contabilidad Perla Lugo', rx, y - 24, body, 9)
  draw('Fecha:  ____ / ____ / 2026', rx, y - 38, body, 9)

  // Footer — tight, brand line
  draw('terminalxpos.com  ·  WhatsApp +1 (809) 828-2971  ·  Hecho a mano en Santo Domingo',
       M, 30, ital, 8)

  const bytes = await pdf.save()
  const out = resolve(__dirname, 'acuerdo-cofundadora-perla.pdf')
  writeFileSync(out, bytes)
  console.log('Wrote:', out, '|', bytes.length, 'bytes')
}

build().catch(e => { console.error(e); process.exit(1) })
