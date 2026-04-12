import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { MessageCircle, Clock, CheckCircle2, AlertCircle, Send, Loader2 } from 'lucide-react'
import { useLang } from '../../i18n'
import { listContainer, listItem } from '../motion'

const STATUS_META = {
  open: { icon: AlertCircle, label: { es: 'Abierto', en: 'Open' }, cls: 'text-amber-500 bg-amber-500/10 border-amber-500/25' },
  in_progress: { icon: Clock, label: { es: 'En progreso', en: 'In Progress' }, cls: 'text-[#b3001e] bg-[#b3001e]/10 border-[#b3001e]/25' },
  resolved: { icon: CheckCircle2, label: { es: 'Resuelto', en: 'Resolved' }, cls: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/25' },
  closed: { icon: CheckCircle2, label: { es: 'Cerrado', en: 'Closed' }, cls: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/25' },
}

export default function Support({ getToken, refreshToken, isDark }) {
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [response, setResponse] = useState('')
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('all')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      let token = await refreshToken?.()
      if (!token) token = getToken()
      const resp = await fetch('/api/panel?action=support_tickets', { headers: { 'Authorization': `Bearer ${token}` } })
      if (resp.ok) { const { data } = await resp.json(); setTickets(data || []) }
    } catch {}
    setLoading(false)
  }

  async function updateTicket(id, updates) {
    setSaving(true)
    try {
      await fetch('/api/panel?action=create_ticket', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
        body: JSON.stringify({ id, ...updates }),
      })
      await load()
      if (selected?.id === id) setSelected(prev => ({ ...prev, ...updates }))
    } catch {}
    setSaving(false)
  }

  const filtered = filter === 'all' ? tickets : tickets.filter(t => t.status === filter)
  const openCount = tickets.filter(t => t.status === 'open').length
  const card = isDark ? 'bg-white/[0.03] border border-white/10' : 'bg-white border border-black/10 shadow-sm'

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-[#b3001e]" size={20} /></div>

  return (
    <div className="p-6 md:p-8 space-y-6">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className={`text-[26px] font-black tracking-tight ${isDark ? 'text-white' : 'text-black'}`}>
          {L('Soporte', 'Support')}
        </h1>
        <p className={`text-[12px] mt-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>
          {openCount} {L('tickets abiertos', 'open tickets')}
        </p>
      </motion.div>

      {/* Filters */}
      <div className="flex gap-2">
        {['all', 'open', 'in_progress', 'resolved', 'closed'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition-colors ${filter === f ? 'bg-[#b3001e] text-white' : isDark ? 'text-white/40 hover:text-white/70 border border-white/10' : 'text-black/40 hover:text-black/70 border border-black/10'}`}>
            {f === 'all' ? L('Todos', 'All') : (STATUS_META[f]?.label?.[lang] || f)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Ticket List */}
        <div className={`rounded-2xl p-5 ${card}`}>
          <p className={`text-[11px] font-bold uppercase tracking-[1.2px] mb-3 text-[#b3001e]`}>
            {L('Tickets', 'Tickets')} ({filtered.length})
          </p>
          {filtered.length === 0 ? (
            <p className={`text-[12px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>{L('Sin tickets.', 'No tickets.')}</p>
          ) : (
            <motion.div variants={listContainer} initial="initial" animate="animate" className="space-y-0 max-h-[500px] overflow-y-auto">
              {filtered.map(t => {
                const meta = STATUS_META[t.status] || STATUS_META.open
                const Icon = meta.icon
                return (
                  <motion.button key={t.id} variants={listItem}
                    onClick={() => { setSelected(t); setResponse(t.admin_response || '') }}
                    className={`w-full flex items-center gap-3 py-3 px-2 text-left rounded-xl transition-colors border-b last:border-0 ${isDark ? 'border-white/5 hover:bg-white/5' : 'border-black/5 hover:bg-black/5'} ${selected?.id === t.id ? (isDark ? 'bg-white/5' : 'bg-black/5') : ''}`}>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center border shrink-0 ${meta.cls}`}>
                      <Icon size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[12px] font-bold truncate ${isDark ? 'text-white' : 'text-black'}`}>{t.subject}</p>
                      <p className={`text-[10px] ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                        {t.businesses?.name || '\u2014'} — {new Date(t.created_at).toLocaleDateString('es-DO', { day: '2-digit', month: 'short' })}
                      </p>
                    </div>
                  </motion.button>
                )
              })}
            </motion.div>
          )}
        </div>

        {/* Ticket Detail */}
        <div className={`rounded-2xl p-5 ${card}`}>
          {!selected ? (
            <div className={`text-center py-16 ${isDark ? 'text-white/20' : 'text-black/20'}`}>
              <MessageCircle size={32} className="mx-auto mb-3 opacity-40" />
              <p className="text-[12px]">{L('Selecciona un ticket', 'Select a ticket')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className={`text-[15px] font-bold ${isDark ? 'text-white' : 'text-black'}`}>{selected.subject}</p>
                <p className={`text-[11px] mt-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                  {selected.businesses?.name} — {new Date(selected.created_at).toLocaleString('es-DO')}
                </p>
              </div>
              <div className={`rounded-xl p-3 ${isDark ? 'bg-white/5' : 'bg-black/5'}`}>
                <p className={`text-[12px] ${isDark ? 'text-white/70' : 'text-black/70'}`}>{selected.message || L('Sin mensaje.', 'No message.')}</p>
              </div>
              <div>
                <p className={`text-[10px] font-bold uppercase tracking-[1.2px] mb-2 text-[#b3001e]`}>{L('Respuesta del admin', 'Admin Response')}</p>
                <textarea value={response} onChange={e => setResponse(e.target.value)} rows={3}
                  className={`w-full px-3.5 py-2.5 rounded-xl text-[13px] outline-none resize-none transition-all focus:ring-2 ${isDark ? 'bg-white/5 border border-white/10 text-white focus:border-[#b3001e] focus:ring-[#b3001e]/25' : 'bg-white border border-black/10 text-black focus:border-[#b3001e] focus:ring-[#b3001e]/25'}`}
                  placeholder={L('Escribe una respuesta...', 'Write a response...')} />
              </div>
              <div className="flex gap-2">
                <button onClick={() => updateTicket(selected.id, { admin_response: response, status: 'in_progress' })} disabled={saving}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[11px] font-bold bg-[#b3001e] text-white hover:bg-[#c8002a] disabled:opacity-50 transition-colors">
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  {L('Responder', 'Respond')}
                </button>
                <button onClick={() => updateTicket(selected.id, { admin_response: response, status: 'resolved' })} disabled={saving}
                  className={`px-3 py-2.5 rounded-xl text-[11px] font-bold border transition-colors disabled:opacity-50 ${isDark ? 'border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10' : 'border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10'}`}>
                  <CheckCircle2 size={12} className="inline mr-1" />{L('Resolver', 'Resolve')}
                </button>
              </div>
              {/* Status change */}
              <div className="flex gap-1.5">
                {['open', 'in_progress', 'resolved', 'closed'].map(s => (
                  <button key={s} onClick={() => updateTicket(selected.id, { status: s })} disabled={saving || selected.status === s}
                    className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-colors disabled:opacity-30 ${isDark ? 'text-white/50 hover:text-white/80 border border-white/10' : 'text-black/50 hover:text-black/80 border border-black/10'}`}>
                    {STATUS_META[s]?.label?.[lang] || s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
