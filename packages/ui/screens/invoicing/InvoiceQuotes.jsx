/**
 * InvoiceQuotes.jsx — FIX-M1
 *
 * Cotización (quote) builder for the Facturación tier. Quotes are NOT e-CFs:
 * they live in localStorage / IndexedDB so the operator can work entirely
 * offline, then promote a quote to a real e-CF with one click which routes
 * back into /invoicing/create with the items pre-filled.
 *
 * Why localStorage instead of Supabase:
 *  - Quotes are not fiscal documents. DGII does not regulate them.
 *  - Keeping them client-side avoids inflating the per-business row count
 *    on Supabase (Hobby tier).
 *  - When a quote is converted to an invoice, the resulting ticket DOES sync.
 *
 * Key bag:
 *  - tx.facturacion.quotes      → JSON array of { id, name, items, ... }
 */
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Plus, Trash2, ArrowLeft, Search, ArrowRight, Copy } from 'lucide-react'
import { useLang } from '../../i18n'

const STORAGE_KEY = 'tx.facturacion.quotes'

function fmtRD(n) {
  return 'RD$ ' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function loadQuotes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}

function saveQuotes(arr) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)) } catch {}
}

function newQuoteId() {
  return 'q_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36)
}

const EMPTY_LINE = { descripcion: '', cantidad: 1, precio: 0, itbisCode: '1', descuentoPct: 0 }

export default function InvoiceQuotes() {
  const navigate = useNavigate()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [quotes, setQuotes] = useState([])
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null) // active quote being edited

  useEffect(() => { setQuotes(loadQuotes()) }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return quotes
    return quotes.filter(qt =>
      (qt.name || '').toLowerCase().includes(q) ||
      (qt.clientName || '').toLowerCase().includes(q)
    )
  }, [quotes, search])

  function persist(next) {
    setQuotes(next)
    saveQuotes(next)
  }

  function createNew() {
    const q = {
      id: newQuoteId(),
      name: L('Cotización sin título', 'Untitled quote'),
      clientName: '',
      clientRnc: '',
      clientPhone: '',
      clientEmail: '',
      items: [{ ...EMPTY_LINE }],
      validUntilDays: 15,
      notes: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    setEditing(q)
  }

  function saveQuote(q) {
    const next = q
    next.updatedAt = Date.now()
    const idx = quotes.findIndex(x => x.id === q.id)
    const arr = idx >= 0 ? quotes.map(x => x.id === q.id ? next : x) : [next, ...quotes]
    persist(arr)
    setEditing(null)
  }

  function removeQuote(id) {
    persist(quotes.filter(q => q.id !== id))
  }

  function duplicateQuote(q) {
    const dup = { ...q, id: newQuoteId(), name: q.name + ' (copia)', createdAt: Date.now(), updatedAt: Date.now() }
    persist([dup, ...quotes])
  }

  // Convert → /invoicing/create with items pre-loaded via sessionStorage hand-off.
  // InvoiceCreate reads `tx.facturacion.pendingQuote` on mount and clears it.
  function convertToInvoice(q) {
    try {
      sessionStorage.setItem('tx.facturacion.pendingQuote', JSON.stringify({
        items: q.items,
        clientName: q.clientName || '',
        clientRnc: q.clientRnc || '',
        clientPhone: q.clientPhone || '',
        clientEmail: q.clientEmail || '',
        notes: q.notes || '',
        sourceQuoteId: q.id,
      }))
    } catch {}
    navigate('/invoicing/create')
  }

  if (editing) {
    return <QuoteEditor quote={editing} onSave={saveQuote} onCancel={() => setEditing(null)} L={L} />
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/invoicing')} className="p-2 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors">
          <ArrowLeft size={20} className="text-slate-500 dark:text-white/50" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white">{L('Cotizaciones', 'Quotes')}</h1>
          <p className="text-xs text-slate-500 dark:text-white/50">{L('Borradores que se convierten en factura con un click', 'Drafts that convert to a real invoice in one click')}</p>
        </div>
        <button
          onClick={createNew}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#b3001e] hover:bg-[#8c0017] text-white font-bold rounded-xl text-sm transition-colors"
        >
          <Plus size={16} /> {L('Nueva Cotización', 'New Quote')}
        </button>
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={L('Buscar por nombre o cliente…', 'Search by name or client…')}
          style={{ paddingLeft: 40 }}
          className="w-full py-2.5 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30"
        />
      </div>

      <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            <FileText size={40} className="mx-auto text-slate-300 dark:text-white/20 mb-3" />
            <p className="text-sm text-slate-500 dark:text-white/50">{L('No hay cotizaciones aún', 'No quotes yet')}</p>
            <button onClick={createNew} className="mt-3 text-sm font-semibold text-[#b3001e] hover:underline">
              {L('Crear tu primera cotización', 'Create your first quote')}
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {filtered.map(q => {
              const total = q.items.reduce((s, i) => s + Number(i.precio || 0) * Number(i.cantidad || 1), 0)
              return (
                <li key={q.id} className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-[#b3001e]/10 flex items-center justify-center shrink-0">
                    <FileText size={16} className="text-[#b3001e]" />
                  </div>
                  <button onClick={() => setEditing(q)} className="flex-1 min-w-0 text-left">
                    <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{q.name}</p>
                    <p className="text-xs text-slate-500 dark:text-white/50 truncate">
                      {q.clientName || L('Sin cliente', 'No client')} · {q.items.length} {L('items', 'items')} · {fmtRD(total)}
                    </p>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => duplicateQuote(q)} title={L('Duplicar', 'Duplicate')} className="p-2 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors">
                      <Copy size={14} className="text-slate-500 dark:text-white/50" />
                    </button>
                    <button onClick={() => removeQuote(q.id)} title={L('Eliminar', 'Delete')} className="p-2 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors">
                      <Trash2 size={14} className="text-red-500" />
                    </button>
                    <button
                      onClick={() => convertToInvoice(q)}
                      className="flex items-center gap-1.5 ml-1 px-3 py-2 rounded-lg bg-[#b3001e] hover:bg-[#8c0017] text-white text-xs font-bold transition-colors"
                    >
                      {L('Convertir', 'Convert')} <ArrowRight size={12} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

// ── Editor ─────────────────────────────────────────────────────────────────
function QuoteEditor({ quote, onSave, onCancel, L }) {
  const [draft, setDraft] = useState(quote)
  const total = draft.items.reduce((s, i) => s + Number(i.precio || 0) * Number(i.cantidad || 1), 0)

  function setLine(idx, key, val) {
    setDraft(d => ({ ...d, items: d.items.map((it, i) => i === idx ? { ...it, [key]: val } : it) }))
  }
  function addLine() {
    setDraft(d => ({ ...d, items: [...d.items, { ...EMPTY_LINE }] }))
  }
  function removeLine(idx) {
    setDraft(d => ({ ...d, items: d.items.length <= 1 ? d.items : d.items.filter((_, i) => i !== idx) }))
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onCancel} className="p-2 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors">
          <ArrowLeft size={20} className="text-slate-500 dark:text-white/50" />
        </button>
        <h1 className="flex-1 text-xl font-bold text-slate-800 dark:text-white">{L('Editar Cotización', 'Edit Quote')}</h1>
        <button
          onClick={() => onSave(draft)}
          className="px-4 py-2 bg-[#b3001e] hover:bg-[#8c0017] text-white font-bold rounded-lg text-sm transition-colors"
        >
          {L('Guardar', 'Save')}
        </button>
      </div>

      <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-white/50 mb-1">{L('Nombre interno', 'Internal name')}</label>
          <input
            type="text"
            value={draft.name}
            onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
            className="w-full px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-white/50 mb-1">{L('Cliente', 'Client')}</label>
          <input
            type="text"
            value={draft.clientName}
            onChange={e => setDraft(d => ({ ...d, clientName: e.target.value }))}
            className="w-full px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-white/50 mb-1">RNC</label>
          <input
            type="text"
            value={draft.clientRnc}
            onChange={e => setDraft(d => ({ ...d, clientRnc: e.target.value }))}
            className="w-full px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-white/50 mb-1">{L('Teléfono', 'Phone')}</label>
          <input
            type="text"
            value={draft.clientPhone}
            onChange={e => setDraft(d => ({ ...d, clientPhone: e.target.value }))}
            className="w-full px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-white/50 mb-1">Email</label>
          <input
            type="email"
            value={draft.clientEmail}
            onChange={e => setDraft(d => ({ ...d, clientEmail: e.target.value }))}
            className="w-full px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-white/50 mb-1">{L('Validez (días)', 'Valid for (days)')}</label>
          <input
            type="number"
            min="1"
            value={draft.validUntilDays}
            onChange={e => setDraft(d => ({ ...d, validUntilDays: Math.max(1, parseInt(e.target.value, 10) || 15) }))}
            className="w-full px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30"
          />
        </div>
      </div>

      <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 p-4 space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-white">{L('Items', 'Items')}</h3>
        {draft.items.map((item, idx) => (
          <div key={idx} className="grid grid-cols-12 gap-2 items-center">
            <input
              type="text"
              value={item.descripcion}
              onChange={e => setLine(idx, 'descripcion', e.target.value)}
              placeholder={L('Descripción', 'Description')}
              className="col-span-6 px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30"
            />
            <input
              type="number"
              min="1"
              value={item.cantidad}
              onChange={e => setLine(idx, 'cantidad', Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="col-span-2 px-2 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-center text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30"
            />
            <input
              type="number"
              min="0"
              step="0.01"
              value={item.precio || ''}
              onChange={e => setLine(idx, 'precio', e.target.value)}
              placeholder="0.00"
              className="col-span-3 px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-right text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30"
            />
            <button
              onClick={() => removeLine(idx)}
              disabled={draft.items.length <= 1}
              className="col-span-1 flex items-center justify-center p-2 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-30"
            >
              <Trash2 size={14} className="text-red-500" />
            </button>
          </div>
        ))}
        <button
          onClick={addLine}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-[#b3001e] hover:bg-[#b3001e]/5 rounded-lg transition-colors"
        >
          <Plus size={16} /> {L('Agregar Item', 'Add Item')}
        </button>

        <div className="flex justify-between items-center pt-3 mt-2 border-t border-slate-100 dark:border-white/5">
          <span className="text-xs text-slate-500 dark:text-white/50">{L('Subtotal estimado (sin ITBIS)', 'Estimated subtotal (no ITBIS)')}</span>
          <span className="text-lg font-extrabold text-[#b3001e]">{fmtRD(total)}</span>
        </div>
      </div>

      <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 p-4">
        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-white/50 mb-1">{L('Notas', 'Notes')}</label>
        <textarea
          value={draft.notes}
          onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
          rows={2}
          className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30 resize-none"
        />
      </div>
    </div>
  )
}
