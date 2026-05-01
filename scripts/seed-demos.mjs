// scripts/seed-demos.mjs
// Comprehensive demo seeder for Terminal X.
// Wipes + repopulates every "Demo *" business with realistic Spanish data.
// NEVER touches Studio X SRL, Ranoza, Perla Contabilidad, or any non-Demo row.
//
// Usage: node scripts/seed-demos.mjs
// Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ACCESS_TOKEN from .env
// (Hard-coded fallbacks pulled from .env so this runs standalone.)

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

// ─────────────────────── ENV BOOTSTRAP ───────────────────────
function loadEnv() {
  try {
    const t = fs.readFileSync(path.resolve('A:/Studio X HUB/Terminal X/.env'), 'utf8')
    for (const line of t.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
    }
  } catch {}
}
loadEnv()

const URL_BASE = process.env.SUPABASE_URL || 'https://csppjsoirjflumaiipqw.supabase.co'
const SR_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY
const TOKEN    = process.env.SUPABASE_ACCESS_TOKEN
const REF      = 'csppjsoirjflumaiipqw'

if (!SR_KEY || !TOKEN) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ACCESS_TOKEN'); process.exit(1)
}

// ─────────────────────── HTTP HELPERS ───────────────────────
async function rest(path, method, body, prefer = 'return=representation', silent = false) {
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${SR_KEY}`,
      apikey: SR_KEY,
      'Content-Type': 'application/json',
      Prefer: prefer,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const t = await r.text()
  if (!r.ok) {
    if (!silent) console.error(`FAIL ${method} ${path}:`, t.slice(0, 600))
    const err = new Error(`${method} ${path} → ${r.status}`)
    err.body = t; err.status = r.status
    throw err
  }
  return t ? JSON.parse(t) : null
}

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const t = await r.text()
  if (!r.ok) { console.error('SQL FAIL:', t.slice(0, 600)); throw new Error(t) }
  return JSON.parse(t)
}

const CHUNK = 500
function normalizeRows(rows) {
  // PostgREST requires every object in a bulk insert to have the SAME set of keys.
  // Compute the union of keys, then fill missing ones with null on every row.
  const keys = new Set()
  for (const r of rows) for (const k of Object.keys(r)) keys.add(k)
  const keyList = [...keys]
  return rows.map(r => {
    const out = {}
    for (const k of keyList) out[k] = (k in r) ? r[k] : null
    return out
  })
}
async function insertPlain(table, rows) {
  if (!rows.length) return 0
  const norm = normalizeRows(rows)
  let n = 0
  for (let i = 0; i < norm.length; i += CHUNK) {
    const slice = norm.slice(i, i + CHUNK)
    await rest(table, 'POST', slice, 'return=minimal')
    n += slice.length
  }
  return n
}
async function insertChunked(table, rows, conflict = 'business_id,supabase_id') {
  if (!rows.length) return 0
  if (table === 'activity_log') return insertPlain(table, rows)
  // Tables that don't have composite (business_id,supabase_id) UNIQUE — fall back to supabase_id
  const SID_ONLY = new Set(['vehicle_reservations','vehicle_warranties','bank_preapprovals','restaurant_reservations','memberships','client_memberships','service_recipe_items','mesas','leads','test_drives','sales_deals','vehicle_inventory','work_orders','work_order_items','vehicles','queue','cuadre_caja','inventory_oversells','stylist_schedules','appointments'])
  if (SID_ONLY.has(table)) conflict = 'supabase_id'
  // Mirror id → supabase_id when supabase_id is missing/null and id looks like a UUID
  for (const r of rows) {
    if ('supabase_id' in r && (r.supabase_id === null || r.supabase_id === undefined)
        && typeof r.id === 'string' && /^[0-9a-f-]{36}$/i.test(r.id)) {
      r.supabase_id = r.id
    }
    if (!('supabase_id' in r) && typeof r.id === 'string' && /^[0-9a-f-]{36}$/i.test(r.id)) {
      r.supabase_id = r.id
    }
  }
  const norm = normalizeRows(rows)
  const url = `${table}?on_conflict=${conflict}`
  let n = 0
  for (let i = 0; i < norm.length; i += CHUNK) {
    const slice = norm.slice(i, i + CHUNK)
    await rest(url, 'POST', slice, 'resolution=merge-duplicates,return=minimal')
    n += slice.length
  }
  return n
}

// ─────────────────────── HELPERS ───────────────────────
const now = () => new Date().toISOString()
const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = (d) => { const x = new Date(); x.setDate(x.getDate() - d); return x.toISOString() }
const daysAgoDate = (d) => { const x = new Date(); x.setDate(x.getDate() - d); return x.toISOString().slice(0, 10) }
const daysFwd = (d) => daysAgo(-d)
const daysFwdDate = (d) => daysAgoDate(-d)
const rndPick = (arr) => arr[Math.floor(Math.random() * arr.length)]
const rndInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1))
const round2 = (n) => Math.round(n * 100) / 100

const FIRST = ['Juan', 'María', 'Luis', 'Ana', 'Carlos', 'Sofía', 'Pedro', 'Carmen', 'José', 'Yulissa', 'Wandy', 'Rafael', 'Gloria', 'Manuel', 'Esperanza', 'Domingo', 'Yelitza', 'Franklin', 'Ramona', 'Héctor']
const LAST  = ['Pérez', 'García', 'Rodríguez', 'Martínez', 'Sánchez', 'Núñez', 'Reyes', 'Mejía', 'Peña', 'Almonte', 'Polanco', 'Tejada', 'Cabrera', 'Encarnación', 'Ortiz', 'Vargas', 'Cruz', 'Beltré']
const STREETS = ['Av. Independencia', 'C/ El Conde', 'Av. 27 de Febrero', 'Av. Lope de Vega', 'C/ Duarte', 'Av. Tiradentes', 'Av. Núñez de Cáceres', 'C/ José Reyes']
const SECTORS = ['Naco', 'Piantini', 'Bella Vista', 'Gazcue', 'Los Cacicazgos', 'Ensanche Naco', 'Mirador Norte', 'Zona Universitaria']
const fullName = () => `${rndPick(FIRST)} ${rndPick(LAST)} ${rndPick(LAST)}`
const phone = () => `+1809${rndInt(2000000, 9999999)}`
const cedula = () => `${String(rndInt(1, 999)).padStart(3,'0')}-${String(rndInt(1,9999999)).padStart(7,'0')}-${rndInt(0,9)}`
const rncStr = () => `${String(rndInt(100000000, 199999999))}`
const address = () => `${rndPick(STREETS)} #${rndInt(1, 250)}, ${rndPick(SECTORS)}, Santo Domingo`

const PAY_METHODS = ['efectivo', 'tarjeta', 'transferencia']

// Deterministic-ish UUID v4 generation (regular randomUUID).
const newId = () => randomUUID()

// ─────────────────────── ACTIVITY LOG ───────────────────────
const ACT_EVENTS = [
  { event_type: 'login', severity: 'info' },
  { event_type: 'logout', severity: 'info' },
  { event_type: 'ticket_created', severity: 'info' },
  { event_type: 'ticket_paid', severity: 'info' },
  { event_type: 'ticket_voided', severity: 'warn' },
  { event_type: 'cuadre_closed', severity: 'info' },
  { event_type: 'caja_chica_added', severity: 'info' },
  { event_type: 'inventory_adjusted', severity: 'warn' },
  { event_type: 'price_changed', severity: 'warn' },
  { event_type: 'ncf_assigned', severity: 'info' },
  { event_type: 'manager_authorized', severity: 'critical' },
  { event_type: 'cert_pem_export', severity: 'critical' },
]

function buildActivityLog(bid, empleados) {
  const rows = []
  for (let d = 0; d < 30; d++) {
    const events = rndInt(2, 7)
    for (let i = 0; i < events; i++) {
      const ev = rndPick(ACT_EVENTS)
      const actor = rndPick(empleados)
      rows.push({
        supabase_id: newId(), business_id: bid,
        event_type: ev.event_type, severity: ev.severity,
        actor_supabase_id: actor.supabase_id, actor_name: actor.nombre, actor_role: actor.role,
        target_type: 'system', target_name: ev.event_type,
        amount: ev.event_type === 'ticket_paid' ? round2(rndInt(200, 8000) + Math.random()) : null,
        reason: null,
        metadata: { seeded: true, day: d },
        created_at: daysAgo(d),
        updated_at: daysAgo(d),
      })
    }
  }
  return rows
}

// ─────────────────────── COMMON SEEDS ───────────────────────
function buildEmpleados(bid, vertical) {
  // Returns 8-10 empleados with role + tipo mix appropriate to vertical
  const roleMix = [
    { role: 'owner',      tipo: 'cajero',  nombre: 'Dueño Demo',       puesto: 'Propietario',    salary: 80000, comision_pct: 0 },
    { role: 'manager',    tipo: 'cajero',  nombre: fullName(),         puesto: 'Gerente',        salary: 45000, comision_pct: 2 },
    { role: 'cfo',        tipo: 'cajero',  nombre: fullName(),         puesto: 'CFO',            salary: 60000, comision_pct: 0 },
    { role: 'accountant', tipo: 'cajero',  nombre: fullName(),         puesto: 'Contabilidad',   salary: 35000, comision_pct: 0 },
    { role: 'cashier',    tipo: 'cajero',  nombre: fullName(),         puesto: 'Cajero/a',       salary: 22000, comision_pct: 0 },
    { role: 'cashier',    tipo: 'cajero',  nombre: fullName(),         puesto: 'Cajero/a',       salary: 22000, comision_pct: 0 },
  ]
  // Vertical-specific extras
  if (vertical === 'carwash') {
    roleMix.push({ role: 'none', tipo: 'lavador', nombre: fullName(), puesto: 'Lavador',  salary: 16000, comision_pct: 10 })
    roleMix.push({ role: 'none', tipo: 'lavador', nombre: fullName(), puesto: 'Lavador',  salary: 16000, comision_pct: 10 })
    roleMix.push({ role: 'none', tipo: 'lavador', nombre: fullName(), puesto: 'Lavador',  salary: 16000, comision_pct: 10 })
  } else if (vertical === 'salon') {
    roleMix.push({ role: 'none', tipo: 'estilista', nombre: fullName(), puesto: 'Estilista', salary: 22000, comision_pct: 30 })
    roleMix.push({ role: 'none', tipo: 'estilista', nombre: fullName(), puesto: 'Estilista', salary: 22000, comision_pct: 30 })
    roleMix.push({ role: 'none', tipo: 'estilista', nombre: fullName(), puesto: 'Estilista', salary: 22000, comision_pct: 30 })
    roleMix.push({ role: 'none', tipo: 'estilista', nombre: fullName(), puesto: 'Estilista', salary: 22000, comision_pct: 30 })
  } else if (vertical === 'concesionario') {
    roleMix.push({ role: 'none', tipo: 'vendedor', nombre: fullName(), puesto: 'Vendedor', salary: 25000, comision_pct: 3 })
    roleMix.push({ role: 'none', tipo: 'vendedor', nombre: fullName(), puesto: 'Vendedor', salary: 25000, comision_pct: 3 })
    roleMix.push({ role: 'none', tipo: 'vendedor', nombre: fullName(), puesto: 'Vendedor', salary: 25000, comision_pct: 3 })
  } else if (vertical === 'tienda' || vertical === 'carniceria' || vertical === 'licoreria') {
    roleMix.push({ role: 'none', tipo: 'vendedor', nombre: fullName(), puesto: 'Vendedor',     salary: 18000, comision_pct: 5 })
    roleMix.push({ role: 'none', tipo: 'vendedor', nombre: fullName(), puesto: 'Vendedor',     salary: 18000, comision_pct: 5 })
  } else if (vertical === 'restaurante') {
    roleMix.push({ role: 'kitchen', tipo: 'cajero', nombre: fullName(), puesto: 'Cocina',  salary: 20000, comision_pct: 0 })
    roleMix.push({ role: 'none',    tipo: 'mesero', nombre: fullName(), puesto: 'Mesero',  salary: 16000, comision_pct: 8 })
    roleMix.push({ role: 'none',    tipo: 'mesero', nombre: fullName(), puesto: 'Mesero',  salary: 16000, comision_pct: 8 })
  } else if (vertical === 'mecanica') {
    roleMix.push({ role: 'none', tipo: 'tecnico', nombre: fullName(), puesto: 'Mecánico', salary: 28000, comision_pct: 5 })
    roleMix.push({ role: 'none', tipo: 'tecnico', nombre: fullName(), puesto: 'Mecánico', salary: 28000, comision_pct: 5 })
  } else {
    roleMix.push({ role: 'none', tipo: 'cajero', nombre: fullName(), puesto: 'Operativo', salary: 18000, comision_pct: 0 })
    roleMix.push({ role: 'none', tipo: 'cajero', nombre: fullName(), puesto: 'Operativo', salary: 18000, comision_pct: 0 })
  }

  return roleMix.map((r, i) => ({
    supabase_id: newId(), business_id: bid,
    nombre: r.nombre, tipo: r.tipo, role: r.role, puesto: r.puesto,
    salary: r.salary, comision_pct: r.comision_pct,
    cedula: cedula(), phone: phone(), email: `empleado${i+1}@demo.com`,
    bank_account: `${rndInt(1000000000, 9999999999)}`, tss_id: cedula(),
    start_date: daysAgoDate(rndInt(60, 720)),
    active: true, created_at: now(), updated_at: now(),
  }))
}

function buildClients(bid) {
  const out = []
  // 2 RNC clients
  for (let i = 0; i < 2; i++) {
    out.push({
      id: newId(), supabase_id: null, business_id: bid,
      name: fullName(), rnc: rncStr(), phone: phone(),
      email: `cliente${i}@empresa.com`, address: address(),
      credit_limit: 50000, balance: 0, visits: rndInt(2, 30), total_spent: round2(rndInt(5000, 100000)),
      loyalty_points: rndInt(0, 500), loyalty_tier: rndPick(['bronce', 'plata', 'oro', null]),
      active: true, wa_opt_out: false,
      created_at: now(), updated_at: now(),
    })
  }
  // 5 walk-in
  for (let i = 0; i < 5; i++) {
    out.push({
      id: newId(), supabase_id: null, business_id: bid,
      name: fullName(), phone: phone(),
      credit_limit: 0, balance: 0, visits: rndInt(1, 15), total_spent: round2(rndInt(500, 30000)),
      loyalty_points: 0, active: true, wa_opt_out: false,
      created_at: now(), updated_at: now(),
    })
  }
  // 2 with credit balance
  for (let i = 0; i < 2; i++) {
    out.push({
      id: newId(), supabase_id: null, business_id: bid,
      name: fullName(), phone: phone(), address: address(),
      credit_limit: 25000, balance: round2(rndInt(2000, 12000)),
      visits: rndInt(5, 40), total_spent: round2(rndInt(10000, 60000)),
      loyalty_points: rndInt(50, 200), loyalty_tier: 'plata',
      active: true, wa_opt_out: false,
      created_at: now(), updated_at: now(),
    })
  }
  // 1 with high loyalty
  out.push({
    id: newId(), supabase_id: null, business_id: bid,
    name: fullName(), phone: phone(), email: 'fidelidad@demo.com',
    credit_limit: 0, balance: 0, visits: 80, total_spent: 250000,
    loyalty_points: 1500, loyalty_tier: 'oro', loyalty_lifetime_earned: 3000,
    birthday_treat_available: true,
    active: true, wa_opt_out: false,
    created_at: now(), updated_at: now(),
  })
  // mirror id → supabase_id
  out.forEach(c => { c.supabase_id = c.id })
  return out
}

function buildAppSettings(bid, vertical) {
  const KV = (key, value) => ({
    id: newId(), supabase_id: newId(), business_id: bid,
    key, value: String(value), updated_at: now(),
    is_device_local: false, device_hwid: null,
  })
  const rows = [
    KV('go_live_date', '2026-01-01'),
    KV('itbis_pct', '18'),
    KV('ncf_pct', '18'),
    KV('currency', 'DOP'),
    KV('biz_city', 'Santo Domingo'),
    KV('ciudad',   'Santo Domingo'),
    KV('print_width', '42'),
    KV('codepage', '858'),
    KV('whatsapp_phone', '+18098282971'),
    KV('rnc', '133410321'),
    KV('dgii_environment', 'certecf'),
    KV('plan_tier', 'pro_max'),
  ]
  if (vertical === 'tienda')      rows.push(KV('tienda_subtype', 'colmado'))
  if (vertical === 'licoreria')   { rows.push(KV('tienda_subtype', 'licoreria')); rows.push(KV('age_verification_enabled', 'true')); rows.push(KV('bottle_deposit_enabled', 'true')) }
  if (vertical === 'carniceria')  { rows.push(KV('tienda_subtype', 'carniceria')); rows.push(KV('feature_freshness_alerts_enabled', 'true')) }
  if (vertical === 'restaurante') { rows.push(KV('servicio_pct', '10')); rows.push(KV('feature_kds_enabled', 'true')); rows.push(KV('feature_reservas_enabled', 'true')) }
  if (vertical === 'salon')       { rows.push(KV('feature_appointments_enabled', 'true')); rows.push(KV('feature_memberships_enabled', 'true')) }
  if (vertical === 'concesionario') { rows.push(KV('feature_uaf_modal_enabled', 'true')); rows.push(KV('feature_lead_scoring_enabled', 'true')) }
  if (vertical === 'mecanica')    rows.push(KV('feature_wo_to_ticket_enabled', 'true'))
  return rows
}

function buildNcfSequences(bid) {
  const types = [
    { type: 'B01', prefix: 'B01', current_number: rndInt(50, 200), limit_number: 99999999 },
    { type: 'B02', prefix: 'B02', current_number: rndInt(20, 100), limit_number: 99999999 },
    { type: 'E31', prefix: 'E31', current_number: rndInt(10, 80),  limit_number: 999999999 },
    { type: 'E32', prefix: 'E32', current_number: rndInt(10, 80),  limit_number: 999999999 },
    { type: 'E33', prefix: 'E33', current_number: rndInt(0, 20),   limit_number: 999999999 },
    { type: 'E34', prefix: 'E34', current_number: rndInt(0, 20),   limit_number: 999999999 },
  ]
  return types.map(t => ({
    id: newId(), supabase_id: newId(), business_id: bid,
    type: t.type, prefix: t.prefix,
    current_number: t.current_number, limit_number: t.limit_number,
    valid_until: daysFwdDate(180),
    active: true, enabled: true,
    created_at: now(), updated_at: now(),
  }))
}

// ─────────────────────── SERVICES ───────────────────────
function buildServicesCarwash(bid) {
  const list = [
    { name: 'Lavado Básico',    price: 250,  cost: 50,  comW: true,  comC: false, no_com: false },
    { name: 'Lavado Completo',  price: 450,  cost: 90,  comW: true,  comC: false, no_com: false },
    { name: 'Lavado Exterior',  price: 200,  cost: 40,  comW: true,  comC: false, no_com: false },
    { name: 'Lavado Motor',     price: 800,  cost: 150, comW: true,  comC: false, no_com: false },
    { name: 'Encerado Premium', price: 1200, cost: 250, comW: true,  comC: false, no_com: false },
  ]
  return list.map((s, i) => svc(bid, s, i, true /* is_wash */))
}
function buildServicesSalon(bid) {
  const list = [
    { name: 'Corte Dama',            price: 600,  cost: 50, category: 'Corte' },
    { name: 'Corte Caballero',       price: 400,  cost: 30, category: 'Corte' },
    { name: 'Tinte Completo',        price: 1800, cost: 350, category: 'Color' },
    { name: 'Mechas / Highlights',   price: 2500, cost: 500, category: 'Color' },
    { name: 'Manicure',              price: 350,  cost: 50, category: 'Uñas' },
    { name: 'Pedicure',              price: 450,  cost: 70, category: 'Uñas' },
    { name: 'Tratamiento Capilar',   price: 800,  cost: 150, category: 'Tratamiento' },
    { name: 'Alisado Brasileño',     price: 4500, cost: 800, category: 'Tratamiento' },
  ]
  return list.map((s, i) => svc(bid, s, i, false))
}
function buildServicesRestaurante(bid) {
  const list = [
    { name: 'Pollo a la Brasa Entero',    price: 750, cost: 200, category: 'Plato Fuerte', course: 'main',     station: 'cocina' },
    { name: 'Pica Pollo (10 piezas)',     price: 550, cost: 150, category: 'Plato Fuerte', course: 'main',     station: 'cocina' },
    { name: 'Mofongo con Chicharrón',     price: 480, cost: 130, category: 'Plato Fuerte', course: 'main',     station: 'cocina' },
    { name: 'La Bandera Dominicana',      price: 380, cost: 100, category: 'Plato Fuerte', course: 'main',     station: 'cocina' },
    { name: 'Sancocho',                   price: 420, cost: 110, category: 'Sopa',         course: 'starter',  station: 'cocina' },
    { name: 'Empanadas (3)',              price: 180, cost: 40,  category: 'Entrante',     course: 'starter',  station: 'cocina' },
    { name: 'Jugo Natural Chinola',       price: 120, cost: 25,  category: 'Bebida',       course: 'beverage', station: 'barra' },
    { name: 'Cerveza Presidente',         price: 180, cost: 70,  category: 'Bebida',       course: 'beverage', station: 'barra' },
    { name: 'Flan de Coco',               price: 220, cost: 50,  category: 'Postre',       course: 'dessert',  station: 'cocina' },
  ]
  // 5 modificadores
  list.push({ name: 'Mod: Sin Cebolla',   price: 0,  cost: 0, category: 'Modificador', course: 'modifier', station: 'cocina' })
  list.push({ name: 'Mod: Extra Salsa',   price: 30, cost: 5, category: 'Modificador', course: 'modifier', station: 'cocina' })
  list.push({ name: 'Mod: Punto Cocción', price: 0,  cost: 0, category: 'Modificador', course: 'modifier', station: 'cocina' })
  list.push({ name: 'Mod: Sin Sal',       price: 0,  cost: 0, category: 'Modificador', course: 'modifier', station: 'cocina' })
  list.push({ name: 'Mod: Para Llevar',   price: 0,  cost: 0, category: 'Modificador', course: 'modifier', station: 'cocina' })
  return list.map((s, i) => svc(bid, { ...s, comC: false, comW: false, no_com: s.category === 'Modificador' }, i, false, true /* is_menu_item */))
}
function buildServicesMecanica(bid) {
  const list = [
    { name: 'Mano de obra (hora)',         price: 800,  cost: 0,    category: 'Labor' },
    { name: 'Diagnóstico Computarizado',   price: 1500, cost: 100,  category: 'Labor' },
    { name: 'Cambio de Aceite + Filtro',   price: 1200, cost: 600,  category: 'Servicio' },
    { name: 'Alineación + Balanceo',       price: 1500, cost: 200,  category: 'Servicio' },
    { name: 'Cambio Pastillas Frenos',     price: 2500, cost: 1200, category: 'Servicio' },
    { name: 'Sangrado Sistema Frenos',     price: 800,  cost: 100,  category: 'Servicio' },
  ]
  return list.map((s, i) => svc(bid, s, i, false))
}
function buildServicesGeneric(bid, vertical) {
  const list = vertical === 'concesionario' ? [
    { name: 'Comisión Vendedor',     price: 0, cost: 0, category: 'Cargo' },
    { name: 'Gestión Matrícula',     price: 5500, cost: 0, category: 'Servicio' },
    { name: 'Inspección Técnica',    price: 1200, cost: 0, category: 'Servicio' },
  ] : [
    { name: 'Servicio General',      price: 500, cost: 100, category: 'Servicio' },
    { name: 'Consultoría (hora)',    price: 1500, cost: 0,  category: 'Servicio' },
    { name: 'Asesoría',              price: 2500, cost: 0,  category: 'Servicio' },
  ]
  return list.map((s, i) => svc(bid, s, i, false))
}
function svc(bid, s, i, is_wash, is_menu_item = false) {
  return {
    id: newId(), supabase_id: null, business_id: bid,
    name: s.name, category: s.category || 'General',
    price: s.price, cost: s.cost,
    aplica_itbis: true, is_wash: !!is_wash,
    no_commission: s.no_com === true,
    commission_washer: s.comW === true,
    commission_seller: s.comS === true,
    commission_cashier: s.comC === true,
    is_menu_item, course: s.course || null, station: s.station || null,
    in_stock: true, active: true, sort_order: i,
    created_at: now(), updated_at: now(),
  }
}

// ─────────────────────── INVENTORY ───────────────────────
function buildInventoryTienda(bid, vertical) {
  // 50 items
  const productsTienda = [
    ['Arroz Marca Línea 5lb',     'Despensa',  85,    65],
    ['Habichuelas Rojas 1lb',     'Despensa',  75,    55],
    ['Aceite Crisol 1L',          'Despensa',  220,   180],
    ['Sal La Fina 1lb',           'Despensa',  35,    20],
    ['Azúcar Blanca 5lb',         'Despensa',  220,   170],
    ['Pasta Ronzoni 1lb',         'Despensa',  90,    60],
    ['Salsa Tomate Pomi 250g',    'Despensa',  85,    50],
    ['Café Santo Domingo 1lb',    'Despensa',  450,   380],
    ['Leche Rica 1L',             'Lácteos',   105,   85],
    ['Yogurt Yoplait 1kg',        'Lácteos',   190,   150],
    ['Queso Sandwich Sigma 1lb',  'Lácteos',   240,   190],
    ['Mantequilla Anchor 1lb',    'Lácteos',   320,   260],
    ['Pan Sobao Bimbo',           'Panadería', 95,    70],
    ['Galletas Hatuey',           'Panadería', 60,    40],
    ['Pollo Entero (lb)',         'Carnes',    85,    60],
    ['Carne de Res Molida (lb)',  'Carnes',    240,   190],
    ['Salchichas Induveca',       'Carnes',    180,   140],
    ['Coca-Cola 1.5L',            'Bebidas',   115,   80],
    ['Agua Crystal 1gal',         'Bebidas',   85,    60],
    ['Jugo Tampico 1gal',         'Bebidas',   220,   170],
    ['Cerveza Presidente Jaba',   'Bebidas',   650,   520],
    ['Detergente Ace 1kg',        'Limpieza',  340,   270],
    ['Cloro Mistolín 1gal',       'Limpieza',  160,   115],
    ['Papel Higiénico Scott 4',   'Limpieza',  220,   170],
    ['Jabón Lavaplatos Axión',    'Limpieza',  90,    65],
    ['Pasta Dental Colgate',      'Higiene',   145,   105],
    ['Shampoo Pantene 400ml',     'Higiene',   320,   240],
    ['Desodorante Old Spice',     'Higiene',   265,   200],
    ['Cigarrillos Marlboro',      'Tabacos',   285,   250],
    ['Encendedor Bic',            'Tabacos',   45,    25],
    ['Chocolate Hershey',         'Confitería',55,    35],
    ['Caramelos Halls',           'Confitería',75,    50],
    ['Chicle Trident',            'Confitería',45,    30],
    ['Galletas Oreo',             'Confitería',95,    65],
    ['Chips Lays',                'Snacks',    120,   80],
    ['Doritos Nacho',             'Snacks',    150,   100],
    ['Pringles',                  'Snacks',    225,   170],
    ['Maní Diana',                'Snacks',    65,    40],
    ['Toallas Femeninas Always',  'Higiene',   285,   220],
    ['Pañales Pampers M',         'Bebé',      650,   500],
    ['Toallitas Húmedas',         'Bebé',      225,   170],
    ['Fórmula Enfamil 12oz',      'Bebé',      1450,  1180],
    ['Aspirina',                  'Farmacia',  85,    50],
    ['Tylenol Niños',             'Farmacia',  185,   130],
    ['Vitaminas Centrum',         'Farmacia',  520,   400],
    ['Tylenol Adulto',            'Farmacia',  220,   165],
    ['Velas Aromáticas',          'Hogar',     145,   100],
    ['Bombillo LED 9w',           'Hogar',     125,   85],
    ['Pilas AA Duracell 4',       'Hogar',     185,   140],
    ['Cargador USB-C',            'Hogar',     320,   220],
  ]
  const productsLicoreria = productsTienda.slice(0, 25).concat([
    ['Brugal Añejo 750ml',     'Ron',       650,   480, true],
    ['Brugal Extra Viejo',     'Ron',       1100,  850, true],
    ['Barceló Imperial',       'Ron',       1450,  1100, true],
    ['Bermudez Aniversario',   'Ron',       1200,  900, true],
    ['Vodka Smirnoff',         'Vodka',     950,   720, true],
    ['Whisky Black Label',     'Whisky',    2400,  1800, true],
    ['Whisky Buchanan\'s 12',  'Whisky',    2200,  1700, true],
    ['Tequila Don Julio',      'Tequila',   2900,  2300, true],
    ['Vino Tinto Casillero',   'Vino',      850,   620, true],
    ['Champagne Veuve',        'Champagne', 7500,  6200, true],
    ['Cerveza Presidente Jaba','Cerveza',   650,   520],
    ['Cerveza Modelo Jaba',    'Cerveza',   850,   680],
    ['Heineken Six-pack',      'Cerveza',   480,   360],
    ['Hielo en Bolsa',         'Accesorios',60,    25],
    ['Coca-Cola 2L',           'Mezcladores', 145, 95],
    ['Limones (lb)',           'Mezcladores', 65,  40],
    ['Sprite 2L',              'Mezcladores', 145, 95],
    ['Tabaco Cohíba',          'Tabacos',    1850, 1400],
    ['Encendedor Zippo',       'Accesorios', 850,  650],
    ['Hielera Coleman 30L',    'Accesorios', 4500, 3500],
    ['Vasos Plásticos x50',    'Accesorios', 220,  150],
    ['Servilletas Pack',       'Accesorios', 95,   60],
    ['Cubitera',               'Accesorios', 350,  250],
    ['Saca-Corcho',            'Accesorios', 280,  180],
    ['Botella Vacía Casco',    'Accesorios', 25,   0],
  ])
  const productsCarniceria = [
    ['Filete Res (lb)',           'Res',         480, 350, false, 'lb'],
    ['Carne Molida Premium (lb)', 'Res',         260, 190, false, 'lb'],
    ['Costilla Res (lb)',         'Res',         220, 160, false, 'lb'],
    ['Falda Res (lb)',            'Res',         320, 240, false, 'lb'],
    ['Carne Guisar Res (lb)',     'Res',         180, 130, false, 'lb'],
    ['Pollo Entero (lb)',         'Pollo',       85,  60,  false, 'lb'],
    ['Pechuga Pollo (lb)',        'Pollo',       145, 100, false, 'lb'],
    ['Muslo Pollo (lb)',          'Pollo',       95,  65,  false, 'lb'],
    ['Alas Pollo (lb)',           'Pollo',       125, 90,  false, 'lb'],
    ['Cerdo Pernil (lb)',         'Cerdo',       195, 140, false, 'lb'],
    ['Costilla Cerdo (lb)',       'Cerdo',       220, 160, false, 'lb'],
    ['Chuleta Cerdo (lb)',        'Cerdo',       240, 175, false, 'lb'],
    ['Tocineta (lb)',             'Cerdo',       380, 280, false, 'lb'],
    ['Chivo Pierna (lb)',         'Chivo',       320, 240, false, 'lb'],
    ['Chivo Costilla (lb)',       'Chivo',       290, 220, false, 'lb'],
    ['Pavo Entero (lb)',          'Pavo',        220, 165, false, 'lb'],
    ['Camarones Jumbo (lb)',      'Mariscos',    580, 430, false, 'lb'],
    ['Pescado Mero (lb)',         'Mariscos',    520, 390, false, 'lb'],
    ['Pulpo (lb)',                'Mariscos',    480, 360, false, 'lb'],
    ['Salami Induveca',           'Embutidos',   290, 220],
    ['Jamón Sigma Sliced (lb)',   'Embutidos',   320, 240],
    ['Salchichas Hot Dog',        'Embutidos',   180, 135],
    ['Chorizo Español',           'Embutidos',   420, 320],
  ]
  let products
  if (vertical === 'licoreria')   products = productsLicoreria
  else if (vertical === 'carniceria') products = productsCarniceria
  else                            products = productsTienda

  return products.slice(0, 50).map((p, i) => {
    const [name, category, price, cost, hasDeposit, unit] = p
    const isSoldByWeight = !!unit && unit === 'lb'
    return {
      id: newId(), supabase_id: null, business_id: bid,
      name, category, sku: `SKU-${(i + 1).toString().padStart(4, '0')}`,
      barcode: `7${String(rndInt(100000000000, 999999999999))}`,
      quantity: rndInt(8, 120), min_quantity: rndInt(2, 10),
      price, cost,
      aplica_itbis: name.toLowerCase().includes('jugo') || name.toLowerCase().includes('agua') ? 0 : 1,
      sold_by_weight: isSoldByWeight, unit: isSoldByWeight ? 'lb' : null,
      price_per_unit: isSoldByWeight ? price : null,
      bottle_deposit: hasDeposit ? 25 : null,
      reorder_quantity: rndInt(20, 80), supplier: 'Distribuidora Demo SRL',
      received_at: daysAgoDate(rndInt(1, 30)),
      expires_at: name.toLowerCase().match(/leche|yogur|carne|pollo|pescado|cerdo|chivo|pavo|camar|pulpo|res|chorizo|jamón|salami/) ? daysFwdDate(rndInt(2, 60)) : null,
      active: true,
      created_at: now(), updated_at: now(),
    }
  })
}
function buildInventoryMecanica(bid) {
  const items = [
    ['Filtro de Aceite Universal', 'Filtros', 280, 180],
    ['Filtro de Aire',             'Filtros', 320, 220],
    ['Filtro de Cabina',           'Filtros', 380, 260],
    ['Aceite Mobil 1 5W30 (qt)',   'Lubricantes', 480, 320],
    ['Aceite Castrol 10W40 (qt)',  'Lubricantes', 380, 250],
    ['Pastillas Freno Delanteras', 'Frenos', 1800, 1100],
    ['Discos Freno Delanteros',    'Frenos', 2400, 1500],
    ['Líquido Frenos DOT4',        'Frenos', 320, 200],
    ['Bujías Iridium x4',          'Encendido', 1200, 800],
    ['Cable Bujías',               'Encendido', 850, 550],
    ['Batería 12V 60Ah',           'Eléctrico', 4800, 3500],
    ['Alternador Reman',           'Eléctrico', 6500, 4500],
    ['Correa Distribución',        'Motor', 2200, 1400],
    ['Bomba de Agua',              'Motor', 3200, 2100],
    ['Termostato',                 'Motor', 850, 550],
    ['Anticongelante (gal)',       'Lubricantes', 580, 380],
    ['Limpiaparabrisas Bosch',     'Accesorios', 480, 300],
    ['Llanta 195/65R15',           'Llantas', 4200, 3000],
    ['Llanta 205/55R16',           'Llantas', 5500, 3900],
    ['Amortiguador Delantero',     'Suspensión', 3800, 2500],
  ]
  return items.map((p, i) => ({
    id: newId(), supabase_id: null, business_id: bid,
    name: p[0], category: p[1], sku: `MEC-${(i + 1).toString().padStart(4, '0')}`,
    barcode: `7${String(rndInt(100000000000, 999999999999))}`,
    quantity: rndInt(3, 30), min_quantity: rndInt(2, 5),
    price: p[2], cost: p[3], aplica_itbis: 1,
    oem_part_number: `OEM-${rndInt(10000, 99999)}`,
    supplier: 'AutoZone RD',
    active: true, created_at: now(), updated_at: now(),
  }))
}

// ─────────────────────── TICKETS ───────────────────────
function buildTickets({ bid, count, services, clients, empleados, vertical, daysSpread = 14, includeInventory = false, inventory = [] }) {
  const tickets = []
  const items = []
  const cashiers = empleados.filter(e => e.role === 'cashier' || e.role === 'manager' || e.role === 'owner')
  const washers  = empleados.filter(e => e.tipo === 'lavador')
  const sellers  = empleados.filter(e => e.tipo === 'vendedor' || e.tipo === 'mesero' || e.tipo === 'estilista')

  for (let i = 0; i < count; i++) {
    const day = rndInt(0, daysSpread)
    const created = daysAgo(day)
    const cajero = rndPick(cashiers) || empleados[0]
    const seller = sellers.length ? rndPick(sellers) : null
    const washerArr = washers.length ? [rndPick(washers).supabase_id] : []
    const client = Math.random() < 0.45 ? rndPick(clients) : null
    const tid = newId()

    // build line items
    const numLines = vertical === 'restaurante' ? rndInt(2, 5) : (vertical === 'tienda' || vertical === 'licoreria' || vertical === 'carniceria') ? rndInt(2, 6) : rndInt(1, 3)
    let subtotal = 0, itbis = 0
    const lineRows = []
    for (let j = 0; j < numLines; j++) {
      const useInv = includeInventory && inventory.length && Math.random() < 0.7
      if (useInv) {
        const inv = rndPick(inventory)
        const qty = inv.sold_by_weight ? round2(0.5 + Math.random() * 3) : rndInt(1, 4)
        const lineTotal = round2(inv.price * qty)
        const lineItbis = inv.aplica_itbis ? round2(lineTotal - lineTotal / 1.18) : 0
        subtotal += lineTotal - lineItbis
        itbis += lineItbis
        lineRows.push({
          id: newId(), supabase_id: newId(), business_id: bid, ticket_supabase_id: tid,
          name: inv.name, price: inv.price, itbis: lineItbis, is_wash: false,
          quantity: qty, sku: inv.sku, inventory_item_supabase_id: inv.id,
          cost: inv.cost, weight: inv.sold_by_weight ? qty : null, unit: inv.unit, price_per_unit: inv.price_per_unit,
          created_at: created, updated_at: created,
        })
      } else {
        const sv = rndPick(services)
        if (!sv) continue
        const qty = 1
        const lineTotal = round2(sv.price * qty)
        const lineItbis = sv.aplica_itbis ? round2(lineTotal - lineTotal / 1.18) : 0
        subtotal += lineTotal - lineItbis
        itbis += lineItbis
        lineRows.push({
          id: newId(), supabase_id: newId(), business_id: bid, ticket_supabase_id: tid,
          name: sv.name, price: sv.price, itbis: lineItbis, is_wash: !!sv.is_wash,
          quantity: qty, service_supabase_id: sv.id, cost: sv.cost,
          course: sv.course,
          empleado_supabase_id: seller?.supabase_id || null,
          created_at: created, updated_at: created,
        })
      }
    }
    if (!lineRows.length) continue
    subtotal = round2(subtotal); itbis = round2(itbis)
    const total = round2(subtotal + itbis)
    const payMethod = rndPick(PAY_METHODS)
    const tipoVenta = client?.rnc ? 'credito_fiscal' : 'consumo'
    const ncfType = client?.rnc ? 'B01' : 'B02'
    const ncfSeq = String(1000 + i).padStart(8, '0')
    tickets.push({
      id: tid, supabase_id: tid, business_id: bid,
      doc_number: `D-${1000 + i}`,
      client_name: client?.name || null, client_supabase_id: client?.id || null,
      services_json: lineRows.map(l => ({ name: l.name, price: l.price, qty: l.quantity })),
      subtotal, itbis, ley: 0, total,
      ncf: ncfType + ncfSeq, ncf_type: ncfType, comprobante_type: ncfType,
      payment_method: payMethod, tipo_venta: tipoVenta,
      cajero_supabase_id: cajero.supabase_id, cajero_name: cajero.nombre,
      seller_supabase_id: seller?.supabase_id || null,
      washer_empleado_supabase_ids: washerArr,
      seller_empleado_supabase_id: seller?.supabase_id || null,
      status: 'cobrado', paid_at: created, created_at: created, updated_at: created,
      vehicle_plate: vertical === 'carwash' ? `A${rndInt(100000, 999999)}` : null,
      vehicle_color: vertical === 'carwash' ? rndPick(['Blanco', 'Negro', 'Gris', 'Rojo', 'Azul']) : null,
      vehicle_make:  vertical === 'carwash' ? rndPick(['Toyota', 'Honda', 'Hyundai', 'Kia', 'Nissan']) : null,
      currency: 'DOP', is_test: false, rev: 1, beverage_subtotal: 0,
    })
    items.push(...lineRows)
  }
  return { tickets, items }
}

// ─────────────────────── VERTICAL SEEDERS ───────────────────────
async function seedCarwash(b, summary) {
  const bid = b.id
  const empleados = buildEmpleados(bid, 'carwash')
  const clients   = buildClients(bid)
  const services  = buildServicesCarwash(bid)
  const ncf       = buildNcfSequences(bid)
  const settings  = buildAppSettings(bid, 'carwash')

  await insertChunked('empleados', empleados)
  await insertChunked('clients', clients)
  await insertChunked('services', services)
  await insertChunked('ncf_sequences', ncf)
  await insertChunked('app_settings', settings)

  const { tickets, items } = buildTickets({ bid, count: 60, services, clients, empleados, vertical: 'carwash' })
  // Mark 3 voided
  for (let i = 0; i < 3; i++) {
    tickets[i].status = 'anulado'
    tickets[i].void_reason = rndPick(['Cliente cambió de opinión', 'Error de cobro', 'Doble cobro'])
    tickets[i].void_at = tickets[i].created_at
  }
  await insertChunked('tickets', tickets)
  await insertChunked('ticket_items', items)

  // 5 pendiente queue tickets — separate (no payment yet)
  const queueTickets = []
  const queueItems = []
  const queueRows = []
  for (let i = 0; i < 5; i++) {
    const created = daysAgo(0)
    const tid = newId()
    const sv = rndPick(services)
    const qid = newId()
    queueTickets.push({
      id: tid, supabase_id: tid, business_id: bid,
      services_json: [{ name: sv.name, price: sv.price }],
      subtotal: round2(sv.price / 1.18), itbis: round2(sv.price - sv.price / 1.18), total: sv.price,
      status: 'pendiente', created_at: created, updated_at: created,
      vehicle_plate: `Q${rndInt(100000, 999999)}`, vehicle_color: rndPick(['Blanco','Negro','Gris']),
      vehicle_make: rndPick(['Toyota','Honda']), currency: 'DOP', is_test: false, rev: 1, beverage_subtotal: 0,
      ley: 0,
    })
    queueItems.push({
      id: newId(), supabase_id: newId(), business_id: bid, ticket_supabase_id: tid,
      name: sv.name, price: sv.price, itbis: round2(sv.price - sv.price / 1.18), is_wash: true,
      quantity: 1, service_supabase_id: sv.id, cost: sv.cost,
      created_at: created, updated_at: created,
    })
    const washer = empleados.find(e => e.tipo === 'lavador')
    queueRows.push({
      id: qid, supabase_id: qid, business_id: bid, ticket_supabase_id: tid,
      status: i < 2 ? 'asignado' : 'en_cola',
      empleado_supabase_id: i < 2 ? washer?.supabase_id : null,
      assigned_at: i < 2 ? created : null, created_at: created, updated_at: created,
    })
  }
  await insertChunked('tickets', queueTickets)
  await insertChunked('ticket_items', queueItems)
  await insertChunked('queue', queueRows)

  // 2 cuadre closures
  const cuadres = []
  for (let d = 0; d < 2; d++) {
    cuadres.push({
      id: newId(), supabase_id: newId(), business_id: bid,
      cajero_supabase_id: empleados[0].supabase_id,
      date: daysAgoDate(d + 1),
      fondo: 2000, efectivo_conteo: round2(8500 + Math.random() * 1500),
      efectivo_sistema: 8500, tarjeta: 12500, transferencia: 4500,
      cheque: 0, creditos: 1500, salidas: 200,
      total_vendido: 27200, total_cobrado: 27200, cierre_total: 27200,
      diferencia: round2(Math.random() * 50 - 25), comentario: 'Cierre del día.',
      denominaciones: { 2000: 2, 1000: 4, 500: 5, 100: 10, 50: 5, 25: 4, 10: 5 },
      closed_at: daysAgo(d + 1), updated_at: now(),
    })
  }
  await insertChunked('cuadre_caja', cuadres)

  const log = buildActivityLog(bid, empleados)
  await insertChunked('activity_log', log, 'supabase_id')

  summary.tickets += tickets.length + queueTickets.length
  summary.items   += items.length + queueItems.length
  summary.misc    += empleados.length + clients.length + services.length + ncf.length + settings.length + queueRows.length + cuadres.length + log.length
}

async function seedTienda(b, summary, vertical) {
  const bid = b.id
  const empleados = buildEmpleados(bid, vertical)
  const clients   = buildClients(bid)
  const services  = buildServicesGeneric(bid, vertical).slice(0, 3) // small services
  const inventory = buildInventoryTienda(bid, vertical)
  const ncf       = buildNcfSequences(bid)
  const settings  = buildAppSettings(bid, vertical)

  await insertChunked('empleados', empleados)
  await insertChunked('clients', clients)
  await insertChunked('services', services)
  await insertChunked('inventory_items', inventory)
  await insertChunked('ncf_sequences', ncf)
  await insertChunked('app_settings', settings)

  const { tickets, items } = buildTickets({ bid, count: 80, services, clients, empleados, vertical, includeInventory: true, inventory })
  await insertChunked('tickets', tickets)
  await insertChunked('ticket_items', items)

  // inventory_oversells for 2 tickets
  const oversells = []
  for (let i = 0; i < 2; i++) {
    const t = tickets[i]
    const it = inventory[i]
    oversells.push({
      id: newId(), supabase_id: newId(), business_id: bid,
      ticket_supabase_id: t.id, item_supabase_id: it.id, item_name: it.name,
      requested_qty: 5, actual_qty: 2, detected_at: t.created_at,
      resolution_type: i === 0 ? 'pending' : 'confirmed_negative_stock',
      resolved_at: i === 0 ? null : t.created_at,
      resolution_notes: i === 0 ? null : 'Stock confirmado en negativo, ajuste programado.',
      updated_at: now(),
    })
  }
  await insertChunked('inventory_oversells', oversells)

  const log = buildActivityLog(bid, empleados)
  await insertChunked('activity_log', log, 'supabase_id')

  summary.tickets += tickets.length
  summary.items   += items.length
  summary.misc    += empleados.length + clients.length + services.length + inventory.length + ncf.length + settings.length + oversells.length + log.length
}

async function seedSalon(b, summary) {
  const bid = b.id
  const empleados = buildEmpleados(bid, 'salon')
  const clients   = buildClients(bid)
  const services  = buildServicesSalon(bid)
  const ncf       = buildNcfSequences(bid)
  const settings  = buildAppSettings(bid, 'salon')

  await insertChunked('empleados', empleados)
  await insertChunked('clients', clients)
  await insertChunked('services', services)
  await insertChunked('ncf_sequences', ncf)
  await insertChunked('app_settings', settings)

  const stylists = empleados.filter(e => e.tipo === 'estilista')

  // Stylist schedules (4 stylists × 6 days/week)
  const schedules = []
  for (const s of stylists) {
    for (const dow of [1, 2, 3, 4, 5, 6]) {
      schedules.push({
        id: newId(), supabase_id: newId(), business_id: bid,
        empleado_supabase_id: s.supabase_id, day_of_week: dow,
        start_time: '09:00', end_time: '19:00', active: true,
        created_at: now(), updated_at: now(),
      })
    }
  }
  await insertChunked('stylist_schedules', schedules)

  // Appointments — 20
  const appointments = []
  const STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show']
  for (let i = 0; i < 20; i++) {
    const dayOff = rndInt(-3, 14)
    const status = i < 4 ? STATUSES[i] : (dayOff < 0 ? rndPick(['completed', 'no_show', 'cancelled']) : 'scheduled')
    const cli = rndPick(clients)
    const styl = rndPick(stylists)
    const sv = rndPick(services)
    appointments.push({
      id: newId(), supabase_id: null, business_id: bid,
      client_supabase_id: cli.id, empleado_supabase_id: styl.supabase_id,
      date: daysAgoDate(-dayOff),
      start_time: `${rndInt(9, 17)}:00`, end_time: `${rndInt(10, 18)}:00`,
      status, services: [{ supabase_id: sv.id, name: sv.name, price: sv.price }],
      notes: status === 'no_show' ? 'Cliente no asistió, fee aplicado.' : null,
      is_walk_in: i % 7 === 0,
      deposit_dop: status === 'scheduled' && Math.random() < 0.4 ? 200 : null,
      deposit_status: null, no_show_fee_charged: status === 'no_show',
      created_at: now(), updated_at: now(),
    })
  }
  appointments.forEach(a => { a.supabase_id = a.id })
  await insertChunked('appointments', appointments)

  // Memberships (3 templates) + 5 client_memberships
  const memTemplates = [
    { name: 'Plan Básico Mensual',   sessions: 4,  price: 2000, validity: 30 },
    { name: 'Plan Premium Mensual',  sessions: 8,  price: 3500, validity: 30 },
    { name: 'Plan Anual Ilimitado',  sessions: 999, price: 35000, validity: 365 },
  ]
  const mems = memTemplates.map(t => ({
    supabase_id: newId(), business_id: bid,
    plan_name: t.name, nombre: t.name, plan_price: t.price, price_dop: t.price,
    wash_quota_per_month: t.sessions, washes_used_this_period: 0,
    total_sessions: t.sessions, validity_days: t.validity,
    start_date: daysAgoDate(0), status: 'active', active_template: true,
    vertical: 'salon', created_at: now(), updated_at: now(),
  }))
  await insertChunked('memberships', mems)

  const cmems = []
  for (let i = 0; i < 5; i++) {
    const m = rndPick(mems)
    const used = rndInt(0, m.total_sessions)
    cmems.push({
      supabase_id: newId(), business_id: bid,
      client_supabase_id: rndPick(clients).id,
      membership_supabase_id: m.supabase_id,
      sessions_remaining: Math.max(0, m.total_sessions - used),
      purchased_at: daysAgo(rndInt(1, 25)),
      expires_at: daysFwd(rndInt(5, 60)),
      created_at: now(), updated_at: now(),
    })
  }
  await insertChunked('client_memberships', cmems)

  const { tickets, items } = buildTickets({ bid, count: 50, services, clients, empleados, vertical: 'salon' })
  await insertChunked('tickets', tickets)
  await insertChunked('ticket_items', items)

  const log = buildActivityLog(bid, empleados)
  await insertChunked('activity_log', log, 'supabase_id')

  summary.tickets += tickets.length
  summary.items   += items.length
  summary.misc    += empleados.length + clients.length + services.length + ncf.length + settings.length + schedules.length + appointments.length + mems.length + cmems.length + log.length
}

async function seedRestaurante(b, summary) {
  const bid = b.id
  const empleados = buildEmpleados(bid, 'restaurante')
  const clients   = buildClients(bid)
  const services  = buildServicesRestaurante(bid)
  const inventory = buildInventoryTienda(bid, 'tienda').slice(0, 20).map(it => ({ ...it, id: newId(), supabase_id: null }))
  inventory.forEach(it => { it.supabase_id = it.id })
  const ncf       = buildNcfSequences(bid)
  const settings  = buildAppSettings(bid, 'restaurante')

  await insertChunked('empleados', empleados)
  await insertChunked('clients', clients)
  await insertChunked('services', services)
  await insertChunked('inventory_items', inventory)
  await insertChunked('ncf_sequences', ncf)
  await insertChunked('app_settings', settings)

  // 12 mesas
  const meseros = empleados.filter(e => e.tipo === 'mesero')
  const mesas = []
  const MESA_NAMES = ['Mesa 1','Mesa 2','Mesa 3','Mesa 4','Mesa 5','Mesa 6','Mesa 7','Mesa 8','Terraza 1','Terraza 2','Barra 1','Barra 2']
  for (let i = 0; i < 12; i++) {
    const status = i < 6 ? 'libre' : i < 9 ? 'ocupada' : i < 11 ? 'reservada' : 'libre'
    mesas.push({
      supabase_id: newId(), business_id: bid,
      name: MESA_NAMES[i], zone: i < 8 ? 'Salón' : i < 10 ? 'Terraza' : 'Barra',
      capacity: i < 8 ? 4 : 2, status,
      waiter_empleado_supabase_id: status === 'ocupada' ? rndPick(meseros)?.supabase_id : null,
      guests_count: status === 'ocupada' ? rndInt(2, 4) : null,
      seated_at: status === 'ocupada' ? daysAgo(0) : null,
      sort_order: i, active: true, rev: 1,
      created_at: now(), updated_at: now(),
    })
  }
  await insertChunked('mesas', mesas)

  // 5 service_recipe_items (BOM)
  const recipes = []
  for (let i = 0; i < 5 && i < services.length && i < inventory.length; i++) {
    recipes.push({
      supabase_id: newId(), business_id: bid,
      service_supabase_id: services[i].id,
      inventory_item_supabase_id: inventory[i].id,
      qty_per_unit: round2(0.5 + Math.random() * 2),
      created_at: now(), updated_at: now(),
    })
  }
  await insertChunked('service_recipe_items', recipes)

  // 6 open mesa tickets
  const openTickets = []
  const openItems = []
  const ocupadas = mesas.filter(m => m.status === 'ocupada')
  for (let i = 0; i < Math.min(6, ocupadas.length); i++) {
    const tid = newId()
    const m = ocupadas[i]
    const sv = rndPick(services.filter(s => s.is_menu_item))
    const sv2 = rndPick(services.filter(s => s.is_menu_item))
    const subtotal = round2((sv.price + sv2.price) / 1.18)
    const itbis    = round2((sv.price + sv2.price) - subtotal)
    openTickets.push({
      id: tid, supabase_id: tid, business_id: bid,
      mesa_supabase_id: m.supabase_id, mode: 'mesa',
      services_json: [{ name: sv.name, price: sv.price }, { name: sv2.name, price: sv2.price }],
      subtotal, itbis, ley: round2((sv.price + sv2.price) * 0.10),
      servicio_pct: 10, servicio_amount: round2((sv.price + sv2.price) * 0.10),
      total: round2(sv.price + sv2.price + (sv.price + sv2.price) * 0.10),
      status: 'abierto', created_at: daysAgo(0), updated_at: now(),
      cajero_supabase_id: m.waiter_empleado_supabase_id,
      seller_empleado_supabase_id: m.waiter_empleado_supabase_id,
      currency: 'DOP', is_test: false, rev: 1, beverage_subtotal: 0,
    })
    openItems.push({
      id: newId(), supabase_id: newId(), business_id: bid, ticket_supabase_id: tid,
      name: sv.name, price: sv.price, itbis: round2(sv.price - sv.price / 1.18),
      is_wash: false, quantity: 1, service_supabase_id: sv.id, cost: sv.cost,
      course: sv.course, kds_fired_at: i < 3 ? daysAgo(0) : null,
      empleado_supabase_id: m.waiter_empleado_supabase_id,
      created_at: daysAgo(0), updated_at: now(),
    })
    openItems.push({
      id: newId(), supabase_id: newId(), business_id: bid, ticket_supabase_id: tid,
      name: sv2.name, price: sv2.price, itbis: round2(sv2.price - sv2.price / 1.18),
      is_wash: false, quantity: 1, service_supabase_id: sv2.id, cost: sv2.cost,
      course: sv2.course, kds_fired_at: null,
      empleado_supabase_id: m.waiter_empleado_supabase_id,
      created_at: daysAgo(0), updated_at: now(),
    })
  }
  await insertChunked('tickets', openTickets)
  await insertChunked('ticket_items', openItems)

  // 15 cobrado restaurant tickets
  const { tickets, items } = buildTickets({ bid, count: 40, services: services.filter(s => s.is_menu_item), clients, empleados, vertical: 'restaurante' })
  // Add servicio_pct to each
  tickets.forEach(t => {
    t.servicio_pct = 10
    t.servicio_amount = round2((t.subtotal + t.itbis) * 0.10)
    t.ley = t.servicio_amount
    t.total = round2(t.subtotal + t.itbis + t.servicio_amount)
    t.mode = 'directo'
  })
  await insertChunked('tickets', tickets)
  await insertChunked('ticket_items', items)

  // 4 reservations
  const reservations = []
  const RSTAT = ['confirmada', 'sentada', 'no_show', 'cancelada']
  for (let i = 0; i < 4; i++) {
    reservations.push({
      supabase_id: newId(), business_id: bid,
      mesa_supabase_id: mesas[i].supabase_id,
      fecha: daysAgoDate(-i), hora: `${18 + i}:30:00`, duration_min: 90,
      nombre: fullName(), telefono: phone(), guests: rndInt(2, 6),
      notas: i === 0 ? 'Aniversario, mesa cerca de ventana.' : null,
      status: RSTAT[i],
      whatsapp_sent_at: daysAgo(2),
      cancelled_reason: RSTAT[i] === 'cancelada' ? 'Cliente canceló por enfermedad.' : null,
      created_at: now(), updated_at: now(),
    })
  }
  await insertChunked('restaurant_reservations', reservations)

  const log = buildActivityLog(bid, empleados)
  await insertChunked('activity_log', log, 'supabase_id')

  summary.tickets += tickets.length + openTickets.length
  summary.items   += items.length + openItems.length
  summary.misc    += empleados.length + clients.length + services.length + inventory.length + ncf.length + settings.length + mesas.length + recipes.length + reservations.length + log.length
}

async function seedConcesionario(b, summary) {
  const bid = b.id
  const empleados = buildEmpleados(bid, 'concesionario')
  const clients   = buildClients(bid)
  const services  = buildServicesGeneric(bid, 'concesionario')
  const ncf       = buildNcfSequences(bid)
  const settings  = buildAppSettings(bid, 'concesionario')

  await insertChunked('empleados', empleados)
  await insertChunked('clients', clients)
  await insertChunked('services', services)
  await insertChunked('ncf_sequences', ncf)
  await insertChunked('app_settings', settings)

  const sellers = empleados.filter(e => e.tipo === 'vendedor')

  // 12 vehicle inventory
  const veh = []
  const MAKES = [['Toyota','Corolla'],['Toyota','RAV4'],['Honda','Civic'],['Honda','CR-V'],['Hyundai','Tucson'],['Kia','Sportage'],['Nissan','Sentra'],['Mitsubishi','Lancer'],['Mazda','CX-5'],['Ford','Escape'],['Chevrolet','Aveo'],['Volkswagen','Jetta']]
  const STATUSES = ['available','available','available','available','available','available','reserved','reserved','sold','sold','available','reserved']
  for (let i = 0; i < 12; i++) {
    const [mk, md] = MAKES[i]
    const newCar = i % 3 === 0
    veh.push({
      supabase_id: newId(), business_id: bid,
      stock_number: `STK-${String(i + 1).padStart(4, '0')}`,
      vin: `JT${String(rndInt(100000000000000, 999999999999999))}`.slice(0, 17),
      make: mk, model: md, year: 2020 + rndInt(0, 5), color: rndPick(['Blanco','Negro','Plata','Gris','Rojo','Azul']),
      mileage: newCar ? rndInt(0, 50) : rndInt(15000, 90000),
      condition: newCar ? 'new' : 'used',
      acquisition_cost: rndInt(800000, 1500000),
      listing_price: rndInt(950000, 1850000),
      status: STATUSES[i],
      listing_date: daysAgo(rndInt(5, 90)),
      sold_date: STATUSES[i] === 'sold' ? daysAgo(rndInt(1, 20)) : null,
      title_status: 'clean',
      photo_urls: [], photos_json: [], featured: i < 3,
      active: true, created_at: now(), updated_at: now(),
    })
  }
  await insertChunked('vehicle_inventory', veh)

  // 15 leads
  const leads = []
  const STAGES = ['nuevo','contactado','test_drive','propuesta','negociacion','ganado','perdido']
  for (let i = 0; i < 15; i++) {
    const stage = STAGES[i % STAGES.length]
    leads.push({
      supabase_id: newId(), business_id: bid,
      name: fullName(), phone: phone(), email: `lead${i}@correo.com`,
      client_supabase_id: i < 6 ? rndPick(clients).id : null,
      interested_vehicle_supabase_id: rndPick(veh).supabase_id,
      salesperson_supabase_id: rndPick(sellers).supabase_id,
      source: rndPick(['Instagram','Facebook','WhatsApp','Walk-in','Referido']),
      stage,
      lost_reason: stage === 'perdido' ? rndPick(['Precio','Financiamiento rechazado','Compró otra marca']) : null,
      budget: rndInt(700000, 1800000),
      notes: 'Lead seeded para demo.',
      next_followup_at: daysFwd(rndInt(1, 14)),
      last_contacted_at: daysAgo(rndInt(0, 7)),
      active: true, created_at: now(), updated_at: now(),
    })
  }
  await insertChunked('leads', leads)

  // 8 test drives
  const tds = []
  for (let i = 0; i < 8; i++) {
    const td_status = i < 5 ? 'completed' : i < 7 ? 'scheduled' : 'cancelled'
    tds.push({
      supabase_id: newId(), business_id: bid,
      client_supabase_id: rndPick(clients).id,
      vehicle_inventory_supabase_id: rndPick(veh).supabase_id,
      staff_supabase_id: rndPick(sellers).supabase_id,
      scheduled_at: daysAgo(rndInt(-7, 14)),
      completed_at: td_status === 'completed' ? daysAgo(rndInt(0, 14)) : null,
      license_number: cedula(),
      outcome: td_status === 'completed' ? rndPick(['sold','lost','follow_up','pending']) : null,
      outcome_notes: 'Test drive seeded.',
      active: td_status !== 'cancelled', created_at: now(), updated_at: now(),
    })
  }
  await insertChunked('test_drives', tds)

  // 5 sales deals
  const deals = []
  const dealVehs = veh.filter(v => v.status === 'sold')
  for (let i = 0; i < 5; i++) {
    const isClosed = i < 3
    const v = dealVehs[i % dealVehs.length] || veh[i]
    const sale = v.listing_price
    const down = round2(sale * 0.20)
    deals.push({
      supabase_id: newId(), business_id: bid,
      client_supabase_id: rndPick(clients).id,
      vehicle_inventory_supabase_id: v.supabase_id,
      salesperson_supabase_id: rndPick(sellers).supabase_id,
      sale_price: sale, down_payment: down,
      financed_amount: round2(sale - down),
      term_months: 60, apr: 12.5,
      monthly_payment: round2((sale - down) * 0.022),
      status: isClosed ? 'cerrada' : 'borrador',
      closed_at: isClosed ? daysAgo(rndInt(1, 15)) : null,
      commission_pct: 3, commission_amount: round2(sale * 0.03),
      commission_paid: false,
      dgii_e31_required: sale >= 250000,
      uaf_threshold_exceeded: sale >= 500000,
      uaf_acknowledged_by: sale >= 500000 ? empleados[0].nombre : null,
      uaf_acknowledged_at: sale >= 500000 ? daysAgo(2) : null,
      active: true, created_at: now(), updated_at: now(),
    })
  }
  await insertChunked('sales_deals', deals)

  // 4 vehicle reservations
  const reservations = []
  const RST = ['active','active','expired','converted']
  for (let i = 0; i < 4; i++) {
    reservations.push({
      supabase_id: newId(), business_id: bid,
      vehicle_inventory_supabase_id: rndPick(veh).supabase_id,
      client_supabase_id: rndPick(clients).id,
      salesperson_supabase_id: rndPick(sellers).supabase_id,
      deposit_amount: 50000, deposit_method: 'transferencia',
      expires_at: RST[i] === 'expired' ? daysAgo(2) : daysFwd(7),
      released_at: RST[i] === 'converted' ? daysAgo(1) : null,
      released_reason: RST[i] === 'converted' ? 'Convertida a venta.' : null,
      converted_deal_supabase_id: RST[i] === 'converted' ? deals[0].supabase_id : null,
      status: RST[i],
      active: RST[i] === 'active', created_at: now(), updated_at: now(),
    })
  }
  await insertChunked('vehicle_reservations', reservations)

  // 3 vehicle warranties (with claims jsonb embedded)
  const warranties = []
  for (let i = 0; i < 3; i++) {
    warranties.push({
      supabase_id: newId(), business_id: bid,
      sales_deal_supabase_id: deals[i].supabase_id,
      vehicle_inventory_supabase_id: deals[i].vehicle_inventory_supabase_id,
      client_supabase_id: deals[i].client_supabase_id,
      kind: rndPick(['motor','transmision','electrico','general','extendida']),
      starts_at: daysAgo(rndInt(1, 30)), expires_at: daysFwd(rndInt(180, 730)),
      terms: 'Garantía limitada de motor y transmisión por 2 años o 40,000 km, lo que ocurra primero.',
      claims: [
        { id: newId(), date: daysAgoDate(rndInt(1, 30)), description: 'Falla sensor MAP', status: 'aprobado', amount: 8500 }
      ],
      status: 'active', active: true,
      created_at: now(), updated_at: now(),
    })
  }
  await insertChunked('vehicle_warranties', warranties)

  // 3 bank preapprovals (1 expired)
  const preapps = []
  const BANKS = ['Banco Popular','Banreservas','BHD León']
  for (let i = 0; i < 3; i++) {
    preapps.push({
      supabase_id: newId(), business_id: bid,
      client_supabase_id: rndPick(clients).id,
      lead_supabase_id: rndPick(leads).supabase_id,
      vehicle_inventory_supabase_id: rndPick(veh).supabase_id,
      salesperson_supabase_id: rndPick(sellers).supabase_id,
      bank: BANKS[i], bank_contact: 'Oficial Plaza',
      requested_amount: 850000, term_months: 60, rate_offered: 13.5,
      monthly_quota_offered: round2(850000 * 0.025),
      status: i === 2 ? 'expirada' : 'pre_aprobada',
      expires_at: i === 2 ? daysAgo(5) : daysFwd(30),
      decision_at: daysAgo(rndInt(1, 10)),
      notes: 'Pre-aprobación bancaria.',
      active: i !== 2, created_at: now(), updated_at: now(),
    })
  }
  await insertChunked('bank_preapprovals', preapps)

  // 5 cobrado E31 tickets for closed deals
  const e31Tickets = []
  const e31Items = []
  for (let i = 0; i < 5; i++) {
    const d = deals[i] || deals[0]
    const tid = newId()
    const subtotal = round2(d.sale_price / 1.18)
    const itbis = round2(d.sale_price - subtotal)
    e31Tickets.push({
      id: tid, supabase_id: tid, business_id: bid,
      doc_number: `D-CONC-${1000 + i}`,
      client_supabase_id: d.client_supabase_id,
      services_json: [{ name: 'Venta de Vehículo', price: d.sale_price }],
      subtotal, itbis, ley: 0, total: d.sale_price,
      ncf: `E31${String(1000 + i).padStart(10, '0')}`, ncf_type: 'E31', comprobante_type: 'E31',
      payment_method: 'transferencia', tipo_venta: 'credito_fiscal',
      cajero_supabase_id: empleados[0].supabase_id, cajero_name: empleados[0].nombre,
      seller_supabase_id: d.salesperson_supabase_id,
      seller_empleado_supabase_id: d.salesperson_supabase_id,
      status: 'cobrado', paid_at: daysAgo(rndInt(1, 15)),
      created_at: daysAgo(rndInt(1, 15)), updated_at: now(),
      currency: 'DOP', is_test: false, rev: 1, beverage_subtotal: 0,
    })
    e31Items.push({
      id: newId(), supabase_id: newId(), business_id: bid, ticket_supabase_id: tid,
      name: 'Venta de Vehículo', price: d.sale_price, itbis, is_wash: false,
      quantity: 1, cost: 0, created_at: now(), updated_at: now(),
    })
  }
  await insertChunked('tickets', e31Tickets)
  await insertChunked('ticket_items', e31Items)

  // Link tickets back to deals
  for (let i = 0; i < Math.min(3, e31Tickets.length); i++) {
    deals[i].ticket_supabase_id = e31Tickets[i].id
  }
  await insertChunked('sales_deals', deals)

  const log = buildActivityLog(bid, empleados)
  await insertChunked('activity_log', log, 'supabase_id')

  summary.tickets += e31Tickets.length
  summary.items   += e31Items.length
  summary.misc    += empleados.length + clients.length + services.length + ncf.length + settings.length + veh.length + leads.length + tds.length + deals.length + reservations.length + warranties.length + preapps.length + log.length
}

async function seedMecanica(b, summary) {
  const bid = b.id
  const empleados = buildEmpleados(bid, 'mecanica')
  const clients   = buildClients(bid)
  const services  = buildServicesMecanica(bid)
  const inventory = buildInventoryMecanica(bid)
  const ncf       = buildNcfSequences(bid)
  const settings  = buildAppSettings(bid, 'mecanica')

  await insertChunked('empleados', empleados)
  await insertChunked('clients', clients)
  await insertChunked('services', services)
  await insertChunked('inventory_items', inventory)
  await insertChunked('ncf_sequences', ncf)
  await insertChunked('app_settings', settings)

  // 4 vehicles per first 4 clients
  const vehs = []
  for (let i = 0; i < 4 && i < clients.length; i++) {
    vehs.push({
      id: newId(), supabase_id: null, business_id: bid,
      client_supabase_id: clients[i].id,
      vin: `JT${String(rndInt(100000000000000, 999999999999999))}`.slice(0, 17),
      plate: `${rndPick(['A','B','C','G'])}${rndInt(100000, 999999)}`,
      make: rndPick(['Toyota','Honda','Hyundai','Kia']),
      model: rndPick(['Corolla','Civic','Accent','Sportage']),
      year: rndInt(2015, 2024), color: rndPick(['Blanco','Negro','Gris','Rojo']),
      odometer_km: rndInt(20000, 120000),
      active: true, created_at: now(), updated_at: now(),
    })
  }
  vehs.forEach(v => { v.supabase_id = v.id })
  await insertChunked('vehicles', vehs)

  // 10 work orders
  const STATS = ['recibido','diagnosticado','aprobado','en_progreso','listo','facturado','recibido','diagnosticado','aprobado','listo']
  const wos = []
  const woItems = []
  const wo3Tix = []
  const wo3Items = []
  const techs = empleados.filter(e => e.tipo === 'tecnico')
  for (let i = 0; i < 10; i++) {
    const status = STATS[i]
    const v = rndPick(vehs)
    const cli = clients.find(c => c.id === v.client_supabase_id)
    const labor = round2(rndInt(800, 8000))
    const partsTotal = round2(rndInt(500, 15000))
    const itbis = round2((labor + partsTotal) * 0.18)
    const total = round2(labor + partsTotal + itbis)
    const woId = newId()
    wos.push({
      id: woId, supabase_id: woId, business_id: bid,
      vehicle_supabase_id: v.id, client_supabase_id: cli.id,
      technician_empleado_supabase_id: rndPick(techs).supabase_id,
      status, labor_total: labor, parts_total: partsTotal, itbis, total,
      estimated_total: total, actual_total: total,
      promised_date: daysFwdDate(rndInt(1, 7)),
      completed_date: status === 'listo' || status === 'facturado' ? daysAgo(rndInt(0, 5)) : null,
      ready_at: status === 'listo' || status === 'facturado' ? daysAgo(rndInt(0, 5)) : null,
      facturado_at: status === 'facturado' ? daysAgo(rndInt(0, 3)) : null,
      odometer_in_km: v.odometer_km, odometer_out_km: v.odometer_km + rndInt(1, 50),
      notes: 'Orden de trabajo seeded.',
      created_at: now(), updated_at: now(),
    })
    // 3-5 items each
    const numItems = rndInt(3, 5)
    for (let j = 0; j < numItems; j++) {
      const usePart = j < 2 && Math.random() < 0.6
      if (usePart && inventory.length) {
        const inv = rndPick(inventory)
        const qty = rndInt(1, 3)
        woItems.push({
          id: newId(), supabase_id: newId(), business_id: bid,
          work_order_supabase_id: woId, type: 'part', name: inv.name,
          quantity: qty, unit_price: inv.price, total: round2(inv.price * qty),
          warranty_months: 6, inventory_item_supabase_id: inv.id,
          created_at: now(), updated_at: now(),
        })
      } else {
        const sv = rndPick(services)
        woItems.push({
          id: newId(), supabase_id: newId(), business_id: bid,
          work_order_supabase_id: woId, type: 'service', name: sv.name,
          quantity: 1, unit_price: sv.price, total: sv.price,
          warranty_months: 3,
          created_at: now(), updated_at: now(),
        })
      }
    }
    // facturado WOs link to a ticket
    if (status === 'facturado') {
      const tid = newId()
      wo3Tix.push({
        id: tid, supabase_id: tid, business_id: bid,
        doc_number: `WO-${1000 + i}`,
        client_supabase_id: cli.id,
        services_json: [{ name: 'Servicio Mecánico', price: total }],
        subtotal: round2(labor + partsTotal), itbis, ley: 0, total,
        ncf: 'B01' + String(2000 + i).padStart(8, '0'), ncf_type: 'B01', comprobante_type: 'B01',
        payment_method: rndPick(PAY_METHODS), tipo_venta: 'consumo',
        cajero_supabase_id: empleados[0].supabase_id, cajero_name: empleados[0].nombre,
        status: 'cobrado', paid_at: daysAgo(rndInt(0, 3)),
        created_at: daysAgo(rndInt(0, 3)), updated_at: now(),
        currency: 'DOP', is_test: false, rev: 1, beverage_subtotal: 0,
      })
      wo3Items.push({
        id: newId(), supabase_id: newId(), business_id: bid, ticket_supabase_id: tid,
        name: 'Servicio Mecánico WO', price: total, itbis, is_wash: false,
        quantity: 1, cost: 0, created_at: now(), updated_at: now(),
      })
      wos[wos.length - 1].ticket_supabase_id = tid
    }
  }
  await insertChunked('work_orders', wos)
  await insertChunked('work_order_items', woItems)
  if (wo3Tix.length) {
    await insertChunked('tickets', wo3Tix)
    await insertChunked('ticket_items', wo3Items)
  }

  const log = buildActivityLog(bid, empleados)
  await insertChunked('activity_log', log, 'supabase_id')

  summary.tickets += wo3Tix.length
  summary.items   += wo3Items.length
  summary.misc    += empleados.length + clients.length + services.length + inventory.length + ncf.length + settings.length + vehs.length + wos.length + woItems.length + log.length
}

async function seedServiciosProfesionales(b, summary) {
  const bid = b.id
  const empleados = buildEmpleados(bid, 'servicios')
  const clients   = buildClients(bid)
  const services  = buildServicesGeneric(bid, 'servicios')
  const ncf       = buildNcfSequences(bid)
  const settings  = buildAppSettings(bid, 'servicios')

  await insertChunked('empleados', empleados)
  await insertChunked('clients', clients)
  await insertChunked('services', services)
  await insertChunked('ncf_sequences', ncf)
  await insertChunked('app_settings', settings)

  const { tickets, items } = buildTickets({ bid, count: 40, services, clients, empleados, vertical: 'servicios' })
  await insertChunked('tickets', tickets)
  await insertChunked('ticket_items', items)

  const log = buildActivityLog(bid, empleados)
  await insertChunked('activity_log', log, 'supabase_id')

  summary.tickets += tickets.length
  summary.items   += items.length
  summary.misc    += empleados.length + clients.length + services.length + ncf.length + settings.length + log.length
}

// ─────────────────────── WIPE ───────────────────────
const WIPE_TABLES = [
  // children first
  'inventory_oversells', 'ticket_items', 'work_order_items', 'service_recipe_items',
  'queue', 'client_memberships', 'memberships', 'appointments', 'stylist_schedules',
  'restaurant_reservations', 'mesas',
  'vehicle_warranties', 'bank_preapprovals', 'vehicle_reservations', 'sales_deals',
  'test_drives', 'leads', 'vehicle_inventory',
  'work_orders', 'vehicles',
  'cuadre_caja', 'caja_chica', 'credit_payments', 'tickets',
  'activity_log', 'app_settings', 'ncf_sequences',
  'inventory_items', 'services', 'empleados', 'clients',
]

async function wipeDemos(demoIds) {
  console.log('Wiping demo data ...')
  const idList = demoIds.map(id => `'${id}'`).join(',')
  for (const t of WIPE_TABLES) {
    try {
      if (t === 'activity_log') {
        // append-only trigger — temporarily disable for demo cleanup
        await sql(`ALTER TABLE public.activity_log DISABLE TRIGGER trg_activity_log_immutable_del; ALTER TABLE public.activity_log DISABLE TRIGGER trg_activity_log_immutable_upd; DELETE FROM public.activity_log WHERE business_id IN (${idList}); ALTER TABLE public.activity_log ENABLE TRIGGER trg_activity_log_immutable_del; ALTER TABLE public.activity_log ENABLE TRIGGER trg_activity_log_immutable_upd;`)
      } else {
        await sql(`DELETE FROM public.${t} WHERE business_id IN (${idList})`)
      }
    } catch (e) {
      // Try alternate trigger name for activity_log
      if (t === 'activity_log') {
        try {
          await sql(`ALTER TABLE public.activity_log DISABLE TRIGGER ALL; DELETE FROM public.activity_log WHERE business_id IN (${idList}); ALTER TABLE public.activity_log ENABLE TRIGGER ALL;`)
          continue
        } catch (e2) {
          console.warn(`  ${t}: ${e2.message.slice(0, 200)}`)
          continue
        }
      }
      console.warn(`  ${t}: ${e.message.slice(0, 200)}`)
    }
  }
}

// ─────────────────────── MAIN ───────────────────────
async function main() {
  const t0 = Date.now()
  console.log('Fetching demo businesses ...')
  const bizRes = await sql(`SELECT id, name, settings->>'business_type' AS bt FROM businesses WHERE name LIKE 'Demo %' ORDER BY name`)
  if (!bizRes.length) throw new Error('No demo businesses found')

  const REAL_PROTECTED = ['1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79', '4f789f41-76d2-4402-838f-5fe20a91641f']
  for (const b of bizRes) {
    if (REAL_PROTECTED.includes(b.id)) {
      throw new Error(`Refusing to seed REAL business ${b.name} (${b.id})`)
    }
    if (!b.name.startsWith('Demo ')) {
      throw new Error(`Refusing to seed non-Demo business ${b.name}`)
    }
  }
  const demoIds = bizRes.map(b => b.id)
  console.log(`Found ${bizRes.length} demos: ${bizRes.map(b => b.name).join(', ')}`)

  await wipeDemos(demoIds)

  // Update businesses to ensure go_live_date set
  await sql(`
    UPDATE public.businesses
    SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('go_live_date', '2026-01-01')
    WHERE id IN (${demoIds.map(id => `'${id}'`).join(',')})
  `)

  const summary = { tickets: 0, items: 0, misc: 0, perBiz: {} }

  for (const b of bizRes) {
    const tBiz = Date.now()
    const before = { tickets: summary.tickets, items: summary.items, misc: summary.misc }
    console.log(`\n=== ${b.name} (${b.bt}) ===`)
    try {
      switch (b.bt) {
        case 'carwash':       await seedCarwash(b, summary); break
        case 'tienda':        await seedTienda(b, summary, 'tienda'); break
        case 'salon':         await seedSalon(b, summary); break
        case 'restaurante':   await seedRestaurante(b, summary); break
        case 'concesionario': await seedConcesionario(b, summary); break
        case 'mecanica':      await seedMecanica(b, summary); break
        case 'servicios':     await seedServiciosProfesionales(b, summary); break
        case 'prestamos':     await seedServiciosProfesionales(b, summary); break
        default:
          console.warn(`  Unknown business_type ${b.bt}, treating as servicios`)
          await seedServiciosProfesionales(b, summary)
      }
      const elapsed = ((Date.now() - tBiz) / 1000).toFixed(1)
      const dT = summary.tickets - before.tickets
      const dI = summary.items - before.items
      const dM = summary.misc - before.misc
      summary.perBiz[b.name] = { tickets: dT, items: dI, misc: dM, elapsed }
      console.log(`  Done ${b.name}: ${dT} tickets, ${dI} items, ${dM} misc rows in ${elapsed}s`)
    } catch (e) {
      console.error(`  FAILED ${b.name}:`, e.message)
      throw e
    }
  }

  const total = summary.tickets + summary.items + summary.misc
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`\n────────────────────── SUMMARY ──────────────────────`)
  for (const [name, s] of Object.entries(summary.perBiz)) {
    console.log(`  ${name.padEnd(36)} ${String(s.tickets).padStart(4)} tix  ${String(s.items).padStart(5)} items  ${String(s.misc).padStart(5)} misc  ${s.elapsed}s`)
  }
  console.log(`\n${bizRes.length} businesses seeded, ${total} rows total, runs in ${elapsed} seconds.`)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
