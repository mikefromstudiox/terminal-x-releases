/**
 * Config.jsx — Unified configuration router
 *
 * No section → renders the ConfigGrid card landing (the "settings home" the
 * user shipped 2026-05-09). Each card on that grid links to one of the
 * routes handled below, so deep links keep working.
 *
 * Maps /config/:section to the correct settings panel.
 */
import { useParams, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Admin from './Admin'
import Sistema, { Preferencias } from './Sistema'
import ConfigGrid from './ConfigGrid'
import ConfigPlan from './ConfigPlan'
import ConfigTerminales from './ConfigTerminales'
// 2026-05-09 — Per-section pages so each ConfigGrid card lands at a
// dedicated screen showing ONLY that setting (no scroll-share).
import ConfigWhatsApp from './config-sections/ConfigWhatsApp'
import ConfigPrinter from './config-sections/ConfigPrinter'
import ConfigCommissions from './config-sections/ConfigCommissions'
import ConfigSync from './config-sections/ConfigSync'
import ConfigPedidosYa from './config-sections/ConfigPedidosYa'
import ConfigEvent from './config-sections/ConfigEvent'
import ConfigLicense from './config-sections/ConfigLicense'
import ConfigSecurity from './config-sections/ConfigSecurity'
import ConfigFeatures from './config-sections/ConfigFeatures'
import ConfigSalon from './config-sections/ConfigSalon'
import ConfigNCF from './config-sections/ConfigNCF'
import { Link } from 'react-router-dom'
import { Crown, ArrowRight } from 'lucide-react'

const ADMIN_SECTIONS = ['empresa', 'usuarios', 'servicios']

// 2026-05-18 — Placeholder for the upcoming standalone Membresías config
// panel. The functional management of memberships lives in
// /pos/memberships (Clients sidebar). This page exists so the Config grid
// card has a home that explains what's coming instead of redirecting to
// the Clients-tab module (which confused owners — same screen via two
// menus). Replace this component when the bigger config UI ships.
function ConfigMembershipsSoon() {
  return (
    <div className="min-h-screen bg-white dark:bg-black flex items-start justify-center p-6 md:p-12">
      <div className="max-w-xl w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-8 text-center space-y-5 mt-12">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-[#b3001e]/10 flex items-center justify-center">
          <Crown size={28} className="text-[#b3001e]" />
        </div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Membresías — Próximamente</h1>
        <p className="text-sm text-slate-600 dark:text-white/70 leading-relaxed">
          Estamos construyendo una versión más completa: planes recurrentes con
          débito automático, agrupación de miembros por familia, recordatorios
          de renovación por WhatsApp y reportes de membresía. Por ahora la
          administración de membresías sigue activa en la sección de Clientes.
        </p>
        <Link
          to="/pos/memberships"
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#b3001e] hover:bg-[#8c0017] text-white font-semibold text-sm transition-colors"
        >
          Ir a Membresías en Clientes
          <ArrowRight size={16} />
        </Link>
        <p className="text-[11px] text-slate-400 dark:text-white/40 pt-2">
          Vuelve por aquí pronto — esta página tendrá toda la configuración
          avanzada cuando esté lista.
        </p>
      </div>
    </div>
  )
}

export default function Config() {
  const { section } = useParams()
  const { user } = useAuth()

  // No section → grid landing.
  if (!section) return <ConfigGrid />

  // Owner-only sections
  const ownerOnly = ['updates', 'preferencias', 'printer', 'whatsapp', 'commissions', 'sync', 'pedidosya', 'event', 'license', 'funciones', 'salon']
  if (ownerOnly.includes(section) && user?.role !== 'owner') {
    return <Navigate to="/config/empresa" replace />
  }

  // Admin sections — render Admin with that tab, no header
  if (ADMIN_SECTIONS.includes(section)) {
    return <Admin initialTab={section} hideHeader />
  }

  // Individual settings pages
  if (section === 'preferencias') {
    return (
      <div className="h-full overflow-y-auto px-3 md:px-6 py-4 md:py-6">
        <Preferencias />
      </div>
    )
  }

  if (section === 'updates') {
    return <Sistema initialTab="actualizaciones" hideHeader />
  }

  // 2026-05-09 — ConfigGrid mini-pages (Plan + Terminales). Replaced
  // /admin/clients deep-links that non-admin roles couldn't reach.
  if (section === 'plan')        return <ConfigPlan />
  if (section === 'terminales')  return <ConfigTerminales />

  // 2026-05-09 — Per-section dedicated pages. ONLY the section's own
  // settings, no shared scroll. Legacy /config/preferencias still works
  // (long-scroll power-user page) for backward-compat with bookmarks.
  if (section === 'whatsapp')    return <ConfigWhatsApp />
  if (section === 'printer')     return <ConfigPrinter />
  if (section === 'commissions') return <ConfigCommissions />
  if (section === 'sync')        return <ConfigSync />
  if (section === 'pedidosya')   return <ConfigPedidosYa />
  if (section === 'event')       return <ConfigEvent />
  if (section === 'license')     return <ConfigLicense />
  if (section === 'security')    return <ConfigSecurity />
  if (section === 'funciones')   return <ConfigFeatures />
  if (section === 'salon')       return <ConfigSalon />
  if (section === 'ncf')         return <ConfigNCF />
  if (section === 'memberships') return <ConfigMembershipsSoon />

  return <Navigate to="/config/empresa" replace />
}
