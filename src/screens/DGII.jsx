import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  FileText, FilePlus, Download, Send, CheckCircle2, AlertCircle,
  Clock, AlertTriangle, RefreshCw, Database, ShoppingCart,
  Package, Minus, ChevronDown, Search,
} from 'lucide-react'
import { useLang } from '../i18n'

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
  const ring = { slate:'border-slate-100 bg-white', blue:'border-blue-200 bg-blue-50', green:'border-emerald-200 bg-emerald-50', red:'border-red-200 bg-red-50', amber:'border-amber-200 bg-amber-50' }
  const val  = { slate:'text-slate-800', blue:'text-blue-700', green:'text-emerald-700', red:'text-red-600', amber:'text-amber-600' }
  return (
    <div className={`rounded-2xl border p-4 flex-1 ${ring[color]}`}>
      <div className="flex justify-between items-start mb-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
        {Icon && <Icon size={14} className={val[color]} />}
      </div>
      <p className={`text-2xl font-bold tabular-nums ${val[color]}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
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
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${period === p ? 'bg-blue-600 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
          {p}
        </button>
      ))}
      <div className="relative">
        <select value={months.some(m => m.value === period) ? period : ''}
          onChange={e => setPeriod(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 appearance-none pr-8">
          <option value="">Mes específico…</option>
          {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <ChevronDown size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
      </div>
    </div>
  )
}

function SubmitBox({ onGenerate, onSend, onXML }) {
  const [sending, setSending] = useState(false)
  async function handleSend() {
    setSending(true)
    await new Promise(r => setTimeout(r, 1500))
    setSending(false)
    onSend()
  }
  return (
    <div className="space-y-2">
      <button onClick={onGenerate} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50">
        <Download size={14} className="text-slate-400" />
        Generar archivo TXT
      </button>
      <button onClick={onXML} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50">
        <Database size={14} className="text-slate-400" />
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
  const bg = color === 'green' ? 'bg-emerald-600' : 'bg-slate-800'
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
    blue: { bar: 'bg-blue-500', bg: warning ? 'bg-amber-50 border-amber-200' : 'bg-blue-50 border-blue-200', text: 'text-blue-700' },
    green: { bar: 'bg-emerald-500', bg: warning ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700' },
  }
  const c = colors[accentColor] || colors.blue
  return (
    <div className={`rounded-xl border p-4 flex-1 ${c.bg}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono font-bold text-slate-800">{code}</span>
        {warning
          ? <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1"><AlertTriangle size={10} />Pocas disponibles</span>
          : seq.limit > 0
            ? <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">OK</span>
            : <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-semibold">Pendiente</span>
        }
      </div>
      <p className="text-xs text-slate-500 mb-1">{seq.name}</p>
      {seq.limit > 0 ? (
        <>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-500">Actual: <span className="font-medium text-slate-700">{seq.current.toLocaleString()}</span></span>
            <span className="text-slate-500">Límite: <span className="font-medium text-slate-700">{seq.limit.toLocaleString()}</span></span>
          </div>
          <div className="h-1.5 bg-white/60 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${warning ? 'bg-amber-400' : c.bar}`} style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
          <div className="flex justify-between text-xs mt-1">
            <span className={warning ? 'text-amber-600 font-medium' : 'text-slate-400'}>{remaining.toLocaleString()} disponibles</span>
            <span className="text-slate-400">Vence: {seq.expires}</span>
          </div>
        </>
      ) : (
        <p className="text-xs text-slate-400">Sin secuencia asignada — configure en Settings</p>
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
      const rows = await window.electronAPI.dgii.get606({ from, to })
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
      console.error('DGII 606 load error:', e)
      setTxns([])
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    if (!window.electronAPI?.ncf?.sequences) return
    window.electronAPI.ncf.sequences()
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

  function generateTXT() {
    const lines = txns.map(t =>
      [t.ncf, t.rnc||'', fmtDate(t.fecha), t.subtotal.toFixed(2), t.itbis.toFixed(2), t.total.toFixed(2), t.estado].join('|')
    )
    const content = `# DGII 606 — Período: ${period}\n` + lines.join('\n')
    const blob = new Blob([content], { type: 'text/plain' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'dgii_606.txt'; a.click()
    showToast('Archivo 606 generado')
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
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{L('Período', 'Period')}</p>
          <button onClick={loadData} disabled={loading}
            className="flex items-center gap-1.5 text-xs border border-slate-200 text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            {L('Actualizar', 'Refresh')}
          </button>
        </div>
        <PeriodSelector period={period} setPeriod={setPeriod} />
      </div>

      {/* NCF Sequence cards */}
      {sequences.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2 px-1">
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
            <div className="mt-2 flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2">
              <AlertTriangle size={15} className="text-red-500" />
              <span className="text-sm text-red-600">
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
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {/* Tabs + search */}
        <div className="flex items-center gap-1 px-4 pt-3 border-b border-slate-100">
          {TABS_606.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t border-b-2 -mb-px transition ${tab === t.key ? 'text-blue-600 border-blue-500' : 'text-slate-500 border-transparent hover:text-slate-700'}`}>
              {t.label}
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tab === t.key ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>{tabCounts[t.key]}</span>
            </button>
          ))}
          <div className="ml-auto pb-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder={L('Buscar…', 'Search…')}
                className="pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 w-48" />
            </div>
          </div>
        </div>
        {/* Header */}
        <div className="flex items-center px-4 py-2 bg-slate-50 border-b border-slate-100">
          {COLS_606.map(c => <span key={c.key} className={`text-[10px] font-semibold uppercase tracking-wider text-slate-400 ${c.cls}`}>{c.label}</span>)}
        </div>
        {/* Rows */}
        <div className="divide-y divide-slate-50">
          {loading && <div className="py-10 text-center text-sm text-slate-400">{L('Cargando…', 'Loading…')}</div>}
          {!loading && visible.length === 0 && <div className="py-10 text-center text-sm text-slate-400">{L('Sin registros para este período.', 'No records for this period.')}</div>}
          {!loading && visible.map(t => (
            <div key={t.id} className={`flex items-center px-4 h-11 ${t.estado === 'anulado' ? 'opacity-50 bg-slate-50' : 'hover:bg-slate-50'}`}>
              <span className={`${COLS_606[0].cls} ${t.estado === 'anulado' ? 'line-through text-slate-400' : ''}`}>{t.ncf}</span>
              <div className={`${COLS_606[1].cls} min-w-0`}>
                <p className="text-sm text-slate-800 truncate">{t.client}</p>
                {t.rnc && <p className="text-[10px] text-slate-400">{t.rnc}</p>}
              </div>
              <div className={`${COLS_606[2].cls}`}>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${['B01','E31'].includes(t.tipo) ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>{t.tipo}</span>
              </div>
              <span className={`${COLS_606[3].cls} text-xs text-slate-500`}>{fmtDate(t.fecha)}</span>
              <span className={`${COLS_606[4].cls} text-sm tabular-nums ${t.estado === 'anulado' ? 'line-through text-slate-400' : 'text-slate-700'}`}>{fmtMoney(t.subtotal)}</span>
              <span className={`${COLS_606[5].cls} text-sm tabular-nums ${t.estado === 'anulado' ? 'line-through text-slate-400' : 'text-slate-700'}`}>{fmtMoney(t.itbis)}</span>
              <span className={`${COLS_606[6].cls} text-sm font-medium tabular-nums ${t.estado === 'anulado' ? 'line-through text-slate-400' : 'text-slate-800'}`}>{fmtMoney(t.total)}</span>
              <div className={`${COLS_606[7].cls}`}>
                {t.estado === 'valido'
                  ? <span className="flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 size={11} />Válido</span>
                  : <span className="flex items-center gap-1 text-xs text-slate-400"><Minus size={11} />Anulado</span>
                }
              </div>
            </div>
          ))}
        </div>
        {/* Footer */}
        <div className="border-t border-slate-100 px-4 py-2 flex justify-between bg-slate-50">
          <span className="text-xs text-slate-400">{visible.length} registro{visible.length !== 1 ? 's' : ''}</span>
          <span className="text-sm font-bold text-slate-800 tabular-nums">{fmtMoney(visible.filter(t=>t.estado==='valido').reduce((s,t)=>s+t.total,0))}</span>
        </div>
      </div>

      {/* Bottom 3 panels */}
      <div className="grid grid-cols-3 gap-4">
        {/* Resumen fiscal */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-3">Resumen fiscal</p>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Período</span><span className="text-slate-700">{period}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Total docs</span><span className="font-medium text-slate-700">{txns.length}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">ITBIS cobrado</span><span className="font-medium text-slate-700">{fmtMoney(totalItbis)}</span></div>
            <div className="flex justify-between border-t border-slate-100 pt-1.5 mt-1"><span className="text-slate-600 font-medium">Total facturado</span><span className="font-bold text-slate-800">{fmtMoney(totalFact)}</span></div>
          </div>
        </div>
        {/* Enviar a DGII */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-3">Enviar a DGII</p>
          <SubmitBox onGenerate={generateTXT} onSend={() => showToast('606 enviado a DGII exitosamente')} onXML={generateXML} />
        </div>
        {/* Historial — driven by real DB ranges */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-3">Historial por mes</p>
          <HistorialPanel showToast={showToast} />
        </div>
      </div>
    </div>
  )
}

// ── Historial Panel — loads last 4 months on demand ──────────────────────────
function HistorialPanel({ showToast }) {
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
          months.map(m => window.electronAPI.dgii.get606({ from: m.from, to: m.to }).then(r => ({ ...m, records: (r||[]).length, total: (r||[]).reduce((s,t)=>s+(t.total||0),0) })).catch(() => ({ ...m, records: 0, total: 0 })))
        )
        setRows(results)
      } catch {
        setRows([])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <p className="text-xs text-slate-400 animate-pulse">Cargando historial…</p>
  if (!rows.length) return <p className="text-xs text-slate-400">Sin historial disponible.</p>

  return (
    <div className="space-y-2">
      {rows.map((h, i) => (
        <div key={i} className="flex items-center gap-2 py-1">
          <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-slate-700 truncate capitalize">{h.label}</p>
            <p className="text-[10px] text-slate-400">{h.records} registros · {fmtMoney(h.total)}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ── 607 SCREEN — empty state (no DB function for purchases) ──────────────────
// ─────────────────────────────────────────────────────────────────────────────
function Screen607() {
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  return (
    <div className="flex flex-col gap-4">
      {/* Summary bar — all zeros */}
      <div className="flex gap-3">
        <MetricCard label={L('Total registros', 'Total records')}  value="0" sub={L('período', 'period')} />
        <MetricCard label={L('Facturas compras', 'Purchase invoices')} value="0" sub={L('con NCF', 'with NCF')} color="green" />
        <MetricCard label={L('Gastos varios', 'Other expenses')}    value="0" sub={L('sin NCF', 'without NCF')} color="amber" />
        <MetricCard label={L('ITBIS pagado', 'ITBIS paid')}         value={fmtMoney(0)} sub={L('a reclamar', 'to claim')} color="blue" />
        <MetricCard label={L('Total gastado', 'Total spent')}        value={fmtMoney(0)} sub={L('bruto', 'gross')} />
      </div>

      {/* Empty state card */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center">
          <Package size={28} className="text-slate-400" />
        </div>
        <div className="text-center">
          <p className="text-base font-semibold text-slate-600 mb-1">
            {L('No hay compras registradas', 'No purchases recorded')}
          </p>
          <p className="text-sm text-slate-400 max-w-xs">
            {L(
              'El módulo 607 de compras y gastos estará disponible próximamente. Los registros de proveedores se ingresarán desde aquí.',
              'The 607 purchases and expenses module is coming soon. Supplier records will be entered from here.'
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 mt-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2">
          <Clock size={14} className="text-amber-500 flex-shrink-0" />
          <span className="text-xs text-amber-700">
            {L('Módulo en desarrollo — disponible en próxima versión', 'Module in development — available in next version')}
          </span>
        </div>
      </div>

      {/* Bottom panels */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-3">Resumen 607</p>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Total registros</span><span className="font-medium text-slate-700">0</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Facturas c/NCF</span><span className="text-slate-700">0</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Gastos varios</span><span className="text-slate-700">0</span></div>
            <div className="flex justify-between border-t border-slate-100 pt-1.5 mt-1">
              <span className="text-slate-600 font-medium">ITBIS a reclamar</span>
              <span className="font-bold text-emerald-700">{fmtMoney(0)}</span>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-3">Enviar a DGII</p>
          <div className="space-y-2">
            <button disabled className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-100 text-sm text-slate-300 cursor-not-allowed">
              <Download size={14} />
              Generar archivo TXT
            </button>
            <button disabled className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-100 text-sm text-slate-300 cursor-not-allowed">
              <Database size={14} />
              Descargar XML
            </button>
            <button disabled className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 text-slate-400 text-sm cursor-not-allowed">
              <Send size={14} />
              Enviar a DGII
            </button>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-3">Historial envíos</p>
          <p className="text-xs text-slate-400">{L('Sin historial de envíos 607.', 'No 607 submission history.')}</p>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Main DGII shell with 606 / 607 tabs ──────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
export default function DGII() {
  const [screen, setScreen] = useState('606')
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  return (
    <div className="h-full flex flex-col bg-slate-50 overflow-hidden">
      {/* Top nav */}
      <div className="bg-white border-b border-slate-100 px-6 py-3 flex items-center gap-4 flex-shrink-0">
        <div className="flex items-center gap-2 mr-4">
          <FileText size={18} className="text-slate-500" />
          <span className="font-semibold text-slate-800">DGII / Fiscal</span>
        </div>
        {/* Tab switcher */}
        <div className="flex rounded-xl border border-slate-200 overflow-hidden text-sm">
          <button onClick={() => setScreen('606')}
            className={`flex items-center gap-1.5 px-5 py-2 font-medium transition ${screen === '606' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
            <Database size={14} />
            {L('Reporte 606', 'Report 606')}
          </button>
          <button onClick={() => setScreen('607')}
            className={`flex items-center gap-1.5 px-5 py-2 font-medium transition ${screen === '607' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
            <ShoppingCart size={14} />
            {L('Reporte 607', 'Report 607')}
          </button>
        </div>
        <div className="ml-auto">
          <span className="text-xs text-slate-400">
            {screen === '606'
              ? L('Ventas / Comprobantes emitidos', 'Sales / Issued receipts')
              : L('Compras / Gastos recibidos', 'Purchases / Received expenses')
            }
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {screen === '606' ? <Screen606 /> : <Screen607 />}
      </div>
    </div>
  )
}
