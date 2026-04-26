import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Wrench, Clock, AlertTriangle, Package, Users, DollarSign, TrendingUp,
  Loader2, ArrowRight, FileText, Car,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'

function fmtRD(n) {
  return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}
function startOfMonthISO() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString()
}
function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export default function MechanicResumen() {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const [loading, setLoading] = useState(true)
  const [workOrders, setWorkOrders] = useState([])
  const [partsAwaiting, setPartsAwaiting] = useState([])
  const [reminders, setReminders] = useState([])
  const [productivity, setProductivity] = useState([])
  const [todayTickets, setTodayTickets] = useState([])

  useEffect(() => { (async () => {
    setLoading(true)
    const monthStart = startOfMonthISO().slice(0, 10)
    const today = todayISO()
    const [wo, pa, rem, prod, tt] = await Promise.all([
      api.workOrders?.list?.().catch(() => []) || Promise.resolve([]),
      api.partsOrders?.listAwaiting?.().catch(() => []) || Promise.resolve([]),
      api.mechanic?.serviceRemindersDue?.().catch(() => []) || Promise.resolve([]),
      api.mechanic?.productivityForPeriod?.({ period_start: monthStart, period_end: today }).catch(() => []) || Promise.resolve([]),
      api.tickets?.byDateRange?.({ from: today, to: today })?.catch?.(() => []) || Promise.resolve([]),
    ])
    setWorkOrders(wo || [])
    setPartsAwaiting(pa || [])
    setReminders(rem || [])
    setProductivity(prod || [])
    setTodayTickets(tt || [])
    setLoading(false)
  })() }, []) // eslint-disable-line

  const kpis = useMemo(() => {
    const active = workOrders.filter(w => ['abierto','en_proceso','aprobado','awaiting_parts'].includes(w.status))
    const overdue = workOrders.filter(w => w.promised_date && new Date(w.promised_date) < new Date()
      && !['facturado','closed','listo'].includes(w.status))
    const awaitingParts = workOrders.filter(w => w.status === 'awaiting_parts').length
    const totalHours = productivity.reduce((s, p) => s + (Number(p.hours_total) || 0), 0)
    const techCount = productivity.filter(p => p.wo_count > 0).length || 1
    const utilization = Math.min(100, Math.round((totalHours / (techCount * 8 * 22)) * 100))
    const ingresos = todayTickets.reduce((s, t) => s + (Number(t.total) || 0), 0)
    const partsRevenue = workOrders
      .filter(w => w.completed_date && String(w.completed_date).slice(0, 7) === new Date().toISOString().slice(0, 7))
      .reduce((s, w) => s + (Number(w.parts_total) || 0), 0)
    return {
      activeCount: active.length,
      overdueCount: overdue.length,
      awaitingParts,
      utilization,
      ingresos,
      partsRevenue,
    }
  }, [workOrders, productivity, todayTickets])

  if (loading) return <div className="p-12 text-center"><Loader2 className="animate-spin mx-auto" /></div>

  const recentWO = workOrders.slice(0, 5)

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-3 dark:text-white"><Wrench size={32} />{L('Taller Mecánico', 'Auto Shop')}</h1>
        <p className="text-sm text-black/70 dark:text-white/70 mt-1">{L('Estado del taller en tiempo real.', 'Real-time shop status.')}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <Tile to="/work-orders" icon={Wrench}      label={L('WO Activos', 'Active WO')}        value={kpis.activeCount} />
        <Tile to="/work-orders" icon={Clock}       label={L('WO Atrasados', 'Overdue WO')}      value={kpis.overdueCount}    tone={kpis.overdueCount > 0 ? 'red' : null} />
        <Tile to="/suministros" icon={Package}     label={L('En Espera Partes', 'Awaiting Parts')} value={kpis.awaitingParts} tone={kpis.awaitingParts > 0 ? 'amber' : null} />
        <Tile                    icon={Users}       label={L('% Utilización', '% Utilization')} value={`${kpis.utilization}%`} />
        <Tile                    icon={DollarSign}  label={L('Ingresos Hoy', 'Today Income')}    value={fmtRD(kpis.ingresos)} />
        <Tile                    icon={TrendingUp}  label={L('Margen Partes', 'Parts Margin')}   value={fmtRD(kpis.partsRevenue)} sub={L('mes', 'month')} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <AlertCard
          icon={AlertTriangle}
          label={L('Vehículos vencidos (mant.)', 'Overdue maintenance')}
          count={reminders.length}
          tone={reminders.length > 0 ? 'red' : 'ok'}
        />
        <AlertCard
          to="/cotizaciones"
          icon={FileText}
          label={L('Cotizaciones por vencer', 'Estimates expiring')}
          count={workOrders.filter(w => w.status === 'estimado' && w.validity_until && new Date(w.validity_until) < new Date(Date.now() + 3 * 86400000)).length}
          tone="amber"
        />
        <AlertCard
          to="/aseguradoras"
          icon={Users}
          label={L('Pendientes Aseguradora', 'Pending Insurance')}
          count={workOrders.filter(w => w.aseguradora_supabase_id && w.aseguradora_status === 'pendiente').length}
          tone="neutral"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border border-black dark:border-white/20 p-4 bg-white dark:bg-white/5">
          <h2 className="font-bold mb-3 flex items-center gap-2 dark:text-white"><Wrench size={18}/>{L('Últimas Órdenes', 'Recent Work Orders')}</h2>
          {recentWO.length === 0 ? (
            <p className="text-sm text-black/50 dark:text-white/50">{L('Sin órdenes registradas.', 'No work orders yet.')}</p>
          ) : (
            <ul className="divide-y divide-black/10 dark:divide-white/10">
              {recentWO.map(w => (
                <li key={w.id} className="py-2 flex items-center justify-between text-sm">
                  <div>
                    <div className="font-semibold dark:text-white">{w.vehicle_plate || '—'} · {w.client_name || L('Cliente', 'Client')}</div>
                    <div className="text-xs text-black/60 dark:text-white/60">{w.status} · {w.created_at ? new Date(w.created_at).toLocaleDateString('es-DO') : ''}</div>
                  </div>
                  <div className="text-right dark:text-white">
                    <div className="font-bold">{fmtRD(w.total || w.estimated_total)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border border-black dark:border-white/20 p-4 bg-white dark:bg-white/5">
          <h2 className="font-bold mb-3 flex items-center gap-2 dark:text-white"><Car size={18}/>{L('Vehículos por mantenimiento', 'Vehicles due for service')}</h2>
          {reminders.length === 0 ? (
            <p className="text-sm text-black/50 dark:text-white/50">{L('Todo al día.', 'All caught up.')}</p>
          ) : (
            <ul className="divide-y divide-black/10 dark:divide-white/10">
              {reminders.slice(0, 6).map(v => (
                <li key={v.id || v.supabase_id} className="py-2 flex items-center justify-between text-sm">
                  <div>
                    <div className="font-semibold dark:text-white">{v.plate || v.vin} · {v.client_name || (v.clients?.name) || '—'}</div>
                    <div className="text-xs text-[#b3001e]">
                      {v.next_service_km ? `${v.odometer_km || 0}/${v.next_service_km} km` : ''}
                      {v.next_service_at ? ` · ${new Date(v.next_service_at).toLocaleDateString('es-DO')}` : ''}
                    </div>
                  </div>
                  <Link to="/vehicles" className="text-xs underline dark:text-white">{L('Abrir', 'Open')}</Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function Tile({ to, icon: Icon, label, value, sub, tone }) {
  const toneCls = tone === 'red' ? 'border-[#b3001e] bg-[#b3001e] text-white'
    : tone === 'amber' ? 'border-black bg-black text-white dark:bg-white dark:text-black dark:border-white'
    : 'border-black bg-white hover:bg-black hover:text-white dark:bg-white/5 dark:text-white dark:border-white/20 dark:hover:bg-white dark:hover:text-black'
  const inner = (
    <div className={`border p-4 transition-colors h-full ${toneCls}`}>
      <div className="flex items-center justify-between">
        <Icon size={20} className="opacity-70"/>
        {to && <ArrowRight size={14} className="opacity-50"/>}
      </div>
      <div className="text-2xl font-bold mt-3">{value}</div>
      <div className="text-xs uppercase tracking-wide opacity-70">{label}</div>
      {sub && <div className="text-xs mt-1 opacity-60">{sub}</div>}
    </div>
  )
  return to ? <Link to={to}>{inner}</Link> : inner
}

function AlertCard({ to, icon: Icon, label, count, subtitle, tone }) {
  const cls = tone === 'red' ? 'border-[#b3001e] bg-[#b3001e] text-white'
    : tone === 'amber' ? 'border-black bg-black text-white dark:border-white dark:bg-white dark:text-black'
    : 'border-black bg-white text-black dark:border-white/20 dark:bg-white/5 dark:text-white'
  const inner = (
    <div className={`border p-4 ${cls} h-full flex items-center justify-between`}>
      <div className="flex items-center gap-3">
        <Icon size={20}/>
        <div>
          <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
          {count !== null && count !== undefined && <div className="text-xl font-bold">{count}</div>}
          {subtitle && <div className="text-xs opacity-80">{subtitle}</div>}
        </div>
      </div>
      {to && <ArrowRight size={16}/>}
    </div>
  )
  return to ? <Link to={to}>{inner}</Link> : inner
}
