import { useState, useEffect } from 'react'
import { Loader2, Plus, Search, RotateCcw, Ban, CheckCircle2, Clock, X } from 'lucide-react'

const STATUS_BADGE = {
  active:    'bg-green-50 text-green-700 border-green-200',
  pending:   'bg-amber-50 text-amber-700 border-amber-200',
  suspended: 'bg-red-50 text-red-700 border-red-200',
  expired:   'bg-slate-100 text-slate-500 border-slate-200',
  cancelled: 'bg-slate-100 text-slate-400 border-slate-200',
}

const EMPTY_FORM = { business_id: '', platform: 'web', max_users: '5', notes: '' }

export default function Licenses({ getToken, refreshToken, isDark, lang }) {
  const L = (es, en) => lang === 'es' ? es : en
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [showAdd, setShowAdd] = useState(false)
  const [businesses, setBusinesses] = useState([])
  const [addForm, setAddForm] = useState(EMPTY_FORM)
  const [adding, setAdding] = useState(false)
  const [addErr, setAddErr] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setLoadErr('')
    try {
      const token = getToken()
      const resp = await fetch('/api/panel?action=licenses', { headers: { 'Authorization': `Bearer ${token}` } })
      if (resp.ok) setList((await resp.json()).data || [])
      else setLoadErr(L('Error al cargar licencias', 'Error loading licenses'))
    } catch { setLoadErr(L('Error al cargar licencias', 'Error loading licenses')) }
    setLoading(false)
  }

  async function loadBusinesses() {
    try {
      const token = getToken()
      const resp = await fetch('/api/panel?action=clients', { headers: { 'Authorization': `Bearer ${token}` } })
      if (resp.ok) {
        const result = await resp.json()
        setBusinesses((result.data || []).map(b => ({ id: b.id, name: b.name, rnc: b.rnc })))
      }
    } catch {}
  }

  async function updateLicense(id, patch) {
    const token = getToken()
    await fetch('/api/panel?action=licenses', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ id, ...patch }),
    })
    load()
  }

  async function createLicense() {
    if (!addForm.business_id) { setAddErr(L('Seleccione un negocio', 'Select a business')); return }
    setAdding(true); setAddErr('')
    try {
      const token = getToken()
      const resp = await fetch('/api/panel?action=licenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          business_id: addForm.business_id,
          platform: addForm.platform,
          max_users: parseInt(addForm.max_users) || 5,
          notes: addForm.notes.trim() || null,
        }),
      })
      if (!resp.ok) {
        const r = await resp.json()
        throw new Error(r.error || L('Error al crear', 'Error creating'))
      }
      setShowAdd(false)
      setAddForm(EMPTY_FORM)
      load()
    } catch (e) { setAddErr(e.message) }
    finally { setAdding(false) }
  }

  function openAdd() {
    setAddForm(EMPTY_FORM)
    setAddErr('')
    setShowAdd(true)
    if (!businesses.length) loadBusinesses()
  }

  const FILTER_LABELS = { all: L('Todas', 'All'), active: L('Activa', 'Active'), pending: L('Pendiente', 'Pending'), suspended: L('Suspendida', 'Suspended'), expired: L('Expirada', 'Expired') }

  const filtered = list.filter(l => {
    if (filter !== 'all' && l.status !== filter) return false
    if (search) {
      const s = search.toLowerCase()
      return (l.businesses?.name || '').toLowerCase().includes(s) ||
             (l.businesses?.rnc || '').includes(s) ||
             (l.license_key || '').toLowerCase().includes(s)
    }
    return true
  })

  return (
    <div className="p-6 md:p-8 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className={`text-[18px] font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>{L('Licencias', 'Licenses')}</h1>
          <p className="text-[12px] text-slate-400">{list.length} total</p>
        </div>
        <button onClick={openAdd}
          className="flex items-center gap-1.5 px-3 py-2 bg-[#b3001e] text-white text-[12px] font-bold rounded-lg hover:bg-[#8c0017] transition-colors">
          <Plus size={13} /> {L('Nueva Licencia', 'New License')}
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={L('Buscar por nombre, RNC o clave...', 'Search by name, RNC, or key...')}
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-[12px] outline-none focus:border-sky-400" />
        </div>
        {['all', 'active', 'pending', 'suspended', 'expired'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-colors ${
              filter === f ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-400'
            }`}>
            {FILTER_LABELS[f] || f}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-slate-300" size={20} /></div>
      ) : loadErr ? (
        <div className="py-12 text-center text-[13px] text-red-500">{loadErr}</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          {/* Desktop table header */}
          <div className="hidden lg:flex items-center px-5 py-2.5 bg-slate-50 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            <span className="flex-1">{L('Negocio', 'Business')}</span>
            <span className="w-28">RNC</span>
            <span className="w-40">{L('Clave', 'Key')}</span>
            <span className="w-24">Plan</span>
            <span className="w-24 text-center">{L('Estado', 'Status')}</span>
            <span className="w-28">{L('Ultimo acceso', 'Last seen')}</span>
            <span className="w-24 text-right">{L('Acciones', 'Actions')}</span>
          </div>
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-[12px] text-slate-400">{L('Sin licencias.', 'No licenses.')}</div>
          ) : filtered.map(l => (
            <div key={l.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60 transition-colors">
              {/* Desktop row */}
              <div className="hidden lg:flex items-center px-5 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-slate-800 truncate">{l.businesses?.name || '—'}</p>
                  <p className="text-[11px] text-slate-400">{l.platform}</p>
                </div>
                <span className="w-28 text-[12px] text-slate-500">{l.businesses?.rnc || '—'}</span>
                <span className="w-40 text-[11px] font-mono text-slate-600">{l.license_key || L('Solo web', 'Web only')}</span>
                <span className="w-24 text-[12px] text-slate-600">{l.plans?.display_name || '—'}</span>
                <div className="w-24 flex justify-center">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_BADGE[l.status] || STATUS_BADGE.cancelled}`}>
                    {l.status}
                  </span>
                </div>
                <span className="w-28 text-[11px] text-slate-400">
                  {l.last_seen ? new Date(l.last_seen).toLocaleDateString(lang === 'es' ? 'es-DO' : 'en-US') : '—'}
                </span>
                <div className="w-24 flex justify-end gap-1">
                  {l.status === 'active' && (
                    <button onClick={() => updateLicense(l.id, { status: 'suspended' })} title={L('Suspender', 'Suspend')}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50"><Ban size={13} /></button>
                  )}
                  {(l.status === 'suspended' || l.status === 'pending') && (
                    <button onClick={() => updateLicense(l.id, { status: 'active' })} title={L('Activar', 'Activate')}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-green-600 hover:bg-green-50"><CheckCircle2 size={13} /></button>
                  )}
                  {l.hardware_id && (
                    <button onClick={() => updateLicense(l.id, { hardware_id: null })} title="Reset HWID"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50"><RotateCcw size={13} /></button>
                  )}
                </div>
              </div>

              {/* Mobile card */}
              <div className="lg:hidden px-4 py-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800 truncate">{l.businesses?.name || '—'}</p>
                    <p className="text-[11px] text-slate-400">{l.businesses?.rnc || '—'} / {l.platform}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${STATUS_BADGE[l.status] || STATUS_BADGE.cancelled}`}>
                    {l.status}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">Plan: <span className="font-semibold text-slate-700">{l.plans?.display_name || '—'}</span></span>
                  <span className="text-slate-400">{l.last_seen ? new Date(l.last_seen).toLocaleDateString(lang === 'es' ? 'es-DO' : 'en-US') : '—'}</span>
                </div>
                {l.license_key && (
                  <p className="font-mono text-[10px] text-slate-500 bg-slate-50 px-2 py-1 rounded-lg truncate">{l.license_key}</p>
                )}
                <div className="flex gap-2 pt-1">
                  {l.status === 'active' && (
                    <button onClick={() => updateLicense(l.id, { status: 'suspended' })}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-red-600 bg-red-50 border border-red-200">
                      <Ban size={12} /> {L('Suspender', 'Suspend')}
                    </button>
                  )}
                  {(l.status === 'suspended' || l.status === 'pending') && (
                    <button onClick={() => updateLicense(l.id, { status: 'active' })}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-green-600 bg-green-50 border border-green-200">
                      <CheckCircle2 size={12} /> {L('Activar', 'Activate')}
                    </button>
                  )}
                  {l.hardware_id && (
                    <button onClick={() => updateLicense(l.id, { hardware_id: null })}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-sky-600 bg-sky-50 border border-sky-200">
                      <RotateCcw size={12} /> Reset HWID
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add License Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h3 className="text-[14px] font-bold text-slate-800">{L('Nueva Licencia', 'New License')}</h3>
              <button onClick={() => setShowAdd(false)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
                <X size={16} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">{L('Negocio *', 'Business *')}</label>
                <select value={addForm.business_id} onChange={e => setAddForm(f => ({ ...f, business_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:border-sky-400 bg-white">
                  <option value="">{L('Seleccionar negocio...', 'Select business...')}</option>
                  {businesses.map(b => (
                    <option key={b.id} value={b.id}>{b.name}{b.rnc ? ` (${b.rnc})` : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">{L('Plataforma', 'Platform')}</label>
                <select value={addForm.platform} onChange={e => setAddForm(f => ({ ...f, platform: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:border-sky-400 bg-white">
                  <option value="web">Web</option>
                  <option value="desktop">Desktop</option>
                  <option value="both">{L('Ambos', 'Both')}</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">{L('Max Usuarios', 'Max Users')}</label>
                <input type="number" min="1" max="50" value={addForm.max_users}
                  onChange={e => setAddForm(f => ({ ...f, max_users: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:border-sky-400" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">{L('Notas', 'Notes')}</label>
                <input value={addForm.notes} onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder={L('Opcional', 'Optional')} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:border-sky-400" />
              </div>
            </div>
            {addErr && <p className="px-5 pb-2 text-[11px] text-red-500">{addErr}</p>}
            <div className="flex gap-2 px-5 py-4 border-t border-slate-100">
              <button onClick={createLicense} disabled={adding}
                className="flex-1 px-4 py-2.5 bg-[#b3001e] text-white text-[12px] font-bold rounded-lg hover:bg-[#8c0017] disabled:opacity-50 transition-colors">
                {adding ? L('Creando...', 'Creating...') : L('Crear Licencia', 'Create License')}
              </button>
              <button onClick={() => setShowAdd(false)}
                className="px-4 py-2.5 text-[12px] text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">
                {L('Cancelar', 'Cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
