#!/usr/bin/env node
// heal-demo-vertical-keys.mjs — one-time fix for 4 demos + 1 missing seed.
//
// Approved by Mike 2026-05-17 after end-to-end vertical audit. Scope:
//   1. Update app_settings.business_type for 4 demos: legacy Spanish → canonical English
//   2. Update businesses.settings.business_type / biz_business_type for the same 4
//   3. Seed 4 service_bays rows for the mechanic demo (was 0)
//
// Narrow by demo business name. Does NOT touch real customer data.

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
config({ path: join(__dirname, '..', '.env') })

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY
const sb = createClient(URL, SVC, { auth: { persistSession: false } })

const HEAL_MAP = [
  // v1 — Spanish → English (Englishization)
  { name: 'Demo Tienda',                  from: 'tienda',        to: 'retail' },
  { name: 'Demo Taller Mecanico',         from: 'mecanica',      to: 'mechanic' },
  { name: 'Demo Servicios Profesionales', from: 'servicios',     to: 'service' },
  { name: 'Demo Concesionario',           from: 'concesionario', to: 'dealership' },
  { name: 'Demo Restaurante',             from: 'restaurante',   to: 'restaurant' },
  // v2 — 2026-05-17 canonical key sweep
  { name: 'Demo Prestamos',               from: 'prestamos',     to: 'loans' },
  { name: 'Demo Contabilidad',            from: 'contabilidad',  to: 'accounting' },
  { name: 'Carniceria Demo',              from: 'carniceria',    to: 'meat_market' },
  { name: 'TX STAGING TEST',              from: 'contabilidad',  to: 'accounting' },
  // Real client — Mike approved 2026-05-17. Aliases keep her resolving
  // either way; this normalizes to the canonical value.
  { name: 'Contabilidad Perla Lugo',      from: 'contabilidad',  to: 'accounting' },
  // Real client — Ranoza's stored 'tienda' is the legacy retail key, but
  // their actual vertical is licorería (tienda_subtype='licoreria' confirms).
  // Setting business_type='licoreria' directly makes isLicoreria=true without
  // depending on subtype + alias chain. Matches the Licoreria Demo precedent.
  { name: 'Ranoza Liquor Store',          from: 'tienda',        to: 'licoreria' },
]

function uuid() { return crypto.randomUUID() }

;(async () => {
  console.log('\n=== heal-demo-vertical-keys @', new Date().toISOString(), '===\n')

  // ── Part 1: business_type rename for 4 demos ─────────────────────────────
  for (const h of HEAL_MAP) {
    const { data: bizs } = await sb.from('businesses').select('id, name, settings').eq('name', h.name)
    if (!bizs?.length) { console.log(`  [miss] ${h.name} — not found`); continue }
    for (const biz of bizs) {
      const cur = biz.settings?.business_type
      if (cur === h.to) { console.log(`  [skip] ${h.name} already ${h.to}`); continue }
      if (cur && cur !== h.from) { console.log(`  [warn] ${h.name} settings.business_type='${cur}' (expected ${h.from}) — patching anyway`) }

      // 1a. businesses.settings JSON
      const nextSettings = { ...(biz.settings || {}), business_type: h.to, biz_business_type: h.to }
      const { error: e1 } = await sb.from('businesses').update({ settings: nextSettings }).eq('id', biz.id)
      if (e1) { console.log(`  [err] businesses.settings: ${e1.message}`); continue }

      // 1b. app_settings rows
      const { data: rows } = await sb.from('app_settings')
        .select('id, key, value').eq('business_id', biz.id).in('key', ['business_type','biz_business_type'])
      for (const r of (rows || [])) {
        const { error: e2 } = await sb.from('app_settings').update({ value: h.to, updated_at: new Date().toISOString() }).eq('id', r.id)
        if (e2) console.log(`  [err] app_settings(${r.key}): ${e2.message}`)
      }
      console.log(`  [ok] ${h.name}: ${h.from} → ${h.to} (businesses.settings + ${rows?.length || 0} app_settings rows)`)
    }
  }

  // ── Part 2: service_bays for mechanic demo ───────────────────────────────
  const { data: mecBiz } = await sb.from('businesses').select('id, name').eq('name', 'Demo Taller Mecanico').maybeSingle()
  if (!mecBiz?.id) {
    console.log('\n  [miss] Demo Taller Mecanico — cannot seed service_bays')
  } else {
    const { count } = await sb.from('service_bays').select('id', { count: 'exact', head: true }).eq('business_id', mecBiz.id)
    if (count && count > 0) {
      console.log(`\n  [skip] service_bays already populated (${count})`)
    } else {
      const bays = [
        { name: 'Bahía 1 — General',    bay_type: 'general',    status: 'occupied', capacity: 1 },
        { name: 'Bahía 2 — Frenos',     bay_type: 'brakes',     status: 'libre',    capacity: 1 },
        { name: 'Bahía 3 — Alineación', bay_type: 'alignment',  status: 'libre',    capacity: 1 },
        { name: 'Bahía 4 — Diagnóstico',bay_type: 'diagnostic', status: 'libre',    capacity: 1 },
      ]
      const payload = bays.map(b => ({ ...b, business_id: mecBiz.id, supabase_id: uuid(), active: true }))
      const { error } = await sb.from('service_bays').insert(payload)
      if (error) console.log(`  [err] service_bays: ${error.message}`)
      else console.log(`\n  [ok] Demo Taller Mecanico: seeded ${bays.length} service_bays`)
    }
  }

  console.log('\n=== heal complete — re-run scripts/demo-vertical-audit.mjs to verify ===\n')
})().catch(e => { console.error(e); process.exit(1) })
