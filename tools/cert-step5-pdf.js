/**
 * cert-step5-pdf.js — PERSONAL REFERENCE (Studio X Tech RNC 133410321)
 *
 * Generates Step 5 PDFs (Representación Impresa) for each e-CF type. Reads
 * actual signed XMLs from test-xmls/step4-sim/ to extract exact data for QR timbre.
 *
 * For the reusable client-facing version, see tools/ecf-pdf.js (config-driven).
 *
 * Usage: node tools/cert-step5-pdf.js
 * Output: test-xmls/step5-pdfs/
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib')
const QRCode = require('qrcode')

const XML_DIR = path.join(__dirname, '../test-xmls/step4-sim')
const OUT_DIR = path.join(__dirname, '../test-xmls/step5-pdfs')
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })

const E = { rnc: '133410321', nombre: 'STUDIO X SRL', comercial: 'STUDIO X', dir: 'TEODORO CHASSEROU, No. 20, MANGANAGUA', tel: '809-870-0712' }

const ECF_LABELS = {
  '31': 'FACTURA DE CREDITO FISCAL ELECTRONICA',
  '32': 'FACTURA DE CONSUMO ELECTRONICA',
  '33': 'NOTA DE DEBITO ELECTRONICA',
  '34': 'NOTA DE CREDITO ELECTRONICA',
  '41': 'COMPRAS ELECTRONICA',
  '43': 'GASTOS MENORES ELECTRONICA',
  '44': 'REGIMENES ESPECIALES ELECTRONICA',
  '45': 'GUBERNAMENTAL ELECTRONICA',
  '46': 'EXPORTACIONES ELECTRONICA',
  '47': 'PAGOS AL EXTERIOR ELECTRONICA',
}

function xmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`))
  return m ? m[1].trim() : ''
}

function parseXml(filePath) {
  const xml = fs.readFileSync(filePath, 'utf8')
  const tipo = xmlTag(xml, 'TipoeCF')
  const encf = xmlTag(xml, 'eNCF')
  const fechaEmision = xmlTag(xml, 'FechaEmision')
  const fechaFirma = xmlTag(xml, 'FechaHoraFirma')
  const montoTotal = xmlTag(xml, 'MontoTotal')
  const rncComprador = xmlTag(xml, 'RNCComprador') || xmlTag(xml, 'IdentificadorExtranjero')
  const razonComprador = xmlTag(xml, 'RazonSocialComprador')
  const sigValue = xmlTag(xml, 'SignatureValue').replace(/\s/g, '')
  const securityCode = sigValue ? sigValue.substring(0, 6) : '000000'

  // Parse items
  const items = []
  const itemMatches = xml.matchAll(/<Item>([\s\S]*?)<\/Item>/g)
  for (const im of itemMatches) {
    const block = im[1]
    const name = block.match(/<NombreItem>([^<]+)/)?.[1] || 'Item'
    const qty = parseFloat(block.match(/<CantidadItem>([^<]+)/)?.[1] || '1')
    const price = parseFloat(block.match(/<PrecioUnitarioItem>([^<]+)/)?.[1] || '0')
    const amount = parseFloat(block.match(/<MontoItem>([^<]+)/)?.[1] || '0')
    items.push({ name, qty, price, amount })
  }

  // Parse totals
  const totalITBIS = parseFloat(xmlTag(xml, 'TotalITBIS') || '0')
  const montoGravado = parseFloat(xmlTag(xml, 'MontoGravadoTotal') || '0')
  const montoExento = parseFloat(xmlTag(xml, 'MontoExento') || '0')
  const subtotal = montoGravado || montoExento || (parseFloat(montoTotal) - totalITBIS)

  // Reference eNCF (for E33/E34)
  const refEncf = xmlTag(xml, 'eNCFModificado')

  return { tipo, encf, fechaEmision, fechaFirma, montoTotal, rncComprador, razonComprador, securityCode, items, subtotal, itbis: totalITBIS, total: parseFloat(montoTotal), refEncf }
}

function fmtRD(n) {
  return 'RD$ ' + Number(n).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

async function generatePDF(data) {
  const { tipo, encf, fechaEmision, fechaFirma, montoTotal, rncComprador, razonComprador, securityCode, items, subtotal, itbis, total, refEncf } = data

  const PAGE_W = 226
  const MARGIN = 12
  const COL_W = PAGE_W - MARGIN * 2
  const LINE_H = 12
  const SMALL = 7
  const NORMAL = 8
  const LARGE = 12
  const QR_SIZE = 80

  // QR URL — per DGII Informe Tecnico pag 35, lowercase params per dgii-ecf reference
  // Consumer <250K uses consultatimbrefc (no comprador/dates)
  const isConsumerUnder250K = tipo === '32' && total < 250000 && !rncComprador
  // E43 (gastos menores) and E47 (pagos al exterior) have no RNCComprador — omit param
  const omitComprador = tipo === '43' || tipo === '47'
  const compradorParam = omitComprador ? '' : `RncComprador=${encodeURIComponent(rncComprador)}&`
  const encode = encodeURIComponent
  const qrUrl = isConsumerUnder250K
    ? `https://fc.dgii.gov.do/certecf/consultatimbrefc?rncemisor=${E.rnc}&encf=${encf}&montototal=${montoTotal}&codigoseguridad=${encode(securityCode)}`
    : `https://ecf.dgii.gov.do/certecf/consultatimbre?rncemisor=${E.rnc}&${compradorParam}encf=${encf}&fechaemision=${encode(fechaEmision)}&montototal=${montoTotal}&fechafirma=${encode(fechaFirma)}&codigoseguridad=${encode(securityCode)}`

  const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: QR_SIZE * 3, margin: 1 })
  const qrBytes = Buffer.from(qrDataUrl.split(',')[1], 'base64')

  // Calculate page height
  let lineCount = 0
  lineCount += 4  // header
  lineCount += 2  // doc type + gap
  lineCount += 3  // fecha, ncf, security code
  if (rncComprador) lineCount += 2  // client name + rnc
  if (refEncf) lineCount += 1
  lineCount += 1  // separator
  lineCount += items.length  // items
  lineCount += 1  // separator
  lineCount += 3  // subtotal, itbis, total
  lineCount += 1  // payment
  lineCount += 1  // separator
  lineCount += 3  // footer
  const pageH = MARGIN * 2 + lineCount * LINE_H + QR_SIZE + 56

  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const fontB = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([PAGE_W, pageH])

  let y = pageH - MARGIN

  function drawText(text, opts = {}) {
    const f = opts.bold ? fontB : font
    const size = opts.size || NORMAL
    const t = String(text)
    const tw = f.widthOfTextAtSize(t, size)
    let xPos = MARGIN
    if (opts.center) xPos = MARGIN + (COL_W - tw) / 2
    else if (opts.right) xPos = MARGIN + COL_W - tw
    page.drawText(t, { x: xPos, y, size, font: f, color: rgb(0, 0, 0) })
    y -= LINE_H
  }

  function drawCols(left, right, opts = {}) {
    const f = opts.bold ? fontB : font
    const size = opts.size || NORMAL
    page.drawText(String(left), { x: MARGIN, y, size, font: f, color: rgb(0.3, 0.3, 0.3) })
    const rStr = String(right)
    const rw = f.widthOfTextAtSize(rStr, size)
    page.drawText(rStr, { x: MARGIN + COL_W - rw, y, size, font: f, color: rgb(0, 0, 0) })
    y -= LINE_H
  }

  function drawRule() {
    page.drawLine({
      start: { x: MARGIN, y: y + 4 },
      end: { x: PAGE_W - MARGIN, y: y + 4 },
      thickness: 0.5,
      color: rgb(0.75, 0.75, 0.75),
    })
    y -= 8
  }

  // Header
  drawText(E.comercial, { bold: true, size: LARGE, center: true })
  drawText(E.nombre, { size: SMALL, center: true })
  drawText(E.dir, { size: SMALL, center: true })
  drawText('Tel: ' + E.tel + '  RNC: ' + E.rnc, { size: SMALL, center: true })
  drawRule()

  // Document type
  drawText(ECF_LABELS[tipo] || 'e-CF', { bold: true, size: SMALL, center: true })
  y -= 4

  // Doc info — all from actual XML
  drawCols('Fecha:', fechaEmision)
  drawCols('e-NCF:', encf)
  drawCols('Cod. Seguridad:', securityCode)
  if (rncComprador) {
    drawCols('Cliente:', razonComprador)
    drawCols(rncComprador.length > 11 ? 'ID:' : 'RNC:', rncComprador)
  }
  if (refEncf) drawCols('Ref:', refEncf)
  drawRule()

  // Items
  for (const it of items) {
    const desc = it.qty > 1 ? `${it.name} x${it.qty}` : it.name
    drawCols(desc, fmtRD(it.amount))
  }
  drawRule()

  // Totals
  drawCols('Subtotal:', fmtRD(subtotal))
  drawCols('ITBIS (18%):', fmtRD(itbis))
  drawCols('TOTAL:', fmtRD(total), { bold: true, size: LARGE })
  y -= 4
  drawCols('Forma de pago:', 'Contado')
  drawRule()

  // QR
  const qrImage = await doc.embedPng(qrBytes)
  const qrX = MARGIN + (COL_W - QR_SIZE) / 2
  page.drawImage(qrImage, { x: qrX, y: y - QR_SIZE, width: QR_SIZE, height: QR_SIZE })
  y -= QR_SIZE + 4
  const vLabel = 'Verificar en dgii.gov.do'
  const vw = font.widthOfTextAtSize(vLabel, 6)
  page.drawText(vLabel, { x: MARGIN + (COL_W - vw) / 2, y, size: 6, font, color: rgb(0.4, 0.4, 0.4) })
  y -= LINE_H
  const scLabel = `Codigo de Seguridad: ${securityCode}`
  const sw = font.widthOfTextAtSize(scLabel, 6)
  page.drawText(scLabel, { x: MARGIN + (COL_W - sw) / 2, y, size: 6, font, color: rgb(0.4, 0.4, 0.4) })
  y -= LINE_H
  const firmaLabel = `Fecha de Firma Digital: ${fechaFirma}`
  const fw = font.widthOfTextAtSize(firmaLabel, 6)
  page.drawText(firmaLabel, { x: MARGIN + (COL_W - fw) / 2, y, size: 6, font, color: rgb(0.4, 0.4, 0.4) })
  y -= LINE_H

  // Footer
  drawText('Gracias por preferirnos!', { size: SMALL, center: true })
  drawText('Powered by Terminal X', { size: 6, center: true })

  const pdfBytes = await doc.save()

  // Label: use tipo, mark E32 variants
  let label = tipo
  if (tipo === '32' && total >= 250000) label = '32_250K'
  else if (tipo === '32') label = '32_LT250K'
  const outFile = `Rep_Impresa_E${label}.pdf`
  fs.writeFileSync(path.join(OUT_DIR, outFile), pdfBytes)
  console.log('OK', outFile, `eNCF=${encf}`, `sec=${securityCode}`, `fecha=${fechaEmision}`, `firma=${fechaFirma}`, `total=${montoTotal}`, `(${(pdfBytes.length / 1024).toFixed(1)} KB)`)
  console.log('   QR:', qrUrl)
}

async function run() {
  // Scan step4-sim XMLs (skip RFCE_ and ACECF_ files)
  const files = fs.readdirSync(XML_DIR).filter(f => f.endsWith('.xml') && !f.startsWith('RFCE_') && !f.startsWith('ACECF_'))
  console.log(`Found ${files.length} XMLs in step4-sim/\n`)

  // Parse all XMLs
  const allData = files.map(f => parseXml(path.join(XML_DIR, f)))

  // Pick one per type. For E32, pick one >=250K and one <250K.
  const picked = new Map()
  for (const d of allData) {
    if (d.tipo === '32') {
      const key = d.total >= 250000 ? '32_250K' : '32_LT250K'
      if (!picked.has(key)) picked.set(key, d)
    } else {
      if (!picked.has(d.tipo)) picked.set(d.tipo, d)
    }
  }

  console.log(`Generating ${picked.size} PDFs (one per e-CF type):\n`)
  for (const [key, data] of picked) {
    await generatePDF(data)
    console.log('')
  }

  // Check total size
  const pdfFiles = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.pdf'))
  const totalKB = pdfFiles.reduce((sum, f) => sum + fs.statSync(path.join(OUT_DIR, f)).size, 0) / 1024
  console.log(`Total: ${pdfFiles.length} PDFs, ${totalKB.toFixed(1)} KB (limit: 10MB)`)
  console.log('Output:', OUT_DIR)
}

run().catch(e => console.error(e))
