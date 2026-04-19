const { chromium } = require('playwright')
const path = require('path')

const DOCS = [
  { html: 'protocolo-de-arranque.html', pdf: 'protocolo-de-arranque.pdf' },
  { html: 'kit-de-bienvenida.html',     pdf: 'kit-de-bienvenida.pdf' },
]

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  for (const d of DOCS) {
    const fileUrl = 'file:///' + path.resolve(__dirname, '..', 'docs', 'onboarding', d.html).replace(/\\/g, '/')
    await page.goto(fileUrl, { waitUntil: 'networkidle' })
    await page.pdf({
      path: path.resolve(__dirname, '..', 'docs', 'onboarding', d.pdf),
      format: 'Letter', printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    })
    console.log('Rendered', d.pdf)
  }
  await browser.close()
})().catch(err => { console.error(err); process.exit(1) })
