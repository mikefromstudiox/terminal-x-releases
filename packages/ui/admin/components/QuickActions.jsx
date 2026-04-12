import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MessageSquare, RotateCcw, ArrowUpDown, Ban, CheckCircle2, CalendarPlus, Copy, Check, Link2, Loader2 } from 'lucide-react'
import { useLang } from '../../i18n'
import { dropdown } from '../motion'

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
  const [showReset, setShowReset] = useState(false)
  const [resetPass, setResetPass] = useState('')
  const [resetErr, setResetErr] = useState('')
  const [resetOk, setResetOk] = useState(false)
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

  const btn = `flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[11px] font-bold transition-colors disabled:opacity-50 border`
  const secondary = isDark
    ? 'border-white/10 text-white/70 hover:bg-white/5 hover:border-[#b3001e]/40 hover:text-white'
    : 'border-black/10 text-black/70 hover:bg-black/5 hover:border-[#b3001e]/40 hover:text-black'
  const accent = 'border-[#b3001e]/30 text-[#b3001e] hover:bg-[#b3001e]/10'

  const inputBase = isDark
    ? 'bg-white/5 border-white/10 text-white placeholder-white/30 focus:border-[#b3001e] focus:ring-[#b3001e]/25'
    : 'bg-white border-black/10 text-black placeholder-black/30 focus:border-[#b3001e] focus:ring-[#b3001e]/25'

  const popoverCls = `absolute top-full mt-2 z-20 rounded-2xl shadow-2xl border p-4 w-72 ${isDark ? 'bg-black border-white/15' : 'bg-white border-black/15'}`

  return (
    <div className="flex flex-wrap gap-2 relative">
      {business.phone && (
        <motion.button
          whileTap={{ scale: 0.96 }}
          whileHover={{ scale: 1.02 }}
          onClick={sendWhatsApp}
          className={`${btn} border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10`}
        >
          <MessageSquare size={13} /> WhatsApp
        </motion.button>
      )}

      {license?.hardware_id && (
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={() => patchLicense({ hardware_id: null })}
          disabled={updating}
          className={`${btn} ${secondary}`}
        >
          <RotateCcw size={13} /> Reset HWID
        </motion.button>
      )}

      <div className="relative">
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={() => setShowPlan(s => !s)}
          disabled={updating}
          className={`${btn} ${secondary}`}
        >
          <ArrowUpDown size={13} /> {L('Cambiar plan', 'Change plan')}
        </motion.button>
        <AnimatePresence>
          {showPlan && (
            <motion.div
              variants={dropdown}
              initial="initial"
              animate="animate"
              exit="exit"
              className={`absolute top-full left-0 mt-2 z-20 rounded-xl shadow-2xl border overflow-hidden ${isDark ? 'bg-black border-white/15' : 'bg-white border-black/15'}`}
            >
              {PLANS.map(p => (
                <button key={p.value} onClick={() => changePlan(p.value)}
                  className={`block w-full text-left px-5 py-2.5 text-[12px] font-semibold transition-colors whitespace-nowrap ${
                    business.plan === p.value
                      ? 'text-[#b3001e] bg-[#b3001e]/10'
                      : isDark ? 'text-white/70 hover:bg-white/5 hover:text-white' : 'text-black/70 hover:bg-black/5 hover:text-black'
                  }`}>
                  {p.label} {business.plan === p.value ? '(actual)' : ''}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {license && license.status === 'active' && (
        <motion.button
          whileTap={{ scale: 0.96 }}
          whileHover={{ scale: 1.02 }}
          onClick={() => patchLicense({ status: 'suspended' })}
          disabled={updating}
          className={`${btn} ${accent}`}
        >
          <Ban size={13} /> {L('Suspender', 'Suspend')}
        </motion.button>
      )}
      {license && (license.status === 'suspended' || license.status === 'pending') && (
        <motion.button
          whileTap={{ scale: 0.96 }}
          whileHover={{ scale: 1.02 }}
          onClick={() => patchLicense({ status: 'active' })}
          disabled={updating}
          className={`${btn} border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10`}
        >
          <CheckCircle2 size={13} /> {L('Activar', 'Activate')}
        </motion.button>
      )}

      {license && (
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={() => {
            const d = new Date(license.expires_at || Date.now())
            d.setDate(d.getDate() + 30)
            patchLicense({ expires_at: d.toISOString() })
          }}
          disabled={updating}
          className={`${btn} ${secondary}`}
        >
          <CalendarPlus size={13} /> +30 {L('dias', 'days')}
        </motion.button>
      )}

      {license?.license_key && (
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={copyKey}
          className={`${btn} ${secondary}`}
        >
          {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
          {copied ? L('Copiado', 'Copied') : L('Copiar clave', 'Copy key')}
        </motion.button>
      )}

      {business.owner_id && (
        <div className="relative">
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => { setShowReset(s => !s); setResetErr(''); setResetOk(false); setResetPass('') }}
            className={`${btn} ${accent}`}
          >
            <RotateCcw size={13} /> {L('Cambiar contraseña', 'Reset password')}
          </motion.button>
          <AnimatePresence>
            {showReset && (
              <motion.div variants={dropdown} initial="initial" animate="animate" exit="exit" className={`right-0 ${popoverCls}`}>
                <p className={`text-[10px] font-bold uppercase tracking-[1.2px] mb-3 ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                  {L('Nueva contraseña para cuenta web', 'New password for web account')}
                </p>
                <input
                  type="password"
                  placeholder={L('Nueva contraseña (min 6)', 'New password (min 6)')}
                  value={resetPass}
                  onChange={e => setResetPass(e.target.value)}
                  className={`w-full px-3 py-2 rounded-xl text-[12px] border mb-3 outline-none transition-all focus:ring-2 ${inputBase}`}
                />
                {resetErr && <p className="text-[11px] text-[#b3001e] font-semibold mb-2">{resetErr}</p>}
                {resetOk && <p className="text-[11px] text-emerald-500 font-semibold mb-2">{L('Contraseña actualizada', 'Password updated')}</p>}
                <div className="flex gap-2">
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    onClick={() => setShowReset(false)}
                    className={`px-3 py-2 rounded-xl text-[11px] font-semibold border ${isDark ? 'border-white/10 text-white/50 hover:bg-white/5' : 'border-black/10 text-black/50 hover:bg-black/5'}`}
                  >
                    {L('Cancelar', 'Cancel')}
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    disabled={updating}
                    onClick={async () => {
                      if (resetPass.length < 6) { setResetErr(L('Min 6 caracteres', 'Min 6 characters')); return }
                      setResetErr(''); setUpdating(true)
                      try {
                        const resp = await fetch('/api/panel?action=reset_password', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
                          body: JSON.stringify({ user_id: business.owner_id, password: resetPass }),
                        })
                        const result = await resp.json()
                        if (!resp.ok) throw new Error(result.error || 'Failed')
                        setResetOk(true); setResetPass('')
                        setTimeout(() => setShowReset(false), 1500)
                      } catch (e) { setResetErr(e.message) }
                      setUpdating(false)
                    }}
                    className="flex-1 py-2 bg-[#b3001e] hover:bg-[#c8002a] disabled:opacity-60 text-white text-[11px] font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-md shadow-[#b3001e]/20"
                  >
                    {updating ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                    {L('Actualizar', 'Update')}
                  </motion.button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {!business.owner_id && (
        <div className="relative">
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => { setShowLink(s => !s); setLinkErr(''); setLinkOk(false) }}
            className={`${btn} ${accent}`}
          >
            <Link2 size={13} /> {L('Vincular cuenta web', 'Link web account')}
          </motion.button>
          <AnimatePresence>
            {showLink && (
              <motion.div variants={dropdown} initial="initial" animate="animate" exit="exit" className={`right-0 ${popoverCls}`}>
                <p className={`text-[10px] font-bold uppercase tracking-[1.2px] mb-3 ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                  {L('Crear cuenta web para este cliente', 'Create web account for this client')}
                </p>
                <input
                  type="email"
                  placeholder="Email"
                  value={linkEmail}
                  onChange={e => setLinkEmail(e.target.value)}
                  className={`w-full px-3 py-2 rounded-xl text-[12px] border mb-2 outline-none transition-all focus:ring-2 ${inputBase}`}
                />
                <input
                  type="password"
                  placeholder={L('Contrasena (min 6)', 'Password (min 6)')}
                  value={linkPass}
                  onChange={e => setLinkPass(e.target.value)}
                  className={`w-full px-3 py-2 rounded-xl text-[12px] border mb-3 outline-none transition-all focus:ring-2 ${inputBase}`}
                />
                {linkErr && <p className="text-[11px] text-[#b3001e] font-semibold mb-2">{linkErr}</p>}
                {linkOk && <p className="text-[11px] text-emerald-500 font-semibold mb-2">{L('Cuenta vinculada', 'Account linked')}</p>}
                <div className="flex gap-2">
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    onClick={() => setShowLink(false)}
                    className={`px-3 py-2 rounded-xl text-[11px] font-semibold border ${isDark ? 'border-white/10 text-white/50 hover:bg-white/5' : 'border-black/10 text-black/50 hover:bg-black/5'}`}
                  >
                    {L('Cancelar', 'Cancel')}
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    disabled={updating}
                    onClick={async () => {
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
                    }}
                    className="flex-1 py-2 bg-[#b3001e] hover:bg-[#c8002a] disabled:opacity-60 text-white text-[11px] font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-md shadow-[#b3001e]/20"
                  >
                    {updating ? <Loader2 size={11} className="animate-spin" /> : <Link2 size={11} />}
                    {L('Vincular', 'Link')}
                  </motion.button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
