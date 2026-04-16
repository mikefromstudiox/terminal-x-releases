import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, Loader2, CheckCircle2, XCircle, Clock, RefreshCw } from 'lucide-react'
import { listContainer, listItem } from '../../motion'

const STATUS_BADGE = {
  accepted: { icon: CheckCircle2, cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  rejected: { icon: XCircle, cls: 'bg-[#b3001e]/10 text-[#b3001e] border-[#b3001e]/30' },
  pending:  { icon: Clock, cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
}

export default function StepSimulationTests({ certificationId, step, testResults = [], onRunTests, isDark, lang }) {
  const L = (es, en) => lang === 'es' ? es : en
  const [running, setRunning] = useState(false)
  const pollRef = useRef(null)

  const accepted = testResults.filter(t => t.status === 'accepted').length
  const total = testResults.length
  const hasRunning = testResults.some(t => t.status === 'pending')

  useEffect(() => {
    if (hasRunning && onRunTests) {
      pollRef.current = setInterval(() => {
        onRunTests(step, true) // poll=true
      }, 3000)
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [hasRunning, step])

  async function handleRun() {
    setRunning(true)
    try {
      await onRunTests?.(step, false)
    } catch {}
    setRunning(false)
  }

  const card = `rounded-2xl p-5 ${isDark ? 'bg-white/[0.03] border border-white/10' : 'bg-white border border-black/10 shadow-sm'}`

  return (
    <div className="space-y-4">
      {/* Run button */}
      <div className="flex items-center gap-3">
        <motion.button
          whileTap={{ scale: 0.96 }}
          whileHover={{ scale: 1.02 }}
          onClick={handleRun}
          disabled={running || hasRunning}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[12px] font-bold bg-[#b3001e] text-white hover:bg-[#c8002a] disabled:opacity-40 transition-colors shadow-lg shadow-[#b3001e]/20"
        >
          {running || hasRunning ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {L('Ejecutando...', 'Running...')}
            </>
          ) : (
            <>
              <Play size={14} />
              {L(`Ejecutar Pruebas Paso ${step}`, `Run Tests Step ${step}`)}
            </>
          )}
        </motion.button>

        {total > 0 && (
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={handleRun}
            disabled={running || hasRunning}
            className={`p-2 rounded-xl transition-colors ${isDark ? 'text-white/30 hover:text-white/60 hover:bg-white/5' : 'text-black/30 hover:text-black/60 hover:bg-black/5'}`}
            title={L('Re-ejecutar', 'Re-run')}
          >
            <RefreshCw size={14} />
          </motion.button>
        )}
      </div>

      {/* Progress bar when running */}
      <AnimatePresence>
        {hasRunning && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className={`h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-white/10' : 'bg-black/10'}`}>
              <motion.div
                className="h-full rounded-full bg-[#b3001e]"
                initial={{ width: '10%' }}
                animate={{ width: `${Math.max(10, (accepted / Math.max(total, 1)) * 100)}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
            <p className={`text-[11px] mt-1.5 ${isDark ? 'text-white/30' : 'text-black/30'}`}>
              {L('Procesando pruebas...', 'Processing tests...')}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Results table */}
      {total > 0 && (
        <div className={`rounded-2xl overflow-hidden ${isDark ? 'bg-white/[0.03] border border-white/10' : 'bg-white border border-black/10 shadow-sm'}`}>
          {/* Header */}
          <div className={`hidden md:flex items-center px-5 py-3 border-b text-[10px] font-bold uppercase tracking-[1.2px] ${
            isDark ? 'bg-white/[0.02] border-white/10 text-white/30' : 'bg-black/[0.02] border-black/5 text-black/35'
          }`}>
            <span className="w-10">#</span>
            <span className="flex-1">{L('Nombre', 'Name')}</span>
            <span className="w-32">e-NCF</span>
            <span className="w-36">TrackId</span>
            <span className="w-24">{L('Estado', 'Status')}</span>
            <span className="w-28">{L('Fecha', 'Date')}</span>
          </div>

          <motion.div variants={listContainer} initial="initial" animate="animate">
            {testResults.map((test, i) => {
              const badge = STATUS_BADGE[test.status] || STATUS_BADGE.pending
              const Icon = badge.icon
              return (
                <motion.div
                  key={test.id || i}
                  variants={listItem}
                  className={`flex flex-col md:flex-row md:items-center px-5 py-3 border-b last:border-0 transition-colors ${
                    isDark ? 'border-white/5 hover:bg-white/[0.04]' : 'border-black/5 hover:bg-[#b3001e]/[0.03]'
                  }`}
                >
                  <span className={`w-10 text-[12px] font-bold ${isDark ? 'text-white/30' : 'text-black/30'}`}>{i + 1}</span>
                  <span className={`flex-1 text-[13px] font-medium truncate ${isDark ? 'text-white/85' : 'text-black/85'}`}>
                    {test.name || test.ecf_type || '--'}
                  </span>
                  <span className={`w-32 text-[11px] font-mono ${isDark ? 'text-white/50' : 'text-black/50'}`}>
                    {test.encf || '--'}
                  </span>
                  <span className={`w-36 text-[11px] font-mono truncate ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                    {test.track_id || '--'}
                  </span>
                  <span className="w-24">
                    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${badge.cls}`}>
                      <Icon size={10} />
                      {test.status === 'accepted' ? L('Aceptado', 'Accepted')
                        : test.status === 'rejected' ? L('Rechazado', 'Rejected')
                        : L('Pendiente', 'Pending')}
                    </span>
                  </span>
                  <span className={`w-28 text-[11px] ${isDark ? 'text-white/35' : 'text-black/35'}`}>
                    {test.created_at ? new Date(test.created_at).toLocaleDateString(lang === 'es' ? 'es-DO' : 'en-US') : '--'}
                  </span>
                </motion.div>
              )
            })}
          </motion.div>
        </div>
      )}

      {/* Summary */}
      {total > 0 && (
        <div className={`flex items-center gap-2 text-[13px] font-medium ${isDark ? 'text-white/60' : 'text-black/60'}`}>
          <CheckCircle2 size={14} className={accepted === total && total > 0 ? 'text-emerald-400' : 'text-amber-400'} />
          {accepted}/{total} {L('pruebas aprobadas', 'tests passed')}
        </div>
      )}

      {total === 0 && !running && (
        <div className={`py-8 text-center text-[12px] ${isDark ? 'text-white/25' : 'text-black/25'}`}>
          <div className={`inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-3 ${isDark ? 'bg-white/5 border border-white/10' : 'bg-black/5 border border-black/10'}`}>
            <Play size={18} className={isDark ? 'text-white/20' : 'text-black/20'} />
          </div>
          <p>{L('No hay resultados de pruebas aun.', 'No test results yet.')}</p>
          <p className="mt-1">{L('Presione el boton para ejecutar las pruebas.', 'Press the button to run tests.')}</p>
        </div>
      )}
    </div>
  )
}
