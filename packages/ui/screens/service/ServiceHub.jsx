/**
 * ServiceHub.jsx — Central console for the generic "service" vertical.
 *
 * Five-tab UI built on top of the four service-vertical data tables:
 *   1) Suscripciones     (recurring billing, Próximos Cobros dashboard)
 *   2) Paquetes          (prepaid blocks of sessions; 80% used alerts)
 *   3) Proyectos         (job tracker — draft/active/paused/closed, running billed total)
 *   4) Tarifas Cliente   (per-client price overrides against the service catalog)
 *   5) Cobro por Hora    (timer — start/stop, computes duration_minutes × hourly_rate)
 *
 * All writes funnel through the DataContext API (desktop: IPC, web: Supabase).
 * Pure Spanish UI. Strict crimson/black/white palette — no gray.
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import {
  RefreshCw, Plus, X, Check, Clock, Play, Pause, Briefcase,
  Users as UsersIcon, Package, Calendar, DollarSign, AlertCircle, Trash2,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'

const RED  = '#b3001e'
const TABS = [
  { id: 'subscriptions', label: 'Suscripciones',   icon: Calendar },
  { id: 'packages',      label: 'Paquetes',        icon: Package },
  { id: 'projects',      label: 'Proyectos',       icon: Briefcase },
  { id: 'rates',         label: 'Tarifas Cliente', icon: DollarSign },
  { id: 'timer',         label: 'Cobro por Hora',  icon: Clock },
]

function money(v) { return 'RD$' + Number(v || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function dateShort(s) { if (!s) return '—'; try { return new Date(s.length <= 10 ? s + 'T12:00:00' : s).toLocaleDateString('es-DO') } catch { return s } }
function daysUntil(s) { if (!s) return null; const d = new Date(s + 'T12:00:00'); return Math.round((d - Date.now()) / 86400000) }

export default function ServiceHub() {
  const [tab, setTab] = useState('subscriptions')
  const TabIcon = TABS.find(t => t.id === tab)?.icon || Briefcase

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6">
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
          <TabIcon className="w-6 h-6" style={{ color: RED }} />
          Servicios
        </h1>
      </header>

      <nav className="flex flex-wrap gap-1 mb-5 border-b border-slate-200 dark:border-white/10">
        {TABS.map(t => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-[1px] ${
                active
                  ? 'text-white dark:text-white'
                  : 'text-slate-600 dark:text-white/60 border-transparent hover:text-slate-800 dark:hover:text-white'
              }`}
              style={active ? { borderColor: RED, color: RED } : {}}
            >
              <Icon className="w-4 h-4" />{t.label}
            </button>
          )
        })}
      </nav>

      {tab === 'subscriptions' && <SubscriptionsTab />}
      {tab === 'packages'      && <PackagesTab />}
      {tab === 'projects'      && <ProjectsTab />}
      {tab === 'rates'         && <RatesTab />}
      {tab === 'timer'         && <TimerTab />}
    </div>
  )
}

// ── Shared helpers ────────────────────────────────────────────────────────────
function useClientsAndServices() {
  const api = useAPI()
  const [clients,  setClients]  = useState([])
  const [services, setServices] = useState([])
  useEffect(() => {
    (async () => {
      try {
        const [c, s] = await Promise.all([
          api?.clients?.all?.()  ?? [],
          api?.services?.all?.() ?? [],
        ])
        setClients(c || []); setServices(s || [])
      } catch {}
    })()
  }, [api])
  return { clients, services }
}

function Empty({ icon: Icon, title, hint }) {
  return (
    <div className="text-center py-12 text-slate-500 dark:text-white/40">
      {Icon && <Icon className="w-10 h-10 mx-auto mb-3 opacity-50" />}
      <p className="font-medium">{title}</p>
      {hint && <p className="text-sm mt-1">{hint}</p>}
    </div>
  )
}

function Modal({ open, onClose, title, children }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-black border border-slate-200 dark:border-white/10 rounded-xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-800 dark:text-white">{title}</h3>
          <button onClick={onClose} className="p-1 text-slate-500 dark:text-white/60 hover:text-slate-800 dark:hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

const inputClass = 'w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]/40'
const btnPrimary = `px-4 py-2 rounded-lg text-white font-medium transition`
const btnSecondary = 'px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/80 font-medium hover:bg-slate-50 dark:hover:bg-white/5'

// ── 1) SUBSCRIPTIONS ──────────────────────────────────────────────────────────
function SubscriptionsTab() {
  const api = useAPI()
  const { clients, services } = useClientsAndServices()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ client_id: '', service_id: '', plan_name: '', interval_days: 30, amount: '', start_date: '' })

  async function reload() {
    setLoading(true)
    try { setRows((await api?.subscriptions?.list?.({})) || []) } catch {}
    setLoading(false)
  }
  useEffect(() => { reload() }, [])

  async function submit(e) {
    e.preventDefault()
    if (!form.client_id || !form.amount) return
    await api.subscriptions.create({
      client_id: Number(form.client_id) || undefined,
      service_id: Number(form.service_id) || undefined,
      plan_name: form.plan_name || null,
      interval_days: Number(form.interval_days) || 30,
      amount: Number(form.amount) || 0,
      start_date: form.start_date || undefined,
    })
    setOpen(false)
    setForm({ client_id: '', service_id: '', plan_name: '', interval_days: 30, amount: '', start_date: '' })
    reload()
  }

  const dueSoon = useMemo(() => rows.filter(r => r.status === 'active' && (daysUntil(r.next_billing_date) ?? 999) <= 7), [rows])
  const mrr = useMemo(() => rows.filter(r => r.status === 'active').reduce((s, r) => s + (Number(r.amount) * 30 / (Number(r.interval_days) || 30)), 0), [rows])

  async function markBilled(id) { await api.subscriptions.markBilled(id); reload() }
  async function cancel(id)     { if (!confirm('¿Cancelar suscripción?')) return; await api.subscriptions.delete(id); reload() }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <KPI label="Activas" value={rows.filter(r => r.status === 'active').length} />
        <KPI label="Próximos Cobros (7d)" value={dueSoon.length} accent />
        <KPI label="MRR estimado" value={money(mrr)} />
      </div>

      <div className="flex items-center justify-between mb-3">
        <button onClick={reload} className={btnSecondary}><RefreshCw className="w-4 h-4 inline mr-1" />Recargar</button>
        <button onClick={() => setOpen(true)} className={btnPrimary} style={{ backgroundColor: RED }}>
          <Plus className="w-4 h-4 inline mr-1" />Nueva Suscripción
        </button>
      </div>

      {loading ? <div className="text-slate-500 dark:text-white/40">Cargando...</div>
        : rows.length === 0 ? <Empty icon={Calendar} title="Sin suscripciones" hint="Crea la primera plantilla de cobro recurrente." />
        : (
          <div className="overflow-x-auto border border-slate-200 dark:border-white/10 rounded-xl">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-white/5 text-left text-slate-600 dark:text-white/70">
                <tr>
                  <th className="p-3">Cliente</th><th className="p-3">Plan</th><th className="p-3">Servicio</th>
                  <th className="p-3 text-right">Monto</th><th className="p-3">Cada</th>
                  <th className="p-3">Próximo Cobro</th><th className="p-3">Estado</th><th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const du = daysUntil(r.next_billing_date)
                  const overdue = r.status === 'active' && du !== null && du < 0
                  const soon    = r.status === 'active' && du !== null && du >= 0 && du <= 7
                  return (
                    <tr key={r.id} className="border-t border-slate-100 dark:border-white/5">
                      <td className="p-3 text-slate-800 dark:text-white">{r.client_name || '—'}</td>
                      <td className="p-3 text-slate-700 dark:text-white/80">{r.plan_name || '—'}</td>
                      <td className="p-3 text-slate-700 dark:text-white/80">{r.service_name || '—'}</td>
                      <td className="p-3 text-right text-slate-800 dark:text-white font-medium">{money(r.amount)}</td>
                      <td className="p-3 text-slate-700 dark:text-white/80">{r.interval_days}d</td>
                      <td className="p-3 text-slate-700 dark:text-white/80">
                        {dateShort(r.next_billing_date)}
                        {overdue && <span className="ml-2 text-xs font-bold" style={{ color: RED }}>vencido</span>}
                        {soon && !overdue && <span className="ml-2 text-xs font-bold text-slate-500 dark:text-white/50">en {du}d</span>}
                      </td>
                      <td className="p-3"><StatusPill value={r.status} /></td>
                      <td className="p-3 text-right whitespace-nowrap">
                        {r.status === 'active' && (
                          <>
                            <button onClick={() => markBilled(r.id)} title="Marcar cobrado"
                              className="px-2 py-1 text-xs rounded border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/80 hover:bg-slate-50 dark:hover:bg-white/5">
                              <Check className="w-3.5 h-3.5" />
                            </button>{' '}
                            <button onClick={() => cancel(r.id)} title="Cancelar"
                              className="px-2 py-1 text-xs rounded border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5"
                              style={{ color: RED }}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

      <Modal open={open} onClose={() => setOpen(false)} title="Nueva Suscripción">
        <form onSubmit={submit} className="space-y-3">
          <Select label="Cliente *" value={form.client_id} onChange={v => setForm({ ...form, client_id: v })}
            options={[{ value: '', label: '— Seleccionar —' }, ...clients.map(c => ({ value: c.id, label: c.name }))]} />
          <Select label="Servicio" value={form.service_id} onChange={v => setForm({ ...form, service_id: v })}
            options={[{ value: '', label: '— (opcional) —' }, ...services.map(s => ({ value: s.id, label: s.name }))]} />
          <Input label="Nombre del plan" value={form.plan_name} onChange={v => setForm({ ...form, plan_name: v })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Intervalo (días)" type="number" value={form.interval_days} onChange={v => setForm({ ...form, interval_days: v })} />
            <Input label="Monto RD$ *" type="number" step="0.01" value={form.amount} onChange={v => setForm({ ...form, amount: v })} />
          </div>
          <Input label="Fecha de inicio" type="date" value={form.start_date} onChange={v => setForm({ ...form, start_date: v })} />
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className={btnSecondary}>Cancelar</button>
            <button type="submit" className={btnPrimary} style={{ backgroundColor: RED }}>Crear</button>
          </div>
        </form>
      </Modal>
    </>
  )
}

// ── 2) PACKAGES ───────────────────────────────────────────────────────────────
function PackagesTab() {
  const api = useAPI()
  const { clients, services } = useClientsAndServices()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ client_id: '', service_id: '', package_name: '', total_sessions: 10, purchase_price: '' })

  async function reload() {
    setLoading(true)
    try { setRows((await api?.servicePackages?.list?.({})) || []) } catch (err) { try { window.__txReportError?.(err, { severity: 'warn', category: 'service.servicePackages.list' }) } catch {} }
    setLoading(false)
  }
  useEffect(() => { reload() }, [])

  async function submit(e) {
    e.preventDefault()
    if (!form.client_id || !form.package_name) return
    await api.servicePackages.create({
      client_id:     Number(form.client_id) || undefined,
      service_id:    Number(form.service_id) || undefined,
      package_name:  form.package_name,
      total_sessions:Number(form.total_sessions) || 0,
      purchase_price:Number(form.purchase_price) || 0,
    })
    setOpen(false)
    setForm({ client_id: '', service_id: '', package_name: '', total_sessions: 10, purchase_price: '' })
    reload()
  }

  async function consume(id) { const r = await api.servicePackages.consume(id); if (!r?.ok) alert('No se pudo consumir (paquete agotado)'); reload() }

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <button onClick={reload} className={btnSecondary}><RefreshCw className="w-4 h-4 inline mr-1" />Recargar</button>
        <button onClick={() => setOpen(true)} className={btnPrimary} style={{ backgroundColor: RED }}>
          <Plus className="w-4 h-4 inline mr-1" />Nuevo Paquete
        </button>
      </div>

      {loading ? <div className="text-slate-500 dark:text-white/40">Cargando...</div>
        : rows.length === 0 ? <Empty icon={Package} title="Sin paquetes" hint="Vende bloques prepagados (ej: 10 sesiones)." />
        : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rows.map(r => {
              const pct = r.total_sessions > 0 ? Math.round(r.used_sessions / r.total_sessions * 100) : 0
              const near = pct >= 80 && r.status === 'active'
              return (
                <div key={r.id} className="border border-slate-200 dark:border-white/10 rounded-xl p-4 bg-white dark:bg-white/5">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-bold text-slate-800 dark:text-white">{r.package_name}</p>
                      <p className="text-xs text-slate-600 dark:text-white/60">{r.client_name} · {r.service_name || '—'}</p>
                    </div>
                    <StatusPill value={r.status} />
                  </div>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-slate-700 dark:text-white/80">{r.used_sessions} / {r.total_sessions} sesiones</span>
                    <span className="text-slate-800 dark:text-white font-medium">{money(r.purchase_price)}</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full overflow-hidden bg-slate-100 dark:bg-white/10">
                    <div className="h-full transition-all" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: near ? RED : '#000', opacity: near ? 1 : 0.85 }} />
                  </div>
                  {near && (
                    <p className="flex items-center gap-1 text-xs mt-2 font-medium" style={{ color: RED }}>
                      <AlertCircle className="w-3.5 h-3.5" /> Casi agotado — avisa al cliente.
                    </p>
                  )}
                  {r.status === 'active' && r.used_sessions < r.total_sessions && (
                    <button onClick={() => consume(r.id)} className="mt-3 w-full px-3 py-1.5 text-sm rounded-lg text-white font-medium" style={{ backgroundColor: RED }}>
                      Consumir sesión
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

      <Modal open={open} onClose={() => setOpen(false)} title="Nuevo Paquete">
        <form onSubmit={submit} className="space-y-3">
          <Select label="Cliente *" value={form.client_id} onChange={v => setForm({ ...form, client_id: v })}
            options={[{ value: '', label: '— Seleccionar —' }, ...clients.map(c => ({ value: c.id, label: c.name }))]} />
          <Select label="Servicio" value={form.service_id} onChange={v => setForm({ ...form, service_id: v })}
            options={[{ value: '', label: '— (opcional) —' }, ...services.map(s => ({ value: s.id, label: s.name }))]} />
          <Input label="Nombre del paquete *" value={form.package_name} onChange={v => setForm({ ...form, package_name: v })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Total sesiones" type="number" value={form.total_sessions} onChange={v => setForm({ ...form, total_sessions: v })} />
            <Input label="Precio total RD$" type="number" step="0.01" value={form.purchase_price} onChange={v => setForm({ ...form, purchase_price: v })} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className={btnSecondary}>Cancelar</button>
            <button type="submit" className={btnPrimary} style={{ backgroundColor: RED }}>Crear</button>
          </div>
        </form>
      </Modal>
    </>
  )
}

// ── 3) PROJECTS ───────────────────────────────────────────────────────────────
function ProjectsTab() {
  const api = useAPI()
  const { clients } = useClientsAndServices()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ client_id: '', name: '', description: '', status: 'active' })

  async function reload() {
    setLoading(true)
    try { setRows((await api?.projects?.list?.({})) || []) } catch (err) { try { window.__txReportError?.(err, { severity: 'warn', category: 'service.projects.list' }) } catch {} }
    setLoading(false)
  }
  useEffect(() => { reload() }, [])

  async function submit(e) {
    e.preventDefault()
    if (!form.name) return
    await api.projects.create({
      client_id:   Number(form.client_id) || undefined,
      name:        form.name,
      description: form.description || null,
      status:      form.status,
    })
    setOpen(false)
    setForm({ client_id: '', name: '', description: '', status: 'active' })
    reload()
  }

  async function changeStatus(id, status) { await api.projects.update({ id, status }); reload() }

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <button onClick={reload} className={btnSecondary}><RefreshCw className="w-4 h-4 inline mr-1" />Recargar</button>
        <button onClick={() => setOpen(true)} className={btnPrimary} style={{ backgroundColor: RED }}>
          <Plus className="w-4 h-4 inline mr-1" />Nuevo Proyecto
        </button>
      </div>

      {loading ? <div className="text-slate-500 dark:text-white/40">Cargando...</div>
        : rows.length === 0 ? <Empty icon={Briefcase} title="Sin proyectos" hint="Agrupa tickets por trabajo / job." />
        : (
          <div className="overflow-x-auto border border-slate-200 dark:border-white/10 rounded-xl">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-white/5 text-left text-slate-600 dark:text-white/70">
                <tr>
                  <th className="p-3">Proyecto</th><th className="p-3">Cliente</th>
                  <th className="p-3 text-right">Facturado</th><th className="p-3">Estado</th><th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-t border-slate-100 dark:border-white/5">
                    <td className="p-3">
                      <p className="font-medium text-slate-800 dark:text-white">{r.name}</p>
                      {r.description && <p className="text-xs text-slate-500 dark:text-white/50">{r.description}</p>}
                    </td>
                    <td className="p-3 text-slate-700 dark:text-white/80">{r.client_name || '—'}</td>
                    <td className="p-3 text-right font-medium text-slate-800 dark:text-white">{money(r.total_billed_live ?? r.total_billed)}</td>
                    <td className="p-3"><StatusPill value={r.status} /></td>
                    <td className="p-3 text-right">
                      <select value={r.status} onChange={e => changeStatus(r.id, e.target.value)}
                        className="px-2 py-1 text-xs rounded border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-white/80">
                        <option value="draft">borrador</option>
                        <option value="active">activo</option>
                        <option value="paused">pausado</option>
                        <option value="closed">cerrado</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      <Modal open={open} onClose={() => setOpen(false)} title="Nuevo Proyecto">
        <form onSubmit={submit} className="space-y-3">
          <Select label="Cliente" value={form.client_id} onChange={v => setForm({ ...form, client_id: v })}
            options={[{ value: '', label: '— (opcional) —' }, ...clients.map(c => ({ value: c.id, label: c.name }))]} />
          <Input label="Nombre *" value={form.name} onChange={v => setForm({ ...form, name: v })} />
          <div>
            <label className="block text-xs text-slate-600 dark:text-white/60 mb-1">Descripción</label>
            <textarea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className={inputClass} />
          </div>
          <Select label="Estado" value={form.status} onChange={v => setForm({ ...form, status: v })}
            options={[
              { value: 'draft', label: 'borrador' },
              { value: 'active', label: 'activo' },
              { value: 'paused', label: 'pausado' },
            ]} />
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className={btnSecondary}>Cancelar</button>
            <button type="submit" className={btnPrimary} style={{ backgroundColor: RED }}>Crear</button>
          </div>
        </form>
      </Modal>
    </>
  )
}

// ── 4) CLIENT RATES ───────────────────────────────────────────────────────────
function RatesTab() {
  const api = useAPI()
  const { clients, services } = useClientsAndServices()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ client_id: '', service_id: '', custom_price: '', notes: '' })

  async function reload() {
    setLoading(true)
    try { setRows((await api?.clientRates?.list?.({})) || []) } catch (err) { try { window.__txReportError?.(err, { severity: 'warn', category: 'service.clientRates.list' }) } catch {} }
    setLoading(false)
  }
  useEffect(() => { reload() }, [])

  async function submit(e) {
    e.preventDefault()
    if (!form.client_id || !form.service_id || !form.custom_price) return
    await api.clientRates.set({
      client_id:    Number(form.client_id),
      service_id:   Number(form.service_id),
      custom_price: Number(form.custom_price),
      notes:        form.notes || null,
    })
    setOpen(false)
    setForm({ client_id: '', service_id: '', custom_price: '', notes: '' })
    reload()
  }

  async function remove(id) { if (!confirm('¿Eliminar tarifa?')) return; await api.clientRates.delete(id); reload() }

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <button onClick={reload} className={btnSecondary}><RefreshCw className="w-4 h-4 inline mr-1" />Recargar</button>
        <button onClick={() => setOpen(true)} className={btnPrimary} style={{ backgroundColor: RED }}>
          <Plus className="w-4 h-4 inline mr-1" />Nueva Tarifa
        </button>
      </div>

      {loading ? <div className="text-slate-500 dark:text-white/40">Cargando...</div>
        : rows.length === 0 ? <Empty icon={DollarSign} title="Sin tarifas personalizadas" hint="Define precios especiales por cliente." />
        : (
          <div className="overflow-x-auto border border-slate-200 dark:border-white/10 rounded-xl">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-white/5 text-left text-slate-600 dark:text-white/70">
                <tr>
                  <th className="p-3">Cliente</th><th className="p-3">Servicio</th>
                  <th className="p-3 text-right">Precio Base</th>
                  <th className="p-3 text-right">Precio Cliente</th>
                  <th className="p-3">Nota</th><th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const delta = Number(r.custom_price) - Number(r.base_price || 0)
                  return (
                    <tr key={r.id} className="border-t border-slate-100 dark:border-white/5">
                      <td className="p-3 text-slate-800 dark:text-white">{r.client_name}</td>
                      <td className="p-3 text-slate-700 dark:text-white/80">{r.service_name}</td>
                      <td className="p-3 text-right text-slate-700 dark:text-white/80">{money(r.base_price)}</td>
                      <td className="p-3 text-right font-medium" style={{ color: delta < 0 ? RED : undefined }}>{money(r.custom_price)}</td>
                      <td className="p-3 text-slate-700 dark:text-white/80">{r.notes || '—'}</td>
                      <td className="p-3 text-right">
                        <button onClick={() => remove(r.id)} className="p-1" style={{ color: RED }}><Trash2 className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

      <Modal open={open} onClose={() => setOpen(false)} title="Tarifa Personalizada">
        <form onSubmit={submit} className="space-y-3">
          <Select label="Cliente *" value={form.client_id} onChange={v => setForm({ ...form, client_id: v })}
            options={[{ value: '', label: '— Seleccionar —' }, ...clients.map(c => ({ value: c.id, label: c.name }))]} />
          <Select label="Servicio *" value={form.service_id} onChange={v => setForm({ ...form, service_id: v })}
            options={[{ value: '', label: '— Seleccionar —' }, ...services.map(s => ({ value: s.id, label: `${s.name} — ${money(s.price)}` }))]} />
          <Input label="Precio personalizado RD$ *" type="number" step="0.01" value={form.custom_price} onChange={v => setForm({ ...form, custom_price: v })} />
          <Input label="Nota" value={form.notes} onChange={v => setForm({ ...form, notes: v })} />
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className={btnSecondary}>Cancelar</button>
            <button type="submit" className={btnPrimary} style={{ backgroundColor: RED }}>Guardar</button>
          </div>
        </form>
      </Modal>
    </>
  )
}

// ── 5) TIMER (hourly billing) ─────────────────────────────────────────────────
function TimerTab() {
  // Lightweight job timer — start/stop, pause/resume, emits a ready-to-add ticket
  // line with duration_minutes + hourly_rate. Actual line insertion happens via
  // POS once the timer stops (user copies values).
  const [rate, setRate] = useState(1000)
  const [startedAt, setStartedAt] = useState(null)
  const [accumSec, setAccumSec] = useState(0)
  const [paused,   setPaused]   = useState(false)
  const [tick, setTick] = useState(0)
  const timerRef = useRef(null)

  useEffect(() => {
    if (startedAt && !paused) {
      timerRef.current = setInterval(() => setTick(t => t + 1), 1000)
    } else {
      clearInterval(timerRef.current)
    }
    return () => clearInterval(timerRef.current)
  }, [startedAt, paused])

  const elapsedSec = useMemo(() => {
    if (!startedAt) return accumSec
    if (paused)    return accumSec
    return accumSec + Math.floor((Date.now() - startedAt) / 1000)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt, paused, tick, accumSec])

  const minutes = Math.floor(elapsedSec / 60)
  const total   = Number(rate) * (elapsedSec / 3600)

  function start() { setStartedAt(Date.now()); setPaused(false) }
  function pause() {
    if (!startedAt) return
    setAccumSec(accumSec + Math.floor((Date.now() - startedAt) / 1000))
    setStartedAt(null); setPaused(true)
  }
  function resume() { setStartedAt(Date.now()); setPaused(false) }
  function reset()  { setStartedAt(null); setAccumSec(0); setPaused(false) }

  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, '0')
  const ss = String(elapsedSec % 60).padStart(2, '0')
  const hh = String(Math.floor(elapsedSec / 3600)).padStart(2, '0')

  return (
    <div className="max-w-xl">
      <div className="border border-slate-200 dark:border-white/10 rounded-xl p-6 bg-white dark:bg-white/5">
        <label className="block text-xs text-slate-600 dark:text-white/60 mb-1">Tarifa por hora (RD$)</label>
        <input type="number" step="0.01" value={rate} onChange={e => setRate(e.target.value)}
          disabled={!!startedAt || accumSec > 0}
          className={inputClass + ' mb-6'} />

        <div className="text-center py-6">
          <p className="text-6xl font-mono font-bold text-slate-800 dark:text-white tabular-nums">{hh}:{mm}:{ss}</p>
          <p className="text-sm text-slate-500 dark:text-white/50 mt-2">{minutes} minutos</p>
          <p className="text-3xl font-bold mt-3" style={{ color: RED }}>{money(total)}</p>
        </div>

        <div className="flex gap-2 justify-center">
          {!startedAt && accumSec === 0 && (
            <button onClick={start} className={btnPrimary} style={{ backgroundColor: RED }}>
              <Play className="w-4 h-4 inline mr-1" />Iniciar
            </button>
          )}
          {startedAt && !paused && (
            <button onClick={pause} className={btnSecondary}><Pause className="w-4 h-4 inline mr-1" />Pausar</button>
          )}
          {(paused || (!startedAt && accumSec > 0)) && (
            <>
              <button onClick={resume} className={btnPrimary} style={{ backgroundColor: RED }}>
                <Play className="w-4 h-4 inline mr-1" />Reanudar
              </button>
              <button onClick={reset} className={btnSecondary}>Reiniciar</button>
            </>
          )}
        </div>

        {accumSec > 0 && (
          <div className="mt-6 p-3 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 text-sm">
            <p className="font-medium text-slate-800 dark:text-white mb-1">Línea lista para POS:</p>
            <p className="text-slate-700 dark:text-white/80">duration_minutes = <b>{minutes}</b>, hourly_rate = <b>{money(rate)}</b>, total = <b>{money(total)}</b></p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Tiny controls ─────────────────────────────────────────────────────────────
function KPI({ label, value, accent }) {
  return (
    <div className="border border-slate-200 dark:border-white/10 rounded-xl p-4 bg-white dark:bg-white/5">
      <p className="text-xs text-slate-600 dark:text-white/60">{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color: accent ? RED : undefined }}>{value}</p>
    </div>
  )
}
function Input({ label, type = 'text', step, value, onChange }) {
  return (
    <div>
      <label className="block text-xs text-slate-600 dark:text-white/60 mb-1">{label}</label>
      <input type={type} step={step} value={value ?? ''} onChange={e => onChange(e.target.value)} className={inputClass} />
    </div>
  )
}
function Select({ label, value, onChange, options }) {
  return (
    <div>
      <label className="block text-xs text-slate-600 dark:text-white/60 mb-1">{label}</label>
      <select value={value ?? ''} onChange={e => onChange(e.target.value)} className={inputClass}>
        {options.map(o => <option key={String(o.value)} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}
function StatusPill({ value }) {
  const v = String(value || '').toLowerCase()
  const red = ['cancelled', 'exhausted', 'closed'].includes(v)
  return (
    <span className={`inline-block px-2 py-0.5 text-xs rounded font-medium ${red
      ? 'text-white'
      : 'text-slate-700 dark:text-white/80 border border-slate-200 dark:border-white/10'}`}
      style={red ? { backgroundColor: RED } : {}}>
      {v || '—'}
    </span>
  )
}
