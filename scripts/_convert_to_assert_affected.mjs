#!/usr/bin/env node
// Automated conversion: every `throwSupaError(await supabase.from(T).update|delete(...).eq(...))`
// → `await assertAffected(supabase.from(T).update|delete(...).eq(...).select('id'), 'web.T.<op>')`
//
// Safety rules:
//  1. Skip sites that already chain `.select(` (different protection model).
//  2. Skip sites that chain `.maybeSingle()`/`.single()` (throws on 0-row).
//  3. Only touch UPDATE / DELETE; SELECTs are left alone.
//  4. Preserve the .eq(...).eq(...) chain verbatim.

import { readFileSync, writeFileSync } from 'fs'

const PATH = 'packages/data/web.js'
let src = readFileSync(PATH, 'utf8')
const before = src.length

// Match multiline UPDATE/DELETE patterns with throwSupaError wrapper.
// We capture: indent, table, op (update/delete), payload, eqChain (greedy until close).
//
// Note: this is a regex, not a JS parser — we tolerate that and verify after.
// We require the *whole expression* terminates with `)` matching the outer
// `throwSupaError(` paren. We approximate by matching up to the closing
// `bid))` / `id))` pattern that's the canonical termination here.

const lines = src.split('\n')
const out = []
let changed = 0
let skippedSelectAlreadyPresent = 0
let i = 0
while (i < lines.length) {
  const line = lines[i]
  // Detect start: `throwSupaError(await supabase.from('X').(update|delete)(...)`
  const m = line.match(/^(\s*)throwSupaError\(await supabase\.from\(['"]([^'"]+)['"]\)\.(update|delete)\((.*)$/)
  if (!m) { out.push(line); i++; continue }
  const [, indent, table, op, restStart] = m

  // Walk forward to find the matching closing `))` (one for the operation, one for throwSupaError)
  let combined = restStart
  let lookahead = i
  let openParens = 1   // we've consumed the open paren of the op call already (update(...))
  // count balanced parens from restStart
  for (const ch of restStart) {
    if (ch === '(') openParens++
    else if (ch === ')') openParens--
  }
  while (openParens > 0 && lookahead + 1 < lines.length) {
    lookahead++
    const next = lines[lookahead]
    for (const ch of next) {
      if (ch === '(') openParens++
      else if (ch === ')') openParens--
      if (openParens === 0) break
    }
    combined += '\n' + next
  }

  // The full expression ends with `))` — first `)` closes the op call,
  // second closes throwSupaError(.
  if (!combined.endsWith('))')) {
    // Couldn't parse cleanly — emit as-is.
    for (let j = i; j <= lookahead; j++) out.push(lines[j])
    i = lookahead + 1
    continue
  }

  // Strip the outer ) — the closing of throwSupaError(
  const inner = combined.slice(0, -1)  // now ends with single `)`

  // Skip if already protected by .select() / .single() / .maybeSingle()
  if (/\.select\s*\(|\.single\s*\(\s*\)|\.maybeSingle\s*\(\s*\)/.test(inner)) {
    skippedSelectAlreadyPresent++
    for (let j = i; j <= lookahead; j++) out.push(lines[j])
    i = lookahead + 1
    continue
  }

  // Build the replacement:
  //   await assertAffected(supabase.from('X').update(...).eq(...).select('id'), 'web.X.update')
  // We need to inject `.select('id')` BEFORE the final `)` of the op call.
  // Find the position of the final unmatched `)` (innermost).
  // Since `inner` ends with `)`, that closes the .from(...).op(...).eq(...) chain.
  // Inject `.select('id')` right before it.
  const withSelect = inner.slice(0, -1) + '.select(\'id\'))'
  const label = `web.${table}.${op}`
  const replacement = `${indent}await assertAffected(${withSelect}, '${label}')`
  out.push(replacement)
  changed++
  i = lookahead + 1
}

if (changed > 0) {
  writeFileSync(PATH, out.join('\n'), 'utf8')
}
const after = readFileSync(PATH, 'utf8').length
console.log(`Sites converted: ${changed}`)
console.log(`Skipped (already protected): ${skippedSelectAlreadyPresent}`)
console.log(`Bytes: ${before} → ${after} (Δ ${after - before > 0 ? '+' : ''}${after - before})`)
