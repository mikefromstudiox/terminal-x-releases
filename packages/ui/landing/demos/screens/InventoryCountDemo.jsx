// InventoryCountDemo — faithful copy of inventory/InventoryCount.jsx render.
// List view with past counts + status badge + variance + progress, plus a
// modal "Nuevo conteo" stub.

import { useState } from 'react'
import { ClipboardList, Plus, Package, X, Check, AlertTriangle, Camera, Loader2 } from 'lucide-react'

function fmtRD(n) { return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
function fmtDate(s) { if (!s) return '—'; return new Date(s).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' }) }

function varianceTone(v) {
  const n = Number(v) || 0
  if (n === 0) return 'text-emerald-600'
  if (n > 0)   return 'text-amber-600'
  return                'text-[#b3001e]'
}

const SEED = [
  { id: 1, started_at: '2026-04-25', title: 'Conteo Mensual Abril', counted_by_name: 'Carmen (Cajera)', status: 'completado', items_count: 142, counted_count: 142, total_variance_value: -2840 },
  { id: 2, started_at: '2026-04-18', title: 'Auditoría Bebidas',     counted_by_name: 'Carmen (Cajera)', status: 'completado', items_count: 35,  counted_count: 35,  total_variance_value: 0 },
  { id: 3, started_at: '2026-04-27', title: 'Conteo Cigarros + Snacks', counted_by_name: 'Pedro Mendez',   status: 'abierto',    items_count: 28,  counted_count: 12,  total_variance_value: -480 },
  { id: 4, started_at: '2026-03-31', title: 'Cierre de Mes',         counted_by_name: 'Mike Mejia',      status: 'completado', items_count: 138, counted_count: 138, total_variance_value: 1250 },
  { id: 5, started_at: '2026-03-15', title: 'Conteo Limpieza',       counted_by_name: 'Carmen (Cajera)', status: 'cancelado',  items_count: 0,   counted_count: 0,   total_variance_value: 0 },
]

const BADGE = {
  abierto:    { label: 'Abierto',    cls: 'bg-[#b3001e] text-white' },
  completado: { label: 'Completado', cls: 'bg-black text-white' },
  cancelado:  { label: 'Cancelado',  cls: 'bg-black/10 text-black' },
}

const COUNT_DETAIL_ITEMS = [
  { sku: 'SKU-0001', name: 'Arroz 5 lb',         expected: 124, counted: 122, price: 350,  variance: -2 },
  { sku: 'SKU-0003', name: 'Aceite Girasol 1L',  expected: 8,   counted: 8,   price: 285,  variance:  0 },
  { sku: 'SKU-0021', name: 'Coca Cola 2L',       expected: 67,  counted: 64,  price: 130,  variance: -3 },
  { sku: 'SKU-0030', name: 'Detergente 1 kg',    expected: 4,   counted: 5,   price: 175,  variance:  1 },
  { sku: 'SKU-0040', name: 'Papel Higiénico 4u', expected: 89,  counted: 87,  price: 165,  variance: -2 },
  { sku: 'SKU-0008', name: 'Mantequilla 1 lb',   expected: 22,  counted: 22,  price: 240,  variance:  0 },
  { sku: 'SKU-0089', name: 'Pollo Entero 1 lb',  expected: 42,  counted: 41,  price: 95,   variance: -1 },
]

function DetailView({ count, onBack }) {
  const completed = count.status === 'completado'
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <button onClick={() => onBack(false)} className="text-sm text-slate-500 hover:underline mb-2">← Volver</button>
          <h1 className="text-2xl font-black text-slate-900 inline-flex items-center gap-2">
            <ClipboardList size={22} className="text-[#b3001e]" /> {count.title}
          </h1>
          <p className="text-sm text-slate-500 mt-1">{fmtDate(count.started_at)} · Contado por <strong>{count.counted_by_name}</strong></p>
        </div>
        <div className="flex items-center gap-2">
          {!completed && (
            <>
              <button className="px-3 py-2 border border-black text-sm font-semibold hover:bg-slate-50">Cancelar conteo</button>
              <button className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold inline-flex items-center gap-2"><Check size={14} /> Completar</button>
            </>
          )}
          <span className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${BADGE[count.status].cls}`}>{BADGE[count.status].label}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="border border-black p-4"><p className="text-xs uppercase">Items</p><p className="text-2xl font-bold mt-1">{count.items_count}</p></div>
        <div className="border border-black p-4"><p className="text-xs uppercase">Contados</p><p className="text-2xl font-bold mt-1">{count.counted_count} / {count.items_count}</p></div>
        <div className="border border-black p-4"><p className="text-xs uppercase">Faltantes</p><p className="text-2xl font-bold mt-1">{count.items_count - count.counted_count}</p></div>
        <div className="border border-black p-4"><p className="text-xs uppercase">Varianza</p><p className={`text-2xl font-bold mt-1 ${varianceTone(count.total_variance_value)}`}>{fmtRD(count.total_variance_value)}</p></div>
      </div>

      <div className="rounded-xl bg-white border border-black/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-black text-white">
            <tr>
              <th className="text-left px-4 py-2 font-bold text-xs uppercase tracking-wide">SKU</th>
              <th className="text-left px-4 py-2 font-bold text-xs uppercase tracking-wide">Producto</th>
              <th className="text-right px-4 py-2 font-bold text-xs uppercase tracking-wide">Esperado</th>
              <th className="text-right px-4 py-2 font-bold text-xs uppercase tracking-wide">Contado</th>
              <th className="text-right px-4 py-2 font-bold text-xs uppercase tracking-wide">Variación</th>
              <th className="text-right px-4 py-2 font-bold text-xs uppercase tracking-wide">Valor varianza</th>
            </tr>
          </thead>
          <tbody>
            {COUNT_DETAIL_ITEMS.map((it, i) => (
              <tr key={i} className="border-t border-black/5 hover:bg-slate-50">
                <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{it.sku}</td>
                <td className="px-4 py-2.5 font-semibold text-slate-800">{it.name}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{it.expected}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-bold">{it.counted}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums font-bold ${varianceTone(it.variance)}`}>{it.variance > 0 ? '+' : ''}{it.variance}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums font-bold ${varianceTone(it.variance * it.price)}`}>{fmtRD(it.variance * it.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ListView({ rows, onNew, onOpen }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-black inline-flex items-center gap-2"><ClipboardList size={22} className="text-[#b3001e]" /> Conteo Físico</h1>
          <p className="text-sm text-black/60 mt-1">Audita el inventario, detecta mermas y genera reportes de varianza.</p>
        </div>
        <button onClick={onNew} className="px-4 py-2 rounded-lg text-sm font-bold bg-[#b3001e] text-white hover:bg-[#95001a] inline-flex items-center gap-2"><Plus size={16} /> Nuevo conteo</button>
      </div>

      <div className="rounded-xl bg-white border border-black/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-black text-white">
            <tr>
              <th className="text-left px-4 py-2 font-bold text-xs uppercase tracking-wide">Fecha</th>
              <th className="text-left px-4 py-2 font-bold text-xs uppercase tracking-wide">Título</th>
              <th className="text-left px-4 py-2 font-bold text-xs uppercase tracking-wide">Contado por</th>
              <th className="text-left px-4 py-2 font-bold text-xs uppercase tracking-wide">Estado</th>
              <th className="text-right px-4 py-2 font-bold text-xs uppercase tracking-wide">Progreso</th>
              <th className="text-right px-4 py-2 font-bold text-xs uppercase tracking-wide">Varianza</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const b = BADGE[r.status]
              return (
                <tr key={r.id} onClick={() => onOpen(r)} className="border-t border-black/5 cursor-pointer hover:bg-black/[0.02]">
                  <td className="px-4 py-3 text-black/80">{fmtDate(r.started_at)}</td>
                  <td className="px-4 py-3 font-semibold text-black">{r.title}</td>
                  <td className="px-4 py-3 text-black/70">{r.counted_by_name}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${b.cls}`}>{b.label}</span></td>
                  <td className="px-4 py-3 text-right text-black/80 tabular-nums">{r.counted_count} / {r.items_count}</td>
                  <td className={`px-4 py-3 text-right font-bold ${varianceTone(r.total_variance_value)}`}>{fmtRD(r.total_variance_value)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function InventoryCountDemo() {
  const [rows]              = useState(SEED)
  const [activeId, setActiveId] = useState(null)
  const [showNew, setShowNew]   = useState(false)

  const active = activeId ? rows.find(r => r.id === activeId) : null

  return (
    <div className="p-6 max-w-7xl mx-auto h-full overflow-y-auto">
      {active
        ? <DetailView count={active} onBack={() => setActiveId(null)} />
        : <ListView rows={rows} onNew={() => setShowNew(true)} onOpen={r => setActiveId(r.id)} />
      }

      {showNew && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowNew(false)}>
          <div className="bg-white border border-black max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-black">
              <h2 className="text-xl font-bold">Nuevo Conteo Físico</h2>
              <button onClick={() => setShowNew(false)} className="p-1 hover:bg-black hover:text-white"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-3">
              <label className="block"><span className="text-xs font-semibold">Título *</span><input className="mt-1 w-full border border-black px-2 py-1.5" placeholder="Ej: Conteo Abril 2026" /></label>
              <label className="block"><span className="text-xs font-semibold">Contado por</span>
                <select className="mt-1 w-full border border-black px-2 py-1.5">
                  <option>Carmen Diaz (Cajera)</option>
                  <option>Pedro Mendez</option>
                  <option>Mike Mejia</option>
                </select>
              </label>
              <label className="block"><span className="text-xs font-semibold">Categorías a incluir</span>
                <div className="mt-1 grid grid-cols-2 gap-1.5">
                  {['Alimentos', 'Bebidas', 'Limpieza', 'Higiene', 'Snacks', '(sin categoría)'].map(c => (
                    <label key={c} className="flex items-center gap-1.5 text-xs"><input type="checkbox" defaultChecked className="accent-[#b3001e]" /> {c}</label>
                  ))}
                </div>
              </label>
              <label className="flex items-center gap-2 text-sm pt-2"><input type="checkbox" defaultChecked className="accent-[#b3001e]" /> Imprimir hoja de conteo en blanco</label>
            </div>
            <div className="flex justify-end gap-2 p-5 border-t border-black">
              <button onClick={() => setShowNew(false)} className="px-4 py-2 border border-black hover:bg-slate-50">Cancelar</button>
              <button onClick={() => { setShowNew(false); setActiveId(3) }} className="px-4 py-2 bg-[#b3001e] text-white font-bold hover:bg-[#95001a]">Iniciar conteo</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
