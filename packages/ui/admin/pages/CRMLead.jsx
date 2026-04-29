import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Loader2, ArrowLeft, Save, MessageSquare, Phone, Mail, Calendar, UserCircle2, ExternalLink, Building2, Clock, Send, MessageCircle, Trash2 } from 'lucide-react'
import { listItem, buttonTap } from '../motion'

const STATUSES = ['new', 'contacted', 'qualified', 'demo_scheduled', 'proposal', 'won', 'lost']
const STATUS_LABEL = {
  es: { new: 'Nuevo', contacted: 'Contactado', qualified: 'Calificado', demo_scheduled: 'Demo agendada', proposal: 'Propuesta', won: 'Ganado', lost: 'Perdido' },
  en: { new: 'New',   contacted: 'Contacted',   qualified: 'Qualified',  demo_scheduled: 'Demo scheduled', proposal: 'Proposal',  won: 'Won',     lost: 'Lost' },
}
const KIND_LABEL = {
  es: { note: 'Nota', call: 'Llamada', whatsapp: 'WhatsApp', email: 'Email', status_change: 'Estado', assignment: 'Asignación', followup_set: 'Seguimiento' },
  en: { note: 'Note', call: 'Call',    whatsapp: 'WhatsApp', email: 'Email', status_change: 'Status',   assignment: 'Assignment', followup_set: 'Follow-up' },
}
const KIND_TONE = {
  note: 'bg-white/10 text-white/70',
  call: 'bg-blue-500/15 text-blue-400',
  whatsapp: 'bg-emerald-500/15 text-emerald-400',
  email: 'bg-amber-500/15 text-amber-400',
  status_change: 'bg-purple-500/15 text-purple-400',
  assignment: 'bg-cyan-500/15 text-cyan-400',
  followup_set: 'bg-[#b3001e]/15 text-[#b3001e]',
}

function fmtDateTime(iso, lang) {
  if (!iso) return ''
  return new Date(iso).toLocaleString(lang === 'es' ? 'es-DO' : 'en-US', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function whatsappLink(phone, msg) {
  const clean = (phone || '').replace(/\D/g, '')
  if (!clean) return null
  const full = clean.startsWith('1') ? clean : `1${clean}`
  return `https://wa.me/${full}${msg ? `?text=${encodeURIComponent(msg)}` : ''}`
}

export default function CRMLead({ getToken, isDark, lang }) {
  const navigate = useNavigate()
  const { id } = useParams()
  const L = (es, en) => lang === 'es' ? es : en

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [noteBody, setNoteBody] = useState('')
  const [noteKind, setNoteKind] = useState('note')
  const [posting, setPosting] = useState(false)

  useEffect(() => { load() }, [id])

  async function load() {
    setLoading(true)
    try {
      const resp = await fetch(`/api/panel?action=crm_detail&id=${id}`, { headers: { 'Authorization': `Bearer ${getToken()}` } })
      if (resp.ok) setData((await resp.json()).data)
    } catch (_) {}
    setLoading(false)
  }

  async function patch(patch) {
    setSaving(true)
    try {
      const resp = await fetch('/api/panel?action=crm_update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
        body: JSON.stringify({ id, ...patch }),
      })
      if (resp.ok) load()
    } catch (_) {}
    setSaving(false)
  }

  async function deleteLead() {
    const name = data?.lead?.business_name || data?.lead?.contact_name || data?.lead?.email || 'este lead'
    const business = data?.business
    const warn = business
      ? L(
          `¿Eliminar "${name}" del CRM?\n\nEsto NO borra la cuenta del cliente — solo lo saca de la lista de leads.`,
          `Delete "${name}" from CRM?\n\nThis does NOT delete the client account — it only removes them from the lead list.`,
        )
      : L(`¿Eliminar "${name}" del CRM? Esta acción no se puede deshacer.`, `Delete "${name}" from CRM? This cannot be undone.`)
    if (!window.confirm(warn)) return
    try {
      const resp = await fetch('/api/panel?action=crm_delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
        body: JSON.stringify({ id }),
      })
      if (resp.ok) navigate('/admin/crm')
      else window.alert(L('No se pudo eliminar.', 'Could not delete.'))
    } catch (_) { window.alert(L('No se pudo eliminar.', 'Could not delete.')) }
  }

  async function addNote() {
    if (!noteBody.trim()) return
    setPosting(true)
    try {
      const resp = await fetch('/api/panel?action=crm_note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
        body: JSON.stringify({ lead_id: id, kind: noteKind, body: noteBody.trim() }),
      })
      if (resp.ok) { setNoteBody(''); load() }
    } catch (_) {}
    setPosting(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin text-[#b3001e]" />
      </div>
    )
  }

  if (!data?.lead) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <button onClick={() => navigate('/admin/crm')} className={`flex items-center gap-1 text-sm mb-4 ${isDark ? 'text-white/60 hover:text-white' : 'text-slate-500 hover:text-slate-900'}`}>
          <ArrowLeft size={14} /> CRM
        </button>
        <p className={isDark ? 'text-white/60' : 'text-slate-500'}>{L('Lead no encontrado.', 'Lead not found.')}</p>
      </div>
    )
  }

  const { lead, activity, admins, business } = data
  const cardBase = isDark ? 'bg-white/[0.03] border-white/10' : 'bg-white border-slate-200'
  const inputBase = isDark
    ? 'bg-black border-white/10 text-white placeholder-white/40 focus:border-[#b3001e]'
    : 'bg-white border-slate-200 text-slate-900 placeholder-slate-400 focus:border-[#b3001e]'
  const labelBase = `block text-[10px] font-bold uppercase tracking-wider mb-1 ${isDark ? 'text-white/60' : 'text-slate-500'}`

  const overdue = lead.next_followup_at && new Date(lead.next_followup_at) < new Date()
  const wa = whatsappLink(lead.phone, L(`Hola ${lead.contact_name || lead.business_name || ''}, te contacto desde Terminal X sobre el plan que solicitaste.`, `Hi ${lead.contact_name || lead.business_name || ''}, reaching out from Terminal X about the plan you requested.`))

  return (
    <div className="p-4 sm:p-6 max-w-[1300px] mx-auto space-y-4">
      <button onClick={() => navigate('/admin/crm')} className={`flex items-center gap-1 text-sm ${isDark ? 'text-white/60 hover:text-white' : 'text-slate-500 hover:text-slate-900'}`}>
        <ArrowLeft size={14} /> CRM
      </button>

      {/* Header */}
      <div className={`rounded-xl border p-5 ${cardBase}`}>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>
              {lead.business_name || lead.contact_name || L('Sin nombre', 'Unnamed')}
            </h1>
            <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[12px] ${isDark ? 'text-white/70' : 'text-slate-600'}`}>
              {lead.email && <span className="flex items-center gap-1.5"><Mail size={12} /> <a href={`mailto:${lead.email}`} className="hover:text-[#b3001e]">{lead.email}</a></span>}
              {lead.phone && <span className="flex items-center gap-1.5"><Phone size={12} /> {lead.phone}</span>}
              {lead.rnc && <span className="flex items-center gap-1.5"><Building2 size={12} /> RNC {lead.rnc}</span>}
              <span className={`flex items-center gap-1.5 ${isDark ? 'text-white/40' : 'text-slate-400'}`}><Clock size={12} /> {fmtDateTime(lead.created_at, lang)}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {wa && (
              <motion.a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                {...buttonTap}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 text-[12px] font-bold transition-colors"
              >
                <MessageCircle size={14} /> WhatsApp <ExternalLink size={11} />
              </motion.a>
            )}
            {lead.email && (
              <motion.a
                href={`mailto:${lead.email}`}
                {...buttonTap}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border border-amber-500/30 text-[12px] font-bold transition-colors"
              >
                <Mail size={14} /> Email
              </motion.a>
            )}
            {business && (
              <motion.button
                onClick={() => navigate(`/admin/clients/${business.id}`)}
                {...buttonTap}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#b3001e]/15 hover:bg-[#b3001e]/25 text-[#b3001e] border border-[#b3001e]/30 text-[12px] font-bold transition-colors"
              >
                <Building2 size={14} /> {L('Ver cliente', 'View client')}
              </motion.button>
            )}
            <motion.button
              onClick={deleteLead}
              {...buttonTap}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/30 text-[12px] font-bold transition-colors"
              title={L('Eliminar del CRM (no borra la cuenta del cliente)', 'Delete from CRM (does not delete client account)')}
            >
              <Trash2 size={14} /> {L('Eliminar', 'Delete')}
            </motion.button>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[320px_1fr] gap-4">
        {/* Sidebar — controls */}
        <div className="space-y-4">
          <div className={`rounded-xl border p-4 space-y-3 ${cardBase}`}>
            <div>
              <label className={labelBase}>{L('Estado', 'Status')}</label>
              <select
                value={lead.status}
                disabled={saving}
                onChange={e => patch({ status: e.target.value })}
                className={`w-full px-3 py-2 rounded-lg border text-sm outline-none ${inputBase}`}
              >
                {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[lang][s]}</option>)}
              </select>
            </div>
            <div>
              <label className={labelBase}>{L('Asignado a', 'Assigned to')}</label>
              <select
                value={lead.assigned_to || ''}
                disabled={saving}
                onChange={e => patch({ assigned_to: e.target.value || null })}
                className={`w-full px-3 py-2 rounded-lg border text-sm outline-none ${inputBase}`}
              >
                <option value="">{L('Sin asignar', 'Unassigned')}</option>
                {admins.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelBase}>{L('Próximo seguimiento', 'Next follow-up')}</label>
              <input
                type="date"
                value={lead.next_followup_at ? lead.next_followup_at.slice(0, 10) : ''}
                disabled={saving}
                onChange={e => patch({ next_followup_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
                className={`w-full px-3 py-2 rounded-lg border text-sm outline-none ${inputBase} ${overdue ? 'border-[#b3001e]' : ''}`}
              />
              {overdue && <p className="text-[10px] text-[#b3001e] mt-1 font-bold uppercase tracking-wider">{L('Atrasado', 'Overdue')}</p>}
            </div>
            <div>
              <label className={labelBase}>{L('Plan de interés', 'Plan of interest')}</label>
              <select
                value={lead.requested_plan || ''}
                disabled={saving}
                onChange={e => patch({ requested_plan: e.target.value || null })}
                className={`w-full px-3 py-2 rounded-lg border text-sm outline-none ${inputBase}`}
              >
                <option value="">—</option>
                <option value="facturacion">Facturación</option>
                <option value="pro">Pro</option>
                <option value="pro_plus">Pro PLUS</option>
                <option value="pro_max">Pro MAX</option>
              </select>
            </div>
          </div>

          <div className={`rounded-xl border p-4 space-y-2 text-[11px] ${cardBase}`}>
            <h3 className={`font-bold uppercase tracking-wider text-[10px] ${isDark ? 'text-white/50' : 'text-slate-500'}`}>{L('Origen', 'Source')}</h3>
            <div className={isDark ? 'text-white/70' : 'text-slate-700'}>
              <div className="flex justify-between"><span className={isDark ? 'text-white/50' : 'text-slate-400'}>{L('Tipo', 'Type')}</span><span>{lead.source}</span></div>
              {lead.utm_source && <div className="flex justify-between"><span className={isDark ? 'text-white/50' : 'text-slate-400'}>UTM source</span><span>{lead.utm_source}</span></div>}
              {lead.utm_medium && <div className="flex justify-between"><span className={isDark ? 'text-white/50' : 'text-slate-400'}>UTM medium</span><span>{lead.utm_medium}</span></div>}
              {lead.utm_campaign && <div className="flex justify-between"><span className={isDark ? 'text-white/50' : 'text-slate-400'}>UTM campaign</span><span>{lead.utm_campaign}</span></div>}
              {lead.business_type && <div className="flex justify-between"><span className={isDark ? 'text-white/50' : 'text-slate-400'}>{L('Tipo negocio', 'Business type')}</span><span>{lead.business_type}</span></div>}
              {lead.last_contacted_at && <div className="flex justify-between"><span className={isDark ? 'text-white/50' : 'text-slate-400'}>{L('Último contacto', 'Last contact')}</span><span>{fmtDateTime(lead.last_contacted_at, lang)}</span></div>}
            </div>
          </div>
        </div>

        {/* Activity feed + note input */}
        <div className="space-y-4">
          <div className={`rounded-xl border p-4 ${cardBase}`}>
            <h3 className={`font-bold uppercase tracking-wider text-[10px] mb-3 ${isDark ? 'text-white/50' : 'text-slate-500'}`}>
              {L('Registrar actividad', 'Log activity')}
            </h3>
            <div className="flex gap-2 mb-2 flex-wrap">
              {['note', 'call', 'whatsapp', 'email'].map(k => (
                <button
                  key={k}
                  onClick={() => setNoteKind(k)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                    noteKind === k ? KIND_TONE[k] + ' ring-1 ring-current' : isDark ? 'bg-white/5 text-white/50 hover:bg-white/10' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  {KIND_LABEL[lang][k]}
                </button>
              ))}
            </div>
            <textarea
              value={noteBody}
              onChange={e => setNoteBody(e.target.value)}
              rows={3}
              placeholder={L('Escribe lo que pasó en este contacto…', 'What happened on this contact…')}
              className={`w-full px-3 py-2 rounded-lg border text-sm outline-none transition-colors ${inputBase}`}
            />
            <div className="flex justify-end mt-2">
              <motion.button
                {...buttonTap}
                onClick={addNote}
                disabled={posting || !noteBody.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#b3001e] hover:bg-[#8c0017] text-white text-[12px] font-bold disabled:opacity-50 transition-colors"
              >
                {posting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                {L('Registrar', 'Log')}
              </motion.button>
            </div>
          </div>

          <div className={`rounded-xl border ${cardBase}`}>
            <div className={`p-4 border-b ${isDark ? 'border-white/10' : 'border-slate-100'}`}>
              <h3 className={`font-bold uppercase tracking-wider text-[10px] ${isDark ? 'text-white/50' : 'text-slate-500'}`}>
                {L('Línea de tiempo', 'Timeline')} <span className="opacity-60">({activity.length})</span>
              </h3>
            </div>
            <div>
              {activity.length === 0 ? (
                <div className={`p-8 text-center text-[12px] ${isDark ? 'text-white/40' : 'text-slate-400'}`}>
                  {L('Sin actividad aún. Registra una llamada, WhatsApp o nota arriba.', 'No activity yet. Log a call, WhatsApp, or note above.')}
                </div>
              ) : (
                <ul className="divide-y divide-current/0">
                  {activity.map(a => (
                    <motion.li
                      key={a.id}
                      variants={listItem}
                      initial="initial"
                      animate="animate"
                      className={`p-4 ${isDark ? 'border-b border-white/5 last:border-0' : 'border-b border-slate-100 last:border-0'}`}
                    >
                      <div className="flex items-start gap-3">
                        <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-bold ${KIND_TONE[a.kind] || KIND_TONE.note}`}>
                          {KIND_LABEL[lang][a.kind] || a.kind}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className={`text-[13px] whitespace-pre-wrap break-words ${isDark ? 'text-white/90' : 'text-slate-800'}`}>{a.body}</div>
                          <div className={`text-[10px] mt-1 flex items-center gap-2 ${isDark ? 'text-white/40' : 'text-slate-400'}`}>
                            <UserCircle2 size={10} /> {a.admin_name || '—'}
                            <span>·</span>
                            {fmtDateTime(a.created_at, lang)}
                          </div>
                        </div>
                      </div>
                    </motion.li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
