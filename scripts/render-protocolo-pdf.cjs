const { chromium } = require('playwright')
const path = require('path')

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const fileUrl = 'file:///' + path.resolve(__dirname, '..', 'docs', 'onboarding', 'protocolo-de-arranque.html').replace(/\\/g, '/')
  await page.goto(fileUrl, { waitUntil: 'networkidle' })
  await page.pdf({
    path: path.resolve(__dirname, '..', 'docs', 'onboarding', 'protocolo-de-arranque.pdf'),
    format: 'Letter',
    printBackground: true,
    margin: { top: '0', bottom: '0', left: '0', right: '0' },
  })
  await browser.close()
  console.log('PDF generated')
})().catch(err => { console.error(err); process.exit(1) })
