const crypto = require('crypto')
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex')

module.exports = function seed(db) {
  const NOW = new Date()
  const DAY_MS = 86400000

  function dateStr(d) { return d.toISOString().slice(0, 10) }
  function ts(d, h, m) {
    const r = new Date(d)
    r.setHours(h, m, 0, 0)
    return r.toISOString().replace('Z', '').slice(0, 19)
  }
  function daysAgoDate(n) { return new Date(NOW.getTime() - n * DAY_MS) }
  function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }
  function pick(arr) { return arr[rand(0, arr.length - 1)] }
  function round2(n) { return Math.round(n * 100) / 100 }

  // seeded PRNG for reproducibility
  let _seed = 42
  function srand(min, max) { _seed = (_seed * 16807) % 2147483647; return min + Math.floor(((_seed - 1) / 2147483646) * (max - min + 1)) }
  function spick(arr) { return arr[srand(0, arr.length - 1)] }

  db.prepare(`UPDATE businesses SET name=@name,rnc=@rnc,address=@address,phone=@phone,email=@email,settings=@settings WHERE id=1`).run({
    name: 'Car Wash El Dorado SRL', rnc: '131-99999-9', address: 'Av. 27 de Febrero #145, Santo Domingo, RD',
    phone: '809-555-0100', email: 'demo@carwasheldorado.do',
    settings: JSON.stringify({ itbis_pct: 18, ley_pct: 0, usd_rate: 59.50, language: 'es', facturacion_mode: 'paper', ley_enabled: false }),
  })
  db.prepare(`UPDATE empresa SET nombre=@nombre,rnc=@rnc,direccion=@dir,telefono=@tel,email=@email WHERE id=1`).run({
    nombre: 'Car Wash El Dorado SRL', rnc: '131-99999-9', dir: 'Av. 27 de Febrero #145, Santo Domingo, RD',
    tel: '809-555-0100', email: 'demo@carwasheldorado.do',
  })
  db.prepare(`INSERT OR REPLACE INTO configuracion(clave,valor) VALUES('setup_complete','1')`).run()

  const insUser = db.prepare(`INSERT OR IGNORE INTO users(name,username,pin_hash,role,discount_pct,active) VALUES(@name,@username,@pin_hash,@role,@discount_pct,1)`)
  const users = [
    { name: 'Miguel Mejia', username: 'miguel', pin: '1234', role: 'owner', discount_pct: 10 },
    { name: 'Carlos Rosario', username: 'carlos', pin: '2222', role: 'manager', discount_pct: 5 },
    { name: 'Maria Gonzalez', username: 'maria', pin: '3333', role: 'cashier', discount_pct: 0 },
    { name: 'Sandra Reyes', username: 'sandra', pin: '4444', role: 'accountant', discount_pct: 0 },
    { name: 'Luisa Batista', username: 'luisa', pin: '5555', role: 'cashier', discount_pct: 0 },
    { name: 'Roberto Marte', username: 'roberto', pin: '6666', role: 'cfo', discount_pct: 0 },
  ]
  users.forEach(u => insUser.run({ ...u, pin_hash: sha256(u.pin) }))

  // v2.1: washers + sellers are gone — seed empleados directly.
  // UUIDs generated inline so commission inserts below can reference
  // empleado_supabase_id without a post-insert query.
  const uuid = () => {
    // SQLite-native v4 UUID generator (matches database.js line 601 pattern)
    return db.prepare(`SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))) AS u`).get().u
  }

  const insEmpLavador = db.prepare(`INSERT OR IGNORE INTO empleados(nombre,tipo,salary,start_date,cedula,phone,comision_pct,role,active,supabase_id,updated_at) VALUES(@nombre,'lavador',@salary,@start_date,@cedula,@phone,@comision_pct,'none',1,@supabase_id,datetime('now'))`)
  const washers = [
    { name: 'Juan Perez', phone: '829-310-4521', cedula: '001-1985432-7', commission_pct: 20, start_date: '2025-06-01' },
    { name: 'Pedro Lopez', phone: '829-220-8834', cedula: '001-1990127-3', commission_pct: 20, start_date: '2025-07-15' },
    { name: 'Luis Gomez', phone: '829-445-1290', cedula: '402-2001889-1', commission_pct: 22, start_date: '2025-08-10' },
    { name: 'Rafael Torres', phone: '829-118-6743', cedula: '001-1988654-9', commission_pct: 20, start_date: '2025-09-20' },
    { name: 'Domingo Reyes', phone: '829-556-3102', cedula: '402-1995342-5', commission_pct: 18, start_date: '2025-10-05' },
    { name: 'Kelvin Santana', phone: '829-773-2048', cedula: '001-2000118-8', commission_pct: 20, start_date: '2025-12-01' },
    { name: 'Franklyn Diaz', phone: '829-882-5519', cedula: '402-1993567-2', commission_pct: 22, start_date: '2026-01-10' },
    { name: 'Yohan Castillo', phone: '829-991-0387', cedula: '001-1997803-6', commission_pct: 20, start_date: '2026-02-15' },
  ]
  // Assign supabase_id upfront so ticket/commission inserts below can reference them.
  washers.forEach(w => {
    w.supabase_id = uuid()
    insEmpLavador.run({
      nombre: w.name, salary: srand(15, 20) * 1000, start_date: w.start_date,
      cedula: w.cedula, phone: w.phone, comision_pct: w.commission_pct,
      supabase_id: w.supabase_id,
    })
  })

  const insEmpVendedor = db.prepare(`INSERT OR IGNORE INTO empleados(nombre,tipo,salary,start_date,cedula,phone,comision_pct,role,active,supabase_id,updated_at) VALUES(@nombre,'vendedor',@salary,@start_date,@cedula,@phone,@comision_pct,'none',1,@supabase_id,datetime('now'))`)
  const sellers = [
    { name: 'Ana Martinez', commission_pct: 5, phone: '829-401-2233' },
    { name: 'Roberto Santos', commission_pct: 7, phone: '829-502-3344' },
    { name: 'Yesenia Polanco', commission_pct: 3, phone: '829-603-4455' },
    { name: 'Fernando Vega', commission_pct: 6, phone: '829-704-5566' },
  ]
  sellers.forEach(s => {
    s.supabase_id = uuid()
    s.cedula = `001-${srand(1980, 2000)}${srand(100, 999)}-${srand(1, 9)}`
    insEmpVendedor.run({
      nombre: s.name, salary: srand(18, 25) * 1000, start_date: '2025-06-01',
      cedula: s.cedula, phone: s.phone, comision_pct: s.commission_pct,
      supabase_id: s.supabase_id,
    })
  })

  const insClient = db.prepare(`INSERT INTO clients(name,rnc,phone,email,address,credit_limit,balance,visits,total_spent,notes,active) VALUES(@name,@rnc,@phone,@email,@address,@credit_limit,@balance,@visits,@total_spent,@notes,1)`)
  const clientsData = [
    { name: 'Empresa XYZ SRL', rnc: '130-12345-6', phone: '809-200-0001', email: 'admin@xyz.com', address: 'C/ Principal #5, Santiago', credit_limit: 10000, balance: 3500, visits: 0, total_spent: 0, notes: 'Cliente frecuente' },
    { name: 'Juan Carlos Familia', rnc: '', phone: '829-300-0001', email: '', address: '', credit_limit: 5000, balance: 1200, visits: 0, total_spent: 0, notes: '' },
    { name: 'Maria Santos', rnc: '', phone: '849-400-0001', email: 'msantos@email.com', address: 'Los Jardines, Santiago', credit_limit: 0, balance: 0, visits: 0, total_spent: 0, notes: '' },
    { name: 'Constructora ABC SRL', rnc: '130-55555-8', phone: '809-200-0002', email: 'contab@abc.do', address: 'Zona Industrial, Santiago', credit_limit: 15000, balance: 8000, visits: 0, total_spent: 0, notes: 'Paga quincenal' },
    { name: 'Pedro Gonzalez', rnc: '', phone: '829-300-0002', email: '', address: '', credit_limit: 0, balance: 0, visits: 0, total_spent: 0, notes: '' },
    { name: 'Auto Dealer Premium SRL', rnc: '130-77777-3', phone: '809-200-0003', email: 'ventas@autopremium.do', address: 'Av. Estrella Sadhala, STG', credit_limit: 20000, balance: 0, visits: 0, total_spent: 0, notes: 'Cuenta corporativa' },
    { name: 'Farmacia La Salud', rnc: '130-44444-2', phone: '809-200-0004', email: '', address: 'C/ Beller #88, Santiago', credit_limit: 8000, balance: 2000, visits: 0, total_spent: 0, notes: '' },
    { name: 'Luis Marte', rnc: '', phone: '829-300-0003', email: '', address: '', credit_limit: 0, balance: 0, visits: 0, total_spent: 0, notes: '' },
    { name: 'Carmen Rivera', rnc: '', phone: '849-400-0002', email: '', address: '', credit_limit: 3000, balance: 800, visits: 0, total_spent: 0, notes: '' },
    { name: 'Supermercado El Colmado', rnc: '130-33333-9', phone: '809-200-0005', email: 'pagos@colmado.do', address: 'Av. Circunvalacion #200, STG', credit_limit: 12000, balance: 5500, visits: 0, total_spent: 0, notes: 'Pago mensual' },
    { name: 'Distribuidora Nacional SRL', rnc: '130-88812-4', phone: '809-331-5500', email: 'compras@distnac.do', address: 'C/ Duarte #150, Santiago', credit_limit: 25000, balance: 12000, visits: 0, total_spent: 0, notes: 'Flota 15 vehiculos' },
    { name: 'Jose Miguel Peralta', rnc: '', phone: '829-665-1234', email: 'jmperalta@gmail.com', address: 'Res. Los Pinos, STG', credit_limit: 5000, balance: 0, visits: 0, total_spent: 0, notes: '' },
    { name: 'Taller Mecanico Duarte', rnc: '130-91234-1', phone: '809-582-4400', email: '', address: 'Av. 27 de Febrero #77, STG', credit_limit: 8000, balance: 3200, visits: 0, total_spent: 0, notes: 'Envian clientes' },
    { name: 'Rosa Almonte', rnc: '', phone: '849-223-8877', email: '', address: '', credit_limit: 0, balance: 0, visits: 0, total_spent: 0, notes: '' },
    { name: 'Ingenieria Avanzada SRL', rnc: '130-65432-7', phone: '809-724-1100', email: 'admin@ingavanz.do', address: 'C/ Restauracion #33, STG', credit_limit: 18000, balance: 7500, visits: 0, total_spent: 0, notes: 'Factura quincenal' },
    { name: 'Freddy Encarnacion', rnc: '', phone: '829-887-4411', email: '', address: 'Gurabo, Santiago', credit_limit: 2000, balance: 500, visits: 0, total_spent: 0, notes: '' },
    { name: 'Seguros La Colonial', rnc: '130-22111-5', phone: '809-580-3300', email: 'flota@colonial.do', address: 'Av. Juan Pablo Duarte, STG', credit_limit: 30000, balance: 15000, visits: 0, total_spent: 0, notes: 'Flota ejecutiva 20+ vehiculos' },
    { name: 'Angela Bautista', rnc: '', phone: '849-112-5566', email: 'angela.b@hotmail.com', address: '', credit_limit: 0, balance: 0, visits: 0, total_spent: 0, notes: '' },
    { name: 'Importadora Del Cibao SRL', rnc: '130-45678-3', phone: '809-241-8800', email: 'pagos@impcibao.do', address: 'Zona Franca Industrial, STG', credit_limit: 15000, balance: 4500, visits: 0, total_spent: 0, notes: '' },
    { name: 'Marcos Feliz', rnc: '', phone: '829-334-7700', email: '', address: '', credit_limit: 0, balance: 0, visits: 0, total_spent: 0, notes: '' },
    { name: 'Clinica Santiago SRL', rnc: '130-10987-6', phone: '809-580-1200', email: 'admin@clinicasantiago.do', address: 'C/ del Sol #45, STG', credit_limit: 10000, balance: 2800, visits: 0, total_spent: 0, notes: 'Ambulancias incluidas' },
    { name: 'Willy De Los Santos', rnc: '', phone: '829-556-2211', email: '', address: 'Licey al Medio', credit_limit: 3000, balance: 0, visits: 0, total_spent: 0, notes: '' },
    { name: 'Hotel Gran Caribe SRL', rnc: '130-34521-8', phone: '809-575-6000', email: 'maint@grancaribe.do', address: 'Av. Las Carreras, STG', credit_limit: 20000, balance: 9000, visits: 0, total_spent: 0, notes: 'Shuttle vans + exec vehicles' },
    { name: 'Raquel Jimenez', rnc: '', phone: '849-778-3344', email: '', address: '', credit_limit: 0, balance: 0, visits: 0, total_spent: 0, notes: '' },
    { name: 'Multiservicio El Punto SRL', rnc: '130-56789-2', phone: '809-247-9900', email: '', address: 'Av. Hispanoamerica #88, STG', credit_limit: 6000, balance: 1800, visits: 0, total_spent: 0, notes: '' },
  ]
  clientsData.forEach(c => insClient.run(c))

  // credit clients (have balance > 0): IDs 1,2,4,7,9,10,11,13,15,16,17,19,21,23,25
  const creditClientIds = [1, 2, 4, 7, 9, 10, 11, 13, 15, 16, 17, 19, 21, 23, 25]

  const SERVICES = [
    { id: 1, name: 'Lavado Basico', price: 500, is_wash: 1 },
    { id: 2, name: 'Lavado Completo', price: 800, is_wash: 1 },
    { id: 3, name: 'Lavado de Motor', price: 1200, is_wash: 1 },
    { id: 4, name: 'Lavado Jeepeta', price: 1000, is_wash: 1 },
    { id: 5, name: 'Lavado Camion', price: 1800, is_wash: 1 },
    { id: 6, name: 'Aromatizante', price: 150, is_wash: 1 },
    { id: 7, name: 'Brillo de Gomas', price: 200, is_wash: 1 },
    { id: 8, name: 'Aspirado Interior', price: 400, is_wash: 1 },
    { id: 9, name: 'Ozono', price: 1200, is_wash: 1 },
    { id: 10, name: 'Lavado + Cera', price: 2000, is_wash: 1 },
    { id: 11, name: 'Lavado + Aspirado', price: 1100, is_wash: 1 },
    { id: 12, name: 'Detailing Completo', price: 4500, is_wash: 1 },
    { id: 13, name: 'Agua Fria', price: 50, is_wash: 0 },
    { id: 14, name: 'Refresco', price: 100, is_wash: 0 },
    { id: 15, name: 'Cafe', price: 75, is_wash: 0 },
    { id: 16, name: 'Papitas', price: 80, is_wash: 0 },
    { id: 17, name: 'Galletas', price: 60, is_wash: 0 },
  ]

  const PLATES_PREFIX = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'K', 'L']
  const MAKES = ['Toyota', 'Honda', 'Hyundai', 'Nissan', 'Kia', 'Jeep', 'Ford', 'BMW', 'Mercedes', 'Chevrolet', 'Mitsubishi', 'Suzuki']
  const COLORS = ['Blanco', 'Negro', 'Rojo', 'Gris', 'Plateado', 'Azul', 'Verde', 'Beige', 'Marron']
  const CAJERO_IDS = [3, 5]
  // v2.1: WASHER_IDS / SELLER_IDS removed — ticket seed walks empleados directly via .supabase_id.

  // v2.1: ticket writes new `washer_empleado_supabase_ids` JSON column + `seller_empleado_supabase_id`.
  // washer/seller commissions FK to empleados via empleado_supabase_id.
  const insTicket = db.prepare(`INSERT INTO tickets(doc_number,client_id,washer_empleado_supabase_ids,seller_empleado_supabase_id,cajero_id,subtotal,descuento,itbis,ley,total,payment_method,comprobante_type,ncf,tipo_venta,status,vehicle_plate,vehicle_make,vehicle_color,void_reason,void_by,void_at,created_at) VALUES(@doc_number,@client_id,@washer_empleado_supabase_ids,@seller_empleado_supabase_id,@cajero_id,@subtotal,@descuento,@itbis,@ley,@total,@payment_method,@comprobante_type,@ncf,@tipo_venta,@status,@vehicle_plate,@vehicle_make,@vehicle_color,@void_reason,@void_by,@void_at,@created_at)`)
  const insItem = db.prepare(`INSERT INTO ticket_items(ticket_id,service_id,name,price,itbis,is_wash) VALUES(@ticket_id,@service_id,@name,@price,@itbis,@is_wash)`)
  const insQueue = db.prepare(`INSERT INTO queue(ticket_id,status,empleado_supabase_id,assigned_at,completed_at,created_at) VALUES(@ticket_id,@status,@empleado_supabase_id,@assigned_at,@completed_at,@created_at)`)
  const insWasherComm = db.prepare(`INSERT INTO washer_commissions(empleado_supabase_id,ticket_id,base_amount,commission_pct,commission_amount,created_at) VALUES(@empleado_supabase_id,@ticket_id,@base_amount,@commission_pct,@commission_amount,@created_at)`)
  const insSellerComm = db.prepare(`INSERT INTO seller_commissions(empleado_supabase_id,ticket_id,base_amount,commission_pct,commission_amount,created_at) VALUES(@empleado_supabase_id,@ticket_id,@base_amount,@commission_pct,@commission_amount,@created_at)`)
  const insCajeroComm = db.prepare(`INSERT INTO cajero_commissions(cajero_id,ticket_id,base_amount,commission_pct,commission_amount,created_at) VALUES(@cajero_id,@ticket_id,@base_amount,@commission_pct,@commission_amount,@created_at)`)

  let b01N = 1, b02N = 1, docN = 1
  const ticketsByDay = {}
  const allTicketIds = []
  const ticketsWithClients = []

  // void targets: ticket indices
  const VOID_INDICES = new Set([15, 78, 210, 445])
  let ticketIndex = 0

  db.transaction(() => {
    for (let dayOffset = 89; dayOffset >= 0; dayOffset--) {
      const d = daysAgoDate(dayOffset)
      const dow = d.getDay()
      const dateKey = dateStr(d)
      const isWeekend = dow === 0 || dow === 6
      const baseCount = isWeekend ? srand(8, 12) : srand(5, 9)

      if (!ticketsByDay[dateKey]) ticketsByDay[dateKey] = { cash: 0, card: 0, transfer: 0, credit: 0, total: 0, count: 0 }
      const dayStats = ticketsByDay[dateKey]

      for (let t = 0; t < baseCount; t++) {
        const hour = srand(7, 17)
        const minute = hour === 7 ? srand(30, 59) : srand(0, 59)
        const createdAt = ts(d, hour, minute)
        const docDate = dateStr(d).replace(/-/g, '')

        const numServices = srand(1, 4)
        const usedIds = new Set()
        const items = []
        // always pick a wash first
        const washSvcs = SERVICES.filter(s => s.is_wash && s.id <= 12)
        const firstSvc = spick(washSvcs)
        usedIds.add(firstSvc.id)
        items.push(firstSvc)
        for (let si = 1; si < numServices; si++) {
          const pool = SERVICES.filter(s => !usedIds.has(s.id))
          if (!pool.length) break
          const s = spick(pool)
          usedIds.add(s.id)
          items.push(s)
        }

        const subtotal = items.reduce((a, i) => a + i.price, 0)
        const washSubtotal = items.filter(i => i.is_wash).reduce((a, i) => a + i.price, 0)
        const itbis = round2(items.reduce((a, i) => a + (i.is_wash ? round2(i.price * 0.18) : 0), 0))
        const total = round2(subtotal + itbis)

        const roll = srand(1, 100)
        let paymentMethod, tipoVenta, clientId = null, isB01 = false
        if (roll <= 60) { paymentMethod = 'cash'; tipoVenta = 'contado' }
        else if (roll <= 75) { paymentMethod = 'card'; tipoVenta = 'contado' }
        else if (roll <= 90) { paymentMethod = 'transfer'; tipoVenta = 'contado' }
        else {
          paymentMethod = 'credit'; tipoVenta = 'credito'
          clientId = spick(creditClientIds)
          isB01 = true
        }

        // 20% of non-credit tickets get a client too (for B01 corporate)
        if (!clientId && srand(1, 100) <= 20) {
          clientId = srand(1, 25)
          const cl = clientsData[clientId - 1]
          if (cl.rnc) isB01 = true
        }

        const numWashers = srand(1, 100) <= 25 ? 2 : 1
        // v2.1: walk empleado supabase_id array instead of INT ids.
        const wIndexes = []
        for (let w = 0; w < numWashers; w++) {
          let wi = srand(0, washers.length - 1)
          while (wIndexes.includes(wi)) wi = srand(0, washers.length - 1)
          wIndexes.push(wi)
        }
        const wSids = wIndexes.map(i => washers[i].supabase_id)

        const sellerIdx = srand(1, 100) <= 40 ? srand(0, sellers.length - 1) : -1
        const sellerSid = sellerIdx >= 0 ? sellers[sellerIdx].supabase_id : null
        const cajeroId = spick(CAJERO_IDS)

        const isVoid = VOID_INDICES.has(ticketIndex)
        const status = isVoid ? 'nula' : (tipoVenta === 'credito' ? 'pendiente' : 'cobrado')

        const ncf = isB01 ? `B01${String(b01N++).padStart(8, '0')}` : `B02${String(b02N++).padStart(8, '0')}`
        const plate = spick(PLATES_PREFIX) + String(srand(100000, 999999))

        const row = {
          doc_number: `T-${docDate}-${String(docN++).padStart(4, '0')}`,
          client_id: clientId,
          washer_empleado_supabase_ids: JSON.stringify(wSids),
          seller_empleado_supabase_id: sellerSid,
          cajero_id: cajeroId,
          subtotal, descuento: 0, itbis, ley: 0, total,
          payment_method: tipoVenta === 'credito' ? 'credit' : paymentMethod,
          comprobante_type: isB01 ? 'B01' : 'B02', ncf, tipo_venta: tipoVenta, status,
          vehicle_plate: plate, vehicle_make: spick(MAKES), vehicle_color: spick(COLORS),
          void_reason: isVoid ? 'Error de cobro' : null, void_by: isVoid ? 1 : null,
          void_at: isVoid ? createdAt : null, created_at: createdAt,
        }

        const { lastInsertRowid: tid } = insTicket.run(row)
        allTicketIds.push(tid)
        if (clientId) ticketsWithClients.push({ tid, clientId, total })
        ticketIndex++

        items.forEach(i => insItem.run({
          ticket_id: tid, service_id: i.id, name: i.name, price: i.price,
          itbis: i.is_wash ? round2(i.price * 0.18) : 0, is_wash: i.is_wash,
        }))

        // queue (v2.1 — empleado_supabase_id)
        const completedMin = srand(20, 45)
        const completedDate = new Date(d)
        completedDate.setHours(hour, minute + completedMin, 0, 0)
        insQueue.run({
          ticket_id: tid, status: 'done', empleado_supabase_id: wSids[0],
          assigned_at: createdAt, completed_at: completedDate.toISOString().replace('Z', '').slice(0, 19),
          created_at: createdAt,
        })

        // washer/seller commissions (v2.1 — empleado_supabase_id)
        if (!isVoid) {
          const perWasher = round2(washSubtotal / wSids.length)
          wIndexes.forEach((wi, idx) => {
            const w = washers[wi]
            insWasherComm.run({ empleado_supabase_id: w.supabase_id, ticket_id: tid, base_amount: perWasher, commission_pct: w.commission_pct, commission_amount: round2(perWasher * w.commission_pct / 100), created_at: createdAt })
          })
          if (sellerSid) {
            const s = sellers[sellerIdx]
            insSellerComm.run({ empleado_supabase_id: s.supabase_id, ticket_id: tid, base_amount: washSubtotal, commission_pct: s.commission_pct, commission_amount: round2(washSubtotal * s.commission_pct / 100), created_at: createdAt })
          }
          insCajeroComm.run({ cajero_id: cajeroId, ticket_id: tid, base_amount: total, commission_pct: 2, commission_amount: round2(total * 0.02), created_at: createdAt })
        }

        if (!isVoid) {
          if (paymentMethod === 'cash' || tipoVenta === 'credito') dayStats.cash += total
          if (paymentMethod === 'card') dayStats.card += total
          if (paymentMethod === 'transfer') dayStats.transfer += total
          if (tipoVenta === 'credito') dayStats.credit += total
          dayStats.total += total
          dayStats.count++
        }
      }
    }

    // credit payments - 30 payments spread across last 90 days
    const insCreditPay = db.prepare(`INSERT INTO credit_payments(client_id,ticket_ids,amount,payment_method,ncf,cajero_id,created_at) VALUES(@client_id,@ticket_ids,@amount,@payment_method,@ncf,@cajero_id,@created_at)`)
    for (let i = 0; i < 30; i++) {
      const dayOff = srand(1, 85)
      const d = daysAgoDate(dayOff)
      const cid = spick(creditClientIds)
      const amt = srand(5, 40) * 100
      const pm = spick(['cash', 'cash', 'cash', 'card', 'transfer'])
      insCreditPay.run({
        client_id: cid, ticket_ids: '[]', amount: amt, payment_method: pm,
        ncf: null, cajero_id: spick(CAJERO_IDS), created_at: ts(d, srand(8, 17), srand(0, 59)),
      })
    }

    // cuadre de caja - for each day that had tickets
    const insCuadre = db.prepare(`INSERT INTO cuadre_caja(cajero_id,date,fondo,efectivo_conteo,efectivo_sistema,tarjeta,transferencia,cheque,creditos,salidas,total_vendido,total_cobrado,cierre_total,diferencia,comentario,closed_at) VALUES(@cajero_id,@date,@fondo,@efectivo_conteo,@efectivo_sistema,@tarjeta,@transferencia,@cheque,@creditos,@salidas,@total_vendido,@total_cobrado,@cierre_total,@diferencia,@comentario,@closed_at)`)
    for (const [dateKey, stats] of Object.entries(ticketsByDay)) {
      if (stats.count === 0) continue
      const cash = round2(stats.cash)
      const dif = spick([-200, -100, -50, 0, 0, 0, 0, 50, 100, 150])
      insCuadre.run({
        cajero_id: spick(CAJERO_IDS), date: dateKey, fondo: 5000,
        efectivo_conteo: round2(cash + 5000 + dif), efectivo_sistema: round2(cash + 5000),
        tarjeta: round2(stats.card), transferencia: round2(stats.transfer),
        cheque: 0, creditos: round2(stats.credit), salidas: 0,
        total_vendido: round2(stats.total), total_cobrado: round2(stats.total - stats.credit),
        cierre_total: round2(stats.total + 5000), diferencia: dif,
        comentario: dif !== 0 ? (dif > 0 ? 'Sobrante en caja' : 'Faltante menor') : '',
        closed_at: `${dateKey}T18:30:00`,
      })
    }

    // caja chica - 45 entries
    const insCajaChica = db.prepare(`INSERT INTO caja_chica(description,category,type,amount,recibo,status,approved_by,cajero_id,created_at) VALUES(@description,@category,@type,@amount,@recibo,@status,@approved_by,@cajero_id,@created_at)`)
    const ccCategories = ['Materiales', 'Comida', 'Transporte', 'Otros', 'Mantenimiento']
    const ccDescs = {
      Materiales: ['Shampo para autos', 'Cera liquida', 'Microfibras', 'Brillo de gomas gallon', 'Desengrasante', 'Toallas secado'],
      Comida: ['Almuerzo equipo', 'Agua para empleados', 'Cafe y galletas', 'Desayuno sabado'],
      Transporte: ['Gasolina moto delivery', 'Uber recogida materiales', 'Pasaje bus empleado'],
      Otros: ['Papel impresora termica', 'Toner oficina', 'Pilas control remoto'],
      Mantenimiento: ['Reparacion bomba agua', 'Manguera nueva', 'Cambio bombillo area lavado', 'Pintura pared entrada'],
    }
    const ccStatuses = ['aprobado', 'aprobado', 'aprobado', 'aprobado', 'pendiente', 'rechazado']
    for (let i = 0; i < 45; i++) {
      const cat = spick(ccCategories)
      const descs = ccDescs[cat]
      const st = spick(ccStatuses)
      const dayOff = srand(0, 89)
      const d = daysAgoDate(dayOff)
      insCajaChica.run({
        description: spick(descs), category: cat, type: 'Gasto', amount: srand(1, 30) * 100,
        recibo: srand(1, 100) <= 60 ? `RC-${srand(1000, 9999)}` : null,
        status: st, approved_by: st === 'aprobado' ? 1 : null, cajero_id: spick(CAJERO_IDS),
        created_at: ts(d, srand(8, 17), srand(0, 59)),
      })
    }

    // notas de credito - 10
    const insNota = db.prepare(`INSERT INTO notas_credito(ncf,client_id,original_ticket_id,motivo,amount,itbis_revertido,forma_devolucion,comentario,cajero_id,created_at) VALUES(@ncf,@client_id,@original_ticket_id,@motivo,@amount,@itbis_revertido,@forma_devolucion,@comentario,@cajero_id,@created_at)`)
    const motivos = ['Devolucion', 'Error de cobro', 'Descuento posterior', 'Servicio no realizado', 'Devolucion parcial']
    for (let i = 0; i < 10; i++) {
      const tid = allTicketIds[srand(5, Math.min(allTicketIds.length - 1, 100))]
      const amt = srand(5, 45) * 100
      const dayOff = srand(0, 60)
      const d = daysAgoDate(dayOff)
      insNota.run({
        ncf: `B04${String(i + 1).padStart(8, '0')}`, client_id: srand(1, 100) <= 50 ? srand(1, 25) : null,
        original_ticket_id: tid, motivo: spick(motivos), amount: amt,
        itbis_revertido: round2(amt * 0.18), forma_devolucion: spick(['Efectivo', 'Nota de Credito', 'Efectivo']),
        comentario: '', cajero_id: spick(CAJERO_IDS), created_at: ts(d, srand(9, 16), srand(0, 59)),
      })
    }

    // inventory items - 22
    const insInvItem = db.prepare(`INSERT INTO inventory_items(sku,name,category,quantity,min_quantity,price,cost,active) VALUES(@sku,@name,@category,@quantity,@min_quantity,@price,@cost,1)`)
    const invItems = [
      { sku: 'SHP-001', name: 'Shampo Concentrado 5gal', category: 'Quimicos', quantity: 8, min_quantity: 3, price: 2500, cost: 1800 },
      { sku: 'CER-001', name: 'Cera Liquida 1gal', category: 'Quimicos', quantity: 12, min_quantity: 5, price: 1800, cost: 1200 },
      { sku: 'CER-002', name: 'Cera Carnauba Pasta', category: 'Quimicos', quantity: 6, min_quantity: 3, price: 3500, cost: 2400 },
      { sku: 'BRG-001', name: 'Brillo de Gomas 1gal', category: 'Quimicos', quantity: 10, min_quantity: 4, price: 1500, cost: 950 },
      { sku: 'DES-001', name: 'Desengrasante Motor 5gal', category: 'Quimicos', quantity: 4, min_quantity: 2, price: 3200, cost: 2100 },
      { sku: 'ARO-001', name: 'Aromatizante Carro Nuevo', category: 'Aromatizantes', quantity: 45, min_quantity: 20, price: 150, cost: 65 },
      { sku: 'ARO-002', name: 'Aromatizante Vainilla', category: 'Aromatizantes', quantity: 38, min_quantity: 20, price: 150, cost: 65 },
      { sku: 'ARO-003', name: 'Aromatizante Fresh Linen', category: 'Aromatizantes', quantity: 25, min_quantity: 20, price: 150, cost: 65 },
      { sku: 'MIC-001', name: 'Microfibra 40x40cm', category: 'Materiales', quantity: 30, min_quantity: 15, price: 250, cost: 120 },
      { sku: 'MIC-002', name: 'Microfibra Secado XL', category: 'Materiales', quantity: 15, min_quantity: 8, price: 450, cost: 280 },
      { sku: 'ESP-001', name: 'Esponja Lavado Grande', category: 'Materiales', quantity: 20, min_quantity: 10, price: 180, cost: 85 },
      { sku: 'GUA-001', name: 'Guantes Latex Caja 100', category: 'Materiales', quantity: 5, min_quantity: 3, price: 800, cost: 550 },
      { sku: 'MAN-001', name: 'Manguera Presion 50ft', category: 'Equipo', quantity: 3, min_quantity: 1, price: 4500, cost: 3200 },
      { sku: 'BOQ-001', name: 'Boquilla Presion Ajustable', category: 'Equipo', quantity: 6, min_quantity: 2, price: 1200, cost: 750 },
      { sku: 'CUB-001', name: 'Cubeta 5gal Resistente', category: 'Materiales', quantity: 12, min_quantity: 5, price: 350, cost: 200 },
      { sku: 'ASP-001', name: 'Bolsa Aspiradora Industrial', category: 'Equipo', quantity: 8, min_quantity: 4, price: 600, cost: 380 },
      { sku: 'VID-001', name: 'Limpiador Vidrios 1gal', category: 'Quimicos', quantity: 7, min_quantity: 3, price: 1100, cost: 700 },
      { sku: 'INT-001', name: 'Limpiador Interior 1gal', category: 'Quimicos', quantity: 5, min_quantity: 3, price: 1400, cost: 900 },
      { sku: 'PPT-001', name: 'Papel Termico 80mm x10', category: 'Oficina', quantity: 18, min_quantity: 10, price: 120, cost: 75 },
      { sku: 'JAB-001', name: 'Jabon Manos Gallon', category: 'Limpieza', quantity: 4, min_quantity: 2, price: 450, cost: 280 },
      { sku: 'CLO-001', name: 'Cloro Gallon', category: 'Limpieza', quantity: 6, min_quantity: 3, price: 350, cost: 180 },
      { sku: 'PUL-001', name: 'Pulimento Fino 1qt', category: 'Quimicos', quantity: 3, min_quantity: 2, price: 2800, cost: 1900 },
    ]
    invItems.forEach(item => insInvItem.run(item))

    // inventory transactions - 18
    const insInvTx = db.prepare(`INSERT INTO inventory_transactions(item_id,type,delta,notes,user_id,created_at) VALUES(@item_id,@type,@delta,@notes,@user_id,@created_at)`)
    const invTxTypes = ['compra', 'compra', 'compra', 'ajuste', 'uso', 'uso', 'uso']
    for (let i = 0; i < 18; i++) {
      const itemId = srand(1, invItems.length)
      const txType = spick(invTxTypes)
      const delta = txType === 'compra' ? srand(5, 25) : (txType === 'uso' ? -srand(1, 5) : srand(-3, 3))
      const dayOff = srand(0, 89)
      const d = daysAgoDate(dayOff)
      insInvTx.run({ item_id: itemId, type: txType, delta, notes: txType === 'compra' ? 'Compra proveedor' : (txType === 'uso' ? 'Uso diario' : 'Ajuste inventario'), user_id: 1, created_at: ts(d, srand(8, 16), srand(0, 59)) })
    }

    // empleados — cashiers only (lavadores + vendedores already seeded above with UUIDs).
    // v2.1: the mirroring step (ref_id → washers/sellers) is gone since those tables no longer exist.
    const insEmpCajero = db.prepare(`INSERT INTO empleados(nombre,tipo,ref_id,salary,start_date,cedula,phone,role,active,supabase_id,updated_at) VALUES(@nombre,'cajero',@ref_id,@salary,@start_date,@cedula,@phone,'cashier',1,@supabase_id,datetime('now'))`)
    ;[{ name: 'Maria Gonzalez', id: 3 }, { name: 'Luisa Batista', id: 5 }].forEach(c => {
      insEmpCajero.run({ nombre: c.name, ref_id: c.id, salary: srand(20, 28) * 1000, start_date: '2025-06-01', cedula: `402-${srand(1985, 2000)}${srand(100, 999)}-${srand(1, 9)}`, phone: `829-${srand(100, 999)}-${srand(1000, 9999)}`, supabase_id: uuid() })
    })

    // compras 607 - 18 purchase records
    const insCompra = db.prepare(`INSERT INTO compras_607(rnc_proveedor,nombre_proveedor,tipo_ncf,ncf,fecha_ncf,fecha_pago,monto_servicios,monto_bienes,total,itbis_facturado,itbis_retenido,retencion_renta,forma_pago,notas) VALUES(@rnc_proveedor,@nombre_proveedor,@tipo_ncf,@ncf,@fecha_ncf,@fecha_pago,@monto_servicios,@monto_bienes,@total,@itbis_facturado,@itbis_retenido,@retencion_renta,@forma_pago,@notas)`)
    const proveedores = [
      { rnc: '130-82145-3', nombre: 'Quimicos Del Cibao SRL' },
      { rnc: '130-41098-7', nombre: 'Distribuidora Clean Pro SRL' },
      { rnc: '130-55678-1', nombre: 'AutoParts Santiago SRL' },
      { rnc: '130-67890-4', nombre: 'Ferreteria Industrial La Fe' },
      { rnc: '130-23456-9', nombre: 'Importadora De Quimicos RD' },
      { rnc: '130-34567-2', nombre: 'Plomeria y Mas SRL' },
    ]
    for (let i = 0; i < 18; i++) {
      const prov = spick(proveedores)
      const dayOff = srand(2, 88)
      const d = daysAgoDate(dayOff)
      const ds = dateStr(d)
      const bienes = srand(10, 150) * 100
      const servicios = srand(1, 100) <= 30 ? srand(5, 30) * 100 : 0
      const subtotal = bienes + servicios
      const itbis = round2(subtotal * 0.18)
      insCompra.run({
        rnc_proveedor: prov.rnc, nombre_proveedor: prov.nombre, tipo_ncf: 'B01',
        ncf: `B01${String(srand(1, 99999)).padStart(8, '0')}`, fecha_ncf: ds, fecha_pago: ds,
        monto_servicios: servicios, monto_bienes: bienes, total: round2(subtotal + itbis),
        itbis_facturado: itbis, itbis_retenido: 0, retencion_renta: 0,
        forma_pago: spick(['efectivo', 'transferencia', 'efectivo', 'cheque']), notas: '',
      })
    }

    // update client visits and total_spent from tickets
    const updateClient = db.prepare(`UPDATE clients SET visits = (SELECT COUNT(*) FROM tickets WHERE client_id = clients.id AND status != 'nula'), total_spent = COALESCE((SELECT SUM(total) FROM tickets WHERE client_id = clients.id AND status != 'nula'), 0) WHERE id = ?`)
    for (let cid = 1; cid <= 25; cid++) updateClient.run(cid)

    // update NCF sequences
    db.prepare(`UPDATE ncf_sequences SET current_number=@n WHERE type='B02'`).run({ n: b02N - 1 })
    db.prepare(`UPDATE ncf_sequences SET current_number=@n WHERE type='B01'`).run({ n: b01N - 1 })
    db.prepare(`UPDATE secuencias_ncf SET secuencia_actual=@n WHERE tipo='B02'`).run({ n: b02N - 1 })
    db.prepare(`UPDATE secuencias_ncf SET secuencia_actual=@n WHERE tipo='B01'`).run({ n: b01N - 1 })
  })()
}
