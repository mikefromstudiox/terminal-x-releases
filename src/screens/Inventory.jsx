import { useState, useEffect, useMemo } from 'react'
import {
  Package, Plus, Search, AlertTriangle, X,
  ChevronUp, ChevronDown, Pencil, Trash2,
  History, RefreshCw, Loader2,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useAPI } from '../context/DataContext'
import { useLang } from '../i18n'
import { syncInventoryItem } from '../services/sync'

const ALLOWED = ['owner', 'manager', 'cfo', 'accountant']

function fmtRD(n) {
  return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDate(s) {
  if (!s) return '—'
  return new Date(s.includes('T') ? s : s + 'T12:00:00').toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const CATEGORIES = ['Bebidas', 'Insumos', 'Repuestos', 'Herramientas', 'Limpieza', 'Otro']

// ── Item form modal ────────────────────────────────────────────────────────────
function ItemModal({ item, onSave, onClose }) {
  const api = useAPI()
  const [form, setForm] = useState({
    sku:          item?.sku          || '',
    name:         item?.name         || '',
    category:     item?.category     || CATEGORIES[0],
    quantity:     item?.quantity     ?? 0,
    min_quantity: item?.min_quantity ?? 5,
    price:        item?.price        ?? 0,
    cost:         item?.cost         ?? 0,
  })
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSave() {
    if (!form.name.trim()) { setErr('El nombre es requerido.'); return }
    setSaving(true)
    try {
      const data = {
        ...form,
        name:         form.name.trim(),
        sku:          form.sku.trim() || null,
        quantity:     Number(form.quantity)     || 0,
        min_quantity: Number(form.min_quantity) || 0,
        price:        parseFloat(form.price)    || 0,
        cost:         parseFloat(form.cost)     || 0,
      }
      if (item?.id) await api.inventory.update({ id: item.id, ...data })
      else          await api.inventory.create(data)
      syncInventoryItem(item?.id ? { id: item.id, ...data } : data)
      onSave()
    } catch (e) {
      setErr(e?.message || 'Error al guardar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="font-bold text-slate-800">{item ? 'Editar item' : 'Nuevo item'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">SKU (opcional)</label>
              <input value={form.sku} onChange={e => set('sku', e.target.value)}
                placeholder="SKU-001"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Categoría</label>
              <select value={form.category} onChange={e => set('category', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Nombre *</label>
            <input value={form.name} onChange={e => { set('name', e.target.value); setErr('') }}
              placeholder="Ej: Shampoo para autos 1L"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Precio venta</label>
              <input type="number" min="0" step="0.01" value={form.price} onChange={e => set('price', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Costo</label>
              <input type="number" min="0" step="0.01" value={form.cost} onChange={e => set('cost', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>
          {!item && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Cantidad inicial</label>
                <input type="number" min="0" value={form.quantity} onChange={e => set('quantity', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Mínimo (alerta)</label>
                <input type="number" min="0" value={form.min_quantity} onChange={e => set('min_quantity', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
            </div>
          )}
          {item && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Mínimo (alerta)</label>
              <input type="number" min="0" value={form.min_quantity} onChange={e => set('min_quantity', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          )}
          {err && <p className="text-xs text-red-500 flex items-center gap-1"><AlertTriangle size={12} />{err}</p>}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
            {saving && <Loader2 size={13} className="animate-spin" />}
            {item ? 'Guardar cambios' : 'Crear item'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Adjust qty modal ───────────────────────────────────────────────────────────
function AdjustModal({ item, onSave, onClose }) {
  const api = useAPI()
  const { user } = useAuth()
  const [delta,  setDelta]  = useState(0)
  const [notes,  setNotes]  = useState('')
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState('')

  const newQty = item.quantity + Number(delta || 0)

  async function handleSave() {
    const d = Number(delta)
    if (!d || isNaN(d)) { setErr('Ingresa una cantidad distinta de cero.'); return }
    setSaving(true)
    try {
      await api.inventory.adjust({ id: item.id, delta: d, notes, userId: user?.id })
      onSave()
    } catch (e) {
      setErr(e?.message || 'Error al ajustar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="font-bold text-slate-800">Ajustar cantidad</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <p className="text-sm font-semibold text-slate-700">{item.name}</p>
            <p className="text-xs text-slate-400 mt-0.5">Stock actual: <span className="font-semibold text-slate-600">{item.quantity}</span></p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
              Cantidad (+ para entrada, - para salida)
            </label>
            <div className="flex items-center gap-2">
              <button onClick={() => setDelta(d => Number(d) - 1)}
                className="w-9 h-9 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50 text-slate-600">
                <ChevronDown size={16} />
              </button>
              <input type="number" value={delta} onChange={e => { setDelta(e.target.value); setErr('') }}
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-center font-semibold focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <button onClick={() => setDelta(d => Number(d) + 1)}
                className="w-9 h-9 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50 text-slate-600">
                <ChevronUp size={16} />
              </button>
            </div>
            {newQty >= 0 && (
              <p className="text-xs text-slate-400 mt-1.5 text-center">
                Nuevo stock: <span className={`font-semibold ${newQty <= item.min_quantity ? 'text-amber-600' : 'text-green-600'}`}>{newQty}</span>
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Notas (opcional)</label>
            <input value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Ej: Recepción factura #123"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          {err && <p className="text-xs text-red-500 flex items-center gap-1"><AlertTriangle size={12} />{err}</p>}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
            {saving && <Loader2 size={13} className="animate-spin" />}
            Confirmar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Transaction history panel ──────────────────────────────────────────────────
function HistoryPanel({ item, onClose }) {
  const api = useAPI()
  const [txns, setTxns]       = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.inventory.transactions({ id: item.id })
      .then(r => { setTxns(r || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [item.id])

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div>
            <h3 className="font-bold text-slate-800">Historial — {item.name}</h3>
            <p className="text-xs text-slate-400 mt-0.5">Últimas 50 transacciones</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {loading && <p className="text-center text-slate-400 text-sm py-8">Cargando…</p>}
          {!loading && txns.length === 0 && <p className="text-center text-slate-400 text-sm py-8">Sin movimientos registrados.</p>}
          {txns.map(t => (
            <div key={t.id} className="flex items-start gap-3 py-3 border-b border-slate-50 last:border-0">
              <span className={`text-sm font-bold w-10 text-right shrink-0 ${t.delta > 0 ? 'text-green-600' : 'text-red-500'}`}>
                {t.delta > 0 ? `+${t.delta}` : t.delta}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-600">{t.notes || '—'}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{t.user_name || 'Sistema'} · {fmtDate(t.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function Inventory() {
  const api = useAPI()
  const { user } = useAuth()
  const { lang } = useLang()

  const [items,    setItems]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [filter,   setFilter]   = useState('all')   // 'all' | 'low'
  const [modal,    setModal]    = useState(null)     // null | { type: 'item'|'adjust'|'history', item }
  const [delConfirm, setDelConfirm] = useState(null)

  if (!ALLOWED.includes(user?.role)) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
        Sin acceso
      </div>
    )
  }

  async function load() {
    setLoading(true)
    try {
      const data = await api?.inventory?.all()
      setItems(data || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleDelete(item) {
    await api.inventory.delete({ id: item.id })
    setDelConfirm(null)
    load()
  }

  const filtered = useMemo(() => {
    let list = items
    if (filter === 'low') list = list.filter(i => i.quantity <= i.min_quantity)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(i => i.name.toLowerCase().includes(q) || (i.sku || '').toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q))
    }
    return list
  }, [items, search, filter])

  const lowCount   = items.filter(i => i.quantity <= i.min_quantity).length
  const totalValue = items.reduce((s, i) => s + (i.quantity * i.price), 0)

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <Package size={20} className="text-slate-500" />
          <h1 className="text-[17px] font-bold text-slate-800">{lang === 'en' ? 'Inventory' : 'Inventario'}</h1>
        </div>
        <button
          onClick={() => setModal({ type: 'item', item: null })}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors">
          <Plus size={15} /> Agregar item
        </button>
      </div>

      {/* Stats */}
      <div className="px-6 py-4 grid grid-cols-3 gap-4 shrink-0">
        {[
          { label: 'Total items',     value: items.length,         color: 'text-slate-700' },
          { label: 'Stock bajo',      value: lowCount,             color: lowCount > 0 ? 'text-amber-600' : 'text-slate-700' },
          { label: 'Valor en stock',  value: fmtRD(totalValue),    color: 'text-slate-700' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl border border-slate-200 px-4 py-3">
            <p className="text-xs text-slate-400 mb-1">{label}</p>
            <p className={`text-[18px] font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Filters + search */}
      <div className="px-6 pb-3 flex items-center gap-3 shrink-0">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre, SKU, categoría…"
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
          {[['all', 'Todos'], ['low', `Stock bajo (${lowCount})`]].map(([v, label]) => (
            <button key={v} onClick={() => setFilter(v)}
              className={`px-4 py-1.5 font-medium transition ${filter === v ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={load} className="p-2 text-slate-400 hover:text-slate-600 transition-colors">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 text-sm gap-2">
            <Loader2 size={16} className="animate-spin" /> Cargando…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-slate-400 text-sm">
            {items.length === 0 ? 'No hay items. Agrega tu primer producto.' : 'Sin resultados para la búsqueda.'}
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left">
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Nombre</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Categoría</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Stock</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Precio</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Valor</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => {
                  const isLow = item.quantity <= item.min_quantity
                  return (
                    <tr key={item.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800">{item.name}</p>
                        {item.sku && <p className="text-[11px] text-slate-400 mt-0.5">{item.sku}</p>}
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{item.category || '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-bold text-base ${isLow ? 'text-amber-600' : 'text-slate-700'}`}>
                          {item.quantity}
                        </span>
                        {isLow && (
                          <span className="ml-1.5 text-[10px] font-medium text-amber-500 bg-amber-50 px-1.5 py-0.5 rounded-full">
                            mín {item.min_quantity}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600">{fmtRD(item.price)}</td>
                      <td className="px-4 py-3 text-right text-slate-500 text-xs">{fmtRD(item.quantity * item.price)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setModal({ type: 'adjust', item })}
                            className="px-2 py-1 text-xs border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 font-medium">
                            Ajustar
                          </button>
                          <button onClick={() => setModal({ type: 'history', item })}
                            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-50" title="Historial">
                            <History size={14} />
                          </button>
                          <button onClick={() => setModal({ type: 'item', item })}
                            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-50" title="Editar">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => setDelConfirm(item)}
                            className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50" title="Eliminar">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {modal?.type === 'item' && (
        <ItemModal item={modal.item} onClose={() => setModal(null)} onSave={() => { setModal(null); load() }} />
      )}
      {modal?.type === 'adjust' && (
        <AdjustModal item={modal.item} onClose={() => setModal(null)} onSave={() => { setModal(null); load() }} />
      )}
      {modal?.type === 'history' && (
        <HistoryPanel item={modal.item} onClose={() => setModal(null)} />
      )}

      {/* Delete confirm */}
      {delConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl text-center">
            <p className="font-semibold text-slate-800 mb-2">¿Eliminar item?</p>
            <p className="text-sm text-slate-500 mb-6">Se eliminará <span className="font-medium text-slate-700">{delConfirm.name}</span>. Esta acción no se puede deshacer.</p>
            <div className="flex gap-3">
              <button onClick={() => setDelConfirm(null)} className="flex-1 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
              <button onClick={() => handleDelete(delConfirm)} className="flex-1 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700">Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
