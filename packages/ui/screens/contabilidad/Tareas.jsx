// Tareas — Contabilidad task tracker (kanban: pending · in_progress · review · done).
// Plan-gated by `contabilidad_tareas`. Auto-creates tasks from obligations
// calendar so the contable sees fiscal due-dates as actionable cards.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ClipboardList, Plus, Trash2, Loader2, Lock, X, Calendar, AlertTriangle, Check } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { usePlan } from '../../hooks/usePlan'

const COLUMNS = [
  { id: 'pending',     label: 'Pendiente',    color: 'bg-white text-black border-black/20 dark:bg-black dark:text-white dark:border-white/20' },
  { id: 'in_progress', label: 'En progreso',  color: 'bg-[#b3001e]/10 text-[#b3001e] border-[#b3001e]/30' },
  { id: 'review',      label: 'En revisión',  color: 'bg-black text-white border-black dark:bg-white dark:text-black dark:border-white' },
  { id: 'done',        label: 'Hecho',        color: 'bg-[#b3001e] text-white border-[#b3001e]' },
]

const PRIORITY_COLORS = {
  low:  'border-black/20 dark:border-white/20',
  med:  'border-[#b3001e]/40',
  high: 'border-[#b3001e] ring-1 ring-[#b3001e]',
}
const PRIORITY_LABELS = { low: 'Baja', med: 'Media', high: 'Alta' }

function ComingSoon() {
  return (
    <div className="p-6 max-w-2xl">
      <div className="rounded-2xl border border-[#b3001e]/30 bg-[#b3001e]/5 p-6">
        <div className="flex items-center gap-2 text-[#b3001e] font-bold mb-2"><Lock size={16}/> Próximamente</div>
        <div className="text-sm text-black/80 dark:text-white/80">
          El módulo Tareas requiere el plan Pro CTB o Pro MAX.
        </div>
      </div>
    </div>
  )
}

function daysUntil(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T23:59:59')
  const now = new Date()
  return Math.ceil((d - now) / 86400000)
}

export default function Tareas() {
  const api = useAPI()
  const { hasFeature } = usePlan()
  const allowed = hasFeature('contabilidad_tareas')

  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState(null) // null = todos
  const [tasks, setTasks] = useState([])
  const [obligations, setObligations] = useState([])
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(null)

  const reload = useCallback(async () => {
    if (!api?.contabilidad) return
    const [c, t] = await Promise.all([
      api.contabilidad.clientList(),
      api.contabilidad.taskList({ accountingClientId: clientId || undefined }),
    ])
    setClients(c || [])
    setTasks(t || [])
    const today = new Date()
    const o = await api.contabilidad.obligationsList({
      accountingClientId: clientId || undefined,
      dateFrom: `${today.getFullYear()}-01-01`,
      dateTo:   `${today.getFullYear() + 1}-12-31`,
    })
    setObligations(o || [])
  }, [api, clientId])

  useEffect(() => { reload() }, [reload])

  const tasksByCol = useMemo(() => {
    const map = { pending: [], in_progress: [], review: [], done: [] }
    for (const t of tasks) {
      const k = COLUMNS.find(c => c.id === t.status) ? t.status : 'pending'
      map[k].push(t)
    }
    // priority-then-due-date sort
    const order = { high: 0, med: 1, low: 2 }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) =>
        (order[a.priority] - order[b.priority]) ||
        String(a.due_date || 'z').localeCompare(String(b.due_date || 'z'))
      )
    }
    return map
  }, [tasks])

  // Tasks auto-derived from obligations the contable hasn't materialized yet
  const obligationCards = useMemo(() => {
    const existing = new Set(tasks.map(t => t.parent_obligation_supabase_id).filter(Boolean))
    return obligations
      .filter(o => o.status !== 'radicado' && o.status !== 'pagado' && !existing.has(o.supabase_id))
      .slice(0, 50)
  }, [obligations, tasks])

  async function move(task, newStatus) {
    setBusy(true)
    try { await api.contabilidad.taskUpdate(task.id, { status: newStatus }); await reload() }
    catch (e) { alert(`Error: ${e?.message || e}`) }
    finally   { setBusy(false) }
  }

  async function remove(task) {
    if (!confirm('¿Eliminar tarea?')) return
    setBusy(true)
    try { await api.contabilidad.taskDelete(task.id); await reload() }
    catch (e) { alert(`Error: ${e?.message || e}`) }
    finally   { setBusy(false) }
  }

  async function save(form) {
    setBusy(true)
    try {
      if (editing?.id) await api.contabilidad.taskUpdate(editing.id, form)
      else await api.contabilidad.taskCreate({ ...form, accounting_client_id: clientId || form.accounting_client_id })
      setEditing(null)
      await reload()
    } catch (e) { alert(`Error: ${e?.message || e}`) }
    finally    { setBusy(false) }
  }

  async function materializeObligation(o) {
    setBusy(true)
    try {
      await api.contabilidad.taskCreate({
        accounting_client_id: o.accounting_client_id,
        title: `${o.form_type} ${o.period_year}-${String(o.period_month || 0).padStart(2,'0')}`,
        description: `Obligación fiscal del calendario DGII. Vence ${o.due_date}.`,
        status: 'pending',
        priority: 'high',
        due_date: o.due_date,
        parent_obligation_supabase_id: o.supabase_id || null,
      })
      await reload()
    } catch (e) { alert(`Error: ${e?.message || e}`) }
    finally    { setBusy(false) }
  }

  const clientName = (id) => clients.find(c => c.id === id)?.nombre_comercial || '—'

  if (!allowed) return <ComingSoon/>

  return (
    <div className="flex flex-col min-h-full">
      <div className="border-b border-black/10 dark:border-white/10 bg-white dark:bg-black px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 font-bold text-[#b3001e]">
          <ClipboardList size={16}/> Tareas
        </div>
        <select value={clientId || ''} onChange={(e) => setClientId(e.target.value ? Number(e.target.value) : null)}
          className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
          <option value="">Todos los clientes</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.nombre_comercial}</option>)}
        </select>
        <button onClick={() => setEditing({})} disabled={busy}
          className="ml-auto inline-flex items-center gap-1 rounded-lg bg-[#b3001e] text-white px-3 py-2 text-sm font-bold hover:bg-[#8f0018] disabled:opacity-50">
          <Plus size={14}/> Nueva tarea
        </button>
      </div>

      {obligationCards.length > 0 && (
        <div className="border-b border-black/10 dark:border-white/10 bg-[#b3001e]/5 px-4 py-3">
          <div className="text-xs font-bold text-[#b3001e] mb-2 inline-flex items-center gap-1"><Calendar size={12}/> Obligaciones DGII pendientes (sin tarea)</div>
          <div className="flex gap-2 overflow-x-auto">
            {obligationCards.map(o => {
              const days = daysUntil(o.due_date)
              return (
                <button key={o.id} onClick={() => materializeObligation(o)}
                  className="shrink-0 rounded-2xl border border-[#b3001e]/30 bg-white dark:bg-black px-3 py-2 text-xs hover:border-[#b3001e]">
                  <div className="font-bold">{o.form_type}</div>
                  <div className="text-[10px] text-black/60 dark:text-white/60">{clientName(o.accounting_client_id)}</div>
                  <div className="text-[10px] mt-0.5">{o.due_date} · {days != null ? `${days} días` : ''}</div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 p-3 bg-white dark:bg-black">
        {COLUMNS.map(col => (
          <div key={col.id} className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 flex flex-col">
            <div className="px-3 py-2 border-b border-black/10 dark:border-white/10 flex items-center justify-between">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase ${col.color}`}>
                {col.label}
              </span>
              <span className="text-[10px] font-bold text-black/50 dark:text-white/50">{tasksByCol[col.id].length}</span>
            </div>
            <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[60vh]">
              {!tasksByCol[col.id].length && <div className="text-[11px] text-black/40 dark:text-white/40 text-center py-4">— vacío —</div>}
              {tasksByCol[col.id].map(t => {
                const days = daysUntil(t.due_date)
                const overdue = days != null && days < 0 && t.status !== 'done'
                return (
                  <div key={t.id}
                    className={`rounded-2xl border-2 bg-white dark:bg-black p-3 text-xs ${PRIORITY_COLORS[t.priority] || PRIORITY_COLORS.med} ${overdue ? 'ring-1 ring-[#b3001e]' : ''}`}>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="font-bold text-black dark:text-white break-words flex-1">{t.title}</div>
                      <button onClick={() => remove(t)} className="text-black/40 dark:text-white/40 hover:text-[#b3001e]"><Trash2 size={10}/></button>
                    </div>
                    {t.description && <div className="text-[10px] text-black/60 dark:text-white/60 mb-2 line-clamp-3">{t.description}</div>}
                    <div className="flex items-center gap-1 text-[10px]">
                      <span className="text-black/50 dark:text-white/50">{clientName(t.accounting_client_id)}</span>
                      <span className="ml-auto inline-flex items-center gap-1 font-bold">
                        {overdue && <AlertTriangle size={10} className="text-[#b3001e]"/>}
                        {t.due_date && <span className={overdue ? 'text-[#b3001e]' : 'text-black/60 dark:text-white/60'}>{t.due_date}</span>}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-1 flex-wrap">
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full border ${
                        t.priority === 'high' ? 'border-[#b3001e] text-[#b3001e]' :
                        t.priority === 'med'  ? 'border-black/30 dark:border-white/30 text-black/70 dark:text-white/70' :
                        'border-black/20 dark:border-white/20 text-black/50 dark:text-white/50'
                      }`}>
                        {PRIORITY_LABELS[t.priority] || t.priority}
                      </span>
                      <select value={t.status} onChange={(e) => move(t, e.target.value)}
                        className="ml-auto text-[9px] font-bold rounded-md border border-black/10 dark:border-white/10 bg-white dark:bg-black px-1 py-0.5">
                        {COLUMNS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                      <button onClick={() => setEditing(t)} className="text-[9px] font-bold text-[#b3001e] hover:underline">Editar</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {editing && <TaskModal initial={editing} clients={clients} clientId={clientId} onClose={() => setEditing(null)} onSave={save} busy={busy}/>}
    </div>
  )
}

function TaskModal({ initial, clients, clientId, onClose, onSave, busy }) {
  const [form, setForm] = useState({
    title: initial?.title || '',
    description: initial?.description || '',
    accounting_client_id: initial?.accounting_client_id ?? clientId ?? (clients[0]?.id || null),
    status: initial?.status || 'pending',
    priority: initial?.priority || 'med',
    due_date: initial?.due_date || '',
  })
  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-black rounded-2xl border border-black/10 dark:border-white/10 max-w-lg w-full p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="font-bold inline-flex items-center gap-2"><ClipboardList size={16}/> {initial?.id ? 'Editar tarea' : 'Nueva tarea'}</div>
          <button onClick={onClose}><X size={16}/></button>
        </div>
        <div className="space-y-3">
          <label className="block text-xs font-bold">Título
            <input value={form.title} onChange={(e) => set('title', e.target.value)}
              className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm"/>
          </label>
          <label className="block text-xs font-bold">Descripción
            <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={3}
              className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm"/>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-bold">Cliente
              <select value={form.accounting_client_id || ''} onChange={(e) => set('accounting_client_id', Number(e.target.value) || null)}
                className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
                <option value="">— Sin cliente —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.nombre_comercial}</option>)}
              </select>
            </label>
            <label className="block text-xs font-bold">Vencimiento
              <input type="date" value={form.due_date || ''} onChange={(e) => set('due_date', e.target.value)}
                className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm"/>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-bold">Estado
              <select value={form.status} onChange={(e) => set('status', e.target.value)}
                className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
                {COLUMNS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <label className="block text-xs font-bold">Prioridad
              <select value={form.priority} onChange={(e) => set('priority', e.target.value)}
                className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
                <option value="low">Baja</option>
                <option value="med">Media</option>
                <option value="high">Alta</option>
              </select>
            </label>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm font-bold border border-black/10 dark:border-white/10">Cancelar</button>
          <button disabled={busy || !form.title} onClick={() => onSave(form)}
            className="px-3 py-2 rounded-lg text-sm font-bold bg-[#b3001e] text-white disabled:opacity-50 inline-flex items-center gap-1">
            {busy && <Loader2 size={12} className="animate-spin"/>}<Check size={12}/> Guardar
          </button>
        </div>
      </div>
    </div>
  )
}
