/**
 * seedLicoreriaCarniceria.js — Two new demo verticals for Terminal X sales.
 *
 * Mirrors scripts/seedDemoBusinesses.js row pattern exactly. Idempotent.
 *   node scripts/seedLicoreriaCarniceria.js
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import crypto from 'crypto'

const envPath = resolve(import.meta.dirname, '..', '.env')
try {
  const envContent = readFileSync(envPath, 'utf8')
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
} catch {}

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const sb  = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

const uuid  = () => crypto.randomUUID()
const pick  = (a) => a[Math.floor(Math.random() * a.length)]
const rand  = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo
const money = (n) => Math.round(n * 100) / 100
const daysAgo = (d) => { const dt = new Date(); dt.setDate(dt.getDate()-d); dt.setHours(rand(8,20),rand(0,59),rand(0,59),0); return dt.toISOString() }
const phone = () => `809${rand(2,9)}${String(rand(0,9999999)).padStart(7,'0')}`
const ncfStr = (prefix, n) => `${prefix}${String(n).padStart(8,'0')}`

const PIN_HASH = crypto.createHash('sha256').update('1234').digest('hex')
const PASSWORD = 'Demo2026!'
const CITY = 'Santo Domingo'

// ── Licoreria inventory (25 items) ─────────────────────────────────────────
const LICORERIA_INV = [
  // Ron
  { cat: 'Ron',       sku: 'RON-BRU-ANE', barcode: '7460000100011', name: 'Ron Brugal Anejo 750ml',       price: 650,  cost: 420 },
  { cat: 'Ron',       sku: 'RON-BRU-EXT', barcode: '7460000100028', name: 'Ron Brugal Extra Viejo 750ml', price: 895,  cost: 560 },
  { cat: 'Ron',       sku: 'RON-BAR-IMP', barcode: '7460000100035', name: 'Ron Barcelo Imperial 750ml',   price: 1250, cost: 780 },
  { cat: 'Ron',       sku: 'RON-BAR-ANE', barcode: '7460000100042', name: 'Ron Barcelo Anejo 750ml',      price: 695,  cost: 445 },
  { cat: 'Ron',       sku: 'RON-BER-1873',barcode: '7460000100059', name: 'Ron Bermudez 1873 750ml',      price: 1450, cost: 910 },
  { cat: 'Ron',       sku: 'RON-MAC-ANE', barcode: '7460000100066', name: 'Ron Macorix Anejo 750ml',      price: 575,  cost: 360 },
  // Whisky
  { cat: 'Whisky',    sku: 'WHI-JW-RED',  barcode: '5000267023625', name: 'Johnnie Walker Red 750ml',     price: 1650, cost: 1080 },
  { cat: 'Whisky',    sku: 'WHI-JW-BLK',  barcode: '5000267024004', name: 'Johnnie Walker Black 750ml',   price: 2850, cost: 1920 },
  { cat: 'Whisky',    sku: 'WHI-CHI-12',  barcode: '5000299211014', name: 'Chivas Regal 12 Anos 750ml',   price: 2450, cost: 1640 },
  { cat: 'Whisky',    sku: 'WHI-BUC-12',  barcode: '5000196002105', name: "Buchanan's 12 Anos 750ml",     price: 2950, cost: 1980 },
  // Vodka
  { cat: 'Vodka',     sku: 'VOD-ABS-750', barcode: '7312040017041', name: 'Absolut Vodka 750ml',          price: 1350, cost: 890 },
  { cat: 'Vodka',     sku: 'VOD-SMI-750', barcode: '0082000001003', name: 'Smirnoff Vodka 750ml',         price: 895,  cost: 580 },
  // Cerveza
  { cat: 'Cerveza',   sku: 'CER-PRE-GRA', barcode: '7460012345678', name: 'Cerveza Presidente Grande',    price: 150,  cost: 95  },
  { cat: 'Cerveza',   sku: 'CER-PRE-PEQ', barcode: '7460012345685', name: 'Cerveza Presidente Pequena',   price: 90,   cost: 55  },
  { cat: 'Cerveza',   sku: 'CER-MOD-355', barcode: '7501064191428', name: 'Cerveza Modelo Especial 355ml',price: 195,  cost: 125 },
  { cat: 'Cerveza',   sku: 'CER-COR-355', barcode: '7501064113154', name: 'Cerveza Corona Extra 355ml',   price: 185,  cost: 120 },
  { cat: 'Cerveza',   sku: 'CER-HEI-330', barcode: '8712000037703', name: 'Cerveza Heineken 330ml',       price: 175,  cost: 115 },
  // Vino
  { cat: 'Vino',      sku: 'VIN-TIN-CAB', barcode: '7804320210019', name: 'Vino Tinto Cabernet 750ml',    price: 950,  cost: 620 },
  { cat: 'Vino',      sku: 'VIN-TIN-MAL', barcode: '7790975000111', name: 'Vino Tinto Malbec 750ml',      price: 1150, cost: 750 },
  { cat: 'Vino',      sku: 'VIN-BLA-CHA', barcode: '3263280094603', name: 'Vino Blanco Chardonnay 750ml', price: 890,  cost: 580 },
  { cat: 'Vino',      sku: 'VIN-ESP-BRU', barcode: '8410261511008', name: 'Vino Espumoso Brut 750ml',     price: 1450, cost: 960 },
  // Mixers / Refrescos
  { cat: 'Mixers',    sku: 'MIX-COC-2L',  barcode: '7460012399881', name: 'Coca Cola 2L',                 price: 175,  cost: 110 },
  { cat: 'Mixers',    sku: 'MIX-SPR-2L',  barcode: '7460012399898', name: 'Sprite 2L',                    price: 165,  cost: 105 },
  { cat: 'Mixers',    sku: 'MIX-AGU-TON', barcode: '7460012399904', name: 'Agua Tonica Schweppes 355ml',  price: 95,   cost: 60  },
  { cat: 'Mixers',    sku: 'MIX-RED-250', barcode: '9002490100070', name: 'Red Bull 250ml',               price: 145,  cost: 95  },
  { cat: 'Hielo',     sku: 'HIE-BOL-5LB', barcode: '7460098765432', name: 'Bolsa de Hielo 5lb',           price: 75,   cost: 30  },
]

// ── Carniceria inventory (26 items, price per libra) ──────────────────────
const CARNICERIA_INV = [
  // Res
  { cat: 'Res',      sku: 'RES-BIS-LB',  barcode: '2100000000011', name: 'Bistec de Res (lb)',           price: 240, cost: 165 },
  { cat: 'Res',      sku: 'RES-MOL-LB',  barcode: '2100000000028', name: 'Carne Molida de Res (lb)',     price: 195, cost: 135 },
  { cat: 'Res',      sku: 'RES-PIN-LB',  barcode: '2100000000035', name: 'Pincho de Res (lb)',           price: 225, cost: 150 },
  { cat: 'Res',      sku: 'RES-LOM-LB',  barcode: '2100000000042', name: 'Lomo de Res (lb)',             price: 320, cost: 220 },
  { cat: 'Res',      sku: 'RES-COS-LB',  barcode: '2100000000059', name: 'Costilla de Res (lb)',         price: 185, cost: 125 },
  { cat: 'Res',      sku: 'RES-HIG-LB',  barcode: '2100000000066', name: 'Higado de Res (lb)',           price: 125, cost: 80  },
  // Pollo
  { cat: 'Pollo',    sku: 'POL-ENT-LB',  barcode: '2100000001011', name: 'Pollo Entero (lb)',            price: 85,  cost: 55  },
  { cat: 'Pollo',    sku: 'POL-MUS-LB',  barcode: '2100000001028', name: 'Muslo de Pollo (lb)',          price: 95,  cost: 65  },
  { cat: 'Pollo',    sku: 'POL-PEC-LB',  barcode: '2100000001035', name: 'Pechuga de Pollo (lb)',        price: 135, cost: 95  },
  { cat: 'Pollo',    sku: 'POL-ALI-LB',  barcode: '2100000001042', name: 'Alitas de Pollo (lb)',         price: 120, cost: 80  },
  { cat: 'Pollo',    sku: 'POL-HIG-LB',  barcode: '2100000001059', name: 'Higadito de Pollo (lb)',       price: 75,  cost: 50  },
  // Cerdo
  { cat: 'Cerdo',    sku: 'CER-CHU-LB',  barcode: '2100000002011', name: 'Chuleta de Cerdo (lb)',        price: 165, cost: 115 },
  { cat: 'Cerdo',    sku: 'CER-COS-LB',  barcode: '2100000002028', name: 'Costilla de Cerdo (lb)',       price: 155, cost: 105 },
  { cat: 'Cerdo',    sku: 'CER-LOM-LB',  barcode: '2100000002035', name: 'Lomo de Cerdo (lb)',           price: 185, cost: 125 },
  { cat: 'Cerdo',    sku: 'CER-CHI-LB',  barcode: '2100000002042', name: 'Chicharron de Cerdo (lb)',     price: 195, cost: 130 },
  { cat: 'Cerdo',    sku: 'CER-PER-LB',  barcode: '2100000002059', name: 'Pernil de Cerdo (lb)',         price: 175, cost: 120 },
  // Embutidos
  { cat: 'Embutidos',sku: 'EMB-SAL-LB',  barcode: '2100000003011', name: 'Salami Inducero (lb)',         price: 145, cost: 95  },
  { cat: 'Embutidos',sku: 'EMB-LON-LB',  barcode: '2100000003028', name: 'Longaniza (lb)',               price: 165, cost: 110 },
  { cat: 'Embutidos',sku: 'EMB-JAM-LB',  barcode: '2100000003035', name: 'Jamon de Cocinar (lb)',        price: 195, cost: 135 },
  { cat: 'Embutidos',sku: 'EMB-QUE-LB',  barcode: '2100000003042', name: 'Queso Amarillo (lb)',          price: 185, cost: 125 },
  { cat: 'Embutidos',sku: 'EMB-CHO-LB',  barcode: '2100000003059', name: 'Chorizo Espanol (lb)',         price: 225, cost: 150 },
  // Mariscos
  { cat: 'Mariscos', sku: 'MAR-CAM-LB',  barcode: '2100000004011', name: 'Camaron Mediano (lb)',         price: 385, cost: 265 },
  { cat: 'Mariscos', sku: 'MAR-CAM-GRA', barcode: '2100000004028', name: 'Camaron Grande (lb)',          price: 495, cost: 340 },
  { cat: 'Mariscos', sku: 'MAR-PES-MER', barcode: '2100000004035', name: 'Filete de Mero (lb)',          price: 325, cost: 220 },
  { cat: 'Mariscos', sku: 'MAR-PES-CHI', barcode: '2100000004042', name: 'Chillo Entero (lb)',           price: 285, cost: 195 },
  { cat: 'Mariscos', sku: 'MAR-PUL-LB',  barcode: '2100000004059', name: 'Pulpo Limpio (lb)',            price: 425, cost: 290 },
]

const TENANTS = [
  {
    type: 'licoreria',
    bizName: 'Licoreria Demo',
    email: 'admin@licoreria.demo.terminalxpos.com',
    rnc: '131000001',
    address: 'Calle El Conde No. 120, Zona Colonial, Santo Domingo',
    inventory: LICORERIA_INV,
    employees: [
      { nombre: 'Jose Cajero',    tipo: 'cajero',   role: 'cashier', salary: 22000, comision_pct: 0 },
      { nombre: 'Sofia Cajera',   tipo: 'cajero',   role: 'cashier', salary: 22000, comision_pct: 0 },
      { nombre: 'Miguel Manager', tipo: 'vendedor', role: 'manager', salary: 35000, comision_pct: 5 },
    ],
  },
  {
    type: 'carniceria',
    bizName: 'Carniceria Demo',
    email: 'admin@carniceria.demo.terminalxpos.com',
    rnc: '131000002',
    address: 'Av. Duarte No. 450, Santiago de los Caballeros',
    inventory: CARNICERIA_INV,
    employees: [
      { nombre: 'Carmen Cajera',  tipo: 'cajero',   role: 'cashier', salary: 22000, comision_pct: 0 },
      { nombre: 'Rosa Cajera',    tipo: 'cajero',   role: 'cashier', salary: 22000, comision_pct: 0 },
      { nombre: 'Pedro Carnicero',tipo: 'vendedor', role: 'manager', salary: 32000, comision_pct: 8 },
    ],
  },
]

const FIRST = ['Juan','Maria','Pedro','Ana','Carlos','Lucia','Miguel','Carmen','Jose','Rosa','Francisco','Elena']
const LAST  = ['Rodriguez','Santos','Fernandez','Martinez','Perez','Garcia','Hernandez','Diaz','Ramirez','Gonzalez']
const COMP  = ['Colmado Central SRL','Distribuidora Caribe SA','Inversiones Duarte SRL']

async function seedTenant(t, planId) {
  // Skip if exists
  const { data: existing } = await sb.from('businesses').select('id, settings').eq('name', t.bizName)
  const dupe = (existing || []).find(b => (b.settings?.business_type || b.settings?.biz_business_type) === t.type)
  if (dupe) {
    console.log(`  [skip] ${t.bizName} already exists id=${dupe.id}`)
    return { ok: true, businessId: dupe.id, created: false }
  }

  // 1. Business
  const businessId = uuid()
  const settings = {
    ciudad: CITY, biz_city: CITY,
    business_type: t.type, biz_business_type: t.type,
    biz_type: '', biz_name: t.bizName, biz_rnc: t.rnc, biz_phone: '+18098282971',
  }
  const { error: bizErr } = await sb.from('businesses').insert({
    id: businessId, name: t.bizName, rnc: t.rnc, address: t.address,
    phone: '+18098282971', email: t.email, settings, plan: 'pro_max',
  })
  if (bizErr) return { ok: false, error: `business: ${bizErr.message}` }

  // 2. Auth user
  let authUserId
  const { data: authCreated, error: authErr } = await sb.auth.admin.createUser({
    email: t.email, password: PASSWORD, email_confirm: true,
    user_metadata: { business_id: businessId, business_type: t.type, demo: true },
  })
  if (authErr) {
    if (/registered|exists|duplicate/i.test(authErr.message)) {
      const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 })
      const existing = list?.users?.find(u => u.email?.toLowerCase() === t.email.toLowerCase())
      if (!existing) return { ok: false, error: `auth lookup: ${authErr.message}` }
      authUserId = existing.id
      await sb.auth.admin.updateUserById(authUserId, {
        password: PASSWORD, email_confirm: true,
        user_metadata: { business_id: businessId, business_type: t.type, demo: true },
      })
    } else return { ok: false, error: `auth: ${authErr.message}` }
  } else authUserId = authCreated.user.id

  // 3. Owner empleado
  const ownerSupId = uuid()
  const { data: ownerEmp, error: empErr } = await sb.from('empleados').insert({
    business_id: businessId, supabase_id: ownerSupId,
    nombre: 'Mike Owner', tipo: 'hybrid', role: 'owner', salary: 50000,
    start_date: new Date(Date.now() - 365*864e5).toISOString().slice(0,10),
    cedula: '001-0000001-1', phone: '+18098282971', email: t.email,
    comision_pct: 0, active: true,
  }).select('id').single()
  if (empErr) return { ok: false, error: `owner empleado: ${empErr.message}` }

  // 4. Staff (login)
  const { error: staffErr } = await sb.from('staff').insert({
    business_id: businessId, supabase_id: uuid(),
    auth_user_id: authUserId, name: 'Mike Owner', username: 'admin',
    pin_hash: PIN_HASH, role: 'owner', cedula: '001-0000001-1',
    start_date: new Date(Date.now() - 365*864e5).toISOString().slice(0,10),
    discount_pct: 0, commission_pct: 0, active: true,
  })
  if (staffErr) return { ok: false, error: `staff: ${staffErr.message}` }

  // 5. License
  const licKey = `TXL-${rand(1000,9999)}-${rand(1000,9999)}-${rand(1000,9999)}`
  const { error: licErr } = await sb.from('licenses').insert({
    business_id: businessId, plan_id: planId, license_key: licKey,
    hardware_id: `demo-${t.type}-${rand(100000,999999)}`,
    status: 'active', platform: 'both',
    activated_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 30*864e5).toISOString(),
    max_users: 999,
    notes: `DEMO ${t.type} — seeded ${new Date().toISOString().slice(0,10)}`,
  })
  if (licErr) console.log(`    [warn] license: ${licErr.message}`)

  // 6. Additional empleados
  const empleados = [{ id: ownerEmp.id, supabase_id: ownerSupId, nombre: 'Mike Owner', tipo: 'hybrid' }]
  for (const e of t.employees) {
    const sId = uuid()
    const { data: row, error } = await sb.from('empleados').insert({
      business_id: businessId, supabase_id: sId,
      nombre: e.nombre, tipo: e.tipo, role: e.role, salary: e.salary,
      comision_pct: e.comision_pct,
      start_date: new Date(Date.now() - rand(60, 720)*864e5).toISOString().slice(0,10),
      cedula: `001-${String(rand(1000000,9999999)).padStart(7,'0')}-${rand(1,9)}`,
      phone: phone(), active: true,
    }).select('id, supabase_id, nombre, tipo, comision_pct').single()
    if (error) { console.log(`    [warn] empleado ${e.nombre}: ${error.message}`); continue }
    empleados.push(row)
  }
  const cajeros = empleados.filter(e => e.tipo === 'cajero')
  const vendedores = empleados.filter(e => e.tipo === 'vendedor')
  const cashStaff = cajeros.length ? cajeros : (vendedores.length ? vendedores : [empleados[0]])

  // 7. Services (retail POS uses services table as product line too — mirror retail demo)
  //    We also create inventory_items. Services here provide the sellable catalog rows.
  const svcRows = []
  for (const p of t.inventory) {
    const supabase_id = uuid()
    const { data: row, error } = await sb.from('services').insert({
      business_id: businessId, supabase_id,
      name: p.name, price: p.price, is_wash: 0,
      aplica_itbis: true, active: true, no_commission: 0,
    }).select('id, supabase_id, name, price, is_wash').single()
    if (error) { console.log(`    [warn] service ${p.name}: ${error.message}`); continue }
    svcRows.push({ ...row, sku: p.sku, barcode: p.barcode, category: p.cat })
  }

  // 8. Inventory items
  const invRows = []
  for (const p of t.inventory) {
    const { data: row, error } = await sb.from('inventory_items').insert({
      business_id: businessId, supabase_id: uuid(),
      sku: p.sku, barcode: p.barcode, name: p.name, category: p.cat,
      quantity: rand(25, 180), min_quantity: 10,
      price: p.price, cost: p.cost, active: true,
    }).select('id, supabase_id, sku, name, quantity').single()
    if (error) { console.log(`    [warn] inv ${p.sku}: ${error.message}`); continue }
    invRows.push(row)
  }

  // 9. Clients
  const clientRows = []
  const clientCount = rand(6, 9)
  for (let i = 0; i < clientCount; i++) {
    const isComp = i >= clientCount - 2
    const name = isComp ? pick(COMP) : `${pick(FIRST)} ${pick(LAST)}`
    const { data: row, error } = await sb.from('clients').insert({
      business_id: businessId, supabase_id: uuid(),
      name,
      rnc: isComp ? `${rand(100,499)}${String(rand(1000000,9999999)).padStart(7,'0')}${rand(1,9)}` : '',
      phone: phone(), email: '',
      credit_limit: pick([0,0,5000,10000]), balance: 0, visits: 0, total_spent: 0, active: true,
    }).select('id, supabase_id, name, rnc, credit_limit').single()
    if (error) { console.log(`    [warn] client: ${error.message}`); continue }
    clientRows.push(row)
  }

  // 10. NCF sequences
  await sb.from('ncf_sequences').insert([
    { business_id: businessId, supabase_id: uuid(), type: 'B01', prefix: 'B01', current_number: 0, limit_number: 500, active: true, enabled: true },
    { business_id: businessId, supabase_id: uuid(), type: 'B02', prefix: 'B02', current_number: 0, limit_number: 500, active: true, enabled: true },
  ])

  // 11. 5 sample tickets across last 7 days
  const PM_POOL = [...Array(6).fill('cash'), ...Array(3).fill('card'), ...Array(2).fill('transfer')]
  let ncfCounter = 1
  let createdTickets = 0
  const ticketCount = 5
  for (let i = 0; i < ticketCount; i++) {
    const created_at = daysAgo(rand(0, 6))
    const numItems = rand(2, 4)
    const items = []
    let subtotal = 0
    for (let j = 0; j < numItems; j++) {
      const svc = pick(svcRows)
      const qty = t.type === 'carniceria' ? money(rand(10, 35)/10) : rand(1, 4) // libras vs units
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
    const vendedor = vendedores.length ? pick(vendedores) : null
    const cajero = pick(cashStaff)
    const ticketSupId = uuid()

    const { data: tk, error: tkErr } = await sb.from('tickets').insert({
      business_id: businessId, supabase_id: ticketSupId,
      doc_number: `T-${String(i + 2000).padStart(4,'0')}`,
      client_name: client?.name || '',
      client_supabase_id: client?.supabase_id || null,
      services_json: JSON.stringify(items.map(it => ({
        name: it.svc.name, price: it.svc.price, qty: it.qty, is_wash: it.svc.is_wash, sku: it.svc.sku,
      }))),
      subtotal, itbis, ley: 0, descuento: 0, total,
      ncf, ncf_type: useEcf, comprobante_type: useEcf,
      payment_method: pm, tipo_venta: 'contado', status: 'cobrado',
      paid_at: created_at,
      cajero_supabase_id: cajero?.supabase_id || null,
      cajero_name: cajero?.nombre || '',
      washer_empleado_supabase_ids: [],
      seller_empleado_supabase_id: vendedor?.supabase_id || null,
      created_at,
    }).select('id, supabase_id').single()
    if (tkErr) { console.log(`    [warn] ticket: ${tkErr.message}`); continue }

    const itemPayloads = items.map(it => ({
      business_id: businessId, supabase_id: uuid(),
      ticket_id: tk.id, ticket_supabase_id: tk.supabase_id,
      service_id: it.svc.id, service_supabase_id: it.svc.supabase_id,
      name: it.svc.name, price: it.svc.price, quantity: it.qty,
      itbis: money(parseFloat(it.svc.price) * it.qty * 0.18),
      is_wash: 0, sku: it.svc.sku || null,
    }))
    const { error: itErr } = await sb.from('ticket_items').insert(itemPayloads)
    if (itErr) console.log(`    [warn] ticket_items: ${itErr.message}`)
    createdTickets++
  }

  console.log(`  [ok] ${t.bizName} | empleados=${empleados.length} svc=${svcRows.length} inv=${invRows.length} cli=${clientRows.length} tk=${createdTickets}`)
  return { ok: true, created: true, businessId,
    counts: { empleados: empleados.length, services: svcRows.length, inventory: invRows.length, clients: clientRows.length, tickets: createdTickets } }
}

async function main() {
  console.log('\n[ dataLEAKS ] Seeding licoreria + carniceria demos\n')
  const { data: planRow } = await sb.from('plans').select('id').eq('name', 'pro_max').single()
  const planId = planRow?.id
  const results = []
  for (const t of TENANTS) {
    console.log(`→ ${t.type.toUpperCase()} (${t.bizName})`)
    try { results.push({ t, ...(await seedTenant(t, planId)) }) }
    catch (e) { console.log(`  [FAIL] ${e.message}`); results.push({ t, ok: false, error: e.message }) }
  }
  console.log('\n' + '='.repeat(96))
  console.log('NEW DEMO CREDENTIALS')
  console.log('='.repeat(96))
  for (const r of results) {
    const status = r.ok ? (r.created ? 'CREATED' : 'EXISTS ') : 'FAILED '
    console.log(`${status} | ${r.t.email.padEnd(48)} | password: ${PASSWORD}  | PIN: 1234  | ${r.t.bizName}`)
    if (r.counts) console.log(`         └─ ${JSON.stringify(r.counts)}`)
    if (r.error) console.log(`         └─ ${r.error}`)
  }
  console.log('='.repeat(96))
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
