import { useState, useEffect, useRef } from 'react'
import {
  CheckCircle2, AlertCircle, ChevronRight, X, History,
  Printer, Calculator, DollarSign, Lock,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../i18n'

// ── Demo day summary (replace with real DB queries) ─────────────────────────
const DAY = {
  efectivo:       12400,
  tarjeta:        18750,
  documento:       3200,
  cheque:          1500,
  transferencia:   8600,
  creditosOtorg:   6800,
  cxcPendiente:    4200,
  reciboAnticipo:  1000,
  totalVendido:   51250,
  totalCobrado:   44450,
}

// ── Denomination rows ────────────────────────────────────────────────────────
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

// Default qty that yields efectivo matching DAY.efectivo (demo green state)
// 4×2000 + 8×1000 + 4×500 + 5×200 + 4×100 + 4×50 + 0+... = 8000+8000+2000+1000+400+200 = don't try to match exactly
// Instead pre-fill a realistic count; live cierre will show diff
const DEFAULT_QTY = {
  2000: 4,   // 8,000
  1000: 2,   // 2,000
  500:  2,   // 1,000
  200:  5,   // 1,000
  100:  3,   //   300
  50:   2,   //   100
  25:   0,
  20:   0,
  10:   0,
  5:    0,
  1:    0,
}
// = 12,400 → matches DAY.efectivo → caja cuadrada demo

// ── Past closings (demo) ─────────────────────────────────────────────────────
const PAST_CIERRES = [
  { date: '2026-03-16', cashier: 'María Rodríguez', total: 42800, diff:    0, estado: 'cuadrada' },
  { date: '2026-03-15', cashier: 'María Rodríguez', total: 38500, diff: -200, estado: 'descuadre' },
  { date: '2026-03-14', cashier: 'Carlos Díaz',     total: 51200, diff:    0, estado: 'cuadrada' },
  { date: '2026-03-13', cashier: 'María Rodríguez', total: 44100, diff:  150, estado: 'descuadre' },
  { date: '2026-03-12', cashier: 'Carlos Díaz',     total: 47600, diff:    0, estado: 'cuadrada' },
]

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n) {
  return 'RD$' + Number(n).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtUSD(n) {
  return 'US$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function now() {
  return new Date().toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
function today() {
  return new Date().toLocaleDateString('es-DO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

// ── Sub-components ───────────────────────────────────────────────────────────
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
      className={`w-16 text-right border border-slate-200 rounded px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 ${className}`}
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
        className="w-28 text-right border border-slate-200 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
    </div>
  )
}

// ── PIN Modal ────────────────────────────────────────────────────────────────
function PinModal({ onConfirm, onClose }) {
  const [pin, setPin]     = useState('')
  const [err, setErr]     = useState(false)
  const inputRef          = useRef()

  useEffect(() => { inputRef.current?.focus() }, [])

  function submit() {
    if (pin === '1111') { onConfirm() }
    else { setErr(true); setPin('') }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-80">
        <div className="flex items-center gap-2 mb-6">
          <Lock size={18} className="text-slate-500" />
          <h3 className="font-semibold text-slate-800">Autorización de Gerente</h3>
        </div>
        <p className="text-sm text-slate-500 mb-4">Ingrese el PIN del gerente para cerrar la caja.</p>
        <input
          ref={inputRef}
          type="password"
          maxLength={4}
          value={pin}
          onChange={e => { setPin(e.target.value); setErr(false) }}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder="••••"
          className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-center text-xl tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {err && <p className="text-xs text-red-500 mt-2 text-center">PIN incorrecto</p>}
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">
            Cancelar
          </button>
          <button onClick={submit} className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
            Confirmar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── History Panel ────────────────────────────────────────────────────────────
function CierresPanel({ onClose }) {
  return (
    <div className="fixed inset-y-0 right-0 z-40 w-[420px] bg-white shadow-2xl flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <h3 className="font-semibold text-slate-800">Historial de Cierres</h3>
        <button onClick={onClose} className="p-1 rounded hover:bg-slate-100">
          <X size={18} className="text-slate-500" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {PAST_CIERRES.map((c, i) => (
          <div key={i} className={`rounded-xl border p-4 ${c.estado === 'cuadrada' ? 'border-emerald-100 bg-emerald-50/40' : 'border-red-100 bg-red-50/40'}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium text-sm text-slate-800">{c.date}</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${c.estado === 'cuadrada' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                {c.estado === 'cuadrada' ? 'Cuadrada' : `Descuadre ${fmt(c.diff)}`}
              </span>
            </div>
            <p className="text-xs text-slate-500">{c.cashier}</p>
            <p className="text-sm font-bold text-slate-800 mt-1">{fmt(c.total)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function CashReconciliation() {
  const { user } = useAuth()
  const [time, setTime]       = useState(now())
  const [fondo, setFondo]     = useState(5000)
  const [comentario, setComentario] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [closed, setClosed]   = useState(false)

  // Denomination qtys
  const [qty, setQty] = useState({ ...DEFAULT_QTY })
  const [usdQty, setUsdQty]       = useState(0)
  const [usdRate, setUsdRate]     = useState(59.50)   // from settings stub

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

  // Clock tick
  useEffect(() => {
    const id = setInterval(() => setTime(now()), 1000)
    return () => clearInterval(id)
  }, [])

  // ── Derived totals ──────────────────────────────────────────────────────
  const efectivoBills  = BILLS.reduce((s, b) => s + b.value * (qty[b.value] || 0), 0)
  const efectivoUSD    = usdQty * usdRate
  const efectivoNeto   = efectivoBills + efectivoUSD - fondo

  const tarjetasTotal  = vAzul + vCarnet + vVisanet
  const transTotal     = cheque + transferencia + documento
  const salidasTotal   = avances + devoluciones + desembolsos + comision

  const cierreTotal    = efectivoNeto + tarjetasTotal + transTotal + fACreditos - salidasTotal
  const diferencia     = cierreTotal - DAY.totalCobrado
  const cuadrada       = Math.abs(diferencia) < 1

  function handleCuadrar() {
    if (user?.role === 'cashier') { setShowPin(true) }
    else { doClose() }
  }
  function doClose() {
    setShowPin(false)
    setClosed(true)
  }

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* PIN Modal */}
      {showPin && <PinModal onConfirm={doClose} onClose={() => setShowPin(false)} />}

      {/* History Panel */}
      {showHistory && (
        <>
          <div className="fixed inset-0 z-30 bg-black/20" onClick={() => setShowHistory(false)} />
          <CierresPanel onClose={() => setShowHistory(false)} />
        </>
      )}

      {/* Closed Banner */}
      {closed && (
        <div className="bg-emerald-600 text-white text-center py-2 text-sm font-medium flex items-center justify-center gap-2">
          <CheckCircle2 size={16} />
          Caja cerrada exitosamente el {today()} a las {time}
        </div>
      )}

      {/* ── Top Bar ── */}
      <div className="bg-white border-b border-slate-100 px-6 py-3 flex items-center gap-6 flex-shrink-0">
        <div className="flex-1">
          <p className="text-xs text-slate-400 uppercase tracking-wider">Cajero</p>
          <p className="font-semibold text-slate-800">{user?.name ?? 'Caja'}</p>
        </div>
        <div className="flex-1">
          <p className="text-xs text-slate-400 uppercase tracking-wider">Fecha</p>
          <p className="font-medium text-slate-700 capitalize text-sm">{today()}</p>
        </div>
        <div className="w-32 text-center">
          <p className="text-xs text-slate-400 uppercase tracking-wider">Hora</p>
          <p className="font-mono font-semibold text-slate-800">{time}</p>
        </div>
        <div className="flex items-center gap-2 ml-4">
          <label className="text-xs text-slate-500 whitespace-nowrap">Fondo de caja</label>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">RD$</span>
            <input
              type="number"
              value={fondo}
              onChange={e => setFondo(Number(e.target.value) || 0)}
              className="w-28 pl-8 pr-2 py-1.5 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
        </div>
        <button
          onClick={() => setShowHistory(true)}
          className="flex items-center gap-1.5 text-sm text-slate-600 border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-50"
        >
          <History size={15} />
          Ver Cierres
        </button>
      </div>

      {/* ── 3-Column Body ── */}
      <div className="flex-1 overflow-hidden flex gap-4 p-4">

        {/* ── LEFT: Resumen + Cierre ── */}
        <div className="w-72 flex flex-col gap-4 overflow-y-auto">

          {/* Resumen del día */}
          <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
            <SectionLabel>Resumen del día</SectionLabel>
            <ResumeRow label="Efectivo"            value={fmt(DAY.efectivo)} />
            <ResumeRow label="Tarjeta"             value={fmt(DAY.tarjeta)} />
            <ResumeRow label="Documento"           value={fmt(DAY.documento)} />
            <ResumeRow label="Cheque"              value={fmt(DAY.cheque)} />
            <ResumeRow label="Transferencia"       value={fmt(DAY.transferencia)} />
            <ResumeRow divider />
            <ResumeRow label="Créditos Otorgados"  value={fmt(DAY.creditosOtorg)}   muted />
            <ResumeRow label="Cuentas x Cobrar"    value={fmt(DAY.cxcPendiente)}    muted />
            <ResumeRow label="Recibo Anticipo"     value={fmt(DAY.reciboAnticipo)}  muted />
            <ResumeRow divider />
            <ResumeRow label="Total Vendido"       value={fmt(DAY.totalVendido)}    bold />
            <ResumeRow label="Total Cobrado"       value={fmt(DAY.totalCobrado)}    bold />
          </div>

          {/* Cierre */}
          <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
            <SectionLabel>Cierre</SectionLabel>
            <ResumeRow label="Efectivo neto"   value={fmt(efectivoNeto)} />
            <ResumeRow label="Tarjetas"        value={fmt(tarjetasTotal)} />
            <ResumeRow label="Transferencias"  value={fmt(transTotal)} />
            <ResumeRow label="F. A Créditos"   value={fmt(fACreditos)} />
            <ResumeRow label="Salidas"         value={fmt(salidasTotal)} muted />
            <ResumeRow divider />
            <ResumeRow label="Total Cobrado"   value={fmt(cierreTotal)} bold />

            {/* Difference box */}
            <div className={`mt-3 rounded-xl p-3 flex items-center gap-2 ${cuadrada ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
              {cuadrada
                ? <CheckCircle2 size={18} className="text-emerald-600 flex-shrink-0" />
                : <AlertCircle  size={18} className="text-red-500 flex-shrink-0" />
              }
              <div>
                <p className={`text-sm font-bold ${cuadrada ? 'text-emerald-700' : 'text-red-600'}`}>
                  {cuadrada ? 'Caja cuadrada' : `Descuadre ${fmt(Math.abs(diferencia))}`}
                </p>
                <p className={`text-xs ${cuadrada ? 'text-emerald-500' : 'text-red-400'}`}>
                  {cuadrada ? 'RD$0.00 de diferencia' : diferencia > 0 ? 'Sobrante en caja' : 'Faltante en caja'}
                </p>
              </div>
            </div>
          </div>

          {/* Comentario */}
          <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
            <SectionLabel>Comentario</SectionLabel>
            <textarea
              value={comentario}
              onChange={e => setComentario(e.target.value)}
              placeholder="Observaciones del cierre..."
              rows={3}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
            />
          </div>
        </div>

        {/* ── CENTER: Conteo de Efectivo ── */}
        <div className="w-72 flex flex-col gap-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm flex-1">
            <SectionLabel>Conteo de Efectivo</SectionLabel>

            {/* Header */}
            <div className="flex items-center justify-between mb-2 pb-1 border-b border-slate-100">
              <span className="text-xs text-slate-400 w-24">Denominación</span>
              <span className="text-xs text-slate-400 w-16 text-right">Cant.</span>
              <span className="text-xs text-slate-400 w-24 text-right">Monto</span>
            </div>

            {BILLS.map(b => {
              const amount = b.value * (qty[b.value] || 0)
              return (
                <div key={b.value} className="flex items-center justify-between py-1">
                  <span className="text-sm text-slate-700 w-24">{b.label}</span>
                  <SmallInput
                    value={qty[b.value] || 0}
                    onChange={v => setQty(q => ({ ...q, [b.value]: v }))}
                    className="w-16"
                  />
                  <span className="text-sm tabular-nums text-slate-700 w-24 text-right">
                    {amount > 0 ? fmt(amount) : <span className="text-slate-300">—</span>}
                  </span>
                </div>
              )
            })}

            {/* USD row */}
            <div className="mt-3 pt-3 border-t border-slate-100">
              <div className="flex items-center justify-between py-1">
                <span className="text-sm text-slate-700 w-24">USD</span>
                <SmallInput
                  value={usdQty}
                  onChange={setUsdQty}
                  className="w-16"
                />
                <span className="text-sm tabular-nums text-slate-700 w-24 text-right">
                  {usdQty > 0 ? fmtUSD(usdQty) : <span className="text-slate-300">—</span>}
                </span>
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-xs text-slate-400">Tasa: {fmt(usdRate)}</span>
                <span className="text-xs tabular-nums text-slate-500">
                  {usdQty > 0 ? `≈ ${fmt(efectivoUSD)}` : ''}
                </span>
              </div>
            </div>

            {/* Blue summary box */}
            <div className="mt-4 rounded-xl bg-blue-50 border border-blue-200 p-3 space-y-1">
              <div className="flex justify-between">
                <span className="text-sm text-blue-700">Efectivo RD$</span>
                <span className="text-sm font-bold text-blue-800 tabular-nums">{fmt(efectivoBills)}</span>
              </div>
              {usdQty > 0 && (
                <div className="flex justify-between">
                  <span className="text-sm text-blue-700">Efectivo USD</span>
                  <span className="text-sm font-bold text-blue-800 tabular-nums">{fmtUSD(usdQty)} ≈ {fmt(efectivoUSD)}</span>
                </div>
              )}
              <hr className="border-blue-200" />
              <div className="flex justify-between">
                <span className="text-sm font-semibold text-blue-700">Total efectivo</span>
                <span className="text-sm font-bold text-blue-900 tabular-nums">{fmt(efectivoBills + efectivoUSD)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-blue-500">− Fondo de caja</span>
                <span className="text-xs text-blue-500 tabular-nums">− {fmt(fondo)}</span>
              </div>
              <div className="flex justify-between pt-0.5 border-t border-blue-200">
                <span className="text-sm font-bold text-blue-800">Efectivo neto</span>
                <span className="text-sm font-bold text-blue-900 tabular-nums">{fmt(efectivoNeto)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── RIGHT: Otros Ingresos / Salidas ── */}
        <div className="flex-1 flex flex-col gap-4 overflow-y-auto min-w-0">

          {/* Tarjetas */}
          <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
            <SectionLabel>Tarjetas</SectionLabel>
            <RightInput label="V. Azul"    value={vAzul}    onChange={setVAzul} />
            <RightInput label="V. Carnet"  value={vCarnet}  onChange={setVCarnet} />
            <RightInput label="V. Visanet" value={vVisanet} onChange={setVVisanet} />
            <div className="flex justify-between pt-2 mt-1 border-t border-slate-100">
              <span className="text-sm font-semibold text-slate-700">Total tarjetas</span>
              <span className="text-sm font-bold text-slate-800 tabular-nums">{fmt(tarjetasTotal)}</span>
            </div>
          </div>

          {/* Documentos y Transferencias */}
          <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
            <SectionLabel>Documentos y Transferencias</SectionLabel>
            <RightInput label="Cheque"        value={cheque}        onChange={setCheque} />
            <RightInput label="Transferencia" value={transferencia} onChange={setTrans} />
            <RightInput label="Documento"     value={documento}     onChange={setDoc} />
            <RightInput label="F. A Créditos" value={fACreditos}   onChange={setFACreditos} />
            <div className="flex justify-between pt-2 mt-1 border-t border-slate-100">
              <span className="text-sm font-semibold text-slate-700">Subtotal</span>
              <span className="text-sm font-bold text-slate-800 tabular-nums">{fmt(transTotal + fACreditos)}</span>
            </div>
          </div>

          {/* Salidas de Caja */}
          <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
            <SectionLabel>Salidas de Caja</SectionLabel>
            <RightInput label="Avances"       value={avances}       onChange={setAvances} />
            <RightInput label="Devoluciones"  value={devoluciones}  onChange={setDevoluciones} />
            <RightInput label="Desembolsos"   value={desembolsos}   onChange={setDesembolsos} />
            <RightInput label="Comisión"      value={comision}      onChange={setComision} />
            <div className="flex justify-between pt-2 mt-1 border-t border-slate-100">
              <span className="text-sm font-semibold text-slate-700">Total salidas</span>
              <span className="text-sm font-bold text-red-600 tabular-nums">{fmt(salidasTotal)}</span>
            </div>
          </div>

          {/* Grand total recap */}
          <div className={`rounded-2xl border p-4 ${cuadrada ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
            <div className="flex justify-between items-center">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-0.5">Total cobrado (cierre)</p>
                <p className={`text-2xl font-bold tabular-nums ${cuadrada ? 'text-emerald-700' : 'text-red-600'}`}>{fmt(cierreTotal)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-500 mb-0.5">Diferencia</p>
                <p className={`text-lg font-bold tabular-nums ${cuadrada ? 'text-emerald-600' : 'text-red-600'}`}>
                  {diferencia === 0 ? 'RD$0.00' : (diferencia > 0 ? '+' : '') + fmt(diferencia)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="bg-white border-t border-slate-100 px-6 py-3 flex items-center gap-3 flex-shrink-0">
        <button
          disabled={closed}
          className="px-5 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          Abrir Caja
        </button>
        <button
          onClick={() => {/* recalculate is live, this is a no-op affordance */}}
          className="flex items-center gap-1.5 px-5 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50"
        >
          <Calculator size={15} />
          Calcular
        </button>
        <button
          disabled={closed}
          className="px-5 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          Cancelar
        </button>

        <div className="flex-1" />

        <button
          disabled={closed}
          className="flex items-center gap-1.5 px-5 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          <Printer size={15} />
          Imprimir
        </button>
        <button
          disabled={closed}
          onClick={handleCuadrar}
          className={`flex items-center gap-1.5 px-6 py-2 rounded-lg text-sm font-semibold text-white transition disabled:opacity-40 ${
            cuadrada ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {user?.role === 'cashier' && <Lock size={14} />}
          Cuadrar / Cerrar Caja
        </button>
      </div>
    </div>
  )
}
