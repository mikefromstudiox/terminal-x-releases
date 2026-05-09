// Carwash demo. POS = GenericPosView. Other tabs = 1:1 demo copies of real screens.
import { ShoppingCart, ClipboardList, Users, BarChart3, Package, FileText, Settings, UserCheck, PiggyBank, Crown } from 'lucide-react'
import { GenericPosView, SoonView, PageHeader, RD } from '../_shared'
import QueueDemo                from '../screens/QueueDemo'
import ReportesDemo             from '../screens/ReportesDemo'
import DGIIDemo                 from '../screens/DGIIDemo'
import ClientsDemo              from '../screens/ClientsDemo'
import CashReconciliationDemo   from '../screens/CashReconciliationDemo'
import MembershipsDemo          from '../screens/MembershipsDemo'
import EmpleadosDemo            from '../screens/EmpleadosDemo'
import ConfigDemo               from '../screens/ConfigDemo'

const BUSINESS = {
  name: 'Studio X Car Wash', rnc: '133-41032-1',
  user: { name: 'Maria Rodriguez', role: 'cashier' },
}

const CATEGORIES = [
  { id: 'lavados',   label: 'Lavados' },
  { id: 'detallado', label: 'Detallado' },
  { id: 'interior',  label: 'Interior' },
  { id: 'especial',  label: 'Especial' },
]
const SERVICES = {
  lavados: [
    { id: 1, name: 'Lavado Express',     price: 200, sub: '15 min' },
    { id: 2, name: 'Lavado Completo',    price: 450, sub: '30 min' },
    { id: 3, name: 'Lavado + Aspirado',  price: 600, sub: '40 min' },
    { id: 4, name: 'Lavado SUV',         price: 550, sub: '35 min' },
    { id: 5, name: 'Lavado Camion',      price: 950, sub: '60 min' },
    { id: 6, name: 'Lavado Premium',     price: 850, sub: '50 min' },
  ],
  detallado: [
    { id: 10, name: 'Encerado a Mano',     price: 800,  sub: '45 min' },
    { id: 11, name: 'Pulido + Encerado',   price: 2500, sub: '2 horas' },
    { id: 12, name: 'Detallado Completo',  price: 4500, sub: '4 horas' },
    { id: 13, name: 'Sellador Ceramico',   price: 8500, sub: '6 horas' },
  ],
  interior: [
    { id: 20, name: 'Aspirado Profundo',  price: 350,  sub: '20 min' },
    { id: 21, name: 'Limpieza Tapiceria', price: 1800, sub: '90 min' },
    { id: 22, name: 'Tratamiento Cuero',  price: 2200, sub: '90 min' },
    { id: 23, name: 'Eliminacion Olores', price: 1500, sub: '60 min' },
  ],
  especial: [
    { id: 30, name: 'Lavado Motor',         price: 700, sub: '30 min' },
    { id: 31, name: 'Lavado Chassis',       price: 500, sub: '20 min' },
    { id: 32, name: 'Brillado de Llantas',  price: 250, sub: '15 min' },
  ],
}
const CLIENTS = [
  { id: 1, name: 'Roberto Castillo',      rnc: '001-1234567-8', phone: '809-555-1010', visits: 24, loyalty: 'Oro',    points: 480 },
  { id: 2, name: 'Maria Sanchez',         rnc: '002-2345678-9', phone: '829-555-2020', visits: 12, loyalty: 'Plata',  points: 240 },
  { id: 3, name: 'Empresa Logistics SRL', rnc: '131-2345678-9', phone: '809-555-3030', visits: 56, loyalty: 'Oro',    points: 1120 },
  { id: 4, name: 'Ana Reyes',             rnc: '003-3456789-0', phone: '849-555-4040', visits: 8,  loyalty: 'Bronce', points: 160 },
]

// Detailed clients shape ClientsDemo expects (with credit + history)
const CLIENTS_FOR_DEMO = [
  { id: 1, name: 'Roberto Castillo', rnc: '001-1234567-8', phone: '809-555-1010', email: 'rcastillo@email.com', address: 'Av. 27 de Febrero #245', tier: 'gold',
    totalVisits: 24, totalSpent: 32450, balance: 0,     creditLimit: 5000,  lastService: '2026-04-26',
    history: [
      { date: '2026-04-26', ticketNo: 'TX-1042', service: 'Lavado Completo + Encerado', amount: 1250, method: 'Efectivo' },
      { date: '2026-04-15', ticketNo: 'TX-0987', service: 'Pulido + Encerado',          amount: 2500, method: 'Tarjeta' },
      { date: '2026-04-02', ticketNo: 'TX-0912', service: 'Lavado Express',             amount:  200, method: 'Efectivo' },
      { date: '2026-03-22', ticketNo: 'TX-0865', service: 'Detallado Completo',         amount: 4500, method: 'Transferencia' },
    ] },
  { id: 2, name: 'Maria Sanchez', rnc: '002-2345678-9', phone: '829-555-2020', email: 'maria.s@email.com', address: 'C/ Duarte #112, Naco', tier: 'silver',
    totalVisits: 12, totalSpent: 8400, balance: 1500, creditLimit: 3000, lastService: '2026-04-25',
    history: [
      { date: '2026-04-25', ticketNo: 'TX-1043', service: 'Lavado Express',     amount: 200,  method: 'Credito' },
      { date: '2026-04-12', ticketNo: 'TX-0974', service: 'Lavado + Aspirado',  amount: 600,  method: 'Efectivo' },
    ] },
  { id: 3, name: 'Empresa Logistics SRL', rnc: '131-2345678-9', phone: '809-555-3030', email: 'flota@logistics.do', address: 'Zona Franca Las Americas', tier: 'platinum',
    totalVisits: 56, totalSpent: 184500, balance: 18500, creditLimit: 25000, lastService: '2026-04-27',
    history: [
      { date: '2026-04-27', ticketNo: 'TX-1045', service: 'Lavado Motor + Lavado Completo', amount: 1650, method: 'Credito' },
      { date: '2026-04-20', ticketNo: 'TX-1015', service: 'Detallado Completo (3 unidades)', amount: 13500, method: 'Transferencia' },
    ] },
  { id: 4, name: 'Ana Reyes', rnc: '003-3456789-0', phone: '849-555-4040', email: '', address: 'Bella Vista', tier: 'bronze',
    totalVisits: 8, totalSpent: 4200, balance: 0, creditLimit: 0, lastService: '2026-04-22',
    history: [
      { date: '2026-04-22', ticketNo: 'TX-1024', service: 'Pulido + Encerado', amount: 2500, method: 'Tarjeta' },
    ] },
  { id: 5, name: 'Pedro Vasquez', rnc: '004-4567890-1', phone: '809-555-5050', email: '', address: '', tier: 'silver',
    totalVisits: 18, totalSpent: 11700, balance: 0, creditLimit: 2000, lastService: '2026-04-20',
    history: [{ date: '2026-04-20', ticketNo: 'TX-0998', service: 'Lavado Completo', amount: 450, method: 'Efectivo' }] },
  { id: 6, name: 'Lucia Almonte', rnc: '005-5678901-2', phone: '829-555-6060', email: 'lucia@email.com', address: 'Piantini', tier: 'gold',
    totalVisits: 31, totalSpent: 28900, balance: 0, creditLimit: 5000, lastService: '2026-04-24',
    history: [{ date: '2026-04-24', ticketNo: 'TX-1031', service: 'Lavado + Aspirado', amount: 600, method: 'Tarjeta' }] },
]

// Transactions seed for ReportesDemo (DailyReport-style)
const TX_FOR_REPORTES = [
  { id: 1, ticketNo: 'TX-1048', client: 'Hotel Atlantico',      vehicle: 'Suburban G890123', services: [{ name: 'Lavado Premium' }], cashier: 'Maria',  date: new Date(Date.now() - 18 * 60_000), subtotal: 720,  itbis: 130, total: 850,  payMethod: 'card',     estado: 'normal' },
  { id: 2, ticketNo: 'TX-1047', client: 'Pedro Vasquez',        vehicle: 'F234567',          services: [{ name: 'Lavado Completo' }], cashier: 'Maria',  date: new Date(Date.now() - 35 * 60_000), subtotal: 381,  itbis: 69,  total: 450,  payMethod: 'cash',     estado: 'normal' },
  { id: 3, ticketNo: 'TX-1046', client: 'Ana Reyes',            vehicle: 'E567890',          services: [{ name: 'Pulido + Encerado' }, { name: 'Aspirado' }], cashier: 'Maria',  date: new Date(Date.now() - 75 * 60_000), subtotal: 2119, itbis: 381, total: 2500, payMethod: 'card',     estado: 'normal' },
  { id: 4, ticketNo: 'TX-1045', client: 'Empresa Logistics',    vehicle: 'D901234',          services: [{ name: 'Lavado Motor' }, { name: 'Lavado Completo' }, { name: 'Lavado Chassis' }], cashier: 'Maria',  date: new Date(Date.now() - 110 * 60_000), subtotal: 1399, itbis: 251, total: 1650, payMethod: 'credit',  estado: 'normal' },
  { id: 5, ticketNo: 'TX-1044', client: 'Walk-in',              vehicle: 'C345678',          services: [{ name: 'Lavado + Aspirado' }, { name: 'Aspirado Profundo' }], cashier: 'Maria',  date: new Date(Date.now() - 130 * 60_000), subtotal: 805,  itbis: 145, total: 950,  payMethod: 'cash',     estado: 'normal' },
  { id: 6, ticketNo: 'TX-1043', client: 'Maria Sanchez',        vehicle: 'B789012',          services: [{ name: 'Lavado Express' }], cashier: 'Maria',  date: new Date(Date.now() - 160 * 60_000), subtotal: 169,  itbis: 31,  total: 200,  payMethod: 'cash',     estado: 'normal' },
  { id: 7, ticketNo: 'TX-1042', client: 'Roberto Castillo',     vehicle: 'A123456',          services: [{ name: 'Lavado Completo' }, { name: 'Encerado' }], cashier: 'Maria',  date: new Date(Date.now() - 200 * 60_000), subtotal: 1059, itbis: 191, total: 1250, payMethod: 'transfer', estado: 'normal' },
  { id: 8, ticketNo: 'TX-1041', client: 'Cliente Anulado',      vehicle: '—',                services: [{ name: 'Lavado Express' }], cashier: 'Carlos', date: new Date(Date.now() - 240 * 60_000), subtotal: 169,  itbis: 31,  total: 200,  payMethod: 'cash',     estado: 'nula', voidReason: 'Doble cobro' },
  { id: 9, ticketNo: 'TX-1040', client: 'Lucia Almonte',        vehicle: 'H456789',          services: [{ name: 'Detallado Completo' }], cashier: 'Carlos', date: new Date(Date.now() - 290 * 60_000), subtotal: 3814, itbis: 686, total: 4500, payMethod: 'card',     estado: 'normal' },
  { id: 10, ticketNo: 'TX-1039', client: 'Sr. Mejia',           vehicle: 'I567890',          services: [{ name: 'Lavado SUV' }], cashier: 'Carlos', date: new Date(Date.now() - 320 * 60_000), subtotal: 466,  itbis: 84,  total: 550,  payMethod: 'cash',     estado: 'normal' },
]
const QUEUE_SEED = [
  { id: 'TX-1042', plate: 'A123456', client: 'Roberto Castillo',   services: [{ name: 'Lavado Completo' }, { name: 'Encerado' }], worker: { id: 1, name: 'Juan' }, status: 'proceso',   amount: 1250, time: '10:24' },
  { id: 'TX-1043', plate: 'B789012', client: 'Maria Sanchez',      services: [{ name: 'Lavado Express' }],                       worker: { id: 2, name: 'Pedro' }, status: 'proceso', amount:  200, time: '11:08' },
  { id: 'TX-1044', plate: 'C345678', client: 'Al Portador',        services: [{ name: 'Lavado + Aspirado' }, { name: 'Aspirado Profundo' }], worker: null, status: 'pendiente', amount: 950, time: '11:14' },
  { id: 'TX-1045', plate: 'D901234', client: 'Empresa Logistics',  services: [{ name: 'Lavado Motor' }, { name: 'Lavado Completo' }, { name: 'Lavado Chassis' }], worker: { id: 3, name: 'Carlos' }, status: 'proceso', amount: 1650, time: '10:42' },
  { id: 'TX-1046', plate: 'E567890', client: 'Ana Reyes',          services: [{ name: 'Pulido + Encerado' }], worker: { id: 4, name: 'Luis' }, status: 'proceso', amount: 2500, time: '09:48' },
  { id: 'TX-1047', plate: 'F234567', client: 'Pedro Vasquez',      services: [{ name: 'Lavado Completo' }],   worker: { id: 1, name: 'Juan' }, status: 'listo', amount: 450, time: '10:55' },
  { id: 'TX-1048', plate: 'G890123', client: 'Hotel Atlantico',    services: [{ name: 'Lavado Premium' }],    worker: { id: 5, name: 'Diego' }, status: 'listo', amount: 850, time: '11:02' },
]
const LAVADORES = [
  { id: 1, name: 'Juan Perez',    initials: 'JP', tickets: 8, comm: 1240, status: 'libre' },
  { id: 2, name: 'Pedro Ramirez', initials: 'PR', tickets: 6, comm:  980, status: 'ocupado' },
  { id: 3, name: 'Carlos Mejia',  initials: 'CM', tickets: 5, comm:  760, status: 'ocupado' },
  { id: 4, name: 'Luis Santana',  initials: 'LS', tickets: 4, comm:  580, status: 'ocupado' },
]
const TODAY = { ventasTotal: 18450, ventasCash: 9200, ventasTarjeta: 6800, ventasTransfer: 2450, ticketsCount: 27, promedioTicket: 683, comisionesTotal: 3560, itbisTotal: 2814, ecf_emitidos: 19 }

// Map QUEUE_SEED → shape QueueDemo expects (matches real Queue.jsx ticket shape).
const QUEUE_FOR_DEMO = QUEUE_SEED.map((q, idx) => ({
  id:           q.id,
  ticketNo:    q.id,
  plate:        q.plate,
  clientName:   q.client === 'Al Portador' ? '' : q.client,
  clientPhone:  '8095551234',
  vehicle:      `${q.plate} · ${q.client}`,
  services:     q.services.map(s => ({ name: s.name, price: 0 })),
  servicesStr:  q.services.map(s => s.name).join(' + '),
  worker:       q.worker ? { id: q.worker.id, name: q.worker.name, fullName: q.worker.name } : null,
  amount:       q.amount,
  createdAt:    new Date(Date.now() - (idx * 14 + 5) * 60_000),
  status:       q.status,
}))

const WASHERS_FOR_DEMO = LAVADORES.map(l => ({ id: l.id, name: l.name }))

function EmpleadosView() {
  return (
    <div className="p-4">
      <PageHeader title="Empleados / Lavadores" sub={`${LAVADORES.length} activos hoy`} right={<button className="bg-[#b3001e] text-white text-[12px] font-bold px-4 py-2 rounded-lg">+ Nuevo</button>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {LAVADORES.map(l => (
          <div key={l.id} className="bg-white rounded-2xl border border-slate-200 p-5 text-center">
            <div className={`w-14 h-14 mx-auto rounded-full text-white text-[18px] font-bold flex items-center justify-center ${l.status === 'libre' ? 'bg-emerald-500' : 'bg-[#b3001e]'}`}>{l.initials}</div>
            <p className="mt-3 font-bold text-slate-800">{l.name}</p>
            <p className={`text-[10px] uppercase tracking-wider inline-block px-2 py-0.5 rounded-full mt-1 ${l.status === 'libre' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{l.status === 'libre' ? 'Libre' : 'Ocupado'}</p>
            <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-slate-100">
              <div><p className="text-[9px] text-slate-400 uppercase">Tickets</p><p className="text-[18px] font-black text-slate-900 tabular-nums">{l.tickets}</p></div>
              <div><p className="text-[9px] text-slate-400 uppercase">Comision</p><p className="text-[18px] font-black text-[#b3001e] tabular-nums">{RD(l.comm)}</p></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const NAV = [
  { id: 'pos',      icon: ShoppingCart,  label: 'POS' },
  { id: 'cola',     icon: ClipboardList, label: 'Cola', badge: QUEUE_SEED.filter(q => q.status !== 'listo').length },
  { id: 'clients',  icon: Users,         label: 'Clientes' },
  { id: 'memb',     icon: Crown,         label: 'Membresias' },
  { id: 'reports',  icon: BarChart3,     label: 'Reportes' },
  { id: 'cuadre',   icon: PiggyBank,     label: 'Cuadre Caja' },
  { id: 'empl',     icon: UserCheck,     label: 'Empleados' },
  { id: 'inv',      icon: Package,       label: 'Inventario' },
  { id: 'dgii',     icon: FileText,      label: 'DGII / e-CF' },
  { id: 'config',   icon: Settings,      label: 'Configuracion' },
]

export default {
  label: 'Car Wash',
  business: BUSINESS,
  navItems: NAV,
  defaultView: 'pos',
  render: (view, ctx) => {
    const tiles = [
      { label: 'Ventas hoy',     value: RD(TODAY.ventasTotal),    sub: `${TODAY.ticketsCount} tickets · ${RD(TODAY.promedioTicket)} prom` },
      { label: 'Vehiculos',      value: TODAY.ticketsCount,        sub: 'atendidos hoy' },
      { label: 'Efectivo',       value: RD(TODAY.ventasCash),     sub: '50% del total' },
      { label: 'Tarjeta',        value: RD(TODAY.ventasTarjeta),  sub: 'Visa, Mastercard' },
      { label: 'Transferencia',  value: RD(TODAY.ventasTransfer), sub: 'Banreservas' },
      { label: 'Comisiones',     value: RD(TODAY.comisionesTotal), sub: `${LAVADORES.length} lavadores` },
      { label: 'ITBIS',          value: RD(TODAY.itbisTotal),     sub: '18%' },
      { label: 'e-CF emitidos',  value: TODAY.ecf_emitidos,        sub: '0 en cola' },
    ]
    if (view === 'pos')     return <GenericPosView business={BUSINESS} categories={CATEGORIES} getItems={(c) => SERVICES[c]} clients={CLIENTS} itemNoun="servicio" />
    if (view === 'cola')    return <QueueDemo initialQueue={QUEUE_FOR_DEMO} washers={WASHERS_FOR_DEMO} />
    if (view === 'clients') return <ClientsDemo clients={CLIENTS_FOR_DEMO} />
    if (view === 'reports') return <ReportesDemo transactions={TX_FOR_REPORTES} />
    if (view === 'cuadre')  return <CashReconciliationDemo ventasCash={TODAY.ventasCash} ticketsCount={TODAY.ticketsCount} />
    if (view === 'memb')    return <MembershipsDemo />
    if (view === 'empl')    return <EmpleadosView />
    if (view === 'dgii')    return <DGIIDemo ecfTodayCount={TODAY.ecf_emitidos} />
    if (view === 'config') return <ConfigDemo vertical="carwash" business={BUSINESS} />
    return <SoonView title={NAV.find(n => n.id === view)?.label || 'Proximamente'} desc="Esta seccion esta disponible en el sistema completo." navigate={ctx.navigate} />
  },
}
