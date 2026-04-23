/**
 * Config.jsx — Unified configuration router
 * Maps /config/:section to the correct settings panel.
 */
import { useParams, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Admin from './Admin'
import Sistema, { Preferencias } from './Sistema'

const ADMIN_SECTIONS = ['empresa', 'usuarios', 'servicios']

export default function Config() {
  const { section } = useParams()
  const { user } = useAuth()

  if (!section) return <Navigate to="/config/empresa" replace />

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

  return <Navigate to="/config/empresa" replace />
}
