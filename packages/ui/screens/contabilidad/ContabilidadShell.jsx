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
import PlanGate from '../../components/PlanGate.jsx'

// 2026-05-18 Fix X — per-tab plan gating. Shell route already gates the whole
// suite by `contabilidad_inbox` (Pro PLUS+); these per-tab keys lock Pro MAX-only
// tabs (Portfolio) and align each sub-module with the plan feature it requires.
const TABS = {
  portfolio:    { C: Portfolio,    feature: 'contabilidad_portfolio' },
  bandeja:      { C: Bandeja,      feature: 'contabilidad_inbox' },
  cartera:      { C: Cartera,      feature: 'contabilidad_cartera' },
  calendario:   { C: Calendario,   feature: 'contabilidad_calendario' },
  tareas:       { C: Tareas,       feature: 'contabilidad_tareas' },
  comprobantes: { C: Comprobantes, feature: 'contabilidad_comprobantes' },
  libro_mayor:  { C: LibroMayor,   feature: 'contabilidad_libro_mayor' },
  banco:        { C: Banco,        feature: 'contabilidad_banco' },
  nomina:       { C: Nomina,       feature: 'contabilidad_nomina' },
  activos:      { C: Activos,      feature: 'contabilidad_activos' },
  reportes:     { C: Reportes,     feature: 'contabilidad_reportes_ejecutivos' },
  vault:        { C: Vault,        feature: 'contabilidad_vault' },
  honorarios:   { C: Honorarios,   feature: 'contabilidad_honorarios' },
}

export default function ContabilidadShell({ initialTab } = {}) {
  const { tab } = useParams()
  const key = tab || initialTab
  if (!key) return <Navigate to="/contabilidad/bandeja" replace />
  const entry = TABS[key]
  if (!entry) return <Navigate to="/contabilidad/bandeja" replace />
  const { C: Active, feature } = entry
  return (
    <div className="flex-1 min-w-0">
      <PlanGate feature={feature}>
        <Active />
      </PlanGate>
    </div>
  )
}
