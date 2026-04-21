import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, Search, Plus, Trash2, X, Copy, Check } from 'lucide-react'
import OnboardingChecklist from '../components/OnboardingChecklist'
import { listContainer, listItem, modalBackdrop, modalPanel, buttonTap } from '../motion'

const EMPTY_FORM = { business_name: '', rnc: '', phone: '', email: '', password: '', plan: 'pro', platform: 'both' }

export default function Clients({ getToken, refreshToken, isDark, lang, demoMode = false }) {
  const navigate = useNavigate()
  const L = (es, en) => lang === 'es' ? es : en
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [adding, setAdding] = useState(false)
  const [addErr, setAddErr] = useState('')
  const [createdKey, setCreatedKey] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => { load() }, [demoMode])

  async function load() {
    setLoading(true); setLoadErr('')
    try {
      const url = demoMode ? '/api/panel?action=clients&demo=1' : '/api/panel?action=clients'
      const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${getToken()}` } })
      if (resp.ok) setList((await resp.json()).data || [])
      else setLoadErr(L('Error al cargar clientes', 'Error loading clients'))
    } catch { setLoadErr(L('Error al cargar clientes', 'Error loading clients')) }
    setLoading(false)
  }

  async function createClient() {
    if (!form.business_name.trim() || !form.email.trim() || !form.password.trim()) {
      setAddErr(L('Nombre, email y contrasena requeridos', 'Name, email, and password required')); return
    }
    if (form.password.length < 6) { setAddErr(L('La contrasena debe tener al menos 6 caracteres', 'Password must be at least 6 characters')); return }
    setAdding(true); setAddErr('')
    try {
      const resp = await fetch('/api/panel?action=clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
        body: JSON.stringify(form),
      })
      if (!resp.ok) { const r = await resp.json(); throw new Error(r.error || 'Error') }
      const result = await resp.json()
      if (result.data?.license_key) {
        setCreatedKey(result.data.license_key)
      } else {
        setShowAdd(false); setForm(EMPTY_FORM)
      }
      load()
    } catch (e) { setAddErr(e.message) }
    finally { setAdding(false) }
  }

  async function deleteClient(id, name) {
    if (!confirm(L(`Eliminar "${name}" y todos sus datos?`, `Delete "${name}" and all its data?`))) return
    try {
      await fetch('/api/panel?action=clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
        body: JSON.stringify({ id, action: 'delete' }),
      })
      load()
    } catch {}
  }

  const filtered = list.filter(b => {
    if (!search) return true
    const s = search.toLowerCase()
    return (b.name || '').toLowerCase().includes(s) || (b.rnc || '').includes(s)
  })

  const tableBase = isDark
    ? 'bg-white/[0.03] border border-white/10'
    : 'bg-white border border-black/10 shadow-sm'

  const inputBase = isDark
    ? 'bg-white/5 border-white/10 text-white placeholder-white/30 focus:border-[#b3001e] focus:ring-[#b3001e]/25'
    : 'bg-white border-black/10 text-black placeholder-black/30 focus:border-[#b3001e] focus:ring-[#b3001e]/25'

  return (
    <div className="p-6 md:p-8 space-y-5">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex items-center justify-between flex-wrap gap-3"
      >
        <div>
          <h1 className={`text-[24px] font-black tracking-tight ${isDark ? 'text-white' : 'text-black'}`}>{demoMode ? L('Demos', 'Demos') : L('Clientes', 'Clients')}</h1>
          <p className={`text-[12px] mt-0.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>
            {list.length} {demoMode ? L('cuentas demo', 'demo accounts') : L('negocios registrados', 'registered businesses')}
          </p>
        </div>
        {!demoMode && (
          <motion.button
            whileTap={{ scale: 0.96 }}
            whileHover={{ scale: 1.02 }}
            onClick={() => { setForm(EMPTY_FORM); setAddErr(''); setShowAdd(true) }}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-[#b3001e] text-white text-[12px] font-bold rounded-xl hover:bg-[#c8002a] transition-colors shadow-lg shadow-[#b3001e]/20"
          >
            <Plus size={14} /> {L('Nuevo Cliente', 'New Client')}
          </motion.button>
        )}
      </motion.div>

      {/* Search */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.08 }}
        className="relative max-w-sm"
      >
        <Search size={15} className={`absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none z-10 ${isDark ? 'text-white/30' : 'text-black/30'}`} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={L('Buscar por nombre o RNC...', 'Search by name or RNC...')}
          style={{ paddingLeft: 38 }}
          className={`w-full pr-3 py-2.5 border rounded-xl text-[12px] outline-none transition-all focus:ring-2 ${inputBase}`}
        />
      </motion.div>

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
          <div className={`hidden md:flex items-center px-5 py-3 border-b text-[10px] font-bold uppercase tracking-[1.2px] ${
            isDark ? 'bg-white/[0.02] border-white/10 text-white/30' : 'bg-black/[0.02] border-black/5 text-black/35'
          }`}>
            <span className="flex-1">{L('Negocio', 'Business')}</span>
            <span className="w-28">RNC</span>
            <span className="w-24">Plan</span>
            <span className="w-14 text-center">Setup</span>
            <span className="w-20 text-center">Staff</span>
            <span className="w-20 text-center">Tickets</span>
            <span className="w-24 text-center">{L('Estado', 'Status')}</span>
            <span className="w-28">{L('Ultimo acceso', 'Last seen')}</span>
            <span className="w-16 text-right">{L('Accion', 'Action')}</span>
          </div>

          {filtered.length === 0 ? (
            <div className={`py-16 text-center text-[12px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#b3001e]/10 border border-[#b3001e]/20 mb-3">
                <Search size={20} className="text-[#b3001e]" />
              </div>
              <p>{L('Sin clientes.', 'No clients.')}</p>
            </div>
          ) : (
            <motion.div variants={listContainer} initial="initial" animate="animate">
              {filtered.map(b => (
                <motion.div
                  key={b.id}
                  variants={listItem}
                  className={`border-b last:border-0 transition-colors cursor-pointer ${
                    isDark ? 'border-white/5 hover:bg-white/[0.04]' : 'border-black/5 hover:bg-[#b3001e]/[0.03]'
                  }`}
                >
                  {/* Desktop row */}
                  <div className="hidden md:flex md:items-center px-5 py-3.5" onClick={() => navigate(`/admin/clients/${b.id}`)}>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[13px] font-semibold truncate ${isDark ? 'text-white' : 'text-black'}`}>{b.name}</p>
                      <p className={`text-[11px] ${isDark ? 'text-white/40' : 'text-black/40'}`}>{b.phone || ''}</p>
                    </div>
                    <span className={`w-28 text-[12px] ${isDark ? 'text-white/50' : 'text-black/50'}`}>{b.rnc || '—'}</span>
                    <span className={`w-24 text-[12px] font-medium ${isDark ? 'text-white/70' : 'text-black/70'}`}>{b.license?.plans?.display_name || b.plan || 'Free'}</span>
                    <div className="w-14 flex justify-center"><OnboardingChecklist onboarding={b.onboarding} compact isDark={isDark} /></div>
                    <span className={`w-20 text-center text-[13px] font-bold ${isDark ? 'text-white' : 'text-black'}`}>{b.staffCount}</span>
                    <span className={`w-20 text-center text-[13px] font-bold ${isDark ? 'text-white' : 'text-black'}`}>{b.ticketCount}</span>
                    <div className="w-24 flex justify-center">
                      <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${
                        b.license?.status === 'active'
                          ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                          : isDark ? 'bg-white/5 text-white/40 border-white/10' : 'bg-black/5 text-black/40 border-black/10'
                      }`}>
                        {b.license?.status || L('Sin licencia', 'No license')}
                      </span>
                    </div>
                    <span className={`w-28 text-[11px] ${isDark ? 'text-white/35' : 'text-black/35'}`}>
                      {b.license?.last_seen ? new Date(b.license.last_seen).toLocaleDateString(lang === 'es' ? 'es-DO' : 'en-US') : '—'}
                    </span>
                    <div className="w-16 flex justify-end">
                      <motion.button
                        whileTap={{ scale: 0.9 }}
                        onClick={(e) => { e.stopPropagation(); deleteClient(b.id, b.name) }}
                        title={L('Eliminar', 'Delete')}
                        className={`p-1.5 rounded-lg transition-colors ${isDark ? 'text-white/30 hover:text-[#b3001e] hover:bg-[#b3001e]/10' : 'text-black/30 hover:text-[#b3001e] hover:bg-[#b3001e]/10'}`}
                      >
                        <Trash2 size={13} />
                      </motion.button>
                    </div>
                  </div>

                  {/* Mobile card */}
                  <div className="md:hidden px-4 py-3 space-y-2" onClick={() => navigate(`/admin/clients/${b.id}`)}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className={`text-[13px] font-semibold truncate ${isDark ? 'text-white' : 'text-black'}`}>{b.name}</p>
                        <p className={`text-[11px] ${isDark ? 'text-white/40' : 'text-black/40'}`}>{b.rnc || '—'} / {b.phone || '—'}</p>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${
                        b.license?.status === 'active'
                          ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                          : isDark ? 'bg-white/5 text-white/40 border-white/10' : 'bg-black/5 text-black/40 border-black/10'
                      }`}>
                        {b.license?.status || L('Sin licencia', 'No license')}
                      </span>
                    </div>
                    <div className={`flex items-center justify-between text-[11px] ${isDark ? 'text-white/50' : 'text-black/50'}`}>
                      <span>Plan: <span className={`font-semibold ${isDark ? 'text-white/80' : 'text-black/80'}`}>{b.license?.plans?.display_name || b.plan || 'Free'}</span></span>
                      <span>{b.staffCount} staff / {b.ticketCount} tickets</span>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <motion.button
                        whileTap={{ scale: 0.94 }}
                        onClick={(e) => { e.stopPropagation(); deleteClient(b.id, b.name) }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-[#b3001e] bg-[#b3001e]/10 border border-[#b3001e]/25"
                      >
                        <Trash2 size={12} /> {L('Eliminar', 'Delete')}
                      </motion.button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>
      )}

      {/* Add Client Modal */}
      <AnimatePresence>
        {showAdd && (
          <motion.div
            variants={modalBackdrop}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => !createdKey && setShowAdd(false)}
          >
            <motion.div
              variants={modalPanel}
              onClick={(e) => e.stopPropagation()}
              className={`rounded-3xl shadow-2xl w-full max-w-md overflow-hidden ${isDark ? 'bg-black border border-white/10' : 'bg-white border border-black/10'}`}
            >
              <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? 'border-white/10' : 'border-black/10'}`}>
                <h3 className={`text-[15px] font-bold ${isDark ? 'text-white' : 'text-black'}`}>{L('Nuevo Cliente', 'New Client')}</h3>
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setShowAdd(false)}
                  className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-white/10 text-white/40' : 'hover:bg-black/5 text-black/40'}`}
                >
                  <X size={16} />
                </motion.button>
              </div>
              <div className="px-6 py-5 space-y-3.5">
                <div>
                  <label className={`block text-[10px] font-bold uppercase tracking-[1.2px] mb-1.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{L('Nombre del negocio *', 'Business name *')}</label>
                  <input value={form.business_name} onChange={e => setForm(f => ({ ...f, business_name: e.target.value }))}
                    placeholder="Car Wash Express"
                    className={`w-full px-3.5 py-2.5 border rounded-xl text-[13px] outline-none transition-all focus:ring-2 ${inputBase}`} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`block text-[10px] font-bold uppercase tracking-[1.2px] mb-1.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>RNC</label>
                    <input value={form.rnc} onChange={e => setForm(f => ({ ...f, rnc: e.target.value }))}
                      placeholder="123-45678-9"
                      className={`w-full px-3.5 py-2.5 border rounded-xl text-[13px] outline-none transition-all focus:ring-2 ${inputBase}`} />
                  </div>
                  <div>
                    <label className={`block text-[10px] font-bold uppercase tracking-[1.2px] mb-1.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{L('Telefono', 'Phone')}</label>
                    <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                      placeholder="809-555-0000"
                      className={`w-full px-3.5 py-2.5 border rounded-xl text-[13px] outline-none transition-all focus:ring-2 ${inputBase}`} />
                  </div>
                </div>
                <div>
                  <label className={`block text-[10px] font-bold uppercase tracking-[1.2px] mb-1.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{L('Email del dueno *', 'Owner email *')}</label>
                  <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder={L('dueno@email.com', 'owner@email.com')}
                    className={`w-full px-3.5 py-2.5 border rounded-xl text-[13px] outline-none transition-all focus:ring-2 ${inputBase}`} />
                </div>
                <div>
                  <label className={`block text-[10px] font-bold uppercase tracking-[1.2px] mb-1.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{L('Contrasena *', 'Password *')}</label>
                  <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    placeholder={L('Minimo 6 caracteres', 'Minimum 6 characters')}
                    className={`w-full px-3.5 py-2.5 border rounded-xl text-[13px] outline-none transition-all focus:ring-2 ${inputBase}`} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`block text-[10px] font-bold uppercase tracking-[1.2px] mb-1.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>Plan</label>
                    <select value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}
                      className={`w-full px-3.5 py-2.5 border rounded-xl text-[13px] outline-none transition-all focus:ring-2 ${inputBase}`}>
                      <option value="pro">Pro</option>
                      <option value="pro_plus">Pro PLUS</option>
                      <option value="pro_max">Pro MAX</option>
                    </select>
                  </div>
                  <div>
                    <label className={`block text-[10px] font-bold uppercase tracking-[1.2px] mb-1.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{L('Plataforma', 'Platform')}</label>
                    <select value={form.platform} onChange={e => setForm(f => ({ ...f, platform: e.target.value }))}
                      className={`w-full px-3.5 py-2.5 border rounded-xl text-[13px] outline-none transition-all focus:ring-2 ${inputBase}`}>
                      <option value="both">Desktop + Web</option>
                      <option value="desktop">Desktop</option>
                      <option value="web">Web</option>
                    </select>
                  </div>
                </div>
              </div>
              {addErr && <p className="px-6 pb-2 text-[11px] text-[#b3001e] font-semibold">{addErr}</p>}
              {createdKey ? (
                <div className="px-6 py-5 space-y-3">
                  <div className="flex items-center gap-2 text-emerald-500">
                    <Check size={16} />
                    <span className="text-[13px] font-bold">{L('Cliente creado', 'Client created')}</span>
                  </div>
                  <div>
                    <p className={`text-[10px] font-bold uppercase tracking-[1.2px] mb-1.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{L('Clave de licencia', 'License key')}</p>
                    <div className={`flex items-center gap-2 rounded-xl px-3.5 py-3 border ${isDark ? 'bg-white/5 border-white/10' : 'bg-black/[0.03] border-black/10'}`}>
                      <span className={`font-mono text-[14px] font-bold flex-1 select-all ${isDark ? 'text-white' : 'text-black'}`}>{createdKey}</span>
                      <motion.button
                        whileTap={{ scale: 0.9 }}
                        onClick={() => { navigator.clipboard.writeText(createdKey); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                        className={`p-1.5 rounded-lg transition-colors ${isDark ? 'text-white/40 hover:text-[#b3001e] hover:bg-white/5' : 'text-black/40 hover:text-[#b3001e] hover:bg-black/5'}`}
                      >
                        {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                      </motion.button>
                    </div>
                    <p className={`text-[11px] mt-2 ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                      {L('Copia esta clave y usala en el paso de licencia durante la instalacion.', 'Copy this key and use it in the license step during installation.')}
                    </p>
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => { setShowAdd(false); setForm(EMPTY_FORM); setCreatedKey(''); setCopied(false) }}
                    className="w-full px-4 py-3 bg-[#b3001e] text-white text-[12px] font-bold rounded-xl hover:bg-[#c8002a] transition-colors shadow-lg shadow-[#b3001e]/20"
                  >
                    {L('Cerrar', 'Close')}
                  </motion.button>
                </div>
              ) : (
                <div className={`flex gap-2 px-6 py-4 border-t ${isDark ? 'border-white/10' : 'border-black/10'}`}>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={createClient}
                    disabled={adding}
                    className="flex-1 px-4 py-3 bg-[#b3001e] text-white text-[12px] font-bold rounded-xl hover:bg-[#c8002a] disabled:opacity-50 transition-colors shadow-lg shadow-[#b3001e]/20 flex items-center justify-center gap-1.5"
                  >
                    {adding && <Loader2 size={12} className="animate-spin" />}
                    {adding ? L('Creando...', 'Creating...') : L('Crear Cliente', 'Create Client')}
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setShowAdd(false)}
                    className={`px-4 py-3 text-[12px] font-semibold border rounded-xl transition-colors ${isDark ? 'text-white/50 border-white/10 hover:bg-white/5' : 'text-black/50 border-black/10 hover:bg-black/5'}`}
                  >
                    {L('Cancelar', 'Cancel')}
                  </motion.button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
