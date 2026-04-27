// LibroMayor — Catálogo · Diario · Mayor · Balance Comprobación · Estado de
// Resultados · Balance General. Plan-gated by `contabilidad_libro_mayor`.
//
// All math runs in-browser over the rows the data layer returns; no server
// roundtrip. Spanish labels, brand palette black/white/#b3001e only.

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BookOpen, Plus, Trash2, Loader2, Sprout, Search, ChevronRight, ChevronDown,
  FileDown, Lock, X,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { usePlan } from '../../hooks/usePlan'
import { CATALOGO_UNICO_DR } from '@terminal-x/config/contabilidadCoaSeed.js'

const TABS = [
  { id: 'catalogo', label: 'Catálogo' },
  { id: 'diario',   label: 'Diario' },
  { id: 'mayor',    label: 'Mayor' },
  { id: 'balance',  label: 'Balance Comprobación' },
  { id: 'er',       label: 'Estado de Resultados' },
  { id: 'bg',       label: 'Balance General' },
]

const MONTHS = [
  '01 - Enero','02 - Febrero','03 - Marzo','04 - Abril','05 - Mayo','06 - Junio',
  '07 - Julio','08 - Agosto','09 - Septiembre','10 - Octubre','11 - Noviembre','12 - Diciembre',
]

const TYPE_LABELS = {
  activo: 'Activo', pasivo: 'Pasivo', patrimonio: 'Patrimonio',
  ingreso: 'Ingreso', costo: 'Costo', gasto: 'Gasto',
}

function fmtRD(n) {
  return Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function todayISO() { return new Date().toISOString().slice(0, 10) }

function ComingSoon() {
  return (
    <div className="p-6 max-w-2xl">
      <div className="rounded-2xl border border-[#b3001e]/30 bg-[#b3001e]/5 p-6">
        <div className="flex items-center gap-2 text-[#b3001e] font-bold mb-2"><Lock size={16}/> Próximamente</div>
        <div className="text-sm text-black/80 dark:text-white/80">
          El módulo Libro Mayor requiere el plan Pro CTB. Contáctanos por WhatsApp para activar.
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function ClientPicker({ clients, value, onChange }) {
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
      <option value="">— Cliente —</option>
      {(clients || []).map(c => <option key={c.id} value={c.id}>{c.nombre_comercial}</option>)}
    </select>
  )
}

function PeriodPicker({ year, month, onYear, onMonth, onlyYear }) {
  const today = new Date()
  const years = [today.getFullYear(), today.getFullYear() - 1, today.getFullYear() - 2]
  return (
    <div className="flex gap-2">
      <select value={year} onChange={(e) => onYear(Number(e.target.value))}
        className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
      {!onlyYear && (
        <select value={month} onChange={(e) => onMonth(Number(e.target.value))}
          className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
          {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
        </select>
      )}
    </div>
  )
}

// ── Catálogo ────────────────────────────────────────────────────────────────

function CatalogoTab({ api, clientId, accounts, onChange }) {
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(null)
  const [search, setSearch] = useState('')

  async function seed() {
    if (!clientId) return alert('Selecciona un cliente primero.')
    if (!confirm('¿Sembrar el Catálogo Único PYME (DR) para este cliente? Se omitirán las cuentas que ya existan.')) return
    setBusy(true)
    try {
      const existing = new Set((accounts || []).map(a => a.code))
      const codeToId = new Map((accounts || []).map(a => [a.code, a.id]))
      // Insert in dependency order so parent_id resolves.
      for (const row of CATALOGO_UNICO_DR) {
        if (existing.has(row.code)) continue
        const parentId = row.parent ? (codeToId.get(row.parent) || null) : null
        const created = await api.contabilidad.coaCreate({
          accounting_client_id: clientId,
          code: row.code, name: row.name, type: row.type,
          parent_id: parentId, is_postable: row.postable !== false,
        })
        if (created?.id) codeToId.set(row.code, created.id)
      }
      await onChange()
    } catch (e) {
      alert(`Error al sembrar: ${e?.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  async function save(form) {
    setBusy(true)
    try {
      if (editing?.id) {
        await api.contabilidad.coaUpdate(editing.id, form)
      } else {
        await api.contabilidad.coaCreate({ ...form, accounting_client_id: clientId })
      }
      setEditing(null)
      await onChange()
    } catch (e) { alert(`Error: ${e?.message || e}`) }
    finally    { setBusy(false) }
  }

  async function remove(id) {
    if (!confirm('¿Eliminar esta cuenta? No se puede deshacer.')) return
    setBusy(true)
    try { await api.contabilidad.coaDelete(id); await onChange() }
    catch (e) { alert(`Error: ${e?.message || e}`) }
    finally   { setBusy(false) }
  }

  const filtered = useMemo(() => {
    if (!search) return accounts || []
    const s = search.toLowerCase()
    return (accounts || []).filter(a =>
      (a.code || '').toLowerCase().includes(s) ||
      (a.name || '').toLowerCase().includes(s),
    )
  }, [accounts, search])

  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <button onClick={seed} disabled={busy || !clientId}
          className="inline-flex items-center gap-2 rounded-lg bg-[#b3001e] text-white px-3 py-2 text-sm font-bold hover:bg-[#8f0018] disabled:opacity-50">
          <Sprout size={14}/> Sembrar Catálogo Único DGII
        </button>
        <button onClick={() => setEditing({})} disabled={busy || !clientId}
          className="inline-flex items-center gap-2 rounded-lg bg-black text-white dark:bg-white dark:text-black px-3 py-2 text-sm font-bold disabled:opacity-50">
          <Plus size={14}/> Nueva Cuenta
        </button>
        <div className="ml-auto relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-black/50 dark:text-white/50"/>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar código o nombre…"
            className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black pl-8 pr-3 py-2 text-sm w-64"/>
        </div>
      </div>
      <div className="rounded-2xl border border-black/10 dark:border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-black text-white">
            <tr>
              <th className="text-left px-3 py-2">Código</th>
              <th className="text-left px-3 py-2">Nombre</th>
              <th className="text-left px-3 py-2">Tipo</th>
              <th className="text-left px-3 py-2">Postable</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {!filtered.length && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-black/50 dark:text-white/50">Sin cuentas. Siembra el catálogo o crea manualmente.</td></tr>
            )}
            {filtered.map(a => (
              <tr key={a.id} className="border-t border-black/10 dark:border-white/10">
                <td className="px-3 py-2 font-mono">{a.code}</td>
                <td className="px-3 py-2">{a.name}</td>
                <td className="px-3 py-2">{TYPE_LABELS[a.type] || a.type}</td>
                <td className="px-3 py-2">{a.is_postable ? 'Sí' : 'No'}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button onClick={() => setEditing(a)} className="text-xs font-bold text-[#b3001e] hover:underline mr-3">Editar</button>
                  <button onClick={() => remove(a.id)} className="text-xs font-bold text-black/60 dark:text-white/60 hover:text-[#b3001e]"><Trash2 size={14} className="inline"/></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <CoaEditModal initial={editing} accounts={accounts} onClose={() => setEditing(null)} onSave={save} busy={busy}/>}
    </div>
  )
}

function CoaEditModal({ initial, accounts, onClose, onSave, busy }) {
  const [form, setForm] = useState({
    code: initial?.code || '',
    name: initial?.name || '',
    type: initial?.type || 'activo',
    parent_id: initial?.parent_id ?? null,
    is_postable: initial?.is_postable ?? 1,
  })
  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-black rounded-2xl border border-black/10 dark:border-white/10 max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="font-bold">{initial?.id ? 'Editar Cuenta' : 'Nueva Cuenta'}</div>
          <button onClick={onClose}><X size={16}/></button>
        </div>
        <div className="space-y-3">
          <label className="block text-xs font-bold">Código
            <input value={form.code} onChange={(e) => set('code', e.target.value)}
              className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm font-mono"/>
          </label>
          <label className="block text-xs font-bold">Nombre
            <input value={form.name} onChange={(e) => set('name', e.target.value)}
              className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm"/>
          </label>
          <label className="block text-xs font-bold">Tipo
            <select value={form.type} onChange={(e) => set('type', e.target.value)}
              className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="block text-xs font-bold">Cuenta padre
            <select value={form.parent_id || ''} onChange={(e) => set('parent_id', e.target.value ? Number(e.target.value) : null)}
              className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
              <option value="">— Sin padre —</option>
              {(accounts || []).filter(a => a.id !== initial?.id).map(a => (
                <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
              ))}
            </select>
          </label>
          <label className="inline-flex items-center gap-2 text-xs font-bold">
            <input type="checkbox" checked={!!form.is_postable} onChange={(e) => set('is_postable', e.target.checked ? 1 : 0)}/>
            Postable (acepta asientos directos)
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm font-bold border border-black/10 dark:border-white/10">Cancelar</button>
          <button disabled={busy || !form.code || !form.name} onClick={() => onSave(form)}
            className="px-3 py-2 rounded-lg text-sm font-bold bg-[#b3001e] text-white disabled:opacity-50">
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Diario ─────────────────────────────────────────────────────────────────

function DiarioTab({ api, clientId, year, month, accounts, onAccountsChange }) {
  const [entries, setEntries] = useState([])
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(null)

  const reload = useCallback(async () => {
    if (!api?.contabilidad || !clientId) { setEntries([]); return }
    const r = await api.contabilidad.journalEntryList({
      accountingClientId: clientId, periodYear: year, periodMonth: month,
    })
    setEntries(r || [])
  }, [api, clientId, year, month])

  useEffect(() => { reload() }, [reload])

  async function remove(id) {
    if (!confirm('¿Eliminar el asiento?')) return
    setBusy(true)
    try { await api.contabilidad.journalEntryDelete(id); await reload() }
    catch (e) { alert(`Error: ${e?.message || e}`) }
    finally   { setBusy(false) }
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <button onClick={() => setEditing({})} disabled={!clientId}
          className="inline-flex items-center gap-2 rounded-lg bg-[#b3001e] text-white px-3 py-2 text-sm font-bold hover:bg-[#8f0018] disabled:opacity-50">
          <Plus size={14}/> Nuevo Asiento
        </button>
        <div className="ml-auto text-xs text-black/60 dark:text-white/60">{entries.length} asiento(s) en el período</div>
      </div>
      <div className="rounded-2xl border border-black/10 dark:border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-black text-white">
            <tr>
              <th className="text-left px-3 py-2">Fecha</th>
              <th className="text-left px-3 py-2">Descripción</th>
              <th className="text-left px-3 py-2">Tipo</th>
              <th className="text-right px-3 py-2">Débito</th>
              <th className="text-right px-3 py-2">Crédito</th>
              <th className="text-left px-3 py-2">Estado</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {!entries.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-black/50 dark:text-white/50">Sin asientos. Crea uno con "Nuevo Asiento".</td></tr>}
            {entries.map(e => (
              <tr key={e.id} className="border-t border-black/10 dark:border-white/10">
                <td className="px-3 py-2 font-mono">{e.fecha}</td>
                <td className="px-3 py-2">{e.description || '—'}</td>
                <td className="px-3 py-2">{e.type}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtRD(e.totals_debit)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtRD(e.totals_credit)}</td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${e.status === 'posted' ? 'bg-[#b3001e] text-white border-[#b3001e]' : 'bg-white text-black border-black/20 dark:bg-black dark:text-white dark:border-white/20'}`}>
                    {e.status === 'posted' ? 'Posteado' : 'Borrador'}
                  </span>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button onClick={() => setEditing(e)} className="text-xs font-bold text-[#b3001e] hover:underline mr-3">Ver</button>
                  <button onClick={() => remove(e.id)} disabled={busy} className="text-xs font-bold text-black/60 dark:text-white/60 hover:text-[#b3001e]"><Trash2 size={14} className="inline"/></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <JournalEntryModal
          api={api} clientId={clientId} year={year} month={month}
          accounts={accounts} initial={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await reload(); await onAccountsChange?.() }}
        />
      )}
    </div>
  )
}

function JournalEntryModal({ api, clientId, year, month, accounts, initial, onClose, onSaved }) {
  const [header, setHeader] = useState({
    fecha: initial?.fecha || `${year}-${String(month).padStart(2,'0')}-${String(new Date().getDate()).padStart(2,'0')}`,
    description: initial?.description || '',
    type: initial?.type || 'manual',
  })
  const [lines, setLines] = useState(
    (initial?.lines || []).length ? initial.lines.map(l => ({
      account_id: l.account_id, debit: Number(l.debit || 0), credit: Number(l.credit || 0), memo: l.memo || '',
    })) : [
      { account_id: null, debit: 0, credit: 0, memo: '' },
      { account_id: null, debit: 0, credit: 0, memo: '' },
    ],
  )
  const [busy, setBusy] = useState(false)

  // Hydrate lines for an existing entry
  useEffect(() => {
    let cancelled = false
    async function loadLines() {
      if (!initial?.id || !api?.contabilidad?.journalEntryGet) return
      const full = await api.contabilidad.journalEntryGet(initial.id)
      if (cancelled || !full?.lines) return
      setLines(full.lines.map(l => ({
        id: l.id, account_id: l.account_id, debit: Number(l.debit || 0), credit: Number(l.credit || 0), memo: l.memo || '',
      })))
    }
    loadLines()
    return () => { cancelled = true }
  }, [initial?.id, api])

  const totals = useMemo(() => {
    const d = lines.reduce((s, l) => s + Number(l.debit || 0), 0)
    const c = lines.reduce((s, l) => s + Number(l.credit || 0), 0)
    return { d, c, balanced: Math.abs(d - c) < 0.005 && d > 0 }
  }, [lines])

  function setLine(i, patch) {
    setLines(arr => arr.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  }
  function addLine() { setLines(arr => [...arr, { account_id: null, debit: 0, credit: 0, memo: '' }]) }
  function delLine(i) { setLines(arr => arr.filter((_, idx) => idx !== i)) }

  const isReadonly = initial?.status === 'posted'

  async function save() {
    if (!clientId) return
    if (!totals.balanced) return alert('Débito y crédito deben balancear y ser mayores a cero.')
    setBusy(true)
    try {
      let entryId = initial?.id
      if (entryId) {
        await api.contabilidad.journalEntryUpdate(entryId, {
          fecha: header.fecha, description: header.description, type: header.type,
          totals_debit: totals.d, totals_credit: totals.c, status: 'posted',
        })
        // Replace lines (delete existing, insert fresh)
        const existing = (initial.lines || [])
        for (const l of existing) {
          if (l.id) await api.contabilidad.journalLineDelete(l.id)
        }
      } else {
        const created = await api.contabilidad.journalEntryCreate({
          accounting_client_id: clientId,
          fecha: header.fecha, description: header.description, type: header.type,
          period_year: year, period_month: month,
          totals_debit: totals.d, totals_credit: totals.c, status: 'posted',
        })
        entryId = created?.id
      }
      for (const l of lines) {
        if (!l.account_id) continue
        if (Number(l.debit || 0) === 0 && Number(l.credit || 0) === 0) continue
        await api.contabilidad.journalLineAdd({
          journal_entry_id: entryId,
          account_id: l.account_id,
          debit: Number(l.debit || 0),
          credit: Number(l.credit || 0),
          memo: l.memo || null,
        })
      }
      await onSaved?.()
    } catch (e) {
      alert(`Error al guardar: ${e?.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-black rounded-2xl border border-black/10 dark:border-white/10 max-w-3xl w-full p-5 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="font-bold">{initial?.id ? `Asiento #${initial.id}` : 'Nuevo Asiento'}{isReadonly ? ' (posteado)' : ''}</div>
          <button onClick={onClose}><X size={16}/></button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <label className="text-xs font-bold">Fecha
            <input type="date" disabled={isReadonly} value={header.fecha} onChange={(e) => setHeader(h => ({ ...h, fecha: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm"/>
          </label>
          <label className="text-xs font-bold md:col-span-2">Descripción
            <input disabled={isReadonly} value={header.description} onChange={(e) => setHeader(h => ({ ...h, description: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm"/>
          </label>
        </div>
        <div className="rounded-2xl border border-black/10 dark:border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-black text-white">
              <tr>
                <th className="text-left px-3 py-2">Cuenta</th>
                <th className="text-right px-3 py-2 w-32">Débito</th>
                <th className="text-right px-3 py-2 w-32">Crédito</th>
                <th className="text-left px-3 py-2">Memo</th>
                <th className="px-3 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-black/10 dark:border-white/10">
                  <td className="px-2 py-1">
                    <select disabled={isReadonly} value={l.account_id || ''} onChange={(e) => setLine(i, { account_id: e.target.value ? Number(e.target.value) : null })}
                      className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-2 py-1 text-xs">
                      <option value="">— Seleccionar —</option>
                      {(accounts || []).filter(a => a.is_postable).map(a => (
                        <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <input disabled={isReadonly} type="number" step="0.01" value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: 0 })}
                      className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-2 py-1 text-xs text-right font-mono"/>
                  </td>
                  <td className="px-2 py-1">
                    <input disabled={isReadonly} type="number" step="0.01" value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: 0 })}
                      className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-2 py-1 text-xs text-right font-mono"/>
                  </td>
                  <td className="px-2 py-1">
                    <input disabled={isReadonly} value={l.memo} onChange={(e) => setLine(i, { memo: e.target.value })}
                      className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-2 py-1 text-xs"/>
                  </td>
                  <td className="px-2 py-1 text-right">
                    {!isReadonly && lines.length > 2 && (
                      <button onClick={() => delLine(i)} className="text-black/50 dark:text-white/50 hover:text-[#b3001e]"><Trash2 size={12}/></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-white dark:bg-black">
              <tr className="border-t border-black/10 dark:border-white/10">
                <td className="px-3 py-2 text-right font-bold">Totales</td>
                <td className={`px-3 py-2 text-right font-mono font-bold ${totals.balanced ? '' : 'text-[#b3001e]'}`}>{fmtRD(totals.d)}</td>
                <td className={`px-3 py-2 text-right font-mono font-bold ${totals.balanced ? '' : 'text-[#b3001e]'}`}>{fmtRD(totals.c)}</td>
                <td colSpan={2} className="px-3 py-2 text-xs">
                  {totals.balanced ? <span className="text-[#b3001e] font-bold">Balanceado</span> : <span className="text-[#b3001e] font-bold">Diferencia: {fmtRD(Math.abs(totals.d - totals.c))}</span>}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        {!isReadonly && (
          <div className="mt-3 flex items-center gap-2">
            <button onClick={addLine} className="inline-flex items-center gap-1 rounded-lg border border-black/10 dark:border-white/10 px-3 py-2 text-xs font-bold">
              <Plus size={12}/> Línea
            </button>
            <div className="ml-auto flex gap-2">
              <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm font-bold border border-black/10 dark:border-white/10">Cancelar</button>
              <button disabled={busy || !totals.balanced} onClick={save}
                className="px-3 py-2 rounded-lg text-sm font-bold bg-[#b3001e] text-white disabled:opacity-50 inline-flex items-center gap-2">
                {busy && <Loader2 size={14} className="animate-spin"/>} Guardar y postear
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Mayor ──────────────────────────────────────────────────────────────────

function MayorTab({ api, clientId, year, month, accounts }) {
  const [accountId, setAccountId] = useState(null)
  const [lines, setLines] = useState([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!api?.contabilidad || !clientId || !accountId) { setLines([]); return }
      setBusy(true)
      try {
        // Pull all entries in period to filter by account_id
        const entries = await api.contabilidad.journalEntryList({
          accountingClientId: clientId, periodYear: year, periodMonth: month, status: 'posted',
        }) || []
        const collected = []
        for (const e of entries) {
          const ll = await api.contabilidad.journalLineList({
            journalEntryId: e.id, journalEntrySupabaseId: e.supabase_id, accountId,
          }) || []
          for (const l of ll) collected.push({ ...l, fecha: e.fecha, description: e.description, entry_id: e.id })
        }
        collected.sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')) || (a.id - b.id))
        if (!cancelled) setLines(collected)
      } finally {
        if (!cancelled) setBusy(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [api, clientId, year, month, accountId])

  let running = 0
  const account = (accounts || []).find(a => a.id === accountId)

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <select value={accountId || ''} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : null)}
          className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm w-96">
          <option value="">— Cuenta —</option>
          {(accounts || []).filter(a => a.is_postable).map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
        </select>
        {busy && <Loader2 size={14} className="animate-spin text-[#b3001e]"/>}
      </div>
      {account && (
        <div className="rounded-2xl border border-black/10 dark:border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-black text-white">
              <tr>
                <th className="text-left px-3 py-2">Fecha</th>
                <th className="text-left px-3 py-2">Descripción</th>
                <th className="text-left px-3 py-2">Memo</th>
                <th className="text-right px-3 py-2">Débito</th>
                <th className="text-right px-3 py-2">Crédito</th>
                <th className="text-right px-3 py-2">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {!lines.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-black/50 dark:text-white/50">Sin movimientos en el período.</td></tr>}
              {lines.map(l => {
                running += Number(l.debit || 0) - Number(l.credit || 0)
                return (
                  <tr key={l.id} className="border-t border-black/10 dark:border-white/10">
                    <td className="px-3 py-2 font-mono">{l.fecha}</td>
                    <td className="px-3 py-2">{l.description || '—'}</td>
                    <td className="px-3 py-2 text-black/60 dark:text-white/60">{l.memo || ''}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtRD(l.debit)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtRD(l.credit)}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold">{fmtRD(running)}</td>
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

// ── Aggregations for Balance, ER, BG ───────────────────────────────────────

async function aggregateByAccount({ api, clientId, year, month, untilMonth }) {
  // Returns Map<account_id, { debit, credit }> over posted entries in scope.
  const map = new Map()
  if (!api?.contabilidad || !clientId) return map
  const months = untilMonth ? Array.from({ length: untilMonth }, (_, i) => i + 1) : [month]
  for (const m of months) {
    const entries = await api.contabilidad.journalEntryList({
      accountingClientId: clientId, periodYear: year, periodMonth: m, status: 'posted',
    }) || []
    for (const e of entries) {
      const lines = await api.contabilidad.journalLineList({
        journalEntryId: e.id, journalEntrySupabaseId: e.supabase_id,
      }) || []
      for (const l of lines) {
        if (!l.account_id) continue
        const cur = map.get(l.account_id) || { debit: 0, credit: 0 }
        cur.debit  += Number(l.debit  || 0)
        cur.credit += Number(l.credit || 0)
        map.set(l.account_id, cur)
      }
    }
  }
  return map
}

function signedSaldo(type, debit, credit) {
  // Activos/Costos/Gastos: saldo natural deudor (debit - credit)
  // Pasivos/Patrimonio/Ingresos: saldo natural acreedor (credit - debit)
  if (type === 'activo' || type === 'costo' || type === 'gasto') return debit - credit
  return credit - debit
}

// ── Balance Comprobación ───────────────────────────────────────────────────

function BalanceTab({ api, clientId, year, month, accounts }) {
  const [agg, setAgg] = useState(new Map())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setBusy(true)
      const m = await aggregateByAccount({ api, clientId, year, untilMonth: month })
      if (!cancelled) setAgg(m)
      if (!cancelled) setBusy(false)
    }
    load()
    return () => { cancelled = true }
  }, [api, clientId, year, month])

  const rows = useMemo(() => (accounts || [])
    .filter(a => a.is_postable)
    .map(a => {
      const t = agg.get(a.id) || { debit: 0, credit: 0 }
      return { ...a, debit: t.debit, credit: t.credit, saldo: signedSaldo(a.type, t.debit, t.credit) }
    })
    .filter(r => r.debit !== 0 || r.credit !== 0)
    .sort((a, b) => String(a.code).localeCompare(String(b.code))), [accounts, agg])

  const totals = rows.reduce((s, r) => ({ d: s.d + r.debit, c: s.c + r.credit }), { d: 0, c: 0 })

  async function exportPDF() {
    const mod = await import('@terminal-x/services/pdf.js')
    if (!mod.buildContabilidadReportPDF) {
      alert('PDF no disponible en este build.')
      return
    }
    await mod.buildContabilidadReportPDF({
      title: 'Balance de Comprobación', year, month, rows,
      totals, kind: 'balance',
    })
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-xs text-black/60 dark:text-white/60">Acumulado del 01/01 al cierre del mes seleccionado.</div>
        <button onClick={exportPDF} className="ml-auto inline-flex items-center gap-2 rounded-lg bg-black text-white dark:bg-white dark:text-black px-3 py-2 text-xs font-bold">
          <FileDown size={12}/> Exportar PDF
        </button>
      </div>
      <div className="rounded-2xl border border-black/10 dark:border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-black text-white">
            <tr>
              <th className="text-left px-3 py-2">Código</th>
              <th className="text-left px-3 py-2">Cuenta</th>
              <th className="text-right px-3 py-2">Débito</th>
              <th className="text-right px-3 py-2">Crédito</th>
              <th className="text-right px-3 py-2">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {busy && <tr><td colSpan={5} className="px-3 py-6 text-center text-black/50 dark:text-white/50">Calculando…</td></tr>}
            {!busy && !rows.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-black/50 dark:text-white/50">Sin movimientos.</td></tr>}
            {rows.map(r => (
              <tr key={r.id} className="border-t border-black/10 dark:border-white/10">
                <td className="px-3 py-2 font-mono">{r.code}</td>
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtRD(r.debit)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtRD(r.credit)}</td>
                <td className="px-3 py-2 text-right font-mono font-bold">{fmtRD(r.saldo)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-black dark:border-white">
              <td colSpan={2} className="px-3 py-2 font-bold">Totales</td>
              <td className="px-3 py-2 text-right font-mono font-bold">{fmtRD(totals.d)}</td>
              <td className="px-3 py-2 text-right font-mono font-bold">{fmtRD(totals.c)}</td>
              <td className="px-3 py-2 text-right font-mono font-bold">{fmtRD(totals.d - totals.c)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

// ── Estado de Resultados ───────────────────────────────────────────────────

function ERTab({ api, clientId, year, month, accounts }) {
  const [agg, setAgg] = useState(new Map())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setBusy(true)
      const m = await aggregateByAccount({ api, clientId, year, untilMonth: month })
      if (!cancelled) setAgg(m)
      if (!cancelled) setBusy(false)
    }
    load()
    return () => { cancelled = true }
  }, [api, clientId, year, month])

  const groups = useMemo(() => {
    const ing = [], cos = [], gas = []
    for (const a of accounts || []) {
      if (!a.is_postable) continue
      const t = agg.get(a.id); if (!t) continue
      const saldo = signedSaldo(a.type, t.debit, t.credit)
      if (a.type === 'ingreso') ing.push({ ...a, saldo })
      else if (a.type === 'costo') cos.push({ ...a, saldo })
      else if (a.type === 'gasto') gas.push({ ...a, saldo })
    }
    const sum = (arr) => arr.reduce((s, r) => s + r.saldo, 0)
    return { ing, cos, gas, totalIng: sum(ing), totalCos: sum(cos), totalGas: sum(gas) }
  }, [accounts, agg])

  const utilidad = groups.totalIng - groups.totalCos - groups.totalGas

  async function exportPDF() {
    const mod = await import('@terminal-x/services/pdf.js')
    if (!mod.buildContabilidadReportPDF) return alert('PDF no disponible.')
    await mod.buildContabilidadReportPDF({
      title: 'Estado de Resultados', year, month, kind: 'er',
      groups, utilidad,
    })
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-xs text-black/60 dark:text-white/60">Acumulado año-a-fecha hasta el mes seleccionado.</div>
        <button onClick={exportPDF} className="ml-auto inline-flex items-center gap-2 rounded-lg bg-black text-white dark:bg-white dark:text-black px-3 py-2 text-xs font-bold">
          <FileDown size={12}/> Exportar PDF
        </button>
      </div>
      {busy && <div className="text-sm text-black/50 dark:text-white/50">Calculando…</div>}
      {!busy && (
        <div className="space-y-4">
          <ERSection title="Ingresos" rows={groups.ing} total={groups.totalIng}/>
          <ERSection title="Costos" rows={groups.cos} total={groups.totalCos}/>
          <ERSection title="Gastos" rows={groups.gas} total={groups.totalGas}/>
          <div className="rounded-2xl border-2 border-[#b3001e] bg-[#b3001e]/5 p-4 flex items-center justify-between">
            <div className="font-bold text-[#b3001e]">Utilidad / (Pérdida) del Período</div>
            <div className={`font-mono font-bold text-lg ${utilidad >= 0 ? 'text-[#b3001e]' : 'text-black dark:text-white'}`}>RD$ {fmtRD(utilidad)}</div>
          </div>
        </div>
      )}
    </div>
  )
}

function ERSection({ title, rows, total }) {
  return (
    <div className="rounded-2xl border border-black/10 dark:border-white/10 overflow-hidden">
      <div className="bg-black text-white px-3 py-2 font-bold text-sm">{title}</div>
      <table className="w-full text-sm">
        <tbody>
          {!rows.length && <tr><td colSpan={3} className="px-3 py-3 text-black/50 dark:text-white/50">Sin movimientos.</td></tr>}
          {rows.map(r => (
            <tr key={r.id} className="border-t border-black/10 dark:border-white/10">
              <td className="px-3 py-2 font-mono w-28">{r.code}</td>
              <td className="px-3 py-2">{r.name}</td>
              <td className="px-3 py-2 text-right font-mono">{fmtRD(r.saldo)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-black dark:border-white">
            <td colSpan={2} className="px-3 py-2 font-bold">Total {title}</td>
            <td className="px-3 py-2 text-right font-mono font-bold">{fmtRD(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ── Balance General ─────────────────────────────────────────────────────────

function BGTab({ api, clientId, year, month, accounts }) {
  const [agg, setAgg] = useState(new Map())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setBusy(true)
      const m = await aggregateByAccount({ api, clientId, year, untilMonth: month })
      if (!cancelled) setAgg(m)
      if (!cancelled) setBusy(false)
    }
    load()
    return () => { cancelled = true }
  }, [api, clientId, year, month])

  const groups = useMemo(() => {
    const act = [], pas = [], pat = []
    let utilidad = 0
    for (const a of accounts || []) {
      if (!a.is_postable) continue
      const t = agg.get(a.id); if (!t) continue
      const saldo = signedSaldo(a.type, t.debit, t.credit)
      if (a.type === 'activo') act.push({ ...a, saldo })
      else if (a.type === 'pasivo') pas.push({ ...a, saldo })
      else if (a.type === 'patrimonio') pat.push({ ...a, saldo })
      else if (a.type === 'ingreso') utilidad += saldo
      else if (a.type === 'costo' || a.type === 'gasto') utilidad -= saldo
    }
    const sum = (arr) => arr.reduce((s, r) => s + r.saldo, 0)
    return { act, pas, pat, totalAct: sum(act), totalPas: sum(pas), totalPat: sum(pat), utilidad }
  }, [accounts, agg])

  const totalPasPat = groups.totalPas + groups.totalPat + groups.utilidad

  async function exportPDF() {
    const mod = await import('@terminal-x/services/pdf.js')
    if (!mod.buildContabilidadReportPDF) return alert('PDF no disponible.')
    await mod.buildContabilidadReportPDF({
      title: 'Balance General', year, month, kind: 'bg',
      groups, totalPasPat,
    })
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-xs text-black/60 dark:text-white/60">Saldos al cierre del mes seleccionado.</div>
        <button onClick={exportPDF} className="ml-auto inline-flex items-center gap-2 rounded-lg bg-black text-white dark:bg-white dark:text-black px-3 py-2 text-xs font-bold">
          <FileDown size={12}/> Exportar PDF
        </button>
      </div>
      {busy && <div className="text-sm text-black/50 dark:text-white/50">Calculando…</div>}
      {!busy && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ERSection title="Activos" rows={groups.act} total={groups.totalAct}/>
          <div className="space-y-4">
            <ERSection title="Pasivos" rows={groups.pas} total={groups.totalPas}/>
            <ERSection title="Patrimonio" rows={groups.pat} total={groups.totalPat}/>
            <div className="rounded-2xl border border-black/10 dark:border-white/10 p-3 flex items-center justify-between">
              <div className="font-bold text-sm">Utilidad acumulada del ejercicio</div>
              <div className="font-mono font-bold">{fmtRD(groups.utilidad)}</div>
            </div>
            <div className="rounded-2xl border-2 border-[#b3001e] bg-[#b3001e]/5 p-3 flex items-center justify-between">
              <div className="font-bold text-[#b3001e]">Total Pasivo + Patrimonio</div>
              <div className="font-mono font-bold text-[#b3001e]">{fmtRD(totalPasPat)}</div>
            </div>
            <div className={`rounded-2xl border p-3 text-xs ${Math.abs(groups.totalAct - totalPasPat) < 0.01 ? 'border-[#b3001e]/30 text-[#b3001e]' : 'border-black/30 dark:border-white/30 text-black dark:text-white'}`}>
              {Math.abs(groups.totalAct - totalPasPat) < 0.01
                ? 'Ecuación contable cuadrada: Activo = Pasivo + Patrimonio.'
                : `Diferencia: ${fmtRD(groups.totalAct - totalPasPat)} — revisar asientos.`}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Shell ───────────────────────────────────────────────────────────────────

export default function LibroMayor() {
  const api = useAPI()
  const { hasFeature } = usePlan()
  const allowed = hasFeature('contabilidad_libro_mayor')

  const [tab, setTab] = useState('catalogo')
  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState(null)
  const [accounts, setAccounts] = useState([])
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!api?.contabilidad) return
      const c = await api.contabilidad.clientList()
      if (cancelled) return
      setClients(c || [])
      if (!clientId && c?.length) setClientId(c[0].id)
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  const reloadAccounts = useCallback(async () => {
    if (!api?.contabilidad || !clientId) { setAccounts([]); return }
    const r = await api.contabilidad.coaList({ accountingClientId: clientId })
    setAccounts(r || [])
  }, [api, clientId])

  useEffect(() => { reloadAccounts() }, [reloadAccounts])

  if (!allowed) return <ComingSoon/>

  return (
    <div className="flex flex-col min-h-full">
      <div className="border-b border-black/10 dark:border-white/10 bg-white dark:bg-black px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 font-bold text-[#b3001e]">
          <BookOpen size={16}/> Libro Mayor
        </div>
        <ClientPicker clients={clients} value={clientId} onChange={setClientId}/>
        <PeriodPicker year={year} month={month} onYear={setYear} onMonth={setMonth}/>
      </div>
      <nav className="border-b border-black/10 dark:border-white/10 bg-white dark:bg-black px-2 py-1 flex gap-1 overflow-x-auto">
        {TABS.map(t => {
          const active = tab === t.id
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-colors
                ${active ? 'bg-[#b3001e] text-white' : 'text-black/70 dark:text-white/70 hover:bg-[#b3001e]/10 hover:text-[#b3001e]'}`}>
              {t.label}
            </button>
          )
        })}
      </nav>
      <div className="flex-1 min-w-0 bg-white dark:bg-black">
        {!clientId && (
          <div className="p-6 text-sm text-black/60 dark:text-white/60">Selecciona un cliente para empezar.</div>
        )}
        {clientId && tab === 'catalogo' && <CatalogoTab api={api} clientId={clientId} accounts={accounts} onChange={reloadAccounts}/>}
        {clientId && tab === 'diario'   && <DiarioTab   api={api} clientId={clientId} year={year} month={month} accounts={accounts} onAccountsChange={reloadAccounts}/>}
        {clientId && tab === 'mayor'    && <MayorTab    api={api} clientId={clientId} year={year} month={month} accounts={accounts}/>}
        {clientId && tab === 'balance'  && <BalanceTab  api={api} clientId={clientId} year={year} month={month} accounts={accounts}/>}
        {clientId && tab === 'er'       && <ERTab       api={api} clientId={clientId} year={year} month={month} accounts={accounts}/>}
        {clientId && tab === 'bg'       && <BGTab       api={api} clientId={clientId} year={year} month={month} accounts={accounts}/>}
      </div>
    </div>
  )
}
