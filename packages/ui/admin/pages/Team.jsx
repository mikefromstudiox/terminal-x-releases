import { useState, useEffect } from 'react'
import { Loader2, Plus, Shield, ShieldCheck, Eye } from 'lucide-react'

const ROLE_LABELS = {
  super_admin: { es: 'Super Admin', en: 'Super Admin' },
  admin:       { es: 'Admin',       en: 'Admin' },
  support:     { es: 'Soporte',     en: 'Support' },
}

const ROLE_CLS = {
  super_admin: { cls: 'bg-red-50 text-red-700 border-red-200', icon: ShieldCheck },
  admin:       { cls: 'bg-sky-50 text-sky-700 border-sky-200', icon: Shield },
  support:     { cls: 'bg-slate-100 text-slate-600 border-slate-200', icon: Eye },
}

export default function Team({ getToken, refreshToken, isDark, lang }) {
  const L = (es, en) => lang === 'es' ? es : en
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
          <h1 className={`text-[18px] font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>{L('Equipo Admin', 'Admin Team')}</h1>
          <p className="text-[12px] text-slate-400">{L('Administradores de Terminal X', 'Terminal X administrators')}</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-[#b3001e] text-white text-[12px] font-bold rounded-lg hover:bg-[#8c0017] transition-colors">
          <Plus size={13} /> {L('Agregar', 'Add')}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={addUser} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
          {error && <div className="bg-red-50 text-red-600 text-sm p-2 rounded-lg">{error}</div>}
          <div className="grid grid-cols-3 gap-3">
            <input placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              className="px-3 py-2 border border-slate-200 rounded-lg text-[12px] outline-none focus:border-sky-400" />
            <input placeholder={L('Nombre', 'Name')} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="px-3 py-2 border border-slate-200 rounded-lg text-[12px] outline-none focus:border-sky-400" />
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              className="px-3 py-2 border border-slate-200 rounded-lg text-[12px] outline-none focus:border-sky-400">
              <option value="support">{L('Soporte', 'Support')}</option>
              <option value="admin">Admin</option>
              <option value="super_admin">Super Admin</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving}
              className="px-4 py-2 bg-[#b3001e] text-white text-[12px] font-semibold rounded-lg hover:bg-[#8c0017] disabled:opacity-50 transition-colors">
              {saving ? L('Guardando...', 'Saving...') : L('Guardar', 'Save')}
            </button>
            <button type="button" onClick={() => { setShowAdd(false); setError('') }}
              className="px-4 py-2 text-[12px] text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">{L('Cancelar', 'Cancel')}</button>
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
            <div className="py-12 text-center text-[12px] text-slate-400">{L('No hay administradores.', 'No administrators.')}</div>
          ) : list.map(u => {
            const roleMeta = ROLE_CLS[u.role] || ROLE_CLS.support
            const roleLabel = ROLE_LABELS[u.role]?.[lang] || u.role
            return (
              <div key={u.id} className="flex items-center px-5 py-3.5 border-b border-slate-100 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-slate-800">{u.name}</p>
                </div>
                <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${roleMeta.cls} mr-4`}>
                  {roleLabel}
                </span>
                <span className={`text-[11px] font-semibold mr-4 ${u.active ? 'text-green-600' : 'text-slate-400'}`}>
                  {u.active ? L('Activo', 'Active') : L('Inactivo', 'Inactive')}
                </span>
                <button onClick={() => toggleActive(u)}
                  className="text-[11px] text-slate-400 hover:text-sky-600 transition-colors">
                  {u.active ? L('Desactivar', 'Deactivate') : L('Activar', 'Activate')}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
