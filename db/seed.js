/**
 * seed.js — Populate the database with realistic demo data.
 * Called automatically by database.js when the DB is freshly created.
 * Safe to re-run: uses INSERT OR IGNORE for idempotency.
 */

const crypto = require('crypto')

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex')
}

// Helper: date N days ago as ISO string
function daysAgo(n, h = 10, m = 0) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

module.exports = function seed(db) {
  // ── App Settings ──────────────────────────────────────────────────────────
  const settings = [
    ['itbis_pct',     '18'],
    ['ley_pct',       '10'],
    ['ley_enabled',   'true'],
    ['usd_rate',      '59.50'],
    ['language',      'es'],
    ['printer_name',  ''],
    ['auto_print',    'true'],
    ['print_conduce', 'true'],
    ['auto_backup',   'true'],
    ['cloud_sync',    'true'],
    ['fondo_caja',    '5000'],
    ['b01_prefix',    'B01'],
    ['b02_prefix',    'B02'],
  ]
  const setSetting = db.prepare('INSERT OR IGNORE INTO app_settings(key,value) VALUES(?,?)')
  for (const [k, v] of settings) setSetting.run(k, v)

  // ── Users ─────────────────────────────────────────────────────────────────
  const insUser = db.prepare(`INSERT OR IGNORE INTO users
    (id, name, username, pin_hash, role, discount_pct, active) VALUES
    (@id,@name,@username,@pin_hash,@role,@discount_pct,@active)`)

  const users = [
    { id:1, name:'Admin Owner',    username:'admin',   pin_hash: sha256('1234'), role:'owner',     discount_pct:25, active:1 },
    { id:2, name:'Carlos Gerente', username:'carlos',  pin_hash: sha256('1111'), role:'manager',   discount_pct:15, active:1 },
    { id:3, name:'María Cajera',   username:'maria',   pin_hash: sha256('0000'), role:'cashier',   discount_pct:5,  active:1 },
    { id:4, name:'Ana Contadora',  username:'ana',     pin_hash: sha256('3333'), role:'accountant',discount_pct:0,  active:1 },
    { id:5, name:'Pedro CFO',      username:'pedro',   pin_hash: sha256('2222'), role:'cfo',       discount_pct:10, active:1 },
  ]
  for (const u of users) insUser.run(u)

  // ── Services ─────────────────────────────────────────────────────────────
  const insSvc = db.prepare(`INSERT OR IGNORE INTO services
    (id,name,name_en,category,price,active,is_wash,sort_order) VALUES
    (@id,@name,@name_en,@category,@price,1,@is_wash,@sort_order)`)

  const services = [
    // Lavado
    { id:1,  name:'Lavado Básico',      name_en:'Basic Wash',       category:'Lavado',    price:500,  is_wash:1, sort_order:1 },
    { id:2,  name:'Lavado Completo',    name_en:'Full Wash',        category:'Lavado',    price:800,  is_wash:1, sort_order:2 },
    { id:3,  name:'Lavado de Motor',    name_en:'Engine Wash',      category:'Lavado',    price:1200, is_wash:1, sort_order:3 },
    { id:4,  name:'Lavado Camión',      name_en:'Truck Wash',       category:'Lavado',    price:1800, is_wash:1, sort_order:4 },
    { id:5,  name:'Lavado Jeepeta',     name_en:'SUV Wash',         category:'Lavado',    price:1000, is_wash:1, sort_order:5 },
    // Detailing
    { id:6,  name:'Cera Premium',       name_en:'Premium Wax',      category:'Detailing', price:1500, is_wash:1, sort_order:6 },
    { id:7,  name:'Aspirado Interior',  name_en:'Interior Vacuum',  category:'Detailing', price:400,  is_wash:1, sort_order:7 },
    { id:8,  name:'Detailing Completo', name_en:'Full Detailing',   category:'Detailing', price:4500, is_wash:1, sort_order:8 },
    { id:9,  name:'Pulida de Faros',    name_en:'Headlight Polish', category:'Detailing', price:800,  is_wash:1, sort_order:9 },
    { id:10, name:'Ozono',              name_en:'Ozone Treatment',  category:'Detailing', price:1200, is_wash:1, sort_order:10 },
    // Extra
    { id:11, name:'Aromatizante',       name_en:'Air Freshener',    category:'Extra',     price:150,  is_wash:1, sort_order:11 },
    { id:12, name:'Brillo de Gomas',    name_en:'Tire Shine',       category:'Extra',     price:200,  is_wash:1, sort_order:12 },
    // Bebidas (excluded from commission)
    { id:13, name:'Agua Fría',          name_en:'Cold Water',       category:'Bebida',    price:50,   is_wash:0, sort_order:13 },
    { id:14, name:'Refresco',           name_en:'Soda',             category:'Bebida',    price:100,  is_wash:0, sort_order:14 },
    { id:15, name:'Café',               name_en:'Coffee',           category:'Bebida',    price:75,   is_wash:0, sort_order:15 },
  ]
  for (const s of services) insSvc.run(s)

  // ── Washers ───────────────────────────────────────────────────────────────
  const insWasher = db.prepare(`INSERT OR IGNORE INTO washers
    (id,name,phone,cedula,commission_pct,active) VALUES
    (@id,@name,@phone,@cedula,@commission_pct,1)`)

  const washers = [
    { id:1, name:'Juan Pérez',     phone:'809-601-1111', cedula:'001-1234567-8', commission_pct:20 },
    { id:2, name:'Luis García',    phone:'809-601-2222', cedula:'001-2345678-9', commission_pct:20 },
    { id:3, name:'Miguel Torres',  phone:'809-601-3333', cedula:'001-3456789-0', commission_pct:18 },
    { id:4, name:'Pedro Díaz',     phone:'809-601-4444', cedula:'001-4567890-1', commission_pct:22 },
    { id:5, name:'Carlos Marte',   phone:'809-601-5555', cedula:'001-5678901-2', commission_pct:20 },
    { id:6, name:'Ramon Feliz',    phone:'809-601-6666', cedula:'001-6789012-3', commission_pct:18 },
    { id:7, name:'José Núñez',     phone:'809-601-7777', cedula:'001-7890123-4', commission_pct:20 },
    { id:8, name:'Fernando Cruz',  phone:'809-601-8888', cedula:'001-8901234-5', commission_pct:22 },
  ]
  for (const w of washers) insWasher.run(w)

  // ── Sellers ───────────────────────────────────────────────────────────────
  db.prepare(`INSERT OR IGNORE INTO sellers(id,name,commission_pct,active) VALUES(1,'Carlos Gerente',5,1)`).run()
  db.prepare(`INSERT OR IGNORE INTO sellers(id,name,commission_pct,active) VALUES(2,'María Cajera',3,1)`).run()

  // ── Clients ───────────────────────────────────────────────────────────────
  const insClient = db.prepare(`INSERT OR IGNORE INTO clients
    (id,name,rnc,phone,email,address,credit_limit,balance,visits,total_spent) VALUES
    (@id,@name,@rnc,@phone,@email,@address,@credit_limit,@balance,@visits,@total_spent)`)

  const clients = [
    { id:1,  name:'Grupo Mejía S.R.L.',      rnc:'130-12345-6', phone:'809-540-1000', email:'gmejia@email.do',      address:'Av. Luperón 45, Santiago',       credit_limit:30000, balance:26500, visits:28, total_spent:187400 },
    { id:2,  name:'Importadora Del Norte',    rnc:'101-98765-4', phone:'809-540-2000', email:'inorte@email.do',      address:'C. del Sol 112, Santiago',       credit_limit:20000, balance:8400,  visits:19, total_spent:98200  },
    { id:3,  name:'Ferretería El Clavo',      rnc:'130-55512-1', phone:'809-540-3000', email:'elclavo@email.do',     address:'Av. Francia 88',                 credit_limit:15000, balance:3200,  visits:14, total_spent:62100  },
    { id:4,  name:'ALTA GAMA Motors',         rnc:'130-77890-2', phone:'809-540-4000', email:'altagama@email.do',    address:'Av. 27 de Febrero 1200',         credit_limit:50000, balance:0,     visits:41, total_spent:312000 },
    { id:5,  name:'EL MILLON Dealer',         rnc:'101-33221-8', phone:'809-540-5000', email:'elmillon@email.do',    address:'Km 7 Autopista Duarte',          credit_limit:40000, balance:12000, visits:35, total_spent:248000 },
    { id:6,  name:'Ecolatico S.R.L.',         rnc:'101-44512-3', phone:'809-540-6000', email:'ecolatico@email.do',   address:'Av. Independencia 550',          credit_limit:25000, balance:4800,  visits:22, total_spent:142000 },
    { id:7,  name:'Seguros Caribe',           rnc:'101-44321-9', phone:'809-540-7000', email:'scaribe@email.do',     address:'C. El Conde 200, Zona Colonial',  credit_limit:35000, balance:0,     visits:31, total_spent:198000 },
    { id:8,  name:'Mueblería Don Pedro',      rnc:'130-77230-8', phone:'809-540-8000', email:'donpedro@email.do',    address:'Av. Máximo Gómez 900',           credit_limit:10000, balance:2100,  visits:11, total_spent:48000  },
    { id:9,  name:'Distribuidora Central',    rnc:'130-88012-5', phone:'809-540-9000', email:'distcentral@email.do', address:'Av. San Martín 340',             credit_limit:20000, balance:0,     visits:16, total_spent:88000  },
    { id:10, name:'Inversiones Caribe Corp',  rnc:'101-77654-3', phone:'809-540-0000', email:'invcaribe@email.do',   address:'Piantini, C. Freddy Prestol 8',  credit_limit:60000, balance:15000, visits:47, total_spent:421000 },
  ]
  for (const c of clients) insClient.run(c)

  // ── NCF Sequences ─────────────────────────────────────────────────────────
  const insNCF = db.prepare(`INSERT OR IGNORE INTO ncf_sequences
    (type,prefix,current_number,limit_number,valid_until,active) VALUES
    (@type,@prefix,@current_number,@limit_number,@valid_until,1)`)
  const seqs = [
    { type:'B01', prefix:'B01', current_number:81,  limit_number:500, valid_until:'2026-12-31' },
    { type:'B02', prefix:'B02', current_number:217, limit_number:500, valid_until:'2026-12-31' },
    { type:'B04', prefix:'B04', current_number:41,  limit_number:200, valid_until:'2026-12-31' },
    { type:'E31', prefix:'E31', current_number:0,   limit_number:0,   valid_until:null          },
    { type:'E32', prefix:'E32', current_number:0,   limit_number:0,   valid_until:null          },
  ]
  for (const s of seqs) insNCF.run(s)

  // ── Historical Tickets (50 across last 30 days) ───────────────────────────
  const insTicket = db.prepare(`INSERT OR IGNORE INTO tickets
    (id,doc_number,client_id,washer_ids,cajero_id,subtotal,descuento,itbis,ley,total,
     payment_method,comprobante_type,ncf,tipo_venta,status,vehicle_plate,created_at)
    VALUES(@id,@doc_number,@client_id,@washer_ids,@cajero_id,
           @subtotal,@descuento,@itbis,@ley,@total,
           @payment_method,@comprobante_type,@ncf,@tipo_venta,@status,@vehicle_plate,@created_at)`)

  const insItem = db.prepare(`INSERT OR IGNORE INTO ticket_items
    (ticket_id,service_id,name,price,itbis,is_wash) VALUES
    (@ticket_id,@service_id,@name,@price,@itbis,@is_wash)`)

  const insComm = db.prepare(`INSERT OR IGNORE INTO washer_commissions
    (washer_id,ticket_id,base_amount,commission_pct,commission_amount,paid)
    VALUES(@washer_id,@ticket_id,@base_amount,@commission_pct,@commission_amount,@paid)`)

  // Service combos for realistic tickets
  const combos = [
    [{ id:1, price:500 }],                          // Basic wash
    [{ id:2, price:800 }],                          // Full wash
    [{ id:2, price:800 }, { id:7, price:400 }],     // Full + vacuum
    [{ id:5, price:1000 }],                         // SUV wash
    [{ id:2, price:800 }, { id:6, price:1500 }],    // Full + wax
    [{ id:8, price:4500 }],                         // Full detailing
    [{ id:3, price:1200 }],                         // Engine wash
    [{ id:5, price:1000 }, { id:6, price:1500 }, { id:12, price:200 }],  // SUV + wax + tire
    [{ id:1, price:500 },  { id:13, price:50 }],    // Basic + water
    [{ id:2, price:800 },  { id:11, price:150 }, { id:12, price:200 }],  // Full + extras
    [{ id:4, price:1800 }],                         // Truck
    [{ id:10, price:1200 }],                        // Ozone
    [{ id:8, price:4500 }, { id:10, price:1200 }],  // Detailing + ozone
  ]

  const METHODS  = ['cash','cash','cash','card','transfer','credit']
  const STATUSES = ['cobrado','cobrado','cobrado','cobrado','cobrado','nula']
  const PLATES   = ['A001234','B209811','C341200','D512009','E671234','F019234','G234500','H891200']

  let ticketId = 1
  const usedDocs = new Set()

  for (let day = 30; day >= 0; day--) {
    const ticketsPerDay = rand(0, 4)
    for (let t = 0; t < ticketsPerDay; t++) {
      if (ticketId > 50) break
      const combo     = combos[rand(0, combos.length - 1)]
      const washerId  = rand(1, 8)
      const washerObj = washers.find(w => w.id === washerId)
      const commPct   = washerObj?.commission_pct ?? 20
      const clientId  = Math.random() < 0.4 ? rand(1, 10) : null
      const method    = METHODS[rand(0, METHODS.length - 1)]
      const status    = ticketId === 7 ? 'nula' : 'cobrado'
      const isCredit  = method === 'credit' && clientId
      const tipo      = isCredit ? 'credito' : 'contado'
      const clientObj = clientId ? clients.find(c => c.id === clientId) : null
      const ncfType   = clientObj?.rnc ? 'B01' : 'B02'
      const ncfNum    = ncfType === 'B01' ? (80 - ticketId) : (216 - ticketId)
      const ncf       = `${ncfType}${String(ncfNum).padStart(8,'0')}`
      const docNo     = `T-${String(ticketId).padStart(4,'0')}`
      if (usedDocs.has(docNo)) continue
      usedDocs.add(docNo)

      const subtotal  = combo.reduce((s, x) => s + x.price, 0)
      const washBase  = combo.filter(x => x.id <= 12).reduce((s, x) => s + x.price, 0)
      const itbis     = parseFloat((subtotal * 0.18).toFixed(2))
      const ley       = parseFloat((subtotal * 0.10).toFixed(2))
      const total     = parseFloat((subtotal + itbis + ley).toFixed(2))
      const hour      = rand(8, 18)
      const created   = daysAgo(day, hour, rand(0, 59))

      insTicket.run({
        id:               ticketId,
        doc_number:       docNo,
        client_id:        clientId,
        washer_ids:       JSON.stringify([washerId]),
        cajero_id:        rand(1, 3),
        subtotal,
        descuento:        0,
        itbis,
        ley,
        total,
        payment_method:   method,
        comprobante_type: ncfType,
        ncf,
        tipo_venta:       tipo,
        status,
        vehicle_plate:    PLATES[rand(0, PLATES.length - 1)],
        created_at:       created,
      })

      for (const svc of combo) {
        const s = services.find(x => x.id === svc.id)
        insItem.run({
          ticket_id:  ticketId,
          service_id: svc.id,
          name:       s?.name ?? '',
          price:      svc.price,
          itbis:      parseFloat((svc.price * 0.18).toFixed(2)),
          is_wash:    s?.is_wash ?? 1,
        })
      }

      if (status === 'cobrado') {
        const commBase   = washBase / (1 + 0.18 + 0.10)
        const commAmount = parseFloat((commBase * commPct / 100).toFixed(2))
        insComm.run({
          washer_id:        washerId,
          ticket_id:        ticketId,
          base_amount:      parseFloat(commBase.toFixed(2)),
          commission_pct:   commPct,
          commission_amount: commAmount,
          paid:             day > 7 ? 1 : 0,
        })
      }

      ticketId++
    }
    if (ticketId > 50) break
  }

  console.log('[seed] Database seeded successfully.')
}
