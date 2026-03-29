import { CheckCircle2, Circle } from 'lucide-react'
import { useLang } from '../../i18n'

const STEPS = [
  { key: 'business_info',    es: 'Info del negocio',    en: 'Business info' },
  { key: 'logo',             es: 'Logo subido',         en: 'Logo uploaded' },
  { key: 'owner_linked',     es: 'Cuenta vinculada',    en: 'Account linked' },
  { key: 'first_service',    es: 'Primer servicio',     en: 'First service' },
  { key: 'first_client',     es: 'Primer cliente',      en: 'First customer' },
  { key: 'first_sale',       es: 'Primera venta',       en: 'First sale' },
  { key: 'fiscal_configured',es: 'Modo fiscal',         en: 'Fiscal mode' },
  { key: 'setup_complete',   es: 'Setup completado',    en: 'Setup complete' },
]

export default function OnboardingChecklist({ onboarding, compact, isDark }) {
  const { lang } = useLang()
  if (!onboarding) return null
  const done = Object.values(onboarding).filter(Boolean).length
  const total = STEPS.length

  if (compact) {
    const color = done === total ? 'text-emerald-500' : done >= 4 ? 'text-amber-500' : 'text-red-400'
    const bg = done === total ? 'bg-emerald-500/10' : done >= 4 ? 'bg-amber-500/10' : 'bg-red-400/10'
    return (
      <span className={`inline-flex items-center justify-center w-10 h-10 rounded-full text-[11px] font-bold ${color} ${bg}`}>
        {done}/{total}
      </span>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <p className={`text-[13px] font-semibold ${isDark ? 'text-white' : 'text-slate-800'}`}>
          {lang === 'es' ? 'Progreso de Onboarding' : 'Onboarding Progress'}
        </p>
        <span className={`text-[12px] font-bold ${done === total ? 'text-emerald-500' : 'text-amber-500'}`}>
          {done}/{total}
        </span>
      </div>
      <div className={`w-full h-1.5 rounded-full ${isDark ? 'bg-white/10' : 'bg-slate-100'}`}>
        <div className={`h-full rounded-full transition-all ${done === total ? 'bg-emerald-500' : 'bg-amber-500'}`}
          style={{ width: `${(done / total) * 100}%` }} />
      </div>
      <div className="space-y-1.5 pt-2">
        {STEPS.map(step => {
          const ok = onboarding[step.key]
          return (
            <div key={step.key} className="flex items-center gap-2.5">
              {ok
                ? <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />
                : <Circle size={15} className={`shrink-0 ${isDark ? 'text-white/20' : 'text-slate-300'}`} />
              }
              <span className={`text-[12px] ${ok
                ? isDark ? 'text-white/70' : 'text-slate-600'
                : isDark ? 'text-white/30' : 'text-slate-400'
              }`}>
                {lang === 'es' ? step.es : step.en}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
