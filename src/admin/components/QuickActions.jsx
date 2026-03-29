import { useState } from 'react'
import { MessageSquare, RotateCcw, ArrowUpDown, Ban, CheckCircle2, CalendarPlus, Copy, Check, Link2, Loader2 } from 'lucide-react'
import { useLang } from '../../i18n'

const PLANS = [
  { value: 'pro',      label: 'Pro' },
  { value: 'pro_plus',  label: 'Pro PLUS' },
  { value: 'pro_max',   label: 'Pro MAX' },
]

export default function QuickActions({ business, license, getToken, onRefresh, isDark }) {
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const [copied, setCopied] = useState(false)
  const [showPlan, setShowPlan] = useState(false)
  const [showLink, setShowLink] = useState(false)
  const [linkEmail, setLinkEmail] = useState('')
  const [linkPass, setLinkPass] = useState('')
  const [linkErr, setLinkErr] = useState('')
  const [linkOk, setLinkOk] = useState(false)
  const [updating, setUpdating] = useState(false)

  async function patchLicense(patch) {
    if (!license?.id) return
    setUpdating(true)
    try {
      await fetch('/api/panel?action=licenses', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
        body: JSON.stringify({ id: license.id, ...patch }),
      })
      onRefresh?.()
    } catch {}
    setUpdating(false)
  }

  async function changePlan(plan) {
    setUpdating(true)
    setShowPlan(false)
    try {
      await fetch('/api/panel?action=clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
        body: JSON.stringify({ id: business.id, action: 'update_plan', plan }),
      })
      onRefresh?.()
    } catch {}
    setUpdating(false)
  }

  function copyKey() {
    if (!license?.license_key) return
    navigator.clipboard.writeText(license.license_key)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function sendWhatsApp() {
    const phone = (business.phone || '').replace(/\D/g, '')
    if (!phone) return
    const msg = encodeURIComponent(lang === 'es'
      ? `Hola ${business.name}! Bienvenido a Terminal X. Si necesitas ayuda con la configuracion, estamos aqui para ti.`
      : `Hi ${business.name}! Welcome to Terminal X. If you need help with setup, we're here for you.`)
    window.open(`https://wa.me/${phone}?text=${msg}`, '_blank')
  }

  const btn = `flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50 border`
  const secondary = isDark
    ? 'border-white/10 text-white/70 hover:bg-white/5'
    : 'border-slate-200 text-slate-600 hover:bg-slate-50'

  return (
    <div className="flex flex-wrap gap-2 relative">
      {business.phone && (
        <button onClick={sendWhatsApp} className={`${btn} border-[#25D366]/30 text-[#25D366] hover:bg-[#25D366]/10`}>
          <MessageSquare size={13} /> WhatsApp
        </button>
      )}

      {license?.hardware_id && (
        <button onClick={() => patchLicense({ hardware_id: null })} disabled={updating} className={`${btn} ${secondary}`}>
          <RotateCcw size={13} /> Reset HWID
        </button>
      )}

      <div className="relative">
        <button onClick={() => setShowPlan(s => !s)} disabled={updating} className={`${btn} ${secondary}`}>
          <ArrowUpDown size={13} /> {L('Cambiar plan', 'Change plan')}
        </button>
        {showPlan && (
          <div className={`absolute top-full left-0 mt-1 z-20 rounded-lg shadow-lg border overflow-hidden ${isDark ? 'bg-zinc-900 border-white/10' : 'bg-white border-slate-200'}`}>
            {PLANS.map(p => (
              <button key={p.value} onClick={() => changePlan(p.value)}
                className={`block w-full text-left px-4 py-2 text-[12px] transition-colors ${
                  business.plan === p.value
                    ? 'text-[#b3001e] font-bold'
                    : isDark ? 'text-white/70 hover:bg-white/5' : 'text-slate-600 hover:bg-slate-50'
                }`}>
                {p.label} {business.plan === p.value ? '(actual)' : ''}
              </button>
            ))}
          </div>
        )}
      </div>

      {license && license.status === 'active' && (
        <button onClick={() => patchLicense({ status: 'suspended' })} disabled={updating} className={`${btn} border-red-200 text-red-500 hover:bg-red-50`}>
          <Ban size={13} /> {L('Suspender', 'Suspend')}
        </button>
      )}
      {license && (license.status === 'suspended' || license.status === 'pending') && (
        <button onClick={() => patchLicense({ status: 'active' })} disabled={updating} className={`${btn} border-emerald-200 text-emerald-600 hover:bg-emerald-50`}>
          <CheckCircle2 size={13} /> {L('Activar', 'Activate')}
        </button>
      )}

      {license && (
        <button onClick={() => {
          const d = new Date(license.expires_at || Date.now())
          d.setDate(d.getDate() + 30)
          patchLicense({ expires_at: d.toISOString() })
        }} disabled={updating} className={`${btn} ${secondary}`}>
          <CalendarPlus size={13} /> +30 {L('dias', 'days')}
        </button>
      )}

      {license?.license_key && (
        <button onClick={copyKey} className={`${btn} ${secondary}`}>
          {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
          {copied ? L('Copiado', 'Copied') : L('Copiar clave', 'Copy key')}
        </button>
      )}

      {!business.owner_id && (
        <div className="relative">
          <button onClick={() => { setShowLink(s => !s); setLinkErr(''); setLinkOk(false) }} className={`${btn} border-sky-200 text-sky-600 hover:bg-sky-50`}>
            <Link2 size={13} /> {L('Vincular cuenta web', 'Link web account')}
          </button>
          {showLink && (
            <div className={`absolute top-full right-0 mt-1 z-20 rounded-xl shadow-lg border p-4 w-72 ${isDark ? 'bg-zinc-900 border-white/10' : 'bg-white border-slate-200'}`}>
              <p className={`text-[11px] font-bold uppercase tracking-wider mb-3 ${isDark ? 'text-white/40' : 'text-slate-400'}`}>
                {L('Crear cuenta web para este cliente', 'Create web account for this client')}
              </p>
              <input type="email" placeholder="Email" value={linkEmail} onChange={e => setLinkEmail(e.target.value)}
                className={`w-full px-3 py-1.5 rounded-lg text-[12px] border mb-2 focus:outline-none focus:ring-1 focus:ring-sky-400 ${isDark ? 'bg-white/5 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-700'}`} />
              <input type="password" placeholder={L('Contrasena (min 6)', 'Password (min 6)')} value={linkPass} onChange={e => setLinkPass(e.target.value)}
                className={`w-full px-3 py-1.5 rounded-lg text-[12px] border mb-3 focus:outline-none focus:ring-1 focus:ring-sky-400 ${isDark ? 'bg-white/5 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-700'}`} />
              {linkErr && <p className="text-[11px] text-red-500 mb-2">{linkErr}</p>}
              {linkOk && <p className="text-[11px] text-emerald-600 mb-2">{L('Cuenta vinculada', 'Account linked')}</p>}
              <div className="flex gap-2">
                <button onClick={() => setShowLink(false)} className={`px-3 py-1.5 rounded-lg text-[11px] border ${isDark ? 'border-white/10 text-white/50' : 'border-slate-200 text-slate-500'}`}>
                  {L('Cancelar', 'Cancel')}
                </button>
                <button disabled={updating} onClick={async () => {
                  if (!linkEmail.includes('@')) { setLinkErr(L('Email invalido', 'Invalid email')); return }
                  if (linkPass.length < 6) { setLinkErr(L('Min 6 caracteres', 'Min 6 characters')); return }
                  setLinkErr(''); setUpdating(true)
                  try {
                    const resp = await fetch('/api/panel?action=link_web_account', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
                      body: JSON.stringify({ business_id: business.id, email: linkEmail.trim(), password: linkPass }),
                    })
                    const result = await resp.json()
                    if (!resp.ok) throw new Error(result.error || 'Failed')
                    setLinkOk(true); setLinkEmail(''); setLinkPass('')
                    setTimeout(() => { setShowLink(false); onRefresh?.() }, 1500)
                  } catch (e) { setLinkErr(e.message) }
                  setUpdating(false)
                }} className="flex-1 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white text-[11px] font-bold rounded-lg flex items-center justify-center gap-1.5">
                  {updating ? <Loader2 size={11} className="animate-spin" /> : <Link2 size={11} />}
                  {L('Vincular', 'Link')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
