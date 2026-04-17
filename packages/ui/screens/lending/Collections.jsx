/**
 * Collections.jsx — Cobros vencidos + CRM de cobranza para préstamos.
 *
 * Dashboard "Cobros vencidos": lista de préstamos activos cuya próxima cuota
 * venció. Cada fila muestra días atrasado y mora acumulada (calculada on-demand
 * al montar la pantalla). Acciones por fila:
 *   - WhatsApp: abre wa.me con mensaje pre-llenado en español
 *   - Registrar contacto: abre modal para loguear un intento (llamada/SMS/visita)
 *
 * Pestañas:
 *   1) Cobros vencidos (default)
 *   2) Historial de contactos (CRM log)
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  AlertTriangle, Phone, MessageSquare, Users, Calendar, Loader2,
  Plus, X, Check, Clock, TrendingDown, Ban, PhoneCall,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'

const CHANNELS = [
  { id: 'call',     label: 'Llamada' },
  { id: 'sms',      label: 'SMS' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'visit',    label: 'Visita' },
]
const OUTCOMES = [
  { id: 'promised',   label: 'Promesa de pago' },
  { id: 'no_answer',  label: 'No contesta' },
  { id: 'refused',    label: 'Rechazó pagar' },
  { id: 'paid',       label: 'Pagó' },
  { id: 'rescheduled',label: 'Reprogramado' },
  { id: 'other',      label: 'Otro' },
]

function fmtRD(n) { return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
function fmtDate(d) { if (!d) return '---'; return new Date(d).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' }) }
function fmtDateShort(d) { if (!d) return '---'; return new Date(d).toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: '2-digit' }) }

// Clean DR phone to international format for wa.me.
// Accepts 10-digit local (8095551234) or international (+1 809...).
function toWhatsappNumber(raw) {
  if (!raw) return ''
  const digits = String(raw).replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length === 10) return '1' + digits
  if (digits.length === 11 && digits.startsWith('1')) return digits
  return digits
}

function whatsappUrl(phone, message) {
  const num = toWhatsappNumber(phone)
  if (!num) return null
  return `https://wa.me/${num}?text=${encodeURIComponent(message)}`
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

// ── Log contact modal ────────────────────────────────────────────────────────

function LogContactModal({ loan, onClose, onSaved }) {
  const api = useAPI()
  const [form, setForm] = useState({
    channel: 'call', outcome: 'promised', notes: '', next_contact_date: '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setErr('')
    try {
      const fn = api?.collections?.logCreate || api?.collectionsLog?.create
      if (!fn) throw new Error('API de cobranza no disponible')
      await fn({
        client_id: loan.client_id,
        loan_id: loan.id,
        channel: form.channel,
        outcome: form.outcome,
        notes: form.notes.trim() || null,
        next_contact_date: form.next_contact_date || null,
      })
      onSaved()
    } catch (e) {
      setErr(e?.message || 'Error al registrar contacto')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10">
          <h2 className="text-[15px] font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <PhoneCall size={16} className="text-[#b3001e]" />
            Registrar contacto de cobranza
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
            <X size={16} className="text-slate-400" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="bg-slate-50 dark:bg-white/5 rounded-xl px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40">Préstamo #{loan.id} — {loan.client_name}</p>
            <p className="text-[12px] text-slate-700 dark:text-white mt-0.5">
              Cuota: <span className="font-bold">{fmtRD(loan.monthly_payment)}</span>
              <span className="mx-2">-</span>
              Vencía: <span className="font-semibold">{fmtDate(loan.next_due_date)}</span>
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase mb-1">Canal</label>
              <select value={form.channel} onChange={e => set('channel', e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]">
                {CHANNELS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase mb-1">Resultado</label>
              <select value={form.outcome} onChange={e => set('outcome', e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]">
                {OUTCOMES.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase mb-1">Próximo contacto (opcional)</label>
            <input type="date" value={form.next_contact_date} onChange={e => set('next_contact_date', e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]" />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase mb-1">Notas</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3}
              placeholder="Detalles del contacto, promesas, excusas..."
              className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e] resize-none" />
          </div>

          {err && (
            <div className="flex items-center gap-2 text-[11px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2">
              <AlertTriangle size={12} /> {err}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-[12px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg">
            Cancelar
          </button>
          <button type="submit" disabled={saving}
            className="flex items-center gap-1.5 px-5 py-2 bg-[#b3001e] text-white text-[12px] font-bold rounded-lg hover:bg-[#8b0018] disabled:opacity-50 transition-colors">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {saving ? 'Guardando...' : 'Registrar'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Main screen ──────────────────────────────────────────────────────────────

export default function Collections() {
  const api = useAPI()
  const [tab, setTab] = useState('overdue')
  const [loans, setLoans] = useState([])
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [toast, setToast] = useState(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      // Compute mora first so numbers are fresh.
      try { await (api?.collections?.computeMora?.() ?? Promise.resolve()) } catch {}
      const [o, l] = await Promise.all([
        (api?.collections?.overdue?.() ?? Promise.resolve([])),
        (api?.collections?.logList?.({}) ?? api?.collectionsLog?.list?.({}) ?? Promise.resolve([])),
      ])
      setLoans(Array.isArray(o) ? o : [])
      setLogs(Array.isArray(l) ? l : [])
    } catch (e) {
      setLoans([]); setLogs([])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const metrics = useMemo(() => {
    const total = loans.length
    const mora = loans.reduce((s, l) => s + Number(l.mora_amount || 0), 0)
    const outstanding = loans.reduce((s, l) => s + Math.max(0, Number(l.principal || 0) - Number(l.total_paid || 0)), 0)
    const critical = loans.filter(l => Number(l.days_late || 0) >= 30).length
    return { total, mora, outstanding, critical }
  }, [loans])

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(null), 2500) }

  function handleWhatsapp(loan) {
    const msg = buildReminderMessage(loan)
    const url = whatsappUrl(loan.client_phone, msg)
    if (!url) { showToast('Este cliente no tiene teléfono registrado'); return }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-black">
      <div className="bg-white dark:bg-white/5 border-b border-slate-200 dark:border-white/10 px-3 py-3 md:px-6 md:py-4 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <AlertTriangle size={20} className="text-[#b3001e]" />
          <h1 className="text-[14px] md:text-[16px] font-bold text-slate-800 dark:text-white">Cobranza</h1>
        </div>
      </div>

      {/* Summary cards */}
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
          {[{id:'overdue',label:'Cobros vencidos'},{id:'log',label:'Historial de contactos'}].map(t => (
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
          loans.length === 0 ? (
            <div className="text-center py-16">
              <Check size={32} className="text-emerald-400 mx-auto mb-3" />
              <p className="text-[13px] text-slate-500 dark:text-white/60 font-medium">Sin préstamos vencidos. Excelente.</p>
            </div>
          ) : (
            <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 overflow-hidden">
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead className="bg-slate-50 dark:bg-white/5 text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-2.5 text-left">#</th>
                      <th className="px-4 py-2.5 text-left">Deudor</th>
                      <th className="px-4 py-2.5 text-left">Teléfono</th>
                      <th className="px-4 py-2.5 text-left">Vencía</th>
                      <th className="px-4 py-2.5 text-right">Días</th>
                      <th className="px-4 py-2.5 text-right">Cuota</th>
                      <th className="px-4 py-2.5 text-right">Saldo</th>
                      <th className="px-4 py-2.5 text-right">Mora</th>
                      <th className="px-4 py-2.5 w-48"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {loans.map(loan => {
                      const balance = Math.max(0, Number(loan.principal || 0) - Number(loan.total_paid || 0))
                      const critical = Number(loan.days_late || 0) >= 30
                      return (
                        <tr key={loan.id} className="border-t border-slate-100 dark:border-white/5">
                          <td className="px-4 py-2.5 text-slate-500 dark:text-white/50 tabular-nums">{loan.id}</td>
                          <td className="px-4 py-2.5 font-semibold text-slate-800 dark:text-white">{loan.client_name || `Cliente #${loan.client_id}`}</td>
                          <td className="px-4 py-2.5 text-slate-600 dark:text-white/60 tabular-nums">{loan.client_phone || '---'}</td>
                          <td className="px-4 py-2.5 tabular-nums text-[#b3001e] font-semibold">{fmtDate(loan.next_due_date)}</td>
                          <td className={`px-4 py-2.5 text-right tabular-nums ${critical ? 'text-[#b3001e] font-bold' : 'text-amber-600 dark:text-amber-400 font-semibold'}`}>{loan.days_late || 0}d</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-700 dark:text-white">{fmtRD(loan.monthly_payment)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-bold text-slate-800 dark:text-white">{fmtRD(balance)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-[#b3001e] font-semibold">{fmtRD(loan.mora_amount)}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center justify-end gap-1.5">
                              <button onClick={() => handleWhatsapp(loan)}
                                title="Enviar recordatorio por WhatsApp"
                                className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 rounded-lg transition-colors">
                                <MessageSquare size={12} /> WA
                              </button>
                              <button onClick={() => setModal({ loan })}
                                title="Registrar contacto"
                                className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 dark:text-white/80 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg transition-colors">
                                <Phone size={12} /> Log
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {/* Mobile cards */}
              <div className="md:hidden divide-y divide-slate-100 dark:divide-white/5">
                {loans.map(loan => {
                  const balance = Math.max(0, Number(loan.principal || 0) - Number(loan.total_paid || 0))
                  return (
                    <div key={loan.id} className="px-4 py-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[13px] font-bold text-slate-800 dark:text-white truncate">{loan.client_name || `Cliente #${loan.client_id}`}</p>
                          <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">#{loan.id} - vencía {fmtDateShort(loan.next_due_date)} ({loan.days_late || 0}d)</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[13px] font-bold text-slate-800 dark:text-white">{fmtRD(balance)}</p>
                          <p className="text-[10px] text-[#b3001e]">Mora: {fmtRD(loan.mora_amount)}</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleWhatsapp(loan)}
                          className="flex-1 flex items-center justify-center gap-1 px-2 py-2 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 rounded-lg min-h-[44px]">
                          <MessageSquare size={12} /> WhatsApp
                        </button>
                        <button onClick={() => setModal({ loan })}
                          className="flex-1 flex items-center justify-center gap-1 px-2 py-2 text-[11px] font-semibold text-slate-700 dark:text-white/80 bg-slate-100 dark:bg-white/5 rounded-lg min-h-[44px]">
                          <Phone size={12} /> Registrar
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
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
                  {logs.map(lg => (
                    <tr key={lg.id} className="border-t border-slate-100 dark:border-white/5">
                      <td className="px-4 py-2 tabular-nums text-slate-600 dark:text-white/60">{fmtDate(lg.contacted_at)}</td>
                      <td className="px-4 py-2 text-slate-800 dark:text-white">{lg.client_name || `Cliente #${lg.client_id}`}</td>
                      <td className="px-4 py-2 text-slate-600 dark:text-white/60 capitalize">{CHANNELS.find(c => c.id === lg.channel)?.label || lg.channel}</td>
                      <td className="px-4 py-2 text-slate-600 dark:text-white/60">{OUTCOMES.find(o => o.id === lg.outcome)?.label || lg.outcome || '---'}</td>
                      <td className="px-4 py-2 text-slate-600 dark:text-white/60 max-w-md truncate">{lg.notes || '---'}</td>
                      <td className="px-4 py-2 tabular-nums text-slate-600 dark:text-white/60">{fmtDate(lg.next_contact_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {modal && (
        <LogContactModal loan={modal.loan} onClose={() => setModal(null)}
          onSaved={() => { setModal(null); showToast('Contacto registrado'); loadAll() }} />
      )}

      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-slate-800 dark:bg-white/90 text-white dark:text-black text-sm px-5 py-3 rounded-full shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
