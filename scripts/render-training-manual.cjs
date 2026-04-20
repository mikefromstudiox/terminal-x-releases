const { chromium } = require('playwright')
const path = require('path')

const DOC = {
  html: 'terminal-x-training-manual.html',
  pdf:  'terminal-x-training-manual.pdf',
}

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const fileUrl = 'file:///' + path.resolve(__dirname, '..', 'docs', 'training', DOC.html).replace(/\\/g, '/')
  await page.goto(fileUrl, { waitUntil: 'networkidle' })
  await page.pdf({
    path: path.resolve(__dirname, '..', 'docs', 'training', DOC.pdf),
    format: 'Letter', printBackground: true,
    margin: { top: '0', bottom: '0', left: '0', right: '0' },
  })
  console.log('Rendered', DOC.pdf)
  await browser.close()
})().catch(err => { console.error(err); process.exit(1) })
