import { Check, ArrowRight } from 'lucide-react'

const STEPS = [
  { num: 1,  label: 'Solicitud',                 phase: 'Inicio' },
  { num: 2,  label: 'Autorizacion',              phase: 'Inicio' },
  { num: 3,  label: 'Configuracion',             phase: 'Preparacion' },
  { num: 4,  label: 'Pruebas Simulacion',        phase: 'Preparacion' },
  { num: 5,  label: 'Representacion Impresa',     phase: 'Preparacion' },
  { num: 6,  label: 'Revision DGII',             phase: 'Validacion' },
  { num: 7,  label: 'URL Servicios Prueba',       phase: 'Validacion' },
  { num: 8,  label: 'Inicio Prueba Recepcion',    phase: 'Pruebas' },
  { num: 9,  label: 'Recepcion e-CF',             phase: 'Pruebas' },
  { num: 10, label: 'Inicio Prueba Aprobacion',   phase: 'Pruebas' },
  { num: 11, label: 'Aprobacion Comercial',       phase: 'Pruebas' },
  { num: 12, label: 'URL Servicios Produccion',   phase: 'Produccion' },
  { num: 13, label: 'Declaracion Jurada',         phase: 'Produccion' },
  { num: 14, label: 'Verificacion Estatus',       phase: 'Produccion' },
  { num: 15, label: 'Finalizado',                 phase: 'Produccion' },
]

export { STEPS }

// Phase groupings for the segmented progress bar
const PHASES = [
  { name: 'Inicio',       steps: [1, 2],          color: '#b3001e' },
  { name: 'Preparacion',  steps: [3, 4, 5],       color: '#b3001e' },
  { name: 'Validacion',   steps: [6, 7],          color: '#b3001e' },
  { name: 'Pruebas',      steps: [8, 9, 10, 11],  color: '#b3001e' },
  { name: 'Produccion',   steps: [12, 13, 14, 15], color: '#b3001e' },
]

export default function PortalStepTracker({ currentStep = 0, stepsCompleted = [], stepDates = {} }) {
  const completedCount = stepsCompleted.length
  const pct = Math.round((completedCount / 15) * 100)

  return (
    <div>
      {/* ── Hero progress ring + percentage ── */}
      <div className="flex items-center gap-6 sm:gap-8 mb-8">
        {/* Circular progress */}
        <div className="relative shrink-0">
          <svg width="96" height="96" viewBox="0 0 96 96" className="transform -rotate-90">
            <circle cx="48" cy="48" r="40" fill="none" stroke="#f1f1f1" strokeWidth="6" />
            <circle
              cx="48" cy="48" r="40" fill="none"
              stroke="#b3001e" strokeWidth="6" strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 40}`}
              strokeDashoffset={`${2 * Math.PI * 40 * (1 - completedCount / 15)}`}
              style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-black text-[#0a0a0a] tracking-tight leading-none">{pct}%</span>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-bold text-[#0a0a0a] mb-1 tracking-tight">
            Progreso de Certificacion
          </h3>
          <p className="text-[13px] text-[#0a0a0a]/40 mb-3">
            {completedCount} de 15 pasos completados
          </p>
          {/* Segmented phase bar */}
          <div className="flex gap-1">
            {PHASES.map((phase) => {
              const doneInPhase = phase.steps.filter(s => stepsCompleted.includes(s)).length
              const total = phase.steps.length
              const phaseComplete = doneInPhase === total
              const phaseActive = phase.steps.includes(currentStep)
              return (
                <div key={phase.name} className="flex-1 min-w-0">
                  <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: '#f1f1f1' }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(doneInPhase / total) * 100}%`,
                        backgroundColor: '#b3001e',
                        transition: 'width 0.8s cubic-bezier(0.4,0,0.2,1)',
                      }}
                    />
                  </div>
                  <p className={`text-[10px] mt-1.5 font-semibold tracking-wide uppercase ${
                    phaseComplete ? 'text-[#b3001e]' : phaseActive ? 'text-[#0a0a0a]' : 'text-[#0a0a0a]/25'
                  }`}>
                    {phase.name}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Step timeline ── */}
      <div className="relative">
        {STEPS.map((step, i) => {
          const completed = stepsCompleted.includes(step.num)
          const isCurrent = step.num === currentStep
          const isPending = !completed && !isCurrent
          const isLast = i === STEPS.length - 1
          const dateStr = stepDates[step.num]

          // Phase boundary marker
          const prevPhase = i > 0 ? STEPS[i - 1].phase : null
          const showPhaseLabel = step.phase !== prevPhase

          return (
            <div key={step.num}>
              {/* Phase divider */}
              {showPhaseLabel && i > 0 && (
                <div className="flex items-center gap-2 mb-2 mt-1 ml-[15px] pl-6">
                  <div className="h-px flex-1 bg-[#0a0a0a]/[0.06]" />
                </div>
              )}

              <div className="relative flex gap-4" style={{ paddingBottom: isLast ? 0 : 6 }}>
                {/* Vertical connector */}
                {!isLast && (
                  <div
                    className="absolute w-[2px]"
                    style={{
                      left: 15,
                      top: 32,
                      bottom: 0,
                      background: completed
                        ? 'linear-gradient(to bottom, #b3001e, #b3001e)'
                        : isCurrent
                          ? 'linear-gradient(to bottom, #b3001e 40%, rgba(10,10,10,0.06) 100%)'
                          : 'rgba(10,10,10,0.06)',
                    }}
                  />
                )}

                {/* Node */}
                <div className="relative z-10 shrink-0">
                  {completed ? (
                    <div className="w-[32px] h-[32px] rounded-full bg-[#b3001e] flex items-center justify-center shadow-[0_0_0_4px_rgba(179,0,30,0.08)]">
                      <Check size={16} className="text-white" strokeWidth={3} />
                    </div>
                  ) : isCurrent ? (
                    <div className="w-[32px] h-[32px] rounded-full bg-white border-[3px] border-[#b3001e] flex items-center justify-center shadow-[0_0_0_4px_rgba(179,0,30,0.1)]">
                      <div className="relative">
                        <span className="absolute inset-0 w-3 h-3 rounded-full bg-[#b3001e] animate-ping opacity-30" style={{ left: -1.5, top: -1.5 }} />
                        <span className="block w-2.5 h-2.5 rounded-full bg-[#b3001e]" />
                      </div>
                    </div>
                  ) : (
                    <div className="w-[32px] h-[32px] rounded-full bg-[#f5f5f5] flex items-center justify-center">
                      <span className="text-[11px] font-bold text-[#0a0a0a]/20">{step.num}</span>
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pt-[5px] pb-2">
                  <div className="flex items-baseline gap-2">
                    <p className={`text-[13px] leading-tight ${
                      completed
                        ? 'text-[#0a0a0a] font-semibold'
                        : isCurrent
                          ? 'text-[#b3001e] font-bold'
                          : 'text-[#0a0a0a]/25 font-medium'
                    }`}>
                      {step.label}
                    </p>
                    {isCurrent && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-[#b3001e] uppercase tracking-widest">
                        <ArrowRight size={10} /> En curso
                      </span>
                    )}
                  </div>
                  {dateStr && (
                    <p className="text-[11px] text-[#0a0a0a]/30 mt-0.5 font-medium">{dateStr}</p>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
