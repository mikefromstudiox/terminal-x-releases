import { useState, useEffect } from 'react'
import { Loader2, Plus, Shield, ShieldCheck, Eye } from 'lucide-react'

const ROLE_BADGE = {
  super_admin: { label: 'Super Admin', cls: 'bg-red-50 text-red-700 border-red-200', icon: ShieldCheck },
  admin:       { label: 'Admin',       cls: 'bg-sky-50 text-sky-700 border-sky-200', icon: Shield },
  support:     { label: 'Soporte',     cls: 'bg-slate-100 text-slate-600 border-slate-200', icon: Eye },
}

export default function Team({ getToken }) {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ email: '', name: '', role: 'support' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setLoadErr('')
    try {
      const resp = await fetch('/api/panel?action=users', { headers: { 'Authorization': `Bearer ${getToken()}` } })
      if (resp.ok) setList((await resp.json()).data || [])
      else setLoadErr('Error al cargar equipo')
    } catch { setLoadErr('Error al cargar equipo') }
    setLoading(false)
  }

  async function addUser(e) {
    e.preventDefault()
    if (!form.email || !form.name) { setError('Email y nombre requeridos'); return }
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
      setForm({ email: '', name: '', role: 'support' })
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

  return (
    <div className="p-6 md:p-8 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-bold text-slate-800">Equipo Admin</h1>
          <p className="text-[12px] text-slate-400">Administradores de Terminal X</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-[#0C447C] text-white text-[12px] font-bold rounded-lg hover:bg-[#0a3a6a] transition-colors">
          <Plus size={13} /> Agregar
        </button>
      </div>

      {showAdd && (
        <form onSubmit={addUser} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
          {error && <div className="bg-red-50 text-red-600 text-sm p-2 rounded-lg">{error}</div>}
          <div className="grid grid-cols-3 gap-3">
            <input placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              className="px-3 py-2 border border-slate-200 rounded-lg text-[12px] outline-none focus:border-sky-400" />
            <input placeholder="Nombre" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="px-3 py-2 border border-slate-200 rounded-lg text-[12px] outline-none focus:border-sky-400" />
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              className="px-3 py-2 border border-slate-200 rounded-lg text-[12px] outline-none focus:border-sky-400">
              <option value="support">Soporte</option>
              <option value="admin">Admin</option>
              <option value="super_admin">Super Admin</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving}
              className="px-4 py-2 bg-[#0C447C] text-white text-[12px] font-semibold rounded-lg hover:bg-[#0a3a6a] disabled:opacity-50 transition-colors">
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
            <button type="button" onClick={() => { setShowAdd(false); setError('') }}
              className="px-4 py-2 text-[12px] text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">Cancelar</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-slate-300" size={20} /></div>
      ) : loadErr ? (
        <div className="py-12 text-center text-[13px] text-red-500">{loadErr}</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          {list.length === 0 ? (
            <div className="py-12 text-center text-[12px] text-slate-400">No hay administradores.</div>
          ) : list.map(u => {
            const role = ROLE_BADGE[u.role] || ROLE_BADGE.support
            return (
              <div key={u.id} className="flex items-center px-5 py-3.5 border-b border-slate-100 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-slate-800">{u.name}</p>
                </div>
                <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${role.cls} mr-4`}>
                  {role.label}
                </span>
                <span className={`text-[11px] font-semibold mr-4 ${u.active ? 'text-green-600' : 'text-slate-400'}`}>
                  {u.active ? 'Activo' : 'Inactivo'}
                </span>
                <button onClick={() => toggleActive(u)}
                  className="text-[11px] text-slate-400 hover:text-sky-600 transition-colors">
                  {u.active ? 'Desactivar' : 'Activar'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
