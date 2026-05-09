/**
 * Collections.jsx — v2.16.2 hardening.
 *
 * Cobranza Diaria (default tab):
 *   Sortable list (días de mora desc | monto adeudado | último contacto).
 *   Each row: cliente, monto vencido, días de mora pill, último intento,
 *   próximo seguimiento, quick-actions (Registrar Intento | WhatsApp).
 *
 * Registrar Intento modal (replaces free-form log entry):
 *   5 outcome buttons (Llamé | Prometió | Pagó | No contestó | Rechazó),
 *   notes, próximo seguimiento date, WhatsApp toggle.
 *   Saves to collections_attempts (and mirrors into collections_log for
 *   one-release back-compat).
 *
 * Drilldown:
 *   Click a row → side panel with the full attempt history (collections_attempts
 *   for that loan_supabase_id), each entry with outcome icon + date + notes.
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  AlertTriangle, MessageSquare, Users, Calendar, Loader2,
  X, Check, Clock, TrendingDown, Ban, PhoneCall, Phone,
  ArrowUpDown, ArrowDown, ArrowUp, ChevronRight,
  CheckCircle2, XCircle, HelpCircle, DollarSign,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { openWhatsApp } from '../../../services/whatsapp.js'

// ── Outcome catalog (drives modal buttons + history icons) ──────────────────

const OUTCOMES = [
  { id: 'called',     label: 'Llamé',          short: 'Llamé',          icon: Phone,        tone: 'blue'   },
  { id: 'promised',   label: 'Prometió pago',  short: 'Prometió',       icon: Clock,        tone: 'amber'  },
  { id: 'paid',       label: 'Pagó',           short: 'Pagó',           icon: CheckCircle2, tone: 'green'  },
  { id: 'no_answer',  label: 'No contestó',    short: 'No contestó',    icon: HelpCircle,   tone: 'gray'   },
  { id: 'refused',    label: 'Rechazó',        short: 'Rechazó',        icon: XCircle,      tone: 'red'    },
]

const OUTCOME_BY_ID = Object.fromEntries(OUTCOMES.map(o => [o.id, o]))

const TONE_CLASSES = {
  blue:  { bg: 'bg-blue-500',    bgSoft: 'bg-blue-50 dark:bg-blue-500/10',       text: 'text-blue-700 dark:text-blue-300',     border: 'border-blue-500',    hover: 'hover:bg-blue-600' },
  amber: { bg: 'bg-amber-500',   bgSoft: 'bg-amber-50 dark:bg-amber-500/10',     text: 'text-amber-700 dark:text-amber-300',   border: 'border-amber-500',   hover: 'hover:bg-amber-600' },
  green: { bg: 'bg-emerald-500', bgSoft: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-500', hover: 'hover:bg-emerald-600' },
  gray:  { bg: 'bg-slate-400',   bgSoft: 'bg-slate-100 dark:bg-white/5',         text: 'text-slate-700 dark:text-white/70',    border: 'border-slate-400',   hover: 'hover:bg-slate-500' },
  red:   { bg: 'bg-[#b3001e]',   bgSoft: 'bg-red-50 dark:bg-red-500/10',         text: 'text-red-700 dark:text-red-300',       border: 'border-[#b3001e]',   hover: 'hover:bg-[#8b0018]' },
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtRD(n) { return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
function fmtDate(d) { if (!d) return '---'; return new Date(d).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' }) }
function fmtDateShort(d) { if (!d) return '---'; return new Date(d).toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: '2-digit' }) }
function fmtDateTime(d) { if (!d) return '---'; return new Date(d).toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) }

// H8 — All wa.me opens MUST go through openWhatsApp() so the horario laboral
// DR (8am-8pm, no domingos) + opt-out + DR phone validation is enforced.
function tryOpenWhatsApp({ client, phone, message, onShowToast }) {
  if (client?.wa_opt_out) {
    onShowToast?.('Cliente solicitó no recibir WhatsApp')
    return false
  }
  let res = openWhatsApp({ phone, message })
  if (res.ok) return true
  if (res.reason === 'phone_invalid') {
    onShowToast?.('Número de WhatsApp inválido. Debe ser DR (809/829/849) + 7 dígitos')
    return false
  }
  if (res.reason === 'horario') {
    const proceed = typeof window !== 'undefined' && window.confirm
      ? window.confirm(`Horario laboral DR: 8am–8pm, no domingos. Hoy es ${res.detail}. ¿Enviar de todos modos?`)
      : false
    if (!proceed) return false
    res = openWhatsApp({ phone, message, force: true })
    return !!res.ok
  }
  return false
}

function buildReminderMessage(loan) {
  const name = loan.client_name || 'estimado cliente'
  const amount = fmtRD(loan.monthly_payment || 0)
  const due = fmtDate(loan.next_due_date)
  const mora = Number(loan.mora_amount || 0)
  const businessName = (loan._biz_name || '').trim()
  const lead = businessName ? `Saludos desde ${businessName}. ` : ''
  let msg = `${lead}${name}, le recordamos que su cuota de ${amount} vencía el ${due}.`
  if (mora > 0) msg += ` Mora acumulada: ${fmtRD(mora)}.`
  msg += ` Por favor comuniquese con nosotros para regularizar su pago. Gracias.`
  return msg
}

// ── Registrar Intento modal ─────────────────────────────────────────────────

function AttemptModal({ loan, onClose, onSaved, onShowToast }) {
  const api = useAPI()
  const [outcome, setOutcome] = useState(null)
  const [notes, setNotes] = useState('')
  const [nextFollowup, setNextFollowup] = useState('')
  const [sendWhatsapp, setSendWhatsapp] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function handleSave() {
    if (!outcome) { setErr('Selecciona un resultado'); return }
    setSaving(true); setErr('')
    try {
      // 1) Open WhatsApp first (popup must come from user gesture before await)
      // H8 — routed through helper: enforces horario laboral DR + opt-out + DR phone shape.
      let waOpened = false
      if (sendWhatsapp) {
        waOpened = tryOpenWhatsApp({
          client: loan,
          phone: loan.client_phone,
          message: buildReminderMessage(loan),
          onShowToast,
        })
      }

      // 2) Persist attempt
      const fn = api?.collections?.attemptCreate
      if (!fn) throw new Error('API de cobranza no disponible (attemptCreate)')
      await fn({
        loan_supabase_id: loan.supabase_id || null,
        loan_id: loan.id,
        client_id: loan.client_id,
        outcome,
        notes: notes.trim() || null,
        next_followup_at: nextFollowup ? new Date(nextFollowup + 'T12:00:00').toISOString() : null,
        whatsapp_sent: waOpened,
      })
      onSaved()
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'collections.fmtrd' }) } catch {}
      setErr(e?.message || 'Error al registrar intento')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10 shrink-0">
          <h2 className="text-[15px] font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <PhoneCall size={16} className="text-[#b3001e]" />
            Registrar Intento
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
            <X size={16} className="text-slate-400" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Loan ref */}
          <div className="bg-slate-50 dark:bg-white/5 rounded-xl px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40">Préstamo #{loan.id} — {loan.client_name || `Cliente #${loan.client_id}`}</p>
            <p className="text-[12px] text-slate-700 dark:text-white mt-0.5">
              Cuota: <span className="font-bold">{fmtRD(loan.monthly_payment)}</span>
              <span className="mx-2">·</span>
              Vencía: <span className="font-semibold text-[#b3001e]">{fmtDate(loan.next_due_date)}</span>
              <span className="mx-2">·</span>
              <span className="text-[#b3001e] font-semibold">{loan.days_late || 0}d mora</span>
            </p>
          </div>

          {/* Outcome buttons — grid of 5 large color-coded tiles */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase mb-2">Resultado</label>
            <div className="grid grid-cols-5 gap-2">
              {OUTCOMES.map(o => {
                const T = TONE_CLASSES[o.tone]
                const selected = outcome === o.id
                const Icon = o.icon
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setOutcome(o.id)}
                    className={`flex flex-col items-center justify-center gap-1.5 px-2 py-3 rounded-xl border-2 transition-all min-h-[78px] ${
                      selected
                        ? `${T.bg} ${T.border} text-white shadow-lg scale-[1.02]`
                        : `bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 ${T.text} hover:border-current`
                    }`}>
                    <Icon size={18} strokeWidth={2} />
                    <span className="text-[10px] font-bold leading-tight text-center">{o.short}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase mb-1">Notas</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              placeholder="Detalles del contacto, promesas, excusas..."
              className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e] resize-none" />
          </div>

          {/* Próximo seguimiento */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase mb-1">Próximo seguimiento (opcional)</label>
            <input type="date" value={nextFollowup} onChange={e => setNextFollowup(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]" />
          </div>

          {/* WhatsApp toggle */}
          <label className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/5 border border-emerald-200 dark:border-emerald-500/20 cursor-pointer">
            <input type="checkbox" checked={sendWhatsapp} onChange={e => setSendWhatsapp(e.target.checked)}
              className="w-4 h-4 accent-emerald-500" />
            <MessageSquare size={14} className="text-emerald-600 dark:text-emerald-400" />
            <span className="text-[12px] font-semibold text-emerald-800 dark:text-emerald-200 flex-1">
              Enviar recordatorio por WhatsApp al guardar
            </span>
          </label>

          {err && (
            <div className="flex items-center gap-2 text-[11px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2">
              <AlertTriangle size={12} /> {err}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 shrink-0">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-[12px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg">
            Cancelar
          </button>
          <button type="button" onClick={handleSave} disabled={saving || !outcome}
            className="flex items-center gap-1.5 px-5 py-2 bg-[#b3001e] text-white text-[12px] font-bold rounded-lg hover:bg-[#8b0018] disabled:opacity-50 transition-colors">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {saving ? 'Guardando...' : 'Guardar Intento'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Drilldown panel — full attempt history for a single loan ────────────────

function HistoryPanel({ loan, onClose }) {
  const api = useAPI()
  const [attempts, setAttempts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      try {
        const rows = await (api?.collections?.attemptsByLoan?.(loan.supabase_id) ?? Promise.resolve([]))
        if (alive) setAttempts(Array.isArray(rows) ? rows : [])
      } finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [loan.supabase_id])

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-slate-900 h-full overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10 sticky top-0 bg-white dark:bg-slate-900 z-10">
          <div>
            <h2 className="text-[15px] font-bold text-slate-800 dark:text-white">Historial de intentos</h2>
            <p className="text-[11px] text-slate-500 dark:text-white/50 mt-0.5">#{loan.id} — {loan.client_name || `Cliente #${loan.client_id}`}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
            <X size={16} className="text-slate-400" />
          </button>
        </div>

        <div className="p-5">
          {loading ? (
            <div className="flex items-center gap-2 text-slate-400 text-sm py-8 justify-center">
              <Loader2 size={14} className="animate-spin" /> Cargando historial...
            </div>
          ) : attempts.length === 0 ? (
            <div className="text-center py-12">
              <PhoneCall size={28} className="text-slate-300 dark:text-white/20 mx-auto mb-3" />
              <p className="text-[12px] text-slate-500 dark:text-white/50">Sin intentos registrados aún.</p>
            </div>
          ) : (
            <ol className="space-y-3">
              {attempts.map(a => {
                const meta = OUTCOME_BY_ID[a.outcome] || { label: a.outcome, icon: HelpCircle, tone: 'gray' }
                const T = TONE_CLASSES[meta.tone]
                const Icon = meta.icon
                return (
                  <li key={a.id} className="flex gap-3 p-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                    <div className={`shrink-0 w-9 h-9 rounded-full ${T.bg} flex items-center justify-center text-white`}>
                      <Icon size={15} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-[12px] font-bold ${T.text}`}>{meta.label}</span>
                        <span className="text-[10px] text-slate-400 dark:text-white/40 tabular-nums">{fmtDateTime(a.attempt_at)}</span>
                      </div>
                      {a.notes && <p className="text-[12px] text-slate-700 dark:text-white/80 mt-1 whitespace-pre-wrap break-words">{a.notes}</p>}
                      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-500 dark:text-white/50">
                        {a.whatsapp_sent && <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold"><MessageSquare size={10} /> WA</span>}
                        {a.next_followup_at && <span className="flex items-center gap-1"><Calendar size={10} /> sigue {fmtDateShort(a.next_followup_at)}</span>}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Sort header button ──────────────────────────────────────────────────────

function SortBtn({ active, dir, onClick, children }) {
  const Icon = active ? (dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-semibold transition-colors min-h-[40px] ${
        active
          ? 'bg-[#b3001e] text-white border-[#b3001e]'
          : 'bg-white dark:bg-white/5 text-slate-600 dark:text-white/60 border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10'
      }`}>
      <Icon size={11} />
      {children}
    </button>
  )
}

// ── Main screen ─────────────────────────────────────────────────────────────

export default function Collections() {
  const api = useAPI()
  const [tab, setTab] = useState('overdue')
  const [loans, setLoans] = useState([])
  const [logs, setLogs] = useState([])
  const [lastAttempts, setLastAttempts] = useState({}) // { loan_supabase_id: { outcome, attempt_at, ... } }
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [drill, setDrill] = useState(null)
  const [toast, setToast] = useState(null)

  // Sort state for Cobranza Diaria
  // sortKey ∈ { 'days_late', 'amount_due', 'last_contact' }; default desc.
  const [sortKey, setSortKey] = useState('days_late')
  const [sortDir, setSortDir] = useState('desc')

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      try { await (api?.collections?.computeMora?.() ?? Promise.resolve()) } catch (_aetherErr) {
        try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'collections.sortbtn' }) } catch {}}
      const [o, l, la] = await Promise.all([
        (api?.collections?.overdue?.() ?? Promise.resolve([])),
        (api?.collections?.logList?.({}) ?? api?.collectionsLog?.list?.({}) ?? Promise.resolve([])),
        (api?.collections?.lastAttempts?.() ?? Promise.resolve({})),
      ])
      setLoans(Array.isArray(o) ? o : [])
      setLogs(Array.isArray(l) ? l : [])
      setLastAttempts(la && typeof la === 'object' ? la : {})
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'collections.sortbtn' }) } catch {}
      setLoans([]); setLogs([]); setLastAttempts({})
    } finally { setLoading(false) }
  }, [api])

  useEffect(() => { loadAll() }, [loadAll])

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(null), 2500) }

  function handleWhatsapp(loan) {
    // H8 — horario laboral DR + opt-out + DR phone validation.
    tryOpenWhatsApp({
      client: loan,
      phone: loan.client_phone,
      message: buildReminderMessage(loan),
      onShowToast: showToast,
    })
  }

  // Decorate + sort
  const sortedLoans = useMemo(() => {
    const arr = loans.map(l => {
      const balance = Math.max(0, Number(l.principal || 0) - Number(l.total_paid || 0))
      const amountDue = Number(l.monthly_payment || 0) + Number(l.mora_amount || 0)
      const last = lastAttempts[l.supabase_id] || null
      const lastTs = last?.attempt_at ? new Date(last.attempt_at).getTime() : 0
      return { ...l, _balance: balance, _amountDue: amountDue, _lastAttempt: last, _lastTs: lastTs }
    })
    const dir = sortDir === 'asc' ? 1 : -1
    arr.sort((a, b) => {
      let av = 0, bv = 0
      if (sortKey === 'days_late') {
        av = Number(a.days_late || 0); bv = Number(b.days_late || 0)
      } else if (sortKey === 'amount_due') {
        av = a._amountDue; bv = b._amountDue
      } else if (sortKey === 'last_contact') {
        av = a._lastTs; bv = b._lastTs
      }
      return (av - bv) * dir
    })
    return arr
  }, [loans, lastAttempts, sortKey, sortDir])

  const metrics = useMemo(() => {
    const total = loans.length
    const mora = loans.reduce((s, l) => s + Number(l.mora_amount || 0), 0)
    const outstanding = loans.reduce((s, l) => s + Math.max(0, Number(l.principal || 0) - Number(l.total_paid || 0)), 0)
    const critical = loans.filter(l => Number(l.days_late || 0) >= 30).length
    return { total, mora, outstanding, critical }
  }, [loans])

  function clickSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-black">
      <div className="bg-white dark:bg-white/5 border-b border-slate-200 dark:border-white/10 px-3 py-3 md:px-6 md:py-4 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <AlertTriangle size={20} className="text-[#b3001e]" />
          <h1 className="text-[14px] md:text-[16px] font-bold text-slate-800 dark:text-white">Cobranza</h1>
        </div>
      </div>

      {/* KPIs */}
      <div className="px-3 md:px-6 py-3 md:py-4 grid grid-cols-2 md:grid-cols-4 gap-3 shrink-0">
        <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 px-4 py-3">
          <div className="flex items-center gap-2 mb-1"><Users size={14} className="text-[#b3001e]" /><p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase">Deudores vencidos</p></div>
          <p className="text-[18px] font-bold text-slate-800 dark:text-white">{metrics.total}</p>
        </div>
        <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 px-4 py-3">
          <div className="flex items-center gap-2 mb-1"><TrendingDown size={14} className="text-[#b3001e]" /><p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase">Saldo por cobrar</p></div>
          <p className="text-[18px] font-bold text-slate-800 dark:text-white">{fmtRD(metrics.outstanding)}</p>
        </div>
        <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 px-4 py-3">
          <div className="flex items-center gap-2 mb-1"><AlertTriangle size={14} className="text-[#b3001e]" /><p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase">Mora acumulada</p></div>
          <p className="text-[18px] font-bold text-slate-800 dark:text-white">{fmtRD(metrics.mora)}</p>
        </div>
        <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 px-4 py-3">
          <div className="flex items-center gap-2 mb-1"><Ban size={14} className="text-[#b3001e]" /><p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase">Atraso crítico (30d+)</p></div>
          <p className="text-[18px] font-bold text-slate-800 dark:text-white">{metrics.critical}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-3 md:px-6 shrink-0">
        <div className="flex gap-1 pb-2">
          {[{id:'overdue',label:'Cobranza Diaria'},{id:'log',label:'Historial de contactos'}].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-lg text-[12px] font-semibold transition-colors border whitespace-nowrap min-h-[44px] ${
                tab === t.id
                  ? 'bg-black dark:bg-white text-white dark:text-black border-black dark:border-white'
                  : 'bg-white dark:bg-white/5 text-slate-500 dark:text-white/60 border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-3 md:px-6 pb-6">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 dark:text-white/40 text-sm gap-2">
            <Loader2 size={16} className="animate-spin" /> Cargando cobranza...
          </div>
        ) : tab === 'overdue' ? (
          <>
            {/* Sort toggles */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mr-1">Ordenar por</span>
              <SortBtn active={sortKey === 'days_late'}    dir={sortDir} onClick={() => clickSort('days_late')}>Días de mora</SortBtn>
              <SortBtn active={sortKey === 'amount_due'}   dir={sortDir} onClick={() => clickSort('amount_due')}>Monto adeudado</SortBtn>
              <SortBtn active={sortKey === 'last_contact'} dir={sortDir} onClick={() => clickSort('last_contact')}>Último contacto</SortBtn>
            </div>

            {sortedLoans.length === 0 ? (
              <div className="text-center py-16">
                <Check size={32} className="text-emerald-400 mx-auto mb-3" />
                <p className="text-[13px] text-slate-500 dark:text-white/60 font-medium">Sin préstamos vencidos. Excelente.</p>
              </div>
            ) : (
              <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 overflow-hidden">
                {/* Desktop */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead className="bg-slate-50 dark:bg-white/5 text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">
                      <tr>
                        <th className="px-4 py-2.5 text-left">Cliente</th>
                        <th className="px-4 py-2.5 text-right">Monto vencido</th>
                        <th className="px-4 py-2.5 text-center">Mora</th>
                        <th className="px-4 py-2.5 text-left">Último intento</th>
                        <th className="px-4 py-2.5 text-left">Próx. seguimiento</th>
                        <th className="px-4 py-2.5 w-56"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedLoans.map(loan => {
                        const days = Number(loan.days_late || 0)
                        const critical = days >= 30
                        const last = loan._lastAttempt
                        const lastMeta = last ? OUTCOME_BY_ID[last.outcome] : null
                        const T = lastMeta ? TONE_CLASSES[lastMeta.tone] : null
                        return (
                          <tr key={loan.id}
                            className="border-t border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer"
                            onClick={() => setDrill(loan)}>
                            <td className="px-4 py-2.5">
                              <div className="flex flex-col">
                                <span className="font-semibold text-slate-800 dark:text-white">{loan.client_name || `Cliente #${loan.client_id}`}</span>
                                <span className="text-[10px] text-slate-400 dark:text-white/40">#{loan.id} · {loan.client_phone || 'sin teléfono'} · vencía {fmtDateShort(loan.next_due_date)}</span>
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums font-bold text-slate-800 dark:text-white">{fmtRD(loan._amountDue)}</td>
                            <td className="px-4 py-2.5 text-center">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                critical
                                  ? 'bg-[#b3001e] text-white'
                                  : days > 7
                                    ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300'
                                    : 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-white/60'
                              }`}>
                                {days}d
                              </span>
                            </td>
                            <td className="px-4 py-2.5">
                              {last && lastMeta ? (
                                <div className="flex items-center gap-2">
                                  <span className={`w-5 h-5 rounded-full ${T.bg} flex items-center justify-center text-white shrink-0`}>
                                    <lastMeta.icon size={10} />
                                  </span>
                                  <div className="flex flex-col leading-tight">
                                    <span className={`text-[11px] font-semibold ${T.text}`}>{lastMeta.short}</span>
                                    <span className="text-[10px] text-slate-400 dark:text-white/40">{fmtDateShort(last.attempt_at)}</span>
                                  </div>
                                </div>
                              ) : (
                                <span className="text-[11px] text-slate-400 dark:text-white/40 italic">Sin intentos</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5">
                              {last?.next_followup_at ? (
                                <span className="text-[11px] text-slate-700 dark:text-white/70 tabular-nums">{fmtDateShort(last.next_followup_at)}</span>
                              ) : (
                                <span className="text-[11px] text-slate-400 dark:text-white/40">---</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1.5">
                                <button onClick={() => setModal({ loan })}
                                  title="Registrar intento"
                                  className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-white bg-[#b3001e] hover:bg-[#8b0018] rounded-lg transition-colors">
                                  <PhoneCall size={11} /> Registrar
                                </button>
                                <button onClick={() => handleWhatsapp(loan)}
                                  title="Enviar recordatorio por WhatsApp"
                                  className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 rounded-lg transition-colors">
                                  <MessageSquare size={11} /> WA
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile */}
                <div className="md:hidden divide-y divide-slate-100 dark:divide-white/5">
                  {sortedLoans.map(loan => {
                    const days = Number(loan.days_late || 0)
                    const critical = days >= 30
                    const last = loan._lastAttempt
                    const lastMeta = last ? OUTCOME_BY_ID[last.outcome] : null
                    const T = lastMeta ? TONE_CLASSES[lastMeta.tone] : null
                    return (
                      <div key={loan.id} className="px-4 py-3 space-y-2 active:bg-slate-50 dark:active:bg-white/5" onClick={() => setDrill(loan)}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-bold text-slate-800 dark:text-white truncate">{loan.client_name || `Cliente #${loan.client_id}`}</p>
                            <p className="text-[10px] text-slate-400 dark:text-white/40">#{loan.id} · vencía {fmtDateShort(loan.next_due_date)}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[13px] font-bold text-slate-800 dark:text-white">{fmtRD(loan._amountDue)}</p>
                            <span className={`inline-block mt-0.5 px-2 py-0.5 rounded-full text-[9px] font-bold ${
                              critical ? 'bg-[#b3001e] text-white' : days > 7 ? 'bg-amber-500 text-white' : 'bg-slate-400 text-white'
                            }`}>{days}d mora</span>
                          </div>
                        </div>
                        {last && lastMeta && (
                          <div className="flex items-center gap-2 text-[10px]">
                            <span className={`w-4 h-4 rounded-full ${T.bg} flex items-center justify-center text-white shrink-0`}>
                              <lastMeta.icon size={9} />
                            </span>
                            <span className={`font-semibold ${T.text}`}>{lastMeta.short}</span>
                            <span className="text-slate-400">{fmtDateShort(last.attempt_at)}</span>
                            {last.next_followup_at && <span className="text-slate-500 dark:text-white/50 ml-auto">→ {fmtDateShort(last.next_followup_at)}</span>}
                          </div>
                        )}
                        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                          <button onClick={() => setModal({ loan })}
                            className="flex-1 flex items-center justify-center gap-1 px-2 py-2 text-[11px] font-semibold text-white bg-[#b3001e] rounded-lg min-h-[40px]">
                            <PhoneCall size={11} /> Registrar
                          </button>
                          <button onClick={() => handleWhatsapp(loan)}
                            className="flex-1 flex items-center justify-center gap-1 px-2 py-2 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 rounded-lg min-h-[40px]">
                            <MessageSquare size={11} /> WhatsApp
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        ) : (
          logs.length === 0 ? (
            <div className="text-center py-16">
              <PhoneCall size={32} className="text-slate-300 dark:text-white/20 mx-auto mb-3" />
              <p className="text-[13px] text-slate-500 dark:text-white/60 font-medium">Sin contactos registrados.</p>
            </div>
          ) : (
            <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 overflow-hidden">
              <table className="w-full text-[12px]">
                <thead className="bg-slate-50 dark:bg-white/5 text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-2.5 text-left">Fecha</th>
                    <th className="px-4 py-2.5 text-left">Cliente</th>
                    <th className="px-4 py-2.5 text-left">Canal</th>
                    <th className="px-4 py-2.5 text-left">Resultado</th>
                    <th className="px-4 py-2.5 text-left">Notas</th>
                    <th className="px-4 py-2.5 text-left">Próximo</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(lg => {
                    const meta = OUTCOME_BY_ID[lg.outcome]
                    return (
                      <tr key={lg.id} className="border-t border-slate-100 dark:border-white/5">
                        <td className="px-4 py-2 tabular-nums text-slate-600 dark:text-white/60">{fmtDate(lg.contacted_at)}</td>
                        <td className="px-4 py-2 text-slate-800 dark:text-white">{lg.client_name || `Cliente #${lg.client_id}`}</td>
                        <td className="px-4 py-2 text-slate-600 dark:text-white/60 capitalize">{lg.channel || '---'}</td>
                        <td className="px-4 py-2">
                          {meta ? <span className={`text-[11px] font-semibold ${TONE_CLASSES[meta.tone].text}`}>{meta.label}</span> : <span className="text-slate-600 dark:text-white/60">{lg.outcome || '---'}</span>}
                        </td>
                        <td className="px-4 py-2 text-slate-600 dark:text-white/60 max-w-md truncate">{lg.notes || '---'}</td>
                        <td className="px-4 py-2 tabular-nums text-slate-600 dark:text-white/60">{fmtDate(lg.next_contact_date)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {modal && (
        <AttemptModal loan={modal.loan} onClose={() => setModal(null)}
          onShowToast={showToast}
          onSaved={() => { setModal(null); showToast('Intento registrado'); loadAll() }} />
      )}

      {drill && <HistoryPanel loan={drill} onClose={() => setDrill(null)} />}

      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-slate-800 dark:bg-white/90 text-white dark:text-black text-sm px-5 py-3 rounded-full shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
