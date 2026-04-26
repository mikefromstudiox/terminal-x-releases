/**
 * seed-demo-mecanica.mjs — populate the live Taller Mecánico demo account
 * (admin@mechanic.demo.terminalxpos.com) with realistic DR shop data.
 *
 * Idempotent: every insert checks for existing rows by natural key first.
 * Safe to re-run after partial failure.
 *
 * Usage:
 *   node scripts/seed-demo-mecanica.mjs
 *   npm run seed:demo:mecanica
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in A:/Studio X HUB/Terminal X/.env.
 */

import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import dotenv from 'dotenv'

dotenv.config({ path: 'A:/Studio X HUB/Terminal X/.env' })

const URL = process.env.SUPABASE_URL
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !SVC) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

const svc = createClient(URL, SVC, { auth: { persistSession: false } })

const DEMO_EMAIL = 'admin@mechanic.demo.terminalxpos.com'
const uuid = () => crypto.randomUUID()

const log = (sym, msg, extra = '') => console.log(`${sym} ${msg}${extra ? ' — ' + extra : ''}`)

// ── Resolve demo business_id ────────────────────────────────────────────
async function resolveBusinessId() {
  const { data: list, error } = await svc.auth.admin.listUsers({ perPage: 200 })
  if (error) throw new Error('listUsers: ' + error.message)
  const u = (list?.users || []).find(x => x.email?.toLowerCase() === DEMO_EMAIL)
  if (!u) throw new Error(`User ${DEMO_EMAIL} not found in auth.users`)
  const bid = u.user_metadata?.business_id
  if (!bid) throw new Error(`User ${DEMO_EMAIL} has no business_id in user_metadata`)
  return bid
}

// ── Idempotent upsert helpers ───────────────────────────────────────────
// Each helper looks up by natural key first; only inserts when absent.
async function ensureRow(table, where, payload) {
  const q = svc.from(table).select('id, supabase_id').match(where).maybeSingle()
  const { data: existing, error: selErr } = await q
  if (selErr && selErr.code !== 'PGRST116') throw new Error(`${table} select: ${selErr.message}`)
  if (existing) return existing
  const supabase_id = payload.supabase_id || uuid()
  const { data, error } = await svc.from(table).insert({ ...payload, supabase_id }).select('id, supabase_id').single()
  if (error) throw new Error(`${table} insert: ${error.message} — ${JSON.stringify(payload).slice(0, 200)}`)
  return data
}

// ── Seed plan ───────────────────────────────────────────────────────────
async function run() {
  console.log('=== Seeding Taller Mecánico demo ===\n')
  const bid = await resolveBusinessId()
  log('✓', 'business_id resolved', bid)

  // 1) business_type = mechanic (idempotent)
  await svc.from('app_settings').upsert(
    { business_id: bid, key: 'business_type', value: 'mechanic', supabase_id: uuid(), updated_at: new Date().toISOString() },
    { onConflict: 'business_id,key' }
  )
  log('✓', 'app_settings.business_type=mechanic')

  // 2) Empleados (mecánicos)
  const mechanics = [
    { nombre: 'Juan Pérez',   tipo: 'vendedor', commission_pct: 10, salary: 25000, active: true },
    { nombre: 'Pedro Gómez',  tipo: 'vendedor', commission_pct: 12, salary: 28000, active: true },
    { nombre: 'Luis Almonte', tipo: 'vendedor', commission_pct: 8,  salary: 22000, active: true },
  ]
  const mechRows = []
  for (const m of mechanics) {
    const row = await ensureRow('empleados', { business_id: bid, nombre: m.nombre }, { ...m, business_id: bid })
    mechRows.push({ ...m, ...row })
  }
  log('✓', `empleados (${mechRows.length} mecánicos)`, mechRows.map(m => m.nombre).join(', '))

  // 3) Service bays
  const bayDefs = [
    { name: 'Bahía 1', bay_type: 'general',    capacity: 1 },
    { name: 'Bahía 2', bay_type: 'alineación', capacity: 1 },
    { name: 'Bahía 3', bay_type: 'frenos',     capacity: 1 },
  ]
  const bayRows = []
  for (const b of bayDefs) {
    const row = await ensureRow('service_bays', { business_id: bid, name: b.name }, { ...b, business_id: bid, status: 'libre', active: true })
    bayRows.push({ ...b, ...row })
  }
  log('✓', `service_bays (${bayRows.length})`)

  // 4) Aseguradoras (DR real names)
  const asegDefs = [
    { nombre: 'Mapfre BHD Seguros', rnc: '101038234', contacto_telefono: '809-378-3000', ecf_mode: 'per_wo'         },
    { nombre: 'Seguros Universal',  rnc: '101013273', contacto_telefono: '809-544-7000', ecf_mode: 'monthly_batch'  },
    { nombre: 'La Colonial',        rnc: '101011260', contacto_telefono: '809-476-7777', ecf_mode: 'monthly_batch'  },
  ]
  const asegRows = []
  for (const a of asegDefs) {
    const row = await ensureRow('aseguradoras', { business_id: bid, nombre: a.nombre }, { ...a, business_id: bid, active: true })
    asegRows.push({ ...a, ...row })
  }
  log('✓', `aseguradoras (${asegRows.length})`)

  // 5) Suppliers (DR real auto-parts names)
  const supDefs = [
    { nombre: 'Auto Repuestos del Caribe', rnc: '130123456', telefono: '809-565-1111', contacto: 'Sr. Hernández' },
    { nombre: 'Toyota Genuino RD',         rnc: '130654321', telefono: '809-562-2222', contacto: 'Ana Martínez'  },
    { nombre: 'Honda Parts Express',       rnc: '130987654', telefono: '809-567-3333', contacto: 'José Reyes'    },
    { nombre: 'Repuestos Naco',            rnc: '130456789', telefono: '809-563-4444', contacto: 'Luis Vargas'   },
  ]
  const supRows = []
  for (const s of supDefs) {
    const row = await ensureRow('suppliers', { business_id: bid, nombre: s.nombre }, { ...s, business_id: bid, active: true })
    supRows.push({ ...s, ...row })
  }
  log('✓', `suppliers (${supRows.length})`)

  // 6) Clients (DR-flavored)
  const clientDefs = [
    { name: 'Carlos Jiménez',  phone: '809-555-1001', rnc: '00112233440' },
    { name: 'María Rodríguez', phone: '809-555-1002', rnc: '00112233441' },
    { name: 'José Castillo',   phone: '809-555-1003' },
    { name: 'Ana Beltré',      phone: '809-555-1004' },
    { name: 'Pedro Núñez',     phone: '809-555-1005', rnc: '00112233442' },
  ]
  const clientRows = []
  for (const c of clientDefs) {
    const row = await ensureRow('clients', { business_id: bid, name: c.name }, { ...c, business_id: bid, active: true })
    clientRows.push({ ...c, ...row })
  }
  log('✓', `clients (${clientRows.length})`)

  // 7) Vehicles — 5 with km logs + service intervals
  const vehDefs = [
    { plate: 'A123456', vin: '1HGBH41JXMN109186', make: 'Honda',  model: 'Civic',     year: 2019, color: 'Blanco', odometer_km: 87_500, last_service_km: 82_000, next_service_km: 92_000, client_idx: 0 },
    { plate: 'B789012', vin: '5TDBKRFH4FS115422', make: 'Toyota', model: 'Corolla',   year: 2021, color: 'Gris',   odometer_km: 45_300, last_service_km: 40_000, next_service_km: 50_000, client_idx: 1 },
    { plate: 'C345678', vin: 'WBA3A5C53DF351234', make: 'BMW',    model: '320i',      year: 2018, color: 'Negro',  odometer_km: 102_400, last_service_km: 99_000, next_service_km: 104_000, client_idx: 2 },
    { plate: 'D901234', vin: 'JN8AS5MT9FW118901', make: 'Nissan', model: 'Sentra',    year: 2020, color: 'Rojo',   odometer_km: 67_800, last_service_km: 65_000, next_service_km: 70_000, client_idx: 3 },
    { plate: 'E567890', vin: '3VWDP7AJ8DM234567', make: 'Hyundai',model: 'Tucson',    year: 2022, color: 'Azul',   odometer_km: 28_900, last_service_km: 24_000, next_service_km: 34_000, client_idx: 4 },
  ]
  const vehRows = []
  for (const v of vehDefs) {
    const client = clientRows[v.client_idx]
    const next_service_at = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30 * 4).toISOString() // ~4 months
    const row = await ensureRow('vehicles',
      { business_id: bid, plate: v.plate },
      {
        plate: v.plate, vin: v.vin, make: v.make, model: v.model, year: v.year, color: v.color,
        mileage: v.odometer_km, odometer_km: v.odometer_km,
        last_service_km: v.last_service_km, next_service_km: v.next_service_km,
        next_service_at,
        client_supabase_id: client.supabase_id,
        business_id: bid, active: true,
      }
    )
    vehRows.push({ ...v, ...row, client })
  }
  log('✓', `vehicles (${vehRows.length})`)

  // 8) Work Orders — 4 different statuses + 1 estimate + insurance
  // 8a) Estimado (pending customer approval) for client 0 / Honda Civic
  // 8b) Aprobado (already approved) for client 1 / Toyota Corolla
  // 8c) En progreso for client 2 / BMW 320i (insurance — Mapfre)
  // 8d) Awaiting parts for client 3 / Nissan Sentra
  // 8e) Listo for client 4 / Hyundai Tucson
  // 8f) Facturado (closed last month) for client 0 / Honda Civic — feeds productivity report
  const woSeed = [
    {
      idx: 0, vehicle_idx: 0, mech_idx: 0, bay_idx: 0,
      status: 'estimado',
      validity_until: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString().slice(0, 10),
      notes: 'Cambio de aceite + filtros. Cliente reporta ruido en bomba de gasolina.',
      items: [
        { type: 'labor',   name: 'Mano de obra cambio de aceite',   qty: 1, unit_price: 800,  warranty_months: 0 },
        { type: 'part',    name: 'Aceite Mobil 1 5W-30 (5L)',        qty: 1, unit_price: 2200, warranty_months: 0 },
        { type: 'part',    name: 'Filtro de aceite Honda original',  qty: 1, unit_price: 650,  warranty_months: 0 },
        { type: 'labor',   name: 'Diagnóstico bomba de gasolina',    qty: 1, unit_price: 1200, warranty_months: 0 },
      ],
    },
    {
      idx: 1, vehicle_idx: 1, mech_idx: 1, bay_idx: 1,
      status: 'aprobado',
      estimate_approved_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
      notes: 'Alineación y balanceo + cambio de pastillas delanteras.',
      items: [
        { type: 'service', name: 'Alineación 4 ruedas',              qty: 1, unit_price: 1500, warranty_months: 0 },
        { type: 'service', name: 'Balanceo 4 ruedas',                qty: 1, unit_price: 1200, warranty_months: 0 },
        { type: 'part',    name: 'Pastillas freno Toyota delanteras',qty: 1, unit_price: 3800, warranty_months: 6 },
        { type: 'labor',   name: 'Mano de obra frenos',              qty: 1, unit_price: 1500, warranty_months: 0 },
      ],
    },
    {
      idx: 2, vehicle_idx: 2, mech_idx: 2, bay_idx: 2,
      status: 'en_progreso',
      started_at: new Date(Date.now() - 1000 * 60 * 90).toISOString(), // started 1.5h ago
      estimate_approved_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
      aseguradora_idx: 0, // Mapfre BHD
      poliza_no: 'POL-2026-887421',
      reclamo_no: 'REC-26-001234',
      aseguradora_status: 'aprobado',
      notes: 'Reclamo aseguradora: choque trasero. Bumper + luz + alineación.',
      items: [
        { type: 'part',    name: 'Bumper trasero BMW original',      qty: 1, unit_price: 18500, warranty_months: 12 },
        { type: 'part',    name: 'Luz trasera derecha',              qty: 1, unit_price: 5200,  warranty_months: 6  },
        { type: 'service', name: 'Alineación 4 ruedas',              qty: 1, unit_price: 1500,  warranty_months: 0  },
        { type: 'labor',   name: 'Mano de obra hojalatería + pintura', qty: 1, unit_price: 12000, warranty_months: 0 },
      ],
    },
    {
      idx: 3, vehicle_idx: 3, mech_idx: 0, bay_idx: 0,
      status: 'awaiting_parts',
      expected_parts_arrival: new Date(Date.now() + 1000 * 60 * 60 * 24 * 3).toISOString().slice(0, 10),
      estimate_approved_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
      notes: 'Esperando bomba de gasolina y filtro especial.',
      items: [
        { type: 'labor', name: 'Mano de obra cambio bomba gasolina', qty: 1, unit_price: 4500, warranty_months: 0 },
        { type: 'part',  name: 'Bomba gasolina Nissan Sentra',       qty: 1, unit_price: 8500, warranty_months: 6 },
        { type: 'part',  name: 'Filtro de combustible',              qty: 1, unit_price: 950,  warranty_months: 0 },
      ],
    },
    {
      idx: 4, vehicle_idx: 4, mech_idx: 1, bay_idx: 2,
      status: 'listo',
      ready_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
      finished_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
      started_at: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
      estimate_approved_at: new Date(Date.now() - 1000 * 60 * 60 * 7).toISOString(),
      notes: 'Mantenimiento preventivo de 30,000 km. Cliente notificado por WhatsApp.',
      items: [
        { type: 'service', name: 'Mantenimiento 30K Hyundai',         qty: 1, unit_price: 4500, warranty_months: 0 },
        { type: 'part',    name: 'Aceite Hyundai genuino 5W-30 (4L)', qty: 1, unit_price: 1900, warranty_months: 0 },
        { type: 'part',    name: 'Filtro aceite Hyundai',             qty: 1, unit_price: 550,  warranty_months: 0 },
        { type: 'part',    name: 'Filtro aire Hyundai',               qty: 1, unit_price: 850,  warranty_months: 0 },
      ],
    },
    {
      idx: 5, vehicle_idx: 0, mech_idx: 2, bay_idx: 1,
      status: 'facturado',
      started_at:   new Date(Date.now() - 1000 * 60 * 60 * 24 * 35).toISOString(),
      finished_at:  new Date(Date.now() - 1000 * 60 * 60 * 24 * 35 + 1000 * 60 * 60 * 4).toISOString(),
      ready_at:     new Date(Date.now() - 1000 * 60 * 60 * 24 * 35 + 1000 * 60 * 60 * 5).toISOString(),
      completed_date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 34).toISOString(),
      estimate_approved_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 36).toISOString(),
      notes: 'Cambio de aceite + revisión. Servicio cerrado mes pasado.',
      items: [
        { type: 'labor', name: 'Mano de obra cambio de aceite',   qty: 1, unit_price: 800,  warranty_months: 0 },
        { type: 'part',  name: 'Aceite Mobil 1 5W-30 (5L)',        qty: 1, unit_price: 2200, warranty_months: 0 },
        { type: 'part',  name: 'Filtro de aceite Honda original',  qty: 1, unit_price: 650,  warranty_months: 0 },
      ],
    },
  ]

  const woRows = []
  for (const wo of woSeed) {
    const veh = vehRows[wo.vehicle_idx]
    const mech = mechRows[wo.mech_idx]
    const bay = bayRows[wo.bay_idx]
    const labor_total = wo.items.filter(i => i.type !== 'part').reduce((s, i) => s + i.qty * i.unit_price, 0)
    const parts_total = wo.items.filter(i => i.type === 'part').reduce((s, i) => s + i.qty * i.unit_price, 0)
    const itbis = Math.round(parts_total * 0.18 * 100) / 100
    const total = Math.round((labor_total + parts_total + itbis) * 100) / 100

    const woPayload = {
      business_id: bid,
      vehicle_supabase_id: veh.supabase_id,
      client_supabase_id: veh.client.supabase_id,
      technician_empleado_supabase_id: mech.supabase_id,
      bay_supabase_id: bay.supabase_id,
      status: wo.status,
      labor_total, parts_total, itbis, total,
      estimated_total: total, actual_total: total,
      promised_date: new Date(Date.now() + 1000 * 60 * 60 * 24 * 2).toISOString().slice(0, 10),
      validity_until: wo.validity_until || null,
      notes: wo.notes,
      odometer_in_km: veh.odometer_km,
      odometer_out_km: ['listo','facturado'].includes(wo.status) ? veh.odometer_km + 50 : null,
      customer_approval_token: wo.status === 'estimado'
        ? crypto.randomBytes(24).toString('hex') + crypto.randomBytes(8).toString('hex')
        : null,
      estimate_approved_at: wo.estimate_approved_at || null,
      started_at: wo.started_at || null,
      finished_at: wo.finished_at || null,
      ready_at: wo.ready_at || null,
      completed_date: wo.completed_date || null,
      expected_parts_arrival: wo.expected_parts_arrival || null,
      aseguradora_supabase_id: wo.aseguradora_idx != null ? asegRows[wo.aseguradora_idx].supabase_id : null,
      poliza_no: wo.poliza_no || null,
      reclamo_no: wo.reclamo_no || null,
      aseguradora_status: wo.aseguradora_status || null,
    }

    // Lookup by (business_id, vehicle_supabase_id, status, notes) — narrow enough to avoid dupe seeds.
    const { data: existing } = await svc.from('work_orders')
      .select('id, supabase_id')
      .eq('business_id', bid)
      .eq('vehicle_supabase_id', veh.supabase_id)
      .eq('status', wo.status)
      .eq('notes', wo.notes)
      .maybeSingle()

    let row = existing
    if (!row) {
      const { data, error } = await svc.from('work_orders')
        .insert({ ...woPayload, supabase_id: uuid() })
        .select('id, supabase_id').single()
      if (error) throw new Error(`work_orders insert: ${error.message}`)
      row = data

      // Items
      for (const it of wo.items) {
        await svc.from('work_order_items').insert({
          supabase_id: uuid(),
          business_id: bid,
          work_order_supabase_id: row.supabase_id,
          type: it.type,
          name: it.name,
          quantity: it.qty,
          unit_price: it.unit_price,
          total: it.qty * it.unit_price,
          warranty_months: it.warranty_months || 0,
        })
      }
    }
    woRows.push({ ...wo, ...row })
  }
  log('✓', `work_orders + items (${woRows.length} WOs)`)

  // 9) Parts orders — 3 pending, 2 en_camino, 1 received (linked to awaiting_parts WO)
  const awaitingWO = woRows.find(w => w.status === 'awaiting_parts')
  const partsSeed = [
    { wo: awaitingWO, supplier_idx: 2, part_name: 'Bomba gasolina Nissan Sentra', part_sku: 'NS-FP-789',  quantity: 1, unit_cost_estimate: 8500, status: 'pendiente',   expected_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 3).toISOString().slice(0, 10) },
    { wo: awaitingWO, supplier_idx: 0, part_name: 'Filtro de combustible',         part_sku: 'NS-FC-012',  quantity: 1, unit_cost_estimate: 950,  status: 'pendiente',   expected_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 3).toISOString().slice(0, 10) },
    { wo: null,        supplier_idx: 1, part_name: 'Filtro aire Toyota Corolla',    part_sku: 'TY-AF-045',  quantity: 2, unit_cost_estimate: 750,  status: 'en_camino',   expected_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 1).toISOString().slice(0, 10) },
    { wo: null,        supplier_idx: 3, part_name: 'Pastillas freno BMW traseras',  part_sku: 'BM-BR-228',  quantity: 1, unit_cost_estimate: 4200, status: 'en_camino',   expected_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 2).toISOString().slice(0, 10) },
    { wo: null,        supplier_idx: 0, part_name: 'Bujías NGK Iridium',            part_sku: 'NG-IR-102',  quantity: 4, unit_cost_estimate: 1100, status: 'recibido',    received_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), received_barcode: '7891234567890' },
    { wo: null,        supplier_idx: 2, part_name: 'Correa de tiempo Honda',        part_sku: 'HN-TB-456',  quantity: 1, unit_cost_estimate: 3800, status: 'pendiente',   expected_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 5).toISOString().slice(0, 10) },
  ]
  let partsCreated = 0
  for (const p of partsSeed) {
    const supplier = supRows[p.supplier_idx]
    const { data: existing } = await svc.from('parts_orders')
      .select('id')
      .eq('business_id', bid)
      .eq('part_name', p.part_name)
      .eq('supplier_supabase_id', supplier.supabase_id)
      .maybeSingle()
    if (existing) continue
    const { error } = await svc.from('parts_orders').insert({
      supabase_id: uuid(),
      business_id: bid,
      work_order_supabase_id: p.wo?.supabase_id || null,
      supplier_supabase_id: supplier.supabase_id,
      part_name: p.part_name,
      part_sku: p.part_sku,
      quantity: p.quantity,
      unit_cost_estimate: p.unit_cost_estimate,
      expected_at: p.expected_at || null,
      received_at: p.received_at || null,
      received_barcode: p.received_barcode || null,
      status: p.status,
    })
    if (error) throw new Error(`parts_orders insert: ${error.message}`)
    partsCreated++
  }
  log('✓', `parts_orders (${partsCreated} new of ${partsSeed.length})`)

  // 10) Insurance batch — 1 borrador for Universal last month (so the screen has data)
  const universal = asegRows[1]
  const lastMonth = new Date()
  lastMonth.setDate(1)
  lastMonth.setMonth(lastMonth.getMonth() - 1)
  const periodMonth = lastMonth.toISOString().slice(0, 10)
  const { data: existingBatch } = await svc.from('insurance_batches')
    .select('id')
    .eq('business_id', bid)
    .eq('aseguradora_supabase_id', universal.supabase_id)
    .eq('period_month', periodMonth)
    .maybeSingle()
  if (!existingBatch) {
    await svc.from('insurance_batches').insert({
      supabase_id: uuid(),
      business_id: bid,
      aseguradora_supabase_id: universal.supabase_id,
      period_month: periodMonth,
      total_amount: 45_300,
      itbis_amount: 6_911,
      work_order_count: 3,
      status: 'borrador',
      notes: 'Lote demo del mes pasado. Pendiente de generar e-CF consolidado.',
    })
  }
  log('✓', `insurance_batches (Universal ${periodMonth.slice(0,7)})`)

  // 11) Vehicle history photos — sample storage paths so VehicleHistoryModal renders.
  // No actual file upload (would need a binary asset); we just register the rows.
  const photoSeed = []
  const finishedWO = woRows.find(w => w.status === 'listo' || w.status === 'facturado')
  if (finishedWO) {
    const veh = vehRows[woSeed.find(w => w.notes === finishedWO.notes).vehicle_idx]
    photoSeed.push(
      { phase: 'antes',   storage_path: `${bid}/${finishedWO.supabase_id}/antes-demo-1.jpg`,   caption: 'Estado inicial antes del servicio' },
      { phase: 'despues', storage_path: `${bid}/${finishedWO.supabase_id}/despues-demo-1.jpg`, caption: 'Trabajo terminado' },
    )
    let added = 0
    for (const p of photoSeed) {
      const { data: existing } = await svc.from('work_order_photos')
        .select('id').eq('business_id', bid).eq('storage_path', p.storage_path).maybeSingle()
      if (existing) continue
      await svc.from('work_order_photos').insert({
        supabase_id: uuid(),
        business_id: bid,
        work_order_supabase_id: finishedWO.supabase_id,
        vehicle_supabase_id: veh.supabase_id,
        phase: p.phase,
        storage_path: p.storage_path,
        caption: p.caption,
      })
      added++
    }
    log('✓', `work_order_photos (${added} new)`)
  }

  console.log('\n=== Demo seed complete ===')
  console.log(`Login: ${DEMO_EMAIL} / Demo2026!`)
  console.log('Open: /pos → Mecánica → Resumen / Cotizaciones / Suministros / Aseguradoras')
}

run().catch(err => { console.error('\nFAILED:', err.message); process.exit(1) })
