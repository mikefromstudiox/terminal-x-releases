// Restaurant demo. Mesas grid + menu + KDS.
import { useState } from 'react'
import { ShoppingCart, Users, BarChart3, Package, FileText, Settings, UserCheck, PiggyBank, UtensilsCrossed, ChefHat, Calendar, Grid3x3, Plus, Check, Clock } from 'lucide-react'
import { SoonView, PageHeader, RD, RDc } from '../_shared'
import CashReconciliationDemo from '../screens/CashReconciliationDemo'
import EmpleadosDemo from '../screens/EmpleadosDemo'
import ConfigDemo    from '../screens/ConfigDemo'
import ReportesDemo from '../screens/ReportesDemo'
import DGIIDemo     from '../screens/DGIIDemo'
import ClientsDemo  from '../screens/ClientsDemo'
import MesasDemo       from '../screens/MesasDemo'
import KDSDemo         from '../screens/KDSDemo'
import MenuBuilderDemo from '../screens/MenuBuilderDemo'
import InventoryDemo   from '../screens/InventoryDemo'
import InventoryCountDemo from '../screens/InventoryCountDemo'
import { toClientsDemoShape, toReportesTxSeed } from '../screens/_adapters'

const BUSINESS = { name: 'Restaurante La Casona', rnc: '131-66778-9', user: { name: 'Camila Torres', role: 'cashier' } }

const MESAS = [
  { id: 1,  name: 'Mesa 1', seats: 4,  status: 'libre',     tab: 0 },
  { id: 2,  name: 'Mesa 2', seats: 4,  status: 'ocupada',   tab: 1850, mesero: 'Carlos', minutes: 32 },
  { id: 3,  name: 'Mesa 3', seats: 6,  status: 'ocupada',   tab: 4250, mesero: 'Maria',  minutes: 18 },
  { id: 4,  name: 'Mesa 4', seats: 2,  status: 'libre',     tab: 0 },
  { id: 5,  name: 'Mesa 5', seats: 4,  status: 'reservada', tab: 0, reserva: 'Familia Mendez · 8:00 PM' },
  { id: 6,  name: 'Mesa 6', seats: 8,  status: 'ocupada',   tab: 8920, mesero: 'Carlos', minutes: 65 },
  { id: 7,  name: 'Mesa 7', seats: 4,  status: 'libre',     tab: 0 },
  { id: 8,  name: 'Mesa 8', seats: 2,  status: 'cuenta',    tab: 1620, mesero: 'Maria',  minutes: 78 },
  { id: 9,  name: 'Bar 1',  seats: 2,  status: 'ocupada',   tab: 480,  mesero: 'Bar',    minutes: 14 },
  { id: 10, name: 'Bar 2',  seats: 2,  status: 'libre',     tab: 0 },
  { id: 11, name: 'Terraza 1', seats: 6, status: 'ocupada', tab: 5680, mesero: 'Pedro',  minutes: 42 },
  { id: 12, name: 'Terraza 2', seats: 6, status: 'libre',   tab: 0 },
]
const MENU_CATS = [
  { id: 'entradas',  label: 'Entradas' },
  { id: 'principal', label: 'Plato Fuerte' },
  { id: 'postres',   label: 'Postres' },
  { id: 'bebidas',   label: 'Bebidas' },
  { id: 'vinos',     label: 'Vinos' },
]
const MENU = {
  entradas: [
    { id: 1, name: 'Tostones con Queso',  price: 285, sub: '4-5 min' },
    { id: 2, name: 'Yaniqueque',          price: 195, sub: '5 min' },
    { id: 3, name: 'Empanadas (3 ud)',    price: 245, sub: '8 min' },
    { id: 4, name: 'Quipes (4 ud)',       price: 195, sub: '6 min' },
  ],
  principal: [
    { id: 10, name: 'Pollo Guisado',       price: 485, sub: '15 min' },
    { id: 11, name: 'Bistec Encebollado',  price: 685, sub: '18 min' },
    { id: 12, name: 'Mofongo con Camarones', price: 895, sub: '20 min' },
    { id: 13, name: 'Sancocho',            price: 595, sub: '12 min' },
    { id: 14, name: 'Arroz con Pollo',     price: 425, sub: '15 min' },
    { id: 15, name: 'Pescado Frito',       price: 785, sub: '20 min' },
  ],
  postres: [
    { id: 20, name: 'Tres Leches',         price: 195, sub: '2 min' },
    { id: 21, name: 'Flan',                price: 165, sub: '2 min' },
    { id: 22, name: 'Helado',              price: 145, sub: '2 min' },
  ],
  bebidas: [
    { id: 30, name: 'Refresco 12oz',       price: 85,  sub: 'Coca Cola, Sprite' },
    { id: 31, name: 'Cerveza Presidente',  price: 165, sub: '12oz' },
    { id: 32, name: 'Jugo Natural',        price: 145, sub: 'naranja, china' },
    { id: 33, name: 'Agua 500ml',          price: 65,  sub: '' },
  ],
  vinos: [
    { id: 40, name: 'Vino Tinto Copa',     price: 285, sub: 'Casillero del Diablo' },
    { id: 41, name: 'Vino Blanco Copa',    price: 265, sub: 'Frontera' },
    { id: 42, name: 'Botella Vino Tinto',  price: 1450, sub: 'Casillero del Diablo' },
  ],
}
const KDS_TICKETS = [
  { id: 'T-101', mesa: 'Mesa 2', items: ['1x Pollo Guisado', '2x Tostones'], minutes: 8, status: 'cocinando' },
  { id: 'T-102', mesa: 'Mesa 3', items: ['1x Mofongo + Camarones', '1x Bistec', '2x Cerveza'], minutes: 12, status: 'cocinando' },
  { id: 'T-103', mesa: 'Mesa 6', items: ['3x Sancocho', '4x Tostones'], minutes: 4, status: 'cola' },
  { id: 'T-104', mesa: 'Bar 1',  items: ['2x Empanadas'], minutes: 2, status: 'cola' },
  { id: 'T-105', mesa: 'Terraza 1', items: ['1x Pescado Frito', '1x Arroz con Pollo', '2x Refresco'], minutes: 16, status: 'listo' },
]
const TODAY = { ventasTotal: 87420, ventasCash: 14200, ventasTarjeta: 52400, ventasTransfer: 20820, ticketsCount: 47, propinas: 8740, ecf_emitidos: 38, mesas_servidas: 31, ticket_promedio: 1860, itbisTotal: 13335 }

const NAV = [
  { id: 'mesas',   icon: Grid3x3,        label: 'Mesas' },
  { id: 'menu',    icon: UtensilsCrossed, label: 'Menu' },
  { id: 'kds',     icon: ChefHat,        label: 'Cocina KDS' },
  { id: 'reservas', icon: Calendar,      label: 'Reservas' },
  { id: 'reports', icon: BarChart3,      label: 'Reportes' },
  { id: 'cuadre',  icon: PiggyBank,      label: 'Cuadre Caja' },
  { id: 'inv',     icon: Package,        label: 'Inventario' },
  { id: 'empl',    icon: UserCheck,      label: 'Empleados' },
  { id: 'dgii',    icon: FileText,       label: 'DGII / e-CF' },
  { id: 'config',  icon: Settings,       label: 'Configuracion' },
]

function MesasView() {
  const status_styles = {
    libre:     'bg-white border-slate-200 text-slate-500',
    ocupada:   'bg-emerald-50 border-emerald-300 text-emerald-800',
    reservada: 'bg-sky-50 border-sky-300 text-sky-800',
    cuenta:    'bg-amber-50 border-amber-300 text-amber-800',
  }
  const labels = { libre: 'Libre', ocupada: 'Ocupada', reservada: 'Reservada', cuenta: 'Cuenta pedida' }
  return (
    <div className="p-4">
      <PageHeader title="Mesas" sub={`${MESAS.filter(m => m.status === 'ocupada').length} ocupadas · ${MESAS.filter(m => m.status === 'libre').length} libres · ${MESAS.filter(m => m.status === 'cuenta').length} con cuenta pedida`}
        right={<button className="bg-[#b3001e] text-white text-[12px] font-bold px-4 py-2 rounded-lg">Editar plano del salon</button>}
      />
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {MESAS.map(m => (
          <button key={m.id} className={`rounded-2xl border-2 p-4 text-left transition-all hover:shadow-md ${status_styles[m.status]}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[16px] font-black">{m.name}</span>
              <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">{m.seats}p</span>
            </div>
            <p className="text-[10px] uppercase tracking-wider font-bold opacity-80">{labels[m.status]}</p>
            {m.status === 'ocupada' && (
              <>
                <p className="text-[18px] font-black text-[#b3001e] tabular-nums mt-2">{RD(m.tab)}</p>
                <p className="text-[10px] text-slate-500 mt-1">{m.mesero} · {m.minutes} min</p>
              </>
            )}
            {m.status === 'cuenta' && (
              <>
                <p className="text-[18px] font-black text-amber-700 tabular-nums mt-2">{RD(m.tab)}</p>
                <p className="text-[10px] text-amber-600 mt-1">{m.mesero} · pidio cuenta</p>
              </>
            )}
            {m.status === 'reservada' && (
              <p className="text-[10px] text-sky-700 mt-2">{m.reserva}</p>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

function MenuView() {
  const [cat, setCat] = useState('principal')
  const items = MENU[cat] || []
  return (
    <div className="p-4">
      <PageHeader title="Menu" sub={`${Object.values(MENU).flat().length} platos en ${MENU_CATS.length} categorias`}
        right={<button className="bg-[#b3001e] text-white text-[12px] font-bold px-4 py-2 rounded-lg">+ Plato</button>}
      />
      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
        {MENU_CATS.map(c => (
          <button key={c.id} onClick={() => setCat(c.id)}
            className={`shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-semibold ${cat === c.id ? 'bg-[#b3001e] text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>{c.label}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {items.map(p => (
          <div key={p.id} className="bg-white rounded-2xl border border-slate-200 p-4 hover:border-[#b3001e] transition-colors">
            <p className="text-[14px] font-bold text-slate-800 leading-tight">{p.name}</p>
            <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-wider flex items-center gap-1"><Clock size={9} /> {p.sub}</p>
            <p className="text-[24px] font-black text-[#b3001e] mt-3 tabular-nums">{RD(p.price)}</p>
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
              <span className="text-[10px] text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">En stock</span>
              <button className="text-[11px] text-slate-400 hover:text-[#b3001e]">Editar</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function KdsView() {
  const cols = [
    { id: 'cola',      label: 'En cola',     style: 'bg-amber-50 border-amber-200',     pill: 'bg-amber-200 text-amber-900' },
    { id: 'cocinando', label: 'Cocinando',   style: 'bg-sky-50 border-sky-200',         pill: 'bg-sky-200 text-sky-900' },
    { id: 'listo',     label: 'Listo servir', style: 'bg-emerald-50 border-emerald-200', pill: 'bg-emerald-200 text-emerald-900' },
  ]
  return (
    <div className="p-4 h-full flex flex-col">
      <PageHeader title="Kitchen Display System (KDS)" sub={`${KDS_TICKETS.length} tickets activos · cocina en vivo`} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-1 min-h-0">
        {cols.map(col => {
          const tickets = KDS_TICKETS.filter(t => t.status === col.id)
          return (
            <div key={col.id} className="flex flex-col min-h-0">
              <div className={`px-4 py-2 rounded-t-xl border-b-2 ${col.style} flex items-center justify-between`}>
                <span className="text-[12px] font-bold">{col.label}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${col.pill}`}>{tickets.length}</span>
              </div>
              <div className={`flex-1 p-2 space-y-2 overflow-y-auto rounded-b-xl border-x border-b ${col.style}`}>
                {tickets.map(t => (
                  <div key={t.id} className="bg-white rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[12px] font-bold text-slate-800">{t.mesa}</span>
                      <span className="text-[10px] font-mono text-slate-400">{t.id}</span>
                    </div>
                    <ul className="space-y-1 mb-2">
                      {t.items.map((it, i) => <li key={i} className="text-[12px] text-slate-700">· {it}</li>)}
                    </ul>
                    <div className="flex items-center justify-between pt-2 border-t border-dashed border-slate-200">
                      <span className="text-[11px] text-slate-500 inline-flex items-center gap-1"><Clock size={10} /> {t.minutes} min</span>
                      <button className="text-[11px] font-bold text-[#b3001e] hover:underline">Avanzar</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const CLIENTS = [
  { id: 1, name: 'Familia Mendez',  rnc: '003-1111111-1', phone: '809-555-1010', visits: 24, loyalty: 'Oro', points: 480 },
  { id: 2, name: 'Empresa Tropical', rnc: '131-2222222-2', phone: '809-555-2020', visits: 56, loyalty: 'Oro', points: 1120 },
  { id: 3, name: 'Sra. Castillo',   rnc: '004-3333333-3', phone: '829-555-3030', visits: 12, loyalty: 'Plata', points: 240 },
]

export default {
  label: 'Restaurante',
  business: BUSINESS,
  navItems: NAV,
  defaultView: 'mesas',
  render: (view, ctx) => {
    const tiles = [
      { label: 'Ventas hoy',  value: RD(TODAY.ventasTotal), sub: `${TODAY.ticketsCount} tickets` },
      { label: 'Mesas servidas', value: TODAY.mesas_servidas, sub: 'rotacion 1.4x' },
      { label: 'Promedio mesa', value: RD(TODAY.ticket_promedio) },
      { label: 'Propinas (10%)', value: RD(TODAY.propinas), sub: 'Ley 16-92' },
      { label: 'Efectivo', value: RD(TODAY.ventasCash) },
      { label: 'Tarjeta', value: RD(TODAY.ventasTarjeta) },
      { label: 'Transferencia', value: RD(TODAY.ventasTransfer) },
      { label: 'e-CF emitidos', value: TODAY.ecf_emitidos },
    ]
    if (view === 'mesas')   return <MesasDemo />
    if (view === 'menu')    return <MenuBuilderDemo />
    if (view === 'inv')     return <InventoryDemo />
    if (view === 'kds')     return <KDSDemo />
    if (view === 'reports') return <ReportesDemo transactions={toReportesTxSeed({ today: TODAY, clients: CLIENTS, items: Object.values(MENU).flat() })} />
    if (view === 'cuadre')  return <CashReconciliationDemo ventasCash={TODAY.ventasCash} ticketsCount={TODAY.ticketsCount} />
    if (view === 'dgii')    return <DGIIDemo ecfTodayCount={TODAY.ecf_emitidos} />
    if (view === 'empl')   return <EmpleadosDemo vertical="restaurant" />
    if (view === 'config') return <ConfigDemo vertical="restaurant" business={BUSINESS} />
    return <SoonView title={NAV.find(n => n.id === view)?.label} desc="Disponible en el sistema completo." navigate={ctx.navigate} />
  },
}
