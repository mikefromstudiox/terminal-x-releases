import { motion } from 'framer-motion'
import { CheckCircle2, ShieldCheck, Copy, ExternalLink, AlertTriangle } from 'lucide-react'
import { STEP_CONFIG } from './StepConfig'
import { listContainer, listItem } from '../../motion'

export default function StepFinalized({ certification, stepData = {}, allStepsComplete, isDark, lang }) {
  const L = (es, en) => lang === 'es' ? es : en
  const cert = certification || {}
  const stepsCompleted = cert.steps_completed || []

  const card = `rounded-2xl p-5 ${isDark ? 'bg-white/[0.03] border border-white/10' : 'bg-white border border-black/10 shadow-sm'}`
  const lbl = `text-[10px] font-bold uppercase tracking-[1.2px] ${isDark ? 'text-white/35' : 'text-black/35'}`
  const val = `text-[13px] font-medium ${isDark ? 'text-white/85' : 'text-black/85'}`

  const portalUrl = cert.portal_token ? `terminalxpos.com/cert/${cert.portal_token}` : null

  function copyPortalUrl() {
    if (portalUrl) navigator.clipboard?.writeText(`https://${portalUrl}`)
  }

  return (
    <div className="space-y-5">
      {/* Banner */}
      {allStepsComplete ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 24 }}
          className="rounded-2xl p-6 bg-emerald-500/10 border border-emerald-500/30 text-center"
        >
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 mb-3">
            <ShieldCheck size={24} className="text-emerald-400" />
          </div>
          <p className="text-[18px] font-black text-emerald-400">
            {L('Certificacion Completada', 'Certification Completed')}
          </p>
          <p className={`text-[13px] mt-1 ${isDark ? 'text-white/50' : 'text-black/50'}`}>
            {L('Todos los pasos han sido completados exitosamente.', 'All steps have been completed successfully.')}
          </p>
        </motion.div>
      ) : (
        <div className="rounded-2xl p-5 bg-amber-500/10 border border-amber-500/30">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-400" />
            <p className="text-[13px] font-bold text-amber-400">
              {L('Pasos incompletos', 'Incomplete steps')}
            </p>
          </div>
          <p className={`text-[12px] mt-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>
            {L(
              `Faltan ${15 - stepsCompleted.length} pasos por completar antes de finalizar.`,
              `${15 - stepsCompleted.length} steps remaining before finalization.`
            )}
          </p>
        </div>
      )}

      {/* Summary card */}
      <div className={card}>
        <p className={`text-[14px] font-bold mb-4 ${isDark ? 'text-white' : 'text-black'}`}>
          {L('Resumen de Certificacion', 'Certification Summary')}
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div><p className={lbl}>{L('Negocio', 'Business')}</p><p className={val}>{cert.business_name || '--'}</p></div>
          <div><p className={lbl}>RNC</p><p className={val}>{cert.rnc || '--'}</p></div>
          <div><p className={lbl}>{L('Paquete', 'Package')}</p><p className={val}>{cert.package_tier || '--'}</p></div>
          <div><p className={lbl}>{L('Estado', 'Status')}</p><p className={val}>{cert.status || '--'}</p></div>
          <div>
            <p className={lbl}>{L('Fecha Inicio', 'Start Date')}</p>
            <p className={val}>{cert.created_at ? new Date(cert.created_at).toLocaleDateString(lang === 'es' ? 'es-DO' : 'en-US') : '--'}</p>
          </div>
          <div>
            <p className={lbl}>{L('Pasos Completos', 'Steps Complete')}</p>
            <p className={val}>{stepsCompleted.length}/15</p>
          </div>
        </div>
      </div>

      {/* Step checklist */}
      <div className={card}>
        <p className={`text-[14px] font-bold mb-4 ${isDark ? 'text-white' : 'text-black'}`}>
          {L('Checklist de Pasos', 'Step Checklist')}
        </p>
        <motion.div variants={listContainer} initial="initial" animate="animate" className="space-y-1.5">
          {STEP_CONFIG.map((step) => {
            const completed = stepsCompleted.includes(step.step)
            const sd = stepData[step.step] || {}
            const completedDate = sd.completed_at || null

            return (
              <motion.div
                key={step.step}
                variants={listItem}
                className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-colors ${
                  completed
                    ? isDark ? 'bg-emerald-500/5' : 'bg-emerald-500/5'
                    : isDark ? 'bg-white/[0.02]' : 'bg-black/[0.02]'
                }`}
              >
                {completed ? (
                  <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                ) : (
                  <span className={`w-4 h-4 rounded-full border-2 shrink-0 ${isDark ? 'border-white/15' : 'border-black/15'}`} />
                )}
                <span className={`flex-1 text-[12px] font-medium ${
                  completed
                    ? isDark ? 'text-white/70' : 'text-black/70'
                    : isDark ? 'text-white/30' : 'text-black/30'
                }`}>
                  <span className={isDark ? 'text-white/20' : 'text-black/20'}>{step.step}.</span>{' '}
                  {lang === 'es' ? step.title : step.titleEn}
                </span>
                {completedDate && (
                  <span className={`text-[10px] ${isDark ? 'text-white/25' : 'text-black/25'}`}>
                    {new Date(completedDate).toLocaleDateString(lang === 'es' ? 'es-DO' : 'en-US')}
                  </span>
                )}
              </motion.div>
            )
          })}
        </motion.div>
      </div>

      {/* Portal URL */}
      {portalUrl && (
        <div className={card}>
          <p className={`text-[14px] font-bold mb-3 ${isDark ? 'text-white' : 'text-black'}`}>
            {L('Portal del Cliente', 'Client Portal')}
          </p>
          <div className="flex items-center gap-2">
            <code className={`flex-1 text-[12px] font-mono px-3 py-2 rounded-lg truncate ${
              isDark ? 'bg-white/5 text-white/60' : 'bg-black/5 text-black/60'
            }`}>
              https://{portalUrl}
            </code>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={copyPortalUrl}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold border transition-colors ${
                isDark ? 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10' : 'bg-black/5 text-black/60 border-black/10 hover:bg-black/10'
              }`}
            >
              <Copy size={12} />
              {L('Copiar', 'Copy')}
            </motion.button>
          </div>
        </div>
      )}

      {/* Production switch notes */}
      <div className={`rounded-2xl p-5 border-2 border-dashed ${isDark ? 'border-[#b3001e]/30 bg-[#b3001e]/5' : 'border-[#b3001e]/20 bg-[#b3001e]/5'}`}>
        <p className={`text-[13px] font-bold text-[#b3001e] mb-2`}>
          {L('Cambio a Produccion', 'Switch to Production')}
        </p>
        <ul className={`text-[12px] space-y-1 ${isDark ? 'text-white/50' : 'text-black/50'}`}>
          <li>1. {L('Cambiar dgii_environment de "certecf" a "ecf" en la configuracion del cliente', 'Change dgii_environment from "certecf" to "ecf" in client settings')}</li>
          <li>2. {L('Verificar que el certificado .p12 de produccion esta instalado', 'Verify production .p12 certificate is installed')}</li>
          <li>3. {L('Confirmar las URLs de receptor apuntan a produccion', 'Confirm receiver URLs point to production')}</li>
          <li>4. {L('Realizar una primera factura de prueba en produccion', 'Issue a first test invoice in production')}</li>
        </ul>
      </div>
    </div>
  )
}
