// Carniceria demo. Cuts catalog + freshness alerts + mayoreo pricing.
import { ShoppingCart, Users, BarChart3, Package, FileText, Settings, UserCheck, PiggyBank, Beef, AlertCircle } from 'lucide-react'
import { GenericPosView, SoonView, PageHeader, RD } from '../_shared'
import CashReconciliationDemo from '../screens/CashReconciliationDemo'
import EmpleadosDemo from '../screens/EmpleadosDemo'
import ConfigDemo    from '../screens/ConfigDemo'
import ReportesDemo from '../screens/ReportesDemo'
import DGIIDemo     from '../screens/DGIIDemo'
import ClientsDemo   from '../screens/ClientsDemo'
import InventoryDemo from '../screens/InventoryDemo'
import { toClientsDemoShape, toReportesTxSeed } from '../screens/_adapters'

const BUSINESS = { name: 'Carniceria El Buen Corte', rnc: '131-44556-7', user: { name: 'Jose Almonte', role: 'cashier' } }

const CATEGORIES = [
  { id: 'res',    label: 'Res' },
  { id: 'cerdo',  label: 'Cerdo' },
  { id: 'pollo',  label: 'Pollo' },
  { id: 'embut',  label: 'Embutidos' },
  { id: 'pescado', label: 'Pescado' },
]
const PRODUCTS = {
  res: [
    { id: 1,  name: 'Filete Res 1 lb',     price: 380, sub: 'lb · refrigerado' },
    { id: 2,  name: 'Costilla Res 1 lb',   price: 285, sub: 'lb · refrigerado' },
    { id: 3,  name: 'Bistec 1 lb',         price: 320, sub: 'lb · refrigerado' },
    { id: 4,  name: 'Carne Molida 1 lb',   price: 195, sub: 'lb · 80/20' },
    { id: 5,  name: 'Lengua 1 lb',         price: 280, sub: 'lb · refrigerado' },
  ],
  cerdo: [
    { id: 10, name: 'Chuleta Cerdo 1 lb',  price: 220, sub: 'lb · refrigerado' },
    { id: 11, name: 'Costilla Cerdo 1 lb', price: 195, sub: 'lb · refrigerado' },
    { id: 12, name: 'Pernil 1 lb',         price: 175, sub: 'lb · refrigerado' },
    { id: 13, name: 'Tocino 1 lb',         price: 285, sub: 'lb · ahumado' },
  ],
  pollo: [
    { id: 20, name: 'Pollo entero 1 lb',   price: 95,  sub: 'lb · fresco' },
    { id: 21, name: 'Pechuga 1 lb',        price: 165, sub: 'lb · fresco' },
    { id: 22, name: 'Muslo 1 lb',          price: 110, sub: 'lb · fresco' },
    { id: 23, name: 'Alitas 1 lb',         price: 125, sub: 'lb · fresco' },
  ],
  embut: [
    { id: 30, name: 'Salami 1 lb',         price: 240, sub: 'Induveca' },
    { id: 31, name: 'Salchicha Vienesa',   price: 180, sub: 'paquete 1 lb' },
    { id: 32, name: 'Jamon de Pierna 1 lb', price: 285, sub: 'lb' },
    { id: 33, name: 'Chorizo Espanol 1 lb', price: 350, sub: 'lb' },
  ],
  pescado: [
    { id: 40, name: 'Mero 1 lb',           price: 420, sub: 'lb · fresco' },
    { id: 41, name: 'Mojarra 1 lb',        price: 195, sub: 'lb · fresco' },
    { id: 42, name: 'Camarones 1 lb',      price: 580, sub: 'lb · congelado' },
  ],
}
const CLIENTS = [
  { id: 1, name: 'Restaurante La Casona', rnc: '131-1111111-1', phone: '809-555-1010', visits: 124, loyalty: 'Oro', points: 2480 },
  { id: 2, name: 'Cocina del Barrio',    rnc: '131-2222222-2', phone: '829-555-2020', visits: 56,  loyalty: 'Plata', points: 1120 },
  { id: 3, name: 'Familia Mendez',       rnc: '003-3333333-3', phone: '849-555-3030', visits: 22, loyalty: 'Bronce', points: 440 },
]
const FRESHNESS = [
  { item: 'Filete de Res', batch: 'L-042026', received: '2026-04-25', expires: '2026-04-29', stock_lb: 18, status: 'caduca_pronto' },
  { item: 'Pollo entero',  batch: 'P-042726', received: '2026-04-27', expires: '2026-05-01', stock_lb: 42, status: 'fresco' },
  { item: 'Mero',          batch: 'M-042626', received: '2026-04-26', expires: '2026-04-28', stock_lb: 8,  status: 'critico' },
  { item: 'Carne Molida',  batch: 'CM-042526', received: '2026-04-25', expires: '2026-04-30', stock_lb: 24, status: 'fresco' },
]
const TODAY = { ventasTotal: 31280, ventasCash: 12200, ventasTarjeta: 14200, ventasTransfer: 4880, ticketsCount: 53, libras_vendidas: 187, ecf_emitidos: 18, itbisTotal: 0 }

const NAV = [
  { id: 'pos',     icon: ShoppingCart,  label: 'POS' },
  { id: 'fresh',   icon: AlertCircle,   label: 'Frescura',  badge: FRESHNESS.filter(f => f.status === 'critico').length },
  { id: 'inv',     icon: Package,       label: 'Inventario' },
  { id: 'clients', icon: Users,         label: 'Clientes' },
  { id: 'reports', icon: BarChart3,     label: 'Reportes' },
  { id: 'cuadre',  icon: PiggyBank,     label: 'Cuadre Caja' },
  { id: 'empl',    icon: UserCheck,     label: 'Empleados' },
  { id: 'dgii',    icon: FileText,      label: 'DGII / e-CF' },
  { id: 'config',  icon: Settings,      label: 'Configuracion' },
]

function FreshnessView() {
  const styles = {
    fresco:        'bg-emerald-100 text-emerald-700',
    caduca_pronto: 'bg-amber-100 text-amber-700',
    critico:       'bg-red-100 text-red-700',
  }
  const labels = { fresco: 'Fresco', caduca_pronto: 'Caduca pronto', critico: 'Critico' }
  return (
    <div className="p-4">
      <PageHeader title="Alertas de Frescura" sub="Control de cadena de frio y vencimiento de cortes" />
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="text-left px-4 py-2.5 font-bold">Producto</th>
              <th className="text-left px-4 py-2.5 font-bold">Lote</th>
              <th className="text-left px-4 py-2.5 font-bold">Recibido</th>
              <th className="text-left px-4 py-2.5 font-bold">Vence</th>
              <th className="text-right px-4 py-2.5 font-bold">Stock (lb)</th>
              <th className="text-right px-4 py-2.5 font-bold">Estado</th>
            </tr>
          </thead>
          <tbody>
            {FRESHNESS.map((f, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-4 py-3 font-semibold text-slate-800">{f.item}</td>
                <td className="px-4 py-3 font-mono text-[11px] text-slate-600">{f.batch}</td>
                <td className="px-4 py-3 text-slate-600">{f.received}</td>
                <td className="px-4 py-3 text-slate-600">{f.expires}</td>
                <td className="px-4 py-3 text-right font-bold tabular-nums">{f.stock_lb}</td>
                <td className="px-4 py-3 text-right"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${styles[f.status]}`}>{labels[f.status]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default {
  label: 'Carniceria',
  business: BUSINESS,
  navItems: NAV,
  defaultView: 'pos',
  render: (view, ctx) => {
    const tiles = [
      { label: 'Ventas hoy', value: RD(TODAY.ventasTotal), sub: `${TODAY.ticketsCount} tickets` },
      { label: 'Libras vendidas', value: TODAY.libras_vendidas, sub: 'lb totales' },
      { label: 'Efectivo', value: RD(TODAY.ventasCash) },
      { label: 'Tarjeta', value: RD(TODAY.ventasTarjeta) },
      { label: 'Transferencia', value: RD(TODAY.ventasTransfer) },
      { label: 'Mayoreo (>20 lb)', value: '14 tickets', sub: 'precio especial' },
      { label: 'Critico frescura', value: FRESHNESS.filter(f => f.status === 'critico').length, sub: 'lotes' },
      { label: 'e-CF emitidos', value: TODAY.ecf_emitidos },
    ]
    if (view === 'pos')     return <GenericPosView business={BUSINESS} categories={CATEGORIES} getItems={(c) => PRODUCTS[c]} clients={CLIENTS} itemNoun="corte" />
    if (view === 'fresh')   return <FreshnessView />
    if (view === 'inv')     return <InventoryDemo />
    if (view === 'clients') return <ClientsDemo clients={toClientsDemoShape(CLIENTS)} />
    if (view === 'reports') return <ReportesDemo transactions={toReportesTxSeed({ today: TODAY, clients: CLIENTS, items: Object.values(PRODUCTS).flat() })} />
    if (view === 'cuadre')  return <CashReconciliationDemo ventasCash={TODAY.ventasCash} ticketsCount={TODAY.ticketsCount} />
    if (view === 'dgii')    return <DGIIDemo ecfTodayCount={TODAY.ecf_emitidos} />
    if (view === 'empl')   return <EmpleadosDemo vertical="carniceria" />
    if (view === 'config') return <ConfigDemo vertical="carniceria" business={BUSINESS} />
    return <SoonView title={NAV.find(n => n.id === view)?.label} desc="Disponible en el sistema completo." navigate={ctx.navigate} />
  },
}
