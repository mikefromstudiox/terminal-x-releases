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

const ADMIN_SECTIONS = ['empresa', 'usuarios', 'servicios']

export default function Config() {
  const { section } = useParams()
  const { user } = useAuth()

  // No section → grid landing.
  if (!section) return <ConfigGrid />

  // Owner-only sections
  const ownerOnly = ['updates', 'preferencias']
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

  return <Navigate to="/config/empresa" replace />
}
