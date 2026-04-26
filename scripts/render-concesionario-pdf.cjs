const { chromium } = require('playwright')
const path = require('path')

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const fileUrl = 'file:///' + path.resolve(__dirname, '..', 'docs', 'sales', 'terminal-x-concesionario.html').replace(/\\/g, '/')
  await page.goto(fileUrl, { waitUntil: 'networkidle' })
  await page.pdf({
    path: path.resolve(__dirname, '..', 'docs', 'sales', 'terminal-x-concesionario.pdf'),
    format: 'Letter',
    printBackground: true,
    margin: { top: '0', bottom: '0', left: '0', right: '0' },
  })
  await browser.close()
  console.log('Rendered: docs/sales/terminal-x-concesionario.pdf')
})().catch(e => { console.error(e); process.exit(1) })
