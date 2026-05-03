import { useState, useEffect, useMemo } from 'react'
import {
  UtensilsCrossed, Plus, Pencil, Trash2, X, Loader2, AlertTriangle,
  Tag, ListOrdered, Settings2, Check, ChevronUp, ChevronDown,
  Search, Link2, Link2Off, Slash, ChefHat, Package,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtRD(n) {
  return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const COURSES = [
  { value: '',          label: '—' },
  { value: 'entrada',   label: 'Entrada' },
  { value: 'principal', label: 'Principal' },
  { value: 'postre',    label: 'Postre' },
  { value: 'bebida',    label: 'Bebida' },
  { value: 'coctel',    label: 'Coctel' },
]

const PRINTER_ROUTES = [
  { value: 'receipt', label: 'Recibo (cajero)' },
  { value: 'kitchen', label: 'Cocina' },
  { value: 'bar',     label: 'Bar' },
]

// ═══════════════════════════════════════════════════════════════════════════════
//  Root screen
// ═══════════════════════════════════════════════════════════════════════════════
export default function MenuBuilder() {
  const [tab, setTab] = useState('items') // categorias | items | modificadores

  const tabs = [
    { id: 'categorias',    label: 'Categorías',      icon: Tag },
    { id: 'items',         label: 'Items del Menú',  icon: UtensilsCrossed },
    { id: 'modificadores', label: 'Modificadores',   icon: Settings2 },
  ]

  return (
    <div className="min-h-full bg-black text-white">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-zinc-800">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-red-600/10 border border-red-600/30 flex items-center justify-center">
            <UtensilsCrossed size={20} className="text-red-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Menú</h1>
            <p className="text-xs text-white/50">Categorías, platos y modificadores</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-6 pt-4 flex gap-1 border-b border-zinc-800">
        {tabs.map(t => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium rounded-t-lg flex items-center gap-2 transition
                ${active
                  ? 'bg-zinc-900 text-white border border-zinc-800 border-b-transparent -mb-px'
                  : 'text-white/50 hover:text-white hover:bg-white/5'}`}
            >
              <Icon size={15} />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Body */}
      <div className="p-6">
        {tab === 'categorias'    && <CategoryTab />}
        {tab === 'items'         && <ItemsTab />}
        {tab === 'modificadores' && <ModifiersTab />}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Tab 1 — Categorías
// ═══════════════════════════════════════════════════════════════════════════════
function CategoryTab() {
  const api = useAPI()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null) // { editing? }
  const [fallback, setFallback] = useState(false)
  const [err, setErr] = useState('')

  async function load() {
    setLoading(true)
    setErr('')
    try {
      if (api?.categorias?.all) {
        const list = await api.categorias.all()
        setRows(Array.isArray(list) ? list : [])
        setFallback(false)
      } else {
        // Fallback: distinct categories from services
        const services = await api.services.all()
        const names = Array.from(new Set((services || []).map(s => s.category).filter(Boolean))).sort()
        setRows(names.map((n, i) => ({ id: `virt-${i}`, nombre: n, orden: i, _virtual: true })))
        setFallback(true)
      }
    } catch (e) {
      setErr(e?.message || 'Error cargando categorías.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  async function handleDelete(row) {
    if (row._virtual) return
    if (!confirm(`¿Eliminar categoría "${row.nombre}"?`)) return
    try {
      await api.categorias.delete(row.id)
      load()
    } catch (e) {
      alert(e?.message || 'Error al eliminar.')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">Categorías</h2>
          <p className="text-xs text-white/50">Organiza el menú en secciones.</p>
        </div>
        {!fallback && (
          <button
            onClick={() => setModal({ editing: null })}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold flex items-center gap-2"
          >
            <Plus size={15} /> Nueva Categoría
          </button>
        )}
      </div>

      {fallback && (
        <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>CRUD de categorías no disponible en esta plataforma. Mostrando categorías únicas extraídas de servicios.</span>
        </div>
      )}

      {err && <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">{err}</div>}

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-10 flex justify-center"><Loader2 size={22} className="animate-spin text-white/40" /></div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-white/40 text-sm">Sin categorías. Crea la primera.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-black/40 text-white/50 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Nombre</th>
                <th className="text-left px-4 py-3 font-semibold w-24">Orden</th>
                {!fallback && <th className="text-right px-4 py-3 font-semibold w-28">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t border-zinc-800 hover:bg-white/5">
                  <td className="px-4 py-3 font-medium">{r.nombre}</td>
                  <td className="px-4 py-3 text-white/60">{r.orden ?? '—'}</td>
                  {!fallback && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setModal({ editing: r })}
                        className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white"
                        title="Editar"
                      ><Pencil size={14} /></button>
                      <button
                        onClick={() => handleDelete(r)}
                        className="p-1.5 rounded hover:bg-red-500/10 text-white/60 hover:text-red-400"
                        title="Eliminar"
                      ><Trash2 size={14} /></button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <CategoryModal
          editing={modal.editing}
          onClose={() => setModal(null)}
          onSave={() => { setModal(null); load() }}
        />
      )}
    </div>
  )
}

function CategoryModal({ editing, onClose, onSave }) {
  const api = useAPI()
  const [form, setForm] = useState({
    nombre: editing?.nombre || '',
    orden:  editing?.orden  ?? 0,
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSave() {
    if (!form.nombre.trim()) { setErr('El nombre es requerido.'); return }
    setSaving(true)
    try {
      const payload = { nombre: form.nombre.trim(), orden: Number(form.orden) || 0 }
      if (editing?.id) await api.categorias.update(editing.id, payload)
      else             await api.categorias.create(payload)
      onSave()
    } catch (e) {
      setErr(e?.message || 'Error al guardar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell title={editing ? 'Editar categoría' : 'Nueva categoría'} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Nombre *">
          <input
            autoFocus
            value={form.nombre}
            onChange={e => { set('nombre', e.target.value); setErr('') }}
            className={inputCls}
            placeholder="Ej: Entradas"
          />
        </Field>
        <Field label="Orden">
          <input
            type="number"
            value={form.orden}
            onChange={e => set('orden', e.target.value)}
            className={inputCls}
          />
        </Field>
        {err && <p className="text-xs text-red-400 flex items-center gap-1"><AlertTriangle size={12} />{err}</p>}
      </div>
      <ModalFooter onClose={onClose} onSave={handleSave} saving={saving} editing={!!editing} />
    </ModalShell>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Tab 2 — Items del Menú
// ═══════════════════════════════════════════════════════════════════════════════
function ItemsTab() {
  const api = useAPI()
  const [services, setServices] = useState([])
  const [categorias, setCategorias] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterCat, setFilterCat] = useState('')
  const [showNonMenu, setShowNonMenu] = useState(false)
  const [q, setQ] = useState('')
  const [modal, setModal] = useState(null) // { editing? }
  const [recipeFor, setRecipeFor] = useState(null) // service row whose recipe is being edited
  const [err, setErr] = useState('')

  async function load() {
    setLoading(true)
    setErr('')
    try {
      const [svcs, cats] = await Promise.all([
        api.services.all(),
        api.categorias?.all ? api.categorias.all() : Promise.resolve([]),
      ])
      setServices(Array.isArray(svcs) ? svcs : [])
      setCategorias(Array.isArray(cats) ? cats : [])
    } catch (e) {
      setErr(e?.message || 'Error cargando items.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    let list = services
    if (!showNonMenu) list = list.filter(s => s.is_menu_item === 1 || s.is_menu_item === true)
    if (filterCat)    list = list.filter(s => String(s.categoria_id || '') === String(filterCat) || s.category === filterCat)
    if (q.trim()) {
      const needle = q.trim().toLowerCase()
      list = list.filter(s =>
        (s.name || '').toLowerCase().includes(needle) ||
        (s.name_en || '').toLowerCase().includes(needle) ||
        (s.category || '').toLowerCase().includes(needle)
      )
    }
    return list
  }, [services, filterCat, showNonMenu, q])

  async function handleDelete(row) {
    if (!confirm(`¿Eliminar "${row.name}"? (se marcará como inactivo)`)) return
    try {
      await api.services.delete(row.id)
      load()
    } catch (e) {
      alert(e?.message || 'Error al eliminar.')
    }
  }

  // v2.16.3 — 86 toggle. Polymorphic key: prefer numeric local id (desktop),
  // fall back to supabase_id UUID (web rows freshly inserted before pull).
  async function handleToggle86(row) {
    const next = (row.in_stock === 0 || row.in_stock === false) ? 1 : 0
    const key = row.id ?? row.supabase_id
    try {
      if (api.services.setInStock) {
        await api.services.setInStock(key, next)
      } else {
        // Fallback: older shells without the dedicated endpoint — write through update.
        await api.services.update(row.id, { in_stock: next })
      }
      load()
    } catch (e) {
      alert(e?.message || 'Error al actualizar disponibilidad.')
    }
  }

  function catName(row) {
    if (row.categoria_id) {
      const c = categorias.find(c => String(c.id) === String(row.categoria_id))
      if (c) return c.nombre
    }
    return row.category || '—'
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold">Items del Menú</h2>
          <p className="text-xs text-white/50">Platos, bebidas y cualquier cosa vendible.</p>
        </div>
        <button
          onClick={() => setModal({ editing: null })}
          className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold flex items-center gap-2"
        >
          <Plus size={15} /> Nuevo Item
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex-1 min-w-[220px] flex items-center gap-2.5 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 focus-within:border-red-600">
          <Search size={14} className="shrink-0 text-white/40" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Buscar por nombre…"
            className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none"
          />
        </div>
        <select
          value={filterCat}
          onChange={e => setFilterCat(e.target.value)}
          className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-white focus:outline-none focus:border-red-600"
        >
          <option value="">Todas las categorías</option>
          {categorias.map(c => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer">
          <input
            type="checkbox"
            checked={showNonMenu}
            onChange={e => setShowNonMenu(e.target.checked)}
            className="accent-red-600"
          />
          Mostrar no-menú
        </label>
      </div>

      {err && <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">{err}</div>}

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-10 flex justify-center"><Loader2 size={22} className="animate-spin text-white/40" /></div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-white/40 text-sm">Sin items.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-black/40 text-white/50 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Nombre</th>
                  <th className="text-left px-4 py-3 font-semibold">Categoría</th>
                  <th className="text-right px-4 py-3 font-semibold">Precio</th>
                  <th className="text-right px-4 py-3 font-semibold">Costo</th>
                  <th className="text-left px-4 py-3 font-semibold">Course</th>
                  <th className="text-left px-4 py-3 font-semibold">Ruta</th>
                  <th className="text-left px-4 py-3 font-semibold">Estación</th>
                  <th className="text-center px-4 py-3 font-semibold">Mods</th>
                  <th className="text-center px-4 py-3 font-semibold">86</th>
                  <th className="text-center px-4 py-3 font-semibold">Activo</th>
                  <th className="text-right px-4 py-3 font-semibold w-28">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} className="border-t border-zinc-800 hover:bg-white/5">
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.name}</div>
                      {r.name_en && <div className="text-xs text-white/40">{r.name_en}</div>}
                    </td>
                    <td className="px-4 py-3 text-white/70">{catName(r)}</td>
                    <td className="px-4 py-3 text-right font-mono text-white">{fmtRD(r.price)}</td>
                    <td className="px-4 py-3 text-right font-mono text-white/60">{r.cost ? fmtRD(r.cost) : '—'}</td>
                    <td className="px-4 py-3 text-white/60 capitalize">{r.course || '—'}</td>
                    <td className="px-4 py-3 text-white/60">{r.printer_route || '—'}</td>
                    <td className="px-4 py-3 text-white/60">{r.station || '—'}</td>
                    <td className="px-4 py-3 text-center text-white/60">{r.modifiers_count ?? '—'}</td>
                    <td className="px-4 py-3 text-center">
                      {(() => {
                        const oos = r.in_stock === 0 || r.in_stock === false
                        return (
                          <button
                            onClick={() => handleToggle86(r)}
                            className={`inline-flex items-center gap-1 text-[10px] font-bold tracking-wide uppercase px-2 py-1 rounded-lg border transition
                              ${oos
                                ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25'
                                : 'bg-white/5 border-white/10 text-white/60 hover:border-amber-500/40 hover:text-amber-300'}`}
                            title={oos ? 'Marcar disponible' : 'Marcar agotado (86)'}
                          >
                            <Slash size={11} />
                            {oos ? 'Agotado' : '86'}
                          </button>
                        )
                      })()}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {(r.active === 1 || r.active === true)
                        ? <span className="inline-flex items-center gap-1 text-green-400 text-xs"><Check size={12} /></span>
                        : <span className="text-white/30 text-xs">Off</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setRecipeFor(r)}
                        className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white"
                        title="Receta (descontar inventario)"
                      ><ChefHat size={14} /></button>
                      <button
                        onClick={() => setModal({ editing: r })}
                        className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white"
                        title="Editar"
                      ><Pencil size={14} /></button>
                      <button
                        onClick={() => handleDelete(r)}
                        className="p-1.5 rounded hover:bg-red-500/10 text-white/60 hover:text-red-400"
                        title="Eliminar"
                      ><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <ItemModal
          editing={modal.editing}
          categorias={categorias}
          onClose={() => setModal(null)}
          onSave={() => { setModal(null); load() }}
        />
      )}

      {recipeFor && (
        <RecipeModal
          service={recipeFor}
          onClose={() => setRecipeFor(null)}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Recipe Modal — Bill-of-Materials per service (v2.16.3)
//  Lists ingredients (inventory_items) with qty_per_unit. At ticket close the
//  close path multiplies qty_per_unit × line qty and decrements inventory.
// ═══════════════════════════════════════════════════════════════════════════════
function RecipeModal({ service, onClose }) {
  const api = useAPI()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)

  async function load() {
    setLoading(true); setErr('')
    try {
      const key = service.supabase_id || service.id
      const list = await api.recipeItems.listForService(key)
      setRows(Array.isArray(list) ? list : [])
    } catch (e) {
      setErr(e?.message || 'Error cargando la receta.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [service?.id, service?.supabase_id])

  // Live ingredient search via api.inventory.search.
  useEffect(() => {
    let alive = true
    const term = search.trim()
    if (!term) { setResults([]); return }
    setSearching(true)
    ;(async () => {
      try {
        const list = await (api.inventory.search ? api.inventory.search(term) : Promise.resolve([]))
        if (!alive) return
        const existing = new Set(rows.map(r => r.inventory_item_supabase_id))
        setResults((list || []).filter(i => i.supabase_id && !existing.has(i.supabase_id)).slice(0, 8))
      } catch {
        if (alive) setResults([])
      } finally {
        if (alive) setSearching(false)
      }
    })()
    return () => { alive = false }
  }, [search, rows, api])

  async function addIngredient(invItem) {
    if (!service.supabase_id) {
      setErr('Este item del menú aún no se ha sincronizado. Guarda el menú e intenta otra vez.')
      return
    }
    setSaving(true); setErr('')
    try {
      await api.recipeItems.add({
        service_supabase_id:        service.supabase_id,
        inventory_item_supabase_id: invItem.supabase_id,
        qty_per_unit:               1,
      })
      setSearch(''); setResults([])
      await load()
    } catch (e) {
      setErr(e?.message || 'Error agregando ingrediente.')
    } finally {
      setSaving(false)
    }
  }

  async function changeQty(row, qty) {
    const next = Math.max(0, Number(qty) || 0)
    setRows(rows.map(r => r.id === row.id ? { ...r, qty_per_unit: next } : r))
    try { await api.recipeItems.update(row.id, next) }
    catch (e) { setErr(e?.message || 'Error actualizando cantidad.'); load() }
  }

  async function removeRow(row) {
    if (!confirm(`¿Eliminar "${row.inventory_item_name}" de la receta?`)) return
    try {
      await api.recipeItems.remove(row.id)
      load()
    } catch (e) {
      setErr(e?.message || 'Error eliminando.')
    }
  }

  return (
    <ModalShell title={`Receta — ${service.name}`} onClose={onClose} width="max-w-2xl">
      <div className="space-y-4">
        <p className="text-xs text-white/50">
          Ingredientes que se descuentan del inventario cada vez que se vende este plato.
          La cantidad es <strong>por unidad vendida</strong>.
        </p>

        {err && <div className="p-3 rounded-lg bg-[#b3001e]/10 border border-[#b3001e]/30 text-red-300 text-xs">{err}</div>}

        {/* Add ingredient */}
        <div className="rounded-lg border border-zinc-800 bg-black/40 p-3">
          <label className="block text-xs font-semibold text-white/70 mb-2">Agregar ingrediente</label>
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 focus-within:border-[#b3001e]">
            <Search size={14} className="shrink-0 text-white/40" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar producto del inventario…"
              className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none"
            />
          </div>
          {searching && <div className="mt-2 text-xs text-white/40">Buscando…</div>}
          {results.length > 0 && (
            <div className="mt-2 border border-zinc-800 rounded-lg overflow-hidden divide-y divide-zinc-800 bg-zinc-900">
              {results.map(inv => (
                <button
                  key={inv.id}
                  type="button"
                  onClick={() => addIngredient(inv)}
                  disabled={saving}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-white/5 disabled:opacity-50"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Package size={14} className="text-white/40 flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="text-white truncate">{inv.name}</div>
                      <div className="text-xs text-white/40">
                        {inv.sku ? `SKU: ${inv.sku} · ` : ''}{inv.unit || 'und'} · stock {inv.quantity ?? 0}
                      </div>
                    </div>
                  </div>
                  <Plus size={14} className="text-[#b3001e]" />
                </button>
              ))}
            </div>
          )}
          {search.trim() && !searching && results.length === 0 && (
            <div className="mt-2 text-xs text-white/40">Sin coincidencias.</div>
          )}
        </div>

        {/* Recipe rows */}
        <div className="rounded-lg border border-zinc-800 bg-black/40 overflow-hidden">
          {loading ? (
            <div className="p-6 flex justify-center"><Loader2 size={18} className="animate-spin text-white/40" /></div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-center text-white/40 text-sm">
              Sin ingredientes. Agrega productos del inventario arriba para
              descontarlos automáticamente al vender este plato.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-black/40 text-white/50 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left  px-3 py-2 font-semibold">Ingrediente</th>
                  <th className="text-right px-3 py-2 font-semibold w-32">Cantidad / unidad</th>
                  <th className="text-left  px-3 py-2 font-semibold w-20">Unidad</th>
                  <th className="text-right px-3 py-2 font-semibold w-12"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-t border-zinc-800">
                    <td className="px-3 py-2">
                      <div className="font-medium text-white">{r.inventory_item_name || '—'}</div>
                      {r.inventory_item_sku && <div className="text-xs text-white/40">SKU: {r.inventory_item_sku}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        value={r.qty_per_unit}
                        onChange={e => changeQty(r, e.target.value)}
                        className="w-full px-2 py-1.5 text-right rounded bg-zinc-900 border border-zinc-800 text-white text-sm focus:outline-none focus:border-[#b3001e]"
                      />
                    </td>
                    <td className="px-3 py-2 text-white/60 text-xs">{r.inventory_item_unit || 'und'}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => removeRow(r)}
                        className="p-1.5 rounded hover:bg-[#b3001e]/10 text-white/60 hover:text-red-400"
                        title="Eliminar"
                      ><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-sm"
          >
            Cerrar
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

function ItemModal({ editing, categorias, onClose, onSave }) {
  const api = useAPI()
  const [form, setForm] = useState({
    name:          editing?.name          || '',
    name_en:       editing?.name_en       || '',
    categoria_id:  editing?.categoria_id  || '',
    price:         editing?.price         ?? 0,
    cost:          editing?.cost          ?? 0,
    aplica_itbis:  editing ? !!editing.aplica_itbis : true,
    is_menu_item:  editing ? !!editing.is_menu_item : true,
    course:        editing?.course        || '',
    printer_route: editing?.printer_route || 'kitchen',
    station:       editing?.station       || '',
    happy_hour_price: editing?.happy_hour_price ?? '',
    happy_hour_start: editing?.happy_hour_start || '',
    happy_hour_end:   editing?.happy_hour_end   || '',
    active:        editing ? (editing.active === 1 || editing.active === true) : true,
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSave() {
    if (!form.name.trim()) { setErr('El nombre es requerido.'); return }
    if (form.price === '' || isNaN(Number(form.price))) { setErr('Precio inválido.'); return }
    setSaving(true)
    try {
      const payload = {
        name:          form.name.trim(),
        name_en:       form.name_en.trim() || null,
        categoria_id:  form.categoria_id || null,
        price:         parseFloat(form.price) || 0,
        cost:          form.cost === '' ? null : (parseFloat(form.cost) || 0),
        aplica_itbis:  form.aplica_itbis ? 1 : 0,
        is_menu_item:  form.is_menu_item ? 1 : 0,
        course:        form.course || null,
        printer_route: form.printer_route || 'receipt',
        station:       form.station.trim() || null,
        happy_hour_price: form.happy_hour_price === '' ? null : (parseFloat(form.happy_hour_price) || 0),
        happy_hour_start: form.happy_hour_start || null,
        happy_hour_end:   form.happy_hour_end   || null,
        active:        form.active ? 1 : 0,
      }
      if (editing?.id) await api.services.update(editing.id, payload)
      else             await api.services.create(payload)
      onSave()
    } catch (e) {
      setErr(e?.message || 'Error al guardar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell title={editing ? 'Editar item' : 'Nuevo item'} onClose={onClose} width="max-w-2xl">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre *">
            <input autoFocus value={form.name}
              onChange={e => { set('name', e.target.value); setErr('') }}
              placeholder="Ej: Hamburguesa Clásica"
              className={inputCls} />
          </Field>
          <Field label="Nombre (Inglés)">
            <input value={form.name_en}
              onChange={e => set('name_en', e.target.value)}
              placeholder="Classic Burger"
              className={inputCls} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Categoría">
            <select value={form.categoria_id}
              onChange={e => set('categoria_id', e.target.value)}
              className={inputCls}>
              <option value="">— sin categoría —</option>
              {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </Field>
          <Field label="Course">
            <select value={form.course}
              onChange={e => set('course', e.target.value)}
              className={inputCls}>
              {COURSES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Precio *">
            <input type="number" min="0" step="0.01" value={form.price}
              onChange={e => { set('price', e.target.value); setErr('') }}
              className={inputCls} />
          </Field>
          <Field label="Costo (opcional)">
            <input type="number" min="0" step="0.01" value={form.cost}
              onChange={e => set('cost', e.target.value)}
              className={inputCls} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Ruta de impresión">
            <select value={form.printer_route}
              onChange={e => set('printer_route', e.target.value)}
              className={inputCls}>
              {PRINTER_ROUTES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </Field>
          <Field label="Estación (opcional)">
            <input value={form.station}
              onChange={e => set('station', e.target.value)}
              placeholder="Ej: Parrilla, Fríos…"
              className={inputCls} />
          </Field>
        </div>

        {/* Happy Hour — optional time-bounded discount. Leave price blank to disable. */}
        <div className="bg-black/40 border border-white/10 rounded-xl p-3">
          <div className="text-xs font-semibold text-white/70 uppercase tracking-wide mb-2">Happy Hour (opcional)</div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Precio HH (RD$)">
              <input type="number" min="0" step="0.01" value={form.happy_hour_price}
                onChange={e => set('happy_hour_price', e.target.value)}
                placeholder="—"
                className={inputCls} />
            </Field>
            <Field label="Inicio (HH:MM)">
              <input type="time" value={form.happy_hour_start}
                onChange={e => set('happy_hour_start', e.target.value)}
                className={inputCls} />
            </Field>
            <Field label="Fin (HH:MM)">
              <input type="time" value={form.happy_hour_end}
                onChange={e => set('happy_hour_end', e.target.value)}
                className={inputCls} />
            </Field>
          </div>
          <p className="text-[11px] text-white/40 mt-1.5">
            Ventana horaria que cruza medianoche es válida (ej: 22:00 → 02:00). Deja el precio en blanco para desactivar.
          </p>
        </div>

        <div className="flex items-center gap-5 pt-1 flex-wrap">
          <Toggle label="Aplica ITBIS" value={form.aplica_itbis} onChange={v => set('aplica_itbis', v)} />
          <Toggle label="Es item del menú" value={form.is_menu_item} onChange={v => set('is_menu_item', v)} />
          <Toggle label="Activo" value={form.active} onChange={v => set('active', v)} />
        </div>

        {err && <p className="text-xs text-red-400 flex items-center gap-1"><AlertTriangle size={12} />{err}</p>}
      </div>
      <ModalFooter onClose={onClose} onSave={handleSave} saving={saving} editing={!!editing} />
    </ModalShell>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Tab 3 — Modificadores
// ═══════════════════════════════════════════════════════════════════════════════
function ModifiersTab() {
  const api = useAPI()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)     // { editing? }
  const [assignFor, setAssignFor] = useState(null) // modifier row
  const [err, setErr] = useState('')

  async function load() {
    setLoading(true)
    setErr('')
    try {
      const list = api?.modificadores?.listAll
        ? await api.modificadores.listAll()
        : await api.modificadores.list()
      setRows(Array.isArray(list) ? list : [])
    } catch (e) {
      setErr(e?.message || 'Error cargando modificadores.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  async function handleDelete(row) {
    if (!confirm(`¿Eliminar modificador "${row.name}"?`)) return
    try {
      await api.modificadores.delete(row.id)
      load()
    } catch (e) {
      alert(e?.message || 'Error al eliminar.')
    }
  }

  const grouped = useMemo(() => {
    const m = new Map()
    for (const r of rows) {
      const key = r.group_name || '(sin grupo)'
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(r)
    }
    // sort each group by sort_order
    for (const arr of m.values()) {
      arr.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name))
    }
    return Array.from(m.entries())
  }, [rows])

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">Modificadores</h2>
          <p className="text-xs text-white/50">Opciones como punto de cocción, extras, sustituciones.</p>
        </div>
        <button
          onClick={() => setModal({ editing: null })}
          className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold flex items-center gap-2"
        >
          <Plus size={15} /> Nuevo Modificador
        </button>
      </div>

      {err && <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">{err}</div>}

      {loading ? (
        <div className="p-10 flex justify-center"><Loader2 size={22} className="animate-spin text-white/40" /></div>
      ) : rows.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-10 text-center text-white/40 text-sm">
          Sin modificadores. Crea el primero.
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(([groupName, list]) => (
            <div key={groupName}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-white/50 mb-2">{groupName}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {list.map(r => (
                  <div key={r.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-zinc-700 transition">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-white truncate">{r.name}</div>
                        <div className="text-xs text-white/50 mt-0.5">
                          {r.price_delta > 0 && <span className="text-green-400">+{fmtRD(r.price_delta)}</span>}
                          {r.price_delta < 0 && <span className="text-red-400">{fmtRD(r.price_delta)}</span>}
                          {(!r.price_delta || Number(r.price_delta) === 0) && <span>Sin cargo</span>}
                        </div>
                      </div>
                      <div className="flex items-center">
                        <button
                          onClick={() => setModal({ editing: r })}
                          className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white"
                          title="Editar"
                        ><Pencil size={14} /></button>
                        <button
                          onClick={() => handleDelete(r)}
                          className="p-1.5 rounded hover:bg-red-500/10 text-white/60 hover:text-red-400"
                          title="Eliminar"
                        ><Trash2 size={14} /></button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-white/50 mb-3">
                      <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10">
                        min {r.min_select ?? 0} / max {r.max_select ?? 1}
                      </span>
                      {r.default_selected ? <span className="text-green-400">• por defecto</span> : null}
                      {(r.active === 0 || r.active === false) && <span className="text-white/30">• inactivo</span>}
                    </div>
                    <button
                      onClick={() => setAssignFor(r)}
                      className="w-full text-xs py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 flex items-center justify-center gap-1.5"
                    >
                      <Link2 size={13} /> Asignar a items
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <ModifierModal
          editing={modal.editing}
          onClose={() => setModal(null)}
          onSave={() => { setModal(null); load() }}
        />
      )}

      {assignFor && (
        <AssignModifierModal
          modifier={assignFor}
          onClose={() => setAssignFor(null)}
        />
      )}
    </div>
  )
}

function ModifierModal({ editing, onClose, onSave }) {
  const api = useAPI()
  const [form, setForm] = useState({
    name:             editing?.name             || '',
    group_name:       editing?.group_name       || '',
    price_delta:      editing?.price_delta      ?? 0,
    min_select:       editing?.min_select       ?? 0,
    max_select:       editing?.max_select       ?? 1,
    default_selected: editing ? !!editing.default_selected : false,
    sort_order:       editing?.sort_order       ?? 0,
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSave() {
    if (!form.name.trim()) { setErr('El nombre es requerido.'); return }
    setSaving(true)
    try {
      const payload = {
        name:             form.name.trim(),
        group_name:       form.group_name.trim() || null,
        price_delta:      parseFloat(form.price_delta) || 0,
        min_select:       parseInt(form.min_select, 10) || 0,
        max_select:       parseInt(form.max_select, 10) || 1,
        default_selected: form.default_selected ? 1 : 0,
        sort_order:       parseInt(form.sort_order, 10) || 0,
      }
      if (editing?.id) await api.modificadores.update(editing.id, payload)
      else             await api.modificadores.create(payload)
      onSave()
    } catch (e) {
      setErr(e?.message || 'Error al guardar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell title={editing ? 'Editar modificador' : 'Nuevo modificador'} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Nombre *">
          <input autoFocus value={form.name}
            onChange={e => { set('name', e.target.value); setErr('') }}
            placeholder="Ej: Término medio"
            className={inputCls} />
        </Field>
        <Field label="Grupo (opcional)">
          <input value={form.group_name}
            onChange={e => set('group_name', e.target.value)}
            placeholder="Ej: Punto de cocción"
            className={inputCls} />
          <p className="text-[11px] text-white/40 mt-1">Los modificadores del mismo grupo aparecen juntos.</p>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ajuste de precio (± RD$)">
            <input type="number" step="0.01" value={form.price_delta}
              onChange={e => set('price_delta', e.target.value)}
              className={inputCls} />
          </Field>
          <Field label="Orden">
            <input type="number" value={form.sort_order}
              onChange={e => set('sort_order', e.target.value)}
              className={inputCls} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mín. seleccionados">
            <input type="number" min="0" value={form.min_select}
              onChange={e => set('min_select', e.target.value)}
              className={inputCls} />
          </Field>
          <Field label="Máx. seleccionados">
            <input type="number" min="0" value={form.max_select}
              onChange={e => set('max_select', e.target.value)}
              className={inputCls} />
          </Field>
        </div>
        <Toggle label="Seleccionado por defecto" value={form.default_selected} onChange={v => set('default_selected', v)} />

        {err && <p className="text-xs text-red-400 flex items-center gap-1"><AlertTriangle size={12} />{err}</p>}
      </div>
      <ModalFooter onClose={onClose} onSave={handleSave} saving={saving} editing={!!editing} />
    </ModalShell>
  )
}

function AssignModifierModal({ modifier, onClose }) {
  const api = useAPI()
  const [services, setServices] = useState([])
  const [attached, setAttached] = useState(new Set()) // service ids
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null) // service id in flight
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')

  async function load() {
    setLoading(true)
    setErr('')
    try {
      const [svcs, attachedList] = await Promise.all([
        api.services.all(),
        // Walk services and ask per-service — simplest contract; data-layer may
        // wire a reverse listener later.
        (async () => {
          const all = await api.services.all()
          const menu = (all || []).filter(s => s.is_menu_item === 1 || s.is_menu_item === true)
          const out = new Set()
          for (const s of menu) {
            try {
              const mods = await api.modificadores.listForService(s.id)
              if ((mods || []).some(m => String(m.id) === String(modifier.id))) out.add(s.id)
            } catch { /* tolerate */ }
          }
          return out
        })(),
      ])
      setServices((svcs || []).filter(s => s.is_menu_item === 1 || s.is_menu_item === true))
      setAttached(attachedList)
    } catch (e) {
      setErr(e?.message || 'Error cargando items.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [modifier.id])

  async function toggle(svc) {
    setBusy(svc.id)
    try {
      if (attached.has(svc.id)) {
        await api.modificadores.detachFromService(svc.id, modifier.id)
        const next = new Set(attached); next.delete(svc.id); setAttached(next)
      } else {
        await api.modificadores.attachToService(svc.id, modifier.id, false)
        const next = new Set(attached); next.add(svc.id); setAttached(next)
      }
    } catch (e) {
      alert(e?.message || 'Error al actualizar asignación.')
    } finally {
      setBusy(null)
    }
  }

  const filtered = useMemo(() => {
    if (!q.trim()) return services
    const n = q.trim().toLowerCase()
    return services.filter(s => (s.name || '').toLowerCase().includes(n))
  }, [services, q])

  return (
    <ModalShell title={`Asignar "${modifier.name}"`} onClose={onClose} width="max-w-lg">
      <div className="space-y-3">
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-black border border-zinc-800 focus-within:border-red-600">
          <Search size={14} className="shrink-0 text-white/40" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Buscar item…"
            className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none"
          />
        </div>

        {err && <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">{err}</div>}

        <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-zinc-800 divide-y divide-zinc-800">
          {loading ? (
            <div className="p-8 flex justify-center"><Loader2 size={20} className="animate-spin text-white/40" /></div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-white/40 text-sm">Sin items.</div>
          ) : filtered.map(s => {
            const on = attached.has(s.id)
            return (
              <div key={s.id} className="flex items-center justify-between px-3 py-2.5 hover:bg-white/5">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{s.name}</div>
                  <div className="text-xs text-white/40">{s.category || '—'} · {fmtRD(s.price)}</div>
                </div>
                <button
                  onClick={() => toggle(s)}
                  disabled={busy === s.id}
                  className={`px-3 py-1.5 text-xs rounded-lg flex items-center gap-1.5 transition disabled:opacity-50
                    ${on
                      ? 'bg-red-600/10 border border-red-600/40 text-red-300 hover:bg-red-600/20'
                      : 'bg-white/5 border border-white/10 text-white/70 hover:bg-white/10'}`}
                >
                  {busy === s.id ? <Loader2 size={12} className="animate-spin" />
                    : on ? <><Link2Off size={12} /> Quitar</> : <><Link2 size={12} /> Asignar</>}
                </button>
              </div>
            )
          })}
        </div>
      </div>
      <div className="pt-4 flex justify-end">
        <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-white/10 hover:bg-white/15 text-white">
          Cerrar
        </button>
      </div>
    </ModalShell>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Shared bits
// ═══════════════════════════════════════════════════════════════════════════════
const inputCls =
  'w-full bg-black border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-red-600'

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-white/60 uppercase tracking-wide mb-1">{label}</label>
      {children}
    </div>
  )
}

function Toggle({ label, value, onChange }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-white/80 cursor-pointer select-none">
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative w-10 h-5 rounded-full transition ${value ? 'bg-red-600' : 'bg-zinc-700'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition ${value ? 'translate-x-5' : ''}`} />
      </button>
      {label}
    </label>
  )
}

function ModalShell({ title, onClose, width = 'max-w-md', children }) {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className={`bg-zinc-900 border border-zinc-800 rounded-2xl w-full ${width} shadow-2xl max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
          <h3 className="font-bold text-white">{title}</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  )
}

function ModalFooter({ onClose, onSave, saving, editing }) {
  return (
    <div className="px-0 pt-5 mt-2 flex gap-3 border-t border-zinc-800 -mx-6 px-6 pb-0">
      <button
        onClick={onClose}
        className="flex-1 py-2 mt-4 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-white/80"
      >
        Cancelar
      </button>
      <button
        onClick={onSave}
        disabled={saving}
        className="flex-1 py-2 mt-4 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold flex items-center justify-center gap-1.5"
      >
        {saving && <Loader2 size={13} className="animate-spin" />}
        {editing ? 'Guardar cambios' : 'Crear'}
      </button>
    </div>
  )
}
