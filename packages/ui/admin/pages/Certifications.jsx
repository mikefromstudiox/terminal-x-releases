import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, Search, Plus, X, ShieldCheck } from 'lucide-react'
import { listContainer, listItem, modalBackdrop, modalPanel } from '../motion'

const EMPTY_FORM = { business_name: '', rnc: '', contact_name: '', contact_phone: '', contact_email: '', package_tier: 'full' }

// Brand-pure: advisory=white/soft, full=red, full_plus=red solid
const PKG_BADGE = {
  advisory:           { label: 'Asesoria',      labelEn: 'Advisory',      cls: 'bg-black/5 text-black/70 border-black/15',             clsDark: 'bg-white/5 text-white/70 border-white/15' },
  full:               { label: 'Completo',      labelEn: 'Full',          cls: 'bg-[#b3001e]/10 text-[#b3001e] border-[#b3001e]/25',   clsDark: 'bg-[#b3001e]/15 text-[#b3001e] border-[#b3001e]/30' },
  full_plus_terminal: { label: 'Completo + TX', labelEn: 'Full + TX',     cls: 'bg-[#b3001e] text-white border-[#b3001e]',             clsDark: 'bg-[#b3001e] text-white border-[#b3001e]' },
}

const PAY_BADGE = {
  pending: { label: 'Pendiente', labelEn: 'Pending', cls: 'bg-amber-500/10 text-amber-600 border-amber-500/30',       clsDark: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  partial: { label: 'Parcial',   labelEn: 'Partial', cls: 'bg-[#b3001e]/10 text-[#b3001e] border-[#b3001e]/25',       clsDark: 'bg-[#b3001e]/15 text-[#b3001e] border-[#b3001e]/30' },
  paid:    { label: 'Pagado',    labelEn: 'Paid',    cls: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30', clsDark: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
}

const STATUS_BADGE = {
  active:    { cls: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30', clsDark: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  completed: { cls: 'bg-[#b3001e]/10 text-[#b3001e] border-[#b3001e]/25',       clsDark: 'bg-[#b3001e]/15 text-[#b3001e] border-[#b3001e]/30' },
  paused:    { cls: 'bg-amber-500/10 text-amber-600 border-amber-500/30',       clsDark: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
}

export default function Certifications({ getToken, refreshToken, isDark, lang }) {
  const navigate = useNavigate()
  const L = (es, en) => lang === 'es' ? es : en
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('all')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [adding, setAdding] = useState(false)
  const [addErr, setAddErr] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setLoadErr('')
    try {
      const resp = await fetch('/api/panel?action=cert_list', { headers: { 'Authorization': `Bearer ${getToken()}` } })
      if (resp.ok) setList((await resp.json()).data || [])
      else setLoadErr(L('Error al cargar certificaciones', 'Error loading certifications'))
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'certifications.certifications' }) } catch {} setLoadErr(L('Error al cargar certificaciones', 'Error loading certifications')) }
    setLoading(false)
  }

  async function createCert() {
    if (!form.business_name.trim() || !form.rnc.trim() || !form.contact_name.trim()) {
      setAddErr(L('Nombre, RNC y contacto requeridos', 'Name, RNC and contact required')); return
    }
    setAdding(true); setAddErr('')
    try {
      const resp = await fetch('/api/panel?action=cert_create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
        body: JSON.stringify(form),
      })
      if (!resp.ok) { const r = await resp.json(); throw new Error(r.error || 'Error') }
      setShowAdd(false); setForm(EMPTY_FORM)
      load()
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'certifications.certifications' }) } catch {} setAddErr(e.message) }
    finally { setAdding(false) }
  }

  const TABS = [
    { key: 'all',       es: 'Todas',       en: 'All' },
    { key: 'active',    es: 'Activas',     en: 'Active' },
    { key: 'completed', es: 'Completadas', en: 'Completed' },
    { key: 'paused',    es: 'Pausadas',    en: 'Paused' },
  ]

  const filtered = list.filter(c => {
    if (tab !== 'all' && c.status !== tab) return false
    if (!search) return true
    const s = search.toLowerCase()
    return (c.business_name || '').toLowerCase().includes(s) || (c.rnc || '').includes(s)
  })

  const tableBase = isDark ? 'bg-white/[0.03] border border-white/10' : 'bg-white border border-black/10 shadow-sm'
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
          <h1 className={`text-[24px] font-black tracking-tight flex items-center gap-2 ${isDark ? 'text-white' : 'text-black'}`}>
            <ShieldCheck size={22} className="text-[#b3001e]" />
            {L('Certificaciones e-CF', 'e-CF Certifications')}
          </h1>
          <p className={`text-[12px] mt-0.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>
            {list.length} {L('procesos de certificacion', 'certification processes')}
          </p>
        </div>
        <motion.button
          whileTap={{ scale: 0.96 }}
          whileHover={{ scale: 1.02 }}
          onClick={() => { setForm(EMPTY_FORM); setAddErr(''); setShowAdd(true) }}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-[#b3001e] text-white text-[12px] font-bold rounded-xl hover:bg-[#c8002a] transition-colors shadow-lg shadow-[#b3001e]/20"
        >
          <Plus size={14} /> {L('Nueva Certificacion', 'New Certification')}
        </motion.button>
      </motion.div>

      {/* Tabs + Search */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.08 }}
        className="flex flex-col sm:flex-row gap-3 sm:items-center"
      >
        <div className="flex gap-1 relative">
          {TABS.map(t => (
            <motion.button
              key={t.key}
              whileTap={{ scale: 0.95 }}
              onClick={() => setTab(t.key)}
              className={`relative px-3.5 py-1.5 rounded-full text-[11px] font-bold transition-colors ${
                tab === t.key
                  ? 'text-white'
                  : isDark ? 'text-white/40 hover:text-white/70' : 'text-black/40 hover:text-black/70'
              }`}
            >
              {tab === t.key && (
                <motion.div
                  layoutId="certFilterPill"
                  className="absolute inset-0 rounded-full bg-[#b3001e]"
                  transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                />
              )}
              <span className="relative">{lang === 'es' ? t.es : t.en}</span>
            </motion.button>
          ))}
        </div>
        <div className="relative max-w-sm flex-1 sm:flex-none sm:w-64">
          <Search size={15} className={`absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none z-10 ${isDark ? 'text-white/30' : 'text-black/30'}`} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={L('Buscar por nombre o RNC...', 'Search by name or RNC...')}
            style={{ paddingLeft: 38 }}
            className={`w-full pr-3 py-2.5 border rounded-xl text-[12px] outline-none transition-all focus:ring-2 ${inputBase}`} />
        </div>
      </motion.div>

      {/* Table */}
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
          {/* Desktop header */}
          <div className={`hidden md:flex items-center px-5 py-3 border-b text-[10px] font-bold uppercase tracking-[1.2px] ${
            isDark ? 'bg-white/[0.02] border-white/10 text-white/30' : 'bg-black/[0.02] border-black/5 text-black/35'
          }`}>
            <span className="flex-1">{L('Negocio', 'Business')}</span>
            <span className="w-28">RNC</span>
            <span className="w-28">{L('Paquete', 'Package')}</span>
            <span className="w-28">{L('Paso', 'Step')}</span>
            <span className="w-24">{L('Pago', 'Payment')}</span>
            <span className="w-24">{L('Estado', 'Status')}</span>
            <span className="w-28">{L('Creado', 'Created')}</span>
          </div>

          {filtered.length === 0 ? (
            <div className={`py-16 text-center text-[12px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#b3001e]/10 border border-[#b3001e]/20 mb-3">
                <ShieldCheck size={20} className="text-[#b3001e]" />
              </div>
              <p>{L('Sin certificaciones.', 'No certifications.')}</p>
            </div>
          ) : (
            <motion.div variants={listContainer} initial="initial" animate="animate">
              {filtered.map(c => {
                const pkg = PKG_BADGE[c.package_tier] || PKG_BADGE.full
                const pay = PAY_BADGE[c.payment_status] || PAY_BADGE.pending
                const status = STATUS_BADGE[c.status] || STATUS_BADGE.active
                const stepNum = c.current_step || 0
                const stepPct = Math.round((stepNum / 15) * 100)

                return (
                  <motion.div
                    key={c.id}
                    variants={listItem}
                    className={`border-b last:border-0 transition-colors cursor-pointer ${
                      isDark ? 'border-white/5 hover:bg-white/[0.04]' : 'border-black/5 hover:bg-[#b3001e]/[0.03]'
                    }`}
                  >
                    {/* Desktop row */}
                    <div className="hidden md:flex md:items-center px-5 py-3.5" onClick={() => navigate(`/admin/certifications/${c.id}`)}>
                      <div className="flex-1 min-w-0">
                        <p className={`text-[13px] font-semibold truncate ${isDark ? 'text-white' : 'text-black'}`}>{c.business_name}</p>
                        <p className={`text-[11px] ${isDark ? 'text-white/40' : 'text-black/40'}`}>{c.contact_name || ''}</p>
                      </div>
                      <span className={`w-28 text-[12px] ${isDark ? 'text-white/50' : 'text-black/50'}`}>{c.rnc || '--'}</span>
                      <div className="w-28">
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${isDark ? pkg.clsDark : pkg.cls}`}>
                          {lang === 'es' ? pkg.label : pkg.labelEn}
                        </span>
                      </div>
                      <div className="w-28 pr-4">
                        <div className="flex items-center gap-2">
                          <span className={`text-[11px] font-bold whitespace-nowrap ${isDark ? 'text-white/80' : 'text-black/80'}`}>{stepNum}/15</span>
                          <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-white/10' : 'bg-black/10'}`}>
                            <motion.div
                              className="h-full rounded-full bg-[#b3001e]"
                              initial={{ width: 0 }}
                              animate={{ width: `${stepPct}%` }}
                              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="w-24">
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${isDark ? pay.clsDark : pay.cls}`}>
                          {lang === 'es' ? pay.label : pay.labelEn}
                        </span>
                      </div>
                      <div className="w-24">
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border capitalize ${isDark ? status.clsDark : status.cls}`}>
                          {c.status || 'active'}
                        </span>
                      </div>
                      <span className={`w-28 text-[11px] ${isDark ? 'text-white/35' : 'text-black/35'}`}>
                        {c.created_at ? new Date(c.created_at).toLocaleDateString(lang === 'es' ? 'es-DO' : 'en-US') : '--'}
                      </span>
                    </div>

                    {/* Mobile card */}
                    <div className="md:hidden px-4 py-3 space-y-2" onClick={() => navigate(`/admin/certifications/${c.id}`)}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className={`text-[13px] font-semibold truncate ${isDark ? 'text-white' : 'text-black'}`}>{c.business_name}</p>
                          <p className={`text-[11px] ${isDark ? 'text-white/40' : 'text-black/40'}`}>{c.rnc || '--'} / {c.contact_name || '--'}</p>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap capitalize ${isDark ? status.clsDark : status.cls}`}>
                          {c.status || 'active'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] flex-wrap">
                        <span className={`font-bold px-2 py-0.5 rounded-full border text-[10px] ${isDark ? pkg.clsDark : pkg.cls}`}>
                          {lang === 'es' ? pkg.label : pkg.labelEn}
                        </span>
                        <span className={isDark ? 'text-white/50' : 'text-black/50'}>
                          {L('Paso', 'Step')} {stepNum}/15
                        </span>
                        <span className={`font-bold px-2 py-0.5 rounded-full border text-[10px] ${isDark ? pay.clsDark : pay.cls}`}>
                          {lang === 'es' ? pay.label : pay.labelEn}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                )
              })}
            </motion.div>
          )}
        </div>
      )}

      {/* Add Certification Modal */}
      <AnimatePresence>
        {showAdd && (
          <motion.div
            variants={modalBackdrop}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => setShowAdd(false)}
          >
            <motion.div
              variants={modalPanel}
              onClick={(e) => e.stopPropagation()}
              className={`rounded-3xl shadow-2xl w-full max-w-md overflow-hidden ${isDark ? 'bg-black border border-white/10' : 'bg-white border border-black/10'}`}
            >
              <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? 'border-white/10' : 'border-black/10'}`}>
                <h3 className={`text-[15px] font-bold ${isDark ? 'text-white' : 'text-black'}`}>
                  {L('Nueva Certificacion', 'New Certification')}
                </h3>
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
                    placeholder="Studio X Tech SRL"
                    className={`w-full px-3.5 py-2.5 border rounded-xl text-[13px] outline-none transition-all focus:ring-2 ${inputBase}`} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`block text-[10px] font-bold uppercase tracking-[1.2px] mb-1.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>RNC *</label>
                    <input value={form.rnc} onChange={e => setForm(f => ({ ...f, rnc: e.target.value }))}
                      placeholder="133410321"
                      className={`w-full px-3.5 py-2.5 border rounded-xl text-[13px] outline-none transition-all focus:ring-2 ${inputBase}`} />
                  </div>
                  <div>
                    <label className={`block text-[10px] font-bold uppercase tracking-[1.2px] mb-1.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{L('Paquete', 'Package')}</label>
                    <select value={form.package_tier} onChange={e => setForm(f => ({ ...f, package_tier: e.target.value }))}
                      className={`w-full px-3.5 py-2.5 border rounded-xl text-[13px] outline-none transition-all focus:ring-2 ${inputBase}`}>
                      <option value="advisory">{L('Asesoria', 'Advisory')}</option>
                      <option value="full">{L('Completo', 'Full')}</option>
                      <option value="full_plus_terminal">{L('Completo + Terminal X', 'Full + Terminal X')}</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className={`block text-[10px] font-bold uppercase tracking-[1.2px] mb-1.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{L('Nombre de contacto *', 'Contact name *')}</label>
                  <input value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))}
                    placeholder="Juan Perez"
                    className={`w-full px-3.5 py-2.5 border rounded-xl text-[13px] outline-none transition-all focus:ring-2 ${inputBase}`} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`block text-[10px] font-bold uppercase tracking-[1.2px] mb-1.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{L('Telefono', 'Phone')}</label>
                    <input value={form.contact_phone} onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))}
                      placeholder="809-555-0000"
                      className={`w-full px-3.5 py-2.5 border rounded-xl text-[13px] outline-none transition-all focus:ring-2 ${inputBase}`} />
                  </div>
                  <div>
                    <label className={`block text-[10px] font-bold uppercase tracking-[1.2px] mb-1.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>Email</label>
                    <input type="email" value={form.contact_email} onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))}
                      placeholder="contacto@email.com"
                      className={`w-full px-3.5 py-2.5 border rounded-xl text-[13px] outline-none transition-all focus:ring-2 ${inputBase}`} />
                  </div>
                </div>
              </div>
              {addErr && <p className="px-6 pb-2 text-[11px] text-[#b3001e] font-semibold">{addErr}</p>}
              <div className={`flex gap-2 px-6 py-4 border-t ${isDark ? 'border-white/10' : 'border-black/10'}`}>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={createCert}
                  disabled={adding}
                  className="flex-1 px-4 py-3 bg-[#b3001e] text-white text-[12px] font-bold rounded-xl hover:bg-[#c8002a] disabled:opacity-50 transition-colors shadow-lg shadow-[#b3001e]/20 flex items-center justify-center gap-1.5"
                >
                  {adding && <Loader2 size={12} className="animate-spin" />}
                  {adding ? L('Creando...', 'Creating...') : L('Crear Certificacion', 'Create Certification')}
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setShowAdd(false)}
                  className={`px-4 py-3 text-[12px] font-semibold border rounded-xl transition-colors ${isDark ? 'text-white/50 border-white/10 hover:bg-white/5' : 'text-black/50 border-black/10 hover:bg-black/5'}`}
                >
                  {L('Cancelar', 'Cancel')}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
