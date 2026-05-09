// Concesionario / dealership demo. Vehicle inventory + sales pipeline + test drives.
import { Users, BarChart3, FileText, Settings, UserCheck, PiggyBank, Car, CarFront, Trophy, FileSignature, Calendar, Shield } from 'lucide-react'
import { SoonView, PageHeader, RD, RDc } from '../_shared'
import EmpleadosDemo from '../screens/EmpleadosDemo'
import ConfigDemo    from '../screens/ConfigDemo'
import ReportesDemo         from '../screens/ReportesDemo'
import DGIIDemo             from '../screens/DGIIDemo'
import ClientsDemo          from '../screens/ClientsDemo'
import VehicleInventoryDemo from '../screens/VehicleInventoryDemo'
import SalesPipelineDemo    from '../screens/SalesPipelineDemo'
import DealBuilderDemo      from '../screens/DealBuilderDemo'
import TestDrivesDemo       from '../screens/TestDrivesDemo'
import { toClientsDemoShape, toReportesTxSeed } from '../screens/_adapters'

const BUSINESS = { name: 'Studio X Auto Dealer', rnc: '131-10112-3', user: { name: 'Carlos Reyes', role: 'manager' } }

const VEHICLES = [
  { id: 1, plate: 'STK-001', make: 'Toyota',  model: 'Corolla XLE',  year: 2024, color: 'Blanco',  km: 12500, price: 1450000, days: 12, status: 'disponible' },
  { id: 2, plate: 'STK-002', make: 'Honda',   model: 'Civic Sport',  year: 2023, color: 'Negro',   km: 18200, price: 1380000, days: 28, status: 'disponible' },
  { id: 3, plate: 'STK-003', make: 'Hyundai', model: 'Tucson Limited', year: 2024, color: 'Gris',  km: 8500, price: 2150000, days: 5,  status: 'reservado' },
  { id: 4, plate: 'STK-004', make: 'Ford',    model: 'F-150 XLT',    year: 2022, color: 'Rojo',    km: 45200, price: 2850000, days: 64, status: 'disponible' },
  { id: 5, plate: 'STK-005', make: 'Mazda',   model: 'CX-5 Touring', year: 2024, color: 'Azul',    km: 6200, price: 1890000, days: 3,  status: 'test_drive' },
  { id: 6, plate: 'STK-006', make: 'Kia',     model: 'Sportage EX',  year: 2023, color: 'Plata',   km: 22100, price: 1620000, days: 41, status: 'disponible' },
  { id: 7, plate: 'STK-007', make: 'Nissan',  model: 'Sentra SR',    year: 2024, color: 'Blanco',  km: 4800, price: 1280000, days: 8,  status: 'vendido' },
  { id: 8, plate: 'STK-008', make: 'Chevrolet', model: 'Tahoe LT',   year: 2023, color: 'Negro',   km: 32100, price: 3450000, days: 89, status: 'disponible' },
]
const PIPELINE = [
  { stage: 'Lead nuevo',         count: 18, total: 0 },
  { stage: 'Contacto inicial',   count: 12, total: 0 },
  { stage: 'Test drive agendado', count: 7, total: 9450000 },
  { stage: 'Cotizacion enviada', count: 5, total: 8200000 },
  { stage: 'Pre-aprobacion bancaria', count: 3, total: 4920000 },
  { stage: 'Cerrado / vendido',  count: 4, total: 6580000 },
]
const DEALS = [
  { id: 'D-1042', client: 'Roberto Castillo',   vehicle: 'Toyota Corolla XLE 2024', stage: 'Pre-aprobacion bancaria', vendedor: 'Pedro Mendez',   value: 1450000, prob: 75 },
  { id: 'D-1043', client: 'Empresa Logistics',  vehicle: 'Ford F-150 XLT 2022',     stage: 'Cotizacion enviada',     vendedor: 'Carlos Reyes',    value: 2850000, prob: 60 },
  { id: 'D-1044', client: 'Maria Sanchez',      vehicle: 'Hyundai Tucson Limited 2024', stage: 'Test drive agendado', vendedor: 'Pedro Mendez',   value: 2150000, prob: 50 },
  { id: 'D-1045', client: 'Ana Reyes',          vehicle: 'Mazda CX-5 Touring 2024', stage: 'Test drive agendado',    vendedor: 'Carlos Reyes',    value: 1890000, prob: 45 },
]
const TEST_DRIVES = [
  { time: '10:00 AM', client: 'Maria Sanchez',  vehicle: 'Hyundai Tucson Limited 2024', vendedor: 'Pedro Mendez',  status: 'agendado' },
  { time: '11:30 AM', client: 'Pedro Vasquez',  vehicle: 'Mazda CX-5 Touring 2024',    vendedor: 'Carlos Reyes',  status: 'completado' },
  { time: '02:00 PM', client: 'Ana Reyes',      vehicle: 'Mazda CX-5 Touring 2024',    vendedor: 'Carlos Reyes',  status: 'agendado' },
  { time: '03:30 PM', client: 'Empresa Trans',  vehicle: 'Ford F-150 XLT 2022',        vendedor: 'Carlos Reyes',  status: 'agendado' },
]
const CLIENTS = [
  { id: 1, name: 'Roberto Castillo',     rnc: '001-1111111-1', phone: '809-555-1010' },
  { id: 2, name: 'Empresa Logistics SRL', rnc: '131-2222222-2', phone: '809-555-2020' },
  { id: 3, name: 'Maria Sanchez',        rnc: '002-3333333-3', phone: '829-555-3030' },
]

const NAV = [
  { id: 'pipeline', icon: Trophy,        label: 'Pipeline' },
  { id: 'inv',      icon: Car,           label: 'Inventario' },
  { id: 'test',     icon: CarFront,      label: 'Test Drives' },
  { id: 'deals',    icon: FileSignature, label: 'Deals abiertos' },
  { id: 'preap',    icon: Shield,        label: 'Pre-aprobaciones' },
  { id: 'clients',  icon: Users,         label: 'Clientes' },
  { id: 'reports',  icon: BarChart3,     label: 'Reportes' },
  { id: 'cuadre',   icon: PiggyBank,     label: 'Cuadre' },
  { id: 'empl',     icon: UserCheck,     label: 'Vendedores' },
  { id: 'dgii',     icon: FileText,      label: 'DGII / e-CF' },
  { id: 'config',   icon: Settings,      label: 'Configuracion' },
]

function InventoryView() {
  const styles = { disponible: 'bg-emerald-100 text-emerald-700', reservado: 'bg-amber-100 text-amber-700', test_drive: 'bg-sky-100 text-sky-700', vendido: 'bg-slate-200 text-slate-600' }
  const labels = { disponible: 'Disponible', reservado: 'Reservado', test_drive: 'En test drive', vendido: 'Vendido' }
  return (
    <div className="p-4">
      <PageHeader title="Inventario de vehiculos" sub={`${VEHICLES.length} unidades · ${VEHICLES.filter(v => v.status === 'disponible').length} disponibles · valor RD$${(VEHICLES.reduce((s, v) => s + v.price, 0) / 1000000).toFixed(1)}M`}
        right={<button className="bg-[#b3001e] text-white text-[12px] font-bold px-4 py-2 rounded-lg">+ Nuevo vehiculo</button>}
      />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {VEHICLES.map(v => (
          <div key={v.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden hover:border-[#b3001e]/30 hover:shadow-md transition-all">
            <div className="aspect-video bg-slate-100 flex items-center justify-center"><Car size={48} className="text-slate-300" /></div>
            <div className="p-4">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[14px] font-bold text-slate-900">{v.make} {v.model}</p>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${styles[v.status]}`}>{labels[v.status]}</span>
              </div>
              <p className="text-[11px] text-slate-500">{v.year} · {v.color} · {RDc(v.km)} km · {v.days} dias en lote</p>
              <p className="text-[11px] font-mono text-slate-400 mt-1">{v.plate}</p>
              <p className="text-[20px] font-black text-[#b3001e] mt-3 tabular-nums">{RD(v.price)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PipelineView() {
  return (
    <div className="p-4">
      <PageHeader title="Pipeline de Ventas" sub={`${PIPELINE.reduce((s, p) => s + p.count, 0)} oportunidades · RD$${(PIPELINE.reduce((s, p) => s + p.total, 0) / 1000000).toFixed(1)}M en pipeline`} />
      <div className="grid grid-cols-1 lg:grid-cols-6 gap-3 mb-5">
        {PIPELINE.map((p, i) => (
          <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[2px] text-slate-400">{p.stage}</p>
            <p className="text-[24px] font-black text-slate-900 mt-1 tabular-nums">{p.count}</p>
            {p.total > 0 && <p className="text-[10px] text-[#b3001e] font-bold mt-0.5">RD${(p.total / 1000000).toFixed(1)}M</p>}
          </div>
        ))}
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100"><h3 className="text-[14px] font-bold text-slate-800">Deals activos</h3></div>
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="text-left px-4 py-2.5 font-bold">Deal</th>
              <th className="text-left px-4 py-2.5 font-bold">Cliente</th>
              <th className="text-left px-4 py-2.5 font-bold">Vehiculo</th>
              <th className="text-left px-4 py-2.5 font-bold">Etapa</th>
              <th className="text-left px-4 py-2.5 font-bold">Vendedor</th>
              <th className="text-right px-4 py-2.5 font-bold">Valor</th>
              <th className="text-right px-4 py-2.5 font-bold">Prob</th>
            </tr>
          </thead>
          <tbody>
            {DEALS.map(d => (
              <tr key={d.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-mono text-[11px] font-bold text-slate-800">{d.id}</td>
                <td className="px-4 py-3 font-semibold text-slate-800">{d.client}</td>
                <td className="px-4 py-3 text-slate-600 text-[12px]">{d.vehicle}</td>
                <td className="px-4 py-3 text-slate-600 text-[12px]">{d.stage}</td>
                <td className="px-4 py-3 text-slate-600 text-[12px]">{d.vendedor}</td>
                <td className="px-4 py-3 text-right font-bold text-[#b3001e] tabular-nums">{RD(d.value)}</td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex items-center gap-1.5">
                    <div className="w-12 h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-[#b3001e]" style={{ width: `${d.prob}%` }} /></div>
                    <span className="text-[11px] font-bold tabular-nums">{d.prob}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TestDrivesView() {
  return (
    <div className="p-4">
      <PageHeader title="Test Drives · Hoy" sub={`${TEST_DRIVES.length} agendados`} />
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="text-left px-4 py-2.5 font-bold">Hora</th>
              <th className="text-left px-4 py-2.5 font-bold">Cliente</th>
              <th className="text-left px-4 py-2.5 font-bold">Vehiculo</th>
              <th className="text-left px-4 py-2.5 font-bold">Vendedor</th>
              <th className="text-right px-4 py-2.5 font-bold">Estado</th>
            </tr>
          </thead>
          <tbody>
            {TEST_DRIVES.map((t, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-4 py-3 font-mono text-[11px] font-bold text-slate-800">{t.time}</td>
                <td className="px-4 py-3 font-semibold text-slate-800">{t.client}</td>
                <td className="px-4 py-3 text-slate-600 text-[12px]">{t.vehicle}</td>
                <td className="px-4 py-3 text-slate-600">{t.vendedor}</td>
                <td className="px-4 py-3 text-right">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${t.status === 'completado' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'}`}>{t.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default {
  label: 'Concesionario',
  business: BUSINESS,
  navItems: NAV,
  defaultView: 'pipeline',
  render: (view, ctx) => {
    const tiles = [
      { label: 'Vehiculos en lote', value: VEHICLES.length },
      { label: 'Disponibles', value: VEHICLES.filter(v => v.status === 'disponible').length },
      { label: 'Vendidos mes', value: 6, sub: 'meta: 8' },
      { label: 'Pipeline total', value: 'RD$28M', accent: true },
      { label: 'Deals cerrados', value: '4', sub: 'esta semana' },
      { label: 'Test drives hoy', value: TEST_DRIVES.length },
      { label: 'Aging > 60 dias', value: 2, sub: 'alertas' },
      { label: 'Comision pendiente', value: 'RD$185K' },
    ]
    if (view === 'pipeline') return <SalesPipelineDemo />
    if (view === 'inv')      return <VehicleInventoryDemo />
    if (view === 'test')     return <TestDrivesDemo />
    if (view === 'deals')    return <DealBuilderDemo />
    if (view === 'clients')  return <ClientsDemo clients={toClientsDemoShape(CLIENTS)} />
    if (view === 'reports')  return <ReportesDemo transactions={toReportesTxSeed({ today: { ventasTotal: 6580000, ventasCash: 0, ventasTarjeta: 1580000, ventasTransfer: 5000000, ticketsCount: 4 }, clients: CLIENTS, items: VEHICLES.map(v => ({ name: `${v.make} ${v.model}` })) })} reportTitle="Ventas de vehiculos" />
    if (view === 'dgii')     return <DGIIDemo ecfTodayCount={4} />
    if (view === 'empl')   return <EmpleadosDemo vertical="dealership" />
    if (view === 'config') return <ConfigDemo vertical="dealership" business={BUSINESS} />
    return <SoonView title={NAV.find(n => n.id === view)?.label} desc="Disponible en el sistema completo." navigate={ctx.navigate} />
  },
}
