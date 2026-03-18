import { useState, useEffect, useRef } from 'react'
import {
  Settings, Building2, Upload, X, CheckCircle2, Loader2, ImageOff,
  Users, UserCheck, KeyRound, LayoutGrid, Plus, Edit2, Power,
  Eye, EyeOff, AlertCircle, Printer,
} from 'lucide-react'
import { useLang } from '../i18n'
import { hasIPC } from '../hooks/useDB'

// ── Shared UI helpers ─────────────────────────────────────────────────────────

function Label({ children }) {
  return <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{children}</p>
}

function Input({ className = '', ...props }) {
  return (
    <input
      {...props}
      className={`w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-[12px] text-slate-700 bg-white
        focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/20 placeholder:text-slate-300 ${className}`}
    />
  )
}

function Select({ className = '', children, ...props }) {
  return (
    <select
      {...props}
      className={`w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-[12px] text-slate-700 bg-white
        focus:outline-none focus:border-sky-400 ${className}`}
    >
      {children}
    </select>
  )
}

function SaveBtn({ saving, saved, label, onClick, disabled }) {
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const lbl = label ?? L('Guardar', 'Save')
  return (
    <button
      onClick={onClick}
      disabled={saving || disabled}
      className="flex items-center gap-1.5 px-4 py-2 bg-[#0C447C] hover:bg-[#0a3a6a] disabled:opacity-50
        text-white text-[12px] font-bold rounded-lg transition-colors"
    >
      {saving ? <><Loader2 size={12} className="animate-spin" /> {L('Guardando…', 'Saving…')}</>
              : saved  ? <><CheckCircle2 size={12} /> {L('Guardado', 'Saved')}</>
              : lbl}
    </button>
  )
}

function ActiveBadge({ active }) {
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
      active ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-400'
    }`}>
      {active ? `● ${L('Activo', 'Active')}` : `○ ${L('Inactivo', 'Inactive')}`}
    </span>
  )
}

function Toast({ toast }) {
  if (!toast) return null
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-xl text-[13px] font-semibold ${
      toast.type === 'error' ? 'bg-red-500 text-white' : 'bg-slate-800 text-white'
    }`}>
      {toast.type === 'error' ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
      {toast.msg}
    </div>
  )
}

function useToast() {
  const [toast, setToast] = useState(null)
  function show(msg, type = 'ok') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }
  return { toast, show }
}

// ── Shared panel wrapper ──────────────────────────────────────────────────────

function Panel({ title, onClose, children }) {
  return (
    <div className="w-72 shrink-0 border border-slate-200 rounded-xl p-5 bg-white self-start">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-[13px] font-bold text-slate-800">{title}</h4>
        <button onClick={onClose} className="text-slate-300 hover:text-slate-500"><X size={15} /></button>
      </div>
      {children}
    </div>
  )
}

// ── Toggle switch ─────────────────────────────────────────────────────────────

function Toggle({ enabled, onChange, disabled = false }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!enabled)}
      disabled={disabled}
      aria-pressed={enabled}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
      } ${enabled ? 'bg-sky-500' : 'bg-slate-200'}`}
    >
      <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
        enabled ? 'translate-x-4' : 'translate-x-0'
      }`} />
    </button>
  )
}

function SettingRow({ label, hint, children }) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1 min-w-0 pr-4">
        <p className="text-[13px] font-semibold text-slate-700">{label}</p>
        {hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function SettingSection({ title, children }) {
  return (
    <div className="mb-5">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">{title}</p>
      <div className="border border-slate-200 rounded-xl px-4 divide-y divide-slate-100">
        {children}
      </div>
    </div>
  )
}

// ── LAVADORES ─────────────────────────────────────────────────────────────────

const EMPTY_WASHER = { name: '', phone: '', cedula: '', commission_pct: '20', start_date: '' }

function Lavadores() {
  const { lang }            = useLang()
  const L                   = (es, en) => lang === 'es' ? es : en
  const [list,   setList]   = useState([])
  const [panel,  setPanel]  = useState(null)
  const [form,   setForm]   = useState(EMPTY_WASHER)
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [error,  setError]  = useState('')
  const { toast, show }     = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    if (!hasIPC()) return
    try { setList((await window.electronAPI.washers.allAdmin()) || []) } catch {}
  }

  function openAdd()   { setForm(EMPTY_WASHER); setError(''); setSaved(false); setPanel('add') }
  function openEdit(w) { setForm({ name: w.name, phone: w.phone||'', cedula: w.cedula||'', commission_pct: String(w.commission_pct), start_date: w.start_date||'' }); setError(''); setSaved(false); setPanel(w) }
  function closePanel(){ setPanel(null) }
  function set(k, v)   { setForm(f => ({ ...f, [k]: v })) }

  async function handleSave() {
    if (!form.name.trim()) { setError(L('El nombre es requerido.', 'Name is required.')); return }
    setSaving(true); setError('')
    try {
      const p = { ...form, commission_pct: parseFloat(form.commission_pct) || 20 }
      if (panel === 'add') await window.electronAPI.washers.create(p)
      else                 await window.electronAPI.washers.update({ id: panel.id, ...p })
      setSaved(true)
      show(panel === 'add' ? L('Lavador agregado ✓', 'Washer added ✓') : L('Lavador actualizado ✓', 'Washer updated ✓'))
      setTimeout(() => { closePanel(); load() }, 1000)
    } catch (err) { setError(err.message || L('Error al guardar.', 'Error saving.')) }
    finally { setSaving(false) }
  }

  async function toggleActive(w) {
    try {
      await window.electronAPI.washers.update({ id: w.id, active: w.active ? 0 : 1 })
      show(w.active ? L('Desactivado', 'Deactivated') : L('Activado', 'Activated'))
      load()
    } catch {}
  }

  return (
    <div className="flex gap-6">
      <Toast toast={toast} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[12px] text-slate-400">{list.length} {L('lavadores', 'washers')}</p>
          <button onClick={openAdd} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0C447C] text-white text-[12px] font-bold rounded-lg hover:bg-[#0a3a6a] transition-colors">
            <Plus size={13} /> {L('Agregar Lavador', 'Add Washer')}
          </button>
        </div>
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="flex items-center px-4 py-2 bg-slate-50 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            <span className="flex-1">{L('Nombre / Cédula', 'Name / ID')}</span>
            <span className="w-28">{L('Teléfono', 'Phone')}</span>
            <span className="w-20 text-center">{L('Comisión', 'Commission')}</span>
            <span className="w-24 text-center">{L('Estado', 'Status')}</span>
            <span className="w-16 text-right">{L('Acción', 'Action')}</span>
          </div>
          {list.length === 0
            ? <div className="py-10 text-center text-[12px] text-slate-400">{L('No hay lavadores registrados.', 'No washers registered.')}</div>
            : list.map(w => (
              <div key={w.id} className="flex items-center px-4 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-[#f0f6ff] text-[#0C447C] flex items-center justify-center text-[11px] font-black shrink-0">
                    {w.name[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800 truncate">{w.name}</p>
                    {w.cedula && <p className="text-[10px] text-slate-400">{w.cedula}</p>}
                  </div>
                </div>
                <span className="w-28 text-[12px] text-slate-500">{w.phone || '—'}</span>
                <span className="w-20 text-center text-[12px] font-semibold text-slate-700">{w.commission_pct}%</span>
                <span className="w-24 flex justify-center"><ActiveBadge active={w.active} /></span>
                <div className="w-16 flex items-center justify-end gap-1">
                  <button onClick={() => openEdit(w)} className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors"><Edit2 size={13} /></button>
                  <button onClick={() => toggleActive(w)} className={`p-1.5 rounded-lg transition-colors ${w.active ? 'text-slate-400 hover:text-red-500 hover:bg-red-50' : 'text-slate-300 hover:text-green-600 hover:bg-green-50'}`}><Power size={13} /></button>
                </div>
              </div>
            ))
          }
        </div>
      </div>

      {panel && (
        <Panel title={panel === 'add' ? L('Nuevo Lavador', 'New Washer') : L('Editar Lavador', 'Edit Washer')} onClose={closePanel}>
          <div className="space-y-3">
            <div><Label>{L('Nombre completo *', 'Full name *')}</Label><Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Juan García" /></div>
            <div><Label>{L('Cédula', 'ID Number')}</Label><Input value={form.cedula} onChange={e => set('cedula', e.target.value)} placeholder="001-0000000-0" /></div>
            <div><Label>{L('Teléfono', 'Phone')}</Label><Input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="809-555-0000" /></div>
            <div><Label>{L('% Comisión', '% Commission')}</Label><Input type="number" min="0" max="100" value={form.commission_pct} onChange={e => set('commission_pct', e.target.value)} /></div>
            <div><Label>{L('Fecha de entrada', 'Start date')}</Label><Input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} /></div>
          </div>
          {error && <p className="mt-3 text-[11px] text-red-500">{error}</p>}
          <div className="flex gap-2 mt-4">
            <SaveBtn saving={saving} saved={saved} onClick={handleSave} />
            <button onClick={closePanel} className="px-3 py-2 text-[12px] text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">{L('Cancelar', 'Cancel')}</button>
          </div>
        </Panel>
      )}
    </div>
  )
}

// ── VENDEDORES ────────────────────────────────────────────────────────────────

const EMPTY_SELLER = { name: '', commission_pct: '5', phone: '' }

function Vendedores() {
  const { lang }            = useLang()
  const L                   = (es, en) => lang === 'es' ? es : en
  const [list,   setList]   = useState([])
  const [panel,  setPanel]  = useState(null)
  const [form,   setForm]   = useState(EMPTY_SELLER)
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [error,  setError]  = useState('')
  const { toast, show }     = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    if (!hasIPC()) return
    try { setList((await window.electronAPI.sellers.allAdmin()) || []) } catch {}
  }

  function openAdd()   { setForm(EMPTY_SELLER); setError(''); setSaved(false); setPanel('add') }
  function openEdit(s) { setForm({ name: s.name, commission_pct: String(s.commission_pct), phone: s.phone||'' }); setError(''); setSaved(false); setPanel(s) }
  function closePanel(){ setPanel(null) }
  function set(k, v)   { setForm(f => ({ ...f, [k]: v })) }

  async function handleSave() {
    if (!form.name.trim()) { setError(L('El nombre es requerido.', 'Name is required.')); return }
    setSaving(true); setError('')
    try {
      const p = { ...form, commission_pct: parseFloat(form.commission_pct) || 5 }
      if (panel === 'add') await window.electronAPI.sellers.create(p)
      else                 await window.electronAPI.sellers.update({ id: panel.id, ...p })
      setSaved(true)
      show(panel === 'add' ? L('Vendedor agregado ✓', 'Salesperson added ✓') : L('Vendedor actualizado ✓', 'Salesperson updated ✓'))
      setTimeout(() => { closePanel(); load() }, 1000)
    } catch (err) { setError(err.message || L('Error al guardar.', 'Error saving.')) }
    finally { setSaving(false) }
  }

  async function toggleActive(s) {
    try {
      await window.electronAPI.sellers.update({ id: s.id, active: s.active ? 0 : 1 })
      show(s.active ? L('Desactivado', 'Deactivated') : L('Activado', 'Activated'))
      load()
    } catch {}
  }

  return (
    <div className="flex gap-6">
      <Toast toast={toast} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[12px] text-slate-400">{list.length} {L('vendedores', 'salespeople')}</p>
          <button onClick={openAdd} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0C447C] text-white text-[12px] font-bold rounded-lg hover:bg-[#0a3a6a] transition-colors">
            <Plus size={13} /> {L('Agregar Vendedor', 'Add Salesperson')}
          </button>
        </div>
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="flex items-center px-4 py-2 bg-slate-50 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            <span className="flex-1">{L('Nombre', 'Name')}</span>
            <span className="w-28">{L('Teléfono', 'Phone')}</span>
            <span className="w-24 text-center">{L('Comisión', 'Commission')}</span>
            <span className="w-24 text-center">{L('Estado', 'Status')}</span>
            <span className="w-16 text-right">{L('Acción', 'Action')}</span>
          </div>
          {list.length === 0
            ? <div className="py-10 text-center text-[12px] text-slate-400">{L('No hay vendedores registrados.', 'No salespeople registered.')}</div>
            : list.map(s => (
              <div key={s.id} className="flex items-center px-4 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-violet-50 text-violet-700 flex items-center justify-center text-[11px] font-black shrink-0">
                    {s.name[0]?.toUpperCase()}
                  </div>
                  <p className="text-[13px] font-semibold text-slate-800 truncate">{s.name}</p>
                </div>
                <span className="w-28 text-[12px] text-slate-500">{s.phone || '—'}</span>
                <span className="w-24 text-center text-[12px] font-semibold text-slate-700">{s.commission_pct}%</span>
                <span className="w-24 flex justify-center"><ActiveBadge active={s.active} /></span>
                <div className="w-16 flex items-center justify-end gap-1">
                  <button onClick={() => openEdit(s)} className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors"><Edit2 size={13} /></button>
                  <button onClick={() => toggleActive(s)} className={`p-1.5 rounded-lg transition-colors ${s.active ? 'text-slate-400 hover:text-red-500 hover:bg-red-50' : 'text-slate-300 hover:text-green-600 hover:bg-green-50'}`}><Power size={13} /></button>
                </div>
              </div>
            ))
          }
        </div>
      </div>

      {panel && (
        <Panel title={panel === 'add' ? L('Nuevo Vendedor', 'New Salesperson') : L('Editar Vendedor', 'Edit Salesperson')} onClose={closePanel}>
          <div className="space-y-3">
            <div><Label>{L('Nombre *', 'Name *')}</Label><Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Pedro Martínez" /></div>
            <div><Label>{L('Teléfono', 'Phone')}</Label><Input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="809-555-0000" /></div>
            <div><Label>{L('% Comisión', '% Commission')}</Label><Input type="number" min="0" max="100" value={form.commission_pct} onChange={e => set('commission_pct', e.target.value)} /></div>
          </div>
          {error && <p className="mt-3 text-[11px] text-red-500">{error}</p>}
          <div className="flex gap-2 mt-4">
            <SaveBtn saving={saving} saved={saved} onClick={handleSave} />
            <button onClick={closePanel} className="px-3 py-2 text-[12px] text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">{L('Cancelar', 'Cancel')}</button>
          </div>
        </Panel>
      )}
    </div>
  )
}

// ── USUARIOS ──────────────────────────────────────────────────────────────────

const ROLES = [
  { value: 'owner',      label: 'Owner',    color: 'bg-red-100 text-red-700'       },
  { value: 'manager',    label: 'Manager',  color: 'bg-orange-100 text-orange-700' },
  { value: 'cfo',        label: 'CFO',      color: 'bg-purple-100 text-purple-700' },
  { value: 'accountant', label: 'Contador', color: 'bg-blue-100 text-blue-700'     },
  { value: 'cashier',    label: 'Cajero',   color: 'bg-slate-100 text-slate-600'   },
]

function RoleBadge({ role }) {
  const r = ROLES.find(r => r.value === role) || ROLES[4]
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${r.color}`}>{r.label}</span>
}

const EMPTY_USER = { name: '', username: '', pin: '', role: 'cashier', discount_pct: '0' }

function Usuarios() {
  const { lang }              = useLang()
  const L                     = (es, en) => lang === 'es' ? es : en
  const [list,    setList]    = useState([])
  const [panel,   setPanel]   = useState(null)
  const [form,    setForm]    = useState(EMPTY_USER)
  const [showPin, setShowPin] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState('')
  const { toast, show }       = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    if (!hasIPC()) return
    try { setList((await window.electronAPI.users.all()) || []) } catch {}
  }

  function openAdd()   { setForm(EMPTY_USER); setShowPin(false); setError(''); setSaved(false); setPanel('add') }
  function openEdit(u) { setForm({ name: u.name, username: u.username, pin: '', role: u.role, discount_pct: String(u.discount_pct || 0) }); setShowPin(false); setError(''); setSaved(false); setPanel(u) }
  function closePanel(){ setPanel(null) }
  function set(k, v)   { setForm(f => ({ ...f, [k]: v })) }

  async function handleSave() {
    if (!form.name.trim())     { setError(L('El nombre es requerido.', 'Name is required.')); return }
    if (!form.username.trim()) { setError(L('El usuario es requerido.', 'Username is required.')); return }
    if (panel === 'add' && !form.pin.trim()) { setError(L('El PIN es requerido.', 'PIN is required.')); return }
    setSaving(true); setError('')
    try {
      const payload = {
        name:         form.name.trim(),
        username:     form.username.trim().toLowerCase(),
        role:         form.role,
        discount_pct: parseFloat(form.discount_pct) || 0,
        ...(form.pin.trim() && { pin: form.pin.trim() }),
      }
      if (panel === 'add') await window.electronAPI.users.create({ ...payload, pin: form.pin.trim() })
      else                 await window.electronAPI.users.update({ id: panel.id, ...payload })
      setSaved(true)
      show(panel === 'add' ? L('Usuario creado ✓', 'User created ✓') : L('Usuario actualizado ✓', 'User updated ✓'))
      setTimeout(() => { closePanel(); load() }, 1000)
    } catch (err) { setError(err.message || L('Error al guardar.', 'Error saving.')) }
    finally { setSaving(false) }
  }

  async function toggleActive(u) {
    try {
      await window.electronAPI.users.update({ id: u.id, active: u.active ? 0 : 1 })
      show(u.active ? L('Usuario desactivado', 'User deactivated') : L('Usuario activado', 'User activated'))
      load()
    } catch {}
  }

  return (
    <div className="flex gap-6">
      <Toast toast={toast} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[12px] text-slate-400">{list.length} {L('usuarios', 'users')}</p>
          <button onClick={openAdd} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0C447C] text-white text-[12px] font-bold rounded-lg hover:bg-[#0a3a6a] transition-colors">
            <Plus size={13} /> {L('Agregar Usuario', 'Add User')}
          </button>
        </div>
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="flex items-center px-4 py-2 bg-slate-50 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            <span className="flex-1">{L('Nombre / Usuario', 'Name / Username')}</span>
            <span className="w-28 text-center">{L('Rol', 'Role')}</span>
            <span className="w-20 text-center">{L('Dto%', 'Disc%')}</span>
            <span className="w-24 text-center">{L('Estado', 'Status')}</span>
            <span className="w-16 text-right">{L('Acción', 'Action')}</span>
          </div>
          {list.length === 0
            ? <div className="py-10 text-center text-[12px] text-slate-400">{L('No hay usuarios registrados.', 'No users registered.')}</div>
            : list.map(u => (
              <div key={u.id} className="flex items-center px-4 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-[11px] font-black shrink-0">
                    {u.name[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800 truncate">{u.name}</p>
                    <p className="text-[10px] text-slate-400">@{u.username}</p>
                  </div>
                </div>
                <span className="w-28 flex justify-center"><RoleBadge role={u.role} /></span>
                <span className="w-20 text-center text-[12px] text-slate-600">{u.discount_pct}%</span>
                <span className="w-24 flex justify-center"><ActiveBadge active={u.active} /></span>
                <div className="w-16 flex items-center justify-end gap-1">
                  <button onClick={() => openEdit(u)} className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors"><Edit2 size={13} /></button>
                  <button onClick={() => toggleActive(u)} className={`p-1.5 rounded-lg transition-colors ${u.active ? 'text-slate-400 hover:text-red-500 hover:bg-red-50' : 'text-slate-300 hover:text-green-600 hover:bg-green-50'}`}><Power size={13} /></button>
                </div>
              </div>
            ))
          }
        </div>
      </div>

      {panel && (
        <Panel title={panel === 'add' ? L('Nuevo Usuario', 'New User') : L('Editar Usuario', 'Edit User')} onClose={closePanel}>
          <div className="space-y-3">
            <div><Label>{L('Nombre completo *', 'Full name *')}</Label><Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="María López" /></div>
            <div><Label>{L('Usuario *', 'Username *')}</Label><Input value={form.username} onChange={e => set('username', e.target.value)} placeholder="mlopez" /></div>
            <div>
              <Label>{panel === 'add' ? 'PIN *' : L('PIN (vacío = sin cambio)', 'PIN (blank = no change)')}</Label>
              <div className="relative">
                <Input type={showPin ? 'text' : 'password'} value={form.pin} onChange={e => set('pin', e.target.value)} placeholder={L('4–6 dígitos', '4–6 digits')} maxLength={6} />
                <button type="button" onClick={() => setShowPin(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                  {showPin ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
            </div>
            <div>
              <Label>{L('Rol', 'Role')}</Label>
              <Select value={form.role} onChange={e => set('role', e.target.value)}>
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </Select>
            </div>
            <div><Label>{L('% Descuento', '% Discount')}</Label><Input type="number" min="0" max="100" value={form.discount_pct} onChange={e => set('discount_pct', e.target.value)} /></div>
          </div>
          {error && <p className="mt-3 text-[11px] text-red-500">{error}</p>}
          <div className="flex gap-2 mt-4">
            <SaveBtn saving={saving} saved={saved} onClick={handleSave} />
            <button onClick={closePanel} className="px-3 py-2 text-[12px] text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">{L('Cancelar', 'Cancel')}</button>
          </div>
        </Panel>
      )}
    </div>
  )
}

// ── SERVICIOS ─────────────────────────────────────────────────────────────────

const EMPTY_SERVICE = { name: '', name_en: '', category: '', price: '', is_wash: '1' }

function Servicios() {
  const { lang }                    = useLang()
  const L                           = (es, en) => lang === 'es' ? es : en
  const [list,       setList]       = useState([])
  const [panel,      setPanel]      = useState(null)
  const [form,       setForm]       = useState(EMPTY_SERVICE)
  const [newCatMode, setNewCatMode] = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [saved,      setSaved]      = useState(false)
  const [error,      setError]      = useState('')
  const [activeTab,  setActiveTab]  = useState('all')
  const { toast, show }             = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    if (!hasIPC()) return
    try { setList((await window.electronAPI.services.allAdmin()) || []) } catch {}
  }

  const categories = [...new Set(list.map(s => s.category))].sort()
  const visible    = activeTab === 'all' ? list : list.filter(s => s.category === activeTab)

  function openAdd()   { setForm({ ...EMPTY_SERVICE, category: categories[0] || '' }); setNewCatMode(false); setError(''); setSaved(false); setPanel('add') }
  function openEdit(s) { setForm({ name: s.name, name_en: s.name_en||'', category: s.category, price: String(s.price), is_wash: String(s.is_wash) }); setNewCatMode(false); setError(''); setSaved(false); setPanel(s) }
  function closePanel(){ setPanel(null) }
  function set(k, v)   { setForm(f => ({ ...f, [k]: v })) }

  async function handleSave() {
    if (!form.name.trim())     { setError(L('El nombre ES es requerido.', 'ES name is required.')); return }
    if (!form.category.trim()) { setError(L('La categoría es requerida.', 'Category is required.')); return }
    if (!form.price)           { setError(L('El precio es requerido.', 'Price is required.')); return }
    setSaving(true); setError('')
    try {
      const p = { name: form.name.trim(), name_en: form.name_en.trim()||null, category: form.category.trim(), price: parseFloat(form.price)||0, is_wash: parseInt(form.is_wash), sort_order: panel !== 'add' ? panel.sort_order : list.length }
      if (panel === 'add') await window.electronAPI.services.create(p)
      else                 await window.electronAPI.services.update({ id: panel.id, ...p })
      setSaved(true)
      show(panel === 'add' ? L('Servicio agregado ✓', 'Service added ✓') : L('Servicio actualizado ✓', 'Service updated ✓'))
      setTimeout(() => { closePanel(); load() }, 1000)
    } catch (err) { setError(err.message || L('Error al guardar.', 'Error saving.')) }
    finally { setSaving(false) }
  }

  async function toggleActive(s) {
    try {
      await window.electronAPI.services.update({ id: s.id, active: s.active ? 0 : 1 })
      show(s.active ? L('Desactivado — no aparece en POS', 'Deactivated — hidden from POS') : L('Activado en POS ✓', 'Activated in POS ✓'))
      load()
    } catch {}
  }

  function fmtRD(n) { return `RD$ ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0 })}` }

  return (
    <div className="flex gap-6">
      <Toast toast={toast} />
      <div className="flex-1 min-w-0">
        {/* Category tabs row */}
        <div className="flex items-center gap-0 border-b border-slate-200 mb-4 overflow-x-auto">
          {[{ id: 'all', label: `${L('Todos', 'All')} (${list.length})` },
            ...categories.map(c => ({ id: c, label: `${c} (${list.filter(s => s.category === c).length})` }))
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 px-4 py-2.5 text-[12px] font-semibold border-b-2 -mb-px transition-colors ${
                activeTab === tab.id ? 'border-[#0C447C] text-[#0C447C]' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}>
              {tab.label}
            </button>
          ))}
          <button onClick={openAdd} className="ml-auto shrink-0 flex items-center gap-1.5 px-3 py-1.5 mb-2 bg-[#0C447C] text-white text-[12px] font-bold rounded-lg hover:bg-[#0a3a6a] transition-colors">
            <Plus size={13} /> {L('Agregar Servicio', 'Add Service')}
          </button>
        </div>

        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="flex items-center px-4 py-2 bg-slate-50 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            <span className="flex-1">{L('Nombre ES', 'Name ES')}</span>
            <span className="w-36">{L('Nombre EN', 'Name EN')}</span>
            <span className="w-24 text-center">{L('Categoría', 'Category')}</span>
            <span className="w-24 text-right">{L('Precio', 'Price')}</span>
            <span className="w-20 text-center">{L('Estado', 'Status')}</span>
            <span className="w-16 text-right">{L('Acción', 'Action')}</span>
          </div>
          {visible.length === 0
            ? <div className="py-10 text-center text-[12px] text-slate-400">{L('No hay servicios en esta categoría.', 'No services in this category.')}</div>
            : visible.map(s => (
              <div key={s.id} className={`flex items-center px-4 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors ${!s.active ? 'opacity-50' : ''}`}>
                <span className="flex-1 text-[13px] font-semibold text-slate-800 truncate">{s.name}</span>
                <span className="w-36 text-[12px] text-slate-400 truncate">{s.name_en || '—'}</span>
                <span className="w-24 flex justify-center">
                  <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full truncate max-w-[88px]">{s.category}</span>
                </span>
                <span className="w-24 text-right text-[12px] font-semibold text-slate-700">{fmtRD(s.price)}</span>
                <span className="w-20 flex justify-center"><ActiveBadge active={s.active} /></span>
                <div className="w-16 flex items-center justify-end gap-1">
                  <button onClick={() => openEdit(s)} className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors"><Edit2 size={13} /></button>
                  <button onClick={() => toggleActive(s)} className={`p-1.5 rounded-lg transition-colors ${s.active ? 'text-slate-400 hover:text-red-500 hover:bg-red-50' : 'text-slate-300 hover:text-green-600 hover:bg-green-50'}`}><Power size={13} /></button>
                </div>
              </div>
            ))
          }
        </div>
      </div>

      {panel && (
        <Panel title={panel === 'add' ? L('Nuevo Servicio', 'New Service') : L('Editar Servicio', 'Edit Service')} onClose={closePanel}>
          <div className="space-y-3">
            <div><Label>{L('Nombre ES *', 'Name ES *')}</Label><Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Lavado Básico" /></div>
            <div><Label>{L('Nombre EN', 'Name EN')}</Label><Input value={form.name_en} onChange={e => set('name_en', e.target.value)} placeholder="Basic Wash" /></div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label>{L('Categoría *', 'Category *')}</Label>
                <button type="button" onClick={() => setNewCatMode(v => !v)} className="text-[10px] text-sky-500 hover:text-sky-700">
                  {newCatMode ? L('← Usar existente', '← Use existing') : L('+ Nueva', '+ New')}
                </button>
              </div>
              {newCatMode
                ? <Input value={form.category} onChange={e => set('category', e.target.value)} placeholder={L('Nombre de categoría', 'Category name')} />
                : <Select value={form.category} onChange={e => set('category', e.target.value)}>
                    <option value="">{L('Seleccionar…', 'Select…')}</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </Select>
              }
            </div>
            <div><Label>{L('Precio RD$ *', 'Price RD$ *')}</Label><Input type="number" min="0" value={form.price} onChange={e => set('price', e.target.value)} placeholder="500" /></div>
            <div>
              <Label>{L('Tipo', 'Type')}</Label>
              <Select value={form.is_wash} onChange={e => set('is_wash', e.target.value)}>
                <option value="1">{L('Lavado / servicio (comisión)', 'Wash / service (commission)')}</option>
                <option value="0">{L('Bebida / snack (sin comisión)', 'Beverage / snack (no commission)')}</option>
              </Select>
            </div>
          </div>
          {error && <p className="mt-3 text-[11px] text-red-500">{error}</p>}
          <div className="flex gap-2 mt-4">
            <SaveBtn saving={saving} saved={saved} onClick={handleSave} />
            <button onClick={closePanel} className="px-3 py-2 text-[12px] text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">{L('Cancelar', 'Cancel')}</button>
          </div>
        </Panel>
      )}
    </div>
  )
}

// ── MI EMPRESA ────────────────────────────────────────────────────────────────

function MiEmpresa() {
  const { lang }            = useLang()
  const L                   = (es, en) => lang === 'es' ? es : en
  const [form, setForm]     = useState({ biz_name: '', biz_rnc: '', biz_address: '', biz_phone: '', biz_city: '' })
  const [logo, setLogo]     = useState('')
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [error,  setError]  = useState('')
  const fileRef = useRef()

  useEffect(() => {
    if (!window.electronAPI?.settings?.get) return
    window.electronAPI.settings.get().then(s => {
      if (!s) return
      setForm({ biz_name: s.biz_name||'', biz_rnc: s.biz_rnc||'', biz_address: s.biz_address||'', biz_phone: s.biz_phone||'', biz_city: s.biz_city||'' })
      setLogo(s.biz_logo || '')
    }).catch(() => {})
  }, [])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function handleLogoFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { setError(L('El archivo debe ser una imagen.', 'File must be an image.')); return }
    if (file.size > 500 * 1024) { setError(L('El logo no debe superar 500 KB.', 'Logo must be under 500 KB.')); return }
    const reader = new FileReader()
    reader.onload = ev => { setLogo(ev.target.result); setError('') }
    reader.readAsDataURL(file)
  }

  async function handleSave() {
    if (!form.biz_name.trim()) { setError(L('El nombre del negocio es requerido.', 'Business name is required.')); return }
    setSaving(true); setError('')
    try {
      await window.electronAPI.settings.update({ ...form, biz_logo: logo })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err.message || L('Error al guardar.', 'Error saving.'))
    } finally {
      setSaving(false)
    }
  }

  const fields = [
    { k: 'biz_name',    label: L('Nombre del Negocio *', 'Business Name *'), ph: 'Car Wash El Brillo SRL'     },
    { k: 'biz_rnc',     label: 'RNC',                                         ph: '130-12345-6'               },
    { k: 'biz_address', label: L('Dirección', 'Address'),                     ph: 'Av. Winston Churchill 1099' },
    { k: 'biz_city',    label: L('Ciudad', 'City'),                           ph: 'Santo Domingo'             },
    { k: 'biz_phone',   label: L('Teléfono', 'Phone'),                        ph: '809-555-0123'              },
  ]

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h3 className="text-[13px] font-bold text-slate-700 mb-1">{L('Información del Negocio', 'Business Information')}</h3>
        <p className="text-[11px] text-slate-400">{L('Esta información aparece en los recibos impresos.', 'This information appears on printed receipts.')}</p>
      </div>

      <div>
        <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">{L('Logo del Negocio', 'Business Logo')}</label>
        <div className="flex items-start gap-4">
          <div className="w-20 h-20 rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center bg-slate-50 shrink-0 overflow-hidden">
            {logo ? <img src={logo} alt="Logo" className="w-full h-full object-contain p-1" /> : <ImageOff size={22} className="text-slate-300" />}
          </div>
          <div className="flex-1 space-y-2">
            <button onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-xl text-[12px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
              <Upload size={13} /> {L('Subir imagen', 'Upload image')}
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoFile} />
            <p className="text-[10px] text-slate-400">{L('PNG o JPG, máx. 500 KB.', 'PNG or JPG, max 500 KB.')}</p>
            {logo && (
              <button onClick={() => setLogo('')} className="flex items-center gap-1 text-[11px] text-red-400 hover:text-red-500 transition-colors">
                <X size={11} /> {L('Eliminar logo', 'Remove logo')}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {fields.map(f => (
          <div key={f.k}>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">{f.label}</label>
            <input type="text" value={form[f.k]} onChange={e => set(f.k, e.target.value)} placeholder={f.ph}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-[13px] text-slate-700 focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/20" />
          </div>
        ))}
      </div>

      {error && <p className="text-[12px] text-red-500 font-medium">{error}</p>}

      <button onClick={handleSave} disabled={saving}
        className="flex items-center gap-2 px-6 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white font-bold rounded-xl text-[13px] transition-colors">
        {saving ? <><Loader2 size={14} className="animate-spin" /> {L('Guardando…', 'Saving…')}</> :
         saved  ? <><CheckCircle2 size={14} /> {L('Guardado', 'Saved')}</> : L('Guardar cambios', 'Save changes')}
      </button>

      {(logo || form.biz_name) && (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="bg-slate-50 border-b border-slate-200 px-4 py-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{L('Vista previa del recibo', 'Receipt preview')}</p>
          </div>
          <div className="bg-white px-6 py-4 flex flex-col items-center gap-2 font-mono text-[12px] text-slate-700">
            {logo ? <img src={logo} alt="logo" className="max-h-[60px] object-contain" />
                  : <p className="font-bold text-[14px] text-center">{form.biz_name}</p>}
            {form.biz_address && <p className="text-center text-[11px]">{form.biz_address}{form.biz_city ? `, ${form.biz_city}` : ''}</p>}
            {form.biz_phone   && <p className="text-center text-[11px]">Tel: {form.biz_phone}</p>}
            {form.biz_rnc     && <p className="text-center text-[11px]">RNC: {form.biz_rnc}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

// ── SISTEMA ───────────────────────────────────────────────────────────────────

const SISTEMA_DEFAULTS = {
  ley_enabled:        '1',
  itbis_pct:          '18',
  usd_rate:           '61.00',
  rnc_verify:         '1',
  sucursales:         '0',
  beverages_in_pos:   '1',
  auto_backup:        '0',
  printer:            '',
  print_preticket:    '0',
  print_factura_auto: '0',
  print_conduce_auto: '0',
}

function Sistema() {
  const { lang, setLang } = useLang()
  const { toast, show }   = useToast()

  const [cfg,      setCfg]      = useState(SISTEMA_DEFAULTS)
  const [printers, setPrinters] = useState([])
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)

  useEffect(() => {
    if (!hasIPC()) return
    // Load persisted settings
    window.electronAPI.settings.get().then(s => {
      if (!s) return
      setCfg(prev => ({
        ...prev,
        ...Object.fromEntries(
          Object.keys(SISTEMA_DEFAULTS)
            .filter(k => s[k] != null)
            .map(k => [k, s[k]])
        ),
      }))
    }).catch(() => {})

    // Load printer list
    window.electronAPI.listPrinters().then(list => {
      if (Array.isArray(list)) setPrinters(list)
    }).catch(() => {})
  }, [])

  function set(k, v) { setCfg(c => ({ ...c, [k]: v })) }
  const on = k => cfg[k] === '1'

  async function handleSave() {
    setSaving(true)
    try {
      await window.electronAPI.settings.update(cfg)
      setSaved(true)
      show(lang === 'es' ? 'Configuración guardada ✓' : 'Settings saved ✓')
      setTimeout(() => setSaved(false), 2500)
    } catch {
      show(lang === 'es' ? 'Error al guardar' : 'Error saving', 'error')
    } finally { setSaving(false) }
  }

  async function testPrint() {
    try {
      await window.electronAPI.print({ type: 'test', data: {}, printerName: cfg.printer || undefined })
      show(lang === 'es' ? 'Prueba de impresión enviada ✓' : 'Test print sent ✓')
    } catch {
      show(lang === 'es' ? 'Error al imprimir' : 'Printer error', 'error')
    }
  }

  const L = (es, en) => lang === 'es' ? es : en

  return (
    <div className="max-w-2xl">
      <Toast toast={toast} />

      {/* ── Language ─────────────────────────────────────────────────────────── */}
      <SettingSection title={L('Idioma del Sistema', 'System Language')}>
        <SettingRow label={L('Idioma / Language', 'Language / Idioma')} hint={L('Cambia el idioma de toda la app inmediatamente', 'Changes app language immediately')}>
          <div className="flex gap-2">
            <button
              onClick={() => setLang('es')}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-bold border transition-colors ${
                lang === 'es'
                  ? 'bg-[#0C447C] border-[#0C447C] text-white'
                  : 'border-slate-200 text-slate-500 hover:border-slate-400 hover:bg-slate-50'
              }`}
            >
              🇩🇴 ES
            </button>
            <button
              onClick={() => setLang('en')}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-bold border transition-colors ${
                lang === 'en'
                  ? 'bg-[#0C447C] border-[#0C447C] text-white'
                  : 'border-slate-200 text-slate-500 hover:border-slate-400 hover:bg-slate-50'
              }`}
            >
              🇺🇸 EN
            </button>
          </div>
        </SettingRow>
      </SettingSection>

      {/* ── Calculations ─────────────────────────────────────────────────────── */}
      <SettingSection title={L('Cálculos', 'Calculations')}>
        <SettingRow
          label="Ley 10%"
          hint={L('Cargo de servicio aplicado a todas las facturas', 'Service charge applied to all invoices')}
        >
          <Toggle enabled={on('ley_enabled')} onChange={v => set('ley_enabled', v ? '1' : '0')} />
        </SettingRow>

        <SettingRow
          label={L('ITBIS %', 'ITBIS %')}
          hint={L('Porcentaje del impuesto (defecto: 18)', 'Tax rate percentage (default: 18)')}
        >
          <Input
            type="number" min="0" max="100"
            value={cfg.itbis_pct}
            onChange={e => set('itbis_pct', e.target.value)}
            className="w-20 text-center"
          />
        </SettingRow>

        <SettingRow
          label={L('Tasa Cambio USD', 'USD Exchange Rate')}
          hint="RD$ por USD"
        >
          <Input
            type="number" min="0" step="0.01"
            value={cfg.usd_rate}
            onChange={e => set('usd_rate', e.target.value)}
            className="w-24 text-center"
          />
        </SettingRow>
      </SettingSection>

      {/* ── Fiscal ───────────────────────────────────────────────────────────── */}
      <SettingSection title={L('Fiscal', 'Tax & Compliance')}>
        <SettingRow
          label={L('Verificar RNC/NCF', 'Verify RNC/NCF')}
          hint={L('Valida RNC contra el API de DGII', 'Validates RNC against DGII API')}
        >
          <Toggle enabled={on('rnc_verify')} onChange={v => set('rnc_verify', v ? '1' : '0')} />
        </SettingRow>

        <SettingRow
          label={L('Sucursales', 'Branches')}
          hint={L('Próximamente — gestión multi-sucursal', 'Coming soon — multi-branch management')}
        >
          <Toggle enabled={on('sucursales')} onChange={v => set('sucursales', v ? '1' : '0')} disabled />
        </SettingRow>
      </SettingSection>

      {/* ── POS ──────────────────────────────────────────────────────────────── */}
      <SettingSection title={L('Punto de Venta', 'Point of Sale')}>
        <SettingRow
          label={L('Bebidas y Snacks en POS', 'Beverages & Snacks in POS')}
          hint={L('Muestra la pestaña Extras en el POS', 'Shows the Extras tab in POS')}
        >
          <Toggle enabled={on('beverages_in_pos')} onChange={v => set('beverages_in_pos', v ? '1' : '0')} />
        </SettingRow>

        <SettingRow
          label={L('Respaldo Automático', 'Auto Backup')}
          hint={L('Genera copia de seguridad automáticamente cada día', 'Generates a backup automatically every day')}
        >
          <Toggle enabled={on('auto_backup')} onChange={v => set('auto_backup', v ? '1' : '0')} />
        </SettingRow>
      </SettingSection>

      {/* ── Printing ─────────────────────────────────────────────────────────── */}
      <SettingSection title={L('Impresión', 'Printing')}>
        <SettingRow
          label={L('Impresora', 'Printer')}
          hint={L('Selecciona la impresora predeterminada del sistema', 'Select the default system printer')}
        >
          <div className="flex items-center gap-2">
            <select
              value={cfg.printer}
              onChange={e => set('printer', e.target.value)}
              className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12px] text-slate-700 bg-white focus:outline-none focus:border-sky-400 max-w-[220px]"
            >
              <option value="">{L('Predeterminada del sistema', 'System default')}</option>
              {printers.map(p => (
                <option key={p.name} value={p.name}>
                  {p.name}{p.isDefault ? ' ★' : ''}
                </option>
              ))}
            </select>
            <button
              onClick={testPrint}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <Printer size={12} />
              {L('Prueba', 'Test')}
            </button>
          </div>
        </SettingRow>

        <SettingRow
          label={L('Imprimir Pre-Ticket', 'Print Pre-Ticket')}
          hint={L('Al añadir el vehículo a la cola', 'When adding the vehicle to the queue')}
        >
          <Toggle enabled={on('print_preticket')} onChange={v => set('print_preticket', v ? '1' : '0')} />
        </SettingRow>

        <SettingRow
          label={L('Imprimir Factura Automáticamente', 'Auto-Print Invoice')}
          hint={L('Al confirmar el cobro', 'On payment confirmation')}
        >
          <Toggle enabled={on('print_factura_auto')} onChange={v => set('print_factura_auto', v ? '1' : '0')} />
        </SettingRow>

        <SettingRow
          label={L('Imprimir Conduce Automáticamente', 'Auto-Print Delivery Note')}
          hint={L('Al confirmar el cobro', 'On payment confirmation')}
        >
          <Toggle enabled={on('print_conduce_auto')} onChange={v => set('print_conduce_auto', v ? '1' : '0')} />
        </SettingRow>
      </SettingSection>

      <div className="flex justify-end mt-2">
        <SaveBtn
          saving={saving}
          saved={saved}
          label={L('Guardar Configuración', 'Save Settings')}
          onClick={handleSave}
        />
      </div>
    </div>
  )
}

// ── MAIN ADMIN SCREEN ─────────────────────────────────────────────────────────

const TABS = [
  { id: 'empresa',    es: 'Mi Empresa',  en: 'Business',   icon: Building2  },
  { id: 'lavadores',  es: 'Lavadores',   en: 'Washers',    icon: Users      },
  { id: 'vendedores', es: 'Vendedores',  en: 'Salespeople',icon: UserCheck  },
  { id: 'usuarios',   es: 'Usuarios',    en: 'Users',      icon: KeyRound   },
  { id: 'servicios',  es: 'Servicios',   en: 'Services',   icon: LayoutGrid },
  { id: 'sistema',    es: 'Sistema',     en: 'System',     icon: Settings   },
]

export default function Admin() {
  const { lang, t } = useLang()
  const [tab, setTab] = useState('empresa')

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-slate-200">
        <h2 className="text-[16px] font-bold text-slate-800">{t('nav_admin')}</h2>
        <p className="text-[12px] text-slate-400 mt-0.5">{t('admin_desc')}</p>
      </div>

      {/* Tabs */}
      <div className="shrink-0 flex border-b border-slate-200 px-6 overflow-x-auto">
        {TABS.map(({ id, es, en, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-4 py-3 text-[13px] font-semibold border-b-2 transition-colors shrink-0 ${
              tab === id ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}>
            <Icon size={14} />
            {lang === 'es' ? es : en}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {tab === 'empresa'    && <MiEmpresa />}
        {tab === 'lavadores'  && <Lavadores />}
        {tab === 'vendedores' && <Vendedores />}
        {tab === 'usuarios'   && <Usuarios />}
        {tab === 'servicios'  && <Servicios />}
        {tab === 'sistema'    && <Sistema />}
      </div>
    </div>
  )
}
