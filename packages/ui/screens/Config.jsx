/**
 * Config.jsx — Unified configuration router
 * Maps /config/:section to the correct settings panel.
 */
import { useParams, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Admin from './Admin'
import { Preferencias, ImpresionSettings, WhatsAppSettings } from './Sistema'
import { FiscalNCF, Respaldo } from './Admin'
import LicenseAdmin from './LicenseAdmin'

// Lazy import for Actualizaciones — it's inside Sistema but not exported yet
// We'll render Sistema with the right tab for updates
import Sistema from './Sistema'

const ADMIN_SECTIONS = ['empresa', 'lavadores', 'vendedores', 'cajeras', 'usuarios', 'servicios']

export default function Config() {
  const { section } = useParams()
  const { user } = useAuth()

  if (!section) return <Navigate to="/config/empresa" replace />

  // Owner-only sections
  const ownerOnly = ['fiscal', 'impresion', 'whatsapp', 'respaldo', 'updates', 'licencia', 'preferencias']
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

  if (section === 'impresion') {
    return (
      <div className="h-full overflow-y-auto px-3 md:px-6 py-4 md:py-6">
        <ImpresionSettings />
      </div>
    )
  }

  if (section === 'whatsapp') {
    return (
      <div className="h-full overflow-y-auto px-3 md:px-6 py-4 md:py-6">
        <WhatsAppSettings />
      </div>
    )
  }

  if (section === 'fiscal') {
    return (
      <div className="h-full overflow-y-auto px-3 md:px-6 py-4 md:py-6">
        <FiscalNCF />
      </div>
    )
  }

  if (section === 'respaldo') {
    return (
      <div className="h-full overflow-y-auto px-3 md:px-6 py-4 md:py-6">
        <Respaldo />
      </div>
    )
  }

  if (section === 'updates') {
    return <Sistema initialTab="actualizaciones" hideHeader />
  }

  if (section === 'licencia') {
    return <LicenseAdmin />
  }

  return <Navigate to="/config/empresa" replace />
}
