// ConfigGrid — single landing page for every settings surface in the app.
// Lifted from packages/ui/landing/demos/screens/ConfigDemo.jsx (the card grid
// the user fell in love with) and wired to the real routes. Replaces the
// prior Sidebar fan-out of 5 sub-entries with one entry → grid of cards.
//
// Each card:
//   - is plan-gated (hidden when the user's plan lacks the backing feature)
//   - is vertical-aware (food trucks see Ubicaciones/Mermas, salons see
//     Membresías + Estilistas, concesionarios see Bancos/Matrículas, etc.)
//   - role-gated where the destination is owner-only (Preferencias, Updates,
//     Licencia)
//
// Detail panels themselves stay where they are — this screen just navigates
// to the existing routes (/config/empresa, /pos/dgii, /memberships, etc.).
// Deep links keep working for power users + bookmarks.
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Building2, Receipt, Printer, MessageSquare, PiggyBank, Cloud, Crown,
  Truck, KeyRound, Users, Settings, ChevronRight, Shield, Download,
  LayoutGrid, MapPin, Trash2, Sparkles, Calendar, Banknote, FileText,
  Tag, Smartphone, ToggleLeft, Scissors,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { usePlan } from '../hooks/usePlan'
import { useBusinessType } from '../hooks/useBusinessType'
import { useLang } from '../i18n'

// Each card declares:
//   id          stable key
//   icon        lucide-react component
//   title       { es, en }
//   desc        { es, en }
//   to          destination route
//   feature?    plan key required to surface
//   roles?      role allow-list
//   when?       (vertical, hasFeature) => boolean — vertical filter
const ALL_CARDS = [
  {
    id: 'business',
    icon: Building2,
    title: { es: 'Mi Empresa',       en: 'Business' },
    desc:  { es: 'RNC, dirección, teléfono, logo, ITBIS y datos fiscales.',
             en: 'RNC, address, phone, logo, ITBIS and fiscal info.' },
    to: '/config/empresa',
  },
  {
    id: 'services',
    icon: LayoutGrid,
    title: { es: 'Servicios y precios', en: 'Services & pricing' },
    desc:  { es: 'Catálogo de servicios, precios, comisiones por línea.',
             en: 'Service catalog, prices, per-line commission flags.' },
    to: '/config/servicios',
  },
  {
    id: 'team',
    icon: Users,
    title: { es: 'Usuarios y roles', en: 'Users & roles' },
    desc:  { es: 'Cuentas, roles, PINs, Manager Authorization Card.',
             en: 'Accounts, roles, PINs, Manager Authorization Card.' },
    to: '/config/usuarios',
  },
  {
    id: 'ncf',
    icon: Receipt,
    title: { es: 'NCF / e-CF', en: 'NCF / e-CF' },
    desc:  { es: 'Certificado, modo fiscal (B-series vs e-CF) y secuencias autorizadas.',
             en: 'Certificate, fiscal mode (B-series vs e-CF) and authorized sequences.' },
    to: '/config/ncf',
    feature: 'dgii',
  },
  {
    id: 'printer',
    icon: Printer,
    title: { es: 'Impresora y caja', en: 'Printer & drawer' },
    desc:  { es: 'Impresora térmica 80mm, cajón de dinero, variantes drawer-kick.',
             en: 'Thermal 80mm printer, cash drawer, drawer-kick variants.' },
    to: '/config/printer',
    roles: ['owner'],
  },
  {
    id: 'whatsapp',
    icon: MessageSquare,
    title: { es: 'WhatsApp', en: 'WhatsApp' },
    desc:  { es: 'Plantillas de recibo, recordatorios, vencimientos y eventos.',
             en: 'Receipt templates, reminders, due dates and event triggers.' },
    to: '/config/whatsapp',
    feature: 'whatsapp_receipts',
    roles: ['owner'],
  },
  {
    id: 'commissions',
    icon: PiggyBank,
    title: { es: 'Comisiones', en: 'Commissions' },
    desc:  { es: 'Reglas por servicio, por empleado, splits y excepciones.',
             en: 'Per-service, per-employee, split and exception rules.' },
    to: '/config/commissions',
    feature: 'commissions',
    roles: ['owner'],
  },
  {
    id: 'sync',
    icon: Cloud,
    title: { es: 'Sincronización', en: 'Sync' },
    desc:  { es: 'Cada 5 min · cola offline 72h · backup nightly 3 AM.',
             en: 'Every 5 min · 72h offline queue · nightly 3 AM backup.' },
    to: '/config/sync',
    roles: ['owner'],
  },
  {
    id: 'memberships',
    icon: Crown,
    title: { es: 'Membresías', en: 'Memberships' },
    desc:  { es: 'Próximamente · planes recurrentes con débito automático y recordatorios.',
             en: 'Coming soon · recurring plans with autopay and reminders.' },
    // 2026-05-18 — Points to the placeholder ConfigMembershipsSoon instead
    // of redirecting to /pos/memberships (the Clients-tab module). Same
    // screen via two menus confused owners. The functional management
    // stays in Clients → Membresías; this Config card now explains the
    // upcoming standalone config.
    to: '/config/memberships',
    feature: 'salon_memberships',
    when: ({ isSalon, isCarWash }) => isSalon || isCarWash,
  },
  {
    id: 'pedidosya',
    icon: Truck,
    title: { es: 'Pedidos Ya', en: 'Pedidos Ya' },
    desc:  { es: 'Canal pink toggle · precios PY · comisión 15% deducida.',
             en: 'Pink channel toggle · PY prices · 15% commission stripped.' },
    to: '/config/pedidosya',
    when: ({ isLicoreria, isRetail, isCarniceria, isFoodTruck }, hasFeature) =>
      hasFeature('pedidos_ya') || isLicoreria || isRetail || isCarniceria || isFoodTruck,
  },
  {
    id: 'food_truck_locations',
    icon: MapPin,
    title: { es: 'Ubicaciones', en: 'Locations' },
    desc:  { es: 'Paradas favoritas con GPS opcional para cuadres por sitio.',
             en: 'Favorite stops with optional GPS for per-site reconciliation.' },
    to: '/ubicaciones',
    feature: 'food_truck_locations',
    when: ({ isFoodTruck }) => isFoodTruck,
  },
  {
    id: 'food_truck_waste',
    icon: Trash2,
    title: { es: 'Mermas', en: 'Waste log' },
    desc:  { es: 'Registro de pérdidas con motivo y costo estimado.',
             en: 'Loss log with reason and estimated cost.' },
    to: '/mermas',
    feature: 'food_truck_waste_log',
    when: ({ isFoodTruck }) => isFoodTruck,
  },
  {
    id: 'food_truck_event_mode',
    icon: Sparkles,
    title: { es: 'Modo Evento', en: 'Event mode' },
    desc:  { es: 'Multiplica precios para eventos privados temporalmente.',
             en: 'Temporarily multiply prices for private events.' },
    to: '/config/event',
    feature: 'food_truck_event_mode',
    when: ({ isFoodTruck }) => isFoodTruck,
  },
  {
    id: 'reservations',
    icon: Calendar,
    title: { es: 'Reservas', en: 'Reservations' },
    desc:  { es: 'Reservas de mesas con depósito y recordatorios automáticos.',
             en: 'Table reservations with deposit and auto reminders.' },
    to: '/reservas',
    feature: 'restaurant_reservations',
    when: ({ isRestaurant }) => isRestaurant,
  },
  {
    id: 'banks',
    icon: Banknote,
    title: { es: 'Bancos y financieras', en: 'Banks' },
    desc:  { es: 'Roster de bancos para pre-aprobaciones de financiamiento.',
             en: 'Bank roster used by financing pre-approvals.' },
    to: '/preapprovals',
    feature: 'preapprovals',
    when: ({ isDealership }) => isDealership,
  },
  {
    id: 'matriculas',
    icon: FileText,
    title: { es: 'Matrículas', en: 'License plates' },
    desc:  { es: 'INTRANT lookup y traspasos vehiculares.',
             en: 'INTRANT lookup and vehicle transfers.' },
    to: '/matriculas',
    feature: 'matriculas',
    when: ({ isDealership }) => isDealership,
  },
  {
    id: 'plan',
    icon: Crown,
    title: { es: 'Plan y facturación', en: 'Plan & billing' },
    desc:  { es: 'Plan activo, próximo cobro, historial de pagos.',
             en: 'Active plan, next charge, payment history.' },
    to: '/config/plan',
  },
  {
    id: 'funciones',
    icon: ToggleLeft,
    title: { es: 'Funciones del Negocio', en: 'Business Features' },
    desc:  { es: 'Comisiones, descuentos, ITBIS por línea, verificación de edad.',
             en: 'Commissions, discounts, per-line ITBIS, age verification.' },
    to: '/config/funciones',
    roles: ['owner'],
  },
  {
    id: 'salon_settings',
    icon: Scissors,
    title: { es: 'Salón / Barbería', en: 'Salon / Barbershop' },
    desc:  { es: 'Depósito por reserva, multa no-show, página pública para agendar.',
             en: 'Booking deposit, no-show fee, public booking page.' },
    to: '/config/salon',
    roles: ['owner'],
    when: ({ isSalon }) => isSalon,
  },
  {
    id: 'security',
    icon: Shield,
    title: { es: 'Seguridad', en: 'Security' },
    desc:  { es: 'PINs, Manager Auth Card, sesiones activas, auditoría.',
             en: 'PINs, Manager Auth Card, active sessions, audit log.' },
    to: '/config/security',
    roles: ['owner'],
  },
  {
    id: 'license',
    icon: KeyRound,
    title: { es: 'Licencia', en: 'License' },
    desc:  { es: 'TXL-XXXX-XXXX-XXXX · vincular o transferir terminal.',
             en: 'TXL-XXXX-XXXX-XXXX · bind or transfer terminal.' },
    to: '/config/license',
    roles: ['owner'],
  },
  {
    id: 'updates',
    icon: Download,
    title: { es: 'Actualizaciones', en: 'Updates' },
    desc:  { es: 'Versión actual, notas y descarga manual del instalador.',
             en: 'Current version, release notes and manual installer.' },
    to: '/config/updates',
    roles: ['owner'],
  },
  // 2026-05-18 — Removed 'Etiquetas y categorías' card. Pointed to the
  // same /config/servicios destination as 'Servicios y precios' above,
  // so it was a duplicate menu entry that confused owners ('why does
  // clicking this open the same modal as the other one?'). Category
  // management lives at the top of the Servicios screen already.
  // Inventory tags live under /pos/inventory. If a standalone tag
  // manager justifies its own card later, re-add here with a real
  // dedicated route — not a dupe of /config/servicios.
  {
    id: 'devices',
    icon: Smartphone,
    title: { es: 'Terminales', en: 'Terminals' },
    desc:  { es: 'Cajas activas, etiquetas por equipo, último acceso.',
             en: 'Active POS terminals, per-device labels, last seen.' },
    to: '/config/terminales',
  },
  // 2026-05-19 — Safety-net card. When Sistema.jsx was broken into
  // config-sections cards in v2.17.x, several sections didn't get migrated
  // (Go-Live Date, Daily Digest, Impuestos y Cargos, Auto Print extras,
  // Básculas/Scales, KDS timings). Add a Configuración Avanzada card that
  // links to the legacy Sistema page so nothing stays unreachable while
  // v2.18 distributes those sections to their proper homes.
  {
    id: 'advanced',
    icon: Settings,
    title: { es: 'Configuración Avanzada', en: 'Advanced Settings' },
    desc:  { es: 'Go-Live, impuestos, resumen diario, básculas, KDS — opciones que aún no se han movido a su tarjeta dedicada.',
             en: 'Go-Live, taxes, daily digest, scales, KDS — options not yet migrated to their dedicated card.' },
    to: '/sistema',
    roles: ['owner', 'manager', 'cfo'],
  },
]

export default function ConfigGrid() {
  const { user } = useAuth()
  const { hasFeature } = usePlan()
  const flags = useBusinessType()
  const { lang } = useLang()
  const role = user?.role

  const cards = useMemo(() => ALL_CARDS.filter(c => {
    if (c.roles && role && !c.roles.includes(role)) return false
    if (c.feature && !hasFeature(c.feature)) return false
    if (c.when && !c.when(flags, hasFeature)) return false
    return true
  }), [role, hasFeature, flags])

  const L = (es, en) => lang === 'es' ? es : en

  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black">
      <div className="px-3 md:px-6 py-4 md:py-6 max-w-6xl mx-auto">
        <div className="mb-5 md:mb-7">
          <h1 className="text-[20px] md:text-[24px] font-black tracking-tight text-slate-900 dark:text-white inline-flex items-center gap-3">
            <Settings size={22} className="text-[#b3001e]" />
            {L('Configuración', 'Settings')}
          </h1>
          <p className="text-[12px] md:text-[13px] text-slate-500 dark:text-white/40 mt-1">
            {L('Todo el setup en un solo lugar. Toca cualquier tarjeta para abrir el panel.',
               'All setup in one place. Tap any card to open its panel.')}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {cards.map(c => {
            const Icon = c.icon
            return (
              <Link
                key={c.id}
                to={c.to}
                className="group bg-white dark:bg-white/[0.03] rounded-2xl border border-slate-200 dark:border-white/10 p-4 md:p-5 text-left hover:border-[#b3001e] dark:hover:border-[#b3001e] hover:shadow-md transition-all"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-[#b3001e]/10 flex items-center justify-center group-hover:bg-[#b3001e]/20 transition-colors">
                    <Icon size={18} className="text-[#b3001e]" />
                  </div>
                  <ChevronRight size={14} className="text-slate-300 dark:text-white/20 group-hover:text-[#b3001e] transition-colors" />
                </div>
                <p className="font-bold text-slate-800 dark:text-white text-[14px]">
                  {L(c.title.es, c.title.en)}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-white/50 mt-1 leading-relaxed">
                  {L(c.desc.es, c.desc.en)}
                </p>
              </Link>
            )
          })}
        </div>

        {cards.length === 0 && (
          <div className="bg-white dark:bg-white/[0.03] rounded-2xl border border-dashed border-slate-200 dark:border-white/10 p-10 text-center">
            <Settings size={28} className="mx-auto text-slate-300 dark:text-white/20 mb-3" />
            <p className="text-sm text-slate-500 dark:text-white/40">
              {L('No hay configuraciones disponibles para tu rol.',
                 'No settings available for your role.')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
