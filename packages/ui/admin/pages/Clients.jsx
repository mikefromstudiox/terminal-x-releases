import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Search, Plus, Trash2, X } from 'lucide-react'
import OnboardingChecklist from '../components/OnboardingChecklist'

import { Copy, Check } from 'lucide-react'

const EMPTY_FORM = { business_name: '', rnc: '', phone: '', email: '', password: '', plan: 'pro', platform: 'both' }

export default function Clients({ getToken, refreshToken, isDark, lang }) {
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

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setLoadErr('')
    try {
      const resp = await fetch('/api/panel?action=clients', { headers: { 'Authorization': `Bearer ${getToken()}` } })
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

  return (
    <div className="p-6 md:p-8 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className={`text-[18px] font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>{L('Clientes', 'Clients')}</h1>
          <p className="text-[12px] text-slate-400">{list.length} {L('negocios registrados', 'registered businesses')}</p>
        </div>
        <button onClick={() => { setForm(EMPTY_FORM); setAddErr(''); setShowAdd(true) }}
          className="flex items-center gap-1.5 px-3 py-2 bg-[#b3001e] text-white text-[12px] font-bold rounded-lg hover:bg-[#8c0017] transition-colors">
          <Plus size={13} /> {L('Nuevo Cliente', 'New Client')}
        </button>
      </div>

      <div className="relative max-w-xs">
        <Search size={16} className={`absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none z-10 ${isDark ? 'text-white/30' : 'text-slate-400'}`} />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder={L('Buscar por nombre o RNC...', 'Search by name or RNC...')}
          style={{ paddingLeft: 36 }}
          className={`w-full pr-3 py-2 border rounded-lg text-[12px] outline-none focus:ring-1 focus:ring-sky-400 ${isDark ? 'bg-white/5 border-white/10 text-white placeholder-white/30' : 'border-slate-200 bg-white text-slate-900 placeholder-slate-400'}`} />
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-slate-300" size={20} /></div>
      ) : loadErr ? (
        <div className="py-12 text-center text-[13px] text-red-500">{loadErr}</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="hidden md:flex items-center px-5 py-2.5 bg-slate-50 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
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
            <div className="py-12 text-center text-[12px] text-slate-400">{L('Sin clientes.', 'No clients.')}</div>
          ) : filtered.map(b => (
            <div key={b.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60 transition-colors">
              {/* Desktop row */}
              <div className="hidden md:flex md:items-center px-5 py-3 cursor-pointer" onClick={() => navigate(`/admin/clients/${b.id}`)}>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-slate-800 truncate">{b.name}</p>
                  <p className="text-[11px] text-slate-400">{b.phone || ''}</p>
                </div>
                <span className="w-28 text-[12px] text-slate-500">{b.rnc || '—'}</span>
                <span className="w-24 text-[12px] text-slate-600">{b.license?.plans?.display_name || b.plan || 'Free'}</span>
                <div className="w-14 flex justify-center"><OnboardingChecklist onboarding={b.onboarding} compact isDark={isDark} /></div>
                <span className="w-20 text-center text-[13px] font-semibold text-slate-700">{b.staffCount}</span>
                <span className="w-20 text-center text-[13px] font-semibold text-slate-700">{b.ticketCount}</span>
                <div className="w-24 flex justify-center">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    b.license?.status === 'active' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-100 text-slate-500 border-slate-200'
                  }`}>
                    {b.license?.status || L('Sin licencia', 'No license')}
                  </span>
                </div>
                <span className="w-28 text-[11px] text-slate-400">
                  {b.license?.last_seen ? new Date(b.license.last_seen).toLocaleDateString(lang === 'es' ? 'es-DO' : 'en-US') : '—'}
                </span>
                <div className="w-16 flex justify-end">
                  <button onClick={(e) => { e.stopPropagation(); deleteClient(b.id, b.name) }} title={L('Eliminar', 'Delete')}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              {/* Mobile card */}
              <div className="md:hidden px-4 py-3 space-y-2 cursor-pointer" onClick={() => navigate(`/admin/clients/${b.id}`)}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800 truncate">{b.name}</p>
                    <p className="text-[11px] text-slate-400">{b.rnc || '—'} / {b.phone || '—'}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${
                    b.license?.status === 'active' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-100 text-slate-500 border-slate-200'
                  }`}>
                    {b.license?.status || L('Sin licencia', 'No license')}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">Plan: <span className="font-semibold text-slate-700">{b.license?.plans?.display_name || b.plan || 'Free'}</span></span>
                  <span className="text-slate-400">{b.staffCount} staff / {b.ticketCount} tickets</span>
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={(e) => { e.stopPropagation(); deleteClient(b.id, b.name) }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-red-600 bg-red-50 border border-red-200">
                    <Trash2 size={12} /> {L('Eliminar', 'Delete')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Client Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h3 className="text-[14px] font-bold text-slate-800">{L('Nuevo Cliente', 'New Client')}</h3>
              <button onClick={() => setShowAdd(false)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
                <X size={16} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">{L('Nombre del negocio *', 'Business name *')}</label>
                <input value={form.business_name} onChange={e => setForm(f => ({ ...f, business_name: e.target.value }))}
                  placeholder="Car Wash Express" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:border-sky-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">RNC</label>
                  <input value={form.rnc} onChange={e => setForm(f => ({ ...f, rnc: e.target.value }))}
                    placeholder="123-45678-9" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:border-sky-400" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">{L('Telefono', 'Phone')}</label>
                  <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="809-555-0000" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:border-sky-400" />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">{L('Email del dueno *', 'Owner email *')}</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder={L('dueno@email.com', 'owner@email.com')} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:border-sky-400" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">{L('Contrasena *', 'Password *')}</label>
                <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder={L('Minimo 6 caracteres', 'Minimum 6 characters')} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:border-sky-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">Plan</label>
                  <select value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:border-sky-400 bg-white">
                    <option value="pro">Pro</option>
                    <option value="pro_plus">Pro PLUS</option>
                    <option value="pro_max">Pro MAX</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">{L('Plataforma', 'Platform')}</label>
                  <select value={form.platform} onChange={e => setForm(f => ({ ...f, platform: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:border-sky-400 bg-white">
                    <option value="both">Desktop + Web</option>
                    <option value="desktop">Desktop</option>
                    <option value="web">Web</option>
                  </select>
                </div>
              </div>
            </div>
            {addErr && <p className="px-5 pb-2 text-[11px] text-red-500">{addErr}</p>}
            {createdKey ? (
              <div className="px-5 py-5 space-y-3">
                <div className="flex items-center gap-2 text-emerald-600">
                  <Check size={16} />
                  <span className="text-[13px] font-semibold">{L('Cliente creado', 'Client created')}</span>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{L('Clave de licencia', 'License key')}</p>
                  <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
                    <span className="font-mono text-[14px] font-bold text-slate-800 flex-1 select-all">{createdKey}</span>
                    <button onClick={() => { navigator.clipboard.writeText(createdKey); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-[#b3001e] hover:bg-slate-100 transition-colors">
                      {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-2">{L('Copia esta clave y usala en el paso de licencia durante la instalacion.', 'Copy this key and use it in the license step during installation.')}</p>
                </div>
                <button onClick={() => { setShowAdd(false); setForm(EMPTY_FORM); setCreatedKey(''); setCopied(false) }}
                  className="w-full px-4 py-2.5 bg-[#b3001e] text-white text-[12px] font-bold rounded-lg hover:bg-[#8c0017] transition-colors">
                  {L('Cerrar', 'Close')}
                </button>
              </div>
            ) : (
              <div className="flex gap-2 px-5 py-4 border-t border-slate-100">
                <button onClick={createClient} disabled={adding}
                  className="flex-1 px-4 py-2.5 bg-[#b3001e] text-white text-[12px] font-bold rounded-lg hover:bg-[#8c0017] disabled:opacity-50 transition-colors">
                  {adding ? L('Creando...', 'Creating...') : L('Crear Cliente', 'Create Client')}
                </button>
                <button onClick={() => setShowAdd(false)}
                  className="px-4 py-2.5 text-[12px] text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">
                  {L('Cancelar', 'Cancel')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
