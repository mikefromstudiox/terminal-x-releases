import { useState, useEffect } from 'react'
import { Loader2, Search } from 'lucide-react'

export default function Clients({ getToken }) {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const resp = await fetch('/api/panel?action=clients', { headers: { 'Authorization': `Bearer ${getToken()}` } })
      if (resp.ok) setList((await resp.json()).data || [])
    } catch {}
    setLoading(false)
  }

  const filtered = list.filter(b => {
    if (!search) return true
    const s = search.toLowerCase()
    return (b.name || '').toLowerCase().includes(s) || (b.rnc || '').includes(s)
  })

  return (
    <div className="p-6 md:p-8 space-y-4">
      <div>
        <h1 className="text-[18px] font-bold text-slate-800">Clientes</h1>
        <p className="text-[12px] text-slate-400">{list.length} negocios registrados</p>
      </div>

      <div className="relative max-w-xs">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nombre o RNC..."
          className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-[12px] outline-none focus:border-sky-400" />
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-slate-300" size={20} /></div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="hidden md:flex items-center px-5 py-2.5 bg-slate-50 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            <span className="flex-1">Negocio</span>
            <span className="w-28">RNC</span>
            <span className="w-24">Plan</span>
            <span className="w-20 text-center">Staff</span>
            <span className="w-20 text-center">Tickets</span>
            <span className="w-24 text-center">Estado</span>
            <span className="w-28">Ultimo acceso</span>
          </div>
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-[12px] text-slate-400">Sin clientes.</div>
          ) : filtered.map(b => (
            <div key={b.id} className="md:flex md:items-center px-5 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50/60 transition-colors">
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-slate-800 truncate">{b.name}</p>
                <p className="text-[11px] text-slate-400">{b.phone || ''}</p>
              </div>
              <span className="hidden md:block w-28 text-[12px] text-slate-500">{b.rnc || '—'}</span>
              <span className="hidden md:block w-24 text-[12px] text-slate-600">{b.license?.plans?.display_name || b.plan || 'Free'}</span>
              <span className="hidden md:block w-20 text-center text-[13px] font-semibold text-slate-700">{b.staffCount}</span>
              <span className="hidden md:block w-20 text-center text-[13px] font-semibold text-slate-700">{b.ticketCount}</span>
              <div className="hidden md:flex w-24 justify-center">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  b.license?.status === 'active' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-100 text-slate-500 border-slate-200'
                }`}>
                  {b.license?.status || 'No license'}
                </span>
              </div>
              <span className="hidden md:block w-28 text-[11px] text-slate-400">
                {b.license?.last_seen ? new Date(b.license.last_seen).toLocaleDateString('es-DO') : '—'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
