import { chromium } from 'playwright'
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs'
import { resolve, join } from 'path'
import { pathToFileURL } from 'url'

const ROOT = resolve('A:/Studio X HUB/Terminal X/web/public/ig-carousels')
const DESKTOP = 'C:/Users/City/Desktop/Terminal X IG Posts'

const decks = [
  { manifest: 'posts-features.json',   html: 'index.html',      label: 'Funciones'  },
  { manifest: 'posts-industrias.json', html: 'industrias.html', label: 'Industrias' },
]

const sanitize = (s) => s.replace(/[<>:"/\\|?*]/g, '').trim()

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 2 })

mkdirSync(DESKTOP, { recursive: true })

let totalSlides = 0
let totalPosts = 0

for (const deck of decks) {
  const manifest = JSON.parse(readFileSync(join(ROOT, deck.manifest), 'utf8'))
  const htmlUrl = pathToFileURL(join(ROOT, deck.html)).href

  const page = await ctx.newPage()
  await page.goto(htmlUrl, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800) // ensure fonts/images settled

  const deckDir = join(DESKTOP, deck.label)
  mkdirSync(deckDir, { recursive: true })

  for (const post of manifest.posts) {
    totalPosts++
    const postDir = join(deckDir, sanitize(`${post.id} — ${post.title}`))
    mkdirSync(postDir, { recursive: true })

    // Find all slides with this data-post
    const handles = await page.$$(`section.slide[data-post="${post.id}"]`)
    if (handles.length === 0) {
      console.warn(`! no slides for post=${post.id}`)
      continue
    }

    let n = 1
    for (const h of handles) {
      await h.scrollIntoViewIfNeeded()
      await page.waitForTimeout(120)
      const file = join(postDir, `slide-${String(n).padStart(2, '0')}.png`)
      await h.screenshot({ path: file, omitBackground: false })
      totalSlides++
      n++
    }

    // caption.txt
    writeFileSync(join(postDir, 'caption.txt'), post.caption_es || '', 'utf8')
    console.log(`✓ ${deck.label} / ${post.id}: ${handles.length} slides`)
  }

  await page.close()
}

await browser.close()
console.log(`\nDone. ${totalPosts} posts, ${totalSlides} slides → ${DESKTOP}`)
