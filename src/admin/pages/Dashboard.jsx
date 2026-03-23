import { useState, useEffect } from 'react'
import { Building2, KeyRound, AlertTriangle, TrendingUp, Loader2 } from 'lucide-react'

export default function Dashboard({ getToken, refreshToken }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      let token = await refreshToken()
      if (!token) token = getToken()
      const resp = await fetch('/api/panel?action=stats', { headers: { 'Authorization': `Bearer ${token}` } })
      if (!resp.ok) { const err = await resp.json().catch(() => ({})); throw new Error(err.error || 'Failed') }
      setStats(await resp.json())
    } catch (e) { console.error('Dashboard load:', e) }
    setLoading(false)
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-slate-600" size={20} /></div>
  }

  if (!stats) {
    return <div className="p-8 text-center text-slate-500 text-sm">Error al cargar datos.</div>
  }

  const cards = [
    { icon: Building2, label: 'Clientes totales', value: stats.totalClients, accent: 'bg-sky-500/10 text-sky-400 border-sky-500/20' },
    { icon: KeyRound, label: 'Licencias activas', value: stats.activeLicenses, accent: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
    { icon: AlertTriangle, label: 'Suspendidas', value: stats.suspendedLicenses, accent: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
    { icon: TrendingUp, label: 'Expiradas', value: stats.expiredLicenses, accent: 'bg-red-500/10 text-red-400 border-red-500/20' },
  ]

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div>
        <h1 className="text-[20px] font-bold text-white">Dashboard</h1>
        <p className="text-[12px] text-slate-500 mt-0.5">Vista general de Terminal X</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((c, i) => (
          <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl px-5 py-5">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${c.accent} mb-3`}>
              <c.icon size={18} />
            </div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{c.label}</p>
            <p className="text-[28px] font-bold text-white mt-0.5">{c.value}</p>
          </div>
        ))}
      </div>

      {/* By Plan */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <p className="text-[13px] font-bold text-slate-300 mb-4">Por Plan</p>
        <div className="flex gap-6 flex-wrap">
          {Object.entries(stats.byPlan || {}).length === 0 ? (
            <p className="text-[12px] text-slate-600">Sin licencias activas.</p>
          ) : Object.entries(stats.byPlan).map(([plan, count]) => (
            <div key={plan} className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-500 uppercase">{plan.replace('_', ' ')}</span>
              <span className="text-[16px] font-bold text-white">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent signups */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <p className="text-[13px] font-bold text-slate-300 mb-4">Registros recientes</p>
        {(stats.recentSignups || []).length === 0 ? (
          <p className="text-[12px] text-slate-600">Sin registros aun.</p>
        ) : (
          <div className="space-y-0">
            {stats.recentSignups.map(s => (
              <div key={s.id} className="flex items-center justify-between py-3 border-b border-slate-800 last:border-0">
                <span className="text-[13px] font-semibold text-slate-300">{s.name}</span>
                <span className="text-[11px] text-slate-600">{new Date(s.created_at).toLocaleDateString('es-DO')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
