// Salon / Barberia demo. Appointments + stylists + services.
import { ShoppingCart, Users, BarChart3, FileText, Settings, UserCheck, PiggyBank, Calendar, Scissors, Crown, Clock, Plus } from 'lucide-react'
import { GenericPosView, SoonView, PageHeader, RD } from '../_shared'
import CashReconciliationDemo from '../screens/CashReconciliationDemo'
import EmpleadosDemo from '../screens/EmpleadosDemo'
import ConfigDemo    from '../screens/ConfigDemo'
import ReportesDemo     from '../screens/ReportesDemo'
import DGIIDemo         from '../screens/DGIIDemo'
import ClientsDemo      from '../screens/ClientsDemo'
import AppointmentsDemo     from '../screens/AppointmentsDemo'
import StylistSchedulesDemo from '../screens/StylistSchedulesDemo'
import MembershipsDemo      from '../screens/MembershipsDemo'
import { toClientsDemoShape, toReportesTxSeed } from '../screens/_adapters'

const BUSINESS = { name: 'Salon Estilo Caribe', rnc: '131-88990-1', user: { name: 'Yolanda Pena', role: 'manager' } }

const CATEGORIES = [
  { id: 'corte',    label: 'Cortes' },
  { id: 'color',    label: 'Color' },
  { id: 'tratam',   label: 'Tratamientos' },
  { id: 'unas',     label: 'Unas' },
  { id: 'depilac',  label: 'Depilacion' },
]
const SERVICES = {
  corte: [
    { id: 1, name: 'Corte Cabello Mujer',   price: 800, sub: '45 min' },
    { id: 2, name: 'Corte Cabello Hombre',  price: 450, sub: '30 min' },
    { id: 3, name: 'Corte Nino',            price: 350, sub: '20 min' },
    { id: 4, name: 'Lavado + Cepillado',    price: 600, sub: '40 min' },
  ],
  color: [
    { id: 10, name: 'Tinte Completo',       price: 2500, sub: '2 horas' },
    { id: 11, name: 'Mechas / Highlights',  price: 3200, sub: '3 horas' },
    { id: 12, name: 'Balayage',             price: 4500, sub: '4 horas' },
    { id: 13, name: 'Retoque Raiz',         price: 1500, sub: '90 min' },
  ],
  tratam: [
    { id: 20, name: 'Keratina',             price: 4500, sub: '3 horas' },
    { id: 21, name: 'Hidratacion Profunda', price: 1800, sub: '60 min' },
    { id: 22, name: 'Botox Capilar',        price: 3500, sub: '2 horas' },
  ],
  unas: [
    { id: 30, name: 'Manicure Clasico',     price: 450,  sub: '40 min' },
    { id: 31, name: 'Pedicure',             price: 650,  sub: '60 min' },
    { id: 32, name: 'Unas Acrilicas',       price: 1800, sub: '2 horas' },
    { id: 33, name: 'Unas Gel',             price: 1200, sub: '90 min' },
  ],
  depilac: [
    { id: 40, name: 'Cejas + Bigote',       price: 350, sub: '20 min' },
    { id: 41, name: 'Piernas Completas',    price: 1200, sub: '60 min' },
    { id: 42, name: 'Bikini',               price: 800,  sub: '30 min' },
  ],
}
const STYLISTS = [
  { id: 1, name: 'Yolanda Pena',  initials: 'YP', specialty: 'Color',         appts_today: 6, comm_today: 3850, status: 'ocupada' },
  { id: 2, name: 'Esperanza Diaz', initials: 'ED', specialty: 'Corte',        appts_today: 8, comm_today: 2400, status: 'libre' },
  { id: 3, name: 'Karina Reyes',   initials: 'KR', specialty: 'Unas',         appts_today: 5, comm_today: 1850, status: 'ocupada' },
  { id: 4, name: 'Andres Soto',    initials: 'AS', specialty: 'Barberia',     appts_today: 9, comm_today: 2750, status: 'libre' },
]
const APPOINTMENTS = [
  { time: '09:00 AM', client: 'Maria Sanchez',   service: 'Corte + Tinte',    stylist: 'Yolanda',   status: 'confirmada', total: 3300 },
  { time: '10:00 AM', client: 'Ana Reyes',       service: 'Mechas',           stylist: 'Yolanda',   status: 'check-in',   total: 3200 },
  { time: '10:30 AM', client: 'Roberto Castillo', service: 'Corte Hombre',    stylist: 'Andres',    status: 'completada', total:  450 },
  { time: '11:00 AM', client: 'Lucia Almonte',   service: 'Manicure + Pedicure', stylist: 'Karina', status: 'en_servicio', total: 1100 },
  { time: '12:00 PM', client: 'Familia Castillo', service: '2x Corte Nino',   stylist: 'Esperanza', status: 'confirmada', total:  700 },
  { time: '02:00 PM', client: 'Sra. Mendez',     service: 'Keratina',         stylist: 'Yolanda',   status: 'confirmada', total: 4500 },
  { time: '03:30 PM', client: 'Carmen Diaz',     service: 'Hidratacion',      stylist: 'Esperanza', status: 'confirmada', total: 1800 },
  { time: '05:00 PM', client: 'Ana Garcia',      service: 'Unas Acrilicas',   stylist: 'Karina',    status: 'confirmada', total: 1800 },
]
const CLIENTS = [
  { id: 1, name: 'Maria Sanchez',     rnc: '002-1111111-1', phone: '829-555-1010', visits: 24, loyalty: 'Oro', points: 480 },
  { id: 2, name: 'Ana Reyes',         rnc: '003-2222222-2', phone: '849-555-2020', visits: 12, loyalty: 'Plata', points: 240 },
  { id: 3, name: 'Familia Castillo',  rnc: '004-3333333-3', phone: '809-555-3030', visits: 36, loyalty: 'Oro', points: 720 },
]
const TODAY = { ventasTotal: 22580, ventasCash: 4200, ventasTarjeta: 12200, ventasTransfer: 6180, ticketsCount: 28, propinas: 2258, ecf_emitidos: 18, citas: 28, citas_completadas: 14 }

const NAV = [
  { id: 'agenda',  icon: Calendar,      label: 'Agenda' },
  { id: 'pos',     icon: ShoppingCart,  label: 'POS' },
  { id: 'stylists', icon: Scissors,     label: 'Estilistas' },
  { id: 'memb',    icon: Crown,         label: 'Membresias' },
  { id: 'clients', icon: Users,         label: 'Clientes' },
  { id: 'reports', icon: BarChart3,     label: 'Reportes' },
  { id: 'cuadre',  icon: PiggyBank,     label: 'Cuadre Caja' },
  { id: 'empl',    icon: UserCheck,     label: 'Empleados' },
  { id: 'dgii',    icon: FileText,      label: 'DGII / e-CF' },
  { id: 'config',  icon: Settings,      label: 'Configuracion' },
]

function AgendaView() {
  const styles = {
    confirmada:    'bg-sky-50 border-sky-200 text-sky-800',
    'check-in':    'bg-amber-50 border-amber-200 text-amber-800',
    en_servicio:   'bg-emerald-50 border-emerald-200 text-emerald-800',
    completada:    'bg-slate-50 border-slate-200 text-slate-600',
  }
  return (
    <div className="p-4">
      <PageHeader title="Agenda · Hoy" sub={`${APPOINTMENTS.length} citas · ${APPOINTMENTS.filter(a => a.status === 'completada').length} completadas`}
        right={<button className="bg-[#b3001e] text-white text-[12px] font-bold px-4 py-2 rounded-lg inline-flex items-center gap-1.5"><Plus size={13} /> Nueva cita</button>}
      />
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="text-left px-4 py-2.5 font-bold">Hora</th>
              <th className="text-left px-4 py-2.5 font-bold">Cliente</th>
              <th className="text-left px-4 py-2.5 font-bold">Servicio</th>
              <th className="text-left px-4 py-2.5 font-bold">Estilista</th>
              <th className="text-right px-4 py-2.5 font-bold">Total</th>
              <th className="text-right px-4 py-2.5 font-bold">Estado</th>
            </tr>
          </thead>
          <tbody>
            {APPOINTMENTS.map((a, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-4 py-3 font-mono text-[11px] font-bold text-slate-800">{a.time}</td>
                <td className="px-4 py-3 font-semibold text-slate-800">{a.client}</td>
                <td className="px-4 py-3 text-slate-600">{a.service}</td>
                <td className="px-4 py-3 text-slate-600">{a.stylist}</td>
                <td className="px-4 py-3 text-right font-bold text-[#b3001e] tabular-nums">{RD(a.total)}</td>
                <td className="px-4 py-3 text-right"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${styles[a.status]}`}>{a.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StylistsView() {
  return (
    <div className="p-4">
      <PageHeader title="Estilistas" sub={`${STYLISTS.length} en turno`} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {STYLISTS.map(s => (
          <div key={s.id} className="bg-white rounded-2xl border border-slate-200 p-5 text-center">
            <div className={`w-14 h-14 mx-auto rounded-full text-white text-[18px] font-bold flex items-center justify-center ${s.status === 'libre' ? 'bg-emerald-500' : 'bg-[#b3001e]'}`}>{s.initials}</div>
            <p className="mt-3 font-bold text-slate-800">{s.name}</p>
            <p className="text-[10px] uppercase tracking-wider text-slate-400 mt-0.5">{s.specialty}</p>
            <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-slate-100">
              <div><p className="text-[9px] text-slate-400 uppercase">Citas</p><p className="text-[18px] font-black text-slate-900 tabular-nums">{s.appts_today}</p></div>
              <div><p className="text-[9px] text-slate-400 uppercase">Comision</p><p className="text-[18px] font-black text-[#b3001e] tabular-nums">{RD(s.comm_today)}</p></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default {
  label: 'Salon / Barberia',
  business: BUSINESS,
  navItems: NAV,
  defaultView: 'agenda',
  render: (view, ctx) => {
    const tiles = [
      { label: 'Ventas hoy', value: RD(TODAY.ventasTotal), sub: `${TODAY.ticketsCount} tickets` },
      { label: 'Citas hoy', value: TODAY.citas, sub: `${TODAY.citas_completadas} completadas` },
      { label: 'Propinas', value: RD(TODAY.propinas) },
      { label: 'Efectivo', value: RD(TODAY.ventasCash) },
      { label: 'Tarjeta', value: RD(TODAY.ventasTarjeta) },
      { label: 'Transferencia', value: RD(TODAY.ventasTransfer) },
      { label: 'Estilistas activas', value: STYLISTS.length },
      { label: 'e-CF emitidos', value: TODAY.ecf_emitidos },
    ]
    if (view === 'pos')     return <GenericPosView business={BUSINESS} categories={CATEGORIES} getItems={(c) => SERVICES[c]} clients={CLIENTS} itemNoun="servicio" />
    if (view === 'agenda')  return <AppointmentsDemo />
    if (view === 'stylists') return <StylistSchedulesDemo />
    if (view === 'memb')    return <MembershipsDemo />
    if (view === 'clients') return <ClientsDemo clients={toClientsDemoShape(CLIENTS)} />
    if (view === 'reports') return <ReportesDemo transactions={toReportesTxSeed({ today: TODAY, clients: CLIENTS, items: Object.values(SERVICES).flat() })} />
    if (view === 'cuadre')  return <CashReconciliationDemo ventasCash={TODAY.ventasCash} ticketsCount={TODAY.ticketsCount} />
    if (view === 'dgii')    return <DGIIDemo ecfTodayCount={TODAY.ecf_emitidos} />
    if (view === 'empl')   return <EmpleadosDemo />
    if (view === 'config') return <ConfigDemo />
    return <SoonView title={NAV.find(n => n.id === view)?.label} desc="Disponible en el sistema completo." navigate={ctx.navigate} />
  },
}
