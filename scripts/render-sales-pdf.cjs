const { chromium } = require('playwright')
const path = require('path')

const DOCS = [
  { html: 'terminal-x-vs-starsisa.html', pdf: 'terminal-x-vs-starsisa.pdf', landscape: true },
]

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  for (const d of DOCS) {
    const fileUrl = 'file:///' + path.resolve(__dirname, '..', 'docs', 'sales', d.html).replace(/\\/g, '/')
    await page.goto(fileUrl, { waitUntil: 'networkidle' })
    await page.pdf({
      path: path.resolve(__dirname, '..', 'docs', 'sales', d.pdf),
      format: 'Letter',
      landscape: !!d.landscape,
      printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    })
    console.log('Rendered', d.pdf)
  }
  await browser.close()
})().catch(err => { console.error(err); process.exit(1) })
