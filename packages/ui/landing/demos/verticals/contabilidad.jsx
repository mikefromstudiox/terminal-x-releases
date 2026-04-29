// Contabilidad demo. e-CF only — no POS, no inventory. For accountants and
// invoicing-only offices. Clean focused demo: invoicing dashboard, 606/607,
// clients, DGII status.
import { Users, BarChart3, FileText, Settings, Briefcase, Receipt, Download, Mail, Plus, Check } from 'lucide-react'
import { SoonView, PageHeader, RD, RDc } from '../_shared'
import EmpleadosDemo from '../screens/EmpleadosDemo'
import ConfigDemo    from '../screens/ConfigDemo'
import ReportesDemo from '../screens/ReportesDemo'
import DGIIDemo     from '../screens/DGIIDemo'
import ClientsDemo  from '../screens/ClientsDemo'
import { toClientsDemoShape, toReportesTxSeed } from '../screens/_adapters'

const BUSINESS = { name: 'CPA Asociados Mendez', rnc: '131-12233-4', user: { name: 'Lic. Juan Mendez', role: 'owner' } }

const INVOICES = [
  { id: 1, ncf: 'E320000001847', client: 'Empresa Tropical SRL',  amount: 18500, itbis: 2823,  date: '2026-04-27 10:24', status: 'aceptada', method: 'Transferencia' },
  { id: 2, ncf: 'E320000001846', client: 'Distribuidora del Sur', amount: 95000, itbis: 14492, date: '2026-04-27 09:18', status: 'aceptada', method: 'Cheque' },
  { id: 3, ncf: 'E310000000235', client: 'Hotel Atlantico SRL',   amount: 245000, itbis: 37373, date: '2026-04-26 16:45', status: 'aceptada', method: 'Transferencia' },
  { id: 4, ncf: 'E320000001845', client: 'Sra. Ana Reyes',        amount: 8500,  itbis: 1297,  date: '2026-04-26 14:32', status: 'aceptada', method: 'Efectivo' },
  { id: 5, ncf: 'E430000000007', client: 'Gastos Menores',        amount: 1850,  itbis: 282,   date: '2026-04-26 11:15', status: 'aceptada', method: 'Efectivo' },
  { id: 6, ncf: 'E320000001844', client: 'Restaurante La Casona', amount: 32400, itbis: 4946,  date: '2026-04-25 18:20', status: 'aceptada', method: 'Transferencia' },
  { id: 7, ncf: 'E340000000091', client: 'Empresa Tropical SRL',  amount: -4500, itbis: -687,  date: '2026-04-25 15:10', status: 'aceptada', method: 'Nota credito' },
]
const CLIENTS = [
  { id: 1, name: 'Empresa Tropical SRL',     rnc: '131-1111111-1', phone: '809-555-1010', visits: 24, loyalty: 'Oro' },
  { id: 2, name: 'Distribuidora del Sur',    rnc: '131-2222222-2', phone: '809-555-2020', visits: 18, loyalty: 'Oro' },
  { id: 3, name: 'Hotel Atlantico SRL',      rnc: '131-3333333-3', phone: '809-555-3030', visits: 12, loyalty: 'Plata' },
  { id: 4, name: 'Sra. Ana Reyes',           rnc: '003-4444444-4', phone: '849-555-4040', visits: 6,  loyalty: 'Bronce' },
  { id: 5, name: 'Restaurante La Casona',    rnc: '131-5555555-5', phone: '809-555-5050', visits: 36, loyalty: 'Oro' },
]
const TODAY = { ventasTotal: 113500, ecf_emitidos: 4, itbisTotal: 17315, clientes_activos: 32, ncf_pendientes: 0 }

const NAV = [
  { id: 'invoicing', icon: Receipt,   label: 'Facturacion' },
  { id: 'clients',   icon: Users,     label: 'Clientes' },
  { id: 'reports',   icon: BarChart3, label: 'Reportes' },
  { id: '606',       icon: Download,  label: '606 Compras' },
  { id: '607',       icon: Download,  label: '607 Ventas' },
  { id: 'dgii',      icon: FileText,  label: 'DGII / e-CF' },
  { id: 'config',    icon: Settings,  label: 'Configuracion' },
]

function InvoicingView() {
  return (
    <div className="p-4">
      <PageHeader title="Facturacion electronica" sub={`${INVOICES.length} comprobantes esta semana · ${RD(INVOICES.reduce((s, i) => s + i.amount, 0))} facturado`}
        right={<button className="bg-[#b3001e] text-white text-[12px] font-bold px-4 py-2 rounded-lg inline-flex items-center gap-1.5"><Plus size={13} /> Nueva factura</button>}
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Facturas hoy', value: 4, sub: 'aceptadas DGII' },
          { label: 'Total facturado hoy', value: RD(TODAY.ventasTotal) },
          { label: 'ITBIS hoy', value: RD(TODAY.itbisTotal) },
          { label: 'En cola', value: TODAY.ncf_pendientes, sub: 'esperando envio' },
        ].map((t, i) => (
          <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[2px] text-slate-400">{t.label}</p>
            <p className="text-[22px] font-black text-slate-900 mt-1.5 tabular-nums">{typeof t.value === 'number' ? t.value : t.value}</p>
            {t.sub && <p className="text-[11px] text-slate-500 mt-0.5">{t.sub}</p>}
          </div>
        ))}
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-[14px] font-bold text-slate-800">Comprobantes recientes</h3>
          <button className="text-[11px] text-[#b3001e] font-bold hover:underline inline-flex items-center gap-1"><Download size={11} /> Exportar PDF</button>
        </div>
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="text-left px-4 py-2.5 font-bold">e-NCF</th>
              <th className="text-left px-4 py-2.5 font-bold">Cliente</th>
              <th className="text-right px-4 py-2.5 font-bold">Monto</th>
              <th className="text-right px-4 py-2.5 font-bold">ITBIS</th>
              <th className="text-left px-4 py-2.5 font-bold">Fecha</th>
              <th className="text-left px-4 py-2.5 font-bold">Pago</th>
              <th className="text-right px-4 py-2.5 font-bold">Estado</th>
              <th className="text-right px-4 py-2.5 font-bold">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {INVOICES.map(inv => (
              <tr key={inv.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                <td className="px-4 py-3 font-mono text-[11px] font-bold text-slate-800">{inv.ncf}</td>
                <td className="px-4 py-3 font-semibold text-slate-800">{inv.client}</td>
                <td className={`px-4 py-3 text-right font-bold tabular-nums ${inv.amount < 0 ? 'text-red-600' : 'text-[#b3001e]'}`}>{RD(inv.amount)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-600">{RD(inv.itbis)}</td>
                <td className="px-4 py-3 text-slate-600 text-[12px]">{inv.date}</td>
                <td className="px-4 py-3 text-slate-600 text-[12px]">{inv.method}</td>
                <td className="px-4 py-3 text-right">
                  <span className="text-[10px] text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider inline-flex items-center gap-1"><Check size={10} /> {inv.status}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button className="text-[11px] text-[#b3001e] font-bold hover:underline mr-2">PDF</button>
                  <button className="text-[11px] text-[#25D366] font-bold hover:underline">WA</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FormatoView({ tipo }) {
  const titulo = tipo === '606' ? '606 — Compras de Bienes y Servicios' : '607 — Ventas y Operaciones'
  const lineas = tipo === '607' ? INVOICES.length : 23
  return (
    <div className="p-4">
      <PageHeader title={titulo} sub={`Periodo abril 2026 · ${lineas} lineas · listo para subir al portal DGII`}
        right={<div className="flex gap-2"><button className="bg-white border border-slate-200 text-[12px] font-bold px-3 py-2 rounded-lg inline-flex items-center gap-1.5"><Mail size={12} /> Enviar por email</button><button className="bg-[#b3001e] text-white text-[12px] font-bold px-4 py-2 rounded-lg inline-flex items-center gap-1.5"><Download size={12} /> Descargar TXT</button></div>}
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="bg-white rounded-2xl border border-slate-200 p-4"><p className="text-[10px] font-bold uppercase tracking-[2px] text-slate-400">Lineas</p><p className="text-[22px] font-black text-slate-900 mt-1 tabular-nums">{lineas}</p></div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4"><p className="text-[10px] font-bold uppercase tracking-[2px] text-slate-400">Total operaciones</p><p className="text-[22px] font-black text-slate-900 mt-1 tabular-nums">{RD(485200)}</p></div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4"><p className="text-[10px] font-bold uppercase tracking-[2px] text-slate-400">ITBIS</p><p className="text-[22px] font-black text-slate-900 mt-1 tabular-nums">{RD(73993)}</p></div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4"><p className="text-[10px] font-bold uppercase tracking-[2px] text-slate-400">Estado</p><p className="text-[14px] font-black text-emerald-700 mt-2.5 inline-flex items-center gap-1.5"><Check size={14} /> Listo para enviar</p></div>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-[14px] font-bold text-slate-800">Vista previa del archivo TXT</h3>
          <span className="text-[10px] text-slate-400 font-mono">formato DGII oficial</span>
        </div>
        <pre className="px-5 py-4 text-[11px] font-mono text-slate-700 leading-relaxed overflow-x-auto bg-slate-50">
{`131${tipo === '607' ? '04' : '03'}|2026-04|${tipo === '607' ? '01' : '01'}|131111111-1|01|E320000001847|2026-04-27|18500.00|2823.00|...|
131${tipo === '607' ? '04' : '03'}|2026-04|02|131222222-2|01|E320000001846|2026-04-27|95000.00|14492.00|...|
131${tipo === '607' ? '04' : '03'}|2026-04|03|131333333-3|01|E310000000235|2026-04-26|245000.00|37373.00|...|
... ${lineas - 3} lineas mas ...`}
        </pre>
      </div>
    </div>
  )
}

export default {
  label: 'Contabilidad',
  business: BUSINESS,
  navItems: NAV,
  defaultView: 'invoicing',
  render: (view, ctx) => {
    const tiles = [
      { label: 'Facturado este mes', value: 'RD$2.4M', sub: '147 e-CF' },
      { label: 'Clientes activos', value: TODAY.clientes_activos },
      { label: 'ITBIS recaudado', value: RD(125842) },
      { label: 'e-CF aceptados', value: '147', sub: '0 rechazados' },
      { label: 'Promedio factura', value: RD(16327) },
      { label: 'Pendiente cobro', value: RD(89400) },
      { label: 'Notas credito', value: 3 },
      { label: 'Cola e-CF', value: '0', sub: 'todo enviado' },
    ]
    if (view === 'invoicing') return <InvoicingView />
    if (view === 'clients')   return <ClientsDemo clients={toClientsDemoShape(CLIENTS)} />
    if (view === 'reports')   return <ReportesDemo transactions={toReportesTxSeed({ today: { ventasTotal: 113500, ventasCash: 0, ventasTarjeta: 8500, ventasTransfer: 105000, ticketsCount: TODAY.ecf_emitidos * 4 }, clients: CLIENTS })} reportTitle="Comprobantes emitidos" />
    if (view === '606')       return <FormatoView tipo="606" />
    if (view === '607')       return <FormatoView tipo="607" />
    if (view === 'dgii')      return <DGIIDemo ecfTodayCount={TODAY.ecf_emitidos} />
    if (view === 'empl')   return <EmpleadosDemo />
    if (view === 'config') return <ConfigDemo />
    return <SoonView title={NAV.find(n => n.id === view)?.label} desc="Disponible en el sistema completo." navigate={ctx.navigate} />
  },
}
