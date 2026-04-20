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
  const [tierFilter, setTierFilter] = useState(null)   // null | 'gold' | 'silver' | 'bronze'
  const [digest, setDigest] = useState(null)
  const [loading, setLoading] = useState(true)
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkResult, setBulkResult] = useState(null)

  useEffect(() => { load() }, [])
  useEffect(() => { reloadLoyalty() }, [tierFilter])

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
    } catch {}
  }

  async function load() {
    setLoading(true)
    try {
      let token = await refreshToken()
      if (!token) token = getToken()
      const headers = { 'Authorization': `Bearer ${token}` }
      const [statsResp, feedResp, loyaltyResp, digestResp] = await Promise.all([
        fetch('/api/panel?action=stats', { headers }),
        fetch('/api/panel?action=activity_feed', { headers }),
        fetch('/api/panel?action=loyalty-overview', { headers }),
        fetch('/api/panel?action=digest-health', { headers }),
      ])
      if (statsResp.ok) setStats(await statsResp.json())
      if (feedResp.ok) { const f = await feedResp.json(); setFeed(f.data || []) }
      if (loyaltyResp.ok) setLoyalty(await loyaltyResp.json())
      if (digestResp.ok) setDigest(await digestResp.json())
    } catch (e) { console.error('Dashboard load:', e) }
    setLoading(false)
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
    } catch {}
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

      {/* Loyalty + Digest Health — two-column */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.28, duration: 0.4 }}
        className="grid md:grid-cols-2 gap-5"
      >
        {/* Loyalty overview */}
        <div className={`rounded-2xl p-6 transition-colors ${cardBase}`}>
          <div className="flex items-center justify-between mb-4">
            <p className={`text-[15px] font-bold ${isDark ? 'text-white' : 'text-black'}`}>
              <Gift size={14} className="inline mr-1.5 text-[#b3001e]" />
              {L('Lealtad', 'Loyalty')}
            </p>
            <span className="text-[10px] font-bold text-[#b3001e] uppercase tracking-[1.2px]">
              {L('Pro PLUS+', 'Pro PLUS+')}
            </span>
          </div>
          {!loyalty ? (
            <p className={`text-[12px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>{L('Sin datos.', 'No data.')}</p>
          ) : (
            <>
              {/* Tier filter chips */}
              <div className="flex flex-wrap items-center gap-1.5 mb-3">
                {[
                  { key: null,      label: L('Todos', 'All'),   count: null },
                  { key: 'gold',    label: L('Oro', 'Gold'),    count: loyalty.tierBreakdown?.gold },
                  { key: 'silver',  label: L('Plata', 'Silver'),count: loyalty.tierBreakdown?.silver },
                  { key: 'bronze',  label: L('Bronce', 'Bronze'),count: loyalty.tierBreakdown?.bronze },
                ].map(chip => {
                  const on = tierFilter === chip.key
                  const tone = chip.key === 'gold'
                    ? (on ? 'bg-amber-500 text-black' : 'bg-amber-400/15 text-amber-500 hover:bg-amber-400/25')
                    : chip.key === 'silver'
                    ? (on ? 'bg-slate-400 text-black' : 'bg-slate-400/15 text-slate-400 hover:bg-slate-400/25')
                    : chip.key === 'bronze'
                    ? (on ? 'bg-orange-700 text-white' : 'bg-orange-700/15 text-orange-500 hover:bg-orange-700/25')
                    : (on ? 'bg-[#b3001e] text-white' : (isDark ? 'bg-white/5 text-white/60 hover:bg-white/10' : 'bg-black/5 text-black/60 hover:bg-black/10'))
                  return (
                    <button
                      key={String(chip.key)}
                      onClick={() => setTierFilter(chip.key)}
                      className={`text-[10px] font-bold uppercase tracking-[1px] px-2.5 py-1 rounded-full transition-colors ${tone}`}
                    >
                      {chip.label}
                      {chip.count != null && <span className="ml-1 opacity-60">({chip.count})</span>}
                    </button>
                  )
                })}
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <p className="text-[10px] font-bold text-[#b3001e] uppercase tracking-[1.2px]">{L('Puntos vivos', 'Outstanding')}</p>
                  <p className={`text-[22px] font-black mt-0.5 ${isDark ? 'text-white' : 'text-black'}`}>
                    <AnimatedNumber value={Math.round(loyalty.totalPoints || 0)} />
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-[#b3001e] uppercase tracking-[1.2px]">{L('Negocios', 'Businesses')}</p>
                  <p className={`text-[22px] font-black mt-0.5 ${isDark ? 'text-white' : 'text-black'}`}>
                    <AnimatedNumber value={loyalty.businessCount || 0} />
                  </p>
                </div>
              </div>
              {(loyalty.topClients || []).length === 0 ? (
                <p className={`text-[12px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>{L('Sin clientes con puntos.', 'No clients with points.')}</p>
              ) : (
                <div className="space-y-1.5">
                  {loyalty.topClients.map((c, i) => {
                    const isGold = (c.tier || '').toLowerCase() === 'gold' || (c.tier || '').toLowerCase() === 'platinum'
                    const isSilver = (c.tier || '').toLowerCase() === 'silver'
                    const tierCls = isGold
                      ? 'bg-amber-400/20 text-amber-500 border border-amber-500/40'
                      : isSilver
                      ? 'bg-slate-400/20 text-slate-400 border border-slate-400/40'
                      : isDark ? 'bg-white/5 text-white/50' : 'bg-black/5 text-black/50'
                    const tierLabel = isGold ? L('Oro','Gold') : isSilver ? L('Plata','Silver') : L('Bronce','Bronze')
                    const valueShown = tierFilter ? Math.round(c.lifetime ?? c.points) : Math.round(c.points)
                    return (
                      <button
                        key={i}
                        onClick={() => c.business_id && navigate(`/admin/clients/${c.business_id}`)}
                        className={`w-full flex items-center gap-2 text-left py-1.5 border-b last:border-0 transition-colors hover:text-[#b3001e] ${isDark ? 'border-white/5 text-white/80' : 'border-black/5 text-black/80'}`}
                      >
                        <span className={`text-[10px] font-bold w-5 shrink-0 ${isDark ? 'text-white/30' : 'text-black/30'}`}>{i + 1}.</span>
                        <span className="text-[12px] font-semibold truncate flex-1">{c.business_name}</span>
                        <span className={`text-[11px] truncate max-w-[120px] ${isDark ? 'text-white/40' : 'text-black/40'}`}>{c.client_name}</span>
                        {c.birthday_treat && <span title={L('Regalo de cumpleaños disponible','Birthday treat available')} className="text-[10px]">🎂</span>}
                        <span className="text-[11px] font-bold text-[#b3001e] shrink-0 tabular-nums">{valueShown.toLocaleString()}</span>
                        <span className={`text-[9px] font-bold uppercase tracking-[1px] shrink-0 px-1.5 py-0.5 rounded ${tierCls}`}>{tierLabel}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>

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
