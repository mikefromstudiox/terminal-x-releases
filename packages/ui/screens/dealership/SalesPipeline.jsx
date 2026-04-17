/**
 * SalesPipeline.jsx — Dealership lead kanban (Prospectos).
 *
 * Stages: lead → test_drive → negotiation → financing → closed (+ lost).
 * Owner/manager/cashier can move a card. Closed cards archive.
 */

import { useState, useEffect } from 'react'
import { Plus, X, Loader2, User, Phone, Car, DollarSign, Trash2, ChevronRight, ChevronLeft } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'

const STAGES = [
  { v: 'lead',         es: 'Prospecto',   en: 'Lead' },
  { v: 'test_drive',   es: 'Prueba de Manejo', en: 'Test Drive' },
  { v: 'negotiation',  es: 'Negociación', en: 'Negotiation' },
  { v: 'financing',    es: 'Financiamiento', en: 'Financing' },
  { v: 'closed',       es: 'Cerrado',     en: 'Closed' },
]
const SOURCES = [
  { v: 'walk_in',  es: 'Visita en Local', en: 'Walk-in' },
  { v: 'whatsapp', es: 'WhatsApp',        en: 'WhatsApp' },
  { v: 'web',      es: 'Web',             en: 'Web' },
  { v: 'referral', es: 'Referido',        en: 'Referral' },
  { v: 'other',    es: 'Otro',            en: 'Other' },
]

function fmtRD(n) { return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}` }

function LeadModal({ lead, lang, onSave, onClose }) {
  const L = (es, en) => lang === 'es' ? es : en
  const [form, setForm] = useState({
    name:   lead?.name   || '',
    phone:  lead?.phone  || '',
    email:  lead?.email  || '',
    source: lead?.source || 'walk_in',
    budget: lead?.budget || '',
    notes:  lead?.notes  || '',
    stage:  lead?.stage  || 'lead',
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function submit(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try { await onSave({ ...form, budget: form.budget ? Number(form.budget) : null }); onClose() }
    catch { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white border border-black max-w-lg w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-black">
          <h2 className="text-xl font-bold">{lead ? L('Editar Prospecto', 'Edit Lead') : L('Nuevo Prospecto', 'New Lead')}</h2>
          <button onClick={onClose} className="p-1 hover:bg-black hover:text-white"><X size={20} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3">
          <label className="block"><span className="text-xs font-semibold">{L('Nombre', 'Name')}*</span>
            <input value={form.name} onChange={e => set('name', e.target.value)} required className="mt-1 w-full border border-black px-2 py-1.5" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="text-xs font-semibold">{L('Teléfono', 'Phone')}</span>
              <input value={form.phone} onChange={e => set('phone', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
            </label>
            <label className="block"><span className="text-xs font-semibold">Email</span>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="text-xs font-semibold">{L('Origen', 'Source')}</span>
              <select value={form.source} onChange={e => set('source', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5">
                {SOURCES.map(s => <option key={s.v} value={s.v}>{lang === 'es' ? s.es : s.en}</option>)}
              </select>
            </label>
            <label className="block"><span className="text-xs font-semibold">{L('Presupuesto', 'Budget')} RD$</span>
              <input type="number" value={form.budget} onChange={e => set('budget', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
            </label>
          </div>
          <label className="block"><span className="text-xs font-semibold">{L('Notas', 'Notes')}</span>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} className="mt-1 w-full border border-black px-2 py-1.5" />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-black">{L('Cancelar', 'Cancel')}</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-black text-white disabled:opacity-50 inline-flex items-center gap-2">
              {saving && <Loader2 size={16} className="animate-spin" />}{L('Guardar', 'Save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function SalesPipeline() {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)

  async function load() {
    setLoading(true)
    const rows = await api.leads.list()
    setLeads(rows || [])
    setLoading(false)
  }
  useEffect(() => { load() }, []) // eslint-disable-line

  async function save(data) {
    if (editing) await api.leads.update(editing.id, data)
    else         await api.leads.create(data)
    await load()
  }
  async function move(lead, direction) {
    const idx = STAGES.findIndex(s => s.v === lead.stage)
    const nextIdx = Math.max(0, Math.min(STAGES.length - 1, idx + direction))
    if (nextIdx === idx) return
    await api.leads.setStage(lead.id, STAGES[nextIdx].v)
    await load()
  }
  async function remove(lead) {
    if (!confirm(L(`¿Eliminar prospecto ${lead.name}?`, `Delete lead ${lead.name}?`))) return
    await api.leads.delete(lead.id); await load()
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">{L('Prospectos', 'Sales Pipeline')}</h1>
          <p className="text-sm text-black/70 mt-1">{L('Seguimiento de clientes potenciales por etapa.', 'Track potential buyers by stage.')}</p>
        </div>
        <button onClick={() => { setEditing(null); setShowModal(true) }} className="px-4 py-2 bg-black text-white inline-flex items-center gap-2"><Plus size={18} />{L('Nuevo Prospecto', 'New Lead')}</button>
      </div>

      {loading ? (
        <div className="p-12 text-center"><Loader2 className="animate-spin mx-auto" /></div>
      ) : (
        <div className="grid grid-cols-5 gap-3">
          {STAGES.map(stage => {
            const items = leads.filter(l => l.stage === stage.v)
            return (
              <div key={stage.v} className="border border-black bg-white">
                <div className="bg-black text-white px-3 py-2 flex items-center justify-between">
                  <span className="font-semibold text-sm">{lang === 'es' ? stage.es : stage.en}</span>
                  <span className="text-xs bg-white text-black px-2 py-0.5">{items.length}</span>
                </div>
                <div className="p-2 space-y-2 min-h-[300px]">
                  {items.map(lead => (
                    <div key={lead.id} className="border border-black p-2 bg-white">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-sm truncate">{lead.name}</div>
                        <button onClick={() => remove(lead)} className="p-0.5 hover:bg-[#b3001e] hover:text-white"><Trash2 size={12} /></button>
                      </div>
                      {lead.phone && <div className="text-xs flex items-center gap-1 mt-1"><Phone size={10} />{lead.phone}</div>}
                      {lead.budget && <div className="text-xs flex items-center gap-1"><DollarSign size={10} />{fmtRD(lead.budget)}</div>}
                      {lead.notes && <div className="text-xs text-black/70 mt-1 line-clamp-2">{lead.notes}</div>}
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-black/10">
                        <button onClick={() => move(lead, -1)} disabled={lead.stage === STAGES[0].v} className="p-0.5 disabled:opacity-20 hover:bg-black hover:text-white"><ChevronLeft size={14} /></button>
                        <button onClick={() => { setEditing(lead); setShowModal(true) }} className="text-xs underline">{L('Editar', 'Edit')}</button>
                        <button onClick={() => move(lead, 1)} disabled={lead.stage === STAGES[STAGES.length-1].v} className="p-0.5 disabled:opacity-20 hover:bg-black hover:text-white"><ChevronRight size={14} /></button>
                      </div>
                    </div>
                  ))}
                  {items.length === 0 && <div className="text-xs text-black/40 text-center py-4">—</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showModal && <LeadModal lead={editing} lang={lang} onSave={save} onClose={() => setShowModal(false)} />}
    </div>
  )
}
