import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Loader2, Search, Plus, Filter, UserCircle2, Phone, Mail, Building2, Clock, Calendar, X } from 'lucide-react'
import { listContainer, listItem, modalBackdrop, modalPanel, buttonTap } from '../motion'

const STATUSES = ['new', 'contacted', 'qualified', 'demo_scheduled', 'proposal', 'won', 'lost']
const STATUS_LABEL = {
  es: { new: 'Nuevo', contacted: 'Contactado', qualified: 'Calificado', demo_scheduled: 'Demo agendada', proposal: 'Propuesta', won: 'Ganado', lost: 'Perdido' },
  en: { new: 'New',   contacted: 'Contacted',   qualified: 'Qualified',  demo_scheduled: 'Demo scheduled', proposal: 'Proposal',  won: 'Won',     lost: 'Lost' },
}
const STATUS_TONE = {
  new: 'bg-[#b3001e]/15 text-[#b3001e] border-[#b3001e]/30',
  contacted: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  qualified: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  demo_scheduled: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  proposal: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  won: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  lost: 'bg-white/10 text-white/50 border-white/20',
}
const PLAN_LABEL = { facturacion: 'Facturación', pro: 'Pro', pro_plus: 'Pro PLUS', pro_max: 'Pro MAX' }

function relTime(iso, lang) {
  if (!iso) return ''
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return lang === 'es' ? 'ahora' : 'now'
  if (m < 60) return lang === 'es' ? `hace ${m}m` : `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return lang === 'es' ? `hace ${h}h` : `${h}h ago`
  const days = Math.floor(h / 24)
  if (days < 30) return lang === 'es' ? `hace ${days}d` : `${days}d ago`
  return d.toLocaleDateString(lang === 'es' ? 'es-DO' : 'en-US', { day: '2-digit', month: 'short' })
}

const EMPTY_FORM = { contact_name: '', business_name: '', email: '', phone: '', rnc: '', requested_plan: 'facturacion' }

export default function CRM({ getToken, isDark, lang }) {
  const navigate = useNavigate()
  const L = (es, en) => lang === 'es' ? es : en
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterPlan, setFilterPlan] = useState('')
  const [filterAssigned, setFilterAssigned] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [adding, setAdding] = useState(false)

  useEffect(() => { load() }, [filterStatus, filterPlan, filterAssigned])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ action: 'crm_list' })
      if (filterStatus) params.set('status', filterStatus)
      if (filterPlan) params.set('plan', filterPlan)
      if (filterAssigned) params.set('assigned_to', filterAssigned)
      const resp = await fetch(`/api/panel?${params}`, { headers: { 'Authorization': `Bearer ${getToken()}` } })
      if (resp.ok) setList((await resp.json()).data || [])
    } catch (_) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_, { severity: 'error', category: 'crm.reltime' }) } catch {}}
    setLoading(false)
  }

  async function createLead() {
    if (!form.business_name.trim() && !form.contact_name.trim()) return
    setAdding(true)
    try {
      const resp = await fetch('/api/panel?action=crm_create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
        body: JSON.stringify(form),
      })
      if (resp.ok) {
        setShowAdd(false)
        setForm(EMPTY_FORM)
        load()
      }
    } catch (_) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_, { severity: 'error', category: 'crm.reltime' }) } catch {}}
    setAdding(false)
  }

  const filtered = useMemo(() => {
    if (!search) return list
    const s = search.toLowerCase()
    return list.filter(l =>
      (l.business_name || '').toLowerCase().includes(s)
      || (l.email || '').toLowerCase().includes(s)
      || (l.phone || '').includes(s)
      || (l.rnc || '').includes(s)
    )
  }, [list, search])

  const counts = useMemo(() => {
    const c = { all: list.length }
    for (const s of STATUSES) c[s] = 0
    for (const l of list) if (c[l.status] !== undefined) c[l.status]++
    return c
  }, [list])

  const cardBase = isDark ? 'bg-white/[0.03] border-white/10' : 'bg-white border-slate-200'
  const inputBase = isDark
    ? 'bg-black border-white/10 text-white placeholder-white/40 focus:border-[#b3001e]'
    : 'bg-white border-slate-200 text-slate-900 placeholder-slate-400 focus:border-[#b3001e]'

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-[1500px] mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>CRM</h1>
          <p className={`text-xs mt-0.5 ${isDark ? 'text-white/50' : 'text-slate-500'}`}>
            {L('Pipeline de ventas — leads de signup + manuales', 'Sales pipeline — signup leads + manual')}
          </p>
        </div>
        <motion.button
          whileTap={buttonTap}
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#b3001e] hover:bg-[#8c0017] text-white text-sm font-bold transition-colors"
        >
          <Plus size={16} /> {L('Nuevo lead', 'New lead')}
        </motion.button>
      </div>

      {/* Status pills */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilterStatus('')}
          className={`px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors ${
            !filterStatus
              ? 'bg-[#b3001e] text-white border-[#b3001e]'
              : isDark ? 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
          }`}
        >
          {L('Todos', 'All')} <span className="opacity-60">{counts.all}</span>
        </button>
        {STATUSES.map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s === filterStatus ? '' : s)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors ${
              filterStatus === s
                ? STATUS_TONE[s].replace('/15', '/30')
                : isDark ? 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {STATUS_LABEL[lang][s]} <span className="opacity-60">{counts[s]}</span>
          </button>
        ))}
      </div>

      {/* Search + plan filter */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Search size={14} className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? 'text-white/40' : 'text-slate-400'}`} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={L('Buscar por nombre, email, teléfono, RNC…', 'Search by name, email, phone, RNC…')}
            className={`w-full pl-10 pr-3 py-2 rounded-lg border text-sm outline-none transition-colors ${inputBase}`}
          />
        </div>
        <select
          value={filterPlan}
          onChange={e => setFilterPlan(e.target.value)}
          className={`px-3 py-2 rounded-lg border text-sm outline-none ${inputBase}`}
        >
          <option value="">{L('Todos los planes', 'All plans')}</option>
          <option value="facturacion">Facturación</option>
          <option value="pro">Pro</option>
          <option value="pro_plus">Pro PLUS</option>
          <option value="pro_max">Pro MAX</option>
        </select>
        <select
          value={filterAssigned}
          onChange={e => setFilterAssigned(e.target.value)}
          className={`px-3 py-2 rounded-lg border text-sm outline-none ${inputBase}`}
        >
          <option value="">{L('Todos los responsables', 'All assignees')}</option>
          <option value="unassigned">{L('Sin asignar', 'Unassigned')}</option>
        </select>
      </div>

      {/* Table / list */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={20} className="animate-spin text-[#b3001e]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className={`text-center py-20 rounded-xl border ${cardBase}`}>
          <UserCircle2 size={32} className={`mx-auto ${isDark ? 'text-white/20' : 'text-slate-300'}`} />
          <p className={`mt-3 text-sm ${isDark ? 'text-white/50' : 'text-slate-500'}`}>{L('Sin leads', 'No leads')}</p>
        </div>
      ) : (
        <motion.div variants={listContainer} initial="initial" animate="animate" className={`rounded-xl border overflow-hidden ${cardBase}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className={isDark ? 'border-b border-white/10 text-white/40' : 'border-b border-slate-200 text-slate-500'}>
                  <th className="text-left font-semibold py-2.5 px-4">{L('Negocio', 'Business')}</th>
                  <th className="text-left font-semibold py-2.5 px-4">{L('Contacto', 'Contact')}</th>
                  <th className="text-left font-semibold py-2.5 px-4">{L('Plan', 'Plan')}</th>
                  <th className="text-left font-semibold py-2.5 px-4">{L('Estado', 'Status')}</th>
                  <th className="text-left font-semibold py-2.5 px-4">{L('Asignado', 'Assigned')}</th>
                  <th className="text-left font-semibold py-2.5 px-4">{L('Seguimiento', 'Follow-up')}</th>
                  <th className="text-left font-semibold py-2.5 px-4">{L('Creado', 'Created')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(l => {
                  const overdue = l.next_followup_at && new Date(l.next_followup_at) < new Date()
                  return (
                    <motion.tr
                      key={l.id}
                      variants={listItem}
                      onClick={() => navigate(`/admin/crm/${l.id}`)}
                      className={`cursor-pointer transition-colors ${
                        isDark ? 'border-b border-white/5 hover:bg-white/[0.04]' : 'border-b border-slate-100 hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <Building2 size={13} className="text-[#b3001e] shrink-0" />
                          <div>
                            <div className={`font-semibold ${isDark ? 'text-white' : 'text-slate-900'}`}>{l.business_name || '—'}</div>
                            {l.rnc && <div className={`text-[10px] ${isDark ? 'text-white/40' : 'text-slate-400'}`}>RNC {l.rnc}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="space-y-0.5">
                          {l.email && <div className={`flex items-center gap-1.5 text-[11px] ${isDark ? 'text-white/70' : 'text-slate-600'}`}><Mail size={10} /> {l.email}</div>}
                          {l.phone && <div className={`flex items-center gap-1.5 text-[11px] ${isDark ? 'text-white/70' : 'text-slate-600'}`}><Phone size={10} /> {l.phone}</div>}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {l.requested_plan && (
                          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                            l.requested_plan === 'facturacion'
                              ? 'bg-[#b3001e]/15 text-[#b3001e]'
                              : isDark ? 'bg-white/10 text-white/70' : 'bg-slate-100 text-slate-600'
                          }`}>{PLAN_LABEL[l.requested_plan] || l.requested_plan}</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${STATUS_TONE[l.status] || STATUS_TONE.new}`}>
                          {STATUS_LABEL[lang][l.status] || l.status}
                        </span>
                      </td>
                      <td className={`py-3 px-4 text-[11px] ${isDark ? 'text-white/70' : 'text-slate-600'}`}>
                        {l.assigned_to_name || <span className={isDark ? 'text-white/30' : 'text-slate-400'}>—</span>}
                      </td>
                      <td className="py-3 px-4">
                        {l.next_followup_at ? (
                          <span className={`inline-flex items-center gap-1 text-[11px] ${overdue ? 'text-[#b3001e] font-bold' : isDark ? 'text-white/70' : 'text-slate-600'}`}>
                            <Calendar size={10} />
                            {new Date(l.next_followup_at).toLocaleDateString(lang === 'es' ? 'es-DO' : 'en-US', { day: '2-digit', month: 'short' })}
                          </span>
                        ) : <span className={isDark ? 'text-white/30' : 'text-slate-400'}>—</span>}
                      </td>
                      <td className={`py-3 px-4 text-[11px] ${isDark ? 'text-white/50' : 'text-slate-500'}`}>
                        <span className="inline-flex items-center gap-1"><Clock size={10} /> {relTime(l.created_at, lang)}</span>
                      </td>
                    </motion.tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* New-lead modal */}
      {showAdd && (
        <motion.div variants={modalBackdrop} initial="initial" animate="animate" exit="exit" className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowAdd(false)}>
          <motion.div variants={modalPanel} onClick={e => e.stopPropagation()} className={`w-full max-w-md rounded-2xl border p-5 ${cardBase}`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className={`text-lg font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>{L('Nuevo lead manual', 'New manual lead')}</h2>
              <button onClick={() => setShowAdd(false)} className={isDark ? 'text-white/40 hover:text-white' : 'text-slate-400 hover:text-slate-700'}><X size={18} /></button>
            </div>
            <div className="space-y-2.5">
              {[
                { k: 'business_name', label: L('Nombre del negocio', 'Business name') },
                { k: 'contact_name',  label: L('Nombre de contacto', 'Contact name') },
                { k: 'email',         label: 'Email', type: 'email' },
                { k: 'phone',         label: L('Teléfono', 'Phone') },
                { k: 'rnc',           label: 'RNC' },
              ].map(f => (
                <div key={f.k}>
                  <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${isDark ? 'text-white/60' : 'text-slate-500'}`}>{f.label}</label>
                  <input
                    type={f.type || 'text'}
                    value={form[f.k]}
                    onChange={e => setForm({ ...form, [f.k]: e.target.value })}
                    className={`w-full px-3 py-2 rounded-lg border text-sm outline-none transition-colors ${inputBase}`}
                  />
                </div>
              ))}
              <div>
                <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${isDark ? 'text-white/60' : 'text-slate-500'}`}>{L('Plan de interés', 'Plan of interest')}</label>
                <select
                  value={form.requested_plan}
                  onChange={e => setForm({ ...form, requested_plan: e.target.value })}
                  className={`w-full px-3 py-2 rounded-lg border text-sm outline-none ${inputBase}`}
                >
                  <option value="facturacion">Facturación</option>
                  <option value="pro">Pro</option>
                  <option value="pro_plus">Pro PLUS</option>
                  <option value="pro_max">Pro MAX</option>
                </select>
              </div>
            </div>
            <button
              onClick={createLead}
              disabled={adding || (!form.business_name.trim() && !form.contact_name.trim())}
              className="mt-4 w-full py-2.5 rounded-lg bg-[#b3001e] hover:bg-[#8c0017] text-white font-bold disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              {adding && <Loader2 size={14} className="animate-spin" />}
              {L('Crear lead', 'Create lead')}
            </button>
          </motion.div>
        </motion.div>
      )}
    </div>
  )
}
