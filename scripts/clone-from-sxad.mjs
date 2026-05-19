#!/usr/bin/env node
// Clone services + inventory_items + missing app_settings from Studio X SRL
// to a target business. Skips clients, empleados, mesas. Dedupe-by-name so a
// target with starter-pack rows already in place keeps them and only the
// truly new rows land. Safe for hybrid carwash+restaurant clients.
//
// Usage: node scripts/clone-from-sxad.mjs --target=<UUID> [--dry-run]

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import crypto from 'crypto'

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))

const argv = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)=?(.*)$/); return m ? [m[1], m[2] || true] : [a, true]
}))

const SOURCE_BIZ = '1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79' // STUDIO X SRL
const target = argv.target
const dryRun = !!argv['dry-run']
if (!target) { console.error('Required: --target=<business_uuid>'); process.exit(1) }
if (target === SOURCE_BIZ) { console.error('Target cannot equal source'); process.exit(1) }

const s = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

console.log(`=== clone-from-sxad ===`)
console.log(`source: STUDIO X SRL (${SOURCE_BIZ})`)
console.log(`target: ${target}`)
console.log(`dry-run: ${dryRun}\n`)

// ── target validation ───────────────────────────────────────────────
const { data: targetBiz } = await s.from('businesses').select('id, name, is_demo').eq('id', target).maybeSingle()
if (!targetBiz) { console.error('Target business not found'); process.exit(1) }
console.log(`target business: ${targetBiz.name} (is_demo=${targetBiz.is_demo})`)

// ── services ────────────────────────────────────────────────────────
const { data: srcServices } = await s.from('services').select('*').eq('business_id', SOURCE_BIZ)
const { data: tgtServices } = await s.from('services').select('name').eq('business_id', target)
const existingNames = new Set((tgtServices || []).map(r => (r.name || '').toLowerCase().trim()))
const newServices = (srcServices || []).filter(r => !existingNames.has((r.name || '').toLowerCase().trim()))
  .map(r => {
    const { id, created_at, updated_at, ...rest } = r
    return { ...rest, business_id: target, supabase_id: crypto.randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
  })
console.log(`services: source=${srcServices?.length || 0}, target_existing=${existingNames.size}, to_insert=${newServices.length}`)

// ── inventory_items ─────────────────────────────────────────────────
const { data: srcInv } = await s.from('inventory_items').select('*').eq('business_id', SOURCE_BIZ)
const { data: tgtInv } = await s.from('inventory_items').select('name').eq('business_id', target)
const existingInvNames = new Set((tgtInv || []).map(r => (r.name || '').toLowerCase().trim()))
const newInv = (srcInv || []).filter(r => !existingInvNames.has((r.name || '').toLowerCase().trim()))
  .map(r => {
    const { id, created_at, updated_at, ...rest } = r
    return { ...rest, business_id: target, supabase_id: crypto.randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
  })
console.log(`inventory_items: source=${srcInv?.length || 0}, target_existing=${existingInvNames.size}, to_insert=${newInv.length}`)

// ── app_settings (only NEW keys; preserve target's hybrid config) ──
//
// 2026-05-19 — IDENTITY_KEYS blocklist added after CAR WASH DJ inherited
// STUDIO X SRL's biz_name / biz_rnc / biz_phone / biz_address / biz_email
// + dgii_environment='ecf' (production). Mike saw Studio X SRL info on
// Darling Disla's client in the admin panel and worse — any e-CF that
// fired from CAR WASH DJ would have hit DGII production under Studio X
// SRL's RNC 133410321 (fiscal violation). These KVs uniquely identify
// the business and must NEVER be cloned. Operational/feature KVs are
// fine to clone.
const IDENTITY_KEYS = new Set([
  'biz_name', 'biz_rnc', 'biz_phone', 'biz_address', 'biz_email',
  'biz_website', 'dgii_environment',
])
const { data: srcSettings } = await s.from('app_settings').select('*').eq('business_id', SOURCE_BIZ)
const { data: tgtSettings } = await s.from('app_settings').select('key, device_hwid').eq('business_id', target)
const existingKeys = new Set((tgtSettings || []).map(r => r.key + '::' + (r.device_hwid || 'null')))
// Dedupe within source too — SXAD has some duplicate keys across hwid variants
const srcSeen = new Set()
const newSettings = []
let identitySkipped = 0
for (const r of (srcSettings || [])) {
  if (IDENTITY_KEYS.has(r.key)) { identitySkipped++; continue }
  const tag = r.key + '::null'
  if (existingKeys.has(tag) || srcSeen.has(tag)) continue
  srcSeen.add(tag)
  const { id, updated_at, ...rest } = r
  newSettings.push({ ...rest, business_id: target, supabase_id: crypto.randomUUID(), is_device_local: false, device_hwid: null, updated_at: new Date().toISOString() })
}
console.log(`app_settings: source=${srcSettings?.length || 0}, target_existing=${existingKeys.size}, identity_skipped=${identitySkipped}, to_insert=${newSettings.length}`)

console.log(`\nskipped tables: clients (per Mike), empleados (different staff), mesas (target has its own)`)

if (dryRun) {
  console.log('\n[DRY RUN] — no writes performed.')
  process.exit(0)
}

// ── execute inserts ─────────────────────────────────────────────────
let totalErrs = 0
async function batchInsert(table, rows) {
  if (!rows.length) return 0
  const CHUNK = 100
  let done = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    const { error } = await s.from(table).insert(slice)
    if (error) {
      console.error(`  [${table}] chunk ${i}-${i + slice.length}: ${error.message}`)
      totalErrs++
    } else {
      done += slice.length
    }
  }
  return done
}

console.log('\nwriting…')
const sInserted = await batchInsert('services', newServices)
console.log(`  ✓ services: ${sInserted}/${newServices.length}`)
const iInserted = await batchInsert('inventory_items', newInv)
console.log(`  ✓ inventory_items: ${iInserted}/${newInv.length}`)
const aInserted = await batchInsert('app_settings', newSettings)
console.log(`  ✓ app_settings: ${aInserted}/${newSettings.length}`)

console.log(`\n=== CLONE COMPLETE ===`)
console.log(`target:    ${targetBiz.name} (${target})`)
console.log(`services:        +${sInserted}`)
console.log(`inventory_items: +${iInserted}`)
console.log(`app_settings:    +${aInserted}`)
console.log(`errors:    ${totalErrs}`)
console.log(`======================`)
