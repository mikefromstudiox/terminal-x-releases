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

const ADMIN_SECTIONS = ['empresa', 'usuarios', 'servicios']

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

  return <Navigate to="/config/empresa" replace />
}
