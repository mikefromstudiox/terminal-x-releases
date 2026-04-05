import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, KeyRound, AlertTriangle, TrendingUp, Loader2, Clock, Ban, CheckCircle2, ShoppingCart, UserX } from 'lucide-react'
import { useLang } from '../../i18n'

const FEED_META = {
  signup:    { icon: Building2,    color: 'text-sky-400',     bg: 'bg-sky-500/10',     border: 'border-sky-500/20' },
  first_sale:{ icon: ShoppingCart, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  expiring:  { icon: Clock,        color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/20' },
  inactive:  { icon: UserX,        color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/20' },
  suspended: { icon: Ban,          color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/20' },
  activated: { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
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

export default function Dashboard({ getToken, refreshToken, isDark }) {
  const { lang } = useLang()
  const navigate = useNavigate()
  const L = (es, en) => lang === 'es' ? es : en
  const [stats, setStats] = useState(null)
  const [feed, setFeed] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      let token = await refreshToken()
      if (!token) token = getToken()
      const headers = { 'Authorization': `Bearer ${token}` }
      const [statsResp, feedResp] = await Promise.all([
        fetch('/api/panel?action=stats', { headers }),
        fetch('/api/panel?action=activity_feed', { headers }),
      ])
      if (statsResp.ok) setStats(await statsResp.json())
      if (feedResp.ok) { const f = await feedResp.json(); setFeed(f.data || []) }
    } catch (e) { console.error('Dashboard load:', e) }
    setLoading(false)
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-white/30" size={20} /></div>
  }

  if (!stats) {
    return <div className={`p-8 text-center text-sm ${isDark ? 'text-white/50' : 'text-slate-400'}`}>{L('Error al cargar datos.', 'Error loading data.')}</div>
  }

  const cards = [
    { icon: Building2, label: L('Clientes totales', 'Total Clients'), value: stats.totalClients, accent: 'bg-sky-500/10 text-sky-400 border-sky-500/20' },
    { icon: KeyRound, label: L('Licencias activas', 'Active Licenses'), value: stats.activeLicenses, accent: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
    { icon: AlertTriangle, label: L('Suspendidas', 'Suspended'), value: stats.suspendedLicenses, accent: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
    { icon: TrendingUp, label: L('Expiradas', 'Expired'), value: stats.expiredLicenses, accent: 'bg-red-500/10 text-red-400 border-red-500/20' },
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
    <div className="p-6 md:p-8 space-y-6">
      <div>
        <h1 className={`text-[20px] font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Dashboard</h1>
        <p className={`text-[12px] mt-0.5 ${isDark ? 'text-white/40' : 'text-slate-400'}`}>{L('Vista general de Terminal X', 'Terminal X Overview')}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((c, i) => (
          <div key={i} className={`rounded-2xl px-5 py-5 ${isDark ? 'bg-white/5 border border-white/10' : 'bg-white border border-slate-200'}`}>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${c.accent} mb-3`}>
              <c.icon size={18} />
            </div>
            <p className="text-[10px] font-bold text-[#b3001e] uppercase tracking-wider">{c.label}</p>
            <p className={`text-[28px] font-bold mt-0.5 ${isDark ? 'text-white' : 'text-slate-900'}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* By Plan */}
      <div className={`rounded-2xl p-5 ${isDark ? 'bg-white/5 border border-white/10' : 'bg-white border border-slate-200'}`}>
        <p className={`text-[16px] font-semibold mb-4 ${isDark ? 'text-white' : 'text-slate-900'}`}>{L('Por Plan', 'By Plan')}</p>
        <div className="flex gap-6 flex-wrap">
          {Object.entries(stats.byPlan || {}).length === 0 ? (
            <p className={`text-[12px] ${isDark ? 'text-white/30' : 'text-slate-400'}`}>{L('Sin licencias activas.', 'No active licenses.')}</p>
          ) : Object.entries(stats.byPlan).map(([plan, count]) => (
            <div key={plan} className="flex items-center gap-2">
              <span className={`text-[11px] font-bold uppercase ${isDark ? 'text-white/40' : 'text-slate-500'}`}>{plan.replace('_', ' ')}</span>
              <span className={`text-[16px] font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Activity Feed */}
      <div className={`rounded-2xl p-5 ${isDark ? 'bg-white/5 border border-white/10' : 'bg-white border border-slate-200'}`}>
        <p className={`text-[16px] font-semibold mb-4 ${isDark ? 'text-white' : 'text-slate-900'}`}>{L('Actividad reciente', 'Recent Activity')}</p>
        {feed.length === 0 ? (
          <p className={`text-[12px] ${isDark ? 'text-white/30' : 'text-slate-400'}`}>{L('Sin actividad reciente.', 'No recent activity.')}</p>
        ) : (
          <div className="space-y-0">
            {feed.map((item, i) => {
              const meta = FEED_META[item.type] || FEED_META.signup
              const Icon = meta.icon
              return (
                <div key={i} className={`flex items-center gap-3 py-3 border-b last:border-0 ${isDark ? 'border-white/5' : 'border-slate-100'}`}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center border shrink-0 ${meta.bg} ${meta.border}`}>
                    <Icon size={14} className={meta.color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[12px] ${isDark ? 'text-white/40' : 'text-slate-400'}`}>{feedLabels[item.type] || item.type}</p>
                    <button onClick={() => item.business_id && navigate(`/admin/clients/${item.business_id}`)}
                      className={`text-[13px] font-semibold truncate block text-left hover:text-[#b3001e] transition-colors ${isDark ? 'text-white/80' : 'text-slate-800'}`}>
                      {item.business_name}
                    </button>
                  </div>
                  {item.detail && <span className={`text-[11px] font-bold shrink-0 ${meta.color}`}>{item.detail}</span>}
                  <span className={`text-[11px] shrink-0 ${isDark ? 'text-white/20' : 'text-slate-300'}`}>{timeAgo(item.date, lang)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
