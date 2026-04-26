// Memberships.jsx — carwash-only monthly subscription CRUD screen.
// Each membership binds a vehicle (optional) to a client with a monthly wash quota.
// Rolling period is maintained by the desktop (membershipGetActiveForClient) on read;
// web clients see the raw period_start/period_end written by the last desktop touch.

import { useEffect, useMemo, useState } from 'react'
import { Plus, X, RefreshCw, AlertCircle, Trash2, Pencil, Car, BadgeCheck, Ban, Pause } from 'lucide-react'
import { useLang } from '../../i18n'
import { useAPI } from '../../context/DataContext'
import { useBusinessType } from '../../hooks/useBusinessType.jsx'
import { Navigate } from 'react-router-dom'

function fmtRD(n) { return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
function fmtDate(s) { if (!s) return '—'; return new Date(s + (String(s).includes('T') ? '' : 'T12:00:00')).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' }) }

const STATUS_META = {
  active:    { es: 'Activa',    en: 'Active',    dot: 'bg-green-500', text: 'text-green-700 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-500/10' },
  paused:    { es: 'Pausada',   en: 'Paused',    dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10' },
  cancelled: { es: 'Cancelada', en: 'Cancelled', dot: 'bg-red-500',   text: 'text-red-700 dark:text-red-400',     bg: 'bg-red-50 dark:bg-red-500/10' },
}

export default function Memberships() {
  const { lang } = useLang()
  const api = useAPI()
  const { businessType } = useBusinessType()

  // Carwash-only screen — anyone else lands here by URL, send them home.
  if (businessType && businessType !== 'carwash') {
    return <Navigate to="/clients" replace />
  }

  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [clients, setClients] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [editing,  setEditing]  = useState(null)
  const [toast,    setToast]    = useState(null)

  function flash(m) { setToast(m); setTimeout(() => setToast(null), 2500) }

  async function load() {
    setLoading(true)
    try {
      const [m, c, v] = await Promise.all([
        api?.memberships?.list?.() ?? [],
        api?.clients?.all?.() ?? [],
        api?.vehicles?.list?.() ?? [],
      ])
      setRows(m || [])
      setClients(c || [])
      setVehicles(v || [])
    } catch (e) {
      console.error('[Memberships] load', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function saveMembership(form) {
    // FIX 5.3 — keep the form open on failure so the cashier can correct &
    // retry. ALWAYS reload after either path so a partial server-side
    // rollback doesn't leave a stale optimistic row in the list.
    try {
      if (editing) {
        await api.memberships.update({ id: editing.id, ...form })
        flash(lang === 'es' ? 'Membresía actualizada' : 'Membership updated')
      } else {
        const res = await api.memberships.create(form)
        if (!res || (!res.id && !res.supabase_id)) {
          throw new Error(lang === 'es'
            ? 'La membresía no fue creada — intenta de nuevo'
            : 'Membership was not created — please retry')
        }
        flash(lang === 'es' ? 'Membresía creada' : 'Membership created')
      }
      setShowForm(false); setEditing(null)
    } catch (e) {
      flash(lang === 'es'
        ? `Error · operación revertida: ${e.message}`
        : `Error · operation rolled back: ${e.message}`)
    } finally {
      await load()
    }
  }

  async function toggleStatus(m, next) {
    try {
      await api.memberships.update({ id: m.id, status: next })
      flash(lang === 'es' ? 'Estado actualizado' : 'Status updated')
      await load()
    } catch (e) { flash(`Error: ${e.message}`) }
  }

  async function remove(m) {
    if (!confirm(lang === 'es' ? 'Cancelar esta membresía?' : 'Cancel this membership?')) return
    try {
      await api.memberships.delete?.(m.id)
      flash(lang === 'es' ? 'Membresía cancelada' : 'Membership cancelled')
      await load()
    } catch (e) { flash(`Error: ${e.message}`) }
  }

  const counts = useMemo(() => ({
    active:    rows.filter(r => r.status === 'active').length,
    paused:    rows.filter(r => r.status === 'paused').length,
    cancelled: rows.filter(r => r.status === 'cancelled').length,
  }), [rows])

  return (
    <div className="h-full flex flex-col bg-white dark:bg-black">
      <div className="shrink-0 px-4 md:px-6 py-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
        <div>
          <h2 className="text-[14px] md:text-[16px] font-bold text-slate-800 dark:text-white">
            {lang === 'es' ? 'Membresías' : 'Memberships'}
          </h2>
          <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">
            {loading ? '…' : `${counts.active} ${lang === 'es' ? 'activas' : 'active'} · ${counts.paused} ${lang === 'es' ? 'pausadas' : 'paused'} · ${counts.cancelled} ${lang === 'es' ? 'canceladas' : 'cancelled'}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading}
            className="w-9 h-9 flex items-center justify-center text-slate-400 dark:text-white/40 hover:text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-500/10 rounded-lg transition-colors">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => { setEditing(null); setShowForm(true) }}
            className="flex items-center gap-2 px-4 py-2 bg-black dark:bg-white/10 hover:bg-slate-800 dark:hover:bg-white/20 text-white rounded-xl text-sm font-medium">
            <Plus size={14} />
            {lang === 'es' ? 'Nueva' : 'New'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-slate-400 dark:text-white/40 text-[13px]">
            {lang === 'es' ? 'Cargando…' : 'Loading…'}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-60 text-slate-300 dark:text-white/30 gap-2">
            <BadgeCheck size={30} />
            <p className="text-[13px]">{lang === 'es' ? 'Sin membresías registradas' : 'No memberships yet'}</p>
            <button onClick={() => { setEditing(null); setShowForm(true) }}
              className="mt-2 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-[12px] font-semibold rounded-xl">
              {lang === 'es' ? 'Crear la primera' : 'Create the first one'}
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-white/10">
            {rows.map(m => {
              const sm = STATUS_META[m.status] || STATUS_META.active
              const used = Number(m.washes_used_this_period) || 0
              const quota = Number(m.wash_quota_per_month) || 0
              const pct = quota > 0 ? Math.min(100, (used / quota) * 100) : 0
              return (
                <li key={m.id} className="px-4 md:px-6 py-3 flex flex-col md:flex-row md:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${sm.bg} ${sm.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${sm.dot}`} />
                        {lang === 'es' ? sm.es : sm.en}
                      </span>
                      <p className="text-[13px] font-bold text-slate-800 dark:text-white truncate">{m.plan_name}</p>
                    </div>
                    <p className="text-[12px] text-slate-500 dark:text-white/60 truncate mt-0.5">
                      {m.client_name || '—'}
                      {m.vehicle_plate && <> · <Car size={10} className="inline-block -mt-0.5" /> {m.vehicle_plate}</>}
                    </p>
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-[11px] text-slate-500 dark:text-white/60">
                        {used}/{quota} {lang === 'es' ? 'lavados este mes' : 'washes this month'}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-700 dark:text-white/80">{fmtRD(m.plan_price)}/mes</span>
                      {m.end_date && <span className="text-[10px] text-slate-400 dark:text-white/40">hasta {fmtDate(m.end_date)}</span>}
                    </div>
                    <div className="h-1.5 bg-slate-100 dark:bg-white/10 rounded-full overflow-hidden mt-1.5 max-w-md">
                      <div className={`h-full ${pct >= 100 ? 'bg-red-500' : pct > 80 ? 'bg-amber-400' : 'bg-green-400'}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {m.status === 'active' && (
                      <button onClick={() => toggleStatus(m, 'paused')}
                        title={lang === 'es' ? 'Pausar' : 'Pause'}
                        className="p-2 text-slate-400 dark:text-white/40 hover:text-amber-500 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-500/10">
                        <Pause size={14} />
                      </button>
                    )}
                    {m.status === 'paused' && (
                      <button onClick={() => toggleStatus(m, 'active')}
                        title={lang === 'es' ? 'Reactivar' : 'Reactivate'}
                        className="p-2 text-slate-400 dark:text-white/40 hover:text-green-600 rounded-lg hover:bg-green-50 dark:hover:bg-green-500/10">
                        <BadgeCheck size={14} />
                      </button>
                    )}
                    <button onClick={() => { setEditing(m); setShowForm(true) }}
                      title={lang === 'es' ? 'Editar' : 'Edit'}
                      className="p-2 text-slate-400 dark:text-white/40 hover:text-sky-600 rounded-lg hover:bg-sky-50 dark:hover:bg-sky-500/10">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => remove(m)}
                      title={lang === 'es' ? 'Cancelar' : 'Cancel'}
                      className="p-2 text-slate-400 dark:text-white/40 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {showForm && (
        <MembershipForm
          editing={editing}
          clients={clients}
          vehicles={vehicles}
          lang={lang}
          onClose={() => { setShowForm(false); setEditing(null) }}
          onSave={saveMembership}
        />
      )}

      {toast && (
        <div className="fixed bottom-20 md:bottom-6 right-6 bg-slate-800 text-white text-[12px] font-medium px-4 py-3 rounded-xl shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  )
}

function MembershipForm({ editing, clients, vehicles, lang, onClose, onSave }) {
  const [form, setForm] = useState({
    client_id:            editing?.client_id || '',
    vehicle_id:           editing?.vehicle_id || '',
    plan_name:            editing?.plan_name || '',
    plan_price:           editing?.plan_price != null ? String(editing.plan_price) : '',
    wash_quota_per_month: editing?.wash_quota_per_month != null ? String(editing.wash_quota_per_month) : '4',
    start_date:           editing?.start_date || new Date().toISOString().slice(0, 10),
    end_date:             editing?.end_date || '',
    notes:                editing?.notes || '',
  })
  const [saving, setSaving] = useState(false)

  const clientVehicles = useMemo(() => {
    if (!form.client_id) return vehicles
    return vehicles.filter(v => String(v.client_id) === String(form.client_id))
  }, [vehicles, form.client_id])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function submit(e) {
    e?.preventDefault?.()
    if (!form.plan_name.trim()) return
    setSaving(true)
    try {
      await onSave({
        client_id:            form.client_id ? Number(form.client_id) : null,
        vehicle_id:           form.vehicle_id ? Number(form.vehicle_id) : null,
        plan_name:            form.plan_name.trim(),
        plan_price:           Number(form.plan_price) || 0,
        wash_quota_per_month: Number(form.wash_quota_per_month) || 0,
        start_date:           form.start_date || null,
        end_date:             form.end_date || null,
        notes:                form.notes.trim() || null,
      })
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <form onClick={e => e.stopPropagation()} onSubmit={submit}
        className="w-full max-w-md mx-4 bg-white dark:bg-black rounded-2xl border border-slate-200 dark:border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10">
          <h3 className="text-[14px] font-bold text-slate-800 dark:text-white">
            {editing ? (lang === 'es' ? 'Editar Membresía' : 'Edit Membership') : (lang === 'es' ? 'Nueva Membresía' : 'New Membership')}
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 dark:text-white/40 hover:text-slate-600 p-1 rounded-lg">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 dark:text-white/60 mb-1">{lang === 'es' ? 'Cliente' : 'Client'}</label>
            <select value={form.client_id} onChange={e => set('client_id', e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[13px] text-slate-700 dark:text-white">
              <option value="">{lang === 'es' ? '— Sin cliente —' : '— No client —'}</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 dark:text-white/60 mb-1">{lang === 'es' ? 'Vehículo' : 'Vehicle'}</label>
            <select value={form.vehicle_id} onChange={e => set('vehicle_id', e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[13px] text-slate-700 dark:text-white">
              <option value="">{lang === 'es' ? '— Sin vehículo —' : '— No vehicle —'}</option>
              {clientVehicles.map(v => (
                <option key={v.id} value={v.id}>{[v.plate, v.make, v.model].filter(Boolean).join(' · ')}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 dark:text-white/60 mb-1">{lang === 'es' ? 'Nombre del plan *' : 'Plan name *'}</label>
            <input value={form.plan_name} onChange={e => set('plan_name', e.target.value)} required
              placeholder={lang === 'es' ? 'Ej: Plan Bronce 4 lavados' : 'e.g. Bronze 4 washes'}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[13px] text-slate-700 dark:text-white" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 dark:text-white/60 mb-1">{lang === 'es' ? 'Precio mensual' : 'Monthly price'}</label>
              <input type="number" step="0.01" value={form.plan_price} onChange={e => set('plan_price', e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[13px] text-slate-700 dark:text-white" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 dark:text-white/60 mb-1">{lang === 'es' ? 'Lavados/mes' : 'Washes/month'}</label>
              <input type="number" min="0" value={form.wash_quota_per_month} onChange={e => set('wash_quota_per_month', e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[13px] text-slate-700 dark:text-white" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 dark:text-white/60 mb-1">{lang === 'es' ? 'Desde' : 'From'}</label>
              <input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[13px] text-slate-700 dark:text-white" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 dark:text-white/60 mb-1">{lang === 'es' ? 'Hasta' : 'To'}</label>
              <input type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[13px] text-slate-700 dark:text-white" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 dark:text-white/60 mb-1">{lang === 'es' ? 'Notas' : 'Notes'}</label>
            <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[13px] text-slate-700 dark:text-white resize-none" />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-200 dark:border-white/10 flex gap-3">
          <button type="button" onClick={onClose}
            className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-[13px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10">
            {lang === 'es' ? 'Cancelar' : 'Cancel'}
          </button>
          <button type="submit" disabled={saving || !form.plan_name.trim()}
            className="flex-1 py-2 rounded-xl bg-[#b3001e] hover:bg-[#8c0017] disabled:opacity-50 text-white text-[13px] font-bold">
            {saving ? (lang === 'es' ? 'Guardando…' : 'Saving…') : (lang === 'es' ? 'Guardar' : 'Save')}
          </button>
        </div>
      </form>
    </div>
  )
}
