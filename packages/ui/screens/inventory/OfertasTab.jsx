// OfertasTab — bundle promos for tienda/retail. Ships v2.16.10.
// Renders inside Inventory.jsx as a third tab between "Productos" and
// "Quiebres de stock". Backed by api.ofertas.{list,upsert,delete}.
import { useState, useEffect, useMemo, useRef } from 'react'
import {
  Plus, X, Pencil, Trash2, Search, Tag, Sparkles, Power,
  Check, Loader2, AlertTriangle, PackageOpen,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'

function fmtRD(n) {
  return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function OfertasTab() {
  const api = useAPI()
  const { lang } = useLang()
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // null | { supabase_id?, ... }
  const [delConfirm, setDelConfirm] = useState(null)
  const [busyId, setBusyId] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const rows = await api?.ofertas?.list?.({ activeOnly: false })
      setList(Array.isArray(rows) ? rows : [])
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function toggleActive(o) {
    setBusyId(o.supabase_id)
    try {
      await api.ofertas.upsert({
        supabase_id: o.supabase_id,
        name: o.name,
        description: o.description || '',
        price: Number(o.price || 0),
        active: !o.active,
        starts_at: o.starts_at || null,
        ends_at: o.ends_at || null,
        items: (o.items || []).map(i => ({
          service_supabase_id: i.service_supabase_id || null,
          inventory_item_supabase_id: i.inventory_item_supabase_id || null,
          qty: Number(i.qty || 1),
        })),
      })
      await load()
    } finally { setBusyId(null) }
  }

  async function handleDelete(o) {
    setBusyId(o.supabase_id)
    try {
      await api.ofertas.delete(o.supabase_id)
      setDelConfirm(null)
      await load()
    } finally { setBusyId(null) }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 md:px-6 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-[#b3001e]" />
          <h2 className="text-[14px] font-bold text-slate-800 dark:text-white">
            {lang === 'en' ? 'Bundle offers' : 'Ofertas'}
          </h2>
          <span className="text-[11px] text-slate-400 dark:text-white/40">
            {list.length} {lang === 'en' ? 'total' : 'total'}
          </span>
        </div>
        <button
          onClick={() => setEditing({ name: '', description: '', price: '', active: true, starts_at: '', ends_at: '', items: [] })}
          className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors">
          <Plus size={15} /> {lang === 'en' ? 'Create offer' : 'Crear oferta'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 md:px-6 pb-6">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 dark:text-white/40">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : list.length === 0 ? (
          <EmptyState lang={lang} onCreate={() => setEditing({ name: '', description: '', price: '', active: true, starts_at: '', ends_at: '', items: [] })} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {list.map(o => {
              const components = o.items || []
              const subtotal = components.reduce((s, c) => s + Number(c.base_price || 0) * Number(c.qty || 1), 0)
              const discount = Math.max(0, subtotal - Number(o.price || 0))
              const available = Number.isFinite(o.oferta_available) ? o.oferta_available : 0
              const inStock = available >= 1
              return (
                <div key={o.supabase_id}
                  className={`rounded-xl border p-4 bg-white dark:bg-white/5 ${o.active ? 'border-slate-200 dark:border-white/10' : 'border-dashed border-slate-200 dark:border-white/10 opacity-70'}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <p className="text-[14px] font-bold text-slate-800 dark:text-white truncate">{o.name}</p>
                      {o.description && (
                        <p className="text-[11px] text-slate-500 dark:text-white/50 line-clamp-2 mt-0.5">{o.description}</p>
                      )}
                    </div>
                    <span className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full ${inStock
                      ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400'}`}>
                      {inStock
                        ? `${lang === 'en' ? 'Available' : 'Disponible'} (${available})`
                        : (lang === 'en' ? 'Out of stock' : 'Sin stock')}
                    </span>
                  </div>
                  <div className="flex items-end justify-between mb-3">
                    <div>
                      <p className="text-[10px] text-slate-400 dark:text-white/40 uppercase tracking-wider">{lang === 'en' ? 'Bundle price' : 'Precio oferta'}</p>
                      <p className="text-[20px] font-black text-[#b3001e] tabular-nums leading-none">{fmtRD(o.price)}</p>
                    </div>
                    {discount > 0 && (
                      <div className="text-right">
                        <p className="text-[10px] text-slate-400 dark:text-white/40 uppercase tracking-wider">{lang === 'en' ? 'Saves' : 'Ahorra'}</p>
                        <p className="text-[12px] font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{fmtRD(discount)}</p>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 mb-3">
                    {components.length === 0 && (
                      <span className="text-[11px] text-slate-400 dark:text-white/40 italic">{lang === 'en' ? 'No components' : 'Sin componentes'}</span>
                    )}
                    {components.map((c, idx) => (
                      <span key={idx}
                        className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-slate-50 dark:bg-white/5 text-slate-600 dark:text-white/70 border border-slate-100 dark:border-white/10">
                        <span className="truncate max-w-[140px]">{c.name}</span>
                        <span className="text-slate-400 dark:text-white/40">×{c.qty}</span>
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-white/10">
                    <button
                      onClick={() => toggleActive(o)}
                      disabled={busyId === o.supabase_id}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-lg transition-colors ${o.active
                        ? 'border border-emerald-200 dark:border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10'
                        : 'border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/50 hover:bg-slate-50 dark:hover:bg-white/10'}`}>
                      <Power size={11} /> {o.active ? (lang === 'en' ? 'Active' : 'Activa') : (lang === 'en' ? 'Inactive' : 'Inactiva')}
                    </button>
                    <div className="flex items-center gap-1">
                      <button onClick={async () => {
                        // Fetch the full record so the editor always sees the
                        // latest items from DB, not a possibly-stale list-cached
                        // version. Earlier list() returned ofertas without
                        // items → editing then re-saving wiped the components.
                        try {
                          const full = await api.ofertas.get(o.supabase_id)
                          setEditing(full || o)
                        } catch (_aetherErr) {
                          try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'ofertastab.handler' }) } catch {} setEditing(o) }
                      }}
                        className="px-2.5 py-1.5 text-[11px] border border-slate-200 dark:border-white/10 rounded-lg text-slate-500 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10">
                        <Pencil size={12} />
                      </button>
                      <button onClick={() => setDelConfirm(o)}
                        className="px-2.5 py-1.5 text-[11px] border border-red-200 dark:border-red-500/30 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {editing && (
        <OfertaEditModal
          oferta={editing}
          onClose={() => setEditing(null)}
          onSave={() => { setEditing(null); load() }} />
      )}
      {delConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-white/5 rounded-2xl w-full max-w-sm p-6 shadow-2xl text-center">
            <p className="font-semibold text-slate-800 dark:text-white mb-2">{lang === 'en' ? 'Delete offer?' : '¿Eliminar oferta?'}</p>
            <p className="text-sm text-slate-500 dark:text-white/60 mb-6">
              <span className="font-medium text-slate-700 dark:text-white">{delConfirm.name}</span>
              {' — '}
              {lang === 'en' ? 'this cannot be undone.' : 'esta acción no se puede deshacer.'}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDelConfirm(null)} className="flex-1 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10">{lang === 'en' ? 'Cancel' : 'Cancelar'}</button>
              <button onClick={() => handleDelete(delConfirm)} className="flex-1 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700">{lang === 'en' ? 'Delete' : 'Eliminar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function EmptyState({ lang, onCreate }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[#b3001e]/10 flex items-center justify-center mb-4">
        <Sparkles size={24} className="text-[#b3001e]" />
      </div>
      <p className="text-[15px] font-bold text-slate-800 dark:text-white mb-1">
        {lang === 'en' ? 'No offers yet' : 'No hay ofertas aún'}
      </p>
      <p className="text-[12px] text-slate-500 dark:text-white/50 mb-5 max-w-sm">
        {lang === 'en' ? 'Create bundles for promotions.' : 'Crea bundles para promociones.'}
      </p>
      <button onClick={onCreate}
        className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors">
        <Plus size={15} /> {lang === 'en' ? 'Create offer' : 'Crear oferta'}
      </button>
    </div>
  )
}

// ── Edit / Create modal ────────────────────────────────────────────────────────
function OfertaEditModal({ oferta, onClose, onSave }) {
  const api = useAPI()
  const { lang } = useLang()
  const [name, setName] = useState(oferta?.name || '')
  const [description, setDescription] = useState(oferta?.description || '')
  const [price, setPrice] = useState(oferta?.price != null ? String(oferta.price) : '')
  const [active, setActive] = useState(oferta?.active !== false)
  const [startsAt, setStartsAt] = useState((oferta?.starts_at || '').slice(0, 10))
  const [endsAt, setEndsAt] = useState((oferta?.ends_at || '').slice(0, 10))
  const [items, setItems] = useState(() => (oferta?.items || []).map(i => ({
    key: i.service_supabase_id || i.inventory_item_supabase_id || crypto.randomUUID(),
    service_supabase_id: i.service_supabase_id || null,
    inventory_item_supabase_id: i.inventory_item_supabase_id || null,
    name: i.name,
    base_price: Number(i.base_price || 0),
    qty: Number(i.qty || 1),
  })))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)

  // Resolve component name + base_price from inventory_items / services
  // directly inside the modal. Belt-and-suspenders so the editor still shows
  // names even if `api.ofertas.list()` enrichment ever returns stale rows
  // (cache, RLS quirk, or unhydrated supabase_id). Loads once on open.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      api?.inventory?.all?.() || Promise.resolve([]),
      api?.services?.all?.() || Promise.resolve([]),
    ]).then(([inv, svc]) => {
      if (cancelled) return
      const invMap = {}
      for (const it of (inv || [])) if (it?.supabase_id) invMap[it.supabase_id] = it
      const svcMap = {}
      for (const it of (svc || [])) if (it?.supabase_id) svcMap[it.supabase_id] = it
      setItems(prev => prev.map(c => {
        if (c.name && Number(c.base_price) > 0) return c
        if (c.inventory_item_supabase_id) {
          const i = invMap[c.inventory_item_supabase_id]
          if (i) return { ...c, name: i.name || c.name, base_price: Number(i.price || c.base_price || 0) }
        }
        if (c.service_supabase_id) {
          const s = svcMap[c.service_supabase_id]
          if (s) return { ...c, name: s.name || c.name, base_price: Number(s.price || c.base_price || 0) }
        }
        return c
      }))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [api])

  const subtotal = useMemo(() => items.reduce((s, c) => s + Number(c.base_price || 0) * Number(c.qty || 1), 0), [items])
  const ofertaPrice = Number(price || 0)
  const discount = subtotal - ofertaPrice

  function addComponent(p) {
    // p: { type: 'service'|'inventory', supabase_id, name, price }
    const key = p.supabase_id
    if (items.some(i => i.key === key)) {
      // bump qty instead of duplicate
      setItems(items.map(i => i.key === key ? { ...i, qty: Number(i.qty || 1) + 1 } : i))
    } else {
      setItems([...items, {
        key,
        service_supabase_id: p.type === 'service' ? p.supabase_id : null,
        inventory_item_supabase_id: p.type === 'inventory' ? p.supabase_id : null,
        name: p.name,
        base_price: Number(p.price || 0),
        qty: 1,
      }])
    }
    setPickerOpen(false)
  }

  function updateQty(key, qty) {
    const n = Math.max(0, Number(qty) || 0)
    setItems(items.map(i => i.key === key ? { ...i, qty: n } : i))
  }

  function removeComponent(key) {
    setItems(items.filter(i => i.key !== key))
  }

  async function handleSave() {
    setError('')
    if (!name.trim()) { setError(lang === 'en' ? 'Name is required' : 'Nombre requerido'); return }
    const p = Number(price)
    if (!Number.isFinite(p) || p <= 0) { setError(lang === 'en' ? 'Price required' : 'Precio requerido'); return }
    if (items.length === 0) { setError(lang === 'en' ? 'Add at least one component' : 'Agrega al menos un producto'); return }
    if (items.some(i => !(Number(i.qty) > 0))) { setError(lang === 'en' ? 'Each component needs a qty' : 'Cada componente necesita cantidad'); return }
    setSaving(true)
    try {
      await api.ofertas.upsert({
        supabase_id: oferta?.supabase_id || undefined,
        name: name.trim(),
        description: description.trim(),
        price: p,
        active: !!active,
        starts_at: startsAt || null,
        ends_at: endsAt || null,
        items: items.map(i => ({
          service_supabase_id: i.service_supabase_id || null,
          inventory_item_supabase_id: i.inventory_item_supabase_id || null,
          qty: Number(i.qty),
        })),
      })
      onSave?.()
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'ofertastab.addcomponent' }) } catch {}
      setError(e?.message || (lang === 'en' ? 'Failed to save' : 'No se pudo guardar'))
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-white/5 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/10">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-[#b3001e]" />
            <h3 className="text-[15px] font-bold text-slate-800 dark:text-white">
              {oferta?.supabase_id ? (lang === 'en' ? 'Edit offer' : 'Editar oferta') : (lang === 'en' ? 'New offer' : 'Nueva oferta')}
            </h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 dark:text-white/40 hover:bg-slate-100 dark:hover:bg-white/10">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-white/50 uppercase tracking-wider mb-1">
              {lang === 'en' ? 'Name' : 'Nombre'} *
            </label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder={lang === 'en' ? 'e.g. 3 beers + rum bottle' : 'ej. 3 cervezas + ron'}
              className="w-full px-3 py-2 bg-white dark:bg-black border border-slate-200 dark:border-white/10 rounded-lg text-[14px] text-slate-800 dark:text-white focus:outline-none focus:border-[#b3001e]" />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-white/50 uppercase tracking-wider mb-1">
              {lang === 'en' ? 'Description' : 'Descripción'}
            </label>
            <textarea value={description} onChange={e => setDescription(e.target.value)}
              rows={2}
              placeholder={lang === 'en' ? 'Optional internal notes' : 'Notas internas opcionales'}
              className="w-full px-3 py-2 bg-white dark:bg-black border border-slate-200 dark:border-white/10 rounded-lg text-[13px] text-slate-800 dark:text-white focus:outline-none focus:border-[#b3001e] resize-none" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 dark:text-white/50 uppercase tracking-wider mb-1">
                {lang === 'en' ? 'Bundle price' : 'Precio oferta'} (RD$) *
              </label>
              <input type="number" inputMode="decimal" step="0.01" min="0"
                value={price} onChange={e => setPrice(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-black border border-slate-200 dark:border-white/10 rounded-lg text-[14px] tabular-nums text-slate-800 dark:text-white focus:outline-none focus:border-[#b3001e]" />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => setActive(!active)}
                className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${active
                  ? 'border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/50'}`}>
                <Power size={13} /> {active ? (lang === 'en' ? 'Active' : 'Activa') : (lang === 'en' ? 'Inactive' : 'Inactiva')}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 dark:text-white/50 uppercase tracking-wider mb-1">
                {lang === 'en' ? 'Starts' : 'Inicia'}
              </label>
              <input type="date" value={startsAt} onChange={e => setStartsAt(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-black border border-slate-200 dark:border-white/10 rounded-lg text-[13px] text-slate-800 dark:text-white focus:outline-none focus:border-[#b3001e]" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 dark:text-white/50 uppercase tracking-wider mb-1">
                {lang === 'en' ? 'Ends' : 'Termina'}
              </label>
              <input type="date" value={endsAt} onChange={e => setEndsAt(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-black border border-slate-200 dark:border-white/10 rounded-lg text-[13px] text-slate-800 dark:text-white focus:outline-none focus:border-[#b3001e]" />
            </div>
          </div>

          {/* Components */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-bold text-slate-500 dark:text-white/50 uppercase tracking-wider">
                {lang === 'en' ? 'Components' : 'Componentes'}
              </label>
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/10">
                <Plus size={12} /> {lang === 'en' ? 'Add product' : 'Agregar producto'}
              </button>
            </div>
            {items.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 dark:border-white/10 px-4 py-6 text-center text-[12px] text-slate-400 dark:text-white/40">
                {lang === 'en' ? 'No components yet.' : 'Aún sin componentes.'}
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 dark:border-white/10 divide-y divide-slate-100 dark:divide-white/5 overflow-hidden">
                {items.map(c => (
                  <div key={c.key} className="flex items-center gap-3 px-3 py-2.5 bg-white dark:bg-white/5">
                    <div className="min-w-0 flex-1">
                      <p className={`text-[13px] font-semibold truncate ${c.name ? 'text-slate-800 dark:text-white' : 'italic text-slate-400 dark:text-white/40'}`}>
                        {c.name || (lang === 'en' ? 'Loading product name...' : 'Cargando nombre...')}
                      </p>
                      <p className="text-[10px] text-slate-400 dark:text-white/40 tabular-nums">{fmtRD(c.base_price)} c/u</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-slate-400 dark:text-white/40">{lang === 'en' ? 'Qty' : 'Cant.'}</span>
                      <input type="number" inputMode="decimal" step="0.5" min="0"
                        value={c.qty}
                        onChange={e => updateQty(c.key, e.target.value)}
                        style={{ width: 60, minWidth: 60 }}
                        className="px-2 py-1 bg-white dark:bg-black border border-slate-200 dark:border-white/10 rounded-md text-[13px] tabular-nums text-center text-slate-800 dark:text-white focus:outline-none focus:border-[#b3001e]" />
                      <button onClick={() => removeComponent(c.key)}
                        className="p-1.5 rounded-md text-slate-400 dark:text-white/40 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10">
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Math summary */}
          <div className="rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/10 px-4 py-3 space-y-1">
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-slate-500 dark:text-white/50">{lang === 'en' ? 'Components subtotal' : 'Subtotal componentes'}</span>
              <span className="font-semibold text-slate-700 dark:text-white tabular-nums">{fmtRD(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-slate-500 dark:text-white/50">{lang === 'en' ? 'Bundle price' : 'Precio oferta'}</span>
              <span className="font-semibold text-slate-700 dark:text-white tabular-nums">{fmtRD(ofertaPrice)}</span>
            </div>
            <div className="flex items-center justify-between text-[13px] pt-1 border-t border-slate-200 dark:border-white/10">
              <span className="font-bold text-slate-700 dark:text-white">{lang === 'en' ? 'Discount' : 'Descuento'}</span>
              <span className={`font-black tabular-nums ${discount > 0 ? 'text-emerald-600 dark:text-emerald-400' : discount < 0 ? 'text-[#b3001e]' : 'text-slate-700 dark:text-white'}`}>
                {fmtRD(discount)}
              </span>
            </div>
            {discount < 0 && (
              <p className="flex items-center gap-1 text-[11px] text-[#b3001e] mt-1">
                <AlertTriangle size={11} /> {lang === 'en' ? 'Bundle costs more than its components.' : 'La oferta cuesta más que sus componentes.'}
              </p>
            )}
          </div>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-[12px] text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 px-6 py-4 border-t border-slate-200 dark:border-white/10">
          <button onClick={onClose}
            className="flex-1 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10">
            {lang === 'en' ? 'Cancel' : 'Cancelar'}
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2 bg-black text-white rounded-lg text-sm font-medium hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {lang === 'en' ? 'Save' : 'Guardar'}
          </button>
        </div>
      </div>

      {pickerOpen && (
        <ProductPicker onClose={() => setPickerOpen(false)} onPick={addComponent} />
      )}
    </div>
  )
}

// ── Product picker drawer ─────────────────────────────────────────────────────
function ProductPicker({ onClose, onPick }) {
  const api = useAPI()
  const { lang } = useLang()
  const [q, setQ] = useState('')
  const [services, setServices] = useState([])
  const [inventory, setInventory] = useState([])
  const [loading, setLoading] = useState(true)
  const inputRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [svc, inv] = await Promise.all([
          api?.services?.all?.().catch(() => []),
          api?.inventory?.all?.().catch(() => []),
        ])
        if (cancelled) return
        setServices((svc || []).filter(s => s.active !== 0 && s.in_stock !== 0))
        setInventory((inv || []).filter(i => i.active !== 0))
      } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [api])

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50) }, [])

  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim()
    const svc = services.map(s => ({
      type: 'service',
      supabase_id: s.supabase_id,
      name: s.name,
      sku: s.sku || '',
      price: Number(s.price || 0),
      sub: lang === 'en' ? 'Service' : 'Servicio',
    }))
    const inv = inventory.map(i => ({
      type: 'inventory',
      supabase_id: i.supabase_id,
      name: i.name,
      sku: i.sku || i.barcode || '',
      price: Number(i.price || 0),
      sub: `${lang === 'en' ? 'Inventory' : 'Inventario'} · ${Number(i.quantity || 0)} ${lang === 'en' ? 'in stock' : 'en stock'}`,
    }))
    const all = [...svc, ...inv].filter(p => p.supabase_id)
    if (!needle) return all.slice(0, 80)
    return all.filter(p =>
      p.name.toLowerCase().includes(needle) ||
      (p.sku || '').toLowerCase().includes(needle)
    ).slice(0, 80)
  }, [services, inventory, q, lang])

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div className="bg-white dark:bg-white/5 rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/10">
          <h4 className="text-[14px] font-bold text-slate-800 dark:text-white">
            {lang === 'en' ? 'Add component' : 'Agregar componente'}
          </h4>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 dark:text-white/40 hover:bg-slate-100 dark:hover:bg-white/10">
            <X size={16} />
          </button>
        </div>
        <div className="px-4 py-3 border-b border-slate-100 dark:border-white/10">
          <input
            ref={inputRef}
            value={q} onChange={e => setQ(e.target.value)}
            placeholder={lang === 'en' ? 'Search by name or SKU' : 'Buscar por nombre o SKU'}
            className="w-full px-3 py-2 bg-white dark:bg-black border border-slate-200 dark:border-white/10 rounded-lg text-[13px] text-slate-800 dark:text-white focus:outline-none focus:border-[#b3001e]" />
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400 dark:text-white/40">
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-12 text-center text-[12px] text-slate-400 dark:text-white/40 flex flex-col items-center gap-2">
              <PackageOpen size={20} />
              {lang === 'en' ? 'No matches' : 'Sin coincidencias'}
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-white/5">
              {filtered.map(p => (
                <li key={`${p.type}-${p.supabase_id}`}>
                  <button
                    onClick={() => onPick(p)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-white/10 transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-slate-800 dark:text-white truncate">{p.name}</p>
                      <p className="text-[10px] text-slate-400 dark:text-white/40 truncate">{p.sub}{p.sku ? ` · ${p.sku}` : ''}</p>
                    </div>
                    <span className="text-[12px] font-bold text-[#b3001e] tabular-nums shrink-0">{fmtRD(p.price)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
