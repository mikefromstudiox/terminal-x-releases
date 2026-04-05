import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Search, Plus, X, ShieldCheck, Filter } from 'lucide-react'

const EMPTY_FORM = { business_name: '', rnc: '', contact_name: '', contact_phone: '', contact_email: '', package_tier: 'full' }

const PKG_BADGE = {
  advisory:           { label: 'Asesoria',        labelEn: 'Advisory',        cls: 'bg-sky-50 text-sky-700 border-sky-200',       clsDark: 'bg-sky-500/10 text-sky-400 border-sky-500/20' },
  full:               { label: 'Completo',        labelEn: 'Full',            cls: 'bg-[#b3001e]/10 text-[#b3001e] border-[#b3001e]/20', clsDark: 'bg-[#b3001e]/10 text-[#b3001e] border-[#b3001e]/20' },
  full_plus_terminal: { label: 'Completo + TX',   labelEn: 'Full + TX',       cls: 'bg-purple-50 text-purple-700 border-purple-200', clsDark: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
}

const PAY_BADGE = {
  pending: { label: 'Pendiente', labelEn: 'Pending', cls: 'bg-amber-50 text-amber-700 border-amber-200',     clsDark: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  partial: { label: 'Parcial',   labelEn: 'Partial', cls: 'bg-sky-50 text-sky-700 border-sky-200',           clsDark: 'bg-sky-500/10 text-sky-400 border-sky-500/20' },
  paid:    { label: 'Pagado',    labelEn: 'Paid',    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', clsDark: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
}

const STATUS_BADGE = {
  active:    { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', clsDark: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  completed: { cls: 'bg-sky-50 text-sky-700 border-sky-200',             clsDark: 'bg-sky-500/10 text-sky-400 border-sky-500/20' },
  paused:    { cls: 'bg-amber-50 text-amber-700 border-amber-200',       clsDark: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
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
    } catch { setLoadErr(L('Error al cargar certificaciones', 'Error loading certifications')) }
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
    } catch (e) { setAddErr(e.message) }
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

  return (
    <div className="p-6 md:p-8 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className={`text-[18px] font-bold ${isDark ? 'text-white' : 'text-black'}`}>
            <ShieldCheck size={18} className="inline mr-1.5 text-[#b3001e] -mt-0.5" />
            {L('Certificaciones e-CF', 'e-CF Certifications')}
          </h1>
          <p className={`text-[12px] ${isDark ? 'text-white/40' : 'text-black/40'}`}>
            {list.length} {L('procesos de certificacion', 'certification processes')}
          </p>
        </div>
        <button onClick={() => { setForm(EMPTY_FORM); setAddErr(''); setShowAdd(true) }}
          className="flex items-center gap-1.5 px-3 py-2 bg-[#b3001e] text-white text-[12px] font-bold rounded-lg hover:bg-[#8c0017] transition-colors">
          <Plus size={13} /> {L('Nueva Certificacion', 'New Certification')}
        </button>
      </div>

      {/* Tabs + Search */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="flex gap-1">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                tab === t.key
                  ? isDark ? 'bg-white/10 text-white' : 'bg-black text-white'
                  : isDark ? 'text-white/40 hover:text-white/60 hover:bg-white/5' : 'text-black/40 hover:text-black/60 hover:bg-black/5'
              }`}>
              {lang === 'es' ? t.es : t.en}
            </button>
          ))}
        </div>
        <div className="relative max-w-xs">
          <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? 'text-white/30' : 'text-black/30'}`} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={L('Buscar por nombre o RNC...', 'Search by name or RNC...')}
            className={`w-full pl-9 pr-3 py-2 border rounded-lg text-[12px] outline-none focus:ring-1 focus:ring-[#b3001e] ${
              isDark ? 'bg-white/5 border-white/10 text-white placeholder-white/30' : 'bg-white border-black/10 text-black placeholder-black/30'
            }`} />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className={`animate-spin ${isDark ? 'text-white/20' : 'text-black/20'}`} size={20} /></div>
      ) : loadErr ? (
        <div className="py-12 text-center text-[13px] text-red-500">{loadErr}</div>
      ) : (
        <div className={`rounded-2xl overflow-hidden border ${isDark ? 'bg-white/5 border-white/10' : 'bg-white border-black/10'}`}>
          {/* Desktop header */}
          <div className={`hidden md:flex items-center px-5 py-2.5 border-b text-[10px] font-bold uppercase tracking-wider ${
            isDark ? 'bg-white/5 border-white/10 text-white/30' : 'bg-black/[0.02] border-black/10 text-black/30'
          }`}>
            <span className="flex-1">{L('Negocio', 'Business')}</span>
            <span className="w-28">RNC</span>
            <span className="w-28">{L('Paquete', 'Package')}</span>
            <span className="w-24">{L('Paso', 'Step')}</span>
            <span className="w-24">{L('Pago', 'Payment')}</span>
            <span className="w-24">{L('Estado', 'Status')}</span>
            <span className="w-28">{L('Creado', 'Created')}</span>
          </div>

          {filtered.length === 0 ? (
            <div className={`py-12 text-center text-[12px] ${isDark ? 'text-white/30' : 'text-black/30'}`}>
              {L('Sin certificaciones.', 'No certifications.')}
            </div>
          ) : filtered.map(c => {
            const pkg = PKG_BADGE[c.package_tier] || PKG_BADGE.full
            const pay = PAY_BADGE[c.payment_status] || PAY_BADGE.pending
            const status = STATUS_BADGE[c.status] || STATUS_BADGE.active
            const stepNum = c.current_step || 0
            const stepPct = Math.round((stepNum / 15) * 100)

            return (
              <div key={c.id} className={`border-b last:border-0 transition-colors cursor-pointer ${
                isDark ? 'border-white/5 hover:bg-white/[0.03]' : 'border-black/5 hover:bg-black/[0.02]'
              }`}>
                {/* Desktop row */}
                <div className="hidden md:flex md:items-center px-5 py-3" onClick={() => navigate(`/admin/certifications/${c.id}`)}>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[13px] font-semibold truncate ${isDark ? 'text-white' : 'text-black'}`}>{c.business_name}</p>
                    <p className={`text-[11px] ${isDark ? 'text-white/40' : 'text-black/40'}`}>{c.contact_name || ''}</p>
                  </div>
                  <span className={`w-28 text-[12px] ${isDark ? 'text-white/50' : 'text-black/50'}`}>{c.rnc || '--'}</span>
                  <div className="w-28">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${isDark ? pkg.clsDark : pkg.cls}`}>
                      {lang === 'es' ? pkg.label : pkg.labelEn}
                    </span>
                  </div>
                  <div className="w-24">
                    <div className="flex items-center gap-2">
                      <span className={`text-[12px] font-bold ${isDark ? 'text-white/70' : 'text-black/70'}`}>{stepNum}/15</span>
                      <div className={`flex-1 h-1 rounded-full ${isDark ? 'bg-white/10' : 'bg-black/10'}`}>
                        <div className="h-full rounded-full bg-[#b3001e] transition-all" style={{ width: `${stepPct}%` }} />
                      </div>
                    </div>
                  </div>
                  <div className="w-24">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${isDark ? pay.clsDark : pay.cls}`}>
                      {lang === 'es' ? pay.label : pay.labelEn}
                    </span>
                  </div>
                  <div className="w-24">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border capitalize ${isDark ? status.clsDark : status.cls}`}>
                      {c.status || 'active'}
                    </span>
                  </div>
                  <span className={`w-28 text-[11px] ${isDark ? 'text-white/40' : 'text-black/40'}`}>
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
                  <div className="flex items-center gap-3 text-[11px]">
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
              </div>
            )
          })}
        </div>
      )}

      {/* Add Certification Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className={`rounded-2xl shadow-2xl w-full max-w-md overflow-hidden ${isDark ? 'bg-black border border-white/10' : 'bg-white'}`}>
            <div className={`flex items-center justify-between px-5 py-4 border-b ${isDark ? 'border-white/10' : 'border-black/10'}`}>
              <h3 className={`text-[14px] font-bold ${isDark ? 'text-white' : 'text-black'}`}>
                {L('Nueva Certificacion', 'New Certification')}
              </h3>
              <button onClick={() => setShowAdd(false)} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/10 text-white/40' : 'hover:bg-black/5 text-black/40'}`}>
                <X size={16} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className={`block text-[11px] font-bold mb-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{L('Nombre del negocio *', 'Business name *')}</label>
                <input value={form.business_name} onChange={e => setForm(f => ({ ...f, business_name: e.target.value }))}
                  placeholder="Studio X Tech SRL"
                  className={`w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1 focus:ring-[#b3001e] ${
                    isDark ? 'bg-white/5 border-white/10 text-white placeholder-white/30' : 'bg-white border-black/10 text-black placeholder-black/30'
                  }`} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`block text-[11px] font-bold mb-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>RNC *</label>
                  <input value={form.rnc} onChange={e => setForm(f => ({ ...f, rnc: e.target.value }))}
                    placeholder="133410321"
                    className={`w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1 focus:ring-[#b3001e] ${
                      isDark ? 'bg-white/5 border-white/10 text-white placeholder-white/30' : 'bg-white border-black/10 text-black placeholder-black/30'
                    }`} />
                </div>
                <div>
                  <label className={`block text-[11px] font-bold mb-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{L('Paquete', 'Package')}</label>
                  <select value={form.package_tier} onChange={e => setForm(f => ({ ...f, package_tier: e.target.value }))}
                    className={`w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1 focus:ring-[#b3001e] ${
                      isDark ? 'bg-white/5 border-white/10 text-white' : 'bg-white border-black/10 text-black'
                    }`}>
                    <option value="advisory">{L('Asesoria', 'Advisory')}</option>
                    <option value="full">{L('Completo', 'Full')}</option>
                    <option value="full_plus_terminal">{L('Completo + Terminal X', 'Full + Terminal X')}</option>
                  </select>
                </div>
              </div>
              <div>
                <label className={`block text-[11px] font-bold mb-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{L('Nombre de contacto *', 'Contact name *')}</label>
                <input value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))}
                  placeholder="Juan Perez"
                  className={`w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1 focus:ring-[#b3001e] ${
                    isDark ? 'bg-white/5 border-white/10 text-white placeholder-white/30' : 'bg-white border-black/10 text-black placeholder-black/30'
                  }`} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`block text-[11px] font-bold mb-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{L('Telefono', 'Phone')}</label>
                  <input value={form.contact_phone} onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))}
                    placeholder="809-555-0000"
                    className={`w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1 focus:ring-[#b3001e] ${
                      isDark ? 'bg-white/5 border-white/10 text-white placeholder-white/30' : 'bg-white border-black/10 text-black placeholder-black/30'
                    }`} />
                </div>
                <div>
                  <label className={`block text-[11px] font-bold mb-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>Email</label>
                  <input type="email" value={form.contact_email} onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))}
                    placeholder="contacto@email.com"
                    className={`w-full px-3 py-2 border rounded-lg text-[13px] focus:outline-none focus:ring-1 focus:ring-[#b3001e] ${
                      isDark ? 'bg-white/5 border-white/10 text-white placeholder-white/30' : 'bg-white border-black/10 text-black placeholder-black/30'
                    }`} />
                </div>
              </div>
            </div>
            {addErr && <p className="px-5 pb-2 text-[11px] text-red-500">{addErr}</p>}
            <div className={`flex gap-2 px-5 py-4 border-t ${isDark ? 'border-white/10' : 'border-black/10'}`}>
              <button onClick={createCert} disabled={adding}
                className="flex-1 px-4 py-2.5 bg-[#b3001e] text-white text-[12px] font-bold rounded-lg hover:bg-[#8c0017] disabled:opacity-50 transition-colors">
                {adding ? L('Creando...', 'Creating...') : L('Crear Certificacion', 'Create Certification')}
              </button>
              <button onClick={() => setShowAdd(false)}
                className={`px-4 py-2.5 text-[12px] border rounded-lg ${
                  isDark ? 'text-white/50 border-white/10 hover:bg-white/5' : 'text-black/50 border-black/10 hover:bg-black/5'
                }`}>
                {L('Cancelar', 'Cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
