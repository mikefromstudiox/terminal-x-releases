/**
 * nomina/index.jsx — Nómina (payroll) container.
 *
 * Lives inside Reportes → Nómina. Renders a horizontal sub-nav and switches
 * between 5 views: Dashboard, Empleados, Pagos, Reportes, Ajustes.
 */

import { useState, lazy, Suspense } from 'react'
import { LayoutDashboard, Users, Banknote, FileText, Settings, Lock, Crown, Check, ArrowRight } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { useLang } from '../../../i18n'
import { usePlan } from '../../../hooks/usePlan.jsx'
import { AccessDenied, ALLOWED_ROLES } from './shared'

const NominaDashboard = lazy(() => import('./NominaDashboard'))
const NominaEmpleados = lazy(() => import('./NominaEmpleados'))
const NominaPagos     = lazy(() => import('./NominaPagos'))
const NominaReportes  = lazy(() => import('./NominaReportes'))
const NominaAjustes   = lazy(() => import('./NominaAjustes'))

// `advanced` views require the `nomina_advanced` feature flag (Pro MAX only).
const VIEWS = [
  { id: 'dashboard', icon: LayoutDashboard, es: 'Dashboard',  en: 'Dashboard',  Component: NominaDashboard, advanced: false },
  { id: 'empleados', icon: Users,           es: 'Empleados',  en: 'Employees',  Component: NominaEmpleados, advanced: false },
  { id: 'pagos',     icon: Banknote,        es: 'Pagos',      en: 'Payments',   Component: NominaPagos,     advanced: true },
  { id: 'reportes',  icon: FileText,        es: 'Reportes',   en: 'Reports',    Component: NominaReportes,  advanced: true },
  { id: 'ajustes',   icon: Settings,        es: 'Ajustes',    en: 'Settings',   Component: NominaAjustes,   advanced: true },
]

export default function Nomina() {
  const { user } = useAuth()
  const { lang } = useLang()
  const { hasFeature, displayName } = usePlan()

  if (!ALLOWED_ROLES.includes(user?.role)) return <AccessDenied lang={lang} />

  const [view, setView] = useState('dashboard')
  const current = VIEWS.find(v => v.id === view) || VIEWS[0]
  const Active = current.Component
  const hasAdvanced = hasFeature('nomina_advanced')
  const blocked = current.advanced && !hasAdvanced

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Sub-nav */}
      <div className="shrink-0 flex items-center gap-1 px-3 md:px-6 pt-3 pb-2 border-b border-slate-200 dark:border-white/10 overflow-x-auto">
        {VIEWS.map(v => {
          const Icon = v.icon
          const active = view === v.id
          const locked = v.advanced && !hasAdvanced
          return (
            <button key={v.id} onClick={() => setView(v.id)}
              className={`shrink-0 flex items-center gap-1.5 px-3 md:px-4 py-2 rounded-lg text-[12px] md:text-[13px] font-semibold transition-colors ${
                active
                  ? 'bg-slate-800 text-white dark:bg-white dark:text-black'
                  : 'text-slate-500 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/10'
              }`}>
              <Icon size={14} />
              {lang === 'es' ? v.es : v.en}
              {locked && <Lock size={11} className="ml-0.5 text-amber-500" />}
            </button>
          )
        })}
      </div>

      {/* Active view */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {blocked ? (
          <NominaUpgradePrompt
            viewName={lang === 'es' ? current.es : current.en}
            currentPlan={displayName}
            lang={lang}
          />
        ) : (
          <Suspense fallback={
            <div className="flex-1 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-slate-200 dark:border-white/10 border-t-[#b3001e] rounded-full animate-spin" />
            </div>
          }>
            <Active />
          </Suspense>
        )}
      </div>
    </div>
  )
}

// ── Upgrade prompt for Pro/Pro PLUS users hitting a Pro MAX-only tab ──────────
function NominaUpgradePrompt({ viewName, currentPlan, lang }) {
  const L = (es, en) => lang === 'es' ? es : en
  const bullets = [
    L('Pagos quincenales y mensuales masivos con un clic', 'Biweekly and monthly bulk payments with one click'),
    L('TSS automático con topes 2026 (SFS RD$232,230 · AFP RD$464,460)', 'Auto TSS with 2026 caps (SFS RD$232,230 · AFP RD$464,460)'),
    L('ISR progresivo automático con escalas DGII 2026', 'Auto progressive ISR with 2026 DGII brackets'),
    L('INFOTEP 1% empleador calculado y reportado', 'INFOTEP 1% employer calculated and reported'),
    L('Reportes TSS + INFOTEP listos para el portal DGII (PDF + CSV)', 'TSS + INFOTEP reports ready for DGII portal (PDF + CSV)'),
    L('Reporte ISR mensual con proyección anual por empleado', 'Monthly ISR report with per-employee annual projection'),
    L('Nómina completa exportable a QuickBooks y Alegra', 'Full payroll export to QuickBooks and Alegra'),
    L('Liquidaciones acumuladas (pasivo laboral al día)', 'Accrued severance liability (up-to-date labor liability)'),
    L('Log automático de cambios de salario', 'Automatic salary change log'),
    L('Recibos de pago formales para cada empleado', 'Formal paycheck stubs for every employee'),
    L('Ajustes editables: tasas, topes, escalas ISR', 'Editable settings: rates, caps, ISR brackets'),
  ]
  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8">
      <div className="max-w-3xl mx-auto">
        {/* Header card */}
        <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-[#b3001e]/40 rounded-3xl p-6 md:p-10 text-white mb-6 shadow-2xl">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-[#b3001e] flex items-center justify-center shrink-0">
              <Crown size={24} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-widest text-[#b3001e]">
                {L('Función exclusiva de Pro MAX', 'Pro MAX exclusive feature')}
              </p>
              <h2 className="text-2xl md:text-3xl font-extrabold mt-1">
                {L(`Nómina in-house (${viewName})`, `In-house Payroll (${viewName})`)}
              </h2>
              <p className="text-[13px] md:text-[14px] text-white/70 mt-2">
                {L(
                  `Tu plan actual es ${currentPlan}. Esta sección de Nómina avanzada está incluida solo en el plan Pro MAX — diseñada para que tú y tu contador manejen TODA la nómina internamente sin pagar un contador externo.`,
                  `Your current plan is ${currentPlan}. This advanced Payroll section is included only in Pro MAX — designed for you and your accountant to handle ALL payroll in-house without paying an external accountant.`
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Feature list */}
        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-5 md:p-6 mb-6">
          <h3 className="text-[13px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider mb-4">
            {L('Qué desbloqueas con Pro MAX', 'What you unlock with Pro MAX')}
          </h3>
          <ul className="space-y-2.5">
            {bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <div className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <Check size={12} className="text-emerald-600 dark:text-emerald-400" />
                </div>
                <span className="text-[13px] text-slate-700 dark:text-white/80">{b}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Value-prop callout */}
        <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-2xl p-5 mb-6">
          <p className="text-[12px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-1">
            {L('Ahorro típico', 'Typical savings')}
          </p>
          <p className="text-[14px] text-emerald-900 dark:text-emerald-100 font-semibold">
            {L(
              'Un contador externo en RD cobra entre RD$8,000 y RD$15,000/mes por preparar nómina, TSS e ISR. Pro MAX incluye todo esto por RD$6,990/mes.',
              'An external accountant in DR charges RD$8,000–15,000/month for payroll, TSS and ISR prep. Pro MAX includes all of this for RD$6,990/month.'
            )}
          </p>
        </div>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row gap-3">
          <a href="https://wa.me/18098282971?text=Hola%2C%20quiero%20cambiar%20a%20Pro%20MAX%20para%20usar%20N%C3%B3mina%20in-house"
             target="_blank" rel="noopener noreferrer"
             className="flex-1 flex items-center justify-center gap-2 px-6 py-4 bg-[#b3001e] hover:bg-[#8c0017] text-white text-[14px] font-bold rounded-xl transition-colors shadow-lg">
            <Crown size={16} />
            {L('Cambiar a Pro MAX', 'Upgrade to Pro MAX')}
            <ArrowRight size={16} />
          </a>
          <a href="https://terminalxpos.com/#pricing" target="_blank" rel="noopener noreferrer"
             className="flex items-center justify-center gap-2 px-6 py-4 text-[13px] font-bold text-slate-600 dark:text-white/70 border border-slate-200 dark:border-white/10 rounded-xl hover:bg-slate-50 dark:hover:bg-white/10 transition-colors">
            {L('Ver todos los planes', 'See all plans')}
          </a>
        </div>
      </div>
    </div>
  )
}
