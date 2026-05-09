import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Building2, Upload, X, CheckCircle2, Loader2, ImageOff,
  Users, UserCheck, KeyRound, LayoutGrid, Plus, Edit2, Power,
  Eye, EyeOff, AlertCircle, FileText, Wifi, WifiOff, ExternalLink,
  Check, Coffee, Lock, ChevronUp, ChevronDown, Trash2, CreditCard,
  CloudUpload, ToggleLeft, Scissors, Copy, QrCode, Download,
  Briefcase, Link2, Unlink,
} from 'lucide-react'
import QRCode from 'qrcode'
import ManagerCardModal from '../components/ManagerCardModal'
import { useLang } from '../i18n'
import { useAPI, usePrinterAPI } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import { useBusinessType } from '../hooks/useBusinessType.jsx'
import { ECF_TYPES, BUSINESS_TYPES, testDGIIConnection, DGII_CONFIGURED } from '@terminal-x/services/ecf'
import { testConnection } from '@terminal-x/services/supabase'
import { WhatsAppSettings } from './Sistema'
// Reports moved to dedicated Reportes screen
// RemoteDashboard moved to its own sidebar tab

// ── Collapsible Section (for Mi Empresa sub-panels) ──────────────────────────
function CollapsibleSection({ title, icon: Icon, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors">
        <div className="flex items-center gap-2">
          {Icon && <Icon size={14} className="text-slate-400 dark:text-white/40" />}
          <span className="text-[13px] font-bold text-slate-700 dark:text-white">{title}</span>
        </div>
        {open ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
      </button>
      {open && <div className="px-4 py-4 border-t border-slate-200 dark:border-white/10">{children}</div>}
    </div>
  )
}

// ── Shared UI helpers ─────────────────────────────────────────────────────────

function Label({ children }) {
  return <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">{children}</p>
}

function Input({ className = '', ...props }) {
  return (
    <input
      {...props}
      className={`w-full px-2.5 py-1.5 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] text-slate-700 dark:text-white bg-white dark:bg-white/5
        focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/20 placeholder:text-slate-300 dark:placeholder:text-white/30 ${className}`}
    />
  )
}

function Select({ className = '', children, ...props }) {
  return (
    <select
      {...props}
      className={`w-full px-2.5 py-1.5 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] text-slate-700 dark:text-white bg-white dark:bg-white/5
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
      active ? 'bg-green-50 dark:bg-emerald-500/10 text-green-700 dark:text-emerald-400' : 'bg-slate-100 dark:bg-white/10 text-slate-400 dark:text-white/40'
    }`}>
      {active ? `● ${L('Activo', 'Active')}` : `○ ${L('Inactivo', 'Inactive')}`}
    </span>
  )
}

function Toast({ toast }) {
  if (!toast) return null
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-xl text-[13px] font-semibold ${
      toast.type === 'error' ? 'bg-red-500 text-white' : 'bg-slate-800 dark:bg-white/10 text-white'
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
    <div className="fixed inset-0 z-40 bg-white dark:bg-black md:relative md:inset-auto md:z-auto md:w-72 shrink-0 md:border md:border-slate-200 md:dark:border-white/10 md:rounded-xl p-5 md:bg-white md:dark:bg-white/5 md:self-start overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-[13px] font-bold text-slate-800 dark:text-white">{title}</h4>
        <button onClick={onClose} className="text-slate-300 dark:text-white/30 hover:text-slate-500 dark:hover:text-white/60"><X size={15} /></button>
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
      } ${enabled ? 'bg-sky-500' : 'bg-slate-200 dark:bg-white/10'}`}
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
        <p className="text-[13px] font-semibold text-slate-700 dark:text-white">{label}</p>
        {hint && <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function SettingSection({ title, children }) {
  return (
    <div className="mb-5">
      <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-2">{title}</p>
      <div className="border border-slate-200 dark:border-white/10 rounded-xl px-4 divide-y divide-slate-100 dark:divide-white/10">
        {children}
      </div>
    </div>
  )
}

// ── USUARIOS (simplified — pick employee + username + PIN) ───────────────────

const ROLES = [
  { value: 'owner',      label: 'Dueño',    color: 'bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400'             },
  { value: 'manager',    label: 'Gerente',  color: 'bg-orange-100 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400' },
  { value: 'cfo',        label: 'CFO',      color: 'bg-purple-100 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400' },
  { value: 'accountant', label: 'Contador', color: 'bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400'         },
  { value: 'cashier',    label: 'Cajero',   color: 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-white/60'          },
]

function RoleBadge({ role }) {
  const r = ROLES.find(r => r.value === role) || ROLES[4]
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${r.color}`}>{r.label}</span>
}

const EMPTY_USER = { employee_id: '', username: '', pin: '', oldPin: '' }

// Privilege hierarchy. A user can only edit/delete another user whose role
// is STRICTLY LOWER in this list than theirs. This prevents a manager from
// resetting the owner's PIN to lock the owner out and escalate.
const ROLE_LEVEL = { owner: 100, cfo: 70, accountant: 60, manager: 50, cashier: 10, none: 0 }
function canActOn(actorRole, targetRole) {
  const a = ROLE_LEVEL[actorRole] ?? 0
  const t = ROLE_LEVEL[targetRole] ?? 0
  return a > t
}

function Usuarios() {
  const api                       = useAPI()
  const { lang }                  = useLang()
  const { user }                  = useAuth()
  const canDelete                 = user?.role === 'owner' || user?.role === 'manager'
  const L                         = (es, en) => lang === 'es' ? es : en
  const [list,      setList]      = useState([])
  const [empleados, setEmpleados] = useState([])
  const [loading,   setLoading]   = useState(false)
  const [loadErr,   setLoadErr]   = useState('')
  const [panel,     setPanel]     = useState(null)
  const [form,      setForm]      = useState(EMPTY_USER)
  const [showPin,   setShowPin]   = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [saved,     setSaved]     = useState(false)
  const [error,     setError]     = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting,  setDeleting]  = useState(false)
  const [cardUser,  setCardUser]  = useState(null)   // v2.6: ManagerCardModal target
  const [bizName,   setBizName]   = useState('')
  const { toast, show }           = useToast()

  async function handleDelete() {
    if (!panel || panel === 'add') return
    setDeleting(true); setError('')
    try {
      const r = await api.users.delete?.({ id: panel.id })
      if (r?.softDeleted) show(L('Usuario desactivado (tiene historial)', 'User deactivated (has history)'))
      else                show(L('Usuario eliminado ✓', 'User deleted ✓'))
      setConfirmDelete(false); closePanel(); load()
    } catch (err) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(err, { severity: 'error', category: 'admin.settingrow' }) } catch {} setError(err.message || L('Error al eliminar.', 'Error deleting.')) }
    finally { setDeleting(false) }
  }

  async function handleRowDelete(u) {
    if (!canDelete || u.id === user?.id) return
    const ok = confirm(L(
      `¿Eliminar a ${u.name || u.username}?\n\nSe borra el usuario y se desvincula su historial (tickets, comisiones, cuadres). No se puede deshacer.`,
      `Delete ${u.name || u.username}?\n\nRemoves the user and unlinks history (tickets, commissions, cash counts). Cannot be undone.`
    ))
    if (!ok) return
    try {
      const r = await api.users.deleteHard?.({ id: u.id }) ?? await api.users.delete?.({ id: u.id })
      if (r?.deleted) show(L('Usuario eliminado ✓', 'User deleted ✓'))
      else            show(L('No se pudo eliminar.', 'Could not delete.'), 'error')
      load()
    } catch (err) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(err, { severity: 'error', category: 'admin.rolebadge' }) } catch {} show(err.message || L('Error al eliminar.', 'Error deleting.'), 'error') }
  }

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setLoadErr('')
    try {
      const [users, emps, emp] = await Promise.all([
        api?.users?.all?.() || [],
        api?.empleados?.all?.() || [],
        api?.admin?.getEmpresa?.().catch(() => null),
      ])
      setList(users)
      setEmpleados(emps)
      if (emp?.name) setBizName(emp.name)
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'admin.rolebadge' }) } catch {} setLoadErr(e.message || L('Error al cargar', 'Load error')) }
    finally { setLoading(false) }
  }

  async function revokeCard(u) {
    const ok = confirm(L(
      `¿Revocar la tarjeta de ${u.name}? La tarjeta física dejará de funcionar de inmediato.`,
      `Revoke ${u.name}'s card? The physical card will stop working immediately.`,
    ))
    if (!ok) return
    try {
      await api.staff.revokeAuthCard(u.id)
      show(L('Tarjeta revocada ✓', 'Card revoked ✓'))
      load()
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'admin.canacton' }) } catch {} show(e?.message || L('Error al revocar', 'Revoke error'), 'error') }
  }

  // Employees that don't already have a user account
  const availableEmpleados = empleados.filter(e =>
    !list.some(u => u.employee_id === e.id)
  )

  // Get employee for a user
  function getEmployee(u) {
    return empleados.find(e => e.id === u.employee_id)
  }

  function openAdd()   { setForm(EMPTY_USER); setShowPin(false); setError(''); setSaved(false); setConfirmDelete(false); setPanel('add') }
  function openEdit(u) {
    // Block editing users at the same or higher privilege level (e.g. manager
    // trying to edit owner). Prevents PIN-reset → lockout → takeover attacks.
    if (user?.id !== u.id && !canActOn(user?.role, u.role)) {
      show(L('No tienes permiso para editar este usuario.', "You don't have permission to edit this user."), 'error')
      return
    }
    setForm({ employee_id: u.employee_id || '', username: u.username, pin: '', oldPin: '' })
    setShowPin(false); setError(''); setSaved(false); setConfirmDelete(false); setPanel(u)
  }
  function closePanel(){ setPanel(null); setConfirmDelete(false) }
  function set(k, v)   { setForm(f => ({ ...f, [k]: v })) }

  async function handleSave() {
    if (panel === 'add' && !form.employee_id) { setError(L('Selecciona un empleado.', 'Select an employee.')); return }
    if (!form.username.trim()) { setError(L('El usuario es requerido.', 'Username is required.')); return }
    if (panel === 'add' && !form.pin.trim()) { setError(L('El PIN es requerido.', 'PIN is required.')); return }
    // Belt-and-suspenders privilege check — mirrors openEdit. Prevents a
    // manager from calling handleSave directly via DevTools to edit a
    // higher-role user after bypassing openEdit's guard.
    if (panel !== 'add' && user?.id !== panel.id && !canActOn(user?.role, panel.role)) {
      setError(L('No tienes permiso para editar este usuario.', "You don't have permission to edit this user."))
      return
    }
    setSaving(true); setError('')
    try {
      // Compare as string — empleado ids are UUIDs on web and integers on
      // desktop. Number(uuid) → NaN, which wiped the employee name on save.
      const empId = form.employee_id
      const emp = empleados.find(e => String(e.id) === String(empId)) || (panel !== 'add' ? empleados.find(e => String(e.id) === String(panel.employee_id)) : null)
      // staff.role CHECK allows only {owner,manager,cfo,accountant,cashier}.
      // empleados.role can legitimately be 'none' — filter it out so we don't
      // push 'none' into staff and trip the CHECK constraint.
      const STAFF_ROLES = new Set(['owner', 'manager', 'cfo', 'accountant', 'cashier'])
      const pick = (v) => (STAFF_ROLES.has(v) ? v : null)
      const resolvedRole = pick(emp?.role) || pick(panel?.role) || 'cashier'

      // Self-PIN change (S-H6 guard in main process): when the actor is
      // editing THEIR OWN row AND rotating the PIN, the IPC layer injects
      // actorId and userUpdate requires data.oldPin to verify the current
      // PIN server-side. UI must collect it here.
      const isSelfPinChange = panel !== 'add' && !!form.pin.trim() && user?.id === panel.id
      if (isSelfPinChange && !form.oldPin.trim()) {
        setError(L('Ingresa tu PIN actual para cambiarlo.', 'Enter your current PIN to change it.'))
        setSaving(false); return
      }

      const payload = {
        name:        emp?.nombre || panel?.name || '',
        username:    form.username.trim().toLowerCase(),
        employee_id: empId,
        role:        resolvedRole,
        ...(form.pin.trim() && { pin: form.pin.trim() }),
        ...(isSelfPinChange && { oldPin: form.oldPin.trim() }),
      }
      if (panel === 'add') await api.users.create({ ...payload, pin: form.pin.trim() })
      else                 await api.users.update({ id: panel.id, ...payload })
      setSaved(true)
      show(panel === 'add' ? L('Usuario creado ✓', 'User created ✓') : L('Usuario actualizado ✓', 'User updated ✓'))
      setTimeout(() => { closePanel(); load() }, 1000)
    } catch (err) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(err, { severity: 'error', category: 'admin.getemployee' }) } catch {} setError(err.message || L('Error al guardar.', 'Error saving.')) }
    finally { setSaving(false) }
  }

  async function toggleActive(u) {
    try {
      await api.users.update({ id: u.id, active: u.active ? 0 : 1 })
      show(u.active ? L('Usuario desactivado', 'User deactivated') : L('Usuario activado', 'User activated'))
      load()
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'admin.closepanel' }) } catch {} show(L('Error al cambiar estado', 'Error toggling status'), 'error') }
  }

  return (
    <div className="flex flex-col md:flex-row gap-4 md:gap-6">
      <Toast toast={toast} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[12px] text-slate-400 dark:text-white/40">{list.length} {L('usuarios', 'users')}</p>
            <p className="text-[10px] text-slate-400 dark:text-white/40 mt-0.5">{L('Crea empleados primero en la pantalla Empleados, luego asigna acceso aqui.', 'Create employees first in the Employees screen, then assign access here.')}</p>
          </div>
          <button onClick={openAdd} disabled={availableEmpleados.length === 0} className="flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] md:min-h-0 bg-[#0C447C] text-white text-[12px] font-bold rounded-lg hover:bg-[#0a3a6a] disabled:opacity-40 transition-colors">
            <Plus size={13} /> {L('Agregar Usuario', 'Add User')}
          </button>
        </div>
        <div className="border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
          <div className="hidden md:flex items-center px-4 py-2 bg-slate-50 dark:bg-white/5 border-b border-slate-100 dark:border-white/10 text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">
            <span className="flex-1">{L('Empleado / Usuario', 'Employee / Username')}</span>
            <span className="w-28 text-center">{L('Rol', 'Role')}</span>
            <span className="w-28 text-center">{L('Tarjeta', 'Card')}</span>
            <span className="w-24 text-center">{L('Estado', 'Status')}</span>
            <span className="w-28 text-right">{L('Accion', 'Action')}</span>
          </div>
          {loading
            ? <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-slate-300 dark:text-white/30" size={20} /></div>
            : loadErr
            ? <div className="py-8 text-center text-[12px] text-red-500 dark:text-red-400">{loadErr}</div>
            : list.length === 0
            ? <div className="py-10 text-center text-[12px] text-slate-400 dark:text-white/40">{L('No hay usuarios registrados.', 'No users registered.')}</div>
            : list.map(u => {
              const emp = getEmployee(u)
              return (
                <div key={u.id} className="md:flex md:items-center px-4 py-3 border-b border-slate-100 dark:border-white/10 last:border-0 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors">
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-white/60 flex items-center justify-center text-[11px] font-black shrink-0">
                      {u.name[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-slate-800 dark:text-white truncate">{u.name}</p>
                      <p className="text-[10px] text-slate-400 dark:text-white/40">@{u.username}</p>
                      <div className="flex items-center gap-2 mt-1 md:hidden">
                        <RoleBadge role={emp?.role || u.role} />
                        <ActiveBadge active={u.active} />
                      </div>
                    </div>
                    <div className="flex items-center gap-1 md:hidden">
                      {(() => {
                        const role = emp?.role || u.role
                        const eligible = role === 'owner' || role === 'manager'
                        const callerIsOwner = user?.role === 'owner'
                        return (eligible && callerIsOwner) ? (
                          <button onClick={() => setCardUser({ ...u, role })}
                            title={L('Tarjeta', 'Card')}
                            className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-400 dark:text-white/40 hover:text-[#b3001e] hover:bg-[#b3001e]/10 transition-colors">
                            <CreditCard size={15} />
                          </button>
                        ) : null
                      })()}
                      <button onClick={() => openEdit(u)} className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-400 dark:text-white/40 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-500/10 transition-colors"><Edit2 size={15} /></button>
                      <button onClick={() => toggleActive(u)} className={`p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors ${u.active ? 'text-slate-400 dark:text-white/40 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10' : 'text-slate-300 dark:text-white/30 hover:text-green-600 dark:hover:text-emerald-400 hover:bg-green-50 dark:hover:bg-emerald-500/10'}`}><Power size={15} /></button>
                      {canDelete && u.id !== user?.id && (
                        <button onClick={() => handleRowDelete(u)} title={L('Eliminar', 'Delete')} className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-400 dark:text-white/40 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"><Trash2 size={15} /></button>
                      )}
                    </div>
                  </div>
                  <span className="hidden md:flex w-28 justify-center"><RoleBadge role={emp?.role || u.role} /></span>
                  <span className="hidden md:flex w-28 justify-center">
                    {(() => {
                      const role = emp?.role || u.role
                      const eligible = role === 'owner' || role === 'manager'
                      if (!eligible) return <span className="text-[10px] text-slate-300 dark:text-white/20">—</span>
                      const has = !!(u.has_auth_card || u.manager_auth_rotated_at)
                      return has
                        ? <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#b3001e]"><CreditCard size={11} /> {L('Activa', 'Active')}</span>
                        : <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 dark:text-white/40"><CreditCard size={11} /> {L('Sin tarjeta', 'None')}</span>
                    })()}
                  </span>
                  <span className="hidden md:flex w-24 justify-center"><ActiveBadge active={u.active} /></span>
                  <div className="hidden md:flex w-28 items-center justify-end gap-1">
                    {(() => {
                      const role = emp?.role || u.role
                      const eligible = role === 'owner' || role === 'manager'
                      // Only the OWNER can manage authorization cards. Managers
                      // can HOLD a card (eligible targets include them) but
                      // cannot mint or revoke one — otherwise they could
                      // bootstrap their own override capability.
                      const callerIsOwner = user?.role === 'owner'
                      return (eligible && callerIsOwner) ? (
                        <button onClick={() => setCardUser({ ...u, role })}
                          title={L('Gestionar tarjeta de autorización', 'Manage authorization card')}
                          className="p-1.5 rounded-lg text-slate-400 dark:text-white/40 hover:text-[#b3001e] hover:bg-[#b3001e]/10 transition-colors">
                          <CreditCard size={13} />
                        </button>
                      ) : null
                    })()}
                    <button onClick={() => openEdit(u)} className="p-1.5 rounded-lg text-slate-400 dark:text-white/40 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-500/10 transition-colors"><Edit2 size={13} /></button>
                    <button onClick={() => toggleActive(u)} className={`p-1.5 rounded-lg transition-colors ${u.active ? 'text-slate-400 dark:text-white/40 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10' : 'text-slate-300 dark:text-white/30 hover:text-green-600 dark:hover:text-emerald-400 hover:bg-green-50 dark:hover:bg-emerald-500/10'}`}><Power size={13} /></button>
                    {canDelete && u.id !== user?.id && (
                      <button onClick={() => handleRowDelete(u)} title={L('Eliminar', 'Delete')} className="p-1.5 rounded-lg text-slate-400 dark:text-white/40 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"><Trash2 size={13} /></button>
                    )}
                  </div>
                </div>
              )
            })
          }
        </div>
      </div>

      {panel && (
        <Panel title={panel === 'add' ? L('Nuevo Usuario', 'New User') : L('Editar Usuario', 'Edit User')} onClose={closePanel}>
          <div className="space-y-3">
            {panel === 'add' ? (
              <div>
                <Label>{L('Empleado *', 'Employee *')}</Label>
                <Select value={form.employee_id} onChange={e => set('employee_id', e.target.value)}>
                  <option value="">{L('Seleccionar empleado…', 'Select employee…')}</option>
                  {availableEmpleados.map(e => (
                    <option key={e.id} value={e.id}>{e.nombre} — {e.tipo}{e.role && e.role !== 'none' ? ` (${e.role})` : ''}</option>
                  ))}
                </Select>
              </div>
            ) : (
              <div className="bg-slate-50 dark:bg-white/5 rounded-lg px-3 py-2">
                <p className="text-[11px] text-slate-400 dark:text-white/40">{L('Empleado', 'Employee')}</p>
                <p className="text-[13px] font-semibold text-slate-700 dark:text-white">{panel.name}</p>
              </div>
            )}
            <div><Label>{L('Usuario *', 'Username *')}</Label><Input value={form.username} onChange={e => set('username', e.target.value)} placeholder="mlopez" /></div>
            {panel !== 'add' && user?.id === panel.id && form.pin.trim() && (
              <div>
                <Label>{L('PIN actual *', 'Current PIN *')}</Label>
                <Input
                  type="password"
                  value={form.oldPin ?? ''}
                  onChange={e => set('oldPin', e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder={L('PIN actual', 'Current PIN')}
                  maxLength={6}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  name="current-pin"
                />
                <p className="text-[10px] text-slate-400 dark:text-white/40 mt-1">{L('Requerido para cambiar tu propio PIN.', 'Required to change your own PIN.')}</p>
              </div>
            )}
            <div>
              <Label>{panel === 'add' ? 'PIN *' : L('PIN (vacio = sin cambio)', 'PIN (blank = no change)')}</Label>
              <div className="relative">
                <Input
                  type={showPin ? 'text' : 'password'}
                  value={form.pin ?? ''}
                  onChange={e => set('pin', e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder={L('4-6 digitos', '4-6 digits')}
                  maxLength={6}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  name="new-pin"
                />
                <button type="button" onClick={() => setShowPin(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 dark:text-white/30 hover:text-slate-500 dark:hover:text-white/60">
                  {showPin ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
            </div>
          </div>
          {error && <p className="mt-3 text-[11px] text-red-500 dark:text-red-400">{error}</p>}
          <div className="flex gap-2 mt-4">
            <SaveBtn saving={saving} saved={saved} onClick={handleSave} />
            <button onClick={closePanel} className="px-3 py-2 text-[12px] text-slate-500 dark:text-white/60 border border-slate-200 dark:border-white/10 rounded-lg hover:bg-slate-50 dark:hover:bg-white/10">{L('Cancelar', 'Cancel')}</button>
          </div>

          {panel !== 'add' && canDelete && panel.id !== user?.id && (
            <div className="mt-6 pt-4 border-t border-slate-200 dark:border-white/10">
              {!confirmDelete ? (
                <button onClick={() => setConfirmDelete(true)}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 text-[12px] font-semibold text-red-500 dark:text-red-400 border border-red-200 dark:border-red-500/30 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors">
                  <Trash2 size={13} /> {L('Eliminar usuario', 'Delete user')}
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-[11px] text-slate-600 dark:text-white/70 text-center">
                    {L('¿Eliminar permanentemente? Si tiene historial se desactivará en su lugar.', 'Delete permanently? If it has history it will be deactivated instead.')}
                  </p>
                  <div className="flex gap-2">
                    <button onClick={() => setConfirmDelete(false)} disabled={deleting}
                      className="flex-1 px-3 py-2 text-[12px] text-slate-500 dark:text-white/60 border border-slate-200 dark:border-white/10 rounded-lg hover:bg-slate-50 dark:hover:bg-white/10">
                      {L('Cancelar', 'Cancel')}
                    </button>
                    <button onClick={handleDelete} disabled={deleting}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-[12px] font-bold text-white bg-red-500 hover:bg-red-600 rounded-lg disabled:opacity-50">
                      {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      {L('Eliminar', 'Delete')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Panel>
      )}

      {cardUser && (
        <ManagerCardModal
          user={cardUser}
          businessName={bizName}
          onClose={() => { setCardUser(null); load() }}
          onRevoke={async () => { await revokeCard(cardUser); setCardUser(null) }}
        />
      )}
    </div>
  )
}

// ── SERVICIOS ─────────────────────────────────────────────────────────────────

const EMPTY_SERVICE = { name: '', name_en: '', category: '', price: '', cost: '', is_wash: '1', commission_washer: 1, commission_seller: 1, commission_cashier: 1 }

function Servicios() {
  const api                         = useAPI()
  const { lang }                    = useLang()
  const { user }                    = useAuth()
  const { businessType }            = useBusinessType()
  const canDelete                   = user?.role === 'owner' || user?.role === 'manager'
  const L                           = (es, en) => lang === 'es' ? es : en
  // Vertical-aware label for the "washer" commission slot.
  // Carwash: Lavadores. Restaurant: Meseros. Salon/Barberia: Estilistas. Mechanic: Técnicos.
  // For everything else (retail/dealership/etc) the slot has no natural worker — hide it.
  const washerSlot = (
    businessType === 'carwash'    ? { es: 'Lavadores',  en: 'Washers',     show: true } :
    businessType === 'restaurant' ? { es: 'Meseros',    en: 'Waiters',     show: true } :
    businessType === 'salon'      ? { es: 'Estilistas', en: 'Stylists',    show: true } :
    businessType === 'barberia'   ? { es: 'Barberos',   en: 'Barbers',     show: true } :
    businessType === 'mechanic'   ? { es: 'Técnicos',   en: 'Technicians', show: true } :
    businessType === 'service'    ? { es: 'Personal',   en: 'Staff',       show: true } :
    businessType === 'hybrid'     ? { es: 'Lavadores',  en: 'Washers',     show: true } :
    { es: 'Lavadores', en: 'Washers', show: false }
  )
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
  const [showInactive, setShowInactive] = useState(false)
  const [catOrder,   setCatOrder]   = useState({}) // { categoryName: orden }
  // v2.14.1: Electron blocks window.prompt() — use a small inline modal instead.
  const [promptModal, setPromptModal] = useState(null) // { title, initial, onSave }
  const { toast, show }             = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setLoadErr('')
    try {
      setList((await api?.services?.allAdmin?.()) || [])
      const cats = (await api?.categorias?.all?.()) || []
      const order = {}
      cats.forEach(c => { order[c.nombre] = c.orden ?? 999 })
      setCatOrder(order)
    }
    catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'admin.servicios' }) } catch {} setLoadErr(e.message || L('Error al cargar', 'Load error')) }
    finally { setLoading(false) }
  }

  const categories = [...new Set(list.map(s => s.category))].sort((a, b) => (catOrder[a] ?? 999) - (catOrder[b] ?? 999))

  async function moveCat(cat, dir) {
    const idx = categories.indexOf(cat)
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= categories.length) return
    const other = categories[swapIdx]
    const catOrderA = catOrder[cat] ?? idx
    const catOrderB = catOrder[other] ?? swapIdx
    // Swap orders
    try {
      const cats = (await api?.categorias?.all?.()) || []
      const catA = cats.find(c => c.nombre === cat)
      const catB = cats.find(c => c.nombre === other)
      if (catA) await api.categorias.update({ id: catA.id, orden: catOrderB })
      else await api.categorias.create({ nombre: cat, orden: catOrderB })
      if (catB) await api.categorias.update({ id: catB.id, orden: catOrderA })
      else await api.categorias.create({ nombre: other, orden: catOrderA })
      setCatOrder(prev => ({ ...prev, [cat]: catOrderB, [other]: catOrderA }))
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'admin.servicios' }) } catch {} show(L('Error al reordenar', 'Error reordering'), 'error') }
  }

  function renameCat(oldName) {
    setPromptModal({
      title: L(`Nuevo nombre para "${oldName}"`, `New name for "${oldName}"`),
      initial: oldName,
      onSave: async (newName) => {
        newName = (newName || '').trim()
        if (!newName || newName === oldName) return
        if (categories.includes(newName)) { show(L('Ya existe esa categoría', 'Category already exists'), 'error'); return }
        try {
          const cats = (await api?.categorias?.all?.()) || []
          const catRec = cats.find(c => c.nombre === oldName)
          if (catRec) await api.categorias.update({ id: catRec.id, nombre: newName })
          else        await api.categorias.create({ nombre: newName, orden: catOrder[oldName] ?? 999 })
          const affected = list.filter(s => s.category === oldName)
          for (const s of affected) {
            await api.services.update({ id: s.id, category: newName })
          }
          show(L(`Categoría renombrada (${affected.length} servicios)`, `Category renamed (${affected.length} services)`))
          if (activeTab === oldName) setActiveTab(newName)
          load()
        } catch (e) {
          try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'admin.onsave' }) } catch {}
          show(e?.message || L('Error al renombrar', 'Rename error'), 'error')
        }
      },
    })
  }

  async function deleteCat(catName) {
    const count = list.filter(s => s.category === catName).length
    if (count > 0) {
      show(L(`"${catName}" tiene ${count} servicio(s). Mueva o elimine primero.`, `"${catName}" has ${count} service(s). Move or delete them first.`), 'error')
      return
    }
    // window.confirm is supported in Electron — keep it.
    const ok = window.confirm(L(`Eliminar la categoría "${catName}"?`, `Delete category "${catName}"?`))
    if (!ok) return
    try {
      const cats = (await api?.categorias?.all?.()) || []
      const catRec = cats.find(c => c.nombre === catName)
      if (catRec) await api.categorias.delete(catRec.id)
      show(L('Categoría eliminada ✓', 'Category deleted ✓'))
      if (activeTab === catName) setActiveTab('all')
      load()
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'admin.onsave' }) } catch {}
      show(e?.message || L('Error al eliminar', 'Delete error'), 'error')
    }
  }

  function openCreateCatPrompt() {
    setPromptModal({
      title: L('Nombre de la nueva categoría', 'Name of the new category'),
      initial: '',
      onSave: async (nombre) => {
        nombre = (nombre || '').trim()
        if (!nombre) return
        if (categories.includes(nombre)) { show(L('Ya existe esa categoría', 'Category already exists'), 'error'); return }
        try {
          await api.categorias.create({ nombre, orden: categories.length })
          show(L('Categoría creada ✓', 'Category created ✓'))
          setActiveTab(nombre)
          load()
        } catch (e) {
          try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'admin.onsave' }) } catch {} show(e?.message || L('Error', 'Error'), 'error') }
      },
    })
  }
  const filtered   = showInactive ? list : list.filter(s => s.active !== 0)
  const visible    = activeTab === 'all' ? filtered : filtered.filter(s => s.category === activeTab)
  const inactiveCount = list.filter(s => s.active === 0).length

  function openAdd()   { setForm({ ...EMPTY_SERVICE, category: categories[0] || '' }); setNewCatMode(false); setError(''); setSaved(false); setConfirmDelete(false); setPanel('add') }
  function openEdit(s) { setForm({ name: s.name, name_en: s.name_en||'', category: s.category, price: String(s.price), cost: s.cost ? String(s.cost) : '', is_wash: String(s.is_wash ?? 1), commission_washer: s.commission_washer ?? 1, commission_seller: s.commission_seller ?? 1, commission_cashier: s.commission_cashier ?? 1 }); setNewCatMode(false); setError(''); setSaved(false); setConfirmDelete(false); setPanel(s) }
  function closePanel(){ setPanel(null); setConfirmDelete(false) }
  function set(k, v)   { setForm(f => ({ ...f, [k]: v })) }

  async function handleSave() {
    if (!form.name.trim())     { setError(L('El nombre ES es requerido.', 'ES name is required.')); return }
    if (!form.category.trim()) { setError(L('La categoría es requerida.', 'Category is required.')); return }
    if (!form.price)           { setError(L('El precio es requerido.', 'Price is required.')); return }
    setSaving(true); setError('')
    try {
      const cw = form.commission_washer ? 1 : 0
      const cs = form.commission_seller ? 1 : 0
      const cc = form.commission_cashier ? 1 : 0
      const p = { name: form.name.trim(), name_en: form.name_en.trim()||null, category: form.category.trim(), price: parseFloat(form.price)||0, cost: parseFloat(form.cost)||0, is_wash: parseInt(form.is_wash, 10), commission_washer: cw, commission_seller: cs, commission_cashier: cc, no_commission: (!cw && !cs && !cc) ? 1 : 0, sort_order: panel !== 'add' ? panel.sort_order : list.length }
      if (panel === 'add') await api.services.create(p)
      else                 await api.services.update({ id: panel.id, ...p })
      setSaved(true)
      show(panel === 'add' ? L('Servicio agregado ✓', 'Service added ✓') : L('Servicio actualizado ✓', 'Service updated ✓'))
      setTimeout(() => { closePanel(); load() }, 1000)
    } catch (err) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(err, { severity: 'error', category: 'admin.onsave' }) } catch {} setError(err.message || L('Error al guardar.', 'Error saving.')) }
    finally { setSaving(false) }
  }

  async function toggleActive(s) {
    try {
      await api.services.update({ id: s.id, active: s.active ? 0 : 1 })
      show(s.active ? L('Desactivado — no aparece en POS', 'Deactivated — hidden from POS') : L('Activado en POS ✓', 'Activated in POS ✓'))
      load()
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'admin.onsave' }) } catch {} show(L('Error al cambiar estado', 'Error toggling status'), 'error') }
  }

  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!panel || panel === 'add') return
    setDeleting(true); setError('')
    try {
      const r = await api.services.delete?.({ id: panel.id })
      if (r?.softDeleted) {
        show(L('Servicio desactivado (tiene ventas históricas)', 'Service deactivated (has historical sales)'))
      } else {
        show(L('Servicio eliminado ✓', 'Service deleted ✓'))
      }
      setConfirmDelete(false)
      closePanel()
      load()
    } catch (err) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(err, { severity: 'error', category: 'admin.openadd' }) } catch {} setError(err.message || L('Error al eliminar.', 'Error deleting.')) }
    finally { setDeleting(false) }
  }

  // Quick-delete from list row — skips the edit panel so the user doesn't
  // have to scroll the form to find the "Eliminar servicio" button.
  async function quickDeleteService(s) {
    if (!s) return
    const ok = window.confirm(L(`Eliminar "${s.name}"?`, `Delete "${s.name}"?`))
    if (!ok) return
    try {
      const r = await api.services.delete?.({ id: s.id })
      if (r?.softDeleted) show(L('Servicio desactivado (tiene ventas históricas)', 'Service deactivated (has historical sales)'))
      else show(L('Servicio eliminado ✓', 'Service deleted ✓'))
      load()
    } catch (err) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(err, { severity: 'error', category: 'admin.openadd' }) } catch {} show(err.message || L('Error al eliminar.', 'Error deleting.'), 'error') }
  }

  function fmtRD(n) { return `RD$ ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0 })}` }

  return (
    <div className="flex flex-col md:flex-row gap-4 md:gap-6">
      <Toast toast={toast} />
      <div className="flex-1 min-w-0">
        {/* Category tabs row */}
        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-0 border-b border-slate-200 dark:border-white/10 mb-4">
          <div className="flex items-center gap-0 flex-wrap flex-1">
            <button onClick={() => setActiveTab('all')}
              className={`shrink-0 px-4 py-2.5 text-[12px] font-semibold border-b-2 -mb-px transition-colors ${
                activeTab === 'all' ? 'border-[#0C447C] text-[#0C447C]' : 'border-transparent text-slate-500 dark:text-white/60 hover:text-slate-700 dark:hover:text-white'
              }`}>
              {L('Todos', 'All')} ({filtered.length})
            </button>
            {categories.map((c, i) => (
              <div key={c} className="flex items-center">
                {activeTab === c && i > 0 && (
                  <button onClick={() => moveCat(c, -1)} className="p-0.5 text-slate-400 hover:text-[#0C447C] dark:text-white/40 dark:hover:text-blue-400" title={L('Mover izquierda', 'Move left')}>
                    <ChevronUp size={12} className="rotate-[-90deg]" />
                  </button>
                )}
                <button onClick={() => setActiveTab(c)}
                  className={`shrink-0 px-3 py-2.5 text-[12px] font-semibold border-b-2 -mb-px transition-colors ${
                    activeTab === c ? 'border-[#0C447C] text-[#0C447C]' : 'border-transparent text-slate-500 dark:text-white/60 hover:text-slate-700 dark:hover:text-white'
                  }`}>
                  {c} ({filtered.filter(s => s.category === c).length})
                </button>
                {activeTab === c && i < categories.length - 1 && (
                  <button onClick={() => moveCat(c, 1)} className="p-0.5 text-slate-400 hover:text-[#0C447C] dark:text-white/40 dark:hover:text-blue-400" title={L('Mover derecha', 'Move right')}>
                    <ChevronDown size={12} className="rotate-[-90deg]" />
                  </button>
                )}
                {activeTab === c && canDelete && (
                  <>
                    <button onClick={() => renameCat(c)} className="p-1 ml-0.5 text-slate-400 hover:text-sky-600 dark:text-white/40 dark:hover:text-sky-400" title={L('Renombrar categoría', 'Rename category')}>
                      <Edit2 size={11} />
                    </button>
                    <button onClick={() => deleteCat(c)} className="p-1 text-slate-400 hover:text-red-600 dark:text-white/40 dark:hover:text-red-400" title={L('Eliminar categoría', 'Delete category')}>
                      <Trash2 size={11} />
                    </button>
                  </>
                )}
              </div>
            ))}
            {canDelete && (
              <button type="button" onClick={openCreateCatPrompt} className="shrink-0 flex items-center gap-1 px-2 py-1 ml-1 text-[11px] text-slate-500 dark:text-white/60 hover:text-[#0C447C] dark:hover:text-blue-400 border border-dashed border-slate-300 dark:border-white/20 rounded-md" title={L('Nueva categoría', 'New category')}>
                <Plus size={10} /> {L('Categoría', 'Category')}
              </button>
            )}
          </div>
          {inactiveCount > 0 && (
            <button onClick={() => setShowInactive(v => !v)} className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 mb-2 min-h-[44px] md:min-h-0 text-[11px] font-semibold rounded-lg transition-colors md:ml-auto ${showInactive ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-500/40' : 'text-slate-500 dark:text-white/60 border border-slate-200 dark:border-white/10 hover:text-slate-800 dark:hover:text-white'}`}>
              {showInactive ? L(`Ocultar inactivos (${inactiveCount})`, `Hide inactive (${inactiveCount})`) : L(`Mostrar inactivos (${inactiveCount})`, `Show inactive (${inactiveCount})`)}
            </button>
          )}
          <button onClick={openAdd} className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 mb-2 min-h-[44px] md:min-h-0 bg-[#0C447C] text-white text-[12px] font-bold rounded-lg hover:bg-[#0a3a6a] transition-colors w-full md:w-auto justify-center md:justify-start ${inactiveCount > 0 ? 'md:ml-2' : 'md:ml-auto'}`}>
            <Plus size={13} /> {L('Agregar Servicio', 'Add Service')}
          </button>
        </div>

        <div className="border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
          <div className="hidden md:flex items-center px-4 py-2 bg-slate-50 dark:bg-white/5 border-b border-slate-100 dark:border-white/10 text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">
            <span className="flex-1">{L('Nombre ES', 'Name ES')}</span>
            <span className="w-36">{L('Nombre EN', 'Name EN')}</span>
            <span className="w-24 text-center">{L('Categoría', 'Category')}</span>
            <span className="w-24 text-right">{L('Precio', 'Price')}</span>
            <span className="w-20 text-center">{L('Estado', 'Status')}</span>
            <span className="w-24 text-right">{L('Acción', 'Action')}</span>
          </div>
          {loading
            ? <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-slate-300 dark:text-white/30" size={20} /></div>
            : loadErr
            ? <div className="py-8 text-center text-[12px] text-red-500 dark:text-red-400">{loadErr}</div>
            : visible.length === 0
            ? <div className="py-10 text-center text-[12px] text-slate-400 dark:text-white/40">{L('No hay servicios en esta categoría.', 'No services in this category.')}</div>
            : visible.map(s => (
              <div key={s.id} className={`md:flex md:items-center px-4 py-3 border-b border-slate-100 dark:border-white/10 last:border-0 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors ${!s.active ? 'opacity-50' : ''}`}>
                <div className="flex items-center justify-between md:contents">
                  <div className="flex-1 min-w-0 md:flex-1">
                    <span className="text-[13px] font-semibold text-slate-800 dark:text-white truncate block">{s.name}</span>
                    <div className="flex items-center gap-2 mt-1 md:hidden">
                      <span className="text-[10px] font-bold bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-white/60 px-2 py-0.5 rounded-full">{s.category}</span>
                      <span className="text-[12px] font-semibold text-slate-700 dark:text-white">{fmtRD(s.price)}</span>
                      <ActiveBadge active={s.active} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 md:hidden">
                    <button onClick={() => openEdit(s)} className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-400 dark:text-white/40 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-500/10 transition-colors"><Edit2 size={15} /></button>
                    <button onClick={() => quickDeleteService(s)} title={L('Eliminar', 'Delete')} className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-400 dark:text-white/40 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"><Trash2 size={15} /></button>
                    <button onClick={() => toggleActive(s)} title={s.active ? L('Desactivar', 'Deactivate') : L('Activar', 'Activate')} className={`p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors ${s.active ? 'text-slate-400 dark:text-white/40 hover:text-amber-500 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10' : 'text-slate-300 dark:text-white/30 hover:text-green-600 dark:hover:text-emerald-400 hover:bg-green-50 dark:hover:bg-emerald-500/10'}`}><Power size={15} /></button>
                  </div>
                </div>
                <span className="hidden md:inline w-36 text-[12px] text-slate-400 dark:text-white/40 truncate">{s.name_en || '—'}</span>
                <span className="hidden md:flex w-24 justify-center">
                  <span className="text-[10px] font-bold bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-white/60 px-2 py-0.5 rounded-full truncate max-w-[88px]">{s.category}</span>
                </span>
                <span className="hidden md:inline w-24 text-right text-[12px] font-semibold text-slate-700 dark:text-white">{fmtRD(s.price)}</span>
                <span className="hidden md:flex w-20 justify-center"><ActiveBadge active={s.active} /></span>
                <div className="hidden md:flex w-24 items-center justify-end gap-1">
                  <button onClick={() => openEdit(s)} title={L('Editar', 'Edit')} className="p-1.5 rounded-lg text-slate-400 dark:text-white/40 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-500/10 transition-colors"><Edit2 size={13} /></button>
                  <button onClick={() => quickDeleteService(s)} title={L('Eliminar', 'Delete')} className="p-1.5 rounded-lg text-slate-400 dark:text-white/40 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"><Trash2 size={13} /></button>
                  <button onClick={() => toggleActive(s)} title={s.active ? L('Desactivar', 'Deactivate') : L('Activar', 'Activate')} className={`p-1.5 rounded-lg transition-colors ${s.active ? 'text-slate-400 dark:text-white/40 hover:text-amber-500 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10' : 'text-slate-300 dark:text-white/30 hover:text-green-600 dark:hover:text-emerald-400 hover:bg-green-50 dark:hover:bg-emerald-500/10'}`}><Power size={13} /></button>
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
                <button type="button" onClick={() => setNewCatMode(v => !v)} className="text-[10px] text-sky-500 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300">
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
            <div><Label>{L('Precio RD$ *', 'Price RD$ *')}</Label><Input type="number" min="0" step="0.01" value={form.price} onChange={e => set('price', e.target.value)} placeholder="500" /></div>
            <div><Label>{L('Costo RD$', 'Cost RD$')}</Label><Input type="number" min="0" step="0.01" value={form.cost} onChange={e => set('cost', e.target.value)} placeholder="0" /></div>
            {/* Es producto toggle — controls is_wash */}
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
              <div className="flex-1 min-w-0 pr-3">
                <p className="text-[12px] font-medium text-slate-700 dark:text-white">{L('Es producto (bebida / snack)', 'Is a product (drink / snack)')}</p>
                <p className="text-[10px] text-slate-400 dark:text-white/40">{L('Productos siempre pagan a cajera aunque haya vendedor', 'Products always pay cashier even with a seller')}</p>
              </div>
              <button type="button" onClick={() => {
                const newVal = form.is_wash === '0' ? '1' : '0'
                // Auto-adjust toggles: product → only cashier on, service → all 3 on
                if (newVal === '0') set('commission_washer', 0)
                if (newVal === '0') set('commission_seller', 0)
                if (newVal === '1') { set('commission_washer', 1); set('commission_seller', 1) }
                set('is_wash', newVal)
              }}
                className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors cursor-pointer ${form.is_wash === '0' ? 'bg-[#b3001e]' : 'bg-slate-300 dark:bg-white/20'}`}>
                <span className={`pointer-events-none inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform ${form.is_wash === '0' ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
              </button>
            </div>

            <div className="pt-1">
              <Label>{L('Quién gana comisión', 'Who earns commission')}</Label>
              <p className="text-[10px] text-slate-400 dark:text-white/40 mb-2 -mt-0.5">{L('Apague los 3 para servicios sin comisión (ej: parqueo, ambientadores).', 'Turn all 3 off for no-commission items (e.g. parking, air fresheners).')}</p>
              <div className="space-y-1.5">
                {[
                  ...(washerSlot.show ? [{ key: 'commission_washer', es: washerSlot.es, en: washerSlot.en, hint: null }] : []),
                  { key: 'commission_seller',  es: 'Vendedores', en: 'Salespeople', hint: null },
                  { key: 'commission_cashier', es: 'Cajeras',    en: 'Cashiers', hint: form.is_wash !== '0' ? L('Solo cuando no hay vendedor en el ticket', 'Only when no seller is on the ticket') : L('Siempre (es un producto)', 'Always (it is a product)') },
                ].map(role => (
                  <div key={role.key} className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                    <div className="flex-1 min-w-0 pr-3">
                      <p className="text-[12px] font-medium text-slate-700 dark:text-white">{L(role.es, role.en)}</p>
                      {role.hint && <p className="text-[10px] text-slate-400 dark:text-white/40">{role.hint}</p>}
                    </div>
                    <button type="button" onClick={() => set(role.key, form[role.key] ? 0 : 1)}
                      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors cursor-pointer ${form[role.key] ? 'bg-[#b3001e]' : 'bg-slate-300 dark:bg-white/20'}`}>
                      <span className={`pointer-events-none inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform ${form[role.key] ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {form.price && form.cost && parseFloat(form.cost) > 0 && parseFloat(form.price) > 0 && (
            <p className="mt-2 text-[11px] text-slate-500 dark:text-white/60">
              {L('Margen:', 'Margin:')} <span className={parseFloat(form.price) > parseFloat(form.cost) ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'font-semibold text-red-500 dark:text-red-400'}>
                {fmtRD(parseFloat(form.price) - parseFloat(form.cost))} ({Math.round(((parseFloat(form.price) - parseFloat(form.cost)) / parseFloat(form.price)) * 100)}%)
              </span>
            </p>
          )}
          {error && <p className="mt-3 text-[11px] text-red-500 dark:text-red-400">{error}</p>}
          <div className="flex gap-2 mt-4">
            <SaveBtn saving={saving} saved={saved} onClick={handleSave} />
            <button onClick={closePanel} className="px-3 py-2 text-[12px] text-slate-500 dark:text-white/60 border border-slate-200 dark:border-white/10 rounded-lg hover:bg-slate-50 dark:hover:bg-white/10">{L('Cancelar', 'Cancel')}</button>
          </div>

          {/* Delete zone (edit mode only, owner/manager only) */}
          {panel !== 'add' && canDelete && (
            <div className="mt-6 pt-4 border-t border-slate-200 dark:border-white/10">
              {!confirmDelete ? (
                <button onClick={() => setConfirmDelete(true)}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 text-[12px] font-semibold text-red-500 dark:text-red-400 border border-red-200 dark:border-red-500/30 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors">
                  <Trash2 size={13} /> {L('Eliminar servicio', 'Delete service')}
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-[11px] text-slate-600 dark:text-white/70 text-center">
                    {L('¿Eliminar permanentemente? Las ventas históricas conservarán el nombre y precio.', 'Delete permanently? Historical sales will keep the original name and price.')}
                  </p>
                  <div className="flex gap-2">
                    <button onClick={() => setConfirmDelete(false)} disabled={deleting}
                      className="flex-1 px-3 py-2 text-[12px] text-slate-500 dark:text-white/60 border border-slate-200 dark:border-white/10 rounded-lg hover:bg-slate-50 dark:hover:bg-white/10">
                      {L('Cancelar', 'Cancel')}
                    </button>
                    <button onClick={handleDelete} disabled={deleting}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-[12px] font-bold text-white bg-red-500 hover:bg-red-600 rounded-lg disabled:opacity-50">
                      {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      {L('Eliminar', 'Delete')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Panel>
      )}

      {promptModal && (
        <PromptModal
          title={promptModal.title}
          initial={promptModal.initial}
          onSave={async (v) => {
            const cb = promptModal.onSave
            setPromptModal(null)
            try { await cb?.(v) } catch (_aetherErr) {
              try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'admin.handler' }) } catch {}}
          }}
          onClose={() => setPromptModal(null)}
          lang={lang}
        />
      )}
    </div>
  )
}

// ── Prompt modal (Electron blocks window.prompt → use this instead) ──────────
function PromptModal({ title, initial, onSave, onClose, lang }) {
  const L = (es, en) => lang === 'es' ? es : en
  const [val, setVal] = useState(initial || '')
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus(); ref.current?.select?.() }, [])
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-200 dark:border-white/10">
          <p className="text-sm font-bold text-slate-700 dark:text-white">{title}</p>
        </div>
        <div className="p-5">
          <input ref={ref} type="text" value={val} onChange={e => setVal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSave(val); if (e.key === 'Escape') onClose() }}
            className="w-full px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 text-sm text-slate-800 dark:text-white" />
        </div>
        <div className="px-5 py-3 border-t border-slate-200 dark:border-white/10 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-[12px] font-bold text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 rounded-lg">{L('Cancelar', 'Cancel')}</button>
          <button onClick={() => onSave(val)} className="px-4 py-1.5 text-[12px] font-bold text-white bg-[#0C447C] hover:bg-[#0a3a6a] rounded-lg">{L('Guardar', 'Save')}</button>
        </div>
      </div>
    </div>
  )
}

// ── Sequence card (shared by legacy B01/B02 and e-CF types) ──────────────────

function SeqCard({ code, nameEs, nameEn, descEs, descEn, noVencimiento,
                   seq, enabled, saving, saved, onToggle, onSave, onUpdate, lang, L }) {
  return (
    <div className={`border rounded-xl p-4 transition-colors ${
      enabled ? 'border-sky-200 bg-sky-50/30 dark:bg-sky-500/10 dark:border-sky-500/30' : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/5'
    }`}>
      <div className="flex items-start gap-3">
        <span className="shrink-0 inline-flex items-center justify-center h-6 px-2 rounded-md text-[11px] font-bold bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-white/60 font-mono mt-0.5">
          {code}
        </span>

        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-slate-700 dark:text-white leading-tight">
            {lang === 'es' ? nameEs : nameEn}
          </p>
          <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5 leading-snug">
            {lang === 'es' ? descEs : descEn}
          </p>

          {enabled && (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                  {L('Número actual', 'Current #')}
                </label>
                <input
                  type="number" min="0"
                  value={seq.current_number}
                  onChange={e => onUpdate(code, { current_number: e.target.value })}
                  className="w-24 px-2.5 py-1.5 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] text-slate-700 dark:text-white bg-white dark:bg-white/5 focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/20"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                  {L('Límite', 'Limit')}
                </label>
                <input
                  type="number" min="1"
                  value={seq.limit_number}
                  onChange={e => onUpdate(code, { limit_number: e.target.value })}
                  className="w-28 px-2.5 py-1.5 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] text-slate-700 dark:text-white bg-white dark:bg-white/5 focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/20"
                />
              </div>
              {!noVencimiento ? (
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1">
                    {L('Válido hasta', 'Valid until')}
                  </label>
                  <input
                    type="date"
                    value={seq.valid_until || ''}
                    onChange={e => onUpdate(code, { valid_until: e.target.value })}
                    className="px-2.5 py-1.5 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] text-slate-700 dark:text-white bg-white dark:bg-white/5 focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/20"
                  />
                </div>
              ) : (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium self-end pb-2">
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
  const [certPass,    setCertPass]    = useState('')
  const [certInstalling, setCertInstalling] = useState(false)
  const [certMsg,     setCertMsg]     = useState(null)
  const [certLegacyPass, setCertLegacyPass] = useState(false)  // v2.16.3 base64-passphrase migration banner

  useEffect(() => {
    const dgii = window.electronAPI?.dgii_ecf
    if (!dgii?.certInfo) return
    dgii.certInfo()
      .then(res => { if (res?.ok && res.data?.legacyPassphrase) setCertLegacyPass(true) })
      .catch(() => {})
  }, [certMsg])  // re-check after every install attempt

  const load = useCallback(async () => {
    try {
      const rows = await api?.ncf?.sequences?.()
      setSequences(rows || [])
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'admin.fiscalncf' }) } catch {} show(L('Error al cargar secuencias NCF', 'Error loading NCF sequences'), 'error') }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    api?.settings?.get?.()
      .then(s => { if (s?.fiscal_mode) setFiscalMode(s.fiscal_mode) })
      .catch(() => show(L('Error al cargar modo fiscal', 'Error loading fiscal mode'), 'error'))
      .finally(() => setModeLoaded(true))
  }, [])

  async function saveFiscalMode(mode) {
    setFiscalMode(mode)
    try {
      await api.settings.update({ fiscal_mode: mode })
      show(L('Modo de comprobantes actualizado ✓', 'Receipt mode updated ✓'))
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'admin.fiscalncf' }) } catch {}
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
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'admin.fiscalncf' }) } catch {}
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
      setSaved(s => ({ ...s, [type]: true }))
      show(L('Secuencia guardada ✓', 'Sequence saved ✓'))
      setTimeout(() => setSaved(s => ({ ...s, [type]: false })), 2500)
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'admin.fiscalncf' }) } catch {}
      show(L('Error al guardar', 'Error saving'), 'error')
    } finally {
      setSaving(s => ({ ...s, [type]: false }))
    }
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      await testDGIIConnection()
      setTestResult('ok')
      setTestMsg(L('Conectado a DGII ✓', 'Connected to DGII ✓'))
      show(L('Conectado a DGII ✓', 'Connected to DGII ✓'))
    } catch (err) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(err, { severity: 'error', category: 'admin.fiscalncf' }) } catch {}
      setTestResult('error')
      setTestMsg(err.message || L('Error de conexión', 'Connection error'))
      show(err.message || L('Error de conexión', 'Connection error'), 'error')
    } finally {
      setTesting(false)
    }
  }

  async function handleInstallCert() {
    const dgii = window.electronAPI?.dgii_ecf
    if (!dgii) return
    setCertInstalling(true); setCertMsg(null)
    try {
      const result = await dgii.installCert({ passphrase: certPass })
      if (result?.ok || result?.serialNumber) {
        setCertMsg({ type: 'ok', text: L(`Certificado instalado (SN: ${result.serialNumber?.slice(0, 12)}…)`, `Certificate installed (SN: ${result.serialNumber?.slice(0, 12)}…)`) })
        setCertPass('')
        show(L('Certificado instalado ✓', 'Certificate installed ✓'))
      } else {
        setCertMsg({ type: 'error', text: result?.error || L('Error al instalar certificado', 'Error installing certificate') })
      }
    } catch (err) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(err, { severity: 'error', category: 'admin.savefiscalmode' }) } catch {}
      const msg = err.message?.includes('isEncryptionAvailable') || err.message?.includes('safeStorage')
        ? L('Error de cifrado del sistema. Reinicie la aplicación e intente de nuevo.', 'System encryption error. Restart the app and try again.')
        : err.message?.includes('Cancelado') ? L('Operación cancelada', 'Cancelled') : (err.message || L('Error desconocido', 'Unknown error'))
      setCertMsg({ type: 'error', text: msg })
    } finally {
      setCertInstalling(false)
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
      <div className="border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
        <div className="bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10 px-4 py-2.5">
          <p className="text-[11px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider">
            {L('Sistema de Comprobantes Fiscales', 'Fiscal Receipt System')}
          </p>
          <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">
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
                ? 'border-sky-500 bg-sky-50 dark:bg-sky-500/10'
                : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20 bg-white dark:bg-white/5'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-[13px] font-black text-slate-700 dark:text-white">B01 / B02</span>
              {fiscalMode === 'legacy' && (
                <span className="text-[9px] font-bold bg-sky-500 text-white px-2 py-0.5 rounded-full">
                  {L('ACTIVO', 'ACTIVE')}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-white/60 leading-snug">
              {L('NCF Tradicional — papel o local', 'Traditional NCF — paper or local')}
            </p>
            <p className="text-[10px] text-slate-400 dark:text-white/40">
              {L('Sin conexión a DGII', 'No DGII connection required')}
            </p>
          </button>

          <button
            onClick={() => saveFiscalMode('ecf')}
            className={`flex flex-col gap-1.5 px-4 py-3.5 rounded-xl border-2 text-left transition-all ${
              fiscalMode === 'ecf'
                ? 'border-sky-500 bg-sky-50 dark:bg-sky-500/10'
                : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20 bg-white dark:bg-white/5'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-[13px] font-black text-slate-700 dark:text-white">e-CF</span>
              {fiscalMode === 'ecf' && (
                <span className="text-[9px] font-bold bg-sky-500 text-white px-2 py-0.5 rounded-full">
                  {L('ACTIVO', 'ACTIVE')}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-white/60 leading-snug">
              {L('Electrónico — E31/E32/etc.', 'Electronic — E31/E32/etc.')}
            </p>
            <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
              {L('Obligatorio desde mayo 2026', 'Mandatory from May 2026')}
            </p>
          </button>
        </div>
      </div>

      {/* ── e-CF connection status ─────────────────────────────────────────── */}
      <div className="border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
        <div className="bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10 px-4 py-2.5 flex items-center justify-between">
          <p className="text-[11px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider">
            {L('Configuración e-CF — DGII Directo', 'e-CF Configuration — DGII Direct')}
          </p>
          {DGII_CONFIGURED
            ? <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 px-2 py-0.5 rounded-full">
                <Wifi size={10} /> {L('Token configurado', 'Token configured')}
              </span>
            : <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 px-2 py-0.5 rounded-full">
                <WifiOff size={10} /> {L('Sin token — modo stub', 'No token — stub mode')}
              </span>
          }
        </div>
        <div className="px-4 py-4 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            {DGII_CONFIGURED ? (
              <p className="text-[12px] text-slate-600 dark:text-white/60">
                {L(
                  'Certificado DGII configurado. Los comprobantes se enviarán a la DGII en tiempo real.',
                  'DGII certificate configured. Receipts will be submitted to DGII in real time.'
                )}
              </p>
            ) : (
              <p className="text-[12px] text-slate-500 dark:text-white/60">
                {L(
                  'Sin certificado configurado — la app opera en modo stub. Los eNCF son simulados y no se envían a la DGII.',
                  'No certificate configured — app runs in stub mode. eNCFs are simulated and not sent to DGII.'
                )}
              </p>
            )}
            {testResult && (
              <div className={`mt-2 flex items-center gap-1.5 text-[12px] font-semibold ${
                testResult === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
              }`}>
                {testResult === 'ok' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                {testMsg}
              </div>
            )}
          </div>
          {DGII_CONFIGURED && (
            <button
              onClick={handleTest}
              disabled={testing}
              className="shrink-0 flex items-center gap-1.5 px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 disabled:opacity-50 transition-colors"
            >
              {testing
                ? <><Loader2 size={12} className="animate-spin" /> {L('Probando…', 'Testing…')}</>
                : <><Wifi size={12} /> {L('Probar conexión', 'Test connection')}</>
              }
            </button>
          )}
        </div>
        {/* ── Cert install ── */}
        {!!window.electronAPI?.dgii_ecf && (
          <div className="border-t border-slate-200 dark:border-white/10 px-4 py-4">
            <p className="text-[11px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider mb-3">
              {L('Instalar / Reinstalar Certificado .p12', 'Install / Reinstall Certificate .p12')}
            </p>
            {certLegacyPass && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-[12px] text-amber-700 dark:text-amber-300">
                {L(
                  'Re-ingresa la contraseña del certificado para migrar a almacenamiento cifrado del sistema.',
                  'Re-enter the certificate password to migrate to system-encrypted storage.'
                )}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input type="password" value={certPass} onChange={e => setCertPass(e.target.value)}
                placeholder={L('Contraseña del .p12', '.p12 password')}
                className="flex-1 max-w-[220px] px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-sm bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <button onClick={handleInstallCert} disabled={certInstalling || !certPass}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition">
                <Upload size={14} />
                {certInstalling ? L('Instalando…', 'Installing…') : L('Seleccionar .p12', 'Select .p12')}
              </button>
            </div>
            {certMsg?.type === 'ok' && <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mt-2"><Check size={11} />{certMsg.text}</p>}
            {certMsg?.type === 'error' && <p className="text-xs text-red-500 dark:text-red-400 mt-2">{certMsg.text}</p>}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-[13px] font-bold text-slate-700 dark:text-white mb-1">
          {L('Secuencias NCF / e-CF', 'NCF / e-CF Sequences')}
        </h3>
        <p className="text-[11px] text-slate-400 dark:text-white/40">
          {L(
            'Configura los rangos de comprobantes asignados por la DGII. El número actual se incrementa en cada cobro.',
            'Configure the NCF ranges assigned by DGII. The current number increments with each payment.'
          )}
        </p>
      </div>

      {/* ── B01 / B02 legacy sequences ─────────────────────────────────────── */}
      <div>
        <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-2 flex items-center gap-2">
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
        <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-2 flex items-center gap-2">
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

// ── Salon-specific settings (deposit, no-show fee, public booking URL) ───────
// Cloud-synced via api.settings.update(). Keys are whitelisted in
// `packages/services/settingsWhitelist.js` under BUSINESS_SETTING_KEYS so the
// values land in `app_settings` and propagate across devices.
export function SalonSettings() {
  const api          = useAPI()
  const { lang }     = useLang()
  const L            = (es, en) => lang === 'es' ? es : en
  const { toast, show } = useToast()

  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [requireDeposit,   setRequireDeposit]   = useState(false)
  const [depositAmount,    setDepositAmount]    = useState('300')
  const [noShowFee,        setNoShowFee]        = useState('500')
  const [bookingEnabled,   setBookingEnabled]   = useState(false)
  const [slug,             setSlug]             = useState('')
  const [slugDirty,        setSlugDirty]        = useState(false)

  useEffect(() => {
    let mounted = true
    api?.settings?.get?.().then(s => {
      if (!mounted) return
      setRequireDeposit(s.salon_require_deposit === 'true')
      setDepositAmount(s.salon_deposit_amount_dop || '300')
      setNoShowFee(s.salon_no_show_fee_dop || '500')
      setBookingEnabled(s.salon_public_booking_enabled === 'true')
      setSlug(s.salon_public_booking_slug || '')
      setLoaded(true)
    }).catch(() => setLoaded(true))
    return () => { mounted = false }
  }, [api])

  function slugify(v) {
    return String(v || '')
      .toLowerCase()
      .normalize('NFD').replace(/\p{Diacritic}/gu, '') // strip diacritics
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64)
  }

  async function save() {
    setSaving(true)
    try {
      const cleanSlug = slugify(slug)
      await api.settings.update({
        salon_require_deposit:        requireDeposit ? 'true' : 'false',
        salon_deposit_amount_dop:     String(Number(depositAmount) || 0),
        salon_no_show_fee_dop:        String(Number(noShowFee) || 0),
        salon_public_booking_enabled: bookingEnabled ? 'true' : 'false',
        salon_public_booking_slug:    cleanSlug,
      })
      setSlug(cleanSlug)
      setSlugDirty(false)
      show(L('Configuración guardada ✓', 'Settings saved ✓'))
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'admin.salonsettings' }) } catch {}
      show(e?.message || L('Error al guardar', 'Save error'), 'error')
    } finally { setSaving(false) }
  }

  const previewUrl = slug ? `https://terminalxpos.com/agendar/${slugify(slug)}` : ''
  const qrShown    = !!previewUrl && bookingEnabled
  const [qrDataUrl, setQrDataUrl] = useState('')
  useEffect(() => {
    let cancelled = false
    if (!qrShown) { setQrDataUrl(''); return }
    QRCode.toDataURL(previewUrl, { width: 480, margin: 2, color: { dark: '#000000', light: '#FFFFFF' } })
      .then(url => { if (!cancelled) setQrDataUrl(url) })
      .catch(() => { if (!cancelled) setQrDataUrl('') })
    return () => { cancelled = true }
  }, [previewUrl, qrShown])

  function downloadQr() {
    if (!qrDataUrl) return
    const a = document.createElement('a')
    a.href = qrDataUrl
    a.download = `agendar-${slugify(slug) || 'qr'}.png`
    document.body.appendChild(a); a.click(); a.remove()
  }

  function copyUrl() {
    if (!previewUrl) return
    try {
      navigator.clipboard.writeText(previewUrl)
      show(L('Copiado ✓', 'Copied ✓'))
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'admin.salonsettings' }) } catch {} show(L('No se pudo copiar', 'Could not copy'), 'error') }
  }

  if (!loaded) return <div className="py-6 flex justify-center"><Loader2 className="animate-spin text-slate-300 dark:text-white/30" size={18} /></div>

  return (
    <div className="space-y-5">
      <Toast toast={toast} />

      {/* Deposit + no-show */}
      <div className="space-y-3">
        <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">
          {L('Depósitos y no-shows', 'Deposits & No-shows')}
        </p>

        <div className="flex items-start justify-between gap-4 py-1">
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-slate-700 dark:text-white">
              {L('Requiere depósito', 'Require deposit')}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-white/50 mt-0.5">
              {L('Cobra un depósito al reservar para reducir no-shows.', 'Charge a deposit at booking to reduce no-shows.')}
            </p>
          </div>
          <button onClick={() => setRequireDeposit(v => !v)}
            aria-pressed={requireDeposit}
            className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              requireDeposit ? 'bg-[#b3001e]' : 'bg-slate-300 dark:bg-white/20'
            }`}>
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              requireDeposit ? 'translate-x-5' : 'translate-x-0.5'
            }`} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 dark:text-white/60 mb-1">
              {L('Monto del depósito (RD$)', 'Deposit amount (RD$)')}
            </label>
            <input type="number" min="0" step="50" value={depositAmount}
              onChange={e => setDepositAmount(e.target.value)}
              disabled={!requireDeposit}
              className="w-full px-3 py-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[13px] text-slate-700 dark:text-white focus:outline-none focus:border-[#b3001e] focus:ring-1 focus:ring-[#b3001e]/20 disabled:opacity-50" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 dark:text-white/60 mb-1">
              {L('Cargo por no presentación (RD$)', 'No-show fee (RD$)')}
            </label>
            <input type="number" min="0" step="50" value={noShowFee}
              onChange={e => setNoShowFee(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[13px] text-slate-700 dark:text-white focus:outline-none focus:border-[#b3001e] focus:ring-1 focus:ring-[#b3001e]/20" />
          </div>
        </div>
      </div>

      {/* Public booking */}
      <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-white/10">
        <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">
          {L('Reservas públicas', 'Public bookings')}
        </p>

        <div className="flex items-start justify-between gap-4 py-1">
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-slate-700 dark:text-white">
              {L('Habilitar enlace público', 'Enable public link')}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-white/50 mt-0.5">
              {L('Permite que clientes agenden desde la web sin login.', 'Lets clients book from the web without logging in.')}
            </p>
          </div>
          <button onClick={() => setBookingEnabled(v => !v)}
            aria-pressed={bookingEnabled}
            className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              bookingEnabled ? 'bg-[#b3001e]' : 'bg-slate-300 dark:bg-white/20'
            }`}>
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              bookingEnabled ? 'translate-x-5' : 'translate-x-0.5'
            }`} />
          </button>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-500 dark:text-white/60 mb-1">
            {L('URL slug', 'URL slug')}
          </label>
          <input type="text" value={slug}
            onChange={e => { setSlug(e.target.value); setSlugDirty(true) }}
            placeholder="barberia-maritza"
            className="w-full px-3 py-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[13px] text-slate-700 dark:text-white focus:outline-none focus:border-[#b3001e] focus:ring-1 focus:ring-[#b3001e]/20 font-mono" />
          {slugDirty && slug && (
            <p className="text-[10px] text-slate-400 dark:text-white/40 mt-1">
              {L('Se guardará como', 'Will save as')}: <span className="font-mono text-[#b3001e]">{slugify(slug)}</span>
            </p>
          )}
        </div>

        {previewUrl && (
          <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl">
            <span className="text-[11px] text-slate-500 dark:text-white/50 truncate flex-1 font-mono">{previewUrl}</span>
            <button onClick={copyUrl} title={L('Copiar', 'Copy')}
              className="p-1.5 rounded-lg hover:bg-[#b3001e]/10 text-slate-400 hover:text-[#b3001e] transition-colors shrink-0">
              <Copy size={13} />
            </button>
          </div>
        )}

        {qrShown && (
          <div className="flex items-center gap-4 p-4 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl">
            <div className="shrink-0 w-32 h-32 rounded-lg bg-white border border-slate-200 dark:border-white/10 flex items-center justify-center overflow-hidden">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="QR" className="w-full h-full object-contain" />
              ) : (
                <Loader2 size={18} className="animate-spin text-slate-300 dark:text-white/30" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-bold text-slate-700 dark:text-white flex items-center gap-1.5">
                <QrCode size={13} className="text-[#b3001e]" />
                {L('Código QR de reservas', 'Booking QR code')}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-white/50 mt-1">
                {L('Imprime y pega en la pared. Tus clientes escanean y reservan.',
                   'Print and pin on the wall. Clients scan and book.')}
              </p>
              <button onClick={downloadQr} disabled={!qrDataUrl}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#b3001e] hover:bg-[#8c0017] disabled:opacity-50 text-white text-[11px] font-bold rounded-lg transition-colors">
                <Download size={12} /> {L('Descargar PNG', 'Download PNG')}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="pt-2">
        <button onClick={save} disabled={saving}
          className="flex items-center gap-2 px-5 py-2 bg-[#b3001e] hover:bg-[#8c0017] disabled:opacity-50 text-white font-bold rounded-xl text-[12px] transition-colors">
          {saving ? <><Loader2 size={13} className="animate-spin" /> {L('Guardando…', 'Saving…')}</> : L('Guardar cambios', 'Save changes')}
        </button>
      </div>
    </div>
  )
}

function MiEmpresa() {
  const api                   = useAPI()
  const { lang }              = useLang()
  const L                     = (es, en) => lang === 'es' ? es : en
  const [form,    setForm]    = useState({ biz_name: '', biz_rnc: '', biz_address: '', biz_phone: '', biz_city: '', biz_email: '', biz_website: '', biz_type: '', mora_pct: '' })
  const [logo,    setLogo]    = useState('')
  const [loading, setLoading] = useState(false)
  const [loadErr, setLoadErr] = useState('')
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState('')
  const { toast, show }       = useToast()
  const { businessType }      = useBusinessType()
  const fileRef = useRef()

  useEffect(() => {
    setLoading(true)
    api?.admin?.getEmpresa?.()
      .then(row => {
        if (!row) return
        // Supabase jsonb arrives parsed; desktop (SQLite) gives a string.
        // Old code unconditionally JSON.parse'd → threw on object → catch
        // swallowed → extra={} → biz_city/biz_website/biz_type silently lost
        // on web reload. Fields with column fallbacks (address/phone/name)
        // masked the bug; biz_city has no column so the placeholder showed
        // up grey and Mike thought the save was broken.
        let extra = {}
        if (row.settings && typeof row.settings === 'object' && !Array.isArray(row.settings)) {
          extra = row.settings
        } else if (typeof row.settings === 'string') {
          try { extra = JSON.parse(row.settings || '{}') } catch (_aetherErr) {
            try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'admin.miempresa' }) } catch {}}
        }
        setForm({
          biz_name:    row.name    || '',
          biz_rnc:     row.rnc     || '',
          biz_address: extra.biz_address || extra.direccion || row.address || '',
          biz_phone:   row.phone   || '',
          biz_city:    extra.biz_city  || extra.ciudad || '',
          // v2.16.28 (B3+B4 follow-up) — load biz_email / biz_website on
          // mount. Save path was wired in earlier today but the read-back
          // never copied these into form state, so the inputs stayed
          // empty after reload. extra.biz_* (settings JSONB) takes
          // precedence over row.email (column) for parity with the
          // dual-write target order. biz_website has no column so it
          // only lives in settings JSONB / app_settings KV.
          biz_email:   extra.biz_email   || row.email || '',
          biz_website: extra.biz_website || '',
          biz_type:    extra.biz_type  || '',
          // C7 — mora_rate_daily is decimal in DB (0.005 = 0.5%/día); UI shows percent.
          mora_pct:    row.mora_rate_daily != null
                         ? String(Math.round(Number(row.mora_rate_daily) * 100 * 1000) / 1000)
                         : '',
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
    // C7 — Validate mora rate. Stored as decimal (0–0.05); UI is percent (0–5).
    let moraDecimal = null
    if (String(form.mora_pct).trim() !== '') {
      const pct = Number(form.mora_pct)
      if (!Number.isFinite(pct) || pct < 0 || pct > 5) {
        setError(L('La tasa de mora diaria debe estar entre 0% y 5%.', 'Daily mora rate must be 0–5%.')); return
      }
      moraDecimal = Math.round((pct / 100) * 10000) / 10000  // 4-decimal precision (matches NUMERIC(5,4))
    }
    setSaving(true); setError('')
    try {
      const current = await api?.admin?.getEmpresa?.()
      // v2.16.28 — Defensive parse. Older saves double-stringified the
      // jsonb (settings = JSON.stringify(JSON.stringify(obj))). When this
      // round-trips, parsing the outer string yields a plain string, and
      // a downstream `{ ...string, ...patch }` spread produced the
      // character-indexed key explosion ("0":"{","1":"\"",...) we saw on
      // Ranoza's settings. Guard: parse up to 3 times until we have a
      // real object; if the result is anything else (string, array, null,
      // number), fall back to {} rather than spreading garbage.
      let existing = current?.settings ?? {}
      for (let i = 0; i < 3 && typeof existing === 'string'; i++) {
        try { existing = JSON.parse(existing) } catch (_aetherErr) {
          try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'admin.set' }) } catch {} existing = {}; break }
      }
      if (!existing || typeof existing !== 'object' || Array.isArray(existing)) existing = {}
      // Also strip stale character-indexed keys ('0','1','2',…) from prior
      // damage so the row eventually heals on next save.
      for (const k of Object.keys(existing)) {
        if (/^\d+$/.test(k) && (existing[k]?.length ?? 0) <= 1) delete existing[k]
      }
      const city = form.biz_city.trim()
      const addr = form.biz_address.trim()
      const email = (form.biz_email || '').trim()
      const website = (form.biz_website || '').trim()
      // v2.16.28 (B3 + B4) — biz_website + biz_city + biz_email all lived
      // in the form but were silently dropped on save: handleSave never
      // copied them into payload, AND saveEmpresa's allowed-list didn't
      // accept biz_website. Owner edits were a no-op. Now include
      // everything in mergedSettings (jsonb) AND on the top-level
      // payload where a real businesses column exists (email is a real
      // column, biz_website / biz_city aren't — those go in jsonb).
      const mergedSettings = {
        ...existing,
        biz_city: city,
        ciudad: city,
        biz_address: addr,
        direccion: addr,
        biz_type: form.biz_type,
        biz_email: email,
        biz_website: website,
      }
      const payload = {
        name:     form.biz_name.trim(),
        rnc:      form.biz_rnc.trim(),
        address:  form.biz_address.trim(),
        phone:    form.biz_phone.trim(),
        email:    email || null,
        logo:     logo || null,
        settings: JSON.stringify(mergedSettings),
      }
      if (moraDecimal != null) payload.mora_rate_daily = moraDecimal
      await api.admin.saveEmpresa(payload)
      // v2.16.28 (B3) — Mirror canonical biz_* keys to app_settings KV so
      // receipts / e-CF / CobrarModal (which read from KV via bizSettings)
      // see the latest values immediately. Without this mirror, owner
      // edits to Mi Empresa landed in `businesses` but the receipt
      // builder kept printing whatever was in KV at first-run migration
      // time. Full reconciliation is queued for v2.17 (Option A); this is
      // the targeted fix that closes the user-visible drift now.
      try {
        await api?.settings?.update?.({
          biz_name:    form.biz_name.trim(),
          biz_rnc:     form.biz_rnc.trim(),
          biz_address: addr,
          biz_city:    city,
          biz_phone:   form.biz_phone.trim(),
          biz_email:   email,
          biz_website: website,
          biz_logo:    logo || '',
        })
      } catch (e) {
        try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'admin.for' }) } catch {} console.warn('[saveEmpresa] app_settings mirror failed:', e?.message) }
      // Clear the warning gate so the loans screen stops nagging.
      try { sessionStorage.removeItem('prestamos_mora_warned') } catch (_aetherErr) {
        try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'admin.for' }) } catch {}}
      show(L('Empresa guardada ✓', 'Business saved ✓'))
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(err, { severity: 'error', category: 'admin.for' }) } catch {}
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
    // v2.16.27 — already cloud-synced via BUSINESS_SETTING_KEYS, already
    // rendered on receipts/PDFs when present. The form just never asked.
    { k: 'biz_email',   label: L('Correo electrónico', 'Email'),              ph: 'contacto@minegocio.do',     type: 'email' },
    { k: 'biz_website', label: L('Sitio web', 'Website'),                     ph: 'https://minegocio.do',      type: 'url' },
  ]

  if (loading) return <div className="py-16 flex justify-center"><Loader2 className="animate-spin text-slate-300 dark:text-white/30" size={22} /></div>
  if (loadErr) return <div className="py-12 text-center text-[13px] text-red-500 dark:text-red-400">{loadErr}</div>

  return (
    <div className="max-w-xl space-y-6">
      <Toast toast={toast} />
      {/* Business type is now picked in Config → Tipo de Negocio (canonical enum).
          The legacy biz_type dropdown used to live here but drove the e-CF
          checklist defaults — that logic still reads from `form.biz_type` under
          the hood for backwards compatibility. Removed from UI on 2026-04-11. */}

      <div>
        <h3 className="text-[13px] font-bold text-slate-700 dark:text-white mb-1">{L('Información del Negocio', 'Business Information')}</h3>
        <p className="text-[11px] text-slate-400 dark:text-white/40">{L('Esta información aparece en los recibos impresos.', 'This information appears on printed receipts.')}</p>
      </div>

      <div>
        <label className="block text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-2">{L('Logo del Negocio', 'Business Logo')}</label>
        <div className="flex items-start gap-4">
          <div className="w-20 h-20 rounded-xl border-2 border-dashed border-slate-200 dark:border-white/10 flex items-center justify-center bg-slate-50 dark:bg-white/5 shrink-0 overflow-hidden">
            {logo ? <img src={logo} alt="Logo" className="w-full h-full object-contain p-1" /> : <ImageOff size={22} className="text-slate-300 dark:text-white/30" />}
          </div>
          <div className="flex-1 space-y-2">
            <button onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-white/10 rounded-xl text-[12px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors">
              <Upload size={13} /> {L('Subir imagen', 'Upload image')}
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoFile} />
            <p className="text-[10px] text-slate-400 dark:text-white/40">{L('PNG o JPG, máx. 500 KB.', 'PNG or JPG, max 500 KB.')}</p>
            {logo && (
              <button onClick={() => setLogo('')} className="flex items-center gap-1 text-[11px] text-red-400 dark:text-red-400 hover:text-red-500 dark:hover:text-red-300 transition-colors">
                <X size={11} /> {L('Eliminar logo', 'Remove logo')}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {fields.map(f => (
          <div key={f.k}>
            <label className="block text-[11px] font-semibold text-slate-500 dark:text-white/60 mb-1">{f.label}</label>
            <input type={f.type || 'text'} value={form[f.k] || ''} onChange={e => set(f.k, e.target.value)} placeholder={f.ph}
              className="w-full px-3 py-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[13px] text-slate-700 dark:text-white focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/20" />
          </div>
        ))}

        {/* C7 — Mora diaria default for prestamos contracts. Stored as decimal; UI is percent. */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 dark:text-white/60 mb-1">
            {L('Tasa de mora diaria (%) — Préstamos', 'Daily mora rate (%) — Loans')}
          </label>
          <input
            type="number" inputMode="decimal" min="0" max="5" step="0.01"
            value={form.mora_pct}
            onChange={e => set('mora_pct', e.target.value)}
            placeholder="0.50"
            className="w-full px-3 py-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[13px] text-slate-700 dark:text-white focus:outline-none focus:border-[#b3001e] focus:ring-1 focus:ring-[#b3001e]/30"
          />
          <p className="text-[10px] text-slate-400 dark:text-white/40 mt-1">
            {L('Aplica al saldo vencido. Recomendado 0.5%. Máximo 5% (anti-usura).',
               'Applied to overdue balance. Recommended 0.5%. Max 5% (anti-usury).')}
          </p>
        </div>
      </div>

      {error && <p className="text-[12px] text-red-500 dark:text-red-400 font-medium">{error}</p>}

      <button onClick={handleSave} disabled={saving}
        className="flex items-center gap-2 px-6 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white font-bold rounded-xl text-[13px] transition-colors">
        {saving ? <><Loader2 size={14} className="animate-spin" /> {L('Guardando…', 'Saving…')}</> :
         saved  ? <><CheckCircle2 size={14} /> {L('Guardado', 'Saved')}</> : L('Guardar cambios', 'Save changes')}
      </button>

      {(logo || form.biz_name) && (
        <div className="border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
          <div className="bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10 px-4 py-2">
            <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">{L('Vista previa del recibo', 'Receipt preview')}</p>
          </div>
          <div className="bg-white dark:bg-white/5 px-6 py-4 flex flex-col items-center gap-2 font-mono text-[12px] text-slate-700 dark:text-white">
            {logo ? <img src={logo} alt="logo" className="max-h-[60px] object-contain" />
                  : <p className="font-bold text-[14px] text-center">{form.biz_name}</p>}
            {(() => {
              // v2.16.10 — receipt preview dedup, mirrors printer.js:261.
              // Show street; skip city if it equals the street (case-insensitive)
              // or if the street already ends with the city as a suffix.
              const addr = String(form.biz_address || '').trim()
              const city = String(form.biz_city || '').trim()
              if (!addr && !city) return null
              const showCity = city && city.toLowerCase() !== addr.toLowerCase() &&
                !addr.toLowerCase().endsWith(city.toLowerCase())
              return (
                <>
                  {addr && <p className="text-center text-[11px]">{addr}</p>}
                  {showCity && <p className="text-center text-[11px]">{city}</p>}
                  {!addr && city && <p className="text-center text-[11px]">{city}</p>}
                </>
              )
            })()}
            {form.biz_phone   && <p className="text-center text-[11px]">Tel: {form.biz_phone}</p>}
            {form.biz_rnc     && <p className="text-center text-[11px]">RNC: {form.biz_rnc}</p>}
          </div>
        </div>
      )}

    </div>
  )
}

// ── Business Feature Toggles (per-business overrides for hasFeature flags) ───
// Surfaces the owner-controlled feature switches that gate parts of the UI
// (currently: Comisiones tab in Reportes). Reads + writes through
// useBusinessType().setFeatureOverride which persists to app_settings as
// `feature_<name>_enabled` and syncs to Supabase like every other setting.
export function BusinessFeatureToggles() {
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const { hasFeature, setFeatureOverride, businessType, isLicoreria } = useBusinessType()
  const [busy, setBusy] = useState(null)

  async function toggle(name) {
    setBusy(name)
    try { await setFeatureOverride(name, !hasFeature(name)) } finally { setBusy(null) }
  }

  // v2.16.10 — Per-business customizable toggles. Each row reads a feature
  // flag from useBusinessType().hasFeature() and writes back through
  // setFeatureOverride(). Defaults live in useBusinessType.jsx (commissions,
  // discounts → true; age_verification → true for licorería; receipt_itbis_per_line → false).
  const toggles = [
    {
      name: 'commissions',
      title: L('Comisiones de empleados', 'Employee commissions'),
      desc: L(
        'Si tu negocio paga comisiones a vendedores, lavadores o cajeros, deja esto encendido. Si no, apágalo y el tab de Comisiones se ocultará en Reportes.',
        'If your business pays commissions to salespeople, washers, or cashiers, keep this on. Otherwise turn it off and the Commissions tab will be hidden from Reports.',
      ),
    },
    {
      name: 'discounts',
      title: L('Descuentos al cobrar', 'Discounts at checkout'),
      desc: L(
        'Permite a la cajera aplicar descuentos en el modal de cobro. Apágalo si no quieres que se modifique el precio en la caja.',
        'Lets the cashier apply discounts in the payment modal. Turn off if you do not want price modifications at checkout.',
      ),
    },
    {
      name: 'receipt_itbis_per_line',
      title: L('ITBIS por producto en el recibo', 'Per-line ITBIS on receipt'),
      desc: L(
        'Imprime el ITBIS incluido en cada producto debajo del precio. El total del ticket no cambia — es solo informativo para el cliente.',
        'Prints the ITBIS amount included in each product below its price. Ticket total stays the same — informational for the customer.',
      ),
    },
  ]

  // Verificación de edad — relevant only for licorería (or businesses that
  // sell alcohol). Surfaced unconditionally so any owner can opt in/out.
  toggles.push({
    name: 'age_verification',
    title: L('Verificación de edad (licorería)', 'Age verification (liquor)'),
    desc: L(
      'Muestra el modal "Confirmar mayor de edad" cuando se agregan productos restringidos al ticket. Apágalo si tu local no requiere este aviso.',
      'Shows the age-confirmation modal when restricted items are added to a ticket. Turn off if your store does not need this warning.',
    ),
  })

  return (
    <div className="space-y-2">
      {toggles.map((t, i) => {
        const on = hasFeature(t.name)
        const isBusy = busy === t.name
        return (
          <div key={t.name} className={`flex items-start justify-between gap-4 py-3 ${i > 0 ? 'border-t border-slate-100 dark:border-white/5' : ''}`}>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-slate-700 dark:text-white">{t.title}</p>
              <p className="text-[11px] text-slate-500 dark:text-white/60 mt-0.5 leading-snug">{t.desc}</p>
              {i === 0 && (
                <p className="text-[10px] text-slate-400 dark:text-white/40 mt-1 uppercase tracking-wider">
                  {L('Tipo de negocio actual', 'Current business type')}: {businessType || '—'}
                </p>
              )}
            </div>
            <button
              onClick={() => toggle(t.name)}
              disabled={isBusy}
              aria-pressed={on}
              className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                on ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-white/20'
              } disabled:opacity-50`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  on ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ── MAIN ADMIN SCREEN ─────────────────────────────────────────────────────────

const TABS = [
  { id: 'empresa',    es: 'Mi Empresa',    en: 'Business',          icon: Building2  },
  { id: 'usuarios',   es: 'Usuarios',      en: 'Users',             icon: KeyRound   },
  { id: 'servicios',  es: 'Servicios',     en: 'Services',          icon: LayoutGrid },
  { id: 'contable',   es: 'Compartir con contador', en: 'Share with accountant', icon: Briefcase },
]

export default function Admin({ initialTab, hideHeader }) {
  const { lang, t } = useLang()
  const [tab, setTab] = useState(initialTab || 'empresa')

  // Sync with external tab override (from Config.jsx)
  useEffect(() => {
    if (initialTab && initialTab !== tab) setTab(initialTab)
  }, [initialTab])

  return (
    <div className="h-full flex flex-col bg-white dark:bg-black">
      {!hideHeader && (
        <>
          {/* Header */}
          <div className="shrink-0 px-3 md:px-6 py-3 md:py-4 border-b border-slate-200 dark:border-white/10">
            <h2 className="text-[14px] md:text-[16px] font-bold text-slate-800 dark:text-white">{t('nav_admin')}</h2>
            <p className="text-[11px] md:text-[12px] text-slate-400 dark:text-white/40 mt-0.5">{t('admin_desc')}</p>
          </div>

          {/* Tabs */}
          <div className="shrink-0 flex border-b border-slate-200 dark:border-white/10 px-2 md:px-6 overflow-x-auto scrollbar-none">
            {TABS.map(({ id, es, en, icon: Icon }) => (
              <button key={id} onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-3 md:px-4 py-3 text-xs md:text-[13px] font-semibold border-b-2 transition-colors shrink-0 whitespace-nowrap ${
                  tab === id ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 dark:text-white/60 hover:text-slate-700 dark:hover:text-white'
                }`}>
                <Icon size={14} />
                {lang === 'es' ? es : en}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 md:px-6 py-4 md:py-6">
        {tab === 'empresa'    && <MiEmpresa />}
        {tab === 'usuarios'   && <Usuarios />}
        {tab === 'servicios'  && <Servicios />}
        {tab === 'contable'   && <ShareWithAccountant />}
      </div>
    </div>
  )
}

// ── Respaldo / Cloud status (read-only) ──────────────────────────────────────
// As of v1.9.12 the Supabase URL + anon key are hardcoded in the installer.
// Clients never need to configure these — the old editable form was dropped
// and replaced with this read-only health check. If support ever gets a
// "my data isn't syncing" ticket, first ask the client to open this screen
// and tell you what the light is. Green = the main process can reach Supabase
// with the bundled key; red = there's a network or credential problem.
export function Respaldo() {
  const [status,  setStatus]  = useState('idle') // idle | testing | ok | error
  const [message, setMessage] = useState('')
  const [checkedAt, setCheckedAt] = useState(null)

  async function handleTest() {
    setStatus('testing'); setMessage('')
    try {
      const res = await testConnection()
      if (res?.ok) {
        setStatus('ok')
        setMessage('Conectado')
      } else {
        setStatus('error')
        setMessage(res?.error || 'No se pudo conectar')
      }
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'admin.admin' }) } catch {}
      setStatus('error')
      setMessage(e?.message || 'No se pudo conectar')
    }
    setCheckedAt(new Date())
  }

  // Auto-check once when the section opens so the user sees real state
  useEffect(() => { handleTest() }, [])

  const dotColor = {
    idle:    'bg-slate-300 dark:bg-white/20',
    testing: 'bg-sky-400 animate-pulse',
    ok:      'bg-emerald-500',
    error:   'bg-red-500',
  }[status]

  const label = {
    idle:    'Sin verificar',
    testing: 'Verificando…',
    ok:      'Conectado a la nube',
    error:   'Sin conexión',
  }[status]

  return (
    <div className="max-w-lg space-y-4">
      <div className="flex items-center gap-4 p-5 rounded-2xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10">
        <div className={`w-3 h-3 rounded-full shrink-0 ${dotColor}`} />
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-bold text-slate-800 dark:text-white">{label}</p>
          <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">
            {status === 'ok' && checkedAt && `Verificado a las ${checkedAt.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })}`}
            {status === 'error' && message}
            {status === 'testing' && 'Probando conexión con Supabase…'}
            {status === 'idle' && 'Haz clic en "Probar conexión" para verificar.'}
          </p>
        </div>
        <button
          onClick={handleTest}
          disabled={status === 'testing'}
          className="shrink-0 flex items-center gap-1.5 px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] font-semibold text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/10 disabled:opacity-40"
        >
          <Wifi size={13} />
          {status === 'testing' ? 'Probando…' : 'Probar conexión'}
        </button>
      </div>

      <div className="rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/10 p-4 text-[12px] text-slate-500 dark:text-white/60 space-y-1.5">
        <p className="text-slate-600 dark:text-white/80">
          La sincronización con la nube funciona automáticamente. Tus datos se respaldan
          en segundo plano cada 5 minutos y en cada venta.
        </p>
        <p className="text-slate-400 dark:text-white/40">
          Si ves la luz en rojo, verifica tu conexión a internet. Si persiste,
          contacta soporte por WhatsApp al <strong>+1 809 828 2971</strong>.
        </p>
      </div>
    </div>
  )
}

// ── Cloud Backup (nightly SQLite snapshot → Supabase Storage) ────────────────
// Owner-only. No-op on web (window.electronAPI absent → guard returns early).
export function CloudBackup() {
  const { user } = useAuth()
  const { lang } = useLang()
  const L = (es, en) => (lang === 'en' ? en : es)

  const isOwner = user?.role === 'owner'
  const hasAPI  = typeof window !== 'undefined' && !!window.electronAPI?.backup

  const [status, setStatus]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [flash, setFlash]     = useState(null)

  const refresh = useCallback(async () => {
    if (!hasAPI) return
    setLoading(true)
    try {
      const s = await window.electronAPI.backup.lastStatus()
      setStatus(s || null)
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'admin.respaldo' }) } catch {}
      setStatus({ last_error: e?.message || 'N/A' })
    } finally {
      setLoading(false)
    }
  }, [hasAPI])

  useEffect(() => { refresh() }, [refresh])

  async function handleRunNow() {
    if (!hasAPI || running) return
    setRunning(true); setFlash(null)
    try {
      const res = await window.electronAPI.backup.runNow()
      setFlash({ kind: 'ok', msg: L(`Respaldo subido (${formatBytes(res?.bytes || 0)})`,
                                    `Backup uploaded (${formatBytes(res?.bytes || 0)})`) })
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'admin.cloudbackup' }) } catch {}
      setFlash({ kind: 'err', msg: e?.message || L('Error', 'Error') })
    } finally {
      setRunning(false)
      refresh()
    }
  }

  if (!hasAPI) {
    return (
      <p className="text-[12px] text-slate-500 dark:text-white/60">
        {L('El respaldo en la nube solo está disponible en la app de escritorio.',
           'Cloud backup is only available in the desktop app.')}
      </p>
    )
  }

  const lastOk  = status?.last_ok_at ? new Date(status.last_ok_at) : null
  const lastErr = status?.last_error || null

  return (
    <div className="max-w-lg space-y-4">
      <div className="flex items-start gap-4 p-5 rounded-2xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10">
        <div className={`w-3 h-3 mt-1.5 rounded-full shrink-0 ${
          lastOk ? 'bg-emerald-500' : lastErr ? 'bg-red-500' : 'bg-slate-300 dark:bg-white/20'
        }`} />
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-bold text-slate-800 dark:text-white">
            {lastOk
              ? L('Último respaldo exitoso', 'Last successful backup')
              : L('Sin respaldos aún', 'No backups yet')}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-white/60 mt-0.5">
            {lastOk
              ? `${lastOk.toLocaleDateString('es-DO')} ${lastOk.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })}`
              : L('Ejecuta un respaldo manual para crear el primero.', 'Run a manual backup to create the first one.')}
          </p>
          {status?.last_bytes ? (
            <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">
              {formatBytes(status.last_bytes)} · {status.last_path}
            </p>
          ) : null}
          {lastErr ? (
            <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">
              {L('Último error:', 'Last error:')} {lastErr}
            </p>
          ) : null}
        </div>
        {isOwner ? (
          <button
            onClick={handleRunNow}
            disabled={running || loading}
            className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold bg-slate-900 text-white dark:bg-white dark:text-black hover:opacity-90 disabled:opacity-40"
          >
            <CloudUpload size={13} />
            {running
              ? L('Subiendo…', 'Uploading…')
              : L('Hacer respaldo ahora', 'Backup now')}
          </button>
        ) : null}
      </div>

      {flash ? (
        <div className={`rounded-lg px-3 py-2 text-[12px] font-semibold ${
          flash.kind === 'ok'
            ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/20'
            : 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-500/20'
        }`}>
          {flash.msg}
        </div>
      ) : null}

      <div className="rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/10 p-4 text-[12px] text-slate-500 dark:text-white/60 space-y-1.5">
        <p className="text-slate-600 dark:text-white/80">
          {L('Cada madrugada a las 3:00 AM subimos un respaldo cifrado de tu base de datos a la nube. Conservamos los últimos 14 días.',
             'Every night at 3:00 AM we upload an encrypted snapshot of your database to the cloud. We keep the last 14 days.')}
        </p>
        <p className="text-slate-400 dark:text-white/40">
          {L('Si tu PC falla, podemos restaurar tu negocio al estado de anoche.',
             'If your PC fails, we can restore your business to last night’s state.')}
        </p>
      </div>
    </div>
  )
}

// ── Share with accountant (Slice 5 — cross-firm wire) ──────────────────────
async function callCtbPanel(action, payload, method = 'POST') {
  const mod = await import('@terminal-x/services/supabase')
  const sb = mod.getSupabaseClient?.()
  const sess = (await sb?.auth?.getSession?.())?.data?.session
  const token = sess?.access_token
  if (!token) throw new Error('Sesión expirada — vuelve a iniciar sesión.')
  const isGet = method === 'GET'
  const qs = isGet
    ? '?' + new URLSearchParams({ action, ...(payload || {}) }).toString()
    : `?action=${encodeURIComponent(action)}`
  const res = await fetch('/api/panel' + qs, {
    method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: isGet ? undefined : JSON.stringify(payload || {}),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || j?.ok === false) throw new Error(j?.error || j?.message || `HTTP ${res.status}`)
  return j
}

function ShareWithAccountant() {
  const [grants, setGrants] = useState([])
  const [loading, setLoading] = useState(true)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const r = await callCtbPanel('ctb_my_accountant', null, 'GET')
      setGrants(r?.grants || [])
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'admin.callctbpanel' }) } catch {} setMsg({ kind: 'error', text: e?.message || String(e) }) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { reload() }, [reload])

  async function accept() {
    const c = code.trim().toUpperCase()
    if (c.length !== 8) return setMsg({ kind: 'error', text: 'El código debe tener 8 caracteres.' })
    setBusy(true); setMsg(null)
    try {
      const r = await callCtbPanel('ctb_accept_access_code', { code: c })
      setMsg({ kind: 'ok', text: `Conectado a ${r.firm_name || 'el contador'}.` })
      setCode('')
      await reload()
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'admin.callctbpanel' }) } catch {}
      const m = e?.message || ''
      const friendly = m.includes('expired') ? 'El código venció. Pide uno nuevo a tu contador.'
                    : m.includes('consumed') ? 'Ese código ya fue usado o no existe.'
                    : m.includes('already_granted') ? 'Este cliente ya está conectado a otro tenant.'
                    : m
      setMsg({ kind: 'error', text: friendly })
    } finally { setBusy(false) }
  }

  async function revoke(grant) {
    if (!confirm(`¿Revocar acceso de "${grant.firm_name || 'tu contador'}" a tus datos?`)) return
    setBusy(true); setMsg(null)
    try {
      await callCtbPanel('ctb_revoke_access', { accounting_client_id: grant.accounting_client_id })
      setMsg({ kind: 'ok', text: 'Acceso revocado.' })
      await reload()
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'admin.callctbpanel' }) } catch {} setMsg({ kind: 'error', text: e?.message || String(e) }) }
    finally { setBusy(false) }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5 text-slate-800 dark:text-white">
      <div>
        <h2 className="text-base font-bold inline-flex items-center gap-2"><Briefcase size={16} className="text-[#b3001e]"/> Compartir con tu contador</h2>
        <p className="text-xs text-slate-500 dark:text-white/60 mt-1">
          Si tu contador usa Terminal X, puede ver tus ventas, e-CFs e inventario sin exportar nada manualmente.
          Pídele un código de 8 caracteres y pégalo aquí. El acceso es <strong>solo lectura</strong> y puedes revocarlo cuando quieras.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 p-5">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-white/60 mb-2">Ingresar código</div>
        <div className="flex gap-2">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 8))}
            placeholder="XXXXXXXX" maxLength={8}
            className="flex-1 font-mono text-2xl tracking-widest text-center px-3 py-2 rounded-lg border border-slate-300 dark:border-white/15 bg-white dark:bg-black"/>
          <button onClick={accept} disabled={busy || code.length !== 8}
            className="px-4 py-2 rounded-lg bg-[#b3001e] text-white text-sm font-bold hover:bg-[#8f0018] disabled:opacity-50 inline-flex items-center gap-1">
            {busy ? <Loader2 size={14} className="animate-spin"/> : <Link2 size={14}/>} Conectar
          </button>
        </div>
        {msg && (
          <div className={`mt-3 text-xs px-3 py-2 rounded-lg ${msg.kind === 'ok'
              ? 'bg-[#b3001e]/10 text-[#b3001e] border border-[#b3001e]/30'
              : 'bg-black text-white border border-black dark:bg-white dark:text-black dark:border-white'}`}>
            {msg.text}
          </div>
        )}
      </div>

      <div>
        <div className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-white/60 mb-2">Conexiones activas</div>
        {loading && <div className="text-sm text-slate-500 dark:text-white/60 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin"/> Cargando…</div>}
        {!loading && !grants.length && (
          <div className="rounded-2xl border border-dashed border-slate-300 dark:border-white/15 p-6 text-center text-xs text-slate-500 dark:text-white/60">
            No hay contadores conectados.
          </div>
        )}
        {!loading && grants.map(g => (
          <div key={g.accounting_client_id} className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 p-4 flex items-center gap-3">
            <Briefcase size={18} className="text-[#b3001e]"/>
            <div className="flex-1 min-w-0">
              <div className="font-bold truncate">{g.firm_name || 'Bufete'}</div>
              <div className="text-[11px] text-slate-500 dark:text-white/60">
                Conectado {g.granted_at ? new Date(g.granted_at).toLocaleDateString('es-DO') : '—'}
              </div>
            </div>
            <button onClick={() => revoke(g)} disabled={busy}
              className="px-3 py-1.5 rounded-lg border border-black/15 dark:border-white/15 text-xs font-bold text-black/70 dark:text-white/70 hover:border-[#b3001e] hover:text-[#b3001e] inline-flex items-center gap-1 disabled:opacity-50">
              <Unlink size={12}/> Revocar
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function formatBytes(n) {
  if (!n || n < 1024) return `${n || 0} B`
  const units = ['KB', 'MB', 'GB']
  let v = n / 1024, i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(1)} ${units[i]}`
}
