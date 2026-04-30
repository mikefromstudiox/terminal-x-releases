/**
 * Builds docs/sales/ecf-protecciones-terminal-x.pdf
 * One-page sales sheet (Spanish) explaining how Terminal X prevents the 3
 * common e-CF failure modes other DR POS systems suffer from.
 *
 * Brand: black / white / #b3001e (crimson). No gray. No emojis.
 *
 * Run: node docs/sales/build-ecf-protecciones-pdf.mjs
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const PAGE_W = 612, PAGE_H = 792
const MARGIN = 42

const CRIMSON = rgb(0.702, 0, 0.118) // #b3001e
const INK     = rgb(0, 0, 0)
const PAPER   = rgb(1, 1, 1)

async function build() {
  const pdf = await PDFDocument.create()
  const font     = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const page = pdf.addPage([PAGE_W, PAGE_H])

  // Header band — crimson with white wordmark
  const headerH = 70
  page.drawRectangle({ x: 0, y: PAGE_H - headerH, width: PAGE_W, height: headerH, color: CRIMSON })
  page.drawText('TERMINAL X', { x: MARGIN, y: PAGE_H - 38, size: 22, font: fontBold, color: PAPER })
  page.drawText('Por que los e-CFs no se duplican ni se quedan colgados con nosotros',
    { x: MARGIN, y: PAGE_H - 58, size: 10, font, color: PAPER })

  // Subheader — DGII certification badge
  let y = PAGE_H - headerH - 24
  page.drawText('Emisor Electronico CERTIFICADO por la DGII  |  RNC 133410321  |  Ley 32-23',
    { x: MARGIN, y, size: 9, font: fontBold, color: INK })

  y -= 28
  page.drawText('Sus colegas estan reportando dos problemas reales:', { x: MARGIN, y, size: 11, font: fontBold, color: INK })
  y -= 14
  page.drawText('e-CFs DUPLICADOS en la DGII, y submisiones que se quedan COLGADAS sin saber si pasaron.', { x: MARGIN, y, size: 10, font, color: INK })
  y -= 12
  page.drawText('Estos son los tres puntos donde otros sistemas fallan, y como Terminal X los resuelve por diseno:', { x: MARGIN, y, size: 10, font, color: INK })

  // Section helper
  function section(num, title, problem, solution) {
    y -= 22
    // Number badge
    page.drawRectangle({ x: MARGIN, y: y - 4, width: 22, height: 22, color: CRIMSON })
    page.drawText(String(num), { x: MARGIN + 7, y: y + 2, size: 14, font: fontBold, color: PAPER })
    // Title
    page.drawText(title, { x: MARGIN + 32, y: y + 4, size: 12, font: fontBold, color: INK })
    y -= 16
    // Problem label
    page.drawText('El problema:', { x: MARGIN + 32, y, size: 9, font: fontBold, color: CRIMSON })
    y -= 12
    for (const line of problem) {
      page.drawText(line, { x: MARGIN + 32, y, size: 9.5, font, color: INK })
      y -= 12
    }
    y -= 4
    page.drawText('Como lo resolvemos:', { x: MARGIN + 32, y, size: 9, font: fontBold, color: INK })
    y -= 12
    for (const line of solution) {
      page.drawText(line, { x: MARGIN + 32, y, size: 9.5, font, color: INK })
      y -= 12
    }
  }

  section(1,
    'Duplicados en la DGII',
    [
      'El POS firma el e-CF, lo manda a la DGII, la DGII lo acepta, pero la respuesta se pierde',
      '(microcorte de internet o timeout). El POS cree que fallo, lo manda otra vez, y queda',
      'duplicado. El cliente no sabe cual es el bueno y la contabilidad se vuelve un caos.',
    ],
    [
      'Cada e-CF lleva un identificador unico (UUID) generado UNA sola vez. Aunque la cajera',
      'apriete el boton cien veces, el servidor reconoce que ese e-CF ya se firmo y devuelve el',
      'original. Tecnicamente: idempotencia en el endpoint /api/ecf-sign autenticado por JWT.',
    ]
  )

  section(2,
    'Colisiones de NCF entre cajas',
    [
      'En negocios con varias cajas, dos cajeras agarran el mismo numero de NCF al mismo',
      'tiempo. La DGII rechaza el segundo, queda colgado, y la cajera no sabe que hacer.',
    ],
    [
      'Terminal X reparte los rangos de NCF por dispositivo automaticamente. Cada caja',
      'pre-asigna su propio bloque de numeros (configurable: 10, 50, 100 NCFs por bloque).',
      'No existe forma matematica de que dos cajas usen el mismo numero. Multi-POS desde dia 1.',
    ]
  )

  section(3,
    'Submisiones colgadas en el aire',
    [
      'La DGII tarda en responder, el sistema no sabe que hacer, la transaccion queda en',
      'estado "enviando" para siempre. La cajera ya cerro la caja, el cliente se fue, y nadie',
      'sabe si ese e-CF se filtro o no. Suele aparecer en auditoria semanas despues.',
    ],
    [
      'A las 72 horas, Terminal X marca esa submision como "envio diferido" — un mecanismo',
      'que la propia Ley 32-23 contempla — la firma de nuevo y la reenvia. La cajera no hace',
      'nada. Cero pendientes en estado intermedio. Cero llamadas a soporte por esto.',
    ]
  )

  section(4,
    'Notas de credito que llegan antes que la factura padre',
    [
      'La cajera factura y al minuto emite la nota de credito. Si los dos van en el mismo lote',
      'a la DGII y la nota llega primero, la DGII la rechaza ("comprobante no encontrado").',
      'La factura llega despues y se acepta. Resultado: la nota queda en error, los libros',
      'internos dicen una cosa, la DGII dice otra, y el 607 mensual no cuadra. Anular o',
      'poner en cero la nota internamente NO la quita del registro de la DGII.',
    ],
    [
      'Terminal X simplemente no deja salir una nota de credito hasta que la factura padre',
      'este ACEPTADA por DGII. Es una compuerta tecnica: el sistema no firma ni envia esa nota',
      'hasta que tiene la confirmacion de DGII de que la factura padre ya esta registrada.',
      'Si la cajera intenta emitirla muy rapido, ve "Esperando aceptacion de la factura...",',
      'la nota se manda automaticamente segundos despues. Cero cruces en libros, cero 607 roto.',
    ]
  )

  // Why Terminal X is different — closing section
  y -= 24
  page.drawRectangle({ x: MARGIN, y: y - 70, width: PAGE_W - MARGIN * 2, height: 78, color: INK })
  page.drawText('La diferencia que importa', { x: MARGIN + 12, y: y - 4, size: 12, font: fontBold, color: PAPER })
  y -= 18
  const claims = [
    'Somos Emisor Electronico CERTIFICADO por la DGII directamente. No es que cumplimos —',
    'la DGII certifico que cumplimos. RNC 133410321 emitiendo en produccion desde abril 2026.',
    'Las protecciones de arriba estan construidas en el sistema, no son configuraciones opcionales.',
    'Cada cliente nuevo las tiene desde el primer ticket que emite.',
  ]
  for (const c of claims) {
    page.drawText(c, { x: MARGIN + 12, y, size: 9, font, color: PAPER })
    y -= 11
  }

  // CTA box
  y -= 28
  page.drawRectangle({ x: MARGIN, y: y - 38, width: PAGE_W - MARGIN * 2, height: 44, borderColor: CRIMSON, borderWidth: 2, color: PAPER })
  page.drawText('Demo en vivo de 15 minutos:', { x: MARGIN + 14, y: y - 12, size: 11, font: fontBold, color: INK })
  page.drawText('WhatsApp +1 (809) 828-2971', { x: MARGIN + 14, y: y - 27, size: 13, font: fontBold, color: CRIMSON })
  page.drawText('Le mostramos como funciona la firma idempotente y la asignacion automatica de NCFs',
    { x: MARGIN + 230, y: y - 16, size: 8.5, font, color: INK })
  page.drawText('en su propio negocio antes de que firme nada.',
    { x: MARGIN + 230, y: y - 28, size: 8.5, font, color: INK })

  // Footer
  page.drawText('Terminal X  |  Producto de Studio X SRL  |  terminalxpos.com  |  Santo Domingo, Republica Dominicana',
    { x: MARGIN, y: 28, size: 7, font, color: INK })

  const bytes = await pdf.save()
  const out = resolve(__dirname, 'ecf-protecciones-terminal-x.pdf')
  writeFileSync(out, bytes)
  console.log('Wrote:', out, '|', bytes.length, 'bytes')
}

build().catch(e => { console.error(e); process.exit(1) })
