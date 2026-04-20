import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, ShieldCheck, ShieldAlert, X, CheckCircle2, Ban, Clock } from 'lucide-react'
import { listContainer, listItem } from '../motion'

const STATUS_BADGE_LIGHT = {
  pending:  'bg-amber-500/10 text-amber-600 border-amber-500/30',
  approved: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  rejected: 'bg-[#b3001e]/10 text-[#b3001e] border-[#b3001e]/25',
  expired:  'bg-black/5 text-black/40 border-black/10',
}
const STATUS_BADGE_DARK = {
  pending:  'bg-amber-500/10 text-amber-400 border-amber-500/30',
  approved: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  rejected: 'bg-[#b3001e]/15 text-[#b3001e] border-[#b3001e]/30',
  expired:  'bg-white/5 text-white/40 border-white/10',
}

const REFRESH_MS = 30000

export default function LicenseRebinds({ getToken, isDark, lang }) {
  const L = (es, en) => lang === 'es' ? es : en
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [filter, setFilter] = useState('pending')
  const [busy, setBusy] = useState({})
  const timerRef = useRef(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setLoadErr('')
    try {
      const token = getToken()
      const resp = await fetch(`/api/panel?action=rebind_requests&status=${filter}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      if (resp.ok) setRows((await resp.json()).data || [])
      else setLoadErr(L('Error al cargar solicitudes', 'Error loading requests'))
    } catch {
      setLoadErr(L('Error al cargar solicitudes', 'Error loading requests'))
    }
    if (!silent) setLoading(false)
  }, [filter, getToken, lang])

  useEffect(() => { load(false) }, [load])

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') load(true)
    }, REFRESH_MS)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [load])

  async function act(id, approve) {
    setBusy(b => ({ ...b, [id]: true }))
    try {
      const token = getToken()
      const action = approve ? 'approve_rebind' : 'reject_rebind'
      const resp = await fetch(`/api/panel?action=${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ id }),
      })
      if (!resp.ok) {
        const r = await resp.json().catch(() => ({}))
        alert(r.error || L('No se pudo procesar', 'Could not process'))
      }
      await load(true)
    } finally {
      setBusy(b => { const n = { ...b }; delete n[id]; return n })
    }
  }

  const STATUS_BADGE = isDark ? STATUS_BADGE_DARK : STATUS_BADGE_LIGHT
  const tableBase = isDark ? 'bg-white/[0.03] border border-white/10' : 'bg-white border border-black/10 shadow-sm'

  const FILTERS = [
    { key: 'pending',  label: L('Pendientes', 'Pending') },
    { key: 'approved', label: L('Aprobadas', 'Approved') },
    { key: 'rejected', label: L('Rechazadas', 'Rejected') },
    { key: 'all',      label: L('Todas', 'All') },
  ]

  const short = (h) => {
    if (!h) return '—'
    const s = String(h)
    return s.length <= 6 ? s : `...${s.slice(-6)}`
  }
  const fmtDate = (d) => d ? new Date(d).toLocaleString(lang === 'es' ? 'es-DO' : 'en-US', {
    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }) : '—'

  const pendingCount = filter === 'pending' ? rows.length : null

  return (
    <div className="p-6 md:p-8 space-y-5">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex items-center justify-between flex-wrap gap-3"
      >
        <div>
          <h1 className={`text-[24px] font-black tracking-tight flex items-center gap-2.5 ${isDark ? 'text-white' : 'text-black'}`}>
            <ShieldAlert size={22} className="text-[#b3001e]" />
            {L('Rebind de Equipos', 'Machine Rebind Requests')}
          </h1>
          <p className={`text-[12px] mt-0.5 flex items-center gap-1.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>
            <Clock size={11} />
            {rows.length} {L('resultado(s)', 'result(s)')} · {L('actualiza cada 30s', 'refreshes every 30s')}
          </p>
        </div>
      </motion.div>

      {/* Filter chips */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.06 }}
        className="flex gap-1 flex-wrap"
      >
        {FILTERS.map(f => (
          <motion.button
            key={f.key}
            whileTap={{ scale: 0.95 }}
            onClick={() => setFilter(f.key)}
            className={`relative px-3.5 py-1.5 rounded-full text-[11px] font-bold transition-colors ${
              filter === f.key
                ? 'text-white'
                : isDark ? 'text-white/40 hover:text-white/70' : 'text-black/40 hover:text-black/70'
            }`}
          >
            {filter === f.key && (
              <motion.div
                layoutId="rebindFilterPill"
                className="absolute inset-0 rounded-full bg-[#b3001e]"
                transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              />
            )}
            <span className="relative">{f.label}</span>
          </motion.button>
        ))}
      </motion.div>

      {loading ? (
        <div className="flex justify-center py-16">
          <motion.div className="flex gap-1.5">
            {[0, 1, 2].map(i => (
              <motion.span
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-[#b3001e]"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
              />
            ))}
          </motion.div>
        </div>
      ) : loadErr ? (
        <div className="py-12 text-center text-[13px] text-[#b3001e]">{loadErr}</div>
      ) : (
        <div className={`rounded-2xl overflow-hidden ${tableBase}`}>
          {/* Desktop table header */}
          <div className={`hidden lg:flex items-center px-5 py-3 border-b text-[10px] font-bold uppercase tracking-[1.2px] ${
            isDark ? 'bg-white/[0.02] border-white/10 text-white/30' : 'bg-black/[0.02] border-black/5 text-black/35'
          }`}>
            <span className="w-36">{L('Clave', 'Key')}</span>
            <span className="flex-1">{L('Cliente', 'Client')}</span>
            <span className="w-28">{L('HWID actual', 'Current HWID')}</span>
            <span className="w-28">{L('HWID nuevo', 'New HWID')}</span>
            <span className="w-28">IP</span>
            <span className="w-28">{L('Creada', 'Created')}</span>
            <span className="w-28">{L('Expira', 'Expires')}</span>
            <span className="w-24 text-center">{L('Estado', 'Status')}</span>
            <span className="w-40 text-right">{L('Acciones', 'Actions')}</span>
          </div>

          {rows.length === 0 ? (
            <div className={`py-16 text-center text-[12px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#b3001e]/10 border border-[#b3001e]/20 mb-3">
                <ShieldCheck size={20} className="text-[#b3001e]" />
              </div>
              <p>{L('Sin solicitudes.', 'No requests.')}</p>
            </div>
          ) : (
            <motion.div variants={listContainer} initial="initial" animate="animate">
              {rows.map(r => {
                const biz = r.licenses?.businesses
                const key = r.licenses?.license_key || '—'
                const shortKey = key.length > 14 ? `${key.slice(0, 8)}...${key.slice(-4)}` : key
                const rowBusy = !!busy[r.id]
                const badgeCls = STATUS_BADGE[r.status] || STATUS_BADGE.expired
                const isPending = r.status === 'pending'

                return (
                  <motion.div
                    key={r.id}
                    variants={listItem}
                    className={`border-b last:border-0 transition-colors ${
                      isDark ? 'border-white/5 hover:bg-white/[0.04]' : 'border-black/5 hover:bg-[#b3001e]/[0.03]'
                    }`}
                  >
                    {/* Desktop row */}
                    <div className="hidden lg:flex items-center px-5 py-3.5">
                      <span className={`w-36 text-[11px] font-mono ${isDark ? 'text-white/70' : 'text-black/70'}`} title={key}>{shortKey}</span>
                      <div className="flex-1 min-w-0 pr-3">
                        <p className={`text-[13px] font-semibold truncate ${isDark ? 'text-white' : 'text-black'}`}>{biz?.name || '—'}</p>
                        <p className={`text-[11px] truncate ${isDark ? 'text-white/40' : 'text-black/40'}`}>{biz?.rnc || ''}</p>
                      </div>
                      <span className={`w-28 text-[11px] font-mono ${isDark ? 'text-white/60' : 'text-black/60'}`} title={r.current_hwid || ''}>{short(r.current_hwid)}</span>
                      <span className="w-28 text-[11px] font-mono text-amber-500" title={r.requested_hwid || ''}>{short(r.requested_hwid)}</span>
                      <span className={`w-28 text-[11px] font-mono truncate ${isDark ? 'text-white/50' : 'text-black/50'}`} title={r.ip || ''}>{r.ip || '—'}</span>
                      <span className={`w-28 text-[11px] ${isDark ? 'text-white/50' : 'text-black/50'}`}>{fmtDate(r.requested_at || r.created_at)}</span>
                      <span className={`w-28 text-[11px] ${isDark ? 'text-white/40' : 'text-black/40'}`}>{fmtDate(r.expires_at)}</span>
                      <div className="w-24 flex justify-center">
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${badgeCls}`}>
                          {r.status}
                        </span>
                      </div>
                      <div className="w-40 flex justify-end gap-1.5">
                        {isPending ? (
                          <>
                            <motion.button
                              whileTap={{ scale: 0.95 }}
                              disabled={rowBusy}
                              onClick={() => act(r.id, true)}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-500 text-white disabled:opacity-50 hover:bg-emerald-600 transition-colors"
                            >
                              {rowBusy ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                              {L('Aprobar', 'Approve')}
                            </motion.button>
                            <motion.button
                              whileTap={{ scale: 0.95 }}
                              disabled={rowBusy}
                              onClick={() => act(r.id, false)}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-[#b3001e] text-white disabled:opacity-50 hover:bg-[#c8002a] transition-colors"
                            >
                              <X size={11} />
                              {L('Rechazar', 'Reject')}
                            </motion.button>
                          </>
                        ) : (
                          <span className={`text-[11px] italic ${isDark ? 'text-white/30' : 'text-black/30'}`}>
                            {L('Resuelta', 'Resolved')}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Mobile card */}
                    <div className="lg:hidden px-4 py-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className={`text-[13px] font-semibold truncate ${isDark ? 'text-white' : 'text-black'}`}>{biz?.name || '—'}</p>
                          <p className={`text-[11px] font-mono truncate ${isDark ? 'text-white/40' : 'text-black/40'}`}>{shortKey}</p>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${badgeCls}`}>
                          {r.status}
                        </span>
                      </div>
                      <div className={`grid grid-cols-2 gap-2 text-[11px] font-mono ${isDark ? 'text-white/60' : 'text-black/60'}`}>
                        <p>
                          <span className={isDark ? 'text-white/30' : 'text-black/30'}>actual: </span>{short(r.current_hwid)}
                        </p>
                        <p className="text-amber-500">
                          <span className={isDark ? 'text-white/30' : 'text-black/30'}>nuevo: </span>{short(r.requested_hwid)}
                        </p>
                      </div>
                      <div className={`flex items-center justify-between text-[11px] ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                        <span>{fmtDate(r.requested_at || r.created_at)}</span>
                        <span>{L('Expira', 'Exp')}: {fmtDate(r.expires_at)}</span>
                      </div>
                      {isPending && (
                        <div className="flex gap-2 pt-1">
                          <motion.button
                            whileTap={{ scale: 0.94 }}
                            disabled={rowBusy}
                            onClick={() => act(r.id, true)}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold bg-emerald-500 text-white disabled:opacity-50"
                          >
                            {rowBusy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                            {L('Aprobar', 'Approve')}
                          </motion.button>
                          <motion.button
                            whileTap={{ scale: 0.94 }}
                            disabled={rowBusy}
                            onClick={() => act(r.id, false)}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold bg-[#b3001e] text-white disabled:opacity-50"
                          >
                            <Ban size={12} /> {L('Rechazar', 'Reject')}
                          </motion.button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )
              })}
            </motion.div>
          )}
        </div>
      )}
    </div>
  )
}
