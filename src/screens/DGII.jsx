import { useState, useMemo } from 'react'
import {
  FileText, FilePlus, Download, Send, CheckCircle2, AlertCircle,
  Clock, AlertTriangle, RefreshCw, Database, ShoppingCart,
  Package, Minus, Plus, ChevronDown, X, Search,
} from 'lucide-react'

// ── Shared date helpers ───────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtMoney(n) {
  return 'RD$' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n); return d
}

// ── NCF Sequences (shared reference) ─────────────────────────────────────────
const NCF_SEQS = {
  B01: { name: 'Crédito Fiscal',       current: 81,  limit: 500, expires: '2026-12-31' },
  B02: { name: 'Consumidor Final',     current: 217, limit: 500, expires: '2026-12-31' },
  E31: { name: 'CF Electrónico',       current: 0,   limit: 0,   expires: '—'          },
  E32: { name: 'CF Elec. Consumidor',  current: 0,   limit: 0,   expires: '—'          },
}

// ── 606 Demo data ─────────────────────────────────────────────────────────────
let _txId = 6000
function mk606(ncf, client, rnc, tipo, dAgo, subtotal, estado = 'valido') {
  const itbis = parseFloat((subtotal * 0.18).toFixed(2))
  const ley   = parseFloat((subtotal * 0.10).toFixed(2))
  const total = subtotal + itbis + ley
  return { id: ++_txId, ncf, client, rnc, tipo, fecha: daysAgo(dAgo), subtotal, itbis, total, estado }
}
const TXNS_606 = [
  mk606('B01000000081','Grupo Mejía S.R.L.',    '130-12345-6','B01',0,  3500),
  mk606('B02000000217','Juan García',           '',           'B02',0,  1100),
  mk606('B01000000080','Importadora Del Norte', '101-98765-4','B01',1,  2200),
  mk606('B02000000216','Ana Rodríguez',         '',           'B02',1,   900),
  mk606('B02000000215','Pedro Sánchez',         '',           'B02',2,  1500),
  mk606('B01000000079','Ferretería El Clavo',   '130-55512-1','B01',2,  4500),
  mk606('B02000000214','Luis Martínez',         '',           'B02',3,   800),
  mk606('B01000000078','Seguros Caribe',        '101-44321-9','B01',3,  6000),
  mk606('B02000000213','María Pérez',           '',           'B02',4,  1200, 'anulado'),
  mk606('B01000000077','Mueblería Don Pedro',   '130-77230-8','B01',5,  3200),
  mk606('B02000000212','Carlos Díaz',           '',           'B02',6,   700),
  mk606('B02000000211','Rosa Flores',           '',           'B02',8,  2100),
]

// ── Past 606 submissions ──────────────────────────────────────────────────────
const HIST_606 = [
  { date: '2026-02-28', period: 'Febrero 2026',   records: 148, status: 'enviado',  size: '48 KB' },
  { date: '2026-01-31', period: 'Enero 2026',     records: 162, status: 'enviado',  size: '52 KB' },
  { date: '2025-12-31', period: 'Diciembre 2025', records: 201, status: 'enviado',  size: '65 KB' },
  { date: '2025-11-30', period: 'Noviembre 2025', records: 139, status: 'enviado',  size: '44 KB' },
]

// ── 607 Demo data ─────────────────────────────────────────────────────────────
let _r607 = 7000
function mk607(ncf, suplidor, rnc, desc, tipo, dAgo, itbis, total) {
  return { id: ++_r607, ncf, suplidor, rnc, desc, tipo, fecha: daysAgo(dAgo), itbis, total, estado: 'registrado' }
}
const TXNS_607 = [
  mk607('B01000000441','Ferretería El Clavo','130-55512-1','Pintura y materiales','Factura',   0,  432, 2400),
  mk607('',            '(Gasto varios)',     '',           'Gasolina cortesía',    'Gasto',     1,    0,  850),
  mk607('B01000000098','Suministros Don Juan','130-44100-2','Detergentes y químicos','Factura', 2,  288, 1600),
  mk607('',            '(Servicio)',         '',           'Electricidad EDENORTE','Servicio',  3,    0, 3200),
  mk607('B01000000312','Inversiones Caribe', '101-77654-3','Repuestos aspiradora', 'Factura',  5,  180, 1000),
  mk607('',            '(Gasto varios)',     '',           'Agua potable',          'Gasto',    7,    0,  420),
  mk607('B01000000555','CLARO Empresas',     '101-22334-5','Internet y teléfono',  'Servicio',10, 324, 1800),
]
const HIST_607 = [
  { date: '2026-02-28', period: 'Febrero 2026',   records: 42, status: 'enviado', itbisRec: 18240 },
  { date: '2026-01-31', period: 'Enero 2026',     records: 38, status: 'enviado', itbisRec: 15840 },
  { date: '2025-12-31', period: 'Diciembre 2025', records: 51, status: 'enviado', itbisRec: 22680 },
]

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

function HistPanel({ items, renderItem }) {
  return (
    <div className="space-y-2">
      {items.map((h, i) => renderItem(h, i))}
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
const TABS_606 = [
  { key: 'todos',  label: 'Todos',  fn: () => true             },
  { key: 'e31b01', label: 'E31/B01',fn: t => ['B01','E31'].includes(t.tipo) },
  { key: 'e32b02', label: 'E32/B02',fn: t => ['B02','E32'].includes(t.tipo) },
]
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
  const [period, setPeriod] = useState('Este mes')
  const [tab, setTab]       = useState('todos')
  const [search, setSearch] = useState('')
  const [toast, setToast]   = useState(null)

  const tabFn     = TABS_606.find(t => t.key === tab)?.fn ?? (() => true)
  const tabCounts = useMemo(() => {
    const o = {}; TABS_606.forEach(t => { o[t.key] = TXNS_606.filter(t.fn).length }); return o
  }, [])

  const q = search.trim().toLowerCase()
  const visible = TXNS_606.filter(tabFn).filter(t =>
    !q || t.client.toLowerCase().includes(q) || t.ncf.toLowerCase().includes(q) || (t.rnc||'').includes(q)
  )

  const totalItbis = TXNS_606.filter(t => t.estado === 'valido').reduce((s, t) => s + t.itbis, 0)
  const totalFact  = TXNS_606.filter(t => t.estado === 'valido').reduce((s, t) => s + t.total, 0)
  const countB01   = TXNS_606.filter(t => ['B01','E31'].includes(t.tipo)).length
  const countB02   = TXNS_606.filter(t => ['B02','E32'].includes(t.tipo)).length

  function generateTXT() {
    const lines = TXNS_606.map(t =>
      [t.ncf, t.rnc||'', fmtDate(t.fecha), t.subtotal.toFixed(2), t.itbis.toFixed(2), t.total.toFixed(2), t.estado].join('|')
    )
    const content = `# DGII 606 — Período: ${period}\n` + lines.join('\n')
    download606TXT(content)
    showToast('Archivo 606 generado')
  }
  function generateXML() {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Reportes606>\n` +
      TXNS_606.map(t => `  <Comprobante NCF="${t.ncf}" Total="${t.total.toFixed(2)}" ITBIS="${t.itbis.toFixed(2)}" Estado="${t.estado}" />`).join('\n') +
      '\n</Reportes606>'
    const blob = new Blob([xml], { type: 'application/xml' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'dgii_606.xml'; a.click()
    showToast('XML 606 descargado')
  }
  function download606TXT(content) {
    const blob = new Blob([content], { type: 'text/plain' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'dgii_606.txt'; a.click()
  }
  function showToast(msg) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  return (
    <div className="flex flex-col gap-4">
      {toast && <Toast msg={toast} color="green" />}

      {/* Period */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-3">Período</p>
        <PeriodSelector period={period} setPeriod={setPeriod} />
      </div>

      {/* NCF Sequence cards */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2 px-1">Secuencias NCF</p>
        <div className="flex gap-3">
          <NCFSeqCard code="E32 / B02" seq={NCF_SEQS.B02} accentColor="blue" />
          <NCFSeqCard code="E31 / B01" seq={NCF_SEQS.B01} accentColor="blue" />
        </div>
        {(NCF_SEQS.B01.limit - NCF_SEQS.B01.current < 500 || NCF_SEQS.B02.limit - NCF_SEQS.B02.current < 500) && (
          <div className="mt-2 flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2">
            <AlertTriangle size={15} className="text-red-500" />
            <span className="text-sm text-red-600">Una o más secuencias están bajas — solicite nuevas a la DGII.</span>
          </div>
        )}
      </div>

      {/* Summary bar */}
      <div className="flex gap-3">
        <MetricCard label="Total comprobantes" value={TXNS_606.length}      sub="período seleccionado"            />
        <MetricCard label="E31/B01 emitidos"   value={countB01}             sub="crédito fiscal"   color="blue"   />
        <MetricCard label="E32/B02 emitidos"   value={countB02}             sub="consumidor final" color="blue"   />
        <MetricCard label="Total ITBIS"         value={fmtMoney(totalItbis)} sub="cobrado"          color="red"    />
        <MetricCard label="Total facturado"     value={fmtMoney(totalFact)}  sub="bruto"            color="slate"  />
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
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…"
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
          {visible.length === 0 && <div className="py-10 text-center text-sm text-slate-400">Sin registros para este período.</div>}
          {visible.map(t => (
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
            <div className="flex justify-between"><span className="text-slate-500">RNC empresa</span><span className="font-mono text-slate-700">130-12345-6</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Período</span><span className="text-slate-700">{period}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Total docs</span><span className="font-medium text-slate-700">{TXNS_606.length}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">ITBIS cobrado</span><span className="font-medium text-slate-700">{fmtMoney(totalItbis)}</span></div>
            <div className="flex justify-between border-t border-slate-100 pt-1.5 mt-1"><span className="text-slate-600 font-medium">Total facturado</span><span className="font-bold text-slate-800">{fmtMoney(totalFact)}</span></div>
          </div>
        </div>
        {/* Enviar a DGII */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-3">Enviar a DGII</p>
          <SubmitBox onGenerate={generateTXT} onSend={() => showToast('606 enviado a DGII exitosamente')} onXML={generateXML} />
        </div>
        {/* Historial envíos */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-3">Historial envíos</p>
          <div className="space-y-2">
            {HIST_606.map((h, i) => (
              <div key={i} className="flex items-center gap-2 py-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-700 truncate">{h.period}</p>
                  <p className="text-[10px] text-slate-400">{h.records} registros · {h.size}</p>
                </div>
                <span className="text-[10px] text-slate-400">{h.date}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ── 607 SCREEN ────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
const TABS_607 = [
  { key: 'todos',     label: 'Todos',     fn: () => true                    },
  { key: 'facturas',  label: 'Facturas',  fn: t => t.tipo === 'Factura'     },
  { key: 'gastos',    label: 'Gastos',    fn: t => t.tipo === 'Gasto'       },
  { key: 'servicios', label: 'Servicios', fn: t => t.tipo === 'Servicio'    },
]
const COLS_607 = [
  { key: 'ncf',     label: 'NCF suplidor', cls: 'w-36 font-mono text-xs' },
  { key: 'supl',    label: 'Suplidor/RNC', cls: 'flex-1 min-w-0'         },
  { key: 'desc',    label: 'Descripción',  cls: 'w-44'                   },
  { key: 'tipo',    label: 'Tipo',         cls: 'w-24 text-center'       },
  { key: 'fecha',   label: 'Fecha',        cls: 'w-28'                   },
  { key: 'itbis',   label: 'ITBIS',        cls: 'w-24 text-right'        },
  { key: 'total',   label: 'Total',        cls: 'w-28 text-right'        },
  { key: 'estado',  label: 'Estado',       cls: 'w-24'                   },
]
const TIPO_607 = { Factura:'bg-emerald-100 text-emerald-700', Gasto:'bg-amber-100 text-amber-700', Servicio:'bg-violet-100 text-violet-700' }

function EntryForm607({ onClose, onSave }) {
  const [suplRNC, setSuplRNC]     = useState('')
  const [suplName, setSuplName]   = useState('')
  const [ncf, setNcf]             = useState('')
  const [fecha, setFecha]         = useState(new Date().toISOString().slice(0, 10))
  const [tipo, setTipo]           = useState('Factura')
  const [formaPago, setFormaPago] = useState('Efectivo')
  const [items, setItems]         = useState([{ desc: '', amount: 0 }])
  const [loading, setLoading]     = useState(false)
  const [rncResult, setRncResult] = useState(null)

  async function lookupRNC() {
    if (!suplRNC || suplRNC.length < 9) return
    setLoading(true)
    await new Promise(r => setTimeout(r, 700))
    const names = ['Ferretería El Clavo S.R.L.','Suministros Don Juan','Inversiones Caribe','CLARO Empresas','Distribuidora Central']
    const idx = parseInt(suplRNC.replace(/-/g,'').slice(-1)) % names.length
    setRncResult(names[idx]); setSuplName(names[idx])
    setLoading(false)
  }
  function addItem() { setItems(i => [...i, { desc: '', amount: 0 }]) }
  function removeItem(idx) { setItems(i => i.filter((_, j) => j !== idx)) }
  function setItem(idx, key, val) { setItems(i => i.map((x, j) => j === idx ? { ...x, [key]: val } : x)) }
  const subtotal = items.reduce((s, x) => s + (parseFloat(x.amount) || 0), 0)
  const itbis    = tipo === 'Factura' ? parseFloat((subtotal * 0.18).toFixed(2)) : 0
  const total    = subtotal + itbis

  return (
    <div className="bg-white rounded-2xl border border-emerald-200 shadow-sm p-5 mb-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Nuevo registro 607</p>
        <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X size={15} className="text-slate-400" /></button>
      </div>
      <div className="flex gap-3 mb-3 flex-wrap">
        <div className="w-44">
          <label className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 block">RNC suplidor</label>
          <div className="flex gap-1">
            <input value={suplRNC} onChange={e => setSuplRNC(e.target.value)} onBlur={lookupRNC} placeholder="000-00000-0"
              className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            {loading && <span className="text-[10px] text-slate-400 self-center animate-pulse">…</span>}
          </div>
          {rncResult && <p className="text-[10px] text-emerald-600 mt-0.5 truncate">✓ {rncResult}</p>}
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 block">Suplidor</label>
          <input value={suplName} onChange={e => setSuplName(e.target.value)} placeholder="Nombre suplidor"
            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
        </div>
        <div className="w-36">
          <label className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 block">NCF suplidor</label>
          <input value={ncf} onChange={e => setNcf(e.target.value)} placeholder="B01000000001"
            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-400" />
        </div>
        <div className="w-36">
          <label className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 block">Fecha</label>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
        </div>
        <div>
          <label className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 block">Tipo</label>
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
            {['Factura','Gasto','Servicio'].map(t => (
              <button key={t} onClick={() => setTipo(t)}
                className={`px-3 py-1.5 font-medium transition ${tipo === t ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 block">Forma de pago</label>
          <select value={formaPago} onChange={e => setFormaPago(e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400">
            {['Efectivo','Transferencia','Crédito'].map(f => <option key={f}>{f}</option>)}
          </select>
        </div>
      </div>
      {/* Items */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] text-slate-400 uppercase tracking-wider">Artículos / Servicios</label>
          <button onClick={addItem} className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-700">
            <Plus size={11} /> Agregar
          </button>
        </div>
        {items.map((item, idx) => (
          <div key={idx} className="flex gap-2 mb-1.5">
            <input value={item.desc} onChange={e => setItem(idx, 'desc', e.target.value)} placeholder="Descripción…"
              className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-400" />
            <div className="relative w-32">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">RD$</span>
              <input type="number" value={item.amount || ''} onChange={e => setItem(idx, 'amount', e.target.value)} placeholder="0"
                className="w-full pl-8 pr-2 py-1.5 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-1 focus:ring-emerald-400" />
            </div>
            {items.length > 1 && (
              <button onClick={() => removeItem(idx)} className="p-1.5 rounded hover:bg-red-50"><Minus size={13} className="text-slate-400" /></button>
            )}
          </div>
        ))}
      </div>
      {/* Calc strip */}
      <div className="flex items-center gap-6 bg-slate-50 rounded-xl px-4 py-2.5 mb-4 text-sm">
        <div><p className="text-[10px] text-slate-400">Subtotal</p><p className="font-semibold text-slate-700">{fmtMoney(subtotal)}</p></div>
        <div><p className="text-[10px] text-slate-400">ITBIS</p><p className="font-semibold text-slate-700">{fmtMoney(itbis)}</p></div>
        <div><p className="text-[10px] text-slate-400 font-bold">Total</p><p className="font-bold text-slate-800">{fmtMoney(total)}</p></div>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
        <button className="px-4 py-2 rounded-lg border border-emerald-300 text-sm text-emerald-700 hover:bg-emerald-50 font-medium">Guardar borrador</button>
        <button onClick={() => { onSave({ suplidor: suplName||'(Suplidor)', rnc: suplRNC, ncf: ncf||'', desc: items.map(i=>i.desc).join(', '), tipo, fecha, itbis, total }) }}
          className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700">
          Guardar en 607
        </button>
      </div>
    </div>
  )
}

function Screen607() {
  const [period, setPeriod]   = useState('Este mes')
  const [tab, setTab]         = useState('todos')
  const [search, setSearch]   = useState('')
  const [txns, setTxns]       = useState(TXNS_607)
  const [showForm, setShowForm] = useState(false)
  const [toast, setToast]     = useState(null)

  const tabFn = TABS_607.find(t => t.key === tab)?.fn ?? (() => true)
  const tabCounts = useMemo(() => {
    const o = {}; TABS_607.forEach(t => { o[t.key] = txns.filter(t.fn).length }); return o
  }, [txns])

  const q = search.trim().toLowerCase()
  const visible = txns.filter(tabFn).filter(t =>
    !q || t.suplidor.toLowerCase().includes(q) || t.ncf.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q)
  )

  const totalItbis = txns.reduce((s, t) => s + (t.itbis || 0), 0)
  const totalGasto = txns.reduce((s, t) => s + t.total, 0)

  function handleSave(rec) {
    setTxns(prev => [{ ...rec, id: Date.now(), estado: 'registrado', fecha: new Date(rec.fecha) }, ...prev])
    setShowForm(false)
    showToast('Registro guardado en 607')
  }
  function generateTXT() {
    const lines = txns.map(t => [t.ncf, t.rnc||'', fmtDate(t.fecha), t.itbis?.toFixed(2)||'0.00', t.total.toFixed(2), t.tipo, t.estado].join('|'))
    const blob = new Blob([`# DGII 607 — ${period}\n` + lines.join('\n')], { type: 'text/plain' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'dgii_607.txt'; a.click()
    showToast('Archivo 607 generado')
  }
  function showToast(msg) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  return (
    <div className="flex flex-col gap-4">
      {toast && <Toast msg={toast} color="green" />}

      {/* Period */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-3">Período</p>
        <PeriodSelector period={period} setPeriod={setPeriod} />
      </div>

      {/* Summary bar */}
      <div className="flex gap-3">
        <MetricCard label="Total registros"    value={txns.length}           sub="período"                       />
        <MetricCard label="Facturas compras"   value={txns.filter(t=>t.tipo==='Factura').length}  sub="con NCF" color="green" />
        <MetricCard label="Gastos varios"      value={txns.filter(t=>t.tipo==='Gasto').length}    sub="sin NCF" color="amber" />
        <MetricCard label="ITBIS pagado"       value={fmtMoney(totalItbis)}  sub="a reclamar"   color="blue"   />
        <MetricCard label="Total gastado"      value={fmtMoney(totalGasto)}  sub="bruto"                        />
      </div>

      {/* Entry form toggle */}
      {!showForm && (
        <div className="flex justify-end">
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 text-sm bg-emerald-600 text-white px-3 py-2 rounded-lg hover:bg-emerald-700">
            <Plus size={14} /> Nuevo registro 607
          </button>
        </div>
      )}
      {showForm && <EntryForm607 onClose={() => setShowForm(false)} onSave={handleSave} />}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="flex items-center gap-1 px-4 pt-3 border-b border-slate-100">
          {TABS_607.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t border-b-2 -mb-px transition ${tab === t.key ? 'text-emerald-600 border-emerald-500' : 'text-slate-500 border-transparent hover:text-slate-700'}`}>
              {t.label}
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tab === t.key ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{tabCounts[t.key]}</span>
            </button>
          ))}
          <div className="ml-auto pb-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…"
                className="pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 w-48" />
            </div>
          </div>
        </div>
        <div className="flex items-center px-4 py-2 bg-slate-50 border-b border-slate-100">
          {COLS_607.map(c => <span key={c.key} className={`text-[10px] font-semibold uppercase tracking-wider text-slate-400 ${c.cls}`}>{c.label}</span>)}
        </div>
        <div className="divide-y divide-slate-50">
          {visible.length === 0 && <div className="py-10 text-center text-sm text-slate-400">Sin registros.</div>}
          {visible.map(t => (
            <div key={t.id} className="flex items-center px-4 h-11 hover:bg-slate-50">
              <span className={`${COLS_607[0].cls} text-slate-500`}>{t.ncf || <span className="text-slate-300">—</span>}</span>
              <div className={`${COLS_607[1].cls} min-w-0`}>
                <p className="text-sm text-slate-800 truncate">{t.suplidor}</p>
                {t.rnc && <p className="text-[10px] text-slate-400">{t.rnc}</p>}
              </div>
              <span className={`${COLS_607[2].cls} text-xs text-slate-600 truncate`}>{t.desc}</span>
              <div className={`${COLS_607[3].cls}`}>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${TIPO_607[t.tipo] || 'bg-slate-100 text-slate-600'}`}>{t.tipo}</span>
              </div>
              <span className={`${COLS_607[4].cls} text-xs text-slate-500`}>{fmtDate(t.fecha)}</span>
              <span className={`${COLS_607[5].cls} text-sm tabular-nums text-slate-700`}>{t.itbis > 0 ? fmtMoney(t.itbis) : <span className="text-slate-300">—</span>}</span>
              <span className={`${COLS_607[6].cls} text-sm font-medium tabular-nums text-slate-800`}>{fmtMoney(t.total)}</span>
              <div className={`${COLS_607[7].cls}`}>
                <span className="flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 size={11} />OK</span>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-slate-100 px-4 py-2 flex justify-between bg-slate-50">
          <span className="text-xs text-slate-400">{visible.length} registro{visible.length !== 1 ? 's' : ''}</span>
          <span className="text-sm font-bold text-slate-800 tabular-nums">{fmtMoney(visible.reduce((s,t)=>s+t.total,0))}</span>
        </div>
      </div>

      {/* Bottom 3 panels */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-3">Resumen 607</p>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Total registros</span><span className="font-medium text-slate-700">{txns.length}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Facturas c/NCF</span><span className="text-slate-700">{txns.filter(t=>t.tipo==='Factura').length}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Gastos varios</span><span className="text-slate-700">{txns.filter(t=>t.tipo!=='Factura').length}</span></div>
            <div className="flex justify-between border-t border-slate-100 pt-1.5 mt-1">
              <span className="text-slate-600 font-medium">ITBIS a reclamar</span>
              <span className="font-bold text-emerald-700">{fmtMoney(totalItbis)}</span>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-3">Enviar a DGII</p>
          <SubmitBox onGenerate={generateTXT} onSend={() => showToast('607 enviado a DGII exitosamente')} onXML={() => showToast('XML 607 descargado')} />
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-3">Historial envíos</p>
          <div className="space-y-2">
            {HIST_607.map((h, i) => (
              <div key={i} className="flex items-center gap-2 py-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-700 truncate">{h.period}</p>
                  <p className="text-[10px] text-slate-400">{h.records} registros · ITBIS a reclamar {fmtMoney(h.itbisRec)}</p>
                </div>
                <span className="text-[10px] text-slate-400">{h.date}</span>
              </div>
            ))}
          </div>
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
            Reporte 606
          </button>
          <button onClick={() => setScreen('607')}
            className={`flex items-center gap-1.5 px-5 py-2 font-medium transition ${screen === '607' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
            <ShoppingCart size={14} />
            Reporte 607
          </button>
        </div>
        <div className="ml-auto">
          <span className="text-xs text-slate-400">
            {screen === '606' ? 'Ventas / Comprobantes emitidos' : 'Compras / Gastos recibidos'}
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
