// ContabilidadShell — wrapper for the firm-side suite (Phase 1 + Phase 2 Slice 3).
// Mounted by the per-tenant app shell when business_type === 'contabilidad'.
// Each sub-screen is a top-level sidebar item now; this shell just routes by
// URL param (`/contabilidad/:tab`) so the main sidebar stays the source of
// truth for navigation.
import { useParams, Navigate } from 'react-router-dom'
import Bandeja from './Bandeja.jsx'
import Cartera from './Cartera.jsx'
import Calendario from './Calendario.jsx'
import Comprobantes from './Comprobantes.jsx'
import Vault from './Vault.jsx'
import Honorarios from './Honorarios.jsx'
import LibroMayor from './LibroMayor.jsx'
import Banco from './Banco.jsx'
import Nomina from './Nomina.jsx'
import Activos from './Activos.jsx'
import Tareas from './Tareas.jsx'
import Reportes from './Reportes.jsx'
import Portfolio from './Portfolio.jsx'

const TABS = {
  portfolio:    Portfolio,
  bandeja:      Bandeja,
  cartera:      Cartera,
  calendario:   Calendario,
  tareas:       Tareas,
  comprobantes: Comprobantes,
  libro_mayor:  LibroMayor,
  banco:        Banco,
  nomina:       Nomina,
  activos:      Activos,
  reportes:     Reportes,
  vault:        Vault,
  honorarios:   Honorarios,
}

export default function ContabilidadShell({ initialTab } = {}) {
  const { tab } = useParams()
  const key = tab || initialTab
  if (!key) return <Navigate to="/contabilidad/bandeja" replace />
  const Active = TABS[key]
  if (!Active) return <Navigate to="/contabilidad/bandeja" replace />
  return (
    <div className="flex-1 min-w-0">
      <Active />
    </div>
  )
}
