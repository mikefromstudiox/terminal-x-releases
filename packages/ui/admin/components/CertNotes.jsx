import { useState } from 'react'
import { Send, Eye, MessageSquare, CreditCard, Settings, ArrowRightLeft, StickyNote, Users } from 'lucide-react'

const TYPE_BADGES = {
  note:           { label: 'Nota',    labelEn: 'Note',     bg: 'bg-black/5 text-black/60 border-black/10',   bgDark: 'bg-white/5 text-white/60 border-white/10' },
  step_change:    { label: 'Paso',    labelEn: 'Step',     bg: 'bg-sky-50 text-sky-700 border-sky-200',       bgDark: 'bg-sky-500/10 text-sky-400 border-sky-500/20' },
  status_change:  { label: 'Estado',  labelEn: 'Status',   bg: 'bg-amber-50 text-amber-700 border-amber-200', bgDark: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  payment:        { label: 'Pago',    labelEn: 'Payment',  bg: 'bg-emerald-50 text-emerald-700 border-emerald-200', bgDark: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  system:         { label: 'Sistema', labelEn: 'System',   bg: 'bg-purple-50 text-purple-700 border-purple-200', bgDark: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
  client_message: { label: 'Cliente', labelEn: 'Client',   bg: 'bg-sky-50 text-sky-700 border-sky-200',       bgDark: 'bg-sky-500/10 text-sky-400 border-sky-500/20' },
}

function timeAgo(dateStr, lang) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return lang === 'es' ? 'ahora' : 'just now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d`
  return new Date(dateStr).toLocaleDateString(lang === 'es' ? 'es-DO' : 'en-US')
}

export default function CertNotes({ notes = [], certId, token, onNoteAdded, isDark, lang }) {
  const L = (es, en) => lang === 'es' ? es : en
  const [content, setContent] = useState('')
  const [type, setType] = useState('note')
  const [visible, setVisible] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    if (!content.trim()) return
    setSubmitting(true); setErr('')
    try {
      const resp = await fetch('/api/panel?action=cert_notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ id: certId, content: content.trim(), type, visible_to_client: visible }),
      })
      if (!resp.ok) { const r = await resp.json().catch(() => ({})); throw new Error(r.error || 'Error') }
      setContent(''); setType('note'); setVisible(false)
      onNoteAdded?.()
    } catch (e) { setErr(e.message) }
    setSubmitting(false)
  }

  return (
    <div className="space-y-4">
      {/* Add form */}
      <div className={`rounded-2xl p-4 space-y-3 ${isDark ? 'bg-white/5 border border-white/10' : 'bg-white border border-black/10'}`}>
        <textarea
          value={content} onChange={e => setContent(e.target.value)}
          rows={3}
          placeholder={L('Agregar nota...', 'Add note...')}
          className={`w-full px-3 py-2 rounded-lg text-[13px] border resize-none focus:outline-none focus:ring-1 focus:ring-[#b3001e] ${
            isDark ? 'bg-white/5 border-white/10 text-white placeholder-white/30' : 'bg-white border-black/10 text-black placeholder-black/30'
          }`}
        />
        <div className="flex items-center gap-3 flex-wrap">
          <select value={type} onChange={e => setType(e.target.value)}
            className={`px-3 py-1.5 rounded-lg text-[12px] border focus:outline-none ${
              isDark ? 'bg-white/5 border-white/10 text-white' : 'bg-white border-black/10 text-black'
            }`}>
            <option value="note">{L('Nota', 'Note')}</option>
            <option value="payment">{L('Pago', 'Payment')}</option>
            <option value="system">Sistema</option>
          </select>
          <label className={`flex items-center gap-1.5 text-[12px] cursor-pointer ${isDark ? 'text-white/50' : 'text-black/50'}`}>
            <input type="checkbox" checked={visible} onChange={e => setVisible(e.target.checked)}
              className="w-3.5 h-3.5 rounded accent-[#b3001e]" />
            <Eye size={12} />
            {L('Visible al cliente', 'Visible to client')}
          </label>
          <div className="flex-1" />
          <button onClick={submit} disabled={submitting || !content.trim()}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-[#b3001e] text-white text-[12px] font-bold rounded-lg hover:bg-[#8c0017] disabled:opacity-40 transition-colors">
            <Send size={12} />
            {submitting ? L('Enviando...', 'Sending...') : L('Agregar', 'Add')}
          </button>
        </div>
        {err && <p className="text-[11px] text-red-500">{err}</p>}
      </div>

      {/* Notes timeline */}
      {notes.length === 0 ? (
        <p className={`text-center text-[12px] py-8 ${isDark ? 'text-white/30' : 'text-black/30'}`}>
          {L('Sin notas aun.', 'No notes yet.')}
        </p>
      ) : (
        <div className="space-y-2">
          {notes.map((note, i) => {
            const badge = TYPE_BADGES[note.type] || TYPE_BADGES.note
            return (
              <div key={note.id || i} className={`rounded-xl px-4 py-3 ${isDark ? 'bg-white/5 border border-white/10' : 'bg-white border border-black/10'}`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${isDark ? badge.bgDark : badge.bg}`}>
                    {lang === 'es' ? badge.label : badge.labelEn}
                  </span>
                  <span className={`text-[11px] font-medium ${isDark ? 'text-white/60' : 'text-black/60'}`}>
                    {note.author_name || 'Admin'}
                  </span>
                  <span className={`text-[10px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>
                    {timeAgo(note.created_at, lang)}
                  </span>
                  {note.visible_to_client && (
                    <Eye size={11} className={isDark ? 'text-white/30' : 'text-black/30'} />
                  )}
                </div>
                <p className={`text-[13px] leading-relaxed ${isDark ? 'text-white/80' : 'text-black/80'}`}>
                  {note.content}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
