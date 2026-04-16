/**
 * Loans.jsx — Full loan management screen with amortization calculator.
 *
 * Tabs: Activos | Pagados | En Mora | Cancelados | Todos
 * Summary cards, loan table, create modal with live amortization,
 * detail view with payment history + payment registration.
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Landmark, Plus, Search, X, Loader2, Check, ChevronDown, ChevronUp,
  Calendar, DollarSign, AlertTriangle, Clock, Eye, Ban,
  Calculator, CreditCard, FileText, Users, TrendingUp,
  ArrowLeft, Banknote,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtRD(n) {
  return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDate(d) {
  if (!d) return '---'
  return new Date(d).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtDateShort(d) {
  if (!d) return '---'
  return new Date(d).toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: '2-digit' })
}
function addMonths(date, months) {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d.toISOString().split('T')[0]
}
function toISO(d) {
  if (!d) return null
  return new Date(d).toISOString().split('T')[0]
}
function today() {
  return new Date().toISOString().split('T')[0]
}

// ── Amortization math (French / cuota fija) ──────────────────────────────────

function calcMonthlyPayment(principal, monthlyRatePct, termMonths) {
  const P = Number(principal) || 0
  const n = Number(termMonths) || 0
  if (P <= 0 || n <= 0) return 0
  const r = (Number(monthlyRatePct) || 0) / 100
  if (r === 0) return P / n
  return P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1)
}

function generateSchedule(principal, monthlyRatePct, termMonths, disbursedDate) {
  const P = Number(principal) || 0
  const n = Number(termMonths) || 0
  const r = (Number(monthlyRatePct) || 0) / 100
  if (P <= 0 || n <= 0) return []
  const M = r === 0 ? P / n : P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1)
  const schedule = []
  let balance = P
  const startDate = disbursedDate || today()
  for (let i = 1; i <= n; i++) {
    const interest = r === 0 ? 0 : balance * r
    const principalPortion = M - interest
    balance = Math.max(0, balance - principalPortion)
    schedule.push({
      number: i,
      due_date: addMonths(startDate, i),
      principal_portion: Math.round(principalPortion * 100) / 100,
      interest_portion: Math.round(interest * 100) / 100,
      payment: Math.round(M * 100) / 100,
      balance: Math.round(balance * 100) / 100,
    })
  }
  return schedule
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  active:    { label: 'Activo',    bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-300' },
  paid:      { label: 'Pagado',    bg: 'bg-slate-100 dark:bg-white/5',          text: 'text-slate-500 dark:text-white/40' },
  defaulted: { label: 'En Mora',   bg: 'bg-red-50 dark:bg-red-500/10',          text: 'text-red-700 dark:text-red-300' },
  cancelled: { label: 'Cancelado', bg: 'bg-slate-100 dark:bg-white/5',          text: 'text-slate-400 dark:text-white/30' },
}

const PAYMENT_STATUS = {
  on_time: { label: 'A Tiempo',  bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-300' },
  late:    { label: 'Tarde',     bg: 'bg-amber-50 dark:bg-amber-500/10',     text: 'text-amber-700 dark:text-amber-300' },
  partial: { label: 'Parcial',   bg: 'bg-red-50 dark:bg-red-500/10',         text: 'text-red-700 dark:text-red-300' },
}

const TABS = [
  { id: 'active',    label: 'Activos' },
  { id: 'paid',      label: 'Pagados' },
  { id: 'defaulted', label: 'En Mora' },
  { id: 'cancelled', label: 'Cancelados' },
  { id: 'all',       label: 'Todos' },
]

// ── Summary Card ──────────────────────────────────────────────────────────────

function SummaryCard({ icon: Icon, label, value, accent = 'slate' }) {
  const accents = {
    slate:   'text-slate-500 dark:text-white/60',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    amber:   'text-amber-600 dark:text-amber-400',
    red:     'text-red-600 dark:text-red-400',
  }
  return (
    <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 px-4 py-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={14} className={accents[accent]} />
        <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-[18px] font-bold text-slate-800 dark:text-white">{value}</p>
    </div>
  )
}

// ── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status, config = STATUS_CONFIG }) {
  const s = config[status] || config.active
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  )
}

// ── New Loan Modal ────────────────────────────────────────────────────────────

function NewLoanModal({ onClose, onSave }) {
  const api = useAPI()
  const [clients, setClients] = useState([])
  const [loadingClients, setLoadingClients] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [showSchedule, setShowSchedule] = useState(false)

  const [form, setForm] = useState({
    client_id: '',
    principal: '',
    term_months: '',
    interest_rate: '',
    notes: '',
  })

  useEffect(() => {
    api?.clients?.all?.()
      .then(r => { setClients(r || []); setLoadingClients(false) })
      .catch(() => setLoadingClients(false))
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const P = Number(form.principal) || 0
  const n = Number(form.term_months) || 0
  const r = Number(form.interest_rate) || 0
  const M = calcMonthlyPayment(P, r, n)
  const totalRepay = M * n
  const totalInterest = totalRepay - P
  const schedule = useMemo(() => generateSchedule(P, r, n, today()), [P, r, n])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.client_id) { setErr('Selecciona un cliente.'); return }
    if (P <= 0) { setErr('El capital debe ser mayor a 0.'); return }
    if (n <= 0) { setErr('El plazo debe ser mayor a 0.'); return }
    setSaving(true)
    setErr('')
    try {
      await api.loans.create({
        client_id: Number(form.client_id),
        principal: P,
        term_months: n,
        interest_rate: r,
        monthly_payment: Math.round(M * 100) / 100,
        total_interest: Math.round(totalInterest * 100) / 100,
        total_repayment: Math.round(totalRepay * 100) / 100,
        disbursed_at: new Date().toISOString(),
        next_due_date: addMonths(today(), 1),
        status: 'active',
        notes: form.notes.trim() || null,
      })
      onSave()
    } catch (e) {
      setErr(e?.message || 'Error al crear el prestamo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <form onSubmit={handleSubmit}
        className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10 shrink-0">
          <h2 className="text-[15px] font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <Landmark size={16} className="text-emerald-500" />
            Nuevo Prestamo
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
            <X size={16} className="text-slate-400" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Client */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
              Cliente
            </label>
            {loadingClients ? (
              <div className="flex items-center gap-2 text-slate-400 dark:text-white/40 text-sm py-2">
                <Loader2 size={14} className="animate-spin" /> Cargando clientes...
              </div>
            ) : (
              <select value={form.client_id} onChange={e => { set('client_id', e.target.value); setErr('') }} required
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400">
                <option value="">Seleccionar cliente...</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}{c.rnc ? ` (${c.rnc})` : ''}</option>)}
              </select>
            )}
          </div>

          {/* Principal + Term + Rate */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                Capital (RD$)
              </label>
              <input type="number" min="1" step="0.01" value={form.principal}
                onChange={e => { set('principal', e.target.value); setErr('') }}
                placeholder="50,000"
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                Plazo (meses)
              </label>
              <input type="number" min="1" max="360" value={form.term_months}
                onChange={e => { set('term_months', e.target.value); setErr('') }}
                placeholder="12"
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                Tasa Mensual (%)
              </label>
              <input type="number" min="0" step="0.01" value={form.interest_rate}
                onChange={e => { set('interest_rate', e.target.value); setErr('') }}
                placeholder="5"
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
          </div>

          {/* Auto-calculated fields */}
          {P > 0 && n > 0 && (
            <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Calculator size={14} className="text-emerald-600 dark:text-emerald-400" />
                <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">
                  Calculo Automatico
                </p>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-[10px] text-emerald-600/70 dark:text-emerald-400/70 uppercase">Cuota Mensual</p>
                  <p className="text-[16px] font-black text-emerald-700 dark:text-emerald-300">{fmtRD(M)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-emerald-600/70 dark:text-emerald-400/70 uppercase">Total a Pagar</p>
                  <p className="text-[16px] font-bold text-emerald-700 dark:text-emerald-300">{fmtRD(totalRepay)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-emerald-600/70 dark:text-emerald-400/70 uppercase">Total Intereses</p>
                  <p className="text-[16px] font-bold text-emerald-700 dark:text-emerald-300">{fmtRD(totalInterest)}</p>
                </div>
              </div>
            </div>
          )}

          {/* Amortization schedule toggle */}
          {schedule.length > 0 && (
            <div>
              <button type="button" onClick={() => setShowSchedule(!showSchedule)}
                className="flex items-center gap-2 text-[12px] font-semibold text-slate-600 dark:text-white/60 hover:text-slate-800 dark:hover:text-white transition-colors">
                {showSchedule ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {showSchedule ? 'Ocultar' : 'Ver'} tabla de amortizacion ({n} cuotas)
              </button>
              {showSchedule && (
                <div className="mt-2 border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden max-h-[250px] overflow-y-auto">
                  <table className="w-full text-[11px]">
                    <thead className="bg-slate-50 dark:bg-white/5 text-[9px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left">#</th>
                        <th className="px-3 py-2 text-left">Fecha</th>
                        <th className="px-3 py-2 text-right">Capital</th>
                        <th className="px-3 py-2 text-right">Interes</th>
                        <th className="px-3 py-2 text-right">Cuota</th>
                        <th className="px-3 py-2 text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {schedule.map(row => (
                        <tr key={row.number} className="border-t border-slate-100 dark:border-white/5">
                          <td className="px-3 py-1.5 text-slate-500 dark:text-white/50">{row.number}</td>
                          <td className="px-3 py-1.5 text-slate-600 dark:text-white/60 tabular-nums">{fmtDateShort(row.due_date)}</td>
                          <td className="px-3 py-1.5 text-right text-slate-700 dark:text-white tabular-nums">{fmtRD(row.principal_portion)}</td>
                          <td className="px-3 py-1.5 text-right text-slate-500 dark:text-white/50 tabular-nums">{fmtRD(row.interest_portion)}</td>
                          <td className="px-3 py-1.5 text-right font-semibold text-slate-800 dark:text-white tabular-nums">{fmtRD(row.payment)}</td>
                          <td className="px-3 py-1.5 text-right text-slate-600 dark:text-white/60 tabular-nums">{fmtRD(row.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
              Notas (opcional)
            </label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
              placeholder="Proposito del prestamo, garantias, condiciones..."
              className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400 resize-none" />
          </div>

          {err && (
            <div className="flex items-center gap-2 text-[11px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2">
              <AlertTriangle size={12} /> {err}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 shrink-0">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-[12px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors">
            Cancelar
          </button>
          <button type="submit" disabled={saving || P <= 0 || n <= 0 || !form.client_id}
            className="flex items-center gap-1.5 px-5 py-2 bg-black dark:bg-white text-white dark:text-black text-[12px] font-bold rounded-lg hover:bg-slate-800 dark:hover:bg-white/90 disabled:opacity-50 transition-colors">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Landmark size={13} />}
            {saving ? 'Aprobando...' : 'Aprobar Prestamo'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Payment Modal ─────────────────────────────────────────────────────────────

function PaymentModal({ loan, onClose, onSave }) {
  const api = useAPI()
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const schedule = useMemo(() =>
    generateSchedule(loan.principal, loan.interest_rate, loan.term_months, loan.disbursed_at),
    [loan]
  )

  // Find current payment number
  const paidCount = loan.payments_count || 0
  const currentPayment = schedule[paidCount] || schedule[schedule.length - 1] || {}

  const [form, setForm] = useState({
    amount: String(loan.monthly_payment || currentPayment.payment || ''),
    payment_date: today(),
    late_fee: '',
    notes: '',
  })

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const amount = Number(form.amount) || 0
  const lateFee = Number(form.late_fee) || 0
  const isLate = form.payment_date > (currentPayment.due_date || '')

  async function handleSubmit(e) {
    e.preventDefault()
    if (amount <= 0) { setErr('El monto debe ser mayor a 0.'); return }
    setSaving(true)
    setErr('')
    try {
      await api.loanPayments.create({
        loan_id: loan.id,
        amount,
        principal_portion: currentPayment.principal_portion || 0,
        interest_portion: currentPayment.interest_portion || 0,
        late_fee: lateFee,
        payment_date: form.payment_date,
        status: isLate ? 'late' : (amount < (loan.monthly_payment || 0) ? 'partial' : 'on_time'),
        notes: form.notes.trim() || null,
      })
      onSave()
    } catch (e) {
      setErr(e?.message || 'Error al registrar pago.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <form onSubmit={handleSubmit}
        className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10">
          <h2 className="text-[15px] font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <Banknote size={16} className="text-emerald-500" />
            Registrar Pago
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
            <X size={16} className="text-slate-400" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Payment info */}
          <div className="bg-slate-50 dark:bg-white/5 rounded-xl p-3 space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-500 dark:text-white/50">Cuota #{paidCount + 1} de {loan.term_months}</span>
              <span className="text-slate-500 dark:text-white/50">Vence: {fmtDate(currentPayment.due_date)}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-500 dark:text-white/50">Capital: {fmtRD(currentPayment.principal_portion)}</span>
              <span className="text-slate-500 dark:text-white/50">Interes: {fmtRD(currentPayment.interest_portion)}</span>
            </div>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
              Monto del Pago (RD$)
            </label>
            <input type="number" min="0" step="0.01" value={form.amount}
              onChange={e => { set('amount', e.target.value); setErr('') }}
              className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          </div>

          {/* Date */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
              Fecha de Pago
            </label>
            <input type="date" value={form.payment_date}
              onChange={e => set('payment_date', e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          </div>

          {/* Late fee */}
          {isLate && (
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                Recargo por Mora (RD$)
              </label>
              <input type="number" min="0" step="0.01" value={form.late_fee}
                onChange={e => set('late_fee', e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-400" />
              <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                <AlertTriangle size={10} /> Pago fuera de fecha de vencimiento
              </p>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
              Notas (opcional)
            </label>
            <input type="text" value={form.notes} onChange={e => set('notes', e.target.value)}
              placeholder="Referencia, metodo de pago..."
              className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          </div>

          {err && (
            <div className="flex items-center gap-2 text-[11px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2">
              <AlertTriangle size={12} /> {err}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-[12px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors">
            Cancelar
          </button>
          <button type="submit" disabled={saving || amount <= 0}
            className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 text-white text-[12px] font-bold rounded-lg hover:bg-emerald-500 disabled:opacity-50 transition-colors">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {saving ? 'Registrando...' : `Registrar ${fmtRD(amount + lateFee)}`}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Loan Detail Modal ─────────────────────────────────────────────────────────

function LoanDetail({ loan, onClose, onReload }) {
  const api = useAPI()
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [showPayment, setShowPayment] = useState(false)
  const [showSchedule, setShowSchedule] = useState(false)
  const [toast, setToast] = useState(null)

  const schedule = useMemo(() =>
    generateSchedule(loan.principal, loan.interest_rate, loan.term_months, loan.disbursed_at),
    [loan]
  )

  useEffect(() => {
    api?.loanPayments?.list?.({ loan_id: loan.id })
      .then(r => { setPayments(r || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [loan.id])

  const st = STATUS_CONFIG[loan.status] || STATUS_CONFIG.active
  const balance = (loan.total_repayment || 0) - (loan.total_paid || 0)

  async function handleMarkDefaulted() {
    if (!confirm('Marcar este prestamo como en mora?')) return
    try {
      await api.loans.update({ id: loan.id, status: 'defaulted' })
      setToast('Prestamo marcado en mora')
      setTimeout(() => { setToast(null); onReload() }, 1500)
    } catch {}
  }

  async function handleCancel() {
    if (!confirm('Cancelar este prestamo? Esta accion no se puede deshacer.')) return
    try {
      await api.loans.update({ id: loan.id, status: 'cancelled' })
      setToast('Prestamo cancelado')
      setTimeout(() => { setToast(null); onReload() }, 1500)
    } catch {}
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-[15px] font-bold text-slate-800 dark:text-white">
              Prestamo #{loan.id}
            </h2>
            <StatusBadge status={loan.status} />
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
            <X size={16} className="text-slate-400" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 relative">
          {toast && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 bg-slate-800 dark:bg-white/90 text-white dark:text-black text-[12px] font-medium px-4 py-2 rounded-xl shadow-lg whitespace-nowrap">
              {toast}
            </div>
          )}

          {/* Loan info grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Cliente', value: loan.client_name || `#${loan.client_id}` },
              { label: 'Capital', value: fmtRD(loan.principal) },
              { label: 'Tasa', value: `${loan.interest_rate}% mensual` },
              { label: 'Plazo', value: `${loan.term_months} meses` },
              { label: 'Cuota', value: fmtRD(loan.monthly_payment) },
              { label: 'Desembolsado', value: fmtDate(loan.disbursed_at) },
              { label: 'Prox. Pago', value: fmtDate(loan.next_due_date) },
              { label: 'Balance', value: fmtRD(balance) },
            ].map(item => (
              <div key={item.label} className="bg-slate-50 dark:bg-white/5 rounded-xl px-3 py-2.5">
                <p className="text-[10px] text-slate-400 dark:text-white/40 uppercase">{item.label}</p>
                <p className="text-[13px] font-bold text-slate-800 dark:text-white mt-0.5">{item.value}</p>
              </div>
            ))}
          </div>

          {/* Notes */}
          {loan.notes && (
            <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl px-3 py-2.5">
              <p className="text-[12px] text-amber-800 dark:text-amber-300">{loan.notes}</p>
            </div>
          )}

          {/* Payment history */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider">
                Historial de Pagos {payments.length > 0 && `(${payments.length})`}
              </p>
              {loan.status === 'active' && (
                <button onClick={() => setShowPayment(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-[11px] font-bold rounded-lg hover:bg-emerald-500 transition-colors">
                  <Plus size={12} /> Registrar Pago
                </button>
              )}
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-8 text-slate-400 dark:text-white/40">
                <Loader2 size={16} className="animate-spin mr-2" />
                <span className="text-[12px]">Cargando pagos...</span>
              </div>
            ) : payments.length === 0 ? (
              <div className="text-center py-6">
                <Banknote size={24} className="text-slate-300 dark:text-white/20 mx-auto mb-2" />
                <p className="text-[12px] text-slate-400 dark:text-white/40">Sin pagos registrados</p>
              </div>
            ) : (
              <div className="border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
                <table className="w-full text-[11px]">
                  <thead className="bg-slate-50 dark:bg-white/5 text-[9px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">
                    <tr>
                      <th className="px-3 py-2 text-left">#</th>
                      <th className="px-3 py-2 text-left">Fecha</th>
                      <th className="px-3 py-2 text-right">Monto</th>
                      <th className="px-3 py-2 text-right">Capital</th>
                      <th className="px-3 py-2 text-right">Interes</th>
                      <th className="px-3 py-2 text-right">Mora</th>
                      <th className="px-3 py-2 text-center">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p, idx) => {
                      const ps = PAYMENT_STATUS[p.status] || PAYMENT_STATUS.on_time
                      return (
                        <tr key={p.id || idx} className="border-t border-slate-100 dark:border-white/5">
                          <td className="px-3 py-1.5 text-slate-500 dark:text-white/50">{idx + 1}</td>
                          <td className="px-3 py-1.5 text-slate-600 dark:text-white/60 tabular-nums">{fmtDate(p.payment_date)}</td>
                          <td className="px-3 py-1.5 text-right font-semibold text-slate-800 dark:text-white tabular-nums">{fmtRD(p.amount)}</td>
                          <td className="px-3 py-1.5 text-right text-slate-600 dark:text-white/60 tabular-nums">{fmtRD(p.principal_portion)}</td>
                          <td className="px-3 py-1.5 text-right text-slate-500 dark:text-white/50 tabular-nums">{fmtRD(p.interest_portion)}</td>
                          <td className="px-3 py-1.5 text-right text-slate-500 dark:text-white/50 tabular-nums">{p.late_fee > 0 ? fmtRD(p.late_fee) : '---'}</td>
                          <td className="px-3 py-1.5 text-center">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-bold ${ps.bg} ${ps.text}`}>
                              {ps.label}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Remaining amortization schedule */}
          <div>
            <button type="button" onClick={() => setShowSchedule(!showSchedule)}
              className="flex items-center gap-2 text-[12px] font-semibold text-slate-600 dark:text-white/60 hover:text-slate-800 dark:hover:text-white transition-colors">
              {showSchedule ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {showSchedule ? 'Ocultar' : 'Ver'} tabla de amortizacion
            </button>
            {showSchedule && schedule.length > 0 && (
              <div className="mt-2 border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden max-h-[200px] overflow-y-auto">
                <table className="w-full text-[11px]">
                  <thead className="bg-slate-50 dark:bg-white/5 text-[9px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left">#</th>
                      <th className="px-3 py-2 text-left">Fecha</th>
                      <th className="px-3 py-2 text-right">Capital</th>
                      <th className="px-3 py-2 text-right">Interes</th>
                      <th className="px-3 py-2 text-right">Cuota</th>
                      <th className="px-3 py-2 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.map(row => {
                      const isPaid = row.number <= (payments.length)
                      return (
                        <tr key={row.number} className={`border-t border-slate-100 dark:border-white/5 ${isPaid ? 'opacity-40' : ''}`}>
                          <td className="px-3 py-1.5 text-slate-500 dark:text-white/50">
                            {row.number} {isPaid && <Check size={10} className="inline text-emerald-500" />}
                          </td>
                          <td className="px-3 py-1.5 text-slate-600 dark:text-white/60 tabular-nums">{fmtDateShort(row.due_date)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{fmtRD(row.principal_portion)}</td>
                          <td className="px-3 py-1.5 text-right text-slate-500 dark:text-white/50 tabular-nums">{fmtRD(row.interest_portion)}</td>
                          <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{fmtRD(row.payment)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{fmtRD(row.balance)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Actions */}
          {loan.status === 'active' && (
            <div className="flex gap-2 pt-2">
              <button onClick={handleMarkDefaulted}
                className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-500/30 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors">
                <AlertTriangle size={12} /> Marcar en Mora
              </button>
              <button onClick={handleCancel}
                className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/30 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors">
                <Ban size={12} /> Cancelar Prestamo
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-5 py-3 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 shrink-0">
          <button onClick={onClose}
            className="px-4 py-2 text-[12px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors">
            Cerrar
          </button>
        </div>
      </div>

      {/* Payment sub-modal */}
      {showPayment && (
        <PaymentModal
          loan={{ ...loan, payments_count: payments.length }}
          onClose={() => setShowPayment(false)}
          onSave={() => {
            setShowPayment(false)
            // Reload payments
            api?.loanPayments?.list?.({ loan_id: loan.id })
              .then(r => setPayments(r || []))
              .catch(() => {})
            onReload()
          }}
        />
      )}
    </div>
  )
}

// ── Main Loans Screen ─────────────────────────────────────────────────────────

export default function Loans() {
  const api = useAPI()
  const [loans, setLoans] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('active')
  const [showNew, setShowNew] = useState(false)
  const [detail, setDetail] = useState(null)
  const [toast, setToast] = useState(null)

  const loadLoans = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await api?.loans?.list?.({})
      setLoans(rows || [])
    } catch { setLoans([]) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadLoans() }, [loadLoans])

  // ── Metrics ──────────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const active = loans.filter(l => l.status === 'active')
    const totalCartera = active.reduce((s, l) => s + ((l.total_repayment || 0) - (l.total_paid || 0)), 0)
    const overdue = active.filter(l => l.next_due_date && l.next_due_date < today()).length
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    // Sum all payments this month — approximation from loan data
    const cobradoMes = loans.reduce((s, l) => {
      // Use total_paid as proxy; real impl would query payments by date
      return s
    }, 0)
    return {
      totalCartera,
      activeCount: active.length,
      overdueCount: overdue,
      cobradoMes,
    }
  }, [loans])

  // ── Filtered list ────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = loans
    if (tab !== 'all') list = list.filter(l => l.status === tab)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(l =>
        (l.client_name || '').toLowerCase().includes(q) ||
        String(l.id).includes(q)
      )
    }
    return list
  }, [loans, tab, search])

  function showToastMsg(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-black">
      {/* Header */}
      <div className="bg-white dark:bg-white/5 border-b border-slate-200 dark:border-white/10 px-3 py-3 md:px-6 md:py-4 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <Landmark size={20} className="text-slate-500 dark:text-white/60" />
          <h1 className="text-[14px] md:text-[16px] font-bold text-slate-800 dark:text-white">Prestamos</h1>
        </div>
        <button onClick={() => setShowNew(true)}
          className="flex items-center gap-2 px-4 py-2 bg-black dark:bg-white text-white dark:text-black hover:bg-slate-800 dark:hover:bg-white/90 rounded-xl text-sm font-medium transition-colors min-h-[44px]">
          <Plus size={15} /> Nuevo Prestamo
        </button>
      </div>

      {/* Summary cards */}
      <div className="px-3 md:px-6 py-3 md:py-4 grid grid-cols-2 md:grid-cols-4 gap-3 shrink-0">
        <SummaryCard icon={DollarSign} label="Total Cartera" value={fmtRD(metrics.totalCartera)} accent="emerald" />
        <SummaryCard icon={Users} label="Prestamos Activos" value={String(metrics.activeCount)} accent="emerald" />
        <SummaryCard icon={Clock} label="Pagos Pendientes" value={String(metrics.overdueCount)} accent={metrics.overdueCount > 0 ? 'red' : 'slate'} />
        <SummaryCard icon={TrendingUp} label="Cobrado Este Mes" value={fmtRD(metrics.cobradoMes)} accent="slate" />
      </div>

      {/* Tabs */}
      <div className="px-3 md:px-6 shrink-0">
        <div className="flex gap-1 overflow-x-auto pb-2">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-lg text-[12px] font-semibold transition-colors border whitespace-nowrap min-h-[44px] ${
                tab === t.id
                  ? 'bg-black dark:bg-white text-white dark:text-black border-black dark:border-white'
                  : 'bg-white dark:bg-white/5 text-slate-500 dark:text-white/60 border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10'
              }`}>
              {t.label}
              {t.id !== 'all' && (
                <span className="ml-1.5 text-[10px] opacity-60">
                  {loans.filter(l => l.status === t.id).length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="px-3 md:px-6 pb-3 shrink-0">
        <div className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl focus-within:ring-2 focus-within:ring-emerald-400 max-w-sm">
          <Search size={14} className="text-slate-400 dark:text-white/40 shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por cliente o # prestamo..."
            className="flex-1 min-w-0 bg-transparent outline-none text-sm text-slate-700 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/40" />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-3 md:px-6 pb-6">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 dark:text-white/40 text-sm gap-2">
            <Loader2 size={16} className="animate-spin" /> Cargando prestamos...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Landmark size={32} className="text-slate-300 dark:text-white/20 mx-auto mb-3" />
            <p className="text-[13px] text-slate-500 dark:text-white/60 font-medium">
              {loans.length === 0 ? 'No hay prestamos registrados' : 'Sin resultados para esta busqueda'}
            </p>
            <p className="text-[11px] text-slate-400 dark:text-white/40 mt-1">
              {loans.length === 0 && 'Haz clic en "Nuevo Prestamo" para crear el primero.'}
            </p>
          </div>
        ) : (
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 overflow-hidden">
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="bg-slate-50 dark:bg-white/5 text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-2.5 text-left">#</th>
                    <th className="px-4 py-2.5 text-left">Cliente</th>
                    <th className="px-4 py-2.5 text-right">Capital</th>
                    <th className="px-4 py-2.5 text-center">Plazo</th>
                    <th className="px-4 py-2.5 text-center">Tasa</th>
                    <th className="px-4 py-2.5 text-right">Cuota</th>
                    <th className="px-4 py-2.5 text-left">Desembolsado</th>
                    <th className="px-4 py-2.5 text-left">Prox. Pago</th>
                    <th className="px-4 py-2.5 text-right">Balance</th>
                    <th className="px-4 py-2.5 text-center">Estado</th>
                    <th className="px-4 py-2.5 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(loan => {
                    const balance = (loan.total_repayment || 0) - (loan.total_paid || 0)
                    const isOverdue = loan.status === 'active' && loan.next_due_date && loan.next_due_date < today()
                    return (
                      <tr key={loan.id}
                        onClick={() => setDetail(loan)}
                        className="border-t border-slate-100 dark:border-white/5 hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition-colors cursor-pointer">
                        <td className="px-4 py-2.5 text-slate-500 dark:text-white/50 tabular-nums">{loan.id}</td>
                        <td className="px-4 py-2.5">
                          <p className="font-semibold text-slate-800 dark:text-white">{loan.client_name || `Cliente #${loan.client_id}`}</p>
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-800 dark:text-white tabular-nums">{fmtRD(loan.principal)}</td>
                        <td className="px-4 py-2.5 text-center text-slate-600 dark:text-white/60">{loan.term_months}m</td>
                        <td className="px-4 py-2.5 text-center text-slate-600 dark:text-white/60">{loan.interest_rate}%</td>
                        <td className="px-4 py-2.5 text-right text-slate-700 dark:text-white tabular-nums">{fmtRD(loan.monthly_payment)}</td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-white/60 tabular-nums">{fmtDate(loan.disbursed_at)}</td>
                        <td className={`px-4 py-2.5 tabular-nums ${isOverdue ? 'text-[#b3001e] font-semibold' : 'text-slate-600 dark:text-white/60'}`}>
                          {fmtDate(loan.next_due_date)}
                          {isOverdue && <AlertTriangle size={10} className="inline ml-1 text-[#b3001e]" />}
                        </td>
                        <td className="px-4 py-2.5 text-right font-bold text-slate-800 dark:text-white tabular-nums">{fmtRD(balance)}</td>
                        <td className="px-4 py-2.5 text-center">
                          <StatusBadge status={loan.status} />
                        </td>
                        <td className="px-4 py-2.5">
                          <button onClick={e => { e.stopPropagation(); setDetail(loan) }}
                            className="p-1.5 text-slate-400 dark:text-white/40 hover:text-slate-600 dark:hover:text-white rounded-lg hover:bg-slate-50 dark:hover:bg-white/10">
                            <Eye size={14} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-slate-100 dark:divide-white/5">
              {filtered.map(loan => {
                const balance = (loan.total_repayment || 0) - (loan.total_paid || 0)
                const isOverdue = loan.status === 'active' && loan.next_due_date && loan.next_due_date < today()
                return (
                  <button key={loan.id} onClick={() => setDetail(loan)}
                    className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[13px] font-bold text-slate-800 dark:text-white truncate">
                          {loan.client_name || `Cliente #${loan.client_id}`}
                        </p>
                        <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">
                          #{loan.id} -- {loan.term_months}m @ {loan.interest_rate}%
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[14px] font-bold text-slate-800 dark:text-white">{fmtRD(balance)}</p>
                        <StatusBadge status={loan.status} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-2 text-[11px]">
                      <span className="text-slate-500 dark:text-white/50">Capital: {fmtRD(loan.principal)}</span>
                      <span className={`${isOverdue ? 'text-[#b3001e] font-semibold' : 'text-slate-500 dark:text-white/50'}`}>
                        Prox: {fmtDate(loan.next_due_date)}
                        {isOverdue && ' !'}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showNew && (
        <NewLoanModal
          onClose={() => setShowNew(false)}
          onSave={() => {
            setShowNew(false)
            loadLoans()
            showToastMsg('Prestamo aprobado y desembolsado')
          }}
        />
      )}

      {detail && (
        <LoanDetail
          loan={detail}
          onClose={() => setDetail(null)}
          onReload={() => { loadLoans(); setDetail(null) }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-emerald-600 text-white text-sm px-5 py-3 rounded-full shadow-lg flex items-center gap-2">
          <Check size={15} /> {toast}
        </div>
      )}
    </div>
  )
}
