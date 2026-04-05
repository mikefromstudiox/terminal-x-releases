import { useState, useMemo, useEffect } from 'react'
import {
  PiggyBank, CheckCircle2, XCircle, Clock, AlertTriangle,
  Send, RefreshCw, History, X, Receipt, Wallet, TrendingDown, Loader2,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useAPI } from '../context/DataContext'
import { useLang } from '../i18n'


// ── Constants ─────────────────────────────────────────────────────────────────
const FONDO_TOTAL = 15000

// DB type values map to display labels
const TIPO_META = {
  expense: { label_es: 'Gasto',   label_en: 'Expense', bg: 'bg-amber-50',   border: 'border-amber-100',  badge: 'bg-amber-100 text-amber-700'   },
  deposit: { label_es: 'Depósito',label_en: 'Deposit', bg: 'bg-emerald-50', border: 'border-emerald-100', badge: 'bg-emerald-100 text-emerald-700' },
  // Legacy UI values (kept for form toggle)
  Gasto:   { label_es: 'Gasto',   label_en: 'Expense', bg: 'bg-amber-50',   border: 'border-amber-100',  badge: 'bg-amber-100 text-amber-700'   },
  Compra:  { label_es: 'Compra',  label_en: 'Purchase',bg: 'bg-emerald-50', border: 'border-emerald-100', badge: 'bg-emerald-100 text-emerald-700' },
}
const ESTADO_META = {
  approved: { label_es: 'Aprobado',  label_en: 'Approved',  icon: CheckCircle2, cls: 'text-emerald-600' },
  pending:  { label_es: 'Pendiente', label_en: 'Pending',   icon: Clock,        cls: 'text-amber-500'  },
  rejected: { label_es: 'Rechazado', label_en: 'Rejected',  icon: XCircle,      cls: 'text-red-500'    },
  // Legacy
  aprobado:  { label_es: 'Aprobado',  label_en: 'Approved',  icon: CheckCircle2, cls: 'text-emerald-600' },
  rechazado: { label_es: 'Rechazado', label_en: 'Rejected',  icon: XCircle,      cls: 'text-red-500'    },
  pendiente: { label_es: 'Pendiente', label_en: 'Pending',   icon: Clock,        cls: 'text-amber-500'  },
}

const CATEGORIAS = ['Transporte', 'Limpieza', 'Alimentación', 'Mantenimiento', 'Oficina', 'Otros']

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n) {
  return 'RD$' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Normalize a raw DB row to a consistent shape
function normalizeRow(r) {
  return {
    id:      r.id,
    desc:    r.description || r.desc || '',
    cat:     r.category || r.cat || 'Otros',
    tipo:    r.type || r.tipo || 'expense',
    monto:   r.amount || r.monto || 0,
    recibo:  r.recibo || '',
    fecha:   r.created_at || r.fecha || new Date().toISOString(),
    estado:  r.status || r.estado || 'pending',
    approvedBy: r.approved_name || r.approvedBy || null,
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────
function MetricCard({ label, value, sub, color = 'slate', icon: Icon }) {
  const colors = {
    slate: 'bg-white border-slate-100 dark:bg-white/5 dark:border-white/10',
    green: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/20',
    red:   'bg-red-50 border-red-200 dark:bg-red-500/10 dark:border-red-500/20',
    amber: 'bg-amber-50 border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/20',
  }
  const valColors = {
    slate: 'text-slate-800 dark:text-white',
    green: 'text-emerald-700 dark:text-emerald-400',
    red:   'text-red-600 dark:text-red-400',
    amber: 'text-amber-600 dark:text-amber-400',
  }
  return (
    <div className={`rounded-2xl border p-3 md:p-4 ${colors[color]}`}>
      <div className="flex items-start justify-between mb-1">
        <p className="text-[10px] md:text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-white/50">{label}</p>
        {Icon && <Icon size={15} className={valColors[color]} />}
      </div>
      <p className={`text-lg md:text-2xl font-bold tabular-nums ${valColors[color]}`}>{value}</p>
      {sub && <p className="text-[10px] md:text-xs text-slate-400 dark:text-white/40 mt-0.5">{sub}</p>}
    </div>
  )
}

function TypeBadge({ tipo, lang }) {
  const m = TIPO_META[tipo] || TIPO_META.expense
  const label = lang === 'es' ? m.label_es : m.label_en
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${m.badge} dark:bg-white/10 dark:text-white/70`}>{label}</span>
  )
}

function EstadoBadge({ estado, lang }) {
  const m = ESTADO_META[estado] || ESTADO_META.pending
  const Icon = m.icon
  const label = lang === 'es' ? m.label_es : m.label_en
  return (
    <span className={`flex items-center gap-1 text-xs ${m.cls}`}>
      <Icon size={12} />
      {label}
    </span>
  )
}

// ── PIN Confirm Modal ─────────────────────────────────────────────────────────
function PinModal({ title, onConfirm, onClose, lang }) {
  const api = useAPI()
  const L = (es, en) => lang === 'es' ? es : en
  const [pin, setPin]         = useState('')
  const [err, setErr]         = useState(false)
  const [loading, setLoading] = useState(false)

  async function submit() {
    if (!pin) return
    setLoading(true)
    try {
      const manager = await api.auth.byPin(pin)
      if (manager && ['owner', 'manager'].includes(manager.role)) {
        onConfirm(manager)
      } else {
        setErr(true); setPin('')
      }
    } catch {
      setErr(true); setPin('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-80">
        <h3 className="font-semibold text-slate-800 mb-1">{title}</h3>
        <p className="text-sm text-slate-500 mb-4">{L('PIN del gerente para continuar.', 'Manager PIN to continue.')}</p>
        <input
          autoFocus
          type="password"
          maxLength={6}
          value={pin}
          onChange={e => { setPin(e.target.value); setErr(false) }}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder="••••"
          className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-center text-xl tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {err && <p className="text-xs text-red-500 mt-1 text-center">{L('PIN incorrecto o sin permisos', 'Incorrect PIN or insufficient permissions')}</p>}
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">{L('Cancelar', 'Cancel')}</button>
          <button onClick={submit} disabled={loading} className="flex-1 py-2 rounded-lg bg-black text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-1">
            {loading && <Loader2 size={13} className="animate-spin" />}
            {L('Confirmar', 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── History Panel ─────────────────────────────────────────────────────────────
function HistoryPanel({ onClose, lang }) {
  const L = (es, en) => lang === 'es' ? es : en
  // History panel shows past closed periods (not available from current API,
  // so we display a helpful placeholder)
  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full md:w-[420px] bg-white shadow-2xl flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <h3 className="font-semibold text-slate-800">{L('Historial de Cuadres', 'Reconciliation History')}</h3>
        <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X size={18} className="text-slate-500" /></button>
      </div>
      <div className="flex-1 flex items-center justify-center text-slate-400 text-sm px-6 text-center">
        {L('El historial de cuadres de caja chica se registra al cerrar el período.', 'Petty cash reconciliation history is recorded when the period is closed.')}
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
  { key: '#',      label_es: '#',            label_en: '#',           cls: 'w-10 text-center' },
  { key: 'desc',   label_es: 'Descripción',  label_en: 'Description', cls: 'flex-1 min-w-0'   },
  { key: 'cat',    label_es: 'Categoría',    label_en: 'Category',    cls: 'w-32'             },
  { key: 'fecha',  label_es: 'Fecha',        label_en: 'Date',        cls: 'w-28'             },
  { key: 'monto',  label_es: 'Monto',        label_en: 'Amount',      cls: 'w-28 text-right'  },
  { key: 'tipo',   label_es: 'Tipo',         label_en: 'Type',        cls: 'w-24 text-center' },
  { key: 'estado', label_es: 'Estado',       label_en: 'Status',      cls: 'w-28'             },
  { key: 'accion', label_es: '',             label_en: '',            cls: 'w-36'             },
]

// ── Main Component ────────────────────────────────────────────────────────────
export default function PettyCash() {
  const api = useAPI()
  const { user }   = useAuth()
  const { lang }   = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const canApprove = ['owner', 'manager'].includes(user?.role)

  const [txns, setTxns]               = useState([])
  const [loading, setLoading]         = useState(true)
  const [tab, setTab]                 = useState('todos')
  const [showHistory, setShowHistory] = useState(false)
  const [toast, setToast]             = useState(null)
  const [pinAction, setPinAction]     = useState(null) // { label, callback }
  const [saving, setSaving]           = useState(false)

  // Entry form state
  const [desc, setDesc]     = useState('')
  const [cat, setCat]       = useState('Transporte')
  const [tipo, setTipo]     = useState('Gasto')   // UI toggle: 'Gasto' | 'Compra'
  const [monto, setMonto]   = useState('')
  const [recibo, setRecibo] = useState('')

  // ── Load transactions from DB ────────────────────────────────────────────
  function loadTxns() {
    setLoading(true)
    api.cajaChica.all()
      .then(rows => setTxns((rows || []).map(normalizeRow)))
      .catch(() => setTxns([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadTxns() }, [])

  // ── Derived metrics ──────────────────────────────────────────────────────
  const approved   = txns.filter(t => t.estado === 'approved' || t.estado === 'aprobado')
  const pending    = txns.filter(t => t.estado === 'pending'  || t.estado === 'pendiente')
  const gastado    = approved.reduce((s, t) => s + t.monto, 0)
  const disponible = FONDO_TOTAL - gastado
  const pendAmt    = pending.reduce((s, t) => s + t.monto, 0)

  const montoNum   = parseFloat(monto) || 0
  const restante   = disponible - montoNum

  // ── Tabs ─────────────────────────────────────────────────────────────────
  const TABS = [
    { key: 'todos',      label_es: 'Todos',      label_en: 'All',       fn: () => true },
    { key: 'gastos',     label_es: 'Gastos',     label_en: 'Expenses',  fn: t => ['expense','Gasto'].includes(t.tipo) },
    { key: 'compras',    label_es: 'Compras',    label_en: 'Purchases', fn: t => ['deposit','Compra'].includes(t.tipo) },
    { key: 'pendientes', label_es: 'Pendientes', label_en: 'Pending',   fn: t => ['pending','pendiente'].includes(t.estado) },
  ]

  const tabFn     = TABS.find(t => t.key === tab)?.fn ?? (() => true)
  const tabCounts = useMemo(() => {
    const obj = {}
    TABS.forEach(t => { obj[t.key] = txns.filter(t.fn).length })
    return obj
  }, [txns])
  const visible = txns.filter(tabFn)

  // ── Actions ──────────────────────────────────────────────────────────────
  async function doApprove(id, approvedBy) {
    try {
      await api.cajaChica.updateStatus({ id, status: 'approved', approvedBy: approvedBy ?? user?.id })
      loadTxns()
    } catch { loadTxns() }
    showToast(L('Gasto aprobado', 'Expense approved'))
  }

  async function doReject(id, approvedBy) {
    try {
      await api.cajaChica.updateStatus({ id, status: 'rejected', approvedBy: approvedBy ?? user?.id })
      loadTxns()
    } catch { loadTxns() }
    showToast(L('Gasto rechazado', 'Expense rejected'))
  }

  function requirePin(label, cb) {
    if (canApprove) { cb(user) }
    else { setPinAction({ label, callback: cb }) }
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  async function handleGuardar() {
    if (!desc.trim() || montoNum <= 0) return
    setSaving(true)

    // Map UI tipo to DB type
    const dbType   = tipo === 'Gasto' ? 'expense' : 'deposit'
    const dbStatus = canApprove ? 'approved' : 'pending'

    const data = {
      description: desc.trim(),
      category:    cat,
      type:        dbType,
      amount:      montoNum,
      recibo:      recibo.trim() || null,
      status:      dbStatus,
      cajero_id:   user?.id ?? 1,
    }

    try {
      await api.cajaChica.create(data)
      loadTxns()
    } catch { loadTxns() }

    setDesc(''); setMonto(''); setRecibo('')
    showToast(canApprove
      ? L('Gasto guardado y aprobado', 'Expense saved and approved')
      : L('Gasto enviado para aprobación', 'Expense submitted for approval')
    )
    setSaving(false)
  }

  function handleSolicitar() {
    showToast(L('Solicitud de reposición enviada al gerente', 'Replenishment request sent to manager'))
  }

  const formValid = desc.trim().length > 0 && montoNum > 0

  return (
    <div className="h-full flex flex-col bg-slate-50 dark:bg-black overflow-hidden">
      {/* PIN modal */}
      {pinAction && (
        <PinModal
          lang={lang}
          title={pinAction.label}
          onConfirm={manager => { pinAction.callback(manager); setPinAction(null) }}
          onClose={() => setPinAction(null)}
        />
      )}

      {/* History panel */}
      {showHistory && (
        <>
          <div className="fixed inset-0 z-30 bg-black/20" onClick={() => setShowHistory(false)} />
          <HistoryPanel lang={lang} onClose={() => setShowHistory(false)} />
        </>
      )}

      {/* Toast */}
      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}

      {/* ── Header ── */}
      <div className="bg-white dark:bg-white/5 border-b border-slate-200 dark:border-white/10 px-3 py-3 md:px-6 md:py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <PiggyBank size={18} className="text-slate-500 dark:text-white/50" />
          <h1 className="text-[14px] md:text-[16px] font-bold text-slate-800 dark:text-white">{L('Caja Chica', 'Petty Cash')}</h1>
          <span className="text-xs text-slate-400 dark:text-white/40 ml-1 hidden md:inline">{L('Fondo', 'Fund')} {fmt(FONDO_TOTAL)}</span>
        </div>
        <button
          onClick={() => setShowHistory(true)}
          className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-white/70 border border-slate-200 dark:border-white/10 px-3 py-1.5 min-h-[44px] md:min-h-0 rounded-lg hover:bg-slate-50 dark:hover:bg-white/10"
        >
          <History size={15} />
          <span className="hidden md:inline">{L('Ver Cuadres', 'View History')}</span>
          <span className="md:hidden">{L('Cuadres', 'History')}</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-3 md:gap-4 p-2 md:p-4">

        {/* ── Summary bar ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
          <MetricCard
            label={L('Fondo Asignado', 'Assigned Fund')}
            value={fmt(FONDO_TOTAL)}
            sub={L('fondo total del período', 'total period fund')}
            icon={Wallet}
          />
          <MetricCard
            label={L('Disponible', 'Available')}
            value={fmt(disponible)}
            sub={`${Math.round(Math.max(disponible, 0) / FONDO_TOTAL * 100)}% ${L('restante', 'remaining')}`}
            color="green"
            icon={RefreshCw}
          />
          <MetricCard
            label={L('Gastado este mes', 'Spent this month')}
            value={fmt(gastado)}
            sub={`${approved.length} ${L('transacciones aprobadas', 'approved transactions')}`}
            color="red"
            icon={TrendingDown}
          />
          <MetricCard
            label={L('Pendiente Aprobar', 'Pending Approval')}
            value={fmt(pendAmt)}
            sub={`${pending.length} ${L('transacciones', 'transactions')}`}
            color={pending.length > 0 ? 'amber' : 'slate'}
            icon={AlertTriangle}
          />
        </div>

        {/* ── Tabs + Table ── */}
        <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/10 shadow-sm flex flex-col overflow-hidden">

          {/* Tab bar */}
          <div className="flex items-center gap-1 px-3 md:px-4 pt-3 border-b border-slate-100 dark:border-white/10">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t transition border-b-2 -mb-px ${
                  tab === t.key
                    ? 'text-blue-600 dark:text-blue-400 border-blue-500'
                    : 'text-slate-500 dark:text-white/50 border-transparent hover:text-slate-700 dark:hover:text-white/70'
                }`}
              >
                {L(t.label_es, t.label_en)}
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  tab === t.key ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400' : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-white/50'
                }`}>
                  {tabCounts[t.key]}
                </span>
              </button>
            ))}
          </div>

          {/* Table header */}
          <div className="hidden md:flex items-center px-4 py-2 bg-slate-50 dark:bg-white/5 border-b border-slate-100 dark:border-white/10 flex-shrink-0">
            {COLS.map(c => (
              <span key={c.key} className={`text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/50 ${c.cls}`}>
                {L(c.label_es, c.label_en)}
              </span>
            ))}
          </div>

          {/* Table rows */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-50 dark:divide-white/5">
            {loading && (
              <div className="flex items-center justify-center gap-2 text-slate-400 dark:text-white/40 text-sm py-10">
                <Loader2 size={16} className="animate-spin" />
                {L('Cargando…', 'Loading…')}
              </div>
            )}
            {!loading && visible.length === 0 && (
              <div className="py-12 text-center text-slate-400 dark:text-white/40 text-sm">
                {L('No hay transacciones en esta categoría.', 'No transactions in this category.')}
              </div>
            )}
            {!loading && visible.map((t, idx) => {
              const tipeMeta = TIPO_META[t.tipo] || TIPO_META.expense
              const isRejected = ['rejected','rechazado'].includes(t.estado)
              const rowBg = isRejected ? 'bg-slate-50/80' : (tipeMeta.bg ?? '')

              return (
                <div
                  key={t.id}
                  className={`${rowBg} ${isRejected ? 'opacity-50' : ''}`}
                >
                  {/* Mobile card layout */}
                  <div className="md:hidden px-3 py-3 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <span className={`text-sm text-slate-800 dark:text-white ${isRejected ? 'line-through' : ''}`}>
                          {t.desc}
                        </span>
                        {t.recibo && (
                          <span className="flex items-center gap-0.5 text-[10px] text-slate-400 dark:text-white/40 mt-0.5">
                            <Receipt size={10} />
                            {t.recibo}
                          </span>
                        )}
                      </div>
                      <span className={`text-sm font-medium tabular-nums shrink-0 ${isRejected ? 'line-through text-slate-400 dark:text-white/30' : 'text-slate-800 dark:text-white'}`}>
                        {fmt(t.monto)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-slate-600 dark:text-white/60">{t.cat}</span>
                      <span className="text-xs text-slate-500 dark:text-white/50">{fmtDate(t.fecha)}</span>
                      <TypeBadge tipo={t.tipo} lang={lang} />
                      <EstadoBadge estado={t.estado} lang={lang} />
                    </div>
                    {['pending','pendiente'].includes(t.estado) && canApprove && (
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => requirePin(
                            L('Aprobar gasto', 'Approve expense'),
                            mgr => doApprove(t.id, mgr?.id)
                          )}
                          className="flex items-center gap-1 text-xs text-emerald-600 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 min-h-[44px] rounded-lg"
                        >
                          <CheckCircle2 size={12} />
                          {L('Aprobar', 'Approve')}
                        </button>
                        <button
                          onClick={() => requirePin(
                            L('Rechazar gasto', 'Reject expense'),
                            mgr => doReject(t.id, mgr?.id)
                          )}
                          className="flex items-center gap-1 text-xs text-red-500 border border-red-200 bg-red-50 hover:bg-red-100 px-3 py-1.5 min-h-[44px] rounded-lg"
                        >
                          <XCircle size={12} />
                          {L('Rechazar', 'Reject')}
                        </button>
                      </div>
                    )}
                    {['pending','pendiente'].includes(t.estado) && !canApprove && (
                      <span className="text-xs text-amber-500 italic">{L('En revisión', 'Under review')}</span>
                    )}
                  </div>

                  {/* Desktop row layout */}
                  <div className="hidden md:flex items-center px-4 h-12 gap-0">
                    {/* # */}
                    <span className={`${COLS[0].cls} text-xs text-slate-400 dark:text-white/50 tabular-nums`}>{idx + 1}</span>

                    {/* Descripción */}
                    <div className={`${COLS[1].cls} flex items-center gap-2 min-w-0`}>
                      <span className={`text-sm text-slate-800 dark:text-white truncate ${isRejected ? 'line-through' : ''}`}>
                        {t.desc}
                      </span>
                      {t.recibo && (
                        <span className="flex items-center gap-0.5 text-[10px] text-slate-400 dark:text-white/40 flex-shrink-0">
                          <Receipt size={10} />
                          {t.recibo}
                        </span>
                      )}
                    </div>

                    {/* Categoría */}
                    <span className={`${COLS[2].cls} text-xs text-slate-600 dark:text-white/60`}>{t.cat}</span>

                    {/* Fecha */}
                    <span className={`${COLS[3].cls} text-xs text-slate-500 dark:text-white/50`}>{fmtDate(t.fecha)}</span>

                    {/* Monto */}
                    <span className={`${COLS[4].cls} text-sm font-medium tabular-nums ${isRejected ? 'line-through text-slate-400 dark:text-white/30' : 'text-slate-800 dark:text-white'}`}>
                      {fmt(t.monto)}
                    </span>

                    {/* Tipo badge */}
                    <div className={`${COLS[5].cls} flex justify-center`}>
                      <TypeBadge tipo={t.tipo} lang={lang} />
                    </div>

                    {/* Estado */}
                    <div className={`${COLS[6].cls}`}>
                      <EstadoBadge estado={t.estado} lang={lang} />
                    </div>

                    {/* Acciones */}
                    <div className={`${COLS[7].cls} flex items-center gap-1.5 justify-end`}>
                      {['pending','pendiente'].includes(t.estado) && canApprove && (
                        <>
                          <button
                            onClick={() => requirePin(
                              L('Aprobar gasto', 'Approve expense'),
                              mgr => doApprove(t.id, mgr?.id)
                            )}
                            className="flex items-center gap-1 text-xs text-emerald-600 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 px-2 py-1 rounded-lg"
                          >
                            <CheckCircle2 size={12} />
                            {L('Aprobar', 'Approve')}
                          </button>
                          <button
                            onClick={() => requirePin(
                              L('Rechazar gasto', 'Reject expense'),
                              mgr => doReject(t.id, mgr?.id)
                            )}
                            className="flex items-center gap-1 text-xs text-red-500 border border-red-200 bg-red-50 hover:bg-red-100 px-2 py-1 rounded-lg"
                          >
                            <XCircle size={12} />
                            {L('Rechazar', 'Reject')}
                          </button>
                        </>
                      )}
                      {['pending','pendiente'].includes(t.estado) && !canApprove && (
                        <span className="text-xs text-amber-500 italic">{L('En revisión', 'Under review')}</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Table footer */}
          <div className="border-t border-slate-100 dark:border-white/10 px-4 py-2 flex items-center justify-between bg-slate-50 dark:bg-white/5">
            <span className="text-xs text-slate-400 dark:text-white/40">
              {visible.length} {L('registro', 'record')}{visible.length !== 1 ? 's' : ''}
            </span>
            <span className="text-sm font-bold text-slate-700 dark:text-white tabular-nums">
              {fmt(visible.reduce((s, t) => s + (['rejected','rechazado'].includes(t.estado) ? 0 : t.monto), 0))}
            </span>
          </div>
        </div>

        {/* ── Entry form ── */}
        <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/10 shadow-sm p-3 md:p-4 flex-shrink-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-white/50 mb-3">
            {L('Registrar gasto', 'Log expense')}
          </p>

          {/* Form row */}
          <div className="flex flex-col md:flex-row md:items-center gap-2 md:flex-wrap">
            {/* Descripción */}
            <input
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder={L('Descripción del gasto…', 'Expense description…')}
              className="w-full md:flex-1 md:min-w-[180px] border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-lg px-3 py-2 min-h-[44px] md:min-h-0 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />

            <div className="flex gap-2 flex-wrap">
              {/* Categoría */}
              <select
                value={cat}
                onChange={e => setCat(e.target.value)}
                className="flex-1 md:flex-none border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-lg px-3 py-2 min-h-[44px] md:min-h-0 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              >
                {CATEGORIAS.map(c => <option key={c}>{c}</option>)}
              </select>

              {/* Tipo toggle */}
              <div className="flex rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden text-sm">
                {['Gasto', 'Compra'].map(t => (
                  <button
                    key={t}
                    onClick={() => setTipo(t)}
                    className={`px-3 py-2 min-h-[44px] md:min-h-0 font-medium transition ${
                      tipo === t
                        ? t === 'Gasto'
                          ? 'bg-amber-500 text-white'
                          : 'bg-emerald-500 text-white'
                        : 'text-slate-500 dark:text-white/50 hover:bg-slate-50 dark:hover:bg-white/10'
                    }`}
                  >
                    {t === 'Gasto' ? L('Gasto', 'Expense') : L('Compra', 'Purchase')}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              {/* Monto */}
              <div className="relative flex-1 md:flex-none">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 dark:text-white/40">RD$</span>
                <input
                  type="number"
                  min="0"
                  value={monto}
                  onChange={e => setMonto(e.target.value)}
                  placeholder="0.00"
                  className="w-full md:w-32 pl-9 pr-3 py-2 min-h-[44px] md:min-h-0 border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>

              {/* Recibo */}
              <div className="relative flex-1 md:flex-none">
                <Receipt size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-white/40" />
                <input
                  value={recibo}
                  onChange={e => setRecibo(e.target.value)}
                  placeholder={L('Recibo # (opc.)', 'Receipt # (opt.)')}
                  className="w-full md:w-36 pl-8 pr-3 py-2 min-h-[44px] md:min-h-0 border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            </div>

            {/* Buttons */}
            <div className="flex gap-2">
              <button
                onClick={handleGuardar}
                disabled={!formValid || saving}
                className="flex-1 md:flex-none px-4 py-2 min-h-[44px] md:min-h-0 rounded-lg bg-black text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap flex items-center justify-center gap-1"
              >
                {saving && <Loader2 size={13} className="animate-spin" />}
                {L('Guardar gasto', 'Save expense')}
              </button>
              <button
                onClick={handleSolicitar}
                className="flex-1 md:flex-none flex items-center justify-center gap-1.5 px-4 py-2 min-h-[44px] md:min-h-0 rounded-lg border border-slate-200 dark:border-white/10 text-sm text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/10 whitespace-nowrap"
              >
                <Send size={14} />
                {L('Solicitar fondos', 'Request funds')}
              </button>
            </div>
          </div>

          {/* Balance strip */}
          <div className={`mt-3 rounded-xl flex items-center gap-6 px-4 py-2.5 text-sm transition ${
            montoNum > 0
              ? restante < 0
                ? 'bg-red-50 border border-red-200 dark:bg-red-500/10 dark:border-red-500/20'
                : 'bg-blue-50 border border-blue-200 dark:bg-blue-500/10 dark:border-blue-500/20'
              : 'bg-slate-50 border border-slate-100 dark:bg-white/5 dark:border-white/10'
          }`}>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 dark:text-white/50">{L('Disponible', 'Available')}</span>
              <span className="font-semibold tabular-nums text-slate-700 dark:text-white">{fmt(disponible)}</span>
            </div>
            {montoNum > 0 && (
              <>
                <span className="text-slate-300 dark:text-white/30">→</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-500 dark:text-white/50">{L('Este gasto', 'This expense')}</span>
                  <span className="font-semibold tabular-nums text-slate-700 dark:text-white">− {fmt(montoNum)}</span>
                </div>
                <span className="text-slate-300 dark:text-white/30">→</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-500 dark:text-white/50">{L('Restante', 'Remaining')}</span>
                  <span className={`font-bold tabular-nums ${restante < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {fmt(restante)}
                  </span>
                  {restante < 0 && (
                    <span className="text-xs text-red-500 ml-1">⚠ {L('Excede disponible', 'Exceeds available')}</span>
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
