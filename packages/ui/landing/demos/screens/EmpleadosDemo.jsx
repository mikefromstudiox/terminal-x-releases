// EmpleadosDemo — vertical-aware staff table. Accepts a `vertical` prop and
// swaps in the right tipo enum, default seed roster, and per-vertical labels
// (lavadores → cocineros → estilistas → mecanicos → vendedores …).

import { useState, useMemo } from 'react'
import { Plus, Search, Edit2, Trash2, X, Phone, ToggleLeft, ToggleRight, KeyRound, Briefcase } from 'lucide-react'

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

// Per-vertical config: which `tipo` enum is offered and what label appears in
// KPI tiles ("X operativos"). Also drives the default seed roster.
const VERTICAL_PROFILES = {
  carwash:      { tipos: ['lavador', 'cajero', 'admin'],                       opLabel: 'Lavadores',          opTipo: 'lavador' },
  retail:       { tipos: ['vendedor', 'cajero', 'admin'],                      opLabel: 'Vendedores',         opTipo: 'vendedor' },
  licoreria:    { tipos: ['vendedor', 'cajero', 'admin'],                      opLabel: 'Vendedores',         opTipo: 'vendedor' },
  carniceria:   { tipos: ['carnicero', 'vendedor', 'cajero', 'admin'],         opLabel: 'Carniceros',         opTipo: 'carnicero' },
  service:      { tipos: ['tecnico', 'vendedor', 'cajero', 'admin'],           opLabel: 'Técnicos',           opTipo: 'tecnico' },
  restaurant:   { tipos: ['mesero', 'cocinero', 'cajero', 'admin'],            opLabel: 'Meseros',            opTipo: 'mesero' },
  food_truck:   { tipos: ['cocinero', 'cajero', 'repartidor', 'admin'],        opLabel: 'Cocineros',          opTipo: 'cocinero' },
  mechanic:     { tipos: ['mecanico', 'asesor', 'cajero', 'admin'],            opLabel: 'Mecánicos',          opTipo: 'mecanico' },
  salon:        { tipos: ['estilista', 'recepcion', 'cajero', 'admin'],        opLabel: 'Estilistas',         opTipo: 'estilista' },
  prestamos:    { tipos: ['cobrador', 'oficial', 'cajero', 'admin'],           opLabel: 'Cobradores',         opTipo: 'cobrador' },
  dealership:   { tipos: ['vendedor', 'asesor', 'cajero', 'admin'],            opLabel: 'Vendedores',         opTipo: 'vendedor' },
  contabilidad: { tipos: ['contador', 'asistente', 'admin'],                   opLabel: 'Contadores',         opTipo: 'contador' },
  facturacion:  { tipos: ['contador', 'asistente', 'admin'],                   opLabel: 'Contadores',         opTipo: 'contador' },
  hybrid:       { tipos: ['vendedor', 'lavador', 'cajero', 'admin'],           opLabel: 'Operativos',         opTipo: 'vendedor' },
}

// Seed rosters by vertical. Owner/manager/contador first, then operativos.
const SEEDS = {
  carwash: [
    { id: 1, name: 'Mike Mejia',      role: 'owner',   tipo: 'admin',   phone: '809-555-0001', cedula: '001-1234567-8', hire_date: '2025-01-15', commission_pct: 0,   salary: 0,     active: true,  monthly_sales: 0,      tickets_today: 0  },
    { id: 2, name: 'Carmen Diaz',     role: 'cashier', tipo: 'cajero',  phone: '829-555-0002', cedula: '002-2345678-9', hire_date: '2025-08-10', commission_pct: 5,   salary: 18000, active: true,  monthly_sales: 540000, tickets_today: 47 },
    { id: 3, name: 'Pedro Mendez',    role: 'manager', tipo: 'admin',   phone: '809-555-0003', cedula: '003-3456789-0', hire_date: '2025-04-05', commission_pct: 0,   salary: 35000, active: true,  monthly_sales: 0,      tickets_today: 0  },
    { id: 4, name: 'Juan Perez',      role: 'cashier', tipo: 'lavador', phone: '809-555-0004', cedula: '004-4567890-1', hire_date: '2026-01-20', commission_pct: 30,  salary: 0,     active: true,  monthly_sales: 124500, tickets_today: 8  },
    { id: 5, name: 'Pedro Ramirez',   role: 'cashier', tipo: 'lavador', phone: '829-555-0005', cedula: '005-5678901-2', hire_date: '2026-02-12', commission_pct: 30,  salary: 0,     active: true,  monthly_sales: 98000,  tickets_today: 6  },
    { id: 6, name: 'Carlos Mejia',    role: 'cashier', tipo: 'lavador', phone: '849-555-0006', cedula: '006-6789012-3', hire_date: '2025-11-18', commission_pct: 30,  salary: 0,     active: true,  monthly_sales: 76000,  tickets_today: 5  },
    { id: 7, name: 'Luis Santana',    role: 'cashier', tipo: 'lavador', phone: '809-555-0007', cedula: '007-7890123-4', hire_date: '2026-03-08', commission_pct: 30,  salary: 0,     active: true,  monthly_sales: 58000,  tickets_today: 4  },
  ],
  food_truck: [
    { id: 1, name: 'Luis Mejia',      role: 'owner',   tipo: 'admin',     phone: '809-555-0101', cedula: '001-1112223-4', hire_date: '2025-03-01', commission_pct: 0,  salary: 0,     active: true,  monthly_sales: 0,      tickets_today: 0  },
    { id: 2, name: 'Yuderka Mateo',   role: 'cashier', tipo: 'cajero',    phone: '829-555-0102', cedula: '002-2223334-5', hire_date: '2025-07-12', commission_pct: 3,  salary: 16000, active: true,  monthly_sales: 412000, tickets_today: 64 },
    { id: 3, name: 'Jose Bautista',   role: 'kitchen', tipo: 'cocinero',  phone: '809-555-0103', cedula: '003-3334445-6', hire_date: '2025-05-20', commission_pct: 0,  salary: 22000, active: true,  monthly_sales: 0,      tickets_today: 0  },
    { id: 4, name: 'Manuel Tavarez',  role: 'kitchen', tipo: 'cocinero',  phone: '829-555-0104', cedula: '004-4445556-7', hire_date: '2026-01-08', commission_pct: 0,  salary: 18000, active: true,  monthly_sales: 0,      tickets_today: 0  },
    { id: 5, name: 'Henry Reyes',     role: 'cashier', tipo: 'repartidor',phone: '809-555-0105', cedula: '005-5556667-8', hire_date: '2026-02-15', commission_pct: 8,  salary: 0,     active: true,  monthly_sales: 92000,  tickets_today: 22 },
    { id: 6, name: 'Carla Espinal',   role: 'cashier', tipo: 'repartidor',phone: '849-555-0106', cedula: '006-6667778-9', hire_date: '2026-03-10', commission_pct: 8,  salary: 0,     active: true,  monthly_sales: 64000,  tickets_today: 16 },
  ],
  restaurant: [
    { id: 1, name: 'Mike Mejia',      role: 'owner',   tipo: 'admin',    phone: '809-555-0201', cedula: '001-1234567-8', hire_date: '2025-01-15', commission_pct: 0,  salary: 0,     active: true,  monthly_sales: 0,      tickets_today: 0 },
    { id: 2, name: 'Pedro Mendez',    role: 'manager', tipo: 'admin',    phone: '809-555-0203', cedula: '003-3456789-0', hire_date: '2025-04-05', commission_pct: 0,  salary: 35000, active: true,  monthly_sales: 0,      tickets_today: 0 },
    { id: 3, name: 'Antonia Vasquez', role: 'kitchen', tipo: 'cocinero', phone: '809-555-0204', cedula: '004-4567890-1', hire_date: '2025-06-10', commission_pct: 0,  salary: 28000, active: true,  monthly_sales: 0,      tickets_today: 0 },
    { id: 4, name: 'Sofia Almonte',   role: 'cashier', tipo: 'mesero',   phone: '809-555-0205', cedula: '005-5678901-2', hire_date: '2026-02-12', commission_pct: 10, salary: 0,     active: true,  monthly_sales: 142000, tickets_today: 28 },
    { id: 5, name: 'Diego Rosario',   role: 'cashier', tipo: 'mesero',   phone: '829-555-0206', cedula: '006-6789012-3', hire_date: '2026-04-15', commission_pct: 10, salary: 0,     active: true,  monthly_sales: 96000,  tickets_today: 19 },
    { id: 6, name: 'Carmen Diaz',     role: 'cashier', tipo: 'cajero',   phone: '829-555-0207', cedula: '007-7890123-4', hire_date: '2025-08-10', commission_pct: 4,  salary: 18000, active: true,  monthly_sales: 240000, tickets_today: 47 },
  ],
  salon: [
    { id: 1, name: 'Vanessa Pichardo',role: 'owner',   tipo: 'admin',     phone: '809-555-0301', cedula: '001-1010101-1', hire_date: '2024-09-01', commission_pct: 0,  salary: 0,     active: true,  monthly_sales: 0,      tickets_today: 0 },
    { id: 2, name: 'Yamilet Rosario', role: 'cashier', tipo: 'recepcion', phone: '829-555-0302', cedula: '002-2020202-2', hire_date: '2025-11-05', commission_pct: 0,  salary: 22000, active: true,  monthly_sales: 0,      tickets_today: 0 },
    { id: 3, name: 'Karla Polanco',   role: 'cashier', tipo: 'estilista', phone: '809-555-0303', cedula: '003-3030303-3', hire_date: '2025-12-15', commission_pct: 40, salary: 0,     active: true,  monthly_sales: 184000, tickets_today: 6 },
    { id: 4, name: 'Andrea Mateo',    role: 'cashier', tipo: 'estilista', phone: '829-555-0304', cedula: '004-4040404-4', hire_date: '2026-01-22', commission_pct: 40, salary: 0,     active: true,  monthly_sales: 142000, tickets_today: 5 },
    { id: 5, name: 'Lisbet Severino', role: 'cashier', tipo: 'estilista', phone: '849-555-0305', cedula: '005-5050505-5', hire_date: '2026-02-18', commission_pct: 35, salary: 0,     active: true,  monthly_sales: 98000,  tickets_today: 4 },
  ],
  mechanic: [
    { id: 1, name: 'Carlos Reyes',   role: 'owner',   tipo: 'admin',    phone: '809-555-0401', cedula: '001-9999999-1', hire_date: '2024-06-01', commission_pct: 0,  salary: 0,     active: true,  monthly_sales: 0,      tickets_today: 0 },
    { id: 2, name: 'Pedro Garcia',   role: 'cashier', tipo: 'asesor',   phone: '829-555-0402', cedula: '002-8888888-2', hire_date: '2025-08-10', commission_pct: 5,  salary: 22000, active: true,  monthly_sales: 380000, tickets_today: 12 },
    { id: 3, name: 'Juan Hernandez', role: 'cashier', tipo: 'mecanico', phone: '809-555-0403', cedula: '003-7777777-3', hire_date: '2025-04-15', commission_pct: 25, salary: 18000, active: true,  monthly_sales: 245000, tickets_today: 4 },
    { id: 4, name: 'Luis Bautista',  role: 'cashier', tipo: 'mecanico', phone: '849-555-0404', cedula: '004-6666666-4', hire_date: '2026-01-20', commission_pct: 25, salary: 18000, active: true,  monthly_sales: 162000, tickets_today: 3 },
  ],
  retail: [
    { id: 1, name: 'Mike Mejia',     role: 'owner',   tipo: 'admin',    phone: '809-555-0501', cedula: '001-5555555-1', hire_date: '2024-09-01', commission_pct: 0, salary: 0,     active: true,  monthly_sales: 0,      tickets_today: 0 },
    { id: 2, name: 'Carmen Diaz',    role: 'cashier', tipo: 'cajero',   phone: '829-555-0502', cedula: '002-4444444-2', hire_date: '2025-08-10', commission_pct: 2, salary: 18000, active: true,  monthly_sales: 540000, tickets_today: 47 },
    { id: 3, name: 'Sofia Almonte',  role: 'cashier', tipo: 'vendedor', phone: '809-555-0503', cedula: '003-3333333-3', hire_date: '2025-09-22', commission_pct: 3, salary: 16000, active: true,  monthly_sales: 280000, tickets_today: 32 },
    { id: 4, name: 'Diego Rosario',  role: 'cashier', tipo: 'vendedor', phone: '849-555-0504', cedula: '004-2222222-4', hire_date: '2026-02-15', commission_pct: 3, salary: 16000, active: true,  monthly_sales: 188000, tickets_today: 24 },
  ],
  licoreria: [
    { id: 1, name: 'Ramon Almonte',  role: 'owner',   tipo: 'admin',    phone: '809-555-0601', cedula: '001-1111101-1', hire_date: '2024-05-01', commission_pct: 0, salary: 0,     active: true,  monthly_sales: 0,      tickets_today: 0 },
    { id: 2, name: 'Yokasta Pena',   role: 'cashier', tipo: 'cajero',   phone: '829-555-0602', cedula: '002-2222202-2', hire_date: '2025-09-12', commission_pct: 2, salary: 17000, active: true,  monthly_sales: 620000, tickets_today: 86 },
    { id: 3, name: 'Wilson Tejada',  role: 'cashier', tipo: 'vendedor', phone: '809-555-0603', cedula: '003-3333303-3', hire_date: '2025-11-08', commission_pct: 3, salary: 15000, active: true,  monthly_sales: 320000, tickets_today: 44 },
    { id: 4, name: 'Eric Pimentel',  role: 'cashier', tipo: 'vendedor', phone: '849-555-0604', cedula: '004-4444404-4', hire_date: '2026-03-01', commission_pct: 3, salary: 15000, active: true,  monthly_sales: 195000, tickets_today: 28 },
  ],
  carniceria: [
    { id: 1, name: 'Domingo Rivas',  role: 'owner',   tipo: 'admin',     phone: '809-555-0701', cedula: '001-7070707-1', hire_date: '2024-04-01', commission_pct: 0, salary: 0,     active: true,  monthly_sales: 0,      tickets_today: 0 },
    { id: 2, name: 'Maria Frias',    role: 'cashier', tipo: 'cajero',    phone: '829-555-0702', cedula: '002-7070707-2', hire_date: '2025-08-10', commission_pct: 2, salary: 16000, active: true,  monthly_sales: 380000, tickets_today: 52 },
    { id: 3, name: 'Pablo Soto',     role: 'cashier', tipo: 'carnicero', phone: '809-555-0703', cedula: '003-7070707-3', hire_date: '2025-06-15', commission_pct: 4, salary: 22000, active: true,  monthly_sales: 240000, tickets_today: 38 },
    { id: 4, name: 'Hector Vargas',  role: 'cashier', tipo: 'carnicero', phone: '849-555-0704', cedula: '004-7070707-4', hire_date: '2026-02-08', commission_pct: 4, salary: 22000, active: true,  monthly_sales: 175000, tickets_today: 26 },
  ],
  service: [
    { id: 1, name: 'Andres Polanco', role: 'owner',   tipo: 'admin',   phone: '809-555-0801', cedula: '001-8080808-1', hire_date: '2024-08-01', commission_pct: 0, salary: 0,     active: true,  monthly_sales: 0,      tickets_today: 0 },
    { id: 2, name: 'Fior Rodriguez', role: 'cashier', tipo: 'cajero',  phone: '829-555-0802', cedula: '002-8080808-2', hire_date: '2025-10-12', commission_pct: 2, salary: 18000, active: true,  monthly_sales: 220000, tickets_today: 18 },
    { id: 3, name: 'Manuel Pineda',  role: 'cashier', tipo: 'tecnico', phone: '809-555-0803', cedula: '003-8080808-3', hire_date: '2025-07-05', commission_pct: 15, salary: 22000, active: true, monthly_sales: 320000, tickets_today: 6 },
    { id: 4, name: 'Yamil Cruz',     role: 'cashier', tipo: 'tecnico', phone: '849-555-0804', cedula: '004-8080808-4', hire_date: '2026-03-20', commission_pct: 15, salary: 22000, active: true, monthly_sales: 188000, tickets_today: 4 },
  ],
  prestamos: [
    { id: 1, name: 'Felix Aybar',    role: 'owner',   tipo: 'admin',    phone: '809-555-0901', cedula: '001-9090909-1', hire_date: '2024-02-01', commission_pct: 0, salary: 0,     active: true,  monthly_sales: 0,      tickets_today: 0 },
    { id: 2, name: 'Norma Cabrera',  role: 'manager', tipo: 'oficial',  phone: '829-555-0902', cedula: '002-9090909-2', hire_date: '2025-06-10', commission_pct: 0, salary: 38000, active: true,  monthly_sales: 0,      tickets_today: 0 },
    { id: 3, name: 'Leonel Beltre',  role: 'cashier', tipo: 'cobrador', phone: '809-555-0903', cedula: '003-9090909-3', hire_date: '2025-09-15', commission_pct: 5, salary: 18000, active: true,  monthly_sales: 142000, tickets_today: 9 },
    { id: 4, name: 'Walter Castro',  role: 'cashier', tipo: 'cobrador', phone: '849-555-0904', cedula: '004-9090909-4', hire_date: '2026-01-08', commission_pct: 5, salary: 18000, active: true,  monthly_sales: 98000,  tickets_today: 7 },
  ],
  dealership: [
    { id: 1, name: 'Manuel Estrella',role: 'owner',   tipo: 'admin',    phone: '809-555-1001', cedula: '001-1010101-9', hire_date: '2023-01-15', commission_pct: 0,  salary: 0,     active: true,  monthly_sales: 0,       tickets_today: 0 },
    { id: 2, name: 'Yris Pena',      role: 'manager', tipo: 'admin',    phone: '829-555-1002', cedula: '002-1010102-9', hire_date: '2024-04-22', commission_pct: 0,  salary: 65000, active: true,  monthly_sales: 0,       tickets_today: 0 },
    { id: 3, name: 'Esteban Rojas',  role: 'cashier', tipo: 'vendedor', phone: '809-555-1003', cedula: '003-1010103-9', hire_date: '2024-11-08', commission_pct: 2,  salary: 25000, active: true,  monthly_sales: 4200000, tickets_today: 1 },
    { id: 4, name: 'Patricia Veloz', role: 'cashier', tipo: 'vendedor', phone: '829-555-1004', cedula: '004-1010104-9', hire_date: '2025-03-15', commission_pct: 2,  salary: 25000, active: true,  monthly_sales: 2380000, tickets_today: 0 },
    { id: 5, name: 'Ronald Pichardo',role: 'cashier', tipo: 'asesor',   phone: '849-555-1005', cedula: '005-1010105-9', hire_date: '2025-08-01', commission_pct: 1,  salary: 28000, active: true,  monthly_sales: 0,       tickets_today: 0 },
  ],
  contabilidad: [
    { id: 1, name: 'Yarisol Perla',  role: 'owner',      tipo: 'admin',     phone: '809-555-1101', cedula: '001-1111111-7', hire_date: '2022-09-01', commission_pct: 0, salary: 0,     active: true,  monthly_sales: 0, tickets_today: 0 },
    { id: 2, name: 'Lourdes Reyes',  role: 'accountant', tipo: 'contador',  phone: '829-555-1102', cedula: '002-2222222-7', hire_date: '2024-03-10', commission_pct: 0, salary: 48000, active: true,  monthly_sales: 0, tickets_today: 0 },
    { id: 3, name: 'Patricia Polanco',role: 'cashier',   tipo: 'asistente', phone: '809-555-1103', cedula: '003-3333333-7', hire_date: '2025-04-22', commission_pct: 0, salary: 24000, active: true,  monthly_sales: 0, tickets_today: 0 },
  ],
  facturacion: null, // alias to contabilidad below
  hybrid: [
    { id: 1, name: 'Mike Mejia',    role: 'owner',   tipo: 'admin',    phone: '809-555-1201', cedula: '001-1212121-1', hire_date: '2025-01-15', commission_pct: 0,  salary: 0,     active: true,  monthly_sales: 0,      tickets_today: 0 },
    { id: 2, name: 'Carmen Diaz',   role: 'cashier', tipo: 'cajero',   phone: '829-555-1202', cedula: '002-1212122-2', hire_date: '2025-08-10', commission_pct: 3,  salary: 18000, active: true,  monthly_sales: 380000, tickets_today: 35 },
    { id: 3, name: 'Sofia Almonte', role: 'cashier', tipo: 'vendedor', phone: '809-555-1203', cedula: '003-1212123-3', hire_date: '2025-09-22', commission_pct: 3,  salary: 16000, active: true,  monthly_sales: 240000, tickets_today: 22 },
    { id: 4, name: 'Juan Perez',    role: 'cashier', tipo: 'lavador',  phone: '809-555-1204', cedula: '004-1212124-4', hire_date: '2026-01-20', commission_pct: 30, salary: 0,     active: true,  monthly_sales: 124500, tickets_today: 8 },
  ],
}
SEEDS.facturacion = SEEDS.contabilidad
SEEDS.retail_default = SEEDS.retail

const DEFAULT_PROFILE = VERTICAL_PROFILES.carwash

export default function EmpleadosDemo({ vertical = 'carwash' }) {
  const profile = VERTICAL_PROFILES[vertical] || DEFAULT_PROFILE
  const seed    = SEEDS[vertical] || SEEDS.carwash
  const [staff]             = useState(seed)
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
    all:      staff.filter(e => e.active).length,
    op:       staff.filter(e => e.active && e.tipo === profile.opTipo).length,
    inactive: staff.filter(e => !e.active).length,
  }
  const totalSalary = staff.filter(e => e.active).reduce((s, e) => s + e.salary, 0)
  const totalCommissions = staff.filter(e => e.active && e.commission_pct > 0).reduce((s, e) => s + (e.monthly_sales * e.commission_pct / 100), 0)

  return (
    <div className="p-6 max-w-7xl mx-auto h-full overflow-y-auto bg-white">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 inline-flex items-center gap-3"><Briefcase size={24} className="text-[#b3001e]" /> Empleados</h1>
          <p className="text-sm text-slate-500 mt-1">{counts.all} activos · {counts.op} {profile.opLabel.toLowerCase()} · nómina {fmtRD(totalSalary)}/mes</p>
        </div>
        <button onClick={() => setEditing({})} className="inline-flex items-center gap-1.5 bg-[#b3001e] hover:bg-[#8c0017] text-white text-sm font-bold px-4 py-2 rounded-lg"><Plus size={14} /> Nuevo empleado</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="bg-white border border-slate-200 rounded-xl p-3"><p className="text-[10px] uppercase tracking-wider text-slate-400">Activos</p><p className="text-2xl font-bold text-slate-800 mt-1">{counts.all}</p></div>
        <div className="bg-white border border-slate-200 rounded-xl p-3"><p className="text-[10px] uppercase tracking-wider text-slate-400">{profile.opLabel}</p><p className="text-2xl font-bold text-slate-800 mt-1">{counts.op}</p></div>
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
          {profile.tipos.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
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
                <select defaultValue={editing.tipo} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white capitalize">{profile.tipos.map(t => <option key={t} value={t}>{t}</option>)}</select>
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
