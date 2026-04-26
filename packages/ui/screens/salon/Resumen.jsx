/**
 * salon/Resumen.jsx — Salón / barbería landing dashboard.
 *
 * 5 KPI tiles + 2 detail cards. Reads live from appointments, tickets, and
 * appointment_reminders. Brand: black + white + crimson #b3001e.
 */

import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Calendar, BarChart3, DollarSign, Scissors, Package,
  Loader2, ArrowRight, Clock, Bell, AlertCircle, User, TrendingUp,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'

function fmtRD(n) {
  return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}
// v2.16.2 (Fix 4) — local-date YYYY-MM-DD without UTC roll-over.
// `toISOString` rolls forward at midnight UTC (8 PM AST) so opening Resumen
// after 8pm silently jumped to "tomorrow" → "0 citas hoy" with cash drawer
// full. Mirror pattern from Appointments.jsx:59-64.
function localDateStr(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function todayStr() { return localDateStr() }
function startOfMonthISO() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString()
}
function endOfMonthISO() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59).toISOString()
}
function next24hISO() {
  return new Date(Date.now() + 24 * 3600 * 1000).toISOString()
}

export default function Resumen() {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [loading, setLoading]   = useState(true)
  const [appts, setAppts]       = useState([])
  const [tickets, setTickets]   = useState([])
  const [empleados, setEmps]    = useState([])
  const [services, setServices] = useState([])
  const [reminders, setReminders] = useState([])
  const [upcoming, setUpcoming] = useState([])

  useEffect(() => { (async () => {
    setLoading(true)
    try {
      const today = todayStr()
      const monthStart = startOfMonthISO()
      const monthEnd = endOfMonthISO()
      const next24 = next24hISO()
      const [todayAppts, monthTix, emps, svcs, pendRems, upAppts] = await Promise.all([
        api?.appointments?.byDate?.(today).catch(() => []) || api?.appointments?.list?.({ date: today }).catch(() => []) || [],
        api?.tickets?.byDateRange?.({ from: monthStart, to: monthEnd }).catch(() => []) || [],
        api?.empleados?.all?.() || [],
        api?.services?.getAll?.() || [],
        api?.appointmentReminders?.pendingDue?.(next24).catch(() => []) || [],
        api?.appointments?.upcomingBetween?.(new Date().toISOString(), next24).catch(() => null),
      ])
      setAppts(todayAppts || [])
      setTickets(monthTix || [])
      setEmps(emps || [])
      setServices(svcs || [])
      setReminders(pendRems || [])
      // Fallback: derive upcoming 24h from today's appts when the API doesn't expose a helper
      if (Array.isArray(upAppts)) setUpcoming(upAppts)
      else {
        const nowH = new Date().getHours() * 60 + new Date().getMinutes()
        const t = (todayAppts || [])
          .filter(a => {
            const [hh, mm] = String(a.start_time || '00:00').split(':').map(Number)
            return (hh * 60 + (mm || 0)) >= nowH && a.status !== 'completada' && a.status !== 'no_show' && a.status !== 'cancelled'
          })
          .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))
          .slice(0, 6)
        setUpcoming(t)
      }
    } catch {}
    setLoading(false)
  })() }, []) // eslint-disable-line

  const empName = (id) => empleados.find(e => e.id === id || e.supabase_id === id)?.nombre || '—'

  const kpis = useMemo(() => {
    // Citas hoy
    const apptCount = appts.length

    // % Ocupación por estilista — booked slots / scheduled slots (top 5)
    const byEmp = {}
    for (const a of appts) {
      const eid = a.empleado_id || a.empleado_supabase_id
      if (!eid) continue
      const dur = Number(a.duration) || 60
      const nm = a.empleados?.nombre || a.empleado_name || empName(eid)
      byEmp[eid] = byEmp[eid] || { eid, name: nm, bookedMin: 0 }
      byEmp[eid].bookedMin += dur
    }
    // Approximate scheduled mins at 12h (8:00 - 20:00 = 720)
    const SCHEDULE_MIN = 720
    const occupancy = Object.values(byEmp).map(e => ({
      ...e, pct: Math.min(100, Math.round((e.bookedMin / SCHEDULE_MIN) * 100)),
    })).sort((a, b) => b.pct - a.pct).slice(0, 5)

    // Ingresos del mes
    const ingresos = (tickets || [])
      .filter(t => t.status === 'cobrado' || t.status === 'paid')
      .reduce((s, t) => s + (Number(t.total) || 0), 0)

    // Top servicios (count from ticket items lines names) — fallback uses tickets.service_names
    const svcCount = {}
    for (const t of tickets) {
      // Simpler: read t.service_names string if available
      const names = t.service_names ? String(t.service_names).split(',').map(s => s.trim()).filter(Boolean) : []
      for (const n of names) svcCount[n] = (svcCount[n] || 0) + 1
    }
    const topServicios = Object.entries(svcCount)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count).slice(0, 5)

    // Productos vendidos — sum of retail line quantities (best-effort)
    const productosVendidos = (tickets || []).reduce((s, t) => s + (Number(t.retail_qty) || 0), 0)

    return { apptCount, occupancy, ingresos, topServicios, productosVendidos }
  }, [appts, tickets, empleados]) // eslint-disable-line

  if (loading) return (
    <div className="flex-1 flex items-center justify-center bg-slate-50 dark:bg-black">
      <Loader2 className="animate-spin text-slate-400 dark:text-white/40" size={22} />
    </div>
  )

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-black">
      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        <div className="mb-5">
          <h1 className="text-[18px] md:text-[22px] font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <Scissors size={22} className="text-[#b3001e]" />
            {L('Resumen', 'Overview')}
          </h1>
          <p className="text-[12px] text-slate-500 dark:text-white/50 mt-1">
            {L('Operación de hoy y rendimiento del mes.', 'Today\'s operation and month performance.')}
          </p>
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
          <Tile to="/appointments" icon={Calendar}    label={L('Citas Hoy', 'Today\'s Appts')} value={kpis.apptCount} />
          <OccupancyTile occupancy={kpis.occupancy} lang={lang} />
          <Tile                     icon={DollarSign}  label={L('Ingresos Mes', 'Month Revenue')} value={fmtRD(kpis.ingresos)} />
          <TopServicesTile          top={kpis.topServicios} lang={lang} />
          <Tile                     icon={Package}     label={L('Productos Vendidos (mes)', 'Products Sold (mo)')} value={kpis.productosVendidos} />
        </div>

        {/* Detail cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Próximas 24h */}
          <Card title={L('Próximas Citas (24h)', 'Upcoming (24h)')} icon={Clock} to="/appointments">
            {upcoming.length === 0 ? (
              <p className="text-[12px] text-slate-400 dark:text-white/40 py-6 text-center">
                {L('No hay citas próximas.', 'No upcoming appointments.')}
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-white/10">
                {upcoming.slice(0, 6).map(a => (
                  <li key={a.id || a.supabase_id} className="py-2.5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="text-[12px] font-mono font-bold text-[#b3001e] shrink-0 w-12">{a.start_time || '—'}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-slate-700 dark:text-white truncate">
                          {a.clients?.name || a.client_name || L('Walk-in', 'Walk-in')}
                        </p>
                        <p className="text-[11px] text-slate-400 dark:text-white/40 flex items-center gap-1">
                          <User size={10} />
                          {a.empleados?.nombre || a.empleado_name || empName(a.empleado_id || a.empleado_supabase_id)}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Recordatorios pendientes */}
          <Card title={L('Recordatorios Pendientes', 'Pending Reminders')} icon={Bell}>
            {reminders.length === 0 ? (
              <p className="text-[12px] text-slate-400 dark:text-white/40 py-6 text-center">
                {L('Sin recordatorios programados.', 'No reminders scheduled.')}
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-white/10">
                {reminders.slice(0, 6).map(r => (
                  <li key={r.id || r.supabase_id} className="py-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-semibold text-slate-700 dark:text-white">
                        {r.kind === '24h' ? L('24h antes', '24h before')
                          : r.kind === '2h' ? L('2h antes', '2h before')
                          : r.kind === 'confirm' ? L('Confirmación', 'Confirmation')
                          : L('Manual', 'Manual')}
                      </p>
                      <p className="text-[10px] text-slate-400 dark:text-white/40">
                        {new Date(r.fire_at).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' })}
                      </p>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 text-[10px] font-bold uppercase">
                      {L('Pendiente', 'Pending')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

// ── Tiles ──────────────────────────────────────────────────────────────────

function Tile({ to, icon: Icon, label, value }) {
  const inner = (
    <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 p-4 hover:border-[#b3001e] dark:hover:border-[#b3001e] transition-colors h-full">
      <div className="flex items-center justify-between mb-3">
        <Icon size={18} className="text-[#b3001e]" />
        {to && <ArrowRight size={13} className="text-slate-300 dark:text-white/30" />}
      </div>
      <div className="text-[20px] md:text-[22px] font-bold text-slate-800 dark:text-white leading-tight">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40 mt-1">{label}</div>
    </div>
  )
  return to ? <Link to={to}>{inner}</Link> : inner
}

function OccupancyTile({ occupancy, lang }) {
  const L = (es, en) => lang === 'es' ? es : en
  const top = occupancy[0]
  return (
    <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 p-4 h-full">
      <div className="flex items-center justify-between mb-2">
        <TrendingUp size={18} className="text-[#b3001e]" />
      </div>
      <div className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40 mb-2">
        {L('% Ocupación', '% Occupancy')}
      </div>
      {occupancy.length === 0 ? (
        <p className="text-[12px] text-slate-400 dark:text-white/40">—</p>
      ) : (
        <div className="space-y-1.5">
          {occupancy.slice(0, 3).map(o => (
            <div key={o.eid} className="flex items-center gap-2">
              <span className="text-[11px] text-slate-600 dark:text-white/70 truncate flex-1">{o.name}</span>
              <div className="w-12 h-1.5 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden">
                <div className="h-full bg-[#b3001e]" style={{ width: `${o.pct}%` }} />
              </div>
              <span className="text-[10px] font-bold text-slate-700 dark:text-white shrink-0 w-7 text-right">{o.pct}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TopServicesTile({ top, lang }) {
  const L = (es, en) => lang === 'es' ? es : en
  return (
    <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 p-4 h-full">
      <div className="flex items-center justify-between mb-2">
        <Scissors size={18} className="text-[#b3001e]" />
      </div>
      <div className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40 mb-2">
        {L('Top 5 Servicios (mes)', 'Top 5 Services (mo)')}
      </div>
      {top.length === 0 ? (
        <p className="text-[12px] text-slate-400 dark:text-white/40">—</p>
      ) : (
        <ul className="space-y-1">
          {top.map((s, i) => (
            <li key={s.name} className="flex items-center justify-between text-[11px]">
              <span className="text-slate-600 dark:text-white/70 truncate flex-1">
                <span className="text-slate-400 dark:text-white/30 mr-1">#{i + 1}</span>
                {s.name}
              </span>
              <span className="font-bold text-slate-800 dark:text-white shrink-0 ml-2">{s.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Card({ title, icon: Icon, to, children }) {
  return (
    <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[13px] font-bold text-slate-700 dark:text-white flex items-center gap-2">
          <Icon size={15} className="text-[#b3001e]" />
          {title}
        </h2>
        {to && (
          <Link to={to} className="text-[11px] text-[#b3001e] hover:underline flex items-center gap-1">
            <ArrowRight size={11} />
          </Link>
        )}
      </div>
      {children}
    </div>
  )
}
