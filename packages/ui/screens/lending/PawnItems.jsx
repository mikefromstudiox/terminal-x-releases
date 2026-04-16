/**
 * PawnItems.jsx — Collateral registry for pawn loans.
 *
 * Summary cards, searchable table, create/edit/redeem/forfeit modals.
 * Status: held (En Custodia), redeemed (Redimido), forfeited (Decomisado).
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ShieldCheck, Plus, Search, X, Loader2, Check, Eye,
  AlertTriangle, Clock, Package, MapPin, Calendar,
  Pencil, Archive, Ban, DollarSign, Users,
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
function today() {
  return new Date().toISOString().split('T')[0]
}
function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}
function daysUntil(dateStr) {
  if (!dateStr) return Infinity
  const diff = new Date(dateStr) - new Date()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  held:      { label: 'En Custodia', bg: 'bg-amber-50 dark:bg-amber-500/10', text: 'text-amber-700 dark:text-amber-300' },
  redeemed:  { label: 'Redimido',    bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-300' },
  forfeited: { label: 'Decomisado',  bg: 'bg-red-50 dark:bg-red-500/10', text: 'text-red-700 dark:text-red-300' },
}

// ── Summary Card ──────────────────────────────────────────────────────────────

function SummaryCard({ icon: Icon, label, value, accent = 'slate' }) {
  const accents = {
    slate:   'text-slate-500 dark:text-white/60',
    amber:   'text-amber-600 dark:text-amber-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
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

function StatusBadge({ status }) {
  const s = STATUS_CONFIG[status] || STATUS_CONFIG.held
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  )
}

// ── Create / Edit Modal ───────────────────────────────────────────────────────

function PawnModal({ item, onClose, onSave }) {
  const api = useAPI()
  const [clients, setClients] = useState([])
  const [loans, setLoans] = useState([])
  const [loadingData, setLoadingData] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const [form, setForm] = useState({
    client_id: item?.client_id ? String(item.client_id) : '',
    loan_id: item?.loan_id ? String(item.loan_id) : '',
    description: item?.description || '',
    estimated_value: item?.estimated_value ? String(item.estimated_value) : '',
    storage_location: item?.storage_location || '',
    redeem_deadline: item?.redeem_deadline || addDays(today(), 30),
    notes: item?.notes || '',
  })

  useEffect(() => {
    Promise.all([
      api?.clients?.all?.() || [],
      api?.loans?.list?.({}) || [],
    ])
      .then(([c, l]) => {
        setClients(c || [])
        setLoans(l || [])
        setLoadingData(false)
      })
      .catch(() => setLoadingData(false))
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Filter loans by selected client
  const clientLoans = useMemo(() => {
    if (!form.client_id) return []
    return (loans || []).filter(l => String(l.client_id) === form.client_id && l.status === 'active')
  }, [loans, form.client_id])

  // When client changes, reset loan selection
  useEffect(() => {
    if (!item) set('loan_id', '')
  }, [form.client_id])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.description.trim()) { setErr('La descripcion es requerida.'); return }
    if (!form.client_id) { setErr('Selecciona un cliente.'); return }
    setSaving(true)
    setErr('')
    try {
      const data = {
        client_id: Number(form.client_id),
        loan_id: form.loan_id ? Number(form.loan_id) : null,
        description: form.description.trim(),
        estimated_value: parseFloat(form.estimated_value) || 0,
        storage_location: form.storage_location.trim() || null,
        redeem_deadline: form.redeem_deadline || null,
        notes: form.notes.trim() || null,
        status: item?.status || 'held',
      }
      if (item?.id) {
        await api.pawnItems.update({ id: item.id, ...data })
      } else {
        await api.pawnItems.create(data)
      }
      onSave()
    } catch (e) {
      setErr(e?.message || 'Error al guardar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <form onSubmit={handleSubmit}
        className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10">
          <h2 className="text-[15px] font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <ShieldCheck size={16} className="text-amber-500" />
            {item ? 'Editar Articulo' : 'Nuevo Empeno'}
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
            <X size={16} className="text-slate-400" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {loadingData ? (
            <div className="flex items-center justify-center py-8 text-slate-400 dark:text-white/40">
              <Loader2 size={16} className="animate-spin mr-2" /> Cargando datos...
            </div>
          ) : (
            <>
              {/* Client */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                  Cliente
                </label>
                <select value={form.client_id} onChange={e => { set('client_id', e.target.value); setErr('') }} required
                  className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-400">
                  <option value="">Seleccionar cliente...</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}{c.rnc ? ` (${c.rnc})` : ''}</option>)}
                </select>
              </div>

              {/* Loan */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                  Prestamo Asociado (opcional)
                </label>
                <select value={form.loan_id} onChange={e => set('loan_id', e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-400">
                  <option value="">Sin Prestamo</option>
                  {clientLoans.map(l => (
                    <option key={l.id} value={l.id}>
                      Prestamo #{l.id} -- {fmtRD(l.principal)} @ {l.interest_rate}%
                    </option>
                  ))}
                </select>
                {form.client_id && clientLoans.length === 0 && (
                  <p className="text-[10px] text-slate-400 dark:text-white/40 mt-1">Este cliente no tiene prestamos activos.</p>
                )}
              </div>

              {/* Description */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                  Descripcion del Articulo *
                </label>
                <textarea value={form.description} onChange={e => { set('description', e.target.value); setErr('') }}
                  rows={2} required
                  placeholder="Ej: Cadena de oro 18K, 24 pulgadas, 35 gramos..."
                  className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
              </div>

              {/* Value + Location */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                    Valor Estimado (RD$)
                  </label>
                  <input type="number" min="0" step="0.01" value={form.estimated_value}
                    onChange={e => set('estimated_value', e.target.value)}
                    placeholder="15,000"
                    className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                    Ubicacion
                  </label>
                  <input type="text" value={form.storage_location}
                    onChange={e => set('storage_location', e.target.value)}
                    placeholder="Caja fuerte A-3"
                    className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
              </div>

              {/* Deadline */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                  Fecha Limite de Redencion
                </label>
                <input type="date" value={form.redeem_deadline}
                  onChange={e => set('redeem_deadline', e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                  Notas (opcional)
                </label>
                <input type="text" value={form.notes}
                  onChange={e => set('notes', e.target.value)}
                  placeholder="Condiciones especiales, marcas, serial..."
                  className="w-full px-3 py-2.5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] bg-white dark:bg-white/5 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>

              {err && (
                <div className="flex items-center gap-2 text-[11px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2">
                  <AlertTriangle size={12} /> {err}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-[12px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors">
            Cancelar
          </button>
          <button type="submit" disabled={saving || loadingData}
            className="flex items-center gap-1.5 px-5 py-2 bg-black dark:bg-white text-white dark:text-black text-[12px] font-bold rounded-lg hover:bg-slate-800 dark:hover:bg-white/90 disabled:opacity-50 transition-colors">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
            {saving ? 'Guardando...' : (item ? 'Guardar Cambios' : 'Registrar Empeno')}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Main PawnItems Screen ─────────────────────────────────────────────────────

export default function PawnItems() {
  const api = useAPI()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [modal, setModal] = useState(null) // null | { type: 'create'|'edit', item }
  const [toast, setToast] = useState(null)

  const loadItems = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await api?.pawnItems?.list?.({})
      setItems(rows || [])
    } catch { setItems([]) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadItems() }, [loadItems])

  // ── Metrics ──────────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const held = items.filter(i => i.status === 'held')
    const totalValue = held.reduce((s, i) => s + (Number(i.estimated_value) || 0), 0)
    const expiringThisWeek = held.filter(i => {
      const days = daysUntil(i.redeem_deadline)
      return days >= 0 && days <= 7
    }).length
    const forfeited = items.filter(i => i.status === 'forfeited').length
    return {
      heldCount: held.length,
      totalValue,
      expiringThisWeek,
      forfeitedCount: forfeited,
    }
  }, [items])

  // ── Filtered list ────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = items
    if (filterStatus !== 'all') list = list.filter(i => i.status === filterStatus)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(i =>
        (i.description || '').toLowerCase().includes(q) ||
        (i.client_name || '').toLowerCase().includes(q) ||
        (i.storage_location || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [items, filterStatus, search])

  function showToast(msg, variant = 'ok') {
    setToast({ msg, variant })
    setTimeout(() => setToast(null), 3000)
  }

  async function handleRedeem(item) {
    if (!confirm(`Redimir "${item.description}"? El articulo sera devuelto al cliente.`)) return
    try {
      await api.pawnItems.update({ id: item.id, status: 'redeemed' })
      await loadItems()
      showToast('Articulo redimido')
    } catch (e) {
      showToast(e?.message || 'Error al redimir', 'error')
    }
  }

  async function handleForfeit(item) {
    if (!confirm(`Decomisar "${item.description}"? Esta accion no se puede deshacer.`)) return
    try {
      await api.pawnItems.update({ id: item.id, status: 'forfeited' })
      await loadItems()
      showToast('Articulo decomisado')
    } catch (e) {
      showToast(e?.message || 'Error al decomisar', 'error')
    }
  }

  const STATUS_FILTERS = [
    { id: 'all',       label: 'Todos' },
    { id: 'held',      label: 'En Custodia' },
    { id: 'redeemed',  label: 'Redimidos' },
    { id: 'forfeited', label: 'Decomisados' },
  ]

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-black">
      {/* Header */}
      <div className="bg-white dark:bg-white/5 border-b border-slate-200 dark:border-white/10 px-3 py-3 md:px-6 md:py-4 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <ShieldCheck size={20} className="text-slate-500 dark:text-white/60" />
          <h1 className="text-[14px] md:text-[16px] font-bold text-slate-800 dark:text-white">Articulos en Empeno</h1>
        </div>
        <button onClick={() => setModal({ type: 'create', item: null })}
          className="flex items-center gap-2 px-4 py-2 bg-black dark:bg-white text-white dark:text-black hover:bg-slate-800 dark:hover:bg-white/90 rounded-xl text-sm font-medium transition-colors min-h-[44px]">
          <Plus size={15} /> Nuevo Empeno
        </button>
      </div>

      {/* Summary cards */}
      <div className="px-3 md:px-6 py-3 md:py-4 grid grid-cols-2 md:grid-cols-4 gap-3 shrink-0">
        <SummaryCard icon={Package} label="Articulos en Custodia" value={String(metrics.heldCount)} accent="amber" />
        <SummaryCard icon={DollarSign} label="Valor Total Estimado" value={fmtRD(metrics.totalValue)} accent="amber" />
        <SummaryCard icon={Clock} label="Vencen Esta Semana" value={String(metrics.expiringThisWeek)} accent={metrics.expiringThisWeek > 0 ? 'red' : 'slate'} />
        <SummaryCard icon={Ban} label="Decomisados" value={String(metrics.forfeitedCount)} accent="red" />
      </div>

      {/* Filters + search */}
      <div className="px-3 md:px-6 pb-3 flex flex-col md:flex-row md:items-center gap-3 shrink-0">
        <div className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl focus-within:ring-2 focus-within:ring-amber-400 flex-1 max-w-sm">
          <Search size={14} className="text-slate-400 dark:text-white/40 shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por descripcion, cliente, ubicacion..."
            className="flex-1 min-w-0 bg-transparent outline-none text-sm text-slate-700 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/40" />
        </div>
        <div className="flex gap-1 flex-wrap">
          {STATUS_FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilterStatus(f.id)}
              className={`px-3 py-2 rounded-lg text-[11px] font-semibold transition-colors border whitespace-nowrap min-h-[44px] ${
                filterStatus === f.id
                  ? 'bg-black dark:bg-white text-white dark:text-black border-black dark:border-white'
                  : 'bg-white dark:bg-white/5 text-slate-500 dark:text-white/60 border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10'
              }`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-3 md:px-6 pb-6">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 dark:text-white/40 text-sm gap-2">
            <Loader2 size={16} className="animate-spin" /> Cargando articulos...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <ShieldCheck size={32} className="text-slate-300 dark:text-white/20 mx-auto mb-3" />
            <p className="text-[13px] text-slate-500 dark:text-white/60 font-medium">
              {items.length === 0 ? 'No hay articulos registrados' : 'Sin resultados para esta busqueda'}
            </p>
            <p className="text-[11px] text-slate-400 dark:text-white/40 mt-1">
              {items.length === 0 && 'Haz clic en "Nuevo Empeno" para registrar el primero.'}
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
                    <th className="px-4 py-2.5 text-left">Descripcion</th>
                    <th className="px-4 py-2.5 text-left">Cliente</th>
                    <th className="px-4 py-2.5 text-center">Prestamo</th>
                    <th className="px-4 py-2.5 text-right">Valor Est.</th>
                    <th className="px-4 py-2.5 text-left">Ubicacion</th>
                    <th className="px-4 py-2.5 text-left">Vence</th>
                    <th className="px-4 py-2.5 text-center">Estado</th>
                    <th className="px-4 py-2.5 w-32"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(item => {
                    const days = daysUntil(item.redeem_deadline)
                    const isExpiring = item.status === 'held' && days >= 0 && days <= 7
                    const isExpired = item.status === 'held' && days < 0
                    return (
                      <tr key={item.id}
                        className="border-t border-slate-100 dark:border-white/5 hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-2.5 text-slate-500 dark:text-white/50 tabular-nums">{item.id}</td>
                        <td className="px-4 py-2.5 max-w-[200px]">
                          <p className="font-semibold text-slate-800 dark:text-white truncate">{item.description}</p>
                          {item.notes && <p className="text-[10px] text-slate-400 dark:text-white/40 truncate mt-0.5">{item.notes}</p>}
                        </td>
                        <td className="px-4 py-2.5 text-slate-700 dark:text-white">{item.client_name || `#${item.client_id}`}</td>
                        <td className="px-4 py-2.5 text-center text-slate-500 dark:text-white/50">
                          {item.loan_id ? `#${item.loan_id}` : '---'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-800 dark:text-white tabular-nums">
                          {fmtRD(item.estimated_value)}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-white/60">
                          {item.storage_location || '---'}
                        </td>
                        <td className={`px-4 py-2.5 tabular-nums ${
                          isExpired ? 'text-[#b3001e] font-semibold' :
                          isExpiring ? 'text-amber-600 dark:text-amber-400 font-semibold' :
                          'text-slate-600 dark:text-white/60'
                        }`}>
                          {fmtDate(item.redeem_deadline)}
                          {isExpired && <span className="ml-1 text-[9px]">VENCIDO</span>}
                          {isExpiring && !isExpired && <span className="ml-1 text-[9px]">{days}d</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <StatusBadge status={item.status} />
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            {item.status === 'held' && (
                              <>
                                <button onClick={() => handleRedeem(item)}
                                  title="Redimir"
                                  className="px-2 py-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded-lg transition-colors">
                                  Redimir
                                </button>
                                <button onClick={() => handleForfeit(item)}
                                  title="Decomisar"
                                  className="px-2 py-1 text-[10px] font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors">
                                  Decomisar
                                </button>
                              </>
                            )}
                            <button onClick={() => setModal({ type: 'edit', item })}
                              title="Editar"
                              className="p-1.5 text-slate-400 dark:text-white/40 hover:text-slate-600 dark:hover:text-white rounded-lg hover:bg-slate-50 dark:hover:bg-white/10">
                              <Pencil size={13} />
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
              {filtered.map(item => {
                const days = daysUntil(item.redeem_deadline)
                const isExpiring = item.status === 'held' && days >= 0 && days <= 7
                const isExpired = item.status === 'held' && days < 0
                return (
                  <div key={item.id} className="px-4 py-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-bold text-slate-800 dark:text-white">{item.description}</p>
                        <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">
                          {item.client_name || `Cliente #${item.client_id}`}
                          {item.loan_id ? ` -- Prestamo #${item.loan_id}` : ''}
                        </p>
                      </div>
                      <StatusBadge status={item.status} />
                    </div>

                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-500 dark:text-white/50">
                        Valor: <span className="font-semibold text-slate-800 dark:text-white">{fmtRD(item.estimated_value)}</span>
                      </span>
                      <span className={`${
                        isExpired ? 'text-[#b3001e] font-semibold' :
                        isExpiring ? 'text-amber-600 dark:text-amber-400 font-semibold' :
                        'text-slate-500 dark:text-white/50'
                      }`}>
                        Vence: {fmtDate(item.redeem_deadline)}
                        {isExpired && ' (VENCIDO)'}
                      </span>
                    </div>

                    {item.storage_location && (
                      <div className="flex items-center gap-1 text-[11px] text-slate-400 dark:text-white/40">
                        <MapPin size={10} /> {item.storage_location}
                      </div>
                    )}

                    <div className="flex gap-2 pt-1">
                      {item.status === 'held' && (
                        <>
                          <button onClick={() => handleRedeem(item)}
                            className="flex-1 py-2 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors min-h-[44px]">
                            Redimir
                          </button>
                          <button onClick={() => handleForfeit(item)}
                            className="flex-1 py-2 text-[11px] font-semibold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/30 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors min-h-[44px]">
                            Decomisar
                          </button>
                        </>
                      )}
                      <button onClick={() => setModal({ type: 'edit', item })}
                        className="px-3 py-2 text-[11px] border border-slate-200 dark:border-white/10 rounded-lg text-slate-500 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 min-h-[44px]">
                        <Pencil size={13} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <PawnModal
          item={modal.item}
          onClose={() => setModal(null)}
          onSave={() => {
            setModal(null)
            loadItems()
            showToast(modal.item ? 'Articulo actualizado' : 'Empeno registrado')
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 text-white text-sm px-5 py-3 rounded-full shadow-lg flex items-center gap-2 ${
          toast.variant === 'error' ? 'bg-red-600' : 'bg-emerald-600'
        }`}>
          <Check size={15} /> {toast.msg}
        </div>
      )}
    </div>
  )
}
