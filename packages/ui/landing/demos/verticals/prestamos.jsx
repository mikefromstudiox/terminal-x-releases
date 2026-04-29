// Prestamos / empenos demo. Loans + pawn items + collections.
import { Users, BarChart3, FileText, Settings, UserCheck, PiggyBank, Banknote, Package, Calendar, Clock } from 'lucide-react'
import { SoonView, PageHeader, RD } from '../_shared'
import EmpleadosDemo from '../screens/EmpleadosDemo'
import ConfigDemo    from '../screens/ConfigDemo'
import ReportesDemo  from '../screens/ReportesDemo'
import DGIIDemo      from '../screens/DGIIDemo'
import ClientsDemo   from '../screens/ClientsDemo'
import LoansDemo     from '../screens/LoansDemo'
import PawnItemsDemo from '../screens/PawnItemsDemo'
import { toClientsDemoShape, toReportesTxSeed } from '../screens/_adapters'

const BUSINESS = { name: 'Prestamos & Empenos La Garantia', rnc: '131-99001-2', user: { name: 'Roberto Almonte', role: 'manager' } }

const LOANS = [
  { id: 'P-1042', client: 'Maria Sanchez',   item: 'Cadena oro 18k 12g', principal: 12000, balance: 9500,  rate: 12, due: '2026-05-15', status: 'al_dia' },
  { id: 'P-1043', client: 'Roberto Castillo', item: 'Anillo brillantes 1.2ct', principal: 45000, balance: 28000, rate: 10, due: '2026-05-08', status: 'al_dia' },
  { id: 'P-1044', client: 'Pedro Vasquez',   item: 'Reloj Rolex Submariner', principal: 85000, balance: 85000, rate: 8,  due: '2026-04-20', status: 'vencido' },
  { id: 'P-1045', client: 'Ana Reyes',       item: 'Pulsera oro 10g', principal: 8500, balance: 4500, rate: 12, due: '2026-05-22', status: 'al_dia' },
  { id: 'P-1046', client: 'Empresa Logistics', item: 'Equipo herramientas industriales', principal: 125000, balance: 95000, rate: 9, due: '2026-05-12', status: 'proximo_vencer' },
]
const PAWN_ITEMS = [
  { id: 1, item: 'Cadena oro 18k 12g',           appraisal: 18000, loan: 12000, status: 'activo' },
  { id: 2, item: 'Anillo brillantes 1.2ct',      appraisal: 65000, loan: 45000, status: 'activo' },
  { id: 3, item: 'Reloj Rolex Submariner',       appraisal: 120000, loan: 85000, status: 'vencido' },
  { id: 4, item: 'iPhone 14 Pro',                appraisal: 25000, loan: 0, status: 'recuperado' },
  { id: 5, item: 'Laptop MacBook Pro M3',        appraisal: 45000, loan: 32000, status: 'activo' },
]
const PAYMENTS = [
  { date: '2026-04-27', loan: 'P-1042', client: 'Maria Sanchez',  amount: 1500, method: 'Efectivo' },
  { date: '2026-04-27', loan: 'P-1043', client: 'Roberto Castillo', amount: 5000, method: 'Transferencia' },
  { date: '2026-04-26', loan: 'P-1045', client: 'Ana Reyes',      amount: 1200, method: 'Efectivo' },
  { date: '2026-04-26', loan: 'P-1046', client: 'Empresa Logistics', amount: 8500, method: 'Transferencia' },
]
const CLIENTS = [
  { id: 1, name: 'Maria Sanchez',          rnc: '002-1111111-1', phone: '829-555-1010', visits: 6, loyalty: 'Plata' },
  { id: 2, name: 'Roberto Castillo',       rnc: '001-2222222-2', phone: '809-555-2020', visits: 12, loyalty: 'Oro' },
  { id: 3, name: 'Empresa Logistics SRL',  rnc: '131-3333333-3', phone: '809-555-3030', visits: 24, loyalty: 'Oro' },
]
const TODAY = { capital_prestado: 275000, capital_recuperado: 16200, intereses_cobrados: 4280, prestamos_activos: 47, vencidos: 4, ticketsCount: 4 }

const NAV = [
  { id: 'loans',   icon: Banknote,      label: 'Prestamos', badge: LOANS.filter(l => l.status === 'vencido').length },
  { id: 'items',   icon: Package,       label: 'Articulos' },
  { id: 'pagos',   icon: PiggyBank,     label: 'Pagos / Cobros' },
  { id: 'agenda',  icon: Calendar,      label: 'Vencimientos' },
  { id: 'clients', icon: Users,         label: 'Clientes' },
  { id: 'reports', icon: BarChart3,     label: 'Reportes' },
  { id: 'empl',    icon: UserCheck,     label: 'Empleados' },
  { id: 'dgii',    icon: FileText,      label: 'DGII / SB' },
  { id: 'config',  icon: Settings,      label: 'Configuracion' },
]

function LoansView() {
  const styles = {
    al_dia:          'bg-emerald-100 text-emerald-700',
    proximo_vencer:  'bg-amber-100 text-amber-700',
    vencido:         'bg-red-100 text-red-700',
  }
  const labels = { al_dia: 'Al dia', proximo_vencer: 'Proximo a vencer', vencido: 'Vencido' }
  return (
    <div className="p-4">
      <PageHeader title="Prestamos activos" sub={`${LOANS.length} prestamos · ${LOANS.filter(l => l.status === 'vencido').length} vencidos`}
        right={<button className="bg-[#b3001e] text-white text-[12px] font-bold px-4 py-2 rounded-lg">+ Nuevo prestamo</button>}
      />
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="text-left px-4 py-2.5 font-bold">ID</th>
              <th className="text-left px-4 py-2.5 font-bold">Cliente</th>
              <th className="text-left px-4 py-2.5 font-bold">Garantia</th>
              <th className="text-right px-4 py-2.5 font-bold">Capital</th>
              <th className="text-right px-4 py-2.5 font-bold">Saldo</th>
              <th className="text-right px-4 py-2.5 font-bold">Tasa</th>
              <th className="text-left px-4 py-2.5 font-bold">Vence</th>
              <th className="text-right px-4 py-2.5 font-bold">Estado</th>
            </tr>
          </thead>
          <tbody>
            {LOANS.map(l => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-mono text-[11px] font-bold text-slate-800">{l.id}</td>
                <td className="px-4 py-3 font-semibold text-slate-800">{l.client}</td>
                <td className="px-4 py-3 text-slate-600 text-[12px]">{l.item}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-700">{RD(l.principal)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-bold text-[#b3001e]">{RD(l.balance)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-600">{l.rate}%/mes</td>
                <td className="px-4 py-3 text-slate-600 text-[12px]">{l.due}</td>
                <td className="px-4 py-3 text-right"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${styles[l.status]}`}>{labels[l.status]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ItemsView() {
  const styles = { activo: 'bg-sky-100 text-sky-700', vencido: 'bg-red-100 text-red-700', recuperado: 'bg-slate-100 text-slate-600' }
  return (
    <div className="p-4">
      <PageHeader title="Articulos en garantia" sub={`${PAWN_ITEMS.length} articulos custodiados`} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {PAWN_ITEMS.map(p => (
          <div key={p.id} className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-start justify-between mb-3">
              <Package size={20} className="text-slate-400" />
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${styles[p.status]}`}>{p.status}</span>
            </div>
            <p className="text-[14px] font-bold text-slate-800">{p.item}</p>
            <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-slate-100">
              <div><p className="text-[9px] text-slate-400 uppercase">Avaluo</p><p className="text-[14px] font-bold text-slate-800 tabular-nums">{RD(p.appraisal)}</p></div>
              <div><p className="text-[9px] text-slate-400 uppercase">Prestado</p><p className="text-[14px] font-bold text-[#b3001e] tabular-nums">{RD(p.loan)}</p></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PaymentsView() {
  return (
    <div className="p-4">
      <PageHeader title="Pagos recibidos" sub={`${PAYMENTS.length} pagos · ${RD(PAYMENTS.reduce((s, p) => s + p.amount, 0))} total`} />
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="text-left px-4 py-2.5 font-bold">Fecha</th>
              <th className="text-left px-4 py-2.5 font-bold">Prestamo</th>
              <th className="text-left px-4 py-2.5 font-bold">Cliente</th>
              <th className="text-right px-4 py-2.5 font-bold">Monto</th>
              <th className="text-left px-4 py-2.5 font-bold">Metodo</th>
            </tr>
          </thead>
          <tbody>
            {PAYMENTS.map((p, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-4 py-3 text-slate-600">{p.date}</td>
                <td className="px-4 py-3 font-mono text-[11px] font-bold text-slate-800">{p.loan}</td>
                <td className="px-4 py-3 text-slate-700">{p.client}</td>
                <td className="px-4 py-3 text-right font-bold text-[#b3001e] tabular-nums">{RD(p.amount)}</td>
                <td className="px-4 py-3 text-slate-600">{p.method}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default {
  label: 'Prestamos / Empenos',
  business: BUSINESS,
  navItems: NAV,
  defaultView: 'loans',
  render: (view, ctx) => {
    const tiles = [
      { label: 'Capital prestado', value: RD(TODAY.capital_prestado), sub: `${TODAY.prestamos_activos} prestamos` },
      { label: 'Recuperado hoy', value: RD(TODAY.capital_recuperado) },
      { label: 'Intereses cobrados', value: RD(TODAY.intereses_cobrados), accent: true },
      { label: 'Prestamos vencidos', value: TODAY.vencidos, sub: 'a cobrar' },
      { label: 'Articulos custodia', value: PAWN_ITEMS.filter(p => p.status === 'activo').length },
      { label: 'Avaluo total', value: RD(PAWN_ITEMS.reduce((s, p) => s + p.appraisal, 0)) },
      { label: 'Pagos hoy', value: PAYMENTS.length },
      { label: 'Reporte SB pendiente', value: '0', sub: 'al dia' },
    ]
    if (view === 'loans')   return <LoansDemo />
    if (view === 'items')   return <PawnItemsDemo />
    if (view === 'pagos')   return <PaymentsView />
    if (view === 'clients') return <ClientsDemo clients={toClientsDemoShape(CLIENTS)} />
    if (view === 'reports') return <ReportesDemo transactions={toReportesTxSeed({ today: { ventasTotal: TODAY.intereses_cobrados * 4, ventasCash: TODAY.intereses_cobrados, ventasTarjeta: 0, ventasTransfer: TODAY.intereses_cobrados * 3, ticketsCount: TODAY.prestamos_activos }, clients: CLIENTS })} reportTitle="Cobros e intereses" />
    if (view === 'dgii')    return <DGIIDemo ecfTodayCount={0} />
    if (view === 'empl')   return <EmpleadosDemo />
    if (view === 'config') return <ConfigDemo />
    return <SoonView title={NAV.find(n => n.id === view)?.label} desc="Disponible en el sistema completo." navigate={ctx.navigate} />
  },
}
