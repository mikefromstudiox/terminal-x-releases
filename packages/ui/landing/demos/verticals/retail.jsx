// Retail / tienda demo. Generic products POS + barcode/SKU search.
import { ShoppingCart, Users, BarChart3, Package, FileText, Settings, UserCheck, PiggyBank, Crown, Truck } from 'lucide-react'
import { GenericPosView, SoonView, PageHeader, RD } from '../_shared'
import CashReconciliationDemo from '../screens/CashReconciliationDemo'
import EmpleadosDemo from '../screens/EmpleadosDemo'
import ConfigDemo    from '../screens/ConfigDemo'
import ReportesDemo from '../screens/ReportesDemo'
import DGIIDemo     from '../screens/DGIIDemo'
import ClientsDemo        from '../screens/ClientsDemo'
import InventoryDemo      from '../screens/InventoryDemo'
import InventoryCountDemo from '../screens/InventoryCountDemo'
import { toClientsDemoShape, toReportesTxSeed } from '../screens/_adapters'

const BUSINESS = { name: 'Tienda La Esquina', rnc: '131-22334-5', user: { name: 'Carmen Diaz', role: 'cashier' } }

const CATEGORIES = [
  { id: 'alimentos',  label: 'Alimentos' },
  { id: 'bebidas',    label: 'Bebidas' },
  { id: 'limpieza',   label: 'Limpieza' },
  { id: 'higiene',    label: 'Higiene' },
  { id: 'snacks',     label: 'Snacks' },
]
const PRODUCTS = {
  alimentos: [
    { id: 1,  name: 'Arroz 5 lb',          price: 350,  sub: 'SKU 001' },
    { id: 2,  name: 'Habichuelas 1 lb',    price: 95,   sub: 'SKU 002' },
    { id: 3,  name: 'Aceite Girasol 1L',   price: 285,  sub: 'SKU 003' },
    { id: 4,  name: 'Azucar 5 lb',         price: 220,  sub: 'SKU 004' },
    { id: 5,  name: 'Sal de Mesa 1 lb',    price: 45,   sub: 'SKU 005' },
    { id: 6,  name: 'Pasta Espagueti',     price: 75,   sub: 'SKU 006' },
    { id: 7,  name: 'Salsa Tomate',        price: 65,   sub: 'SKU 007' },
    { id: 8,  name: 'Mantequilla 1 lb',    price: 240,  sub: 'SKU 008' },
  ],
  bebidas: [
    { id: 20, name: 'Agua 5 galones',      price: 65,   sub: 'SKU 020' },
    { id: 21, name: 'Coca Cola 2L',        price: 130,  sub: 'SKU 021' },
    { id: 22, name: 'Jugo Manzana',        price: 95,   sub: 'SKU 022' },
    { id: 23, name: 'Leche 1L',            price: 110,  sub: 'SKU 023' },
    { id: 24, name: 'Cafe Santo Domingo',  price: 350,  sub: 'SKU 024' },
  ],
  limpieza: [
    { id: 30, name: 'Detergente 1 kg',     price: 175,  sub: 'SKU 030' },
    { id: 31, name: 'Cloro 1 galon',       price: 95,   sub: 'SKU 031' },
    { id: 32, name: 'Suavizante 1L',       price: 145,  sub: 'SKU 032' },
    { id: 33, name: 'Jabon Lavar Trastes', price: 85,   sub: 'SKU 033' },
  ],
  higiene: [
    { id: 40, name: 'Papel Higienico 4u',  price: 165,  sub: 'SKU 040' },
    { id: 41, name: 'Pasta Dental',        price: 95,   sub: 'SKU 041' },
    { id: 42, name: 'Jabon de Bano',       price: 55,   sub: 'SKU 042' },
    { id: 43, name: 'Champu 400ml',        price: 230,  sub: 'SKU 043' },
  ],
  snacks: [
    { id: 50, name: 'Galletas Coco',       price: 45,   sub: 'SKU 050' },
    { id: 51, name: 'Mani Salado 100g',    price: 35,   sub: 'SKU 051' },
    { id: 52, name: 'Chocolate Tableta',   price: 55,   sub: 'SKU 052' },
    { id: 53, name: 'Chicles Adams',       price: 25,   sub: 'SKU 053' },
  ],
}
const CLIENTS = [
  { id: 1, name: 'Familia Castillo',     rnc: '001-1111111-1', phone: '809-555-1010', visits: 48, loyalty: 'Oro',    points: 960 },
  { id: 2, name: 'Pension Dona Maria',   rnc: '002-2222222-2', phone: '829-555-2020', visits: 32, loyalty: 'Plata',  points: 640 },
  { id: 3, name: 'Comedor La Bendicion', rnc: '131-3333333-3', phone: '809-555-3030', visits: 86, loyalty: 'Oro',    points: 1720 },
  { id: 4, name: 'Sra. Reyes',           rnc: '003-4444444-4', phone: '849-555-4040', visits: 12, loyalty: 'Bronce', points: 240 },
]
const TODAY = { ventasTotal: 24580, ventasCash: 14200, ventasTarjeta: 7200, ventasTransfer: 3180, ticketsCount: 89, promedioTicket: 276, itbisTotal: 3750, ecf_emitidos: 12, productos_vendidos: 247 }

const NAV = [
  { id: 'pos',     icon: ShoppingCart,  label: 'POS' },
  { id: 'inv',     icon: Package,       label: 'Inventario' },
  { id: 'count',   icon: Package,       label: 'Conteo Fisico' },
  { id: 'clients', icon: Users,         label: 'Clientes' },
  { id: 'memb',    icon: Crown,         label: 'Membresias' },
  { id: 'reports', icon: BarChart3,     label: 'Reportes' },
  { id: 'cuadre',  icon: PiggyBank,     label: 'Cuadre Caja' },
  { id: 'empl',    icon: UserCheck,     label: 'Empleados' },
  { id: 'dgii',    icon: FileText,      label: 'DGII / e-CF' },
  { id: 'config',  icon: Settings,      label: 'Configuracion' },
]

const INVENTORY = [
  { id: 1,  name: 'Arroz 5 lb',         stock: 124, low: 20, price: 350, supplier: 'Distribuidora RD' },
  { id: 2,  name: 'Aceite Girasol 1L',  stock: 8,   low: 12, price: 285, supplier: 'Mayorista Caribe' },
  { id: 3,  name: 'Coca Cola 2L',       stock: 67,  low: 15, price: 130, supplier: 'Bepensa' },
  { id: 4,  name: 'Detergente 1 kg',    stock: 4,   low: 10, price: 175, supplier: 'Hogar Plus' },
  { id: 5,  name: 'Papel Higienico 4u', stock: 89,  low: 20, price: 165, supplier: 'Hogar Plus' },
  { id: 6,  name: 'Mantequilla 1 lb',   stock: 22,  low: 8,  price: 240, supplier: 'Lacteos del Norte' },
]

function InventoryView() {
  return (
    <div className="p-4">
      <PageHeader title="Inventario" sub={`${INVENTORY.length} productos · ${INVENTORY.filter(i => i.stock <= i.low).length} bajo stock`}
        right={<div className="flex gap-2"><button className="bg-white border border-slate-200 text-[12px] font-bold px-3 py-2 rounded-lg">Importar CSV</button><button className="bg-[#b3001e] text-white text-[12px] font-bold px-4 py-2 rounded-lg">+ Producto</button></div>}
      />
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="text-left px-4 py-2.5 font-bold">Producto</th>
              <th className="text-right px-4 py-2.5 font-bold">Stock</th>
              <th className="text-right px-4 py-2.5 font-bold">Minimo</th>
              <th className="text-right px-4 py-2.5 font-bold">Precio</th>
              <th className="text-left px-4 py-2.5 font-bold">Proveedor</th>
              <th className="text-right px-4 py-2.5 font-bold">Estado</th>
            </tr>
          </thead>
          <tbody>
            {INVENTORY.map(i => {
              const low = i.stock <= i.low
              return (
                <tr key={i.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-semibold text-slate-800">{i.name}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-bold text-slate-800">{i.stock}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500">{i.low}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-[#b3001e] font-bold">{RD(i.price)}</td>
                  <td className="px-4 py-3 text-slate-600">{i.supplier}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${low ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>{low ? 'Bajo stock' : 'OK'}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default {
  label: 'Tienda',
  business: BUSINESS,
  navItems: NAV,
  defaultView: 'pos',
  render: (view, ctx) => {
    const tiles = [
      { label: 'Ventas hoy', value: RD(TODAY.ventasTotal), sub: `${TODAY.ticketsCount} tickets` },
      { label: 'Productos vendidos', value: TODAY.productos_vendidos, sub: 'unidades' },
      { label: 'Efectivo', value: RD(TODAY.ventasCash) },
      { label: 'Tarjeta', value: RD(TODAY.ventasTarjeta) },
      { label: 'Transferencia', value: RD(TODAY.ventasTransfer) },
      { label: 'ITBIS', value: RD(TODAY.itbisTotal), sub: '18%' },
      { label: 'Promedio ticket', value: RD(TODAY.promedioTicket) },
      { label: 'e-CF emitidos', value: TODAY.ecf_emitidos },
    ]
    if (view === 'pos')     return <GenericPosView business={BUSINESS} categories={CATEGORIES} getItems={(c) => PRODUCTS[c]} clients={CLIENTS} itemNoun="producto" />
    if (view === 'inv')     return <InventoryDemo />
    if (view === 'count')   return <InventoryCountDemo />
    if (view === 'clients') return <ClientsDemo clients={toClientsDemoShape(CLIENTS)} />
    if (view === 'reports') return <ReportesDemo transactions={toReportesTxSeed({ today: TODAY, clients: CLIENTS, items: Object.values(PRODUCTS).flat() })} />
    if (view === 'cuadre')  return <CashReconciliationDemo ventasCash={TODAY.ventasCash} ticketsCount={TODAY.ticketsCount} />
    if (view === 'dgii')    return <DGIIDemo ecfTodayCount={TODAY.ecf_emitidos} />
    if (view === 'empl')   return <EmpleadosDemo />
    if (view === 'config') return <ConfigDemo />
    return <SoonView title={NAV.find(n => n.id === view)?.label} desc="Disponible en el sistema completo." navigate={ctx.navigate} />
  },
}
