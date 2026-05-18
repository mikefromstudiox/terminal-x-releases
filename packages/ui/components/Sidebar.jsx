import { NavLink, useLocation } from 'react-router-dom'
import logoImg from '../assets/logo.webp'
import xMark from '../assets/x-mark.webp'
import { useState, useEffect } from 'react'
import { useAPI } from '../context/DataContext'
import {
  ShoppingCart, ClipboardList, Users, CreditCard,
  Landmark, FileText, Settings, Package,
  ChevronLeft, ChevronRight, ChevronDown, LogOut, Globe,
  Cloud, CloudOff, RefreshCw, Sun, Moon, Monitor,
  BarChart3, Menu, X, Lock, PiggyBank, FileMinus,
  Building2, UserCheck, Coffee, KeyRound, LayoutGrid,
  Printer, MessageSquare, HardDrive, Download,
  Archive, LifeBuoy, Send, Loader2,
  Grid3x3, UtensilsCrossed, ChefHat,
  Wrench, Scissors, Car, Calendar, Warehouse, Banknote, Clock, Briefcase,
  Beef, Leaf, Truck, Tag, Shield, ShieldCheck,
  Inbox, BookOpen, FolderArchive,
  MapPin, Trash2,
} from 'lucide-react'
import { usePlan } from '../hooks/usePlan.jsx'
import { useLang } from '../i18n'
import { useAuth } from '../context/AuthContext'
import { useLayout } from '../context/LayoutContext'
import { useBackup } from '../context/BackupContext'
import { useLicense } from '../context/LicenseContext'
import LanguageToggle from './LanguageToggle'
// v2.16.2 (item #13) — surface dead-letter WhatsApp reminders in the sidebar.
import { getQueueCounts, getFailedWhatsappReminders, retryAllFailedWhatsappReminders } from '../../services/offline-queue.js'
import { useBusinessType } from '../hooks/useBusinessType.jsx'

// ── Navigation structure ────────────────────────────────────────────────────

const NAV = [
  {
    id: 'pos', to: '/pos', icon: ShoppingCart,
    es: 'POS', en: 'POS',
    feature: 'pos',
  },
  {
    id: 'queue', to: '/queue', icon: ClipboardList,
    es: 'Cola', en: 'Queue',
    feature: 'queue',
    // Service-based businesses (carwash, generic service, hybrid) get a work queue.
    businessTypes: ['carwash', 'service', 'hybrid'],
  },
  {
    id: 'mesas', to: '/mesas', icon: Grid3x3,
    es: 'Mesas', en: 'Tables',
    businessTypes: ['restaurant', 'hybrid'],
    roles: ['owner','manager','cashier','waiter'],
  },
  {
    id: 'menu_builder', to: '/menu-builder', icon: UtensilsCrossed,
    es: 'Menu', en: 'Menu',
    businessTypes: ['restaurant', 'food_truck'],
    roles: ['owner','manager'],
  },
  {
    // Hybrid — unified Menú + Productos editor in one screen so owners
    // don't have to bounce between Menu and Inventario just to add an item.
    id: 'catalogo', to: '/catalogo', icon: UtensilsCrossed,
    es: 'Catálogo', en: 'Catalog',
    businessTypes: ['hybrid'],
    roles: ['owner','manager'],
  },
  {
    id: 'kds', to: '/kds', icon: ChefHat,
    es: 'Cocina (KDS)', en: 'Kitchen (KDS)',
    businessTypes: ['restaurant', 'food_truck', 'hybrid'],
    roles: ['owner','manager','cashier','waiter'],
  },
  // Food Truck — favorite stops + waste log. KDS + Menu reuse the restaurant
  // entries above (food_truck added to their businessTypes whitelist).
  {
    id: 'food_truck_pendientes', to: '/pendientes', icon: Clock,
    es: 'Pendientes', en: 'Pending',
    businessTypes: ['food_truck'],
    roles: ['owner','manager','cashier'],
    badgeKey: 'foodTruckPendientes',
  },
  {
    id: 'food_truck_locations', to: '/ubicaciones', icon: MapPin,
    es: 'Ubicaciones', en: 'Stops',
    feature: 'food_truck_locations',
    businessTypes: ['food_truck'],
    roles: ['owner','manager','cashier'],
  },
  {
    id: 'food_truck_waste', to: '/mermas', icon: Trash2,
    es: 'Mermas', en: 'Waste Log',
    feature: 'food_truck_waste_log',
    businessTypes: ['food_truck'],
    roles: ['owner','manager','cashier'],
  },
  // v2.16.3 — Restaurante H5: Resumen del Salón (manager-only).
  {
    id: 'restaurant_salon_dashboard', to: '/salon-dashboard', icon: BarChart3,
    es: 'Resumen Comedor', en: 'Dining Room',
    feature: 'restaurant_salon_dashboard',
    businessTypes: ['restaurant'],
    roles: ['owner','manager','cfo','accountant'],
  },
  // v2.16.3 — Restaurante H4: Reservas (front-of-house).
  {
    id: 'restaurant_reservations', to: '/reservas', icon: Calendar,
    es: 'Reservas', en: 'Reservations',
    feature: 'restaurant_reservations',
    businessTypes: ['restaurant'],
    roles: ['owner','manager','cashier','waiter'],
  },
  {
    id: 'mechanic_resumen', to: '/mecanica/resumen', icon: BarChart3,
    es: 'Resumen', en: 'Overview',
    feature: 'mechanic_dashboard',
    businessTypes: ['mechanic'],
    roles: ['owner','manager','cashier','accountant','cfo'],
  },
  {
    id: 'work_orders', to: '/work-orders', icon: Wrench,
    es: 'Órdenes', en: 'Work Orders',
    feature: 'work_orders',
    businessTypes: ['mechanic'],
    roles: ['owner','manager','cashier'],
  },
  {
    id: 'cotizaciones', to: '/cotizaciones', icon: FileText,
    es: 'Cotizaciones', en: 'Estimates',
    feature: 'work_orders',
    businessTypes: ['mechanic'],
    roles: ['owner','manager','cashier'],
  },
  {
    id: 'suministros', to: '/suministros', icon: Package,
    es: 'Suministros', en: 'Parts Orders',
    feature: 'parts_ordering',
    businessTypes: ['mechanic'],
    roles: ['owner','manager','cashier'],
  },
  {
    id: 'aseguradoras', to: '/aseguradoras', icon: Shield,
    es: 'Aseguradoras', en: 'Insurers',
    feature: 'insurance_batching',
    businessTypes: ['mechanic'],
    roles: ['owner','manager','cfo','accountant'],
  },
  {
    id: 'vehicles', to: '/vehicles', icon: Car,
    es: 'Vehículos', en: 'Vehicles',
    feature: 'vehicles',
    businessTypes: ['mechanic'],
    roles: ['owner','manager','cashier'],
  },
  {
    id: 'concesionario_resumen', to: '/concesionario', icon: Car,
    es: 'Resumen', en: 'Overview',
    feature: 'concesionario_resumen',
    businessTypes: ['dealership'],
    roles: ['owner','manager','cashier','accountant','cfo'],
  },
  {
    id: 'vehicle_inventory', to: '/vehicle-inventory', icon: Car,
    es: 'Vehículos', en: 'Vehicle Inventory',
    feature: 'vehicle_inventory',
    businessTypes: ['dealership'],
    roles: ['owner','manager','cashier'],
  },
  {
    id: 'deal_builder', to: '/deal-builder', icon: Car,
    es: 'Cierre de Venta', en: 'Deal Builder',
    feature: 'deal_builder',
    businessTypes: ['dealership'],
    roles: ['owner','manager','cashier'],
  },
  {
    id: 'sales_pipeline', to: '/sales-pipeline', icon: Car,
    es: 'Prospectos', en: 'Sales Pipeline',
    feature: 'sales_pipeline',
    businessTypes: ['dealership'],
    roles: ['owner','manager','cashier'],
  },
  {
    id: 'reservations', to: '/reservations', icon: Calendar,
    es: 'Reservas', en: 'Reservations',
    feature: 'reservations',
    businessTypes: ['dealership'],
    roles: ['owner','manager','cashier'],
  },
  {
    id: 'warranties', to: '/warranties', icon: ShieldCheck,
    es: 'Garantias', en: 'Warranties',
    feature: 'warranties',
    businessTypes: ['dealership'],
    roles: ['owner','manager','cashier'],
  },
  {
    id: 'preapprovals', to: '/preapprovals', icon: Banknote,
    es: 'Pre-aprobaciones', en: 'Pre-approvals',
    feature: 'preapprovals',
    businessTypes: ['dealership'],
    roles: ['owner','manager','cashier'],
  },
  {
    id: 'test_drives', to: '/test-drives', icon: Car,
    es: 'Pruebas de Manejo', en: 'Test Drives',
    feature: 'test_drives',
    businessTypes: ['dealership'],
    roles: ['owner','manager','cashier'],
  },
  {
    id: 'matriculas', to: '/matriculas', icon: FileText,
    es: 'Matriculas', en: 'Titles',
    feature: 'matriculas',
    businessTypes: ['dealership'],
    roles: ['owner','manager','cashier','accountant','cfo'],
  },
  {
    id: 'service_bays', to: '/service-bays', icon: Warehouse,
    es: 'Bahías', en: 'Service Bays',
    feature: 'service_bays',
    businessTypes: ['mechanic'],
    roles: ['owner','manager'],
  },
  {
    id: 'mechanic_productivity', to: '/mecanica/productividad', icon: BarChart3,
    es: 'Productividad', en: 'Productivity',
    feature: 'mechanic_productivity',
    businessTypes: ['mechanic'],
    roles: ['owner','manager','cfo','accountant'],
  },
  {
    // Salon-only dashboard. Sits at the top of the salon nav so it's the first
    // thing the cashier-stylist sees on login. Pro PLUS+.
    id: 'salon_resumen', to: '/resumen', icon: BarChart3,
    es: 'Resumen', en: 'Overview',
    feature: 'salon_dashboard',
    businessTypes: ['salon'],
    roles: ['owner','manager','cashier'],
  },
  {
    id: 'appointments', to: '/appointments', icon: Calendar,
    es: 'Citas', en: 'Appointments',
    feature: 'appointments',
    businessTypes: ['salon', 'mechanic'],
    roles: ['owner','manager','cashier'],
  },
  {
    // Salon memberships — separate top-level entry (NOT under the generic
    // Clients group) so it's discoverable for the cashier-stylist on Pro PLUS.
    id: 'salon_memberships', to: '/memberships', icon: Tag,
    es: 'Membresías', en: 'Memberships',
    feature: 'salon_memberships',
    businessTypes: ['salon'],
    roles: ['owner','manager','cashier'],
  },
  {
    id: 'stylist_schedules', to: '/stylist-schedules', icon: Clock,
    es: 'Horarios', en: 'Schedules',
    feature: 'appointments',
    businessTypes: ['salon'],
    roles: ['owner','manager'],
  },
  {
    id: 'salon_whatsapp_log', to: '/whatsapp-log', icon: MessageSquare,
    es: 'Recordatorios', en: 'Reminders',
    feature: 'salon_whatsapp_reminders',
    businessTypes: ['salon'],
    roles: ['owner','manager'],
  },
  {
    id: 'lending', icon: Banknote,
    es: 'Préstamos', en: 'Lending',
    feature: 'loans',
    businessTypes: ['loans'],
    roles: ['owner','manager','cfo','accountant'],
    children: [
      { to: '/loans', es: 'Préstamos', en: 'Loans', feature: 'loans' },
      { to: '/pawn-items', es: 'Empeños', en: 'Pawn Items', feature: 'pawn_items' },
      { to: '/collections', es: 'Cobros', en: 'Collections', feature: 'loans' },
      { to: '/lending/resumen', es: 'Resumen', en: 'Dashboard', feature: 'loans' },
      { to: '/lending/reporte-sb', es: 'Reporte SB', en: 'SB Report', feature: 'loans' },
    ],
  },
  {
    id: 'carniceria_cortes', to: '/carniceria/cortes', icon: Beef,
    es: 'Cortes', en: 'Cuts',
    businessTypes: ['meat_market'],
    roles: ['owner','manager','cashier'],
  },
  {
    id: 'carniceria_frescura', to: '/carniceria/frescura', icon: Leaf,
    es: 'Frescura', en: 'Freshness',
    businessTypes: ['meat_market'],
    roles: ['owner','manager','cashier'],
  },
  {
    id: 'carniceria_mayoreo', to: '/carniceria/mayoreo', icon: Truck,
    es: 'Mayoreo', en: 'Wholesale',
    businessTypes: ['meat_market'],
    roles: ['owner','manager','cashier'],
  },
  {
    id: 'carniceria_resumen', to: '/carniceria/resumen', icon: BarChart3,
    es: 'Resumen', en: 'Overview',
    businessTypes: ['meat_market'],
    roles: ['owner','manager','cfo','accountant'],
  },
  {
    id: 'service_hub', to: '/servicios', icon: Briefcase,
    es: 'Servicios', en: 'Services',
    businessTypes: ['service'],
    roles: ['owner','manager','cashier','cfo','accountant'],
  },
  {
    id: 'ctb_portfolio', to: '/contabilidad/portfolio', icon: LayoutGrid,
    es: 'Portfolio', en: 'Portfolio',
    businessTypes: ['accounting'], roles: ['owner','manager','cfo','accountant'],
    feature: 'contabilidad_portfolio',
  },
  {
    id: 'ctb_bandeja', to: '/contabilidad/bandeja', icon: Inbox,
    es: 'Bandeja', en: 'Inbox',
    businessTypes: ['accounting'], roles: ['owner','manager','cfo','accountant'],
    feature: 'contabilidad_inbox',
  },
  {
    id: 'ctb_cartera', to: '/contabilidad/cartera', icon: Building2,
    es: 'Cartera', en: 'Client Roster',
    businessTypes: ['accounting'], roles: ['owner','manager','cfo','accountant'],
    feature: 'contabilidad_inbox',
  },
  {
    id: 'ctb_calendario', to: '/contabilidad/calendario', icon: Calendar,
    es: 'Calendario Fiscal', en: 'Tax Calendar',
    businessTypes: ['accounting'], roles: ['owner','manager','cfo','accountant'],
    feature: 'contabilidad_inbox',
  },
  {
    id: 'ctb_tareas', to: '/contabilidad/tareas', icon: ClipboardList,
    es: 'Tareas', en: 'Tasks',
    businessTypes: ['accounting'], roles: ['owner','manager','cfo','accountant'],
    feature: 'contabilidad_tareas',
  },
  {
    id: 'ctb_comprobantes', to: '/contabilidad/comprobantes', icon: FileText,
    es: 'Comprobantes', en: 'Receipts',
    businessTypes: ['accounting'], roles: ['owner','manager','cfo','accountant'],
    feature: 'contabilidad_inbox',
  },
  {
    id: 'ctb_libro_mayor', to: '/contabilidad/libro_mayor', icon: BookOpen,
    es: 'Libro Mayor', en: 'General Ledger',
    businessTypes: ['accounting'], roles: ['owner','manager','cfo','accountant'],
    feature: 'contabilidad_libro_mayor',
  },
  {
    id: 'ctb_banco', to: '/contabilidad/banco', icon: Landmark,
    es: 'Banco', en: 'Bank',
    businessTypes: ['accounting'], roles: ['owner','manager','cfo','accountant'],
    feature: 'contabilidad_banco',
  },
  {
    id: 'ctb_nomina', to: '/contabilidad/nomina', icon: Users,
    es: 'Nómina', en: 'Payroll',
    businessTypes: ['accounting'], roles: ['owner','manager','cfo','accountant'],
    feature: 'contabilidad_nomina',
  },
  {
    id: 'ctb_activos', to: '/contabilidad/activos', icon: Package,
    es: 'Activos', en: 'Fixed Assets',
    businessTypes: ['accounting'], roles: ['owner','manager','cfo','accountant'],
    feature: 'contabilidad_activos',
  },
  {
    id: 'ctb_reportes', to: '/contabilidad/reportes', icon: BarChart3,
    es: 'Reportes', en: 'Reports',
    businessTypes: ['accounting'], roles: ['owner','manager','cfo','accountant'],
    feature: 'contabilidad_reportes_ejecutivos',
  },
  {
    id: 'ctb_vault', to: '/contabilidad/vault', icon: FolderArchive,
    es: 'Vault', en: 'Vault',
    businessTypes: ['accounting'], roles: ['owner','manager','cfo','accountant'],
    feature: 'contabilidad_inbox',
  },
  {
    id: 'ctb_honorarios', to: '/contabilidad/honorarios', icon: Banknote,
    es: 'Honorarios', en: 'Fees',
    businessTypes: ['accounting'], roles: ['owner','manager','cfo','accountant'],
    feature: 'contabilidad_inbox',
  },
  {
    id: 'clients', icon: Users,
    es: 'Clientes', en: 'Clients',
    feature: 'clients',
    children: [
      { to: '/clients',      es: 'Directorio',       en: 'Directory' },
      { to: '/memberships',  es: 'Membresías',       en: 'Memberships',   businessTypes: ['carwash'], roles: ['owner','manager','cashier'] },
      { to: '/credits',      es: 'Creditos',         en: 'Credits',       feature: 'credits',      roles: ['owner','manager','cfo','accountant'] },
      { to: '/credit-notes', es: 'Notas de Credito', en: 'Credit Notes',  feature: 'credit_notes', roles: ['owner','manager','cfo','accountant'] },
      { to: '/returns',      es: 'Devoluciones',     en: 'Returns',       feature: 'credit_notes' },
    ],
  },
  {
    id: 'caja', icon: Landmark,
    es: 'Caja', en: 'Cash',
    roles: ['owner','manager','cfo','accountant'],
    children: [
      { to: '/cash-recon',  es: 'Cuadre de Caja', en: 'Cash Recon',  feature: 'cash_recon' },
      { to: '/petty-cash',  es: 'Caja Chica',     en: 'Petty Cash',  feature: 'petty_cash' },
    ],
  },
  {
    id: 'inventory', icon: Package,
    es: 'Inventario', en: 'Inventory',
    feature: 'inventory',
    roles: ['owner','manager','cfo','accountant'],
    hasBadge: 'lowStock',
    children: [
      { to: '/inventory',      es: 'Productos',       en: 'Products' },
      // Conteo Fisico is only meaningful where stock is actually tracked. The
      // wash/salon/prestamos verticals have no SKUs to count, so hide it there
      // — the route itself stays routable for deep links.
      { to: '/conteo-fisico',  es: 'Conteo Fisico',   en: 'Physical Count',
        businessTypes: ['retail','dealership','restaurant','hybrid','mechanic','licoreria','meat_market'] },
    ],
  },
  {
    id: 'reports', icon: BarChart3,
    es: 'Reportes', en: 'Reports',
    feature: 'reports',
    roles: ['owner','manager','cfo','accountant'],
    children: [
      { to: '/reports',         es: 'Ventas',           en: 'Sales' },
      { to: '/remote',          es: 'Dashboard Remoto', en: 'Remote Dashboard', feature: 'remote_dashboard' },
    ],
  },
  {
    id: 'empleados', to: '/empleados', icon: Users,
    es: 'Empleados', en: 'Employees',
    feature: 'pos',
    roles: ['owner','manager','cfo','accountant'],
  },
  {
    id: 'invoicing', icon: FileText,
    es: 'Facturacion', en: 'Invoicing',
    // Standalone invoicing module — for clients on the invoicing-only plan.
    // e-CF emission for regular POS/carwash flows happens inside CobrarModal
    // and is NOT gated by this sidebar item. Hidden entirely unless the plan
    // explicitly includes 'invoicing'.
    featureAny: ['invoicing'],
    roles: ['owner','manager','cfo','accountant','cashier'],
    children: [
      { to: '/invoicing/create', es: 'Nueva Factura', en: 'New Invoice' },
      { to: '/invoicing/quotes', es: 'Cotizaciones', en: 'Quotes' },
      { to: '/invoicing/history', es: 'Historial', en: 'History' },
      // v2.16.2 Facturación-tier sprint — E33/E34 surfaces here so a billing-only
      // client never has to hunt for the standalone /credit-notes entry.
      { to: '/credit-notes', es: 'Notas de Crédito', en: 'Credit Notes', feature: 'credit_notes' },
      // Deep-link to the 606 tab inside the DGII shell so a Facturación-plan
       // client clicking 'Reportes 606/607' lands on the report, not the default
       // (which was always 606 anyway, but explicit query keeps it stable if
       // the DGII default tab ever changes). Also distinguishes this entry
       // visually from the top-level 'DGII' menu for the rare plan that has both.
      { to: '/dgii?tab=606', es: 'Reportes 606/607', en: '606/607 Reports', feature: 'dgii_606_607' },
    ],
  },
  {
    id: 'dgii', to: '/dgii', icon: FileText,
    es: 'DGII', en: 'DGII',
    feature: 'dgii',
    roles: ['owner','manager','cfo','accountant'],
    hasBadge: true,
  },
  // 2026-05-09 — collapsed from 5 sub-entries to a single landing card grid.
  // The grid lives at /config (no section) and renders ConfigGrid.jsx, which
  // links into the legacy section routes — bookmarks + deep links to
  // /config/empresa, /config/usuarios, etc. all keep working unchanged.
  {
    id: 'config', to: '/config', icon: Settings,
    es: 'Configuracion', en: 'Settings',
    roles: ['owner','manager'],
  },
]

// Bottom nav shows these routes + Menu
const BOTTOM_NAV_KEYS = ['pos', 'queue', 'clients', 'reports']

// ── Helpers ─────────────────────────────────────────────────────────────────

// Sidebar `to` values come in two flavors:
//   - Short: '/queue', '/clients', '/reports' (matches a Navigate in
//     web/main.jsx that redirects to '/pos/queue', etc.)
//   - Full:  '/pos', '/admin', '/pos/foo'
// The actual rendered pathname is always the full '/pos/X' form. To match
// short forms, we compare against both pathname and pathname-minus-/pos.
// Without this, item.to='/pos' matched every '/pos/*' route (POS tab stuck
// red while user was on Cola, Clientes, Reportes, etc.).
function isItemActive(itemTo, pathname) {
  if (!itemTo) return false
  if (pathname === itemTo) return true
  // Special case: '/pos' should match ONLY the bare service grid, not
  // every sub-route. The sub-routes have their own sidebar entries.
  if (itemTo === '/pos') return false
  if (pathname.startsWith(itemTo + '/')) return true
  // Short form: compare 'queue' to '/pos/queue' via prefix strip.
  if (pathname.startsWith('/pos/')) {
    const stripped = pathname.slice(4) // '/pos/queue' → '/queue'
    if (stripped === itemTo || stripped.startsWith(itemTo + '/')) return true
  }
  return false
}

function isChildActive(children, pathname) {
  return children?.some(c => isItemActive(c.to, pathname))
}

// ── Desktop Nav Item ────────────────────────────────────────────────────────

function NavItem({ item, collapsed, lang, hasFeature, userRole, ecfQueue, lowStock, unreadActivity, foodTruckPendientes, pathname, businessType }) {
  const isGroup = !!item.children
  const locked = item.feature && !hasFeature(item.feature)
  const active = isGroup
    ? isChildActive(item.children, pathname)
    : isItemActive(item.to, pathname)
  const [open, setOpen] = useState(active)

  // Auto-open when a child route is active
  useEffect(() => {
    if (active && isGroup) setOpen(true)
  }, [active, isGroup])

  const label = lang === 'es' ? item.es : item.en
  const Icon = item.icon
  const badge = item.badgeKey === 'foodTruckPendientes' ? foodTruckPendientes
    : item.hasBadge === 'lowStock' ? lowStock
    : item.hasBadge ? ecfQueue
    : 0
  // Group-level roll-up: Reportes shows the unread activity badge so owners
  // see new manager overrides at a glance even while the group is collapsed.
  const groupBadge = item.id === 'reports' ? unreadActivity : 0

  // Filter children by role and business type
  const visibleChildren = isGroup
    ? item.children.filter(c =>
        (!c.roles || c.roles.includes(userRole)) &&
        (!c.businessTypes || c.businessTypes.includes(businessType))
      )
    : []

  if (isGroup && collapsed) {
    // Collapsed group — just show icon, first child route
    const firstChild = visibleChildren[0]
    if (!firstChild) return null
    return (
      <NavLink
        to={locked ? '#' : firstChild.to}
        onClick={locked ? (e) => e.preventDefault() : undefined}
        title={label}
        className={`flex items-center justify-center w-10 h-10 mx-auto rounded-xl transition-all group select-none ${
          locked ? 'opacity-40 cursor-not-allowed' : ''
        } ${active ? 'bg-white/10 text-[#b3001e]' : 'text-white/50 hover:bg-white/5 hover:text-white/80'}`}
      >
        <span className="relative flex items-center justify-center w-[22px] h-[22px]">
          <Icon size={17} strokeWidth={1.75} />
          {locked && <Lock size={8} className="absolute -top-0.5 -right-0.5 text-white/30" />}
          {!locked && groupBadge > 0 && (
            <span className="absolute top-0 right-0 w-4 h-4 rounded-full flex items-center justify-center leading-none pointer-events-none"
              style={{ background: '#b3001e', color: '#fff', fontSize: 9, fontWeight: 500 }}>
              {groupBadge > 99 ? '99+' : groupBadge}
            </span>
          )}
        </span>
        <span className="pointer-events-none absolute left-full ml-3 px-2.5 py-1.5 bg-zinc-700 text-white text-xs rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg">
          {label}{locked ? ' (Pro)' : ''}
        </span>
      </NavLink>
    )
  }

  if (isGroup) {
    return (
      <div>
        <button
          onClick={() => setOpen(o => !o)}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all select-none ${
            locked ? 'opacity-40' : ''
          } ${active ? 'text-[#b3001e]' : 'text-white/50 hover:bg-white/5 hover:text-white/80'}`}
        >
          <Icon size={17} strokeWidth={1.75} className="shrink-0" />
          <span className="text-[13px] font-medium flex-1 text-left leading-none">{label}</span>
          {!locked && groupBadge > 0 && (
            <span className="min-w-[18px] h-[18px] px-1 text-[10px] bg-[#b3001e] text-white font-bold rounded-full flex items-center justify-center leading-none"
              title={lang === 'es' ? 'Actividad nueva' : 'New activity'}>
              {groupBadge > 99 ? '99+' : groupBadge}
            </span>
          )}
          {locked && <Lock size={12} className="text-white/30 shrink-0" />}
          {!locked && (
            <ChevronDown size={14} className={`text-white/30 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
          )}
        </button>
        <div className={`overflow-hidden transition-all duration-200 ${open ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}>
          <div className="ml-5 pl-3 border-l border-white/10 space-y-0.5 py-1">
            {visibleChildren.map(child => {
              const childLocked = child.feature && !hasFeature(child.feature)
              const childActive = isItemActive(child.to, pathname)
              // The remote dashboard child carries the live "unread activity"
              // dot so owners can tell at a glance that there are new manager
              // overrides / voids / discrepancies since they last checked.
              const childBadge = child.to === '/remote' ? unreadActivity : 0
              return (
                <NavLink
                  key={child.to}
                  to={childLocked ? '#' : child.to}
                  onClick={childLocked ? (e) => e.preventDefault() : undefined}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-medium transition-colors ${
                    childLocked ? 'opacity-40 cursor-not-allowed' : ''
                  } ${childActive
                    ? 'bg-white/10 text-[#b3001e] font-semibold'
                    : 'text-white/50 hover:bg-white/5 hover:text-white/70'
                  }`}
                >
                  {child.icon && <child.icon size={13} strokeWidth={1.75} className="shrink-0" />}
                  <span className="flex-1">{lang === 'es' ? child.es : child.en}</span>
                  {!childLocked && childBadge > 0 && (
                    <span className="min-w-[16px] h-[16px] px-1 text-[9px] bg-[#b3001e] text-white font-bold rounded-full flex items-center justify-center leading-none"
                      title={lang === 'es' ? 'Actividad nueva' : 'New activity'}>
                      {childBadge > 99 ? '99+' : childBadge}
                    </span>
                  )}
                  {childLocked && <Lock size={10} className="text-white/30" />}
                </NavLink>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  // Simple link item
  if (collapsed) {
    return (
      <NavLink
        to={locked ? '#' : item.to}
        onClick={locked ? (e) => e.preventDefault() : undefined}
        title={label}
        className={`flex items-center justify-center w-10 h-10 mx-auto rounded-xl transition-all group select-none ${
          locked ? 'opacity-40 cursor-not-allowed' : ''
        } ${active ? 'bg-white/10 text-[#b3001e]' : 'text-white/50 hover:bg-white/5 hover:text-white/80'}`}
      >
        <span className="relative flex items-center justify-center w-[22px] h-[22px]">
          <Icon size={17} strokeWidth={1.75} />
          {locked && <Lock size={8} className="absolute -top-0.5 -right-0.5 text-white/30" />}
          {!locked && badge > 0 && (
            <span className="absolute top-0 right-0 w-4 h-4 rounded-full flex items-center justify-center leading-none pointer-events-none"
              style={{ background: '#b3001e', color: '#fff', fontSize: 9, fontWeight: 500 }}>
              {badge}
            </span>
          )}
        </span>
        <span className="pointer-events-none absolute left-full ml-3 px-2.5 py-1.5 bg-zinc-700 text-white text-xs rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg">
          {label}{locked ? ' (Pro)' : ''}
        </span>
      </NavLink>
    )
  }

  return (
    <NavLink
      to={locked ? '#' : item.to}
      onClick={locked ? (e) => e.preventDefault() : undefined}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all select-none ${
        locked ? 'opacity-40 cursor-not-allowed' : ''
      } ${active
        ? 'bg-white/10 text-[#b3001e] border-l-2 border-[#b3001e]'
        : 'text-white/50 hover:bg-white/5 hover:text-white/80'
      }`}
    >
      <Icon size={17} strokeWidth={1.75} className="shrink-0" />
      <span className="text-[13px] font-medium flex-1 leading-none">{label}</span>
      {locked && <Lock size={12} className="text-white/30 shrink-0" />}
      {!locked && badge > 0 && (
        <span className="w-[18px] h-[18px] text-[10px] bg-[#b3001e] text-white font-bold rounded-full flex items-center justify-center leading-none">
          {badge}
        </span>
      )}
    </NavLink>
  )
}

// ── Support Ticket Button ────────────────────────────────────────────────────

function SupportTicketButton({ collapsed, lang, businessId }) {
  const [open, setOpen] = useState(false)
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  async function submit() {
    if (!subject.trim() || !businessId) return
    setSending(true)
    try {
      await fetch('/api/panel?action=create_ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId, subject: subject.trim(), message: message.trim(), priority: 'medium' }),
      })
      setSent(true)
      setTimeout(() => { setOpen(false); setSent(false); setSubject(''); setMessage('') }, 2000)
    } catch (err) {
      try { window.__txReportError?.(err, { severity: 'warn', category: 'sidebar.support_ticket.create', extra: { businessId, subjectLen: subject.length } }) } catch {}
    }
    setSending(false)
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        title={lang === 'es' ? 'Reportar problema' : 'Report issue'}
        className={`flex items-center rounded-xl text-white/40 hover:text-[#b3001e] hover:bg-white/5 transition-colors ${
          collapsed ? 'w-8 h-8 justify-center mx-auto' : 'w-full gap-2 px-3 py-2'
        }`}>
        <LifeBuoy size={15} className="shrink-0" />
        {!collapsed && <span className="text-[12px] font-medium">{lang === 'es' ? 'Reportar problema' : 'Report issue'}</span>}
      </button>

      {open && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={() => setOpen(false)}>
          <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-black rounded-2xl border border-black/10 dark:border-white/10 p-6 w-[400px] max-w-[90vw] space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-bold dark:text-white">{lang === 'es' ? 'Reportar Problema' : 'Report Issue'}</h3>
              <button onClick={() => setOpen(false)} className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5"><X size={16} className="dark:text-white/40" /></button>
            </div>
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder={lang === 'es' ? 'Asunto...' : 'Subject...'}
              className="w-full px-3.5 py-2.5 rounded-xl text-[13px] outline-none border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white dark:placeholder-white/30 focus:ring-2 focus:ring-[#b3001e]/25 focus:border-[#b3001e]" />
            <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3}
              placeholder={lang === 'es' ? 'Describe el problema...' : 'Describe the issue...'}
              className="w-full px-3.5 py-2.5 rounded-xl text-[13px] outline-none border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white dark:placeholder-white/30 resize-none focus:ring-2 focus:ring-[#b3001e]/25 focus:border-[#b3001e]" />
            <button onClick={submit} disabled={!subject.trim() || sending || sent}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#b3001e] hover:bg-[#c8002a] text-white text-[13px] font-bold rounded-xl disabled:opacity-50 transition-colors">
              {sending ? <Loader2 size={14} className="animate-spin" /> : sent ? '✓' : <Send size={14} />}
              {sending ? (lang === 'es' ? 'Enviando...' : 'Sending...') : sent ? (lang === 'es' ? 'Enviado' : 'Sent') : (lang === 'es' ? 'Enviar Ticket' : 'Send Ticket')}
            </button>
          </div>
        </div>
      )}
    </>
  )
}

// ── Connection & License dots ───────────────────────────────────────────────

function ConnectionDot({ collapsed }) {
  const { status, configured } = useBackup()
  const { lang } = useLang()
  if (!configured) return null

  const meta = {
    online:  { dot: 'bg-emerald-400', label: lang === 'es' ? 'En linea'       : 'Online',  Icon: Cloud    },
    syncing: { dot: 'bg-amber-400 animate-pulse', label: lang === 'es' ? 'Sincronizando' : 'Syncing', Icon: RefreshCw },
    offline: { dot: 'bg-red-400',     label: lang === 'es' ? 'Sin conexion'   : 'Offline', Icon: CloudOff },
  }[status] || { dot: 'bg-slate-300', label: '', Icon: Cloud }

  if (collapsed) {
    return <div title={meta.label} className="flex justify-center"><span className={`w-2 h-2 rounded-full ${meta.dot}`} /></div>
  }
  return (
    <div className="flex items-center gap-2 px-3 py-1">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} />
      <span className="text-[11px] text-slate-400">{meta.label}</span>
    </div>
  )
}

function LicenseDot({ collapsed }) {
  const { result, isReadOnly, refresh, checking } = useLicense()
  const { lang } = useLang()
  if (!result) return null

  const isExpired = result.status === 'expired' || result.status === 'grace'
  const isWarning = result.warning
  if (!isExpired && !isWarning && !isReadOnly) return null

  const dot   = isReadOnly || isExpired ? 'bg-red-400' : 'bg-amber-400'
  const statusLabels = {
    rnc_mismatch:      lang === 'es' ? 'RNC no coincide'       : 'RNC mismatch',
    hardware_mismatch: lang === 'es' ? 'Equipo no coincide'    : 'Hardware mismatch',
    not_found:         lang === 'es' ? 'Licencia no encontrada': 'License not found',
    pending:           lang === 'es' ? 'Licencia pendiente'    : 'License pending',
    inactive:          lang === 'es' ? 'Licencia inactiva'     : 'License inactive',
    suspended:         lang === 'es' ? 'Licencia suspendida'   : 'License suspended',
  }
  const label = isReadOnly
    ? (statusLabels[result.status] || (lang === 'es' ? 'Licencia invalida'  : 'Invalid license'))
    : isExpired
      ? (lang === 'es' ? 'Licencia vencida' : 'License expired')
      : result.warningMsg || ''

  if (collapsed) {
    return (
      <button onClick={refresh} disabled={checking} title={label + (lang === 'es' ? ' — clic para refrescar' : ' — click to refresh')} className="flex justify-center w-full">
        <span className={`w-2 h-2 rounded-full ${checking ? 'animate-pulse' : ''} ${dot}`} />
      </button>
    )
  }
  return (
    <button onClick={refresh} disabled={checking} title={lang === 'es' ? 'Clic para refrescar licencia' : 'Click to refresh license'}
      className="flex items-center gap-2 px-3 py-1 w-full hover:bg-white/5 rounded-lg transition-colors text-left">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${checking ? 'animate-pulse' : ''} ${dot}`} />
      <span className="text-[11px] text-slate-400 truncate">{label}</span>
      <RefreshCw size={10} className={`text-white/30 ml-auto shrink-0 ${checking ? 'animate-spin' : ''}`} />
    </button>
  )
}

// ── Mobile Bottom Nav ───────────────────────────────────────────────────────

function MobileBottomNav({ visibleNav, ecfQueue, businessType }) {
  const { lang } = useLang()
  const { user, logout } = useAuth()
  const { darkMode, toggleDark, themePreference } = useLayout()
  const { hasFeature } = usePlan()
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const pathname = location.pathname

  useEffect(() => { setDrawerOpen(false) }, [pathname])

  const allBottomItems = [
    { id: 'pos',       to: '/pos',       icon: ShoppingCart,  label: 'POS' },
    { id: 'queue',     to: '/queue',     icon: ClipboardList, label: 'Cola',       businessTypes: ['carwash', 'service', 'hybrid'] },
    { id: 'inventory', to: '/inventory', icon: Package,       label: lang === 'es' ? 'Inventario' : 'Inventory', businessTypes: ['retail', 'dealership', 'restaurant', 'hybrid', 'mechanic'] },
    { id: 'clients',   to: '/clients',   icon: Users,         label: lang === 'es' ? 'Clientes' : 'Clients' },
    { id: 'reports',   to: '/reports',   icon: BarChart3,     label: lang === 'es' ? 'Reportes' : 'Reports' },
  ]
  const bottomItems = allBottomItems.filter(i => !i.businessTypes || i.businessTypes.includes(businessType))

  // Bottom bar covers the primary routes; drawer surfaces everything else.
  // For grouped items whose group id is in BOTTOM_NAV_KEYS (e.g. reports),
  // we still expose any SECONDARY children in the drawer (e.g. /remote) —
  // only the primary link that already lives in the bottom bar is suppressed.
  const bottomRoutes = new Set(bottomItems.map(b => b.to))
  const drawerItems = []
  for (const item of visibleNav) {
    const isBottomGroup = BOTTOM_NAV_KEYS.includes(item.id)
    if (item.children) {
      const visibleChildren = item.children.filter(c =>
        (!c.roles || c.roles.includes(user?.role)) &&
        !bottomRoutes.has(c.to)
      )
      if (visibleChildren.length === 0) continue
      drawerItems.push({ type: 'header', label: lang === 'es' ? item.es : item.en, icon: item.icon })
      for (const child of visibleChildren) {
        const childLocked = child.feature && !hasFeature(child.feature)
        drawerItems.push({ type: 'link', to: child.to, label: lang === 'es' ? child.es : child.en, icon: child.icon, locked: childLocked })
      }
    } else {
      if (isBottomGroup) continue
      const locked = item.feature && !hasFeature(item.feature)
      drawerItems.push({ type: 'link', to: item.to, label: lang === 'es' ? item.es : item.en, icon: item.icon, locked, badge: item.hasBadge ? ecfQueue : 0 })
    }
  }

  const isMenuActive = drawerOpen || drawerItems.some(d => d.type === 'link' && pathname.startsWith(d.to))

  return (
    <>
      {drawerOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setDrawerOpen(false)} />
      )}

      {/* Slide-up drawer */}
      <div className={`fixed bottom-16 left-0 right-0 z-50 md:hidden transition-transform duration-200 ${
        drawerOpen ? 'translate-y-0' : 'translate-y-full'
      }`}>
        <div className="bg-black border-t border-white/10 rounded-t-2xl max-h-[70vh] overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
            <span className="text-white text-sm font-semibold">Menu</span>
            <button onClick={() => setDrawerOpen(false)} className="text-slate-400 hover:text-white p-1">
              <X size={18} />
            </button>
          </div>

          <nav className="py-2 px-3 space-y-0.5">
            {drawerItems.map((d, i) => {
              if (d.type === 'header') {
                const Icon = d.icon
                return (
                  <div key={i} className="flex items-center gap-2 px-3 pt-3 pb-1">
                    {Icon && <Icon size={13} className="text-slate-500" />}
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{d.label}</span>
                  </div>
                )
              }
              const Icon = d.icon
              const isActive = isItemActive(d.to, pathname)
              return (
                <NavLink
                  key={d.to}
                  to={d.to}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
                    d.locked ? 'opacity-40' : ''
                  } ${isActive ? 'bg-slate-700 text-[#b3001e]' : 'text-slate-300 hover:bg-slate-700/50'}`}
                >
                  {Icon && <Icon size={15} strokeWidth={1.75} className="shrink-0" />}
                  <span className="text-[13px] font-medium flex-1">{d.label}</span>
                  {d.locked && <Lock size={11} className="text-slate-500" />}
                  {d.badge > 0 && (
                    <span className="w-[18px] h-[18px] text-[10px] bg-[#E24B4A] text-white font-bold rounded-full flex items-center justify-center leading-none">
                      {d.badge}
                    </span>
                  )}
                </NavLink>
              )
            })}
          </nav>

          <div className="border-t border-slate-700 px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white text-[13px] font-semibold">{user?.name}</p>
                <p className="text-slate-400 text-[11px] capitalize">{user?.role}</p>
              </div>
              <div className="flex items-center gap-1">
                <LanguageToggle />
                <button onClick={toggleDark} className="p-2 rounded-lg text-slate-400 hover:text-amber-400 transition-colors"
                  title={themePreference === 'system' ? (lang === 'es' ? 'Sistema' : 'System') : themePreference === 'dark' ? (lang === 'es' ? 'Modo dia' : 'Day mode') : (lang === 'es' ? 'Modo noche' : 'Night mode')}>
                  {themePreference === 'system' ? <Monitor size={15} /> : themePreference === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
                </button>
                <ManualSyncButton lang={lang} darkBg />
                <button onClick={logout} className="p-2 rounded-lg text-slate-400 hover:text-red-400 transition-colors">
                  <LogOut size={15} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 h-16 bg-black border-t border-white/10 flex justify-around items-center z-50 md:hidden">
        {bottomItems.map(item => {
          const isActive = isItemActive(item.to, pathname)
          return (
            <NavLink key={item.to} to={item.to} className="flex flex-col items-center justify-center flex-1 py-1">
              <item.icon size={20} strokeWidth={1.75} className={isActive ? 'text-[#b3001e]' : 'text-slate-400'} />
              <span className={`text-[10px] mt-0.5 ${isActive ? 'text-[#b3001e] font-medium' : 'text-slate-400'}`}>
                {item.label}
              </span>
            </NavLink>
          )
        })}
        <button onClick={() => setDrawerOpen(o => !o)} className="flex flex-col items-center justify-center flex-1 py-1">
          <Menu size={20} strokeWidth={1.75} className={isMenuActive ? 'text-[#b3001e]' : 'text-slate-400'} />
          <span className={`text-[10px] mt-0.5 ${isMenuActive ? 'text-[#b3001e] font-medium' : 'text-slate-400'}`}>
            {lang === 'es' ? 'Mas' : 'More'}
          </span>
        </button>
      </div>
    </>
  )
}

// ── Main Sidebar Export ─────────────────────────────────────────────────────

export default function Sidebar() {
  const api = useAPI()
  const { t, lang } = useLang()
  const { user, logout } = useAuth()
  const { collapsed, setCollapsed, darkMode, toggleDark, themePreference } = useLayout()
  const { result } = useLicense()
  const { hasFeature } = usePlan()
  const { businessType } = useBusinessType()
  const location = useLocation()
  const [ecfQueue, setEcfQueue] = useState(0)
  const [lowStock, setLowStock] = useState(0)
  const [unreadActivity, setUnreadActivity] = useState(0)
  const [foodTruckPendientes, setFoodTruckPendientes] = useState(0)
  // v2.16.2 (item #13) — dead-letter WhatsApp reminders surface
  const [waFailed, setWaFailed] = useState(0)
  const [waFailedOpen, setWaFailedOpen] = useState(false)
  const [waFailedRows, setWaFailedRows] = useState([])
  const [waRetrying, setWaRetrying] = useState(false)

  useEffect(() => {
    if (!user?.id) return
    async function poll() {
      const count = await api?.ecf?.queueCount?.() ?? 0
      setEcfQueue(count)
    }
    poll()
    const id = setInterval(poll, 30_000)
    return () => clearInterval(id)
  }, [api, user?.id])

  useEffect(() => {
    // Only stock-tracked business types have inventory to count low stock on.
    const stockTracked = ['retail', 'dealership', 'restaurant', 'hybrid', 'mechanic'].includes(businessType)
    if (!stockTracked || !user?.id) return
    async function poll() {
      const count = await api?.inventory?.lowStockCount?.() ?? 0
      setLowStock(count)
    }
    poll()
    const id = setInterval(poll, 60_000)
    return () => clearInterval(id)
  }, [businessType, api, user?.id])

  // 2026-05-09 — food_truck Pendientes count (open-ticket lifecycle).
  useEffect(() => {
    if (businessType !== 'food_truck' || !user?.id) return
    async function poll() {
      try {
        const list = await api?.tickets?.listOpen?.({})
        setFoodTruckPendientes(Array.isArray(list) ? list.length : 0)
      } catch { /* RLS / offline → keep last good count */ }
    }
    poll()
    const id = setInterval(poll, 20_000)
    return () => clearInterval(id)
  }, [businessType, api, user?.id])

  // Unread-activity badge. Counts warn/critical rows in activity_log since the
  // last time the current user opened the Actividad tab on this business.
  // Roles: owner/cfo/accountant only (matches RemoteDashboard ALLOWED). Plan:
  // requires remote_dashboard feature. Polls every 60s via a single shared
  // interval. Mark-seen happens inside RemoteDashboard → tx:actividad-seen.
  const allowedRole = ['owner','cfo','accountant'].includes(user?.role)
  const canRemote = hasFeature('remote_dashboard')
  const bidForActivity = result?.businessId || null
  useEffect(() => {
    if (!allowedRole || !canRemote || !bidForActivity) { setUnreadActivity(0); return }
    let cancelled = false
    const seenKey = `tx_actividad_seen_${bidForActivity}`
    async function poll() {
      try {
        let count = 0
        const sinceIso = localStorage.getItem(seenKey)
          || new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
        if (api?.activity?.unreadCount) {
          count = await api.activity.unreadCount({ businessId: bidForActivity, sinceIso }) ?? 0
        } else {
          // Web: hit Supabase directly. Lazy-load the client so the Sidebar
          // doesn't drag the SDK into non-authenticated routes.
          const mod = await import('@terminal-x/services/supabase.js').catch(() => null)
          const sb = mod?.getSupabaseClient?.()
          if (sb) {
            const { count: c } = await sb.from('activity_log')
              .select('*', { count: 'exact', head: true })
              .eq('business_id', bidForActivity)
              .gt('created_at', sinceIso)
              .in('severity', ['warn', 'critical'])
            count = c || 0
          }
        }
        if (!cancelled) setUnreadActivity(count)
      } catch { if (!cancelled) setUnreadActivity(0) }
    }
    poll()
    const id = setInterval(poll, 60_000)
    // Listen for the mark-seen event fired when the Actividad tab opens.
    function onSeen(e) {
      if (e?.detail?.businessId && e.detail.businessId !== bidForActivity) return
      try { localStorage.setItem(seenKey, new Date().toISOString()) } catch {}
      setUnreadActivity(0)
    }
    window.addEventListener('tx:actividad-seen', onSeen)
    return () => { cancelled = true; clearInterval(id); window.removeEventListener('tx:actividad-seen', onSeen) }
  }, [allowedRole, canRemote, bidForActivity, api])

  // v2.16.2 (item #13) — poll dead-letter count (web only — desktop has its
  // own retry path). Cheap (single IDB read), 60s cadence.
  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    async function poll() {
      try {
        const c = await getQueueCounts()
        if (!cancelled) setWaFailed(Number(c?.whatsapp_failed) || 0)
      } catch { /* IDB not available — desktop, ignore */ }
    }
    poll()
    const id = setInterval(poll, 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [user?.id])

  async function openWaFailed() {
    try { setWaFailedRows(await getFailedWhatsappReminders()) } catch { setWaFailedRows([]) }
    setWaFailedOpen(true)
  }
  async function retryWaFailed() {
    setWaRetrying(true)
    try {
      await retryAllFailedWhatsappReminders()
      setWaFailedRows([])
      setWaFailed(0)
      setWaFailedOpen(false)
    } catch { /* swallow — count refreshes on next poll */ }
    setWaRetrying(false)
  }

  // Filter nav items by role, business type and required features.
  // `featureAny` hides the item entirely unless the plan unlocks at least one
  // of the listed features (distinct from `feature`, which only greys it out).
  //
  // Invoicing-only verticals (contabilidad) get a whitelist: POS-side items
  // that don't declare `businessTypes` would otherwise leak through. Only
  // items explicitly relevant to a contadora are shown.
  const CONTABILIDAD_ALLOWED_IDS = new Set([
    'ctb_portfolio',
    'ctb_bandeja', 'ctb_cartera', 'ctb_calendario', 'ctb_tareas',
    'ctb_comprobantes', 'ctb_libro_mayor', 'ctb_banco', 'ctb_nomina',
    'ctb_activos', 'ctb_reportes', 'ctb_vault', 'ctb_honorarios',
    'remote_dashboard', 'sistema', 'settings', 'activity', 'logout',
  ])
  const isInvoicingOnly = businessType === 'accounting'
  const visibleNav = NAV.filter(item =>
    (!item.roles || item.roles.includes(user?.role)) &&
    (!item.businessTypes || item.businessTypes.includes(businessType)) &&
    (!item.featureAny || item.featureAny.some(f => hasFeature(f))) &&
    (!isInvoicingOnly || CONTABILIDAD_ALLOWED_IDS.has(item.id))
  )

  return (
    <>
      {/* ── Desktop sidebar ──────────────────────────────────────────────── */}
      <aside className={`hidden md:flex ${
        collapsed ? 'w-[48px]' : 'w-[220px]'
      } bg-black flex-col h-full shrink-0 transition-all duration-200 overflow-visible`}>

        {/* Brand */}
        <div className={`flex items-center border-b border-white/10 shrink-0 h-14 ${
          collapsed ? 'justify-center' : 'px-4'
        }`}>
          {collapsed
            ? <img src={xMark} alt="TX" width="32" height="32" className="w-8 h-8 object-contain" draggable={false} />
            : <div className="flex items-center gap-0">
                <span className="text-[15px] font-black tracking-[3px] text-white leading-none -mt-1">TERMINAL</span>
                <img src={logoImg} alt="X" width="24" height="24" className="h-6 w-auto object-contain" draggable={false} />
              </div>
          }
        </div>

        {/* Nav */}
        <nav className={`flex-1 py-3 space-y-0.5 ${collapsed ? 'px-2 overflow-visible' : 'px-3 overflow-y-auto'}`}>
          {visibleNav.map(item => (
            <NavItem
              key={item.id}
              item={item}
              collapsed={collapsed}
              lang={lang}
              hasFeature={hasFeature}
              userRole={user?.role}
              ecfQueue={ecfQueue}
              lowStock={lowStock}
              unreadActivity={unreadActivity}
              foodTruckPendientes={foodTruckPendientes}
              pathname={location.pathname}
              businessType={businessType}
            />
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-white/10 shrink-0 p-2 space-y-1">
          {/* v2.16.2 (item #13) — dead-letter WhatsApp reminders */}
          {waFailed > 0 && (
            <button onClick={openWaFailed}
              title={lang === 'es' ? `${waFailed} recordatorios fallidos` : `${waFailed} failed reminders`}
              className={`flex items-center rounded-lg text-[#b3001e] hover:bg-[#b3001e]/10 transition-colors ${
                collapsed ? 'w-8 h-8 justify-center mx-auto' : 'w-full gap-2 px-3 py-2'
              }`}>
              <MessageSquare size={14} className="shrink-0" />
              {!collapsed && (
                <span className="text-[12px] font-semibold flex-1 text-left truncate">
                  {lang === 'es' ? `Recordatorios fallidos: ${waFailed}` : `Failed reminders: ${waFailed}`}
                </span>
              )}
              {collapsed && <span className="absolute -mt-4 ml-3 bg-[#b3001e] text-white text-[9px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center">{waFailed}</span>}
            </button>
          )}
          <ConnectionDot collapsed={collapsed} />
          <LicenseDot collapsed={collapsed} />
          {!collapsed && (
            <div className="px-2 py-1">
              <p className="text-white text-[13px] font-semibold truncate">{user?.name}</p>
              <p className="text-white/40 text-[11px] capitalize">{user?.role}</p>
            </div>
          )}

          <div className={`flex items-center ${collapsed ? 'flex-col gap-1' : 'justify-between px-1'}`}>
            {!collapsed && <LanguageToggle />}
            <button onClick={toggleDark}
              title={themePreference === 'system' ? (lang === 'es' ? 'Sistema' : 'System') : themePreference === 'dark' ? (lang === 'es' ? 'Modo dia' : 'Day mode') : (lang === 'es' ? 'Modo noche' : 'Night mode')}
              className="p-2 rounded-lg text-white/40 hover:text-amber-400 hover:bg-white/5 transition-colors">
              {themePreference === 'system' ? <Monitor size={15} /> : themePreference === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <ManualSyncButton lang={lang} />
            <button onClick={logout} title={t('logout')}
              className="p-2 rounded-lg text-white/40 hover:text-[#b3001e] hover:bg-white/5 transition-colors">
              <LogOut size={15} />
            </button>
          </div>

          {/* WhatsApp support */}
          <a href="https://wa.me/18098282971?text=Hola%2C%20necesito%20soporte%20con%20Terminal%20X."
            target="_blank" rel="noopener noreferrer"
            title={lang === 'es' ? 'Soporte Studio X Tech' : 'Studio X Tech Support'}
            className={`flex items-center rounded-xl text-[#25D366] hover:bg-[#25D366]/10 transition-colors ${
              collapsed ? 'w-8 h-8 justify-center mx-auto' : 'w-full gap-2 px-3 py-2'
            }`}>
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-[15px] h-[15px] shrink-0">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
              <path d="M12 0C5.373 0 0 5.373 0 12c0 2.054.519 4 1.426 5.703L0 24l6.439-1.399A11.938 11.938 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-4.964-1.347l-.356-.211-3.698.803.827-3.607-.232-.371A9.818 9.818 0 1112 21.818z"/>
            </svg>
            {!collapsed && <span className="text-[12px] font-medium">{lang === 'es' ? 'Soporte' : 'Support'}</span>}
          </a>

          {/* Support ticket */}
          <SupportTicketButton collapsed={collapsed} lang={lang} businessId={result?.businessId} />

          {/* Collapse toggle */}
          <button onClick={() => setCollapsed(c => !c)}
            className={`flex items-center rounded-xl text-white/40 hover:bg-white/5 hover:text-white/60 transition-colors ${
              collapsed ? 'w-8 h-8 justify-center mx-auto' : 'w-full gap-2 px-3 py-2'
            }`}>
            {collapsed
              ? <ChevronRight size={15} />
              : <><ChevronLeft size={15} /><span className="text-[12px]">{lang === 'es' ? 'Colapsar' : 'Collapse'}</span></>
            }
          </button>
        </div>
      </aside>

      {/* ── Mobile bottom nav ────────────────────────────────────────────── */}
      <MobileBottomNav visibleNav={visibleNav} ecfQueue={ecfQueue} businessType={businessType} />

      {/* v2.16.2 (item #13) — dead-letter WhatsApp reminders panel */}
      {waFailedOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" onClick={() => setWaFailedOpen(false)}>
          <div onClick={e => e.stopPropagation()}
            className="w-full max-w-lg bg-white dark:bg-black rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10 shrink-0">
              <div className="min-w-0">
                <h2 className="text-[15px] font-bold text-slate-800 dark:text-white flex items-center gap-2">
                  <MessageSquare size={16} className="text-[#b3001e]" />
                  {lang === 'es' ? 'Recordatorios fallidos' : 'Failed reminders'}
                </h2>
                <p className="text-[12px] text-slate-500 dark:text-white/50 mt-0.5">
                  {lang === 'es'
                    ? `${waFailedRows.length} recordatorios agotaron sus reintentos.`
                    : `${waFailedRows.length} reminders exhausted their retries.`}
                </p>
              </div>
              <button onClick={() => setWaFailedOpen(false)} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
                <X size={16} className="text-slate-400" />
              </button>
            </div>
            <div className="flex-1 overflow-auto px-5 py-3">
              {waFailedRows.length === 0 ? (
                <p className="py-12 text-center text-[12px] text-slate-400 dark:text-white/40">
                  {lang === 'es' ? 'Sin recordatorios fallidos.' : 'No failed reminders.'}
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-white/10">
                  {waFailedRows.map(r => (
                    <li key={r.id} className="py-2.5">
                      <p className="text-[12px] font-semibold text-slate-700 dark:text-white truncate">
                        {r.kind} · {r.appointment_supabase_id?.slice(0, 8) || '—'}
                      </p>
                      <p className="text-[11px] text-slate-400 dark:text-white/40 truncate">
                        {r.last_error || (lang === 'es' ? 'sin detalle' : 'no detail')}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="px-5 py-3 border-t border-slate-200 dark:border-white/10 shrink-0 flex gap-2">
              <button onClick={() => setWaFailedOpen(false)}
                className="flex-1 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10">
                {lang === 'es' ? 'Cerrar' : 'Close'}
              </button>
              <button onClick={retryWaFailed} disabled={waRetrying || waFailedRows.length === 0}
                className="flex-1 py-2 bg-[#b3001e] hover:bg-black text-white rounded-lg text-[12px] font-bold disabled:opacity-50 flex items-center justify-center gap-1.5">
                {waRetrying && <Loader2 size={12} className="animate-spin" />}
                {lang === 'es' ? 'Reintentar todos' : 'Retry all'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Manual Supabase sync button ─────────────────────────────────────────────
// Forces an immediate push + pull cycle so the user doesn't have to wait
// for the 5-min auto-sync tick. Shows success/failure as a brief tooltip.
function ManualSyncButton({ lang, darkBg }) {
  const [state, setState] = useState('idle') // idle | syncing | ok | error
  const [msg,   setMsg]   = useState('')

  async function run() {
    if (state === 'syncing') return
    const api = window.electronAPI?.sync
    if (!api?.now) {
      setState('error'); setMsg(lang === 'es' ? 'No disponible en web' : 'Not available on web')
      setTimeout(() => { setState('idle'); setMsg('') }, 2500)
      return
    }
    setState('syncing'); setMsg('')
    try {
      const r = await api.now()
      const pushed = r?.totalRows ?? 0
      const pulled = r?.totalPulled ?? 0
      setState('ok')
      setMsg(lang === 'es'
        ? `${pushed} enviados, ${pulled} recibidos`
        : `${pushed} pushed, ${pulled} pulled`)
    } catch (e) {
      setState('error')
      setMsg(e?.message || (lang === 'es' ? 'Error de sync' : 'Sync error'))
    }
    setTimeout(() => { setState('idle'); setMsg('') }, 3000)
  }

  const colorMap = darkBg ? {
    idle:    'text-slate-400 hover:text-sky-400 hover:bg-slate-700/50',
    syncing: 'text-sky-400',
    ok:      'text-emerald-400',
    error:   'text-red-400',
  } : {
    idle:    'text-white/40 hover:text-sky-300 hover:bg-white/5',
    syncing: 'text-sky-300',
    ok:      'text-emerald-400',
    error:   'text-red-400',
  }

  return (
    <button onClick={run}
      title={state === 'idle'
        ? (lang === 'es' ? 'Sincronizar con la nube' : 'Sync with cloud')
        : msg || (state === 'syncing' ? (lang === 'es' ? 'Sincronizando…' : 'Syncing…') : '')}
      className={`p-2 rounded-lg transition-colors ${colorMap[state]}`}>
      <RefreshCw size={15} className={state === 'syncing' ? 'animate-spin' : ''} />
    </button>
  )
}
