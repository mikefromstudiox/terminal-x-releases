import { useState, useMemo, useRef } from 'react'
import {
  FileMinus, Search, Plus, Printer, Lock,
  CheckCircle2, ExternalLink, RotateCcw, AlertCircle,
  Tag, Scissors, X, ChevronDown,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'

// ── Constants ────────────────────────────────────────────────────────────────
const MANAGER_PIN   = '1111'
const ITBIS_RATE    = 0.18
const LEY_RATE      = 0.10

// NCF B04 sequence stub — real impl pulls from Settings
let _b04Seq = 41
function nextB04() { return `B04${String(++_b04Seq).padStart(8, '0')}` }

const MOTIVOS = ['Devolución', 'Descuento', 'Error']
const FORMAS  = ['Efectivo', 'Crédito en cuenta', 'Transferencia']

const MOTIVO_META = {
  'Devolución': { icon: RotateCcw, badge: 'bg-blue-100 text-blue-700',   tab: 'devoluciones' },
  'Descuento':  { icon: Tag,       badge: 'bg-violet-100 text-violet-700', tab: 'descuentos'  },
  'Error':      { icon: Scissors,  badge: 'bg-red-100 text-red-700',       tab: 'errores'     },
}

// ── Demo original invoices (for lookup) ──────────────────────────────────────
const ORIG_INVOICES = {
  'F-2024-0081': { client: 'Grupo Mejía S.R.L.',    rnc: '130-12345-6', subtotal: 3500, total: 4480, ncf: 'B01000000081', services: ['Lavado Completo', 'Cera Premium'] },
  'F-2024-0074': { client: 'Importadora Del Norte', rnc: '101-98765-4', subtotal: 1500, total: 1920, ncf: 'B01000000074', services: ['Lavado Básico'] },
  'F-2024-0063': { client: 'Ferretería El Clavo',   rnc: '130-55512-1', subtotal: 2200, total: 2816, ncf: 'B01000000063', services: ['Lavado Completo', 'Aspirado'] },
  'F-2024-0052': { client: 'Mueblería Don Pedro',   rnc: '130-77230-8', subtotal: 800,  total: 1024, ncf: 'B02000000052', services: ['Lavado Básico'] },
  'F-2024-0041': { client: 'Seguros Caribe',        rnc: '101-44321-9', subtotal: 4500, total: 5760, ncf: 'B01000000041', services: ['Detailing Completo', 'Cera Premium', 'Ozono'] },
}

// ── Demo credit notes ────────────────────────────────────────────────────────
let _nid = 0
function mn(ncf, factOrig, motivo, monto, fecha, estado = 'emitida') {
  const inv = ORIG_INVOICES[factOrig] || {}
  return {
    id:       ++_nid,
    ncf,
    factOrig,
    client:   inv.client ?? 'Cliente',
    rnc:      inv.rnc ?? '',
    motivo,
    monto,
    fecha:    new Date(fecha),
    estado,
    itbisRev: parseFloat((monto * ITBIS_RATE / (1 + ITBIS_RATE)).toFixed(2)),
    forma:    'Crédito en cuenta',
    comentario: '',
  }
}

const INIT_NOTES = [
  mn('B04000000032', 'F-2024-0081', 'Devolución', 1120, '2026-03-15'),
  mn('B04000000031', 'F-2024-0074', 'Error',       960,  '2026-03-12'),
  mn('B04000000030', 'F-2024-0063', 'Descuento',   400,  '2026-03-10'),
  mn('B04000000029', 'F-2024-0052', 'Devolución',  512,  '2026-03-08'),
  mn('B04000000028', 'F-2024-0041', 'Error',      1440,  '2026-03-05'),
  mn('B04000000027', 'F-2024-0041', 'Descuento',   288,  '2026-03-01'),
]

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n) {
  return 'RD$' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(d) {
  return d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ── COLS ──────────────────────────────────────────────────────────────────────
const COLS = [
  { key: 'ncf',      label: '# Nota',           cls: 'w-36'            },
  { key: 'client',   label: 'Cliente',           cls: 'flex-1 min-w-0'  },
  { key: 'factOrig', label: 'Factura original',  cls: 'w-36'            },
  { key: 'fecha',    label: 'Fecha',             cls: 'w-28'            },
  { key: 'monto',    label: 'Monto',             cls: 'w-32 text-right' },
  { key: 'itbis',    label: 'ITBIS rev.',        cls: 'w-28 text-right' },
  { key: 'motivo',   label: 'Motivo',            cls: 'w-28'            },
  { key: 'estado',   label: 'Estado',            cls: 'w-24'            },
]

const TABS = [
  { key: 'todas',       label: 'Todas',       fn: () => true                          },
  { key: 'devoluciones',label: 'Devoluciones',fn: n => n.motivo === 'Devolución'      },
  { key: 'descuentos',  label: 'Descuentos',  fn: n => n.motivo === 'Descuento'       },
  { key: 'errores',     label: 'Errores',     fn: n => n.motivo === 'Error'           },
]

// ── Sub-components ────────────────────────────────────────────────────────────
function MetricCard({ label, value, sub, color = 'slate', icon: Icon }) {
  const ring = { slate: 'border-slate-100 bg-white', red: 'border-red-200 bg-red-50', blue: 'border-blue-200 bg-blue-50', violet: 'border-violet-200 bg-violet-50' }
  const val  = { slate: 'text-slate-800', red: 'text-red-600', blue: 'text-blue-700', violet: 'text-violet-700' }
  return (
    <div className={`rounded-2xl border p-4 flex-1 ${ring[color]}`}>
      <div className="flex items-start justify-between mb-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
        {Icon && <Icon size={14} className={val[color]} />}
      </div>
      <p className={`text-2xl font-bold tabular-nums ${val[color]}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function MotivoBadge({ motivo }) {
  const m   = MOTIVO_META[motivo] || {}
  const Icon = m.icon ?? Tag
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${m.badge}`}>
      <Icon size={10} />
      {motivo}
    </span>
  )
}

// ── PIN Modal ─────────────────────────────────────────────────────────────────
function PinModal({ onConfirm, onClose }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState(false)
  function submit() {
    if (pin === MANAGER_PIN) onConfirm()
    else { setErr(true); setPin('') }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-80">
        <div className="flex items-center gap-2 mb-1">
          <Lock size={16} className="text-slate-500" />
          <h3 className="font-semibold text-slate-800">Autorización requerida</h3>
        </div>
        <p className="text-sm text-slate-500 mb-4">Ingrese PIN del gerente para emitir la nota de crédito.</p>
        <input
          autoFocus
          type="password"
          maxLength={4}
          value={pin}
          onChange={e => { setPin(e.target.value); setErr(false) }}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder="••••"
          className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-center text-xl tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {err && <p className="text-xs text-red-500 mt-1 text-center">PIN incorrecto</p>}
        <div className="flex gap-3 mt-5">
          <button onClick={onClose}  className="flex-1 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button onClick={submit}   className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">Confirmar</button>
        </div>
      </div>
    </div>
  )
}

// ── Invoice Detail Popover ────────────────────────────────────────────────────
function InvoicePopover({ factNo, onClose }) {
  const inv = ORIG_INVOICES[factNo]
  if (!inv) return null
  return (
    <div className="absolute z-30 top-8 left-0 w-72 bg-white rounded-xl shadow-2xl border border-slate-100 p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-slate-800">{factNo}</p>
        <button onClick={onClose} className="p-0.5 rounded hover:bg-slate-100"><X size={14} className="text-slate-400" /></button>
      </div>
      <p className="text-xs text-slate-500 mb-1">NCF: <span className="font-medium text-slate-700">{inv.ncf}</span></p>
      <p className="text-xs text-slate-500 mb-1">Cliente: <span className="font-medium text-slate-700">{inv.client}</span></p>
      <p className="text-xs text-slate-500 mb-2">RNC: <span className="font-medium text-slate-700">{inv.rnc}</span></p>
      <div className="border-t border-slate-100 pt-2 space-y-0.5">
        {inv.services.map((s, i) => (
          <p key={i} className="text-xs text-slate-600">· {s}</p>
        ))}
      </div>
      <div className="border-t border-slate-100 mt-2 pt-2 flex justify-between">
        <span className="text-xs text-slate-500">Total factura</span>
        <span className="text-sm font-bold text-slate-800">{fmt(inv.total)}</span>
      </div>
    </div>
  )
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ msg }) {
  return (
    <div
      className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white text-sm px-5 py-3 rounded-full shadow-lg flex items-center gap-2"
      style={{ animation: 'fadeOut 2.8s forwards' }}
    >
      <CheckCircle2 size={15} className="text-emerald-400" />
      {msg}
      <style>{`@keyframes fadeOut{0%,70%{opacity:1}100%{opacity:0}}`}</style>
    </div>
  )
}

// ── RNC Lookup stub ───────────────────────────────────────────────────────────
function useRncLookup() {
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState(null)
  async function lookup(rnc) {
    if (!rnc || rnc.length < 9) { setResult(null); return }
    setLoading(true)
    await new Promise(r => setTimeout(r, 700))
    // Demo: deterministic name from RNC digits
    const names = ['Grupo Comercial S.R.L.', 'Importadora Del Norte', 'Inversiones Caribe', 'Distribuidora Central', 'Servicios Integrados']
    const idx = parseInt(rnc.replace(/-/g, '').slice(-1)) % names.length
    setResult({ name: names[idx], rnc })
    setLoading(false)
  }
  return { lookup, loading, result, clear: () => setResult(null) }
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function CreditNotes() {
  const { user } = useAuth()
  const isCashier = user?.role === 'cashier'

  const [notes, setNotes]       = useState(INIT_NOTES)
  const [tab, setTab]           = useState('todas')
  const [search, setSearch]     = useState('')
  const [selected, setSelected] = useState(null)
  const [showPin, setShowPin]   = useState(false)
  const [toast, setToast]       = useState(null)
  const [popover, setPopover]   = useState(null)  // factNo string

  // Form state
  const [clientName, setClientName] = useState('')
  const [clientRNC,  setClientRNC]  = useState('')
  const [factNo,     setFactNo]     = useState('')
  const [motivo,     setMotivo]     = useState('Devolución')
  const [monto,      setMonto]      = useState('')
  const [forma,      setForma]      = useState('Efectivo')
  const [comentario, setComentario] = useState('')
  const [factLookup, setFactLookup] = useState(null)   // loaded invoice
  const [factLoading,setFactLoading]= useState(false)
  const pendingEmit                 = useRef(null)

  const rnc = useRncLookup()

  // ── Derived metrics ─────────────────────────────────────────────────────
  const totalDevuelto = notes.reduce((s, n) => s + n.monto, 0)
  const totalDevol    = notes.filter(n => n.motivo === 'Devolución').reduce((s, n) => s + n.monto, 0)
  const totalOther    = notes.filter(n => n.motivo !== 'Devolución').reduce((s, n) => s + n.monto, 0)

  // ── Filter ──────────────────────────────────────────────────────────────
  const tabFn    = TABS.find(t => t.key === tab)?.fn ?? (() => true)
  const tabCounts = useMemo(() => {
    const o = {}
    TABS.forEach(t => { o[t.key] = notes.filter(t.fn).length })
    return o
  }, [notes])

  const q = search.trim().toLowerCase()
  const visible = notes
    .filter(tabFn)
    .filter(n => !q || n.client.toLowerCase().includes(q) || n.ncf.toLowerCase().includes(q) || n.factOrig.toLowerCase().includes(q))

  // ── Fact lookup ──────────────────────────────────────────────────────────
  async function handleFactBlur() {
    const key = factNo.trim().toUpperCase()
    if (!key) { setFactLookup(null); return }
    setFactLoading(true)
    await new Promise(r => setTimeout(r, 500))
    const inv = ORIG_INVOICES[key] ?? null
    setFactLookup(inv ? { ...inv, key } : null)
    if (inv) {
      setClientName(inv.client)
      setClientRNC(inv.rnc)
    }
    setFactLoading(false)
  }

  // ── Derived form calc ────────────────────────────────────────────────────
  const montoNum   = parseFloat(monto) || 0
  const itbisRev   = parseFloat((montoNum * ITBIS_RATE / (1 + ITBIS_RATE + LEY_RATE)).toFixed(2))
  const nextNCF    = `B04${String(_b04Seq + 1).padStart(8, '0')}`
  const formValid  = clientName.trim() && montoNum > 0

  // ── Emit ─────────────────────────────────────────────────────────────────
  function tryEmit() {
    if (!formValid) return
    if (isCashier) {
      pendingEmit.current = doEmit
      setShowPin(true)
    } else {
      doEmit()
    }
  }
  function doEmit() {
    const ncf = nextB04()
    const note = {
      id:         Date.now(),
      ncf,
      factOrig:   factNo.trim().toUpperCase() || '—',
      client:     clientName.trim(),
      rnc:        clientRNC.trim(),
      motivo,
      monto:      montoNum,
      fecha:      new Date(),
      estado:     'emitida',
      itbisRev,
      forma,
      comentario: comentario.trim(),
    }
    setNotes(prev => [note, ...prev])
    // reset form
    setClientName(''); setClientRNC(''); setFactNo(''); setMonto(''); setComentario('')
    setFactLookup(null); rnc.clear()
    showToast(`Nota de crédito ${ncf} emitida`)
  }
  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  return (
    <div className="h-full flex flex-col bg-slate-50 overflow-hidden">
      {showPin && (
        <PinModal
          onConfirm={() => { setShowPin(false); pendingEmit.current?.() }}
          onClose={() => setShowPin(false)}
        />
      )}
      {toast && <Toast msg={toast} />}

      {/* ── Header ── */}
      <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <FileMinus size={20} className="text-slate-500" />
          <h1 className="text-lg font-semibold text-slate-800">Notas de Crédito</h1>
          <span className="text-xs text-slate-400 ml-1">Secuencia B04</span>
        </div>
        <button
          onClick={() => document.getElementById('nc-form')?.scrollIntoView({ behavior: 'smooth' })}
          className="flex items-center gap-1.5 text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700"
        >
          <Plus size={14} />
          Nueva nota
        </button>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-4 p-4">

        {/* ── Summary bar ── */}
        <div className="flex gap-3">
          <MetricCard label="Total notas emitidas" value={notes.length}        sub="en todos los períodos"           icon={FileMinus}   />
          <MetricCard label="Total devuelto"        value={fmt(totalDevuelto)}  sub="suma de todas las notas"        color="red"  icon={AlertCircle} />
          <MetricCard label="Por devolución"        value={fmt(totalDevol)}     sub={`${notes.filter(n=>n.motivo==='Devolución').length} notas`} color="blue"   icon={RotateCcw} />
          <MetricCard label="Por error / descuento" value={fmt(totalOther)}     sub={`${notes.filter(n=>n.motivo!=='Devolución').length} notas`} color="violet" icon={Tag}       />
        </div>

        {/* ── Filter bar ── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm flex flex-col overflow-hidden">
          <div className="flex items-center gap-1 px-4 pt-3 border-b border-slate-100">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t border-b-2 -mb-px transition ${
                  tab === t.key ? 'text-blue-600 border-blue-500' : 'text-slate-500 border-transparent hover:text-slate-700'
                }`}
              >
                {t.label}
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tab === t.key ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                  {tabCounts[t.key]}
                </span>
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2 pb-2">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Cliente o # nota…"
                  className="pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 w-48"
                />
              </div>
            </div>
          </div>

          {/* Table header */}
          <div className="flex items-center px-4 py-2 bg-slate-50 border-b border-slate-100">
            {COLS.map(c => (
              <span key={c.key} className={`text-[10px] font-semibold uppercase tracking-wider text-slate-400 ${c.cls}`}>
                {c.label}
              </span>
            ))}
            <span className="w-10" />
          </div>

          {/* Rows */}
          <div className="divide-y divide-slate-50">
            {visible.length === 0 && (
              <div className="py-12 text-center text-sm text-slate-400">No hay notas en esta categoría.</div>
            )}
            {visible.map(n => (
              <div
                key={n.id}
                onClick={() => setSelected(s => s?.id === n.id ? null : n)}
                className={`flex items-center px-4 h-12 cursor-pointer transition ${
                  selected?.id === n.id ? 'bg-blue-50 border-l-2 border-blue-500' : 'hover:bg-slate-50'
                }`}
              >
                {/* NCF */}
                <span className={`${COLS[0].cls} text-xs font-mono text-slate-700`}>{n.ncf}</span>

                {/* Cliente */}
                <div className={`${COLS[1].cls} min-w-0 overflow-hidden pr-3`}>
                  <p className="text-sm text-slate-800 truncate">{n.client}</p>
                  {n.rnc && <p className="text-[10px] text-slate-400 truncate">{n.rnc}</p>}
                </div>

                {/* Factura original */}
                <div className={`${COLS[2].cls} relative`}>
                  <button
                    onClick={e => { e.stopPropagation(); setPopover(v => v === n.factOrig ? null : n.factOrig) }}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
                  >
                    {n.factOrig}
                    <ExternalLink size={10} />
                  </button>
                  {popover === n.factOrig && (
                    <InvoicePopover factNo={n.factOrig} onClose={() => setPopover(null)} />
                  )}
                </div>

                {/* Fecha */}
                <span className={`${COLS[3].cls} text-xs text-slate-500`}>{fmtDate(n.fecha)}</span>

                {/* Monto */}
                <span className={`${COLS[4].cls} text-sm font-semibold tabular-nums text-red-600`}>
                  − {fmt(n.monto)}
                </span>

                {/* ITBIS rev */}
                <span className={`${COLS[5].cls} text-xs tabular-nums text-slate-500`}>
                  − {fmt(n.itbisRev)}
                </span>

                {/* Motivo */}
                <div className={`${COLS[6].cls}`}>
                  <MotivoBadge motivo={n.motivo} />
                </div>

                {/* Estado */}
                <div className={`${COLS[7].cls}`}>
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                    <CheckCircle2 size={12} />
                    {n.estado}
                  </span>
                </div>

                {/* Chevron */}
                <div className="w-10 flex justify-end">
                  <ChevronDown size={14} className={`text-slate-300 transition ${selected?.id === n.id ? 'rotate-180' : ''}`} />
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="border-t border-slate-100 px-4 py-2 flex justify-between items-center bg-slate-50">
            <span className="text-xs text-slate-400">{visible.length} nota{visible.length !== 1 ? 's' : ''}</span>
            <span className="text-sm font-bold text-red-600 tabular-nums">
              − {fmt(visible.reduce((s, n) => s + n.monto, 0))}
            </span>
          </div>
        </div>

        {/* ── Bottom action bar (row selected) ── */}
        {selected && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-3 flex items-center gap-3">
            <span className="text-sm text-slate-600">
              Nota <span className="font-mono font-semibold">{selected.ncf}</span> — {selected.client}
            </span>
            <div className="flex-1" />
            <button className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">
              <Printer size={15} />
              Imprimir nota
            </button>
          </div>
        )}

        {/* ── Entry form ── */}
        <div id="nc-form" className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Nueva nota de crédito</p>
            {isCashier && (
              <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
                <Lock size={12} />
                Requiere PIN de gerente
              </span>
            )}
          </div>

          {/* Row 1 — Client + Invoice lookup */}
          <div className="flex gap-3 mb-3 flex-wrap">
            {/* RNC */}
            <div className="w-44">
              <label className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 block">RNC cliente</label>
              <div className="relative">
                <input
                  value={clientRNC}
                  onChange={e => { setClientRNC(e.target.value); rnc.lookup(e.target.value) }}
                  placeholder="000-00000-0"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                {rnc.loading && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 animate-pulse">buscando…</span>
                )}
              </div>
              {rnc.result && (
                <p className="text-[10px] text-emerald-600 mt-0.5 truncate">✓ {rnc.result.name}</p>
              )}
            </div>

            {/* Client name */}
            <div className="flex-1 min-w-[180px]">
              <label className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 block">Nombre / empresa</label>
              <input
                value={clientName}
                onChange={e => setClientName(e.target.value)}
                placeholder="Nombre del cliente…"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            {/* Factura original */}
            <div className="w-48">
              <label className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 block">Factura original</label>
              <div className="relative">
                <input
                  value={factNo}
                  onChange={e => { setFactNo(e.target.value); setFactLookup(null) }}
                  onBlur={handleFactBlur}
                  placeholder="F-2024-0081"
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                    factLookup ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200'
                  }`}
                />
                {factLoading && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 animate-pulse">buscando…</span>
                )}
              </div>
              {factLookup && (
                <p className="text-[10px] text-emerald-600 mt-0.5 truncate">✓ {factLookup.client} · {fmt(factLookup.total)}</p>
              )}
              {factNo && !factLookup && !factLoading && (
                <p className="text-[10px] text-slate-400 mt-0.5">Factura no encontrada en demo</p>
              )}
            </div>
          </div>

          {/* Loaded invoice details */}
          {factLookup && (
            <div className="mb-3 rounded-xl bg-slate-50 border border-slate-200 p-3 flex gap-6 flex-wrap">
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">NCF original</p>
                <p className="text-xs font-mono font-medium text-slate-700">{factLookup.ncf}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">Servicios</p>
                <p className="text-xs text-slate-700">{factLookup.services.join(', ')}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">Subtotal</p>
                <p className="text-xs font-medium text-slate-700">{fmt(factLookup.subtotal)}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">Total facturado</p>
                <p className="text-sm font-bold text-slate-800">{fmt(factLookup.total)}</p>
              </div>
            </div>
          )}

          {/* Row 2 — Motivo + Monto + Forma */}
          <div className="flex gap-3 mb-3 flex-wrap items-end">
            {/* Motivo */}
            <div>
              <label className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 block">Motivo</label>
              <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
                {MOTIVOS.map(m => {
                  const meta = MOTIVO_META[m]
                  const Icon = meta.icon
                  return (
                    <button
                      key={m}
                      onClick={() => setMotivo(m)}
                      className={`flex items-center gap-1.5 px-3 py-2 font-medium transition ${
                        motivo === m ? `${meta.badge} border-0` : 'text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      <Icon size={12} />
                      {m}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Monto */}
            <div className="w-36">
              <label className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 block">Monto a devolver</label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">RD$</span>
                <input
                  type="number"
                  min="0"
                  value={monto}
                  onChange={e => setMonto(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            </div>

            {/* Forma devolución */}
            <div className="w-48">
              <label className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 block">Forma de devolución</label>
              <div className="relative">
                <select
                  value={forma}
                  onChange={e => setForma(e.target.value)}
                  className="w-full appearance-none border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white pr-8"
                >
                  {FORMAS.map(f => <option key={f}>{f}</option>)}
                </select>
                <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            </div>

            {/* Comentario */}
            <div className="flex-1 min-w-[180px]">
              <label className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 block">Comentario (opcional)</label>
              <input
                value={comentario}
                onChange={e => setComentario(e.target.value)}
                placeholder="Observaciones…"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            {/* Emit button */}
            <button
              onClick={tryEmit}
              disabled={!formValid}
              className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap self-end"
            >
              {isCashier && <Lock size={13} />}
              Emitir nota de crédito
            </button>
          </div>

          {/* Live calc strip */}
          <div className={`rounded-xl border px-4 py-3 flex items-center gap-6 flex-wrap text-sm transition ${
            montoNum > 0 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-100'
          }`}>
            {/* Factura original total */}
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Factura original</p>
              <p className="font-semibold text-slate-700 tabular-nums">
                {factLookup ? fmt(factLookup.total) : <span className="text-slate-300">—</span>}
              </p>
            </div>
            <span className="text-slate-300 text-lg">→</span>
            {/* Monto nota */}
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Monto nota</p>
              <p className={`font-bold tabular-nums ${montoNum > 0 ? 'text-red-600' : 'text-slate-300'}`}>
                {montoNum > 0 ? `− ${fmt(montoNum)}` : '—'}
              </p>
            </div>
            <span className="text-slate-300 text-lg">→</span>
            {/* ITBIS a revertir */}
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">ITBIS a revertir</p>
              <p className={`font-semibold tabular-nums ${montoNum > 0 ? 'text-red-500' : 'text-slate-300'}`}>
                {montoNum > 0 ? `− ${fmt(itbisRev)}` : '—'}
              </p>
            </div>
            <span className="text-slate-300 text-lg">→</span>
            {/* NCF asignado */}
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">NCF a asignar</p>
              <p className="font-mono font-semibold text-slate-700">{nextNCF}</p>
            </div>
            {/* Forma */}
            {montoNum > 0 && (
              <>
                <span className="text-slate-300 text-lg">→</span>
                <div>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Vía</p>
                  <p className="font-medium text-slate-700">{forma}</p>
                </div>
              </>
            )}
            {/* Warning if over invoice total */}
            {factLookup && montoNum > factLookup.total && (
              <span className="ml-auto flex items-center gap-1 text-xs text-red-500 bg-red-100 px-3 py-1 rounded-full">
                <AlertCircle size={12} />
                Monto excede factura original
              </span>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
