// Licoreria demo. Generic POS + age verification + bottle deposit + brand suggestions.
import { useState } from 'react'
import { ShoppingCart, Users, BarChart3, Package, FileText, Settings, UserCheck, PiggyBank, Crown, Wine, Shield, AlertCircle } from 'lucide-react'
import { GenericPosView, SoonView, PageHeader, RD } from '../_shared'
import CashReconciliationDemo from '../screens/CashReconciliationDemo'
import EmpleadosDemo from '../screens/EmpleadosDemo'
import ConfigDemo    from '../screens/ConfigDemo'
import ReportesDemo from '../screens/ReportesDemo'
import DGIIDemo     from '../screens/DGIIDemo'
import ClientsDemo   from '../screens/ClientsDemo'
import InventoryDemo from '../screens/InventoryDemo'
import { toClientsDemoShape, toReportesTxSeed } from '../screens/_adapters'

const BUSINESS = { name: 'Ranoza Liquor Store', rnc: '132-13168-1', user: { name: 'Pablo Nunez', role: 'cashier' } }

const CATEGORIES = [
  { id: 'whisky',   label: 'Whisky' },
  { id: 'ron',      label: 'Ron' },
  { id: 'vodka',    label: 'Vodka' },
  { id: 'cerveza',  label: 'Cerveza' },
  { id: 'vino',     label: 'Vino' },
  { id: 'snacks',   label: 'Snacks' },
]
const PRODUCTS = {
  whisky: [
    { id: 1,  name: 'Buchanans 12 anos 750ml', price: 2850, sub: 'SKU 101' },
    { id: 2,  name: 'Johnnie Walker Black 750', price: 2400, sub: 'SKU 102' },
    { id: 3,  name: 'Old Parr 12 anos 750ml',   price: 2650, sub: 'SKU 103' },
    { id: 4,  name: 'Chivas Regal 12 750ml',    price: 2300, sub: 'SKU 104' },
  ],
  ron: [
    { id: 10, name: 'Brugal Anejo 750ml',       price: 950,  sub: 'SKU 201' },
    { id: 11, name: 'Brugal Extra Viejo 750ml', price: 1450, sub: 'SKU 202' },
    { id: 12, name: 'Barcelo Anejo 750ml',      price: 1100, sub: 'SKU 203' },
    { id: 13, name: 'Bermudez Anejo 750ml',     price: 1050, sub: 'SKU 204' },
    { id: 14, name: 'Brugal Blanco 750ml',      price: 850,  sub: 'SKU 205' },
  ],
  vodka: [
    { id: 20, name: 'Absolut Vodka 750ml',      price: 1850, sub: 'SKU 301' },
    { id: 21, name: 'Smirnoff Red 750ml',       price: 1100, sub: 'SKU 302' },
    { id: 22, name: 'Grey Goose 750ml',         price: 4200, sub: 'SKU 303' },
  ],
  cerveza: [
    { id: 30, name: 'Presidente 12oz x6',       price: 380,  sub: 'SKU 401' },
    { id: 31, name: 'Presidente Light x6',      price: 380,  sub: 'SKU 402' },
    { id: 32, name: 'Corona Extra x6',          price: 720,  sub: 'SKU 403' },
    { id: 33, name: 'Heineken x6',              price: 820,  sub: 'SKU 404' },
    { id: 34, name: 'Modelo Especial x6',       price: 880,  sub: 'SKU 405' },
  ],
  vino: [
    { id: 40, name: 'Concha y Toro Tinto',      price: 950,  sub: 'SKU 501' },
    { id: 41, name: 'Casillero del Diablo',     price: 1450, sub: 'SKU 502' },
    { id: 42, name: 'Trapiche Malbec',          price: 1250, sub: 'SKU 503' },
  ],
  snacks: [
    { id: 50, name: 'Lays Papitas 100g',        price: 95,   sub: 'SKU 601' },
    { id: 51, name: 'Mani Salado 100g',         price: 65,   sub: 'SKU 602' },
    { id: 52, name: 'Cigarros Marlboro',        price: 280,  sub: 'SKU 603' },
  ],
}
const CLIENTS = [
  { id: 1, name: 'Cliente Frecuente A',  rnc: '001-1111111-1', phone: '809-555-1010', visits: 56, loyalty: 'Oro',    points: 1120 },
  { id: 2, name: 'Restaurant La Casona', rnc: '131-2222222-2', phone: '809-555-2020', visits: 88, loyalty: 'Oro',    points: 1760 },
  { id: 3, name: 'Bar El Chico',         rnc: '131-3333333-3', phone: '829-555-3030', visits: 34, loyalty: 'Plata',  points: 680 },
]
const TODAY = { ventasTotal: 42180, ventasCash: 18200, ventasTarjeta: 18900, ventasTransfer: 5080, ticketsCount: 67, promedioTicket: 629, itbisTotal: 6435, ecf_emitidos: 24 }

function AgeBanner() {
  return (
    <div className="mx-3 mt-3 flex items-start gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
      <Shield size={16} className="text-amber-600 mt-0.5 shrink-0" />
      <div className="flex-1 text-[12px] text-amber-900 leading-relaxed">
        <strong>Verificacion de edad activa.</strong> Cobrar requiere confirmar que el cliente tiene 18+. Modal aparece automatico antes de cerrar el ticket.
      </div>
    </div>
  )
}

const NAV = [
  { id: 'pos',     icon: ShoppingCart,  label: 'POS' },
  { id: 'inv',     icon: Package,       label: 'Inventario' },
  { id: 'clients', icon: Users,         label: 'Clientes' },
  { id: 'reports', icon: BarChart3,     label: 'Reportes' },
  { id: 'cuadre',  icon: PiggyBank,     label: 'Cuadre Caja' },
  { id: 'empl',    icon: UserCheck,     label: 'Empleados' },
  { id: 'dgii',    icon: FileText,      label: 'DGII / e-CF' },
  { id: 'config',  icon: Settings,      label: 'Configuracion' },
]

export default {
  label: 'Licoreria',
  business: BUSINESS,
  navItems: NAV,
  defaultView: 'pos',
  render: (view, ctx) => {
    const tiles = [
      { label: 'Ventas hoy', value: RD(TODAY.ventasTotal), sub: `${TODAY.ticketsCount} tickets` },
      { label: 'Promedio ticket', value: RD(TODAY.promedioTicket), accent: true },
      { label: 'Efectivo', value: RD(TODAY.ventasCash) },
      { label: 'Tarjeta', value: RD(TODAY.ventasTarjeta) },
      { label: 'Transferencia', value: RD(TODAY.ventasTransfer) },
      { label: 'ITBIS', value: RD(TODAY.itbisTotal) },
      { label: 'e-CF emitidos', value: TODAY.ecf_emitidos },
      { label: 'Marca top hoy', value: 'Brugal', sub: '14 botellas vendidas' },
    ]
    if (view === 'pos') return (
      <div className="flex flex-col h-full">
        <AgeBanner />
        <div className="flex-1 min-h-0">
          <GenericPosView business={BUSINESS} categories={CATEGORIES} getItems={(c) => PRODUCTS[c]} clients={CLIENTS} itemNoun="producto" />
        </div>
      </div>
    )
    if (view === 'inv')     return <InventoryDemo />
    if (view === 'clients') return <ClientsDemo clients={toClientsDemoShape(CLIENTS)} />
    if (view === 'reports') return <ReportesDemo transactions={toReportesTxSeed({ today: TODAY, clients: CLIENTS, items: Object.values(PRODUCTS).flat() })} />
    if (view === 'cuadre')  return <CashReconciliationDemo ventasCash={TODAY.ventasCash} ticketsCount={TODAY.ticketsCount} />
    if (view === 'dgii')    return <DGIIDemo ecfTodayCount={TODAY.ecf_emitidos} />
    if (view === 'empl')   return <EmpleadosDemo />
    if (view === 'config') return <ConfigDemo />
    return <SoonView title={NAV.find(n => n.id === view)?.label} desc="Disponible en el sistema completo." navigate={ctx.navigate} />
  },
}
