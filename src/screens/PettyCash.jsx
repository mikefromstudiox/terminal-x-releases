import { useState, useMemo } from 'react'
import {
  PiggyBank, CheckCircle2, XCircle, Clock, AlertTriangle,
  Send, RefreshCw, History, X, Receipt, Wallet, TrendingDown,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'

// ── Constants ────────────────────────────────────────────────────────────────
const FONDO_TOTAL  = 15000
const CATEGORIAS   = ['Transporte', 'Limpieza', 'Alimentación', 'Mantenimiento', 'Oficina', 'Otros']
const MANAGER_PIN  = '1111'

const TIPO_META = {
  Gasto:   { label: 'Gasto',   bg: 'bg-amber-50',   border: 'border-amber-100',  badge: 'bg-amber-100 text-amber-700'   },
  Compra:  { label: 'Compra',  bg: 'bg-emerald-50',  border: 'border-emerald-100', badge: 'bg-emerald-100 text-emerald-700' },
}
const ESTADO_META = {
  aprobado:  { label: 'Aprobado',  icon: CheckCircle2,   cls: 'text-emerald-600' },
  pendiente: { label: 'Pendiente', icon: Clock,           cls: 'text-amber-500'  },
  rechazado: { label: 'Rechazado', icon: XCircle,         cls: 'text-red-500'    },
}

// ── Demo data ────────────────────────────────────────────────────────────────
let _id = 100
function mk(desc, cat, tipo, monto, recibo, daysAgo, estado = 'aprobado') {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return { id: _id++, desc, cat, tipo, monto, recibo, fecha: d, estado }
}

const INIT_TXNS = [
  mk('Gasolina delivery', 'Transporte',    'Gasto',  850,  'F-2201', 0,  'aprobado'),
  mk('Cloro y escobas',   'Limpieza',      'Compra', 1240, 'F-1182', 1,  'aprobado'),
  mk('Almuerzo técnico',  'Alimentación',  'Gasto',  600,  '',       1,  'aprobado'),
  mk('Bombillo LED x4',   'Mantenimiento', 'Compra', 480,  'F-0940', 2,  'aprobado'),
  mk('Papel bond A4',     'Oficina',       'Compra', 320,  'F-0887', 3,  'aprobado'),
  mk('Taxi repuesto',     'Transporte',    'Gasto',  400,  '',       4,  'aprobado'),
  mk('Detergente',        'Limpieza',      'Compra', 760,  'F-0731', 5,  'aprobado'),
  mk('Cena reunión',      'Alimentación',  'Gasto',  1800, '',       6,  'pendiente'),
  mk('Cable corriente',   'Mantenimiento', 'Compra', 950,  'F-0612', 7,  'pendiente'),
  mk('Varios oficina',    'Oficina',       'Gasto',  270,  '',       8,  'rechazado'),
]

// ── Past reconciliations ─────────────────────────────────────────────────────
const PAST_RECON = [
  { date: '2026-02-28', fondo: 15000, gastado: 12840, restante: 2160, aprobador: 'Carlos Gerente' },
  { date: '2026-01-31', fondo: 15000, gastado: 11520, restante: 3480, aprobador: 'Carlos Gerente' },
  { date: '2025-12-31', fondo: 15000, gastado: 14100, restante:  900, aprobador: 'Carlos Gerente' },
]

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n) {
  return 'RD$' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(d) {
  return d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ── Sub-components ───────────────────────────────────────────────────────────
function MetricCard({ label, value, sub, color = 'slate', icon: Icon }) {
  const colors = {
    slate:   'bg-white border-slate-100',
    green:   'bg-emerald-50 border-emerald-200',
    red:     'bg-red-50 border-red-200',
    amber:   'bg-amber-50 border-amber-200',
  }
  const valColors = {
    slate: 'text-slate-800',
    green: 'text-emerald-700',
    red:   'text-red-600',
    amber: 'text-amber-600',
  }
  return (
    <div className={`rounded-2xl border p-4 flex-1 ${colors[color]}`}>
      <div className="flex items-start justify-between mb-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
        {Icon && <Icon size={15} className={valColors[color]} />}
      </div>
      <p className={`text-2xl font-bold tabular-nums ${valColors[color]}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function TypeBadge({ tipo }) {
  const m = TIPO_META[tipo] || {}
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${m.badge}`}>{m.label}</span>
  )
}

function EstadoBadge({ estado }) {
  const m = ESTADO_META[estado] || ESTADO_META.pendiente
  const Icon = m.icon
  return (
    <span className={`flex items-center gap-1 text-xs ${m.cls}`}>
      <Icon size={12} />
      {m.label}
    </span>
  )
}

// ── PIN Confirm Modal ─────────────────────────────────────────────────────────
function PinModal({ title, onConfirm, onClose }) {
  const [pin, setPin]   = useState('')
  const [err, setErr]   = useState(false)
  function submit() {
    if (pin === MANAGER_PIN) onConfirm()
    else { setErr(true); setPin('') }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-80">
        <h3 className="font-semibold text-slate-800 mb-1">{title}</h3>
        <p className="text-sm text-slate-500 mb-4">PIN del gerente para continuar.</p>
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
          <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button onClick={submit}  className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">Confirmar</button>
        </div>
      </div>
    </div>
  )
}

// ── History Panel ─────────────────────────────────────────────────────────────
function HistoryPanel({ onClose }) {
  return (
    <div className="fixed inset-y-0 right-0 z-40 w-[420px] bg-white shadow-2xl flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <h3 className="font-semibold text-slate-800">Historial de Cuadres</h3>
        <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X size={18} className="text-slate-500" /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {PAST_RECON.map((r, i) => (
          <div key={i} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
            <div className="flex justify-between items-center mb-2">
              <span className="font-medium text-sm text-slate-800">{r.date}</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${r.restante > 2000 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                Restante {fmt(r.restante)}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1 text-xs text-slate-500">
              <span>Fondo: <span className="text-slate-700 font-medium">{fmt(r.fondo)}</span></span>
              <span>Gastado: <span className="text-red-600 font-medium">{fmt(r.gastado)}</span></span>
              <span className="col-span-2">Aprobado por: {r.aprobador}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Notify Toast ──────────────────────────────────────────────────────────────
function Toast({ msg, onDone }) {
  return (
    <div
      className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white text-sm px-5 py-3 rounded-full shadow-lg flex items-center gap-2"
      onAnimationEnd={onDone}
      style={{ animation: 'fadeOut 2.8s forwards' }}
    >
      <CheckCircle2 size={15} className="text-emerald-400" />
      {msg}
      <style>{`@keyframes fadeOut{0%,70%{opacity:1}100%{opacity:0}}`}</style>
    </div>
  )
}

// ── COLS definition ───────────────────────────────────────────────────────────
const COLS = [
  { key: '#',     label: '#',           cls: 'w-10 text-center' },
  { key: 'desc',  label: 'Descripción', cls: 'flex-1 min-w-0'   },
  { key: 'cat',   label: 'Categoría',   cls: 'w-32'             },
  { key: 'fecha', label: 'Fecha',       cls: 'w-28'             },
  { key: 'monto', label: 'Monto',       cls: 'w-28 text-right'  },
  { key: 'tipo',  label: 'Tipo',        cls: 'w-24 text-center' },
  { key: 'estado',label: 'Estado',      cls: 'w-28'             },
  { key: 'accion',label: '',            cls: 'w-36'             },
]

const TABS = [
  { key: 'todos',     label: 'Todos',     fn: () => true                         },
  { key: 'gastos',    label: 'Gastos',    fn: t => t.tipo === 'Gasto'            },
  { key: 'compras',   label: 'Compras',   fn: t => t.tipo === 'Compra'           },
  { key: 'pendientes',label: 'Pendientes',fn: t => t.estado === 'pendiente'      },
]

// ── Main Component ────────────────────────────────────────────────────────────
export default function PettyCash() {
  const { user } = useAuth()
  const canApprove = ['owner', 'manager'].includes(user?.role)

  const [txns, setTxns]             = useState(INIT_TXNS)
  const [tab, setTab]               = useState('todos')
  const [showHistory, setShowHistory] = useState(false)
  const [toast, setToast]           = useState(null)
  const [pinAction, setPinAction]   = useState(null) // { label, callback }

  // Entry form state
  const [desc, setDesc]       = useState('')
  const [cat, setCat]         = useState('Transporte')
  const [tipo, setTipo]       = useState('Gasto')
  const [monto, setMonto]     = useState('')
  const [recibo, setRecibo]   = useState('')

  // ── Derived metrics ─────────────────────────────────────────────────────
  const approved   = txns.filter(t => t.estado === 'aprobado')
  const pending    = txns.filter(t => t.estado === 'pendiente')
  const gastado    = approved.reduce((s, t) => s + t.monto, 0)
  const disponible = FONDO_TOTAL - gastado
  const pendAmt    = pending.reduce((s, t) => s + t.monto, 0)

  const montoNum   = parseFloat(monto) || 0
  const restante   = disponible - montoNum

  // ── Filtered rows ───────────────────────────────────────────────────────
  const tabFn     = TABS.find(t => t.key === tab)?.fn ?? (() => true)
  const tabCounts = useMemo(() => {
    const obj = {}
    TABS.forEach(t => { obj[t.key] = txns.filter(t.fn).length })
    return obj
  }, [txns])
  const visible   = txns.filter(tabFn)

  // ── Actions ─────────────────────────────────────────────────────────────
  function doApprove(id) {
    setTxns(prev => prev.map(t => t.id === id ? { ...t, estado: 'aprobado' } : t))
    showToast('Gasto aprobado')
  }
  function doReject(id) {
    setTxns(prev => prev.map(t => t.id === id ? { ...t, estado: 'rechazado' } : t))
    showToast('Gasto rechazado')
  }
  function requirePin(label, cb) {
    if (canApprove) { cb() }
    else { setPinAction({ label, callback: cb }) }
  }
  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  function handleGuardar() {
    if (!desc.trim() || montoNum <= 0) return
    const d = new Date()
    const next = {
      id: Date.now(),
      desc: desc.trim(),
      cat,
      tipo,
      monto: montoNum,
      recibo: recibo.trim(),
      fecha: d,
      estado: canApprove ? 'aprobado' : 'pendiente',
    }
    setTxns(prev => [next, ...prev])
    setDesc(''); setMonto(''); setRecibo('')
    showToast(canApprove ? 'Gasto guardado y aprobado' : 'Gasto enviado para aprobación')
  }

  function handleSolicitar() {
    showToast('Solicitud de reposición enviada al gerente')
  }

  const formValid = desc.trim().length > 0 && montoNum > 0

  return (
    <div className="h-full flex flex-col bg-slate-50 overflow-hidden">
      {/* PIN modal */}
      {pinAction && (
        <PinModal
          title={pinAction.label}
          onConfirm={() => { pinAction.callback(); setPinAction(null) }}
          onClose={() => setPinAction(null)}
        />
      )}

      {/* History panel */}
      {showHistory && (
        <>
          <div className="fixed inset-0 z-30 bg-black/20" onClick={() => setShowHistory(false)} />
          <HistoryPanel onClose={() => setShowHistory(false)} />
        </>
      )}

      {/* Toast */}
      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}

      {/* ── Header ── */}
      <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <PiggyBank size={20} className="text-slate-500" />
          <h1 className="text-lg font-semibold text-slate-800">Caja Chica</h1>
          <span className="text-xs text-slate-400 ml-1">Fondo {fmt(FONDO_TOTAL)}</span>
        </div>
        <button
          onClick={() => setShowHistory(true)}
          className="flex items-center gap-1.5 text-sm text-slate-600 border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-50"
        >
          <History size={15} />
          Ver Cuadres
        </button>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-4 p-4">

        {/* ── Summary bar ── */}
        <div className="flex gap-3">
          <MetricCard
            label="Fondo Asignado"
            value={fmt(FONDO_TOTAL)}
            sub="fondo total del período"
            icon={Wallet}
          />
          <MetricCard
            label="Disponible"
            value={fmt(disponible)}
            sub={`${Math.round(disponible / FONDO_TOTAL * 100)}% restante`}
            color="green"
            icon={RefreshCw}
          />
          <MetricCard
            label="Gastado este mes"
            value={fmt(gastado)}
            sub={`${approved.length} transacciones aprobadas`}
            color="red"
            icon={TrendingDown}
          />
          <MetricCard
            label="Pendiente Aprobar"
            value={fmt(pendAmt)}
            sub={`${pending.length} transacciones`}
            color={pending.length > 0 ? 'amber' : 'slate'}
            icon={AlertTriangle}
          />
        </div>

        {/* ── Tabs + Table ── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm flex flex-col overflow-hidden">

          {/* Tab bar */}
          <div className="flex items-center gap-1 px-4 pt-3 border-b border-slate-100">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t transition border-b-2 -mb-px ${
                  tab === t.key
                    ? 'text-blue-600 border-blue-500'
                    : 'text-slate-500 border-transparent hover:text-slate-700'
                }`}
              >
                {t.label}
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  tab === t.key ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'
                }`}>
                  {tabCounts[t.key]}
                </span>
              </button>
            ))}
          </div>

          {/* Table header */}
          <div className="flex items-center px-4 py-2 bg-slate-50 border-b border-slate-100 flex-shrink-0">
            {COLS.map(c => (
              <span key={c.key} className={`text-[10px] font-semibold uppercase tracking-wider text-slate-400 ${c.cls}`}>
                {c.label}
              </span>
            ))}
          </div>

          {/* Table rows */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
            {visible.length === 0 && (
              <div className="py-12 text-center text-slate-400 text-sm">
                No hay transacciones en esta categoría.
              </div>
            )}
            {visible.map((t, idx) => {
              const tipeMeta = TIPO_META[t.tipo] || {}
              const rowBg = t.estado === 'rechazado'
                ? 'bg-slate-50/80'
                : tipeMeta.bg ?? ''

              return (
                <div
                  key={t.id}
                  className={`flex items-center px-4 h-12 gap-0 ${rowBg} ${t.estado === 'rechazado' ? 'opacity-50' : ''}`}
                >
                  {/* # */}
                  <span className={`${COLS[0].cls} text-xs text-slate-400 tabular-nums`}>{idx + 1}</span>

                  {/* Descripción */}
                  <div className={`${COLS[1].cls} flex items-center gap-2 min-w-0`}>
                    <span className={`text-sm text-slate-800 truncate ${t.estado === 'rechazado' ? 'line-through' : ''}`}>
                      {t.desc}
                    </span>
                    {t.recibo && (
                      <span className="flex items-center gap-0.5 text-[10px] text-slate-400 flex-shrink-0">
                        <Receipt size={10} />
                        {t.recibo}
                      </span>
                    )}
                  </div>

                  {/* Categoría */}
                  <span className={`${COLS[2].cls} text-xs text-slate-600`}>{t.cat}</span>

                  {/* Fecha */}
                  <span className={`${COLS[3].cls} text-xs text-slate-500`}>{fmtDate(t.fecha)}</span>

                  {/* Monto */}
                  <span className={`${COLS[4].cls} text-sm font-medium tabular-nums ${t.estado === 'rechazado' ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                    {fmt(t.monto)}
                  </span>

                  {/* Tipo badge */}
                  <div className={`${COLS[5].cls} flex justify-center`}>
                    <TypeBadge tipo={t.tipo} />
                  </div>

                  {/* Estado */}
                  <div className={`${COLS[6].cls}`}>
                    <EstadoBadge estado={t.estado} />
                  </div>

                  {/* Acciones */}
                  <div className={`${COLS[7].cls} flex items-center gap-1.5 justify-end`}>
                    {t.estado === 'pendiente' && canApprove && (
                      <>
                        <button
                          onClick={() => doApprove(t.id)}
                          className="flex items-center gap-1 text-xs text-emerald-600 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 px-2 py-1 rounded-lg"
                        >
                          <CheckCircle2 size={12} />
                          Aprobar
                        </button>
                        <button
                          onClick={() => doReject(t.id)}
                          className="flex items-center gap-1 text-xs text-red-500 border border-red-200 bg-red-50 hover:bg-red-100 px-2 py-1 rounded-lg"
                        >
                          <XCircle size={12} />
                          Rechazar
                        </button>
                      </>
                    )}
                    {t.estado === 'pendiente' && !canApprove && (
                      <span className="text-xs text-amber-500 italic">En revisión</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Table footer */}
          <div className="border-t border-slate-100 px-4 py-2 flex items-center justify-between bg-slate-50">
            <span className="text-xs text-slate-400">{visible.length} registro{visible.length !== 1 ? 's' : ''}</span>
            <span className="text-sm font-bold text-slate-700 tabular-nums">
              {fmt(visible.reduce((s, t) => s + (t.estado !== 'rechazado' ? t.monto : 0), 0))}
            </span>
          </div>
        </div>

        {/* ── Entry form ── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex-shrink-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-3">Registrar gasto</p>

          {/* Form row */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Descripción */}
            <input
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="Descripción del gasto…"
              className="flex-1 min-w-[180px] border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />

            {/* Categoría */}
            <select
              value={cat}
              onChange={e => setCat(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
            >
              {CATEGORIAS.map(c => <option key={c}>{c}</option>)}
            </select>

            {/* Tipo toggle */}
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
              {['Gasto', 'Compra'].map(t => (
                <button
                  key={t}
                  onClick={() => setTipo(t)}
                  className={`px-3 py-2 font-medium transition ${
                    tipo === t
                      ? t === 'Gasto'
                        ? 'bg-amber-500 text-white'
                        : 'bg-emerald-500 text-white'
                      : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Monto */}
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">RD$</span>
              <input
                type="number"
                min="0"
                value={monto}
                onChange={e => setMonto(e.target.value)}
                placeholder="0.00"
                className="w-32 pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            {/* Recibo */}
            <div className="relative">
              <Receipt size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={recibo}
                onChange={e => setRecibo(e.target.value)}
                placeholder="Recibo # (opc.)"
                className="w-36 pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            {/* Buttons */}
            <button
              onClick={handleGuardar}
              disabled={!formValid}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              Guardar gasto
            </button>
            <button
              onClick={handleSolicitar}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 whitespace-nowrap"
            >
              <Send size={14} />
              Solicitar fondos
            </button>
          </div>

          {/* Balance strip */}
          <div className={`mt-3 rounded-xl flex items-center gap-6 px-4 py-2.5 text-sm transition ${
            montoNum > 0
              ? restante < 0
                ? 'bg-red-50 border border-red-200'
                : 'bg-blue-50 border border-blue-200'
              : 'bg-slate-50 border border-slate-100'
          }`}>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500">Disponible</span>
              <span className="font-semibold tabular-nums text-slate-700">{fmt(disponible)}</span>
            </div>
            {montoNum > 0 && (
              <>
                <span className="text-slate-300">→</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-500">Este gasto</span>
                  <span className="font-semibold tabular-nums text-slate-700">− {fmt(montoNum)}</span>
                </div>
                <span className="text-slate-300">→</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-500">Restante</span>
                  <span className={`font-bold tabular-nums ${restante < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {fmt(restante)}
                  </span>
                  {restante < 0 && (
                    <span className="text-xs text-red-500 ml-1">⚠ Excede disponible</span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
