// EmpleadosDemo — faithful copy of Empleados.jsx render. Staff table with
// avatar, role, type (lavador/cajero/vendedor), commission %, hire date,
// active toggle. Modal for new/edit. Filter by role + tipo.

import { useState, useMemo } from 'react'
import { Plus, Search, Edit2, Trash2, X, Phone, Mail, IdCard, Calendar, ToggleLeft, ToggleRight, Shield, KeyRound, Briefcase } from 'lucide-react'

function fmtRD(n) { return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}` }
function fmtDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' }) }
function initials(n) { return (n || '?').split(' ').map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() }

const ROLE_LABELS = {
  owner:      'Dueño',
  manager:    'Gerente',
  cfo:        'CFO',
  accountant: 'Contador',
  cashier:    'Cajero',
  kitchen:    'Cocina',
  none:       'Sin rol',
}
const ROLE_PILL = {
  owner:      'bg-[#b3001e] text-white',
  manager:    'bg-amber-500 text-white',
  cfo:        'bg-violet-600 text-white',
  accountant: 'bg-sky-600 text-white',
  cashier:    'bg-slate-600 text-white',
  kitchen:    'bg-emerald-600 text-white',
  none:       'bg-slate-200 text-slate-600',
}

const TIPOS = ['lavador', 'cajero', 'vendedor', 'mecanico', 'estilista', 'mesero', 'cocinero', 'admin']

const SEED = [
  { id: 1, name: 'Mike Mejia',        role: 'owner',      tipo: 'admin',     phone: '809-555-0001', cedula: '001-1234567-8', hire_date: '2025-01-15', commission_pct: 0,  salary: 0,     active: true,  monthly_sales: 0,      tickets_today: 0  },
  { id: 2, name: 'Carmen Diaz',       role: 'cashier',    tipo: 'cajero',    phone: '829-555-0002', cedula: '002-2345678-9', hire_date: '2025-08-10', commission_pct: 5,  salary: 18000, active: true,  monthly_sales: 540000, tickets_today: 47 },
  { id: 3, name: 'Pedro Mendez',      role: 'manager',    tipo: 'admin',     phone: '809-555-0003', cedula: '003-3456789-0', hire_date: '2025-04-05', commission_pct: 0,  salary: 35000, active: true,  monthly_sales: 0,      tickets_today: 0  },
  { id: 4, name: 'Juan Perez',        role: 'cashier',    tipo: 'lavador',   phone: '809-555-0004', cedula: '004-4567890-1', hire_date: '2026-01-20', commission_pct: 30, salary: 0,     active: true,  monthly_sales: 124500, tickets_today: 8  },
  { id: 5, name: 'Pedro Ramirez',     role: 'cashier',    tipo: 'lavador',   phone: '829-555-0005', cedula: '005-5678901-2', hire_date: '2026-02-12', commission_pct: 30, salary: 0,     active: true,  monthly_sales: 98000,  tickets_today: 6  },
  { id: 6, name: 'Carlos Mejia',      role: 'cashier',    tipo: 'lavador',   phone: '849-555-0006', cedula: '006-6789012-3', hire_date: '2025-11-18', commission_pct: 30, salary: 0,     active: true,  monthly_sales: 76000,  tickets_today: 5  },
  { id: 7, name: 'Luis Santana',      role: 'cashier',    tipo: 'lavador',   phone: '809-555-0007', cedula: '007-7890123-4', hire_date: '2026-03-08', commission_pct: 30, salary: 0,     active: true,  monthly_sales: 58000,  tickets_today: 4  },
  { id: 8, name: 'Diego Rosario',     role: 'cashier',    tipo: 'lavador',   phone: '829-555-0008', cedula: '008-8901234-5', hire_date: '2026-04-15', commission_pct: 25, salary: 0,     active: true,  monthly_sales: 42000,  tickets_today: 3  },
  { id: 9, name: 'Maria Rodriguez',   role: 'accountant', tipo: 'admin',     phone: '849-555-0009', cedula: '009-9012345-6', hire_date: '2025-06-01', commission_pct: 0,  salary: 28000, active: true,  monthly_sales: 0,      tickets_today: 0  },
  { id: 10,name: 'Sofia Almonte',     role: 'cashier',    tipo: 'vendedor',  phone: '809-555-0010', cedula: '010-0123456-7', hire_date: '2025-09-22', commission_pct: 1.8, salary: 22000, active: false, monthly_sales: 0,      tickets_today: 0  },
]

export default function EmpleadosDemo() {
  const [staff]             = useState(SEED)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [tipoFilter, setTipoFilter] = useState('all')
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState(null)

  const filtered = useMemo(() => staff.filter(e => {
    if (!showInactive && !e.active) return false
    if (roleFilter !== 'all' && e.role !== roleFilter) return false
    if (tipoFilter !== 'all' && e.tipo !== tipoFilter) return false
    const q = search.toLowerCase().trim()
    if (!q) return true
    return e.name.toLowerCase().includes(q) || e.cedula.includes(q) || e.phone.includes(q)
  }), [staff, search, roleFilter, tipoFilter, showInactive])

  const counts = {
    all:    staff.filter(e => e.active).length,
    lavador: staff.filter(e => e.active && e.tipo === 'lavador').length,
    cajero: staff.filter(e => e.active && e.tipo === 'cajero').length,
    inactive: staff.filter(e => !e.active).length,
  }
  const totalSalary = staff.filter(e => e.active).reduce((s, e) => s + e.salary, 0)
  const totalCommissions = staff.filter(e => e.active && e.commission_pct > 0).reduce((s, e) => s + (e.monthly_sales * e.commission_pct / 100), 0)

  return (
    <div className="p-6 max-w-7xl mx-auto h-full overflow-y-auto bg-white">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 inline-flex items-center gap-3"><Briefcase size={24} className="text-[#b3001e]" /> Empleados</h1>
          <p className="text-sm text-slate-500 mt-1">{counts.all} activos · {counts.lavador} lavadores · nómina {fmtRD(totalSalary)}/mes</p>
        </div>
        <button onClick={() => setEditing({})} className="inline-flex items-center gap-1.5 bg-[#b3001e] hover:bg-[#8c0017] text-white text-sm font-bold px-4 py-2 rounded-lg"><Plus size={14} /> Nuevo empleado</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="bg-white border border-slate-200 rounded-xl p-3"><p className="text-[10px] uppercase tracking-wider text-slate-400">Activos</p><p className="text-2xl font-bold text-slate-800 mt-1">{counts.all}</p></div>
        <div className="bg-white border border-slate-200 rounded-xl p-3"><p className="text-[10px] uppercase tracking-wider text-slate-400">Lavadores / operativos</p><p className="text-2xl font-bold text-slate-800 mt-1">{counts.lavador}</p></div>
        <div className="bg-white border border-slate-200 rounded-xl p-3"><p className="text-[10px] uppercase tracking-wider text-slate-400">Nómina mensual</p><p className="text-2xl font-bold text-slate-800 mt-1 tabular-nums">{fmtRD(totalSalary)}</p></div>
        <div className="bg-white border border-slate-200 rounded-xl p-3"><p className="text-[10px] uppercase tracking-wider text-slate-400">Comisiones del mes</p><p className="text-2xl font-bold text-[#b3001e] mt-1 tabular-nums">{fmtRD(totalCommissions)}</p></div>
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus-within:ring-2 focus-within:ring-sky-400 w-56">
          <Search size={13} className="text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar nombre, cédula..." className="flex-1 text-[12px] bg-transparent outline-none" />
        </div>
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-[12px] bg-white focus:border-sky-400 outline-none">
          <option value="all">Todos los roles</option>
          {Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={tipoFilter} onChange={e => setTipoFilter(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-[12px] bg-white focus:border-sky-400 outline-none">
          <option value="all">Todos los tipos</option>
          {TIPOS.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
        </select>
        <label className="ml-auto flex items-center gap-1.5 text-[12px] text-slate-600 cursor-pointer"><input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="accent-[#b3001e]" /> Mostrar inactivos ({counts.inactive})</label>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="text-left px-4 py-2.5 font-bold">Empleado</th>
              <th className="text-left px-4 py-2.5 font-bold">Rol</th>
              <th className="text-left px-4 py-2.5 font-bold">Tipo</th>
              <th className="text-left px-4 py-2.5 font-bold">Contacto</th>
              <th className="text-left px-4 py-2.5 font-bold">Ingreso</th>
              <th className="text-right px-4 py-2.5 font-bold">Salario</th>
              <th className="text-right px-4 py-2.5 font-bold">Comisión</th>
              <th className="text-center px-4 py-2.5 font-bold">Estado</th>
              <th className="text-right px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(e => (
              <tr key={e.id} className={`border-t border-slate-100 hover:bg-slate-50 ${!e.active ? 'opacity-60' : ''}`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-600 text-[11px] font-bold flex items-center justify-center shrink-0">{initials(e.name)}</div>
                    <div>
                      <p className="font-semibold text-slate-800">{e.name}</p>
                      <p className="text-[10px] text-slate-400 font-mono">{e.cedula}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3"><span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${ROLE_PILL[e.role]}`}>{ROLE_LABELS[e.role]}</span></td>
                <td className="px-4 py-3 text-slate-600 text-[12px] capitalize">{e.tipo}</td>
                <td className="px-4 py-3 text-slate-600 text-[12px]"><Phone size={10} className="inline mr-1" />{e.phone}</td>
                <td className="px-4 py-3 text-slate-500 text-[12px] tabular-nums">{fmtDate(e.hire_date)}</td>
                <td className="px-4 py-3 text-right text-slate-700 tabular-nums">{e.salary ? fmtRD(e.salary) : '—'}</td>
                <td className="px-4 py-3 text-right text-[#b3001e] font-semibold tabular-nums">{e.commission_pct ? `${e.commission_pct}%` : '—'}</td>
                <td className="px-4 py-3 text-center">
                  {e.active ? <ToggleRight size={20} className="text-emerald-600 mx-auto" /> : <ToggleLeft size={20} className="text-slate-300 mx-auto" />}
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => setEditing(e)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"><Edit2 size={13} /></button>
                  <button className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={13} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-[16px] font-bold text-slate-800">{editing.id ? `Editar ${editing.name}` : 'Nuevo empleado'}</h3>
              <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-3">
              <label className="block col-span-2"><span className="text-xs font-semibold text-slate-500">Nombre completo *</span><input defaultValue={editing.name} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:border-sky-400 outline-none" /></label>
              <label className="block"><span className="text-xs font-semibold text-slate-500">Cédula</span><input defaultValue={editing.cedula} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:border-sky-400 outline-none" /></label>
              <label className="block"><span className="text-xs font-semibold text-slate-500">Teléfono</span><input defaultValue={editing.phone} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:border-sky-400 outline-none" /></label>
              <label className="block"><span className="text-xs font-semibold text-slate-500">Rol (acceso)</span>
                <select defaultValue={editing.role} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">{Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </label>
              <label className="block"><span className="text-xs font-semibold text-slate-500">Tipo (nómina)</span>
                <select defaultValue={editing.tipo} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white capitalize">{TIPOS.map(t => <option key={t} value={t}>{t}</option>)}</select>
              </label>
              <label className="block"><span className="text-xs font-semibold text-slate-500">Fecha de ingreso</span><input type="date" defaultValue={editing.hire_date} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:border-sky-400 outline-none" /></label>
              <label className="block"><span className="text-xs font-semibold text-slate-500">Salario base RD$/mes</span><input type="number" defaultValue={editing.salary} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:border-sky-400 outline-none" /></label>
              <label className="block"><span className="text-xs font-semibold text-slate-500">Comisión %</span><input type="number" step="0.1" defaultValue={editing.commission_pct} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:border-sky-400 outline-none" /></label>
              <div className="col-span-2 border border-slate-200 rounded-lg p-3 bg-slate-50">
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 inline-flex items-center gap-1.5"><KeyRound size={12} /> Acceso al POS</p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block"><span className="text-[10px] font-semibold text-slate-500">PIN (4-6 dígitos)</span><input type="password" maxLength={6} className="mt-1 w-full border border-slate-200 rounded px-2 py-1.5 text-sm font-mono text-center tracking-[6px]" placeholder="••••" /></label>
                  <label className="block"><span className="text-[10px] font-semibold text-slate-500">Tarjeta autorización (Code128)</span><input className="mt-1 w-full border border-slate-200 rounded px-2 py-1.5 text-sm font-mono" placeholder="MAC-..." /></label>
                </div>
              </div>
              <label className="flex items-center gap-2 col-span-2 text-sm text-slate-700 pt-2"><input type="checkbox" defaultChecked={editing.active !== false} className="accent-[#b3001e]" /> Empleado activo (puede iniciar sesión)</label>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200">
              {editing.id && <button className="mr-auto inline-flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={13} /> Eliminar</button>}
              <button onClick={() => setEditing(null)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium hover:bg-slate-50">Cancelar</button>
              <button onClick={() => setEditing(null)} className="px-4 py-2 bg-[#b3001e] text-white rounded-lg text-sm font-bold hover:bg-[#8c0017]">Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
