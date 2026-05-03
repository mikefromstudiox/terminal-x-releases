/**
 * Seed the 3 demo accounts referenced in the marketing video prompts:
 *   - Demo Restaurante  (admin@restaurant.demo.terminalxpos.com)
 *   - Demo Car Wash     (admin@carwash.demo.terminalxpos.com)
 *   - Demo Contabilidad (creates if missing)  admin@contabilidad.demo.terminalxpos.com
 *
 * Run:
 *   node scripts/_demo-seed-for-screenshots.mjs        # seed
 *   node scripts/_demo-seed-for-screenshots.mjs --clear # remove seeded rows
 *
 * Tags every row with `__videoseed_` prefix so cleanup is surgical.
 */
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import fs from 'node:fs'

const env = fs.readFileSync('.env', 'utf8')
const get = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1].trim()
const URL = get('SUPABASE_URL') || get('VITE_SUPABASE_URL')
const SVC = get('SUPABASE_SERVICE_ROLE_KEY')

const TAG = '__videoseed_'
const CLEAR = process.argv.includes('--clear')

const sb = createClient(URL, SVC, { auth: { persistSession: false } })
const uid = () => crypto.randomUUID()

// Resolved at runtime — never hard-code BIDs (the original guesses had wrong suffixes).
let RESTAURANT_BID = null
let CARWASH_BID = null
let CONTAB_BID = null

async function findDemoBidByEmail(email) {
  const { data: { users } } = await sb.auth.admin.listUsers({ perPage: 200 })
  const u = users.find(x => x.email === email)
  if (!u) return null
  const { data: staff } = await sb.from('staff').select('business_id').eq('auth_user_id', u.id).limit(1)
  return staff?.[0]?.business_id || null
}

async function ensureContabilidadDemo() {
  const email = 'admin@contabilidad.demo.terminalxpos.com'
  let bid = await findDemoBidByEmail(email)
  if (bid) {
    console.log(`✅ Demo Contabilidad exists: ${bid}`)
    return bid
  }
  console.log('Creating Demo Contabilidad account...')
  // 1. Create auth user
  const { data: { user }, error: authErr } = await sb.auth.admin.createUser({
    email, password: 'Demo2026!', email_confirm: true,
  })
  if (authErr) throw authErr
  // 2. Create business
  const { data: biz } = await sb.from('businesses').insert({
    owner_id: user.id, name: 'Demo Contabilidad', plan: 'pro_max', is_demo: true,
    rnc: '000000001', phone: '+18095550100',
    settings: { itbis_pct: 18, ley_pct: 10, language: 'es', business_type: 'contabilidad', biz_type: 'contabilidad' },
  }).select('id').single()
  bid = biz.id
  // 3. Set app_metadata.business_id (RLS uses this)
  await sb.auth.admin.updateUserById(user.id, { app_metadata: { business_id: bid } })
  // 4. Staff row
  await sb.from('staff').insert({
    business_id: bid, auth_user_id: user.id, name: 'Demo Contadora',
    username: 'owner', role: 'owner', active: true,
  })
  // 5. License
  const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const seg = () => Array.from({ length: 4 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('')
  const { data: planRow } = await sb.from('plans').select('id,max_users').eq('name', 'pro_max').maybeSingle()
  await sb.from('licenses').insert({
    business_id: bid, plan_id: planRow?.id || null,
    license_key: `TXL-${seg()}-${seg()}-${seg()}`,
    status: 'active', platform: 'web',
    activated_at: new Date().toISOString(),
    max_users: planRow?.max_users || 999,
    expires_at: new Date(Date.now() + 365 * 86400000).toISOString(),
  })
  // 6. app_settings business_type cloud-synced
  await sb.from('app_settings').upsert({
    business_id: bid, key: 'business_type', value: 'contabilidad',
    device_hwid: null, is_device_local: false, supabase_id: uid(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'business_id,key,device_hwid' })
  console.log(`✅ Created Demo Contabilidad: ${bid}`)
  return bid
}

// ============================================================================
// CLEANUP
// ============================================================================
async function clearAll() {
  console.log('Clearing video-seed rows...')
  CONTAB_BID = await findDemoBidByEmail('admin@contabilidad.demo.terminalxpos.com')
  for (const bid of [RESTAURANT_BID, CARWASH_BID, CONTAB_BID].filter(Boolean)) {
    await sb.from('ticket_items').delete().eq('business_id', bid).like('name', `${TAG}%`)
    await sb.from('payments').delete().eq('business_id', bid).like('notes', `${TAG}%`).then(() => {}, () => {})
    await sb.from('tickets').delete().eq('business_id', bid).like('notes', `${TAG}%`)
    await sb.from('mesas').delete().eq('business_id', bid).like('name', `${TAG}%`)
    await sb.from('services').delete().eq('business_id', bid).like('name', `${TAG}%`)
    await sb.from('categorias_servicio').delete().eq('business_id', bid).like('nombre', `${TAG}%`)
    await sb.from('empleados').delete().eq('business_id', bid).like('nombre', `${TAG}%`)
    await sb.from('inventory_items').delete().eq('business_id', bid).like('name', `${TAG}%`)
    await sb.from('clients').delete().eq('business_id', bid).like('nombre', `${TAG}%`).then(() => {}, () => {})
    await sb.from('accounting_clients').delete().eq('business_id', bid).like('client_name', `${TAG}%`).then(() => {}, () => {})
  }
  console.log('✅ Cleared')
}

// ============================================================================
// SEED RESTAURANT (Demo Restaurante)
// ============================================================================
async function seedRestaurant() {
  console.log('\n--- Seeding Demo Restaurante ---')
  const bid = RESTAURANT_BID

  // 6 mesas with mixed states for the screenshot
  const mesaStates = [
    { name: 'Mesa 1', status: 'libre',     guests: 0, sort: 0 },
    { name: 'Mesa 2', status: 'ocupada',   guests: 4, sort: 1 },
    { name: 'Mesa 3', status: 'ocupada',   guests: 2, sort: 2 },
    { name: 'Mesa 4', status: 'acuenta',   guests: 3, sort: 3 },
    { name: 'Terraza 1', status: 'libre',  guests: 0, sort: 4 },
    { name: 'Barra',  status: 'ocupada',   guests: 1, sort: 5 },
  ]
  const mesaIds = []
  for (const m of mesaStates) {
    const { data: mesa } = await sb.from('mesas').insert({
      supabase_id: uid(), business_id: bid, active: true,
      name: `${TAG}${m.name}`, sort_order: m.sort, status: m.status, capacity: 4,
      guests_count: m.guests,
      seated_at: m.status !== 'libre' ? new Date(Date.now() - (Math.random() * 60 + 10) * 60000).toISOString() : null,
      bill_requested_at: m.status === 'acuenta' ? new Date(Date.now() - 5 * 60000).toISOString() : null,
      rev: m.status === 'libre' ? 0 : (m.status === 'ocupada' ? 1 : 2),
    }).select('id,supabase_id').single()
    mesaIds.push({ ...mesa, name: m.name, status: m.status })
  }
  console.log(`✅ ${mesaStates.length} mesas (3 ocupadas, 1 acuenta, 2 libre)`)

  // 4 categorías + 14 menu items
  const cats = ['Entradas', 'Principales', 'Bebidas', 'Postres']
  for (let i = 0; i < cats.length; i++) {
    await sb.from('categorias_servicio').insert({
      supabase_id: uid(), business_id: bid, active: true,
      nombre: `${TAG}${cats[i]}`, orden: i,
    })
  }

  const items = [
    { name: 'Empanada de Pollo',   course: 'entradas',    price: 150, cost: 50, cat: 'Entradas' },
    { name: 'Tostones con Salsa',  course: 'entradas',    price: 200, cost: 70, cat: 'Entradas' },
    { name: 'Yaroa de Pollo',      course: 'entradas',    price: 350, cost: 120, cat: 'Entradas' },
    { name: 'Chicharrón de Cerdo', course: 'entradas',    price: 425, cost: 150, cat: 'Entradas' },
    { name: 'Pollo a la Plancha',  course: 'principales', price: 550, cost: 180, cat: 'Principales' },
    { name: 'Chivo Guisado',       course: 'principales', price: 650, cost: 220, cat: 'Principales' },
    { name: 'Pescado Frito',       course: 'principales', price: 750, cost: 280, cat: 'Principales' },
    { name: 'Mofongo Camarones',   course: 'principales', price: 850, cost: 320, cat: 'Principales' },
    { name: 'La Bandera',          course: 'principales', price: 475, cost: 175, cat: 'Principales' },
    { name: 'Cerveza Presidente',  course: 'bebidas',     price: 175, cost: 80, cat: 'Bebidas' },
    { name: 'Morir Soñando',       course: 'bebidas',     price: 150, cost: 50, cat: 'Bebidas' },
    { name: 'Jugo de Chinola',     course: 'bebidas',     price: 120, cost: 40, cat: 'Bebidas' },
    { name: 'Flan de Coco',        course: 'postres',     price: 220, cost: 60, cat: 'Postres' },
    { name: 'Tres Leches',         course: 'postres',     price: 250, cost: 75, cat: 'Postres' },
  ]
  const svcMap = {}
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const { data: svc } = await sb.from('services').insert({
      supabase_id: uid(), business_id: bid, active: true,
      name: `${TAG}${it.name}`, category: `${TAG}${it.cat}`,
      price: it.price, cost: it.cost, aplica_itbis: 1, is_wash: 0,
      no_commission: false, commission_washer: true, commission_seller: true, commission_cashier: true,
      is_menu_item: true, course: it.course, sort_order: i,
    }).select('id,supabase_id').single()
    svcMap[it.name] = svc
  }
  console.log(`✅ ${cats.length} categorías + ${items.length} platos`)

  // 4 empleados
  const staff = [
    { nombre: 'Carlos R.',  tipo: 'vendedor', role: 'cashier', cedula: '00100000001' },
    { nombre: 'María T.',   tipo: 'vendedor', role: 'cashier', cedula: '00100000002' },
    { nombre: 'Lucía P.',   tipo: 'cajero',   role: 'cashier', cedula: '00100000003' },
    { nombre: 'Juan M.',    tipo: 'lavador',  role: 'none',    cedula: '00100000004' },
  ]
  for (const s of staff) {
    await sb.from('empleados').insert({
      supabase_id: uid(), business_id: bid, active: true,
      nombre: `${TAG}${s.nombre}`, tipo: s.tipo, role: s.role,
      cedula: s.cedula, start_date: new Date().toISOString().slice(0, 10),
    })
  }
  console.log(`✅ ${staff.length} empleados`)

  // Active tickets on the ocupada/acuenta mesas (so KDS shows orders + Resumen has live data)
  const activeTickets = [
    { mesa: 'Mesa 2', items: ['Empanada de Pollo', 'Cerveza Presidente', 'Pollo a la Plancha'], total: 875 },
    { mesa: 'Mesa 3', items: ['Yaroa de Pollo', 'Morir Soñando'], total: 500 },
    { mesa: 'Mesa 4', items: ['Mofongo Camarones', 'Cerveza Presidente', 'Cerveza Presidente', 'Tres Leches'], total: 1450 },
    { mesa: 'Barra',  items: ['Cerveza Presidente'], total: 175 },
  ]
  for (const t of activeTickets) {
    const mesa = mesaIds.find(m => m.name === t.mesa)
    if (!mesa) continue
    const ticketSid = uid()
    const { data: ticket } = await sb.from('tickets').insert({
      supabase_id: ticketSid, business_id: bid,
      mesa_supabase_id: mesa.supabase_id,
      status: 'abierto', total: t.total, subtotal: Math.round(t.total / 1.18), itbis: t.total - Math.round(t.total / 1.18),
      notes: `${TAG}active`, created_at: new Date(Date.now() - 30 * 60000).toISOString(),
    }).select('id').single()
    for (const itName of t.items) {
      const svc = svcMap[itName]
      if (!svc) continue
      const it = items.find(i => i.name === itName)
      // Half the items are KDS-fired (showing realistic in-progress state)
      const fired = Math.random() > 0.4
      await sb.from('ticket_items').insert({
        supabase_id: uid(), business_id: bid,
        ticket_id: ticket.id, ticket_supabase_id: ticketSid,
        service_id: svc.id, service_supabase_id: svc.supabase_id,
        name: `${TAG}${itName}`, price: it.price, quantity: 1, itbis: Math.round(it.price * 0.18),
        course: it.course, is_wash: false, cost: it.cost,
        kds_fired_at: fired ? new Date(Date.now() - 10 * 60000).toISOString() : null,
      })
    }
  }
  console.log(`✅ ${activeTickets.length} tickets activos con items en cocina`)

  // Recently-paid tickets so /reports + Resumen show real numbers
  const paidCount = 18
  for (let i = 0; i < paidCount; i++) {
    const ticketSid = uid()
    const itemCount = 2 + Math.floor(Math.random() * 4)
    const { data: ticket, error: insErr } = await sb.from('tickets').insert({
      supabase_id: ticketSid, business_id: bid,
      status: 'cobrado', payment_method: ['efectivo', 'tarjeta', 'transferencia'][i % 3],
      paid_at: new Date(Date.now() - (i * 90 + Math.random() * 60) * 60000).toISOString(),
      created_at: new Date(Date.now() - (i * 90 + 15 + Math.random() * 30) * 60000).toISOString(),
      notes: `${TAG}paid`, total: 0, subtotal: 0, itbis: 0,
    }).select('id').single()
    if (insErr) { console.log('  ticket insert error:', insErr.message); continue }
    if (!ticket) continue
    let total = 0
    for (let k = 0; k < itemCount; k++) {
      const it = items[Math.floor(Math.random() * items.length)]
      const svc = svcMap[it.name]
      if (!svc) continue
      await sb.from('ticket_items').insert({
        supabase_id: uid(), business_id: bid,
        ticket_id: ticket.id, ticket_supabase_id: ticketSid,
        service_id: svc.id, service_supabase_id: svc.supabase_id,
        name: `${TAG}${it.name}`, price: it.price, quantity: 1, itbis: Math.round(it.price * 0.18),
        course: it.course, is_wash: false, cost: it.cost,
        kds_fired_at: new Date(Date.now() - (i * 90 + 12) * 60000).toISOString(),
      })
      total += it.price
    }
    await sb.from('tickets').update({
      total, subtotal: Math.round(total / 1.18), itbis: total - Math.round(total / 1.18),
    }).eq('id', ticket.id)
  }
  console.log(`✅ ${paidCount} tickets cobrados (con totales realistas)`)
}

// ============================================================================
// SEED CARWASH (Demo Car Wash) — for the May 15 e-CF deadline video
// ============================================================================
async function seedCarwash() {
  console.log('\n--- Seeding Demo Car Wash ---')
  const bid = CARWASH_BID

  const services = [
    { name: 'Lavado Express',     price: 250, cost: 80 },
    { name: 'Lavado Completo',    price: 450, cost: 150 },
    { name: 'Lavado + Encerado',  price: 850, cost: 280 },
    { name: 'Detallado Premium',  price: 2500, cost: 800 },
    { name: 'Limpieza de Motor',  price: 750, cost: 200 },
    { name: 'Aspirado',           price: 200, cost: 50 },
    { name: 'Cambio de Aceite',   price: 1200, cost: 600 },
  ]
  const svcMap = {}
  for (let i = 0; i < services.length; i++) {
    const s = services[i]
    const { data: svc } = await sb.from('services').insert({
      supabase_id: uid(), business_id: bid, active: true,
      name: `${TAG}${s.name}`, category: '__videoseed_Servicios',
      price: s.price, cost: s.cost, aplica_itbis: 1, is_wash: 1,
      no_commission: false, commission_washer: true, commission_seller: true, commission_cashier: true,
      is_menu_item: false, sort_order: i,
    }).select('id,supabase_id').single()
    svcMap[s.name] = svc
  }
  console.log(`✅ ${services.length} servicios`)

  const staff = [
    { nombre: 'Pedro M.',  tipo: 'lavador', role: 'none', cedula: '00200000001' },
    { nombre: 'Ramón A.',  tipo: 'lavador', role: 'none', cedula: '00200000002' },
    { nombre: 'José L.',   tipo: 'lavador', role: 'none', cedula: '00200000003' },
    { nombre: 'Andrea V.', tipo: 'cajero',  role: 'cashier', cedula: '00200000004' },
  ]
  for (const s of staff) {
    await sb.from('empleados').insert({
      supabase_id: uid(), business_id: bid, active: true,
      nombre: `${TAG}${s.nombre}`, tipo: s.tipo, role: s.role,
      cedula: s.cedula, start_date: new Date().toISOString().slice(0, 10),
    })
  }
  console.log(`✅ ${staff.length} empleados`)

  // Recently paid tickets — mix of B01 + E31 (e-CF)
  const paidCount = 22
  for (let i = 0; i < paidCount; i++) {
    const ticketSid = uid()
    const s = services[Math.floor(Math.random() * services.length)]
    const svc = svcMap[s.name]
    if (!svc) continue
    const isECF = i % 3 === 0
    const ncfNum = String(1000 + i).padStart(10, '0')
    const ncf = isECF ? `E31${ncfNum}` : `B0200${String(i).padStart(6, '0')}`
    const ecf_result = isECF ? {
      status: 'aceptado',
      doc_number: ncf,
      submitted_at: new Date(Date.now() - i * 60 * 60000).toISOString(),
      tracking_id: `TX-${i.toString().padStart(6, '0')}`,
    } : null
    const { data: ticket, error: insErr2 } = await sb.from('tickets').insert({
      supabase_id: ticketSid, business_id: bid,
      status: 'cobrado', payment_method: ['efectivo', 'tarjeta'][i % 2],
      paid_at: new Date(Date.now() - i * 60 * 60000).toISOString(),
      created_at: new Date(Date.now() - (i * 60 + 5) * 60000).toISOString(),
      notes: `${TAG}paid`,
      ncf, ncf_type: isECF ? 'E31' : 'B02',
      ecf_result: ecf_result || {},
      total: s.price, subtotal: Math.round(s.price / 1.18), itbis: s.price - Math.round(s.price / 1.18),
    }).select('id').single()
    if (insErr2) { console.log('  cw ticket insert error:', insErr2.message); continue }
    if (!ticket) continue
    await sb.from('ticket_items').insert({
      supabase_id: uid(), business_id: bid,
      ticket_id: ticket.id, ticket_supabase_id: ticketSid,
      service_id: svc.id, service_supabase_id: svc.supabase_id,
      name: `${TAG}${s.name}`,
      price: s.price, quantity: 1, itbis: Math.round(s.price * 0.18),
      is_wash: true, cost: s.cost,
    })
  }
  console.log(`✅ ${paidCount} tickets cobrados (mix B01 + E31 e-CF)`)
}

// ============================================================================
// SEED CONTABILIDAD (Demo Contabilidad) — for the contadora portfolio video
// ============================================================================
async function seedContabilidad() {
  console.log('\n--- Seeding Demo Contabilidad ---')
  const bid = CONTAB_BID
  if (!bid) throw new Error('Contabilidad bid not set')

  // Try inserting into accounting_clients (the firm's client roster).
  // Schema verified earlier — has client_name, client_rnc, status, etc.
  const fakeClients = [
    { name: 'Restaurante La Cocina',        rnc: '101234001', sector: 'restaurante',     monthly_fee: 8500 },
    { name: 'Ferretería del Norte',         rnc: '101234002', sector: 'ferretería',      monthly_fee: 6500 },
    { name: 'Salón Beauty Studio',          rnc: '101234003', sector: 'salón',           monthly_fee: 4500 },
    { name: 'Transporte Express SRL',       rnc: '101234004', sector: 'transporte',      monthly_fee: 12000 },
    { name: 'Distribuidora El Roble',       rnc: '101234005', sector: 'distribución',    monthly_fee: 9500 },
    { name: 'Constructora Hermanos Jiménez', rnc: '101234006', sector: 'construcción',   monthly_fee: 18000 },
    { name: 'Farmacia Comunitaria',         rnc: '101234007', sector: 'farmacia',        monthly_fee: 7000 },
    { name: 'Café del Conde',               rnc: '101234008', sector: 'cafetería',       monthly_fee: 5500 },
  ]

  for (const c of fakeClients) {
    try {
      await sb.from('accounting_clients').insert({
        supabase_id: uid(), business_id: bid,
        client_name: `${TAG}${c.name}`, client_rnc: c.rnc,
        sector: c.sector, monthly_fee: c.monthly_fee,
        status: 'active', active: true,
      })
    } catch (e) {
      // accounting_clients table may have different shape; fall back to staff/clients
      console.log(`  (accounting_clients insert skipped: ${e?.message?.slice(0,80)})`)
      break
    }
  }
  console.log(`✅ ${fakeClients.length} accounting clients in the portfolio`)
}

// ============================================================================
// MAIN
// ============================================================================
// Resolve BIDs from Supabase before doing anything (lookup by demo email).
RESTAURANT_BID = await findDemoBidByEmail('admin@restaurant.demo.terminalxpos.com')
CARWASH_BID    = await findDemoBidByEmail('admin@carwash.demo.terminalxpos.com')
console.log(`Resolved: restaurant=${RESTAURANT_BID?.slice(0,8)} carwash=${CARWASH_BID?.slice(0,8)}`)
if (!RESTAURANT_BID) throw new Error('Demo Restaurante account not found')
if (!CARWASH_BID) throw new Error('Demo Car Wash account not found')

if (CLEAR) {
  CONTAB_BID = await findDemoBidByEmail('admin@contabilidad.demo.terminalxpos.com')
  await clearAll()
} else {
  console.log('Seeding demo accounts for video screenshots...\n')
  await clearAll()
  await seedRestaurant()
  await seedCarwash()
  CONTAB_BID = await ensureContabilidadDemo()
  await seedContabilidad()
  console.log('\n✨ All demos seeded.')
  console.log('\n=== LOGIN CREDENTIALS for screenshots ===')
  console.log('terminalxpos.com')
  console.log('  Restaurante:    admin@restaurant.demo.terminalxpos.com / Demo2026!')
  console.log('  Car Wash:       admin@carwash.demo.terminalxpos.com / Demo2026!')
  console.log('  Contabilidad:   admin@contabilidad.demo.terminalxpos.com / Demo2026!')
  console.log('\nRun with --clear when done to wipe seeded rows.')
}
