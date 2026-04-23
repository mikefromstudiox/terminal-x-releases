const { chromium } = require('playwright')
const path = require('path')

const DOCS = [
  { dir: 'training',   html: 'terminal-x-training-manual.html',  pdf: 'terminal-x-training-manual.pdf'  },
  { dir: 'training',   html: 'licoreria-demo-cheatsheet.html',   pdf: 'licoreria-demo-cheatsheet.pdf'   },
  { dir: 'training',   html: 'manual-nuevo-empleado.html',       pdf: 'manual-nuevo-empleado.pdf'       },
  { dir: 'training',   html: 'cheat-sheet-cajera.html',          pdf: 'cheat-sheet-cajera.pdf'          },
  { dir: 'training',   html: 'cheat-sheet-gerente.html',         pdf: 'cheat-sheet-gerente.pdf'         },
  { dir: 'training',   html: 'cheat-sheet-dueno.html',           pdf: 'cheat-sheet-dueno.pdf'           },
  { dir: 'onboarding', html: 'protocolo-de-arranque.html',       pdf: 'protocolo-de-arranque.pdf'       },
  { dir: 'onboarding', html: 'kit-de-bienvenida.html',           pdf: 'kit-de-bienvenida.pdf'           },
]

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  for (const d of DOCS) {
    const fileUrl = 'file:///' + path.resolve(__dirname, '..', 'docs', d.dir, d.html).replace(/\\/g, '/')
    await page.goto(fileUrl, { waitUntil: 'networkidle' })
    await page.pdf({
      path: path.resolve(__dirname, '..', 'docs', d.dir, d.pdf),
      format: 'Letter', printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    })
    console.log('Rendered', d.dir + '/' + d.pdf)
  }
  await browser.close()
})().catch(err => { console.error(err); process.exit(1) })
