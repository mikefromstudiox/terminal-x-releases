import { useState, useEffect, useRef } from 'react'
import {
  CheckCircle2, AlertCircle, ChevronRight, ChevronDown, X, History,
  Printer, Calculator, DollarSign, Lock, Loader2, Search,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useAPI, usePrinterAPI } from '../context/DataContext'
import { useLang } from '../i18n'
import { printCuadreCaja } from '@terminal-x/services/printer'


// ── Denomination rows ─────────────────────────────────────────────────────────
const BILLS = [
  { label: '2,000', value: 2000 },
  { label: '1,000', value: 1000 },
  { label: '500',   value: 500  },
  { label: '200',   value: 200  },
  { label: '100',   value: 100  },
  { label: '50',    value: 50   },
  { label: '25',    value: 25   },
  { label: '20',    value: 20   },
  { label: '10',    value: 10   },
  { label: '5',     value: 5    },
  { label: '1',     value: 1    },
]

const EMPTY_QTY = Object.fromEntries(BILLS.map(b => [b.value, 0]))

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n) {
  return 'RD$' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtUSD(n) {
  return 'US$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function nowStr() {
  return new Date().toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
function todayStr() {
  return new Date().toLocaleDateString('es-DO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}
function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

// ── Sub-components ────────────────────────────────────────────────────────────
function SectionLabel({ children }) {
  return <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-white/40 mb-2">{children}</p>
}

function ResumeRow({ label, value, bold, indent, muted, divider }) {
  if (divider) return <hr className="my-2 border-slate-100 dark:border-white/10" />
  return (
    <div className={`flex justify-between items-center py-[3px] ${indent ? 'pl-3' : ''}`}>
      <span className={`text-sm ${bold ? 'font-semibold text-slate-800 dark:text-white' : muted ? 'text-slate-400 dark:text-white/40' : 'text-slate-600 dark:text-white/60'}`}>
        {label}
      </span>
      <span className={`text-sm tabular-nums ${bold ? 'font-bold text-slate-900 dark:text-white' : muted ? 'text-slate-400 dark:text-white/40' : 'text-slate-700 dark:text-white'}`}>
        {value}
      </span>
    </div>
  )
}

function SmallInput({ value, onChange, className = '' }) {
  return (
    <input
      type="number"
      min="0"
      value={value}
      onChange={e => onChange(Number(e.target.value) || 0)}
      className={`w-16 text-right border border-slate-200 dark:border-white/10 rounded px-1.5 py-1 md:py-0.5 text-sm min-h-[44px] md:min-h-0 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-400 ${className}`}
    />
  )
}

function RightInput({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-base font-bold text-slate-800 dark:text-white whitespace-nowrap flex-1">{label}</span>
      <input
        type="number"
        min="0"
        value={value || ''}
        onChange={e => onChange(Number(e.target.value) || 0)}
        placeholder="0"
        className="w-24 flex-shrink-0 text-right border border-slate-200 dark:border-white/10 rounded px-2 py-1 text-sm tabular-nums dark:bg-white/5 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
    </div>
  )
}

// ── PIN Modal ─────────────────────────────────────────────────────────────────
function PinModal({ onConfirm, onClose, lang }) {
  const api = useAPI()
  const L = (es, en) => lang === 'es' ? es : en
  const [pin, setPin]       = useState('')
  const [err, setErr]       = useState(false)
  const [loading, setLoading] = useState(false)
  const inputRef            = useRef()

  useEffect(() => { inputRef.current?.focus() }, [])

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
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'cashreconciliation.fmt' }) } catch {}
      setErr(true); setPin('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-white/5 rounded-2xl shadow-2xl p-6 md:p-8 w-full max-w-sm mx-4">
        <div className="flex items-center gap-2 mb-6">
          <Lock size={18} className="text-slate-500 dark:text-white/60" />
          <h3 className="font-semibold text-slate-800 dark:text-white">{L('Autorización de Gerente', 'Manager Authorization')}</h3>
        </div>
        <p className="text-sm text-slate-500 dark:text-white/60 mb-4">{L('Ingrese el PIN del gerente para cerrar la caja.', 'Enter manager PIN to close the register.')}</p>
        <input
          ref={inputRef}
          type="password"
          maxLength={6}
          value={pin}
          onChange={e => { setPin(e.target.value); setErr(false) }}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder="••••"
          className="w-full border border-slate-300 dark:border-white/10 rounded-lg px-4 py-2.5 text-center text-xl tracking-[0.5em] dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {err && <p className="text-xs text-red-500 mt-2 text-center">{L('PIN incorrecto o sin permisos', 'Incorrect PIN or insufficient permissions')}</p>}
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-sm text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10">
            {L('Cancelar', 'Cancel')}
          </button>
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
function CierresPanel({ onClose, lang, biz }) {
  const api = useAPI()
  const L = (es, en) => lang === 'es' ? es : en
  const today = new Date().toISOString().slice(0, 10)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

  const [history,  setHistory]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo)
  const [dateTo,   setDateTo]   = useState(today)
  const [expanded, setExpanded] = useState(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  function runSearch(from, to) {
    setLoading(true)
    api.cuadre.list({ dateFrom: from, dateTo: to })
      .then(rows => { if (mountedRef.current) setHistory(rows || []) })
      .catch(() => { if (mountedRef.current) setHistory([]) })
      .finally(() => { if (mountedRef.current) setLoading(false) })
  }

  useEffect(() => { runSearch(thirtyDaysAgo, today) }, [])

  async function handleReprint(c) {
    const storedQty = JSON.parse(c.denominaciones || '{}')
    await printCuadreCaja({
      biz:    biz || {},
      cajero: c.cajero_name || '—',
      day: {
        efectivo:     c.efectivo_sistema || 0,
        tarjeta:      c.tarjeta || 0,
        transferencia: c.transferencia || 0,
        cheque:       c.cheque || 0,
        totalVendido: c.total_vendido || 0,
        totalCobrado: c.total_cobrado || 0,
      },
      denominaciones: BILLS.map(b => ({ label: b.label, qty: storedQty[b.value] || 0, label_val: b.value })),
      efectivoNeto: (c.efectivo_conteo || 0) - (c.fondo || 0),
      cierreTotal:  c.cierre_total || 0,
      diferencia:   c.diferencia   || 0,
      comentario:   c.comentario   || null,
    }).catch(() => { /* reprint errors are non-critical in history panel */ })
  }

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full md:w-[500px] bg-white dark:bg-black shadow-2xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/10">
        <h3 className="text-[14px] md:text-[16px] font-bold text-slate-800 dark:text-white">{L('Historial de Cierres', 'Closing History')}</h3>
        <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-white/10">
          <X size={18} className="text-slate-500 dark:text-white/60" />
        </button>
      </div>

      {/* Filters */}
      <div className="px-4 py-3 border-b border-slate-100 dark:border-white/10 flex items-center gap-2">
        <div className="flex flex-col gap-0.5 flex-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">{L('Desde', 'From')}</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border border-slate-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-sm dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
        <div className="flex flex-col gap-0.5 flex-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">{L('Hasta', 'To')}</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border border-slate-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-sm dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
        <button onClick={() => runSearch(dateFrom, dateTo)}
          className="flex items-center gap-1.5 mt-4 px-4 py-1.5 bg-black hover:bg-slate-800 text-white text-sm font-medium rounded-lg">
          <Search size={14} />
          {L('Buscar', 'Search')}
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading && (
          <div className="flex items-center justify-center h-20 gap-2 text-slate-400 dark:text-white/40">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">{L('Cargando…', 'Loading…')}</span>
          </div>
        )}
        {!loading && history.length === 0 && (
          <div className="text-center text-slate-400 dark:text-white/40 text-sm py-10">{L('Sin cierres en el período', 'No closings in period')}</div>
        )}
        {!loading && history.map((c, i) => {
          const diff      = c.diferencia ?? 0
          const cuadrada  = Math.abs(diff) < 1
          const isOpen    = expanded === i
          const storedQty = isOpen ? JSON.parse(c.denominaciones || '{}') : {}
          return (
            <div key={i} className={`rounded-xl border ${cuadrada ? 'border-emerald-100 dark:border-emerald-500/20' : 'border-red-100 dark:border-red-500/20'}`}>
              {/* Row header */}
              <div
                className={`flex items-center gap-3 px-4 py-3 cursor-pointer rounded-xl ${cuadrada ? 'bg-emerald-50/40 dark:bg-emerald-500/5 hover:bg-emerald-50 dark:hover:bg-emerald-500/10' : 'bg-red-50/40 dark:bg-red-500/5 hover:bg-red-50 dark:hover:bg-red-500/10'}`}
                onClick={() => setExpanded(isOpen ? null : i)}
              >
                <ChevronDown size={15} className={`text-slate-400 dark:text-white/40 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-slate-800 dark:text-white">{c.date}</span>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${cuadrada ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400'}`}>
                      {cuadrada ? L('Cuadrada', 'Balanced') : `${L('Desc.', 'Diff.')} ${fmt(diff)}`}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-white/60 mt-0.5">{c.cajero_name || '—'}</p>
                </div>
                <span className="text-sm font-bold text-slate-800 dark:text-white tabular-nums flex-shrink-0">{fmt(c.cierre_total || 0)}</span>
              </div>

              {/* Expanded detail */}
              {isOpen && (
                <div className="px-4 pb-4 pt-2 space-y-3 border-t border-slate-100 dark:border-white/10">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <span className="text-slate-500 dark:text-white/60">{L('Fondo de caja', 'Opening float')}</span>
                    <span className="text-right tabular-nums text-slate-800 dark:text-white">{fmt(c.fondo)}</span>
                    <span className="text-slate-500 dark:text-white/60">{L('Efectivo contado', 'Cash counted')}</span>
                    <span className="text-right tabular-nums text-slate-800 dark:text-white">{fmt(c.efectivo_conteo)}</span>
                    <span className="text-slate-500 dark:text-white/60">{L('Efectivo sistema', 'System cash')}</span>
                    <span className="text-right tabular-nums text-slate-800 dark:text-white">{fmt(c.efectivo_sistema)}</span>
                    <span className="text-slate-500 dark:text-white/60">{L('Tarjeta', 'Card')}</span>
                    <span className="text-right tabular-nums text-slate-800 dark:text-white">{fmt(c.tarjeta)}</span>
                    <span className="text-slate-500 dark:text-white/60">{L('Transferencia', 'Transfer')}</span>
                    <span className="text-right tabular-nums text-slate-800 dark:text-white">{fmt(c.transferencia)}</span>
                    <span className="text-slate-500 dark:text-white/60">{L('Cheque', 'Check')}</span>
                    <span className="text-right tabular-nums text-slate-800 dark:text-white">{fmt(c.cheque)}</span>
                    <span className="text-slate-500 dark:text-white/60">{L('F. A Créditos', 'Credits')}</span>
                    <span className="text-right tabular-nums text-slate-800 dark:text-white">{fmt(c.creditos)}</span>
                    <span className="text-slate-500 dark:text-white/60">{L('Salidas', 'Outflows')}</span>
                    <span className="text-right tabular-nums text-red-600 dark:text-red-400">{fmt(c.salidas)}</span>
                    <hr className="col-span-2 border-slate-100 dark:border-white/10 my-1" />
                    <span className="font-semibold text-slate-700 dark:text-white">{L('Total vendido', 'Total sold')}</span>
                    <span className="text-right tabular-nums font-semibold text-slate-800 dark:text-white">{fmt(c.total_vendido)}</span>
                    <span className="font-semibold text-slate-700 dark:text-white">{L('Total cobrado', 'Total collected')}</span>
                    <span className="text-right tabular-nums font-semibold text-slate-800 dark:text-white">{fmt(c.total_cobrado)}</span>
                    <span className="font-bold text-slate-800 dark:text-white">{L('Cierre total', 'Closing total')}</span>
                    <span className="text-right tabular-nums font-bold text-slate-900 dark:text-white">{fmt(c.cierre_total)}</span>
                    <span className={`font-bold ${cuadrada ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{L('Diferencia', 'Difference')}</span>
                    <span className={`text-right tabular-nums font-bold ${cuadrada ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      {diff === 0 ? 'RD$0.00' : (diff > 0 ? '+' : '') + fmt(diff)}
                    </span>
                  </div>

                  {/* Denominaciones */}
                  {BILLS.some(b => storedQty[b.value] > 0) && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40 mb-1">{L('Conteo de efectivo', 'Cash count')}</p>
                      <div className="space-y-0.5">
                        {BILLS.filter(b => storedQty[b.value] > 0).map(b => (
                          <div key={b.value} className="flex justify-between text-xs text-slate-600 dark:text-white/60">
                            <span>{b.label} × {storedQty[b.value]}</span>
                            <span className="tabular-nums">{fmt(b.value * storedQty[b.value])}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Comentario */}
                  {c.comentario && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40 mb-1">{L('Comentario', 'Note')}</p>
                      <p className="text-xs text-slate-600 dark:text-white/60 italic">{c.comentario}</p>
                    </div>
                  )}

                  <button onClick={() => handleReprint(c)}
                    className="flex items-center gap-1.5 w-full justify-center py-2 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10">
                    <Printer size={14} />
                    {L('Reimprimir', 'Reprint')}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function CashReconciliation() {
  const api = useAPI()
  const printerApi = usePrinterAPI()
  const { user }  = useAuth()
  const { lang }  = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [time, setTime]           = useState(nowStr())
  const [fondo, setFondo]         = useState(5000)
  const [comentario, setComentario] = useState('')
  const [showPin, setShowPin]     = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [closed, setClosed]       = useState(false)
  const [saving, setSaving]       = useState(false)
  const [managerName, setManagerName] = useState(null)
  const [biz, setBiz]             = useState(null)
  const [toast, setToast]         = useState(null)

  function flash(msg) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  // Daily summary from DB (replaces hardcoded DAY)
  const [daySummary, setDaySummary] = useState({
    efectivo: 0, tarjeta: 0, transferencia: 0, cheque: 0, credito: 0,
    totalVendido: 0, totalCobrado: 0, count: 0,
  })
  const [loadingDay, setLoadingDay] = useState(true)

  // v2.16.10 — Modern Cuadre. Replaces the legacy denomination grid + 4
  // outflow inputs + 3-card breakdown with a 3-step flow: (1) auto resumen,
  // (2) single counted-cash input, (3) optional salidas + notes + close.
  // The api.cuadre.create payload contract is preserved (denominaciones={},
  // tarjeta/transferencia auto-pulled from daily summary).
  const [efectivoConteo, setEfectivoConteo] = useState('')   // RD$ counted in drawer (single number)
  const [tarjetaConteo, setTarjetaConteo] = useState('')     // RD$ tarjeta total (single number, prefilled)
  const [transferConteo, setTransferConteo] = useState('')   // RD$ transferencia total (single number, prefilled)
  const [salidas, setSalidas] = useState(0)                  // RD$ paid out from drawer (avances+desembolsos)
  const [showSalidas, setShowSalidas] = useState(false)

  // Load business info for print header
  useEffect(() => {
    api.admin.getEmpresa().then(setBiz).catch(err => { try { window.__txReportError?.(err, { severity: 'warn', category: 'cuadre.empresa.load' }) } catch {} ; flash(L('Error al cargar empresa', 'Error loading business')) })
  }, [])

  // Clock tick
  useEffect(() => {
    const id = setInterval(() => setTime(nowStr()), 1000)
    return () => clearInterval(id)
  }, [])

  // Load daily summary on mount + prefill tarjeta/transfer with system totals
  useEffect(() => {
    api.cuadre.daily(todayISO())
      .then(data => {
        if (data) {
          setDaySummary(data)
          if (data.tarjeta != null)       setTarjetaConteo(String(data.tarjeta || 0))
          // Transferencia + cheque combined into a single transfer bucket.
          const trans = Number(data.transferencia || 0) + Number(data.cheque || 0)
          setTransferConteo(String(trans))
        }
      })
      .catch(err => { try { window.__txReportError?.(err, { severity: 'warn', category: 'cuadre.daily.load' }) } catch {} ; flash(L('Error al cargar resumen del día', 'Error loading daily summary')) })
      .finally(() => setLoadingDay(false))
  }, [])

  // ── Derived totals ────────────────────────────────────────────────────────
  // System-side expected (read-only, auto-pulled).
  const tarjetaSistema   = Number(daySummary.tarjeta || 0)
  const transSistema     = Number(daySummary.transferencia || 0) + Number(daySummary.cheque || 0)
  const creditosTotal    = Number(daySummary.credito || 0)

  // Cashier-counted (what they actually have).
  const efectivoConteoNum = Number(efectivoConteo) || 0
  const tarjetaConteoNum  = Number(tarjetaConteo)  || 0
  const transferConteoNum = Number(transferConteo) || 0

  const efectivoNeto      = efectivoConteoNum - fondo - salidas
  const cierreTotal       = efectivoNeto + tarjetaConteoNum + transferConteoNum
  const diferencia        = cierreTotal - (daySummary.totalCobrado || 0)
  const cuadrada          = Math.abs(diferencia) < 1
  const efectivoEsperado  = Number(daySummary.efectivo || 0) - salidas

  function buildPrintPayload() {
    return {
      biz:    biz || {},
      cajero: user?.name || '—',
      day: {
        efectivo:      daySummary.efectivo     || 0,
        tarjeta:       tarjetaConteoNum,
        documento:     0,
        cheque:        0,
        transferencia: transferConteoNum,
        totalVendido:  daySummary.totalVendido || 0,
        totalCobrado:  daySummary.totalCobrado || 0,
      },
      // Modern flow: no denomination breakdown. Empty array preserves the
      // print-builder contract; reprint side reads from c.denominaciones JSON
      // (legacy cierres still render their bill rows).
      denominaciones: [],
      efectivoNeto,
      cierreTotal,
      diferencia,
      comentario: comentario || null,
    }
  }

  function doPrint() {
    printCuadreCaja(buildPrintPayload()).catch(err => { try { window.__txReportError?.(err, { severity: 'warn', category: 'cuadre.print' }) } catch {} ; flash(L('Error al imprimir cuadre', 'Error printing reconciliation')) })
  }

  async function handleRecalc() {
    setLoadingDay(true)
    try {
      const data = await api.cuadre.daily(todayISO())
      if (data) setDaySummary(data)
      flash(L('Datos actualizados ✓', 'Data refreshed ✓'))
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'cashreconciliation.buildprintpayload' }) } catch {}
      flash(L('Error al recalcular', 'Error recalculating'))
    } finally {
      setLoadingDay(false)
    }
  }

  function handleCancel() {
    setEfectivoConteo('')
    setTarjetaConteo(String(daySummary.tarjeta || 0))
    setTransferConteo(String(Number(daySummary.transferencia || 0) + Number(daySummary.cheque || 0)))
    setSalidas(0)
    setShowSalidas(false)
    setComentario('')
  }

  function handleCuadrar() {
    if (efectivoConteo === '') { flash(L('Ingrese el efectivo contado en gaveta', 'Enter the cash counted in drawer')); return }
    if (user?.role === 'cashier') { setShowPin(true) }
    else { doClose(null) }
  }

  async function doClose(manager) {
    setShowPin(false)
    setSaving(true)
    const closeData = {
      cajero_id:        user?.id ?? 1,
      date:             todayISO(),
      fondo:            fondo,
      efectivo_conteo:  efectivoConteoNum,
      efectivo_sistema: daySummary.efectivo || 0,
      tarjeta:          tarjetaConteoNum,
      transferencia:    transferConteoNum,
      cheque:           0,
      creditos:         creditosTotal,
      salidas:          Number(salidas) || 0,
      total_vendido:    daySummary.totalVendido || 0,
      total_cobrado:    daySummary.totalCobrado || 0,
      cierre_total:     cierreTotal,
      diferencia:       diferencia,
      comentario:       comentario || null,
      denominaciones:   {},
    }
    try {
      await api.cuadre.create(closeData)
      setManagerName(manager?.name ?? null)
      setClosed(true)
      doPrint()
    } catch (err) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(err, { severity: 'error', category: 'cashreconciliation.buildprintpayload' }) } catch {}
      console.error('cuadre:create error', err)
      flash(L('Error al cerrar caja', 'Error closing register'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full flex flex-col bg-slate-50 dark:bg-black">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-xl text-[13px] font-semibold bg-red-500 text-white">
          <AlertCircle size={14} />{toast}
        </div>
      )}

      {/* PIN Modal */}
      {showPin && (
        <PinModal
          lang={lang}
          onConfirm={mgr => doClose(mgr)}
          onClose={() => setShowPin(false)}
        />
      )}

      {/* History Panel */}
      {showHistory && (
        <>
          <div className="fixed inset-0 z-30 bg-black/20" onClick={() => setShowHistory(false)} />
          <CierresPanel lang={lang} biz={biz} onClose={() => setShowHistory(false)} />
        </>
      )}

      {/* Closed Banner */}
      {closed && (
        <div className="bg-emerald-600 text-white text-center py-2 text-sm font-medium flex items-center justify-center gap-2">
          <CheckCircle2 size={16} />
          {L('Caja cerrada exitosamente el', 'Register successfully closed on')} {todayStr()} {L('a las', 'at')} {time}
          {managerName && <span className="ml-1 opacity-80">· {L('Autorizado por', 'Authorized by')} {managerName}</span>}
        </div>
      )}

      {/* ── Top Bar ── */}
      <div className="bg-white dark:bg-white/5 border-b border-slate-200 dark:border-white/10 px-3 md:px-6 py-3 flex-shrink-0">
        <div className="flex flex-wrap items-center gap-3 md:gap-6">
          <div className="flex-1 min-w-[120px]">
            <p className="text-xs text-slate-400 dark:text-white/40 uppercase tracking-wider">{L('Cajero', 'Cashier')}</p>
            <p className="font-semibold text-slate-800 dark:text-white text-sm md:text-base">{user?.name ?? L('Caja', 'Register')}</p>
          </div>
          <div className="hidden md:block flex-1">
            <p className="text-xs text-slate-400 dark:text-white/40 uppercase tracking-wider">{L('Fecha', 'Date')}</p>
            <p className="font-medium text-slate-700 dark:text-white capitalize text-sm">{todayStr()}</p>
          </div>
          <div className="w-20 md:w-32 text-center">
            <p className="text-xs text-slate-400 dark:text-white/40 uppercase tracking-wider">{L('Hora', 'Time')}</p>
            <p className="font-mono font-semibold text-slate-800 dark:text-white text-sm md:text-base">{time}</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 dark:text-white/60 whitespace-nowrap hidden md:inline">{L('Fondo de caja', 'Opening float')}</label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 dark:text-white/40">RD$</span>
              <input
                type="number"
                value={fondo}
                onChange={e => setFondo(Number(e.target.value) || 0)}
                className="w-28 pl-8 pr-2 py-1.5 min-h-[44px] md:min-h-0 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-right dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>
          <button
            onClick={() => setShowHistory(true)}
            className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-white/60 border border-slate-200 dark:border-white/10 px-3 py-1.5 min-h-[44px] md:min-h-0 rounded-lg hover:bg-slate-50 dark:hover:bg-white/10"
          >
            <History size={15} />
            <span className="hidden md:inline">{L('Ver Cierres', 'View History')}</span>
            <span className="md:hidden">{L('Cierres', 'History')}</span>
          </button>
        </div>
      </div>

      {/* ── v2.16.10 Modern Cuadre — 3 stacked cards ───────────────────── */}
      <div className="flex-1 overflow-y-auto p-3 md:p-6">
        <div className="max-w-2xl mx-auto space-y-4">

          {/* STEP 1 — Resumen del día (auto, read-only) */}
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/10 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#b3001e] text-white text-[11px] font-black mr-2">1</span>
                <span className="text-[15px] font-bold text-slate-800 dark:text-white">{L('Resumen del día', "Day's Summary")}</span>
              </div>
              <button onClick={handleRecalc} disabled={loadingDay}
                className="text-[11px] text-slate-500 dark:text-white/60 hover:text-[#b3001e] inline-flex items-center gap-1 disabled:opacity-40">
                <Calculator size={12} />
                {loadingDay ? L('…', '…') : L('Recalcular', 'Refresh')}
              </button>
            </div>
            {loadingDay ? (
              <div className="flex items-center gap-2 text-slate-400 dark:text-white/40 text-sm py-4">
                <Loader2 size={14} className="animate-spin" />
                {L('Cargando…', 'Loading…')}
              </div>
            ) : (
              <div className="space-y-0.5">
                <ResumeRow label={L('Efectivo esperado', 'Expected cash')} value={fmt(daySummary.efectivo)} />
                <ResumeRow label={L('Tarjeta esperada', 'Expected card')}  value={fmt(tarjetaSistema)} />
                <ResumeRow label={L('Transferencia esperada', 'Expected transfer')} value={fmt(transSistema)} />
                {creditosTotal > 0 && (
                  <ResumeRow label={L('Créditos otorgados', 'Credits issued')} value={fmt(creditosTotal)} muted />
                )}
                {(Number(daySummary.depositos_cobrados) > 0 || Number(daySummary.depositos_devueltos) > 0) && (
                  <>
                    <ResumeRow divider />
                    <ResumeRow label={L('Depósitos netos (envases)', 'Deposits net (bottles)')}
                               value={fmt((daySummary.depositos_cobrados || 0) - (daySummary.depositos_devueltos || 0))} muted />
                  </>
                )}
                <ResumeRow divider />
                <ResumeRow label={L('Total vendido', 'Total sold')}      value={fmt(daySummary.totalVendido)} bold />
                <ResumeRow label={L('Total cobrado', 'Total collected')} value={fmt(daySummary.totalCobrado)} bold />
              </div>
            )}
          </div>

          {/* STEP 2 — Conteo (efectivo + tarjeta + transferencia) */}
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/10 p-5 shadow-sm">
            <div className="mb-4">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#b3001e] text-white text-[11px] font-black mr-2">2</span>
              <span className="text-[15px] font-bold text-slate-800 dark:text-white">{L('Conteo', 'Count')}</span>
            </div>

            {/* Efectivo — primary input, biggest field */}
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40 mb-2">
              {L('Efectivo en gaveta (RD$)', 'Cash in drawer (RD$)')}
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[14px] text-slate-400 dark:text-white/40 font-semibold">RD$</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={efectivoConteo}
                onChange={e => setEfectivoConteo(e.target.value)}
                onFocus={e => e.target.select()}
                placeholder="0.00"
                disabled={closed}
                className="w-full pl-14 pr-4 py-4 text-2xl md:text-3xl font-black tabular-nums text-right rounded-xl border-2 border-slate-200 dark:border-white/10 bg-white dark:bg-black text-slate-800 dark:text-white focus:outline-none focus:border-[#b3001e] focus:ring-2 focus:ring-[#b3001e]/20 disabled:opacity-50"
              />
            </div>

            {/* Tarjeta + Transferencia — secondary inputs, prefilled from system */}
            <div className="grid grid-cols-2 gap-3 mt-4">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40 mb-2">
                  {L('Tarjeta (RD$)', 'Card (RD$)')}
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-slate-400 dark:text-white/40 font-semibold">RD$</span>
                  <input
                    type="number" inputMode="decimal" step="0.01" min="0"
                    value={tarjetaConteo}
                    onChange={e => setTarjetaConteo(e.target.value)}
                    onFocus={e => e.target.select()}
                    placeholder="0.00"
                    disabled={closed}
                    className="w-full pl-12 pr-3 py-2.5 text-[15px] font-bold tabular-nums text-right rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-black text-slate-800 dark:text-white focus:outline-none focus:border-[#b3001e] disabled:opacity-50"
                  />
                </div>
                {tarjetaSistema > 0 && Math.abs(tarjetaConteoNum - tarjetaSistema) >= 1 && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
                    {L('Sistema', 'System')}: {fmt(tarjetaSistema)}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40 mb-2">
                  {L('Transferencia (RD$)', 'Transfer (RD$)')}
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-slate-400 dark:text-white/40 font-semibold">RD$</span>
                  <input
                    type="number" inputMode="decimal" step="0.01" min="0"
                    value={transferConteo}
                    onChange={e => setTransferConteo(e.target.value)}
                    onFocus={e => e.target.select()}
                    placeholder="0.00"
                    disabled={closed}
                    className="w-full pl-12 pr-3 py-2.5 text-[15px] font-bold tabular-nums text-right rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-black text-slate-800 dark:text-white focus:outline-none focus:border-[#b3001e] disabled:opacity-50"
                  />
                </div>
                {transSistema > 0 && Math.abs(transferConteoNum - transSistema) >= 1 && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
                    {L('Sistema', 'System')}: {fmt(transSistema)}
                  </p>
                )}
              </div>
            </div>

            {/* Salidas — collapsible disclosure */}
            <div className="mt-4">
              {!showSalidas ? (
                <button onClick={() => setShowSalidas(true)} disabled={closed}
                  className="text-[12px] text-slate-500 dark:text-white/60 hover:text-[#b3001e] underline underline-offset-2 disabled:opacity-40">
                  {L('¿Hubo retiros o desembolsos hoy?', 'Were there cash payouts today?')}
                </button>
              ) : (
                <div className="rounded-xl border border-slate-200 dark:border-white/10 p-3 bg-slate-50 dark:bg-white/5">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-white/60 mb-1.5">
                    {L('Salidas en efectivo (RD$)', 'Cash payouts (RD$)')}
                  </label>
                  <p className="text-[10px] text-slate-400 dark:text-white/40 mb-2">
                    {L('Suma de avances, devoluciones, comisiones o desembolsos pagados de la gaveta.', 'Sum of advances, refunds, commissions or disbursements paid from drawer.')}
                  </p>
                  <input
                    type="number" min="0" step="0.01"
                    value={salidas || ''}
                    onChange={e => setSalidas(Number(e.target.value) || 0)}
                    placeholder="0.00"
                    disabled={closed}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-right text-[14px] tabular-nums dark:bg-black dark:text-white focus:outline-none focus:border-[#b3001e]"
                  />
                </div>
              )}
            </div>

            {/* Live breakdown */}
            {efectivoConteo !== '' && !loadingDay && (
              <div className="mt-4 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/10 p-3 space-y-1">
                <ResumeRow label={L('Efectivo contado', 'Cash counted')}  value={fmt(efectivoConteoNum)} />
                <ResumeRow label={`− ${L('Fondo de caja', 'Opening float')}`} value={fmt(fondo)} muted />
                {salidas > 0 && (
                  <ResumeRow label={`− ${L('Salidas', 'Payouts')}`} value={fmt(salidas)} muted />
                )}
                <ResumeRow label={L('Efectivo neto', 'Net cash')}         value={fmt(efectivoNeto)} bold />
                <ResumeRow divider />
                <ResumeRow label={L('+ Tarjeta', '+ Card')}                value={fmt(tarjetaConteoNum)} />
                <ResumeRow label={L('+ Transferencia', '+ Transfer')}      value={fmt(transferConteoNum)} />
                <ResumeRow divider />
                <ResumeRow label={L('Total cierre', 'Closing total')}      value={fmt(cierreTotal)} bold />
                <ResumeRow label={L('Total cobrado (sistema)', 'Total collected (system)')} value={fmt(daySummary.totalCobrado)} muted />
              </div>
            )}

            {/* Diferencia banner */}
            {efectivoConteo !== '' && !loadingDay && (
              <div className={`mt-4 rounded-xl p-4 flex items-center gap-3 ${cuadrada ? 'bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30' : 'bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30'}`}>
                {cuadrada
                  ? <CheckCircle2 size={22} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                  : <AlertCircle size={22} className="text-red-500 dark:text-red-400 shrink-0" />}
                <div className="flex-1">
                  <p className={`text-[15px] font-black ${cuadrada ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                    {cuadrada ? L('Caja cuadrada', 'Balanced') : `${L('Descuadre', 'Off by')} ${fmt(Math.abs(diferencia))}`}
                  </p>
                  <p className={`text-[11px] ${cuadrada ? 'text-emerald-600/80 dark:text-emerald-400/70' : 'text-red-500/80 dark:text-red-400/70'}`}>
                    {cuadrada
                      ? L('El efectivo coincide con lo cobrado.', 'Cash matches collected.')
                      : diferencia > 0
                        ? L('Sobrante — hay más efectivo del esperado.', 'Cash over — more in drawer than expected.')
                        : L('Faltante — falta efectivo en gaveta.', 'Cash short — drawer below expected.')}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* STEP 3 — Notas y cierre */}
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/10 p-5 shadow-sm">
            <div className="mb-3">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#b3001e] text-white text-[11px] font-black mr-2">3</span>
              <span className="text-[15px] font-bold text-slate-800 dark:text-white">{L('Notas y cierre', 'Notes & close')}</span>
            </div>
            <textarea
              value={comentario}
              onChange={e => setComentario(e.target.value)}
              placeholder={L('Observaciones opcionales del cierre…', 'Optional closing notes…')}
              rows={2}
              disabled={closed}
              className="w-full border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm dark:bg-white/5 dark:text-white focus:outline-none focus:border-[#b3001e] resize-none disabled:opacity-50"
            />
          </div>

        </div>
      </div>

      {/* ── Footer ── */}
      <div className="bg-white dark:bg-white/5 border-t border-slate-100 dark:border-white/10 px-3 md:px-6 py-3 flex-shrink-0">
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <button
            onClick={() => printerApi?.openDrawer?.().catch?.(() => {})}
            className="flex items-center gap-1.5 px-3 md:px-5 py-2 min-h-[44px] md:min-h-0 rounded-lg border border-slate-200 dark:border-white/10 text-sm text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10"
          >
            <DollarSign size={15} />
            <span className="hidden md:inline">{L('Abrir Cajón', 'Open Drawer')}</span>
            <span className="md:hidden">{L('Cajón', 'Drawer')}</span>
          </button>
          <button
            onClick={handleRecalc}
            disabled={loadingDay}
            className="flex items-center gap-1.5 px-3 md:px-5 py-2 min-h-[44px] md:min-h-0 rounded-lg border border-slate-200 dark:border-white/10 text-sm text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 disabled:opacity-40"
          >
            <Calculator size={15} />
            {loadingDay ? L('Cargando…', 'Loading…') : L('Recalcular', 'Recalculate')}
          </button>
          <button
            onClick={handleCancel}
            disabled={closed}
            className="px-3 md:px-5 py-2 min-h-[44px] md:min-h-0 rounded-lg border border-slate-200 dark:border-white/10 text-sm text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 disabled:opacity-40"
          >
            {L('Limpiar', 'Clear')}
          </button>

          <div className="flex-1" />

          <button
            onClick={doPrint}
            className="flex items-center gap-1.5 px-3 md:px-5 py-2 min-h-[44px] md:min-h-0 rounded-lg border border-slate-200 dark:border-white/10 text-sm text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10"
          >
            <Printer size={15} />
            <span className="hidden md:inline">{L('Imprimir', 'Print')}</span>
          </button>
          <button
            disabled={closed || saving}
            onClick={handleCuadrar}
            className={`flex items-center gap-1.5 px-4 md:px-6 py-2 min-h-[44px] md:min-h-0 rounded-lg text-xs md:text-sm font-semibold text-white transition disabled:opacity-40 ${
              cuadrada ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-black hover:bg-slate-800'
            }`}
          >
            {saving
              ? <Loader2 size={14} className="animate-spin" />
              : user?.role === 'cashier' && <Lock size={14} />
            }
            {L('Cuadrar / Cerrar Caja', 'Balance / Close Register')}
          </button>
        </div>
      </div>
    </div>
  )
}
