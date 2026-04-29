// Marketing demo seed for /probar/carwash. Pure static data — never touches
// Supabase, electronAPI, or any real DB. This mirrors the shape of a real
// Terminal X carwash account so the demo feels exactly like the production POS.

export const BUSINESS = {
  name: 'Studio X Car Wash',
  rnc: '133-41032-1',
  address: 'Av. 27 de Febrero #245, Santo Domingo',
  phone: '809-555-0123',
  user: { name: 'Maria Rodriguez', role: 'cashier' },
  ncf_b02: 'B0200001847',
  ncf_e32: 'E320000001847',
  cert_subject: 'Studio X Car Wash · CN=133410321',
  cert_expires: '2027-03-15',
}

export const CATEGORIES = [
  { id: 'lavados',    label: 'Lavados' },
  { id: 'detallado',  label: 'Detallado' },
  { id: 'interior',   label: 'Interior' },
  { id: 'especial',   label: 'Especial' },
  { id: 'mecanica',   label: 'Mecanica Express' },
  { id: 'productos',  label: 'Productos' },
]

export const SERVICES = {
  lavados: [
    { id: 1,  name: 'Lavado Express',         price: 200,  time: '15 min', commission_pct: 30 },
    { id: 2,  name: 'Lavado Completo',        price: 450,  time: '30 min', commission_pct: 30 },
    { id: 3,  name: 'Lavado + Aspirado',      price: 600,  time: '40 min', commission_pct: 30 },
    { id: 4,  name: 'Lavado SUV / Camioneta', price: 550,  time: '35 min', commission_pct: 30 },
    { id: 5,  name: 'Lavado Camion / Bus',    price: 950,  time: '60 min', commission_pct: 35 },
    { id: 6,  name: 'Lavado Premium',         price: 850,  time: '50 min', commission_pct: 35 },
  ],
  detallado: [
    { id: 10, name: 'Encerado a Mano',        price: 800,  time: '45 min', commission_pct: 35 },
    { id: 11, name: 'Pulido + Encerado',      price: 2500, time: '2 horas', commission_pct: 35 },
    { id: 12, name: 'Detallado Completo',     price: 4500, time: '4 horas', commission_pct: 40 },
    { id: 13, name: 'Sellador Ceramico 6m',   price: 8500, time: '6 horas', commission_pct: 40 },
    { id: 14, name: 'Restauracion de Faros',  price: 1500, time: '60 min', commission_pct: 35 },
    { id: 15, name: 'Pulido de Aros',         price: 700,  time: '40 min', commission_pct: 30 },
  ],
  interior: [
    { id: 20, name: 'Aspirado Profundo',      price: 350,  time: '20 min', commission_pct: 30 },
    { id: 21, name: 'Limpieza Tapiceria',     price: 1800, time: '90 min', commission_pct: 35 },
    { id: 22, name: 'Limpieza Alfombras',     price: 900,  time: '45 min', commission_pct: 35 },
    { id: 23, name: 'Tratamiento Cuero',      price: 2200, time: '90 min', commission_pct: 40 },
    { id: 24, name: 'Desinfeccion Ozono',     price: 1200, time: '40 min', commission_pct: 35 },
    { id: 25, name: 'Eliminacion Olores',     price: 1500, time: '60 min', commission_pct: 35 },
  ],
  especial: [
    { id: 30, name: 'Lavado Motor',           price: 700,  time: '30 min', commission_pct: 35 },
    { id: 31, name: 'Lavado Chassis',         price: 500,  time: '20 min', commission_pct: 30 },
    { id: 32, name: 'Sellado Plasticos',      price: 600,  time: '30 min', commission_pct: 30 },
    { id: 33, name: 'Brillado de Llantas',    price: 250,  time: '15 min', commission_pct: 25 },
  ],
  mecanica: [
    { id: 40, name: 'Cambio de Aceite',       price: 1200, time: '20 min', commission_pct: 20 },
    { id: 41, name: 'Cambio Filtro Aire',     price: 600,  time: '15 min', commission_pct: 20 },
    { id: 42, name: 'Revision de Frenos',     price: 800,  time: '30 min', commission_pct: 25 },
    { id: 43, name: 'Bateria Test + Carga',   price: 400,  time: '20 min', commission_pct: 20 },
  ],
  productos: [
    { id: 50, name: 'Ambientador Premium',    price: 250,  time: null, commission_pct: 10 },
    { id: 51, name: 'Cera Liquida 500ml',     price: 850,  time: null, commission_pct: 10 },
    { id: 52, name: 'Toallas de Microfibra',  price: 350,  time: null, commission_pct: 10 },
    { id: 53, name: 'Limpiavidrios 1L',       price: 480,  time: null, commission_pct: 10 },
  ],
}

export const LAVADORES = [
  { id: 1, name: 'Juan Perez',    initials: 'JP', active: true, ticketsToday: 8, commissionToday: 1240, status: 'libre' },
  { id: 2, name: 'Pedro Ramirez', initials: 'PR', active: true, ticketsToday: 6, commissionToday:  980, status: 'ocupado' },
  { id: 3, name: 'Carlos Mejia',  initials: 'CM', active: true, ticketsToday: 5, commissionToday:  760, status: 'ocupado' },
  { id: 4, name: 'Luis Santana',  initials: 'LS', active: true, ticketsToday: 4, commissionToday:  580, status: 'ocupado' },
  { id: 5, name: 'Diego Rosario', initials: 'DR', active: true, ticketsToday: 3, commissionToday:  420, status: 'libre' },
]

export const QUEUE = [
  {
    id: 'TX-1042', placa: 'A123456', client: 'Roberto Castillo', client_id: 1, vehicle: 'Honda Civic 2022', color: 'Negro',
    services: [
      { name: 'Lavado Completo', price: 450 },
      { name: 'Encerado a Mano', price: 800 },
    ],
    lavador_id: 1, lavador: 'Juan Perez', status: 'en_proceso', minutes: 18, total: 1250, eta_min: 30,
  },
  {
    id: 'TX-1043', placa: 'B789012', client: 'Maria Sanchez', client_id: 2, vehicle: 'Toyota Corolla 2020', color: 'Blanco',
    services: [{ name: 'Lavado Express', price: 200 }],
    lavador_id: 2, lavador: 'Pedro Ramirez', status: 'en_proceso', minutes: 6, total: 200, eta_min: 9,
  },
  {
    id: 'TX-1044', placa: 'C345678', client: 'Cliente sin registrar', client_id: null, vehicle: 'Hyundai Tucson 2023', color: 'Gris',
    services: [
      { name: 'Lavado + Aspirado', price: 600 },
      { name: 'Aspirado Profundo', price: 350 },
    ],
    lavador_id: null, lavador: null, status: 'pendiente', minutes: 0, total: 950, eta_min: 60,
  },
  {
    id: 'TX-1045', placa: 'D901234', client: 'Empresa Logistics SRL', client_id: 3, vehicle: 'Ford F-150 2021', color: 'Roja',
    services: [
      { name: 'Lavado Motor',     price: 700 },
      { name: 'Lavado Chassis',   price: 500 },
      { name: 'Lavado Completo',  price: 450 },
    ],
    lavador_id: 3, lavador: 'Carlos Mejia', status: 'en_proceso', minutes: 32, total: 1650, eta_min: 50,
  },
  {
    id: 'TX-1046', placa: 'E567890', client: 'Ana Reyes', client_id: 4, vehicle: 'Mazda CX-5 2024', color: 'Azul',
    services: [{ name: 'Pulido + Encerado', price: 2500 }],
    lavador_id: 4, lavador: 'Luis Santana', status: 'en_proceso', minutes: 45, total: 2500, eta_min: 120,
  },
  {
    id: 'TX-1041', placa: 'F234567', client: 'Pedro Vasquez', client_id: 5, vehicle: 'Kia Sportage 2019', color: 'Plata',
    services: [{ name: 'Lavado Completo', price: 450 }],
    lavador_id: 1, lavador: 'Juan Perez', status: 'completado', minutes: 28, total: 450, eta_min: 0,
  },
]

export const VEHICLES = [
  { id: 1, plate: 'A123456', make: 'Honda',   model: 'Civic',    year: 2022, color: 'Negro',  client_id: 1, client_name: 'Roberto Castillo', visits: 24 },
  { id: 2, plate: 'B789012', make: 'Toyota',  model: 'Corolla',  year: 2020, color: 'Blanco', client_id: 2, client_name: 'Maria Sanchez',     visits: 12 },
  { id: 3, plate: 'D901234', make: 'Ford',    model: 'F-150',    year: 2021, color: 'Roja',   client_id: 3, client_name: 'Empresa Logistics SRL', visits: 56 },
  { id: 4, plate: 'E567890', make: 'Mazda',   model: 'CX-5',     year: 2024, color: 'Azul',   client_id: 4, client_name: 'Ana Reyes',         visits: 8 },
  { id: 5, plate: 'F234567', make: 'Kia',     model: 'Sportage', year: 2019, color: 'Plata',  client_id: 5, client_name: 'Pedro Vasquez',     visits: 18 },
  { id: 6, plate: 'G345678', make: 'Hyundai', model: 'Elantra',  year: 2023, color: 'Rojo',   client_id: 1, client_name: 'Roberto Castillo', visits: 5 },
]

export const CLIENTS = [
  { id: 1, name: 'Roberto Castillo',      rnc: '001-1234567-8', phone: '809-555-1010', visits: 24, last_visit: '2026-04-26', loyalty: 'Oro',    points: 480 },
  { id: 2, name: 'Maria Sanchez',         rnc: '002-2345678-9', phone: '829-555-2020', visits: 12, last_visit: '2026-04-25', loyalty: 'Plata',  points: 240 },
  { id: 3, name: 'Empresa Logistics SRL', rnc: '131-2345678-9', phone: '809-555-3030', visits: 56, last_visit: '2026-04-27', loyalty: 'Oro',    points: 1120 },
  { id: 4, name: 'Ana Reyes',             rnc: '003-3456789-0', phone: '849-555-4040', visits: 8,  last_visit: '2026-04-22', loyalty: 'Bronce', points: 160 },
  { id: 5, name: 'Pedro Vasquez',         rnc: '004-4567890-1', phone: '809-555-5050', visits: 18, last_visit: '2026-04-20', loyalty: 'Plata',  points: 360 },
  { id: 6, name: 'Lucia Almonte',         rnc: '005-5678901-2', phone: '829-555-6060', visits: 31, last_visit: '2026-04-24', loyalty: 'Oro',    points: 620 },
  { id: 7, name: 'Carlos Mendez',         rnc: '006-6789012-3', phone: '809-555-7070', visits: 4,  last_visit: '2026-04-15', loyalty: 'Bronce', points: 80 },
]

export const TODAY = {
  ventasTotal:    18450,
  ventasCash:      9200,
  ventasTarjeta:   6800,
  ventasTransfer:  2450,
  ticketsCount:      27,
  promedioTicket:   683,
  comisionesTotal: 3560,
  itbisTotal:      2814,
  ecf_emitidos:      19,
  ecf_pendientes:     0,
  vehiculos_atendidos: 27,
  membresias_renovadas: 3,
}

export const MEMBERSHIPS = [
  { tier: 'Basico',   price: 1500, active: 8,  perks: '4 lavados express/mes' },
  { tier: 'Premium',  price: 3500, active: 14, perks: '8 lavados completos + 1 encerado' },
  { tier: 'VIP',      price: 7500, active: 5,  perks: 'Ilimitado + 2 detallados/mes' },
]
