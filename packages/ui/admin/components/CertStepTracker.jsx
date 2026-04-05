import { CheckCircle2, Circle, Loader2 } from 'lucide-react'

const STEPS = [
  { num: 1,  es: 'Solicitud',                en: 'Application' },
  { num: 2,  es: 'Autorizacion',             en: 'Authorization' },
  { num: 3,  es: 'Configuracion',            en: 'Configuration' },
  { num: 4,  es: 'Pruebas Simulacion',       en: 'Simulation Tests' },
  { num: 5,  es: 'Representacion Impresa',   en: 'Printed Representation' },
  { num: 6,  es: 'Revision DGII',            en: 'DGII Review' },
  { num: 7,  es: 'URL Servicios Prueba',     en: 'Test Service URLs' },
  { num: 8,  es: 'Inicio Prueba Recepcion',  en: 'Reception Test Start' },
  { num: 9,  es: 'Recepcion e-CF',           en: 'e-CF Reception' },
  { num: 10, es: 'Inicio Prueba Aprobacion', en: 'Approval Test Start' },
  { num: 11, es: 'Aprobacion Comercial',     en: 'Commercial Approval' },
  { num: 12, es: 'URL Servicios Produccion', en: 'Production Service URLs' },
  { num: 13, es: 'Declaracion Jurada',       en: 'Sworn Statement' },
  { num: 14, es: 'Verificacion Estatus',     en: 'Status Verification' },
  { num: 15, es: 'Finalizado',               en: 'Completed' },
]

export default function CertStepTracker({ stepsCompleted = [], currentStep = 0, onStepAction, isDark, lang }) {
  const L = (es, en) => lang === 'es' ? es : en

  return (
    <div className="space-y-0">
      <p className={`text-[14px] font-semibold mb-4 ${isDark ? 'text-white' : 'text-black'}`}>
        {L('Pasos de Certificacion', 'Certification Steps')}
        <span className={`ml-2 text-[12px] font-normal ${isDark ? 'text-white/40' : 'text-black/40'}`}>
          {stepsCompleted.length}/15
        </span>
      </p>
      <div className="relative">
        {STEPS.map((step, i) => {
          const completed = stepsCompleted.includes(step.num)
          const isCurrent = step.num === currentStep
          const isPending = !completed && !isCurrent
          const isLast = i === STEPS.length - 1

          return (
            <div key={step.num} className="relative flex gap-3" style={{ paddingBottom: isLast ? 0 : 8 }}>
              {/* Vertical line */}
              {!isLast && (
                <div className="absolute left-[13px] top-[28px] w-[2px] bottom-0"
                  style={{ backgroundColor: completed ? '#059669' : isCurrent ? '#b3001e' : isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }} />
              )}

              {/* Circle */}
              <button
                onClick={() => {
                  if (!onStepAction) return
                  if (completed) onStepAction(step.num, 'uncomplete')
                  else onStepAction(step.num, 'complete')
                }}
                className={`relative z-10 shrink-0 w-[28px] h-[28px] rounded-full flex items-center justify-center transition-all duration-200 ${
                  completed
                    ? 'bg-emerald-500/10 hover:bg-emerald-500/20'
                    : isCurrent
                      ? 'bg-[#b3001e]/10 hover:bg-[#b3001e]/20 ring-2 ring-[#b3001e]/40'
                      : isDark
                        ? 'bg-white/5 hover:bg-white/10'
                        : 'bg-black/5 hover:bg-black/10'
                }`}
              >
                {completed ? (
                  <CheckCircle2 size={16} className="text-emerald-500" />
                ) : isCurrent ? (
                  <span className="relative flex items-center justify-center">
                    <span className="absolute w-3 h-3 rounded-full bg-[#b3001e] animate-ping opacity-30" />
                    <span className="w-2.5 h-2.5 rounded-full bg-[#b3001e]" />
                  </span>
                ) : (
                  <span className={`text-[10px] font-bold ${isDark ? 'text-white/30' : 'text-black/30'}`}>{step.num}</span>
                )}
              </button>

              {/* Label */}
              <div className="flex-1 min-w-0 pt-[3px]">
                <p className={`text-[12px] font-medium leading-tight ${
                  completed
                    ? isDark ? 'text-white/70' : 'text-black/70'
                    : isCurrent
                      ? 'text-[#b3001e] font-semibold'
                      : isDark ? 'text-white/30' : 'text-black/30'
                }`}>
                  <span className={`${isDark ? 'text-white/20' : 'text-black/20'} mr-1.5`}>{step.num}.</span>
                  {lang === 'es' ? step.es : step.en}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
