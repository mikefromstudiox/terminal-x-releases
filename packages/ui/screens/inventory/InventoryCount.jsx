/**
 * InventoryCount.jsx — Conteo Fisico (v2.5)
 *
 * Physical inventory count + variance/theft reporting, built for the
 * Ranoza licoreria go-live. Works identically on web (Supabase) and
 * desktop (Electron IPC) — all data flows through api.inventoryCount.*
 *
 * Flow:
 *   List view → [Nuevo Conteo] → modal (title, cashier, notes) → Detail
 *   Detail (abierto): grouped-by-category entry table, enter commits +
 *     advances, category subtotals, search filter, [Imprimir hoja],
 *     [Terminar] → confirm (apply toggle) → complete
 *   Detail (completado): read-only, variance summary card, top-10 losses,
 *     [Imprimir reporte], [Exportar CSV]
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  ClipboardList, Plus, Printer, FileSpreadsheet, Search, ArrowLeft,
  CheckCircle2, XCircle, Loader2, Trash2, AlertTriangle, Package,
  TrendingDown, TrendingUp, Minus, PenLine,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../i18n'
import { saveCountSheetPDF, saveVarianceReportPDF } from '@terminal-x/services/countSheetPdf'
import { exportInventoryCount } from '@terminal-x/services/csv'
import SignaturePad from '../../components/SignaturePad'

const ALLOWED = ['owner', 'manager', 'cfo', 'accountant']

function fmtRD(n) {
  const v = Number(n || 0)
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (v < 0 ? '-RD$ ' : 'RD$ ') + s
}
function fmtQty(n) {
  if (n === null || n === undefined || n === '') return '—'
  const v = Number(n)
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}
function fmtDate(s) {
  if (!s) return '—'
  return new Date(s.includes('T') ? s : s + 'T12:00:00').toLocaleString('es-DO', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function varianceTone(value) {
  const v = Number(value || 0)
  if (v < 0) return 'text-[#b3001e]'
  if (v > 0) return 'text-black dark:text-white'
  return 'text-black/40 dark:text-white/40'
}

// Helper: lets us key a fragment in a map without emitting an extra DOM node.
// Keeping <tr> elements as direct children of <tbody> is required for valid
// HTML / DevTools table navigation — don't replace this with a <div>.
function CategoryBlock({ children }) { return <>{children}</> }

// ── Start-count modal ────────────────────────────────────────────────────────

function StartModal({ onStart, onClose, empleados, availableCategories }) {
  const [title, setTitle]       = useState(`Conteo ${new Date().toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })}`)
  const [countedBy, setCountedBy] = useState('')
  const [notes, setNotes]       = useState('')
  const [scope, setScope]       = useState('all') // 'all' | 'some'
  const [selectedCats, setSelectedCats] = useState(new Set())
  const [busy, setBusy]         = useState(false)
  const [err, setErr]           = useState('')

  const toggleCat = (c) => {
    setSelectedCats(prev => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c); else next.add(c)
      return next
    })
  }

  async function handleStart() {
    setErr(''); setBusy(true)
    try {
      const cats = scope === 'some' ? [...selectedCats] : null
      if (scope === 'some' && cats.length === 0) {
        setErr('Seleccione al menos una categoría')
        setBusy(false)
        return
      }
      // Auto-title when scoped to categories (so the list view is self-explanatory)
      let effectiveTitle = title.trim()
      if (scope === 'some' && cats.length && cats.length <= 3) {
        effectiveTitle = `${effectiveTitle} — ${cats.join(', ')}`
      }
      await onStart({
        title: effectiveTitle || null,
        counted_by_name: countedBy.trim() || null,
        notes: notes.trim() || null,
        categories: cats,
      })
    } catch (e) {
      setErr(e?.message || 'Error al iniciar el conteo')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-black border border-black/10 dark:border-white/10 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/10 dark:border-white/10">
          <h2 className="text-lg font-bold text-black dark:text-white">Nuevo Conteo Fisico</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5" aria-label="Cerrar">
            <XCircle size={20} className="text-black/60 dark:text-white/60" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60 mb-1">Titulo</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-white/5 text-black dark:text-white focus:outline-none focus:border-[#b3001e]" />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60 mb-1">Contado por</label>
            {empleados?.length ? (
              <select value={countedBy} onChange={e => setCountedBy(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-white/5 text-black dark:text-white focus:outline-none focus:border-[#b3001e]">
                <option value="">— Seleccionar empleado —</option>
                {empleados.map(e => (
                  <option key={e.id || e.nombre} value={e.nombre}>{e.nombre}</option>
                ))}
              </select>
            ) : (
              <input type="text" value={countedBy} onChange={e => setCountedBy(e.target.value)}
                placeholder="Nombre del empleado"
                className="w-full px-3 py-2 rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-white/5 text-black dark:text-white focus:outline-none focus:border-[#b3001e]" />
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60 mb-1">Alcance</label>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <button type="button" onClick={() => setScope('all')}
                className={`py-2 rounded-lg text-sm font-semibold border transition ${
                  scope === 'all'
                    ? 'bg-[#b3001e] border-[#b3001e] text-white'
                    : 'bg-white dark:bg-white/5 border-black/15 dark:border-white/15 text-black dark:text-white hover:border-[#b3001e]'
                }`}>
                Todas las categorías
              </button>
              <button type="button" onClick={() => setScope('some')}
                className={`py-2 rounded-lg text-sm font-semibold border transition ${
                  scope === 'some'
                    ? 'bg-[#b3001e] border-[#b3001e] text-white'
                    : 'bg-white dark:bg-white/5 border-black/15 dark:border-white/15 text-black dark:text-white hover:border-[#b3001e]'
                }`}>
                Categorías específicas
              </button>
            </div>
            {scope === 'some' && (
              <div className="rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-white/5 p-2 max-h-56 overflow-y-auto">
                {(!availableCategories || availableCategories.length === 0) ? (
                  <div className="text-xs text-black/50 dark:text-white/50 p-2">Cargando categorías…</div>
                ) : (
                  <div className="grid grid-cols-2 gap-1">
                    {availableCategories.map(c => {
                      const active = selectedCats.has(c.name)
                      return (
                        <button key={c.name} type="button" onClick={() => toggleCat(c.name)}
                          className={`text-left text-xs px-2.5 py-1.5 rounded flex items-center justify-between gap-2 border ${
                            active
                              ? 'bg-[#b3001e]/10 border-[#b3001e] text-[#b3001e] dark:text-[#ff6b7e]'
                              : 'border-transparent hover:border-black/15 dark:hover:border-white/15 text-black/80 dark:text-white/80'
                          }`}>
                          <span className="truncate">{c.name}</span>
                          <span className="text-[10px] opacity-60 shrink-0">{c.count}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
                <div className="mt-2 pt-2 border-t border-black/10 dark:border-white/10 flex items-center justify-between text-[11px] text-black/60 dark:text-white/60">
                  <span>{selectedCats.size} seleccionada(s) · {availableCategories.filter(c => selectedCats.has(c.name)).reduce((s, c) => s + c.count, 0)} productos</span>
                  <button type="button" onClick={() => setSelectedCats(new Set())}
                    className="text-[#b3001e] hover:underline disabled:opacity-40" disabled={selectedCats.size === 0}>
                    Limpiar
                  </button>
                </div>
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60 mb-1">Notas (opcional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              className="w-full px-3 py-2 rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-white/5 text-black dark:text-white focus:outline-none focus:border-[#b3001e] resize-none" />
          </div>
          {err && <div className="text-sm text-[#b3001e]">{err}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-black/10 dark:border-white/10">
          <button onClick={onClose} disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-black/70 dark:text-white/70 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={handleStart} disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-bold bg-[#b3001e] text-white hover:bg-[#95001a] disabled:opacity-60 inline-flex items-center gap-2">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            Iniciar conteo
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Confirm-complete modal ──────────────────────────────────────────────────

function CompleteConfirm({ count, onConfirm, onClose }) {
  const [apply, setApply] = useState(true)
  const [signature, setSignature] = useState(null)
  const [busy, setBusy]   = useState(false)
  const counted = count?.items?.filter(i => i.counted_qty !== null && i.counted_qty !== undefined && i.counted_qty !== '').length || 0
  const total   = count?.items?.length || 0
  const skipped = total - counted

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-black border border-black/10 dark:border-white/10 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/10 dark:border-white/10">
          <h2 className="text-lg font-bold text-black dark:text-white">Finalizar Conteo</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5" aria-label="Cerrar">
            <XCircle size={20} className="text-black/60 dark:text-white/60" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="text-sm text-black/80 dark:text-white/80">
            <div className="flex justify-between"><span>Productos contados:</span><b className="text-black dark:text-white">{counted} / {total}</b></div>
            {skipped > 0 && (
              <div className="mt-2 text-xs text-[#b3001e] inline-flex items-center gap-1.5">
                <AlertTriangle size={14} />
                {skipped} producto{skipped === 1 ? '' : 's'} sin contar — se dejaran con la cantidad esperada.
              </div>
            )}
          </div>
          <label className="flex items-start gap-3 text-sm cursor-pointer select-none">
            <input type="checkbox" checked={apply} onChange={e => setApply(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-[#b3001e]" />
            <span className="text-black/80 dark:text-white/80">
              <b className="text-black dark:text-white">Actualizar inventario con conteo real</b>
              <br /><span className="text-xs text-black/60 dark:text-white/60">
                Marque esta opcion para aplicar las cantidades contadas como el nuevo stock.
                Si lo deja sin marcar, solo se guarda el reporte — el inventario no cambia.
              </span>
            </span>
          </label>
          <SignaturePad onChange={setSignature} />
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-black/10 dark:border-white/10">
          <button onClick={onClose} disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-black/70 dark:text-white/70 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50">
            Cancelar
          </button>
          <button
            onClick={async () => { setBusy(true); try { await onConfirm({ apply_to_inventory: apply, signature_dataurl: signature }) } finally { setBusy(false) } }}
            disabled={busy || !signature}
            title={!signature ? 'Firme para finalizar' : ''}
            className="px-4 py-2 rounded-lg text-sm font-bold bg-[#b3001e] text-white hover:bg-[#95001a] disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            Finalizar conteo
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Detail view ─────────────────────────────────────────────────────────────

function DetailView({ count, onBack, onReload, biz }) {
  const api = useAPI()
  const [q, setQ]         = useState('')
  const [catFilter, setCatFilter] = useState('')  // '' = todas
  const [saving, setSaving] = useState(null) // supabase_id of row being saved
  const [confirm, setConfirm] = useState(false)
  const [error, setError]   = useState('')
  const inputRefs = useRef({})
  const isOpen = count.status === 'abierto'

  // Unique categories (sorted) for the dropdown filter. Uses the same
  // "Sin categoria" fallback as the grouping logic so users recognize the
  // bucket by name when the item has null/empty category.
  const categories = useMemo(() => {
    const set = new Set()
    for (const it of count.items || []) {
      const k = (it.category && String(it.category).trim()) || 'Sin categoria'
      set.add(k)
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'es'))
  }, [count.items])

  // Row order needs to be stable so "Enter → next row" advances predictably.
  const orderedItems = useMemo(() => {
    const groups = new Map()
    for (const it of count.items || []) {
      const k = (it.category && String(it.category).trim()) || 'Sin categoria'
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k).push(it)
    }
    const ordered = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'))
    const flat = []
    for (const [cat, arr] of ordered) {
      arr.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'))
      for (const it of arr) flat.push({ category: cat, item: it })
    }
    return { ordered, flat }
  }, [count.items])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const filtGroups = new Map()
    for (const [cat, arr] of orderedItems.ordered) {
      if (catFilter && cat !== catFilter) continue
      const hits = !needle ? arr : arr.filter(i =>
        (i.name || '').toLowerCase().includes(needle) ||
        (i.sku || '').toLowerCase().includes(needle) ||
        (cat || '').toLowerCase().includes(needle))
      if (hits.length) filtGroups.set(cat, hits)
    }
    const ordered = [...filtGroups.entries()]
    const flat = []
    for (const [cat, arr] of ordered) for (const it of arr) flat.push({ category: cat, item: it })
    return { ordered, flat }
  }, [q, catFilter, orderedItems])

  const progress = useMemo(() => {
    const items = count.items || []
    const counted = items.filter(i => i.counted_qty !== null && i.counted_qty !== undefined && i.counted_qty !== '').length
    return { counted, total: items.length }
  }, [count.items])

  // v2.14 — Variance math subtracts sales-during-count from expected so the
  // shrinkage number reflects TRUE loss, not sales that happened while the
  // cashier was walking the aisles with the paper sheet.
  const totals = useMemo(() => {
    const items = count.items || []
    return items.reduce((acc, it) => {
      const exp = Number(it.expected_qty) || 0
      const sold = Number(it.sold_during_count) || 0
      const adj = exp - sold
      const cnt = (it.counted_qty === null || it.counted_qty === undefined || it.counted_qty === '') ? adj : Number(it.counted_qty)
      const cost  = Number(it.unit_cost)  || 0
      const price = Number(it.unit_price) || 0
      acc.expCost  += exp * cost
      acc.cntCost  += cnt * cost
      acc.varCost  += (cnt - adj) * cost
      acc.varPrice += (cnt - adj) * price
      acc.soldQty  += sold
      return acc
    }, { expCost: 0, cntCost: 0, varCost: 0, varPrice: 0, soldQty: 0 })
  }, [count.items])

  // Top 10 biggest cost losses for the summary card on completed counts.
  const topLosses = useMemo(() => {
    if (count.status !== 'completado') return []
    return (count.items || [])
      .map(it => {
        const exp = Number(it.expected_qty) || 0
        const sold = Number(it.sold_during_count) || 0
        const adj = exp - sold
        const cnt = (it.counted_qty === null || it.counted_qty === undefined) ? adj : Number(it.counted_qty)
        const dq  = cnt - adj
        return { ...it, _adjExp: adj, _varQty: dq, _varCost: dq * (Number(it.unit_cost) || 0) }
      })
      .filter(r => r._varCost < 0)
      .sort((a, b) => a._varCost - b._varCost)
      .slice(0, 10)
  }, [count.items, count.status])

  const saveItem = useCallback(async (item, newVal) => {
    setError('')
    setSaving(item.supabase_id)
    try {
      const qty = newVal === '' ? null : Number(newVal)
      await api.inventoryCount.saveItem({
        count_supabase_id: count.supabase_id,
        inventory_item_supabase_id: item.inventory_item_supabase_id,
        counted_qty: qty,
      })
      await onReload()
    } catch (e) {
      setError(e?.message || 'Error al guardar')
    } finally {
      setSaving(null)
    }
  }, [api, count.supabase_id, onReload])

  function handleKeyDown(e, idx) {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault()
      const next = filtered.flat[idx + 1]
      if (next) {
        const ref = inputRefs.current[next.item.supabase_id]
        if (ref) ref.focus()
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = filtered.flat[idx - 1]
      if (prev) {
        const ref = inputRefs.current[prev.item.supabase_id]
        if (ref) ref.focus()
      }
    }
  }

  async function complete({ apply_to_inventory, signature_dataurl }) {
    setError('')
    try {
      await api.inventoryCount.complete({ id: count.id, apply_to_inventory, signature_dataurl })
      setConfirm(false)
      await onReload()
    } catch (e) {
      setError(e?.message || 'Error al finalizar el conteo')
      setConfirm(false)
    }
  }


  async function cancelCount() {
    if (!confirm && !window.confirm('Cancelar este conteo? Los datos ingresados se mantendran visibles pero el conteo no modificara el inventario.')) return
    try {
      await api.inventoryCount.cancel(count.id)
      await onReload()
    } catch (e) { setError(e?.message || 'Error al cancelar') }
  }

  async function deleteCount() {
    if (!window.confirm('Eliminar este conteo permanentemente? Esta accion no se puede deshacer.')) return
    try {
      await api.inventoryCount.delete(count.id)
      onBack(true) // request list refresh
    } catch (e) { setError(e?.message || 'Error al eliminar') }
  }

  // v2.14 — If a category filter is active, exports scope to that subset only
  // (Ranoza use case: "count just the wines, export just the wines"). Title
  // is annotated so the PDF / CSV make the scope obvious in the header.
  const scopedCount = useMemo(() => {
    if (!catFilter) return count
    const items = (count.items || []).filter(it => {
      const k = (it.category && String(it.category).trim()) || 'Sin categoria'
      return k === catFilter
    })
    return { ...count, items, title: `${count.title || 'Conteo'} — ${catFilter}` }
  }, [count, catFilter])

  async function printSheet() {
    setError('')
    const res = await saveCountSheetPDF({ count: scopedCount, biz }, api)
    if (!res?.ok) setError(res?.error || 'Error al generar PDF')
  }
  async function printReport() {
    setError('')
    const res = await saveVarianceReportPDF({ count: scopedCount, biz }, api)
    if (!res?.ok) setError(res?.error || 'Error al generar PDF')
  }
  function exportCsv() {
    exportInventoryCount(biz, scopedCount)
  }

  const statusBadge = {
    abierto:    { label: 'Abierto',    cls: 'bg-[#b3001e] text-white' },
    completado: { label: 'Completado', cls: 'bg-black text-white dark:bg-white dark:text-black' },
    cancelado:  { label: 'Cancelado',  cls: 'bg-black/10 text-black dark:bg-white/10 dark:text-white' },
  }[count.status] || { label: count.status, cls: 'bg-black/10 text-black' }

  let flatIndex = 0 // for keyboard nav linearization

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <button onClick={() => onBack(false)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-black/60 dark:text-white/60 hover:text-[#b3001e] mb-2">
            <ArrowLeft size={14} /> Volver a conteos
          </button>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-black text-black dark:text-white">{count.title}</h1>
            <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${statusBadge.cls}`}>
              {statusBadge.label}
            </span>
          </div>
          <div className="text-xs text-black/60 dark:text-white/60 mt-1">
            Iniciado: {fmtDate(count.started_at)}
            {count.completed_at && <> · Completado: {fmtDate(count.completed_at)}</>}
            {count.counted_by_name && <> · Contado por: <b className="text-black dark:text-white">{count.counted_by_name}</b></>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={printSheet}
            title="Imprime una lista con todos los productos y un espacio en blanco para anotar la cantidad contada a mano"
            className="px-3 py-2 rounded-lg text-sm font-semibold border border-black/15 dark:border-white/15 text-black dark:text-white hover:border-[#b3001e] inline-flex items-center gap-1.5">
            <Printer size={14} /> Imprimir lista para contar
          </button>
          {count.status === 'completado' && (
            <>
              <button onClick={printReport}
                className="px-3 py-2 rounded-lg text-sm font-semibold bg-[#b3001e] text-white hover:bg-[#95001a] inline-flex items-center gap-1.5">
                <Printer size={14} /> Reporte varianza
              </button>
              <button onClick={exportCsv}
                className="px-3 py-2 rounded-lg text-sm font-semibold border border-black/15 dark:border-white/15 text-black dark:text-white hover:border-[#b3001e] inline-flex items-center gap-1.5">
                <FileSpreadsheet size={14} /> CSV
              </button>
            </>
          )}
          {isOpen && (
            <>
              <button onClick={() => setConfirm(true)}
                className="px-3 py-2 rounded-lg text-sm font-bold bg-black text-white dark:bg-white dark:text-black hover:opacity-90 inline-flex items-center gap-1.5">
                <CheckCircle2 size={14} /> Terminar
              </button>
              <button onClick={cancelCount}
                className="px-3 py-2 rounded-lg text-sm font-semibold text-black/60 dark:text-white/60 hover:text-[#b3001e]">
                Cancelar
              </button>
            </>
          )}
          {count.status !== 'abierto' && (
            <button onClick={deleteCount}
              className="p-2 rounded-lg text-black/60 dark:text-white/60 hover:text-[#b3001e] hover:bg-black/5 dark:hover:bg-white/5" title="Eliminar conteo">
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Progreso</div>
          <div className="text-2xl font-black text-black dark:text-white mt-1">{progress.counted} / {progress.total}</div>
          <div className="text-xs text-black/50 dark:text-white/50 mt-0.5">productos contados</div>
        </div>
        <div className="rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Valor esperado</div>
          <div className="text-2xl font-black text-black dark:text-white mt-1">{fmtRD(totals.expCost)}</div>
          <div className="text-xs text-black/50 dark:text-white/50 mt-0.5">al costo</div>
        </div>
        <div className="rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Valor contado</div>
          <div className="text-2xl font-black text-black dark:text-white mt-1">{fmtRD(totals.cntCost)}</div>
          <div className="text-xs text-black/50 dark:text-white/50 mt-0.5">al costo</div>
        </div>
        <div className="rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Varianza</div>
          <div className={`text-2xl font-black mt-1 ${varianceTone(totals.varCost)}`}>{fmtRD(totals.varCost)}</div>
          <div className={`text-xs mt-0.5 ${varianceTone(totals.varPrice)}`}>al precio: {fmtRD(totals.varPrice)}</div>
        </div>
      </div>

      {count.status === 'completado' && topLosses.length > 0 && (
        <div className="rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 overflow-hidden">
          <div className="px-4 py-2 bg-[#b3001e] text-white text-xs font-bold uppercase tracking-wide inline-flex items-center gap-1.5">
            <TrendingDown size={14} /> Top 10 perdidas (costo)
          </div>
          <div className="divide-y divide-black/5 dark:divide-white/5">
            {topLosses.map((r, i) => (
              <div key={r.supabase_id || i} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="w-6 text-right font-bold text-black/40 dark:text-white/40">{i + 1}</span>
                <span className="flex-1 text-black dark:text-white truncate">{r.name}</span>
                <span className="text-xs font-mono text-black/60 dark:text-white/60 w-20 text-right">{r.sku || '—'}</span>
                <span className="text-xs text-black/60 dark:text-white/60 w-24 text-right">{fmtQty(r.expected_qty)} → {fmtQty(r.counted_qty)}</span>
                <span className="font-bold text-[#b3001e] w-28 text-right">{fmtRD(r._varCost)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <div className="rounded-lg bg-[#b3001e]/10 border border-[#b3001e]/30 text-[#b3001e] text-sm px-3 py-2">{error}</div>}

      {/* Toolbar — search + category filter + scan mode */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/40 dark:text-white/40 pointer-events-none z-10" />
          <input value={q} onChange={e => setQ(e.target.value)}
            type="text" name="conteo-search" autoComplete="off"
            data-lpignore="true" data-1p-ignore="true" data-form-type="other"
            placeholder="Buscar por nombre, SKU o categoria…"
            className="w-full pl-10 pr-3 py-2 rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-white/5 text-sm text-black dark:text-white focus:outline-none focus:border-[#b3001e]" />
        </div>
        {categories.length > 1 && (
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-white/5 text-sm text-black dark:text-white focus:outline-none focus:border-[#b3001e]">
            <option value="">Todas las categorias</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {/* Signature display — shown on completed counts that were signed. */}
      {count.status === 'completado' && count.signature_dataurl && (
        <div className="rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 p-4 flex items-start gap-4">
          <PenLine size={16} className="text-[#b3001e] shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60 mb-2">
              Firma de {count.counted_by_name || 'responsable'}
            </div>
            <img src={count.signature_dataurl} alt="Firma"
              className="max-h-32 bg-white rounded border border-black/10" />
          </div>
        </div>
      )}

      {/* Table grouped by category */}
      <div className="rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#b3001e] text-white">
            <tr>
              <th className="text-left  px-3 py-2 font-bold text-xs uppercase tracking-wide w-24">SKU</th>
              <th className="text-left  px-3 py-2 font-bold text-xs uppercase tracking-wide">Producto</th>
              <th className="text-right px-3 py-2 font-bold text-xs uppercase tracking-wide w-24">Esperado</th>
              <th className="text-right px-3 py-2 font-bold text-xs uppercase tracking-wide w-28">Contado</th>
              <th className="text-right px-3 py-2 font-bold text-xs uppercase tracking-wide w-24">Dif.</th>
              <th className="text-right px-3 py-2 font-bold text-xs uppercase tracking-wide w-28">Varianza</th>
            </tr>
          </thead>
          <tbody>
            {filtered.ordered.length === 0 && (
              <tr><td colSpan={6} className="text-center py-10 text-black/60 dark:text-white/60">Sin productos que coincidan.</td></tr>
            )}
            {filtered.ordered.map(([cat, arr]) => {
              const sub = arr.reduce((acc, it) => {
                const exp = Number(it.expected_qty) || 0
                const sold = Number(it.sold_during_count) || 0
                const adj = exp - sold
                const cnt = (it.counted_qty === null || it.counted_qty === undefined || it.counted_qty === '') ? adj : Number(it.counted_qty)
                const cost = Number(it.unit_cost) || 0
                acc.exp += exp * cost; acc.cnt += cnt * cost; acc.var += (cnt - adj) * cost
                return acc
              }, { exp: 0, cnt: 0, var: 0 })
              return (
                <CategoryBlock key={`cat-${cat}`}>
                  <tr className="bg-black text-white">
                    <td colSpan={2} className="px-3 py-1.5 text-xs font-bold uppercase tracking-wide">{cat}</td>
                    <td className="px-3 py-1.5 text-xs text-right">{fmtRD(sub.exp)}</td>
                    <td className="px-3 py-1.5 text-xs text-right">{fmtRD(sub.cnt)}</td>
                    <td className="px-3 py-1.5 text-xs text-right" />
                    <td className={`px-3 py-1.5 text-xs text-right font-bold ${sub.var < 0 ? 'text-white' : ''}`}>{fmtRD(sub.var)}</td>
                  </tr>
                  {arr.map(it => {
                    const myIdx = flatIndex++
                    const exp = Number(it.expected_qty) || 0
                    const sold = Number(it.sold_during_count) || 0
                    const adj = exp - sold
                    const countedVal = (it.counted_qty === null || it.counted_qty === undefined) ? '' : String(it.counted_qty)
                    const cnt = countedVal === '' ? null : Number(countedVal)
                    const dq = cnt === null ? null : (cnt - adj)
                    const varCost = cnt === null ? null : dq * (Number(it.unit_cost) || 0)
                    return (
                      <tr key={it.supabase_id} className="border-t border-black/5 dark:border-white/5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                        <td className="px-3 py-2 text-xs font-mono text-black/60 dark:text-white/60">{it.sku || '—'}</td>
                        <td className="px-3 py-2 text-black dark:text-white">{it.name}</td>
                        <td className="px-3 py-2 text-right text-black/80 dark:text-white/80">
                          {fmtQty(adj)}
                          {sold > 0 && (
                            <div className="text-[10px] text-black/40 dark:text-white/40 font-normal">
                              {fmtQty(exp)} − {fmtQty(sold)} vend.
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {isOpen ? (
                            <input
                              ref={el => { inputRefs.current[it.supabase_id] = el }}
                              type="number" step="any" min="0"
                              defaultValue={countedVal}
                              onBlur={e => {
                                const v = e.target.value
                                if (v !== countedVal) saveItem(it, v)
                              }}
                              onKeyDown={e => handleKeyDown(e, myIdx)}
                              className="w-24 px-2 py-1 text-right rounded border border-black/15 dark:border-white/15 bg-white dark:bg-black text-black dark:text-white focus:outline-none focus:border-[#b3001e]"
                            />
                          ) : (
                            <span className="text-black dark:text-white font-semibold">{fmtQty(it.counted_qty)}</span>
                          )}
                          {saving === it.supabase_id && <Loader2 size={12} className="inline-block ml-1 animate-spin text-black/40 dark:text-white/40" />}
                        </td>
                        <td className={`px-3 py-2 text-right font-semibold ${dq == null ? 'text-black/30 dark:text-white/30' : varianceTone(dq)}`}>
                          {dq == null ? '—' : (dq > 0 ? '+' : '') + fmtQty(dq)}
                        </td>
                        <td className={`px-3 py-2 text-right font-bold ${varCost == null ? 'text-black/30 dark:text-white/30' : varianceTone(varCost)}`}>
                          {varCost == null ? '—' : fmtRD(varCost)}
                        </td>
                      </tr>
                    )
                  })}
                </CategoryBlock>
              )
            })}
          </tbody>
        </table>
      </div>

      {confirm && <CompleteConfirm count={count} onConfirm={complete} onClose={() => setConfirm(false)} />}
    </div>
  )
}

// ── List view ───────────────────────────────────────────────────────────────

function ListView({ rows, onNew, onOpen }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-black dark:text-white inline-flex items-center gap-2">
            <ClipboardList size={22} className="text-[#b3001e]" /> Conteo Fisico
          </h1>
          <p className="text-sm text-black/60 dark:text-white/60 mt-1">
            Audita el inventario producto por producto. Imprime la lista, cuenta cada artículo a mano, luego ingresa la cantidad real para detectar mermas.
          </p>
        </div>
        <button onClick={onNew}
          className="px-4 py-2 rounded-lg text-sm font-bold bg-[#b3001e] text-white hover:bg-[#95001a] inline-flex items-center gap-2">
          <Plus size={16} /> Nuevo conteo
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 p-12 text-center">
          <Package size={40} className="mx-auto text-black/20 dark:text-white/20" />
          <div className="mt-4 text-black dark:text-white font-bold">No hay conteos fisicos aun.</div>
          <div className="text-sm text-black/60 dark:text-white/60 mt-1">Inicie el primer conteo para auditar el inventario.</div>
        </div>
      ) : (
        <div className="rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-black text-white">
              <tr>
                <th className="text-left  px-4 py-2 font-bold text-xs uppercase tracking-wide">Fecha</th>
                <th className="text-left  px-4 py-2 font-bold text-xs uppercase tracking-wide">Titulo</th>
                <th className="text-left  px-4 py-2 font-bold text-xs uppercase tracking-wide">Contado por</th>
                <th className="text-left  px-4 py-2 font-bold text-xs uppercase tracking-wide">Estado</th>
                <th className="text-right px-4 py-2 font-bold text-xs uppercase tracking-wide">Progreso</th>
                <th className="text-right px-4 py-2 font-bold text-xs uppercase tracking-wide">Varianza</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const badge = {
                  abierto:    { label: 'Abierto',    cls: 'bg-[#b3001e] text-white' },
                  completado: { label: 'Completado', cls: 'bg-black text-white dark:bg-white dark:text-black' },
                  cancelado:  { label: 'Cancelado',  cls: 'bg-black/10 text-black dark:bg-white/10 dark:text-white' },
                }[r.status] || { label: r.status, cls: 'bg-black/10 text-black' }
                return (
                  <tr key={r.id} onClick={() => onOpen(r)}
                    className="border-t border-black/5 dark:border-white/5 cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                    <td className="px-4 py-3 text-black/80 dark:text-white/80">{fmtDate(r.started_at)}</td>
                    <td className="px-4 py-3 font-semibold text-black dark:text-white">{r.title}</td>
                    <td className="px-4 py-3 text-black/70 dark:text-white/70">{r.counted_by_name || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${badge.cls}`}>{badge.label}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-black/80 dark:text-white/80">
                      {r.counted_count ?? 0} / {r.items_count ?? 0}
                    </td>
                    <td className={`px-4 py-3 text-right font-bold ${varianceTone(r.total_variance_value)}`}>
                      {fmtRD(r.total_variance_value)}
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

// ── Top-level screen ────────────────────────────────────────────────────────

export default function InventoryCount() {
  const api = useAPI()
  const { user } = useAuth()
  const { lang } = useLang() // accepted but UI is Spanish-only per project rules

  const [rows, setRows]         = useState([])
  const [activeId, setActiveId] = useState(null)
  const [active, setActive]     = useState(null)
  const [showStart, setShowStart] = useState(false)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [empleados, setEmpleados] = useState([])
  const [availableCategories, setAvailableCategories] = useState([])
  const [biz, setBiz] = useState({ name: '', rnc: '' })

  const allowed = user && ALLOWED.includes(user.role)

  const loadList = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await api.inventoryCount.list({ limit: 100 })
      setRows(Array.isArray(data) ? data : [])
    } catch (e) { setError(e?.message || 'Error al cargar conteos') }
    finally { setLoading(false) }
  }, [api])

  const loadActive = useCallback(async (id) => {
    try {
      const data = await api.inventoryCount.get(id)
      setActive(data || null)
    } catch (e) { setError(e?.message || 'Error al cargar conteo') }
  }, [api])

  useEffect(() => {
    if (!allowed) return
    loadList()
    ;(async () => {
      try { const ee = await api.empleados?.all?.(); if (Array.isArray(ee)) setEmpleados(ee.filter(e => e.active !== 0)) } catch {}
      try {
        const s = await api.settings?.get?.()
        if (s) setBiz({
          name: s.biz_name || s.business_name || 'Empresa',
          rnc:  s.biz_rnc  || s.rnc           || '',
        })
      } catch {}
      // v2.14 — category list for the StartModal pre-scope selector. Uses
      // inventory.all() which every mode exposes. Grouping + "(sin
      // categoria)" bucket matches the filter logic in countStart.
      try {
        const all = await api.inventory?.all?.()
        if (Array.isArray(all)) {
          const counts = new Map()
          for (const it of all) {
            if (it.active === 0 || it.active === false) continue
            const k = (it.category && String(it.category).trim()) || '(sin categoria)'
            counts.set(k, (counts.get(k) || 0) + 1)
          }
          const list = [...counts.entries()]
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => a.name.localeCompare(b.name, 'es'))
          setAvailableCategories(list)
        }
      } catch {}
    })()
  }, [allowed, loadList, api])

  useEffect(() => {
    if (activeId) loadActive(activeId)
    else setActive(null)
  }, [activeId, loadActive])

  async function handleStart(data) {
    const newRow = await api.inventoryCount.start(data)
    setShowStart(false)
    await loadList()
    if (newRow?.id) setActiveId(newRow.id)
  }

  if (!allowed) {
    return (
      <div className="p-8 text-center text-black/60 dark:text-white/60">
        No tiene permisos para ver esta seccion.
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-7xl mx-auto">
      {loading && !active ? (
        <div className="p-12 text-center">
          <Loader2 size={32} className="mx-auto animate-spin text-[#b3001e]" />
        </div>
      ) : error && !rows.length && !active ? (
        <div className="p-6 rounded-lg bg-[#b3001e]/10 border border-[#b3001e]/30 text-[#b3001e]">{error}</div>
      ) : active ? (
        <DetailView
          count={active}
          biz={biz}
          onBack={(refresh) => { setActiveId(null); if (refresh) loadList() }}
          onReload={async () => { await loadActive(activeId); await loadList() }}
        />
      ) : (
        <ListView rows={rows} onNew={() => setShowStart(true)} onOpen={r => setActiveId(r.id)} />
      )}

      {showStart && (
        <StartModal
          empleados={empleados}
          availableCategories={availableCategories}
          onStart={handleStart}
          onClose={() => setShowStart(false)}
        />
      )}
      </div>
    </div>
  )
}
