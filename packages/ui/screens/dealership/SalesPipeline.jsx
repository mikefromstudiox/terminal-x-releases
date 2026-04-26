/**
 * SalesPipeline.jsx — Dealership lead kanban (Prospectos).
 *
 * Stages: lead → test_drive → negotiation → financing → closed (+ lost).
 * Owner/manager/cashier can move a card. Closed cards archive.
 */

import { useState, useEffect, useMemo } from 'react'
import { Plus, X, Loader2, User, Phone, Car, DollarSign, Trash2, ChevronRight, ChevronLeft, AlertTriangle, Calendar, MessageSquare, MessageCircle, Flame, ArrowUpDown } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'
import DateTimeModal from '../../components/DateTimeModal'
import { sendFollowupOverdue } from '../../../services/whatsapp-dealership.js'
import WabaStubBanner from '../../components/WabaStubBanner'

const STAGES = [
  { v: 'lead',         es: 'Prospecto',   en: 'Lead' },
  { v: 'test_drive',   es: 'Prueba de Manejo', en: 'Test Drive' },
  { v: 'negotiation',  es: 'Negociación', en: 'Negotiation' },
  { v: 'financing',    es: 'Financiamiento', en: 'Financing' },
  { v: 'closed',       es: 'Cerrado',     en: 'Closed' },
]
const TERMINAL_STAGES = ['closed', 'lost']

function isOverdue(lead) {
  if (!lead.next_followup_at) return false
  if (TERMINAL_STAGES.includes(lead.stage)) return false
  return new Date(lead.next_followup_at).getTime() < Date.now()
}
function fmtDate(s) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('es-DO', { day: '2-digit', month: 'short' })
}
const SOURCES = [
  { v: 'walk_in',  es: 'Visita en Local', en: 'Walk-in' },
  { v: 'whatsapp', es: 'WhatsApp',        en: 'WhatsApp' },
  { v: 'web',      es: 'Web',             en: 'Web' },
  { v: 'referral', es: 'Referido',        en: 'Referral' },
  { v: 'other',    es: 'Otro',            en: 'Other' },
]

function fmtRD(n) { return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}` }

// v2.16.2 Sprint 2E item 3 — Lead scoring.
// Scale: 0-100. Buckets: 0-39 cold (Frio), 40-69 warm (Tibio), 70+ hot (Caliente).
// Inputs: lead row + map { client_id -> [testDrives] }. Pure function — easy to
// test and reasonable to recompute on every render (lead count rarely > 200).
function scoreLead(lead, testDrivesByClient) {
  if (!lead) return 0
  let score = 0
  if (Number(lead.budget) > 0) score += 20
  if (lead.stage === 'negotiation' || lead.stage === 'financing') score += 20
  if (lead.phone && String(lead.phone).trim()) score += 10
  // Test drive boost — any COMPLETED drive for the client gets +30.
  const cid = lead.client_id || lead.client_supabase_id
  if (cid) {
    const drives = testDrivesByClient.get(cid) || []
    if (drives.some(td => td.status === 'completed' || td.completed_at)) score += 30
  }
  // Overdue penalty supersedes the not-overdue bonus.
  if (isOverdue(lead)) score -= 30
  else                 score += 20
  return Math.max(0, Math.min(100, score))
}
function leadHeat(score) {
  if (score >= 70) return { level: 'hot',  es: 'Caliente', en: 'Hot',  color: 'bg-[#b3001e] text-white' }
  if (score >= 40) return { level: 'warm', es: 'Tibio',    en: 'Warm', color: 'bg-amber-500 text-white' }
  return                  { level: 'cold', es: 'Frio',     en: 'Cold', color: 'bg-slate-400 text-white' }
}

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
    next_followup_at: lead?.next_followup_at ? new Date(lead.next_followup_at).toISOString().slice(0, 16) : '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function submit(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try {
      await onSave({
        ...form,
        budget: form.budget ? Number(form.budget) : null,
        next_followup_at: form.next_followup_at ? new Date(form.next_followup_at).toISOString() : null,
      })
      onClose()
    } catch { setSaving(false) }
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
          <label className="block"><span className="text-xs font-semibold flex items-center gap-1"><Calendar size={12}/>{L('Próximo Seguimiento', 'Next Follow-up')}</span>
            <input type="datetime-local" value={form.next_followup_at} onChange={e => set('next_followup_at', e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5"/>
          </label>
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
  const [staff, setStaff] = useState([])
  const [testDrives, setTestDrives] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  // v2.16.2 Sprint 2E — sort + hot-only filter
  const [sortKey, setSortKey] = useState('score') // 'score' | 'next_followup_at' | 'created_at'
  const [hotOnly, setHotOnly] = useState(false)
  // Follow-up date picker state — replaces the legacy `prompt()` so the cashier
  // gets a real native calendar instead of typing "YYYY-MM-DD HH:MM" by hand.
  const [followupCtx, setFollowupCtx] = useState(null)  // { lead, initial }

  async function load() {
    setLoading(true)
    const [rows, emp, td] = await Promise.all([
      api.leads.list(),
      api.empleados?.list?.() || api.empleados?.all?.() || Promise.resolve([]),
      api.testDrives?.list?.() || api.testDrives?.all?.() || Promise.resolve([]),
    ])
    setLeads(rows || [])
    setStaff(emp || [])
    setTestDrives(td || [])
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
  function logContact(lead) {
    // Default the picker to "now + 3 days" — the most common follow-up cadence
    // dealerships actually use; cashier can still pick anything.
    const initial = lead.next_followup_at || new Date(Date.now() + 3 * 86400000).toISOString()
    setFollowupCtx({ lead, initial })
  }
  async function confirmFollowup(iso) {
    const ctx = followupCtx
    setFollowupCtx(null)
    if (!ctx) return
    await api.leads.logContact(ctx.lead.id, { nextFollowupAt: iso || null })
    await load()
  }

  const overdueCount = leads.filter(isOverdue).length

  // Pre-index test drives by client for O(1) lookup during scoring.
  const testDrivesByClient = useMemo(() => {
    const m = new Map()
    for (const td of testDrives) {
      const key = td.client_id || td.client_supabase_id
      if (!key) continue
      const arr = m.get(key) || []
      arr.push(td)
      m.set(key, arr)
    }
    return m
  }, [testDrives])

  // Score every lead once, attach to row.
  const scoredLeads = useMemo(() => leads.map(l => ({ ...l, _score: scoreLead(l, testDrivesByClient) })), [leads, testDrivesByClient])
  const hotCount = useMemo(() => scoredLeads.filter(l => l._score >= 70 && !TERMINAL_STAGES.includes(l.stage)).length, [scoredLeads])

  function sortLeads(arr) {
    const copy = arr.slice()
    if (sortKey === 'score') copy.sort((a, b) => b._score - a._score)
    else if (sortKey === 'next_followup_at') {
      copy.sort((a, b) => {
        const ta = a.next_followup_at ? new Date(a.next_followup_at).getTime() : Infinity
        const tb = b.next_followup_at ? new Date(b.next_followup_at).getTime() : Infinity
        return ta - tb
      })
    } else { // created_at
      copy.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    }
    return copy
  }
  const filteredLeads = hotOnly ? scoredLeads.filter(l => l._score >= 70) : scoredLeads

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      {/* v2.16.7 — WABA-status honesty banner (whatsapp_auto stub). */}
      <WabaStubBanner />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">{L('Prospectos', 'Sales Pipeline')}</h1>
          <p className="text-sm text-black/70 mt-1">{L('Seguimiento de clientes potenciales por etapa.', 'Track potential buyers by stage.')}</p>
          {overdueCount > 0 && (
            <div className="inline-flex items-center gap-1 mt-2 px-2 py-1 bg-[#b3001e] text-white text-xs font-semibold">
              <AlertTriangle size={12}/>{L(`${overdueCount} con seguimiento vencido`, `${overdueCount} overdue follow-ups`)}
            </div>
          )}
          {hotCount > 0 && (
            <button
              onClick={() => setHotOnly(h => !h)}
              title={L('Filtrar solo leads calientes', 'Filter hot leads only')}
              className={`ml-2 inline-flex items-center gap-1 mt-2 px-2 py-1 text-xs font-semibold transition-colors ${
                hotOnly ? 'bg-[#b3001e] text-white' : 'bg-white text-[#b3001e] border border-[#b3001e]'
              }`}
            >
              <Flame size={12}/>{L(`${hotCount} leads calientes`, `${hotCount} hot leads`)}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-1 text-xs">
            <ArrowUpDown size={12} className="text-black/60" />
            <select value={sortKey} onChange={e => setSortKey(e.target.value)} className="border border-black px-2 py-1.5">
              <option value="score">{L('Score', 'Score')}</option>
              <option value="next_followup_at">{L('Proximo seguimiento', 'Next follow-up')}</option>
              <option value="created_at">{L('Fecha creacion', 'Created date')}</option>
            </select>
          </label>
          <button onClick={() => { setEditing(null); setShowModal(true) }} className="px-4 py-2 bg-black text-white inline-flex items-center gap-2"><Plus size={18} />{L('Nuevo Prospecto', 'New Lead')}</button>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center"><Loader2 className="animate-spin mx-auto" /></div>
      ) : (
        <div className="grid grid-cols-5 gap-3">
          {STAGES.map(stage => {
            const items = sortLeads(filteredLeads.filter(l => l.stage === stage.v))
            return (
              <div key={stage.v} className="border border-black bg-white">
                <div className="bg-black text-white px-3 py-2 flex items-center justify-between">
                  <span className="font-semibold text-sm">{lang === 'es' ? stage.es : stage.en}</span>
                  <span className="text-xs bg-white text-black px-2 py-0.5">{items.length}</span>
                </div>
                <div className="p-2 space-y-2 min-h-[300px]">
                  {items.map(lead => {
                    const overdue = isOverdue(lead)
                    const heat = leadHeat(lead._score)
                    const showHeat = !TERMINAL_STAGES.includes(lead.stage)
                    return (
                    <div key={lead.id} className={`border p-2 bg-white ${overdue ? 'border-[#b3001e] border-l-4' : 'border-black'}`}>
                      <div className="flex items-center justify-between gap-1">
                        <div className="font-semibold text-sm truncate flex-1">{lead.name}</div>
                        {showHeat && (
                          <span title={L(`Score ${lead._score}`, `Score ${lead._score}`)}
                            className={`text-[9px] px-1.5 py-0.5 font-bold ${heat.color}`}>
                            {lang === 'es' ? heat.es : heat.en}
                          </span>
                        )}
                        <button onClick={() => remove(lead)} className="p-0.5 hover:bg-[#b3001e] hover:text-white"><Trash2 size={12} /></button>
                      </div>
                      {lead.phone && <div className="text-xs flex items-center gap-1 mt-1"><Phone size={10} />{lead.phone}</div>}
                      {lead.budget && <div className="text-xs flex items-center gap-1"><DollarSign size={10} />{fmtRD(lead.budget)}</div>}
                      {lead.next_followup_at && (
                        <div className={`text-xs flex items-center gap-1 mt-1 ${overdue ? 'text-[#b3001e] font-semibold' : ''}`}>
                          <Calendar size={10}/>
                          {overdue ? L('Vencido', 'Overdue') + ' · ' : ''}{fmtDate(lead.next_followup_at)}
                        </div>
                      )}
                      {lead.notes && <div className="text-xs text-black/70 mt-1 line-clamp-2">{lead.notes}</div>}
                      {overdue && (
                        <button
                          onClick={() => {
                            const sp = staff.find(s => s.phone && (s.role === 'owner' || s.role === 'manager' || s.tipo === 'vendedor')) || staff.find(s => s.phone)
                            if (!sp) { alert(L('No hay vendedor con telefono registrado.', 'No salesperson with a phone on file.')); return }
                            const ok = sendFollowupOverdue(lead, sp)
                            if (!ok) alert(L('No se pudo abrir WhatsApp.', 'Could not open WhatsApp.'))
                          }}
                          title={L('Avisar al vendedor por WhatsApp', 'Ping salesperson on WhatsApp')}
                          className="mt-1 w-full px-2 py-0.5 text-[10px] border border-[#b3001e] text-[#b3001e] inline-flex items-center justify-center gap-1 hover:bg-emerald-600 hover:text-white hover:border-emerald-600"
                        >
                          <MessageCircle size={10}/>{L('WhatsApp vendedor', 'WhatsApp seller')}
                        </button>
                      )}
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-black/10">
                        <button onClick={() => move(lead, -1)} disabled={lead.stage === STAGES[0].v} className="p-0.5 disabled:opacity-20 hover:bg-black hover:text-white"><ChevronLeft size={14} /></button>
                        <button onClick={() => logContact(lead)} title={L('Registrar seguimiento', 'Log follow-up')} className="p-0.5 hover:bg-black hover:text-white"><MessageSquare size={12}/></button>
                        <button onClick={() => { setEditing(lead); setShowModal(true) }} className="text-xs underline">{L('Editar', 'Edit')}</button>
                        <button onClick={() => move(lead, 1)} disabled={lead.stage === STAGES[STAGES.length-1].v} className="p-0.5 disabled:opacity-20 hover:bg-black hover:text-white"><ChevronRight size={14} /></button>
                      </div>
                    </div>
                    )
                  })}
                  {items.length === 0 && <div className="text-xs text-black/40 text-center py-4">—</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showModal && <LeadModal lead={editing} lang={lang} onSave={save} onClose={() => setShowModal(false)} />}

      <DateTimeModal
        open={!!followupCtx}
        title={L('Próximo seguimiento', 'Next follow-up')}
        initialValue={followupCtx?.initial}
        minDate={new Date().toISOString()}
        onConfirm={confirmFollowup}
        onCancel={() => setFollowupCtx(null)}
      />
    </div>
  )
}
