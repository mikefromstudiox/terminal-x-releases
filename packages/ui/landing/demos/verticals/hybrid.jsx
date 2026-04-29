// Hybrid demo. Combines Restaurant (mesas + menu) + Retail (POS) so an owner
// running a colmado-restaurant or food truck-with-tienda can do both from
// one app. Uses both restaurant.mesas and retail-style POS.
import { useState } from 'react'
import { ShoppingCart, Users, BarChart3, Package, FileText, Settings, UserCheck, PiggyBank, UtensilsCrossed, Grid3x3, ChefHat, LayoutGrid } from 'lucide-react'
import { GenericPosView, SoonView, PageHeader, RD } from '../_shared'
import CashReconciliationDemo from '../screens/CashReconciliationDemo'
import EmpleadosDemo from '../screens/EmpleadosDemo'
import ConfigDemo    from '../screens/ConfigDemo'
import ReportesDemo from '../screens/ReportesDemo'
import DGIIDemo     from '../screens/DGIIDemo'
import ClientsDemo  from '../screens/ClientsDemo'
import MesasDemo     from '../screens/MesasDemo'
import InventoryDemo from '../screens/InventoryDemo'
import { toClientsDemoShape, toReportesTxSeed } from '../screens/_adapters'

const BUSINESS = { name: 'Colmado-Restaurant Tropical', rnc: '131-13344-5', user: { name: 'Cesar Diaz', role: 'manager' } }

const RETAIL_CATS = [
  { id: 'snacks',  label: 'Snacks' },
  { id: 'bebidas', label: 'Bebidas' },
  { id: 'cigarros', label: 'Cigarros' },
]
const RETAIL_PRODUCTS = {
  snacks: [
    { id: 1, name: 'Chicharrones',    price: 65,  sub: 'paquete' },
    { id: 2, name: 'Galletas Coco',   price: 45,  sub: 'paquete' },
    { id: 3, name: 'Mani Salado',     price: 35,  sub: '100g' },
  ],
  bebidas: [
    { id: 10, name: 'Coca Cola 12oz', price: 65,  sub: 'lata' },
    { id: 11, name: 'Cerveza Presidente', price: 165, sub: '12oz' },
    { id: 12, name: 'Agua 500ml',     price: 45,  sub: '' },
    { id: 13, name: 'Red Bull',       price: 195, sub: '250ml' },
  ],
  cigarros: [
    { id: 20, name: 'Marlboro Box',   price: 280, sub: 'caja' },
    { id: 21, name: 'Cigarrillos por unidad', price: 25, sub: '' },
  ],
}
const MESAS = [
  { id: 1, name: 'Mesa 1', seats: 4, status: 'libre',   tab: 0 },
  { id: 2, name: 'Mesa 2', seats: 4, status: 'ocupada', tab: 1850, mesero: 'Carlos', minutes: 32 },
  { id: 3, name: 'Mesa 3', seats: 6, status: 'ocupada', tab: 4250, mesero: 'Maria',  minutes: 18 },
  { id: 4, name: 'Mesa 4', seats: 2, status: 'libre',   tab: 0 },
  { id: 5, name: 'Bar 1',  seats: 2, status: 'ocupada', tab: 480,  mesero: 'Bar',    minutes: 14 },
  { id: 6, name: 'Bar 2',  seats: 2, status: 'libre',   tab: 0 },
]
const CLIENTS = [
  { id: 1, name: 'Familia Castillo', rnc: '001-1111111-1', phone: '809-555-1010', visits: 36, loyalty: 'Oro' },
  { id: 2, name: 'Empresa Tropical', rnc: '131-2222222-2', phone: '809-555-2020', visits: 18, loyalty: 'Plata' },
]
const TODAY = { ventasTotal: 64280, ventasCash: 18200, ventasTarjeta: 28200, ventasTransfer: 17880, ticketsCount: 78, ecf_emitidos: 24, ventas_restaurant: 41200, ventas_colmado: 23080 }

const NAV = [
  { id: 'switcher', icon: LayoutGrid,    label: 'Restaurante / Colmado' },
  { id: 'mesas',    icon: Grid3x3,       label: 'Mesas' },
  { id: 'pos',      icon: ShoppingCart,  label: 'POS Colmado' },
  { id: 'menu',     icon: UtensilsCrossed, label: 'Menu' },
  { id: 'kds',      icon: ChefHat,       label: 'Cocina KDS' },
  { id: 'inv',      icon: Package,       label: 'Inventario' },
  { id: 'clients',  icon: Users,         label: 'Clientes' },
  { id: 'reports',  icon: BarChart3,     label: 'Reportes' },
  { id: 'cuadre',   icon: PiggyBank,     label: 'Cuadre' },
  { id: 'empl',     icon: UserCheck,     label: 'Empleados' },
  { id: 'dgii',     icon: FileText,      label: 'DGII / e-CF' },
  { id: 'config',   icon: Settings,      label: 'Configuracion' },
]

function SwitcherView({ setView }) {
  return (
    <div className="p-8">
      <PageHeader title="Hibrido · escoge donde trabajar" sub="Tu negocio combina restaurante + colmado · cambia entre los dos en cualquier momento" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-3xl">
        <button onClick={() => setView('mesas')} className="bg-white rounded-2xl border-2 border-slate-200 hover:border-[#b3001e] p-8 text-left transition-all hover:shadow-lg group">
          <div className="w-14 h-14 rounded-2xl bg-[#b3001e]/10 flex items-center justify-center mb-4">
            <Grid3x3 size={26} className="text-[#b3001e]" />
          </div>
          <h3 className="text-[20px] font-black text-slate-900">Modo Restaurante</h3>
          <p className="text-[13px] text-slate-600 mt-2 leading-relaxed">Mesas, menu, KDS, propinas, mesero por mesa, salir y volver a la cuenta.</p>
          <p className="text-[11px] text-[#b3001e] font-bold mt-3 uppercase tracking-wider">Hoy: {RD(TODAY.ventas_restaurant)}</p>
        </button>
        <button onClick={() => setView('pos')} className="bg-white rounded-2xl border-2 border-slate-200 hover:border-[#b3001e] p-8 text-left transition-all hover:shadow-lg group">
          <div className="w-14 h-14 rounded-2xl bg-[#b3001e]/10 flex items-center justify-center mb-4">
            <ShoppingCart size={26} className="text-[#b3001e]" />
          </div>
          <h3 className="text-[20px] font-black text-slate-900">Modo Colmado</h3>
          <p className="text-[13px] text-slate-600 mt-2 leading-relaxed">POS rapido para snacks, bebidas, cigarros, productos del mostrador.</p>
          <p className="text-[11px] text-[#b3001e] font-bold mt-3 uppercase tracking-wider">Hoy: {RD(TODAY.ventas_colmado)}</p>
        </button>
      </div>
    </div>
  )
}

function MesasView() {
  const status_styles = {
    libre:   'bg-white border-slate-200 text-slate-500',
    ocupada: 'bg-emerald-50 border-emerald-300 text-emerald-800',
  }
  return (
    <div className="p-4">
      <PageHeader title="Mesas" sub={`${MESAS.filter(m => m.status === 'ocupada').length} ocupadas · ${MESAS.filter(m => m.status === 'libre').length} libres`} />
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        {MESAS.map(m => (
          <div key={m.id} className={`rounded-2xl border-2 p-4 text-left ${status_styles[m.status]}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[16px] font-black">{m.name}</span>
              <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">{m.seats}p</span>
            </div>
            <p className="text-[10px] uppercase tracking-wider font-bold opacity-80">{m.status === 'libre' ? 'Libre' : 'Ocupada'}</p>
            {m.status === 'ocupada' && (
              <>
                <p className="text-[18px] font-black text-[#b3001e] tabular-nums mt-2">{RD(m.tab)}</p>
                <p className="text-[10px] text-slate-500 mt-1">{m.mesero} · {m.minutes} min</p>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default {
  label: 'Hibrido (Restaurante + Colmado)',
  business: BUSINESS,
  navItems: NAV,
  defaultView: 'switcher',
  render: (view, ctx) => {
    const tiles = [
      { label: 'Ventas hoy total', value: RD(TODAY.ventasTotal), sub: `${TODAY.ticketsCount} tickets` },
      { label: 'Ventas restaurante', value: RD(TODAY.ventas_restaurant), accent: true },
      { label: 'Ventas colmado',     value: RD(TODAY.ventas_colmado),    accent: true },
      { label: 'Efectivo',     value: RD(TODAY.ventasCash) },
      { label: 'Tarjeta',      value: RD(TODAY.ventasTarjeta) },
      { label: 'Transferencia', value: RD(TODAY.ventasTransfer) },
      { label: 'Mesas activas', value: `${MESAS.filter(m => m.status === 'ocupada').length}/${MESAS.length}` },
      { label: 'e-CF emitidos', value: TODAY.ecf_emitidos },
    ]
    if (view === 'switcher') return <SwitcherView setView={ctx.setView} />
    if (view === 'mesas')    return <MesasDemo />
    if (view === 'inv')      return <InventoryDemo />
    if (view === 'pos')      return <GenericPosView business={BUSINESS} categories={RETAIL_CATS} getItems={(c) => RETAIL_PRODUCTS[c]} clients={CLIENTS} itemNoun="producto" />
    if (view === 'clients')  return <ClientsDemo clients={toClientsDemoShape(CLIENTS)} />
    if (view === 'reports')  return <ReportesDemo transactions={toReportesTxSeed({ today: TODAY, clients: CLIENTS, items: Object.values(RETAIL_PRODUCTS).flat() })} />
    if (view === 'cuadre')   return <CashReconciliationDemo ventasCash={TODAY.ventasCash} ticketsCount={TODAY.ticketsCount} />
    if (view === 'dgii')     return <DGIIDemo ecfTodayCount={TODAY.ecf_emitidos} />
    if (view === 'empl')   return <EmpleadosDemo />
    if (view === 'config') return <ConfigDemo />
    return <SoonView title={NAV.find(n => n.id === view)?.label} desc="Disponible en el sistema completo." navigate={ctx.navigate} />
  },
}
