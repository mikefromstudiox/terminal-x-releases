import { useState, useEffect } from 'react'
import {
  Building2, Users, Shield, Wrench, Percent, Target,
  UserCheck, Truck, CalendarCheck, WalletCards, ReceiptText,
  Wifi, Globe, HardDrive, GitBranch, BadgeDollarSign,
  Upload, ToggleLeft, ToggleRight, ChevronRight, Save, Plus,
  Pencil, Check, KeyRound, Printer, Server, X, Lock,
  Cloud, CloudUpload, RotateCcw, AlertTriangle, RefreshCw,
} from 'lucide-react'
import { useRNC } from '../hooks/useRNC'
import { useAuth } from '../context/AuthContext'
import { useAPI, usePrinterAPI } from '../context/DataContext'
import { useBackup } from '../context/BackupContext'
import { manualBackup, restoreFromBackup } from '../services/backup.js'
import { testConnection, setStoredSetting, getStoredSetting, resetSupabaseClient, ensureBusinessRegistered } from '../services/supabase.js'
import ExportToCloud from '../components/ExportToCloud'

// ── Sidebar nav structure ─────────────────────────────────────────────────────
const NAV = [
  {
    group: 'Configuración',
    items: [
      { key: 'empresa',    label: 'Mi Empresa',          icon: Building2    },
      { key: 'usuarios',   label: 'Usuarios y Roles',    icon: Users        },
      { key: 'permisos',   label: 'Permisos',            icon: Shield       },
      { key: 'servicios',  label: 'Servicios y Precios', icon: Wrench       },
      { key: 'descuentos', label: 'Descuentos',          icon: Percent      },
      { key: 'objetivos',  label: 'Objetivos de Ventas', icon: Target       },
    ],
  },
  {
    group: 'Empleados',
    items: [
      { key: 'empleados',  label: 'Maestro Empleados',   icon: UserCheck    },
      { key: 'lavadores',  label: 'Lavadores',           icon: UserCheck    },
      { key: 'vendedores', label: 'Vendedores',          icon: Users        },
      { key: 'asistencia', label: 'Asistencia',          icon: CalendarCheck},
      { key: 'avances',    label: 'Avances de Sueldo',   icon: WalletCards  },
    ],
  },
  {
    group: 'DGII / Fiscal',
    items: [
      { key: 'ncf',        label: 'Secuencias NCF',      icon: ReceiptText  },
      { key: 'fiscal',     label: 'Datos Fiscales',      icon: Building2    },
      { key: 'ecf',        label: 'Configuración e-CF',  icon: Wifi         },
    ],
  },
  {
    group: 'Suplidores',
    items: [
      { key: 'suplidores', label: 'Maestro Suplidores',  icon: Truck        },
      { key: 'compras',    label: 'Órdenes de Compra',   icon: GitBranch    },
      { key: 'cxp',        label: 'CxP',                 icon: BadgeDollarSign },
    ],
  },
  {
    group: 'Sistema',
    items: [
      { key: 'impresoras', label: 'Impresoras',          icon: Printer      },
      { key: 'idioma',     label: 'Idioma / Language',   icon: Globe        },
      { key: 'backup',     label: 'Respaldo / Backup',   icon: HardDrive    },
      { key: 'sucursales', label: 'Sucursales',          icon: GitBranch    },
      { key: 'tasas',      label: 'Tasas y Monedas',     icon: BadgeDollarSign },
    ],
  },
]

const INIT_USERS   = []
const INIT_WASHERS = []
const INIT_NCF     = []

// ── Permissions matrix ────────────────────────────────────────────────────────
const PERM_FUNCS = [
  'Nueva orden POS',
  'Ver reportes',
  'Cambiar precios',
  'DGII 606/607',
  'Anular facturas',
  'Cuentas x cobrar',
  'Cuadre de caja',
  'Panel administrativo',
]
const PERM_ROLES = ['owner', 'manager', 'cfo', 'accountant', 'cashier']
const PERM_LABELS = { owner: 'Owner', manager: 'Gerente', cfo: 'CFO', accountant: 'Contador', cashier: 'Cajero' }
const INIT_PERMS = {
  'Nueva orden POS':       { owner: true,  manager: true,  cfo: false, accountant: false, cashier: true  },
  'Ver reportes':          { owner: true,  manager: true,  cfo: true,  accountant: true,  cashier: false },
  'Cambiar precios':       { owner: true,  manager: true,  cfo: false, accountant: false, cashier: false },
  'DGII 606/607':          { owner: true,  manager: false, cfo: true,  accountant: true,  cashier: false },
  'Anular facturas':       { owner: true,  manager: true,  cfo: false, accountant: false, cashier: false },
  'Cuentas x cobrar':      { owner: true,  manager: true,  cfo: true,  accountant: true,  cashier: true  },
  'Cuadre de caja':        { owner: true,  manager: true,  cfo: true,  accountant: true,  cashier: true  },
  'Panel administrativo':  { owner: true,  manager: true,  cfo: false, accountant: false, cashier: false },
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const ROLE_BADGE = {
  owner:     'bg-slate-800 text-white',
  manager:   'bg-blue-100 text-blue-700',
  cfo:       'bg-violet-100 text-violet-700',
  accountant:'bg-emerald-100 text-emerald-700',
  cashier:   'bg-amber-100 text-amber-700',
}
const ROLE_LABELS = { owner: 'Owner', manager: 'Gerente', cfo: 'CFO', accountant: 'Contador', cashier: 'Cajero' }

function initials(name) {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
}
function SectionLabel({ children }) {
  return <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-3">{children}</p>
}
function FieldRow({ label, children }) {
  return (
    <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-4 py-2 border-b border-slate-50 last:border-0">
      <label className="md:w-40 text-sm text-slate-500 md:flex-shrink-0">{label}</label>
      <div className="flex-1">{children}</div>
    </div>
  )
}
function SmInput({ value, onChange, placeholder, type = 'text', className = '' }) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 w-full ${className}`}
    />
  )
}
function Toggle({ on, onToggle, label }) {
  return (
    <button onClick={onToggle} className="flex items-center gap-2 group">
      {on
        ? <ToggleRight size={22} className="text-blue-600" />
        : <ToggleLeft  size={22} className="text-slate-300" />
      }
      {label && <span className="text-sm text-slate-700 group-hover:text-slate-900">{label}</span>}
    </button>
  )
}
function SaveBtn({ onClick }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
      <Save size={14} />
      Guardar
    </button>
  )
}
function Toast({ msg }) {
  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white text-sm px-5 py-3 rounded-full shadow-lg flex items-center gap-2"
      style={{ animation: 'fadeOut 2.8s forwards' }}>
      <Check size={15} className="text-emerald-400" />
      {msg}
      <style>{`@keyframes fadeOut{0%,70%{opacity:1}100%{opacity:0}}`}</style>
    </div>
  )
}

// ── Stub panel for unimplemented sections ─────────────────────────────────────
function StubPanel({ label, icon: Icon }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-slate-300 gap-3">
      <Icon size={40} strokeWidth={1} />
      <p className="text-slate-400 text-sm font-medium">{label}</p>
      <p className="text-xs text-slate-300">Próximamente disponible</p>
    </div>
  )
}

// ── User slide-in form ────────────────────────────────────────────────────────
function UserForm({ user: u, onSave, onClose }) {
  const [name, setName]       = useState(u?.name     ?? '')
  const [username, setUser]   = useState(u?.username ?? '')
  const [role, setRole]       = useState(u?.role     ?? 'cashier')
  const [desc, setDesc]       = useState(u?.desc     ?? 0)
  const [status, setStatus]   = useState(u?.status   ?? 'activo')
  const [pin, setPin]         = useState(u?.pin      ?? '')
  const [clave, setClave]     = useState('')
  const [pregunta, setPregunta] = useState('')
  const [respuesta, setRespuesta] = useState('')

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="hidden md:block flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full md:w-[420px] bg-white shadow-2xl flex flex-col h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">{u ? 'Editar usuario' : 'Nuevo usuario'}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X size={17} className="text-slate-400" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          <div><label className="text-xs text-slate-400 mb-1 block">Nombre completo</label><SmInput value={name} onChange={setName} placeholder="Nombre y apellido" /></div>
          <div><label className="text-xs text-slate-400 mb-1 block">Usuario</label><SmInput value={username} onChange={setUser} placeholder="usuario" /></div>
          <div><label className="text-xs text-slate-400 mb-1 block">Clave</label><SmInput type="password" value={clave} onChange={setClave} placeholder="Nueva clave…" /></div>
          <div><label className="text-xs text-slate-400 mb-1 block">PIN de acceso (4 dígitos)</label><SmInput value={pin} onChange={setPin} placeholder="0000" className="w-24" /></div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Nivel de permiso</label>
            <select value={role} onChange={e => setRole(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
              {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div><label className="text-xs text-slate-400 mb-1 block">% Descuento máximo</label><SmInput type="number" value={desc} onChange={v => setDesc(Number(v))} placeholder="0" className="w-24" /></div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Estado</label>
            <div className="flex gap-2">
              {['activo', 'inactivo'].map(s => (
                <button key={s} onClick={() => setStatus(s)}
                  className={`px-3 py-1 rounded-lg text-sm border capitalize ${status === s ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <hr className="border-slate-100" />
          <div><label className="text-xs text-slate-400 mb-1 block">Pregunta secreta</label><SmInput value={pregunta} onChange={setPregunta} placeholder="¿Cuál es el nombre de tu mascota?" /></div>
          <div><label className="text-xs text-slate-400 mb-1 block">Respuesta secreta</label><SmInput value={respuesta} onChange={setRespuesta} placeholder="Respuesta…" /></div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button onClick={() => onSave({ name, username, role, desc, status, pin })}
            className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
            {u ? 'Guardar cambios' : 'Crear usuario'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── PANEL COMPONENTS ──────────────────────────────────────────────────────────

function PanelEmpresa({ onSave }) {
  const api = useAPI()
  const [nombre, setNombre]   = useState('')
  const [rnc, setRnc]         = useState('')
  const [tel, setTel]         = useState('')
  const [email, setEmail]     = useState('')
  const [dir, setDir]         = useState('')
  const [ciudad, setCiudad]   = useState('')
  const [logo, setLogo]       = useState(null)

  useEffect(() => {
    api.admin.getEmpresa().then(biz => {
      if (!biz) return
      setNombre(biz.name   ?? '')
      setRnc(biz.rnc       ?? '')
      setTel(biz.phone     ?? '')
      setEmail(biz.email   ?? '')
      setDir(biz.address   ?? '')
      const s = biz.settings ? JSON.parse(biz.settings) : {}
      setCiudad(s.ciudad   ?? '')
      if (biz.logo) setLogo(biz.logo)
    })
  }, [])

  function handleLogoClick() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/svg+xml,image/webp'
    input.onchange = e => {
      const file = e.target.files[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = ev => setLogo(ev.target.result)
      reader.readAsDataURL(file)
    }
    input.click()
  }

  async function handleSave() {
    const biz = await api.admin.getEmpresa()
    const s = biz?.settings ? JSON.parse(biz.settings) : {}
    if (ciudad) s.ciudad = ciudad
    await api.admin.saveEmpresa({
      name: nombre, rnc, phone: tel, email, address: dir,
      logo: logo ?? '',
      settings: JSON.stringify(s),
    })
    onSave()
  }

  return (
    <div>
      <SectionLabel>Mi Empresa</SectionLabel>
      {/* Logo */}
      <div className="mb-5">
        <label className="text-xs text-slate-400 mb-2 block">Logo del negocio</label>
        <div
          onClick={handleLogoClick}
          className="w-32 h-32 rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition overflow-hidden"
        >
          {logo ? (
            <img src={logo} alt="logo" className="w-full h-full object-contain" />
          ) : (
            <>
              <Upload size={20} className="text-slate-400" />
              <span className="text-xs text-slate-400">Subir logo</span>
            </>
          )}
        </div>
      </div>
      <FieldRow label="Nombre del negocio"><SmInput value={nombre} onChange={setNombre} /></FieldRow>
      <FieldRow label="RNC"><SmInput value={rnc} onChange={setRnc} placeholder="000-00000-0" /></FieldRow>
      <FieldRow label="Teléfono"><SmInput value={tel} onChange={setTel} /></FieldRow>
      <FieldRow label="Email"><SmInput value={email} onChange={setEmail} type="email" /></FieldRow>
      <FieldRow label="Dirección"><SmInput value={dir} onChange={setDir} /></FieldRow>
      <FieldRow label="Ciudad"><SmInput value={ciudad} onChange={setCiudad} /></FieldRow>
      <div className="mt-5 flex justify-end"><SaveBtn onClick={handleSave} /></div>
    </div>
  )
}

function PanelUsuarios({ onSave }) {
  const api = useAPI()
  const [users, setUsers]   = useState(INIT_USERS)
  const [form, setForm]     = useState(null)   // null | {user} | 'new'

  useEffect(() => {
    api?.users?.all().then(rows => { if (rows) setUsers(rows) }).catch(() => {})
  }, [])

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <SectionLabel>Usuarios y Roles</SectionLabel>
        <button onClick={() => setForm('new')} className="flex items-center gap-1.5 text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700">
          <Plus size={13} /> Nuevo usuario
        </button>
      </div>
      {form && (
        <UserForm
          user={form === 'new' ? null : form}
          onSave={data => {
            if (form === 'new') setUsers(u => [...u, { id: Date.now(), ...data }])
            else setUsers(u => u.map(x => x.id === form.id ? { ...x, ...data } : x))
            setForm(null)
            onSave()
          }}
          onClose={() => setForm(null)}
        />
      )}
      <div className="rounded-xl border border-slate-100 overflow-hidden">
        {/* Header */}
        <div className="flex items-center px-4 py-2 bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-400 gap-0">
          <span className="w-8" />
          <span className="flex-1">Nombre</span>
          <span className="w-28">Usuario</span>
          <span className="w-24">Rol</span>
          <span className="w-16 text-right">% Desc.</span>
          <span className="w-20 text-center">Estado</span>
          <span className="w-24" />
        </div>
        {users.map(u => (
          <div key={u.id} className="flex items-center px-4 h-12 border-t border-slate-50 hover:bg-slate-50">
            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-[11px] font-bold text-slate-600 flex-shrink-0 mr-3">
              {initials(u.name)}
            </div>
            <span className="flex-1 text-sm text-slate-800 font-medium">{u.name}</span>
            <span className="w-28 text-xs text-slate-500">{u.username}</span>
            <div className="w-24">
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${ROLE_BADGE[u.role]}`}>
                {ROLE_LABELS[u.role]}
              </span>
            </div>
            <span className="w-16 text-right text-sm text-slate-600">{u.desc}%</span>
            <div className="w-20 flex justify-center">
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${u.status === 'activo' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                {u.status}
              </span>
            </div>
            <div className="w-24 flex justify-end">
              <button onClick={() => setForm(u)} className="p-1.5 rounded hover:bg-slate-100">
                <Pencil size={13} className="text-slate-400" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PanelPermisos({ onSave }) {
  const [perms, setPerms] = useState(INIT_PERMS)
  function toggle(fn, role) {
    setPerms(p => ({ ...p, [fn]: { ...p[fn], [role]: !p[fn][role] } }))
  }
  return (
    <div>
      <SectionLabel>Permisos por rol</SectionLabel>
      <div className="rounded-xl border border-slate-100 overflow-auto">
        {/* Header */}
        <div className="flex items-center bg-slate-50 border-b border-slate-100 px-4 py-2">
          <span className="flex-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Función</span>
          {PERM_ROLES.map(r => (
            <span key={r} className={`w-24 text-center text-[10px] font-semibold uppercase tracking-wider ${ROLE_BADGE[r]} px-2 py-0.5 rounded-full mx-1`}>
              {PERM_LABELS[r]}
            </span>
          ))}
        </div>
        {PERM_FUNCS.map(fn => (
          <div key={fn} className="flex items-center px-4 h-11 border-t border-slate-50 hover:bg-slate-50/50">
            <span className="flex-1 text-sm text-slate-700">{fn}</span>
            {PERM_ROLES.map(r => (
              <div key={r} className="w-24 flex justify-center mx-1">
                <button
                  onClick={() => r !== 'owner' && toggle(fn, r)}
                  disabled={r === 'owner'}
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center transition ${
                    perms[fn]?.[r]
                      ? 'bg-blue-600 border-blue-600'
                      : 'border-slate-300'
                  } ${r === 'owner' ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:border-blue-400'}`}
                >
                  {perms[fn]?.[r] && <Check size={11} className="text-white" />}
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-end"><SaveBtn onClick={onSave} /></div>
    </div>
  )
}

function PanelLavadores({ onSave }) {
  const [washers, setWashers] = useState(INIT_WASHERS)
  function setComm(id, v) { setWashers(ws => ws.map(w => w.id === id ? { ...w, comm: Number(v) } : w)) }
  function toggleStatus(id) { setWashers(ws => ws.map(w => w.id === id ? { ...w, status: w.status === 'activo' ? 'inactivo' : 'activo' } : w)) }
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <SectionLabel>Lavadores</SectionLabel>
        <button className="flex items-center gap-1.5 text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700">
          <Plus size={13} /> Nuevo lavador
        </button>
      </div>
      <div className="rounded-xl border border-slate-100 overflow-hidden">
        <div className="flex items-center px-4 py-2 bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          <span className="flex-1">Nombre</span>
          <span className="w-28 text-center">Comisión %</span>
          <span className="w-28">Desde</span>
          <span className="w-20 text-center">Estado</span>
        </div>
        {washers.map(w => (
          <div key={w.id} className="flex items-center px-4 h-12 border-t border-slate-50 hover:bg-slate-50">
            <div className="flex items-center gap-2 flex-1">
              <div className="w-7 h-7 rounded-full bg-sky-100 flex items-center justify-center text-[11px] font-bold text-sky-600">
                {initials(w.name)}
              </div>
              <span className="text-sm text-slate-800">{w.name}</span>
            </div>
            <div className="w-28 flex justify-center">
              <div className="relative w-20">
                <input
                  type="number"
                  value={w.comm}
                  onChange={e => setComm(w.id, e.target.value)}
                  className="w-full border border-slate-200 rounded-lg pr-5 pl-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
              </div>
            </div>
            <span className="w-28 text-xs text-slate-500">{w.start}</span>
            <div className="w-20 flex justify-center">
              <button onClick={() => toggleStatus(w.id)} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${w.status === 'activo' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                {w.status}
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-end"><SaveBtn onClick={onSave} /></div>
    </div>
  )
}

function PanelObjetivos({ onSave }) {
  const [vals, setVals] = useState({ diario: 8000, semanal: 48000, quincenal: 95000, mensual: 190000, anual: 2200000 })
  const set = k => v => setVals(o => ({ ...o, [k]: Number(v) }))
  const rows = [
    ['Objetivo diario',     'diario'],
    ['Objetivo semanal',    'semanal'],
    ['Objetivo quincenal',  'quincenal'],
    ['Objetivo mensual',    'mensual'],
    ['Objetivo anual',      'anual'],
  ]
  return (
    <div>
      <SectionLabel>Objetivos de Ventas</SectionLabel>
      {rows.map(([label, key]) => (
        <FieldRow key={key} label={label}>
          <div className="relative w-48">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">RD$</span>
            <input type="number" value={vals[key]} onChange={e => set(key)(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
        </FieldRow>
      ))}
      <div className="mt-5 flex justify-end"><SaveBtn onClick={onSave} /></div>
    </div>
  )
}

function PanelNCF({ onSave }) {
  const [seqs, setSeqs] = useState(INIT_NCF)
  const pct = s => Math.round(s.current / (s.to || 1) * 100)
  return (
    <div>
      <SectionLabel>Secuencias NCF</SectionLabel>
      <div className="rounded-xl border border-slate-100 overflow-hidden mb-4">
        <div className="flex items-center px-4 py-2 bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          <span className="w-12">Seq.</span>
          <span className="flex-1">Nombre</span>
          <span className="w-20 text-right">Actual</span>
          <span className="w-20 text-right">Límite</span>
          <span className="w-32">Uso</span>
          <span className="w-28">Vence</span>
          <span className="w-20 text-center">Estado</span>
        </div>
        {seqs.map((s, i) => (
          <div key={s.seq} className="flex items-center px-4 h-12 border-t border-slate-50 hover:bg-slate-50">
            <span className="w-12 font-mono text-sm font-semibold text-slate-700">{s.seq}</span>
            <span className="flex-1 text-sm text-slate-600">{s.name}</span>
            <span className="w-20 text-right text-sm tabular-nums text-slate-700">{s.current.toLocaleString()}</span>
            <span className="w-20 text-right text-sm tabular-nums text-slate-400">{s.to ? s.to.toLocaleString() : '—'}</span>
            <div className="w-32 px-2">
              {s.to > 0 && (
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className={`h-full rounded-full ${pct(s) > 85 ? 'bg-red-400' : 'bg-blue-400'}`}
                    style={{ width: `${Math.min(pct(s), 100)}%` }} />
                </div>
              )}
            </div>
            <span className="w-28 text-xs text-slate-500">{s.expires}</span>
            <div className="w-20 flex justify-center">
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                s.status === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-600'
              }`}>
                {s.status === 'ok' ? 'OK' : 'Pendiente'}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-end"><SaveBtn onClick={onSave} /></div>
    </div>
  )
}

function PanelECF({ onSave }) {
  const api = useAPI()
  const [apiKey, setApiKey]   = useState('')
  const [mode, setMode]       = useState('paper')   // 'paper' | 'ecf'
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const { sync, syncing, syncProgress, dbStatus } = useRNC()

  useEffect(() => {
    async function load() {
      const biz = await api.admin.getEmpresa()
      if (!biz) return
      const s = biz.settings ? JSON.parse(biz.settings) : {}
      if (s.facturacion_mode) setMode(s.facturacion_mode)
      const safeToken = await api.safe.get('ef2_token').catch(() => '')
      setApiKey(safeToken || s.ef2_token || '')
    }
    load()
  }, [])

  async function testConn() {
    setTesting(true); setTestResult(null)
    try {
      const { testEF2Connection } = await import('../services/ecf')
      await testEF2Connection(apiKey || undefined)
      setTestResult('ok')
    } catch {
      setTestResult('error')
    } finally {
      setTesting(false)
    }
  }

  async function handleSave() {
    await api.safe.set('ef2_token', apiKey)
    const biz = await api.admin.getEmpresa()
    const s = biz?.settings ? JSON.parse(biz.settings) : {}
    await api.admin.saveEmpresa({
      settings: JSON.stringify({ ...s, ef2_token: apiKey, facturacion_mode: mode }),
    })
    onSave()
  }

  const lastSyncLabel = dbStatus.lastSync
    ? new Date(dbStatus.lastSync).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'Nunca'

  return (
    <div>
      <SectionLabel>Configuración e-CF (Ley 32-23)</SectionLabel>
      <FieldRow label="ef2.do API Key">
        <div className="flex gap-2">
          <div className="relative flex-1 max-w-xs">
            <KeyRound size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="ef2_live_xxxxxxxx…"
              className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <button onClick={testConn} disabled={testing}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            <Wifi size={13} />
            {testing ? 'Probando…' : 'Probar conexión'}
          </button>
          {testResult === 'ok'    && <span className="flex items-center gap-1 text-xs text-emerald-600"><Check size={13} />Conectado</span>}
          {testResult === 'error' && <span className="text-xs text-red-500">Fallo — verifique la clave</span>}
        </div>
      </FieldRow>
      <FieldRow label="Certificado digital">
        <label className="flex items-center gap-2 cursor-pointer border border-dashed border-slate-200 rounded-lg px-3 py-2 hover:border-blue-400 hover:bg-blue-50/30 w-56 transition">
          <Upload size={14} className="text-slate-400" />
          <span className="text-sm text-slate-500">Subir .p12 / .pfx</span>
          <input type="file" accept=".p12,.pfx" className="hidden" />
        </label>
      </FieldRow>
      <FieldRow label="Modo de facturación">
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
          <button onClick={() => setMode('paper')}
            className={`px-4 py-2 font-medium transition ${mode === 'paper' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
            B01/B02 Papel
          </button>
          <button onClick={() => setMode('ecf')}
            className={`px-4 py-2 font-medium transition ${mode === 'ecf' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
            E31/E32 e-CF
          </button>
        </div>
        {mode === 'ecf' && (
          <p className="text-xs text-blue-600 mt-1.5 flex items-center gap-1">
            <Check size={11} />
            Modo electrónico activo — facturas firmadas digitalmente vía ef2.do
          </p>
        )}
        {mode === 'paper' && (
          <p className="text-xs text-amber-500 mt-1.5">Modo papel — cambia a e-CF antes del 15 mayo 2026 (Ley 32-23)</p>
        )}
      </FieldRow>
      <SectionLabel>Base de Datos RNC (DGII)</SectionLabel>
      <FieldRow label="Contribuyentes cargados">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-slate-700">
            {dbStatus.count > 0 ? dbStatus.count.toLocaleString('es-DO') : 'Sin datos'}
          </span>
          {dbStatus.count > 0 && (
            <span className="text-xs text-slate-400">Última sync: {lastSyncLabel}</span>
          )}
        </div>
      </FieldRow>
      <FieldRow label="Sincronizar con DGII">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <button onClick={sync} disabled={syncing}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition">
              <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Sincronizando...' : 'Sincronizar ahora'}
            </button>
            {dbStatus.count === 0 && !syncing && (
              <span className="text-xs text-amber-500">Requerido para lookup offline</span>
            )}
          </div>
          {syncing && syncProgress && (
            <div className="w-full max-w-sm">
              <div className="flex justify-between text-xs text-slate-500 mb-1">
                <span className="truncate">{syncProgress.message}</span>
                <span>{syncProgress.percent}%</span>
              </div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{ width: `${syncProgress.percent}%` }} />
              </div>
            </div>
          )}
          {!syncing && syncProgress?.percent === 100 && (
            <p className="text-xs text-emerald-600 flex items-center gap-1">
              <Check size={11} />{syncProgress.message}
            </p>
          )}
          {!syncing && syncProgress?.percent === 0 && syncProgress?.message?.startsWith('❌') && (
            <p className="text-xs text-red-500">{syncProgress.message}</p>
          )}
          <p className="text-xs text-slate-400">
            Descarga la base oficial de ~900K contribuyentes de la DGII. Permite lookup instantáneo sin internet.
          </p>
        </div>
      </FieldRow>

      <div className="mt-5 flex justify-end"><SaveBtn onClick={handleSave} /></div>
    </div>
  )
}

function PanelImpresoras({ onSave }) {
  const api = useAPI()
  const printerApi = usePrinterAPI()
  const [printers,   setPrinters]   = useState([])
  const [printer,    setPrinter]    = useState('')
  const [preTicket,  setPreTicket]  = useState(true)
  const [factura,    setFactura]    = useState(true)
  const [cuadre,     setCuadre]     = useState(true)
  const [compacto,   setCompacto]   = useState(false)
  const [loading,    setLoading]    = useState(true)
  const [testing,    setTesting]    = useState(false)
  const [testResult, setTestResult] = useState(null)

  async function loadPrinters() {
    const list = await printerApi?.listPrinters()
    if (list?.ok) setPrinters(list.data || [])
    return list?.data || []
  }

  useEffect(() => {
    async function load() {
      const [cfg, list] = await Promise.all([
        api?.settings?.get(),
        printerApi?.listPrinters(),
      ])
      if (list?.ok) setPrinters(list.data || [])
      const c = cfg || {}
      setPrinter(c.printer || list?.data?.[0]?.name || '')
      setPreTicket(c.print_pre_ticket !== '0')
      setFactura(c.print_factura !== '0')
      setCuadre(c.print_cuadre !== '0')
      setCompacto(c.print_compacto === '1')
      setLoading(false)
    }
    load()
  }, [])

  async function handleSave() {
    await api?.settings?.update({
      printer,
      print_pre_ticket: preTicket ? '1' : '0',
      print_factura:    factura   ? '1' : '0',
      print_cuadre:     cuadre    ? '1' : '0',
      print_compacto:   compacto  ? '1' : '0',
    })
    onSave()
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      await printerApi?.testDrawerVariants?.(printer)
      setTestResult('ok')
    } catch {
      setTestResult('error')
    } finally {
      setTesting(false)
    }
  }

  if (loading) return <div className="py-8 text-center text-slate-400 text-sm">Cargando impresoras…</div>

  return (
    <div>
      <SectionLabel>Impresoras</SectionLabel>
      <FieldRow label="Impresora principal">
        <div className="flex gap-2 items-center w-full">
          <select value={printer} onChange={e => setPrinter(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 flex-1">
            {printers.length === 0 && <option value="">— Sin impresoras detectadas —</option>}
            {printers.map(p => (
              <option key={p.name} value={p.name}>
                {p.displayName || p.name}{p.isDefault ? ' (predeterminada)' : ''}
              </option>
            ))}
          </select>
          <button onClick={loadPrinters} className="p-1.5 text-slate-400 hover:text-slate-600 transition-colors" title="Actualizar lista">
            <RefreshCw size={14} />
          </button>
        </div>
        {printers.length === 0 && (
          <p className="text-xs text-amber-500 mt-1.5">No se detectaron impresoras. Asegúrate que esté encendida y conectada por USB.</p>
        )}
      </FieldRow>

      <FieldRow label="Probar cajón de dinero">
        <div className="flex items-center gap-3">
          <button onClick={handleTest} disabled={testing || !printer}
            className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 transition-colors flex items-center gap-1.5">
            <Printer size={13} />
            {testing ? 'Probando…' : 'Abrir cajón'}
          </button>
          {testResult === 'ok'    && <span className="text-xs text-green-600">Señal enviada</span>}
          {testResult === 'error' && <span className="text-xs text-red-500">Error al abrir</span>}
        </div>
      </FieldRow>

      <FieldRow label="Imprimir Pre-Ticket"><Toggle on={preTicket} onToggle={() => setPreTicket(v => !v)} /></FieldRow>
      <FieldRow label="Imprimir Factura"><Toggle on={factura} onToggle={() => setFactura(v => !v)} /></FieldRow>
      <FieldRow label="Imprimir Cuadre"><Toggle on={cuadre} onToggle={() => setCuadre(v => !v)} /></FieldRow>
      <FieldRow label="Formato compacto"><Toggle on={compacto} onToggle={() => setCompacto(v => !v)} label={compacto ? 'Compacto' : 'Normal'} /></FieldRow>
      <div className="mt-5 flex justify-end"><SaveBtn onClick={handleSave} /></div>
    </div>
  )
}

function PanelSistema({ onSave }) {
  const [lang, setLang]       = useState('ES')
  const [sucursales, setSuc]  = useState(false)
  const [bebidas, setBebidas] = useState(true)
  const [backup, setBackup]   = useState(true)
  const [ley10, setLey10]     = useState(true)
  const [verRNC, setVerRNC]   = useState(false)
  const [usdRate, setUsdRate] = useState('59.50')
  const [itbis, setItbis]     = useState('18')
  return (
    <div className="space-y-6">
      <div>
        <SectionLabel>Sistema</SectionLabel>
        <FieldRow label="Idioma / Language">
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
            {['ES', 'EN'].map(l => (
              <button key={l} onClick={() => setLang(l)}
                className={`px-5 py-1.5 font-medium transition ${lang === l ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                {l}
              </button>
            ))}
          </div>
        </FieldRow>
        <FieldRow label="Sucursales"><Toggle on={sucursales} onToggle={() => setSuc(v => !v)} label={sucursales ? 'Habilitado' : 'Deshabilitado'} /></FieldRow>
        <FieldRow label="Bebidas/Snacks en POS"><Toggle on={bebidas} onToggle={() => setBebidas(v => !v)} label={bebidas ? 'Visible' : 'Oculto'} /></FieldRow>
        <FieldRow label="Respaldo automático"><Toggle on={backup} onToggle={() => setBackup(v => !v)} label={backup ? 'Activo' : 'Inactivo'} /></FieldRow>
        <FieldRow label="Aplicar Ley 10%"><Toggle on={ley10} onToggle={() => setLey10(v => !v)} label={ley10 ? 'Sí' : 'No'} /></FieldRow>
        <FieldRow label="Verificar RNC/NCF (DGII)"><Toggle on={verRNC} onToggle={() => setVerRNC(v => !v)} label={verRNC ? 'Activo' : 'Inactivo'} /></FieldRow>
      </div>
      <div>
        <SectionLabel>Tasas y Monedas</SectionLabel>
        <FieldRow label="Tasa de cambio USD">
          <div className="relative w-32">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">RD$</span>
            <input type="number" value={usdRate} onChange={e => setUsdRate(e.target.value)} step="0.01"
              className="w-full pl-9 pr-3 py-1.5 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
        </FieldRow>
        <FieldRow label="ITBIS %">
          <div className="relative w-24">
            <input type="number" value={itbis} onChange={e => setItbis(e.target.value)} step="1"
              className="w-full pr-6 pl-3 py-1.5 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
          </div>
        </FieldRow>
      </div>
      <div className="flex justify-end"><SaveBtn onClick={onSave} /></div>
    </div>
  )
}

// ── Backup Panel ──────────────────────────────────────────────────────────────
function PanelBackup({ onSave }) {
  const { status, progress, lastBackup, lastSync, history, storageUsed,
          configured, refreshHistory, markConfigured } = useBackup()

  const [url,     setUrl]     = useState(() => getStoredSetting('supabase_url'))
  const [anonKey, setAnonKey] = useState(() => getStoredSetting('supabase_anon_key'))
  const [autoBackupOn, setAutoBackup] = useState(() => localStorage.getItem('tx_setting_auto_backup') !== 'false')
  const [syncOn, setSyncOn]           = useState(() => localStorage.getItem('tx_setting_cloud_sync') !== 'false')
  const [testing, setTesting]   = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [backing, setBacking]   = useState(false)
  const [backupResult, setBackupResult] = useState(null)
  const [restoreId, setRestoreId] = useState(null)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => { if (configured) refreshHistory() }, [configured])

  function saveCredentials() {
    setStoredSetting('supabase_url',      url.trim())
    setStoredSetting('supabase_anon_key', anonKey.trim())
    resetSupabaseClient()
    markConfigured(!!(url.trim() && anonKey.trim()))
    localStorage.setItem('tx_setting_auto_backup', autoBackupOn ? 'true' : 'false')
    localStorage.setItem('tx_setting_cloud_sync',  syncOn       ? 'true' : 'false')
    // Register this business in Supabase so RemoteDashboard can filter by business_id
    if (url.trim() && anonKey.trim()) {
      ensureBusinessRegistered().catch(() => {})
    }
    onSave()
  }

  async function handleTest() {
    setTesting(true); setTestResult(null)
    const res = await testConnection()
    setTesting(false); setTestResult(res)
  }

  async function handleManualBackup() {
    setBacking(true); setBackupResult(null)
    const res = await manualBackup()
    setBacking(false); setBackupResult(res)
    if (res.success) refreshHistory()
  }

  async function handleRestore(id) {
    if (!window.confirm('¿Restaurar este backup? Los datos actuales serán reemplazados.')) return
    setRestoreId(id); setRestoring(true)
    await restoreFromBackup(id)
    setRestoring(false); setRestoreId(null)
  }

  function fmtBytes(b) {
    if (b < 1024) return b + ' B'
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB'
    return (b / 1024 / 1024).toFixed(2) + ' MB'
  }
  function fmtTs(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('es-DO', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
  }

  const statusMeta = {
    online:  { dot: 'bg-emerald-400', label: 'En línea',      cls: 'text-emerald-600' },
    syncing: { dot: 'bg-amber-400',   label: 'Sincronizando', cls: 'text-amber-600'   },
    offline: { dot: 'bg-red-400',     label: 'Sin conexión',  cls: 'text-red-500'     },
  }[status] || { dot: 'bg-slate-300', label: '—', cls: 'text-slate-400' }

  return (
    <div className="space-y-6">
      {/* Connection status strip */}
      <div className={`flex items-center gap-3 rounded-xl border p-3 ${configured ? 'bg-slate-50 border-slate-200' : 'bg-amber-50 border-amber-200'}`}>
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusMeta.dot}`} />
        <div className="flex-1">
          <p className={`text-sm font-medium ${statusMeta.cls}`}>{configured ? statusMeta.label : 'No configurado'}</p>
          {configured && lastSync && (
            <p className="text-xs text-slate-400">Última sincronización: {fmtTs(lastSync)}</p>
          )}
        </div>
        {storageUsed > 0 && (
          <span className="text-xs text-slate-500">{fmtBytes(storageUsed)} usados</span>
        )}
      </div>

      {/* Supabase credentials */}
      <div>
        <SectionLabel>Supabase — Credenciales</SectionLabel>
        <FieldRow label="Supabase URL">
          <SmInput value={url} onChange={setUrl} placeholder="https://xxxx.supabase.co" />
        </FieldRow>
        <FieldRow label="Anon Key">
          <div className="relative">
            <KeyRound size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="password" value={anonKey} onChange={e => setAnonKey(e.target.value)} placeholder="eyJhbGciOiJIUzI1…"
              className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
        </FieldRow>
        <div className="flex items-center gap-3 mt-3">
          <button onClick={handleTest} disabled={testing || !url || !anonKey}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">
            <Wifi size={13} />
            {testing ? 'Probando…' : 'Probar conexión'}
          </button>
          {testResult?.ok  && <span className="flex items-center gap-1 text-xs text-emerald-600"><Check size={12} />Conexión exitosa</span>}
          {testResult && !testResult.ok && <span className="text-xs text-red-500">Error: {testResult.error}</span>}
        </div>
      </div>

      {/* Toggles */}
      <div>
        <SectionLabel>Comportamiento</SectionLabel>
        <FieldRow label="Backup automático (2:00 am)">
          <Toggle on={autoBackupOn} onToggle={() => setAutoBackup(v => !v)} label={autoBackupOn ? 'Activo' : 'Inactivo'} />
        </FieldRow>
        <FieldRow label="Sincronización en la nube">
          <Toggle on={syncOn} onToggle={() => setSyncOn(v => !v)} label={syncOn ? 'Cada 15 min' : 'Inactivo'} />
        </FieldRow>
        <FieldRow label="Último backup">
          <span className="text-sm text-slate-700">{fmtTs(lastBackup)}</span>
        </FieldRow>
      </div>

      {/* Manual backup */}
      <div>
        <SectionLabel>Backup manual</SectionLabel>
        <div className="flex items-center gap-3">
          <button onClick={handleManualBackup} disabled={backing || !configured}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40">
            <CloudUpload size={14} />
            {backing ? 'Subiendo…' : 'Hacer backup ahora'}
          </button>
          {backupResult?.success && (
            <span className="flex items-center gap-1 text-xs text-emerald-600"><Check size={12} />{backupResult.filename}</span>
          )}
          {backupResult && !backupResult.success && (
            <span className="text-xs text-red-500">{backupResult.error}</span>
          )}
        </div>
        {/* Progress bar */}
        {progress && (
          <div className="mt-3">
            <div className="flex justify-between text-xs text-slate-500 mb-1">
              <span>{progress.msg}</span><span>{progress.pct}%</span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${progress.pct}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Export to Cloud */}
      <ExportToCloud />

      {/* Backup history */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <SectionLabel>Historial de backups</SectionLabel>
          <button onClick={refreshHistory} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
            <RefreshCw size={11} />Actualizar
          </button>
        </div>
        {history.length === 0 ? (
          <p className="text-sm text-slate-400">Sin backups aún.</p>
        ) : (
          <div className="rounded-xl border border-slate-100 overflow-hidden">
            {history.map((b, i) => (
              <div key={b.id} className="flex items-center px-4 py-3 border-b border-slate-50 last:border-0 hover:bg-slate-50">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Cloud size={14} className="text-slate-400 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">{b.filename}</p>
                    <p className="text-[10px] text-slate-400">
                      {fmtTs(b.created_at)} · {fmtBytes(b.size_bytes)} ·
                      <span className={b.type === 'manual' ? ' text-blue-500' : ' text-slate-400'}> {b.type}</span>
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleRestore(b.id)}
                  disabled={restoring && restoreId === b.id}
                  className="flex items-center gap-1 text-xs text-slate-500 border border-slate-200 px-2 py-1 rounded-lg hover:bg-slate-50 disabled:opacity-50 ml-3 flex-shrink-0"
                >
                  <RotateCcw size={11} />
                  {restoring && restoreId === b.id ? 'Restaurando…' : 'Restaurar'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Mode info */}
      <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl p-3">
        <AlertTriangle size={14} className="text-blue-500 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-blue-700">
          Terminal X funciona 100% sin internet. Los datos se guardan localmente en SQLite.
          Cuando hay conexión, los cambios se sincronizan automáticamente a Supabase.
          El POS nunca se bloquea por problemas de red.
        </p>
      </div>

      <div className="flex justify-end">
        <SaveBtn onClick={saveCredentials} />
      </div>
    </div>
  )
}

// ── Panel router ──────────────────────────────────────────────────────────────
function PanelContent({ active, onSave }) {
  switch (active) {
    case 'empresa':    return <PanelEmpresa    onSave={onSave} />
    case 'usuarios':   return <PanelUsuarios   onSave={onSave} />
    case 'permisos':   return <PanelPermisos   onSave={onSave} />
    case 'lavadores':  return <PanelLavadores  onSave={onSave} />
    case 'objetivos':  return <PanelObjetivos  onSave={onSave} />
    case 'ncf':        return <PanelNCF        onSave={onSave} />
    case 'ecf':        return <PanelECF        onSave={onSave} />
    case 'impresoras': return <PanelImpresoras onSave={onSave} />
    case 'backup':     return <PanelBackup     onSave={onSave} />
    case 'idioma':
    case 'sucursales':
    case 'tasas':      return <PanelSistema    onSave={onSave} />
    default: {
      const all  = NAV.flatMap(g => g.items)
      const item = all.find(i => i.key === active)
      return <StubPanel label={item?.label ?? active} icon={item?.icon ?? Server} />
    }
  }
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Settings() {
  const { user } = useAuth()
  const [active, setActive] = useState('empresa')
  const [toast, setToast]   = useState(null)

  const allItems = NAV.flatMap(g => g.items)
  const activeItem = allItems.find(i => i.key === active)

  function handleSave() {
    setToast('Cambios guardados')
    setTimeout(() => setToast(null), 3000)
  }

  return (
    <div className="h-full flex flex-col md:flex-row bg-slate-50 overflow-hidden">
      {toast && <Toast msg={toast} />}

      {/* ── Mobile: horizontal scroll tabs ── */}
      <div className="md:hidden shrink-0 bg-white border-b border-slate-100 overflow-x-auto scrollbar-none">
        <div className="flex px-2 py-2 gap-1">
          {allItems.map(item => {
            const Icon = item.icon
            const isActive = active === item.key
            return (
              <button
                key={item.key}
                onClick={() => setActive(item.key)}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg transition whitespace-nowrap min-h-[44px] ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                <Icon size={13} className={isActive ? 'text-blue-600' : 'text-slate-400'} />
                {item.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Desktop: Sidebar ── */}
      <aside className="hidden md:flex w-56 bg-white border-r border-slate-100 flex-col overflow-y-auto flex-shrink-0">
        <div className="px-4 py-4 border-b border-slate-100">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Ajustes</p>
        </div>
        <nav className="flex-1 py-2">
          {NAV.map(group => (
            <div key={group.group} className="mb-1">
              <p className="px-4 pt-3 pb-1 text-[9px] font-bold uppercase tracking-widest text-slate-300">
                {group.group}
              </p>
              {group.items.map(item => {
                const Icon = item.icon
                const isActive = active === item.key
                return (
                  <button
                    key={item.key}
                    onClick={() => setActive(item.key)}
                    className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition ${
                      isActive
                        ? 'bg-blue-50 text-blue-700 font-medium border-r-2 border-blue-500'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'
                    }`}
                  >
                    <Icon size={14} className={isActive ? 'text-blue-600' : 'text-slate-400'} />
                    {item.label}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>
      </aside>

      {/* ── Content area ── */}
      <main className="flex-1 overflow-y-auto">
        {/* Content header */}
        <div className="bg-white border-b border-slate-100 px-4 md:px-8 py-3 md:py-4 flex items-center gap-2 sticky top-0 z-10 flex-shrink-0">
          {activeItem && <activeItem.icon size={16} className="text-slate-500" />}
          <h2 className="font-semibold text-slate-800 text-sm md:text-base">{activeItem?.label ?? 'Ajustes'}</h2>
        </div>
        <div className="p-3 md:p-8 max-w-3xl">
          <PanelContent active={active} onSave={handleSave} />
        </div>
      </main>
    </div>
  )
}
