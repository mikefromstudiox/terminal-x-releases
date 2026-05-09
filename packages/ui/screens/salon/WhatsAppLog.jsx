/**
 * WhatsAppLog.jsx — v2.16.2 audit screen for salon WhatsApp reminders.
 *
 * Reads `appointment_reminders` rows for the last 30 days and renders them as
 * a sortable / filterable timeline. Owners use this to verify that 24h / 2h /
 * manual / confirm pings actually fired and to surface failures (UltraMsg
 * outage, missing phone, rate-limit). Read-only — sending happens elsewhere.
 *
 * Plan-gated through Sidebar (salon_whatsapp_reminders). Falls back gracefully
 * if `api.appointmentReminders.recent` isn't available on the runtime.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  MessageSquare, Loader2, AlertCircle, CheckCircle2,
  Clock, Send, RefreshCw, Filter, User, Scissors,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'

const KIND_LABEL = {
  '24h':     { es: '24h',      en: '24h' },
  '2h':      { es: '2h',       en: '2h' },
  manual:    { es: 'Manual',   en: 'Manual' },
  confirm:   { es: 'Confirm.', en: 'Confirm.' },
}

const STATUS_STYLE = {
  pending: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30',
  sent:    'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30',
  failed:  'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/30',
  skipped: 'bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-white/50 border-slate-200 dark:border-white/10',
}

const STATUS_LABEL = {
  pending: { es: 'Pendiente', en: 'Pending' },
  sent:    { es: 'Enviado',   en: 'Sent' },
  failed:  { es: 'Fallido',   en: 'Failed' },
  skipped: { es: 'Omitido',   en: 'Skipped' },
}

function fmtDR(iso) {
  if (!iso) return '—'
  // Render in DR local time (UTC-4, no DST). Plain `toLocaleString` would use
  // the host TZ which is right on desktop but wrong on a remote browser.
  try {
    const d = new Date(iso)
    if (!Number.isFinite(d.getTime())) return iso
    const drMs = d.getTime() - 4 * 60 * 60 * 1000
    const x = new Date(drMs)
    const Y = x.getUTCFullYear()
    const M = String(x.getUTCMonth() + 1).padStart(2, '0')
    const D = String(x.getUTCDate()).padStart(2, '0')
    const h = String(x.getUTCHours()).padStart(2, '0')
    const m = String(x.getUTCMinutes()).padStart(2, '0')
    return `${D}/${M}/${Y} ${h}:${m}`
  } catch (_aetherErr) {
    try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'whatsapplog.fmtdr' }) } catch {} return iso }
}

export default function WhatsAppLog() {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [rows,        setRows]        = useState([])
  const [clientsById, setClientsById] = useState(new Map())
  const [empsById,    setEmpsById]    = useState(new Map())
  const [apptsById,   setApptsById]   = useState(new Map())
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState('')
  const [filterStatus, setFilterStatus] = useState('all')

  async function load() {
    setLoading(true); setError('')
    try {
      let recent = []
      if (api?.appointmentReminders?.recent) {
        recent = await api.appointmentReminders.recent({ days: 30 }) || []
      } else if (api?.appointmentReminders?.pendingDue) {
        // Fallback: at least show pending ones.
        recent = await api.appointmentReminders.pendingDue() || []
      }
      const [clients, emps, appts] = await Promise.all([
        api?.clients?.getAll?.().catch(() => []) || [],
        api?.empleados?.all?.().catch(() => []) || [],
        api?.appointments?.list?.().catch(() => []) || [],
      ])
      const cMap = new Map()
      ;(clients || []).forEach(c => {
        if (c?.supabase_id) cMap.set(c.supabase_id, c)
        if (c?.id) cMap.set(`id:${c.id}`, c)
      })
      const eMap = new Map()
      ;(emps || []).forEach(e => {
        if (e?.supabase_id) eMap.set(e.supabase_id, e)
        if (e?.id) eMap.set(`id:${e.id}`, e)
      })
      const aMap = new Map()
      ;(appts || []).forEach(a => {
        if (a?.supabase_id) aMap.set(a.supabase_id, a)
      })
      setClientsById(cMap)
      setEmpsById(eMap)
      setApptsById(aMap)
      setRows(Array.isArray(recent) ? recent : [])
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'whatsapplog.fmtdr' }) } catch {}
      setError(e?.message || L('Error al cargar', 'Load error'))
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    if (filterStatus === 'all') return rows
    return rows.filter(r => String(r.status || '').toLowerCase() === filterStatus)
  }, [rows, filterStatus])

  function clientFor(rem) {
    const appt = apptsById.get(rem.appointment_supabase_id)
    if (!appt) return null
    if (appt.client_supabase_id && clientsById.get(appt.client_supabase_id)) return clientsById.get(appt.client_supabase_id)
    if (appt.client_id && clientsById.get(`id:${appt.client_id}`)) return clientsById.get(`id:${appt.client_id}`)
    return null
  }
  function stylistFor(rem) {
    const appt = apptsById.get(rem.appointment_supabase_id)
    if (!appt) return null
    if (appt.empleado_supabase_id && empsById.get(appt.empleado_supabase_id)) return empsById.get(appt.empleado_supabase_id)
    if (appt.empleado_id && empsById.get(`id:${appt.empleado_id}`)) return empsById.get(`id:${appt.empleado_id}`)
    return null
  }

  const counts = useMemo(() => {
    const c = { all: rows.length, pending: 0, sent: 0, failed: 0, skipped: 0 }
    for (const r of rows) {
      const s = String(r.status || '').toLowerCase()
      if (c[s] !== undefined) c[s]++
    }
    return c
  }, [rows])

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-black">
      {/* Header */}
      <div className="bg-white dark:bg-white/5 border-b border-slate-200 dark:border-white/10 px-3 md:px-6 py-3 md:py-4 shrink-0 flex items-center gap-3">
        <MessageSquare size={20} className="text-slate-500 dark:text-white/60" />
        <div className="flex-1 min-w-0">
          <h1 className="text-[14px] md:text-[16px] font-bold text-slate-800 dark:text-white">
            {L('Recordatorios WhatsApp', 'WhatsApp reminders')}
          </h1>
          <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">
            {L('Auditoría de los últimos 30 días', 'Audit of the last 30 days')}
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 dark:border-white/10 rounded-lg text-[11px] font-bold text-slate-600 dark:text-white/70 hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-50">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> {L('Actualizar', 'Refresh')}
        </button>
      </div>

      {/* Filter chips */}
      <div className="px-3 md:px-6 py-3 border-b border-slate-200 dark:border-white/10 flex flex-wrap gap-1.5 bg-white dark:bg-transparent">
        {[
          { k: 'all',     es: 'Todos',     en: 'All' },
          { k: 'pending', es: 'Pendiente', en: 'Pending' },
          { k: 'sent',    es: 'Enviado',   en: 'Sent' },
          { k: 'failed',  es: 'Fallido',   en: 'Failed' },
          { k: 'skipped', es: 'Omitido',   en: 'Skipped' },
        ].map(t => (
          <button
            key={t.k}
            type="button"
            onClick={() => setFilterStatus(t.k)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider border transition-colors ${
              filterStatus === t.k
                ? 'bg-[#b3001e] text-white border-[#b3001e]'
                : 'bg-white dark:bg-white/5 text-slate-600 dark:text-white/60 border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10'
            }`}
          >
            {L(t.es, t.en)} <span className="opacity-70 ml-1">{counts[t.k] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-3 md:px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 dark:text-white/40 gap-2">
            <Loader2 size={16} className="animate-spin" /> {L('Cargando...', 'Loading...')}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 text-red-500 gap-2">
            <AlertCircle size={24} />
            <p className="text-[13px]">{error}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-300 dark:text-white/30 gap-2">
            <MessageSquare size={32} />
            <p className="text-[13px]">{L('Sin recordatorios en este filtro.', 'No reminders for this filter.')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40 border-b border-slate-200 dark:border-white/10">
                  <th className="text-left px-3 py-2 font-bold">{L('Disparo', 'Fire at')}</th>
                  <th className="text-left px-3 py-2 font-bold">{L('Tipo', 'Kind')}</th>
                  <th className="text-left px-3 py-2 font-bold">{L('Cliente', 'Client')}</th>
                  <th className="text-left px-3 py-2 font-bold">{L('Estilista', 'Stylist')}</th>
                  <th className="text-left px-3 py-2 font-bold">{L('Estado', 'Status')}</th>
                  <th className="text-left px-3 py-2 font-bold">{L('Error', 'Error')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const c = clientFor(r)
                  const e = stylistFor(r)
                  const status = String(r.status || 'pending').toLowerCase()
                  const klabel = KIND_LABEL[r.kind] || { es: r.kind, en: r.kind }
                  return (
                    <tr key={r.id || r.supabase_id} className="border-b border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/5">
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap text-slate-700 dark:text-white">{fmtDR(r.fire_at)}</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#b3001e]/10 text-[#b3001e] border border-[#b3001e]/20 uppercase tracking-wider">
                          {L(klabel.es, klabel.en)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-700 dark:text-white">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <User size={11} className="text-slate-400 dark:text-white/40 shrink-0" />
                          <span className="truncate">{c?.name || '—'}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-white/70">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Scissors size={11} className="text-slate-400 dark:text-white/40 shrink-0" />
                          <span className="truncate">{e?.nombre || '—'}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider ${STATUS_STYLE[status] || STATUS_STYLE.pending}`}>
                          {L((STATUS_LABEL[status] || {}).es || status, (STATUS_LABEL[status] || {}).en || status)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-500 dark:text-white/50 max-w-[280px] truncate" title={r.error || ''}>
                        {r.error || ''}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
