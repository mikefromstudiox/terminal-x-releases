import { useState, useEffect } from 'react'
import { Loader2, Plus, Search, RotateCcw, Ban, CheckCircle2, Clock } from 'lucide-react'

const STATUS_BADGE = {
  active:    'bg-green-50 text-green-700 border-green-200',
  pending:   'bg-amber-50 text-amber-700 border-amber-200',
  suspended: 'bg-red-50 text-red-700 border-red-200',
  expired:   'bg-slate-100 text-slate-500 border-slate-200',
  cancelled: 'bg-slate-100 text-slate-400 border-slate-200',
}

export default function Licenses({ getToken, refreshToken }) {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setLoadErr('')
    try {
      const token = getToken()
      const resp = await fetch('/api/panel?action=licenses', { headers: { 'Authorization': `Bearer ${token}` } })
      if (resp.ok) setList((await resp.json()).data || [])
      else setLoadErr('Error al cargar licencias')
    } catch { setLoadErr('Error al cargar licencias') }
    setLoading(false)
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
          <h1 className="text-[18px] font-bold text-slate-800">Licencias</h1>
          <p className="text-[12px] text-slate-400">{list.length} total</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre, RNC o clave..."
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-[12px] outline-none focus:border-sky-400" />
        </div>
        {['all', 'active', 'pending', 'suspended', 'expired'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-colors ${
              filter === f ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-400'
            }`}>
            {f === 'all' ? 'Todas' : f.charAt(0).toUpperCase() + f.slice(1)}
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
          <div className="hidden md:flex items-center px-5 py-2.5 bg-slate-50 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            <span className="flex-1">Negocio</span>
            <span className="w-28">RNC</span>
            <span className="w-40">Clave</span>
            <span className="w-24">Plan</span>
            <span className="w-24 text-center">Estado</span>
            <span className="w-28">Ultimo acceso</span>
            <span className="w-24 text-right">Acciones</span>
          </div>
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-[12px] text-slate-400">Sin licencias.</div>
          ) : filtered.map(l => (
            <div key={l.id} className="md:flex md:items-center px-5 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50/60 transition-colors">
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-slate-800 truncate">{l.businesses?.name || '—'}</p>
                <p className="text-[11px] text-slate-400">{l.platform}</p>
              </div>
              <span className="hidden md:block w-28 text-[12px] text-slate-500">{l.businesses?.rnc || '—'}</span>
              <span className="hidden md:block w-40 text-[11px] font-mono text-slate-600">{l.license_key || 'Web only'}</span>
              <span className="hidden md:block w-24 text-[12px] text-slate-600">{l.plans?.display_name || '—'}</span>
              <div className="hidden md:flex w-24 justify-center">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_BADGE[l.status] || STATUS_BADGE.cancelled}`}>
                  {l.status}
                </span>
              </div>
              <span className="hidden md:block w-28 text-[11px] text-slate-400">
                {l.last_seen ? new Date(l.last_seen).toLocaleDateString('es-DO') : '—'}
              </span>
              <div className="hidden md:flex w-24 justify-end gap-1">
                {l.status === 'active' && (
                  <button onClick={() => updateLicense(l.id, { status: 'suspended' })} title="Suspender"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50"><Ban size={13} /></button>
                )}
                {l.status === 'suspended' && (
                  <button onClick={() => updateLicense(l.id, { status: 'active' })} title="Activar"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-green-600 hover:bg-green-50"><CheckCircle2 size={13} /></button>
                )}
                {l.hardware_id && (
                  <button onClick={() => updateLicense(l.id, { hardware_id: null })} title="Reset HWID"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50"><RotateCcw size={13} /></button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
