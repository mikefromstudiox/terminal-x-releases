import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, Plus, Shield, ShieldCheck, Eye, Briefcase, Target } from 'lucide-react'
import { listContainer, listItem } from '../motion'

const ROLE_LABELS = {
  super_admin:   { es: 'Super Admin',       en: 'Super Admin' },
  admin:         { es: 'Admin',             en: 'Admin' },
  sales_manager: { es: 'Gerente de Ventas', en: 'Sales Manager' },
  sales:         { es: 'Ventas / CRM',      en: 'Sales / CRM' },
  support:       { es: 'Soporte',           en: 'Support' },
}

const ROLE_ICONS = {
  super_admin:   ShieldCheck,
  admin:         Shield,
  sales_manager: Briefcase,
  sales:         Target,
  support:       Eye,
}

export default function Team({ getToken, refreshToken, isDark, lang }) {
  const L = (es, en) => lang === 'es' ? es : en
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ email: '', name: '', role: 'support', password: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setLoadErr('')
    try {
      const resp = await fetch('/api/panel?action=users', { headers: { 'Authorization': `Bearer ${getToken()}` } })
      if (resp.ok) setList((await resp.json()).data || [])
      else setLoadErr(L('Error al cargar equipo', 'Error loading team'))
    } catch { setLoadErr(L('Error al cargar equipo', 'Error loading team')) }
    setLoading(false)
  }

  async function addUser(e) {
    e.preventDefault()
    if (!form.email || !form.name) { setError(L('Email y nombre requeridos', 'Email and name required')); return }
    setSaving(true); setError('')
    try {
      const resp = await fetch('/api/panel?action=users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
        body: JSON.stringify(form),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || 'Error')
      setShowAdd(false)
      setForm({ email: '', name: '', role: 'support', password: '' })
      load()
    } catch (err) { setError(err.message) }
    setSaving(false)
  }

  async function toggleActive(user) {
    await fetch('/api/panel?action=users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
      body: JSON.stringify({ id: user.id, active: !user.active }),
    })
    load()
  }

  const tableBase = isDark ? 'bg-white/[0.03] border border-white/10' : 'bg-white border border-black/10 shadow-sm'
  const inputBase = isDark
    ? 'bg-white/5 border-white/10 text-white placeholder-white/30 focus:border-[#b3001e] focus:ring-[#b3001e]/25'
    : 'bg-white border-black/10 text-black placeholder-black/30 focus:border-[#b3001e] focus:ring-[#b3001e]/25'

  return (
    <div className="p-6 md:p-8 space-y-5">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex items-center justify-between flex-wrap gap-3"
      >
        <div>
          <h1 className={`text-[24px] font-black tracking-tight ${isDark ? 'text-white' : 'text-black'}`}>{L('Equipo Admin', 'Admin Team')}</h1>
          <p className={`text-[12px] mt-0.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>
            {L('Administradores de Terminal X', 'Terminal X administrators')}
          </p>
        </div>
        <motion.button
          whileTap={{ scale: 0.96 }}
          whileHover={{ scale: 1.02 }}
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-[#b3001e] text-white text-[12px] font-bold rounded-xl hover:bg-[#c8002a] transition-colors shadow-lg shadow-[#b3001e]/20"
        >
          <Plus size={14} /> {L('Agregar', 'Add')}
        </motion.button>
      </motion.div>

      <AnimatePresence>
        {showAdd && (
          <motion.form
            onSubmit={addUser}
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -4, height: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className={`rounded-2xl p-5 space-y-3 overflow-hidden ${tableBase}`}
          >
            {error && <div className="bg-[#b3001e]/10 text-[#b3001e] text-[12px] p-2.5 rounded-lg border border-[#b3001e]/25">{error}</div>}
            <div className="grid grid-cols-2 gap-3">
              <input placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className={`px-3.5 py-2.5 border rounded-xl text-[12px] outline-none transition-all focus:ring-2 ${inputBase}`} />
              <input placeholder={L('Nombre', 'Name')} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className={`px-3.5 py-2.5 border rounded-xl text-[12px] outline-none transition-all focus:ring-2 ${inputBase}`} />
              <input type="password" placeholder={L('Contraseña (mín 8) — solo si es nuevo', 'Password (min 8) — only if new')} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                className={`px-3.5 py-2.5 border rounded-xl text-[12px] outline-none transition-all focus:ring-2 ${inputBase}`} />
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                className={`px-3.5 py-2.5 border rounded-xl text-[12px] outline-none transition-all focus:ring-2 ${inputBase}`}>
                <option value="support">{L('Soporte', 'Support')}</option>
                <option value="sales">{L('Ventas / CRM', 'Sales / CRM')}</option>
                <option value="sales_manager">{L('Gerente de Ventas', 'Sales Manager')}</option>
                <option value="admin">Admin</option>
                <option value="super_admin">Super Admin</option>
              </select>
            </div>
            <p className={`text-[11px] ${isDark ? 'text-white/40' : 'text-black/40'}`}>
              {L('Si el email no tiene cuenta auth, se creará con la contraseña ingresada.', 'If the email has no auth account, one will be created with the entered password.')}
            </p>
            <div className="flex gap-2">
              <motion.button
                whileTap={{ scale: 0.97 }}
                type="submit"
                disabled={saving}
                className="px-4 py-2.5 bg-[#b3001e] text-white text-[12px] font-bold rounded-xl hover:bg-[#c8002a] disabled:opacity-50 transition-colors"
              >
                {saving ? L('Guardando...', 'Saving...') : L('Guardar', 'Save')}
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.97 }}
                type="button"
                onClick={() => { setShowAdd(false); setError('') }}
                className={`px-4 py-2.5 text-[12px] font-semibold border rounded-xl transition-colors ${isDark ? 'text-white/50 border-white/10 hover:bg-white/5' : 'text-black/50 border-black/10 hover:bg-black/5'}`}
              >
                {L('Cancelar', 'Cancel')}
              </motion.button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="flex justify-center py-16">
          <motion.div className="flex gap-1.5">
            {[0, 1, 2].map(i => (
              <motion.span
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-[#b3001e]"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
              />
            ))}
          </motion.div>
        </div>
      ) : loadErr ? (
        <div className="py-12 text-center text-[13px] text-[#b3001e]">{loadErr}</div>
      ) : (
        <div className={`rounded-2xl overflow-hidden ${tableBase}`}>
          {list.length === 0 ? (
            <div className={`py-16 text-center text-[12px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#b3001e]/10 border border-[#b3001e]/20 mb-3">
                <Shield size={20} className="text-[#b3001e]" />
              </div>
              <p>{L('No hay administradores.', 'No administrators.')}</p>
            </div>
          ) : (
            <motion.div variants={listContainer} initial="initial" animate="animate">
              {list.map(u => {
                const RoleIcon = ROLE_ICONS[u.role] || Eye
                const roleLabel = ROLE_LABELS[u.role]?.[lang] || u.role
                return (
                  <motion.div
                    key={u.id}
                    variants={listItem}
                    className={`flex items-center px-5 py-3.5 border-b last:border-0 transition-colors ${isDark ? 'border-white/5 hover:bg-white/[0.04]' : 'border-black/5 hover:bg-[#b3001e]/[0.03]'}`}
                  >
                    <div className="w-9 h-9 rounded-xl bg-[#b3001e]/10 border border-[#b3001e]/25 flex items-center justify-center mr-3 shrink-0">
                      <RoleIcon size={15} className="text-[#b3001e]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[13px] font-semibold ${isDark ? 'text-white' : 'text-black'}`}>{u.name}</p>
                      <p className={`text-[10px] font-bold uppercase tracking-[1.2px] mt-0.5 text-[#b3001e]`}>{roleLabel}</p>
                    </div>
                    <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border mr-3 ${
                      u.active
                        ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                        : isDark ? 'bg-white/5 text-white/40 border-white/10' : 'bg-black/5 text-black/40 border-black/10'
                    }`}>
                      {u.active ? L('Activo', 'Active') : L('Inactivo', 'Inactive')}
                    </span>
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      onClick={() => toggleActive(u)}
                      className={`text-[11px] font-semibold transition-colors ${isDark ? 'text-white/40 hover:text-[#b3001e]' : 'text-black/40 hover:text-[#b3001e]'}`}
                    >
                      {u.active ? L('Desactivar', 'Deactivate') : L('Activar', 'Activate')}
                    </motion.button>
                  </motion.div>
                )
              })}
            </motion.div>
          )}
        </div>
      )}
    </div>
  )
}
