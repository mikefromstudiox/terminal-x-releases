import { motion } from 'framer-motion'
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
  const pct = (done / total) * 100

  if (compact) {
    const isDoneAll = done === total
    const color = isDoneAll ? 'text-emerald-500' : done >= 4 ? 'text-amber-500' : 'text-[#b3001e]'
    const bg = isDoneAll ? 'bg-emerald-500/10 border-emerald-500/30' : done >= 4 ? 'bg-amber-500/10 border-amber-500/30' : 'bg-[#b3001e]/10 border-[#b3001e]/30'
    return (
      <span className={`inline-flex items-center justify-center w-10 h-10 rounded-full text-[11px] font-black border ${color} ${bg}`}>
        {done}/{total}
      </span>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <p className={`text-[14px] font-bold ${isDark ? 'text-white' : 'text-black'}`}>
          <span className="text-[#b3001e] mr-1.5">◉</span>
          {lang === 'es' ? 'Progreso de Onboarding' : 'Onboarding Progress'}
        </p>
        <span className={`text-[12px] font-black ${done === total ? 'text-emerald-500' : 'text-[#b3001e]'}`}>
          {done}/{total}
        </span>
      </div>
      <div className={`w-full h-2 rounded-full overflow-hidden ${isDark ? 'bg-white/10' : 'bg-black/10'}`}>
        <motion.div
          className={`h-full rounded-full ${done === total ? 'bg-emerald-500' : 'bg-[#b3001e]'}`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <div className="space-y-1.5 pt-3">
        {STEPS.map((step, i) => {
          const ok = onboarding[step.key]
          return (
            <motion.div
              key={step.key}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 + i * 0.04, duration: 0.3 }}
              className="flex items-center gap-2.5"
            >
              {ok
                ? <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />
                : <Circle size={15} className={`shrink-0 ${isDark ? 'text-white/20' : 'text-black/15'}`} />
              }
              <span className={`text-[12px] ${ok
                ? isDark ? 'text-white/80' : 'text-black/80'
                : isDark ? 'text-white/30' : 'text-black/30'
              }`}>
                {lang === 'es' ? step.es : step.en}
              </span>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
