import { chromium } from 'playwright'
import { resolve } from 'path'

const html = resolve(process.cwd(), 'docs/training/licoreria-demo-cheatsheet.html')
const pdf  = resolve(process.cwd(), 'docs/training/licoreria-demo-cheatsheet.pdf')

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('file:///' + html.replace(/\\/g, '/'), { waitUntil: 'networkidle' })
await page.pdf({
  path: pdf,
  format: 'Letter',
  printBackground: true,
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
})
await browser.close()
console.log('PDF ->', pdf)
