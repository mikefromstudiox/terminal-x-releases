#!/usr/bin/env node
// Multi-line converter for throwSupaError(await supabase.from(T).(update|delete)(...).eq(...).eq(...))
// Handles multi-line .update({...}) payloads.
import { readFileSync, writeFileSync } from 'fs'
const PATH = 'packages/data/web.js'
let src = readFileSync(PATH, 'utf8')

// Use whole-text regex with DOTALL (s flag). Match ANY content inside update(...)
// including newlines, balanced via lazy match terminated by `}).eq(...).eq(...))`.
// Three closing parens at end: `}` of update body + `)` of update call + `)` of throwSupaError.
//
// Pattern variants we need:
// 1. update({...}).eq(...).eq(...) — most common
// 2. update({...}).eq(...).eq(...).eq(...) — 3 eqs
// 3. delete().eq(...).eq(...)
// 4. update(...).eq(...).eq(...) where payload is a var (no `{}`)
//
// We handle by capturing the OPEN paren of (update|delete) and tracking nesting.

function convertOne(text) {
  // Find next `throwSupaError(await supabase.from('X').(update|delete)(`
  const re = /(\s*)throwSupaError\(await supabase\.from\(['"]([^'"]+)['"]\)\.(update|delete)\(/g
  let match
  while ((match = re.exec(text)) !== null) {
    const [whole, indent, table, op] = match
    const afterOpenParen = re.lastIndex
    // Find matching close paren of the op call
    let depth = 1
    let i = afterOpenParen
    while (i < text.length && depth > 0) {
      const c = text[i]
      if (c === '(') depth++
      else if (c === ')') depth--
      if (depth === 0) break
      i++
    }
    if (depth !== 0) continue
    // i is now position of the closing ) of the op call. After it, chain continues.
    // Walk through `.eq(...)`, `.in(...)`, `.gte(...)`, etc until we hit the closing
    // ) that matches the outer throwSupaError(.
    // Stop when we see a top-level `)` that closes throwSupaError.
    let j = i + 1   // after op-close
    let outerDepth = 1  // depth of throwSupaError(
    while (j < text.length && outerDepth > 0) {
      const c = text[j]
      if (c === '(') outerDepth++
      else if (c === ')') outerDepth--
      if (outerDepth === 0) break
      j++
    }
    if (outerDepth !== 0) continue
    // text[j] is the closing ) of throwSupaError. The op chain is text[match.index ... j].
    // We need to replace from match.index to j+1.
    const fullExpr = text.slice(match.index, j + 1)
    // Skip if already has .select( or .single() inside the chain
    if (/\.select\s*\(|\.single\s*\(\s*\)|\.maybeSingle\s*\(\s*\)/.test(fullExpr)) continue

    // The inner expr is text[match.index ... j]. We need to inject .select('id')
    // BEFORE the final closing ) (which closes the op chain) but AFTER the eq chain.
    // The chain after the op call: text[i+1 ... j-1] (between op-close and throwSupaError-close)
    // and the j-1 is the close of the last .eq(...) call.
    // So we inject `.select('id')` at position j (right before throwSupaError-close).
    const chain = text.slice(match.index + indent.length, j)   // without indent, ends at last eq-close
    // Build replacement
    const newExpr = `${indent}await assertAffected(${chain.replace(/^throwSupaError\(await /, '')}.select('id'), 'web.${table}.${op}')`
    text = text.slice(0, match.index) + newExpr + text.slice(j + 1)
    // Reset regex to scan from after the replacement
    re.lastIndex = match.index + newExpr.length
  }
  return text
}

let out = convertOne(src)
// Count conversions
const before = (src.match(/throwSupaError\(await supabase\.from\(['"][^'"]+['"]\)\.(update|delete)\(/g) || []).length
const after  = (out.match(/throwSupaError\(await supabase\.from\(['"][^'"]+['"]\)\.(update|delete)\(/g) || []).length
console.log(`Before: ${before} sites`)
console.log(`After:  ${after} sites`)
console.log(`Converted: ${before - after}`)
writeFileSync(PATH, out, 'utf8')
