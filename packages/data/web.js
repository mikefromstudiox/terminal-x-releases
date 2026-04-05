/**
 * web.js — Web/PWA data layer (Supabase).
 *
 * Provides the exact same API shape as window.electronAPI (see preload.js)
 * but backed by real Supabase queries instead of IPC calls.
 *
 * Usage:
 *   import { createClient } from '@supabase/supabase-js'
 *   import { createWebAPI, createWebPrinterAPI } from './data/web'
 *   const supabase = createClient(url, anonKey)
 *   window.electronAPI = createWebAPI(supabase, businessId)
 *   window.printerAPI  = createWebPrinterAPI()
 */

import { enqueueTicket } from '@terminal-x/services/offline-queue'

// ── Helpers ────────────────────────────────────────────────────────────────────

async function tryOr(fn, fallback) {
  try {
    const result = await fn()
    // Supabase returns null for empty results — coerce to fallback
    if (result === null && fallback !== undefined) return fallback
    return result
  } catch (err) {
    if (fallback !== undefined) return fallback
    throw err
  }
}

function throwSupaError(res) {
  if (res.error) throw new Error(res.error.message || res.error.code || 'Supabase error')
  return res.data
}

async function hashPin(pin) {
  const enc = new TextEncoder().encode(String(pin))
  const buf = await crypto.subtle.digest('SHA-256', enc)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ── Payroll helpers (shared by payrollRuns.create + bulkCreate) ────────────────
function buildPayrollRunRow(data, businessId) {
  const sfs_employee     = Number(data.sfs_employee || 0)
  const afp_employee     = Number(data.afp_employee || 0)
  const isr              = Number(data.isr || 0)
  const other_deductions = Number(data.other_deductions || 0)
  const deductions = data.deductions != null
    ? Number(data.deductions)
    : sfs_employee + afp_employee + isr + other_deductions
  return {
    empleado_id:      data.empleado_id,
    period_start:     data.period_start,
    period_end:       data.period_end,
    base:             Number(data.base || 0),
    commissions:      Number(data.commissions || 0),
    bonuses:          Number(data.bonuses || 0),
    sfs_employee, afp_employee, isr, other_deductions, deductions,
    sfs_employer:     Number(data.sfs_employer || 0),
    afp_employer:     Number(data.afp_employer || 0),
    infotep_employer: Number(data.infotep_employer || 0),
    net:              Number(data.net),
    notes:            data.notes || null,
    paid_by:          data.paid_by || null,
    business_id:      businessId,
  }
}

// Mark unpaid commissions within [from, to] as paid for an employee, based on tipo → ref_id.
// Commissions attach to tickets whose created_at falls in the date range.
async function markCommissionsPaidForEmpleado(supabase, businessId, empleadoId, from, to) {
  const { data: emp } = await supabase.from('empleados').select('tipo, ref_id').eq('id', empleadoId).single()
  if (!emp || !emp.ref_id) return 0
  const table = emp.tipo === 'lavador'  ? 'washer_commissions'
              : emp.tipo === 'vendedor' ? 'seller_commissions'
              : emp.tipo === 'cajero'   ? 'cajero_commissions'
              : null
  if (!table) return 0
  const col = emp.tipo === 'lavador' ? 'washer_id' : emp.tipo === 'vendedor' ? 'seller_id' : 'cajero_id'
  // Find tickets in the date range, then update only rows whose ticket_id is in that set
  const { data: tickets } = await supabase.from('tickets').select('id')
    .eq('business_id', businessId)
    .gte('created_at', from)
    .lte('created_at', to + ' 23:59:59')
  const ticketIds = (tickets || []).map(t => t.id)
  if (ticketIds.length === 0) return 0
  const { data: updated } = await supabase.from(table)
    .update({ paid: true, paid_at: new Date().toISOString() })
    .eq('business_id', businessId).eq(col, emp.ref_id).eq('paid', false)
    .in('ticket_id', ticketIds)
    .select('id')
  return (updated || []).length
}

// ── Main factory ───────────────────────────────────────────────────────────────

export function createWebAPI(supabase, businessId) {
  const bid = businessId

  // Shorthand: select from a table scoped to this business
  function from(table) {
    return supabase.from(table).select('*').eq('business_id', bid)
  }

  return {

    // ── Admin panel ──────────────────────────────────────────────────────────

    admin: {
      getEmpresa: () => tryOr(async () => {
        const { data } = await supabase.from('businesses').select('id,name,rnc,address,phone,email,logo_url,settings').eq('id', bid).single()
        if (data) data.logo = data.logo_url  // map to desktop field name
        return data
      }, null),

      saveEmpresa: (data) => tryOr(async () => {
        const allowed = ['name', 'rnc', 'address', 'phone', 'email', 'logo', 'settings']
        const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
        if (!Object.keys(patch).length) return null
        throwSupaError(await supabase.from('businesses').update(patch).eq('id', bid))
      }),

      getUsuarios: () => tryOr(async () => {
        return throwSupaError(await supabase.from('users').select('id,name,username,role,discount_pct,active').eq('business_id', bid).order('id'))
      }, []),

      saveUsuario: (data) => tryOr(async () => {
        if (data.id) {
          const { pin, id, ...rest } = data
          if (pin) rest.pin_hash = await hashPin(pin)
          throwSupaError(await supabase.from('users').update(rest).eq('id', id).eq('business_id', bid))
          return { id }
        }
        if (!data.pin) throw new Error('PIN requerido')
        const pin_hash = await hashPin(data.pin)
        const { pin: _p, ...rest } = data
        const row = throwSupaError(await supabase.from('users').insert({ id: crypto.randomUUID(), ...rest, pin_hash, business_id: bid }).select('id').single())
        return row
      }),

      deleteUsuario: ({ id }) => tryOr(async () => {
        throwSupaError(await supabase.from('users').update({ active: 0 }).eq('id', id).eq('business_id', bid))
      }),

      getLavadores: () => tryOr(async () => {
        return throwSupaError(await supabase.from('washers').select('*').eq('business_id', bid).order('name'))
      }, []),

      saveLavador: (data) => tryOr(async () => {
        if (data.id) {
          const { id, ...rest } = data
          throwSupaError(await supabase.from('washers').update(rest).eq('id', id).eq('business_id', bid))
          return { id }
        }
        const row = throwSupaError(await supabase.from('washers').insert({ ...data, business_id: bid, active: 1 }).select('id').single())
        return row
      }),

      deleteLavador: ({ id }) => tryOr(async () => {
        throwSupaError(await supabase.from('washers').update({ active: 0 }).eq('id', id).eq('business_id', bid))
      }),

      getVendedores: () => tryOr(async () => {
        return throwSupaError(await supabase.from('sellers').select('*').eq('business_id', bid).order('name'))
      }, []),

      saveVendedor: (data) => tryOr(async () => {
        if (data.id) {
          const { id, ...rest } = data
          throwSupaError(await supabase.from('sellers').update(rest).eq('id', id).eq('business_id', bid))
          return { id }
        }
        const row = throwSupaError(await supabase.from('sellers').insert({ ...data, business_id: bid, active: 1 }).select('id').single())
        return row
      }),

      deleteVendedor: ({ id }) => tryOr(async () => {
        throwSupaError(await supabase.from('sellers').update({ active: 0 }).eq('id', id).eq('business_id', bid))
      }),

      getServicios: () => tryOr(async () => {
        return throwSupaError(await supabase.from('services').select('*').eq('business_id', bid).order('category').order('sort_order').order('id'))
      }, []),

      saveServicio: (data) => tryOr(async () => {
        if (data.id) {
          const { id, ...rest } = data
          throwSupaError(await supabase.from('services').update(rest).eq('id', id).eq('business_id', bid))
          return { id }
        }
        const row = throwSupaError(await supabase.from('services').insert({ ...data, business_id: bid, active: 1 }).select('id').single())
        return row
      }),

      deleteServicio: ({ id }) => tryOr(async () => {
        throwSupaError(await supabase.from('services').update({ active: 0 }).eq('id', id).eq('business_id', bid))
      }),

      getCategorias: () => tryOr(async () => {
        return throwSupaError(await supabase.from('categorias_servicio').select('*').eq('business_id', bid).order('orden').order('nombre'))
      }, []),

      getSecuenciasNcf: () => tryOr(async () => {
        return throwSupaError(await supabase.from('ncf_sequences').select('*').eq('business_id', bid).order('type'))
      }, []),

      saveSecuenciaNcf: (data) => tryOr(async () => {
        if (data.type) {
          throwSupaError(await supabase.from('ncf_sequences').upsert({ ...data, business_id: bid }, { onConflict: 'business_id,type' }))
        }
      }),

      getConfiguracion: () => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('configuracion').select('clave,valor').eq('business_id', bid))
        return Object.fromEntries((rows || []).map(r => [r.clave, r.valor]))
      }, {}),

      saveConfiguracion: (data) => tryOr(async () => {
        const entries = Object.entries(data)
        for (const [clave, valor] of entries) {
          throwSupaError(await supabase.from('configuracion').upsert(
            { business_id: bid, clave, valor: String(valor) },
            { onConflict: 'business_id,clave' }
          ))
        }
      }),
    },

    // ── Settings ─────────────────────────────────────────────────────────────

    settings: {
      get: () => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('app_settings').select('key,value').eq('business_id', bid))
        return Object.fromEntries((rows || []).map(r => [r.key, r.value]))
      }, {}),

      update: (obj) => tryOr(async () => {
        for (const [key, value] of Object.entries(obj)) {
          throwSupaError(await supabase.from('app_settings').upsert(
            { business_id: bid, key, value: String(value) },
            { onConflict: 'business_id,key' }
          ))
        }
      }),
    },

    // ── Inventory ────────────────────────────────────────────────────────────

    inventory: {
      all: () => tryOr(async () => {
        return throwSupaError(await supabase.from('inventory_items').select('*').eq('business_id', bid).eq('active', true).order('name'))
      }, []),

      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('inventory_items').insert({ ...data, business_id: bid }).select('id').single())
        return row.id
      }),

      update: (data) => tryOr(async () => {
        const { id, ...rest } = data
        throwSupaError(await supabase.from('inventory_items').update(rest).eq('id', id).eq('business_id', bid))
      }),

      delete: (data) => tryOr(async () => {
        const id = typeof data === 'object' ? data.id : data
        throwSupaError(await supabase.from('inventory_items').update({ active: false }).eq('id', id).eq('business_id', bid))
      }),

      adjust: ({ id, delta, notes, userId }) => tryOr(async () => {
        // Use RPC for atomic increment
        throwSupaError(await supabase.rpc('inventory_adjust', {
          p_business_id: bid, p_item_id: id, p_delta: delta,
          p_notes: notes || '', p_user_id: userId || null,
        }))
        const item = throwSupaError(await supabase.from('inventory_items').select('quantity').eq('id', id).single())
        return item?.quantity ?? null
      }),

      transactions: ({ id }) => tryOr(async () => {
        return throwSupaError(
          await supabase.from('inventory_transactions').select('*, staff!user_id(name)')
            .eq('item_id', id).order('created_at', { ascending: false }).limit(50)
        )
      }, []),
    },

    // ── Auth ─────────────────────────────────────────────────────────────────

    auth: {
      byPin: (pin) => tryOr(async () => {
        const hash = await hashPin(pin)
        const { data } = await supabase.from('users')
          .select('id,name,username,role,discount_pct')
          .eq('business_id', bid).eq('pin_hash', hash).eq('active', true)
          .single()
        return data || null
      }, null),
    },

    // ── Users ────────────────────────────────────────────────────────────────

    users: {
      all: () => tryOr(async () => {
        return throwSupaError(await supabase.from('users').select('id,name,username,role,discount_pct,active').eq('business_id', bid).order('id'))
      }, []),

      create: (data) => tryOr(async () => {
        if (!data.pin) throw new Error('PIN requerido')
        const pin_hash = await hashPin(data.pin)
        const { pin: _p, ...rest } = data
        const row = throwSupaError(await supabase.from('users').insert({ id: crypto.randomUUID(), ...rest, pin_hash, business_id: bid, active: true }).select('id').single())
        return row
      }),

      update: (data) => tryOr(async () => {
        const { id, pin, ...rest } = data
        if (pin) rest.pin_hash = await hashPin(pin)
        throwSupaError(await supabase.from('users').update(rest).eq('id', id).eq('business_id', bid))
      }),
    },

    // ── Categorias ───────────────────────────────────────────────────────────

    categorias: {
      all: () => tryOr(async () => {
        return throwSupaError(await supabase.from('categorias_servicio').select('*').eq('business_id', bid).order('orden').order('nombre'))
      }, []),

      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('categorias_servicio').insert({
          nombre: data.nombre, orden: data.orden || 0, business_id: bid,
        }).select('id').single())
        return { id: row.id }
      }),

      update: (data) => tryOr(async () => {
        const { id, ...rest } = data
        const allowed = ['nombre', 'orden']
        const patch = Object.fromEntries(Object.entries(rest).filter(([k]) => allowed.includes(k)))
        throwSupaError(await supabase.from('categorias_servicio').update(patch).eq('id', id).eq('business_id', bid))
      }),

      delete: (id) => tryOr(async () => {
        const actualId = typeof id === 'object' ? id.id : id
        // Check if any services reference this category
        const { count } = await supabase.from('services').select('id', { count: 'exact', head: true })
          .eq('business_id', bid).eq('categoria_id', actualId)
        if (count > 0) throw new Error('Categoria tiene servicios asociados')
        throwSupaError(await supabase.from('categorias_servicio').delete().eq('id', actualId).eq('business_id', bid))
      }),
    },

    // ── Services ─────────────────────────────────────────────────────────────

    services: {
      all: () => tryOr(async () => {
        return throwSupaError(
          await supabase.from('services').select('*').eq('business_id', bid).eq('active', true)
            .order('category').order('sort_order').order('id')
        )
      }, []),

      allAdmin: () => tryOr(async () => {
        return throwSupaError(
          await supabase.from('services').select('*').eq('business_id', bid)
            .order('category').order('sort_order').order('id')
        )
      }, []),

      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('services').insert({
          name: data.name, name_en: data.name_en || null,
          category: data.category || 'Lavado', categoria_id: data.categoria_id || null,
          price: data.price, cost: data.cost || 0, aplica_itbis: data.aplica_itbis ?? 1,
          is_wash: data.is_wash ?? 1, active: true, sort_order: data.sort_order || 0,
          business_id: bid,
        }).select('id').single())
        return { id: row.id }
      }),

      update: (data) => tryOr(async () => {
        const { id, ...rest } = data
        const allowed = ['name', 'name_en', 'category', 'categoria_id', 'price', 'cost', 'aplica_itbis', 'is_wash', 'active', 'sort_order']
        const patch = Object.fromEntries(Object.entries(rest).filter(([k]) => allowed.includes(k)))
        throwSupaError(await supabase.from('services').update(patch).eq('id', id).eq('business_id', bid))
      }),
    },

    // ── Washers ──────────────────────────────────────────────────────────────

    washers: {
      all: () => tryOr(async () => {
        return throwSupaError(await supabase.from('washers').select('*').eq('business_id', bid).eq('active', true).order('name'))
      }, []),

      allAdmin: () => tryOr(async () => {
        return throwSupaError(await supabase.from('washers').select('*').eq('business_id', bid).order('name'))
      }, []),

      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('washers').insert({
          name: data.name, phone: data.phone || null, cedula: data.cedula || null,
          commission_pct: data.commission_pct || 20, start_date: data.start_date || null,
          active: true, business_id: bid,
        }).select('id').single())
        return { id: row.id }
      }),

      update: (data) => tryOr(async () => {
        const { id, ...rest } = data
        const allowed = ['name', 'phone', 'cedula', 'commission_pct', 'start_date', 'active']
        const patch = Object.fromEntries(Object.entries(rest).filter(([k]) => allowed.includes(k)))
        throwSupaError(await supabase.from('washers').update(patch).eq('id', id).eq('business_id', bid))
      }),
    },

    // ── Sellers ──────────────────────────────────────────────────────────────

    sellers: {
      all: () => tryOr(async () => {
        return throwSupaError(await supabase.from('sellers').select('*').eq('business_id', bid).eq('active', true).order('name'))
      }, []),

      allAdmin: () => tryOr(async () => {
        return throwSupaError(await supabase.from('sellers').select('*').eq('business_id', bid).order('name'))
      }, []),

      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('sellers').insert({
          name: data.name, commission_pct: data.commission_pct || 5,
          phone: data.phone || null, active: true, business_id: bid,
        }).select('id').single())
        return { id: row.id }
      }),

      update: (data) => tryOr(async () => {
        const { id, ...rest } = data
        const allowed = ['name', 'commission_pct', 'phone', 'active']
        const patch = Object.fromEntries(Object.entries(rest).filter(([k]) => allowed.includes(k)))
        throwSupaError(await supabase.from('sellers').update(patch).eq('id', id).eq('business_id', bid))
      }),
    },

    // ── Empleados (payroll) ────────────────────────────────────────────────

    empleados: {
      all: () => tryOr(async () => {
        return throwSupaError(await supabase.from('empleados').select('*').eq('business_id', bid).eq('active', true).order('nombre'))
      }, []),

      allAdmin: () => tryOr(async () => {
        return throwSupaError(await supabase.from('empleados').select('*').eq('business_id', bid).order('nombre'))
      }, []),

      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('empleados').insert({
          nombre: data.nombre, tipo: data.tipo, ref_id: data.ref_id || null,
          salary: data.salary || 0, start_date: data.start_date,
          cedula: data.cedula || null, phone: data.phone || null,
          puesto: data.puesto || null, email: data.email || null,
          bank_account: data.bank_account || null, tss_id: data.tss_id || null,
          active: true, business_id: bid,
        }).select('id').single())
        return { id: row.id }
      }),

      update: (data) => tryOr(async () => {
        const { id, salary_change_reason, changed_by, ...rest } = data
        const allowed = ['nombre','tipo','ref_id','salary','start_date','cedula','phone','puesto','email','bank_account','tss_id','active']
        const patch = Object.fromEntries(Object.entries(rest).filter(([k]) => allowed.includes(k)))
        // Auto-log salary change: fetch current, compare, insert salary_changes row.
        if (patch.salary != null) {
          const { data: current } = await supabase.from('empleados').select('salary').eq('id', id).eq('business_id', bid).single()
          const oldSalary = Number(current?.salary || 0)
          const newSalary = Number(patch.salary || 0)
          if (current && oldSalary !== newSalary) {
            await supabase.from('salary_changes').insert({
              empleado_id: id, old_salary: oldSalary, new_salary: newSalary,
              effective_date: new Date().toISOString().slice(0, 10),
              reason: salary_change_reason || null,
              business_id: bid,
            })
          }
        }
        throwSupaError(await supabase.from('empleados').update(patch).eq('id', id).eq('business_id', bid))
      }),

      delete: (id) => tryOr(async () => {
        throwSupaError(await supabase.from('empleados').update({ active: false }).eq('id', id).eq('business_id', bid))
      }),
    },

    // ── Payroll runs (paycheck history) ─────────────────────────────────────
    payrollRuns: {
      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('payroll_runs').insert(
          buildPayrollRunRow(data, bid)
        ).select('id').single())
        // Auto-mark underlying commissions as paid
        if ((Number(data.commissions) || 0) > 0) {
          try { await markCommissionsPaidForEmpleado(supabase, bid, data.empleado_id, data.period_start, data.period_end) } catch {}
        }
        return { id: row.id }
      }),
      bulkCreate: (runs) => tryOr(async () => {
        if (!Array.isArray(runs) || runs.length === 0) return { created: 0, ids: [] }
        const rows = runs.map(r => buildPayrollRunRow(r, bid))
        const inserted = throwSupaError(await supabase.from('payroll_runs').insert(rows).select('id'))
        // Fire-and-forget mark-paid for each employee's commissions in its period
        for (const r of runs) {
          if ((Number(r.commissions) || 0) > 0) {
            try { await markCommissionsPaidForEmpleado(supabase, bid, r.empleado_id, r.period_start, r.period_end) } catch {}
          }
        }
        return { created: (inserted || []).length, ids: (inserted || []).map(x => x.id) }
      }, { created: 0, ids: [] }),
      byEmpleado: (empleadoId, limit = 100) => tryOr(async () => {
        return throwSupaError(
          await supabase.from('payroll_runs').select('*')
            .eq('business_id', bid).eq('empleado_id', empleadoId)
            .order('paid_at', { ascending: false }).limit(limit)
        )
      }, []),
      byPeriod: (from, to) => tryOr(async () => {
        let q = supabase.from('payroll_runs')
          .select('*, empleados(nombre, tipo)')
          .eq('business_id', bid)
          .order('paid_at', { ascending: false })
        if (from) q = q.gte('paid_at', from)
        if (to)   q = q.lte('paid_at', to + ' 23:59:59')
        const rows = throwSupaError(await q)
        return (rows || []).map(r => ({
          ...r,
          empleado_nombre: r.empleados?.nombre || null,
          empleado_tipo:   r.empleados?.tipo || null,
        }))
      }, []),
      remove: (id) => tryOr(async () => {
        throwSupaError(await supabase.from('payroll_runs').delete().eq('id', id).eq('business_id', bid))
      }),
    },

    // ── Payroll settings (per-business config) ──────────────────────────────
    payrollSettings: {
      get: () => tryOr(async () => {
        const { data } = await supabase.from('payroll_settings').select('*').eq('business_id', bid).maybeSingle()
        if (!data) return null
        // Supabase returns isr_brackets already parsed (jsonb). Leave as-is.
        return data
      }, null),
      update: (data) => tryOr(async () => {
        const allowed = [
          'pay_cycle',
          'sfs_employee_rate','afp_employee_rate',
          'sfs_employer_rate','afp_employer_rate','infotep_employer_rate',
          'sfs_monthly_cap','afp_monthly_cap',
          'isr_enabled','isr_brackets',
          'navidad_enabled','vacation_days','daily_divisor',
        ]
        const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
        // Upsert: one row per business (UNIQUE constraint on business_id)
        throwSupaError(await supabase.from('payroll_settings')
          .upsert({ ...patch, business_id: bid, updated_at: new Date().toISOString() }, { onConflict: 'business_id' }))
      }),
    },

    // ── Salary changes (audit log) ──────────────────────────────────────────
    salaryChanges: {
      byEmpleado: (empleadoId) => tryOr(async () => {
        return throwSupaError(
          await supabase.from('salary_changes').select('*')
            .eq('business_id', bid).eq('empleado_id', empleadoId)
            .order('effective_date', { ascending: false }).order('id', { ascending: false })
        )
      }, []),
    },

    // ── Clients ──────────────────────────────────────────────────────────────

    clients: {
      all: () => tryOr(async () => {
        return throwSupaError(await supabase.from('clients').select('*').eq('business_id', bid).eq('active', true).order('name'))
      }, []),

      byId: (id) => tryOr(async () => {
        const { data } = await supabase.from('clients').select('*').eq('id', id).eq('business_id', bid).single()
        return data || null
      }, null),

      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('clients').insert({
          name: data.name, rnc: data.rnc || null, phone: data.phone || null,
          email: data.email || null, address: data.address || null,
          credit_limit: data.credit_limit || 0, balance: 0, business_id: bid,
        }).select('id').single())
        return row
      }),

      update: (data) => tryOr(async () => {
        const { id, ...rest } = data
        const allowed = ['name', 'rnc', 'phone', 'email', 'address', 'credit_limit', 'balance', 'visits', 'total_spent', 'active']
        const patch = Object.fromEntries(Object.entries(rest).filter(([k]) => allowed.includes(k)))
        throwSupaError(await supabase.from('clients').update(patch).eq('id', id).eq('business_id', bid))
      }),

      updateBalance: ({ id, delta }) => tryOr(async () => {
        throwSupaError(await supabase.rpc('client_update_balance', {
          p_client_id: id, p_delta: delta, p_business_id: bid,
        }))
      }),

      openTickets: (clientId) => tryOr(async () => {
        const { data: tickets } = await supabase.from('tickets')
          .select('*')
          .eq('business_id', bid).eq('client_id', clientId)
          .eq('tipo_venta', 'credito').eq('status', 'pendiente')
          .order('created_at', { ascending: true })
        if (!tickets?.length) return []
        // Fetch items separately
        const ticketIds = tickets.map(t => t.id)
        const { data: allItems } = await supabase.from('ticket_items')
          .select('ticket_id, name, price, is_wash').in('ticket_id', ticketIds)
        const itemsMap = {}
        for (const i of (allItems || [])) {
          if (!itemsMap[i.ticket_id]) itemsMap[i.ticket_id] = []
          itemsMap[i.ticket_id].push(i)
        }
        return tickets.map(t => ({
          ...t,
          items: (itemsMap[t.id] || []).filter(i => i.name != null),
        }))
      }, []),
    },

    credits: {
      collect: (data) => tryOr(async () => {
        return throwSupaError(await supabase.rpc('collect_credit', {
          p_business_id: bid,
          p_client_id: data.clientId,
          p_ticket_ids: data.ticketIds,
          p_amount: data.amount,
          p_payment_method: data.paymentMethod,
          p_ncf: data.ncf || null,
          p_notes: data.notes || null,
          p_cajero_id: data.cajeroId || null,
        }))
      }),
    },

    // ── Tickets ──────────────────────────────────────────────────────────────

    tickets: {
      all: (params = {}) => tryOr(async () => {
        const { dateFrom, dateTo, status, limit = 200 } = params
        const safeLimit = Math.min(limit || 200, 500)
        let q = supabase.from('tickets').select('*').eq('business_id', bid)
        if (dateFrom) q = q.gte('created_at', dateFrom)
        if (dateTo)   q = q.lte('created_at', dateTo)
        if (status)   q = q.eq('status', status)
        q = q.order('created_at', { ascending: false }).limit(safeLimit)
        const rows = throwSupaError(await q)
        if (!rows?.length) return []

        // Fetch client names
        const clientIds = [...new Set(rows.map(r => r.client_id).filter(Boolean))]
        let clientMap = {}
        if (clientIds.length) {
          const { data: cls } = await supabase.from('clients').select('id, name, rnc').in('id', clientIds)
          for (const c of (cls || [])) clientMap[c.id] = c
        }

        // Fetch cajero names
        const cajeroIds = [...new Set(rows.map(r => r.cajero_id).filter(Boolean))]
        let cajeroMap = {}
        if (cajeroIds.length) {
          const { data: staff } = await supabase.from('staff').select('id, name').in('id', cajeroIds)
          for (const s of (staff || [])) cajeroMap[s.id] = s
        }

        return rows.map(r => ({
          ...r,
          client_name: clientMap[r.client_id]?.name || null,
          client_rnc:  clientMap[r.client_id]?.rnc  || null,
          cajero_name: cajeroMap[r.cajero_id]?.name  || null,
        }))
      }, []),

      byId: (id) => tryOr(async () => {
        const { data: ticket } = await supabase.from('tickets')
          .select('*')
          .eq('id', id).eq('business_id', bid).single()
        if (!ticket) return null

        // Fetch items separately (PostgREST joins can fail on FK naming)
        const { data: itemRows } = await supabase.from('ticket_items')
          .select('*').eq('ticket_id', id)
        const items = (itemRows || []).filter(i => i.name != null)

        // Fetch client name
        let client_name = null, client_rnc = null
        if (ticket.client_id) {
          const { data: cl } = await supabase.from('clients')
            .select('name, rnc').eq('id', ticket.client_id).single()
          if (cl) { client_name = cl.name; client_rnc = cl.rnc }
        }

        // Fetch cajero name
        let cajero_name = null
        if (ticket.cajero_id) {
          const { data: cj } = await supabase.from('staff')
            .select('name').eq('id', ticket.cajero_id).single()
          if (cj) cajero_name = cj.name
        }

        let ecf_result = {}
        try { ecf_result = typeof ticket.ecf_result === 'string' ? JSON.parse(ticket.ecf_result) : (ticket.ecf_result || {}) } catch {}
        let washer_ids = []
        try { washer_ids = typeof ticket.washer_ids === 'string' ? JSON.parse(ticket.washer_ids) : (ticket.washer_ids || []) } catch {}
        return {
          ...ticket,
          client_name,
          client_rnc,
          cajero_name,
          items,
          ecf_result,
          washer_ids,
        }
      }, null),

      create: async (data) => {
        try {
          return await tryOr(async () => {
            // Generate doc_number
            const { count } = await supabase.from('tickets')
              .select('id', { count: 'exact', head: true })
              .eq('business_id', bid)
            const docNum = `T-${String((count || 0) + 1).padStart(4, '0')}`

            const status = data.status || (data.tipo_venta === 'credito' || data.payment_method === 'credit' ? 'pendiente' : 'cobrado')

            // Insert ticket
            const ticket = throwSupaError(await supabase.from('tickets').insert({
              business_id:     bid,
              doc_number:      docNum,
              client_id:       data.client_id || null,
              washer_ids:      data.washer_ids || [],
              seller_id:       data.seller_id || null,
              cajero_id:       data.cajero_id || null,
              subtotal:        data.subtotal || 0,
              descuento:       data.descuento || 0,
              itbis:           data.itbis || 0,
              ley:             data.ley || 0,
              total:           data.total || 0,
              payment_method:  data.payment_method || 'cash',
              comprobante_type:data.comprobante_type || 'B02',
              ecf_result:      data.ecf_result || {},
              tipo_venta:      data.tipo_venta || 'contado',
              status,
              vehicle_plate:   data.vehicle_plate || null,
              notes:           data.notes || null,
            }).select().single())

            // Insert ticket items — try with business_id first, fall back without
            // Snapshot each item's cost at sale time for historical profit accuracy.
            // Look up current service costs once, then fall back to explicit item.cost.
            const items = data.items || []
            let svcCostById = new Map()
            if (items.length && ticket?.id) {
              const svcIds = items.map(i => i.service_id).filter(Boolean)
              if (svcIds.length) {
                const { data: svcRows } = await supabase.from('services').select('id, cost').in('id', svcIds)
                svcCostById = new Map((svcRows || []).map(r => [r.id, r.cost || 0]))
              }
              const itemRows = items.map(i => ({
                ticket_id:   ticket.id,
                service_id:  i.service_id || null,
                name:        i.name,
                price:       i.price,
                cost:        i.cost != null ? Number(i.cost) : (i.service_id ? (svcCostById.get(i.service_id) || 0) : 0),
                itbis:       i.itbis || 0,
                is_wash:     i.is_wash ?? true,
              }))
              // Try with business_id (some Supabase schemas have it)
              const { error: err1 } = await supabase.from('ticket_items').insert(
                itemRows.map(r => ({ ...r, business_id: bid }))
              )
              if (err1) {
                // Retry without business_id
                const { error: err2 } = await supabase.from('ticket_items').insert(itemRows)
                if (err2) console.warn('[ticket_items insert]', err2.message)
              }
            }

            // Commission calculations — service prices include 18% ITBIS, strip it out
            const bevSub = data.beverage_subtotal || 0
            const commBase = parseFloat(((data.subtotal - bevSub) / 1.18).toFixed(2))
            const bevBase  = bevSub > 0 ? parseFloat((bevSub / 1.18).toFixed(2)) : 0

            // Washer commissions — only on wash/service items (NOT beverages/snacks)
            if (ticket?.id && commBase > 0 && Array.isArray(data.washer_ids) && data.washer_ids.length) {
              try {
                const { data: washerRows } = await supabase.from('washers')
                  .select('id, commission_pct').in('id', data.washer_ids)
                for (const w of (washerRows || [])) {
                  const pct = w.commission_pct || 0
                  if (pct <= 0) continue
                  const amt = parseFloat((commBase * pct / 100).toFixed(2))
                  await supabase.from('washer_commissions').insert({
                    business_id: bid, washer_id: w.id, ticket_id: ticket.id,
                    base_amount: commBase, commission_pct: pct, commission_amount: amt, paid: false,
                  })
                }
              } catch { /* commission insert failed — non-fatal */ }
            }

            // Seller commission — only on wash/service items (NOT beverages/snacks)
            if (ticket?.id && commBase > 0 && data.seller_id) {
              try {
                const { data: seller } = await supabase.from('sellers')
                  .select('id, commission_pct').eq('id', data.seller_id).single()
                if (seller && seller.commission_pct > 0) {
                  const amt = parseFloat((commBase * seller.commission_pct / 100).toFixed(2))
                  await supabase.from('seller_commissions').insert({
                    business_id: bid, seller_id: seller.id, ticket_id: ticket.id,
                    base_amount: commBase, commission_pct: seller.commission_pct, commission_amount: amt, paid: false,
                  })
                }
              } catch { /* seller commission insert failed — non-fatal */ }
            }

            // Cajero commission — on beverages/snacks ONLY
            if (ticket?.id && bevBase > 0 && data.cajero_id) {
              try {
                const { data: cajero } = await supabase.from('staff')
                  .select('id, commission_pct').eq('id', data.cajero_id).single()
                if (cajero && cajero.commission_pct > 0) {
                  const amt = parseFloat((bevBase * cajero.commission_pct / 100).toFixed(2))
                  await supabase.from('cajero_commissions').insert({
                    business_id: bid, cajero_id: cajero.id, ticket_id: ticket.id,
                    base_amount: bevBase, commission_pct: cajero.commission_pct, commission_amount: amt, paid: false,
                  })
                }
              } catch { /* cajero commission insert failed — non-fatal */ }
            }

            // Auto-add to queue (same as desktop database.js)
            let queueError = null
            if (ticket?.id) {
              const firstWasher = Array.isArray(data.washer_ids) && data.washer_ids[0] ? data.washer_ids[0] : null
              const { error: queueErr } = await supabase.from('queue').insert({
                business_id: bid,
                ticket_id:   ticket.id,
                status:      'waiting',
                washer_id:   firstWasher,
              })
              if (queueErr) queueError = queueErr.message
            }

            // Update client balance for credit sales
            if (status === 'pendiente' && data.client_id) {
              await supabase.rpc('increment_client_balance', { cid: data.client_id, delta: data.total })
                .catch(() => {
                  // Fallback if RPC doesn't exist: manual update
                  supabase.from('clients')
                    .select('balance').eq('id', data.client_id).single()
                    .then(({ data: cl }) => {
                      if (cl) supabase.from('clients').update({ balance: (cl.balance || 0) + (data.total || 0) }).eq('id', data.client_id)
                    })
                })
            }

            return { id: ticket.id, docNumber: docNum, ncf: null, queueError }
          })
        } catch (err) {
          // Supabase unreachable — save to offline queue
          const offlineId = await enqueueTicket(data)
          return { id: `offline-${offlineId}`, docNumber: 'OFFLINE', ncf: null, offline: true, offlineReason: err?.message || String(err) }
        }
      },

      markPaid: (data) => tryOr(async () => {
        const updates = { status: 'cobrado' }
        if (data.paymentMethod || data.payment_method) updates.payment_method = data.paymentMethod || data.payment_method
        if (data.ncf) updates.ncf = data.ncf
        if (data.ecfResult || data.ecf_result) updates.ecf_result = data.ecfResult || data.ecf_result
        if (data.tipoVenta || data.tipo_venta) updates.tipo_venta = data.tipoVenta || data.tipo_venta
        if (data.clientId || data.client_id) updates.client_id = data.clientId || data.client_id

        const ticketId = data.id || data.ticket_id
        throwSupaError(await supabase.from('tickets').update(updates).eq('id', ticketId).eq('business_id', bid))

        // Update queue status to done
        await supabase.from('queue').update({ status: 'done', completed_at: new Date().toISOString() })
          .eq('ticket_id', ticketId).eq('business_id', bid)

        return { id: ticketId }
      }),

      void: (data) => tryOr(async () => {
        const { id, reason, voidBy } = typeof data === 'object' ? data : { id: data }
        throwSupaError(await supabase.from('tickets').update({
          status: 'nula',
          void_reason: reason || '',
          void_by: voidBy || null,
          void_at: new Date().toISOString(),
        }).eq('id', id).eq('business_id', bid))
      }),

      byDateRange: (params) => tryOr(async () => {
        const { dateFrom, dateTo } = params
        let q = supabase.from('tickets').select('*').eq('business_id', bid)
        if (dateFrom) q = q.gte('created_at', dateFrom)
        if (dateTo)   q = q.lte('created_at', dateTo)
        q = q.order('created_at', { ascending: false }).limit(500)
        const rows = throwSupaError(await q)
        if (!rows?.length) return []

        // Fetch items for all tickets
        const ticketIds = rows.map(r => r.id)
        const { data: allItems } = await supabase.from('ticket_items')
          .select('ticket_id, name, price, is_wash').in('ticket_id', ticketIds)
        const itemsMap = {}
        for (const i of (allItems || [])) {
          if (!itemsMap[i.ticket_id]) itemsMap[i.ticket_id] = []
          itemsMap[i.ticket_id].push(i)
        }

        // Fetch client names
        const clientIds = [...new Set(rows.map(r => r.client_id).filter(Boolean))]
        let clientMap = {}
        if (clientIds.length) {
          const { data: cls } = await supabase.from('clients').select('id, name, rnc').in('id', clientIds)
          for (const c of (cls || [])) clientMap[c.id] = c
        }

        // Fetch cajero names
        const cajeroIds = [...new Set(rows.map(r => r.cajero_id).filter(Boolean))]
        let cajeroMap = {}
        if (cajeroIds.length) {
          const { data: staff } = await supabase.from('staff').select('id, name').in('id', cajeroIds)
          for (const s of (staff || [])) cajeroMap[s.id] = s
        }

        return rows.map(r => {
          const items = (itemsMap[r.id] || []).filter(i => i.name != null)
          return {
            ...r,
            items,
            service_names: items.map(i => i.name).join(' + ') || null,
            client_name: clientMap[r.client_id]?.name || null,
            client_rnc:  clientMap[r.client_id]?.rnc  || null,
            cajero_name: cajeroMap[r.cajero_id]?.name  || null,
          }
        })
      }, []),
    },

    // ── Queue ────────────────────────────────────────────────────────────────

    queue: {
      active: () => tryOr(async () => {
        // Fetch queue rows with ticket data (no deep nested joins — PostgREST limitation)
        const { data: rows, error: qErr } = await supabase.from('queue')
          .select('*, tickets(id, doc_number, total, vehicle_plate, created_at, client_id), washers(name)')
          .eq('business_id', bid).not('status', 'in', '("done","cancelled")')
          .order('created_at', { ascending: true })
        if (qErr) throw new Error(qErr.message)

        if (!rows?.length) return []

        // Fetch client names and ticket items separately
        const ticketIds = rows.map(q => q.tickets?.id).filter(Boolean)
        const clientIds = rows.map(q => q.tickets?.client_id).filter(Boolean)

        let clientMap = {}
        if (clientIds.length) {
          const { data: cls } = await supabase.from('clients').select('id, name').in('id', clientIds)
          for (const c of (cls || [])) clientMap[c.id] = c.name
        }

        let itemsMap = {}
        if (ticketIds.length) {
          const { data: items } = await supabase.from('ticket_items').select('ticket_id, name').in('ticket_id', ticketIds)
          for (const i of (items || [])) {
            if (!itemsMap[i.ticket_id]) itemsMap[i.ticket_id] = []
            itemsMap[i.ticket_id].push(i.name)
          }
        }

        return rows.map(q => ({
          ...q,
          doc_number:     q.tickets?.doc_number    || null,
          total:          q.tickets?.total          || 0,
          vehicle_plate:  q.tickets?.vehicle_plate  || null,
          ticket_created: q.tickets?.created_at     || null,
          client_name:    clientMap[q.tickets?.client_id] || null,
          services:       (itemsMap[q.tickets?.id] || []).join(' + '),
          washer_name:    q.washers?.name           || null,
          tickets: undefined,
          washers: undefined,
        }))
      }, []),

      updateStatus: (data) => tryOr(async () => {
        const { id, status, washerId } = data
        const now = new Date().toISOString()
        const patch = { status }
        if (status === 'in_progress') {
          patch.washer_id = washerId || null
          patch.assigned_at = now
        } else if (status === 'done') {
          patch.completed_at = now
        }
        throwSupaError(await supabase.from('queue').update(patch).eq('id', id).eq('business_id', bid))
      }),

      delete: (data) => tryOr(async () => {
        const { id, deletedBy } = data
        const now = new Date().toISOString()
        const row = await supabase.from('queue').select('ticket_id').eq('id', id).single()
        if (row.error) throw new Error(row.error.message)
        await supabase.from('queue').update({ status: 'cancelled', completed_at: now }).eq('id', id)
        if (row.data?.ticket_id) {
          await supabase.from('tickets').update({ status: 'anulado' }).eq('id', row.data.ticket_id)
        }
        await supabase.from('queue_deletions').insert({ queue_id: id, ticket_id: row.data?.ticket_id, deleted_by: deletedBy || 'unknown', deleted_at: now, reason: 'manual', business_id: bid })
        return { id }
      }),
    },

    // ── Commissions ──────────────────────────────────────────────────────────

    commissions: {
      byWasher: (params) => tryOr(async () => {
        const washerId = params.washerId
        const dateFrom = params.from || params.dateFrom
        const dateTo   = params.to   || params.dateTo
        let q = supabase.from('washer_commissions')
          .select('*')
          .eq('business_id', bid).eq('washer_id', washerId)
        if (dateFrom) q = q.gte('created_at', dateFrom)
        if (dateTo)   q = q.lte('created_at', dateTo)
        q = q.order('created_at', { ascending: false }).limit(2000)
        const rows = throwSupaError(await q)
        if (!rows?.length) return []

        // Fetch ticket details separately
        const ticketIds = [...new Set(rows.map(r => r.ticket_id))]
        const { data: ticketRows } = await supabase.from('tickets')
          .select('id, doc_number, created_at, vehicle_plate, status')
          .in('id', ticketIds)
        const ticketMap = {}
        for (const t of (ticketRows || [])) ticketMap[t.id] = t

        // Fetch wash-only items (is_wash = true) — exclude beverages/snacks
        const { data: itemRows } = await supabase.from('ticket_items')
          .select('ticket_id, name').in('ticket_id', ticketIds).eq('is_wash', true)
        const itemsMap = {}
        for (const i of (itemRows || [])) {
          if (!itemsMap[i.ticket_id]) itemsMap[i.ticket_id] = []
          itemsMap[i.ticket_id].push(i.name)
        }

        // Fetch washer info
        const { data: washerRow } = await supabase.from('washers')
          .select('name, commission_pct').eq('id', washerId).single()

        return rows.map(r => {
          const t = ticketMap[r.ticket_id] || {}
          return {
            ...r,
            doc_number:     t.doc_number   || null,
            ticket_date:    t.created_at    || r.created_at,
            vehicle_plate:  t.vehicle_plate || null,
            washer_name:    washerRow?.name  || null,
            commission_pct: washerRow?.commission_pct || r.commission_pct || 0,
            services:       (itemsMap[r.ticket_id] || []).join(' + '),
          }
        })
      }, []),

      byPeriod: (params) => tryOr(async () => {
        const dateFrom = params.from || params.dateFrom
        const dateTo   = params.to   || params.dateTo
        // Fetch commissions (flat — no joins that might break)
        const { data: rows, error } = await supabase.from('washer_commissions')
          .select('washer_id, ticket_id, base_amount, commission_pct, commission_amount, created_at')
          .eq('business_id', bid)
        if (error) throw new Error(error.message)
        if (!rows?.length) return []

        // Filter by date range using commission's own created_at
        const from = dateFrom || '2000-01-01'
        const to   = dateTo   || '2099-12-31'
        const filtered = rows.filter(r => r.created_at >= from && r.created_at <= to)
        if (!filtered.length) return []

        // Fetch washer names
        const washerIds = [...new Set(filtered.map(r => r.washer_id))]
        const { data: washerRows } = await supabase.from('washers')
          .select('id, name, commission_pct').in('id', washerIds)
        const washerMap = {}
        for (const w of (washerRows || [])) washerMap[w.id] = w

        // Group by washer
        const map = {}
        for (const r of filtered) {
          const wid = r.washer_id
          const w = washerMap[wid] || {}
          if (!map[wid]) map[wid] = { washer_id: wid, washer_name: w.name || '', commission_pct: w.commission_pct || r.commission_pct || 0, ticket_count: 0, total_base: 0, total_commission: 0 }
          map[wid].ticket_count++
          map[wid].total_base       += r.base_amount || 0
          map[wid].total_commission += r.commission_amount || 0
        }
        return Object.values(map).sort((a, b) => b.total_commission - a.total_commission)
      }, []),

      markPaid: (ids) => tryOr(async () => {
        const now = new Date().toISOString()
        throwSupaError(await supabase.from('washer_commissions')
          .update({ paid: true, paid_at: now }).in('id', ids).eq('business_id', bid))
      }),
    },

    // ── Seller Commissions ──────────────────────────────────────────────────

    sellerCommissions: {
      bySeller: (params) => tryOr(async () => {
        const sellerId = params.sellerId
        const dateFrom = params.from || params.dateFrom
        const dateTo   = params.to   || params.dateTo
        let q = supabase.from('seller_commissions').select('*')
          .eq('business_id', bid).eq('seller_id', sellerId)
        if (dateFrom) q = q.gte('created_at', dateFrom)
        if (dateTo)   q = q.lte('created_at', dateTo)
        q = q.order('created_at', { ascending: false }).limit(2000)
        const rows = throwSupaError(await q)
        if (!rows?.length) return []
        const ticketIds = [...new Set(rows.map(r => r.ticket_id))]
        const { data: ticketRows } = await supabase.from('tickets').select('id, doc_number, created_at, vehicle_plate').in('id', ticketIds)
        const tMap = {}; for (const t of (ticketRows || [])) tMap[t.id] = t
        const { data: sellerRow } = await supabase.from('sellers').select('name, commission_pct').eq('id', sellerId).single()
        return rows.map(r => {
          const t = tMap[r.ticket_id] || {}
          return { ...r, doc_number: t.doc_number || null, ticket_date: t.created_at || r.created_at, vehicle_plate: t.vehicle_plate || null, seller_name: sellerRow?.name || null, commission_pct: sellerRow?.commission_pct || r.commission_pct || 0 }
        })
      }, []),

      byPeriod: (params) => tryOr(async () => {
        const dateFrom = params.from || params.dateFrom
        const dateTo   = params.to   || params.dateTo
        const { data: rows, error } = await supabase.from('seller_commissions')
          .select('seller_id, base_amount, commission_pct, commission_amount, created_at')
          .eq('business_id', bid)
        if (error) throw new Error(error.message)
        if (!rows?.length) return []
        const from = dateFrom || '2000-01-01', to = dateTo || '2099-12-31'
        const filtered = rows.filter(r => r.created_at >= from && r.created_at <= to)
        if (!filtered.length) return []
        const sellerIds = [...new Set(filtered.map(r => r.seller_id))]
        const { data: sellerRows } = await supabase.from('sellers').select('id, name, commission_pct').in('id', sellerIds)
        const sMap = {}; for (const s of (sellerRows || [])) sMap[s.id] = s
        const map = {}
        for (const r of filtered) {
          const sid = r.seller_id; const s = sMap[sid] || {}
          if (!map[sid]) map[sid] = { seller_id: sid, seller_name: s.name || '', commission_pct: s.commission_pct || r.commission_pct || 0, ticket_count: 0, total_base: 0, total_commission: 0 }
          map[sid].ticket_count++; map[sid].total_base += r.base_amount || 0; map[sid].total_commission += r.commission_amount || 0
        }
        return Object.values(map).sort((a, b) => b.total_commission - a.total_commission)
      }, []),

      markPaid: (ids) => tryOr(async () => {
        const now = new Date().toISOString()
        throwSupaError(await supabase.from('seller_commissions')
          .update({ paid: true, paid_at: now }).in('id', ids).eq('business_id', bid))
      }),
    },

    // ── Cajero Commissions ──────────────────────────────────────────────────

    cajeroCommissions: {
      byCajero: (params) => tryOr(async () => {
        const cajeroId = params.cajeroId
        const dateFrom = params.from || params.dateFrom
        const dateTo   = params.to   || params.dateTo
        let q = supabase.from('cajero_commissions').select('*')
          .eq('business_id', bid).eq('cajero_id', cajeroId)
        if (dateFrom) q = q.gte('created_at', dateFrom)
        if (dateTo)   q = q.lte('created_at', dateTo)
        q = q.order('created_at', { ascending: false }).limit(2000)
        const rows = throwSupaError(await q)
        if (!rows?.length) return []
        const ticketIds = [...new Set(rows.map(r => r.ticket_id))]
        const { data: ticketRows } = await supabase.from('tickets').select('id, doc_number, created_at, vehicle_plate').in('id', ticketIds)
        const tMap = {}; for (const t of (ticketRows || [])) tMap[t.id] = t
        const { data: userRow } = await supabase.from('staff').select('name, commission_pct').eq('id', cajeroId).single()
        return rows.map(r => {
          const t = tMap[r.ticket_id] || {}
          return { ...r, doc_number: t.doc_number || null, ticket_date: t.created_at || r.created_at, vehicle_plate: t.vehicle_plate || null, cajero_name: userRow?.name || null, commission_pct: userRow?.commission_pct || r.commission_pct || 0 }
        })
      }, []),

      byPeriod: (params) => tryOr(async () => {
        const dateFrom = params.from || params.dateFrom
        const dateTo   = params.to   || params.dateTo
        const { data: rows, error } = await supabase.from('cajero_commissions')
          .select('cajero_id, base_amount, commission_pct, commission_amount, created_at')
          .eq('business_id', bid)
        if (error) throw new Error(error.message)
        if (!rows?.length) return []
        const from = dateFrom || '2000-01-01', to = dateTo || '2099-12-31'
        const filtered = rows.filter(r => r.created_at >= from && r.created_at <= to)
        if (!filtered.length) return []
        const cajeroIds = [...new Set(filtered.map(r => r.cajero_id))]
        const { data: userRows } = await supabase.from('staff').select('id, name, commission_pct').in('id', cajeroIds)
        const cMap = {}; for (const u of (userRows || [])) cMap[u.id] = u
        const map = {}
        for (const r of filtered) {
          const cid = r.cajero_id; const u = cMap[cid] || {}
          if (!map[cid]) map[cid] = { cajero_id: cid, cajero_name: u.name || '', commission_pct: u.commission_pct || r.commission_pct || 0, ticket_count: 0, total_base: 0, total_commission: 0 }
          map[cid].ticket_count++; map[cid].total_base += r.base_amount || 0; map[cid].total_commission += r.commission_amount || 0
        }
        return Object.values(map).sort((a, b) => b.total_commission - a.total_commission)
      }, []),

      markPaid: (ids) => tryOr(async () => {
        const now = new Date().toISOString()
        throwSupaError(await supabase.from('cajero_commissions')
          .update({ paid: true, paid_at: now }).in('id', ids).eq('business_id', bid))
      }),
    },

    // ── Cuadre de Caja ───────────────────────────────────────────────────────

    cuadre: {
      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('cuadre_caja').insert({
          ...data,
          business_id: bid,
          denominaciones: typeof data.denominaciones === 'string' ? data.denominaciones : JSON.stringify(data.denominaciones || {}),
        }).select('id').single())
        return row
      }),

      history: () => tryOr(async () => {
        const { data } = await supabase.from('cuadre_caja')
          .select('*, staff!cajero_id(name)')
          .eq('business_id', bid)
          .order('closed_at', { ascending: false }).limit(20)
        return (data || []).map(r => ({
          ...r,
          cajero_name: r.staff?.name || null,
          staff: undefined,
        }))
      }, []),

      list: (filters = {}) => tryOr(async () => {
        const { dateFrom, dateTo, limit = 100 } = filters
        let q = supabase.from('cuadre_caja')
          .select('*, staff!cajero_id(name)')
          .eq('business_id', bid)
        if (dateFrom) q = q.gte('date', dateFrom)
        if (dateTo)   q = q.lte('date', dateTo)
        q = q.order('closed_at', { ascending: false }).limit(limit)
        const rows = throwSupaError(await q)
        return (rows || []).map(r => ({
          ...r,
          cajero_name: r.staff?.name || null,
          staff: undefined,
        }))
      }, []),

      daily: (date) => tryOr(async () => {
        return throwSupaError(await supabase.rpc('cuadre_daily_summary', {
          p_business_id: bid,
          p_date: date || new Date().toISOString().slice(0, 10),
        }))
      }, { efectivo: 0, tarjeta: 0, transferencia: 0, cheque: 0, credito: 0, totalVendido: 0, totalCobrado: 0, count: 0 }),
    },

    // ── NCF ──────────────────────────────────────────────────────────────────

    ncf: {
      sequences: () => tryOr(async () => {
        return throwSupaError(await supabase.from('ncf_sequences').select('*').eq('business_id', bid).order('type'))
      }, []),

      next: (type) => tryOr(async () => {
        // Atomic NCF increment via RPC to prevent race conditions
        const result = throwSupaError(await supabase.rpc('atomic_next_ncf', {
          p_business_id: bid,
          p_type: type,
        }))
        return result // returns formatted NCF string like "E3100000001"
      }, null),

      updateSequence: (data) => tryOr(async () => {
        const { type, ...rest } = data
        throwSupaError(await supabase.from('ncf_sequences').update(rest).eq('business_id', bid).eq('type', type))
      }),
    },

    // ── Caja Chica ───────────────────────────────────────────────────────────

    cajaChica: {
      all: () => tryOr(async () => {
        const { data } = await supabase.from('caja_chica')
          .select('*, staff!approved_by(name)')
          .eq('business_id', bid)
          .order('created_at', { ascending: false }).limit(100)
        return (data || []).map(r => ({
          ...r,
          approved_name: r.staff?.name || null,
          staff: undefined,
        }))
      }, []),

      create: (data) => tryOr(async () => {
        throwSupaError(await supabase.from('caja_chica').insert({ ...data, business_id: bid }))
      }),

      updateStatus: (data) => tryOr(async () => {
        const { id, status, approvedBy } = data
        throwSupaError(await supabase.from('caja_chica').update({ status, approved_by: approvedBy }).eq('id', id).eq('business_id', bid))
      }),
    },

    // ── Notas de Credito ─────────────────────────────────────────────────────

    notas: {
      all: () => tryOr(async () => {
        const { data } = await supabase.from('notas_credito')
          .select('*, clients!client_id(name)')
          .eq('business_id', bid)
          .order('created_at', { ascending: false }).limit(100)
        return (data || []).map(r => ({
          ...r,
          client_name: r.clients?.name || null,
          clients: undefined,
        }))
      }, []),

      create: (data) => tryOr(async () => {
        throwSupaError(await supabase.from('notas_credito').insert({ ...data, business_id: bid }))
      }),
    },

    // ── DGII ─────────────────────────────────────────────────────────────────

    dgii: {
      get606: (params) => tryOr(async () => {
        const { dateFrom, dateTo } = params || {}
        let q = supabase.from('tickets')
          .select('id, ncf, comprobante_type, created_at, subtotal, itbis, ley, total, status, clients!client_id(name, rnc)')
          .eq('business_id', bid)
        if (dateFrom) q = q.gte('created_at', dateFrom)
        if (dateTo)   q = q.lte('created_at', dateTo)
        q = q.order('created_at', { ascending: false })
        const rows = throwSupaError(await q)
        return (rows || []).map(r => ({
          id: r.id, ncf: r.ncf, tipo: r.comprobante_type,
          fecha: r.created_at, subtotal: r.subtotal, itbis: r.itbis,
          ley: r.ley, total: r.total, estado: r.status,
          client_name: r.clients?.name || null,
          client_rnc: r.clients?.rnc || null,
          clients: undefined,
        }))
      }, []),

      get607: (params) => tryOr(async () => {
        const { dateFrom, dateTo } = params || {}
        let q = supabase.from('compras_607').select('*').eq('business_id', bid)
        if (dateFrom) q = q.gte('fecha_ncf', dateFrom)
        if (dateTo)   q = q.lte('fecha_ncf', dateTo)
        q = q.order('fecha_ncf', { ascending: false })
        return throwSupaError(await q)
      }, []),

      addCompra: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('compras_607').insert({
          rnc_proveedor:    data.rnc_proveedor    || '',
          nombre_proveedor: data.nombre_proveedor || '',
          tipo_ncf:         data.tipo_ncf         || 'B01',
          ncf:              data.ncf              || '',
          ncf_modificado:   data.ncf_modificado   || '',
          fecha_ncf:        data.fecha_ncf        || new Date().toISOString().slice(0, 10),
          fecha_pago:       data.fecha_pago       || '',
          monto_servicios:  Number(data.monto_servicios)  || 0,
          monto_bienes:     Number(data.monto_bienes)     || 0,
          total:            Number(data.total)            || 0,
          itbis_facturado:  Number(data.itbis_facturado)  || 0,
          itbis_retenido:   Number(data.itbis_retenido)   || 0,
          retencion_renta:  Number(data.retencion_renta)  || 0,
          forma_pago:       data.forma_pago       || 'efectivo',
          notas:            data.notas            || '',
          business_id: bid,
        }).select('id').single())
        return { id: row.id }
      }),

      deleteCompra: ({ id }) => tryOr(async () => {
        throwSupaError(await supabase.from('compras_607').delete().eq('id', id).eq('business_id', bid))
      }),
    },

    // ── RNC Lookup ───────────────────────────────────────────────────────────

    rnc: {
      lookup: async (rnc) => {
        const clean = rnc.replace(/[\s-]/g, '')

        // 1. Try rnc_cache table (previously looked-up entries)
        try {
          const { data: cached } = await supabase.from('rnc_cache')
            .select('rnc, nombre, estado')
            .eq('business_id', bid)
            .eq('rnc', clean)
            .maybeSingle()
          if (cached?.nombre) return { rnc: cached.rnc, name: cached.nombre, status: cached.estado }
        } catch { /* table may not exist */ }

        // 2. Try rnc_contribuyentes table (full DGII directory if synced)
        try {
          const { data: local } = await supabase.from('rnc_contribuyentes')
            .select('rnc, nombre, estado')
            .eq('rnc', clean)
            .maybeSingle()
          if (local?.nombre) return { rnc: local.rnc, name: local.nombre, status: local.estado }
        } catch { /* table may not exist */ }

        // 3. Fallback: megaplus.com.do via Vercel API proxy
        try {
          const resp = await fetch('/api/rnc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rnc: clean }),
          })
          if (resp.ok) {
            const result = await resp.json()
            // Cache the result for next time
            supabase.from('rnc_cache').upsert({
              business_id: bid, rnc: clean,
              nombre: result.name || '',
              estado: result.status || 'ACTIVO',
              source: 'api',
            }, { onConflict: 'business_id,rnc' }).then(() => {})
            return result
          }
        } catch { /* API proxy unavailable */ }

        return null
      },

      sync: () => tryOr(async () => {
        const { data, error } = await supabase.functions.invoke('rnc-sync', {
          body: { business_id: bid },
        })
        if (error) throw error
        return data
      }),

      status: () => tryOr(async () => {
        const { data, error } = await supabase.functions.invoke('rnc-status', {
          body: { business_id: bid },
        })
        if (error) throw error
        return data
      }, { count: 0, lastSync: null }),

      // No real event emitter in web — consumers should poll or use Supabase Realtime
      onSyncProgress: () => { /* no-op in web context */ },
    },

    // ── Backup / DB export ───────────────────────────────────────────────────

    db: {
      exportAll: () => tryOr(async () => {
        const tables = ['tickets', 'ticket_items', 'clients', 'credit_payments', 'queue',
          'cuadre_caja', 'caja_chica', 'notas_credito', 'washer_commissions', 'ncf_sequences', 'app_settings']
        const snap = { exported_at: new Date().toISOString(), version: '1.0.0-web', tables: {} }
        for (const t of tables) {
          try {
            const { data } = await supabase.from(t).select('*').eq('business_id', bid)
            snap.tables[t] = data || []
          } catch {
            snap.tables[t] = []
          }
        }
        return snap
      }, {}),

      exportSince: (since) => tryOr(async () => {
        const [tickets, clients, payments] = await Promise.all([
          supabase.from('tickets').select('*').eq('business_id', bid).gt('created_at', since),
          supabase.from('clients').select('*').eq('business_id', bid).gt('created_at', since),
          supabase.from('credit_payments').select('*').eq('business_id', bid).gt('created_at', since),
        ])
        return {
          tickets:  tickets.data  || [],
          clients:  clients.data  || [],
          payments: payments.data || [],
        }
      }, { tickets: [], clients: [], payments: [] }),
    },

    // ── PDF receipts ─────────────────────────────────────────────────────────

    pdf: {
      save: (payload) => tryOr(async () => {
        // In web context, trigger a browser download
        const { buffer, filename } = payload || {}
        if (!buffer) return { ok: false, error: 'No buffer provided' }
        const blob = new Blob(
          [buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)],
          { type: 'application/pdf' }
        )
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename || 'receipt.pdf'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        return { ok: true }
      }),
    },

    // ── Local backup ─────────────────────────────────────────────────────────

    backup: {
      local: () => Promise.resolve({ ok: true, message: 'Supabase IS the backup in web mode' }),
    },

    // ── Printer ──────────────────────────────────────────────────────────────

    print: () => Promise.resolve({ ok: false, error: 'Use printWeb service for browser printing' }),

    // ── File save ────────────────────────────────────────────────────────────

    saveFile: (payload) => tryOr(async () => {
      const { data, filename, mimeType } = payload || {}
      if (!data) return { ok: false, error: 'No data provided' }
      const blob = new Blob(
        [typeof data === 'string' ? data : new Uint8Array(data)],
        { type: mimeType || 'application/octet-stream' }
      )
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename || 'file'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      return { ok: true }
    }),

    // ── License ──────────────────────────────────────────────────────────────

    license: {
      hwid: () => Promise.resolve('web-client'),
      isMaster: () => Promise.resolve(false),
    },

    // ── App version ──────────────────────────────────────────────────────────

    version: () => Promise.resolve('0.0.0-web'),

    // ── WhatsApp (via Edge Function) ─────────────────────────────────────────

    whatsapp: {
      send: (params) => tryOr(async () => {
        const { data, error } = await supabase.functions.invoke('whatsapp-send', {
          body: { ...params, businessId: bid },
        })
        if (error) throw error
        return data
      }),

      sendDocument: (params) => tryOr(async () => {
        const { data, error } = await supabase.functions.invoke('whatsapp-send', {
          body: { ...params, type: 'document', businessId: bid },
        })
        if (error) throw error
        return data
      }),
    },

    // ── Env config ───────────────────────────────────────────────────────────

    env: {
      get: (key) => {
        try {
          // Vite exposes env vars via import.meta.env.VITE_*
          const val = import.meta.env?.['VITE_' + key] || import.meta.env?.[key] || ''
          return Promise.resolve(val)
        } catch {
          return Promise.resolve('')
        }
      },
    },

    // ── Safe storage (localStorage fallback) ─────────────────────────────────

    safe: {
      get: (key) => {
        try {
          return Promise.resolve(localStorage.getItem('tx_safe_' + key) || '')
        } catch {
          return Promise.resolve('')
        }
      },
      set: (key, val) => {
        try {
          localStorage.setItem('tx_safe_' + key, val)
        } catch { /* quota exceeded or private browsing */ }
        return Promise.resolve()
      },
    },

    // ── e-CF offline queue ───────────────────────────────────────────────────

    ecf: {
      queueCount: () => tryOr(async () => {
        const { count } = await supabase.from('ecf_queue')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', bid)
          .gt('created_at', new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString())
        return count || 0
      }, 0),
    },

    // ── Auto-updater ─────────────────────────────────────────────────────────

    updater: {
      install:  () => Promise.resolve(), // web auto-updates via service worker
      onStatus: () => () => {},          // returns unsubscribe function (no-op)
    },
  }
}

// ── Printer API (qz-tray integration for web) ────────────────────────────────

export function createWebPrinterAPI() {
  // Check if qz-tray is available (loaded via <script> tag or npm)
  function getQz() {
    return typeof qz !== 'undefined' ? qz : null
  }

  return {
    listPrinters: async () => {
      const q = getQz()
      if (!q) return []
      try {
        if (!q.websocket.isActive()) {
          await q.websocket.connect()
        }
        return await q.printers.find()
      } catch {
        return []
      }
    },

    openDrawer: async () => {
      const q = getQz()
      if (!q) return
      try {
        if (!q.websocket.isActive()) {
          await q.websocket.connect()
        }
        const printer = await q.printers.getDefault()
        if (!printer) return
        const config = q.configs.create(printer)
        // ESC/POS drawer kick: ESC p 0 25 250
        const drawerKick = [0x1B, 0x70, 0x00, 0x19, 0xFA]
        await q.print(config, [{ type: 'raw', format: 'hex', data: drawerKick.map(b => b.toString(16).padStart(2, '0')).join('') }])
      } catch { /* qz not connected or no printer */ }
    },

    testDrawerVariants: async (printerName) => {
      const q = getQz()
      if (!q) return
      try {
        if (!q.websocket.isActive()) {
          await q.websocket.connect()
        }
        const config = q.configs.create(printerName)
        // Try multiple drawer kick variants
        const variants = [
          [0x1B, 0x70, 0x00, 0x19, 0xFA],
          [0x1B, 0x70, 0x01, 0x19, 0xFA],
          [0x10, 0x14, 0x01, 0x00, 0x05],
        ]
        for (const v of variants) {
          await q.print(config, [{ type: 'raw', format: 'hex', data: v.map(b => b.toString(16).padStart(2, '0')).join('') }])
        }
      } catch { /* qz not connected or no printer */ }
    },

    // Extra helper for web: send raw ESC/POS buffer via qz-tray
    printRaw: async (printerName, buffer) => {
      const q = getQz()
      if (!q) return { ok: false, error: 'qz-tray not available' }
      try {
        if (!q.websocket.isActive()) {
          await q.websocket.connect()
        }
        const config = q.configs.create(printerName)
        const hex = Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('')
        await q.print(config, [{ type: 'raw', format: 'hex', data: hex }])
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err.message || 'Print failed' }
      }
    },
  }
}
