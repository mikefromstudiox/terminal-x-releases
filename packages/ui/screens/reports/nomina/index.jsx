/**
 * nomina/index.jsx — Nómina (payroll) container.
 *
 * Lives inside Reportes → Nómina. Renders a horizontal sub-nav and switches
 * between 5 views: Dashboard, Empleados, Pagos, Reportes, Ajustes.
 */

import { useState, lazy, Suspense } from 'react'
import { LayoutDashboard, Users, Banknote, FileText, Settings } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { useLang } from '../../../i18n'
import { AccessDenied, ALLOWED_ROLES } from './shared'

const NominaDashboard = lazy(() => import('./NominaDashboard'))
const NominaEmpleados = lazy(() => import('./NominaEmpleados'))
const NominaPagos     = lazy(() => import('./NominaPagos'))
const NominaReportes  = lazy(() => import('./NominaReportes'))
const NominaAjustes   = lazy(() => import('./NominaAjustes'))

const VIEWS = [
  { id: 'dashboard', icon: LayoutDashboard, es: 'Dashboard',  en: 'Dashboard',  Component: NominaDashboard },
  { id: 'empleados', icon: Users,           es: 'Empleados',  en: 'Employees',  Component: NominaEmpleados },
  { id: 'pagos',     icon: Banknote,        es: 'Pagos',      en: 'Payments',   Component: NominaPagos },
  { id: 'reportes',  icon: FileText,        es: 'Reportes',   en: 'Reports',    Component: NominaReportes },
  { id: 'ajustes',   icon: Settings,        es: 'Ajustes',    en: 'Settings',   Component: NominaAjustes },
]

export default function Nomina() {
  const { user } = useAuth()
  const { lang } = useLang()

  if (!ALLOWED_ROLES.includes(user?.role)) return <AccessDenied lang={lang} />

  const [view, setView] = useState('dashboard')
  const current = VIEWS.find(v => v.id === view) || VIEWS[0]
  const Active = current.Component

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Sub-nav */}
      <div className="shrink-0 flex items-center gap-1 px-3 md:px-6 pt-3 pb-2 border-b border-slate-200 dark:border-white/10 overflow-x-auto">
        {VIEWS.map(v => {
          const Icon = v.icon
          const active = view === v.id
          return (
            <button key={v.id} onClick={() => setView(v.id)}
              className={`shrink-0 flex items-center gap-1.5 px-3 md:px-4 py-2 rounded-lg text-[12px] md:text-[13px] font-semibold transition-colors ${
                active
                  ? 'bg-slate-800 text-white dark:bg-white dark:text-black'
                  : 'text-slate-500 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/10'
              }`}>
              <Icon size={14} />
              {lang === 'es' ? v.es : v.en}
            </button>
          )
        })}
      </div>

      {/* Active view */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <Suspense fallback={
          <div className="flex-1 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-slate-200 dark:border-white/10 border-t-[#b3001e] rounded-full animate-spin" />
          </div>
        }>
          <Active />
        </Suspense>
      </div>
    </div>
  )
}
