// Food truck demo. Mesa-free take-out POS + KDS + locations + waste log.
import { ShoppingCart, BarChart3, Package, Settings, UserCheck, PiggyBank, UtensilsCrossed, ChefHat, MapPin, Trash2, Sparkles } from 'lucide-react'
import { SoonView, RD } from '../_shared'
import CashReconciliationDemo from '../screens/CashReconciliationDemo'
import EmpleadosDemo from '../screens/EmpleadosDemo'
import ConfigDemo    from '../screens/ConfigDemo'
import ReportesDemo from '../screens/ReportesDemo'
import DGIIDemo     from '../screens/DGIIDemo'
import KDSDemo         from '../screens/KDSDemo'
import MenuBuilderDemo from '../screens/MenuBuilderDemo'
import InventoryDemo   from '../screens/InventoryDemo'
import { toReportesTxSeed } from '../screens/_adapters'

const BUSINESS = { name: 'Food Truck El Sabroso', rnc: '131-99887-1', user: { name: 'Luis Mejia', role: 'cashier' } }

const TODAY = {
  ventasTotal: 32480, ventasCash: 18600, ventasTarjeta: 9420, ventasTransfer: 4460,
  ticketsCount: 142, propinas: 0, ecf_emitidos: 0,
  ticket_promedio: 229, itbisTotal: 4955,
  ubicacion_actual: 'Plaza Naco · Av. Tiradentes',
  ordenes_pendientes: 7, ordenes_listas: 12,
  merma_dia: 285,
  evento_activo: false,
}

const LOCATIONS = [
  { id: 1, name: 'Plaza Naco · Av. Tiradentes',  notes: 'Lun-Vie 11am-3pm · alta venta',  ventas_30d: 142850, active: true },
  { id: 2, name: 'Parque Mirador del Sur',       notes: 'Sab-Dom 5pm-10pm · familias',    ventas_30d:  98620, active: true },
  { id: 3, name: 'Universidad APEC · Naco',      notes: 'Lun-Jue 5pm-9pm · estudiantes',  ventas_30d:  74200, active: true },
  { id: 4, name: 'Av. Independencia (kiosko)',   notes: 'Mie + Vie 6pm-12am · vida nocturna', ventas_30d: 88450, active: true },
  { id: 5, name: 'Evento privado · Casa de Campo', notes: 'Sat 2026-05-15 · 200 personas',  ventas_30d:  0,     active: false },
]

const WASTE_LOG = [
  { id: 1, item: 'Pollo crudo (lb)',         qty: 4,  unit: 'lb',  reason: 'caducado',   cost_est: 320, when: 'Hoy 10:45am' },
  { id: 2, item: 'Pan de hamburguesa',       qty: 12, unit: 'und', reason: 'humedo',     cost_est:  85, when: 'Hoy 9:20am' },
  { id: 3, item: 'Yuca pelada',              qty: 3,  unit: 'lb',  reason: 'oxidada',    cost_est:  90, when: 'Ayer 6:15pm' },
  { id: 4, item: 'Salsa rosada (litro)',     qty: 1,  unit: 'lt',  reason: 'derrame',    cost_est: 110, when: 'Ayer 2:40pm' },
  { id: 5, item: 'Tomate maduro (lb)',       qty: 5,  unit: 'lb',  reason: 'maltrato',   cost_est: 140, when: '2 dias atras' },
]

const NAV = [
  { id: 'pos',         icon: ShoppingCart,    label: 'POS Camion' },
  { id: 'menu',        icon: UtensilsCrossed, label: 'Menu' },
  { id: 'kds',         icon: ChefHat,         label: 'Cocina KDS' },
  { id: 'ubicaciones', icon: MapPin,          label: 'Ubicaciones' },
  { id: 'mermas',      icon: Trash2,          label: 'Mermas' },
  { id: 'reports',     icon: BarChart3,       label: 'Reportes' },
  { id: 'cuadre',      icon: PiggyBank,       label: 'Cuadre Caja' },
  { id: 'inv',         icon: Package,         label: 'Inventario' },
  { id: 'empl',        icon: UserCheck,       label: 'Empleados' },
  { id: 'dgii',        icon: ChefHat,         label: 'DGII / e-CF' },
  { id: 'config',      icon: Settings,        label: 'Configuracion' },
]

function PosTakeOut() {
  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl px-4 py-3 mb-5 flex items-center gap-3">
        <Sparkles size={18} className="text-amber-500" />
        <div className="flex-1 text-sm">
          <span className="font-bold text-slate-700">Modo Evento listo</span>
          <span className="text-slate-500"> — activalo desde Configuracion para multiplicar precios en eventos privados.</span>
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-5">
        <p className="text-[10px] uppercase tracking-wider text-slate-400">Ubicacion actual</p>
        <p className="text-[18px] font-bold text-slate-800 mt-1 flex items-center gap-2">
          <MapPin size={16} className="text-[#b3001e]" /> {TODAY.ubicacion_actual}
        </p>
        <p className="text-[12px] text-slate-500 mt-1">Cuadre abierto desde 10:32am · {TODAY.ticketsCount} tickets</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {[
          { name: 'Chimi clasico',         price: 220 },
          { name: 'Chimi con queso',       price: 260 },
          { name: 'Hot dog dominicano',    price: 180 },
          { name: 'Pica pollo (4 piezas)', price: 320 },
          { name: 'Tostones con salsa',    price: 140 },
          { name: 'Yaniqueque',            price:  80 },
          { name: 'Yaroa de pollo',        price: 280 },
          { name: 'Yaroa mixta',           price: 340 },
          { name: 'Mangu con 3 golpes',    price: 280 },
          { name: 'Refresco lata',         price:  60 },
          { name: 'Malta Morena',          price:  80 },
          { name: 'Batida de chinola',     price: 140 },
        ].map((it, i) => (
          <button key={i} className="bg-white border border-slate-200 rounded-xl p-3 text-left hover:border-[#b3001e] transition-colors">
            <p className="text-[13px] font-semibold text-slate-800 truncate">{it.name}</p>
            <p className="text-[14px] font-bold text-[#b3001e] mt-1">{RD(it.price)}</p>
          </button>
        ))}
      </div>
    </div>
  )
}

function LocationsView() {
  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-[20px] font-black text-slate-800">Ubicaciones favoritas</h2>
          <p className="text-[12px] text-slate-500">Para que cada cuadre arranque con la parada correcta marcada.</p>
        </div>
        <button className="bg-[#b3001e] text-white text-[12px] font-bold px-4 py-2 rounded-xl">+ Nueva ubicacion</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {LOCATIONS.map(l => (
          <div key={l.id} className={`bg-white border rounded-2xl p-4 ${l.active ? 'border-slate-200' : 'border-dashed border-slate-200 opacity-60'}`}>
            <div className="flex items-start gap-2">
              <MapPin size={16} className={l.active ? 'text-[#b3001e]' : 'text-slate-400'} />
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-bold text-slate-800">{l.name}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">{l.notes}</p>
              </div>
              {!l.active && <span className="text-[10px] uppercase font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">Privado</span>}
            </div>
            {l.active && (
              <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-[12px]">
                <span className="text-slate-400">Ventas 30d</span>
                <span className="font-bold text-slate-800 tabular-nums">{RD(l.ventas_30d)}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function WasteLogView() {
  const total = WASTE_LOG.reduce((s, w) => s + w.cost_est, 0)
  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-[20px] font-black text-slate-800">Mermas</h2>
          <p className="text-[12px] text-slate-500">Lleva control de lo que se descarta para entender el costo real del food truck.</p>
        </div>
        <button className="bg-[#b3001e] text-white text-[12px] font-bold px-4 py-2 rounded-xl">+ Registrar merma</button>
      </div>
      <div className="bg-[#b3001e]/5 border border-[#b3001e]/20 rounded-2xl p-4 mb-4 flex items-center gap-3">
        <Trash2 size={18} className="text-[#b3001e]" />
        <div className="flex-1">
          <p className="text-[11px] uppercase font-bold tracking-wider text-[#b3001e]">Costo estimado ultimos 7 dias</p>
          <p className="text-[24px] font-black text-slate-800 tabular-nums">{RD(total + 1280)}</p>
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        {WASTE_LOG.map(w => (
          <div key={w.id} className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-0">
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-slate-800">{w.item}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{w.qty} {w.unit} · {w.reason} · {w.when}</p>
            </div>
            <span className="text-[13px] font-bold text-[#b3001e] tabular-nums">-{RD(w.cost_est)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const CLIENTS = [
  { id: 1, name: 'Cliente recurrente · Naco',  visits: 18, loyalty: 'Plata', points: 360 },
  { id: 2, name: 'Familia Mendez',             visits: 11, loyalty: 'Bronce', points: 220 },
]

export default {
  label: 'Food Truck',
  business: BUSINESS,
  navItems: NAV,
  defaultView: 'pos',
  render: (view, ctx) => {
    if (view === 'pos')         return <PosTakeOut />
    if (view === 'menu')        return <MenuBuilderDemo />
    if (view === 'kds')         return <KDSDemo />
    if (view === 'ubicaciones') return <LocationsView />
    if (view === 'mermas')      return <WasteLogView />
    if (view === 'inv')         return <InventoryDemo />
    if (view === 'reports')     return <ReportesDemo transactions={toReportesTxSeed({ today: TODAY, clients: CLIENTS, items: [] })} />
    if (view === 'cuadre')      return <CashReconciliationDemo ventasCash={TODAY.ventasCash} ticketsCount={TODAY.ticketsCount} />
    if (view === 'dgii')        return <DGIIDemo ecfTodayCount={TODAY.ecf_emitidos} />
    if (view === 'empl')        return <EmpleadosDemo />
    if (view === 'config')      return <ConfigDemo />
    return <SoonView title={NAV.find(n => n.id === view)?.label} desc="Disponible en el sistema completo." navigate={ctx.navigate} />
  },
}
