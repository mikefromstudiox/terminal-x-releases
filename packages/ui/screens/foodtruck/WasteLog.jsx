import { useState, useEffect, useCallback, useMemo } from 'react'
import { Trash2, Plus, X, Loader2, Check } from 'lucide-react'
import { useAPI } from '../../context/DataContext'

const REASONS = [
  { id: 'spoiled',     es: 'Echado a perder' },
  { id: 'overcooked',  es: 'Quemado / Mal preparado' },
  { id: 'dropped',     es: 'Caído / Derramado' },
  { id: 'expired',     es: 'Vencido' },
  { id: 'returned',    es: 'Devuelto por cliente' },
  { id: 'tasted',      es: 'Prueba / Cortesía' },
  { id: 'other',       es: 'Otro' },
]

function fmtRD(n) {
  return new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP', minimumFractionDigits: 2 }).format(Number(n || 0))
}

export default function WasteLog() {
  const api = useAPI()
  const [rows, setRows]           = useState([])
  const [items, setItems]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [creating, setCreating]   = useState(false)
  const [busy, setBusy]           = useState(false)
  const [form, setForm]           = useState({
    inventory_item_id: '',
    qty: '',
    unit: '',
    reason: 'spoiled',
    photo_url: '',
  })

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [list, inv] = await Promise.all([
        api?.wasteLog?.list?.({ limit: 100 }) || [],
        api?.inventory?.all?.() || api?.inventory?.list?.() || [],
      ])
      setRows(Array.isArray(list) ? list : [])
      setItems(Array.isArray(inv) ? inv : [])
      setError(null)
    } catch (e) {
      setError(e?.message || 'Error cargando mermas')
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { reload() }, [reload])

  const itemMap = useMemo(() => {
    const m = new Map()
    for (const it of items) m.set(String(it.id), it)
    return m
  }, [items])

  const startCreate = () => {
    setForm({ inventory_item_id: '', qty: '', unit: '', reason: 'spoiled', photo_url: '' })
    setCreating(true)
  }

  const submit = async () => {
    const qty = Number(form.qty)
    if (!Number.isFinite(qty) || qty <= 0) { setError('Cantidad inválida'); return }
    if (!form.reason) { setError('Motivo requerido'); return }
    setBusy(true)
    try {
      const sel = form.inventory_item_id ? itemMap.get(String(form.inventory_item_id)) : null
      await api.wasteLog.create({
        inventory_item_id:           sel?.id || null,
        inventory_item_supabase_id:  sel?.supabase_id || null,
        item_name:                   sel?.name || null,
        qty,
        unit:                        form.unit || sel?.unit || null,
        reason:                      form.reason,
        photo_url:                   form.photo_url || null,
        occurred_at:                 new Date().toISOString(),
      })
      setCreating(false)
      setError(null)
      await reload()
    } catch (e) {
      setError(e?.message || 'No se pudo registrar la merma')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id) => {
    if (!confirm('¿Eliminar este registro de merma?')) return
    try {
      await api.wasteLog.delete(id)
      await reload()
    } catch (e) {
      setError(e?.message || 'No se pudo eliminar')
    }
  }

  const totalCostEstimate = useMemo(() => {
    return rows.reduce((sum, r) => {
      const it = r.inventory_item_id ? itemMap.get(String(r.inventory_item_id)) : null
      const cost = Number(it?.cost || 0)
      return sum + cost * Number(r.qty || 0)
    }, 0)
  }, [rows, itemMap])

  return (
    <div className="h-full overflow-y-auto p-5 lg:p-7 bg-slate-50 dark:bg-black min-h-0">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-xl bg-[#b3001e]/10 grid place-items-center">
          <Trash2 className="text-[#b3001e]" size={20} />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl lg:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Mermas</h1>
          <p className="text-xs text-slate-500 dark:text-white/50 mt-0.5">
            Registro de pérdidas · {rows.length} eventos · estimado {fmtRD(totalCostEstimate)}
          </p>
        </div>
        <button
          onClick={startCreate}
          className="px-4 py-2.5 rounded-xl bg-[#b3001e] hover:bg-red-700 text-white text-sm font-semibold flex items-center gap-2"
        >
          <Plus size={16} /> Nueva
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-[#b3001e]/10 text-[#b3001e] text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)}><X size={14} /></button>
        </div>
      )}

      {creating && (
        <div className="mb-6 p-5 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5">
          <div className="text-[11px] font-extrabold tracking-[2px] text-slate-400 dark:text-white/40 mb-3 uppercase">
            Nuevo registro
          </div>
          <select
            value={form.inventory_item_id}
            onChange={e => setForm({ ...form, inventory_item_id: e.target.value })}
            className="w-full mb-3 px-4 py-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black text-slate-900 dark:text-white text-sm focus:outline-none focus:border-[#b3001e]"
          >
            <option value="">— Producto (opcional) —</option>
            {items.map(it => (
              <option key={it.id} value={it.id}>{it.name}{it.unit ? ` (${it.unit})` : ''}</option>
            ))}
          </select>
          <div className="flex gap-2 mb-3">
            <input
              type="number" step="0.01" min="0"
              value={form.qty}
              onChange={e => setForm({ ...form, qty: e.target.value })}
              placeholder="Cantidad"
              className="flex-1 px-4 py-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black text-slate-900 dark:text-white text-sm focus:outline-none focus:border-[#b3001e]"
            />
            <input
              type="text"
              value={form.unit}
              onChange={e => setForm({ ...form, unit: e.target.value })}
              placeholder="Unidad (lb, ud, oz...)"
              className="flex-1 px-4 py-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black text-slate-900 dark:text-white text-sm focus:outline-none focus:border-[#b3001e]"
            />
          </div>
          <select
            value={form.reason}
            onChange={e => setForm({ ...form, reason: e.target.value })}
            className="w-full mb-3 px-4 py-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black text-slate-900 dark:text-white text-sm focus:outline-none focus:border-[#b3001e]"
          >
            {REASONS.map(r => <option key={r.id} value={r.id}>{r.es}</option>)}
          </select>
          <input
            type="url"
            value={form.photo_url}
            onChange={e => setForm({ ...form, photo_url: e.target.value })}
            placeholder="URL de foto (opcional)"
            className="w-full mb-3 px-4 py-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black text-slate-900 dark:text-white text-sm focus:outline-none focus:border-[#b3001e]"
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setCreating(false)}
              className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-800 dark:text-white text-sm font-semibold"
            >
              Cancelar
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="px-4 py-2.5 rounded-xl bg-[#b3001e] hover:bg-red-700 text-white text-sm font-semibold flex items-center gap-2 disabled:opacity-60"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Guardar
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-slate-400 dark:text-white/40 text-sm">Cargando...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-slate-400 dark:text-white/40 text-sm">
          Sin registros todavía.
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-black/40 text-slate-500 dark:text-white/50 text-[11px] font-extrabold tracking-[1.5px] uppercase">
              <tr>
                <th className="text-left px-4 py-3">Cuándo</th>
                <th className="text-left px-4 py-3">Producto</th>
                <th className="text-right px-4 py-3">Cantidad</th>
                <th className="text-left px-4 py-3">Motivo</th>
                <th className="text-right px-4 py-3">Costo est.</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const it = r.inventory_item_id ? itemMap.get(String(r.inventory_item_id)) : null
                const itemName = r.item_name || it?.name || '—'
                const cost = Number(it?.cost || 0) * Number(r.qty || 0)
                const reasonLabel = REASONS.find(x => x.id === r.reason)?.es || r.reason
                return (
                  <tr key={r.id} className="border-t border-slate-200 dark:border-white/10">
                    <td className="px-4 py-3 text-slate-600 dark:text-white/70">
                      {new Date(r.occurred_at).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td className="px-4 py-3 text-slate-900 dark:text-white font-medium">{itemName}</td>
                    <td className="px-4 py-3 text-right text-slate-900 dark:text-white">{Number(r.qty)}{r.unit ? ` ${r.unit}` : ''}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-white/70">{reasonLabel}</td>
                    <td className="px-4 py-3 text-right text-slate-900 dark:text-white">{cost > 0 ? fmtRD(cost) : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => remove(r.id)}
                        className="p-1.5 rounded-lg hover:bg-[#b3001e]/10 text-[#b3001e]"
                        aria-label="Eliminar"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
