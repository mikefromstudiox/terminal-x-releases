/**
 * ecf-pdf.js — Generate Step 5 PDFs (Representacion Impresa) from client config
 *
 * Usage: node tools/ecf-pdf.js <config.json>
 * Reads signed XMLs from ecf-output-{RNC}/, generates one PDF per e-CF type with QR.
 */
const fs = require('fs')
const path = require('path')
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib')
const QRCode = require('qrcode')

const configPath = process.argv[2]
if (!configPath) { console.error('Usage: node tools/ecf-pdf.js <config.json>'); process.exit(1) }

const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'))
const XML_DIR = path.join(path.dirname(configPath), `ecf-output-${cfg.rnc}`)
const OUT_DIR = path.join(XML_DIR, 'pdfs')
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })

const ENV_PATH = { DEV: 'testecf', CERT: 'certecf', PROD: 'ecf' }
const envPath = ENV_PATH[cfg.environment] || 'certecf'

const ECF_LABELS = {
  '31': 'FACTURA DE CREDITO FISCAL ELECTRONICA', '32': 'FACTURA DE CONSUMO ELECTRONICA',
  '33': 'NOTA DE DEBITO ELECTRONICA', '34': 'NOTA DE CREDITO ELECTRONICA',
  '41': 'COMPRAS ELECTRONICA', '43': 'GASTOS MENORES ELECTRONICA',
  '44': 'REGIMENES ESPECIALES ELECTRONICA', '45': 'GUBERNAMENTAL ELECTRONICA',
  '46': 'EXPORTACIONES ELECTRONICA', '47': 'PAGOS AL EXTERIOR ELECTRONICA',
}

function xmlTag(xml, tag) { const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`)); return m ? m[1].trim() : '' }

function parseXml(filePath) {
  const xml = fs.readFileSync(filePath, 'utf8')
  const tipo = xmlTag(xml, 'TipoeCF'), encf = xmlTag(xml, 'eNCF')
  const fechaEmision = xmlTag(xml, 'FechaEmision'), fechaFirma = xmlTag(xml, 'FechaHoraFirma')
  const montoTotal = xmlTag(xml, 'MontoTotal')
  const rncComprador = xmlTag(xml, 'RNCComprador') || xmlTag(xml, 'IdentificadorExtranjero')
  const razonComprador = xmlTag(xml, 'RazonSocialComprador')
  const sigValue = xmlTag(xml, 'SignatureValue').replace(/\s/g, '')
  const securityCode = sigValue ? sigValue.substring(0, 6) : '000000'
  const items = []
  for (const im of xml.matchAll(/<Item>([\s\S]*?)<\/Item>/g)) {
    const b = im[1]
    items.push({ name: b.match(/<NombreItem>([^<]+)/)?.[1]||'Item', qty: parseFloat(b.match(/<CantidadItem>([^<]+)/)?.[1]||'1'), price: parseFloat(b.match(/<PrecioUnitarioItem>([^<]+)/)?.[1]||'0'), amount: parseFloat(b.match(/<MontoItem>([^<]+)/)?.[1]||'0') })
  }
  const totalITBIS = parseFloat(xmlTag(xml, 'TotalITBIS') || '0')
  const montoGravado = parseFloat(xmlTag(xml, 'MontoGravadoTotal') || '0')
  const montoExento = parseFloat(xmlTag(xml, 'MontoExento') || '0')
  const subtotal = montoGravado || montoExento || (parseFloat(montoTotal) - totalITBIS)
  const refEncf = xmlTag(xml, 'eNCFModificado')
  return { tipo, encf, fechaEmision, fechaFirma, montoTotal, rncComprador, razonComprador, securityCode, items, subtotal, itbis: totalITBIS, total: parseFloat(montoTotal), refEncf }
}

function fmtRD(n) { return 'RD$ ' + Number(n).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

async function generatePDF(data) {
  const { tipo, encf, fechaEmision, fechaFirma, montoTotal, rncComprador, razonComprador, securityCode, items, subtotal, itbis, total, refEncf } = data
  const PAGE_W = 226, MARGIN = 12, COL_W = PAGE_W - MARGIN * 2, LINE_H = 12, SMALL = 7, NORMAL = 8, LARGE = 12, QR_SIZE = 80

  const isConsumerUnder250K = tipo === '32' && total < 250000 && !rncComprador
  const omitComprador = tipo === '43' || tipo === '47'
  const compradorParam = omitComprador ? '' : `RncComprador=${encodeURIComponent(rncComprador)}&`
  const encode = encodeURIComponent
  const qrUrl = isConsumerUnder250K
    ? `https://fc.dgii.gov.do/${envPath}/consultatimbrefc?rncemisor=${cfg.rnc}&encf=${encf}&montototal=${montoTotal}&codigoseguridad=${encode(securityCode)}`
    : `https://ecf.dgii.gov.do/${envPath}/consultatimbre?rncemisor=${cfg.rnc}&${compradorParam}encf=${encf}&fechaemision=${encode(fechaEmision)}&montototal=${montoTotal}&fechafirma=${encode(fechaFirma)}&codigoseguridad=${encode(securityCode)}`

  const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: QR_SIZE * 3, margin: 1 })
  const qrBytes = Buffer.from(qrDataUrl.split(',')[1], 'base64')

  let lineCount = 4 + 2 + 3 + items.length + 3 + 1 + 1 + 3
  if (rncComprador) lineCount += 2
  if (refEncf) lineCount += 1
  const pageH = MARGIN * 2 + lineCount * LINE_H + QR_SIZE + 56

  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const fontB = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([PAGE_W, pageH])
  let y = pageH - MARGIN

  function drawText(text, opts = {}) {
    const f = opts.bold ? fontB : font, size = opts.size || NORMAL, t = String(text)
    const tw = f.widthOfTextAtSize(t, size)
    let xPos = MARGIN
    if (opts.center) xPos = MARGIN + (COL_W - tw) / 2
    else if (opts.right) xPos = MARGIN + COL_W - tw
    page.drawText(t, { x: xPos, y, size, font: f, color: rgb(0, 0, 0) }); y -= LINE_H
  }
  function drawCols(left, right, opts = {}) {
    const f = opts.bold ? fontB : font, size = opts.size || NORMAL
    page.drawText(String(left), { x: MARGIN, y, size, font: f, color: rgb(0.3, 0.3, 0.3) })
    const rStr = String(right), rw = f.widthOfTextAtSize(rStr, size)
    page.drawText(rStr, { x: MARGIN + COL_W - rw, y, size, font: f, color: rgb(0, 0, 0) }); y -= LINE_H
  }
  function drawRule() {
    page.drawLine({ start: { x: MARGIN, y: y + 4 }, end: { x: PAGE_W - MARGIN, y: y + 4 }, thickness: 0.5, color: rgb(0.75, 0.75, 0.75) }); y -= 8
  }

  // Header
  drawText(cfg.nombreComercial, { bold: true, size: LARGE, center: true })
  drawText(cfg.razonSocial, { size: SMALL, center: true })
  drawText(cfg.direccion, { size: SMALL, center: true })
  drawText('Tel: ' + cfg.telefono + '  RNC: ' + cfg.rnc, { size: SMALL, center: true })
  drawRule()

  drawText(ECF_LABELS[tipo] || 'e-CF', { bold: true, size: SMALL, center: true })
  y -= 4

  drawCols('Fecha:', fechaEmision)
  drawCols('e-NCF:', encf)
  drawCols('Cod. Seguridad:', securityCode)
  if (rncComprador) { drawCols('Cliente:', razonComprador); drawCols(rncComprador.length > 11 ? 'ID:' : 'RNC:', rncComprador) }
  if (refEncf) drawCols('Ref:', refEncf)
  drawRule()

  for (const it of items) { drawCols(it.qty > 1 ? `${it.name} x${it.qty}` : it.name, fmtRD(it.amount)) }
  drawRule()

  drawCols('Subtotal:', fmtRD(subtotal))
  drawCols('ITBIS (18%):', fmtRD(itbis))
  drawCols('TOTAL:', fmtRD(total), { bold: true, size: LARGE })
  y -= 4
  drawCols('Forma de pago:', 'Contado')
  drawRule()

  const qrImage = await doc.embedPng(qrBytes)
  page.drawImage(qrImage, { x: MARGIN + (COL_W - QR_SIZE) / 2, y: y - QR_SIZE, width: QR_SIZE, height: QR_SIZE })
  y -= QR_SIZE + 4
  const vLabel = 'Verificar en dgii.gov.do', vw = font.widthOfTextAtSize(vLabel, 6)
  page.drawText(vLabel, { x: MARGIN + (COL_W - vw) / 2, y, size: 6, font, color: rgb(0.4, 0.4, 0.4) }); y -= LINE_H
  const scLabel = `Codigo de Seguridad: ${securityCode}`, sw = font.widthOfTextAtSize(scLabel, 6)
  page.drawText(scLabel, { x: MARGIN + (COL_W - sw) / 2, y, size: 6, font, color: rgb(0.4, 0.4, 0.4) }); y -= LINE_H
  const firmaLabel = `Fecha de Firma Digital: ${fechaFirma}`, fw = font.widthOfTextAtSize(firmaLabel, 6)
  page.drawText(firmaLabel, { x: MARGIN + (COL_W - fw) / 2, y, size: 6, font, color: rgb(0.4, 0.4, 0.4) }); y -= LINE_H

  drawText('Gracias por preferirnos!', { size: SMALL, center: true })
  drawText('Powered by Studio X Media', { size: 6, center: true })

  const pdfBytes = await doc.save()
  let label = tipo
  if (tipo === '32' && total >= 250000) label = '32_250K'
  else if (tipo === '32') label = '32_LT250K'
  const outFile = `Rep_Impresa_E${label}.pdf`
  fs.writeFileSync(path.join(OUT_DIR, outFile), pdfBytes)
  console.log('OK', outFile, `eNCF=${encf} sec=${securityCode} total=${montoTotal} (${(pdfBytes.length / 1024).toFixed(1)} KB)`)
  console.log('   QR:', qrUrl)
}

async function run() {
  const files = fs.readdirSync(XML_DIR).filter(f => f.endsWith('.xml') && !f.startsWith('RFCE_') && !f.startsWith('ACECF_'))
  console.log(`Found ${files.length} XMLs in ${XML_DIR}\n`)
  const allData = files.map(f => parseXml(path.join(XML_DIR, f)))
  const picked = new Map()
  for (const d of allData) {
    if (d.tipo === '32') { const key = d.total >= 250000 ? '32_250K' : '32_LT250K'; if (!picked.has(key)) picked.set(key, d) }
    else { if (!picked.has(d.tipo)) picked.set(d.tipo, d) }
  }
  console.log(`Generating ${picked.size} PDFs (one per e-CF type):\n`)
  for (const [, data] of picked) { await generatePDF(data); console.log('') }
  const pdfFiles = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.pdf'))
  const totalKB = pdfFiles.reduce((sum, f) => sum + fs.statSync(path.join(OUT_DIR, f)).size, 0) / 1024
  console.log(`Total: ${pdfFiles.length} PDFs, ${totalKB.toFixed(1)} KB → ${OUT_DIR}`)
}

run().catch(e => console.error(e))
