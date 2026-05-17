// Multi-POS Simulation — Test Data Factory
// Creates + tears down a dedicated test business in Supabase (idempotent).
// SAFETY: every row is tagged with name='__MULTIPOS_SIM__' so cleanup cascades.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import 'dotenv/config'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')

export const SIM_BUSINESS_NAME = '__MULTIPOS_SIM__'

function envOrThrow(k) {
  const v = process.env[k]
  if (!v) throw new Error(`Missing env var: ${k}. Make sure .env is at ${ROOT}/.env`)
  return v
}

export function supa() {
  // Load .env from Terminal X root
  try {
    const env = readFileSync(join(ROOT, '.env'), 'utf8')
    for (const line of env.split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
    }
  } catch {}
  const url = envOrThrow('SUPABASE_URL')
  const key = envOrThrow('SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, { auth: { persistSession: false } })
}

export function assertSim(businessName) {
  if (!businessName || !String(businessName).startsWith('__MULTIPOS_SIM__')) {
    throw new Error(
      `REFUSING TO RUN: business name "${businessName}" is not a simulation fixture. ` +
      `All harness operations must target businesses named '${SIM_BUSINESS_NAME}' to prevent data loss.`
    )
  }
}

function uuid() { return crypto.randomUUID() }

export async function tearDown(s) {
  // Delete by name — cascades to all child rows via FKs.
  const { data: biz } = await s.from('businesses').select('id,name').eq('name', SIM_BUSINESS_NAME)
  if (!biz?.length) return { removed: 0 }
  const ids = biz.map(b => b.id)
  // Manual cascade (in case FK ON DELETE CASCADE isn't set on all child tables).
  const children = [
    'ticket_items', 'tickets', 'inventory_items', 'ncf_sequences',
    'services', 'empleados', 'staff', 'clients', 'app_settings'
  ]
  for (const t of children) {
    await s.from(t).delete().in('business_id', ids)
  }
  await s.from('businesses').delete().in('id', ids)
  return { removed: ids.length }
}

export async function setUp(s, { devices = 2 } = {}) {
  // Idempotent: tear down any prior run first.
  await tearDown(s)

  const bizId = uuid()
  const { error: bizErr } = await s.from('businesses').insert({
    id: bizId,
    name: SIM_BUSINESS_NAME,
    rnc: '000000000',
    phone: '+18090000000',
    email: 'sim@terminalxpos.test',
    settings: { business_type: 'retail', devices, sim: true }
  })
  if (bizErr) throw new Error('fixtures setUp(businesses): ' + bizErr.message)

  // Owner / staff row (business owner)
  const ownerId = uuid()
  const { error: stErr } = await s.from('staff').insert({
    id: ownerId, supabase_id: ownerId,
    business_id: bizId, name: 'SIM Owner', username: 'simowner',
    pin_hash: 'x', role: 'owner', active: 1
  })
  if (stErr) throw new Error('fixtures setUp(staff): ' + stErr.message)

  // 5 empleados
  const empleados = []
  for (let i = 0; i < 5; i++) {
    const id = uuid()
    empleados.push({
      id, supabase_id: id, business_id: bizId,
      nombre: `SIM Emp ${i + 1}`, tipo: i % 2 === 0 ? 'cajero' : 'vendedor',
      role: 'cashier', active: 1, salary: 20000, comision_pct: 0,
      start_date: '2026-01-01', cedula: `000-000000${i}-0`
    })
  }
  const { error: eErr } = await s.from('empleados').insert(empleados)
  if (eErr) throw new Error('fixtures setUp(empleados): ' + eErr.message)

  // 10 inventory items with varied stock (5, 2, 1, 10, 20, 3, 1, 50, 7, 4)
  const stocks = [5, 2, 1, 10, 20, 3, 1, 50, 7, 4]
  const items = stocks.map((qty, i) => {
    const id = uuid()
    return {
      id, supabase_id: id, business_id: bizId,
      sku: `SIM-${String(i + 1).padStart(3, '0')}`,
      barcode: `900000${String(i + 1).padStart(4, '0')}`,
      name: `SIM Item ${i + 1}`,
      category: 'sim',
      quantity: qty,
      min_quantity: 1,
      price: 100 + i * 10,
      cost: 50 + i * 5,
      active: 1,
      aplica_itbis: 1
    }
  })
  const { error: iErr } = await s.from('inventory_items').insert(items)
  if (iErr) throw new Error('fixtures setUp(inventory_items): ' + iErr.message)

  // 5 services
  const services = []
  for (let i = 0; i < 5; i++) {
    const id = uuid()
    services.push({
      id, supabase_id: id, business_id: bizId,
      name: `SIM Service ${i + 1}`, price: 150 + i * 25,
      aplica_itbis: 1, is_wash: 0, active: 1,
      cost: 0, no_commission: 0
    })
  }
  const { error: svcErr } = await s.from('services').insert(services)
  if (svcErr) throw new Error('fixtures setUp(services): ' + svcErr.message)

  // NCF sequence for B01 (range 1..500)
  const seqId = uuid()
  const { error: nErr } = await s.from('ncf_sequences').insert({
    id: seqId, supabase_id: seqId, business_id: bizId,
    type: 'B01', prefix: 'B01',
    current_number: 0, limit_number: 500,
    active: 1, enabled: 1
  })
  if (nErr) throw new Error('fixtures setUp(ncf_sequences): ' + nErr.message)

  return {
    businessId: bizId,
    businessName: SIM_BUSINESS_NAME,
    ownerId,
    empleados: empleados.map(e => e.id),
    items: items.map(i => ({ id: i.id, sku: i.sku, qty: i.quantity, price: i.price })),
    services: services.map(s => ({ id: s.id, name: s.name, price: s.price })),
    ncfSeqId: seqId
  }
}
