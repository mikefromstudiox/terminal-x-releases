import { useState, useEffect, useRef } from 'react'
import {
  CheckCircle2, AlertCircle, ChevronRight, ChevronDown, X, History,
  Printer, Calculator, DollarSign, Lock, Loader2, Search,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useAPI, usePrinterAPI } from '../context/DataContext'
import { useLang } from '../i18n'
import { printCuadreCaja } from '../services/printer'


// ── Denomination rows ─────────────────────────────────────────────────────────
const BILLS = [
  { label: 'RD$2,000', value: 2000 },
  { label: 'RD$1,000', value: 1000 },
  { label: 'RD$500',   value: 500  },
  { label: 'RD$200',   value: 200  },
  { label: 'RD$100',   value: 100  },
  { label: 'RD$50',    value: 50   },
  { label: 'RD$25',    value: 25   },
  { label: 'RD$20',    value: 20   },
  { label: 'RD$10',    value: 10   },
  { label: 'RD$5',     value: 5    },
  { label: 'RD$1',     value: 1    },
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
  return <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">{children}</p>
}

function ResumeRow({ label, value, bold, indent, muted, divider }) {
  if (divider) return <hr className="my-2 border-slate-100" />
  return (
    <div className={`flex justify-between items-center py-[3px] ${indent ? 'pl-3' : ''}`}>
      <span className={`text-sm ${bold ? 'font-semibold text-slate-800' : muted ? 'text-slate-400' : 'text-slate-600'}`}>
        {label}
      </span>
      <span className={`text-sm tabular-nums ${bold ? 'font-bold text-slate-900' : muted ? 'text-slate-400' : 'text-slate-700'}`}>
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
      className={`w-16 text-right border border-slate-200 rounded px-1.5 py-1 md:py-0.5 text-sm min-h-[44px] md:min-h-0 focus:outline-none focus:ring-1 focus:ring-blue-400 ${className}`}
    />
  )
}

function RightInput({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-sm text-slate-600 truncate">{label}</span>
      <input
        type="number"
        min="0"
        value={value || ''}
        onChange={e => onChange(Number(e.target.value) || 0)}
        placeholder="0"
        className="w-28 text-right border border-slate-200 rounded px-2 py-1 md:py-0.5 text-sm min-h-[44px] md:min-h-0 focus:outline-none focus:ring-1 focus:ring-blue-400"
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
    } catch {
      setErr(true); setPin('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl p-6 md:p-8 w-full max-w-sm mx-4">
        <div className="flex items-center gap-2 mb-6">
          <Lock size={18} className="text-slate-500" />
          <h3 className="font-semibold text-slate-800">{L('Autorización de Gerente', 'Manager Authorization')}</h3>
        </div>
        <p className="text-sm text-slate-500 mb-4">{L('Ingrese el PIN del gerente para cerrar la caja.', 'Enter manager PIN to close the register.')}</p>
        <input
          ref={inputRef}
          type="password"
          maxLength={6}
          value={pin}
          onChange={e => { setPin(e.target.value); setErr(false) }}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder="••••"
          className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-center text-xl tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {err && <p className="text-xs text-red-500 mt-2 text-center">{L('PIN incorrecto o sin permisos', 'Incorrect PIN or insufficient permissions')}</p>}
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">
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
    }).catch(() => { /* reprint errors are non-critical in history panel */ })
  }

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full md:w-[500px] bg-white shadow-2xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
        <h3 className="text-[14px] md:text-[16px] font-bold text-slate-800">{L('Historial de Cierres', 'Closing History')}</h3>
        <button onClick={onClose} className="p-1 rounded hover:bg-slate-100">
          <X size={18} className="text-slate-500" />
        </button>
      </div>

      {/* Filters */}
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <div className="flex flex-col gap-0.5 flex-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{L('Desde', 'From')}</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
        <div className="flex flex-col gap-0.5 flex-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{L('Hasta', 'To')}</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
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
          <div className="flex items-center justify-center h-20 gap-2 text-slate-400">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">{L('Cargando…', 'Loading…')}</span>
          </div>
        )}
        {!loading && history.length === 0 && (
          <div className="text-center text-slate-400 text-sm py-10">{L('Sin cierres en el período', 'No closings in period')}</div>
        )}
        {!loading && history.map((c, i) => {
          const diff      = c.diferencia ?? 0
          const cuadrada  = Math.abs(diff) < 1
          const isOpen    = expanded === i
          const storedQty = isOpen ? JSON.parse(c.denominaciones || '{}') : {}
          return (
            <div key={i} className={`rounded-xl border ${cuadrada ? 'border-emerald-100' : 'border-red-100'}`}>
              {/* Row header */}
              <div
                className={`flex items-center gap-3 px-4 py-3 cursor-pointer rounded-xl ${cuadrada ? 'bg-emerald-50/40 hover:bg-emerald-50' : 'bg-red-50/40 hover:bg-red-50'}`}
                onClick={() => setExpanded(isOpen ? null : i)}
              >
                <ChevronDown size={15} className={`text-slate-400 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-slate-800">{c.date}</span>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${cuadrada ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                      {cuadrada ? L('Cuadrada', 'Balanced') : `${L('Desc.', 'Diff.')} ${fmt(diff)}`}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{c.cajero_name || '—'}</p>
                </div>
                <span className="text-sm font-bold text-slate-800 tabular-nums flex-shrink-0">{fmt(c.cierre_total || 0)}</span>
              </div>

              {/* Expanded detail */}
              {isOpen && (
                <div className="px-4 pb-4 pt-2 space-y-3 border-t border-slate-100">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <span className="text-slate-500">{L('Fondo de caja', 'Opening float')}</span>
                    <span className="text-right tabular-nums text-slate-800">{fmt(c.fondo)}</span>
                    <span className="text-slate-500">{L('Efectivo contado', 'Cash counted')}</span>
                    <span className="text-right tabular-nums text-slate-800">{fmt(c.efectivo_conteo)}</span>
                    <span className="text-slate-500">{L('Efectivo sistema', 'System cash')}</span>
                    <span className="text-right tabular-nums text-slate-800">{fmt(c.efectivo_sistema)}</span>
                    <span className="text-slate-500">{L('Tarjeta', 'Card')}</span>
                    <span className="text-right tabular-nums text-slate-800">{fmt(c.tarjeta)}</span>
                    <span className="text-slate-500">{L('Transferencia', 'Transfer')}</span>
                    <span className="text-right tabular-nums text-slate-800">{fmt(c.transferencia)}</span>
                    <span className="text-slate-500">{L('Cheque', 'Check')}</span>
                    <span className="text-right tabular-nums text-slate-800">{fmt(c.cheque)}</span>
                    <span className="text-slate-500">{L('F. A Créditos', 'Credits')}</span>
                    <span className="text-right tabular-nums text-slate-800">{fmt(c.creditos)}</span>
                    <span className="text-slate-500">{L('Salidas', 'Outflows')}</span>
                    <span className="text-right tabular-nums text-red-600">{fmt(c.salidas)}</span>
                    <hr className="col-span-2 border-slate-100 my-1" />
                    <span className="font-semibold text-slate-700">{L('Total vendido', 'Total sold')}</span>
                    <span className="text-right tabular-nums font-semibold text-slate-800">{fmt(c.total_vendido)}</span>
                    <span className="font-semibold text-slate-700">{L('Total cobrado', 'Total collected')}</span>
                    <span className="text-right tabular-nums font-semibold text-slate-800">{fmt(c.total_cobrado)}</span>
                    <span className="font-bold text-slate-800">{L('Cierre total', 'Closing total')}</span>
                    <span className="text-right tabular-nums font-bold text-slate-900">{fmt(c.cierre_total)}</span>
                    <span className={`font-bold ${cuadrada ? 'text-emerald-700' : 'text-red-600'}`}>{L('Diferencia', 'Difference')}</span>
                    <span className={`text-right tabular-nums font-bold ${cuadrada ? 'text-emerald-700' : 'text-red-600'}`}>
                      {diff === 0 ? 'RD$0.00' : (diff > 0 ? '+' : '') + fmt(diff)}
                    </span>
                  </div>

                  {/* Denominaciones */}
                  {BILLS.some(b => storedQty[b.value] > 0) && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">{L('Conteo de efectivo', 'Cash count')}</p>
                      <div className="space-y-0.5">
                        {BILLS.filter(b => storedQty[b.value] > 0).map(b => (
                          <div key={b.value} className="flex justify-between text-xs text-slate-600">
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
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">{L('Comentario', 'Note')}</p>
                      <p className="text-xs text-slate-600 italic">{c.comentario}</p>
                    </div>
                  )}

                  <button onClick={() => handleReprint(c)}
                    className="flex items-center gap-1.5 w-full justify-center py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
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

  // Denomination qtys
  const [qty, setQty]             = useState({ ...EMPTY_QTY })
  const [usdQty, setUsdQty]       = useState(0)
  const [usdRate, setUsdRate]     = useState(59.50)

  // Right column inputs
  const [vAzul, setVAzul]             = useState(0)
  const [vCarnet, setVCarnet]         = useState(0)
  const [vVisanet, setVVisanet]       = useState(0)
  const [cheque, setCheque]           = useState(0)
  const [transferencia, setTrans]     = useState(0)
  const [documento, setDoc]           = useState(0)
  const [fACreditos, setFACreditos]   = useState(0)
  const [avances, setAvances]         = useState(0)
  const [devoluciones, setDevoluciones] = useState(0)
  const [desembolsos, setDesembolsos] = useState(0)
  const [comision, setComision]       = useState(0)

  // Load business info for print header
  useEffect(() => {
    api.admin.getEmpresa().then(setBiz).catch(() => flash(L('Error al cargar empresa', 'Error loading business')))
  }, [])

  // Clock tick
  useEffect(() => {
    const id = setInterval(() => setTime(nowStr()), 1000)
    return () => clearInterval(id)
  }, [])

  // Load daily summary on mount
  useEffect(() => {
    api.cuadre.daily(todayISO())
      .then(data => {
        if (data) setDaySummary(data)
        // Pre-fill transferencia and tarjeta from DB summary
        if (data?.tarjeta)      setVAzul(data.tarjeta)
        if (data?.transferencia) setTrans(data.transferencia)
        if (data?.cheque)       setCheque(data.cheque)
        if (data?.credito)      setFACreditos(data.credito)
      })
      .catch(() => flash(L('Error al cargar resumen del dia', 'Error loading daily summary')))
      .finally(() => setLoadingDay(false))
  }, [])

  // ── Derived totals ────────────────────────────────────────────────────────
  const efectivoBills  = BILLS.reduce((s, b) => s + b.value * (qty[b.value] || 0), 0)
  const efectivoUSD    = usdQty * usdRate
  const efectivoNeto   = efectivoBills + efectivoUSD - fondo

  const tarjetasTotal  = vAzul + vCarnet + vVisanet
  const transTotal     = cheque + transferencia + documento
  const salidasTotal   = avances + devoluciones + desembolsos + comision

  const cierreTotal    = efectivoNeto + tarjetasTotal + transTotal + fACreditos - salidasTotal
  const diferencia     = cierreTotal - (daySummary.totalCobrado || 0)
  const cuadrada       = Math.abs(diferencia) < 1

  function buildPrintPayload() {
    return {
      biz:    biz || {},
      cajero: user?.name || '—',
      day: {
        efectivo:      daySummary.efectivo     || 0,
        tarjeta:       tarjetasTotal,
        documento:     documento,
        cheque:        cheque,
        transferencia: transferencia,
        totalVendido:  daySummary.totalVendido || 0,
        totalCobrado:  daySummary.totalCobrado || 0,
      },
      denominaciones: BILLS.map(b => ({ label: b.label, qty: qty[b.value] || 0, label_val: b.value })),
      efectivoNeto,
      cierreTotal,
      diferencia,
    }
  }

  function doPrint() {
    printCuadreCaja(buildPrintPayload()).catch(() => flash(L('Error al imprimir cuadre', 'Error printing reconciliation')))
  }

  function handleCuadrar() {
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
      efectivo_conteo:  efectivoBills + efectivoUSD,
      efectivo_sistema: daySummary.efectivo || 0,
      tarjeta:          tarjetasTotal,
      transferencia:    transTotal,
      cheque:           cheque,
      creditos:         fACreditos,
      salidas:          salidasTotal,
      total_vendido:    daySummary.totalVendido || 0,
      total_cobrado:    daySummary.totalCobrado || 0,
      cierre_total:     cierreTotal,
      diferencia:       diferencia,
      comentario:       comentario || null,
      denominaciones:   qty,
    }
    try {
      await api.cuadre.create(closeData)
      setManagerName(manager?.name ?? null)
      setClosed(true)
      doPrint()
    } catch (err) {
      console.error('cuadre:create error', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full flex flex-col bg-slate-50">
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
      <div className="bg-white border-b border-slate-200 px-3 md:px-6 py-3 flex-shrink-0">
        <div className="flex flex-wrap items-center gap-3 md:gap-6">
          <div className="flex-1 min-w-[120px]">
            <p className="text-xs text-slate-400 uppercase tracking-wider">{L('Cajero', 'Cashier')}</p>
            <p className="font-semibold text-slate-800 text-sm md:text-base">{user?.name ?? L('Caja', 'Register')}</p>
          </div>
          <div className="hidden md:block flex-1">
            <p className="text-xs text-slate-400 uppercase tracking-wider">{L('Fecha', 'Date')}</p>
            <p className="font-medium text-slate-700 capitalize text-sm">{todayStr()}</p>
          </div>
          <div className="w-20 md:w-32 text-center">
            <p className="text-xs text-slate-400 uppercase tracking-wider">{L('Hora', 'Time')}</p>
            <p className="font-mono font-semibold text-slate-800 text-sm md:text-base">{time}</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 whitespace-nowrap hidden md:inline">{L('Fondo de caja', 'Opening float')}</label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">RD$</span>
              <input
                type="number"
                value={fondo}
                onChange={e => setFondo(Number(e.target.value) || 0)}
                className="w-28 pl-8 pr-2 py-1.5 min-h-[44px] md:min-h-0 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>
          <button
            onClick={() => setShowHistory(true)}
            className="flex items-center gap-1.5 text-sm text-slate-600 border border-slate-200 px-3 py-1.5 min-h-[44px] md:min-h-0 rounded-lg hover:bg-slate-50"
          >
            <History size={15} />
            <span className="hidden md:inline">{L('Ver Cierres', 'View History')}</span>
            <span className="md:hidden">{L('Cierres', 'History')}</span>
          </button>
        </div>
      </div>

      {/* ── Two-column layout ── */}
      <div className="flex-1 overflow-hidden p-2 md:p-4 flex flex-col md:flex-row gap-3 md:gap-4 min-h-0 overflow-y-auto md:overflow-hidden">

        {/* LEFT: Day summary + Cash count */}
        <div className="flex flex-col gap-3 md:w-[48%] md:overflow-y-auto min-h-0 shrink-0">

          {/* Resumen del día */}
          <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm flex-shrink-0">
            <SectionLabel>{L('Resumen del día', "Day's Summary")}</SectionLabel>
            {loadingDay ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
                <Loader2 size={14} className="animate-spin" />
                {L('Cargando…', 'Loading…')}
              </div>
            ) : (
              <>
                <ResumeRow label={L('Efectivo', 'Cash')}                 value={fmt(daySummary.efectivo)} />
                <ResumeRow label={L('Tarjeta', 'Card')}                  value={fmt(daySummary.tarjeta)} />
                <ResumeRow label={L('Transferencia', 'Transfer')}        value={fmt(daySummary.transferencia)} />
                <ResumeRow label={L('Cheque', 'Check')}                  value={fmt(daySummary.cheque)} />
                <ResumeRow divider />
                <ResumeRow label={L('Créditos', 'Credits')}              value={fmt(daySummary.credito)} muted />
                <ResumeRow divider />
                <ResumeRow label={L('Total Vendido', 'Total Sold')}      value={fmt(daySummary.totalVendido)} bold />
                <ResumeRow label={L('Total Cobrado', 'Total Collected')} value={fmt(daySummary.totalCobrado)} bold />
              </>
            )}
          </div>

          {/* Conteo de Efectivo */}
          <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm flex-shrink-0">
            <SectionLabel>{L('Conteo de Efectivo', 'Cash Count')}</SectionLabel>

            <div className="flex items-center justify-between mb-1 pb-1 border-b border-slate-100">
              <span className="text-xs text-slate-400 flex-1">{L('Denominación', 'Denomination')}</span>
              <span className="text-xs text-slate-400 w-14 text-right">{L('Cant.', 'Qty.')}</span>
              <span className="text-xs text-slate-400 w-24 text-right">{L('Monto', 'Amount')}</span>
            </div>

            {BILLS.map(b => {
              const amount = b.value * (qty[b.value] || 0)
              return (
                <div key={b.value} className="flex items-center justify-between py-0.5">
                  <span className="text-sm text-slate-700 flex-1">{b.label}</span>
                  <SmallInput
                    value={qty[b.value] || 0}
                    onChange={v => setQty(q => ({ ...q, [b.value]: v }))}
                    className="w-14"
                  />
                  <span className="text-sm tabular-nums text-slate-700 w-24 text-right">
                    {amount > 0 ? fmt(amount) : <span className="text-slate-300">—</span>}
                  </span>
                </div>
              )
            })}

            {/* USD row */}
            <div className="mt-2 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between py-0.5">
                <span className="text-sm text-slate-700 flex-1">USD</span>
                <SmallInput value={usdQty} onChange={setUsdQty} className="w-14" />
                <span className="text-sm tabular-nums text-slate-700 w-24 text-right">
                  {usdQty > 0 ? fmtUSD(usdQty) : <span className="text-slate-300">—</span>}
                </span>
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-xs text-slate-400">{L('Tasa', 'Rate')}: {fmt(usdRate)}</span>
                <span className="text-xs tabular-nums text-slate-500">
                  {usdQty > 0 ? `≈ ${fmt(efectivoUSD)}` : ''}
                </span>
              </div>
            </div>

            {/* Blue summary box */}
            <div className="mt-3 rounded-xl bg-blue-50 border border-blue-200 p-3 space-y-1">
              <div className="flex justify-between">
                <span className="text-sm text-blue-700">{L('Efectivo RD$', 'Cash RD$')}</span>
                <span className="text-sm font-bold text-blue-800 tabular-nums">{fmt(efectivoBills)}</span>
              </div>
              {usdQty > 0 && (
                <div className="flex justify-between">
                  <span className="text-sm text-blue-700">{L('Efectivo USD', 'Cash USD')}</span>
                  <span className="text-sm font-bold text-blue-800 tabular-nums">{fmtUSD(usdQty)} ≈ {fmt(efectivoUSD)}</span>
                </div>
              )}
              <hr className="border-blue-200" />
              <div className="flex justify-between">
                <span className="text-sm font-semibold text-blue-700">{L('Total efectivo', 'Total cash')}</span>
                <span className="text-sm font-bold text-blue-900 tabular-nums">{fmt(efectivoBills + efectivoUSD)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-blue-500">− {L('Fondo de caja', 'Opening float')}</span>
                <span className="text-xs text-blue-500 tabular-nums">− {fmt(fondo)}</span>
              </div>
              <div className="flex justify-between pt-0.5 border-t border-blue-200">
                <span className="text-sm font-bold text-blue-800">{L('Efectivo neto', 'Net cash')}</span>
                <span className="text-sm font-bold text-blue-900 tabular-nums">{fmt(efectivoNeto)}</span>
              </div>
            </div>
          </div>

        </div>

        {/* RIGHT: Cards + Transfers + Outflows + Closing + Comment */}
        <div className="flex flex-col gap-3 flex-1 md:overflow-y-auto min-h-0">

          {/* Tarjetas */}
          <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm flex-shrink-0">
            <SectionLabel>{L('Tarjetas', 'Cards')}</SectionLabel>
            <RightInput label="V. Azul"    value={vAzul}    onChange={setVAzul} />
            <RightInput label="V. Carnet"  value={vCarnet}  onChange={setVCarnet} />
            <RightInput label="V. Visanet" value={vVisanet} onChange={setVVisanet} />
            <div className="flex justify-between pt-2 mt-1 border-t border-slate-100">
              <span className="text-sm font-semibold text-slate-700">{L('Total tarjetas', 'Total cards')}</span>
              <span className="text-sm font-bold text-slate-800 tabular-nums">{fmt(tarjetasTotal)}</span>
            </div>
          </div>

          {/* Documentos y Transferencias */}
          <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm flex-shrink-0">
            <SectionLabel>{L('Documentos y Transferencias', 'Documents & Transfers')}</SectionLabel>
            <RightInput label={L('Cheque', 'Check')}           value={cheque}        onChange={setCheque} />
            <RightInput label={L('Transferencia', 'Transfer')} value={transferencia} onChange={setTrans} />
            <RightInput label={L('Documento', 'Document')}     value={documento}     onChange={setDoc} />
            <RightInput label={L('F. A Créditos', 'Credits')}  value={fACreditos}    onChange={setFACreditos} />
            <div className="flex justify-between pt-2 mt-1 border-t border-slate-100">
              <span className="text-sm font-semibold text-slate-700">Subtotal</span>
              <span className="text-sm font-bold text-slate-800 tabular-nums">{fmt(transTotal + fACreditos)}</span>
            </div>
          </div>

          {/* Salidas de Caja */}
          <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm flex-shrink-0">
            <SectionLabel>{L('Salidas de Caja', 'Cash Outflows')}</SectionLabel>
            <RightInput label={L('Avances', 'Advances')}          value={avances}      onChange={setAvances} />
            <RightInput label={L('Devoluciones', 'Refunds')}      value={devoluciones} onChange={setDevoluciones} />
            <RightInput label={L('Desembolsos', 'Disbursements')} value={desembolsos}  onChange={setDesembolsos} />
            <RightInput label={L('Comisión', 'Commission')}       value={comision}     onChange={setComision} />
            <div className="flex justify-between pt-2 mt-1 border-t border-slate-100">
              <span className="text-sm font-semibold text-slate-700">{L('Total salidas', 'Total outflows')}</span>
              <span className="text-sm font-bold text-red-600 tabular-nums">{fmt(salidasTotal)}</span>
            </div>
          </div>

          {/* Cierre */}
          <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm flex-shrink-0">
            <SectionLabel>{L('Cierre', 'Closing')}</SectionLabel>
            <ResumeRow label={L('Efectivo neto', 'Net cash')}        value={fmt(efectivoNeto)} />
            <ResumeRow label={L('Tarjetas', 'Cards')}                value={fmt(tarjetasTotal)} />
            <ResumeRow label={L('Transferencias', 'Transfers')}      value={fmt(transTotal)} />
            <ResumeRow label={L('F. A Créditos', 'Credits')}         value={fmt(fACreditos)} />
            <ResumeRow label={L('Salidas', 'Outflows')}              value={fmt(salidasTotal)} muted />
            <ResumeRow divider />
            <ResumeRow label={L('Total Cobrado', 'Total Collected')} value={fmt(cierreTotal)} bold />

            <div className={`mt-3 rounded-xl p-3 flex items-center gap-2 ${cuadrada ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
              {cuadrada
                ? <CheckCircle2 size={18} className="text-emerald-600 flex-shrink-0" />
                : <AlertCircle  size={18} className="text-red-500 flex-shrink-0" />
              }
              <div>
                <p className={`text-sm font-bold ${cuadrada ? 'text-emerald-700' : 'text-red-600'}`}>
                  {cuadrada
                    ? L('Caja cuadrada', 'Balanced')
                    : `${L('Descuadre', 'Difference')} ${fmt(Math.abs(diferencia))}`}
                </p>
                <p className={`text-xs ${cuadrada ? 'text-emerald-500' : 'text-red-400'}`}>
                  {cuadrada
                    ? 'RD$0.00'
                    : diferencia > 0
                    ? L('Sobrante en caja', 'Cash over')
                    : L('Faltante en caja', 'Cash short')}
                </p>
              </div>
            </div>
          </div>

          {/* Comentario */}
          <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm flex-shrink-0">
            <SectionLabel>{L('Comentario', 'Comments')}</SectionLabel>
            <textarea
              value={comentario}
              onChange={e => setComentario(e.target.value)}
              placeholder={L('Observaciones del cierre…', 'Closing observations…')}
              rows={2}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
            />
          </div>

        </div>
      </div>

      {/* ── Footer ── */}
      <div className="bg-white border-t border-slate-100 px-3 md:px-6 py-3 flex-shrink-0">
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <button
            onClick={() => printerApi?.openDrawer?.().catch?.(() => {})}
            className="flex items-center gap-1.5 px-3 md:px-5 py-2 min-h-[44px] md:min-h-0 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50"
          >
            <DollarSign size={15} />
            <span className="hidden md:inline">{L('Abrir Cajón', 'Open Drawer')}</span>
            <span className="md:hidden">{L('Cajón', 'Drawer')}</span>
          </button>
          <button
            className="hidden md:flex items-center gap-1.5 px-5 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50"
          >
            <Calculator size={15} />
            {L('Calcular', 'Calculate')}
          </button>
          <button
            disabled={closed}
            className="hidden md:block px-5 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            {L('Cancelar', 'Cancel')}
          </button>

          <div className="flex-1" />

          <button
            onClick={doPrint}
            className="flex items-center gap-1.5 px-3 md:px-5 py-2 min-h-[44px] md:min-h-0 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50"
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
