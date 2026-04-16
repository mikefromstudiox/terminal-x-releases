import { useState, useEffect, useMemo, useRef } from 'react'
import {
  Plus, Users, User, Clock, MoreVertical, Edit2, Trash2, Check, X,
  AlertCircle, Loader2, RefreshCw,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'

// ── Status catalog ────────────────────────────────────────────────────────────

const STATUS = {
  libre: {
    label: 'Libre',
    chip:  'bg-green-500/15 text-green-400 border-green-500/30',
    ring:  'border-green-500/40 hover:border-green-500/70',
    dot:   'bg-green-500',
  },
  ocupada: {
    label: 'Ocupada',
    chip:  'bg-red-600/15 text-red-400 border-red-600/30',
    ring:  'border-red-600/50 hover:border-red-600/80',
    dot:   'bg-red-500',
  },
  sucia: {
    label: 'Sucia',
    chip:  'bg-amber-500/15 text-amber-400 border-amber-500/30',
    ring:  'border-amber-500/40 hover:border-amber-500/70',
    dot:   'bg-amber-500',
  },
  reservada: {
    label: 'Reservada',
    chip:  'bg-blue-500/15 text-blue-400 border-blue-500/30',
    ring:  'border-blue-500/40 hover:border-blue-500/70',
    dot:   'bg-blue-500',
  },
}

const STATUS_ORDER = ['libre', 'ocupada', 'sucia', 'reservada']

// ── Helpers ───────────────────────────────────────────────────────────────────

function elapsedMinutes(seatedAt, now) {
  if (!seatedAt) return 0
  const t = new Date(seatedAt).getTime()
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.floor((now - t) / 60000))
}

function fmtElapsed(mins) {
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}h ${m}m`
}

function empleadoName(empleados, id) {
  if (!id) return null
  const e = empleados.find(x => x.id === id || x.supabase_id === id)
  return e?.name || e?.full_name || e?.nombre || null
}

// ── Mesa card ─────────────────────────────────────────────────────────────────

function MesaCard({ mesa, empleados, now, onClick }) {
  const s = STATUS[mesa.status] || STATUS.libre
  const waiter = empleadoName(empleados, mesa.waiter_empleado_id)
  const mins = mesa.status === 'ocupada' ? elapsedMinutes(mesa.seated_at, now) : 0

  return (
    <button
      onClick={onClick}
      className={`group relative text-left bg-zinc-900 rounded-2xl p-4 border transition-all ${s.ring} hover:-translate-y-0.5`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0">
          <div className="text-xl font-bold text-white truncate">{mesa.name}</div>
          {mesa.zone ? (
            <div className="text-xs text-white/50 truncate mt-0.5">{mesa.zone}</div>
          ) : null}
        </div>
        <MoreVertical size={16} className="text-white/30 group-hover:text-white/60 shrink-0" />
      </div>

      <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] font-semibold ${s.chip}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
        {s.label}
        {mesa.status === 'ocupada' && mesa.seated_at ? (
          <span className="ml-1 flex items-center gap-0.5 text-[10px] opacity-80">
            <Clock size={10} />
            {fmtElapsed(mins)}
          </span>
        ) : null}
      </div>

      <div className="mt-3 space-y-1.5">
        <div className="flex items-center gap-1.5 text-[12px] text-white/60">
          <Users size={12} />
          <span>Capacidad {mesa.capacity ?? 0}</span>
        </div>
        {mesa.status === 'ocupada' && mesa.guests_count ? (
          <div className="flex items-center gap-1.5 text-[12px] text-white/80">
            <Users size={12} />
            <span>{mesa.guests_count} comensales</span>
          </div>
        ) : null}
        {waiter ? (
          <div className="flex items-center gap-1.5 text-[12px] text-white/60 truncate">
            <User size={12} />
            <span className="truncate">{waiter}</span>
          </div>
        ) : null}
      </div>
    </button>
  )
}

// ── Nueva mesa modal ──────────────────────────────────────────────────────────

function NuevaMesaModal({ onClose, onCreate }) {
  const [form, setForm]     = useState({ name: '', zone: '', capacity: 4 })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')

  async function submit() {
    if (!form.name.trim()) { setErr('El nombre es requerido.'); return }
    setSaving(true)
    try {
      await onCreate({
        name:       form.name.trim(),
        zone:       form.zone.trim() || null,
        capacity:   Number(form.capacity) || 0,
        sort_order: 0,
      })
      onClose()
    } catch (e) {
      setErr(e?.message || 'Error al crear la mesa.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <h3 className="font-bold text-white">Nueva Mesa</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-white/60 uppercase tracking-wide mb-1">Nombre *</label>
            <input
              autoFocus
              value={form.name}
              onChange={e => { setForm(f => ({ ...f, name: e.target.value })); setErr('') }}
              placeholder="Ej: Mesa 5"
              className="w-full border border-zinc-800 rounded-lg px-3 py-2 text-sm bg-black text-white focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-white/60 uppercase tracking-wide mb-1">Zona</label>
            <input
              value={form.zone}
              onChange={e => setForm(f => ({ ...f, zone: e.target.value }))}
              placeholder="Ej: Terraza"
              className="w-full border border-zinc-800 rounded-lg px-3 py-2 text-sm bg-black text-white focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-white/60 uppercase tracking-wide mb-1">Capacidad</label>
            <input
              type="number" min="1"
              value={form.capacity}
              onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))}
              className="w-full border border-zinc-800 rounded-lg px-3 py-2 text-sm bg-black text-white focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>
          {err ? (
            <div className="flex items-center gap-2 text-xs text-red-400 bg-red-600/10 border border-red-600/30 rounded-lg px-3 py-2">
              <AlertCircle size={14} /> {err}
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-zinc-800">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-white/70 hover:text-white">Cancelar</button>
          <button
            onClick={submit}
            disabled={saving}
            className="px-4 py-2 text-sm font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-60 inline-flex items-center gap-2"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Edit mesa modal ───────────────────────────────────────────────────────────

function EditMesaModal({ mesa, onClose, onSave }) {
  const [form, setForm]     = useState({
    name:     mesa.name     || '',
    zone:     mesa.zone     || '',
    capacity: mesa.capacity ?? 4,
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')

  async function submit() {
    if (!form.name.trim()) { setErr('El nombre es requerido.'); return }
    setSaving(true)
    try {
      await onSave({
        name:     form.name.trim(),
        zone:     form.zone.trim() || null,
        capacity: Number(form.capacity) || 0,
      })
      onClose()
    } catch (e) {
      setErr(e?.message || 'Error al guardar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <h3 className="font-bold text-white">Editar mesa</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-white/60 uppercase tracking-wide mb-1">Nombre *</label>
            <input
              autoFocus
              value={form.name}
              onChange={e => { setForm(f => ({ ...f, name: e.target.value })); setErr('') }}
              className="w-full border border-zinc-800 rounded-lg px-3 py-2 text-sm bg-black text-white focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-white/60 uppercase tracking-wide mb-1">Zona</label>
            <input
              value={form.zone}
              onChange={e => setForm(f => ({ ...f, zone: e.target.value }))}
              className="w-full border border-zinc-800 rounded-lg px-3 py-2 text-sm bg-black text-white focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-white/60 uppercase tracking-wide mb-1">Capacidad</label>
            <input
              type="number" min="1"
              value={form.capacity}
              onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))}
              className="w-full border border-zinc-800 rounded-lg px-3 py-2 text-sm bg-black text-white focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>
          {err ? (
            <div className="flex items-center gap-2 text-xs text-red-400 bg-red-600/10 border border-red-600/30 rounded-lg px-3 py-2">
              <AlertCircle size={14} /> {err}
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-zinc-800">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-white/70 hover:text-white">Cancelar</button>
          <button
            onClick={submit}
            disabled={saving}
            className="px-4 py-2 text-sm font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-60 inline-flex items-center gap-2"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Seat guests modal ─────────────────────────────────────────────────────────

function SeatGuestsModal({ mesa, empleados, onClose, onConfirm }) {
  const [guests, setGuests] = useState(mesa.capacity || 2)
  const [waiter, setWaiter] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')

  async function submit() {
    const g = Number(guests)
    if (!g || g < 1) { setErr('Ingrese la cantidad de comensales.'); return }
    setSaving(true)
    try {
      await onConfirm({ guests_count: g, waiter_empleado_id: waiter || null })
      onClose()
    } catch (e) {
      setErr(e?.message || 'Error al sentar comensales.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <h3 className="font-bold text-white">Sentar comensales — {mesa.name}</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-white/60 uppercase tracking-wide mb-1">Comensales</label>
            <input
              autoFocus
              type="number" min="1"
              value={guests}
              onChange={e => { setGuests(e.target.value); setErr('') }}
              className="w-full border border-zinc-800 rounded-lg px-3 py-2 text-sm bg-black text-white focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-white/60 uppercase tracking-wide mb-1">Mesero</label>
            <select
              value={waiter}
              onChange={e => setWaiter(e.target.value)}
              className="w-full border border-zinc-800 rounded-lg px-3 py-2 text-sm bg-black text-white focus:outline-none focus:ring-2 focus:ring-red-600"
            >
              <option value="">— Sin asignar —</option>
              {empleados.map(e => (
                <option key={e.id || e.supabase_id} value={e.supabase_id || e.id}>
                  {e.name || e.full_name || e.nombre || `Empleado ${e.id}`}
                </option>
              ))}
            </select>
          </div>
          {err ? (
            <div className="flex items-center gap-2 text-xs text-red-400 bg-red-600/10 border border-red-600/30 rounded-lg px-3 py-2">
              <AlertCircle size={14} /> {err}
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-zinc-800">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-white/70 hover:text-white">Cancelar</button>
          <button
            onClick={submit}
            disabled={saving}
            className="px-4 py-2 text-sm font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-60 inline-flex items-center gap-2"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Sentar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Action sheet ──────────────────────────────────────────────────────────────

function ActionSheet({ mesa, onClose, onSeat, onSetStatus, onEdit, onDelete }) {
  const [confirmDel, setConfirmDel] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])

  const actions = []
  if (mesa.status === 'libre')     actions.push({ label: 'Sentar comensales', onClick: onSeat,  icon: Users })
  if (mesa.status === 'libre')     actions.push({ label: 'Reservar',          onClick: () => onSetStatus('reservada'), icon: Clock })
  if (mesa.status === 'ocupada')   actions.push({ label: 'Marcar como sucia', onClick: () => onSetStatus('sucia'),     icon: RefreshCw })
  if (mesa.status === 'ocupada' || mesa.status === 'sucia' || mesa.status === 'reservada')
                                   actions.push({ label: 'Marcar como libre', onClick: () => onSetStatus('libre'),     icon: Check })
  actions.push({ label: 'Editar',   onClick: onEdit, icon: Edit2 })

  return (
    <div className="fixed inset-0 bg-black/70 flex items-end sm:items-center justify-center z-50 p-4">
      <div ref={ref} className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div>
            <div className="font-bold text-white">{mesa.name}</div>
            {mesa.zone ? <div className="text-xs text-white/50">{mesa.zone}</div> : null}
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white"><X size={18} /></button>
        </div>
        <div className="py-2">
          {actions.map(a => (
            <button
              key={a.label}
              onClick={a.onClick}
              className="w-full flex items-center gap-3 px-5 py-3 text-sm text-white hover:bg-white/5 transition-colors"
            >
              <a.icon size={15} className="text-white/60" />
              {a.label}
            </button>
          ))}
          {confirmDel ? (
            <div className="px-5 py-3 border-t border-zinc-800 bg-red-600/10">
              <p className="text-sm text-white mb-2">¿Eliminar mesa?</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setConfirmDel(false)}
                  className="flex-1 px-3 py-2 text-xs font-semibold text-white/70 hover:text-white border border-zinc-800 rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  onClick={onDelete}
                  className="flex-1 px-3 py-2 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg"
                >
                  Eliminar
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDel(true)}
              className="w-full flex items-center gap-3 px-5 py-3 text-sm text-red-400 hover:bg-red-600/10 border-t border-zinc-800 transition-colors"
            >
              <Trash2 size={15} />
              Eliminar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function Mesas() {
  const api = useAPI()

  const [mesas, setMesas]         = useState([])
  const [empleados, setEmpleados] = useState([])
  const [loading, setLoading]     = useState(true)
  const [err, setErr]             = useState('')
  const [now, setNow]             = useState(Date.now())

  const [showNew, setShowNew]       = useState(false)
  const [editing, setEditing]       = useState(null)
  const [seating, setSeating]       = useState(null)
  const [actionOn, setActionOn]     = useState(null)

  async function loadMesas() {
    try {
      const list = await api.mesas.list()
      setMesas(Array.isArray(list) ? list.filter(m => m.active !== false) : [])
      setErr('')
    } catch (e) {
      setErr(e?.message || 'Error al cargar mesas.')
    }
  }

  async function loadEmpleados() {
    try {
      const list = await api.empleados.getAll()
      setEmpleados(Array.isArray(list) ? list : [])
    } catch {
      setEmpleados([])
    }
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      await Promise.all([loadMesas(), loadEmpleados()])
      if (alive) setLoading(false)
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Realtime sub (web) or polling (desktop)
  useEffect(() => {
    if (typeof api.subscribeMesas === 'function') {
      const unsub = api.subscribeMesas(() => { loadMesas() })
      return () => { try { unsub && unsub() } catch {} }
    }
    const id = setInterval(() => { loadMesas() }, 5000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  // Tick for elapsed time on ocupada cards
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  const counts = useMemo(() => {
    const c = { libre: 0, ocupada: 0, sucia: 0, reservada: 0 }
    for (const m of mesas) if (c[m.status] != null) c[m.status]++
    return c
  }, [mesas])

  const sorted = useMemo(() => {
    return [...mesas].sort((a, b) => {
      const so = (a.sort_order ?? 0) - (b.sort_order ?? 0)
      if (so !== 0) return so
      return (a.name || '').localeCompare(b.name || '', 'es', { numeric: true })
    })
  }, [mesas])

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handleCreate(payload) {
    await api.mesas.create(payload)
    await loadMesas()
  }

  async function handleUpdate(id, patch) {
    await api.mesas.update(id, patch)
    await loadMesas()
  }

  async function handleStatus(mesa, status, extra = {}) {
    await api.mesas.setStatus(mesa.id, status, extra)
    await loadMesas()
  }

  async function handleDelete(mesa) {
    await api.mesas.delete(mesa.id)
    setActionOn(null)
    await loadMesas()
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Top bar */}
      <div className="border-b border-zinc-800 bg-zinc-900/40 sticky top-0 z-10 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">Mesas</h1>
            <p className="text-xs text-white/50 mt-0.5">{mesas.length} mesas activas</p>
          </div>
          <button
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
          >
            <Plus size={16} /> Nueva Mesa
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5">
        {/* Stats strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {STATUS_ORDER.map(k => {
            const s = STATUS[k]
            return (
              <div key={k} className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                  <span className="text-xs font-semibold uppercase tracking-wide text-white/60">{s.label}</span>
                </div>
                <div className="text-2xl font-bold text-white mt-1">{counts[k] || 0}</div>
              </div>
            )
          })}
        </div>

        {err ? (
          <div className="flex items-center gap-2 text-sm text-red-400 bg-red-600/10 border border-red-600/30 rounded-lg px-4 py-3 mb-4">
            <AlertCircle size={16} /> {err}
          </div>
        ) : null}

        {/* Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-24 text-white/50">
            <Loader2 size={20} className="animate-spin mr-2" /> Cargando mesas…
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-24 bg-zinc-900 border border-zinc-800 rounded-2xl">
            <Users size={32} className="mx-auto text-white/30 mb-3" />
            <p className="text-white/60 text-sm mb-4">No hay mesas configuradas.</p>
            <button
              onClick={() => setShowNew(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg"
            >
              <Plus size={16} /> Crear la primera mesa
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {sorted.map(m => (
              <MesaCard
                key={m.id || m.supabase_id}
                mesa={m}
                empleados={empleados}
                now={now}
                onClick={() => setActionOn(m)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modals / sheets */}
      {showNew ? (
        <NuevaMesaModal
          onClose={() => setShowNew(false)}
          onCreate={handleCreate}
        />
      ) : null}

      {editing ? (
        <EditMesaModal
          mesa={editing}
          onClose={() => setEditing(null)}
          onSave={patch => handleUpdate(editing.id, patch)}
        />
      ) : null}

      {seating ? (
        <SeatGuestsModal
          mesa={seating}
          empleados={empleados}
          onClose={() => setSeating(null)}
          onConfirm={extra => handleStatus(seating, 'ocupada', extra)}
        />
      ) : null}

      {actionOn ? (
        <ActionSheet
          mesa={actionOn}
          onClose={() => setActionOn(null)}
          onSeat={() => { setSeating(actionOn); setActionOn(null) }}
          onSetStatus={status => { handleStatus(actionOn, status); setActionOn(null) }}
          onEdit={() => { setEditing(actionOn); setActionOn(null) }}
          onDelete={() => handleDelete(actionOn)}
        />
      ) : null}
    </div>
  )
}
