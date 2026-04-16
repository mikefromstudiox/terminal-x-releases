import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Plus, History, Wifi, WifiOff, TrendingUp, Receipt, DollarSign, Clock } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'
import { useAuth } from '../../context/AuthContext'

function fmtRD(n) {
  return 'RD$ ' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function todayRange() {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString()
  return { from, to }
}

function monthRange() {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString()
  return { from, to }
}

export default function InvoiceDashboard() {
  const api = useAPI()
  const navigate = useNavigate()
  const { lang } = useLang()
  const { user } = useAuth()
  const L = (es, en) => lang === 'es' ? es : en

  const [todayTickets, setTodayTickets] = useState([])
  const [monthTickets, setMonthTickets] = useState([])
  const [recentTickets, setRecentTickets] = useState([])
  const [ecfStatus, setEcfStatus] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { from: tFrom, to: tTo } = todayRange()
        const { from: mFrom, to: mTo } = monthRange()

        const [today, month, recent, cert] = await Promise.all([
          api?.tickets?.all?.({ dateFrom: tFrom, dateTo: tTo, status: 'cobrado' }) || [],
          api?.tickets?.all?.({ dateFrom: mFrom, dateTo: mTo, status: 'cobrado' }) || [],
          api?.tickets?.all?.({ limit: 10 }) || [],
          api?.dgii_ecf?.certInfo?.() || null,
        ])

        if (cancelled) return
        setTodayTickets(today || [])
        setMonthTickets(month || [])
        setRecentTickets((recent || []).slice(0, 10))
        setEcfStatus(cert)
      } catch (err) {
        console.error('[InvoiceDashboard]', err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [api])

  const todayCount = todayTickets.length
  const todayTotal = todayTickets.reduce((sum, t) => sum + Number(t.total || 0), 0)
  const monthCount = monthTickets.length
  const monthTotal = monthTickets.reduce((sum, t) => sum + Number(t.total || 0), 0)

  const bizName = user?.business_name || user?.name || 'Tu Negocio'

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-white/10 border-t-[#b3001e] rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white">{L('Facturacion', 'Invoicing')}</h1>
          <p className="text-sm text-slate-500 dark:text-white/50">{bizName}</p>
        </div>
        <div className="flex items-center gap-2">
          {ecfStatus?.installed ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20">
              <Wifi size={14} className="text-green-600 dark:text-green-400" />
              <span className="text-xs font-semibold text-green-700 dark:text-green-400">{L('Conectado a DGII', 'Connected to DGII')}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
              <WifiOff size={14} className="text-amber-600 dark:text-amber-400" />
              <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">{L('Sin certificado', 'No certificate')}</span>
            </div>
          )}
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: Receipt, label: L('Facturas Hoy', 'Invoices Today'), value: todayCount, color: 'text-[#b3001e]' },
          { icon: DollarSign, label: L('Total Hoy', 'Total Today'), value: fmtRD(todayTotal), color: 'text-[#b3001e]' },
          { icon: TrendingUp, label: L('Facturas Este Mes', 'Invoices This Month'), value: monthCount, color: 'text-[#b3001e]' },
          { icon: DollarSign, label: L('Total Este Mes', 'Total This Month'), value: fmtRD(monthTotal), color: 'text-[#b3001e]' },
        ].map((card, i) => (
          <div key={i} className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-[#b3001e]/10 flex items-center justify-center">
                <card.icon size={16} className="text-[#b3001e]" />
              </div>
              <span className="text-xs font-medium text-slate-500 dark:text-white/50">{card.label}</span>
            </div>
            <p className={`text-xl font-bold ${card.color} dark:text-white`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => navigate('/invoicing/create')}
          className="flex items-center gap-2 px-5 py-3 bg-[#b3001e] hover:bg-[#8c0017] text-white font-bold rounded-xl transition-colors shadow-lg shadow-red-500/20"
        >
          <Plus size={18} />
          {L('Nueva Factura', 'New Invoice')}
        </button>
        <button
          onClick={() => navigate('/invoicing/history')}
          className="flex items-center gap-2 px-5 py-3 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white font-bold rounded-xl hover:bg-slate-50 dark:hover:bg-white/10 transition-colors"
        >
          <History size={18} />
          {L('Ver Historial', 'View History')}
        </button>
      </div>

      {/* Recent invoices */}
      <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10">
          <h2 className="text-sm font-bold text-slate-700 dark:text-white">{L('Facturas Recientes', 'Recent Invoices')}</h2>
          <button onClick={() => navigate('/invoicing/history')} className="text-xs text-[#b3001e] font-semibold hover:underline">
            {L('Ver todas', 'View all')}
          </button>
        </div>
        {recentTickets.length === 0 ? (
          <div className="py-12 text-center">
            <FileText size={40} className="mx-auto text-slate-300 dark:text-white/20 mb-3" />
            <p className="text-sm text-slate-500 dark:text-white/50">{L('No hay facturas aun', 'No invoices yet')}</p>
            <button onClick={() => navigate('/invoicing/create')} className="mt-3 text-sm font-semibold text-[#b3001e] hover:underline">
              {L('Crear tu primera factura', 'Create your first invoice')}
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-white/5">
            {recentTickets.map((t) => {
              const ecf = typeof t.ecf_result === 'string' ? JSON.parse(t.ecf_result || '{}') : (t.ecf_result || {})
              return (
                <div
                  key={t.id}
                  onClick={() => navigate('/invoicing/history')}
                  className="flex items-center justify-between px-5 py-3 hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-white/10 flex items-center justify-center shrink-0">
                      <FileText size={14} className="text-slate-500 dark:text-white/50" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 dark:text-white truncate">
                        {t.doc_number || t.id} {t.client_name ? `- ${t.client_name}` : ''}
                      </p>
                      <p className="text-xs text-slate-400 dark:text-white/40">
                        {fmtDate(t.created_at)} {ecf?.eNCF ? `| ${ecf.eNCF}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="text-sm font-bold text-slate-800 dark:text-white">{fmtRD(t.total)}</p>
                    <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                      t.status === 'cobrado' ? 'bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400' :
                      t.status === 'anulado' ? 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400' :
                      'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400'
                    }`}>
                      {t.status === 'cobrado' ? L('Cobrado', 'Paid') : t.status === 'anulado' ? L('Anulado', 'Voided') : L('Pendiente', 'Pending')}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
