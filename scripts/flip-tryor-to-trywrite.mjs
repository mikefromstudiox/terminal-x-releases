#!/usr/bin/env node
// Codemod: convert write-path tryOr(...) calls in packages/data/web.js to
// tryWrite(..., '<action_id>'). Source of truth is the audit CSV.
//
// Strategy: enumerate every `<name>: ... => tryOr(` site in the file, then
// for each CSV row pick the closest unassigned site whose property name
// matches the row's last action_id segment. Each source site is consumed at
// most once — eliminates the radius-collision problem (e.g. multiple
// `create:` props in the same neighborhood).

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.cwd())
const SRC  = path.join(ROOT, 'packages', 'data', 'web.js')
const CSV  = path.join(ROOT, 'docs', 'audits', 'error-reporting-coverage', 'B_web_data.csv')

const csv = fs.readFileSync(CSV, 'utf8')
let src   = fs.readFileSync(SRC, 'utf8')

const rows = csv.split(/\r?\n/).slice(1)
  .filter(l => l && !l.startsWith('#'))
  .map(l => l.split(','))
  .map(c => ({ line: parseInt(c[2], 10), action_id: c[3], gap_type: c[9] }))
  .filter(r => r.gap_type === 'tryor_on_write')

const SKIP = new Set(['web.tickets.byId']) // pure read despite CSV note

// Enumerate ALL `<name>:` declarations whose RHS contains `tryOr(` within the
// next 3 lines. Record absolute char offset of the property's `tryOr` token.
function enumerateSites(src) {
  const lines = src.split('\n')
  // Pre-compute char offset of each line.
  const lineOff = new Array(lines.length)
  { let off = 0; for (let i = 0; i < lines.length; i++) { lineOff[i] = off; off += lines[i].length + 1 } }

  const propRe = /(^|\s)([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/
  const sites = []
  for (let i = 0; i < lines.length; i++) {
    const m = propRe.exec(lines[i])
    if (!m) continue
    const blob = (lines[i] || '') + '\n' + (lines[i+1] || '') + '\n' + (lines[i+2] || '')
    const tm = /tryOr\s*\(/.exec(blob)
    if (!tm) continue
    // Find absolute index of this tryOr( in src.
    const searchFrom = lineOff[i]
    const tryOrAbs = src.indexOf('tryOr(', searchFrom)
    if (tryOrAbs === -1) continue
    // sanity: tryOrAbs should be within next ~3 lines
    if (tryOrAbs - searchFrom > 400) continue
    sites.push({ name: m[2], line: i + 1, tryOrIdx: tryOrAbs })
  }
  return sites
}

let sites = enumerateSites(src)

// Assign each CSV row to the closest unconsumed site whose name matches.
const consumed = new Set()
const assignments = [] // { site, action_id }
const skipped = []

// Process CSV rows in order of line — small bias for consistency.
const sortedRows = [...rows].sort((a, b) => a.line - b.line)
for (const row of sortedRows) {
  if (SKIP.has(row.action_id)) { skipped.push(`${row.action_id} (skip-list)`); continue }
  const fnName = row.action_id.split('.').pop()
  let best = -1, bestDist = Infinity
  for (let k = 0; k < sites.length; k++) {
    if (consumed.has(k)) continue
    if (sites[k].name !== fnName) continue
    const d = Math.abs(sites[k].line - row.line)
    if (d < bestDist) { bestDist = d; best = k }
  }
  if (best === -1) { skipped.push(`${row.action_id} @${row.line} (no available site)`); continue }
  consumed.add(best)
  assignments.push({ site: sites[best], action_id: row.action_id })
}

// Build edits, apply right-to-left.
function findMatchingClose(src, openParenIdx) {
  let depth = 0, inStr = null, inLineCmt = false, inBlockCmt = false
  for (let i = openParenIdx; i < src.length; i++) {
    const ch = src[i], nx = src[i+1]
    if (inLineCmt) { if (ch === '\n') inLineCmt = false; continue }
    if (inBlockCmt) { if (ch === '*' && nx === '/') { inBlockCmt = false; i++ } continue }
    if (inStr) { if (ch === '\\') { i++; continue } if (ch === inStr) inStr = null; continue }
    if (ch === '/' && nx === '/') { inLineCmt = true; i++; continue }
    if (ch === '/' && nx === '*') { inBlockCmt = true; i++; continue }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue }
    if (ch === '(') depth++
    else if (ch === ')') { depth--; if (depth === 0) return i }
  }
  return -1
}
function findLastTopLevelComma(src, openParenIdx, closeParenIdx) {
  let depth = 0, inStr = null, inLineCmt = false, inBlockCmt = false, last = -1
  for (let j = openParenIdx + 1; j < closeParenIdx; j++) {
    const ch = src[j], nx = src[j+1]
    if (inLineCmt) { if (ch === '\n') inLineCmt = false; continue }
    if (inBlockCmt) { if (ch === '*' && nx === '/') { inBlockCmt = false; j++ } continue }
    if (inStr) { if (ch === '\\') { j++; continue } if (ch === inStr) inStr = null; continue }
    if (ch === '/' && nx === '/') { inLineCmt = true; j++; continue }
    if (ch === '/' && nx === '*') { inBlockCmt = true; j++; continue }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue }
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    else if (ch === ',' && depth === 0) last = j
  }
  return last
}

const edits = []
for (const a of assignments) {
  const tryOrIdx  = a.site.tryOrIdx
  const openParen = src.indexOf('(', tryOrIdx)
  const closeParen = findMatchingClose(src, openParen)
  if (closeParen === -1) { skipped.push(`${a.action_id} (unbalanced)`); continue }
  const lastComma = findLastTopLevelComma(src, openParen, closeParen)
  edits.push({ start: tryOrIdx, end: tryOrIdx + 'tryOr'.length, repl: 'tryWrite' })
  const tail = `, '${a.action_id}')`
  if (lastComma !== -1) edits.push({ start: lastComma, end: closeParen + 1, repl: tail })
  else                  edits.push({ start: closeParen, end: closeParen + 1, repl: tail })
}

edits.sort((a, b) => b.start - a.start)
for (const e of edits) src = src.slice(0, e.start) + e.repl + src.slice(e.end)

fs.writeFileSync(SRC, src)
console.log(`converted ${assignments.length} tryOr → tryWrite calls`)
if (skipped.length) {
  console.log('skipped:')
  for (const s of skipped) console.log('  -', s)
}
