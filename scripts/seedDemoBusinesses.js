/**
 * seedDemoBusinesses.js — Spawn 9 fully-populated demo businesses on Supabase,
 * one per business_type, ready for live client walkthroughs.
 *
 * Usage:  node scripts/seedDemoBusinesses.js
 *
 * Idempotent — safe to re-run. Existing businesses (matched by name + type)
 * are skipped, existing auth users are reused.
 *
 * Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from ../.env
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import crypto from 'crypto'

// ── Load .env ───────────────────────────────────────────────────────────────
const envPath = resolve(import.meta.dirname, '..', '.env')
try {
  const envContent = readFileSync(envPath, 'utf8')
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
} catch {}

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}
const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

// ── Helpers ────────────────────────────────────────────────────────────────
const uuid = () => crypto.randomUUID()
const pick = (a) => a[Math.floor(Math.random() * a.length)]
const rand = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo
const money = (n) => Math.round(n * 100) / 100
const daysAgo = (d, hourJitter = true) => {
  const dt = new Date()
  dt.setDate(dt.getDate() - d)
  if (hourJitter) {
    dt.setHours(rand(8, 20), rand(0, 59), rand(0, 59), 0)
  }
  return dt.toISOString()
}
const phone = () => `809${rand(2, 9)}${String(rand(0, 9999999)).padStart(7, '0')}`
const ncfStr = (prefix, n) => `${prefix}${String(n).padStart(8, '0')}`

// Bcrypt of PIN '1234' (same hash reused across every demo row — fine because
// demo business_ids don't overlap). Matches desktop's bcrypt convention so
// every freshly-seeded demo logs in without the sha256→bcrypt auto-upgrade
// dance. Cost 10 matches electron/database.js BCRYPT_COST.
const bcryptjs = require('bcryptjs')
const PIN_SALT = crypto.randomBytes(24).toString('base64url').slice(0, 32)
const PIN_HASH = bcryptjs.hashSync('1234' + PIN_SALT, 10)
const PIN_ALGO = 'bcrypt'

const PASSWORD = 'Demo2026!'
const RNC = '133410321'
const CITY = 'Santo Domingo'
const PLAN_PRO_MAX_ID = '5ff22750-175f-4032-97c0-8e97223e423f' // resolved at runtime too

// ── Vertical catalog ───────────────────────────────────────────────────────
const VERTICALS = [
  {
    type: 'carwash',
    bizName: 'Demo Car Wash',
    email: 'admin@carwash.demo.terminalxpos.com',
    employees: [
      { nombre: 'Roberto Lavador', tipo: 'lavador', role: 'none', salary: 18000, comision_pct: 20 },
      { nombre: 'Julio Lavador', tipo: 'lavador', role: 'none', salary: 18000, comision_pct: 20 },
      { nombre: 'Manuel Lavador', tipo: 'lavador', role: 'none', salary: 18000, comision_pct: 15 },
      { nombre: 'Carmen Cajera', tipo: 'cajero', role: 'cashier', salary: 22000, comision_pct: 0 },
    ],
    services: [
      { name: 'Lavado Express', price: 200, is_wash: 1 },
      { name: 'Lavado Completo', price: 350, is_wash: 1 },
      { name: 'Encerado', price: 500, is_wash: 1 },
      { name: 'Lavado de Chasis', price: 500, is_wash: 1 },
      { name: 'Detallado Premium', price: 1500, is_wash: 1 },
      { name: 'Aspirado', price: 150, is_wash: 1 },
      { name: 'Pulido Completo', price: 2500, is_wash: 1 },
    ],
    plates: true, queueRows: 3,
  },
  {
    type: 'retail',
    bizName: 'Demo Tienda',
    email: 'admin@retail.demo.terminalxpos.com',
    employees: [
      { nombre: 'Daniela Vendedora', tipo: 'vendedor', role: 'cashier', salary: 20000, comision_pct: 5 },
      { nombre: 'Sofia Vendedora', tipo: 'vendedor', role: 'cashier', salary: 20000, comision_pct: 5 },
      { nombre: 'Carlos Almacen', tipo: 'vendedor', role: 'none', salary: 16000, comision_pct: 0 },
    ],
    services: [
      { name: 'Coca Cola 600ml', price: 80, is_wash: 0, sku: 'CC-600' },
      { name: 'Agua 500ml', price: 40, is_wash: 0, sku: 'AG-500' },
      { name: 'Snickers', price: 60, is_wash: 0, sku: 'SN-001' },
      { name: 'Cigarrillos Marlboro', price: 320, is_wash: 0, sku: 'CG-MAR' },
      { name: 'Cerveza Presidente', price: 120, is_wash: 0, sku: 'CV-PRE' },
      { name: 'Pan Sobao', price: 30, is_wash: 0, sku: 'PN-SOB' },
      { name: 'Doritos', price: 90, is_wash: 0, sku: 'SN-DOR' },
    ],
    plates: false, queueRows: 0, retail: true,
  },
  {
    type: 'restaurant',
    bizName: 'Demo Restaurante',
    email: 'admin@restaurant.demo.terminalxpos.com',
    employees: [
      { nombre: 'Pedro Mesero', tipo: 'vendedor', role: 'cashier', salary: 18000, comision_pct: 8 },
      { nombre: 'Maria Mesera', tipo: 'vendedor', role: 'cashier', salary: 18000, comision_pct: 8 },
      { nombre: 'Jose Cocinero', tipo: 'lavador', role: 'none', salary: 24000, comision_pct: 0 },
      { nombre: 'Ana Cajera', tipo: 'cajero', role: 'cashier', salary: 22000, comision_pct: 0 },
    ],
    services: [
      { name: 'Pollo Frito', price: 450, is_wash: 0, is_menu_item: true, course: 'principal', station: 'cocina' },
      { name: 'Hamburguesa Clasica', price: 350, is_wash: 0, is_menu_item: true, course: 'principal', station: 'cocina' },
      { name: 'Pizza Mediana', price: 600, is_wash: 0, is_menu_item: true, course: 'principal', station: 'cocina' },
      { name: 'Refresco', price: 100, is_wash: 0, is_menu_item: true, course: 'bebida', station: 'bar' },
      { name: 'Cerveza Presidente', price: 120, is_wash: 0, is_menu_item: true, course: 'bebida', station: 'bar' },
      { name: 'Mofongo', price: 400, is_wash: 0, is_menu_item: true, course: 'principal', station: 'cocina' },
      { name: 'Sancocho', price: 550, is_wash: 0, is_menu_item: true, course: 'principal', station: 'cocina' },
    ],
    plates: false, queueRows: 0,
  },
  {
    type: 'salon',
    bizName: 'Demo Salon de Belleza',
    email: 'admin@salon.demo.terminalxpos.com',
    employees: [
      { nombre: 'Lucia Estilista', tipo: 'vendedor', role: 'cashier', salary: 20000, comision_pct: 30 },
      { nombre: 'Elena Estilista', tipo: 'vendedor', role: 'cashier', salary: 20000, comision_pct: 30 },
      { nombre: 'Rosa Manicurista', tipo: 'vendedor', role: 'none', salary: 16000, comision_pct: 25 },
    ],
    services: [
      { name: 'Corte Caballero', price: 400, is_wash: 1 },
      { name: 'Tinte Completo', price: 1800, is_wash: 1 },
      { name: 'Manicure', price: 500, is_wash: 1 },
      { name: 'Pedicure', price: 600, is_wash: 1 },
      { name: 'Lavado y Secado', price: 350, is_wash: 1 },
      { name: 'Tratamiento Capilar', price: 1200, is_wash: 1 },
    ],
    plates: false, queueRows: 0,
  },
  {
    type: 'hybrid',
    bizName: 'Demo Lavadero + Tienda',
    email: 'admin@hybrid.demo.terminalxpos.com',
    employees: [
      { nombre: 'Felix Lavador', tipo: 'lavador', role: 'none', salary: 18000, comision_pct: 20 },
      { nombre: 'Andres Lavador', tipo: 'lavador', role: 'none', salary: 18000, comision_pct: 20 },
      { nombre: 'Isabella Vendedora', tipo: 'vendedor', role: 'cashier', salary: 20000, comision_pct: 5 },
      { nombre: 'Carmen Cajera', tipo: 'cajero', role: 'cashier', salary: 22000, comision_pct: 0 },
    ],
    services: [
      { name: 'Lavado Express', price: 200, is_wash: 1 },
      { name: 'Lavado Completo', price: 350, is_wash: 1 },
      { name: 'Encerado', price: 500, is_wash: 1 },
      { name: 'Detallado Premium', price: 1500, is_wash: 1 },
      { name: 'Coca Cola 600ml', price: 80, is_wash: 0, sku: 'CC-600' },
      { name: 'Agua 500ml', price: 40, is_wash: 0, sku: 'AG-500' },
      { name: 'Cerveza Presidente', price: 120, is_wash: 0, sku: 'CV-PRE' },
      { name: 'Snickers', price: 60, is_wash: 0, sku: 'SN-001' },
    ],
    plates: true, queueRows: 2, retail: true,
  },
  {
    type: 'mechanic',
    bizName: 'Demo Taller Mecanico',
    email: 'admin@mechanic.demo.terminalxpos.com',
    employees: [
      { nombre: 'Miguel Mecanico', tipo: 'lavador', role: 'none', salary: 28000, comision_pct: 15 },
      { nombre: 'Francisco Mecanico', tipo: 'lavador', role: 'none', salary: 25000, comision_pct: 15 },
      { nombre: 'Pedro Ayudante', tipo: 'lavador', role: 'none', salary: 16000, comision_pct: 10 },
      { nombre: 'Carmen Cajera', tipo: 'cajero', role: 'cashier', salary: 22000, comision_pct: 0 },
    ],
    services: [
      { name: 'Cambio de Aceite', price: 1500, is_wash: 1 },
      { name: 'Alineacion', price: 2000, is_wash: 1 },
      { name: 'Frenos Delanteros', price: 3500, is_wash: 1 },
      { name: 'Diagnostico Electrico', price: 1200, is_wash: 1 },
      { name: 'Cambio de Bateria', price: 8500, is_wash: 1 },
      { name: 'Cambio de Filtros', price: 800, is_wash: 1 },
    ],
    plates: true, queueRows: 3,
  },
  {
    type: 'service',
    bizName: 'Demo Servicios Profesionales',
    email: 'admin@service.demo.terminalxpos.com',
    employees: [
      { nombre: 'Carlos Consultor', tipo: 'vendedor', role: 'cashier', salary: 35000, comision_pct: 20 },
      { nombre: 'Lucia Tecnica', tipo: 'vendedor', role: 'cashier', salary: 28000, comision_pct: 15 },
      { nombre: 'Ana Soporte', tipo: 'vendedor', role: 'none', salary: 22000, comision_pct: 10 },
    ],
    services: [
      { name: 'Consultoria por Hora', price: 2500, is_wash: 1 },
      { name: 'Instalacion Completa', price: 5000, is_wash: 1 },
      { name: 'Mantenimiento Mensual', price: 3500, is_wash: 1 },
      { name: 'Soporte Remoto', price: 1500, is_wash: 1 },
      { name: 'Capacitacion', price: 4500, is_wash: 1 },
    ],
    plates: false, queueRows: 0,
  },
  {
    type: 'loans',
    bizName: 'Demo Prestamos',
    email: 'admin@prestamos.demo.terminalxpos.com',
    employees: [
      { nombre: 'Miguel Oficial', tipo: 'vendedor', role: 'cashier', salary: 30000, comision_pct: 5 },
      { nombre: 'Carmen Cajera', tipo: 'cajero', role: 'cashier', salary: 22000, comision_pct: 0 },
      { nombre: 'Jose Cobrador', tipo: 'vendedor', role: 'none', salary: 18000, comision_pct: 8 },
    ],
    services: [
      { name: 'Comision de Apertura', price: 2500, is_wash: 1 },
      { name: 'Cuota Mensual', price: 5000, is_wash: 1 },
      { name: 'Cargo por Mora', price: 750, is_wash: 1 },
      { name: 'Renovacion', price: 1500, is_wash: 1 },
      { name: 'Estudio de Credito', price: 1000, is_wash: 1 },
    ],
    plates: false, queueRows: 0,
  },
  {
    type: 'dealership',
    bizName: 'Demo Concesionario',
    email: 'admin@dealership.demo.terminalxpos.com',
    employees: [
      { nombre: 'Roberto Vendedor', tipo: 'vendedor', role: 'cashier', salary: 35000, comision_pct: 3 },
      { nombre: 'Daniela Vendedora', tipo: 'vendedor', role: 'cashier', salary: 35000, comision_pct: 3 },
      { nombre: 'Felix Mecanico', tipo: 'lavador', role: 'none', salary: 25000, comision_pct: 10 },
      { nombre: 'Carmen Cajera', tipo: 'cajero', role: 'cashier', salary: 22000, comision_pct: 0 },
    ],
    services: [
      { name: 'Toyota Corolla 2026', price: 1650000, is_wash: 1 },
      { name: 'Hyundai Tucson 2026', price: 1850000, is_wash: 1 },
      { name: 'Servicio Post-Venta', price: 3500, is_wash: 1 },
      { name: 'Inspeccion Tecnica', price: 2500, is_wash: 1 },
      { name: 'Cambio de Aceite', price: 1800, is_wash: 1 },
      { name: 'Garantia Extendida', price: 45000, is_wash: 1 },
    ],
    plates: true, queueRows: 0,
  },
]

const FIRST_NAMES = ['Juan', 'Maria', 'Pedro', 'Ana', 'Carlos', 'Lucia', 'Miguel', 'Carmen', 'Jose', 'Rosa', 'Francisco', 'Elena', 'Luis', 'Sofia', 'Manuel']
const LAST_NAMES = ['Rodriguez', 'Santos', 'Fernandez', 'Martinez', 'Perez', 'Garcia', 'Hernandez', 'Diaz', 'Ramirez', 'Gonzalez', 'Lopez', 'Morales', 'Reyes', 'Cruz']
const COMPANY_SUFFIXES = ['Auto Parts El Caribe SRL', 'Inversiones San Juan SA', 'Transport Express RD', 'Comercial Dominicana SRL']
const PLATES = ['A123456','B789012','C345678','D901234','E567890','G112233','H445566','K778899','L001122','M334455']
const COLORS = ['Blanco','Negro','Gris','Rojo','Azul','Plateado']
const MAKES  = ['Toyota Corolla','Honda Civic','Hyundai Tucson','Kia Sportage','Nissan Sentra','Toyota Hilux']

// ── Per-vertical seed ──────────────────────────────────────────────────────
async function seedVertical(v, planId) {
  const result = { ok: false, created: false, businessId: null, error: null }

  // 1. Skip if business already exists with same name + type
  const { data: existingBiz } = await sb
    .from('businesses')
    .select('id, settings')
    .eq('name', v.bizName)
    .limit(20)
  // Normalize legacy Spanish keys when comparing against v.type so a seeder
  // re-run after the 2026-05-17 type-key cleanup doesn't double-insert demos
  // that still carry old values like 'tienda'/'mecanica'/'concesionario'.
  const LEGACY = { tienda:'retail', mecanica:'mechanic', mecanico:'mechanic', servicios:'service', concesionario:'dealership', barberia:'salon', hibrido:'hybrid', restaurante:'restaurant', prestamo:'loans', prestamos:'loans', contabilidad:'accounting', carniceria:'meat_market' }
  const norm = t => LEGACY[String(t || '').toLowerCase().trim()] || String(t || '').toLowerCase().trim()
  const dupe = (existingBiz || []).find(b => norm(b.settings?.business_type || b.settings?.biz_business_type) === norm(v.type))
  if (dupe) {
    result.ok = true
    result.businessId = dupe.id
    console.log(`  [skip] ${v.bizName} (${v.type}) already exists — id=${dupe.id}`)
    return result
  }

  // 2. Create business
  const businessId = uuid()
  const settings = {
    ciudad: CITY,
    biz_city: CITY,
    business_type: v.type,
    biz_business_type: v.type,
    biz_type: '',
    biz_name: v.bizName,
    biz_rnc: RNC,
    biz_phone: '+18098282971',
  }
  const { error: bizErr } = await sb.from('businesses').insert({
    id: businessId,
    name: v.bizName,
    rnc: RNC,
    address: 'Av. Winston Churchill, Santo Domingo',
    phone: '+18098282971',
    email: v.email,
    settings,
    plan: 'pro_max',
  })
  if (bizErr) { result.error = `business: ${bizErr.message}`; return result }

  // 3. Auth user — create or reuse
  let authUserId
  const { data: authCreated, error: authErr } = await sb.auth.admin.createUser({
    email: v.email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { business_id: businessId, business_type: v.type, demo: true },
  })
  if (authErr) {
    if (/registered|exists|duplicate/i.test(authErr.message)) {
      // Find existing user
      const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 })
      const existing = list?.users?.find(u => u.email?.toLowerCase() === v.email.toLowerCase())
      if (!existing) { result.error = `auth lookup: ${authErr.message}`; return result }
      authUserId = existing.id
      // Update password + metadata
      await sb.auth.admin.updateUserById(authUserId, {
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { business_id: businessId, business_type: v.type, demo: true },
      })
    } else {
      result.error = `auth: ${authErr.message}`; return result
    }
  } else {
    authUserId = authCreated.user.id
  }

  // 4. Owner empleado (created BEFORE staff so staff.employee_id can link)
  const ownerEmpleadoSupabaseId = uuid()
  const { data: ownerEmp, error: empErr } = await sb.from('empleados').insert({
    business_id: businessId,
    supabase_id: ownerEmpleadoSupabaseId,
    nombre: 'Mike Owner',
    tipo: 'hybrid',
    role: 'owner',
    salary: 50000,
    start_date: new Date(Date.now() - 365*24*3600*1000).toISOString().slice(0,10),
    cedula: '001-0000001-1',
    phone: '+18098282971',
    email: v.email,
    comision_pct: 0,
    active: true,
  }).select('id').single()
  if (empErr) { result.error = `owner empleado: ${empErr.message}`; return result }

  // 5. Staff (login row)
  const { error: staffErr } = await sb.from('staff').insert({
    business_id: businessId,
    supabase_id: uuid(),
    auth_user_id: authUserId,
    name: 'Mike Owner',
    username: 'admin',
    pin_hash: PIN_HASH,
    pin_hash_algo: PIN_ALGO,
    pin_salt: PIN_SALT,
    role: 'owner',
    // employee_id is INTEGER (legacy SQLite local id) — leave null on cloud
    cedula: '001-0000001-1',
    start_date: new Date(Date.now() - 365*24*3600*1000).toISOString().slice(0,10),
    discount_pct: 0,
    commission_pct: 0,
    active: true,
  })
  if (staffErr) { result.error = `staff: ${staffErr.message}`; return result }

  // 6. License — Pro MAX, 30-day expires_at
  const expires = new Date(Date.now() + 30*24*3600*1000).toISOString()
  const licKey = `TXL-${rand(1000,9999)}-${rand(1000,9999)}-${rand(1000,9999)}`
  const { error: licErr } = await sb.from('licenses').insert({
    business_id: businessId,
    plan_id: planId,
    license_key: licKey,
    hardware_id: `demo-${v.type}-${rand(100000,999999)}`,
    status: 'active',
    platform: 'both',
    activated_at: new Date().toISOString(),
    expires_at: expires,
    max_users: 999,
    notes: `DEMO ${v.type} — auto-seeded ${new Date().toISOString().slice(0,10)}`,
  })
  if (licErr) console.log(`    [warn] license: ${licErr.message}`)

  // 7. Additional empleados
  const empleados = [{ id: ownerEmp.id, supabase_id: ownerEmpleadoSupabaseId, nombre: 'Mike Owner', tipo: 'hybrid' }]
  for (const e of v.employees) {
    const sId = uuid()
    const { data: row, error } = await sb.from('empleados').insert({
      business_id: businessId,
      supabase_id: sId,
      nombre: e.nombre,
      tipo: e.tipo,
      role: e.role,
      salary: e.salary,
      comision_pct: e.comision_pct,
      start_date: new Date(Date.now() - rand(60, 720)*24*3600*1000).toISOString().slice(0,10),
      cedula: `001-${String(rand(1000000,9999999)).padStart(7,'0')}-${rand(1,9)}`,
      phone: phone(),
      active: true,
    }).select('id, supabase_id, nombre, tipo, comision_pct').single()
    if (error) { console.log(`    [warn] empleado ${e.nombre}: ${error.message}`); continue }
    empleados.push(row)
  }
  const lavadores = empleados.filter(e => e.tipo === 'lavador')
  const vendedores = empleados.filter(e => e.tipo === 'vendedor')
  const cajeros = empleados.filter(e => e.tipo === 'cajero')
  const cashStaff = cajeros.length ? cajeros : (vendedores.length ? vendedores : [empleados[0]])

  // 8. Services
  const svcRows = []
  for (const s of v.services) {
    const supabase_id = uuid()
    const { data: row, error } = await sb.from('services').insert({
      business_id: businessId,
      supabase_id,
      name: s.name,
      price: s.price,
      is_wash: s.is_wash,
      aplica_itbis: true,
      active: true,
      no_commission: 0,
      ...(s.is_menu_item ? { is_menu_item: s.is_menu_item, course: s.course, station: s.station } : {}),
    }).select('id, supabase_id, name, price, is_wash').single()
    if (error) { console.log(`    [warn] service ${s.name}: ${error.message}`); continue }
    svcRows.push({ ...row, sku: s.sku })
  }

  // 9. Inventory items (retail / hybrid)
  const invRows = []
  if (v.retail) {
    const products = v.services.filter(s => !s.is_wash && s.sku)
    for (const p of products) {
      const { data: row, error } = await sb.from('inventory_items').insert({
        business_id: businessId,
        supabase_id: uuid(),
        sku: p.sku,
        name: p.name,
        category: 'General',
        quantity: rand(20, 150),
        min_quantity: 10,
        price: p.price,
        cost: money(p.price * 0.55),
        active: true,
      }).select('id, supabase_id, sku, name, quantity').single()
      if (error) { console.log(`    [warn] inv ${p.sku}: ${error.message}`); continue }
      invRows.push(row)
    }
  }

  // 10. Clients
  const clientRows = []
  const clientCount = rand(6, 10)
  for (let i = 0; i < clientCount; i++) {
    const isCompany = i >= clientCount - 2
    const name = isCompany ? pick(COMPANY_SUFFIXES) : `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`
    const { data: row, error } = await sb.from('clients').insert({
      business_id: businessId,
      supabase_id: uuid(),
      name,
      rnc: isCompany ? `${rand(100,499)}${String(rand(1000000,9999999)).padStart(7,'0')}${rand(1,9)}` : '',
      phone: phone(),
      email: '',
      credit_limit: pick([0, 0, 5000, 10000, 25000]),
      balance: 0,
      visits: 0,
      total_spent: 0,
      active: true,
    }).select('id, supabase_id, name, rnc, credit_limit').single()
    if (error) { console.log(`    [warn] client: ${error.message}`); continue }
    clientRows.push(row)
  }

  // 11. NCF sequences
  await sb.from('ncf_sequences').insert([
    { business_id: businessId, supabase_id: uuid(), type: 'B01', prefix: 'B01', current_number: 0, limit_number: 500, active: true, enabled: true },
    { business_id: businessId, supabase_id: uuid(), type: 'B02', prefix: 'B02', current_number: 0, limit_number: 500, active: true, enabled: true },
  ])

  // 12. Tickets — 18 to 22 spread across last 7 days
  const ticketCount = rand(18, 22)
  const PM_POOL = [...Array(6).fill('cash'), ...Array(3).fill('card'), ...Array(2).fill('transfer')]
  let ncfCounter = 1
  let createdTickets = 0
  const ticketRowsForQueue = []

  for (let i = 0; i < ticketCount; i++) {
    const created_at = daysAgo(rand(0, 6))
    const numItems = rand(1, 3)
    const items = []
    let subtotal = 0
    for (let j = 0; j < numItems; j++) {
      const svc = pick(svcRows)
      const qty = svc.is_wash ? 1 : rand(1, 3)
      items.push({ svc, qty })
      subtotal += parseFloat(svc.price) * qty
    }
    subtotal = money(subtotal)
    const itbis = money(subtotal * 0.18)
    const total = money(subtotal + itbis)

    const pm = pick(PM_POOL)
    const client = Math.random() > 0.4 ? pick(clientRows) : null
    const useEcf = client?.rnc ? 'B01' : 'B02'
    const ncf = ncfStr(useEcf, ncfCounter++)

    const lavador = lavadores.length ? pick(lavadores) : null
    const vendedor = vendedores.length ? pick(vendedores) : null
    const cajero = pick(cashStaff)

    const ticketSupId = uuid()
    const ticketPayload = {
      business_id: businessId,
      supabase_id: ticketSupId,
      doc_number: `T-${String(i + 1000).padStart(4, '0')}`,
      client_name: client?.name || '',
      client_supabase_id: client?.supabase_id || null,
      services_json: JSON.stringify(items.map(it => ({
        name: it.svc.name, price: it.svc.price, qty: it.qty, is_wash: it.svc.is_wash,
      }))),
      subtotal,
      itbis,
      ley: 0,
      descuento: 0,
      total,
      ncf,
      ncf_type: useEcf,
      comprobante_type: useEcf,
      payment_method: pm,
      tipo_venta: 'contado',
      status: 'cobrado',
      paid_at: created_at,
      cajero_supabase_id: cajero?.supabase_id || null,
      cajero_name: cajero?.nombre || '',
      washer_empleado_supabase_ids: lavador ? [lavador.supabase_id] : [],
      seller_empleado_supabase_id: vendedor?.supabase_id || null,
      vehicle_plate: v.plates ? pick(PLATES) : null,
      vehicle_color: v.plates ? pick(COLORS) : null,
      vehicle_make: v.plates ? pick(MAKES) : null,
      created_at,
    }

    const { data: tk, error: tkErr } = await sb.from('tickets').insert(ticketPayload).select('id, supabase_id').single()
    if (tkErr) { console.log(`    [warn] ticket: ${tkErr.message}`); continue }

    // Ticket items
    const itemPayloads = items.map(it => ({
      business_id: businessId,
      supabase_id: uuid(),
      ticket_id: tk.id,
      ticket_supabase_id: tk.supabase_id,
      service_id: it.svc.id,
      service_supabase_id: it.svc.supabase_id,
      name: it.svc.name,
      price: it.svc.price,
      quantity: it.qty,
      itbis: money(parseFloat(it.svc.price) * it.qty * 0.18),
      is_wash: it.svc.is_wash,
      sku: it.svc.sku || null,
    }))
    const { error: itErr } = await sb.from('ticket_items').insert(itemPayloads)
    if (itErr) console.log(`    [warn] ticket_items: ${itErr.message}`)

    createdTickets++
    ticketRowsForQueue.push({ ...tk, washer: lavador, created_at })
  }

  // 13. Queue rows for verticals that need them — fresh tickets, status pendiente
  if (v.queueRows > 0 && lavadores.length) {
    for (let i = 0; i < v.queueRows; i++) {
      const created_at = daysAgo(0)
      const lavador = pick(lavadores)
      const svc = pick(svcRows.filter(s => s.is_wash)) || pick(svcRows)
      const subtotal = parseFloat(svc.price)
      const itbis = money(subtotal * 0.18)
      const total = money(subtotal + itbis)
      const ticketSupId = uuid()
      const { data: tk, error: tkErr } = await sb.from('tickets').insert({
        business_id: businessId,
        supabase_id: ticketSupId,
        doc_number: `Q-${String(i + 1).padStart(4, '0')}`,
        services_json: JSON.stringify([{ name: svc.name, price: svc.price, qty: 1, is_wash: svc.is_wash }]),
        subtotal, itbis, ley: 0, descuento: 0, total,
        payment_method: 'cash',
        tipo_venta: 'contado',
        status: 'pendiente',
        washer_empleado_supabase_ids: [lavador.supabase_id],
        vehicle_plate: v.plates ? pick(PLATES) : null,
        vehicle_color: v.plates ? pick(COLORS) : null,
        vehicle_make: v.plates ? pick(MAKES) : null,
        created_at,
      }).select('id, supabase_id').single()
      if (tkErr) { console.log(`    [warn] queue ticket: ${tkErr.message}`); continue }

      await sb.from('ticket_items').insert({
        business_id: businessId,
        supabase_id: uuid(),
        ticket_id: tk.id,
        ticket_supabase_id: tk.supabase_id,
        service_id: svc.id,
        service_supabase_id: svc.supabase_id,
        name: svc.name,
        price: svc.price,
        quantity: 1,
        itbis,
        is_wash: svc.is_wash,
      })

      const qStatus = i === 0 ? 'in_progress' : 'waiting'
      await sb.from('queue').insert({
        business_id: businessId,
        supabase_id: uuid(),
        ticket_id: tk.id,
        ticket_supabase_id: tk.supabase_id,
        empleado_supabase_id: lavador.supabase_id,
        status: qStatus,
        assigned_at: qStatus === 'in_progress' ? created_at : null,
        created_at,
      })
    }
  }

  // 14. Vertical-specific extras — wire surfaces the Sidebar promises but
  //     that would otherwise render blank on a fresh demo.
  if (v.type === 'mechanic') {
    const { data: existingBays } = await sb.from('service_bays')
      .select('id').eq('business_id', businessId).limit(1)
    if (!existingBays?.length) {
      const bays = [
        { name: 'Bahía 1 — General', bay_type: 'general',     status: 'occupied', capacity: 1 },
        { name: 'Bahía 2 — Frenos',  bay_type: 'brakes',      status: 'libre',    capacity: 1 },
        { name: 'Bahía 3 — Alineación', bay_type: 'alignment', status: 'libre',    capacity: 1 },
        { name: 'Bahía 4 — Diagnóstico', bay_type: 'diagnostic', status: 'libre',  capacity: 1 },
      ]
      const baysPayload = bays.map(b => ({
        ...b, business_id: businessId, supabase_id: uuid(), active: true,
      }))
      const { error: bayErr } = await sb.from('service_bays').insert(baysPayload)
      if (bayErr) console.log(`    [warn] service_bays: ${bayErr.message}`)
      else console.log(`    [ok] service_bays seeded (${bays.length})`)
    }
  }

  console.log(`  [ok] ${v.bizName} | empleados=${empleados.length} svc=${svcRows.length} cli=${clientRows.length} tk=${createdTickets} queue=${v.queueRows}`)
  result.ok = true
  result.created = true
  result.businessId = businessId
  return result
}

// ──────────────────────────────────────────────────────────────────────────
// seedActivity(businessId, vertical) — fills payroll/adelantos/cuadre/
// caja_chica/activity_log/notas_credito/commissions for a single business.
// Idempotent: every section checks for existing rows first.
// ──────────────────────────────────────────────────────────────────────────
const TSS_RATE = 0.0287   // simplified employee withholding (AFP ~2.87%)
const ISR_MONTHLY_FREE = 34685     // ~ RD$416,220 / 12
const PETTY_CATEGORIES = ['Transporte','Alimentacion','Mantenimiento','Suministros','Servicios Publicos']
const PETTY_DESCRIPTIONS = {
  Transporte: ['Gasolina motor','Uber para diligencia','Pasaje publico','Combustible camioneta'],
  Alimentacion: ['Compra de cafe','Almuerzo equipo','Agua para oficina','Galletas y snacks'],
  Mantenimiento: ['Reparacion inodoro','Pintura local','Cambio bombillos','Limpieza profunda'],
  Suministros: ['Toner impresora','Papel termico','Bolsas de basura','Articulos de aseo'],
  'Servicios Publicos': ['Pago internet','Recarga celular','Pago agua','Recarga TV cable'],
}
const ADELANTO_REASONS = ['Adelanto quincenal','Emergencia familiar','Compra de uniforme','Gastos medicos','Pago de colegio']

async function seedActivity(businessId, v) {
  const counts = { payroll_runs: 0, adelantos: 0, cuadre: 0, caja_chica: 0, activity: 0, notas: 0, commissions: 0 }

  // Pull empleados + tickets for this business
  const { data: empleados = [] } = await sb.from('empleados')
    .select('supabase_id, nombre, tipo, role, salary, comision_pct')
    .eq('business_id', businessId)
  if (!empleados.length) return counts

  const lavadores  = empleados.filter(e => e.tipo === 'lavador' || e.tipo === 'hybrid')
  const vendedores = empleados.filter(e => e.tipo === 'vendedor' || e.tipo === 'hybrid')
  const cajeros    = empleados.filter(e => e.tipo === 'cajero'   || e.tipo === 'hybrid')
  const owner      = empleados.find(e => e.role === 'owner') || empleados[0]
  const cashStaff  = cajeros.length ? cajeros : (vendedores.length ? vendedores : [owner])

  const { data: tickets = [] } = await sb.from('tickets')
    .select('id, supabase_id, subtotal, total, status, payment_method, created_at, paid_at, washer_empleado_supabase_ids, seller_empleado_supabase_id, cajero_supabase_id, ncf, ncf_type, comprobante_type, client_supabase_id')
    .eq('business_id', businessId)
    .order('created_at', { ascending: true })

  // ── 1. Payroll runs ───────────────────────────────────────────────────
  const { data: existingPayroll } = await sb.from('payroll_runs')
    .select('id').eq('business_id', businessId).limit(1)
  if (!existingPayroll?.length) {
    const periods = [
      { start: '2026-03-16', end: '2026-03-31' },
      { start: '2026-04-01', end: '2026-04-15' },
    ]
    const payrollRows = []
    for (const period of periods) {
      for (const emp of empleados) {
        if (!emp.salary || emp.salary <= 0) continue // skip commission-only
        const grossQuincenal = emp.salary / 2
        const commissions = money(grossQuincenal * (rand(5, 15) / 100))
        const sfs = money(grossQuincenal * 0.0304)
        const afp = money(grossQuincenal * TSS_RATE)
        const isr = grossQuincenal > ISR_MONTHLY_FREE / 2
          ? money((grossQuincenal - ISR_MONTHLY_FREE / 2) * 0.15)
          : 0
        const totalDeductions = money(sfs + afp + isr)
        const net = money(grossQuincenal + commissions - totalDeductions)
        const paidAt = new Date(period.end + 'T00:00:00Z')
        paidAt.setDate(paidAt.getDate() + rand(1, 3))
        paidAt.setHours(rand(9, 17), rand(0, 59))
        payrollRows.push({
          business_id: businessId,
          supabase_id: uuid(),
          empleado_supabase_id: emp.supabase_id,
          period_start: period.start,
          period_end: period.end,
          base: grossQuincenal,
          commissions,
          bonuses: 0,
          sfs_employee: sfs,
          afp_employee: afp,
          isr,
          other_deductions: 0,
          deductions: totalDeductions,
          sfs_employer: money(grossQuincenal * 0.0709),
          afp_employer: money(grossQuincenal * 0.0710),
          infotep_employer: money(grossQuincenal * 0.01),
          net,
          notes: 'Pago quincenal',
          paid_at: paidAt.toISOString(),
          created_at: paidAt.toISOString(),
          updated_at: paidAt.toISOString(),
        })
      }
    }
    if (payrollRows.length) {
      const { error } = await sb.from('payroll_runs').insert(payrollRows)
      if (error) console.log(`    [warn] payroll_runs: ${error.message}`)
      else counts.payroll_runs = payrollRows.length
    }
  } else {
    counts.payroll_runs = -1 // skipped
  }

  // ── 2. Adelantos ──────────────────────────────────────────────────────
  const { data: existingAdel } = await sb.from('adelantos')
    .select('id').eq('business_id', businessId).limit(1)
  if (!existingAdel?.length && empleados.filter(e => e.salary > 0).length) {
    const targets = empleados.filter(e => e.salary > 0)
    const adelRows = []
    const mix = [
      { status: 'pendiente', daysAgo: rand(5, 10),  amount: rand(3000, 8000) },
      { status: 'deducido',  daysAgo: rand(20, 25), amount: rand(2000, 5000), deductedDaysAgo: rand(15, 19) },
      { status: 'cancelado', daysAgo: 15,           amount: 1500 },
      { status: 'pendiente', daysAgo: rand(2, 6),   amount: rand(2000, 4000) },
    ]
    for (let i = 0; i < Math.min(mix.length, targets.length + 1); i++) {
      const m = mix[i]
      const emp = targets[i % targets.length]
      adelRows.push({
        business_id: businessId,
        supabase_id: uuid(),
        empleado_supabase_id: emp.supabase_id,
        amount: m.amount,
        date: daysAgo(m.daysAgo).slice(0, 10),
        notes: pick(ADELANTO_REASONS),
        status: m.status,
        deducted_at: m.status === 'deducido' ? daysAgo(m.deductedDaysAgo) : null,
        approved_by: owner.nombre,
        created_at: daysAgo(m.daysAgo),
        updated_at: daysAgo(m.daysAgo),
      })
    }
    const { error } = await sb.from('adelantos').insert(adelRows)
    if (error) console.log(`    [warn] adelantos: ${error.message}`)
    else counts.adelantos = adelRows.length
  } else if (existingAdel?.length) {
    counts.adelantos = -1
  }

  // ── 3. Cuadre de Caja (skip prestamos/dealership/service per Mike's rule) ─
  const skipCuadreTypes = ['loans', 'dealership', 'service']
  if (!skipCuadreTypes.includes(v.type)) {
    const { data: existingCuadre } = await sb.from('cuadre_caja')
      .select('id').eq('business_id', businessId).limit(1)
    if (!existingCuadre?.length && cashStaff.length) {
      const cuadreRows = []
      const numDays = rand(5, 7)
      for (let d = 0; d < numDays; d++) {
        const day = daysAgo(d).slice(0, 10)
        const cajero = pick(cashStaff)
        // Sum that day's cash tickets
        const dayTickets = tickets.filter(t => t.created_at?.slice(0, 10) === day && t.status === 'cobrado')
        const cashTotal = dayTickets.filter(t => t.payment_method === 'cash').reduce((s, t) => s + Number(t.total || 0), 0)
        const cardTotal = dayTickets.filter(t => t.payment_method === 'card').reduce((s, t) => s + Number(t.total || 0), 0)
        const xferTotal = dayTickets.filter(t => t.payment_method === 'transfer').reduce((s, t) => s + Number(t.total || 0), 0)
        const fondo = pick([1000, 2000, 3000])
        const sysCash = money(cashTotal)
        const conteoCash = money(sysCash + (Math.random() - 0.5) * 100) // ±50
        const diff = money(conteoCash - sysCash)
        const totalSold = money(cashTotal + cardTotal + xferTotal)
        const closedAt = new Date(day + 'T20:30:00.000Z')
        closedAt.setMinutes(closedAt.getMinutes() + rand(0, 90))
        cuadreRows.push({
          business_id: businessId,
          supabase_id: uuid(),
          cajero_supabase_id: cajero.supabase_id,
          date: day,
          fondo,
          efectivo_conteo: conteoCash,
          efectivo_sistema: sysCash,
          tarjeta: money(cardTotal),
          transferencia: money(xferTotal),
          cheque: 0,
          creditos: 0,
          salidas: 0,
          total_vendido: totalSold,
          total_cobrado: totalSold,
          cierre_total: money(conteoCash + cardTotal + xferTotal + fondo),
          diferencia: diff,
          comentario: Math.abs(diff) > 50 ? 'Pequena diferencia' : '',
          denominaciones: { '2000': rand(0,3), '1000': rand(2,6), '500': rand(3,8), '200': rand(0,5), '100': rand(2,10), '50': rand(1,8), '25': rand(0,10), '10': rand(0,15), '5': rand(0,20), '1': rand(0,30) },
          closed_at: closedAt.toISOString(),
          updated_at: closedAt.toISOString(),
        })
      }
      const { error } = await sb.from('cuadre_caja').insert(cuadreRows)
      if (error) console.log(`    [warn] cuadre_caja: ${error.message}`)
      else counts.cuadre = cuadreRows.length
    } else if (existingCuadre?.length) {
      counts.cuadre = -1
    }
  }

  // ── 4. Caja Chica ──────────────────────────────────────────────────────
  const { data: existingCC } = await sb.from('caja_chica')
    .select('id').eq('business_id', businessId).limit(1)
  if (!existingCC?.length) {
    const ccRows = []
    const n = rand(8, 12)
    for (let i = 0; i < n; i++) {
      const r = Math.random()
      const type = r < 0.6 ? 'Gasto' : (r < 0.9 ? 'Compra' : 'Fondo')
      const sr = Math.random()
      const status = sr < 0.7 ? 'aprobado' : (sr < 0.9 ? 'pendiente' : 'rechazado')
      const cat = pick(PETTY_CATEGORIES)
      const desc = pick(PETTY_DESCRIPTIONS[cat])
      const cajero = pick(cashStaff)
      const created = daysAgo(rand(0, 13))
      ccRows.push({
        business_id: businessId,
        supabase_id: uuid(),
        description: desc,
        category: cat,
        type,
        amount: rand(200, 2500),
        recibo: Math.random() > 0.5 ? `R-${rand(10000, 99999)}` : null,
        status,
        approved_by_supabase_id: status === 'aprobado' ? owner.supabase_id : null,
        cajero_supabase_id: cajero.supabase_id,
        created_at: created,
        updated_at: created,
      })
    }
    const { error } = await sb.from('caja_chica').insert(ccRows)
    if (error) console.log(`    [warn] caja_chica: ${error.message}`)
    else counts.caja_chica = ccRows.length
  } else {
    counts.caja_chica = -1
  }

  // ── 5. Notas de credito (skip prestamos/salon/dealership) ──────────────
  const skipNotaTypes = ['loans', 'salon', 'dealership']
  if (!skipNotaTypes.includes(v.type)) {
    const { data: existingNotas } = await sb.from('notas_credito')
      .select('id').eq('business_id', businessId).limit(1)
    if (!existingNotas?.length && tickets.length) {
      const cobrado = tickets.filter(t => t.status === 'cobrado')
      const numNotas = Math.min(rand(1, 2), cobrado.length)
      const motivos = ['Devolucion de mercancia', 'Error de facturacion']
      const notaRows = []
      const used = new Set()
      let ncfSeq = 1
      for (let i = 0; i < numNotas; i++) {
        let tk = null
        for (let attempt = 0; attempt < 10; attempt++) {
          const candidate = pick(cobrado)
          if (!used.has(candidate.supabase_id)) { tk = candidate; used.add(tk.supabase_id); break }
        }
        if (!tk) break
        const created = daysAgo(rand(5, 15))
        const cajero = pick(cashStaff)
        const itbis = money(Number(tk.total) * 0.18 / 1.18)
        notaRows.push({
          business_id: businessId,
          supabase_id: uuid(),
          ncf: `B04${String(ncfSeq++).padStart(8, '0')}`,
          client_supabase_id: tk.client_supabase_id || null,
          original_ticket_supabase_id: tk.supabase_id,
          motivo: motivos[i % motivos.length],
          amount: tk.total,
          itbis_revertido: itbis,
          forma_devolucion: 'Efectivo',
          comentario: 'Cliente solicito devolucion',
          cajero_supabase_id: cajero.supabase_id,
          created_at: created,
          updated_at: created,
        })
      }
      if (notaRows.length) {
        const { error } = await sb.from('notas_credito').insert(notaRows)
        if (error) console.log(`    [warn] notas_credito: ${error.message}`)
        else counts.notas = notaRows.length
      }
    } else if (existingNotas?.length) {
      counts.notas = -1
    }
  }

  // ── 6. Commissions backfill ────────────────────────────────────────────
  const { data: existingComm } = await sb.from('washer_commissions')
    .select('id').eq('business_id', businessId).limit(1)
  const { data: existingSComm } = await sb.from('seller_commissions')
    .select('id').eq('business_id', businessId).limit(1)
  const { data: existingCComm } = await sb.from('cajero_commissions')
    .select('id').eq('business_id', businessId).limit(1)
  const allCommExist = existingComm?.length && existingSComm?.length && existingCComm?.length
  if (!allCommExist) {
    const empByUuid = Object.fromEntries(empleados.map(e => [e.supabase_id, e]))
    const washerRows = [], sellerRows = [], cajeroRows = []
    for (const tk of tickets) {
      if (tk.status !== 'cobrado') continue
      const subtotal = Number(tk.subtotal || 0)
      // Washers
      let washerIds = []
      try {
        const raw = tk.washer_empleado_supabase_ids
        washerIds = Array.isArray(raw) ? raw : (typeof raw === 'string' && raw.startsWith('[') ? JSON.parse(raw) : [])
      } catch { washerIds = [] }
      for (const wId of washerIds) {
        const emp = empByUuid[wId]
        if (!emp) continue
        const pct = Number(emp.comision_pct || 0)
        if (pct <= 0) continue
        const perWasher = subtotal / washerIds.length
        const amt = money(perWasher * pct / 100)
        washerRows.push({
          business_id: businessId,
          supabase_id: uuid(),
          empleado_supabase_id: wId,
          ticket_supabase_id: tk.supabase_id,
          base_amount: money(perWasher),
          commission_pct: pct,
          commission_amount: amt,
          paid: false,
          created_at: tk.paid_at || tk.created_at,
          updated_at: tk.paid_at || tk.created_at,
        })
      }
      // Seller
      if (tk.seller_empleado_supabase_id) {
        const emp = empByUuid[tk.seller_empleado_supabase_id]
        const pct = Number(emp?.comision_pct || 0)
        if (pct > 0) {
          sellerRows.push({
            business_id: businessId,
            supabase_id: uuid(),
            empleado_supabase_id: tk.seller_empleado_supabase_id,
            ticket_supabase_id: tk.supabase_id,
            base_amount: subtotal,
            commission_pct: pct,
            commission_amount: money(subtotal * pct / 100),
            paid: false,
            created_at: tk.paid_at || tk.created_at,
            updated_at: tk.paid_at || tk.created_at,
          })
        }
      }
      // Cajero (only on beverage portion — skip if no is_wash=0 items)
      if (tk.cajero_supabase_id) {
        const emp = empByUuid[tk.cajero_supabase_id]
        const pct = Number(emp?.comision_pct || 0)
        if (pct > 0) {
          // Approximate beverage subtotal from ticket items (lazy: skip if no retail vertical)
          if (v.retail) {
            const { data: items = [] } = await sb.from('ticket_items')
              .select('price, quantity, is_wash')
              .eq('business_id', businessId)
              .eq('ticket_supabase_id', tk.supabase_id)
            const bevSubtotal = items.filter(i => !i.is_wash)
              .reduce((s, i) => s + Number(i.price || 0) * Number(i.quantity || 1), 0)
            if (bevSubtotal > 0) {
              cajeroRows.push({
                business_id: businessId,
                supabase_id: uuid(),
                cajero_supabase_id: tk.cajero_supabase_id,
                ticket_supabase_id: tk.supabase_id,
                base_amount: money(bevSubtotal),
                commission_pct: pct,
                commission_amount: money(bevSubtotal * pct / 100),
                paid: false,
                created_at: tk.paid_at || tk.created_at,
                updated_at: tk.paid_at || tk.created_at,
              })
            }
          }
        }
      }
    }
    if (washerRows.length && !existingComm?.length) {
      const { error } = await sb.from('washer_commissions').insert(washerRows)
      if (error) console.log(`    [warn] washer_commissions: ${error.message}`)
      else counts.commissions += washerRows.length
    }
    if (sellerRows.length && !existingSComm?.length) {
      const { error } = await sb.from('seller_commissions').insert(sellerRows)
      if (error) console.log(`    [warn] seller_commissions: ${error.message}`)
      else counts.commissions += sellerRows.length
    }
    if (cajeroRows.length && !existingCComm?.length) {
      const { error } = await sb.from('cajero_commissions').insert(cajeroRows)
      if (error) console.log(`    [warn] cajero_commissions: ${error.message}`)
      else counts.commissions += cajeroRows.length
    }
  } else {
    counts.commissions = -1
  }

  // ── 7. Activity Log (last — references payroll/adelantos/caja_chica/notas IDs) ─
  const { data: existingAct } = await sb.from('activity_log')
    .select('id').eq('business_id', businessId).limit(1)
  if (!existingAct?.length) {
    // Re-query newly inserted rows so target_id points to real UUIDs
    const [{ data: payRows = [] }, { data: adelRows = [] }, { data: ccRows = [] }, { data: notasRows = [] }, { data: cuadreRows = [] }] = await Promise.all([
      sb.from('payroll_runs').select('supabase_id, empleado_supabase_id, net, paid_at').eq('business_id', businessId),
      sb.from('adelantos').select('supabase_id, empleado_supabase_id, amount, date, status').eq('business_id', businessId),
      sb.from('caja_chica').select('supabase_id, description, amount, status, cajero_supabase_id, created_at').eq('business_id', businessId).eq('status', 'aprobado'),
      sb.from('notas_credito').select('supabase_id, motivo, amount, cajero_supabase_id, created_at').eq('business_id', businessId),
      sb.from('cuadre_caja').select('supabase_id, cajero_supabase_id, diferencia, closed_at').eq('business_id', businessId),
    ])
    const empByUuid = Object.fromEntries(empleados.map(e => [e.supabase_id, e]))
    const actorFor = (sid) => {
      const e = empByUuid[sid] || owner
      return { actor_supabase_id: e.supabase_id, actor_name: e.nombre, actor_role: e.role || 'cashier' }
    }
    const actRows = []
    const baseRow = (overrides) => ({
      business_id: businessId,
      supabase_id: uuid(),
      severity: 'info',
      ...overrides,
      created_at: overrides.created_at || daysAgo(rand(0, 29)),
      updated_at: overrides.created_at || new Date().toISOString(),
    })

    // Nomina paid (one per payroll run, capped)
    for (const p of payRows.slice(0, 8)) {
      const emp = empByUuid[p.empleado_supabase_id] || owner
      actRows.push(baseRow({
        event_type: 'payroll_paid',
        severity: 'info',
        target_type: 'payroll_run',
        target_id: p.supabase_id,
        target_name: emp.nombre,
        amount: Number(p.net),
        reason: 'Pago de nomina quincenal',
        metadata: { period_end: p.paid_at?.slice(0, 10) },
        created_at: p.paid_at,
        ...actorFor(owner.supabase_id),
      }))
    }
    // Adelanto created
    for (const a of adelRows) {
      const emp = empByUuid[a.empleado_supabase_id] || owner
      actRows.push(baseRow({
        event_type: 'adelanto_created',
        severity: 'info',
        target_type: 'adelanto',
        target_id: a.supabase_id,
        target_name: emp.nombre,
        amount: Number(a.amount),
        reason: 'Adelanto solicitado',
        metadata: { status: a.status },
        created_at: new Date(a.date + 'T12:00:00Z').toISOString(),
        ...actorFor(owner.supabase_id),
      }))
    }
    // Petty cash approvals
    for (const c of ccRows.slice(0, 6)) {
      actRows.push(baseRow({
        event_type: 'caja_chica_withdrawal',
        severity: 'info',
        target_type: 'caja_chica',
        target_id: c.supabase_id,
        target_name: c.description,
        amount: Number(c.amount),
        reason: 'Gasto aprobado',
        metadata: { status: c.status },
        created_at: c.created_at,
        ...actorFor(c.cajero_supabase_id || owner.supabase_id),
      }))
    }
    // Notas de credito
    for (const n of notasRows) {
      actRows.push(baseRow({
        event_type: 'nota_credito_created',
        severity: 'warn',
        target_type: 'nota_credito',
        target_id: n.supabase_id,
        target_name: n.motivo,
        amount: Number(n.amount),
        reason: n.motivo,
        metadata: {},
        created_at: n.created_at,
        ...actorFor(n.cajero_supabase_id || owner.supabase_id),
      }))
    }
    // Cuadre discrepancy (only if |diff|>50)
    for (const cu of cuadreRows) {
      if (Math.abs(Number(cu.diferencia || 0)) <= 50) continue
      actRows.push(baseRow({
        event_type: 'cuadre_discrepancy',
        severity: 'warn',
        target_type: 'cuadre_caja',
        target_id: cu.supabase_id,
        target_name: 'Cierre de caja',
        amount: Number(cu.diferencia),
        reason: `Diferencia de RD$${Math.abs(Number(cu.diferencia)).toFixed(2)}`,
        metadata: { date: cu.closed_at?.slice(0, 10) },
        created_at: cu.closed_at,
        ...actorFor(cu.cajero_supabase_id || owner.supabase_id),
      }))
    }
    // Synthetic events (ticket voids, discounts, price changes, deactivations)
    const cobradoTk = tickets.filter(t => t.status === 'cobrado')
    const synth = [
      { event_type: 'ticket_voided', severity: 'warn', count: rand(1, 3), reason: 'Anulacion por error de captura', target_type: 'ticket' },
      { event_type: 'discount_applied', severity: 'info', count: rand(2, 4), reason: 'Descuento cliente VIP', target_type: 'ticket' },
      { event_type: 'service_price_changed', severity: 'info', count: rand(1, 2), reason: 'Ajuste de precio mensual', target_type: 'service' },
      { event_type: 'user_deactivated', severity: 'warn', count: 1, reason: 'Empleado renuncio', target_type: 'empleado' },
    ]
    for (const s of synth) {
      for (let i = 0; i < s.count; i++) {
        let target_id = null, target_name = '', amount = null, old_value = null, new_value = null, severity = s.severity
        if (s.target_type === 'ticket' && cobradoTk.length) {
          const tk = pick(cobradoTk)
          target_id = tk.supabase_id
          target_name = tk.ncf || `Ticket ${tk.supabase_id.slice(0, 8)}`
          if (s.event_type === 'discount_applied') {
            amount = rand(200, 2500)
            if (amount > 1500) severity = 'warn'
          } else if (s.event_type === 'ticket_voided') {
            amount = Number(tk.total)
          }
        } else if (s.target_type === 'service') {
          target_id = uuid()
          target_name = pick(['Lavado Express', 'Encerado', 'Detallado Premium'])
          old_value = String(rand(150, 400))
          new_value = String(Number(old_value) + rand(50, 150))
        } else if (s.target_type === 'empleado') {
          const e = pick(empleados)
          target_id = e.supabase_id
          target_name = e.nombre
        }
        actRows.push(baseRow({
          event_type: s.event_type,
          severity,
          target_type: s.target_type,
          target_id,
          target_name,
          amount,
          old_value,
          new_value,
          reason: s.reason,
          metadata: {},
          created_at: daysAgo(rand(0, 29)),
          ...actorFor(owner.supabase_id),
        }))
      }
    }

    if (actRows.length) {
      // Insert in batches of 50
      for (let i = 0; i < actRows.length; i += 50) {
        const batch = actRows.slice(i, i + 50)
        const { error } = await sb.from('activity_log').insert(batch)
        if (error) { console.log(`    [warn] activity_log batch: ${error.message}`); break }
        counts.activity += batch.length
      }
    }
  } else {
    counts.activity = -1
  }

  return counts
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n[ dataLEAKS ] Demo seed — 9 verticals\n')

  // Resolve plan id (in case the hardcoded UUID drifts)
  const { data: planRow } = await sb.from('plans').select('id').eq('name', 'pro_max').single()
  const planId = planRow?.id || PLAN_PRO_MAX_ID

  const summary = []
  for (const v of VERTICALS) {
    console.log(`→ ${v.type.toUpperCase()} (${v.bizName})`)
    try {
      const r = await seedVertical(v, planId)
      let activity = null
      if (r.ok && r.businessId) {
        try {
          activity = await seedActivity(r.businessId, v)
          const fmt = (n) => n === -1 ? 'skip' : String(n)
          console.log(`    activity: payroll=${fmt(activity.payroll_runs)} adel=${fmt(activity.adelantos)} cuadre=${fmt(activity.cuadre)} cc=${fmt(activity.caja_chica)} act=${fmt(activity.activity)} nota=${fmt(activity.notas)} comm=${fmt(activity.commissions)}`)
        } catch (err) {
          console.log(`    [warn] activity seed failed: ${err.message}`)
        }
      }
      summary.push({ vertical: v, ...r, activity })
    } catch (err) {
      console.log(`  [FAIL] ${err.message}`)
      summary.push({ vertical: v, ok: false, error: err.message })
    }
  }

  // Credentials table
  console.log('\n' + '='.repeat(96))
  console.log('DEMO CREDENTIALS — terminalxpos.com')
  console.log('='.repeat(96))
  for (const s of summary) {
    const v = s.vertical
    const status = s.ok ? (s.created ? 'CREATED' : 'EXISTS ') : 'FAILED '
    console.log(`${status} | ${v.email.padEnd(48)} | password: ${PASSWORD}  | PIN: 1234  | ${v.bizName}`)
    if (s.error) console.log(`         └─ ${s.error}`)
  }
  console.log('='.repeat(96))

  // Activity summary (verified post-insert with row counts)
  console.log('\nACTIVITY DATA (verified row counts per business)')
  console.log('='.repeat(96))
  for (const s of summary) {
    if (!s.ok || !s.businessId) continue
    const v = s.vertical
    const bid = s.businessId
    const [pr, ad, cu, cc, ac, nc, wc, sc, cjc] = await Promise.all([
      sb.from('payroll_runs').select('id', { count: 'exact', head: true }).eq('business_id', bid),
      sb.from('adelantos').select('id', { count: 'exact', head: true }).eq('business_id', bid),
      sb.from('cuadre_caja').select('id', { count: 'exact', head: true }).eq('business_id', bid),
      sb.from('caja_chica').select('id', { count: 'exact', head: true }).eq('business_id', bid),
      sb.from('activity_log').select('id', { count: 'exact', head: true }).eq('business_id', bid),
      sb.from('notas_credito').select('id', { count: 'exact', head: true }).eq('business_id', bid),
      sb.from('washer_commissions').select('id', { count: 'exact', head: true }).eq('business_id', bid),
      sb.from('seller_commissions').select('id', { count: 'exact', head: true }).eq('business_id', bid),
      sb.from('cajero_commissions').select('id', { count: 'exact', head: true }).eq('business_id', bid),
    ])
    const totalComm = (wc.count || 0) + (sc.count || 0) + (cjc.count || 0)
    console.log(`${v.bizName.padEnd(28)} | payroll=${pr.count||0}  adel=${ad.count||0}  cuadre=${cu.count||0}  cc=${cc.count||0}  act=${ac.count||0}  notas=${nc.count||0}  comm=${totalComm}`)
  }
  console.log('='.repeat(96))
  console.log(`\nDone. ${summary.filter(s => s.ok).length}/${summary.length} businesses ready.\n`)
}

export { seedActivity, seedVertical }

const argv1 = process.argv[1] || ''
const isDirectRun = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, '/').split('/').pop())
if (isDirectRun) {
  main().catch(err => { console.error('FATAL:', err); process.exit(1) })
}
