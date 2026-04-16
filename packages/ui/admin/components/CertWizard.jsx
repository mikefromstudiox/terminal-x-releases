import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, Lock, Circle, ChevronRight, BookOpen, MessageSquare, Info } from 'lucide-react'
import { STEP_CONFIG } from './wizard/StepConfig'
import WizardStepForm from './wizard/WizardStepForm'
import StepSimulationTests from './wizard/StepSimulationTests'
import StepFinalized from './wizard/StepFinalized'
import CertNotes from './CertNotes'
import { listItem } from '../motion'

export default function CertWizard({
  certification,
  stepData = {},
  documents = [],
  testResults = [],
  notes = [],
  onSaveStepData,
  onCompleteStep,
  onUncompleteStep,
  onUploadFile,
  onRunTests,
  onAddNote,
  getToken,
  refreshToken,
  isDark,
  lang,
}) {
  const L = (es, en) => lang === 'es' ? es : en
  const cert = certification || {}
  const stepsCompleted = cert.steps_completed || []
  const [activeStep, setActiveStep] = useState(cert.current_step || 1)
  const [completing, setCompleting] = useState(false)

  const activeConfig = useMemo(() => STEP_CONFIG.find(s => s.step === activeStep), [activeStep])
  const activeData = stepData[activeStep] || {}
  const stepNotes = useMemo(() => notes.filter(n => n.step === activeStep), [notes, activeStep])

  function canOpenStep(num) {
    if (num === 1) return true
    return stepsCompleted.includes(num - 1)
  }

  function isStepComplete(num) {
    return stepsCompleted.includes(num)
  }

  function handleFieldChange(key, value) {
    const updated = { ...activeData, [key]: value }
    onSaveStepData?.(activeStep, updated)
  }

  function handleFileUpload(file, fieldKey) {
    onUploadFile?.(file, activeStep, fieldKey)
  }

  async function handleComplete() {
    setCompleting(true)
    try {
      await onCompleteStep?.(activeStep)
      // auto-advance to next step
      if (activeStep < 15) {
        setTimeout(() => setActiveStep(activeStep + 1), 400)
      }
    } catch {}
    setCompleting(false)
  }

  async function handleUncomplete() {
    try {
      await onUncompleteStep?.(activeStep)
    } catch {}
  }

  const allComplete = stepsCompleted.length === 15

  // Validation
  let canComplete = false
  if (activeConfig) {
    if (activeConfig.customComponent === 'StepFinalized') {
      canComplete = allComplete
    } else if (activeConfig.customComponent === 'StepSimulationTests' && !activeConfig.fields.length) {
      // Step 4: validated by test results only
      const stepTests = testResults.filter(t => t.step === activeStep)
      canComplete = stepTests.length > 0 && stepTests.every(t => t.status === 'accepted')
    } else {
      canComplete = activeConfig.validate(activeData)
    }
  }

  const currentStepComplete = isStepComplete(activeStep)

  const card = `rounded-2xl p-5 ${isDark ? 'bg-white/[0.03] border border-white/10' : 'bg-white border border-black/10 shadow-sm'}`

  return (
    <div className="flex flex-col lg:flex-row gap-5">
      {/* ── LEFT: Step sidebar (desktop) / pill bar (mobile) ── */}

      {/* Mobile pill bar */}
      <div className="lg:hidden overflow-x-auto pb-1 -mx-1 px-1">
        <div className="flex gap-1.5 min-w-max">
          {STEP_CONFIG.map((step) => {
            const completed = isStepComplete(step.step)
            const locked = !canOpenStep(step.step)
            const active = step.step === activeStep

            return (
              <button
                key={step.step}
                onClick={() => !locked && setActiveStep(step.step)}
                disabled={locked}
                className={`relative shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold transition-all ${
                  active
                    ? 'bg-[#b3001e] text-white shadow-lg shadow-[#b3001e]/20'
                    : completed
                      ? isDark ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
                      : locked
                        ? isDark ? 'bg-white/[0.02] text-white/15 border border-white/5' : 'bg-black/[0.02] text-black/15 border border-black/5'
                        : isDark ? 'bg-white/5 text-white/50 border border-white/10' : 'bg-black/5 text-black/50 border border-black/10'
                }`}
              >
                {completed ? <CheckCircle2 size={11} /> : locked ? <Lock size={10} /> : null}
                <span>{step.step}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Desktop sidebar */}
      <div className={`hidden lg:block w-64 shrink-0 rounded-2xl overflow-hidden ${isDark ? 'bg-white/[0.02] border border-white/10' : 'bg-white border border-black/10 shadow-sm'}`}>
        <div className={`px-4 py-3 border-b ${isDark ? 'border-white/10' : 'border-black/10'}`}>
          <p className={`text-[12px] font-bold ${isDark ? 'text-white/60' : 'text-black/60'}`}>
            {L('Pasos', 'Steps')}
            <span className={`ml-2 text-[11px] font-normal ${isDark ? 'text-white/30' : 'text-black/30'}`}>
              {stepsCompleted.length}/15
            </span>
          </p>
          {/* Progress bar */}
          <div className={`h-1 mt-2 rounded-full overflow-hidden ${isDark ? 'bg-white/10' : 'bg-black/10'}`}>
            <motion.div
              className="h-full rounded-full bg-emerald-500"
              initial={{ width: 0 }}
              animate={{ width: `${(stepsCompleted.length / 15) * 100}%` }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
        </div>

        <div className="py-1">
          {STEP_CONFIG.map((step) => {
            const completed = isStepComplete(step.step)
            const locked = !canOpenStep(step.step)
            const active = step.step === activeStep

            return (
              <button
                key={step.step}
                onClick={() => !locked && setActiveStep(step.step)}
                disabled={locked}
                className={`relative w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-all ${
                  active
                    ? isDark ? 'bg-[#b3001e]/15 border-l-2 border-[#b3001e]' : 'bg-[#b3001e]/10 border-l-2 border-[#b3001e]'
                    : locked
                      ? 'opacity-30 cursor-not-allowed'
                      : isDark ? 'hover:bg-white/[0.04]' : 'hover:bg-black/[0.03]'
                }`}
              >
                {/* Step icon */}
                <div className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  completed
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : active
                      ? 'bg-[#b3001e]/15 text-[#b3001e]'
                      : locked
                        ? isDark ? 'bg-white/5 text-white/20' : 'bg-black/5 text-black/20'
                        : isDark ? 'bg-white/5 text-white/40' : 'bg-black/5 text-black/40'
                }`}>
                  {completed ? <CheckCircle2 size={13} /> : locked ? <Lock size={10} /> : step.step}
                </div>

                {/* Step label */}
                <span className={`flex-1 text-[12px] font-medium truncate leading-tight ${
                  active
                    ? 'text-[#b3001e] font-semibold'
                    : completed
                      ? isDark ? 'text-white/60' : 'text-black/60'
                      : locked
                        ? isDark ? 'text-white/20' : 'text-black/20'
                        : isDark ? 'text-white/40' : 'text-black/40'
                }`}>
                  {lang === 'es' ? step.title : step.titleEn}
                </span>

                {active && <ChevronRight size={12} className="text-[#b3001e] shrink-0" />}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── RIGHT: Step content ── */}
      <div className="flex-1 min-w-0 space-y-5">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeStep}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25 }}
            className="space-y-5"
          >
            {/* Step header */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                  currentStepComplete
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                    : 'bg-[#b3001e]/10 text-[#b3001e] border border-[#b3001e]/30'
                }`}>
                  {L('Paso', 'Step')} {activeStep}
                </span>
                {currentStepComplete && (
                  <span className="text-[10px] font-bold text-emerald-400">
                    {L('Completado', 'Completed')}
                  </span>
                )}
              </div>
              <h2 className={`text-[20px] font-black tracking-tight ${isDark ? 'text-white' : 'text-black'}`}>
                {lang === 'es' ? activeConfig?.title : activeConfig?.titleEn}
              </h2>
              <p className={`text-[13px] mt-0.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                {lang === 'es' ? activeConfig?.description : activeConfig?.descriptionEn}
              </p>
            </div>

            {/* Instructions card */}
            {activeConfig?.instructions && (
              <div className={`rounded-xl p-4 flex gap-3 ${isDark ? 'bg-white/[0.03] border border-white/10' : 'bg-black/[0.02] border border-black/8'}`}>
                <Info size={16} className={`shrink-0 mt-0.5 ${isDark ? 'text-white/25' : 'text-black/25'}`} />
                <div>
                  <p className={`text-[11px] font-bold uppercase tracking-[1px] mb-1 ${isDark ? 'text-white/35' : 'text-black/35'}`}>
                    {L('Instrucciones', 'Instructions')}
                  </p>
                  <p className={`text-[12px] leading-relaxed ${isDark ? 'text-white/50' : 'text-black/50'}`}>
                    {activeConfig.instructions}
                  </p>
                </div>
              </div>
            )}

            {/* Step content — form or custom component */}
            <div className={card}>
              {activeConfig?.customComponent === 'StepSimulationTests' && !activeConfig.fields.length ? (
                <StepSimulationTests
                  certificationId={cert.id}
                  step={activeStep}
                  testResults={testResults.filter(t => t.step === activeStep)}
                  onRunTests={onRunTests}
                  isDark={isDark}
                  lang={lang}
                />
              ) : activeConfig?.customComponent === 'StepFinalized' ? (
                <StepFinalized
                  certification={cert}
                  stepData={stepData}
                  allStepsComplete={allComplete}
                  isDark={isDark}
                  lang={lang}
                />
              ) : activeConfig?.customComponent === 'StepSimulationTests' && activeConfig.fields.length ? (
                // Steps like 9 that have both test results AND fields
                <div className="space-y-6">
                  <StepSimulationTests
                    certificationId={cert.id}
                    step={activeStep}
                    testResults={testResults.filter(t => t.step === activeStep)}
                    onRunTests={onRunTests}
                    isDark={isDark}
                    lang={lang}
                  />
                  <div className={`border-t pt-5 ${isDark ? 'border-white/10' : 'border-black/10'}`}>
                    <WizardStepForm
                      config={activeConfig}
                      data={activeData}
                      onChange={handleFieldChange}
                      onFileUpload={handleFileUpload}
                      isDark={isDark}
                      lang={lang}
                    />
                  </div>
                </div>
              ) : activeConfig?.fields?.length ? (
                <WizardStepForm
                  config={activeConfig}
                  data={activeData}
                  onChange={handleFieldChange}
                  onFileUpload={handleFileUpload}
                  isDark={isDark}
                  lang={lang}
                />
              ) : (
                <p className={`text-[12px] py-4 text-center ${isDark ? 'text-white/25' : 'text-black/25'}`}>
                  {L('Sin campos configurados para este paso.', 'No fields configured for this step.')}
                </p>
              )}
            </div>

            {/* Step notes */}
            {activeStep <= 14 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <MessageSquare size={14} className={isDark ? 'text-white/30' : 'text-black/30'} />
                  <p className={`text-[13px] font-bold ${isDark ? 'text-white/60' : 'text-black/60'}`}>
                    {L('Notas del Paso', 'Step Notes')}
                    {stepNotes.length > 0 && (
                      <span className={`ml-1.5 text-[11px] font-normal ${isDark ? 'text-white/30' : 'text-black/30'}`}>
                        ({stepNotes.length})
                      </span>
                    )}
                  </p>
                </div>
                <CertNotes
                  notes={stepNotes}
                  certId={cert.id}
                  token={getToken?.()}
                  onNoteAdded={onAddNote}
                  isDark={isDark}
                  lang={lang}
                />
              </div>
            )}

            {/* Complete / Uncomplete button */}
            <div className={`flex items-center gap-3 pt-2 border-t ${isDark ? 'border-white/10' : 'border-black/10'}`}>
              {currentStepComplete ? (
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleUncomplete}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[12px] font-bold border transition-colors ${
                    isDark ? 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10' : 'bg-black/5 text-black/60 border-black/10 hover:bg-black/10'
                  }`}
                >
                  {L('Desmarcar Completo', 'Unmark Complete')}
                </motion.button>
              ) : (
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  whileHover={canComplete ? { scale: 1.02 } : {}}
                  onClick={handleComplete}
                  disabled={!canComplete || completing}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[12px] font-bold bg-[#b3001e] text-white hover:bg-[#c8002a] disabled:opacity-30 disabled:cursor-not-allowed transition-colors shadow-lg shadow-[#b3001e]/20"
                >
                  {completing ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      {L('Guardando...', 'Saving...')}
                    </span>
                  ) : (
                    <>
                      <CheckCircle2 size={14} />
                      {L('Marcar Completo', 'Mark Complete')}
                    </>
                  )}
                </motion.button>
              )}

              {!canComplete && !currentStepComplete && (
                <p className={`text-[11px] ${isDark ? 'text-white/25' : 'text-black/25'}`}>
                  {L('Complete los campos requeridos para continuar.', 'Fill required fields to continue.')}
                </p>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
