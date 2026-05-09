// Mecanica / taller demo. Work orders + service bays + cotizaciones.
import { ShoppingCart, Users, BarChart3, FileText, Settings, UserCheck, PiggyBank, Wrench, Car, Clock, AlertCircle } from 'lucide-react'
import { GenericPosView, SoonView, PageHeader, RD } from '../_shared'
import CashReconciliationDemo from '../screens/CashReconciliationDemo'
import EmpleadosDemo from '../screens/EmpleadosDemo'
import ConfigDemo    from '../screens/ConfigDemo'
import ReportesDemo   from '../screens/ReportesDemo'
import DGIIDemo       from '../screens/DGIIDemo'
import ClientsDemo    from '../screens/ClientsDemo'
import WorkOrdersDemo from '../screens/WorkOrdersDemo'
import { toClientsDemoShape, toReportesTxSeed } from '../screens/_adapters'

const BUSINESS = { name: 'Taller Mecanico Hermanos Lopez', rnc: '131-77889-0', user: { name: 'Pedro Lopez', role: 'manager' } }

const CATEGORIES = [
  { id: 'cambios',   label: 'Cambios' },
  { id: 'frenos',    label: 'Frenos' },
  { id: 'motor',     label: 'Motor' },
  { id: 'suspen',    label: 'Suspension' },
  { id: 'electrica', label: 'Electrica' },
]
const SERVICES = {
  cambios: [
    { id: 1, name: 'Cambio Aceite + Filtro',    price: 1800, sub: '30 min' },
    { id: 2, name: 'Cambio Filtro Aire',        price: 600,  sub: '15 min' },
    { id: 3, name: 'Cambio Bujias',             price: 1500, sub: '45 min' },
    { id: 4, name: 'Cambio Refrigerante',       price: 2200, sub: '40 min' },
  ],
  frenos: [
    { id: 10, name: 'Cambio Pastillas Delant',  price: 3500, sub: '60 min' },
    { id: 11, name: 'Cambio Pastillas Trasero', price: 3200, sub: '60 min' },
    { id: 12, name: 'Rectificar Discos',        price: 4500, sub: '90 min' },
    { id: 13, name: 'Cambio Liquido Frenos',    price: 1800, sub: '40 min' },
  ],
  motor: [
    { id: 20, name: 'Diagnostico Motor',        price: 2500, sub: '45 min' },
    { id: 21, name: 'Limpieza Inyectores',      price: 4800, sub: '2 horas' },
    { id: 22, name: 'Cambio Banda Distrib.',    price: 12500, sub: '4 horas' },
    { id: 23, name: 'Cambio Bomba Agua',        price: 6500, sub: '2 horas' },
  ],
  suspen: [
    { id: 30, name: 'Cambio Amortiguadores',    price: 8500, sub: '3 horas' },
    { id: 31, name: 'Alineacion + Balanceo',    price: 2800, sub: '90 min' },
    { id: 32, name: 'Cambio Rotulas',           price: 4500, sub: '2 horas' },
  ],
  electrica: [
    { id: 40, name: 'Diagnostico Electrico',    price: 1800, sub: '45 min' },
    { id: 41, name: 'Cambio Bateria',           price: 800,  sub: '20 min' },
    { id: 42, name: 'Reparacion Alternador',    price: 4500, sub: '3 horas' },
  ],
}

const WORK_ORDERS = [
  { id: 'WO-1042', placa: 'A123456', vehicle: 'Honda Civic 2022', client: 'Roberto Castillo', items: ['Cambio Aceite', 'Cambio Filtro Aire'], total: 2400, status: 'en_proceso',  bay: 'Bay 1', mecanico: 'Juan Reyes', minutes: 18 },
  { id: 'WO-1043', placa: 'B789012', vehicle: 'Toyota Corolla',   client: 'Maria Sanchez',    items: ['Diagnostico Motor', 'Cambio Bujias'],  total: 4000, status: 'en_proceso',  bay: 'Bay 2', mecanico: 'Carlos Diaz', minutes: 52 },
  { id: 'WO-1044', placa: 'C345678', vehicle: 'Hyundai Tucson',   client: 'Sin registrar',    items: ['Alineacion + Balanceo'],               total: 2800, status: 'cotizacion',   bay: '—',     mecanico: '—', minutes: 0 },
  { id: 'WO-1045', placa: 'D901234', vehicle: 'Ford F-150',       client: 'Empresa Logistics SRL', items: ['Cambio Pastillas', 'Rectificar Discos'], total: 8000, status: 'aprobado_cliente', bay: 'Bay 3', mecanico: 'Pedro Almonte', minutes: 0 },
  { id: 'WO-1046', placa: 'E567890', vehicle: 'Mazda CX-5',       client: 'Ana Reyes',        items: ['Cambio Banda Distrib.'], total: 12500, status: 'esperando_aprobacion', bay: '—', mecanico: '—', minutes: 0 },
]
const BAYS = [
  { id: 1, name: 'Bay 1', status: 'ocupado', wo: 'WO-1042', vehicle: 'Honda Civic',   minutes: 18 },
  { id: 2, name: 'Bay 2', status: 'ocupado', wo: 'WO-1043', vehicle: 'Toyota Corolla', minutes: 52 },
  { id: 3, name: 'Bay 3', status: 'ocupado', wo: 'WO-1045', vehicle: 'Ford F-150',     minutes: 0 },
  { id: 4, name: 'Bay 4', status: 'libre',   wo: null,      vehicle: null,             minutes: 0 },
]
const CLIENTS = [
  { id: 1, name: 'Roberto Castillo',      rnc: '001-1111111-1', phone: '809-555-1010', visits: 12, loyalty: 'Plata' },
  { id: 2, name: 'Empresa Logistics SRL', rnc: '131-2222222-2', phone: '809-555-2020', visits: 48, loyalty: 'Oro' },
  { id: 3, name: 'Maria Sanchez',         rnc: '002-3333333-3', phone: '829-555-3030', visits: 6,  loyalty: 'Bronce' },
]
const TODAY = { ventasTotal: 38450, ventasCash: 8200, ventasTarjeta: 18900, ventasTransfer: 11350, ticketsCount: 14, ecf_emitidos: 14, itbisTotal: 5862, ordenes_completadas: 8 }

const NAV = [
  { id: 'pos',     icon: ShoppingCart,  label: 'POS' },
  { id: 'wo',      icon: Wrench,        label: 'Ordenes',  badge: WORK_ORDERS.filter(w => w.status === 'esperando_aprobacion').length },
  { id: 'bays',    icon: Car,           label: 'Bays' },
  { id: 'clients', icon: Users,         label: 'Clientes' },
  { id: 'reports', icon: BarChart3,     label: 'Reportes' },
  { id: 'cuadre',  icon: PiggyBank,     label: 'Cuadre Caja' },
  { id: 'empl',    icon: UserCheck,     label: 'Mecanicos' },
  { id: 'dgii',    icon: FileText,      label: 'DGII / e-CF' },
  { id: 'config',  icon: Settings,      label: 'Configuracion' },
]

function WoView() {
  const styles = {
    en_proceso: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    cotizacion: 'bg-slate-50 border-slate-200 text-slate-700',
    esperando_aprobacion: 'bg-amber-50 border-amber-200 text-amber-800',
    aprobado_cliente: 'bg-sky-50 border-sky-200 text-sky-800',
  }
  const labels = {
    en_proceso: 'En proceso',
    cotizacion: 'Cotizacion',
    esperando_aprobacion: 'Esperando aprobacion cliente',
    aprobado_cliente: 'Aprobado por cliente',
  }
  return (
    <div className="p-4">
      <PageHeader title="Ordenes de Trabajo" sub={`${WORK_ORDERS.length} ordenes activas`}
        right={<button className="bg-[#b3001e] text-white text-[12px] font-bold px-4 py-2 rounded-lg">+ Nueva orden</button>}
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {WORK_ORDERS.map(w => (
          <div key={w.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className={`px-4 py-2 flex items-center justify-between border-b ${styles[w.status]}`}>
              <span className="text-[10px] font-bold uppercase tracking-[1.5px]">{labels[w.status]}</span>
              <span className="text-[10px] font-mono">{w.id}</span>
            </div>
            <div className="p-4">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center"><Car size={18} className="text-slate-500" /></div>
                <div>
                  <p className="text-[14px] font-bold text-slate-900">{w.placa} · {w.vehicle}</p>
                  <p className="text-[11px] text-slate-500">{w.client}</p>
                </div>
              </div>
              <ul className="text-[12px] text-slate-700 space-y-1 mb-3 pb-3 border-b border-dashed border-slate-200">
                {w.items.map((it, i) => <li key={i}>· {it}</li>)}
              </ul>
              <div className="flex items-center justify-between">
                <div className="text-[11px] text-slate-500">{w.bay !== '—' && <>Bay <strong className="text-slate-700">{w.bay}</strong> · {w.mecanico}{w.minutes > 0 && <> · <Clock size={10} className="inline" /> {w.minutes} min</>}</>}</div>
                <span className="text-[18px] font-black text-[#b3001e] tabular-nums">{RD(w.total)}</span>
              </div>
              {w.status === 'esperando_aprobacion' && (
                <button className="w-full mt-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[12px] font-bold">Enviar cotizacion por WhatsApp</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function BaysView() {
  return (
    <div className="p-4">
      <PageHeader title="Bays / Bahias de servicio" sub={`${BAYS.filter(b => b.status === 'ocupado').length} ocupadas · ${BAYS.filter(b => b.status === 'libre').length} libres`} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {BAYS.map(b => (
          <div key={b.id} className={`rounded-2xl border-2 p-5 ${b.status === 'ocupado' ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center border border-slate-200"><Car size={18} className="text-slate-500" /></div>
              <div>
                <p className="text-[16px] font-black text-slate-900">{b.name}</p>
                <p className={`text-[10px] uppercase tracking-wider font-bold ${b.status === 'ocupado' ? 'text-emerald-700' : 'text-slate-400'}`}>{b.status === 'ocupado' ? 'Ocupado' : 'Libre'}</p>
              </div>
            </div>
            {b.status === 'ocupado' && (
              <>
                <p className="text-[12px] font-bold text-slate-800">{b.vehicle}</p>
                <p className="text-[11px] text-slate-500 mt-0.5 font-mono">{b.wo}</p>
                <p className="text-[11px] text-slate-500 mt-1 inline-flex items-center gap-1"><Clock size={10} /> {b.minutes} min en proceso</p>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default {
  label: 'Mecanica',
  business: BUSINESS,
  navItems: NAV,
  defaultView: 'wo',
  render: (view, ctx) => {
    const tiles = [
      { label: 'Ventas hoy', value: RD(TODAY.ventasTotal), sub: `${TODAY.ticketsCount} tickets` },
      { label: 'Ordenes completadas', value: TODAY.ordenes_completadas },
      { label: 'Efectivo', value: RD(TODAY.ventasCash) },
      { label: 'Tarjeta', value: RD(TODAY.ventasTarjeta) },
      { label: 'Transferencia', value: RD(TODAY.ventasTransfer) },
      { label: 'Bays activas', value: `${BAYS.filter(b => b.status === 'ocupado').length}/${BAYS.length}` },
      { label: 'ITBIS', value: RD(TODAY.itbisTotal) },
      { label: 'e-CF emitidos', value: TODAY.ecf_emitidos },
    ]
    if (view === 'pos')     return <GenericPosView business={BUSINESS} categories={CATEGORIES} getItems={(c) => SERVICES[c]} clients={CLIENTS} itemNoun="servicio" />
    if (view === 'wo')      return <WorkOrdersDemo />
    if (view === 'bays')    return <BaysView />
    if (view === 'clients') return <ClientsDemo clients={toClientsDemoShape(CLIENTS)} />
    if (view === 'reports') return <ReportesDemo transactions={toReportesTxSeed({ today: TODAY, clients: CLIENTS, items: Object.values(SERVICES).flat() })} />
    if (view === 'cuadre')  return <CashReconciliationDemo ventasCash={TODAY.ventasCash} ticketsCount={TODAY.ticketsCount} />
    if (view === 'dgii')    return <DGIIDemo ecfTodayCount={TODAY.ecf_emitidos} />
    if (view === 'empl')   return <EmpleadosDemo vertical="mechanic" />
    if (view === 'config') return <ConfigDemo vertical="mechanic" business={BUSINESS} />
    return <SoonView title={NAV.find(n => n.id === view)?.label} desc="Disponible en el sistema completo." navigate={ctx.navigate} />
  },
}
