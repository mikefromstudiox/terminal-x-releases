import { CheckCircle2 } from 'lucide-react'

const STEPS = [
  { num: 1,  label: 'Solicitud' },
  { num: 2,  label: 'Autorizacion' },
  { num: 3,  label: 'Configuracion' },
  { num: 4,  label: 'Pruebas Simulacion' },
  { num: 5,  label: 'Representacion Impresa' },
  { num: 6,  label: 'Revision DGII' },
  { num: 7,  label: 'URL Servicios Prueba' },
  { num: 8,  label: 'Inicio Prueba Recepcion' },
  { num: 9,  label: 'Recepcion e-CF' },
  { num: 10, label: 'Inicio Prueba Aprobacion' },
  { num: 11, label: 'Aprobacion Comercial' },
  { num: 12, label: 'URL Servicios Produccion' },
  { num: 13, label: 'Declaracion Jurada' },
  { num: 14, label: 'Verificacion Estatus' },
  { num: 15, label: 'Finalizado' },
]

export { STEPS }

export default function PortalStepTracker({ currentStep = 0, stepsCompleted = [], stepDates = {} }) {
  const completedCount = stepsCompleted.length

  return (
    <div>
      {/* Progress summary */}
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm font-semibold text-black">
          Progreso de Certificacion
        </p>
        <span className="text-xs font-medium text-black/50">
          {completedCount} de 15 pasos
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 bg-black/5 rounded-full mb-8 overflow-hidden">
        <div
          className="h-full bg-[#b3001e] rounded-full transition-all duration-700 ease-out"
          style={{ width: `${(completedCount / 15) * 100}%` }}
        />
      </div>

      {/* Vertical timeline */}
      <div className="relative">
        {STEPS.map((step, i) => {
          const completed = stepsCompleted.includes(step.num)
          const isCurrent = step.num === currentStep
          const isLast = i === STEPS.length - 1
          const dateStr = stepDates[step.num]

          return (
            <div key={step.num} className="relative flex gap-3 sm:gap-4" style={{ paddingBottom: isLast ? 0 : 12 }}>
              {/* Connecting line */}
              {!isLast && (
                <div
                  className="absolute top-[32px] w-[2px] bottom-0"
                  style={{
                    left: 15,
                    backgroundColor: completed
                      ? '#059669'
                      : isCurrent
                        ? '#b3001e'
                        : 'rgba(0,0,0,0.08)',
                    borderStyle: completed || isCurrent ? 'solid' : 'dashed',
                  }}
                />
              )}

              {/* Circle indicator */}
              <div
                className={`relative z-10 shrink-0 w-[32px] h-[32px] rounded-full flex items-center justify-center ${
                  completed
                    ? 'bg-emerald-500/10'
                    : isCurrent
                      ? 'bg-[#b3001e]/10 ring-2 ring-[#b3001e]/30'
                      : 'bg-black/5'
                }`}
              >
                {completed ? (
                  <CheckCircle2 size={18} className="text-emerald-600" />
                ) : isCurrent ? (
                  <span className="relative flex items-center justify-center">
                    <span className="absolute w-3.5 h-3.5 rounded-full bg-[#b3001e] animate-ping opacity-25" />
                    <span className="w-3 h-3 rounded-full bg-[#b3001e]" />
                  </span>
                ) : (
                  <span className="text-[11px] font-bold text-black/25">{step.num}</span>
                )}
              </div>

              {/* Label + date */}
              <div className="flex-1 min-w-0 pt-[5px]">
                <p className={`text-[13px] leading-tight ${
                  completed
                    ? 'text-black/70 font-medium'
                    : isCurrent
                      ? 'text-[#b3001e] font-semibold'
                      : 'text-black/30 font-medium'
                }`}>
                  <span className="text-black/20 mr-1.5">{step.num}.</span>
                  {step.label}
                </p>
                {dateStr && (
                  <p className="text-[11px] text-black/30 mt-0.5">{dateStr}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
