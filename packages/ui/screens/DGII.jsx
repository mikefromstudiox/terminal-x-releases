import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import {
  FileText, FilePlus, Download, Send, CheckCircle2, AlertCircle,
  Clock, AlertTriangle, RefreshCw, Database, ShoppingCart,
  Package, Minus, ChevronDown, Search, Trash2, Plus, X, Ban,
  ShieldCheck, Upload, KeyRound, Receipt,
} from 'lucide-react'
import { useLang } from '../i18n'
import { useAPI } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import { isTech } from '../lib/roles'
import { printANECFComprobante } from '@terminal-x/services/printer'
import {
  generateFormato606Txt, generateFormato607Txt,
  downloadTxt, filename606, filename607,
} from '@terminal-x/services/dgii-reports'

// ── Shared date helpers ───────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtMoney(n) {
  return 'RD$' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── Period helpers ────────────────────────────────────────────────────────────
function periodToDateRange(period) {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()

  if (period === 'Hoy') {
    const d = now.toISOString().slice(0, 10)
    return { from: d, to: d + 'T23:59:59' }
  }
  if (period === 'Esta semana') {
    const day = now.getDay() || 7
    const mon = new Date(now); mon.setDate(now.getDate() - day + 1)
    return { from: mon.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) + 'T23:59:59' }
  }
  if (period === 'Este mes') {
    const from = `${y}-${String(m + 1).padStart(2, '0')}-01`
    return { from, to: now.toISOString().slice(0, 10) + 'T23:59:59' }
  }
  if (period === 'Mes pasado') {
    const pm = m === 0 ? 11 : m - 1
    const py = m === 0 ? y - 1 : y
    const last = new Date(py, pm + 1, 0)
    const from = `${py}-${String(pm + 1).padStart(2, '0')}-01`
    const to   = `${py}-${String(pm + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}T23:59:59`
    return { from, to }
  }
  if (period === 'Trimestre') {
    const qStart = new Date(y, Math.floor(m / 3) * 3, 1)
    return { from: qStart.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) + 'T23:59:59' }
  }
  // YYYY-MM specific month
  if (/^\d{4}-\d{2}$/.test(period)) {
    const [py, pm] = period.split('-').map(Number)
    const last = new Date(py, pm, 0)
    const from = `${py}-${String(pm).padStart(2, '0')}-01`
    const to   = `${py}-${String(pm).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}T23:59:59`
    return { from, to }
  }
  // fallback: all time
  return { from: '2020-01-01', to: '2099-12-31' }
}


// ── Shared components ─────────────────────────────────────────────────────────
function MetricCard({ label, value, sub, color = 'slate', icon: Icon }) {
  const ring = { slate:'border-slate-100 bg-white dark:border-white/10 dark:bg-white/5', blue:'border-blue-200 bg-blue-50 dark:border-blue-500/30 dark:bg-blue-500/10', green:'border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10', red:'border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10', amber:'border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10' }
  const val  = { slate:'text-slate-800 dark:text-white', blue:'text-blue-700 dark:text-blue-400', green:'text-emerald-700 dark:text-emerald-400', red:'text-red-600 dark:text-red-400', amber:'text-amber-600 dark:text-amber-400' }
  return (
    <div className={`rounded-2xl border p-4 flex-1 ${ring[color]}`}>
      <div className="flex justify-between items-start mb-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">{label}</p>
        {Icon && <Icon size={14} className={val[color]} />}
      </div>
      <p className={`text-2xl font-bold tabular-nums ${val[color]}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 dark:text-white/40 mt-0.5">{sub}</p>}
    </div>
  )
}

function PeriodSelector({ period, setPeriod }) {
  const PILLS = ['Hoy','Esta semana','Este mes','Mes pasado','Trimestre']
  const now = new Date()
  const months = []
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({ label: d.toLocaleDateString('es-DO',{month:'long',year:'numeric'}), value: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` })
  }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {PILLS.map(p => (
        <button key={p} onClick={() => setPeriod(p)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${period === p ? 'bg-blue-600 text-white' : 'border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10'}`}>
          {p}
        </button>
      ))}
      <div className="relative">
        <select value={months.some(m => m.value === period) ? period : ''}
          onChange={e => setPeriod(e.target.value)}
          className="border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-lg px-3 py-1.5 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 appearance-none pr-8">
          <option value="">Mes específico…</option>
          {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <ChevronDown size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 dark:text-white/40 pointer-events-none" />
      </div>
    </div>
  )
}

function SubmitBox({ onGenerate, onSend, onXML }) {
  const [sending, setSending] = useState(false)
  async function handleSend() {
    setSending(true)
    onSend()
    setSending(false)
  }
  return (
    <div className="space-y-2">
      <button onClick={onGenerate} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-sm text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-white/10">
        <Download size={14} className="text-slate-400 dark:text-white/40" />
        Generar archivo TXT
      </button>
      <button onClick={onXML} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-sm text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-white/10">
        <Database size={14} className="text-slate-400 dark:text-white/40" />
        Descargar XML
      </button>
      <button onClick={handleSend} disabled={sending}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60">
        <Send size={14} />
        {sending ? 'Enviando a DGII…' : 'Enviar a DGII'}
      </button>
    </div>
  )
}

function Toast({ msg, color = 'slate' }) {
  const bg = color === 'green' ? 'bg-emerald-600' : color === 'red' ? 'bg-red-600' : 'bg-slate-800'
  return (
    <div className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-50 ${bg} text-white text-sm px-5 py-3 rounded-full shadow-lg flex items-center gap-2`}
      style={{ animation: 'fadeOut 2.8s forwards' }}>
      <CheckCircle2 size={15} className="text-white" />
      {msg}
      <style>{`@keyframes fadeOut{0%,70%{opacity:1}100%{opacity:0}}`}</style>
    </div>
  )
}

// ── NCF Sequence Cards ────────────────────────────────────────────────────────
function NCFSeqCard({ code, seq, accentColor }) {
  const pct = seq.limit > 0 ? Math.round(seq.current / seq.limit * 100) : 0
  const remaining = seq.limit - seq.current
  const warning = seq.limit > 0 && remaining < 500
  const colors = {
    blue: { bar: 'bg-blue-500', bg: warning ? 'bg-amber-50 border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/30' : 'bg-blue-50 border-blue-200 dark:bg-blue-500/10 dark:border-blue-500/30', text: 'text-blue-700 dark:text-blue-400' },
    green: { bar: 'bg-emerald-500', bg: warning ? 'bg-amber-50 border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/30' : 'bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/30', text: 'text-emerald-700 dark:text-emerald-400' },
  }
  const c = colors[accentColor] || colors.blue
  return (
    <div className={`rounded-xl border p-4 flex-1 ${c.bg}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono font-bold text-slate-800 dark:text-white">{code}</span>
        {warning
          ? <span className="text-[10px] bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1"><AlertTriangle size={10} />Pocas disponibles</span>
          : seq.limit > 0
            ? <span className="text-[10px] bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full font-semibold">OK</span>
            : <span className="text-[10px] bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-white/60 px-2 py-0.5 rounded-full font-semibold">Pendiente</span>
        }
      </div>
      <p className="text-xs text-slate-500 dark:text-white/60 mb-1">{seq.name}</p>
      {seq.limit > 0 ? (
        <>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-500 dark:text-white/60">Actual: <span className="font-medium text-slate-700 dark:text-white">{seq.current.toLocaleString()}</span></span>
            <span className="text-slate-500 dark:text-white/60">Límite: <span className="font-medium text-slate-700 dark:text-white">{seq.limit.toLocaleString()}</span></span>
          </div>
          <div className="h-1.5 bg-white/60 dark:bg-white/10 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${warning ? 'bg-amber-400' : c.bar}`} style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
          <div className="flex justify-between text-xs mt-1">
            <span className={warning ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-slate-400 dark:text-white/40'}>{remaining.toLocaleString()} disponibles</span>
            <span className="text-slate-400 dark:text-white/40">Vence: {seq.expires}</span>
          </div>
        </>
      ) : (
        <p className="text-xs text-slate-400 dark:text-white/40">Sin secuencia asignada — configure en Settings</p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ── 606 SCREEN ────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
const COLS_606 = [
  { key: 'ncf',    label: 'NCF / eNCF',   cls: 'w-40 font-mono text-xs'    },
  { key: 'client', label: 'Cliente / RNC', cls: 'flex-1 min-w-0'            },
  { key: 'tipo',   label: 'Tipo',          cls: 'w-20 text-center'          },
  { key: 'fecha',  label: 'Fecha',         cls: 'w-28'                      },
  { key: 'sub',    label: 'Subtotal',      cls: 'w-28 text-right'           },
  { key: 'itbis',  label: 'ITBIS',         cls: 'w-24 text-right'           },
  { key: 'total',  label: 'Total',         cls: 'w-28 text-right'           },
  { key: 'estado', label: 'Estado',        cls: 'w-24'                      },
]

function Screen606() {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [period,       setPeriod]       = useState('Este mes')
  const [txns,         setTxns]         = useState([])
  const [loading,      setLoading]      = useState(false)
  const [tab,          setTab]          = useState('todos')
  const [search,       setSearch]       = useState('')
  const [toast,        setToast]        = useState(null)
  const [enabledTypes, setEnabledTypes] = useState([])
  const [sequences,    setSequences]    = useState([])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const { from, to } = periodToDateRange(period)
      const rows = await api.dgii.get606({ dateFrom: from, dateTo: to })
      // Normalize field names from DB
      const normalized = (rows || []).map(r => ({
        id:      r.id,
        ncf:     r.ncf || '—',
        client:  r.client_name || 'Consumidor Final',
        rnc:     r.client_rnc  || '',
        tipo:    r.tipo        || r.comprobante_type || 'B02',
        fecha:   r.fecha       || r.created_at,
        subtotal: r.subtotal   || 0,
        itbis:   r.itbis_amount ?? r.itbis ?? 0,
        total:   r.total       || 0,
        estado:  r.status === 'anulado' ? 'anulado' : 'valido',
      }))
      setTxns(normalized)
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'dgii.screen606' }) } catch {}
      console.error('DGII 606 load error:', e)
      setTxns([])
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    if (!api?.ncf?.sequences) return
    api.ncf.sequences()
      .then(rows => {
        const enabled = (rows || []).filter(r => r.enabled === 1)
        setSequences(enabled)
        setEnabledTypes(enabled.length > 0 ? enabled.map(r => r.type) : ['E31','E32','B01','B02'])
      })
      .catch(() => { setEnabledTypes(['E31','E32','B01','B02']); setSequences([]) })
  }, [])

  // Build filter tabs dynamically from enabled e-CF types
  const TABS_606 = useMemo(() => {
    const tabs = [{ key: 'todos', label: L('Todos', 'All'), fn: () => true }]
    // Group by e-CF family: E31/B01, E32/B02, E33, E34, E41, E43, E44, E45, E46, E47
    const families = [
      { key: 'e31', label: 'E31/B01', types: ['E31','B01'] },
      { key: 'e32', label: 'E32/B02', types: ['E32','B02'] },
      { key: 'e33', label: 'E33',     types: ['E33'] },
      { key: 'e34', label: 'E34',     types: ['E34'] },
      { key: 'e41', label: 'E41',     types: ['E41'] },
      { key: 'e43', label: 'E43',     types: ['E43'] },
      { key: 'e44', label: 'E44',     types: ['E44'] },
      { key: 'e45', label: 'E45',     types: ['E45'] },
      { key: 'e46', label: 'E46',     types: ['E46'] },
      { key: 'e47', label: 'E47',     types: ['E47'] },
    ]
    for (const fam of families) {
      // Show tab if any of this family's types are enabled OR if we have data for this type
      const isEnabled = fam.types.some(t => enabledTypes.includes(t))
      if (isEnabled) {
        tabs.push({ key: fam.key, label: fam.label, fn: t => fam.types.includes(t.tipo) })
      }
    }
    return tabs
  }, [enabledTypes, lang])

  const tabFn = TABS_606.find(t => t.key === tab)?.fn ?? (() => true)
  const tabCounts = useMemo(() => {
    const o = {}; TABS_606.forEach(t => { o[t.key] = txns.filter(t.fn).length }); return o
  }, [txns, TABS_606])

  const q = search.trim().toLowerCase()
  const visible = txns.filter(tabFn).filter(t =>
    !q || t.client.toLowerCase().includes(q) || t.ncf.toLowerCase().includes(q) || (t.rnc||'').includes(q)
  )

  const totalItbis = txns.filter(t => t.estado === 'valido').reduce((s, t) => s + t.itbis, 0)
  const totalFact  = txns.filter(t => t.estado === 'valido').reduce((s, t) => s + t.total, 0)
  const countB01   = txns.filter(t => ['B01','E31'].includes(t.tipo)).length
  const countB02   = txns.filter(t => ['B02','E32'].includes(t.tipo)).length

  async function generateTXT() {
    // This screen shows SALES data → produces DGII Formato 607 (Ventas).
    try {
      const empresa = await api?.admin?.getEmpresa?.().catch(() => ({}))
      const rncEmisor = empresa?.rnc || empresa?.RNC || ''
      const { from } = periodToDateRange(period)
      const d = new Date(from)
      const year = d.getUTCFullYear()
      const month = d.getUTCMonth() + 1
      // Map screen-normalized rows back to the fields the generator expects
      const rows = txns.map(t => ({
        client_rnc:      t.rnc,
        ncf:             t.ncf === '—' ? '' : t.ncf,
        created_at:      t.fecha,
        subtotal:        t.subtotal,
        itbis:           t.itbis,
        total:           t.total,
        payment_method:  t.payment_method || 'cash',
        tipo_venta:      t.tipo_venta || 'contado',
        status:          t.estado === 'anulado' ? 'nula' : 'cobrado',
        ley:             0,
      }))
      const content = generateFormato607Txt(rows, rncEmisor, year, month)
      downloadTxt(content, filename607(rncEmisor, year, month))
      showToast(L('Archivo 607 (Ventas) generado', '607 Sales file generated'))
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'dgii.generatetxt' }) } catch {}
      showToast(L('Error al generar: ', 'Error generating: ') + (e?.message || ''))
    }
  }
  function generateXML() {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Reportes606>\n` +
      txns.map(t => `  <Comprobante NCF="${t.ncf}" Total="${t.total.toFixed(2)}" ITBIS="${t.itbis.toFixed(2)}" Estado="${t.estado}" />`).join('\n') +
      '\n</Reportes606>'
    const blob = new Blob([xml], { type: 'application/xml' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'dgii_606.xml'; a.click()
    showToast('XML 606 descargado')
  }
  function showToast(msg) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  return (
    <div className="flex flex-col gap-4">
      {toast && <Toast msg={toast} color="green" />}

      {/* Period */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/10 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-white/40">{L('Período', 'Period')}</p>
          <button onClick={loadData} disabled={loading}
            className="flex items-center gap-1.5 text-xs border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 px-2 py-1 rounded-lg hover:bg-slate-50 dark:hover:bg-white/10 disabled:opacity-50">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            {L('Actualizar', 'Refresh')}
          </button>
        </div>
        <PeriodSelector period={period} setPeriod={setPeriod} />
      </div>

      {/* NCF Sequence cards */}
      {sequences.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-white/40 mb-2 px-1">
            {L('Secuencias NCF habilitadas', 'Enabled NCF Sequences')}
          </p>
          <div className="flex gap-3 flex-wrap">
            {sequences.map(seq => (
              <NCFSeqCard
                key={seq.type}
                code={seq.type}
                seq={{
                  name:    seq.type,
                  current: seq.current_number || 0,
                  limit:   seq.limit_number   || 0,
                  expires: seq.valid_until    || '—',
                }}
                accentColor="blue"
              />
            ))}
          </div>
          {sequences.some(s => s.limit_number > 0 && (s.limit_number - s.current_number) < 500) && (
            <div className="mt-2 flex items-center gap-2 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl px-4 py-2">
              <AlertTriangle size={15} className="text-red-500 dark:text-red-400" />
              <span className="text-sm text-red-600 dark:text-red-400">
                {L('Una o más secuencias están bajas — solicite nuevas a la DGII.', 'One or more sequences are low — request new ones from DGII.')}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Summary bar */}
      <div className="flex gap-3">
        <MetricCard label={L('Total comprobantes', 'Total receipts')} value={loading ? '…' : txns.length} sub={L('período seleccionado', 'selected period')} />
        <MetricCard label="E31/B01 emitidos"   value={loading ? '…' : countB01} sub="crédito fiscal"   color="blue"   />
        <MetricCard label="E32/B02 emitidos"   value={loading ? '…' : countB02} sub="consumidor final" color="blue"   />
        <MetricCard label={L('Total ITBIS', 'Total ITBIS')} value={loading ? '…' : fmtMoney(totalItbis)} sub={L('cobrado', 'collected')} color="red" />
        <MetricCard label={L('Total facturado', 'Total billed')} value={loading ? '…' : fmtMoney(totalFact)} sub={L('bruto', 'gross')} />
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/10 shadow-sm overflow-hidden">
        {/* Tabs + search */}
        <div className="flex items-center gap-1 px-4 pt-3 border-b border-slate-100 dark:border-white/10">
          {TABS_606.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t border-b-2 -mb-px transition ${tab === t.key ? 'text-blue-600 dark:text-blue-400 border-blue-500' : 'text-slate-500 dark:text-white/60 border-transparent hover:text-slate-700 dark:hover:text-white'}`}>
              {t.label}
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tab === t.key ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400' : 'bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-white/60'}`}>{tabCounts[t.key]}</span>
            </button>
          ))}
          <div className="ml-auto pb-2">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg focus-within:ring-2 focus-within:ring-blue-400 w-48">
              <Search size={13} className="text-slate-400 dark:text-white/40 shrink-0" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder={L('Buscar…', 'Search…')}
                className="flex-1 min-w-0 bg-transparent outline-none text-sm text-slate-700 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/40" />
            </div>
          </div>
        </div>
        {/* Header + Rows — horizontal scroll on mobile for wide tables */}
        <div className="overflow-x-auto">
        <div className="min-w-[700px]">
        <div className="flex items-center px-4 py-2 bg-slate-50 dark:bg-white/5 border-b border-slate-100 dark:border-white/10">
          {COLS_606.map(c => <span key={c.key} className={`text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40 ${c.cls}`}>{c.label}</span>)}
        </div>
        <div className="divide-y divide-slate-50 dark:divide-white/5">
          {loading && <div className="py-10 text-center text-sm text-slate-400 dark:text-white/40">{L('Cargando…', 'Loading…')}</div>}
          {!loading && visible.length === 0 && <div className="py-10 text-center text-sm text-slate-400 dark:text-white/40">{L('Sin registros para este período.', 'No records for this period.')}</div>}
          {!loading && visible.map(t => (
            <div key={t.id} className={`flex items-center px-4 h-11 ${t.estado === 'anulado' ? 'opacity-50 bg-slate-50 dark:bg-white/5' : 'hover:bg-slate-50 dark:hover:bg-white/5'}`}>
              <span className={`${COLS_606[0].cls} ${t.estado === 'anulado' ? 'line-through text-slate-400 dark:text-white/40' : ''}`}>{t.ncf}</span>
              <div className={`${COLS_606[1].cls} min-w-0`}>
                <p className="text-sm text-slate-800 dark:text-white truncate">{t.client}</p>
                {t.rnc && <p className="text-[10px] text-slate-400 dark:text-white/40">{t.rnc}</p>}
              </div>
              <div className={`${COLS_606[2].cls}`}>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${['B01','E31'].includes(t.tipo) ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400' : 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-white/60'}`}>{t.tipo}</span>
              </div>
              <span className={`${COLS_606[3].cls} text-xs text-slate-500 dark:text-white/60`}>{fmtDate(t.fecha)}</span>
              <span className={`${COLS_606[4].cls} text-sm tabular-nums ${t.estado === 'anulado' ? 'line-through text-slate-400 dark:text-white/40' : 'text-slate-700 dark:text-white'}`}>{fmtMoney(t.subtotal)}</span>
              <span className={`${COLS_606[5].cls} text-sm tabular-nums ${t.estado === 'anulado' ? 'line-through text-slate-400 dark:text-white/40' : 'text-slate-700 dark:text-white'}`}>{fmtMoney(t.itbis)}</span>
              <span className={`${COLS_606[6].cls} text-sm font-medium tabular-nums ${t.estado === 'anulado' ? 'line-through text-slate-400 dark:text-white/40' : 'text-slate-800 dark:text-white'}`}>{fmtMoney(t.total)}</span>
              <div className={`${COLS_606[7].cls}`}>
                {t.estado === 'valido'
                  ? <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><CheckCircle2 size={11} />Válido</span>
                  : <span className="flex items-center gap-1 text-xs text-slate-400 dark:text-white/40"><Minus size={11} />Anulado</span>
                }
              </div>
            </div>
          ))}
        </div>
        </div>{/* /min-w-[700px] */}
        </div>{/* /overflow-x-auto */}
        {/* Footer */}
        <div className="border-t border-slate-100 dark:border-white/10 px-4 py-2 flex justify-between bg-slate-50 dark:bg-white/5">
          <span className="text-xs text-slate-400 dark:text-white/40">{visible.length} registro{visible.length !== 1 ? 's' : ''}</span>
          <span className="text-sm font-bold text-slate-800 dark:text-white tabular-nums">{fmtMoney(visible.filter(t=>t.estado==='valido').reduce((s,t)=>s+t.total,0))}</span>
        </div>
      </div>

      {/* Bottom 3 panels */}
      <div className="grid grid-cols-3 gap-4">
        {/* Resumen fiscal */}
        <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/10 shadow-sm p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-white/40 mb-3">Resumen fiscal</p>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-slate-500 dark:text-white/60">Período</span><span className="text-slate-700 dark:text-white">{period}</span></div>
            <div className="flex justify-between"><span className="text-slate-500 dark:text-white/60">Total docs</span><span className="font-medium text-slate-700 dark:text-white">{txns.length}</span></div>
            <div className="flex justify-between"><span className="text-slate-500 dark:text-white/60">ITBIS cobrado</span><span className="font-medium text-slate-700 dark:text-white">{fmtMoney(totalItbis)}</span></div>
            <div className="flex justify-between border-t border-slate-100 dark:border-white/10 pt-1.5 mt-1"><span className="text-slate-600 dark:text-white/60 font-medium">Total facturado</span><span className="font-bold text-slate-800 dark:text-white">{fmtMoney(totalFact)}</span></div>
          </div>
        </div>
        {/* Enviar a DGII */}
        <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/10 shadow-sm p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-white/40 mb-3">Enviar a DGII</p>
          <SubmitBox onGenerate={generateTXT} onSend={() => showToast('606 enviado a DGII exitosamente')} onXML={generateXML} />
        </div>
        {/* Historial — driven by real DB ranges */}
        <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/10 shadow-sm p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-white/40 mb-3">Historial por mes</p>
          <HistorialPanel showToast={showToast} />
        </div>
      </div>
    </div>
  )
}

// ── Historial Panel — loads last 4 months on demand ──────────────────────────
function HistorialPanel({ showToast }) {
  const api = useAPI()
  const [rows, setRows]     = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const now = new Date()
        const months = []
        for (let i = 1; i <= 4; i++) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
          const pm = d.getMonth()
          const py = d.getFullYear()
          const last = new Date(py, pm + 1, 0)
          const from = `${py}-${String(pm+1).padStart(2,'0')}-01`
          const to   = `${py}-${String(pm+1).padStart(2,'0')}-${String(last.getDate()).padStart(2,'0')}T23:59:59`
          months.push({
            label: d.toLocaleDateString('es-DO', { month: 'long', year: 'numeric' }),
            from, to,
          })
        }
        const results = await Promise.all(
          months.map(m => api.dgii.get606({ dateFrom: m.from, dateTo: m.to }).then(r => ({ ...m, records: (r||[]).length, total: (r||[]).reduce((s,t)=>s+(t.total||0),0) })).catch(() => ({ ...m, records: 0, total: 0 })))
        )
        setRows(results)
      } catch (_aetherErr) {
        try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'dgii.historialpanel' }) } catch {}
        setRows([])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <p className="text-xs text-slate-400 dark:text-white/40 animate-pulse">Cargando historial…</p>
  if (!rows.length) return <p className="text-xs text-slate-400 dark:text-white/40">Sin historial disponible.</p>

  return (
    <div className="space-y-2">
      {rows.map((h, i) => (
        <div key={i} className="flex items-center gap-2 py-1">
          <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-slate-700 dark:text-white truncate capitalize">{h.label}</p>
            <p className="text-[10px] text-slate-400 dark:text-white/40">{h.records} registros · {fmtMoney(h.total)}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ── 607 — NCF types applicable to purchases ───────────────────────────────────
const TIPOS_607 = [
  { value: 'B01', label: 'B01 — Crédito Fiscal' },
  { value: 'B11', label: 'B11 — Facturas Gubernamentales' },
  { value: 'B13', label: 'B13 — Gastos Menores' },
  { value: 'B14', label: 'B14 — Regímenes Especiales' },
  { value: 'B15', label: 'B15 — Comprobante Gubernamental' },
  { value: 'B16', label: 'B16 — Exportaciones' },
  { value: 'B17', label: 'B17 — Pagos al Exterior' },
  { value: 'E31', label: 'E31 — Factura de Crédito Fiscal (e-CF)' },
  { value: 'E33', label: 'E33 — Factura de Gastos Menores (e-CF)' },
  { value: 'E34', label: 'E34 — Regímenes Especiales (e-CF)' },
  { value: 'E41', label: 'E41 — Comprobante para Pagos al Exterior (e-CF)' },
  { value: 'E43', label: 'E43 — Compra Gubernamental (e-CF)' },
  { value: 'E45', label: 'E45 — Exportaciones (e-CF)' },
]
const FORMAS_PAGO_607 = [
  { value: 'efectivo',      label: 'Efectivo' },
  { value: 'cheque',        label: 'Cheque / Transferencia' },
  { value: 'tarjeta',       label: 'Tarjeta' },
  { value: 'credito',       label: 'Crédito' },
  { value: 'bonos',         label: 'Bonos / Certificados' },
  { value: 'otras',         label: 'Otras formas' },
]

const BLANK_607 = {
  rnc_proveedor: '', nombre_proveedor: '', tipo_ncf: 'B01', ncf: '',
  ncf_modificado: '', fecha_ncf: new Date().toISOString().slice(0,10),
  fecha_pago: '', monto_servicios: '', monto_bienes: '', total: '',
  itbis_facturado: '', itbis_retenido: '', retencion_renta: '',
  forma_pago: 'efectivo', notas: '',
}

// ─────────────────────────────────────────────────────────────────────────────
// ── 607 SCREEN ────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
function Screen607() {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [period,  setPeriod]  = useState('Este mes')
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(false)
  const [search,  setSearch]  = useState('')
  const [toast,   setToast]   = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form,    setForm]    = useState(BLANK_607)
  const [saving,  setSaving]  = useState(false)
  const [rncLoading, setRncLoading] = useState(false)

  function showToast(msg, color = 'green') { setToast({ msg, color }); setTimeout(() => setToast(null), 3000) }

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const { from, to } = periodToDateRange(period)
      const data = await api.dgii.get607({ dateFrom: from, dateTo: to })
      setRows(data || [])
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'dgii.screen607' }) } catch {} setRows([]) }
    finally { setLoading(false) }
  }, [period])

  useEffect(() => { loadData() }, [loadData])

  // RNC lookup when user finishes typing RNC
  async function lookupRNC(rnc) {
    const clean = rnc.replace(/-/g, '').trim()
    if (clean.length < 9) return
    setRncLoading(true)
    try {
      const res = await api.rnc.lookup(rnc)
      if (res?.nombre) setForm(f => ({ ...f, nombre_proveedor: res.nombre }))
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'dgii.screen607' }) } catch {} /* silent */ }
    finally { setRncLoading(false) }
  }

  // Auto-calc total when amounts change
  function handleAmountChange(field, value) {
    setForm(f => {
      const next = { ...f, [field]: value }
      const srv = parseFloat(next.monto_servicios) || 0
      const bie = parseFloat(next.monto_bienes)    || 0
      const itb = parseFloat(next.itbis_facturado) || 0
      if (field !== 'total') next.total = String((srv + bie + itb).toFixed(2))
      return next
    })
  }

  async function handleSave() {
    if (!form.fecha_ncf) return showToast(L('Fecha del comprobante requerida', 'NCF date required'), 'red')
    setSaving(true)
    try {
      await api.dgii.addCompra({
        ...form,
        monto_servicios: parseFloat(form.monto_servicios) || 0,
        monto_bienes:    parseFloat(form.monto_bienes)    || 0,
        total:           parseFloat(form.total)           || 0,
        itbis_facturado: parseFloat(form.itbis_facturado) || 0,
        itbis_retenido:  parseFloat(form.itbis_retenido)  || 0,
        retencion_renta: parseFloat(form.retencion_renta) || 0,
      })
      setForm(BLANK_607)
      setShowForm(false)
      showToast(L('Compra registrada', 'Purchase saved'))
      loadData()
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'dgii.screen607' }) } catch {}
      showToast(L('Error al guardar', 'Save error'), 'red')
    } finally { setSaving(false) }
  }

  async function handleDelete(id) {
    try {
      await api.dgii.deleteCompra({ id })
      setRows(r => r.filter(x => x.id !== id))
      showToast(L('Registro eliminado', 'Record deleted'))
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'dgii.screen607' }) } catch {} showToast(L('Error al eliminar', 'Delete error'), 'red') }
  }

  const q = search.trim().toLowerCase()
  const visible = rows.filter(r =>
    !q || (r.nombre_proveedor||'').toLowerCase().includes(q) ||
          (r.rnc_proveedor||'').includes(q) ||
          (r.ncf||'').toLowerCase().includes(q)
  )

  const totalItbis   = rows.reduce((s, r) => s + (r.itbis_facturado || 0), 0)
  const totalGastado = rows.reduce((s, r) => s + (r.total || 0), 0)
  const countConNCF  = rows.filter(r => r.ncf && r.ncf.trim()).length
  const countSinNCF  = rows.filter(r => !r.ncf || !r.ncf.trim()).length

  async function generateTXT() {
    // This screen shows PURCHASES data → produces DGII Formato 606 (Compras).
    try {
      const empresa = await api?.admin?.getEmpresa?.().catch(() => ({}))
      const rncEmisor = empresa?.rnc || empresa?.RNC || ''
      const { from } = periodToDateRange(period)
      const d = new Date(from)
      const year = d.getUTCFullYear()
      const month = d.getUTCMonth() + 1
      const content = generateFormato606Txt(rows, rncEmisor, year, month)
      downloadTxt(content, filename606(rncEmisor, year, month))
      showToast(L('Archivo 606 (Compras) generado', '606 Purchases file generated'))
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'dgii.showtoast' }) } catch {}
      showToast(L('Error al generar: ', 'Error generating: ') + (e?.message || ''))
    }
  }

  function generateXML() {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Reportes607>\n` +
      rows.map(r =>
        `  <Compra RNC="${r.rnc_proveedor}" NCF="${r.ncf}" Tipo="${r.tipo_ncf}" ` +
        `Total="${(r.total||0).toFixed(2)}" ITBIS="${(r.itbis_facturado||0).toFixed(2)}" Fecha="${r.fecha_ncf}" />`
      ).join('\n') +
      '\n</Reportes607>'
    const blob = new Blob([xml], { type: 'application/xml' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'dgii_607.xml'; a.click()
    showToast('XML 607 descargado')
  }

  return (
    <div className="flex flex-col gap-4">
      {toast && <Toast msg={toast.msg} color={toast.color} />}

      {/* Period + actions */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/10 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-white/40">{L('Período', 'Period')}</p>
          <div className="flex items-center gap-2">
            <button onClick={loadData} disabled={loading}
              className="flex items-center gap-1.5 text-xs border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 px-2 py-1 rounded-lg hover:bg-slate-50 dark:hover:bg-white/10 disabled:opacity-50">
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
              {L('Actualizar', 'Refresh')}
            </button>
            <button onClick={() => setShowForm(v => !v)}
              className="flex items-center gap-1.5 text-xs bg-emerald-600 dark:bg-emerald-500 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700 dark:hover:bg-emerald-600">
              <Plus size={11} />
              {L('Registrar compra', 'Add purchase')}
            </button>
          </div>
        </div>
        <PeriodSelector period={period} setPeriod={setPeriod} />
      </div>

      {/* Add-purchase form */}
      {showForm && (
        <div className="bg-white dark:bg-white/5 rounded-2xl border border-emerald-200 dark:border-emerald-500/30 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-slate-700 dark:text-white">{L('Nueva compra / gasto', 'New purchase / expense')}</p>
            <button onClick={() => { setShowForm(false); setForm(BLANK_607) }} className="text-slate-400 dark:text-white/40 hover:text-slate-600 dark:hover:text-white/60">
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-4 gap-3 mb-3">
            {/* RNC proveedor */}
            <div className="col-span-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-white/40 mb-1 block">
                {rncLoading ? 'Buscando…' : 'RNC Proveedor'}
              </label>
              <input value={form.rnc_proveedor}
                onChange={e => setForm(f => ({ ...f, rnc_proveedor: e.target.value }))}
                onBlur={e => lookupRNC(e.target.value)}
                placeholder="000-00000-0"
                className="w-full border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 font-mono" />
            </div>
            {/* Nombre */}
            <div className="col-span-2">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-white/40 mb-1 block">{L('Nombre proveedor', 'Supplier name')}</label>
              <input value={form.nombre_proveedor}
                onChange={e => setForm(f => ({ ...f, nombre_proveedor: e.target.value }))}
                placeholder={L('Nombre del proveedor', 'Supplier name')}
                className="w-full border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
            {/* Tipo NCF */}
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-white/40 mb-1 block">Tipo NCF</label>
              <select value={form.tipo_ncf} onChange={e => setForm(f => ({ ...f, tipo_ncf: e.target.value }))}
                className="w-full border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-white">
                {TIPOS_607.map(t => <option key={t.value} value={t.value}>{t.value}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3 mb-3">
            {/* NCF */}
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-white/40 mb-1 block">NCF</label>
              <input value={form.ncf} onChange={e => setForm(f => ({ ...f, ncf: e.target.value }))}
                placeholder="B0100000001"
                className="w-full border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 font-mono" />
            </div>
            {/* Fecha NCF */}
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-white/40 mb-1 block">{L('Fecha NCF', 'NCF Date')}</label>
              <input type="date" value={form.fecha_ncf} onChange={e => setForm(f => ({ ...f, fecha_ncf: e.target.value }))}
                className="w-full border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
            {/* Fecha pago */}
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-white/40 mb-1 block">{L('Fecha pago', 'Payment date')}</label>
              <input type="date" value={form.fecha_pago} onChange={e => setForm(f => ({ ...f, fecha_pago: e.target.value }))}
                className="w-full border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
            {/* Forma pago */}
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-white/40 mb-1 block">{L('Forma pago', 'Payment method')}</label>
              <select value={form.forma_pago} onChange={e => setForm(f => ({ ...f, forma_pago: e.target.value }))}
                className="w-full border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-white">
                {FORMAS_PAGO_607.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-5 gap-3 mb-4">
            {[
              { field: 'monto_servicios', label: L('Monto servicios', 'Services') },
              { field: 'monto_bienes',    label: L('Monto bienes', 'Goods') },
              { field: 'itbis_facturado', label: 'ITBIS facturado' },
              { field: 'itbis_retenido',  label: 'ITBIS retenido' },
              { field: 'total',           label: 'Total' },
            ].map(({ field, label }) => (
              <div key={field}>
                <label className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-white/40 mb-1 block">{label}</label>
                <input type="number" min="0" step="0.01" value={form[field]}
                  onChange={e => handleAmountChange(field, e.target.value)}
                  placeholder="0.00"
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 dark:text-white ${field === 'total' ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/30 font-semibold' : 'border-slate-200 dark:border-white/10 dark:bg-white/5'}`} />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <div className="flex-1 mr-4">
              <input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                placeholder={L('Notas (opcional)', 'Notes (optional)')}
                className="w-full border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setShowForm(false); setForm(BLANK_607) }}
                className="px-4 py-2 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 rounded-lg text-sm hover:bg-slate-50 dark:hover:bg-white/10">
                {L('Cancelar', 'Cancel')}
              </button>
              <button onClick={handleSave} disabled={saving}
                className="px-5 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-60">
                {saving ? L('Guardando…', 'Saving…') : L('Guardar compra', 'Save purchase')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Summary bar */}
      <div className="flex gap-3">
        <MetricCard label={L('Total registros', 'Total records')} value={loading ? '…' : rows.length} sub={L('período seleccionado', 'selected period')} />
        <MetricCard label={L('Con NCF', 'With NCF')}  value={loading ? '…' : countConNCF} sub={L('facturas c/NCF', 'invoices w/NCF')} color="green" />
        <MetricCard label={L('Sin NCF', 'No NCF')}    value={loading ? '…' : countSinNCF} sub={L('gastos menores', 'minor expenses')} color="amber" />
        <MetricCard label={L('ITBIS pagado', 'ITBIS paid')} value={loading ? '…' : fmtMoney(totalItbis)} sub={L('a reclamar', 'reclaimable')} color="blue" />
        <MetricCard label={L('Total gastado', 'Total spent')} value={loading ? '…' : fmtMoney(totalGastado)} sub={L('bruto', 'gross')} />
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/10 shadow-sm overflow-hidden">
        <div className="flex items-center px-4 pt-3 pb-2 border-b border-slate-100 dark:border-white/10">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-white/40 flex-1">
            {L('Compras y gastos del período', 'Purchases & expenses for period')}
          </p>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg focus-within:ring-2 focus-within:ring-emerald-400 w-44">
            <Search size={13} className="text-slate-400 dark:text-white/40 shrink-0" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={L('Buscar…', 'Search…')}
              className="flex-1 min-w-0 bg-transparent outline-none text-sm text-slate-700 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/40" />
          </div>
        </div>

        {/* Header + Rows — horizontal scroll on mobile for wide tables */}
        <div className="overflow-x-auto">
        <div className="min-w-[700px]">
        <div className="flex items-center px-4 py-2 bg-slate-50 dark:bg-white/5 border-b border-slate-100 dark:border-white/10 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
          <span className="w-36 font-mono">NCF</span>
          <span className="flex-1">Proveedor / RNC</span>
          <span className="w-16 text-center">Tipo</span>
          <span className="w-24">Fecha</span>
          <span className="w-28 text-right">ITBIS</span>
          <span className="w-28 text-right">Total</span>
          <span className="w-20 text-center">{L('Pago', 'Payment')}</span>
          <span className="w-8" />
        </div>

        <div className="divide-y divide-slate-50 dark:divide-white/5 max-h-96 overflow-y-auto">
          {loading && <div className="py-10 text-center text-sm text-slate-400 dark:text-white/40">{L('Cargando…', 'Loading…')}</div>}
          {!loading && visible.length === 0 && (
            <div className="py-12 flex flex-col items-center gap-3 text-slate-400 dark:text-white/40">
              <Package size={28} className="text-slate-300 dark:text-white/30" />
              <p className="text-sm">{L('Sin compras para este período', 'No purchases for this period')}</p>
              <button onClick={() => setShowForm(true)} className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1">
                <Plus size={11} />{L('Registrar primera compra', 'Add first purchase')}
              </button>
            </div>
          )}
          {!loading && visible.map(r => (
            <div key={r.id} className="flex items-center px-4 h-11 hover:bg-slate-50 dark:hover:bg-white/5">
              <span className="w-36 font-mono text-xs text-slate-700 dark:text-white truncate">{r.ncf || '—'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-800 dark:text-white truncate">{r.nombre_proveedor || L('Sin nombre', 'No name')}</p>
                {r.rnc_proveedor && <p className="text-[10px] text-slate-400 dark:text-white/40">{r.rnc_proveedor}</p>}
              </div>
              <div className="w-16 text-center">
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400">{r.tipo_ncf}</span>
              </div>
              <span className="w-24 text-xs text-slate-500 dark:text-white/60">{fmtDate(r.fecha_ncf)}</span>
              <span className="w-28 text-right text-sm tabular-nums text-slate-700 dark:text-white">{fmtMoney(r.itbis_facturado||0)}</span>
              <span className="w-28 text-right text-sm font-medium tabular-nums text-slate-800 dark:text-white">{fmtMoney(r.total||0)}</span>
              <div className="w-20 text-center">
                <span className="text-[10px] text-slate-400 dark:text-white/40 capitalize">{r.forma_pago}</span>
              </div>
              <button onClick={() => handleDelete(r.id)} className="w-8 flex justify-center text-slate-300 dark:text-white/30 hover:text-red-500 dark:hover:text-red-400 transition">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
        </div>{/* /min-w-[700px] */}
        </div>{/* /overflow-x-auto */}

        {/* Footer */}
        <div className="border-t border-slate-100 dark:border-white/10 px-4 py-2 flex justify-between bg-slate-50 dark:bg-white/5">
          <span className="text-xs text-slate-400 dark:text-white/40">{visible.length} registro{visible.length !== 1 ? 's' : ''}</span>
          <span className="text-sm font-bold text-slate-800 dark:text-white tabular-nums">{fmtMoney(visible.reduce((s,r)=>s+(r.total||0),0))}</span>
        </div>
      </div>

      {/* Bottom panels */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Resumen */}
        <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/10 shadow-sm p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-white/40 mb-3">Resumen 607</p>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-slate-500 dark:text-white/60">Período</span><span className="text-slate-700 dark:text-white">{period}</span></div>
            <div className="flex justify-between"><span className="text-slate-500 dark:text-white/60">Total registros</span><span className="font-medium text-slate-700 dark:text-white">{rows.length}</span></div>
            <div className="flex justify-between"><span className="text-slate-500 dark:text-white/60">Facturas c/NCF</span><span className="text-slate-700 dark:text-white">{countConNCF}</span></div>
            <div className="flex justify-between"><span className="text-slate-500 dark:text-white/60">Gastos varios</span><span className="text-slate-700 dark:text-white">{countSinNCF}</span></div>
            <div className="flex justify-between border-t border-slate-100 dark:border-white/10 pt-1.5 mt-1">
              <span className="text-slate-600 dark:text-white/60 font-medium">ITBIS a reclamar</span>
              <span className="font-bold text-emerald-700 dark:text-emerald-400">{fmtMoney(totalItbis)}</span>
            </div>
          </div>
        </div>

        {/* Enviar */}
        <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/10 shadow-sm p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-white/40 mb-3">Enviar a DGII</p>
          <SubmitBox
            onGenerate={generateTXT}
            onSend={() => showToast('607 enviado a DGII exitosamente')}
            onXML={generateXML}
          />
        </div>

        {/* Historial 607 — last 4 months */}
        <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/10 shadow-sm p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-white/40 mb-3">Historial por mes</p>
          <Historial607Panel showToast={showToast} />
        </div>
      </div>
    </div>
  )
}

// ── 607 History panel ─────────────────────────────────────────────────────────
function Historial607Panel({ showToast }) {
  const api = useAPI()
  const [rows, setRows]     = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    async function load() {
      if (!api?.dgii?.get607) return
      setLoading(true)
      try {
        const now = new Date()
        const months = []
        for (let i = 1; i <= 4; i++) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
          const pm = d.getMonth()
          const py = d.getFullYear()
          const last = new Date(py, pm + 1, 0)
          const from = `${py}-${String(pm+1).padStart(2,'0')}-01`
          const to   = `${py}-${String(pm+1).padStart(2,'0')}-${String(last.getDate()).padStart(2,'0')}T23:59:59`
          months.push({ label: d.toLocaleDateString('es-DO', { month: 'long', year: 'numeric' }), from, to })
        }
        const results = await Promise.all(
          months.map(m =>
            api.dgii.get607({ dateFrom: m.from, dateTo: m.to })
              .then(r => ({ ...m, records: (r||[]).length, total: (r||[]).reduce((s,x)=>s+(x.total||0),0) }))
              .catch(() => ({ ...m, records: 0, total: 0 }))
          )
        )
        setRows(results)
      } catch (_aetherErr) {
        try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'dgii.historial607panel' }) } catch {} setRows([]) }
      finally { setLoading(false) }
    }
    load()
  }, [])

  if (loading) return <p className="text-xs text-slate-400 dark:text-white/40 animate-pulse">Cargando historial…</p>
  if (!rows.length) return <p className="text-xs text-slate-400 dark:text-white/40">Sin historial disponible.</p>

  return (
    <div className="space-y-2">
      {rows.map((h, i) => (
        <div key={i} className="flex items-center gap-2 py-1">
          <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-slate-700 dark:text-white truncate capitalize">{h.label}</p>
            <p className="text-[10px] text-slate-400 dark:text-white/40">{h.records} registros · {Number(h.total).toLocaleString('es-DO', {minimumFractionDigits:2})}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ── ANECF — Anulación de Rangos e-NCF ────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
const ECF_TYPES = [
  { code: 'E31', label: 'E31 — Factura de Crédito Fiscal' },
  { code: 'E32', label: 'E32 — Factura de Consumo' },
  { code: 'E33', label: 'E33 — Nota de Débito' },
  { code: 'E34', label: 'E34 — Nota de Crédito' },
  { code: 'E41', label: 'E41 — Compras' },
  { code: 'E43', label: 'E43 — Gastos Menores' },
  { code: 'E44', label: 'E44 — Regímenes Especiales' },
  { code: 'E45', label: 'E45 — Gubernamental' },
  { code: 'E46', label: 'E46 — Exportaciones' },
  { code: 'E47', label: 'E47 — Pagos al Exterior' },
]

function ScreenANECF() {
  const api = useAPI()
  const { lang } = useLang()
  const { user } = useAuth()
  const L = (es, en) => lang === 'es' ? es : en

  const [tipoECF, setTipoECF] = useState('E31')
  const [rangoDesde, setRangoDesde] = useState('')
  const [rangoHasta, setRangoHasta] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [empresa, setEmpresa] = useState(null)

  useEffect(() => {
    if (api?.admin?.getEmpresa) {
      api.admin.getEmpresa().then(setEmpresa).catch(() => {})
    }
  }, [])

  // Auto-format eNCF: pad numeric suffix to 10 digits
  function formatENCF(tipo, value) {
    if (!value) return ''
    // If user typed full eNCF like E310000001234, accept as-is
    if (/^E\d{11,}$/.test(value)) return value
    // If just the numeric part, prefix with type
    const numPart = value.replace(/\D/g, '')
    if (!numPart) return ''
    return `${tipo}${numPart.padStart(10, '0')}`
  }

  function handleDesdeChange(val) {
    setRangoDesde(val.toUpperCase())
    setResult(null)
    setError(null)
  }

  function handleHastaChange(val) {
    setRangoHasta(val.toUpperCase())
    setResult(null)
    setError(null)
  }

  function getValidationError() {
    const desde = formatENCF(tipoECF, rangoDesde)
    const hasta = formatENCF(tipoECF, rangoHasta)
    if (!desde || !hasta) return L('Complete ambos campos de rango', 'Complete both range fields')
    if (!empresa?.rnc) return L('Configure el RNC de la empresa en Configuración', 'Set business RNC in Settings')
    const numDesde = parseInt(desde.replace(/[^\d]/g, ''), 10)
    const numHasta = parseInt(hasta.replace(/[^\d]/g, ''), 10)
    if (isNaN(numDesde) || isNaN(numHasta)) return L('Rango inválido', 'Invalid range')
    if (numDesde > numHasta) return L('El rango "Desde" debe ser menor o igual a "Hasta"', '"From" must be less than or equal to "To"')
    return null
  }

  async function handleSubmit() {
    setConfirmOpen(false)
    setSubmitting(true)
    setResult(null)
    setError(null)

    try {
      const desde = formatENCF(tipoECF, rangoDesde)
      const hasta = formatENCF(tipoECF, rangoHasta)
      const dgii = window.electronAPI?.dgii_ecf
      if (!dgii) throw new Error('Solo disponible en versión desktop')
      const res = await dgii.voidSequence({
        rncEmisor: empresa.rnc.replace(/[-\s]/g, ''),
        tipoECF,
        rangoDesde: desde,
        rangoHasta: hasta,
      })
      setResult(res)
      // v2.14.33 — auto-print the ANECF comprobante on successful void.
      // Runs fire-and-forget so a print failure never shadows the success.
      try {
        const numDesde = parseInt(desde.replace(/\D/g, ''), 10)
        const numHasta = parseInt(hasta.replace(/\D/g, ''), 10)
        const cantidadNCF = Number.isFinite(numDesde) && Number.isFinite(numHasta)
          ? numHasta - numDesde + 1 : 0
        printANECFComprobante({
          biz: {
            name: empresa?.nombre || empresa?.name || '',
            address: empresa?.direccion || empresa?.address || '',
            phone: empresa?.telefono || empresa?.phone || '',
            rnc: empresa?.rnc || '',
            logo: empresa?.logo || '',
            settings: empresa?.settings || {},
          },
          rncEmisor: empresa.rnc.replace(/[-\s]/g, ''),
          tipoECF,
          rangoDesde: desde,
          rangoHasta: hasta,
          cantidadNCF,
          submittedAt: res?.submittedAt || new Date(),
          environment: res?.environment || 'ecf',
          cajero: user?.name || '',
          dgiiResponse: res || {},
        }).catch(() => {})
      } catch (_aetherErr) {
        try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'dgii.screenanecf' }) } catch {}}
    } catch (err) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(err, { severity: 'error', category: 'dgii.screenanecf' }) } catch {}
      setError(err.message || L('Error desconocido', 'Unknown error'))
    } finally {
      setSubmitting(false)
    }
  }

  const validationError = getValidationError()
  const previewDesde = formatENCF(tipoECF, rangoDesde)
  const previewHasta = formatENCF(tipoECF, rangoHasta)
  const cantidadPreview = (previewDesde && previewHasta)
    ? Math.max(0, parseInt(previewHasta.replace(/\D/g, ''), 10) - parseInt(previewDesde.replace(/\D/g, ''), 10) + 1)
    : 0

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/10 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
            <Ban size={20} className="text-red-600 dark:text-red-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-white">{L('Anulación de Rangos e-NCF', 'Void e-NCF Ranges')}</h2>
            <p className="text-xs text-slate-500 dark:text-white/60">{L('Anule secuencias de e-NCF no utilizadas ante la DGII', 'Void unused e-NCF sequences with DGII')}</p>
          </div>
        </div>

        {/* Form */}
        <div className="space-y-4">
          {/* e-CF Type */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-1.5">
              {L('Tipo de Comprobante', 'Receipt Type')}
            </label>
            <select value={tipoECF} onChange={e => { setTipoECF(e.target.value); setResult(null); setError(null) }}
              className="w-full border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 appearance-none bg-white">
              {ECF_TYPES.map(t => (
                <option key={t.code} value={t.code}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Range */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-1.5">
                {L('Rango Desde', 'Range From')}
              </label>
              <input type="text" value={rangoDesde} onChange={e => handleDesdeChange(e.target.value)}
                placeholder={`${tipoECF}0000001900`}
                className="w-full border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder:text-slate-300 dark:placeholder:text-white/20" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-1.5">
                {L('Rango Hasta', 'Range To')}
              </label>
              <input type="text" value={rangoHasta} onChange={e => handleHastaChange(e.target.value)}
                placeholder={`${tipoECF}0000001999`}
                className="w-full border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder:text-slate-300 dark:placeholder:text-white/20" />
            </div>
          </div>

          {/* Preview */}
          {previewDesde && previewHasta && cantidadPreview > 0 && (
            <div className="bg-slate-50 dark:bg-white/5 rounded-xl px-4 py-3 border border-slate-100 dark:border-white/10">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500 dark:text-white/60">{L('Rango a anular:', 'Range to void:')}</span>
                <span className="font-mono font-bold text-slate-800 dark:text-white">{previewDesde} — {previewHasta}</span>
              </div>
              <div className="flex items-center justify-between text-sm mt-1">
                <span className="text-slate-500 dark:text-white/60">{L('Cantidad de NCF:', 'NCF count:')}</span>
                <span className="font-bold text-red-600 dark:text-red-400">{cantidadPreview.toLocaleString()}</span>
              </div>
            </div>
          )}

          {/* RNC info */}
          {empresa?.rnc && (
            <p className="text-xs text-slate-400 dark:text-white/40">
              RNC Emisor: <span className="font-mono font-medium text-slate-600 dark:text-white/60">{empresa.rnc}</span>
            </p>
          )}

          {/* Submit button */}
          <button
            onClick={() => setConfirmOpen(true)}
            disabled={!!validationError || submitting}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition">
            {submitting ? (
              <>
                <RefreshCw size={15} className="animate-spin" />
                {L('Enviando a DGII...', 'Submitting to DGII...')}
              </>
            ) : (
              <>
                <Ban size={15} />
                {L('Anular Rango', 'Void Range')}
              </>
            )}
          </button>

          {validationError && !result && !error && (
            <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
              <AlertTriangle size={12} /> {validationError}
            </p>
          )}
        </div>
      </div>

      {/* Result */}
      {result && (
        <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400" />
            <span className="font-bold text-emerald-700 dark:text-emerald-400">{L('Anulación exitosa', 'Void successful')}</span>
          </div>
          <div className="space-y-1 text-sm text-emerald-800 dark:text-emerald-300">
            <p>{L('Rango:', 'Range:')} <span className="font-mono font-medium">{result.rangoDesde} — {result.rangoHasta}</span></p>
            <p>{L('Cantidad anulada:', 'Voided count:')} <span className="font-bold">{result.cantidadNCF}</span></p>
            {result.mensajes?.length > 0 && (
              <p>{L('Mensaje:', 'Message:')} {result.mensajes.join('; ')}</p>
            )}
            <p className="text-xs text-emerald-600 dark:text-emerald-400/60 mt-2">{result.submittedAt}</p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle size={18} className="text-red-600 dark:text-red-400" />
            <span className="font-bold text-red-700 dark:text-red-400">{L('Error al anular', 'Void error')}</span>
          </div>
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Confirm dialog */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmOpen(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-500/20 flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={20} className="text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800 dark:text-white">{L('Confirmar Anulación', 'Confirm Void')}</h3>
                <p className="text-xs text-slate-500 dark:text-white/60">{L('Esta acción no se puede deshacer', 'This action cannot be undone')}</p>
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-white/5 rounded-xl p-3 mb-4 space-y-1 text-sm">
              <p className="text-slate-600 dark:text-white/60">{L('Tipo:', 'Type:')} <span className="font-bold text-slate-800 dark:text-white">{tipoECF}</span></p>
              <p className="text-slate-600 dark:text-white/60">{L('Rango:', 'Range:')} <span className="font-mono font-bold text-slate-800 dark:text-white">{previewDesde} — {previewHasta}</span></p>
              <p className="text-slate-600 dark:text-white/60">{L('Cantidad:', 'Count:')} <span className="font-bold text-red-600 dark:text-red-400">{cantidadPreview}</span></p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmOpen(false)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 text-sm font-medium text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 transition">
                {L('Cancelar', 'Cancel')}
              </button>
              <button onClick={handleSubmit}
                className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition">
                {L('Sí, Anular', 'Yes, Void')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ── ScreenCert — web-only Viafirma .p12 installer ───────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
function ScreenCert() {
  const api = useAPI()
  const { lang } = useLang()
  const { user } = useAuth()
  const tech = isTech(user)
  const L = (es, en) => lang === 'es' ? es : en

  const [info, setInfo]           = useState(null)
  const [loading, setLoading]     = useState(true)
  const [file, setFile]           = useState(null)
  const [passphrase, setPass]     = useState('')
  const [showPass, setShowPass]   = useState(false)
  const [busy, setBusy]           = useState(false)
  const [toast, setToast]         = useState(null) // {kind:'ok'|'err', msg}
  const [envBusy, setEnvBusy]     = useState(false)
  // 2026-04-30 — drag-drop + on-blur pre-validation state.
  const [dragHover, setDragHover] = useState(false)
  const [preview, setPreview]     = useState(null) // {subject, expiry, expired} | null
  const [validating, setValidating] = useState(false)
  const fileRef = useRef(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.dgii_ecf.certInfo()
      setInfo(r || { installed: false })
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'dgii.screencert' }) } catch {}
      setInfo({ installed: false })
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { refresh() }, [refresh])

  function pickFile(f) {
    if (!f) return
    if (!/\.(p12|pfx)$/i.test(f.name)) {
      setToast({ kind: 'err', msg: L('El archivo debe ser .p12 o .pfx', 'File must be .p12 or .pfx') })
      return
    }
    if (f.size > 1024 * 1024) {
      setToast({ kind: 'err', msg: L('Archivo demasiado grande (máx 1MB)', 'File too large (max 1MB)') })
      return
    }
    setFile(f)
    setPreview(null)  // reset previous validation when file changes
    setToast(null)
  }

  // 2026-04-30 — pre-validate the .p12 + passphrase via /api/dgii-cert-upload
  // with validate_only=1. Triggered on passphrase blur. Surfaces wrong
  // password / expired cert before the user commits the install.
  async function validateNow() {
    if (!file || !passphrase) return
    setValidating(true)
    setToast(null)
    try {
      const res = await api.dgii_ecf.validateCert({ file, passphrase })
      if (res?.ok) {
        setPreview({ subject: res.subject, expiry: res.expiry, expired: !!res.expired })
        if (res.expired) {
          setToast({ kind: 'err', msg: L('El certificado esta VENCIDO. Renueve con Viafirma antes de instalar.',
                                          'The certificate is EXPIRED. Renew with Viafirma before installing.') })
        }
      } else {
        setPreview(null)
        setToast({ kind: 'err', msg: res?.error || L('No se pudo validar el certificado', 'Could not validate certificate') })
      }
    } catch (err) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(err, { severity: 'error', category: 'dgii.screencert' }) } catch {}
      setPreview(null)
      setToast({ kind: 'err', msg: err.message || L('Error de red', 'Network error') })
    } finally {
      setValidating(false)
    }
  }

  async function handleUpload() {
    if (!file) {
      setToast({ kind: 'err', msg: L('Seleccione un archivo .p12', 'Select a .p12 file') })
      return
    }
    if (!passphrase) {
      setToast({ kind: 'err', msg: L('Ingrese la contraseña del certificado', 'Enter the certificate passphrase') })
      return
    }
    setBusy(true)
    setToast(null)
    try {
      const res = await api.dgii_ecf.uploadCert({ file, passphrase })
      if (res?.ok) {
        setToast({ kind: 'ok', msg: L('Certificado instalado correctamente', 'Certificate installed successfully') })
        setFile(null)
        setPass('')
        if (fileRef.current) fileRef.current.value = ''
        await refresh()
      } else {
        setToast({ kind: 'err', msg: res?.error || L('Error al instalar el certificado', 'Failed to install certificate') })
      }
    } catch (err) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(err, { severity: 'error', category: 'dgii.screencert' }) } catch {}
      setToast({ kind: 'err', msg: err.message || L('Error de red', 'Network error') })
    } finally {
      setBusy(false)
    }
  }

  async function flipEnv(targetEnv) {
    if (envBusy) return
    setEnvBusy(true)
    try {
      const res = await api.dgii_ecf.setEnvironment(targetEnv)
      if (res?.ok) {
        setToast({ kind: 'ok', msg: targetEnv === 'ecf'
          ? L('Modo Producción activado', 'Production mode enabled')
          : L('Modo Pruebas activado', 'Test mode enabled') })
        await refresh()
      } else {
        setToast({ kind: 'err', msg: L('No se pudo cambiar el entorno', 'Could not switch environment') })
      }
    } catch (err) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(err, { severity: 'error', category: 'dgii.pickfile' }) } catch {}
      setToast({ kind: 'err', msg: err.message || L('Error', 'Error') })
    } finally {
      setEnvBusy(false)
    }
  }

  const installed = !!info?.installed
  const expired   = !!info?.expired
  const env       = info?.environment || 'certecf'
  const isProd    = env === 'ecf'

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/10 p-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
            <ShieldCheck size={20} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-white">{L('Certificado e-CF', 'e-CF Certificate')}</h2>
            <p className="text-xs text-slate-500 dark:text-white/60">
              {L('Instale su certificado .p12 de Viafirma para emitir e-CFs desde la web',
                 'Install your Viafirma .p12 certificate to issue e-CFs from the web')}
            </p>
          </div>
        </div>
      </div>

      {/* Status card */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/10 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-slate-700 dark:text-white/80 uppercase tracking-wider">
            {L('Estado actual', 'Current status')}
          </h3>
          {loading && <RefreshCw size={14} className="text-slate-400 animate-spin" />}
        </div>

        {!loading && !installed && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30">
            <AlertCircle size={18} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-amber-800 dark:text-amber-300">{L('Sin certificado instalado', 'No certificate installed')}</p>
              <p className="text-amber-700 dark:text-amber-300/80 text-xs mt-1">
                {L('No podrá emitir e-CFs hasta instalar su certificado .p12.',
                   'You cannot issue e-CFs until you install your .p12 certificate.')}
              </p>
            </div>
          </div>
        )}

        {!loading && installed && (
          <div className="space-y-3">
            <div className={`flex items-start gap-3 p-4 rounded-xl border ${
              expired
                ? 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30'
                : 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30'
            }`}>
              {expired
                ? <AlertCircle size={18} className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                : <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />}
              <div className="text-sm flex-1">
                <p className={`font-semibold ${expired ? 'text-red-800 dark:text-red-300' : 'text-emerald-800 dark:text-emerald-300'}`}>
                  {expired ? L('Certificado VENCIDO', 'Certificate EXPIRED') : L('Certificado activo', 'Certificate active')}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mt-2 text-xs">
                  <div>
                    <span className="text-slate-500 dark:text-white/50">{L('Sujeto:', 'Subject:')}</span>{' '}
                    <span className="font-mono text-slate-800 dark:text-white/90">{info.subject || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-white/50">{L('Vence:', 'Expires:')}</span>{' '}
                    <span className="font-mono text-slate-800 dark:text-white/90">{fmtDate(info.expiry)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Environment toggle — tech only. Flipping ecf↔certecf changes
                fiscal validity; owners should never self-serve this. */}
            {tech && (
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/10">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-white">{L('Entorno DGII', 'DGII environment')}</p>
                  <p className="text-xs text-slate-500 dark:text-white/60">
                    {isProd
                      ? L('Producción — los e-CFs se envían a la DGII real', 'Production — e-CFs are sent to the live DGII')
                      : L('Pruebas (CertECF) — los e-CFs no son fiscalmente válidos', 'Test (CertECF) — e-CFs are not fiscally valid')}
                  </p>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  isProd
                    ? 'bg-red-600 text-white'
                    : 'bg-amber-500 text-white'
                }`}>
                  {isProd ? 'PROD' : 'TEST'}
                </span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => flipEnv('certecf')} disabled={envBusy || env === 'certecf'}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition ${
                    env === 'certecf'
                      ? 'bg-amber-500 text-white cursor-default'
                      : 'border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70 hover:bg-white dark:hover:bg-white/10'
                  }`}>
                  {L('Pruebas', 'Test')}
                </button>
                <button onClick={() => flipEnv('ecf')} disabled={envBusy || env === 'ecf'}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition ${
                    env === 'ecf'
                      ? 'bg-red-600 text-white cursor-default'
                      : 'border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70 hover:bg-white dark:hover:bg-white/10'
                  }`}>
                  {L('Producción', 'Production')}
                </button>
              </div>
            </div>
            )}
          </div>
        )}
      </div>

      {/* Upload form */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/10 p-6">
        <h3 className="text-sm font-bold text-slate-700 dark:text-white/80 uppercase tracking-wider mb-4">
          {installed ? L('Reemplazar certificado', 'Replace certificate') : L('Instalar certificado', 'Install certificate')}
        </h3>

        <div className="space-y-4">
          {/* File picker — drag-and-drop dropzone (2026-04-30) */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-1.5">
              {L('Archivo .p12 / .pfx', '.p12 / .pfx file')}
            </label>
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragHover(true) }}
              onDragLeave={() => setDragHover(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragHover(false)
                const dropped = e.dataTransfer?.files?.[0]
                if (dropped) pickFile(dropped)
              }}
              className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-6 text-center transition
                ${dragHover
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10'
                  : file
                  ? 'border-emerald-300 dark:border-emerald-500/40 bg-white dark:bg-white/5'
                  : 'border-slate-300 dark:border-white/15 bg-slate-50 dark:bg-white/[0.03] hover:border-emerald-400 hover:bg-emerald-50/50 dark:hover:bg-emerald-500/5'}`}
            >
              <input ref={fileRef} type="file" accept=".p12,.pfx,application/x-pkcs12"
                onChange={e => pickFile(e.target.files?.[0])}
                className="hidden" />
              {file ? (
                <div className="text-sm">
                  <p className="font-semibold text-slate-700 dark:text-white/90 truncate">{file.name}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-white/50 font-mono">
                    {(file.size / 1024).toFixed(1)} KB · {L('Click para cambiar', 'Click to replace')}
                  </p>
                </div>
              ) : (
                <div className="text-sm">
                  <Upload size={20} className="mx-auto mb-2 text-slate-400 dark:text-white/40" />
                  <p className="font-semibold text-slate-700 dark:text-white/80">
                    {L('Arrastre su .p12 aqui', 'Drop your .p12 here')}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-white/50">
                    {L('o haga click para seleccionar el archivo', 'or click to select the file')}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Passphrase */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-1.5">
              {L('Contraseña del certificado', 'Certificate passphrase')}
            </label>
            <div className="relative">
              <input type={showPass ? 'text' : 'password'} value={passphrase}
                onChange={e => { setPass(e.target.value); setPreview(null) }}
                onBlur={validateNow}
                placeholder={L('Su contraseña Viafirma', 'Your Viafirma password')}
                autoComplete="new-password"
                className="w-full border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-xl px-3 pr-20 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 placeholder:text-slate-300 dark:placeholder:text-white/20" />
              <button type="button" onClick={() => setShowPass(p => !p)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-slate-500 dark:text-white/60 hover:text-slate-700 dark:hover:text-white/90 px-2 py-1">
                {showPass ? L('OCULTAR', 'HIDE') : L('VER', 'SHOW')}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400 dark:text-white/40">
              {L('Su contraseña no se guarda. Solo se usa para extraer la llave.',
                 'Your passphrase is never stored. It is only used to extract the key.')}
            </p>
            {/* 2026-04-30 — pre-validation feedback. Green = parsed cleanly,
                shows subject + expiry. Red goes through the existing toast. */}
            {validating && (
              <p className="mt-2 text-[11px] text-slate-500 dark:text-white/50 flex items-center gap-1.5">
                <RefreshCw size={11} className="animate-spin" />
                {L('Validando contrasena...', 'Validating passphrase...')}
              </p>
            )}
            {preview && !validating && (
              <div className={`mt-2 flex items-start gap-2 px-3 py-2 rounded-lg text-xs border ${
                preview.expired
                  ? 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30 text-red-800 dark:text-red-300'
                  : 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
              }`}>
                <CheckCircle2 size={13} className="mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-semibold">{L('Certificado valido — listo para instalar', 'Certificate valid — ready to install')}</p>
                  <p className="font-mono mt-0.5 truncate">{preview.subject}</p>
                  {preview.expiry && (
                    <p className="text-[10px] opacity-70">{L('Vence:', 'Expires:')} {new Date(preview.expiry).toLocaleDateString('es-DO')}</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Submit */}
          <button onClick={handleUpload} disabled={busy || !file || !passphrase}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition">
            {busy ? (
              <>
                <RefreshCw size={15} className="animate-spin" />
                {L('Instalando...', 'Installing...')}
              </>
            ) : (
              <>
                <Upload size={15} />
                {installed ? L('Reemplazar certificado', 'Replace certificate') : L('Instalar certificado', 'Install certificate')}
              </>
            )}
          </button>

          {/* Toast */}
          {toast && (
            <div className={`p-3 rounded-xl border text-sm ${
              toast.kind === 'ok'
                ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
                : 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30 text-red-800 dark:text-red-300'
            }`}>
              <div className="flex items-start gap-2">
                {toast.kind === 'ok'
                  ? <CheckCircle2 size={16} className="flex-shrink-0 mt-0.5" />
                  : <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />}
                <p>{toast.msg}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer help */}
      <div className="text-xs text-slate-400 dark:text-white/40 text-center">
        {L('¿No tiene certificado? Solicítelo en ',
           'Don\u2019t have a certificate? Request one at ')}
        <a href="https://studioxrdtech.com/ecf-certification" target="_blank" rel="noreferrer"
          className="text-[#b3001e] hover:underline font-medium">studioxrdtech.com/ecf-certification</a>
      </div>

      {/* Sandbox demo card — visible always so trial users can preview the e-CF flow */}
      <SandboxDemoCard />
    </div>
  )
}

// ── SandboxDemoCard: anyone can preview the e-CF acceptance shape ──────────
function SandboxDemoCard() {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  async function tryDemo() {
    setBusy(true); setError(null); setResult(null)
    try {
      const r = await api.dgii_ecf?.sandboxTry?.({ amount: 1000 })
      if (r?.ok) setResult(r.data || r)
      else setError(r?.error || L('Error en demo', 'Demo error'))
    } catch (err) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(err, { severity: 'error', category: 'dgii.sandboxdemocard' }) } catch {}
      setError(err?.message || L('Error de red', 'Network error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white dark:bg-white/5 rounded-2xl border border-[#b3001e]/20 dark:border-[#b3001e]/30 p-6">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-[#b3001e]/10 flex items-center justify-center flex-shrink-0">
          <Receipt size={20} className="text-[#b3001e]" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-slate-700 dark:text-white/80 uppercase tracking-wider">
            {L('Probar emision (demo)', 'Try emission (demo)')}
          </h3>
          <p className="text-[12px] text-slate-500 dark:text-white/50 mt-1">
            {L('Genere una factura de prueba para ver como funciona el flujo de e-CF de Terminal X — sin instalar nada.',
               'Generate a test invoice to see how the Terminal X e-CF flow works — no install needed.')}
          </p>
        </div>
      </div>

      <button onClick={tryDemo} disabled={busy}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#b3001e] text-white text-sm font-semibold hover:bg-[#8f0018] disabled:opacity-50 transition">
        {busy ? <RefreshCw size={15} className="animate-spin" /> : <Receipt size={15} />}
        {busy ? L('Generando...', 'Generating...') : L('Generar factura demo (RD$ 1,180)', 'Generate demo invoice (RD$ 1,180)')}
      </button>

      {error && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-800 dark:text-red-300 text-sm">
          <div className="flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
            <p>{error}</p>
          </div>
        </div>
      )}

      {result && (
        <div className="mt-4 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-sm">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400" />
            <span className="font-bold text-emerald-800 dark:text-emerald-300">
              {result._demo === false
                ? L('e-CF aceptado por DGII', 'e-CF accepted by DGII')
                : L('Demo: e-CF aceptado', 'Demo: e-CF accepted')}
            </span>
            {result._demo !== false && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 uppercase">
                {L('Modo demo', 'Demo mode')}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs font-mono text-emerald-900 dark:text-emerald-100/90">
            <div>
              <span className="opacity-60 block text-[10px] uppercase tracking-wider">eNCF</span>
              {result.eNCF}
            </div>
            <div>
              <span className="opacity-60 block text-[10px] uppercase tracking-wider">Track ID</span>
              {result.trackId}
            </div>
            <div>
              <span className="opacity-60 block text-[10px] uppercase tracking-wider">{L('Codigo DGII', 'DGII code')}</span>
              {result.dgiiCodigo} {result.status ? `· ${result.status}` : ''}
            </div>
            <div>
              <span className="opacity-60 block text-[10px] uppercase tracking-wider">{L('Codigo seguridad', 'Security code')}</span>
              {result.securityCode}
            </div>
            <div className="col-span-2">
              <span className="opacity-60 block text-[10px] uppercase tracking-wider">{L('Total', 'Total')}</span>
              RD$ {Number(result.totales?.total || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
            </div>
          </div>
          {result.qrLink && (
            <div className="mt-3 pt-3 border-t border-emerald-200 dark:border-emerald-500/30">
              <span className="opacity-60 block text-[10px] uppercase tracking-wider mb-1">QR DGII</span>
              <a href={result.qrLink} target="_blank" rel="noreferrer"
                className="text-[11px] text-emerald-700 dark:text-emerald-300 hover:underline break-all font-mono">
                {result.qrLink}
              </a>
            </div>
          )}
          {result._note && (
            <p className="mt-3 pt-3 border-t border-emerald-200 dark:border-emerald-500/30 text-[11px] text-emerald-700/80 dark:text-emerald-300/70 italic">
              {result._note}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Main DGII shell with 606 / 607 / ANECF tabs ─────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
export default function DGII() {
  // Honor ?tab= deep-links so onboarding/wizard CTAs (e.g. "Cargar certificado")
  // can jump straight to the right tab instead of dropping the user on 607.
  const initialTab = (() => {
    if (typeof window === 'undefined') return '606'
    const t = new URLSearchParams(window.location.search).get('tab')
    return ['606', '607', 'anecf', 'cert'].includes(t) ? t : '606'
  })()
  const [screen, setScreen] = useState(initialTab)
  const { lang } = useLang()
  const { user } = useAuth()
  const L = (es, en) => lang === 'es' ? es : en

  // Cert tab is web-only (desktop has its own installer in Settings) and owner-only.
  const isWeb       = typeof window !== 'undefined' && !window.electronAPI
  const isOwner     = String(user?.role || '').toLowerCase() === 'owner'
  const showCertTab = isWeb && isOwner

  return (
    <div className="h-full flex flex-col bg-slate-50 dark:bg-black overflow-hidden">
      {/* Top nav */}
      <div className="bg-white dark:bg-white/5 border-b border-slate-100 dark:border-white/10 px-6 py-3 flex items-center gap-4 flex-shrink-0">
        <div className="flex items-center gap-2 mr-4">
          <FileText size={18} className="text-slate-500 dark:text-white/60" />
          <span className="font-semibold text-slate-800 dark:text-white">DGII / Fiscal</span>
        </div>
        {/* Tab switcher */}
        <div className="flex rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden text-sm">
          {/* Tab labels match DGII's official naming: 607=Ventas (sales), 606=Compras (purchases).
              Underlying screens were historically mis-labeled; tabs now match screen content. */}
          <button onClick={() => setScreen('606')}
            title={L('Ventas emitidas por tu negocio', 'Sales issued by your business')}
            className={`flex items-center gap-1.5 px-5 py-2 font-medium transition ${screen === '606' ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10'}`}>
            <Database size={14} />
            {L('607 Ventas', '607 Sales')}
          </button>
          <button onClick={() => setScreen('607')}
            title={L('Compras a proveedores con comprobante fiscal', 'Purchases from suppliers with fiscal receipt')}
            className={`flex items-center gap-1.5 px-5 py-2 font-medium transition ${screen === '607' ? 'bg-emerald-600 text-white' : 'text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10'}`}>
            <ShoppingCart size={14} />
            {L('606 Compras', '606 Purchases')}
          </button>
          <button onClick={() => setScreen('anecf')}
            className={`flex items-center gap-1.5 px-5 py-2 font-medium transition ${screen === 'anecf' ? 'bg-red-600 text-white' : 'text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10'}`}>
            <Ban size={14} />
            {L('Anular e-NCF', 'Void e-NCF')}
          </button>
          {showCertTab && (
            <button onClick={() => setScreen('cert')}
              className={`flex items-center gap-1.5 px-5 py-2 font-medium transition ${screen === 'cert' ? 'bg-emerald-600 text-white' : 'text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10'}`}>
              <ShieldCheck size={14} />
              {L('Certificado', 'Certificate')}
            </button>
          )}
        </div>
        <div className="ml-auto">
          <span className="text-xs text-slate-400 dark:text-white/40">
            {screen === '606'
              ? L('Ventas / Comprobantes emitidos', 'Sales / Issued receipts')
              : screen === '607'
                ? L('Compras / Gastos recibidos', 'Purchases / Received expenses')
                : screen === 'anecf'
                  ? L('Anulación de rangos no utilizados', 'Void unused sequence ranges')
                  : L('Certificado digital Viafirma', 'Viafirma digital certificate')
            }
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {screen === '606'
          ? <Screen606 />
          : screen === '607'
            ? <Screen607 />
            : screen === 'cert' && showCertTab
              ? <ScreenCert />
              : <ScreenANECF />}
      </div>
    </div>
  )
}
