import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Building2, KeyRound, AlertTriangle, TrendingUp, Clock, Ban, CheckCircle2, ShoppingCart, UserX, Activity, WifiOff, Zap, Megaphone, Loader2, Gift, Mail, MailX } from 'lucide-react'
import { useLang } from '../../i18n'
import { listContainer, listItem, cardHover, AnimatedNumber } from '../motion'

// Status palette — semantic only, restrained, brand-adjacent.
// emerald/amber/red kept ONLY for status cues, at low-intensity bg.
const FEED_META = {
  signup:    { icon: Building2,    tone: 'brand' },
  first_sale:{ icon: ShoppingCart, tone: 'ok' },
  expiring:  { icon: Clock,        tone: 'warn' },
  inactive:  { icon: UserX,        tone: 'bad' },
  suspended: { icon: Ban,          tone: 'bad' },
  activated: { icon: CheckCircle2, tone: 'ok' },
}

const TONE = {
  brand: { ic: 'text-[#b3001e]',     bg: 'bg-[#b3001e]/10',   br: 'border-[#b3001e]/25' },
  ok:    { ic: 'text-emerald-500',   bg: 'bg-emerald-500/10', br: 'border-emerald-500/25' },
  warn:  { ic: 'text-amber-500',     bg: 'bg-amber-500/10',   br: 'border-amber-500/25' },
  bad:   { ic: 'text-[#b3001e]',     bg: 'bg-[#b3001e]/10',   br: 'border-[#b3001e]/25' },
}

// 2026-05-03 (peppy-greeting-popcorn) — color palette per error category so
// the Recent Errors list scans visually. Brand-aligned (red/amber/sky/zinc).
const CATEGORY_COLORS = {
  chunk_load:      { bg: 'bg-amber-500/10',   text: 'text-amber-400',   border: 'border-amber-500/30',   activeBg: 'bg-amber-500',   activeText: 'text-black', activeBorder: 'border-amber-500' },
  lazy_resolution: { bg: 'bg-amber-500/10',   text: 'text-amber-400',   border: 'border-amber-500/30',   activeBg: 'bg-amber-500',   activeText: 'text-black', activeBorder: 'border-amber-500' },
  react_invariant: { bg: 'bg-[#b3001e]/15',   text: 'text-[#b3001e]',   border: 'border-[#b3001e]/40',   activeBg: 'bg-[#b3001e]',   activeText: 'text-white', activeBorder: 'border-[#b3001e]' },
  api_shape:       { bg: 'bg-[#b3001e]/15',   text: 'text-[#b3001e]',   border: 'border-[#b3001e]/40',   activeBg: 'bg-[#b3001e]',   activeText: 'text-white', activeBorder: 'border-[#b3001e]' },
  tdz:             { bg: 'bg-[#b3001e]/15',   text: 'text-[#b3001e]',   border: 'border-[#b3001e]/40',   activeBg: 'bg-[#b3001e]',   activeText: 'text-white', activeBorder: 'border-[#b3001e]' },
  tdz_or_undefined:{ bg: 'bg-[#b3001e]/15',   text: 'text-[#b3001e]',   border: 'border-[#b3001e]/40',   activeBg: 'bg-[#b3001e]',   activeText: 'text-white', activeBorder: 'border-[#b3001e]' },
  rls_denial:      { bg: 'bg-[#b3001e]/15',   text: 'text-[#b3001e]',   border: 'border-[#b3001e]/40',   activeBg: 'bg-[#b3001e]',   activeText: 'text-white', activeBorder: 'border-[#b3001e]' },
  routing:         { bg: 'bg-sky-500/15',     text: 'text-sky-400',     border: 'border-sky-500/30',     activeBg: 'bg-sky-500',     activeText: 'text-white', activeBorder: 'border-sky-500' },
  boot:            { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30', activeBg: 'bg-emerald-500', activeText: 'text-black', activeBorder: 'border-emerald-500' },
  network:         { bg: 'bg-amber-500/10',   text: 'text-amber-400',   border: 'border-amber-500/30',   activeBg: 'bg-amber-500',   activeText: 'text-black', activeBorder: 'border-amber-500' },
  auth:            { bg: 'bg-amber-500/10',   text: 'text-amber-400',   border: 'border-amber-500/30',   activeBg: 'bg-amber-500',   activeText: 'text-black', activeBorder: 'border-amber-500' },
  other:           { bg: 'bg-zinc-500/10',    text: 'text-zinc-400',    border: 'border-zinc-500/30',    activeBg: 'bg-zinc-500',    activeText: 'text-white', activeBorder: 'border-zinc-500' },
}
function categoryStyle(cat) { return CATEGORY_COLORS[cat] || CATEGORY_COLORS.other }

function timeAgo(dateStr, lang) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}${lang === 'es' ? 'd' : 'd'}`
}

function SkeletonBar({ className = '' }) {
  return (
    <motion.div
      className={`rounded-lg bg-gradient-to-r from-transparent via-[#b3001e]/10 to-transparent bg-[length:200%_100%] ${className}`}
      animate={{ backgroundPosition: ['200% 0', '-200% 0'] }}
      transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
    />
  )
}

export default function Dashboard({ getToken, refreshToken, isDark }) {
  const { lang } = useLang()
  const navigate = useNavigate()
  const L = (es, en) => lang === 'es' ? es : en
  const [stats, setStats] = useState(null)
  const [feed, setFeed] = useState([])
  const [loyalty, setLoyalty] = useState(null)
  const [recentErrors, setRecentErrors] = useState([])
  const [errorsLoading, setErrorsLoading] = useState(false)
  // 2026-05-17 — Deploy Health (Layer 1, post-ff65749 incident). Surfaces the
  // most recent /api/panel?action=cron_deploy_smoke run + history. Red banner
  // on any failure; click expands the failing checks.
  const [smokeHistory, setSmokeHistory] = useState([])
  const [smokeExpanded, setSmokeExpanded] = useState(false)
  // Layer 3 — Cron Health (downstream side-effect verifier). Catches the silent
  // 200-but-no-output failures that Layer 1 (HTTP) and Layer 2 (throws) miss.
  const [cronHealth, setCronHealth] = useState([])
  const [cronHealthExpanded, setCronHealthExpanded] = useState(false)
  // Layer 4 — Flow Drift (end-to-end user-action assertions). Catches the
  // queue.ticket_id NULL → markPaid silent-skip class of bug that Layers 1/2/3
  // cannot see. Cron at /api/panel?action=cron_flow_drift_smoke every 15 min.
  const [flowDrift, setFlowDrift] = useState([])
  const [flowDriftExpanded, setFlowDriftExpanded] = useState(false)
  // Layer 6 — MEGA SMOKE. ~100 scenarios covering every silent-bug class that
  // has bitten this codebase. Cron at /api/panel?action=cron_mega_smoke every
  // 15 min. Card shows pass count + click-to-expand failures.
  const [megaSmoke, setMegaSmoke] = useState([])
  const [megaSmokeExpanded, setMegaSmokeExpanded] = useState(false)
  // Layer 5 — Claude Triage. Anthropic-powered RCA on every critical incident.
  const [triage, setTriage] = useState({ data: [], stats: null })
  const [triageExpanded, setTriageExpanded] = useState(false)
  const [showResolvedErrors, setShowResolvedErrors] = useState(false)
  const [catFilter, setCatFilter] = useState(null) // null | category string
  const [tierFilter, setTierFilter] = useState(null)   // null | 'gold' | 'silver' | 'bronze'
  const [digest, setDigest] = useState(null)
  const [loading, setLoading] = useState(true)
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkResult, setBulkResult] = useState(null)

  useEffect(() => { load() }, [])
  useEffect(() => { reloadLoyalty() }, [tierFilter])
  useEffect(() => { reloadErrors() }, [showResolvedErrors])
  // 2026-05-03 (peppy-greeting-popcorn) — auto-refresh errors every 30s so Mike
  // sees client problems without F5. Tab visibility-aware: pauses when the
  // dashboard is in a background tab.
  useEffect(() => {
    let stopped = false
    const tick = () => { if (!stopped && document.visibilityState === 'visible') reloadErrors() }
    const id = setInterval(tick, 30_000)
    return () => { stopped = true; clearInterval(id) }
  }, [showResolvedErrors])

  async function reloadLoyalty() {
    try {
      let token = await refreshToken()
      if (!token) token = getToken()
      const headers = { 'Authorization': `Bearer ${token}` }
      const url = tierFilter
        ? `/api/panel?action=loyalty-overview&tier=${encodeURIComponent(tierFilter)}`
        : '/api/panel?action=loyalty-overview'
      const r = await fetch(url, { headers })
      if (r.ok) setLoyalty(await r.json())
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'dashboard.tick' }) } catch {}}
  }

  async function load() {
    setLoading(true)
    try {
      let token = await refreshToken()
      if (!token) token = getToken()
      const headers = { 'Authorization': `Bearer ${token}` }
      const [statsResp, feedResp, loyaltyResp, digestResp, errResp, smokeResp, cronHealthResp, flowDriftResp, triageResp, megaSmokeResp] = await Promise.all([
        fetch('/api/panel?action=stats', { headers }),
        fetch('/api/panel?action=activity_feed', { headers }),
        fetch('/api/panel?action=loyalty-overview', { headers }),
        fetch('/api/panel?action=digest-health', { headers }),
        fetch('/api/panel?action=errors_list&unresolved=1&limit=50', { headers }),
        fetch('/api/panel?action=deploy_smoke_history&limit=20', { headers }),
        fetch('/api/panel?action=cron_health_history&limit=20', { headers }),
        fetch('/api/panel?action=flow_drift_history&limit=20', { headers }),
        fetch('/api/panel?action=claude_triage_history&limit=20', { headers }),
        fetch('/api/panel?action=mega_smoke_history&limit=20', { headers }),
      ])
      if (statsResp.ok) setStats(await statsResp.json())
      if (feedResp.ok) { const f = await feedResp.json(); setFeed(f.data || []) }
      if (loyaltyResp.ok) setLoyalty(await loyaltyResp.json())
      if (digestResp.ok) setDigest(await digestResp.json())
      if (errResp.ok) setRecentErrors(((await errResp.json()).data) || [])
      if (smokeResp.ok) setSmokeHistory(((await smokeResp.json()).data) || [])
      if (cronHealthResp.ok) setCronHealth(((await cronHealthResp.json()).data) || [])
      if (flowDriftResp.ok) setFlowDrift(((await flowDriftResp.json()).data) || [])
      if (megaSmokeResp.ok) setMegaSmoke(((await megaSmokeResp.json()).data) || [])
      if (triageResp.ok) {
        const j = await triageResp.json()
        setTriage({ data: j.data || [], stats: j.stats || null })
      }
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'dashboard.tick' }) } catch {} console.error('Dashboard load:', e) }
    setLoading(false)
  }

  async function reloadErrors() {
    setErrorsLoading(true)
    try {
      let token = await refreshToken()
      if (!token) token = getToken()
      const url = `/api/panel?action=errors_list&limit=50${showResolvedErrors ? '' : '&unresolved=1'}`
      const r = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
      if (r.ok) setRecentErrors(((await r.json()).data) || [])
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'dashboard.tick' }) } catch {}}
    setErrorsLoading(false)
  }

  // 2026-05-03 (peppy-greeting-popcorn Phase 3) — on-demand sourcemap decode.
  // The async decode in handleReportError sometimes loses to Vercel cold-shut;
  // this lets Mike click 'Decodificar' on any error to fill the gap.
  async function decodeStack(errorId) {
    try {
      let token = await refreshToken()
      if (!token) token = getToken()
      const r = await fetch('/api/panel?action=errors_decode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ id: errorId }),
      })
      if (!r.ok) return
      const j = await r.json()
      if (!j.data?.decoded_stack) return
      // Mutate the in-memory list so the row re-renders with the decoded frames.
      setRecentErrors(prev => prev.map(e =>
        e.id === errorId
          ? { ...e, metadata: { ...(e.metadata || {}), decoded_stack: j.data.decoded_stack } }
          : e
      ))
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'dashboard.reloadloyalty' }) } catch {}}
  }

  async function runBulkAction(type, actionData = {}) {
    setBulkLoading(true)
    setBulkResult(null)
    try {
      let token = await refreshToken()
      if (!token) token = getToken()
      const resp = await fetch('/api/panel?action=bulk_action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ type, data: actionData }),
      })
      const result = await resp.json()
      setBulkResult(result)
      if (result.ok) load()
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'dashboard.reloadloyalty' }) } catch {}}
    setBulkLoading(false)
  }

  const cardBase = isDark
    ? 'bg-white/[0.03] border border-white/10 hover:border-[#b3001e]/40'
    : 'bg-white border border-black/10 hover:border-[#b3001e]/40 shadow-sm'

  if (loading) {
    return (
      <div className="p-6 md:p-8 space-y-6">
        <div>
          <SkeletonBar className="h-7 w-48 mb-2" />
          <SkeletonBar className="h-3 w-64" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={`rounded-2xl px-5 py-5 ${cardBase}`}>
              <SkeletonBar className="h-10 w-10 rounded-xl mb-3" />
              <SkeletonBar className="h-3 w-20 mb-2" />
              <SkeletonBar className="h-7 w-16" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!stats) {
    return <div className={`p-8 text-center text-[13px] ${isDark ? 'text-white/40' : 'text-black/40'}`}>{L('Error al cargar datos.', 'Error loading data.')}</div>
  }

  const cards = [
    { icon: Building2,     label: L('Clientes totales', 'Total Clients'),    value: stats.totalClients,       tone: 'brand' },
    { icon: KeyRound,      label: L('Licencias activas', 'Active Licenses'), value: stats.activeLicenses,     tone: 'ok' },
    { icon: AlertTriangle, label: L('Suspendidas', 'Suspended'),             value: stats.suspendedLicenses,  tone: 'warn' },
    { icon: TrendingUp,    label: L('Expiradas', 'Expired'),                 value: stats.expiredLicenses,    tone: 'bad' },
  ]

  const feedLabels = {
    signup:     L('Nuevo registro', 'New signup'),
    first_sale: L('Primera venta', 'First sale'),
    expiring:   L('Licencia por vencer', 'License expiring'),
    inactive:   L('Sin actividad', 'Inactive'),
    suspended:  L('Licencia suspendida', 'License suspended'),
    activated:  L('Licencia activada', 'License activated'),
  }

  return (
    <div className="p-6 md:p-8 space-y-7">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <h1 className={`text-[26px] font-black tracking-tight ${isDark ? 'text-white' : 'text-black'}`}>Dashboard</h1>
        <p className={`text-[12px] mt-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>
          {L('Vista general de Terminal X', 'Terminal X Overview')}
        </p>
      </motion.div>

      {/* Deploy Health — Layer 1 post-ff65749 incident surfacing. Catches the
          exact silent-failure classes that took prod down for 6h on 2026-05-17. */}
      {(() => {
        const latest = smokeHistory[0]
        const failing = latest && latest.failed_count > 0
        if (!latest) {
          return (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className={`rounded-2xl p-4 transition-colors ${cardBase} flex items-center justify-between`}>
              <div className="flex items-center gap-3">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400" />
                <p className={`text-[13px] font-semibold ${isDark ? 'text-white/80' : 'text-black/80'}`}>
                  {L('Deploy Health — sin datos aún (cron corre cada 15 min).', 'Deploy Health — no data yet (cron runs every 15 min).')}
                </p>
              </div>
            </motion.div>
          )
        }
        const ts = new Date(latest.ran_at)
        const minsAgo = Math.max(0, Math.round((Date.now() - ts.getTime()) / 60000))
        const dotColor = failing ? 'bg-red-500' : 'bg-emerald-500'
        const bgTone = failing
          ? (isDark ? 'border-red-500/40 bg-red-500/10' : 'border-red-500/40 bg-red-500/5')
          : ''
        return (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className={`rounded-2xl p-5 transition-colors border ${cardBase} ${bgTone}`}>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${dotColor} ${failing ? 'animate-pulse' : ''}`} />
                <div>
                  <p className={`text-[14px] font-bold ${isDark ? 'text-white' : 'text-black'}`}>
                    {failing
                      ? L(`Deploy Health: ${latest.failed_count} fallo${latest.failed_count === 1 ? '' : 's'} de ${latest.total_count}`,
                            `Deploy Health: ${latest.failed_count} failure${latest.failed_count === 1 ? '' : 's'} of ${latest.total_count}`)
                      : L(`Deploy Health: ${latest.passed_count}/${latest.total_count} OK`,
                            `Deploy Health: ${latest.passed_count}/${latest.total_count} OK`)}
                  </p>
                  <p className={`text-[11px] mt-0.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                    {L(`Hace ${minsAgo} min · ${latest.duration_ms || 0}ms · ${latest.source || 'cron'}`,
                       `${minsAgo}m ago · ${latest.duration_ms || 0}ms · ${latest.source || 'cron'}`)}
                    {latest.bundle_hash ? ` · ${latest.bundle_hash.slice(0, 24)}` : ''}
                  </p>
                </div>
              </div>
              {failing && (
                <button onClick={() => setSmokeExpanded(s => !s)}
                  className={`text-[11px] font-bold px-3 py-1 rounded-full border transition-colors ${isDark ? 'border-red-400/40 text-red-300 hover:bg-red-500/10' : 'border-red-500/40 text-red-600 hover:bg-red-500/5'}`}>
                  {smokeExpanded ? L('Ocultar', 'Hide') : L('Ver fallos', 'Show failures')}
                </button>
              )}
            </div>
            {failing && smokeExpanded && Array.isArray(latest.failures) && (
              <div className="mt-3 space-y-1.5">
                {latest.failures.map((f, i) => (
                  <div key={i} className={`text-[11px] font-mono ${isDark ? 'text-white/70' : 'text-black/70'} pl-4 border-l-2 ${f.severity === 'warning' ? 'border-amber-400' : 'border-red-500'}`}>
                    <span className="font-bold">[{f.category}]</span> {f.check}
                    {f.expected ? <span className={isDark ? 'block text-white/40' : 'block text-black/40'}>expected: {String(f.expected).slice(0, 200)}</span> : null}
                    {f.actual ? <span className={isDark ? 'block text-white/40' : 'block text-black/40'}>actual: {String(f.actual).slice(0, 200)}</span> : null}
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )
      })()}

      {/* Cron Health — Layer 3 downstream side-effect verifier. Catches the
          silent 200-but-no-output failures that Layer 1 (HTTP) misses. Each cron
          has an expected business-side row (digest activity_log, dgii last_pull_at,
          anecf queue movement, smoke run insert) — if it's stale, we flag it. */}
      {(() => {
        const latest = cronHealth[0]
        const failing = latest && latest.failed_count > 0
        if (!latest) {
          return (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className={`rounded-2xl p-4 transition-colors ${cardBase} flex items-center justify-between`}>
              <div className="flex items-center gap-3">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400" />
                <p className={`text-[13px] font-semibold ${isDark ? 'text-white/80' : 'text-black/80'}`}>
                  {L('Cron Health — sin datos aún (verificador corre cada 30 min).', 'Cron Health — no data yet (verifier runs every 30 min).')}
                </p>
              </div>
            </motion.div>
          )
        }
        const ts = new Date(latest.ran_at)
        const minsAgo = Math.max(0, Math.round((Date.now() - ts.getTime()) / 60000))
        const dotColor = failing ? 'bg-red-500' : 'bg-emerald-500'
        const bgTone = failing
          ? (isDark ? 'border-red-500/40 bg-red-500/10' : 'border-red-500/40 bg-red-500/5')
          : ''
        return (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className={`rounded-2xl p-5 transition-colors border ${cardBase} ${bgTone}`}>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${dotColor} ${failing ? 'animate-pulse' : ''}`} />
                <div>
                  <p className={`text-[14px] font-bold ${isDark ? 'text-white' : 'text-black'}`}>
                    {failing
                      ? L(`Cron Health: ${latest.failed_count} cron${latest.failed_count === 1 ? '' : 's'} sin output de ${latest.total_checks}`,
                            `Cron Health: ${latest.failed_count} cron${latest.failed_count === 1 ? '' : 's'} silent of ${latest.total_checks}`)
                      : L(`Cron Health: ${latest.passed_count}/${latest.total_checks} OK`,
                            `Cron Health: ${latest.passed_count}/${latest.total_checks} OK`)}
                  </p>
                  <p className={`text-[11px] mt-0.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                    {L(`Hace ${minsAgo} min · ${latest.duration_ms || 0}ms`,
                       `${minsAgo}m ago · ${latest.duration_ms || 0}ms`)}
                  </p>
                </div>
              </div>
              {failing && (
                <button onClick={() => setCronHealthExpanded(s => !s)}
                  className={`text-[11px] font-bold px-3 py-1 rounded-full border transition-colors ${isDark ? 'border-red-400/40 text-red-300 hover:bg-red-500/10' : 'border-red-500/40 text-red-600 hover:bg-red-500/5'}`}>
                  {cronHealthExpanded ? L('Ocultar', 'Hide') : L('Ver fallos', 'Show failures')}
                </button>
              )}
            </div>
            {failing && cronHealthExpanded && Array.isArray(latest.failures) && (
              <div className="mt-3 space-y-1.5">
                {latest.failures.map((f, i) => (
                  <div key={i} className={`text-[11px] font-mono ${isDark ? 'text-white/70' : 'text-black/70'} pl-4 border-l-2 border-red-500`}>
                    <span className="font-bold">{f.cron_path}</span>
                    <span className={isDark ? 'block text-white/40' : 'block text-black/40'}>
                      expected within: {f.expected_within_hours}h · observed: {f.observed_at || 'never'}
                    </span>
                    {f.detail ? <span className={isDark ? 'block text-white/40' : 'block text-black/40'}>{f.detail}</span> : null}
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )
      })()}

      {/* Flow Drift — Layer 4 end-to-end user-action assertions. Catches the
          queue.ticket_id NULL → markPaid silent-skip bug that hit prod 2026-05-17
          and similar "UI claims success, DB never changed" regressions that the
          first three layers cannot see. */}
      {(() => {
        const latest = flowDrift[0]
        const failing = latest && latest.failed_count > 0
        if (!latest) {
          return (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className={`rounded-2xl p-4 transition-colors ${cardBase} flex items-center justify-between`}>
              <div className="flex items-center gap-3">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400" />
                <p className={`text-[13px] font-semibold ${isDark ? 'text-white/80' : 'text-black/80'}`}>
                  {L('Flow Drift — sin datos aún (cron corre cada 15 min).', 'Flow Drift — no data yet (cron runs every 15 min).')}
                </p>
              </div>
            </motion.div>
          )
        }
        const ts = new Date(latest.ran_at)
        const minsAgo = Math.max(0, Math.round((Date.now() - ts.getTime()) / 60000))
        const dotColor = failing ? 'bg-red-500' : 'bg-emerald-500'
        const bgTone = failing
          ? (isDark ? 'border-red-500/40 bg-red-500/10' : 'border-red-500/40 bg-red-500/5')
          : ''
        return (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className={`rounded-2xl p-5 transition-colors border ${cardBase} ${bgTone}`}>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${dotColor} ${failing ? 'animate-pulse' : ''}`} />
                <div>
                  <p className={`text-[14px] font-bold ${isDark ? 'text-white' : 'text-black'}`}>
                    {failing
                      ? L(`Flow Drift: ${latest.failed_count} escenario${latest.failed_count === 1 ? '' : 's'} fallido${latest.failed_count === 1 ? '' : 's'} de ${latest.total_count}`,
                            `Flow Drift: ${latest.failed_count} scenario${latest.failed_count === 1 ? '' : 's'} failed of ${latest.total_count}`)
                      : L(`Flow Drift: ${latest.passed_count}/${latest.total_count} OK`,
                            `Flow Drift: ${latest.passed_count}/${latest.total_count} OK`)}
                  </p>
                  <p className={`text-[11px] mt-0.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                    {L(`Hace ${minsAgo} min · ${latest.duration_ms || 0}ms · ${latest.source || 'cron'}`,
                       `${minsAgo}m ago · ${latest.duration_ms || 0}ms · ${latest.source || 'cron'}`)}
                  </p>
                </div>
              </div>
              {failing && (
                <button onClick={() => setFlowDriftExpanded(s => !s)}
                  className={`text-[11px] font-bold px-3 py-1 rounded-full border transition-colors ${isDark ? 'border-red-400/40 text-red-300 hover:bg-red-500/10' : 'border-red-500/40 text-red-600 hover:bg-red-500/5'}`}>
                  {flowDriftExpanded ? L('Ocultar', 'Hide') : L('Ver fallos', 'Show failures')}
                </button>
              )}
            </div>
            {failing && flowDriftExpanded && Array.isArray(latest.failures) && (
              <div className="mt-3 space-y-1.5">
                {latest.failures.map((f, i) => (
                  <div key={i} className={`text-[11px] font-mono ${isDark ? 'text-white/70' : 'text-black/70'} pl-4 border-l-2 border-red-500`}>
                    <span className="font-bold">{f.scenario}</span>
                    {f.expected ? <span className={isDark ? 'block text-white/40' : 'block text-black/40'}>expected: {String(f.expected).slice(0, 240)}</span> : null}
                    {f.observed ? <span className={isDark ? 'block text-white/40' : 'block text-black/40'}>observed: {String(f.observed).slice(0, 240)}</span> : null}
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )
      })()}

      {/* Mega Smoke — Layer 6 comprehensive drift + silent-bug net. 100+
          scenarios across infra, env, schema, RLS, per-vertical flows, mesas,
          contabilidad, plan gating, cron liveness, e-CF. Failures escalate to
          client_errors as critical and Layer 5 (Claude Triage) auto-diagnoses
          + WhatsApps Mike (throttled). */}
      {(() => {
        const latest = megaSmoke[0]
        if (!latest) {
          return (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className={`rounded-2xl p-4 transition-colors ${cardBase} flex items-center justify-between`}>
              <div className="flex items-center gap-3">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400" />
                <p className={`text-[13px] font-semibold ${isDark ? 'text-white/80' : 'text-black/80'}`}>
                  {L('Mega Smoke — sin datos aún (cron corre cada 15 min).', 'Mega Smoke — no data yet (cron runs every 15 min).')}
                </p>
              </div>
            </motion.div>
          )
        }
        const ts = new Date(latest.ran_at)
        const minsAgo = Math.max(0, Math.round((Date.now() - ts.getTime()) / 60000))
        const failing = latest.failed_count > 0
        const yellow = !failing ? false : latest.failed_count <= 3
        const red = failing && !yellow
        const dotColor = red ? 'bg-red-500' : yellow ? 'bg-amber-400' : 'bg-emerald-500'
        const bgTone = red
          ? (isDark ? 'border-red-500/40 bg-red-500/10' : 'border-red-500/40 bg-red-500/5')
          : yellow
            ? (isDark ? 'border-amber-500/40 bg-amber-500/10' : 'border-amber-500/40 bg-amber-500/5')
            : ''
        return (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className={`rounded-2xl p-5 transition-colors border ${cardBase} ${bgTone}`}>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${dotColor} ${red ? 'animate-pulse' : ''}`} />
                <div>
                  <p className={`text-[14px] font-bold ${isDark ? 'text-white' : 'text-black'}`}>
                    {L(`Mega Smoke: ${latest.passed_count}/${latest.total_count} OK${failing ? ` · ${latest.failed_count} fallido${latest.failed_count === 1 ? '' : 's'}` : ''}`,
                       `Mega Smoke: ${latest.passed_count}/${latest.total_count} OK${failing ? ` · ${latest.failed_count} failed` : ''}`)}
                  </p>
                  <p className={`text-[11px] mt-0.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                    {L(`Hace ${minsAgo} min · ${latest.duration_ms || 0}ms · ${latest.source || 'cron'} · WhatsApp ${latest.whatsapp_sent_count || 0}`,
                       `${minsAgo}m ago · ${latest.duration_ms || 0}ms · ${latest.source || 'cron'} · WhatsApp ${latest.whatsapp_sent_count || 0}`)}
                  </p>
                </div>
              </div>
              {failing && (
                <button onClick={() => setMegaSmokeExpanded(s => !s)}
                  className={`text-[11px] font-bold px-3 py-1 rounded-full border transition-colors ${isDark ? 'border-red-400/40 text-red-300 hover:bg-red-500/10' : 'border-red-500/40 text-red-600 hover:bg-red-500/5'}`}>
                  {megaSmokeExpanded ? L('Ocultar', 'Hide') : L('Ver fallos', 'Show failures')}
                </button>
              )}
            </div>
            {failing && megaSmokeExpanded && Array.isArray(latest.failures) && (
              <div className="mt-3 space-y-1.5 max-h-96 overflow-y-auto">
                {latest.failures.map((f, i) => (
                  <div key={i} className={`text-[11px] font-mono ${isDark ? 'text-white/70' : 'text-black/70'} pl-4 border-l-2 border-red-500`}>
                    <span className="font-bold">{f.id || f.category}</span>
                    {f.name ? <span className={isDark ? 'block text-white/50' : 'block text-black/50'}>{f.name}</span> : null}
                    {f.expected ? <span className={isDark ? 'block text-white/40' : 'block text-black/40'}>expected: {String(f.expected).slice(0, 240)}</span> : null}
                    {f.observed ? <span className={isDark ? 'block text-white/40' : 'block text-black/40'}>observed: {String(f.observed).slice(0, 240)}</span> : null}
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )
      })()}

      {/* Stat cards */}
      <motion.div
        variants={listContainer}
        initial="initial"
        animate="animate"
        className="grid grid-cols-2 md:grid-cols-4 gap-4"
      >
        {cards.map((c, i) => {
          const t = TONE[c.tone]
          return (
            <motion.div
              key={i}
              variants={listItem}
              whileHover={{ y: -3, scale: 1.012 }}
              transition={{ type: 'spring', stiffness: 320, damping: 22 }}
              className={`relative rounded-2xl px-5 py-5 transition-colors cursor-default overflow-hidden ${cardBase}`}
            >
              {/* subtle top-right glow */}
              <div className={`absolute -top-10 -right-10 w-24 h-24 rounded-full ${t.bg} blur-2xl`} />
              <div className={`relative w-10 h-10 rounded-xl flex items-center justify-center border ${t.bg} ${t.br} mb-4`}>
                <c.icon size={18} className={t.ic} />
              </div>
              <p className="relative text-[10px] font-bold text-[#b3001e] uppercase tracking-[1.2px]">{c.label}</p>
              <p className={`relative text-[30px] font-black mt-1 tracking-tight ${isDark ? 'text-white' : 'text-black'}`}>
                <AnimatedNumber value={c.value} />
              </p>
            </motion.div>
          )
        })}
      </motion.div>

      {/* Health Status */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.4 }}
        className={`rounded-2xl p-6 transition-colors ${cardBase}`}
      >
        <div className="flex items-center justify-between mb-4">
          <p className={`text-[15px] font-bold ${isDark ? 'text-white' : 'text-black'}`}>{L('Estado de Salud', 'Health Status')}</p>
          <span className="text-[10px] font-bold text-[#b3001e] uppercase tracking-[1.2px]">{L('Hoy', 'Today')}</span>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className={`inline-flex w-10 h-10 rounded-xl items-center justify-center border mb-2 ${TONE.ok.bg} ${TONE.ok.br}`}>
              <Activity size={18} className={TONE.ok.ic} />
            </div>
            <p className={`text-[22px] font-black ${isDark ? 'text-white' : 'text-black'}`}><AnimatedNumber value={stats.activeToday || 0} /></p>
            <p className="text-[10px] font-bold text-[#b3001e] uppercase tracking-[1.2px]">{L('Activos hoy', 'Active Today')}</p>
          </div>
          <div className="text-center">
            <div className={`inline-flex w-10 h-10 rounded-xl items-center justify-center border mb-2 ${TONE.brand.bg} ${TONE.brand.br}`}>
              <Zap size={18} className={TONE.brand.ic} />
            </div>
            <p className={`text-[22px] font-black ${isDark ? 'text-white' : 'text-black'}`}><AnimatedNumber value={stats.validationsToday || 0} /></p>
            <p className="text-[10px] font-bold text-[#b3001e] uppercase tracking-[1.2px]">{L('Validaciones', 'Validations')}</p>
          </div>
          <div className="text-center">
            <div className={`inline-flex w-10 h-10 rounded-xl items-center justify-center border mb-2 ${TONE.warn.bg} ${TONE.warn.br}`}>
              <WifiOff size={18} className={TONE.warn.ic} />
            </div>
            <p className={`text-[22px] font-black ${isDark ? 'text-white' : 'text-black'}`}><AnimatedNumber value={stats.offlineCount || 0} /></p>
            <p className="text-[10px] font-bold text-[#b3001e] uppercase tracking-[1.2px]">{L('Sin conexion 7d', 'Offline 7d')}</p>
          </div>
        </div>
      </motion.div>

      {/* By Plan */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.4 }}
        className={`rounded-2xl p-6 transition-colors ${cardBase}`}
      >
        <div className="flex items-center justify-between mb-4">
          <p className={`text-[15px] font-bold ${isDark ? 'text-white' : 'text-black'}`}>{L('Por Plan', 'By Plan')}</p>
          <span className="text-[10px] font-bold text-[#b3001e] uppercase tracking-[1.2px]">{L('Distribucion', 'Distribution')}</span>
        </div>
        <div className="flex gap-6 flex-wrap">
          {Object.entries(stats.byPlan || {}).length === 0 ? (
            <p className={`text-[12px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>{L('Sin licencias activas.', 'No active licenses.')}</p>
          ) : Object.entries(stats.byPlan).map(([plan, count], i) => (
            <motion.div
              key={plan}
              className="flex items-center gap-2.5"
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.35 + i * 0.05 }}
            >
              <span className="text-[10px] font-bold text-[#b3001e] uppercase tracking-[1.2px]">{plan.replace('_', ' ')}</span>
              <span className={`text-[18px] font-black ${isDark ? 'text-white' : 'text-black'}`}>
                <AnimatedNumber value={count} />
              </span>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Bulk Actions */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.27, duration: 0.4 }}
        className={`rounded-2xl p-6 transition-colors ${cardBase}`}
      >
        <div className="flex items-center justify-between mb-4">
          <p className={`text-[15px] font-bold ${isDark ? 'text-white' : 'text-black'}`}>{L('Acciones Masivas', 'Bulk Actions')}</p>
          <span className="text-[10px] font-bold text-[#b3001e] uppercase tracking-[1.2px]">{L('Operaciones', 'Operations')}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => runBulkAction('suspend_unpaid')} disabled={bulkLoading}
            className={`flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-[11px] font-bold border transition-colors disabled:opacity-50 ${isDark ? 'border-white/10 text-white/70 hover:bg-white/5 hover:border-[#b3001e]/40' : 'border-black/10 text-black/70 hover:bg-black/5 hover:border-[#b3001e]/40'}`}>
            {bulkLoading ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
            {L('Suspender vencidos', 'Suspend Expired')}
          </button>
          <button onClick={() => {
            const msg = prompt(L('Titulo del anuncio:', 'Announcement title:'))
            if (msg) runBulkAction('announcement', { title: msg, message: '' })
          }} disabled={bulkLoading}
            className={`flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-[11px] font-bold border transition-colors disabled:opacity-50 ${isDark ? 'border-white/10 text-white/70 hover:bg-white/5 hover:border-[#b3001e]/40' : 'border-black/10 text-black/70 hover:bg-black/5 hover:border-[#b3001e]/40'}`}>
            <Megaphone size={12} />
            {L('Enviar anuncio', 'Send Announcement')}
          </button>
        </div>
        {bulkResult && (
          <p className={`text-[11px] mt-3 ${bulkResult.ok ? 'text-emerald-500' : 'text-[#b3001e]'}`}>
            {bulkResult.ok ? `${L('Completado', 'Done')}: ${bulkResult.affected} ${L('afectados', 'affected')}` : bulkResult.error}
          </p>
        )}
      </motion.div>

      {/* Claude Triage — Layer 5 RCA. Brief summary card; click to expand history. */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.24, duration: 0.4 }}
        className={`rounded-2xl p-6 transition-colors ${cardBase}`}
      >
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <p className={`text-[15px] font-bold ${isDark ? 'text-white' : 'text-black'}`}>
            <span className="inline-block w-2 h-2 rounded-full bg-[#b3001e] mr-2" />
            {L('Triage Claude', 'Claude Triage')}
            {triage.stats?.diagnosed_last_24h > 0 && (
              <span className="ml-2 text-[11px] font-bold text-[#b3001e] bg-[#b3001e]/10 border border-[#b3001e]/30 rounded-full px-2 py-0.5">
                {triage.stats.diagnosed_last_24h} {L('en 24h', 'in 24h')}
              </span>
            )}
          </p>
          <div className="flex items-center gap-2">
            {triage.stats && !triage.stats.anthropic_configured && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/30">
                {L('ANTHROPIC_API_KEY no configurado', 'ANTHROPIC_API_KEY missing')}
              </span>
            )}
            {triage.stats && !triage.stats.whatsapp_configured && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/30">
                {L('WhatsApp no configurado', 'WhatsApp not configured')}
              </span>
            )}
            <button
              onClick={() => setTriageExpanded(s => !s)}
              className={`text-[11px] font-bold px-3 py-1 rounded-full transition-colors ${isDark ? 'text-white/50 hover:text-white hover:bg-white/5' : 'text-black/50 hover:text-black hover:bg-black/5'}`}
            >
              {triageExpanded ? L('Ocultar', 'Hide') : L('Ver historial', 'View history')}
            </button>
          </div>
        </div>

        {triage.stats?.most_recent ? (
          <div className={`p-3 rounded-lg ${isDark ? 'bg-white/[0.03]' : 'bg-black/[0.02]'}`}>
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-white/40' : 'text-black/40'}`}>{L('Más reciente', 'Most recent')}</span>
              <span className={`text-[10px] font-mono ${isDark ? 'text-white/40' : 'text-black/40'}`}>{timeAgo(triage.stats.most_recent.when, lang)}</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#b3001e]/10 text-[#b3001e] border border-[#b3001e]/25">{triage.stats.most_recent.kind}</span>
              {triage.stats.most_recent.diagnosis?.confidence && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  triage.stats.most_recent.diagnosis.confidence === 'high' ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30'
                  : triage.stats.most_recent.diagnosis.confidence === 'medium' ? 'bg-amber-500/15 text-amber-500 border border-amber-500/30'
                  : 'bg-zinc-500/15 text-zinc-400 border border-zinc-500/30'
                }`}>
                  {L('confianza', 'confidence')}: {triage.stats.most_recent.diagnosis.confidence}
                </span>
              )}
            </div>
            <p className={`text-[12px] font-semibold ${isDark ? 'text-white' : 'text-black'}`}>{triage.stats.most_recent.diagnosis?.likely_cause || L('(sin causa identificada)', '(no cause identified)')}</p>
            {triage.stats.most_recent.diagnosis?.next_step && (
              <p className={`text-[11px] mt-1 ${isDark ? 'text-white/60' : 'text-black/60'}`}>→ {triage.stats.most_recent.diagnosis.next_step}</p>
            )}
          </div>
        ) : (
          <p className={`text-[12px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>
            {L('Sin incidentes diagnosticados en los últimos 7 días.', 'No diagnosed incidents in the last 7 days.')}
          </p>
        )}

        {triageExpanded && triage.data.length > 0 && (
          <div className="mt-4 space-y-2 max-h-[420px] overflow-y-auto">
            {triage.data.map(ev => (
              <div key={`${ev.kind}_${ev.id}`} className={`p-3 rounded-lg ${isDark ? 'bg-white/[0.03]' : 'bg-black/[0.02]'}`}>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#b3001e]/10 text-[#b3001e] border border-[#b3001e]/25">{ev.kind}</span>
                  <span className={`text-[10px] font-mono ${isDark ? 'text-white/40' : 'text-black/40'}`}>{timeAgo(ev.when, lang)}</span>
                  {ev.diagnosis?.confidence && <span className={`text-[10px] font-bold ${isDark ? 'text-white/60' : 'text-black/60'}`}>· {ev.diagnosis.confidence}</span>}
                  {ev.business && <span className={`text-[10px] ${isDark ? 'text-white/50' : 'text-black/50'}`}>· {ev.business}</span>}
                </div>
                <p className={`text-[11px] font-semibold mb-1 ${isDark ? 'text-white' : 'text-black'}`}>{ev.title}</p>
                {ev.diagnosis?.likely_cause && <p className={`text-[11px] ${isDark ? 'text-white/70' : 'text-black/70'}`}>{L('Causa', 'Cause')}: {ev.diagnosis.likely_cause}</p>}
                {ev.diagnosis?.next_step && <p className={`text-[11px] ${isDark ? 'text-white/60' : 'text-black/60'}`}>{L('Siguiente', 'Next')}: {ev.diagnosis.next_step}</p>}
                {ev.diagnosis?.user_impact && <p className={`text-[11px] ${isDark ? 'text-white/50' : 'text-black/50'}`}>{L('Impacto', 'Impact')}: {ev.diagnosis.user_impact}</p>}
                {Array.isArray(ev.diagnosis?.suspected_files) && ev.diagnosis.suspected_files.length > 0 && (
                  <p className={`text-[10px] font-mono mt-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{ev.diagnosis.suspected_files.join(' · ')}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </motion.div>

      {/* Recent client errors — full-width, copy-paste-ready format */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.26, duration: 0.4 }}
        className={`rounded-2xl p-6 transition-colors ${cardBase}`}
      >
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <p className={`text-[15px] font-bold ${isDark ? 'text-white' : 'text-black'}`}>
            <span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-2" />
            {L('Errores recientes', 'Recent errors')}
            {recentErrors.length > 0 && (
              <span className="ml-2 text-[11px] font-bold text-red-400 bg-red-500/10 border border-red-500/30 rounded-full px-2 py-0.5">
                {recentErrors.length}
              </span>
            )}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowResolvedErrors(s => !s)}
              className={`text-[11px] font-bold px-3 py-1 rounded-full border transition-colors ${showResolvedErrors ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : (isDark ? 'border-white/10 text-white/60 hover:bg-white/5' : 'border-black/10 text-black/60 hover:bg-black/5')}`}
              title={L('Alternar entre todos y sin resolver', 'Toggle between all and unresolved')}
            >
              {showResolvedErrors ? L('Mostrando todos', 'Showing all') : L('Solo sin resolver', 'Unresolved only')}
            </button>
            <button
              onClick={reloadErrors}
              disabled={errorsLoading}
              className={`text-[11px] font-bold px-3 py-1 rounded-full transition-colors ${isDark ? 'text-white/50 hover:text-white hover:bg-white/5' : 'text-black/50 hover:text-black hover:bg-black/5'}`}
            >
              {errorsLoading ? L('Cargando...', 'Loading...') : L('Refrescar', 'Refresh')}
            </button>
          </div>
        </div>
        {/* 2026-05-03 (peppy-greeting-popcorn) — last-24h category breakdown.
            Click a chip to filter the list to that category. */}
        {recentErrors.length > 0 && (() => {
          const since = Date.now() - 24 * 60 * 60 * 1000
          const last24 = recentErrors.filter(e => new Date(e.created_at).getTime() >= since)
          const counts = {}
          last24.forEach(e => {
            const cat = e.metadata?.category || 'other'
            counts[cat] = (counts[cat] || 0) + 1
          })
          const ordered = Object.entries(counts).sort((a, b) => b[1] - a[1])
          if (!ordered.length) return null
          return (
            <div className="flex items-center gap-1.5 flex-wrap mb-3">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-white/40' : 'text-black/40'}`}>{L('Últimas 24h', 'Last 24h')}:</span>
              {ordered.map(([cat, n]) => {
                const active = catFilter === cat
                return (
                  <button key={cat} onClick={() => setCatFilter(active ? null : cat)}
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition-colors ${active
                      ? `${categoryStyle(cat).activeBg} ${categoryStyle(cat).activeText} ${categoryStyle(cat).activeBorder}`
                      : `${categoryStyle(cat).bg} ${categoryStyle(cat).text} ${categoryStyle(cat).border}`}`}>
                    {cat} · {n}
                  </button>
                )
              })}
              {catFilter && (
                <button onClick={() => setCatFilter(null)}
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isDark ? 'text-white/50 hover:text-white' : 'text-black/50 hover:text-black'}`}>
                  {L('Limpiar filtro', 'Clear filter')}
                </button>
              )}
            </div>
          )
        })()}

        {(() => {
          const filtered = catFilter
            ? recentErrors.filter(e => (e.metadata?.category || 'other') === catFilter)
            : recentErrors
          if (filtered.length === 0) return (
            <p className={`text-[12px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>
              {showResolvedErrors
                ? L('Sin errores registrados.', 'No errors logged.')
                : L('Sin errores sin resolver. Todo limpio.', 'No unresolved errors. All clean.')}
            </p>
          )
          return (
            <div className="space-y-2 max-h-[420px] overflow-y-auto">
              {filtered.map(e => {
                const bizName = e.businesses?.name || L('(sin negocio)', '(no business)')
                const when = new Date(e.created_at).toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                const copyText = `[${bizName}] ${e.message}${e.route ? ` @ ${e.route}` : ''}${e.app_version ? ` (v${e.app_version})` : ''}`
                const cat = e.metadata?.category || null
                const meta = e.metadata || {}
                const catSty = cat ? categoryStyle(cat) : null
                return (
                  <div key={e.id} className={`flex items-start gap-3 p-3 rounded-lg ${isDark ? 'bg-white/[0.03] hover:bg-white/[0.06]' : 'bg-black/[0.02] hover:bg-black/[0.05]'} transition-colors`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <button
                          onClick={() => e.business_id && navigate(`/admin/clients/${e.business_id}`)}
                          className={`text-[12px] font-bold ${e.business_id ? 'hover:text-[#b3001e]' : 'cursor-default'} ${isDark ? 'text-white' : 'text-black'}`}
                        >
                          {bizName}
                        </button>
                        {cat && catSty && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${catSty.bg} ${catSty.text} ${catSty.border}`}>
                            {cat}
                          </span>
                        )}
                        {e.severity && e.severity !== 'error' && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            e.severity === 'warning' ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' :
                            e.severity === 'critical' ? 'bg-[#b3001e]/15 text-[#b3001e] border border-[#b3001e]/40' :
                            'bg-sky-500/15 text-sky-400 border border-sky-500/30'
                          }`}>{e.severity}</span>
                        )}
                        <span className={`text-[10px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>{when}</span>
                        {e.app_version && <span className={`text-[10px] font-mono ${isDark ? 'text-white/30' : 'text-black/30'}`}>v{e.app_version}</span>}
                        {meta.business_type && <span className={`text-[10px] font-mono ${isDark ? 'text-white/30' : 'text-black/30'}`}>· {meta.business_type}</span>}
                        {meta.plan && <span className={`text-[10px] font-mono ${isDark ? 'text-white/30' : 'text-black/30'}`}>· {meta.plan}</span>}
                        {e.resolved_at && (
                          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded-full px-2 py-0.5">
                            {L('Resuelto', 'Resolved')} · {new Date(e.resolved_at).toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </div>
                      <p className={`text-[12px] font-mono break-words ${isDark ? 'text-red-300' : 'text-red-700'}`}>
                        {e.message}
                      </p>
                      {e.route && (
                        <p className={`text-[10px] font-mono mt-0.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                          {e.route}
                        </p>
                      )}
                      {Array.isArray(meta.last_routes) && meta.last_routes.length > 1 && (
                        <p className={`text-[10px] font-mono mt-0.5 ${isDark ? 'text-white/30' : 'text-black/30'}`}>
                          {L('Ruta', 'Route')}: {meta.last_routes.join(' → ')}
                        </p>
                      )}
                      {Array.isArray(meta.decoded_stack) && meta.decoded_stack.length > 0 && (
                        <pre className={`text-[10px] font-mono mt-1 p-2 rounded whitespace-pre-wrap break-all ${isDark ? 'bg-white/5 text-white/70' : 'bg-black/5 text-black/70'}`}>
                          {meta.decoded_stack.slice(0, 5).map((f, i) =>
                            f.decoded
                              ? `${f.decoded.name || '(anonymous)'} at ${f.decoded.source}:${f.decoded.line}:${f.decoded.column}`
                              : `${f.name || '?'} at ${(f.url || '').split('/').pop()}:${f.line}:${f.col}`
                          ).join('\n')}
                        </pre>
                      )}
                      {meta.claude_diagnosis && (
                        <div className={`text-[10px] mt-1.5 p-2 rounded border ${isDark ? 'bg-[#b3001e]/5 border-[#b3001e]/20 text-white/80' : 'bg-[#b3001e]/5 border-[#b3001e]/20 text-black/80'}`}>
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="font-bold text-[#b3001e] uppercase tracking-wider">{L('Triage Claude', 'Claude triage')}</span>
                            {meta.claude_diagnosis.confidence && (
                              <span className={`font-bold px-1.5 py-0 rounded-full text-[9px] ${
                                meta.claude_diagnosis.confidence === 'high' ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30'
                                : meta.claude_diagnosis.confidence === 'medium' ? 'bg-amber-500/15 text-amber-500 border border-amber-500/30'
                                : 'bg-zinc-500/15 text-zinc-400 border border-zinc-500/30'
                              }`}>{meta.claude_diagnosis.confidence}</span>
                            )}
                          </div>
                          {meta.claude_diagnosis.likely_cause && <p><span className="font-bold">{L('Causa', 'Cause')}:</span> {meta.claude_diagnosis.likely_cause}</p>}
                          {meta.claude_diagnosis.next_step && <p><span className="font-bold">{L('Siguiente', 'Next')}:</span> {meta.claude_diagnosis.next_step}</p>}
                          {meta.claude_diagnosis.user_impact && <p><span className="font-bold">{L('Impacto', 'Impact')}:</span> {meta.claude_diagnosis.user_impact}</p>}
                        </div>
                      )}
                      {e.resolution && (
                        <p className={`text-[10px] mt-1 italic ${isDark ? 'text-emerald-300/80' : 'text-emerald-700'}`}>
                          {L('Nota', 'Note')}: {e.resolution}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 flex flex-col gap-1">
                      {!meta.decoded_stack && e.stack && /\/assets\/[A-Za-z0-9_-]+\.js:\d+:\d+/.test(e.stack) && (
                        <button
                          onClick={() => decodeStack(e.id)}
                          className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-colors ${isDark ? 'bg-sky-500/15 hover:bg-sky-500/25 text-sky-400 border border-sky-500/30' : 'bg-sky-500/10 hover:bg-sky-500/20 text-sky-700 border border-sky-500/30'}`}
                          title={L('Decodificar stack minificado', 'Decode minified stack')}
                        >
                          {L('Decodificar', 'Decode')}
                        </button>
                      )}
                      <button
                        onClick={() => { try { navigator.clipboard?.writeText(copyText) } catch (_aetherErr) {
                          try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'dashboard.handler' }) } catch {}} }}
                        className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-colors ${isDark ? 'bg-white/5 hover:bg-white/10 text-white/70' : 'bg-black/5 hover:bg-black/10 text-black/70'}`}
                        title={L('Copiar al portapapeles', 'Copy to clipboard')}
                      >
                        {L('Copiar', 'Copy')}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })()}
      </motion.div>

      {/* Digest Health */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.28, duration: 0.4 }}
      >
        {/* Digest health */}
        <div className={`rounded-2xl p-6 transition-colors ${cardBase}`}>
          <div className="flex items-center justify-between mb-4">
            <p className={`text-[15px] font-bold ${isDark ? 'text-white' : 'text-black'}`}>
              <Mail size={14} className="inline mr-1.5 text-[#b3001e]" />
              {L('Digests', 'Digests')}
            </p>
            <span className="text-[10px] font-bold text-[#b3001e] uppercase tracking-[1.2px]">
              {L('Pro MAX', 'Pro MAX')}
            </span>
          </div>
          {!digest ? (
            <p className={`text-[12px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>{L('Sin datos.', 'No data.')}</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div>
                  <p className="text-[10px] font-bold text-[#b3001e] uppercase tracking-[1.2px]">{L('Activos', 'Enabled')}</p>
                  <p className={`text-[22px] font-black mt-0.5 ${isDark ? 'text-white' : 'text-black'}`}>
                    <AnimatedNumber value={digest.enabled || 0} />
                    <span className={`text-[13px] font-medium ml-1 ${isDark ? 'text-white/30' : 'text-black/30'}`}>/ {digest.proMaxTotal || 0}</span>
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-[#b3001e] uppercase tracking-[1.2px]">{L('Enviados 7d', 'Sent 7d')}</p>
                  <p className={`text-[22px] font-black mt-0.5 ${isDark ? 'text-white' : 'text-black'}`}>
                    <AnimatedNumber value={digest.sent7d || 0} />
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-[#b3001e] uppercase tracking-[1.2px]">{L('Fallaron', 'Failing')}</p>
                  <p className={`text-[22px] font-black mt-0.5 ${(digest.missingYesterday || []).length ? 'text-[#b3001e]' : (isDark ? 'text-white' : 'text-black')}`}>
                    <AnimatedNumber value={(digest.missingYesterday || []).length} />
                  </p>
                </div>
              </div>
              {(digest.missingYesterday || []).length === 0 ? (
                <div className={`flex items-center gap-2 text-[12px] ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                  <CheckCircle2 size={13} className="text-emerald-500" />
                  {L('Todos enviaron ayer', 'All delivered yesterday')}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {digest.missingYesterday.slice(0, 5).map((b, i) => (
                    <button
                      key={i}
                      onClick={() => navigate(`/admin/clients/${b.business_id}`)}
                      className={`w-full flex items-center gap-2 text-left py-1.5 border-b last:border-0 transition-colors hover:text-[#b3001e] ${isDark ? 'border-white/5 text-white/80' : 'border-black/5 text-black/80'}`}
                    >
                      <MailX size={13} className="text-[#b3001e] shrink-0" />
                      <span className="text-[12px] font-semibold truncate flex-1">{b.business_name}</span>
                      <span className={`text-[11px] shrink-0 ${isDark ? 'text-white/30' : 'text-black/30'}`}>
                        {b.last_digest_sent
                          ? timeAgo(b.last_digest_sent, lang)
                          : L('Nunca', 'Never')}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>

      {/* Activity Feed */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.4 }}
        className={`rounded-2xl p-6 transition-colors ${cardBase}`}
      >
        <div className="flex items-center justify-between mb-4">
          <p className={`text-[15px] font-bold ${isDark ? 'text-white' : 'text-black'}`}>{L('Actividad reciente', 'Recent Activity')}</p>
          <span className="text-[10px] font-bold text-[#b3001e] uppercase tracking-[1.2px]">{feed.length} {L('eventos', 'events')}</span>
        </div>

        {feed.length === 0 ? (
          <p className={`text-[12px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>{L('Sin actividad reciente.', 'No recent activity.')}</p>
        ) : (
          <motion.div variants={listContainer} initial="initial" animate="animate" className="space-y-0">
            {feed.map((item, i) => {
              const meta = FEED_META[item.type] || FEED_META.signup
              const Icon = meta.icon
              const t = TONE[meta.tone]
              return (
                <motion.div
                  key={i}
                  variants={listItem}
                  whileHover={{ x: 2 }}
                  className={`flex items-center gap-3 py-3 border-b last:border-0 transition-colors ${isDark ? 'border-white/5' : 'border-black/5'}`}
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center border shrink-0 ${t.bg} ${t.br}`}>
                    <Icon size={15} className={t.ic} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[11px] font-medium ${isDark ? 'text-white/40' : 'text-black/40'}`}>{feedLabels[item.type] || item.type}</p>
                    <button
                      onClick={() => item.business_id && navigate(`/admin/clients/${item.business_id}`)}
                      className={`text-[13px] font-semibold truncate block text-left hover:text-[#b3001e] transition-colors ${isDark ? 'text-white' : 'text-black'}`}
                    >
                      {item.business_name}
                    </button>
                  </div>
                  {item.detail && <span className={`text-[11px] font-bold shrink-0 ${t.ic}`}>{item.detail}</span>}
                  <span className={`text-[11px] shrink-0 font-medium ${isDark ? 'text-white/25' : 'text-black/25'}`}>{timeAgo(item.date, lang)}</span>
                </motion.div>
              )
            })}
          </motion.div>
        )}
      </motion.div>
    </div>
  )
}
