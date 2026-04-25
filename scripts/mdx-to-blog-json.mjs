#!/usr/bin/env node
/**
 * mdx-to-blog-json.mjs
 *
 * Reads `web/blog/*.mdx`, parses front-matter + body, converts the
 * Markdown body to HTML (lightweight inline parser — no external deps),
 * and writes the resulting array into
 * `packages/ui/landing/data/blogPosts.json` in the shape that
 * `BlogIndex.jsx` and `BlogPost.jsx` expect:
 *
 *   {
 *     slug, title_es, title_en, excerpt_es, excerpt_en, body_html,
 *     date, author, category, tags, readMinutes, og_image
 *   }
 *
 * Spanish-only MDX files: title_en/excerpt_en mirror the Spanish copy
 * for now (BlogPost falls back to es when en is missing — both are populated
 * to keep the JSON shape consistent and lint-quiet).
 *
 * Run: `node scripts/mdx-to-blog-json.mjs`
 * Idempotent. No Node deps required.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const BLOG_DIR = join(ROOT, 'web', 'blog')
const OUT = join(ROOT, 'packages', 'ui', 'landing', 'data', 'blogPosts.json')

function parseFrontMatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!m) return { meta: {}, body: raw }
  const meta = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/)
    if (!kv) continue
    let v = kv[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    meta[kv[1]] = v
  }
  return { meta, body: m[2] }
}

function slugify(s) {
  return String(s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Minimal Markdown -> HTML. Supports: # ## ### headings, paragraphs,
// blank lines, **bold**, *italic*, `code`, [text](url), ordered + unordered
// lists, raw <img> tags pass-through, blockquotes.
function mdToHtml(md) {
  const lines = md.split(/\r?\n/)
  const out = []
  let i = 0

  function inline(text) {
    // Pass-through raw HTML tags (img, etc.) by tokenizing on `<...>`.
    // We only escape outside of those tags.
    const parts = text.split(/(<[^>]+>)/g)
    return parts.map(p => {
      if (p.startsWith('<') && p.endsWith('>')) return p
      let s = escapeHtml(p)
      s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
      s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      return s
    }).join('')
  }

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }

    // Heading
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      const lvl = h[1].length
      const text = h[2].trim()
      const id = slugify(text)
      out.push(`<h${lvl} id="${id}">${inline(text)}</h${lvl}>`)
      i++
      continue
    }

    // Blockquote
    if (line.startsWith('>')) {
      const buf = []
      while (i < lines.length && lines[i].startsWith('>')) {
        buf.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      out.push(`<blockquote><p>${inline(buf.join(' '))}</p></blockquote>`)
      continue
    }

    // Unordered list
    if (/^[-*]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^[-*]\s+/, '').trim())}</li>`)
        i++
      }
      out.push(`<ul>${items.join('')}</ul>`)
      continue
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\d+\.\s+/, '').trim())}</li>`)
        i++
      }
      out.push(`<ol>${items.join('')}</ol>`)
      continue
    }

    // Raw <img> on its own line — pass through
    if (/^<img\s/.test(line.trim())) {
      out.push(line.trim())
      i++
      continue
    }

    // Paragraph (gather until blank line)
    const buf = [line]
    i++
    while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s+/.test(lines[i]) && !/^[-*]\s+/.test(lines[i]) && !/^\d+\.\s+/.test(lines[i]) && !lines[i].startsWith('>')) {
      buf.push(lines[i])
      i++
    }
    out.push(`<p>${inline(buf.join(' '))}</p>`)
  }

  return out.join('\n')
}

function readingMinutes(md) {
  const words = md.split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / 220))
}

function deriveTags(meta) {
  const tags = []
  if (meta.category) tags.push(meta.category)
  if (/migrar/i.test(meta.slug || '')) tags.push('migración')
  if (/ley-32/i.test(meta.slug || '')) tags.push('Ley 32-23')
  if (/facturador/i.test(meta.slug || '')) tags.push('DGII')
  return [...new Set(tags)]
}

function main() {
  const files = readdirSync(BLOG_DIR).filter(f => f.endsWith('.mdx'))
  const posts = files.map(file => {
    const raw = readFileSync(join(BLOG_DIR, file), 'utf8')
    const { meta, body } = parseFrontMatter(raw)
    const html = mdToHtml(body)
    const title = meta.title || file.replace(/\.mdx$/, '')
    const excerpt = meta.excerpt || ''
    return {
      slug: meta.slug || file.replace(/\.mdx$/, ''),
      title_es: title,
      title_en: title,
      excerpt_es: excerpt,
      excerpt_en: excerpt,
      author: meta.author || 'Equipo Terminal X',
      date: meta.published_date || '',
      category: meta.category || '',
      tags: deriveTags(meta),
      readMinutes: parseInt((meta.reading_time || '').replace(/\D/g, ''), 10) || readingMinutes(body),
      og_image: meta.og_image || '',
      body_html: html,
      // Legacy / SEO fields preserved for back-compat:
      title: title,
      excerpt: excerpt,
      published_date: meta.published_date || '',
      reading_time: meta.reading_time || '',
    }
  })
  // Stable order: newest first by published_date desc, then slug asc.
  posts.sort((a, b) => (b.published_date || '').localeCompare(a.published_date || '') || a.slug.localeCompare(b.slug))
  writeFileSync(OUT, JSON.stringify(posts, null, 2) + '\n', 'utf8')
  console.log(`[mdx-to-blog-json] wrote ${posts.length} posts to ${OUT}`)
}

main()
