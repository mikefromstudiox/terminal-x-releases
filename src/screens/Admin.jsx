import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Building2, Upload, X, CheckCircle2, Loader2, ImageOff,
  Users, UserCheck, KeyRound, LayoutGrid, Plus, Edit2, Power,
  Eye, EyeOff, AlertCircle, FileText, Wifi, WifiOff, ExternalLink,
  Check, Coffee,
} from 'lucide-react'
import { useLang } from '../i18n'
import { useAPI } from '../context/DataContext'
import { ECF_TYPES, BUSINESS_TYPES, testEF2Connection, EF2_CONFIGURED } from '../services/ecf'
import {
  getStoredSetting, setStoredSetting, resetSupabaseClient,
  testConnection, ensureBusinessRegistered,
} from '../services/supabase'
import { syncService, syncWasher, syncSeller, syncUser, syncNCFSequence } from '../services/sync'
// Reports moved to dedicated Reportes screen
// RemoteDashboard moved to its own sidebar tab

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
    <div className="fixed inset-0 z-40 bg-white md:relative md:inset-auto md:z-auto md:w-72 shrink-0 md:border md:border-slate-200 md:rounded-xl p-5 md:bg-white md:self-start overflow-y-auto">
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
  const api                     = useAPI()
  const { lang }                = useLang()
  const L                       = (es, en) => lang === 'es' ? es : en
  const [list,      setList]    = useState([])
  const [loading,   setLoading] = useState(false)
  const [loadErr,   setLoadErr] = useState('')
  const [panel,     setPanel]   = useState(null)
  const [form,      setForm]    = useState(EMPTY_WASHER)
  const [saving,    setSaving]  = useState(false)
  const [saved,     setSaved]   = useState(false)
  const [error,     setError]   = useState('')
  const { toast, show }         = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setLoadErr('')
    try { setList((await api?.washers?.allAdmin?.()) || []) }
    catch (e) { setLoadErr(e.message || L('Error al cargar', 'Load error')) }
    finally { setLoading(false) }
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
      if (panel === 'add') await api.washers.create(p)
      else                 await api.washers.update({ id: panel.id, ...p })
      syncWasher(panel === 'add' ? p : { id: panel.id, ...p })
      setSaved(true)
      show(panel === 'add' ? L('Lavador agregado ✓', 'Washer added ✓') : L('Lavador actualizado ✓', 'Washer updated ✓'))
      setTimeout(() => { closePanel(); load() }, 1000)
    } catch (err) { setError(err.message || L('Error al guardar.', 'Error saving.')) }
    finally { setSaving(false) }
  }

  async function toggleActive(w) {
    try {
      await api.washers.update({ id: w.id, active: w.active ? 0 : 1 })
      show(w.active ? L('Desactivado', 'Deactivated') : L('Activado', 'Activated'))
      load()
    } catch {}
  }

  return (
    <div className="flex flex-col md:flex-row gap-4 md:gap-6">
      <Toast toast={toast} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[12px] text-slate-400">{list.length} {L('lavadores', 'washers')}</p>
          <button onClick={openAdd} className="flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] md:min-h-0 bg-[#0C447C] text-white text-[12px] font-bold rounded-lg hover:bg-[#0a3a6a] transition-colors">
            <Plus size={13} /> {L('Agregar Lavador', 'Add Washer')}
          </button>
        </div>
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="hidden md:flex items-center px-4 py-2 bg-slate-50 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            <span className="flex-1">{L('Nombre / Cédula', 'Name / ID')}</span>
            <span className="w-28">{L('Teléfono', 'Phone')}</span>
            <span className="w-20 text-center">{L('Comisión', 'Commission')}</span>
            <span className="w-24 text-center">{L('Estado', 'Status')}</span>
            <span className="w-16 text-right">{L('Acción', 'Action')}</span>
          </div>
          {loading
            ? <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={20} /></div>
            : loadErr
            ? <div className="py-8 text-center text-[12px] text-red-500">{loadErr}</div>
            : list.length === 0
            ? <div className="py-10 text-center text-[12px] text-slate-400">{L('No hay lavadores registrados.', 'No washers registered.')}</div>
            : list.map(w => (
              <div key={w.id} className="md:flex md:items-center px-4 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                {/* Mobile card layout */}
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-[#f0f6ff] text-[#0C447C] flex items-center justify-center text-[11px] font-black shrink-0">
                    {w.name[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-slate-800 truncate">{w.name}</p>
                    {w.cedula && <p className="text-[10px] text-slate-400">{w.cedula}</p>}
                    <div className="flex items-center gap-3 mt-1 md:hidden">
                      <span className="text-[11px] text-slate-500">{w.phone || '—'}</span>
                      <span className="text-[11px] font-semibold text-slate-700">{w.commission_pct}%</span>
                      <ActiveBadge active={w.active} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 md:hidden">
                    <button onClick={() => openEdit(w)} className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors"><Edit2 size={15} /></button>
                    <button onClick={() => toggleActive(w)} className={`p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors ${w.active ? 'text-slate-400 hover:text-red-500 hover:bg-red-50' : 'text-slate-300 hover:text-green-600 hover:bg-green-50'}`}><Power size={15} /></button>
                  </div>
                </div>
                {/* Desktop columns */}
                <span className="hidden md:inline w-28 text-[12px] text-slate-500">{w.phone || '—'}</span>
                <span className="hidden md:inline w-20 text-center text-[12px] font-semibold text-slate-700">{w.commission_pct}%</span>
                <span className="hidden md:flex w-24 justify-center"><ActiveBadge active={w.active} /></span>
                <div className="hidden md:flex w-16 items-center justify-end gap-1">
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
  const api                     = useAPI()
  const { lang }                = useLang()
  const L                       = (es, en) => lang === 'es' ? es : en
  const [list,      setList]    = useState([])
  const [loading,   setLoading] = useState(false)
  const [loadErr,   setLoadErr] = useState('')
  const [panel,     setPanel]   = useState(null)
  const [form,      setForm]    = useState(EMPTY_SELLER)
  const [saving,    setSaving]  = useState(false)
  const [saved,     setSaved]   = useState(false)
  const [error,     setError]   = useState('')
  const { toast, show }         = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setLoadErr('')
    try { setList((await api?.sellers?.allAdmin?.()) || []) }
    catch (e) { setLoadErr(e.message || L('Error al cargar', 'Load error')) }
    finally { setLoading(false) }
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
      if (panel === 'add') await api.sellers.create(p)
      else                 await api.sellers.update({ id: panel.id, ...p })
      syncSeller(panel === 'add' ? p : { id: panel.id, ...p })
      setSaved(true)
      show(panel === 'add' ? L('Vendedor agregado ✓', 'Salesperson added ✓') : L('Vendedor actualizado ✓', 'Salesperson updated ✓'))
      setTimeout(() => { closePanel(); load() }, 1000)
    } catch (err) { setError(err.message || L('Error al guardar.', 'Error saving.')) }
    finally { setSaving(false) }
  }

  async function toggleActive(s) {
    try {
      await api.sellers.update({ id: s.id, active: s.active ? 0 : 1 })
      show(s.active ? L('Desactivado', 'Deactivated') : L('Activado', 'Activated'))
      load()
    } catch {}
  }

  return (
    <div className="flex flex-col md:flex-row gap-4 md:gap-6">
      <Toast toast={toast} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[12px] text-slate-400">{list.length} {L('vendedores', 'salespeople')}</p>
          <button onClick={openAdd} className="flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] md:min-h-0 bg-[#0C447C] text-white text-[12px] font-bold rounded-lg hover:bg-[#0a3a6a] transition-colors">
            <Plus size={13} /> {L('Agregar Vendedor', 'Add Salesperson')}
          </button>
        </div>
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="hidden md:flex items-center px-4 py-2 bg-slate-50 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            <span className="flex-1">{L('Nombre', 'Name')}</span>
            <span className="w-28">{L('Teléfono', 'Phone')}</span>
            <span className="w-24 text-center">{L('Comisión', 'Commission')}</span>
            <span className="w-24 text-center">{L('Estado', 'Status')}</span>
            <span className="w-16 text-right">{L('Acción', 'Action')}</span>
          </div>
          {loading
            ? <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={20} /></div>
            : loadErr
            ? <div className="py-8 text-center text-[12px] text-red-500">{loadErr}</div>
            : list.length === 0
            ? <div className="py-10 text-center text-[12px] text-slate-400">{L('No hay vendedores registrados.', 'No salespeople registered.')}</div>
            : list.map(s => (
              <div key={s.id} className="md:flex md:items-center px-4 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-violet-50 text-violet-700 flex items-center justify-center text-[11px] font-black shrink-0">
                    {s.name[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-slate-800 truncate">{s.name}</p>
                    <div className="flex items-center gap-3 mt-1 md:hidden">
                      <span className="text-[11px] text-slate-500">{s.phone || '—'}</span>
                      <span className="text-[11px] font-semibold text-slate-700">{s.commission_pct}%</span>
                      <ActiveBadge active={s.active} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 md:hidden">
                    <button onClick={() => openEdit(s)} className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors"><Edit2 size={15} /></button>
                    <button onClick={() => toggleActive(s)} className={`p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors ${s.active ? 'text-slate-400 hover:text-red-500 hover:bg-red-50' : 'text-slate-300 hover:text-green-600 hover:bg-green-50'}`}><Power size={15} /></button>
                  </div>
                </div>
                <span className="hidden md:inline w-28 text-[12px] text-slate-500">{s.phone || '—'}</span>
                <span className="hidden md:inline w-24 text-center text-[12px] font-semibold text-slate-700">{s.commission_pct}%</span>
                <span className="hidden md:flex w-24 justify-center"><ActiveBadge active={s.active} /></span>
                <div className="hidden md:flex w-16 items-center justify-end gap-1">
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

const EMPTY_USER = { name: '', username: '', pin: '', role: 'cashier', discount_pct: '0', commission_pct: '0' }

function Usuarios() {
  const api                     = useAPI()
  const { lang }                = useLang()
  const L                       = (es, en) => lang === 'es' ? es : en
  const [list,      setList]    = useState([])
  const [loading,   setLoading] = useState(false)
  const [loadErr,   setLoadErr] = useState('')
  const [panel,     setPanel]   = useState(null)
  const [form,      setForm]    = useState(EMPTY_USER)
  const [showPin,   setShowPin] = useState(false)
  const [saving,    setSaving]  = useState(false)
  const [saved,     setSaved]   = useState(false)
  const [error,     setError]   = useState('')
  const { toast, show }         = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setLoadErr('')
    try { setList((await api?.users?.all?.()) || []) }
    catch (e) { setLoadErr(e.message || L('Error al cargar', 'Load error')) }
    finally { setLoading(false) }
  }

  function openAdd()   { setForm(EMPTY_USER); setShowPin(false); setError(''); setSaved(false); setPanel('add') }
  function openEdit(u) { setForm({ name: u.name, username: u.username, pin: '', role: u.role, discount_pct: String(u.discount_pct || 0), commission_pct: String(u.commission_pct || 0) }); setShowPin(false); setError(''); setSaved(false); setPanel(u) }
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
        discount_pct:   parseFloat(form.discount_pct) || 0,
        commission_pct: parseFloat(form.commission_pct) || 0,
        ...(form.pin.trim() && { pin: form.pin.trim() }),
      }
      if (panel === 'add') await api.users.create({ ...payload, pin: form.pin.trim() })
      else                 await api.users.update({ id: panel.id, ...payload })
      syncUser(panel === 'add' ? { ...payload, pin: form.pin.trim() } : { id: panel.id, ...payload })
      setSaved(true)
      show(panel === 'add' ? L('Usuario creado ✓', 'User created ✓') : L('Usuario actualizado ✓', 'User updated ✓'))
      setTimeout(() => { closePanel(); load() }, 1000)
    } catch (err) { setError(err.message || L('Error al guardar.', 'Error saving.')) }
    finally { setSaving(false) }
  }

  async function toggleActive(u) {
    try {
      await api.users.update({ id: u.id, active: u.active ? 0 : 1 })
      show(u.active ? L('Usuario desactivado', 'User deactivated') : L('Usuario activado', 'User activated'))
      load()
    } catch {}
  }

  return (
    <div className="flex flex-col md:flex-row gap-4 md:gap-6">
      <Toast toast={toast} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[12px] text-slate-400">{list.length} {L('usuarios', 'users')}</p>
          <button onClick={openAdd} className="flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] md:min-h-0 bg-[#0C447C] text-white text-[12px] font-bold rounded-lg hover:bg-[#0a3a6a] transition-colors">
            <Plus size={13} /> {L('Agregar Usuario', 'Add User')}
          </button>
        </div>
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="hidden md:flex items-center px-4 py-2 bg-slate-50 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            <span className="flex-1">{L('Nombre / Usuario', 'Name / Username')}</span>
            <span className="w-28 text-center">{L('Rol', 'Role')}</span>
            <span className="w-20 text-center">{L('Dto%', 'Disc%')}</span>
            <span className="w-24 text-center">{L('Estado', 'Status')}</span>
            <span className="w-16 text-right">{L('Acción', 'Action')}</span>
          </div>
          {loading
            ? <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={20} /></div>
            : loadErr
            ? <div className="py-8 text-center text-[12px] text-red-500">{loadErr}</div>
            : list.length === 0
            ? <div className="py-10 text-center text-[12px] text-slate-400">{L('No hay usuarios registrados.', 'No users registered.')}</div>
            : list.map(u => (
              <div key={u.id} className="md:flex md:items-center px-4 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-[11px] font-black shrink-0">
                    {u.name[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-slate-800 truncate">{u.name}</p>
                    <p className="text-[10px] text-slate-400">@{u.username}</p>
                    <div className="flex items-center gap-2 mt-1 md:hidden">
                      <RoleBadge role={u.role} />
                      <span className="text-[11px] text-slate-600">{u.discount_pct}%</span>
                      <ActiveBadge active={u.active} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 md:hidden">
                    <button onClick={() => openEdit(u)} className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors"><Edit2 size={15} /></button>
                    <button onClick={() => toggleActive(u)} className={`p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors ${u.active ? 'text-slate-400 hover:text-red-500 hover:bg-red-50' : 'text-slate-300 hover:text-green-600 hover:bg-green-50'}`}><Power size={15} /></button>
                  </div>
                </div>
                <span className="hidden md:flex w-28 justify-center"><RoleBadge role={u.role} /></span>
                <span className="hidden md:inline w-20 text-center text-[12px] text-slate-600">{u.discount_pct}%</span>
                <span className="hidden md:flex w-24 justify-center"><ActiveBadge active={u.active} /></span>
                <div className="hidden md:flex w-16 items-center justify-end gap-1">
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
            <div><Label>{L('% Comision (Bebidas/Snacks)', '% Commission (Drinks/Snacks)')}</Label><Input type="number" min="0" max="100" value={form.commission_pct} onChange={e => set('commission_pct', e.target.value)} /></div>
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
  const api                         = useAPI()
  const { lang }                    = useLang()
  const L                           = (es, en) => lang === 'es' ? es : en
  const [list,       setList]       = useState([])
  const [loading,    setLoading]    = useState(false)
  const [loadErr,    setLoadErr]    = useState('')
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
    setLoading(true); setLoadErr('')
    try { setList((await api?.services?.allAdmin?.()) || []) }
    catch (e) { setLoadErr(e.message || L('Error al cargar', 'Load error')) }
    finally { setLoading(false) }
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
      if (panel === 'add') await api.services.create(p)
      else                 await api.services.update({ id: panel.id, ...p })
      syncService(panel === 'add' ? p : { id: panel.id, ...p })
      setSaved(true)
      show(panel === 'add' ? L('Servicio agregado ✓', 'Service added ✓') : L('Servicio actualizado ✓', 'Service updated ✓'))
      setTimeout(() => { closePanel(); load() }, 1000)
    } catch (err) { setError(err.message || L('Error al guardar.', 'Error saving.')) }
    finally { setSaving(false) }
  }

  async function toggleActive(s) {
    try {
      await api.services.update({ id: s.id, active: s.active ? 0 : 1 })
      show(s.active ? L('Desactivado — no aparece en POS', 'Deactivated — hidden from POS') : L('Activado en POS ✓', 'Activated in POS ✓'))
      load()
    } catch {}
  }

  function fmtRD(n) { return `RD$ ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0 })}` }

  return (
    <div className="flex flex-col md:flex-row gap-4 md:gap-6">
      <Toast toast={toast} />
      <div className="flex-1 min-w-0">
        {/* Category tabs row */}
        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-0 border-b border-slate-200 mb-4 overflow-x-auto">
          <div className="flex items-center gap-0 overflow-x-auto flex-1">
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
          </div>
          <button onClick={openAdd} className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 mb-2 min-h-[44px] md:min-h-0 bg-[#0C447C] text-white text-[12px] font-bold rounded-lg hover:bg-[#0a3a6a] transition-colors w-full md:w-auto justify-center md:justify-start md:ml-auto">
            <Plus size={13} /> {L('Agregar Servicio', 'Add Service')}
          </button>
        </div>

        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="hidden md:flex items-center px-4 py-2 bg-slate-50 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            <span className="flex-1">{L('Nombre ES', 'Name ES')}</span>
            <span className="w-36">{L('Nombre EN', 'Name EN')}</span>
            <span className="w-24 text-center">{L('Categoría', 'Category')}</span>
            <span className="w-24 text-right">{L('Precio', 'Price')}</span>
            <span className="w-20 text-center">{L('Estado', 'Status')}</span>
            <span className="w-16 text-right">{L('Acción', 'Action')}</span>
          </div>
          {loading
            ? <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={20} /></div>
            : loadErr
            ? <div className="py-8 text-center text-[12px] text-red-500">{loadErr}</div>
            : visible.length === 0
            ? <div className="py-10 text-center text-[12px] text-slate-400">{L('No hay servicios en esta categoría.', 'No services in this category.')}</div>
            : visible.map(s => (
              <div key={s.id} className={`md:flex md:items-center px-4 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors ${!s.active ? 'opacity-50' : ''}`}>
                <div className="flex items-center justify-between md:contents">
                  <div className="flex-1 min-w-0 md:flex-1">
                    <span className="text-[13px] font-semibold text-slate-800 truncate block">{s.name}</span>
                    <div className="flex items-center gap-2 mt-1 md:hidden">
                      <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{s.category}</span>
                      <span className="text-[12px] font-semibold text-slate-700">{fmtRD(s.price)}</span>
                      <ActiveBadge active={s.active} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 md:hidden">
                    <button onClick={() => openEdit(s)} className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors"><Edit2 size={15} /></button>
                    <button onClick={() => toggleActive(s)} className={`p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors ${s.active ? 'text-slate-400 hover:text-red-500 hover:bg-red-50' : 'text-slate-300 hover:text-green-600 hover:bg-green-50'}`}><Power size={15} /></button>
                  </div>
                </div>
                <span className="hidden md:inline w-36 text-[12px] text-slate-400 truncate">{s.name_en || '—'}</span>
                <span className="hidden md:flex w-24 justify-center">
                  <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full truncate max-w-[88px]">{s.category}</span>
                </span>
                <span className="hidden md:inline w-24 text-right text-[12px] font-semibold text-slate-700">{fmtRD(s.price)}</span>
                <span className="hidden md:flex w-20 justify-center"><ActiveBadge active={s.active} /></span>
                <div className="hidden md:flex w-16 items-center justify-end gap-1">
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

// ── Sequence card (shared by legacy B01/B02 and e-CF types) ──────────────────

function SeqCard({ code, nameEs, nameEn, descEs, descEn, noVencimiento,
                   seq, enabled, saving, saved, onToggle, onSave, onUpdate, lang, L }) {
  return (
    <div className={`border rounded-xl p-4 transition-colors ${
      enabled ? 'border-sky-200 bg-sky-50/30' : 'border-slate-200 bg-white'
    }`}>
      <div className="flex items-start gap-3">
        <span className="shrink-0 inline-flex items-center justify-center h-6 px-2 rounded-md text-[11px] font-bold bg-slate-100 text-slate-600 font-mono mt-0.5">
          {code}
        </span>

        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-slate-700 leading-tight">
            {lang === 'es' ? nameEs : nameEn}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
            {lang === 'es' ? descEs : descEn}
          </p>

          {enabled && (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  {L('Número actual', 'Current #')}
                </label>
                <input
                  type="number" min="0"
                  value={seq.current_number}
                  onChange={e => onUpdate(code, { current_number: e.target.value })}
                  className="w-24 px-2.5 py-1.5 border border-slate-200 rounded-lg text-[12px] text-slate-700 bg-white focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/20"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  {L('Límite', 'Limit')}
                </label>
                <input
                  type="number" min="1"
                  value={seq.limit_number}
                  onChange={e => onUpdate(code, { limit_number: e.target.value })}
                  className="w-28 px-2.5 py-1.5 border border-slate-200 rounded-lg text-[12px] text-slate-700 bg-white focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/20"
                />
              </div>
              {!noVencimiento ? (
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                    {L('Válido hasta', 'Valid until')}
                  </label>
                  <input
                    type="date"
                    value={seq.valid_until || ''}
                    onChange={e => onUpdate(code, { valid_until: e.target.value })}
                    className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-[12px] text-slate-700 bg-white focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/20"
                  />
                </div>
              ) : (
                <p className="text-[10px] text-amber-600 font-medium self-end pb-2">
                  {L('Sin fecha de vencimiento', 'No expiry date')}
                </p>
              )}
              <button
                onClick={() => onSave(code)}
                disabled={saving[code]}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0C447C] hover:bg-[#0a3a6a] disabled:opacity-50 text-white text-[12px] font-bold rounded-lg transition-colors"
              >
                {saving[code] ? <><Loader2 size={11} className="animate-spin" /> {L('Guardando…', 'Saving…')}</>
                 : saved[code] ? <><CheckCircle2 size={11} /> {L('Guardado', 'Saved')}</>
                 : L('Guardar', 'Save')}
              </button>
            </div>
          )}
        </div>

        <Toggle enabled={enabled} onChange={v => onToggle(code, v)} />
      </div>
    </div>
  )
}

// ── FISCAL / NCF SEQUENCES ────────────────────────────────────────────────────

export function FiscalNCF() {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const { toast, show } = useToast()

  const [sequences,   setSequences]   = useState([])
  const [saving,      setSaving]      = useState({})
  const [saved,       setSaved]       = useState({})
  const [testing,     setTesting]     = useState(false)
  const [testResult,  setTestResult]  = useState(null)  // null | 'ok' | 'error'
  const [testMsg,     setTestMsg]     = useState('')
  const [fiscalMode,  setFiscalMode]  = useState('ecf')  // 'legacy' | 'ecf'
  const [modeLoaded,  setModeLoaded]  = useState(false)

  const load = useCallback(async () => {
    try {
      const rows = await api?.ncf?.sequences?.()
      setSequences(rows || [])
    } catch {}
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    api?.settings?.get?.()
      .then(s => { if (s?.fiscal_mode) setFiscalMode(s.fiscal_mode) })
      .catch(() => {})
      .finally(() => setModeLoaded(true))
  }, [])

  async function saveFiscalMode(mode) {
    setFiscalMode(mode)
    try {
      await api.settings.update({ fiscal_mode: mode })
      show(L('Modo de comprobantes actualizado ✓', 'Receipt mode updated ✓'))
    } catch {
      show(L('Error al guardar', 'Error saving'), 'error')
    }
  }

  function getSeq(type) {
    return sequences.find(s => s.type === type) || {
      type, enabled: 0, current_number: 0, limit_number: 500, valid_until: '',
    }
  }

  function updateLocal(type, patch) {
    setSequences(prev => {
      const exists = prev.find(s => s.type === type)
      if (exists) return prev.map(s => s.type === type ? { ...s, ...patch } : s)
      return [...prev, { type, enabled: 0, current_number: 0, limit_number: 500, valid_until: '', ...patch }]
    })
  }

  async function handleToggle(type, enabled) {
    updateLocal(type, { enabled: enabled ? 1 : 0 })
    try {
      await api.ncf.updateSequence({ type, enabled: enabled ? 1 : 0 })
    } catch {
      show(L('Error al actualizar', 'Error updating'), 'error')
    }
  }

  async function handleSaveSeq(type) {
    const seq = getSeq(type)
    setSaving(s => ({ ...s, [type]: true }))
    try {
      await api.ncf.updateSequence({
        type,
        current_number: Number(seq.current_number) || 0,
        limit_number:   Number(seq.limit_number)   || 500,
        valid_until:    seq.valid_until || null,
      })
      syncNCFSequence({ type, current_number: Number(seq.current_number) || 0, limit_number: Number(seq.limit_number) || 500, valid_until: seq.valid_until || null })
      setSaved(s => ({ ...s, [type]: true }))
      show(L('Secuencia guardada ✓', 'Sequence saved ✓'))
      setTimeout(() => setSaved(s => ({ ...s, [type]: false })), 2500)
    } catch {
      show(L('Error al guardar', 'Error saving'), 'error')
    } finally {
      setSaving(s => ({ ...s, [type]: false }))
    }
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      await testEF2Connection()
      setTestResult('ok')
      setTestMsg(L('Conectado a ef2.do ✓', 'Connected to ef2.do ✓'))
      show(L('Conectado a ef2.do ✓', 'Connected to ef2.do ✓'))
    } catch (err) {
      setTestResult('error')
      setTestMsg(err.message || L('Error de conexión', 'Connection error'))
      show(err.message || L('Error de conexión', 'Connection error'), 'error')
    } finally {
      setTesting(false)
    }
  }

  const ecfList = Object.values(ECF_TYPES)

  const LEGACY_SEQ_TYPES = [
    {
      code: 'B01',
      name_es: 'Crédito Fiscal',          name_en: 'Tax Credit Invoice',
      desc_es: 'Para ventas a empresas con RNC. Requiere RNC del comprador.',
      desc_en: 'For B2B sales with RNC. Buyer RNC required.',
      noVencimiento: false,
    },
    {
      code: 'B02',
      name_es: 'Consumidor Final',         name_en: 'Consumer Final Invoice',
      desc_es: 'Ventas al consumidor general. Sin RNC requerido.',
      desc_en: 'Consumer sales. No RNC required.',
      noVencimiento: false,
    },
  ]

  return (
    <div className="max-w-2xl space-y-5">
      <Toast toast={toast} />

      {/* ── Fiscal Mode Toggle ─────────────────────────────────────────────── */}
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            {L('Sistema de Comprobantes Fiscales', 'Fiscal Receipt System')}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {L(
              'Elige entre NCF tradicional (B01/B02) o el nuevo sistema electrónico obligatorio desde mayo 2026.',
              'Choose between traditional NCF (B01/B02) or the new electronic system mandatory from May 2026.'
            )}
          </p>
        </div>
        <div className="px-4 py-4 grid grid-cols-2 gap-3">
          <button
            onClick={() => saveFiscalMode('legacy')}
            className={`flex flex-col gap-1.5 px-4 py-3.5 rounded-xl border-2 text-left transition-all ${
              fiscalMode === 'legacy'
                ? 'border-sky-500 bg-sky-50'
                : 'border-slate-200 hover:border-slate-300 bg-white'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-[13px] font-black text-slate-700">B01 / B02</span>
              {fiscalMode === 'legacy' && (
                <span className="text-[9px] font-bold bg-sky-500 text-white px-2 py-0.5 rounded-full">
                  {L('ACTIVO', 'ACTIVE')}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 leading-snug">
              {L('NCF Tradicional — papel o local', 'Traditional NCF — paper or local')}
            </p>
            <p className="text-[10px] text-slate-400">
              {L('Sin conexión a ef2.do', 'No ef2.do connection required')}
            </p>
          </button>

          <button
            onClick={() => saveFiscalMode('ecf')}
            className={`flex flex-col gap-1.5 px-4 py-3.5 rounded-xl border-2 text-left transition-all ${
              fiscalMode === 'ecf'
                ? 'border-sky-500 bg-sky-50'
                : 'border-slate-200 hover:border-slate-300 bg-white'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-[13px] font-black text-slate-700">e-CF</span>
              {fiscalMode === 'ecf' && (
                <span className="text-[9px] font-bold bg-sky-500 text-white px-2 py-0.5 rounded-full">
                  {L('ACTIVO', 'ACTIVE')}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 leading-snug">
              {L('Electrónico — E31/E32/etc.', 'Electronic — E31/E32/etc.')}
            </p>
            <p className="text-[10px] text-amber-600 font-medium">
              {L('Obligatorio desde mayo 2026', 'Mandatory from May 2026')}
            </p>
          </button>
        </div>
      </div>

      {/* ── e-CF connection status ─────────────────────────────────────────── */}
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex items-center justify-between">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            {L('Configuración e-CF — ef2.do', 'e-CF Configuration — ef2.do')}
          </p>
          {EF2_CONFIGURED
            ? <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                <Wifi size={10} /> {L('Token configurado', 'Token configured')}
              </span>
            : <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                <WifiOff size={10} /> {L('Sin token — modo stub', 'No token — stub mode')}
              </span>
          }
        </div>
        <div className="px-4 py-4 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            {EF2_CONFIGURED ? (
              <p className="text-[12px] text-slate-600">
                {L(
                  'El API de ef2.do está configurado. Los comprobantes se enviarán a la DGII en tiempo real.',
                  'ef2.do API is configured. Receipts will be submitted to DGII in real time.'
                )}
              </p>
            ) : (
              <p className="text-[12px] text-slate-500">
                {L(
                  'Sin token configurado — la app opera en modo stub. Los eNCF son simulados y no se envían a la DGII.',
                  'No token configured — app runs in stub mode. eNCFs are simulated and not sent to DGII.'
                )}
                {' '}
                <a href="https://ef2.do" target="_blank" rel="noreferrer"
                  className="text-sky-600 hover:underline inline-flex items-center gap-0.5">
                  ef2.do <ExternalLink size={10} className="inline" />
                </a>
              </p>
            )}
            {testResult && (
              <div className={`mt-2 flex items-center gap-1.5 text-[12px] font-semibold ${
                testResult === 'ok' ? 'text-emerald-600' : 'text-red-600'
              }`}>
                {testResult === 'ok' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                {testMsg}
              </div>
            )}
          </div>
          {EF2_CONFIGURED && (
            <button
              onClick={handleTest}
              disabled={testing}
              className="shrink-0 flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-[12px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              {testing
                ? <><Loader2 size={12} className="animate-spin" /> {L('Probando…', 'Testing…')}</>
                : <><Wifi size={12} /> {L('Probar conexión', 'Test connection')}</>
              }
            </button>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-[13px] font-bold text-slate-700 mb-1">
          {L('Secuencias NCF / e-CF', 'NCF / e-CF Sequences')}
        </h3>
        <p className="text-[11px] text-slate-400">
          {L(
            'Configura los rangos de comprobantes asignados por la DGII. El número actual se incrementa en cada cobro.',
            'Configure the NCF ranges assigned by DGII. The current number increments with each payment.'
          )}
        </p>
      </div>

      {/* ── B01 / B02 legacy sequences ─────────────────────────────────────── */}
      <div>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
          <span className="font-mono">B01 / B02</span>
          <span>— {L('NCF Tradicional (hasta mayo 2026)', 'Traditional NCF (until May 2026)')}</span>
        </p>
        <div className="space-y-3">
          {LEGACY_SEQ_TYPES.map(ncf => {
            const seq     = getSeq(ncf.code)
            const enabled = seq.enabled === 1
            return (
              <SeqCard
                key={ncf.code}
                code={ncf.code}
                nameEs={ncf.name_es} nameEn={ncf.name_en}
                descEs={ncf.desc_es} descEn={ncf.desc_en}
                noVencimiento={ncf.noVencimiento}
                seq={seq} enabled={enabled}
                saving={saving} saved={saved}
                onToggle={handleToggle}
                onSave={handleSaveSeq}
                onUpdate={updateLocal}
                lang={lang} L={L}
              />
            )
          })}
        </div>
      </div>

      {/* ── e-CF electronic sequences ──────────────────────────────────────── */}
      <div>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
          <span className="font-mono">e-CF</span>
          <span>— {L('Electrónico (obligatorio mayo 2026)', 'Electronic (mandatory May 2026)')}</span>
        </p>
        <div className="space-y-3">
          {ecfList.map(ecf => {
            const seq     = getSeq(ecf.code)
            const enabled = seq.enabled === 1
            return (
              <SeqCard
                key={ecf.code}
                code={ecf.code}
                nameEs={ecf.name_es} nameEn={ecf.name_en}
                descEs={ecf.desc_es} descEn={ecf.desc_en}
                noVencimiento={ecf.noVencimiento}
                seq={seq} enabled={enabled}
                saving={saving} saved={saved}
                onToggle={handleToggle}
                onSave={handleSaveSeq}
                onUpdate={updateLocal}
                lang={lang} L={L}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── MI EMPRESA ────────────────────────────────────────────────────────────────

function MiEmpresa() {
  const api                   = useAPI()
  const { lang }              = useLang()
  const L                     = (es, en) => lang === 'es' ? es : en
  const [form,    setForm]    = useState({ biz_name: '', biz_rnc: '', biz_address: '', biz_phone: '', biz_city: '', biz_type: '' })
  const [logo,    setLogo]    = useState('')
  const [loading, setLoading] = useState(false)
  const [loadErr, setLoadErr] = useState('')
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState('')
  const { toast, show }       = useToast()
  const fileRef = useRef()

  useEffect(() => {
    setLoading(true)
    api?.admin?.getEmpresa?.()
      .then(row => {
        if (!row) return
        let extra = {}
        try { extra = JSON.parse(row.settings || '{}') } catch {}
        setForm({
          biz_name:    row.name    || '',
          biz_rnc:     row.rnc     || '',
          biz_address: row.address || '',
          biz_phone:   row.phone   || '',
          biz_city:    extra.biz_city  || '',
          biz_type:    extra.biz_type  || '',
        })
        setLogo(row.logo || '')
      })
      .catch(e => setLoadErr(e.message || L('Error al cargar', 'Load error')))
      .finally(() => setLoading(false))
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
      await api.admin.saveEmpresa({
        name:     form.biz_name.trim(),
        rnc:      form.biz_rnc.trim(),
        address:  form.biz_address.trim(),
        phone:    form.biz_phone.trim(),
        logo:     logo || null,
        settings: JSON.stringify({ biz_city: form.biz_city.trim(), biz_type: form.biz_type }),
      })
      show(L('Empresa guardada ✓', 'Business saved ✓'))
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

  if (loading) return <div className="py-16 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={22} /></div>
  if (loadErr) return <div className="py-12 text-center text-[13px] text-red-500">{loadErr}</div>

  return (
    <div className="max-w-xl space-y-6">
      <Toast toast={toast} />
      {/* Business type */}
      <div>
        <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
          {L('Tipo de Negocio', 'Business Type')}
        </label>
        <select
          value={form.biz_type}
          onChange={e => {
            const bt = e.target.value
            set('biz_type', bt)
          }}
          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-[13px] text-slate-700 focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/20"
        >
          <option value="">{L('Seleccionar tipo…', 'Select type…')}</option>
          {Object.entries(BUSINESS_TYPES).map(([key, bt]) => (
            <option key={key} value={key}>{L(bt.es, bt.en)}</option>
          ))}
        </select>
        {form.biz_type && BUSINESS_TYPES[form.biz_type] && (
          <p className="text-[11px] text-slate-400 mt-1.5">
            {L('Tipos habilitados por defecto:', 'Default enabled types:')}
            {' '}
            <span className="font-mono font-semibold text-sky-600">
              {BUSINESS_TYPES[form.biz_type].enabled.join(', ')}
            </span>
          </p>
        )}
      </div>

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

// ── CAJERAS ──────────────────────────────────────────────────────────────────

function Cajeras() {
  const api              = useAPI()
  const { lang }         = useLang()
  const L                = (es, en) => lang === 'es' ? es : en
  const [list, setList]  = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving]   = useState({})
  const { toast, show }  = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const users = (await api?.users?.all?.()) || []
      // Show cashiers and any user with commission_pct > 0
      setList(users.filter(u => u.active && (u.role === 'cashier' || (u.commission_pct && u.commission_pct > 0))))
    } catch {}
    setLoading(false)
  }

  async function updateCommission(userId, pct) {
    setSaving(s => ({ ...s, [userId]: true }))
    try {
      await api.users.update({ id: userId, commission_pct: parseFloat(pct) || 0 })
      show(L('Comision actualizada', 'Commission updated'))
      load()
    } catch {}
    setSaving(s => ({ ...s, [userId]: false }))
  }

  return (
    <div>
      <p className="text-[12px] text-slate-400 mb-4">
        {L('Porcentaje de comision sobre bebidas y snacks para cada cajera/o.', 'Commission percentage on drinks and snacks for each cashier.')}
      </p>
      {loading ? (
        <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={20} /></div>
      ) : list.length === 0 ? (
        <div className="py-10 text-center text-[12px] text-slate-400">
          {L('No hay cajeras registradas. Agrega usuarios con rol "Cajera" en la pestana Usuarios.', 'No cashiers registered. Add users with "Cashier" role in the Users tab.')}
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <Toast toast={toast} />
          <div className="hidden md:flex items-center px-4 py-2 bg-slate-50 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            <span className="flex-1">{L('Nombre', 'Name')}</span>
            <span className="w-24 text-center">{L('Rol', 'Role')}</span>
            <span className="w-32 text-center">{L('% Comision', '% Commission')}</span>
            <span className="w-20 text-center"></span>
          </div>
          {list.map(u => (
            <CajeraRow key={u.id} u={u} L={L} saving={saving[u.id]} onSave={updateCommission} />
          ))}
        </div>
      )}
    </div>
  )
}

function CajeraRow({ u, L, saving, onSave }) {
  const [pct, setPct] = useState(String(u.commission_pct || 0))
  const changed = parseFloat(pct) !== (u.commission_pct || 0)
  return (
    <div className="md:flex md:items-center px-4 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
      <div className="flex items-center gap-2.5 flex-1 min-w-0">
        <div className="w-8 h-8 rounded-full bg-sky-50 text-sky-600 flex items-center justify-center text-[11px] font-black shrink-0">
          {u.name[0]?.toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-slate-800 truncate">{u.name}</p>
          <p className="text-[10px] text-slate-400">@{u.username}</p>
        </div>
      </div>
      <span className="hidden md:flex w-24 justify-center"><RoleBadge role={u.role} /></span>
      <div className="w-32 flex items-center justify-center gap-1">
        <input type="number" min="0" max="100" step="0.5" value={pct} onChange={e => setPct(e.target.value)}
          className="w-16 px-2 py-1 border border-slate-200 rounded-lg text-[12px] text-center text-slate-700 focus:outline-none focus:border-sky-400" />
        <span className="text-[11px] text-slate-400">%</span>
      </div>
      <div className="w-20 flex items-center justify-center">
        {changed && (
          <button onClick={() => onSave(u.id, pct)} disabled={saving}
            className="px-3 py-1 bg-[#0C447C] text-white text-[11px] font-semibold rounded-lg hover:bg-[#0a3a6b] disabled:opacity-40">
            {saving ? <Loader2 className="animate-spin" size={12} /> : L('Guardar', 'Save')}
          </button>
        )}
      </div>
    </div>
  )
}

// ── MAIN ADMIN SCREEN ─────────────────────────────────────────────────────────

const TABS = [
  { id: 'empresa',    es: 'Mi Empresa',    en: 'Business',          icon: Building2  },
  { id: 'lavadores',  es: 'Lavadores',     en: 'Washers',           icon: Users      },
  { id: 'vendedores', es: 'Vendedores',    en: 'Salespeople',       icon: UserCheck  },
  { id: 'cajeras',    es: 'Cajeras',       en: 'Cashiers',          icon: Coffee     },
  { id: 'usuarios',   es: 'Usuarios',      en: 'Users',             icon: KeyRound   },
  { id: 'servicios',  es: 'Servicios',     en: 'Services',          icon: LayoutGrid },
]

export default function Admin() {
  const { lang, t } = useLang()
  const [tab, setTab] = useState('empresa')

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="shrink-0 px-3 md:px-6 py-3 md:py-4 border-b border-slate-200">
        <h2 className="text-[14px] md:text-[16px] font-bold text-slate-800">{t('nav_admin')}</h2>
        <p className="text-[11px] md:text-[12px] text-slate-400 mt-0.5">{t('admin_desc')}</p>
      </div>

      {/* Tabs */}
      <div className="shrink-0 flex border-b border-slate-200 px-2 md:px-6 overflow-x-auto scrollbar-none">
        {TABS.map(({ id, es, en, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 md:px-4 py-3 text-xs md:text-[13px] font-semibold border-b-2 transition-colors shrink-0 whitespace-nowrap ${
              tab === id ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}>
            <Icon size={14} />
            {lang === 'es' ? es : en}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 md:px-6 py-4 md:py-6">
        {tab === 'empresa'    && <MiEmpresa />}
        {tab === 'lavadores'  && <Lavadores />}
        {tab === 'vendedores' && <Vendedores />}
        {tab === 'cajeras'    && <Cajeras />}
        {tab === 'usuarios'   && <Usuarios />}
        {tab === 'servicios'  && <Servicios />}
      </div>
    </div>
  )
}

// ── Respaldo / Supabase config ────────────────────────────────────────────────
export function Respaldo() {
  const [url,        setUrl]        = useState(() => getStoredSetting('supabase_url'))
  const [anonKey,    setAnonKey]    = useState(() => getStoredSetting('supabase_anon_key'))
  const [saved,      setSaved]      = useState(false)
  const [testing,    setTesting]    = useState(false)
  const [testResult, setTestResult] = useState(null)

  async function handleSave() {
    setStoredSetting('supabase_url',      url.trim())
    setStoredSetting('supabase_anon_key', anonKey.trim())
    setStoredSetting('business_id',       '')          // force re-register on next Dashboard visit
    resetSupabaseClient()
    if (url.trim() && anonKey.trim()) {
      ensureBusinessRegistered().catch(() => {})
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleTest() {
    setTesting(true); setTestResult(null)
    const res = await testConnection()
    setTesting(false); setTestResult(res)
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <p className="text-[13px] font-bold text-slate-700 mb-1">Supabase — Credenciales</p>
        <p className="text-[12px] text-slate-400 mb-4">
          Conecta con Supabase para activar el Dashboard Remoto y sincronización en la nube.
        </p>

        <div className="space-y-3">
          <div>
            <Label>Project URL</Label>
            <Input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://xxxxxxxxxxxx.supabase.co"
            />
          </div>
          <div>
            <Label>Anon Public Key</Label>
            <input
              type="password"
              value={anonKey}
              onChange={e => setAnonKey(e.target.value)}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-[12px] text-slate-700 bg-white
                focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/20 placeholder:text-slate-300"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={handleSave}
            disabled={!url || !anonKey}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#0C447C] text-white rounded-lg text-[12px] font-semibold disabled:opacity-40 hover:bg-[#0a3a6b]"
          >
            {saved ? <><Check size={13} /> Guardado</> : 'Guardar'}
          </button>
          <button
            onClick={handleTest}
            disabled={testing || !url || !anonKey}
            className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-[12px] text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            <Wifi size={13} />
            {testing ? 'Probando…' : 'Probar conexión'}
          </button>
          {testResult?.ok    && <span className="flex items-center gap-1 text-xs text-emerald-600"><Check size={12} /> Conexión exitosa</span>}
          {testResult?.error && <span className="text-xs text-red-500">{testResult.error}</span>}
        </div>
      </div>

      <div className="rounded-xl bg-slate-50 border border-slate-100 p-4 text-[12px] text-slate-500 space-y-1">
        <p className="font-semibold text-slate-600">¿Dónde encuentro estas credenciales?</p>
        <p>1. Entra a tu proyecto en supabase.com</p>
        <p>2. Haz clic en <strong>Connect</strong> (arriba) o ve a <strong>Project Settings → API</strong></p>
        <p>3. Copia el <strong>Project URL</strong> y la clave <strong>anon public</strong></p>
      </div>
    </div>
  )
}
