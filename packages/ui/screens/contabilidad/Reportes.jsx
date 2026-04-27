// Reportes — Reportes ejecutivos por cliente y vista agregada del bufete.
// Plan-gated by `contabilidad_reportes_ejecutivos`.
//
// Vista por cliente:
//   – Resumen P&L (ingresos − costos − gastos) del período YTD
//   – Activo / Pasivo / Patrimonio al cierre
//   – Cobertura DGII: obligaciones radicadas vs. pendientes
//   – Honorarios: facturado, cobrado, vencido (aging 30/60/90)
//   – Botón Compartir por WhatsApp (link a wa.me con resumen)
//
// Vista bufete (aggregated):
//   – Total honorarios cobrados del mes
//   – Cuentas por cobrar abiertas + aging
//   – Tareas pendientes / en progreso / vencidas
//   – Alertas: obligaciones DGII venciendo en ≤7 días
//   – Top 5 clientes por honorarios

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BarChart3, FileDown, MessageCircle, Lock, Building2, AlertTriangle,
  TrendingUp, ClipboardList, Calendar, DollarSign,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { usePlan } from '../../hooks/usePlan'
import { contabilidadReporteEjecutivo, contabilidadEstadosListos } from '@terminal-x/services/whatsapp-business-stub.js'

const MONTHS_LABEL = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
]

function fmtRD(n) { return Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

function ComingSoon() {
  return (
    <div className="p-6 max-w-2xl">
      <div className="rounded-2xl border border-[#b3001e]/30 bg-[#b3001e]/5 p-6">
        <div className="flex items-center gap-2 text-[#b3001e] font-bold mb-2"><Lock size={16}/> Próximamente</div>
        <div className="text-sm text-black/80 dark:text-white/80">El módulo Reportes Ejecutivos requiere el plan Pro CTB o Pro MAX.</div>
      </div>
    </div>
  )
}

function signedSaldo(type, debit, credit) {
  if (type === 'activo' || type === 'costo' || type === 'gasto') return debit - credit
  return credit - debit
}

async function aggregateByAccount(api, clientId, year, untilMonth) {
  const map = new Map()
  if (!api?.contabilidad || !clientId) return map
  for (let m = 1; m <= untilMonth; m++) {
    const entries = await api.contabilidad.journalEntryList({
      accountingClientId: clientId, periodYear: year, periodMonth: m, status: 'posted',
    }) || []
    for (const e of entries) {
      const lines = await api.contabilidad.journalLineList({ journalEntryId: e.id, journalEntrySupabaseId: e.supabase_id }) || []
      for (const l of lines) {
        if (!l.account_id) continue
        const cur = map.get(l.account_id) || { debit: 0, credit: 0 }
        cur.debit  += Number(l.debit  || 0)
        cur.credit += Number(l.credit || 0)
        map.set(l.account_id, cur)
      }
    }
  }
  return map
}

// ── Vista por cliente ────────────────────────────────────────────────────────

function ClientReport({ api, client, accounts, year, month, obligations, invoices }) {
  const [agg, setAgg] = useState(new Map())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setBusy(true)
      const m = await aggregateByAccount(api, client.id, year, month)
      if (!cancelled) setAgg(m)
      if (!cancelled) setBusy(false)
    }
    load()
    return () => { cancelled = true }
  }, [api, client.id, year, month])

  const stats = useMemo(() => {
    let ing = 0, cos = 0, gas = 0, act = 0, pas = 0, pat = 0
    for (const a of accounts || []) {
      if (!a.is_postable) continue
      const t = agg.get(a.id); if (!t) continue
      const s = signedSaldo(a.type, t.debit, t.credit)
      if (a.type === 'ingreso') ing += s
      else if (a.type === 'costo') cos += s
      else if (a.type === 'gasto') gas += s
      else if (a.type === 'activo') act += s
      else if (a.type === 'pasivo') pas += s
      else if (a.type === 'patrimonio') pat += s
    }
    const utilidad = ing - cos - gas
    return { ing, cos, gas, utilidad, act, pas, pat, margenPct: ing > 0 ? (utilidad / ing) * 100 : 0 }
  }, [accounts, agg])

  const dgiiCoverage = useMemo(() => {
    const filtered = obligations.filter(o => o.accounting_client_id === client.id && o.period_year === year)
    const radicadas = filtered.filter(o => o.status === 'radicado' || o.status === 'pagado').length
    return { total: filtered.length, radicadas, pct: filtered.length ? (radicadas / filtered.length) * 100 : 0 }
  }, [obligations, client.id, year])

  const honorarios = useMemo(() => {
    const filtered = invoices.filter(i => i.accounting_client_id === client.id)
    const facturado = filtered.reduce((s, i) => s + Number(i.amount || 0), 0)
    const cobrado   = filtered.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.amount || 0), 0)
    const vencido   = filtered
      .filter(i => i.status !== 'paid' && i.status !== 'void')
      .reduce((s, i) => {
        const days = Math.floor((Date.now() - new Date(i.created_at || Date.now()).getTime()) / 86400000)
        return days > 30 ? s + Number(i.amount || 0) : s
      }, 0)
    return { facturado, cobrado, vencido }
  }, [invoices, client.id])

  const phone = (client.notes || '').match(/8\d{9}/)?.[0] || ''

  function exportPDF() {
    const text = [
      `${client.nombre_comercial}`,
      `Reporte ejecutivo · YTD ${year} (al cierre de ${MONTHS_LABEL[month - 1]})`,
      ''.padEnd(60, '─'),
      'P&L',
      `  Ingresos:           RD$ ${fmtRD(stats.ing)}`,
      `  Costos:             RD$ ${fmtRD(stats.cos)}`,
      `  Gastos:             RD$ ${fmtRD(stats.gas)}`,
      `  Utilidad:           RD$ ${fmtRD(stats.utilidad)}  (${stats.margenPct.toFixed(1)}%)`,
      '',
      'Posición financiera al cierre',
      `  Activo:             RD$ ${fmtRD(stats.act)}`,
      `  Pasivo:             RD$ ${fmtRD(stats.pas)}`,
      `  Patrimonio:         RD$ ${fmtRD(stats.pat)}`,
      '',
      'Cumplimiento DGII',
      `  ${dgiiCoverage.radicadas}/${dgiiCoverage.total} obligaciones radicadas (${dgiiCoverage.pct.toFixed(0)}%)`,
      '',
      'Honorarios',
      `  Facturado YTD:      RD$ ${fmtRD(honorarios.facturado)}`,
      `  Cobrado YTD:        RD$ ${fmtRD(honorarios.cobrado)}`,
      `  Vencido (>30d):     RD$ ${fmtRD(honorarios.vencido)}`,
    ].join('\n')
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `reporte_${(client.nombre_comercial || 'cliente').replace(/\W+/g,'_')}_${year}${String(month).padStart(2,'0')}.txt`
    a.click(); URL.revokeObjectURL(url)
  }

  function shareWhatsApp() {
    const { url } = contabilidadReporteEjecutivo({
      phone,
      cliente: client.nombre_comercial,
      periodo: `${MONTHS_LABEL[month - 1]} ${year}`,
    })
    window.open(url, '_blank', 'noopener')
  }

  function shareEstados() {
    const { url } = contabilidadEstadosListos({
      phone,
      cliente: client.nombre_comercial,
      periodo: `${MONTHS_LABEL[month - 1]} ${year}`,
    })
    window.open(url, '_blank', 'noopener')
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Ingresos YTD" value={`RD$ ${fmtRD(stats.ing)}`} icon={TrendingUp}/>
        <Stat label="Utilidad neta" value={`RD$ ${fmtRD(stats.utilidad)}`} sub={`${stats.margenPct.toFixed(1)}% margen`} icon={BarChart3} highlight={stats.utilidad >= 0}/>
        <Stat label="Cumplimiento DGII" value={`${dgiiCoverage.pct.toFixed(0)}%`} sub={`${dgiiCoverage.radicadas}/${dgiiCoverage.total} radicadas`} icon={Calendar}/>
        <Stat label="Honorarios cobrados" value={`RD$ ${fmtRD(honorarios.cobrado)}`} sub={`Vencido: RD$ ${fmtRD(honorarios.vencido)}`} icon={DollarSign}/>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-black p-4">
          <div className="font-bold mb-2">Estado de Resultados</div>
          <Row label="Ingresos"          value={stats.ing}/>
          <Row label="Costos"            value={-stats.cos} dim/>
          <Row label="Gastos operativos" value={-stats.gas} dim/>
          <div className="border-t-2 border-[#b3001e] mt-2 pt-2">
            <Row label="Utilidad / (Pérdida)" value={stats.utilidad} bold/>
          </div>
        </div>
        <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-black p-4">
          <div className="font-bold mb-2">Posición financiera</div>
          <Row label="Activo total"  value={stats.act}/>
          <Row label="Pasivo total"  value={stats.pas}/>
          <Row label="Patrimonio"    value={stats.pat}/>
          <div className="border-t border-black/10 dark:border-white/10 mt-2 pt-2 text-xs text-black/60 dark:text-white/60">
            Diferencia A − (P + Pat): {fmtRD(stats.act - stats.pas - stats.pat)}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={exportPDF} className="inline-flex items-center gap-1 rounded-lg bg-black text-white dark:bg-white dark:text-black px-3 py-2 text-sm font-bold">
          <FileDown size={14}/> Descargar resumen
        </button>
        <button onClick={shareWhatsApp} disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-[#b3001e] text-white px-3 py-2 text-sm font-bold hover:bg-[#8f0018]">
          <MessageCircle size={14}/> Compartir reporte por WhatsApp
        </button>
        <button onClick={shareEstados} className="inline-flex items-center gap-1 rounded-lg border border-black/10 dark:border-white/10 px-3 py-2 text-sm font-bold">
          <MessageCircle size={14}/> Avisar estados listos
        </button>
        {busy && <span className="text-xs text-[#b3001e] font-bold">Calculando…</span>}
      </div>
    </div>
  )
}

function Row({ label, value, dim, bold }) {
  return (
    <div className={`flex items-center justify-between py-1 text-sm ${dim ? 'text-black/60 dark:text-white/60' : ''}`}>
      <span className={bold ? 'font-bold' : ''}>{label}</span>
      <span className={`font-mono ${bold ? 'font-bold text-[#b3001e]' : ''}`}>RD$ {fmtRD(value)}</span>
    </div>
  )
}

function Stat({ label, value, sub, icon: Icon, highlight }) {
  return (
    <div className={`rounded-2xl border p-3 bg-white dark:bg-black ${highlight ? 'border-[#b3001e]/40' : 'border-black/10 dark:border-white/10'}`}>
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50 mb-1">
        {Icon && <Icon size={12} className="text-[#b3001e]"/>} {label}
      </div>
      <div className="text-lg font-black text-black dark:text-white">{value}</div>
      {sub && <div className="text-[10px] text-black/50 dark:text-white/50 mt-0.5">{sub}</div>}
    </div>
  )
}

// ── Vista bufete ──────────────────────────────────────────────────────────────

function FirmReport({ api, clients, year, month }) {
  const [invoices, setInvoices] = useState([])
  const [obligations, setObligations] = useState([])
  const [tasks, setTasks] = useState([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!api?.contabilidad) return
      const [inv, obs, tk] = await Promise.all([
        api.contabilidad.billingInvoiceList(),
        api.contabilidad.obligationsList({ dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` }),
        api.contabilidad.taskList(),
      ])
      if (cancelled) return
      setInvoices(inv || [])
      setObligations(obs || [])
      setTasks(tk || [])
    }
    load()
    return () => { cancelled = true }
  }, [api, year])

  const stats = useMemo(() => {
    const monthInvoices = invoices.filter(i => i.period_year === year && i.period_month === month)
    const cobradoMes = monthInvoices.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.amount || 0), 0)
    const facturadoMes = monthInvoices.reduce((s, i) => s + Number(i.amount || 0), 0)
    const cxc = invoices.filter(i => i.status !== 'paid' && i.status !== 'void')
    const cxcTotal = cxc.reduce((s, i) => s + Number(i.amount || 0), 0)
    const aging = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }
    const today = Date.now()
    for (const i of cxc) {
      const days = Math.floor((today - new Date(i.created_at || today).getTime()) / 86400000)
      const k = days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+'
      aging[k] += Number(i.amount || 0)
    }
    const tareas = {
      pending:     tasks.filter(t => t.status === 'pending').length,
      in_progress: tasks.filter(t => t.status === 'in_progress').length,
      review:      tasks.filter(t => t.status === 'review').length,
      vencidas:    tasks.filter(t => t.due_date && t.status !== 'done' && new Date(t.due_date) < new Date()).length,
    }
    // Top 5 clientes por facturado YTD
    const byClient = new Map()
    for (const i of invoices) {
      if (i.period_year !== year) continue
      const v = (byClient.get(i.accounting_client_id) || 0) + Number(i.amount || 0)
      byClient.set(i.accounting_client_id, v)
    }
    const top5 = Array.from(byClient.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cid, total]) => ({ client: clients.find(c => c.id === cid), total }))
      .filter(x => x.client)
    // Obligaciones DGII venciendo en 7 días
    const horizon = new Date(); horizon.setDate(horizon.getDate() + 7)
    const upcoming = obligations
      .filter(o => o.status !== 'radicado' && o.status !== 'pagado' && o.due_date)
      .filter(o => {
        const due = new Date(o.due_date + 'T23:59:59')
        return due >= new Date() && due <= horizon
      })
      .slice(0, 20)
    return { cobradoMes, facturadoMes, cxcTotal, aging, tareas, top5, upcoming }
  }, [invoices, obligations, tasks, year, month, clients])

  const clientName = (id) => clients.find(c => c.id === id)?.nombre_comercial || '—'

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label={`Cobrado ${MONTHS_LABEL[month - 1]}`} value={`RD$ ${fmtRD(stats.cobradoMes)}`} sub={`Facturado: RD$ ${fmtRD(stats.facturadoMes)}`} icon={DollarSign}/>
        <Stat label="Cuentas por cobrar" value={`RD$ ${fmtRD(stats.cxcTotal)}`} sub={`>90d: RD$ ${fmtRD(stats.aging['90+'])}`} icon={AlertTriangle}/>
        <Stat label="Tareas vencidas" value={stats.tareas.vencidas} sub={`En progreso: ${stats.tareas.in_progress}`} icon={ClipboardList}/>
        <Stat label="Vencimientos DGII (7d)" value={stats.upcoming.length} sub="Próximos 7 días" icon={Calendar}/>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-black p-4">
          <div className="font-bold mb-2">Aging de cobranza</div>
          {Object.entries(stats.aging).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between py-1 text-sm">
              <span>{k} días</span>
              <span className="font-mono font-bold">{fmtRD(v)}</span>
            </div>
          ))}
          <div className="border-t-2 border-[#b3001e] mt-2 pt-2 flex items-center justify-between">
            <span className="font-bold">Total CxC</span>
            <span className="font-mono font-bold text-[#b3001e]">RD$ {fmtRD(stats.cxcTotal)}</span>
          </div>
        </div>

        <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-black p-4">
          <div className="font-bold mb-2">Top 5 clientes (facturado YTD)</div>
          {!stats.top5.length && <div className="text-xs text-black/50 dark:text-white/50">Sin datos del año.</div>}
          {stats.top5.map((row, i) => (
            <div key={row.client.id} className="flex items-center justify-between py-1 text-sm">
              <span><span className="font-bold text-[#b3001e]">#{i + 1}</span> {row.client.nombre_comercial}</span>
              <span className="font-mono font-bold">RD$ {fmtRD(row.total)}</span>
            </div>
          ))}
        </div>
      </div>

      {stats.upcoming.length > 0 && (
        <div className="rounded-2xl border border-[#b3001e]/30 bg-[#b3001e]/5 p-4">
          <div className="font-bold text-[#b3001e] mb-2 inline-flex items-center gap-1"><AlertTriangle size={14}/> Vencimientos DGII en 7 días</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {stats.upcoming.map(o => (
              <div key={o.id} className="rounded-xl border border-[#b3001e]/30 bg-white dark:bg-black p-2 text-xs">
                <div className="font-bold">{o.form_type}</div>
                <div className="text-[10px] text-black/60 dark:text-white/60">{clientName(o.accounting_client_id)}</div>
                <div className="text-[10px] mt-0.5">Vence {o.due_date}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Shell ─────────────────────────────────────────────────────────────────────

const VIEWS = [
  { id: 'firm',   label: 'Vista bufete' },
  { id: 'client', label: 'Por cliente' },
]

export default function Reportes() {
  const api = useAPI()
  const { hasFeature } = usePlan()
  const allowed = hasFeature('contabilidad_reportes_ejecutivos')

  const [view, setView] = useState('firm')
  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [obligations, setObligations] = useState([])
  const [invoices, setInvoices] = useState([])
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!api?.contabilidad) return
      const [c, obs, inv] = await Promise.all([
        api.contabilidad.clientList(),
        api.contabilidad.obligationsList({ dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` }),
        api.contabilidad.billingInvoiceList(),
      ])
      if (cancelled) return
      setClients(c || [])
      setObligations(obs || [])
      setInvoices(inv || [])
      if (!clientId && c?.length) setClientId(c[0].id)
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, year])

  const reloadAccounts = useCallback(async () => {
    if (!api?.contabilidad || !clientId) { setAccounts([]); return }
    const r = await api.contabilidad.coaList({ accountingClientId: clientId })
    setAccounts(r || [])
  }, [api, clientId])
  useEffect(() => { reloadAccounts() }, [reloadAccounts])

  const client = useMemo(() => clients.find(c => c.id === clientId), [clients, clientId])

  if (!allowed) return <ComingSoon/>

  return (
    <div className="flex flex-col min-h-full">
      <div className="border-b border-black/10 dark:border-white/10 bg-white dark:bg-black px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 font-bold text-[#b3001e]"><BarChart3 size={16}/> Reportes ejecutivos</div>
        <div className="flex gap-1">
          {VIEWS.map(v => (
            <button key={v.id} onClick={() => setView(v.id)}
              className={`px-3 py-2 rounded-lg text-xs font-bold ${view === v.id ? 'bg-[#b3001e] text-white' : 'text-black/70 dark:text-white/70 hover:bg-[#b3001e]/10 hover:text-[#b3001e]'}`}>
              {v.label}
            </button>
          ))}
        </div>
        {view === 'client' && (
          <select value={clientId || ''} onChange={(e) => setClientId(Number(e.target.value) || null)}
            className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
            <option value="">— Cliente —</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.nombre_comercial}</option>)}
          </select>
        )}
        <div className="flex gap-2 ml-auto">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
            {[today.getFullYear() + 1, today.getFullYear(), today.getFullYear() - 1, today.getFullYear() - 2].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
            className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
            {MONTHS_LABEL.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
        </div>
      </div>

      <div className="flex-1 min-w-0 bg-white dark:bg-black p-4">
        {view === 'firm' && (
          <FirmReport api={api} clients={clients} year={year} month={month}/>
        )}
        {view === 'client' && (!client ? (
          <div className="p-6 text-sm text-black/60 dark:text-white/60 inline-flex items-center gap-2">
            <Building2 size={16}/> Selecciona un cliente.
          </div>
        ) : (
          <ClientReport api={api} client={client} accounts={accounts} year={year} month={month}
            obligations={obligations} invoices={invoices}/>
        ))}
      </div>
    </div>
  )
}
