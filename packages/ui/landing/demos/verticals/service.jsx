// Generic services vertical (consultoria, taller pequeno, freelance services).
import { ShoppingCart, Users, BarChart3, FileText, Settings, UserCheck, PiggyBank, Briefcase, ClipboardList, Calendar } from 'lucide-react'
import { GenericPosView, SoonView, PageHeader, RD } from '../_shared'
import CashReconciliationDemo from '../screens/CashReconciliationDemo'
import EmpleadosDemo from '../screens/EmpleadosDemo'
import ConfigDemo    from '../screens/ConfigDemo'
import ReportesDemo from '../screens/ReportesDemo'
import DGIIDemo     from '../screens/DGIIDemo'
import ClientsDemo  from '../screens/ClientsDemo'
import { toClientsDemoShape, toReportesTxSeed } from '../screens/_adapters'

const BUSINESS = { name: 'Servicios Profesionales SRL', rnc: '131-55667-8', user: { name: 'Andres Rivas', role: 'owner' } }

const CATEGORIES = [
  { id: 'consultoria', label: 'Consultoria' },
  { id: 'mantto',      label: 'Mantenimiento' },
  { id: 'reparac',     label: 'Reparaciones' },
  { id: 'extras',      label: 'Extras' },
]
const SERVICES = {
  consultoria: [
    { id: 1, name: 'Hora de Consultoria',   price: 2500, sub: 'por hora' },
    { id: 2, name: 'Diagnostico Inicial',   price: 1500, sub: 'una vez' },
    { id: 3, name: 'Reporte Tecnico',       price: 1200, sub: 'por informe' },
  ],
  mantto: [
    { id: 10, name: 'Mantenimiento Mensual',  price: 4500, sub: 'plan basico' },
    { id: 11, name: 'Mantenimiento Premium',  price: 8500, sub: 'plan avanzado' },
    { id: 12, name: 'Visita Tecnica',         price: 1800, sub: 'por visita' },
  ],
  reparac: [
    { id: 20, name: 'Reparacion Menor',       price: 800,  sub: 'por hora' },
    { id: 21, name: 'Reparacion Mayor',       price: 2500, sub: 'cotizada' },
    { id: 22, name: 'Servicio de Emergencia', price: 3500, sub: '24h' },
  ],
  extras: [
    { id: 30, name: 'Material y Repuestos',   price: 0,    sub: 'cotizado' },
    { id: 31, name: 'Transporte',             price: 500,  sub: 'por viaje' },
  ],
}
const CLIENTS = [
  { id: 1, name: 'Empresa ABC SRL',  rnc: '131-1111111-1', phone: '809-555-1010', visits: 24, loyalty: 'Oro',    points: 480 },
  { id: 2, name: 'Maria Sanchez',    rnc: '002-2222222-2', phone: '829-555-2020', visits: 8,  loyalty: 'Bronce', points: 160 },
  { id: 3, name: 'Hotel Atlantico',  rnc: '131-3333333-3', phone: '809-555-3030', visits: 56, loyalty: 'Oro',    points: 1120 },
]
const TODAY = { ventasTotal: 28500, ticketsCount: 8, promedioTicket: 3563, ecf_emitidos: 8, itbisTotal: 4348, ventasCash: 4500, ventasTarjeta: 12000, ventasTransfer: 12000 }

const NAV = [
  { id: 'pos',     icon: ShoppingCart,  label: 'POS' },
  { id: 'agenda',  icon: Calendar,      label: 'Agenda' },
  { id: 'clients', icon: Users,         label: 'Clientes' },
  { id: 'reports', icon: BarChart3,     label: 'Reportes' },
  { id: 'cuadre',  icon: PiggyBank,     label: 'Cuadre Caja' },
  { id: 'empl',    icon: UserCheck,     label: 'Empleados' },
  { id: 'dgii',    icon: FileText,      label: 'DGII / e-CF' },
  { id: 'config',  icon: Settings,      label: 'Configuracion' },
]

export default {
  label: 'Servicios',
  business: BUSINESS,
  navItems: NAV,
  defaultView: 'pos',
  render: (view, ctx) => {
    const tiles = [
      { label: 'Ventas hoy', value: RD(TODAY.ventasTotal), sub: `${TODAY.ticketsCount} servicios` },
      { label: 'Promedio servicio', value: RD(TODAY.promedioTicket), accent: true },
      { label: 'Efectivo', value: RD(TODAY.ventasCash) },
      { label: 'Tarjeta', value: RD(TODAY.ventasTarjeta) },
      { label: 'Transferencia', value: RD(TODAY.ventasTransfer) },
      { label: 'ITBIS', value: RD(TODAY.itbisTotal) },
      { label: 'Citas mes', value: 47, sub: '12 esta semana' },
      { label: 'e-CF emitidos', value: TODAY.ecf_emitidos },
    ]
    if (view === 'pos')     return <GenericPosView business={BUSINESS} categories={CATEGORIES} getItems={(c) => SERVICES[c]} clients={CLIENTS} itemNoun="servicio" />
    if (view === 'clients') return <ClientsDemo clients={toClientsDemoShape(CLIENTS)} />
    if (view === 'reports') return <ReportesDemo transactions={toReportesTxSeed({ today: TODAY, clients: CLIENTS, items: Object.values(SERVICES).flat() })} />
    if (view === 'cuadre')  return <CashReconciliationDemo ventasCash={TODAY.ventasCash} ticketsCount={TODAY.ticketsCount} />
    if (view === 'dgii')    return <DGIIDemo ecfTodayCount={TODAY.ecf_emitidos} />
    if (view === 'empl')   return <EmpleadosDemo vertical="service" />
    if (view === 'config') return <ConfigDemo vertical="service" business={BUSINESS} />
    return <SoonView title={NAV.find(n => n.id === view)?.label} desc="Disponible en el sistema completo." navigate={ctx.navigate} />
  },
}
