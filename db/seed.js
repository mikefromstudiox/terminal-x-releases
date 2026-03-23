/**
 * seed.js — Test data for Terminal X development / demo.
 * Runs once on first launch when the users table is empty.
 *
 * PINs:
 *   Miguel (owner)   → 1234
 *   Carlos (manager) → 2222
 *   Maria  (cajera)  → 3333
 *   Sandra (contable)→ 4444
 */

const crypto = require('crypto')
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex')

module.exports = function seed(db) {
  const today = new Date().toISOString().slice(0, 10)

  function daysAgo(n, hour = '10:00:00') {
    const d = new Date()
    d.setDate(d.getDate() - n)
    return `${d.toISOString().slice(0, 10)}T${hour}.000Z`
  }

  // ── Business info ──────────────────────────────────────────────────────────
  db.prepare(`UPDATE businesses SET name=@name,rnc=@rnc,address=@address,phone=@phone,email=@email,settings=@settings WHERE id=1`).run({
    name:     'Car Wash Terminal X',
    rnc:      '1-31-00000-1',
    address:  'Av. Las Palmas #12, Santiago, RD',
    phone:    '809-555-1234',
    email:    'info@terminalx.do',
    settings: JSON.stringify({
      itbis_pct: 18, ley_pct: 0, usd_rate: 59.50,
      language: 'es', facturacion_mode: 'paper', ley_enabled: false,
    }),
  })
  db.prepare(`UPDATE empresa SET nombre=@nombre,rnc=@rnc,direccion=@dir,telefono=@tel,email=@email WHERE id=1`).run({
    nombre: 'Car Wash Terminal X',
    rnc:    '1-31-00000-1',
    dir:    'Av. Las Palmas #12, Santiago, RD',
    tel:    '809-555-1234',
    email:  'info@terminalx.do',
  })
  db.prepare(`INSERT OR REPLACE INTO configuracion(clave,valor) VALUES('setup_complete','1')`).run()

  // ── Users ──────────────────────────────────────────────────────────────────
  const insUser = db.prepare(`INSERT OR IGNORE INTO users(name,username,pin_hash,role,discount_pct,active)
    VALUES(@name,@username,@pin_hash,@role,@discount_pct,1)`)
  ;[
    { name: 'Miguel Tavarez',  username: 'miguel',  pin: '1234', role: 'owner',      discount_pct: 10 },
    { name: 'Carlos Rosario',  username: 'carlos',  pin: '2222', role: 'manager',    discount_pct: 5  },
    { name: 'Maria González',  username: 'maria',   pin: '3333', role: 'cashier',    discount_pct: 0  },
    { name: 'Sandra Reyes',    username: 'sandra',  pin: '4444', role: 'accountant', discount_pct: 0  },
  ].forEach(u => insUser.run({ ...u, pin_hash: sha256(u.pin) }))

  // ── Washers ────────────────────────────────────────────────────────────────
  const insWasher = db.prepare(`INSERT OR IGNORE INTO washers(name,phone,commission_pct,active,start_date)
    VALUES(@name,@phone,@commission_pct,1,@start_date)`)
  ;[
    { name: 'Juan Pérez',    phone: '829-100-0001', commission_pct: 20, start_date: '2025-01-15' },
    { name: 'Pedro López',   phone: '829-100-0002', commission_pct: 20, start_date: '2025-03-01' },
    { name: 'Luis Gómez',    phone: '829-100-0003', commission_pct: 20, start_date: '2025-06-10' },
    { name: 'Rafael Torres', phone: '829-100-0004', commission_pct: 22, start_date: '2024-09-20' },
    { name: 'Domingo Reyes', phone: '829-100-0005', commission_pct: 20, start_date: '2026-01-05' },
  ].forEach(w => insWasher.run(w))

  // ── Sellers ────────────────────────────────────────────────────────────────
  const insSeller = db.prepare(`INSERT OR IGNORE INTO sellers(name,commission_pct,active)
    VALUES(@name,@commission_pct,1)`)
  ;[
    { name: 'Ana Martínez',   commission_pct: 5 },
    { name: 'Roberto Santos', commission_pct: 5 },
  ].forEach(s => insSeller.run(s))

  // ── Clients ────────────────────────────────────────────────────────────────
  const insClient = db.prepare(`INSERT INTO clients
    (name,rnc,phone,email,address,credit_limit,balance,visits,total_spent,notes,active)
    VALUES(@name,@rnc,@phone,@email,@address,@credit_limit,@balance,@visits,@total_spent,@notes,1)`)
  const clientRows = [
    { name: 'Empresa XYZ SRL',        rnc: '130-12345-6', phone: '809-200-0001', email: 'admin@xyz.com',          address: 'C/ Principal #5, Santiago',    credit_limit: 10000, balance: 3500,  visits: 24, total_spent: 45000, notes: 'Cliente frecuente' },
    { name: 'Juan Carlos Familia',    rnc: '',            phone: '829-300-0001', email: '',                       address: '',                             credit_limit: 5000,  balance: 1200,  visits: 12, total_spent: 18500, notes: '' },
    { name: 'María Santos',           rnc: '',            phone: '849-400-0001', email: 'msantos@email.com',      address: 'Los Jardines, Santiago',        credit_limit: 0,     balance: 0,     visits: 8,  total_spent: 9600,  notes: '' },
    { name: 'Constructora ABC SRL',   rnc: '130-55555-8', phone: '809-200-0002', email: 'contab@abc.do',          address: 'Zona Industrial, Santiago',     credit_limit: 15000, balance: 8000,  visits: 35, total_spent: 82000, notes: 'Paga quincenal' },
    { name: 'Pedro González',         rnc: '',            phone: '829-300-0002', email: '',                       address: '',                             credit_limit: 0,     balance: 0,     visits: 5,  total_spent: 4200,  notes: '' },
    { name: 'Auto Dealer Premium SRL',rnc: '130-77777-3', phone: '809-200-0003', email: 'ventas@autopremium.do', address: 'Av. Estrella Sadhalá, STG',     credit_limit: 20000, balance: 0,     visits: 50, total_spent: 135000, notes: 'Cuenta corporativa' },
    { name: 'Farmacia La Salud',      rnc: '130-44444-2', phone: '809-200-0004', email: '',                       address: 'C/ Beller #88, Santiago',       credit_limit: 8000,  balance: 2000,  visits: 18, total_spent: 28500, notes: '' },
    { name: 'Luis Marte',             rnc: '',            phone: '829-300-0003', email: '',                       address: '',                             credit_limit: 0,     balance: 0,     visits: 3,  total_spent: 2400,  notes: '' },
    { name: 'Carmen Rivera',          rnc: '',            phone: '849-400-0002', email: '',                       address: '',                             credit_limit: 3000,  balance: 800,   visits: 9,  total_spent: 11200, notes: '' },
    { name: 'Supermercado El Colmado',rnc: '130-33333-9', phone: '809-200-0005', email: 'pagos@colmado.do',       address: 'Av. Circunvalación #200, STG', credit_limit: 12000, balance: 5500,  visits: 28, total_spent: 67000, notes: 'Pago mensual' },
  ]
  clientRows.forEach(c => insClient.run(c))

  // ── Services ───────────────────────────────────────────────────────────────
  const insSvc = db.prepare(`INSERT OR IGNORE INTO services(id,name,price,category,active)
    VALUES(@id,@name,@price,@category,1)`)
  ;[
    { id: 1,  name: 'Lavado Básico',         price: 500,   category: 'lavado' },
    { id: 2,  name: 'Lavado Completo',        price: 800,   category: 'lavado' },
    { id: 3,  name: 'Lavado de Motor',        price: 1200,  category: 'lavado' },
    { id: 4,  name: 'Lavado Jeepeta',         price: 1000,  category: 'lavado' },
    { id: 5,  name: 'Lavado Camión',          price: 1800,  category: 'lavado' },
    { id: 6,  name: 'Aromatizante',           price: 150,   category: 'extra'  },
    { id: 7,  name: 'Brillo de Gomas',        price: 200,   category: 'extra'  },
    { id: 8,  name: 'Aspirado Interior',      price: 400,   category: 'extra'  },
    { id: 9,  name: 'Encerrado',              price: 800,   category: 'extra'  },
    { id: 10, name: 'Lavado + Cera',          price: 2000,  category: 'lavado' },
    { id: 11, name: 'Lavado + Aspirado',      price: 1100,  category: 'lavado' },
    { id: 12, name: 'Detailing Completo',     price: 4500,  category: 'lavado' },
  ].forEach(s => insSvc.run(s))

  // ── Tickets + Items ────────────────────────────────────────────────────────
  const insTicket = db.prepare(`INSERT INTO tickets
    (doc_number,client_id,washer_ids,seller_id,cajero_id,subtotal,descuento,itbis,ley,total,
     payment_method,comprobante_type,ncf,tipo_venta,status,vehicle_plate,vehicle_make,vehicle_color,created_at)
    VALUES
    (@doc_number,@client_id,@washer_ids,@seller_id,@cajero_id,@subtotal,@descuento,@itbis,@ley,@total,
     @payment_method,@comprobante_type,@ncf,@tipo_venta,@status,@vehicle_plate,@vehicle_make,@vehicle_color,@created_at)`)
  const insItem = db.prepare(`INSERT INTO ticket_items(ticket_id,service_id,name,price,itbis,is_wash)
    VALUES(@ticket_id,@service_id,@name,@price,@itbis,@is_wash)`)

  let docN = 1
  let b02N = 1
  let b01N = 1
  const nextDoc  = () => `T-${today.replace(/-/g, '')}-${String(docN++).padStart(4, '0')}`
  const nextB02  = () => `B02${String(b02N++).padStart(8, '0')}`
  const nextB01  = () => `B01${String(b01N++).padStart(8, '0')}`
  // service helper: id, name, price, is_wash (1=yes, 0=beverage)
  const svc = (id, name, price, is_wash = 1) => ({
    service_id: id, name, price,
    itbis:      is_wash ? Math.round(price * 0.18 * 100) / 100 : 0,
    is_wash,
  })

  function mkTicket(o) {
    const {
      client_id = null, washer_ids = [1], seller_id = 1, cajero_id = 1,
      items, payment_method = 'cash', tipo_venta = 'contado', status = 'cobrado',
      plate = '', make = '', color = '', created_at = daysAgo(0), b01 = false,
    } = o
    const subtotal = items.reduce((s, i) => s + i.price, 0)
    const itbis    = items.reduce((s, i) => s + (i.itbis || 0), 0)
    const total    = subtotal + itbis
    const row = {
      doc_number:       nextDoc(),
      client_id,
      washer_ids:       JSON.stringify(washer_ids),
      seller_id,
      cajero_id,
      subtotal,
      descuento:        0,
      itbis,
      ley:              0,
      total,
      payment_method:   tipo_venta === 'credito' ? 'credit' : payment_method,
      comprobante_type: b01 ? 'B01' : 'B02',
      ncf:              b01 ? nextB01() : nextB02(),
      tipo_venta,
      status,
      vehicle_plate:    plate,
      vehicle_make:     make,
      vehicle_color:    color,
      created_at,
    }
    const { lastInsertRowid: tid } = insTicket.run(row)
    items.forEach(item => insItem.run({ ticket_id: tid, ...item }))
    return tid
  }

  db.transaction(() => {
    // ── Today ──
    mkTicket({ washer_ids:[1],   plate:'A123456', make:'Toyota',      color:'Blanco',   items:[svc(1,'Lavado Básico',500),    svc(6,'Aromatizante',150)],           created_at:daysAgo(0,'08:15:00') })
    mkTicket({ washer_ids:[2],   plate:'B234567', make:'Honda',       color:'Rojo',     items:[svc(2,'Lavado Completo',800),   svc(7,'Brillo de Gomas',200)],        created_at:daysAgo(0,'08:55:00') })
    mkTicket({ washer_ids:[3],   plate:'C345678', make:'Hyundai',     color:'Gris',     client_id:3,  items:[svc(4,'Lavado Jeepeta',1000),  svc(8,'Aspirado Interior',400)],    created_at:daysAgo(0,'09:30:00') })
    mkTicket({ washer_ids:[1,2], plate:'D456789', make:'Nissan',      color:'Negro',    client_id:1,  seller_id:1, items:[svc(10,'Lavado + Cera',2000),  svc(8,'Aspirado Interior',400)],    tipo_venta:'credito', status:'pendiente', b01:true, created_at:daysAgo(0,'10:10:00') })
    mkTicket({ washer_ids:[4],   plate:'E567890', make:'Ford',        color:'Azul',     client_id:4,  seller_id:2, items:[svc(5,'Lavado Camión',1800)],                                       tipo_venta:'credito', status:'pendiente', b01:true, created_at:daysAgo(0,'11:00:00') })
    mkTicket({ washer_ids:[5],   plate:'F678901', make:'Jeep',        color:'Blanco',   items:[svc(4,'Lavado Jeepeta',1000),  svc(6,'Aromatizante',150), svc(7,'Brillo de Gomas',200)],     created_at:daysAgo(0,'11:45:00') })
    mkTicket({ washer_ids:[2],   plate:'G789012', make:'Kia',         color:'Plateado', items:[svc(1,'Lavado Básico',500)],                                                                    payment_method:'card', created_at:daysAgo(0,'13:00:00') })

    // ── Yesterday ──
    mkTicket({ washer_ids:[3,4], plate:'H890123', make:'BMW',         color:'Negro',    client_id:6,  seller_id:1, items:[svc(12,'Detailing Completo',4500)],                                payment_method:'card',     b01:true, created_at:daysAgo(1,'09:00:00') })
    mkTicket({ washer_ids:[1],   plate:'I901234', make:'Jeep',        color:'Blanco',   items:[svc(4,'Lavado Jeepeta',1000),  svc(6,'Aromatizante',150), svc(8,'Aspirado Interior',400)],   created_at:daysAgo(1,'10:20:00') })
    mkTicket({ washer_ids:[5],   plate:'J012345', make:'Toyota',      color:'Plateado', client_id:7,  seller_id:2, items:[svc(2,'Lavado Completo',800)],                                     tipo_venta:'credito', status:'pendiente', b01:true, created_at:daysAgo(1,'11:30:00') })
    mkTicket({ washer_ids:[2],   plate:'K123456', make:'Mitsubishi',  color:'Verde',    items:[svc(2,'Lavado Completo',800),  svc(8,'Aspirado Interior',400)],                               payment_method:'transfer', created_at:daysAgo(1,'13:15:00') })
    mkTicket({ washer_ids:[4],   plate:'L234567', make:'Honda',       color:'Azul',     items:[svc(1,'Lavado Básico',500),    svc(7,'Brillo de Gomas',200)],                                 created_at:daysAgo(1,'14:00:00') })
    mkTicket({ washer_ids:[1],   plate:'M345678', make:'Chevrolet',   color:'Rojo',     items:[svc(11,'Lavado + Aspirado',1100)],                                                             payment_method:'cash',     created_at:daysAgo(1,'15:30:00') })

    // ── 2 days ago ──
    mkTicket({ washer_ids:[1,3], plate:'N456789', make:'Caterpillar', color:'Amarillo', client_id:4,  seller_id:2, items:[svc(5,'Lavado Camión',1800),   svc(3,'Lavado de Motor',1200)],     tipo_venta:'credito', status:'pendiente', b01:true, created_at:daysAgo(2,'08:30:00') })
    mkTicket({ washer_ids:[4],   plate:'O567890', make:'Chevrolet',   color:'Gris',     items:[svc(1,'Lavado Básico',500),    svc(6,'Aromatizante',150)],                                    created_at:daysAgo(2,'09:45:00') })
    mkTicket({ washer_ids:[5],   plate:'P678901', make:'Suzuki',      color:'Blanco',   client_id:10, seller_id:1, items:[svc(11,'Lavado + Aspirado',1100)],                                 tipo_venta:'credito', status:'pendiente', b01:true, created_at:daysAgo(2,'10:50:00') })
    mkTicket({ washer_ids:[2],   plate:'Q789012', make:'Toyota',      color:'Plateado', items:[svc(4,'Lavado Jeepeta',1000)],                                                                 payment_method:'card', created_at:daysAgo(2,'12:00:00') })
    mkTicket({ washer_ids:[3],   plate:'R890123', make:'Hyundai',     color:'Azul',     items:[svc(2,'Lavado Completo',800)],                                                                 payment_method:'cash', created_at:daysAgo(2,'14:20:00') })

    // ── 3 days ago ──
    mkTicket({ washer_ids:[1],   plate:'S901234', make:'Honda',       color:'Blanco',   items:[svc(2,'Lavado Completo',800)],                                                                 created_at:daysAgo(3,'08:00:00') })
    mkTicket({ washer_ids:[3],   plate:'T012345', make:'Nissan',      color:'Negro',    client_id:2,  seller_id:1, items:[svc(10,'Lavado + Cera',2000)],                                    tipo_venta:'credito', status:'pendiente', b01:true, created_at:daysAgo(3,'09:30:00') })
    mkTicket({ washer_ids:[4,5], plate:'U123456', make:'Kia',         color:'Rojo',     client_id:9,  seller_id:2, items:[svc(1,'Lavado Básico',500),    svc(7,'Brillo de Gomas',200)],     tipo_venta:'credito', status:'pendiente', b01:true, created_at:daysAgo(3,'11:00:00') })
    mkTicket({ washer_ids:[2],   plate:'V234567', make:'Ford',        color:'Blanco',   items:[svc(1,'Lavado Básico',500)],                                                                   created_at:daysAgo(3,'13:45:00') })

    // ── 4 days ago ──
    mkTicket({ washer_ids:[1],   plate:'W345678', make:'Hyundai',     color:'Rojo',     items:[svc(2,'Lavado Completo',800),  svc(6,'Aromatizante',150)],                                   payment_method:'card', created_at:daysAgo(4,'09:00:00') })
    mkTicket({ washer_ids:[3],   plate:'X456789', make:'Mercedes',    color:'Negro',    client_id:6,  seller_id:1, items:[svc(12,'Detailing Completo',4500)],                               payment_method:'transfer', b01:true, created_at:daysAgo(4,'10:30:00') })
    mkTicket({ washer_ids:[2],   plate:'Y567890', make:'Toyota',      color:'Blanco',   items:[svc(4,'Lavado Jeepeta',1000)],                                                                 created_at:daysAgo(4,'12:00:00') })
    mkTicket({ washer_ids:[4],   plate:'Z678901', make:'Jeep',        color:'Gris',     items:[svc(4,'Lavado Jeepeta',1000),  svc(8,'Aspirado Interior',400)],                              created_at:daysAgo(4,'14:00:00') })

    // ── 5 days ago ──
    mkTicket({ washer_ids:[5],   plate:'A234567', make:'Chevrolet',   color:'Azul',     items:[svc(1,'Lavado Básico',500)],                                                                   created_at:daysAgo(5,'08:30:00') })
    mkTicket({ washer_ids:[1,2], plate:'B345678', make:'BMW',         color:'Negro',    client_id:6,  seller_id:2, items:[svc(10,'Lavado + Cera',2000),  svc(8,'Aspirado Interior',400)],  payment_method:'card', b01:true, created_at:daysAgo(5,'10:00:00') })
    mkTicket({ washer_ids:[3],   plate:'C456789', make:'Honda',       color:'Plateado', items:[svc(2,'Lavado Completo',800)],                                                                  created_at:daysAgo(5,'13:00:00') })

    // Update NCF sequences to reflect used numbers
    db.prepare(`UPDATE ncf_sequences SET current_number=@n WHERE type='B02'`).run({ n: b02N - 1 })
    db.prepare(`UPDATE ncf_sequences SET current_number=@n WHERE type='B01'`).run({ n: b01N - 1 })
  })()
}
