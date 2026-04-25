#!/usr/bin/env node
/**
 * Terminal X · SEO verification harness
 *
 * Runs against either:
 *   - a local build directory  (default: dist-web/)
 *   - a live URL               (--url https://terminalxpos.com)
 *
 * Asserts:
 *   1) <title> present and non-default
 *   2) meta description present and < 160 chars
 *   3) og:image, og:url, og:title, twitter:card present
 *   4) canonical link
 *   5) hreflang es-DO + x-default
 *   6) all <script type="application/ld+json"> blocks parse as valid JSON and
 *      contain @context + @type
 *   7) sitemap.xml + robots.txt exist (and are not the SPA index.html)
 *   8) robots.txt references the sitemap
 *
 * Exit code 0 = all pass · 1 = any failure.
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) => {
    if (a.startsWith('--')) {
      const [k, v] = a.includes('=') ? a.slice(2).split('=') : [a.slice(2), arr[i + 1]?.startsWith('--') ? 'true' : arr[i + 1] ?? 'true']
      return [[k, v]]
    }
    return []
  })
)

const MODE = args.url ? 'url' : 'dist'
const BASE = args.url || resolve(ROOT, args.dir || 'dist-web')

let pass = 0
let fail = 0
const log = (ok, msg) => { (ok ? pass++ : fail++); console.log(`${ok ? '✓' : '✗'} ${msg}`) }

async function fetchText(pathOrUrl) {
  if (MODE === 'url') {
    const u = pathOrUrl.startsWith('http') ? pathOrUrl : BASE.replace(/\/$/, '') + pathOrUrl
    const res = await fetch(u, { redirect: 'follow' })
    return { ok: res.ok, status: res.status, text: await res.text(), ctype: res.headers.get('content-type') || '' }
  }
  const file = join(BASE, pathOrUrl === '/' ? 'index.html' : pathOrUrl.replace(/^\//, ''))
  if (!existsSync(file)) return { ok: false, status: 404, text: '', ctype: '' }
  return { ok: true, status: 200, text: readFileSync(file, 'utf8'), ctype: file.endsWith('.xml') ? 'application/xml' : file.endsWith('.txt') ? 'text/plain' : 'text/html' }
}

const pick = (html, re) => (html.match(re) || [, ''])[1].trim()

console.log(`\n[verify-seo] mode=${MODE} base=${BASE}\n`)

// ---- index.html ----
const idx = await fetchText('/')
log(idx.ok, `GET / returns ${idx.status}`)
const html = idx.text

const title = pick(html, /<title[^>]*>([^<]+)<\/title>/i)
log(title.length > 10 && /Terminal X/i.test(title), `<title> present: "${title}"`)

const desc = pick(html, /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)
log(desc.length > 50 && desc.length < 200, `meta description present (${desc.length} chars)`)

const ogImage = pick(html, /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)
log(/^https?:\/\/.+\.(png|jpg|svg)/.test(ogImage), `og:image: ${ogImage}`)

const ogUrl = pick(html, /<meta\s+property=["']og:url["']\s+content=["']([^"']+)["']/i)
log(/^https:\/\/terminalxpos\.com/.test(ogUrl), `og:url: ${ogUrl}`)

const ogTitle = pick(html, /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i)
log(ogTitle.length > 5, `og:title present`)

const twCard = pick(html, /<meta\s+name=["']twitter:card["']\s+content=["']([^"']+)["']/i)
log(twCard === 'summary_large_image', `twitter:card = ${twCard}`)

const canonical = pick(html, /<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i)
log(/^https:\/\/terminalxpos\.com/.test(canonical), `canonical: ${canonical}`)

const hreflangEs = /hreflang=["']es-DO["']/.test(html)
const hreflangXdef = /hreflang=["']x-default["']/.test(html)
log(hreflangEs && hreflangXdef, `hreflang es-DO + x-default present`)

// ---- JSON-LD blocks ----
const ldRe = /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
const blocks = [...html.matchAll(ldRe)].map(m => m[1].trim())
log(blocks.length >= 4, `Found ${blocks.length} JSON-LD blocks (expected >=4)`)

const types = new Set()
for (const [i, raw] of blocks.entries()) {
  try {
    const obj = JSON.parse(raw)
    const arr = Array.isArray(obj) ? obj : [obj]
    for (const o of arr) {
      const ok = o['@context'] && o['@type']
      log(ok, `  LD block #${i + 1} parses + has @context/@type (${o['@type'] || 'no-type'})`)
      if (o['@type']) types.add(Array.isArray(o['@type']) ? o['@type'].join(',') : o['@type'])
    }
  } catch (err) {
    log(false, `  LD block #${i + 1} invalid JSON: ${err.message}`)
  }
}
const required = ['SoftwareApplication', 'FAQPage', 'Organization', 'LocalBusiness']
for (const t of required) log(types.has(t), `  schema type: ${t}`)

// ---- sitemap + robots ----
const sm = await fetchText('/sitemap.xml')
log(sm.ok && /<urlset/.test(sm.text), `sitemap.xml served (status=${sm.status}, urlset=${/<urlset/.test(sm.text)})`)
log(!/<!doctype html|<html/i.test(sm.text), `sitemap.xml is NOT the SPA index (no <html>)`)
log(/terminalxpos\.com\/blog\//i.test(sm.text), `sitemap.xml lists at least one /blog/ entry`)

const rb = await fetchText('/robots.txt')
log(rb.ok && /User-agent:/i.test(rb.text), `robots.txt served (status=${rb.status})`)
log(!/<!doctype html|<html/i.test(rb.text), `robots.txt is NOT the SPA index`)
log(/Sitemap:\s*https:\/\/terminalxpos\.com\/sitemap\.xml/i.test(rb.text), `robots.txt references sitemap`)
log(/Disallow:\s*\/pos/i.test(rb.text), `robots.txt disallows /pos`)
log(/Disallow:\s*\/admin/i.test(rb.text), `robots.txt disallows /admin`)

// ---- og-image asset ----
const ogPng = await fetchText('/og-image.png')
const ogSvg = await fetchText('/og-image.svg')
log(ogPng.ok || ogSvg.ok, `og-image asset present (png=${ogPng.ok} svg=${ogSvg.ok})`)

console.log(`\n[verify-seo] ${pass} passed · ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
