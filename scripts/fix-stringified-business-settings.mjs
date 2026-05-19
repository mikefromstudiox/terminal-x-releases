#!/usr/bin/env node
// fix-stringified-business-settings.mjs
//
// 2026-05-19 — One-shot data fix for businesses.settings rows that got
// stored as JSON-stringified strings instead of native jsonb objects.
//
// Why this exists: CAR WASH DJ (ef5b9202) and Crokao (8ca2af1e) both had
// settings serialized as a string at provisioning time. Data layer
// already defensively JSON.parse()s string values at read time (see
// packages/data/web.js setEnvironment / setFiscalMode), so consumers
// aren't broken — but every read pays a parse cost and any code path
// that doesn't yet have the defensive parse would silently see garbage.
//
// What we do: scan all businesses, find any with typeof settings ===
// 'string', JSON.parse them, write the object back. Verify each row
// post-write. Dry-run by default.
//
// Usage:
//   node scripts/fix-stringified-business-settings.mjs             # dry run
//   node scripts/fix-stringified-business-settings.mjs --apply     # write fix
//   node scripts/fix-stringified-business-settings.mjs --only=<id> # one row only
//
// Why a script instead of an inline UPDATE: per-row safety. We READ each
// row, PARSE the string, MERGE nothing (keep the exact same content,
// just the right type), WRITE back, then READ-BACK to verify the type
// flipped to 'object' AND every key/value is identical. If any row
// fails to parse or verify, we report and skip — never blindly
// `UPDATE ... = '{}'`.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))

const argv = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)=?(.*)$/); return m ? [m[1], m[2] || true] : [a, true]
}))

const apply = !!argv.apply
const only  = argv.only && typeof argv.only === 'string' ? argv.only : null

const s = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

console.log(`=== fix-stringified-business-settings ===`)
console.log(`mode:  ${apply ? 'APPLY (will write)' : 'DRY RUN (no writes)'}`)
if (only) console.log(`scope: business id = ${only}`)
console.log()

const q = s.from('businesses').select('id, name, is_demo, settings, created_at').order('created_at', { ascending: false })
if (only) q.eq('id', only)
const { data, error } = await q
if (error) { console.error('select failed:', error.message); process.exit(1) }

const broken = (data || []).filter(b => typeof b.settings === 'string')
console.log(`scanned: ${data?.length || 0} businesses`)
console.log(`broken:  ${broken.length} rows have typeof settings === 'string'\n`)

if (broken.length === 0) { console.log('Nothing to fix.'); process.exit(0) }

let fixed = 0, skipped = 0, failed = 0
for (const b of broken) {
  const label = `${b.id.slice(0, 8)} ${b.name} (${b.is_demo ? 'demo' : 'REAL'})`
  let parsed
  try { parsed = JSON.parse(b.settings) }
  catch (e) {
    console.log(`  ✗ ${label} — JSON.parse failed: ${e.message}`)
    skipped++; continue
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.log(`  ✗ ${label} — parsed to ${typeof parsed}/${Array.isArray(parsed) ? 'array' : ''}, not a plain object — skipping`)
    skipped++; continue
  }

  console.log(`  → ${label}`)
  console.log(`     parsed keys: ${Object.keys(parsed).join(', ')}`)

  if (!apply) { fixed++; continue }

  const { error: upErr } = await s.from('businesses').update({ settings: parsed }).eq('id', b.id)
  if (upErr) { console.log(`     ✗ write failed: ${upErr.message}`); failed++; continue }

  // Read back and confirm type flipped + content identical.
  const { data: ver } = await s.from('businesses').select('settings').eq('id', b.id).single()
  if (typeof ver?.settings !== 'object' || ver.settings === null) {
    console.log(`     ✗ verify failed: still typeof ${typeof ver?.settings}`); failed++; continue
  }
  const before = JSON.stringify(parsed, Object.keys(parsed).sort())
  const after  = JSON.stringify(ver.settings, Object.keys(ver.settings).sort())
  if (before !== after) {
    console.log(`     ✗ verify failed: content drift after write`); failed++; continue
  }
  console.log(`     ✓ fixed + verified (${Object.keys(parsed).length} keys preserved)`)
  fixed++
}

console.log(`\n=== RESULT ===`)
console.log(`fixed:   ${fixed}${apply ? '' : ' (dry-run — re-run with --apply)'}`)
console.log(`skipped: ${skipped}`)
console.log(`failed:  ${failed}`)
process.exit(failed > 0 ? 1 : 0)
