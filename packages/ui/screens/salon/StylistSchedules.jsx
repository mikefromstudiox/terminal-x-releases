/**
 * StylistSchedules.jsx — Weekly availability matrix per empleado (tipo=lavador/hybrid).
 *
 * Salon-vertical management screen. Lets the owner define Mon-Sun start/end
 * windows for each stylist. Appointments UI will later consult these rows to
 * grey out unavailable slots. A stylist with no schedule rows is treated as
 * always available (backwards-compatible with the existing day-view grid).
 *
 * Persists via api.stylistSchedules.{list,create,update,delete} which is wired
 * through electron IPC (desktop) and Supabase (web) transparently.
 */

import { useState, useEffect, useMemo } from 'react'
import {
  Clock, Plus, Trash2, Loader2, CheckCircle2, AlertCircle,
  Scissors, Calendar as CalendarIcon, Wand2,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'

const DAYS = [
  { dow: 1, es: 'Lun', en: 'Mon', full_es: 'Lunes',     full_en: 'Monday'    },
  { dow: 2, es: 'Mar', en: 'Tue', full_es: 'Martes',    full_en: 'Tuesday'   },
  { dow: 3, es: 'Mié', en: 'Wed', full_es: 'Miércoles', full_en: 'Wednesday' },
  { dow: 4, es: 'Jue', en: 'Thu', full_es: 'Jueves',    full_en: 'Thursday'  },
  { dow: 5, es: 'Vie', en: 'Fri', full_es: 'Viernes',   full_en: 'Friday'    },
  { dow: 6, es: 'Sáb', en: 'Sat', full_es: 'Sábado',    full_en: 'Saturday'  },
  { dow: 0, es: 'Dom', en: 'Sun', full_es: 'Domingo',   full_en: 'Sunday'    },
]

const DEFAULT_START = '09:00'
const DEFAULT_END   = '18:00'

export default function StylistSchedules() {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [empleados, setEmpleados] = useState([])
  const [schedules, setSchedules] = useState([])
  const [todayStats, setTodayStats] = useState({}) // { [empleado_id]: { count, earned } }
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(null) // `${empId}-${dow}`
  const [toast,     setToast]     = useState(null)
  const [confirmDefault, setConfirmDefault] = useState(null) // empleado_id
  const [applying,  setApplying]  = useState(false)

  function flash(msg, ok = true) {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 2500)
  }

  // v2.16.2 (Fix 4) — local-date YYYY-MM-DD (DR is UTC-4, no DST). Without
  // this, after 8pm AST `toISOString` rolls to tomorrow and "Citas hoy" /
  // "Ganado hoy" both render zero with cash drawer full.
  function localDateStr(d = new Date()) {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  async function load() {
    setLoading(true)
    try {
      const today = localDateStr()
      const [emps, schs, tickets, services] = await Promise.all([
        api?.empleados?.all?.() || [],
        api?.stylistSchedules?.list?.() || [],
        // Best-effort: list today's tickets so we can compute commissions inline.
        api?.tickets?.list?.({ from: today, to: today }) || api?.tickets?.list?.({ date: today }) || [],
        api?.services?.getAll?.() || [],
      ])
      // Salon schedules only make sense for stylists (tipo lavador or hybrid) or any active empleado.
      const activeEmps = (emps || []).filter(e => e.active !== 0)
      setEmpleados(activeEmps)
      setSchedules(schs || [])

      // Compute per-stylist count + earnings for today.
      // Earnings = Σ (line_subtotal × commission_pct/100) where the line's
      // empleado matches. Falls back to ticket-level empleado if cart-line
      // empleado isn't shipped yet. Service vs retail commission split is
      // 50%/10% defaults when row doesn't carry an explicit pct.
      const svcByName = new Map()
      ;(services || []).forEach(s => svcByName.set((s.name || '').toLowerCase(), s))
      const stats = {}
      for (const e of activeEmps) stats[e.id] = { count: 0, earned: 0 }
      for (const t of (tickets || [])) {
        // Group by line empleado_id (preferred) or whole-ticket empleado_id.
        const lines = Array.isArray(t.items) ? t.items : Array.isArray(t.services) ? t.services : []
        if (lines.length === 0 && t.empleado_id) {
          const total = Number(t.total || 0)
          if (stats[t.empleado_id]) {
            stats[t.empleado_id].count += 1
            stats[t.empleado_id].earned += total * 0.5
          }
          continue
        }
        const seen = new Set()
        for (const line of lines) {
          const empId = line.empleado_id || t.empleado_id
          if (!empId || !stats[empId]) continue
          const lineTotal = Number(line.price || line.subtotal || 0) * Number(line.qty || 1)
          const isService = !!line.service_id || !!line.service_supabase_id ||
            (line.name && svcByName.has(String(line.name).toLowerCase()))
          const pct = Number(line.commission_pct ?? (isService ? 50 : 10)) / 100
          stats[empId].earned += lineTotal * pct
          if (!seen.has(empId)) { stats[empId].count += 1; seen.add(empId) }
        }
      }
      setTodayStats(stats)
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'stylistschedules.stylistschedules' }) } catch {}
      flash(e?.message || L('Error cargando', 'Error loading'), false)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // Quick lookup: `${empleado_id}-${dow}` → schedule row
  const byKey = useMemo(() => {
    const m = new Map()
    for (const s of schedules) m.set(`${s.empleado_id}-${s.day_of_week}`, s)
    return m
  }, [schedules])

  async function setSlot(empleado_id, dow, patch) {
    const key = `${empleado_id}-${dow}`
    setSaving(key)
    try {
      const existing = byKey.get(key)
      if (existing) {
        if (patch.is_off) {
          await api.stylistSchedules.delete(existing.id)
        } else {
          await api.stylistSchedules.update({ id: existing.id, ...patch })
        }
      } else if (!patch.is_off) {
        await api.stylistSchedules.create({
          empleado_id,
          day_of_week: dow,
          start_time: patch.start_time || DEFAULT_START,
          end_time:   patch.end_time   || DEFAULT_END,
        })
      }
      await load()
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'stylistschedules.load' }) } catch {}
      flash(e?.message || L('Error al guardar', 'Save error'), false)
    }
    setSaving(null)
  }

  async function applyDefaultSchedule(empleado_id) {
    setApplying(true)
    try {
      // Mon=1..Sat=6 → 09:00-19:00. Sun=0 stays libre.
      for (let dow = 1; dow <= 6; dow++) {
        const existing = byKey.get(`${empleado_id}-${dow}`)
        if (existing) {
          await api.stylistSchedules.update({ id: existing.id, start_time: '09:00', end_time: '19:00' })
        } else {
          await api.stylistSchedules.create({
            empleado_id,
            day_of_week: dow,
            start_time: '09:00',
            end_time:   '19:00',
          })
        }
      }
      await load()
      flash(L('Horario por defecto aplicado', 'Default schedule applied'))
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'stylistschedules.setslot' }) } catch {}
      flash(e?.message || L('Error al aplicar', 'Apply error'), false)
    }
    setApplying(false)
    setConfirmDefault(null)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-black">
      {/* Header */}
      <div className="bg-white dark:bg-white/5 border-b border-slate-200 dark:border-white/10 px-3 md:px-6 py-3 md:py-4 shrink-0">
        <div className="flex items-center gap-3">
          <CalendarIcon size={20} className="text-slate-500 dark:text-white/60" />
          <div>
            <h1 className="text-[14px] md:text-[16px] font-bold text-slate-800 dark:text-white">
              {L('Horarios de Estilistas', 'Stylist Schedules')}
            </h1>
            <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">
              {L('Define horario semanal. Sin fila = disponible todo el día.',
                 'Set weekly hours. No row = available all day.')}
            </p>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-3 md:px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 dark:text-white/40 gap-2">
            <Loader2 size={16} className="animate-spin" /> {L('Cargando...', 'Loading...')}
          </div>
        ) : empleados.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-300 dark:text-white/30 gap-2">
            <Scissors size={32} />
            <p className="text-sm">{L('No hay empleados activos.', 'No active employees.')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {empleados.map(emp => (
              <div key={emp.id} className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-white/10">
                  <div className="w-9 h-9 rounded-full bg-[#b3001e]/10 flex items-center justify-center text-[#b3001e] font-bold text-[12px]">
                    {(emp.nombre || '?').split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[13px] font-bold text-slate-800 dark:text-white truncate">{emp.nombre}</p>
                      <button
                        type="button"
                        onClick={() => setConfirmDefault(emp.id)}
                        disabled={applying}
                        title={L('Aplicar horario por defecto Lun-Sáb 9-7', 'Apply default Mon-Sat 9-7')}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded-md border border-[#b3001e] text-[#b3001e] hover:bg-[#b3001e] hover:text-white transition-colors disabled:opacity-50"
                      >
                        <Wand2 size={10}/>{L('Aplicar horario por defecto', 'Apply default schedule')}
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-400 dark:text-white/40 uppercase tracking-wider">{emp.tipo || 'estilista'}</p>
                  </div>
                  <div className="flex items-center gap-3 text-right">
                    <div>
                      <p className="text-[9px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">
                        {L('Citas hoy', 'Today')}
                      </p>
                      <p className="text-[13px] font-bold text-slate-800 dark:text-white tabular-nums">
                        {todayStats[emp.id]?.count || 0}
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">
                        {L('Ganado hoy', 'Earned today')}
                      </p>
                      <p className="text-[13px] font-bold text-[#b3001e] tabular-nums">
                        RD$ {Number(todayStats[emp.id]?.earned || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-7 gap-2 p-3">
                  {DAYS.map(d => {
                    const row = byKey.get(`${emp.id}-${d.dow}`)
                    const key = `${emp.id}-${d.dow}`
                    const isSaving = saving === key
                    const active = !!row
                    return (
                      <div key={d.dow}
                        className={`rounded-xl border p-2.5 transition-colors ${
                          active
                            ? 'bg-white dark:bg-white/5 border-[#b3001e]/40'
                            : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10'
                        }`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[11px] font-bold text-slate-600 dark:text-white/70">
                            {lang === 'es' ? d.es : d.en}
                          </span>
                          {isSaving
                            ? <Loader2 size={11} className="animate-spin text-slate-400" />
                            : active
                              ? <button onClick={() => setSlot(emp.id, d.dow, { is_off: true })}
                                  className="text-[10px] text-red-500 hover:text-red-700 font-semibold">
                                  {L('Libre', 'Off')}
                                </button>
                              : <button onClick={() => setSlot(emp.id, d.dow, { start_time: DEFAULT_START, end_time: DEFAULT_END })}
                                  className="text-[10px] text-emerald-600 hover:text-emerald-700 font-semibold flex items-center gap-0.5">
                                  <Plus size={10}/>{L('Trabaja', 'Work')}
                                </button>
                          }
                        </div>
                        {active && (
                          <div className="flex items-center gap-1">
                            <input type="time" value={row.start_time || DEFAULT_START}
                              onChange={e => setSlot(emp.id, d.dow, { start_time: e.target.value, end_time: row.end_time || DEFAULT_END })}
                              className="w-full px-1.5 py-1 text-[11px] rounded border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-white tabular-nums" />
                            <span className="text-[10px] text-slate-400">—</span>
                            <input type="time" value={row.end_time || DEFAULT_END}
                              onChange={e => setSlot(emp.id, d.dow, { start_time: row.start_time || DEFAULT_START, end_time: e.target.value })}
                              className="w-full px-1.5 py-1 text-[11px] rounded border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-white tabular-nums" />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Confirm default-schedule dialog */}
      {confirmDefault !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="bg-white dark:bg-neutral-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl max-w-sm w-full p-5">
            <div className="flex items-center gap-2 mb-3">
              <Wand2 size={16} className="text-[#b3001e]" />
              <h3 className="text-[14px] font-bold text-slate-800 dark:text-white">
                {L('Aplicar horario por defecto', 'Apply default schedule')}
              </h3>
            </div>
            <p className="text-[12px] text-slate-600 dark:text-white/60 mb-4">
              {L('Se creará el horario Lunes a Sábado de 9:00 a 19:00. Domingo queda libre. Sobrescribe horarios existentes de esos días.',
                 'Will set Monday-Saturday 9:00-19:00. Sunday stays off. Overwrites existing days.')}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDefault(null)}
                disabled={applying}
                className="px-3 py-1.5 text-[12px] rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70 hover:bg-slate-100 dark:hover:bg-white/10"
              >
                {L('Cancelar', 'Cancel')}
              </button>
              <button
                onClick={() => applyDefaultSchedule(confirmDefault)}
                disabled={applying}
                className="px-3 py-1.5 text-[12px] rounded-lg bg-[#b3001e] hover:bg-[#8f0018] text-white font-bold flex items-center gap-1.5 disabled:opacity-60"
              >
                {applying && <Loader2 size={11} className="animate-spin" />}
                {L('Aplicar', 'Apply')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 flex items-center gap-2 text-white text-sm font-medium px-4 py-3 rounded-xl shadow-xl z-50 ${
          toast.ok ? 'bg-slate-800 dark:bg-white/10' : 'bg-red-600'
        }`}>
          {toast.ok ? <CheckCircle2 size={14} className="text-green-400"/> : <AlertCircle size={14}/>}
          {toast.msg}
        </div>
      )}
    </div>
  )
}
