// Cartera — Contabilidad client roster + per-client semáforo (Phase 1).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Search, X, Loader2, Building2, AlertCircle } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useRNC } from '../../hooks/useRNC'
import { applicableTemplates } from '@terminal-x/config/contabilidadCalendar.js'

const PERSONA_LABEL = { pf: 'Persona física', pj: 'Persona jurídica', eirl: 'EIRL' }
const REGIMEN_LABEL = { ordinario: 'Ordinario', rst: 'RST', pst: 'PST', sin_operaciones: 'Sin operaciones' }

function pendingForClient(obligations, clientId, year, month) {
  return (obligations || []).filter(o =>
    o.accounting_client_id === clientId &&
    o.period_year === year &&
    o.period_month === month &&
    o.status === 'pendiente'
  ).length
}

export default function Cartera() {
  const api = useAPI()
  const { lookup: rncLookup, lookupLoading: rncLoading } = useRNC()
  const [rows, setRows] = useState([])
  const [obligations, setObligations] = useState([])
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)

  const today = useMemo(() => new Date(), [])
  const year = today.getFullYear()
  const month = today.getMonth() + 1

  const reload = useCallback(async () => {
    if (!api?.contabilidad) return
    const [c, o] = await Promise.all([
      api.contabilidad.clientList(),
      api.contabilidad.obligationsList({ dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` }),
    ])
    setRows(c || [])
    setObligations(o || [])
  }, [api, year])

  useEffect(() => { reload() }, [reload])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return rows
    return rows.filter(r => (r.nombre_comercial || '').toLowerCase().includes(s) || (r.rnc || '').includes(s))
  }, [rows, search])

  async function save(input) {
    setBusy(true)
    try {
      if (editing?.id) {
        await api.contabilidad.clientUpdate(editing.id, input)
      } else {
        await api.contabilidad.clientCreate(input)
      }
      setEditing(null)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  async function generateYear(client) {
    if (!api?.contabilidad?.obligationsGenerateYear) return
    const templates = applicableTemplates({ regimen: client.regimen, persona: client.tipo_persona })
    setBusy(true)
    try {
      await api.contabilidad.obligationsGenerateYear({ accountingClientId: client.id, year, templates })
      await reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-black text-black dark:text-white">Cartera</h1>
        <button onClick={() => setEditing({})}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#b3001e] hover:bg-[#c8002a] text-white text-sm font-bold">
          <Plus size={16} /> Nuevo cliente
        </button>
      </div>

      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/40 dark:text-white/40" />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre o RNC"
          className="w-full pl-9 pr-3 py-2 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-black dark:text-white text-sm" />
      </div>

      <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-black text-white">
            <tr className="text-left">
              <th className="px-4 py-2 font-bold">Cliente</th>
              <th className="px-4 py-2 font-bold">RNC / Cédula</th>
              <th className="px-4 py-2 font-bold">Persona</th>
              <th className="px-4 py-2 font-bold">Régimen</th>
              <th className="px-4 py-2 font-bold">Honorarios</th>
              <th className="px-4 py-2 font-bold">Pendientes mes</th>
              <th className="px-4 py-2 font-bold text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan="7" className="px-4 py-10 text-center text-black/40 dark:text-white/40">
                <Building2 size={20} className="inline mr-2 text-[#b3001e]" />Sin clientes en cartera
              </td></tr>
            )}
            {filtered.map(r => {
              const pend = pendingForClient(obligations, r.id, year, month)
              return (
                <tr key={r.id} className="border-b border-black/5 dark:border-white/10 hover:bg-[#b3001e]/5">
                  <td className="px-4 py-2 font-bold text-black dark:text-white">{r.nombre_comercial}</td>
                  <td className="px-4 py-2 text-black/70 dark:text-white/70">{r.rnc || r.cedula || '—'}</td>
                  <td className="px-4 py-2 text-black/70 dark:text-white/70">{PERSONA_LABEL[r.tipo_persona] || r.tipo_persona}</td>
                  <td className="px-4 py-2 text-black/70 dark:text-white/70">{REGIMEN_LABEL[r.regimen] || r.regimen}</td>
                  <td className="px-4 py-2 text-black dark:text-white">RD$ {Number(r.honorarios_mensuales || 0).toFixed(2)}</td>
                  <td className="px-4 py-2">
                    {pend > 0
                      ? <span className="inline-flex items-center gap-1 text-[#b3001e] font-bold"><AlertCircle size={12} /> {pend}</span>
                      : <span className="text-black/40 dark:text-white/40">0</span>}
                  </td>
                  <td className="px-4 py-2 text-right space-x-2 whitespace-nowrap">
                    <button onClick={() => generateYear(r)}
                      className="px-2.5 py-1 rounded-lg border border-black/15 dark:border-white/15 text-xs text-black/70 dark:text-white/70 hover:border-[#b3001e] hover:text-[#b3001e]">
                      Generar {year}
                    </button>
                    <button onClick={() => setEditing(r)}
                      className="px-2.5 py-1 rounded-lg bg-black text-white text-xs hover:bg-[#b3001e] dark:bg-white dark:text-black dark:hover:bg-[#b3001e] dark:hover:text-white">
                      Editar
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <ClientModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={save}
          busy={busy}
          rncLookup={rncLookup}
          rncLoading={rncLoading}
        />
      )}
    </div>
  )
}

function ClientModal({ initial, onClose, onSave, busy, rncLookup, rncLoading }) {
  const [form, setForm] = useState({
    nombre_comercial: initial?.nombre_comercial || '',
    rnc: initial?.rnc || '',
    cedula: initial?.cedula || '',
    tipo_persona: initial?.tipo_persona || 'pj',
    regimen: initial?.regimen || 'ordinario',
    honorarios_mensuales: initial?.honorarios_mensuales || 0,
    notes: initial?.notes || '',
  })

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleRncBlur() {
    if (!form.rnc || form.nombre_comercial) return
    const r = await rncLookup(form.rnc)
    if (r?.razon_social) set('nombre_comercial', r.razon_social)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-black border border-black/10 dark:border-white/10 p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-black text-black dark:text-white">
            {initial?.id ? 'Editar cliente' : 'Nuevo cliente'}
          </h2>
          <button onClick={onClose} className="text-black/50 dark:text-white/50 hover:text-[#b3001e]"><X size={18} /></button>
        </div>

        <div className="space-y-3 text-sm">
          <Field label="Nombre comercial">
            <input value={form.nombre_comercial} onChange={(e) => set('nombre_comercial', e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="RNC">
              <div className="relative">
                <input value={form.rnc} onChange={(e) => set('rnc', e.target.value)} onBlur={handleRncBlur}
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white" />
                {rncLoading && <Loader2 size={12} className="absolute right-2 top-1/2 -translate-y-1/2 animate-spin text-[#b3001e]" />}
              </div>
            </Field>
            <Field label="Cédula">
              <input value={form.cedula} onChange={(e) => set('cedula', e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo de persona">
              <select value={form.tipo_persona} onChange={(e) => set('tipo_persona', e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white">
                <option value="pj">Persona jurídica</option>
                <option value="pf">Persona física</option>
                <option value="eirl">EIRL</option>
              </select>
            </Field>
            <Field label="Régimen">
              <select value={form.regimen} onChange={(e) => set('regimen', e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white">
                <option value="ordinario">Ordinario</option>
                <option value="rst">RST</option>
                <option value="pst">PST</option>
                <option value="sin_operaciones">Sin operaciones</option>
              </select>
            </Field>
          </div>
          <Field label="Honorarios mensuales (RD$)">
            <input type="number" min="0" step="0.01"
              value={form.honorarios_mensuales}
              onChange={(e) => set('honorarios_mensuales', Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white" />
          </Field>
          <Field label="Notas">
            <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white" />
          </Field>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-black/15 dark:border-white/15 text-sm text-black/70 dark:text-white/70 hover:border-[#b3001e]">Cancelar</button>
          <button disabled={busy || !form.nombre_comercial} onClick={() => onSave(form)}
            className="px-4 py-2 rounded-lg bg-[#b3001e] text-white text-sm font-bold disabled:opacity-50 hover:bg-[#c8002a]">
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50 mb-1">{label}</label>
      {children}
    </div>
  )
}
