import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FileText, Plus, Loader2, ArrowRight, Clock, AlertTriangle } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'

function fmtRD(n) {
  return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}
function daysUntil(iso) {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)
}

// Mirror of WorkOrders.jsx STATUS_ALIAS — keep in sync.
const STATUS_ALIAS = { estimate: 'estimado', approved: 'aprobado', in_progress: 'en_progreso', completed: 'completado', closed: 'facturado', invoiced: 'facturado' }
function normStatus(s) { return STATUS_ALIAS[s] || s || 'estimado' }

export default function Cotizaciones() {
  const api = useAPI()
  const navigate = useNavigate()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const [estimates, setEstimates] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { (async () => {
    setLoading(true)
    const wos = (await api.workOrders?.list?.().catch(() => [])) || []
    setEstimates(wos.filter(w => ['estimado','aprobado'].includes(normStatus(w.status))))
    setLoading(false)
  })() }, []) // eslint-disable-line

  const buckets = useMemo(() => {
    const today = Date.now()
    const expiring = []
    const fresh = []
    const approved = []
    const expired = []
    for (const w of estimates) {
      if (normStatus(w.status) === 'aprobado') { approved.push(w); continue }
      const d = daysUntil(w.validity_until)
      if (d == null) fresh.push(w)
      else if (d < 0) expired.push(w)
      else if (d <= 3) expiring.push(w)
      else fresh.push(w)
    }
    return { fresh, expiring, expired, approved }
  }, [estimates])

  if (loading) return <div className="p-12 text-center"><Loader2 className="animate-spin mx-auto" /></div>

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3 dark:text-white"><FileText size={32} />{L('Cotizaciones', 'Estimates')}</h1>
          <p className="text-sm text-black/70 dark:text-white/70 mt-1">{L('Cotizaciones aprobadas → Órdenes de Trabajo. e-CF se emite SOLO al cobrar.', 'Approved estimates → Work Orders. e-CF only on close.')}</p>
        </div>
        <button
          onClick={() => navigate('/work-orders?new=1&status=estimado')}
          className="px-4 py-2 bg-[#b3001e] text-white font-bold hover:bg-black flex items-center gap-2"
        >
          <Plus size={16}/>{L('Nueva Cotización', 'New Estimate')}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Column title={L('Por vencer (≤3d)', 'Expiring (≤3d)')} icon={AlertTriangle} tone="red" rows={buckets.expiring} />
        <Column title={L('Vigentes', 'Active')}                  icon={FileText}      tone="neutral" rows={buckets.fresh} />
        <Column title={L('Aprobadas', 'Approved')}              icon={Clock}         tone="black" rows={buckets.approved} />
        <Column title={L('Vencidas', 'Expired')}                 icon={AlertTriangle} tone="muted" rows={buckets.expired} />
      </div>
    </div>
  )
}

function Column({ title, icon: Icon, tone, rows }) {
  const head = tone === 'red' ? 'bg-[#b3001e] text-white'
    : tone === 'black' ? 'bg-black text-white'
    : tone === 'muted' ? 'bg-black/10 text-black dark:bg-white/10 dark:text-white'
    : 'bg-white text-black border-b border-black dark:bg-white/5 dark:text-white dark:border-white/20'
  return (
    <div className="border border-black dark:border-white/20">
      <div className={`p-3 flex items-center gap-2 font-bold ${head}`}>
        <Icon size={16}/>{title} <span className="ml-auto text-xs opacity-80">{rows.length}</span>
      </div>
      <div className="divide-y divide-black/10 dark:divide-white/10 max-h-[60vh] overflow-y-auto">
        {rows.length === 0 ? (
          <p className="p-4 text-xs text-black/50 dark:text-white/50">—</p>
        ) : rows.map(w => <Row key={w.id} w={w} />)}
      </div>
    </div>
  )
}

function Row({ w }) {
  const d = daysUntil(w.validity_until)
  return (
    <Link to={`/work-orders?id=${w.id}`} className="block p-3 hover:bg-black/5 dark:hover:bg-white/5">
      <div className="flex items-center justify-between text-sm dark:text-white">
        <div>
          <div className="font-semibold">{w.vehicle_plate || '—'}</div>
          <div className="text-xs text-black/60 dark:text-white/60">{w.client_name || ''}</div>
        </div>
        <div className="text-right">
          <div className="font-bold">{fmtRD(w.total || w.estimated_total)}</div>
          {w.validity_until && (
            <div className="text-[11px] text-black/50 dark:text-white/50">
              {d == null ? '' : d < 0 ? `Vencida ${Math.abs(d)}d` : d === 0 ? 'Hoy' : `${d}d`}
            </div>
          )}
        </div>
        <ArrowRight size={14} className="ml-2 opacity-40"/>
      </div>
    </Link>
  )
}
