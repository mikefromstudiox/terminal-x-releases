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
    console.error('[web.js]', err.message || err)
    if (fallback !== undefined) return fallback
    throw err
  }
}

/** For write operations: log and re-throw so callers see failures. */
async function tryWrite(fn) {
  try {
    return await fn()
  } catch (err) {
    console.error('[web.js WRITE]', err.message || err)
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
    supabase_id:      crypto.randomUUID(),
    empleado_id:      data.empleado_id,
    empleado_supabase_id: data.empleado_supabase_id || null,
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

  // ── Activity log (owner audit feed) helper ───────────────────────────────
  // Web mutations write log rows directly to Supabase; the module-level actor
  // is set via api.activity.setActor(...) from AuthContext on login.
  let _webActor = null
  async function logActivity(evt) {
    if (!evt || !evt.event_type) return
    try {
      const actor = _webActor || {}
      await supabase.from('activity_log').insert({
        supabase_id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
        business_id: bid,
        event_type: evt.event_type,
        severity: evt.severity || 'info',
        actor_name: evt.actor_name || actor.name || null,
        actor_role: evt.actor_role || actor.role || null,
        target_type: evt.target_type || null,
        target_id:   evt.target_id != null ? String(evt.target_id) : null,
        target_name: evt.target_name || null,
        amount:      evt.amount != null ? Number(evt.amount) : null,
        old_value:   evt.old_value != null ? String(evt.old_value) : null,
        new_value:   evt.new_value != null ? String(evt.new_value) : null,
        reason:      evt.reason || null,
        metadata:    evt.metadata || null,
      })
    } catch (e) { console.error('[activity_log web] failed:', e?.message || e) }
  }

  return {

    // ── Activity log ─────────────────────────────────────────────────────────
    activity: {
      setActor: (user) => { _webActor = user ? { id: user.id, name: user.name, role: user.role } : null },
      list: ({ dateFrom, dateTo, eventTypes, limit = 200 } = {}) => tryOr(async () => {
        let q = supabase.from('activity_log').select('*').eq('business_id', bid)
        if (dateFrom) q = q.gte('created_at', dateFrom)
        if (dateTo)   q = q.lte('created_at', dateTo)
        if (Array.isArray(eventTypes) && eventTypes.length) q = q.in('event_type', eventTypes)
        q = q.order('created_at', { ascending: false }).limit(Math.min(Number(limit) || 200, 1000))
        return throwSupaError(await q)
      }, []),
    },


    // ── Admin panel ──────────────────────────────────────────────────────────

    admin: {
      getEmpresa: () => tryOr(async () => {
        const { data } = await supabase.from('businesses').select('id,name,rnc,address,phone,email,logo_url,settings').eq('id', bid).single()
        if (data) data.logo = data.logo_url  // map to desktop field name
        // Resolve the active license plan so usePlan() unlocks the right
        // features on web. Without this, web sessions default to 'pro' even
        // when the business is on Pro PLUS / Pro MAX — every owner appears
        // limited regardless of what they're paying for.
        try {
          const { data: lic } = await supabase.from('licenses')
            .select('plan_id, status, expires_at, plans(name)')
            .eq('business_id', bid).eq('status', 'active')
            .order('expires_at', { ascending: false })
            .limit(1).maybeSingle()
          const planName = lic?.plans?.name
          if (planName && data) data.plan = planName
        } catch {}
        return data
      }, null),

      saveEmpresa: (data) => tryOr(async () => {
        const allowed = ['name', 'rnc', 'address', 'phone', 'email', 'logo', 'logo_url', 'settings']
        const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
        // Map `logo` → `logo_url` (Supabase column name differs from desktop)
        if ('logo' in patch) { patch.logo_url = patch.logo; delete patch.logo }
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
          if ('active' in rest) rest.active = !!rest.active
          throwSupaError(await supabase.from('users').update(rest).eq('id', id).eq('business_id', bid))
          return { id }
        }
        if (!data.pin) throw new Error('PIN requerido')
        const pin_hash = await hashPin(data.pin)
        const { pin: _p, ...rest } = data
        if ('active' in rest) rest.active = !!rest.active
        const row = throwSupaError(await supabase.from('users').insert({ id: crypto.randomUUID(), supabase_id: crypto.randomUUID(), ...rest, pin_hash, business_id: bid, active: rest.active !== false }).select('id').single())
        return row
      }),

      deleteUsuario: ({ id }) => tryOr(async () => {
        throwSupaError(await supabase.from('users').update({ active: false }).eq('id', id).eq('business_id', bid))
      }),

      getLavadores: () => tryOr(async () => {
        return throwSupaError(await supabase.from('washers').select('*').eq('business_id', bid).order('name'))
      }, []),

      saveLavador: (data) => tryOr(async () => {
        if (data.id) {
          const { id, ...rest } = data
          if ('active' in rest) rest.active = !!rest.active
          throwSupaError(await supabase.from('washers').update(rest).eq('id', id).eq('business_id', bid))
          return { id }
        }
        const row = throwSupaError(await supabase.from('washers').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid, active: true }).select('id').single())
        return row
      }),

      deleteLavador: ({ id }) => tryOr(async () => {
        throwSupaError(await supabase.from('washers').update({ active: false }).eq('id', id).eq('business_id', bid))
      }),

      getVendedores: () => tryOr(async () => {
        return throwSupaError(await supabase.from('sellers').select('*').eq('business_id', bid).order('name'))
      }, []),

      saveVendedor: (data) => tryOr(async () => {
        if (data.id) {
          const { id, ...rest } = data
          if ('active' in rest) rest.active = !!rest.active
          throwSupaError(await supabase.from('sellers').update(rest).eq('id', id).eq('business_id', bid))
          return { id }
        }
        const row = throwSupaError(await supabase.from('sellers').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid, active: true }).select('id').single())
        return row
      }),

      deleteVendedor: ({ id }) => tryOr(async () => {
        throwSupaError(await supabase.from('sellers').update({ active: false }).eq('id', id).eq('business_id', bid))
      }),

      getServicios: () => tryOr(async () => {
        return throwSupaError(await supabase.from('services').select('*').eq('business_id', bid).order('category').order('sort_order').order('id'))
      }, []),

      saveServicio: (data) => tryOr(async () => {
        if (data.id) {
          const { id, ...rest } = data
          // Coerce booleans for bool columns
          for (const k of ['active','no_commission','commission_washer','commission_seller','commission_cashier','is_wash','aplica_itbis']) {
            if (k in rest) rest[k] = !!rest[k]
          }
          throwSupaError(await supabase.from('services').update(rest).eq('id', id).eq('business_id', bid))
          return { id }
        }
        const row = throwSupaError(await supabase.from('services').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid, active: true }).select('id').single())
        return row
      }),

      deleteServicio: ({ id }) => tryOr(async () => {
        throwSupaError(await supabase.from('services').update({ active: false }).eq('id', id).eq('business_id', bid))
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
        const row = throwSupaError(await supabase.from('inventory_items').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid }).select('id').single())
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
        // Direct UPDATE + INSERT instead of a non-existent RPC.
        // Fetch current qty, compute new, update, log the transaction.
        const current = throwSupaError(await supabase.from('inventory_items').select('quantity, supabase_id, name').eq('id', id).eq('business_id', bid).single())
        const newQty = Math.max(0, (current.quantity || 0) + delta)
        throwSupaError(await supabase.from('inventory_items').update({ quantity: newQty }).eq('id', id).eq('business_id', bid))
        await logActivity({ event_type: 'inventory_adjusted', severity: 'info',
          target_type: 'inventory_item', target_id: id, target_name: current?.name || `#${id}`,
          amount: delta,
          old_value: current?.quantity != null ? String(current.quantity) : null,
          new_value: String(newQty),
          reason: notes || null })
        // Log the adjustment in inventory_transactions (non-blocking — stock already updated)
        try {
          await supabase.from('inventory_transactions').insert({
            supabase_id: crypto.randomUUID(),
            item_id: id,
            item_supabase_id: current.supabase_id || null,
            type: delta > 0 ? 'adjustment_in' : 'adjustment_out',
            delta,
            notes: notes || null,
            user_id: userId || null,
            business_id: bid,
          })
        } catch {}
        return newQty
      }),

      transactions: ({ id }) => tryOr(async () => {
        return throwSupaError(
          await supabase.from('inventory_transactions').select('*, staff!user_id(name)')
            .eq('item_id', id).order('created_at', { ascending: false }).limit(50)
        )
      }, []),

      lowStockCount: () => tryOr(async () => {
        // Supabase can't compare column-to-column with .lte(), so fetch and filter client-side
        const items = throwSupaError(await supabase.from('inventory_items')
          .select('quantity, min_quantity')
          .eq('business_id', bid).eq('active', true))
        return (items || []).filter(i => i.quantity <= (i.min_quantity || 5)).length
      }, 0),

      lookupSku: (sku) => tryOr(async () => {
        if (!sku) return null
        const safe = String(sku).replace(/[,.()"'\\]/g, '')
        const { data } = await supabase.from('inventory_items').select('*')
          .eq('business_id', bid).eq('active', true)
          .or(`sku.eq."${safe}",barcode.eq."${safe}"`)
          .limit(1).maybeSingle()
        return data || null
      }),

      search: (query) => tryOr(async () => {
        if (!query) return []
        const safe = String(query).replace(/[%_,.()"'\\]/g, '')
        return throwSupaError(
          await supabase.from('inventory_items').select('*')
            .eq('business_id', bid).eq('active', true)
            .or(`name.ilike."%${safe}%",sku.ilike."%${safe}%",barcode.ilike."%${safe}%",category.ilike."%${safe}%"`)
            .order('name').limit(20)
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
        const row = throwSupaError(await supabase.from('users').insert({ id: crypto.randomUUID(), supabase_id: crypto.randomUUID(), ...rest, pin_hash, discount_pct: rest.discount_pct || 0, business_id: bid, active: true }).select('id').single())
        return row
      }),

      update: (data) => tryOr(async () => {
        const { id, pin, ...rest } = data
        if (pin) rest.pin_hash = await hashPin(pin)
        if ('active' in rest) rest.active = !!rest.active
        throwSupaError(await supabase.from('users').update(rest).eq('id', id).eq('business_id', bid))
      }),

      delete: ({ id }) => tryOr(async () => {
        // Soft-delete only — hard-delete resurrects after the next desktop
        // sync push (desktop still has the row locally and upserts it back).
        const snap = await supabase.from('users').select('name, username').eq('id', id).eq('business_id', bid).maybeSingle()
        const name = snap?.data ? `${snap.data.name} (@${snap.data.username})` : `#${id}`
        throwSupaError(await supabase.from('users').update({ active: false, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid))
        await logActivity({ event_type: 'user_deleted', severity: 'warn', target_type: 'user', target_id: id, target_name: name })
        return { deleted: true }
      }),
    },

    // ── Categorias ───────────────────────────────────────────────────────────

    categorias: {
      all: () => tryOr(async () => {
        return throwSupaError(await supabase.from('categorias_servicio').select('*').eq('business_id', bid).order('orden').order('nombre'))
      }, []),

      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('categorias_servicio').insert({
          supabase_id: crypto.randomUUID(),
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
          supabase_id: crypto.randomUUID(),
          name: data.name, name_en: data.name_en || null,
          category: data.category || 'Lavado', categoria_id: data.categoria_id || null,
          price: data.price, cost: data.cost || 0, aplica_itbis: data.aplica_itbis ?? 1,
          is_wash: data.is_wash ?? 1,
          no_commission: !!(data.no_commission),
          commission_washer: data.commission_washer ?? true,
          commission_seller: data.commission_seller ?? true,
          commission_cashier: data.commission_cashier ?? true,
          active: true, sort_order: data.sort_order || 0,
          business_id: bid,
        }).select('id').single())
        return { id: row.id }
      }),

      update: (data) => tryOr(async () => {
        const { id, ...rest } = data
        const allowed = ['name', 'name_en', 'category', 'categoria_id', 'price', 'cost', 'aplica_itbis', 'is_wash', 'no_commission', 'commission_washer', 'commission_seller', 'commission_cashier', 'active', 'sort_order']
        const patch = Object.fromEntries(Object.entries(rest).filter(([k]) => allowed.includes(k)))
        // Coerce booleans for Supabase bool columns
        for (const k of ['no_commission', 'commission_washer', 'commission_seller', 'commission_cashier', 'active', 'is_wash', 'aplica_itbis']) {
          if (k in patch) patch[k] = !!patch[k]
        }
        // Auto-derive no_commission when all 3 role flags are off
        if ('commission_washer' in patch || 'commission_seller' in patch || 'commission_cashier' in patch) {
          patch.no_commission = !(patch.commission_washer || patch.commission_seller || patch.commission_cashier)
        }
        const priorRow = 'price' in patch
          ? (await supabase.from('services').select('name, price').eq('id', id).eq('business_id', bid).maybeSingle())?.data
          : null
        throwSupaError(await supabase.from('services').update(patch).eq('id', id).eq('business_id', bid))
        if (priorRow && Number(priorRow.price) !== Number(patch.price)) {
          await logActivity({ event_type: 'service_price_changed', severity: 'warn',
            target_type: 'service', target_id: id, target_name: priorRow.name,
            old_value: priorRow.price, new_value: patch.price,
            amount: Number(patch.price) - Number(priorRow.price) })
        }
      }),

      delete: ({ id }) => tryOr(async () => {
        // Soft-delete — set active=false, bump updated_at. Desktop pulls the
        // change via LWW and hides the service from the POS grid. Hard-delete
        // is useless here: the desktop's next sync push would just re-upsert
        // its still-active local copy and resurrect the row on Supabase.
        const svc = await supabase.from('services').select('name, price').eq('id', id).eq('business_id', bid).maybeSingle()
        throwSupaError(await supabase.from('services').update({ active: false, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid))
        await logActivity({ event_type: 'service_deleted', severity: 'warn',
          target_type: 'service', target_id: id,
          target_name: svc?.data?.name || `#${id}`, amount: svc?.data?.price })
        return { deleted: true }
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
          supabase_id: crypto.randomUUID(),
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
          supabase_id: crypto.randomUUID(),
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
        const empSid = crypto.randomUUID()
        const row = throwSupaError(await supabase.from('empleados').insert({
          supabase_id: empSid,
          nombre: data.nombre, tipo: data.tipo, role: data.role || 'none',
          ref_id: data.ref_id || null, comision_pct: data.comision_pct || 0,
          salary: data.salary || 0, start_date: data.start_date,
          cedula: data.cedula || null, phone: data.phone || null,
          puesto: data.puesto || null, email: data.email || null,
          bank_account: data.bank_account || null, tss_id: data.tss_id || null,
          active: true, business_id: bid,
        }).select('id').single())
        // Log initial salary for salaryAtDate(). Guard against duplicate
        // insert when desktop already pushed one for the same empleado (same
        // initial_salary row created twice → 4 "historiales" bug).
        const sal = data.salary || 0
        if (sal > 0) {
          const { data: existing } = await supabase.from('salary_changes')
            .select('id').eq('business_id', bid).eq('empleado_supabase_id', empSid)
            .eq('reason', 'initial_salary').limit(1).maybeSingle()
          if (!existing) {
            const { error: scErr } = await supabase.from('salary_changes').insert({
              supabase_id: crypto.randomUUID(),
              empleado_supabase_id: empSid,
              old_salary: 0, new_salary: sal,
              effective_date: data.start_date || new Date().toISOString().slice(0, 10),
              reason: 'initial_salary', business_id: bid,
            })
            if (scErr) console.error('[salary_changes initial insert]', scErr.message || scErr)
          }
        }
        return { id: row.id }
      }),

      update: (data) => tryOr(async () => {
        const { id, salary_change_reason, changed_by, ...rest } = data
        const allowed = ['nombre','tipo','role','ref_id','salary','comision_pct','start_date','cedula','phone','puesto','email','bank_account','tss_id','active']
        const patch = Object.fromEntries(Object.entries(rest).filter(([k]) => allowed.includes(k)))
        // Coerce boolean — UI may send 0/1
        if ('active' in patch) patch.active = !!patch.active
        // Auto-log salary change: fetch current, compare, insert salary_changes row.
        // Use empleado_supabase_id (uuid) — salary_changes.empleado_id is legacy bigint.
        if (patch.salary != null) {
          const { data: current } = await supabase.from('empleados').select('salary, supabase_id').eq('id', id).eq('business_id', bid).single()
          const oldSalary = Number(current?.salary || 0)
          const newSalary = Number(patch.salary || 0)
          if (current && oldSalary !== newSalary) {
            const { error: scErr } = await supabase.from('salary_changes').insert({
              supabase_id: crypto.randomUUID(),
              empleado_supabase_id: current.supabase_id,
              old_salary: oldSalary, new_salary: newSalary,
              effective_date: new Date().toISOString().slice(0, 10),
              reason: salary_change_reason || null,
              business_id: bid,
            })
            if (scErr) console.error('[salary_changes auto-log]', scErr.message || scErr)
          }
        }
        throwSupaError(await supabase.from('empleados').update(patch).eq('id', id).eq('business_id', bid))
      }),

      delete: (id) => tryOr(async () => {
        throwSupaError(await supabase.from('empleados').update({ active: false }).eq('id', id).eq('business_id', bid))
      }),

      // Mirror of electron hard-delete: try to remove outright, fall back to
      // soft-delete if FKs (payroll_runs / salary_changes / commissions) block
      // the delete. Returns { deleted: true } or { softDeleted: true, reason }.
      hardDelete: (id) => tryOr(async () => {
        const snap = await supabase.from('empleados').select('nombre, supabase_id').eq('id', id).eq('business_id', bid).maybeSingle()
        const name = snap?.data?.nombre || `#${id}`
        const empSid = snap?.data?.supabase_id
        if (empSid) {
          try { await supabase.from('salary_changes').delete().eq('business_id', bid).eq('empleado_supabase_id', empSid) } catch {}
        }
        const { error } = await supabase.from('empleados').delete().eq('id', id).eq('business_id', bid)
        if (!error) {
          await logActivity({ event_type: 'empleado_deleted', severity: 'warn', target_type: 'empleado', target_id: id, target_name: name })
          return { deleted: true }
        }
        try { throwSupaError(await supabase.from('empleados').update({ active: false }).eq('id', id).eq('business_id', bid)) } catch {}
        await logActivity({ event_type: 'empleado_deactivated', severity: 'warn', target_type: 'empleado', target_id: id, target_name: name, reason: error.message })
        return { softDeleted: true, reason: error.message }
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
          try { await markCommissionsPaidForEmpleado(supabase, bid, data.empleado_id, data.period_start, data.period_end) } catch (e) { console.error('[payrollRuns.create] markCommissionsPaid failed:', e.message) }
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
            try { await markCommissionsPaidForEmpleado(supabase, bid, r.empleado_id, r.period_start, r.period_end) } catch (e) { console.error('[payrollRuns.bulkCreate] markCommissionsPaid failed for empleado', r.empleado_id, ':', e.message) }
          }
        }
        const totalNet = runs.reduce((s, r) => s + Number(r?.net || 0), 0)
        const period = runs[0] ? `${runs[0].period_start || ''} → ${runs[0].period_end || ''}` : ''
        await logActivity({ event_type: 'payroll_paid', severity: 'critical',
          target_type: 'payroll_run', target_id: inserted?.[0]?.id || null,
          target_name: `Nómina ${period}`.trim(),
          amount: totalNet,
          metadata: { run_count: (inserted || []).length, run_ids: (inserted || []).map(x => x.id), period_start: runs[0]?.period_start, period_end: runs[0]?.period_end } })
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
        // Coerce booleans — UI sends 0/1, schema is BOOLEAN
        if ('isr_enabled' in patch)     patch.isr_enabled     = !!patch.isr_enabled
        if ('navidad_enabled' in patch) patch.navidad_enabled = !!patch.navidad_enabled
        // Upsert: one row per business (UNIQUE constraint on business_id)
        throwSupaError(await supabase.from('payroll_settings')
          .upsert({ ...patch, business_id: bid, updated_at: new Date().toISOString() }, { onConflict: 'business_id' }))
      }),
    },

    // ── Adelantos de nomina (salary advances) ──────────────────────────────
    adelantos: {
      create: (data) => tryOr(async () => {
        const sid = crypto.randomUUID()
        const { data: emp } = await supabase.from('empleados').select('supabase_id, nombre').eq('id', data.empleado_id).eq('business_id', bid).maybeSingle()
        const row = throwSupaError(await supabase.from('adelantos').insert({
          supabase_id: sid,
          empleado_id: data.empleado_id,
          empleado_supabase_id: emp?.supabase_id || null,
          amount: Number(data.amount),
          date: data.date || new Date().toISOString().slice(0, 10),
          notes: data.notes || null,
          status: 'pendiente',
          approved_by: data.approved_by || null,
          business_id: bid,
        }).select('id').single())
        await logActivity({ event_type: 'adelanto_created', severity: 'warn',
          target_type: 'adelanto', target_id: row.id,
          target_name: `Adelanto #${row.id}`,
          amount: Number(data.amount) })
        return { id: row.id, supabase_id: sid }
      }),
      list: (params = {}) => tryOr(async () => {
        let q = supabase.from('adelantos').select('*, empleados(nombre, tipo)').eq('business_id', bid)
        if (params.empleado_id) q = q.eq('empleado_id', params.empleado_id)
        if (params.status)      q = q.eq('status', params.status)
        if (params.dateFrom)    q = q.gte('date', params.dateFrom)
        if (params.dateTo)      q = q.lte('date', params.dateTo)
        q = q.order('created_at', { ascending: false })
        const rows = throwSupaError(await q)
        return (rows || []).map(r => ({
          ...r,
          empleado_nombre: r.empleados?.nombre || null,
          empleado_tipo: r.empleados?.tipo || null,
        }))
      }, []),
      byEmpleado: (id) => tryOr(async () => {
        return throwSupaError(await supabase.from('adelantos').select('*')
          .eq('business_id', bid).eq('empleado_id', id).eq('status', 'pendiente')
          .order('date', { ascending: true }))
      }, []),
      pendingTotal: (id) => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('adelantos').select('amount')
          .eq('business_id', bid).eq('empleado_id', id).eq('status', 'pendiente'))
        return (rows || []).reduce((s, r) => s + Number(r.amount || 0), 0)
      }, 0),
      deduct: (id, payrollRunId) => tryOr(async () => {
        throwSupaError(await supabase.from('adelantos').update({
          status: 'deducido',
          deducted_from_payroll_id: payrollRunId,
          deducted_at: new Date().toISOString(),
        }).eq('id', id).eq('business_id', bid))
      }),
      cancel: (id) => tryOr(async () => {
        const { data: row } = await supabase.from('adelantos').select('amount').eq('id', id).eq('business_id', bid).maybeSingle()
        throwSupaError(await supabase.from('adelantos').update({ status: 'cancelado' })
          .eq('id', id).eq('business_id', bid).eq('status', 'pendiente'))
        if (row) {
          await logActivity({ event_type: 'adelanto_cancelled', severity: 'warn',
            target_type: 'adelanto', target_id: id,
            target_name: `Adelanto #${id}`,
            amount: row.amount })
        }
      }),
      summary: () => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('adelantos').select('empleado_id, amount, empleados(id, nombre, tipo)')
          .eq('business_id', bid).eq('status', 'pendiente'))
        const map = {}
        for (const r of (rows || [])) {
          const eid = r.empleado_id
          if (!map[eid]) map[eid] = { id: eid, nombre: r.empleados?.nombre || '', tipo: r.empleados?.tipo || '', pending_total: 0, pending_count: 0 }
          map[eid].pending_total += Number(r.amount || 0)
          map[eid].pending_count++
        }
        return Object.values(map).sort((a, b) => b.pending_total - a.pending_total)
      }, []),
    },

    // ── Salary changes (audit log) ──────────────────────────────────────────
    // All queries join on empleado_supabase_id, not the legacy bigint empleado_id column.
    salaryChanges: {
      byEmpleado: (empleadoId) => tryOr(async () => {
        // Look up the empleado's supabase_id from its PK id (the UI passes id)
        const { data: emp } = await supabase.from('empleados').select('supabase_id').eq('id', empleadoId).eq('business_id', bid).maybeSingle()
        if (!emp?.supabase_id) return []
        return throwSupaError(
          await supabase.from('salary_changes').select('*')
            .eq('business_id', bid).eq('empleado_supabase_id', emp.supabase_id)
            .order('effective_date', { ascending: false }).order('id', { ascending: false })
        )
      }, []),
      atDate: (empleadoId, date) => tryOr(async () => {
        const { data: emp } = await supabase.from('empleados').select('salary, supabase_id').eq('id', empleadoId).eq('business_id', bid).maybeSingle()
        if (!emp?.supabase_id) return Number(emp?.salary || 0)
        const { data: row } = await supabase.from('salary_changes').select('new_salary')
          .eq('business_id', bid).eq('empleado_supabase_id', emp.supabase_id)
          .lte('effective_date', date)
          .order('effective_date', { ascending: false }).order('id', { ascending: false })
          .limit(1).maybeSingle()
        if (row) return Number(row.new_salary)
        return Number(emp?.salary || 0)
      }, 0),
      create: (data) => tryOr(async () => {
        // The UI (NominaEmpleados.handleSaveSalaryChange) passes:
        //   { empleado_id, new_salary, effective_date, reason, changed_by }
        // We resolve empleado_id → empleado_supabase_id, insert the row, and
        // also update empleados.salary if this is the latest effective_date
        // (keeps Dashboard + commission calcs in sync without a second click).
        const { data: emp } = await supabase.from('empleados').select('id, salary, supabase_id').eq('id', data.empleado_id).eq('business_id', bid).maybeSingle()
        if (!emp?.supabase_id) throw new Error('Empleado no encontrado')
        // old_salary = whatever was in effect strictly before this date
        const { data: prev } = await supabase.from('salary_changes').select('new_salary')
          .eq('business_id', bid).eq('empleado_supabase_id', emp.supabase_id)
          .lt('effective_date', data.effective_date)
          .order('effective_date', { ascending: false }).order('id', { ascending: false })
          .limit(1).maybeSingle()
        const oldSalary = prev ? Number(prev.new_salary) : 0
        const newSalary = Number(data.new_salary) || 0
        const sid = crypto.randomUUID()
        const inserted = throwSupaError(await supabase.from('salary_changes').insert({
          supabase_id: sid,
          empleado_supabase_id: emp.supabase_id,
          old_salary: oldSalary, new_salary: newSalary,
          effective_date: data.effective_date,
          reason: data.reason || null,
          business_id: bid,
        }).select('id').single())
        // If this is now the most-recent row, sync empleados.salary
        const { data: latest } = await supabase.from('salary_changes').select('new_salary, effective_date, id')
          .eq('business_id', bid).eq('empleado_supabase_id', emp.supabase_id)
          .order('effective_date', { ascending: false }).order('id', { ascending: false })
          .limit(1).maybeSingle()
        if (latest && Number(latest.new_salary) !== Number(emp.salary || 0)) {
          await supabase.from('empleados').update({ salary: Number(latest.new_salary) })
            .eq('id', emp.id).eq('business_id', bid)
        }
        return { id: inserted.id, supabase_id: sid }
      }),
      remove: (id) => tryOr(async () => {
        // Look up empleado_supabase_id before deleting so we can re-sync
        // empleados.salary to whatever becomes the new latest row.
        const { data: row } = await supabase.from('salary_changes').select('empleado_supabase_id').eq('id', id).eq('business_id', bid).maybeSingle()
        if (!row?.empleado_supabase_id) return
        throwSupaError(await supabase.from('salary_changes').delete().eq('id', id).eq('business_id', bid))
        const { data: latest } = await supabase.from('salary_changes').select('new_salary')
          .eq('business_id', bid).eq('empleado_supabase_id', row.empleado_supabase_id)
          .order('effective_date', { ascending: false }).order('id', { ascending: false })
          .limit(1).maybeSingle()
        const newSal = latest ? Number(latest.new_salary) : 0
        await supabase.from('empleados').update({ salary: newSal })
          .eq('supabase_id', row.empleado_supabase_id).eq('business_id', bid)
      }),
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
          supabase_id: crypto.randomUUID(),
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
        if ('active' in patch) patch.active = !!patch.active
        throwSupaError(await supabase.from('clients').update(patch).eq('id', id).eq('business_id', bid))
      }),

      updateBalance: ({ id, delta }) => tryOr(async () => {
        const { data: cl } = await supabase.from('clients').select('balance').eq('id', id).eq('business_id', bid).single()
        if (cl) {
          const newBal = Math.max(0, (cl.balance || 0) + delta)
          throwSupaError(await supabase.from('clients').update({ balance: newBal }).eq('id', id).eq('business_id', bid))
        }
      }),

      openTickets: (clientId) => tryOr(async () => {
        const { data: tickets } = await supabase.from('tickets')
          .select('*')
          .eq('business_id', bid).eq('client_id', clientId)
          .eq('tipo_venta', 'credito').eq('status', 'pendiente')
          .order('created_at', { ascending: true })
        if (!tickets?.length) return []
        // Fetch items — dual-key: ticket_id (web-created) + ticket_supabase_id (synced)
        const tUuids = tickets.map(t => t.id).filter(Boolean)
        const tSids  = [...new Set(tickets.map(t => t.supabase_id).filter(Boolean))]
        const itemsMap = {}
        if (tUuids.length) { const { data: ir } = await supabase.from('ticket_items').select('ticket_id, name, price, is_wash').in('ticket_id', tUuids); for (const i of (ir || [])) { if (!itemsMap[i.ticket_id]) itemsMap[i.ticket_id] = []; itemsMap[i.ticket_id].push(i) } }
        if (tSids.length)  { const { data: ir } = await supabase.from('ticket_items').select('ticket_supabase_id, name, price, is_wash').in('ticket_supabase_id', tSids); for (const i of (ir || [])) { if (!itemsMap[i.ticket_supabase_id]) itemsMap[i.ticket_supabase_id] = []; itemsMap[i.ticket_supabase_id].push(i) } }
        return tickets.map(t => ({
          ...t,
          items: (itemsMap[t.id] || itemsMap[t.supabase_id] || []).filter(i => i.name != null),
        }))
      }, []),
    },

    credits: {
      collect: (data) => tryOr(async () => {
        // Mirrors desktop collectCredit(): mark tickets paid, insert credit_payment,
        // decrease client balance. No RPC — done step-by-step.
        const { clientId, ticketIds, amount, paymentMethod, ncf, notes, cajeroId } = data

        // 1. Mark each ticket as 'cobrado' with the payment method
        for (const tid of (ticketIds || [])) {
          await supabase.from('tickets').update({ status: 'cobrado', payment_method: paymentMethod })
            .eq('id', tid).eq('business_id', bid)
        }

        // 2. Decrease client balance
        const { data: cl } = await supabase.from('clients').select('balance, supabase_id').eq('id', clientId).eq('business_id', bid).single()
        if (cl) {
          await supabase.from('clients').update({ balance: Math.max(0, (cl.balance || 0) - amount) })
            .eq('id', clientId).eq('business_id', bid)
        }

        // 3. Insert credit_payment record
        const sid = crypto.randomUUID()
        const row = throwSupaError(await supabase.from('credit_payments').insert({
          supabase_id: sid,
          client_id: clientId,
          client_supabase_id: cl?.supabase_id || null,
          ticket_ids: ticketIds,
          amount,
          payment_method: paymentMethod,
          ncf: ncf || null,
          notes: notes || null,
          cajero_id: cajeroId || null,
          business_id: bid,
        }).select('id').single())

        return { id: row.id, supabase_id: sid }
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

        // Fetch items — dual-key: ticket_id (web-created) + ticket_supabase_id (synced)
        const tUuids = rows.map(r => r.id).filter(Boolean)
        const tSids  = [...new Set(rows.map(r => r.supabase_id).filter(Boolean))]
        const itemsMap = {}
        if (tUuids.length) { const { data: ir } = await supabase.from('ticket_items').select('ticket_id, name, price, cost, is_wash, quantity, sku').in('ticket_id', tUuids); for (const i of (ir || [])) { if (!itemsMap[i.ticket_id]) itemsMap[i.ticket_id] = []; itemsMap[i.ticket_id].push(i) } }
        if (tSids.length)  { const { data: ir } = await supabase.from('ticket_items').select('ticket_supabase_id, name, price, cost, is_wash, quantity, sku').in('ticket_supabase_id', tSids); for (const i of (ir || [])) { if (!itemsMap[i.ticket_supabase_id]) itemsMap[i.ticket_supabase_id] = []; itemsMap[i.ticket_supabase_id].push(i) } }

        // Fetch client names — dual-key
        const clientIds = [...new Set(rows.map(r => r.client_id).filter(Boolean))]
        const clientSids = [...new Set(rows.map(r => r.client_supabase_id).filter(Boolean))]
        let clientMap = {}
        if (clientIds.length) { const { data: cls } = await supabase.from('clients').select('id, name, rnc').in('id', clientIds); for (const c of (cls || [])) clientMap[c.id] = c }
        if (clientSids.length) { const { data: cls } = await supabase.from('clients').select('id, supabase_id, name, rnc').in('supabase_id', clientSids); for (const c of (cls || [])) clientMap[c.supabase_id] = c }

        // Fetch cajero names — dual-key
        const cajeroIds = [...new Set(rows.map(r => r.cajero_id).filter(Boolean))]
        const cajeroSids = [...new Set(rows.map(r => r.cajero_supabase_id).filter(Boolean))]
        let cajeroMap = {}
        if (cajeroIds.length) { const { data: staff } = await supabase.from('staff').select('id, name').in('id', cajeroIds); for (const s of (staff || [])) cajeroMap[s.id] = s }
        if (cajeroSids.length) { const { data: ur } = await supabase.from('users').select('supabase_id, name').in('supabase_id', cajeroSids); for (const u of (ur || [])) cajeroMap[u.supabase_id] = u }

        return rows.map(r => {
          const iKey = r.id || r.supabase_id
          const items = (itemsMap[r.id] || itemsMap[r.supabase_id] || []).filter(i => i.name != null)
          const cKey = r.client_id || r.client_supabase_id
          const cajKey = r.cajero_id || r.cajero_supabase_id
          return {
            ...r,
            items,
            service_names: items.map(i => i.name).join(' + ') || null,
            client_name: (clientMap[cKey] || clientMap[r.client_id] || clientMap[r.client_supabase_id])?.name || null,
            client_rnc:  (clientMap[cKey] || clientMap[r.client_id] || clientMap[r.client_supabase_id])?.rnc  || null,
            cajero_name: (cajeroMap[cajKey] || cajeroMap[r.cajero_id] || cajeroMap[r.cajero_supabase_id])?.name || null,
          }
        })
      }, []),

      byId: (id) => tryOr(async () => {
        const { data: ticket } = await supabase.from('tickets')
          .select('*')
          .eq('id', id).eq('business_id', bid).single()
        if (!ticket) return null

        // Fetch items — dual-key: ticket_id (web-created) + ticket_supabase_id (synced)
        let items = []
        const { data: itemRows } = await supabase.from('ticket_items')
          .select('*').eq('ticket_id', id)
        items = (itemRows || []).filter(i => i.name != null)
        // If no items via ticket_id, try ticket_supabase_id (desktop-synced data)
        if (!items.length && ticket.supabase_id) {
          const { data: sidItems } = await supabase.from('ticket_items')
            .select('*').eq('ticket_supabase_id', ticket.supabase_id)
          items = (sidItems || []).filter(i => i.name != null)
        }

        // Fetch client name — dual-key
        let client_name = null, client_rnc = null
        const cid = ticket.client_id || ticket.client_supabase_id
        if (cid) {
          let cl = null
          if (ticket.client_id) { const r = await supabase.from('clients').select('name, rnc').eq('id', ticket.client_id).maybeSingle(); cl = r.data }
          if (!cl && ticket.client_supabase_id) { const r = await supabase.from('clients').select('name, rnc').eq('supabase_id', ticket.client_supabase_id).maybeSingle(); cl = r.data }
          if (cl) { client_name = cl.name; client_rnc = cl.rnc }
        }

        // Fetch cajero name — dual-key
        let cajero_name = null
        const cajId = ticket.cajero_id || ticket.cajero_supabase_id
        if (cajId) {
          let cj = null
          if (ticket.cajero_id) { const r = await supabase.from('staff').select('name').eq('id', ticket.cajero_id).maybeSingle(); cj = r.data }
          if (!cj && ticket.cajero_supabase_id) { const r = await supabase.from('users').select('name').eq('supabase_id', ticket.cajero_supabase_id).maybeSingle(); cj = r.data }
          if (cj) cajero_name = cj.name
        }

        let ecf_result = {}
        try { ecf_result = typeof ticket.ecf_result === 'string' ? JSON.parse(ticket.ecf_result) : (ticket.ecf_result || {}) } catch {}

        // Resolve washer_ids to washer_names
        let washer_ids = []
        try { washer_ids = typeof ticket.washer_ids === 'string' ? JSON.parse(ticket.washer_ids) : (ticket.washer_ids || []) } catch {}
        let washer_names = []
        if (washer_ids.length) {
          const { data: wr } = await supabase.from('washers').select('id, supabase_id, name').in('id', washer_ids)
          if (wr?.length) { washer_names = wr.map(w => w.name) }
          else {
            // Try supabase_id lookup (synced washer IDs)
            const { data: wr2 } = await supabase.from('washers').select('id, supabase_id, name').in('supabase_id', washer_ids)
            if (wr2?.length) washer_names = wr2.map(w => w.name)
          }
        }

        return {
          ...ticket,
          client_name,
          client_rnc,
          cajero_name,
          items,
          ecf_result,
          washer_ids,
          washer_names,
        }
      }, null),

      create: async (data) => {
        try {
          return await tryOr(async () => {
            // ── Server-side price validation (#21) ────────────────────────
            // Validate item prices against real DB values before proceeding.
            // Prevents client-side price manipulation via DevTools.
            const itemsToValidate = (data.items || []).filter(i => i.service_id || i.inventory_item_id)
            if (itemsToValidate.length > 0) {
              const { data: validation, error: valErr } = await supabase.rpc('validate_ticket_prices', {
                p_business_id: bid,
                p_items: itemsToValidate.map(i => ({
                  service_id: i.service_id || null,
                  inventory_item_id: i.inventory_item_id || null,
                  name: i.name,
                  price: i.price,
                  quantity: i.quantity || 1,
                })),
              })
              if (valErr) console.error('[web.js] price validation RPC error:', valErr.message)
              if (validation && !validation.valid) {
                const errMsg = (validation.errors || []).map(e => e.error).join('; ')
                throw new Error('Price validation failed: ' + errMsg)
              }
            }

            // Generate doc_number
            // Atomic doc_number: find max existing, not count (avoids gaps from voids)
            const { data: lastDoc } = await supabase.from('tickets')
              .select('doc_number')
              .eq('business_id', bid)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
            let nextNum = 1
            if (lastDoc?.doc_number) {
              const m = lastDoc.doc_number.match(/T-(\d+)/)
              if (m) nextNum = parseInt(m[1]) + 1
            }
            const docNum = `T-${String(nextNum).padStart(4, '0')}`

            const status = data.status || (data.tipo_venta === 'credito' || data.payment_method === 'credit' ? 'pendiente' : 'cobrado')

            // Insert ticket
            const ticketSid = crypto.randomUUID()
            const ticket = throwSupaError(await supabase.from('tickets').insert({
              supabase_id:     ticketSid,
              business_id:     bid,
              doc_number:      docNum,
              client_id:       data.client_id || null,
              client_supabase_id: data.client_supabase_id || null,
              washer_ids:      data.washer_ids || [],
              seller_id:       data.seller_id || null,
              seller_supabase_id: data.seller_supabase_id || null,
              cajero_id:       data.cajero_id || null,
              cajero_supabase_id: data.cajero_supabase_id || null,
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
                const { data: svcRows } = await supabase.from('services').select('id, cost, aplica_itbis').in('id', svcIds)
                svcCostById = new Map((svcRows || []).map(r => [r.id, r.cost || 0]))
                var svcItbisById = new Map((svcRows || []).map(r => [r.id, r.aplica_itbis ?? 1]))
              }
              const itemRows = items.map(i => ({
                supabase_id:        crypto.randomUUID(),
                ticket_id:          ticket.id,
                ticket_supabase_id: ticketSid,
                service_id:         i.service_id || null,
                service_supabase_id: i.service_supabase_id || null,
                inventory_item_id:  i.inventory_item_id || null,
                inventory_item_supabase_id: i.inventory_item_supabase_id || null,
                name:               i.name,
                price:              i.price,
                cost:               i.cost != null ? Number(i.cost) : (i.service_id ? (svcCostById.get(i.service_id) || 0) : 0),
                itbis: (() => {
                  const aplica = i.aplica_itbis !== undefined ? i.aplica_itbis : (i.service_id ? (svcItbisById.get(i.service_id) ?? 1) : 1)
                  return aplica !== 0 ? parseFloat((i.price * 0.18).toFixed(2)) : 0
                })(),
                is_wash:            i.is_wash ?? true,
                quantity:           i.quantity || 1,
                sku:                i.sku || null,
              }))
              // Try with business_id (some Supabase schemas have it)
              const { error: err1 } = await supabase.from('ticket_items').insert(
                itemRows.map(r => ({ ...r, business_id: bid }))
              )
              if (err1) {
                // Retry without business_id
                const { error: err2 } = await supabase.from('ticket_items').insert(itemRows)
                if (err2) console.error('[ticket_items insert]', err2.message)
              }

              // Auto-deduct inventory stock for product items
              for (const item of items) {
                if (item.inventory_item_id) {
                  const qty = item.quantity || 1
                  try {
                    const { data: inv } = await supabase.from('inventory_items').select('quantity').eq('id', item.inventory_item_id).eq('business_id', bid).single()
                    if (inv) await supabase.from('inventory_items').update({ quantity: Math.max(0, (inv.quantity || 0) - qty) }).eq('id', item.inventory_item_id).eq('business_id', bid)
                  } catch (e) { console.error('[web.js] stock deduction failed:', e.message) }
                }
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
                  .select('id, supabase_id, commission_pct').in('id', data.washer_ids)
                for (const w of (washerRows || [])) {
                  const pct = w.commission_pct || 0
                  if (pct <= 0) continue
                  const amt = parseFloat((commBase * pct / 100).toFixed(2))
                  await supabase.from('washer_commissions').insert({
                    supabase_id: crypto.randomUUID(), business_id: bid, washer_id: w.id, washer_supabase_id: w.supabase_id || null, ticket_id: ticket.id, ticket_supabase_id: ticketSid,
                    base_amount: commBase, commission_pct: pct, commission_amount: amt, paid: false,
                  })
                }
              } catch (e) { console.error('[web.js] commission insert failed:', e.message) }
            }

            // Seller commission — only on wash/service items (NOT beverages/snacks)
            if (ticket?.id && commBase > 0 && data.seller_id) {
              try {
                const { data: seller } = await supabase.from('sellers')
                  .select('id, supabase_id, commission_pct').eq('id', data.seller_id).single()
                if (seller && seller.commission_pct > 0) {
                  const amt = parseFloat((commBase * seller.commission_pct / 100).toFixed(2))
                  await supabase.from('seller_commissions').insert({
                    supabase_id: crypto.randomUUID(), business_id: bid, seller_id: seller.id, seller_supabase_id: seller.supabase_id || null, ticket_id: ticket.id, ticket_supabase_id: ticketSid,
                    base_amount: commBase, commission_pct: seller.commission_pct, commission_amount: amt, paid: false,
                  })
                }
              } catch (e) { console.error('[web.js] commission insert failed:', e.message) }
            }

            // Cajero commission — on beverages/snacks ONLY
            if (ticket?.id && bevBase > 0 && data.cajero_id) {
              try {
                const { data: cajero } = await supabase.from('staff')
                  .select('id, supabase_id, commission_pct').eq('id', data.cajero_id).single()
                if (cajero && cajero.commission_pct > 0) {
                  const amt = parseFloat((bevBase * cajero.commission_pct / 100).toFixed(2))
                  await supabase.from('cajero_commissions').insert({
                    supabase_id: crypto.randomUUID(), business_id: bid, cajero_id: cajero.id, cajero_supabase_id: cajero.supabase_id || null, ticket_id: ticket.id, ticket_supabase_id: ticketSid,
                    base_amount: bevBase, commission_pct: cajero.commission_pct, commission_amount: amt, paid: false,
                  })
                }
              } catch (e) { console.error('[web.js] commission insert failed:', e.message) }
            }

            // Auto-add to queue ONLY for pendiente tickets (Encolar path).
            // Cobrado tickets (direct Cobrar) skip the queue — they're already paid.
            let queueError = null
            if (ticket?.id && status === 'pendiente') {
              const firstWasher = Array.isArray(data.washer_ids) && data.washer_ids[0] ? data.washer_ids[0] : null
              const { error: queueErr } = await supabase.from('queue').insert({
                supabase_id: crypto.randomUUID(),
                business_id: bid,
                ticket_id:   ticket.id,
                ticket_supabase_id: ticketSid,
                status:      'waiting',
                washer_id:   firstWasher,
              })
              if (queueErr) queueError = queueErr.message
            }

            // Update client balance for credit sales
            if (status === 'pendiente' && data.client_id) {
              // Increment client balance for credit sale (no RPC — direct update)
              try {
                const { data: cl } = await supabase.from('clients').select('balance').eq('id', data.client_id).eq('business_id', bid).single()
                if (cl) await supabase.from('clients').update({ balance: (cl.balance || 0) + (data.total || 0) }).eq('id', data.client_id).eq('business_id', bid)
              } catch (e) { console.error('[web.js] client balance increment failed:', e.message) }
            }

            const desc = Number(data.descuento || 0)
            const subt = Number(data.subtotal || 0)
            const pct  = subt > 0 ? (desc / subt) * 100 : 0
            if (desc > 500 || pct > 15) {
              await logActivity({ event_type: 'discount_applied',
                severity: desc > 2000 || pct > 30 ? 'warn' : 'info',
                target_type: 'ticket', target_id: ticket.id, target_name: docNum || `#${ticket.id}`,
                amount: desc,
                metadata: { subtotal: subt, total: data.total, pct: Math.round(pct * 10) / 10, payment_method: data.payment_method } })
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
        const priorRow = (await supabase.from('tickets').select('doc_number, total, payment_method, tipo_venta, ncf').eq('id', id).eq('business_id', bid).maybeSingle())?.data
        throwSupaError(await supabase.from('tickets').update({
          status: 'nula',
          void_reason: reason || '',
          void_by: voidBy || null,
          void_at: new Date().toISOString(),
        }).eq('id', id).eq('business_id', bid))
        if (priorRow) {
          await logActivity({ event_type: 'ticket_voided', severity: 'critical',
            target_type: 'ticket', target_id: id, target_name: priorRow.doc_number || `#${id}`,
            amount: priorRow.total, reason: reason || null,
            metadata: { payment_method: priorRow.payment_method, tipo_venta: priorRow.tipo_venta, ncf: priorRow.ncf } })
        }

        // Reverse inventory stock for product items
        try {
          const { data: items } = await supabase.from('ticket_items')
            .select('inventory_item_id, quantity')
            .eq('ticket_id', id)
            .not('inventory_item_id', 'is', null)
          for (const item of (items || [])) {
            const qty = item.quantity || 1
            const { data: inv } = await supabase.from('inventory_items').select('quantity').eq('id', item.inventory_item_id).eq('business_id', bid).single()
            if (inv) await supabase.from('inventory_items').update({ quantity: (inv.quantity || 0) + qty }).eq('id', item.inventory_item_id).eq('business_id', bid)
          }
        } catch (e) { console.error('[web.js] void stock reversal failed:', e.message) }
      }),

      byDateRange: (params) => tryOr(async () => {
        const { dateFrom, dateTo } = params
        let q = supabase.from('tickets').select('*').eq('business_id', bid)
        if (dateFrom) q = q.gte('created_at', dateFrom)
        if (dateTo)   q = q.lte('created_at', dateTo)
        q = q.order('created_at', { ascending: false }).limit(500)
        const rows = throwSupaError(await q)
        if (!rows?.length) return []

        // Fetch items — dual-key: ticket_id (web-created) + ticket_supabase_id (synced)
        const tUuids = rows.map(r => r.id).filter(Boolean)
        const tSids  = [...new Set(rows.map(r => r.supabase_id).filter(Boolean))]
        const itemsMap = {}
        if (tUuids.length) { const { data: ir } = await supabase.from('ticket_items').select('ticket_id, name, price, cost, is_wash, quantity, sku').in('ticket_id', tUuids); for (const i of (ir || [])) { if (!itemsMap[i.ticket_id]) itemsMap[i.ticket_id] = []; itemsMap[i.ticket_id].push(i) } }
        if (tSids.length)  { const { data: ir } = await supabase.from('ticket_items').select('ticket_supabase_id, name, price, cost, is_wash, quantity, sku').in('ticket_supabase_id', tSids); for (const i of (ir || [])) { if (!itemsMap[i.ticket_supabase_id]) itemsMap[i.ticket_supabase_id] = []; itemsMap[i.ticket_supabase_id].push(i) } }

        // Fetch client names — dual-key
        const clientIds = [...new Set(rows.map(r => r.client_id).filter(Boolean))]
        const clientSids = [...new Set(rows.map(r => r.client_supabase_id).filter(Boolean))]
        let clientMap = {}
        if (clientIds.length) { const { data: cls } = await supabase.from('clients').select('id, name, rnc').in('id', clientIds); for (const c of (cls || [])) clientMap[c.id] = c }
        if (clientSids.length) { const { data: cls } = await supabase.from('clients').select('id, supabase_id, name, rnc').in('supabase_id', clientSids); for (const c of (cls || [])) clientMap[c.supabase_id] = c }

        // Fetch cajero names — dual-key
        const cajeroIds = [...new Set(rows.map(r => r.cajero_id).filter(Boolean))]
        const cajeroSids = [...new Set(rows.map(r => r.cajero_supabase_id).filter(Boolean))]
        let cajeroMap = {}
        if (cajeroIds.length) { const { data: staff } = await supabase.from('staff').select('id, name').in('id', cajeroIds); for (const s of (staff || [])) cajeroMap[s.id] = s }
        if (cajeroSids.length) { const { data: ur } = await supabase.from('users').select('supabase_id, name').in('supabase_id', cajeroSids); for (const u of (ur || [])) cajeroMap[u.supabase_id] = u }

        // Fetch washer names for all tickets
        const allWasherIds = new Set()
        for (const r of rows) {
          let wids = []
          try { wids = typeof r.washer_ids === 'string' ? JSON.parse(r.washer_ids) : (r.washer_ids || []) } catch {}
          for (const w of wids) if (w) allWasherIds.add(w)
        }
        const washerMap = {}
        if (allWasherIds.size) {
          const wArr = [...allWasherIds]
          const { data: wr } = await supabase.from('washers').select('id, supabase_id, name').in('id', wArr)
          for (const w of (wr || [])) { washerMap[w.id] = w.name; if (w.supabase_id) washerMap[w.supabase_id] = w.name }
          // Also try supabase_id for synced washer references
          const foundIds = new Set((wr || []).map(w => String(w.id)))
          const unfound = wArr.filter(w => !foundIds.has(String(w)))
          if (unfound.length) {
            const { data: wr2 } = await supabase.from('washers').select('id, supabase_id, name').in('supabase_id', unfound)
            for (const w of (wr2 || [])) { washerMap[w.supabase_id] = w.name; washerMap[w.id] = w.name }
          }
        }

        return rows.map(r => {
          const items = (itemsMap[r.id] || itemsMap[r.supabase_id] || []).filter(i => i.name != null)
          const cKey = r.client_id || r.client_supabase_id
          const cajKey = r.cajero_id || r.cajero_supabase_id
          let wids = []
          try { wids = typeof r.washer_ids === 'string' ? JSON.parse(r.washer_ids) : (r.washer_ids || []) } catch {}
          return {
            ...r,
            items,
            service_names: items.map(i => i.name).join(' + ') || null,
            client_name: (clientMap[cKey] || clientMap[r.client_id] || clientMap[r.client_supabase_id])?.name || null,
            client_rnc:  (clientMap[cKey] || clientMap[r.client_id] || clientMap[r.client_supabase_id])?.rnc  || null,
            cajero_name: (cajeroMap[cajKey] || cajeroMap[r.cajero_id] || cajeroMap[r.cajero_supabase_id])?.name || null,
            washer_names: wids.map(w => washerMap[w] || washerMap[String(w)]).filter(Boolean),
          }
        })
      }, []),
    },

    // ── Queue ────────────────────────────────────────────────────────────────

    queue: {
      active: () => tryOr(async () => {
        // Fetch queue rows — include both UUID FK and supabase_id FK columns
        const { data: rows, error: qErr } = await supabase.from('queue')
          .select('*')
          .eq('business_id', bid).not('status', 'in', '("done","cancelled")')
          .order('created_at', { ascending: true })
        if (qErr) throw new Error(qErr.message)
        if (!rows?.length) return []

        // Resolve tickets — by UUID ticket_id or ticket_supabase_id
        const tUuids = [...new Set(rows.map(q => q.ticket_id).filter(Boolean))]
        const tSids  = [...new Set(rows.map(q => q.ticket_supabase_id).filter(Boolean))]
        const ticketMap = {}
        if (tUuids.length) { const { data: tr } = await supabase.from('tickets').select('id, doc_number, total, vehicle_plate, created_at, client_id, client_supabase_id').in('id', tUuids); for (const t of (tr || [])) ticketMap[t.id] = t }
        if (tSids.length)  { const { data: tr } = await supabase.from('tickets').select('id, supabase_id, doc_number, total, vehicle_plate, created_at, client_id, client_supabase_id').in('supabase_id', tSids); for (const t of (tr || [])) ticketMap[t.supabase_id] = t }

        // Resolve washers — by UUID washer_id or washer_supabase_id
        const wUuids = [...new Set(rows.map(q => q.washer_id).filter(Boolean))]
        const wSids  = [...new Set(rows.map(q => q.washer_supabase_id).filter(Boolean))]
        const washerMap = {}
        if (wUuids.length) { const { data: wr } = await supabase.from('washers').select('id, name').in('id', wUuids); for (const w of (wr || [])) washerMap[w.id] = w.name }
        if (wSids.length)  { const { data: wr } = await supabase.from('washers').select('id, supabase_id, name').in('supabase_id', wSids); for (const w of (wr || [])) washerMap[w.supabase_id] = w.name }

        // Resolve clients
        const allTickets = Object.values(ticketMap)
        const cUuids = [...new Set(allTickets.map(t => t.client_id).filter(Boolean))]
        const cSids  = [...new Set(allTickets.map(t => t.client_supabase_id).filter(Boolean))]
        const clientMap = {}
        if (cUuids.length) { const { data: cls } = await supabase.from('clients').select('id, name').in('id', cUuids); for (const c of (cls || [])) clientMap[c.id] = c.name }
        if (cSids.length)  { const { data: cls } = await supabase.from('clients').select('id, supabase_id, name').in('supabase_id', cSids); for (const c of (cls || [])) clientMap[c.supabase_id] = c.name }

        // Resolve ticket items
        const itemsMap = {}
        if (tUuids.length) { const { data: items } = await supabase.from('ticket_items').select('ticket_id, name').in('ticket_id', tUuids); for (const i of (items || [])) { if (!itemsMap[i.ticket_id]) itemsMap[i.ticket_id] = []; itemsMap[i.ticket_id].push(i.name) } }
        if (tSids.length)  { const { data: items } = await supabase.from('ticket_items').select('ticket_supabase_id, name').in('ticket_supabase_id', tSids); for (const i of (items || [])) { if (!itemsMap[i.ticket_supabase_id]) itemsMap[i.ticket_supabase_id] = []; itemsMap[i.ticket_supabase_id].push(i.name) } }

        return rows.map(q => {
          const tKey = q.ticket_id || q.ticket_supabase_id
          const wKey = q.washer_id || q.washer_supabase_id
          const t = ticketMap[tKey] || {}
          const cKey = t.client_id || t.client_supabase_id
          return {
            ...q,
            doc_number:     t.doc_number    || null,
            total:          t.total          || 0,
            vehicle_plate:  t.vehicle_plate  || null,
            ticket_created: t.created_at     || null,
            client_name:    clientMap[cKey]   || null,
            services:       (itemsMap[tKey] || []).join(' + '),
            washer_name:    washerMap[wKey]   || null,
          }
        })
      }, []),

      updateStatus: (data) => tryOr(async () => {
        const { id, status, washerId } = data
        const now = new Date().toISOString()
        const patch = { status }
        if (status === 'in_progress') {
          // washerId could be a Supabase UUID or a supabase_id — store in appropriate column
          if (washerId) {
            // Check if it's a native Supabase row ID or a synced supabase_id
            const { data: w } = await supabase.from('washers').select('id').eq('id', washerId).maybeSingle()
            if (w) patch.washer_id = washerId
            else patch.washer_supabase_id = washerId
          }
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
        await supabase.from('queue_deletions').insert({ supabase_id: crypto.randomUUID(), queue_id: id, ticket_id: row.data?.ticket_id, deleted_by: deletedBy || 'unknown', deleted_at: now, reason: 'manual', business_id: bid })
        return { id }
      }),
    },

    // ── Commissions ──────────────────────────────────────────────────────────

    commissions: {
      byWasher: (params) => tryOr(async () => {
        const washerId = params.washerId
        const dateFrom = params.from || params.dateFrom
        const dateTo   = params.to   || params.dateTo
        // Try UUID FK first, fall back to supabase_id FK
        let q = supabase.from('washer_commissions').select('*').eq('business_id', bid)
        const isUuid = washerId?.includes?.('-')
        if (isUuid) q = q.or(`washer_id.eq.${washerId},washer_supabase_id.eq.${washerId}`)
        else q = q.eq('washer_id', washerId)
        if (dateFrom) q = q.gte('created_at', dateFrom)
        if (dateTo)   q = q.lte('created_at', dateTo)
        q = q.order('created_at', { ascending: false }).limit(2000)
        const rows = throwSupaError(await q)
        if (!rows?.length) return []

        // Fetch ticket details — use both ticket_id and ticket_supabase_id
        const tUuids = [...new Set(rows.map(r => r.ticket_id).filter(Boolean))]
        const tSids  = [...new Set(rows.map(r => r.ticket_supabase_id).filter(Boolean))]
        const ticketMap = {}
        if (tUuids.length) { const { data: tr } = await supabase.from('tickets').select('id, doc_number, created_at, vehicle_plate, status').in('id', tUuids); for (const t of (tr || [])) ticketMap[t.id] = t }
        if (tSids.length)  { const { data: tr } = await supabase.from('tickets').select('id, supabase_id, doc_number, created_at, vehicle_plate, status').in('supabase_id', tSids); for (const t of (tr || [])) ticketMap[t.supabase_id] = t }

        // Fetch wash-only items
        const allTids = [...new Set([...tUuids, ...tSids])]
        const itemsMap = {}
        if (tUuids.length) { const { data: ir } = await supabase.from('ticket_items').select('ticket_id, name').in('ticket_id', tUuids).eq('is_wash', true); for (const i of (ir || [])) { if (!itemsMap[i.ticket_id]) itemsMap[i.ticket_id] = []; itemsMap[i.ticket_id].push(i.name) } }
        if (tSids.length)  { const { data: ir } = await supabase.from('ticket_items').select('ticket_supabase_id, name').in('ticket_supabase_id', tSids).eq('is_wash', true); for (const i of (ir || [])) { if (!itemsMap[i.ticket_supabase_id]) itemsMap[i.ticket_supabase_id] = []; itemsMap[i.ticket_supabase_id].push(i.name) } }

        // Fetch washer info
        let washerRow = null
        if (isUuid) {
          const { data: w1 } = await supabase.from('washers').select('name, commission_pct').eq('id', washerId).maybeSingle()
          washerRow = w1
          if (!w1) { const { data: w2 } = await supabase.from('washers').select('name, commission_pct').eq('supabase_id', washerId).maybeSingle(); washerRow = w2 }
        }

        return rows.map(r => {
          const tKey = r.ticket_id || r.ticket_supabase_id
          const t = ticketMap[tKey] || ticketMap[r.ticket_id] || ticketMap[r.ticket_supabase_id] || {}
          return {
            ...r,
            doc_number:     t.doc_number   || null,
            ticket_date:    t.created_at    || r.created_at,
            vehicle_plate:  t.vehicle_plate || null,
            washer_name:    washerRow?.name  || '—',
            commission_pct: washerRow?.commission_pct || r.commission_pct || 0,
            services:       (itemsMap[tKey] || itemsMap[r.ticket_id] || itemsMap[r.ticket_supabase_id] || []).join(' + '),
          }
        })
      }, []),

      byPeriod: (params) => tryOr(async () => {
        const dateFrom = params.from || params.dateFrom
        const dateTo   = params.to   || params.dateTo
        // Fetch commissions — include both UUID FK and supabase_id FK for compatibility
        const { data: rows, error } = await supabase.from('washer_commissions')
          .select('washer_id, washer_supabase_id, ticket_id, ticket_supabase_id, base_amount, commission_pct, commission_amount, created_at')
          .eq('business_id', bid)
        if (error) throw new Error(error.message)
        if (!rows?.length) return []

        // Filter by date range using commission's own created_at
        const from = dateFrom || '2000-01-01'
        const to   = dateTo   || '2099-12-31'
        const filtered = rows.filter(r => r.created_at >= from && r.created_at <= to)
        if (!filtered.length) return []

        // Fetch washer names — try UUID id first, fall back to supabase_id
        const washerUuids = [...new Set(filtered.map(r => r.washer_id).filter(Boolean))]
        const washerSids  = [...new Set(filtered.map(r => r.washer_supabase_id).filter(Boolean))]
        let washerMap = {}
        if (washerUuids.length) {
          const { data: wr } = await supabase.from('washers').select('id, name, commission_pct').in('id', washerUuids)
          for (const w of (wr || [])) washerMap[w.id] = w
        }
        if (washerSids.length) {
          const { data: wr } = await supabase.from('washers').select('id, supabase_id, name, commission_pct').in('supabase_id', washerSids)
          for (const w of (wr || [])) washerMap[w.supabase_id] = w
        }

        // Group by washer (use whichever key is available)
        const map = {}
        for (const r of filtered) {
          const wid = r.washer_id || r.washer_supabase_id
          const w = washerMap[wid] || washerMap[r.washer_id] || washerMap[r.washer_supabase_id] || {}
          if (!map[wid]) map[wid] = { washer_id: wid, washer_name: w.name || '—', commission_pct: w.commission_pct || r.commission_pct || 0, ticket_count: 0, total_base: 0, total_commission: 0 }
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
        const isUuid = sellerId?.includes?.('-')
        let q = supabase.from('seller_commissions').select('*').eq('business_id', bid)
        if (isUuid) q = q.or(`seller_id.eq.${sellerId},seller_supabase_id.eq.${sellerId}`)
        else q = q.eq('seller_id', sellerId)
        if (dateFrom) q = q.gte('created_at', dateFrom)
        if (dateTo)   q = q.lte('created_at', dateTo)
        q = q.order('created_at', { ascending: false }).limit(2000)
        const rows = throwSupaError(await q)
        if (!rows?.length) return []
        const tUuids = [...new Set(rows.map(r => r.ticket_id).filter(Boolean))]
        const tSids  = [...new Set(rows.map(r => r.ticket_supabase_id).filter(Boolean))]
        const tMap = {}
        if (tUuids.length) { const { data: tr } = await supabase.from('tickets').select('id, doc_number, created_at, vehicle_plate').in('id', tUuids); for (const t of (tr || [])) tMap[t.id] = t }
        if (tSids.length)  { const { data: tr } = await supabase.from('tickets').select('id, supabase_id, doc_number, created_at, vehicle_plate').in('supabase_id', tSids); for (const t of (tr || [])) tMap[t.supabase_id] = t }
        let sellerRow = null
        if (isUuid) {
          const { data: s1 } = await supabase.from('sellers').select('name, commission_pct').eq('id', sellerId).maybeSingle()
          sellerRow = s1
          if (!s1) { const { data: s2 } = await supabase.from('sellers').select('name, commission_pct').eq('supabase_id', sellerId).maybeSingle(); sellerRow = s2 }
        }
        return rows.map(r => {
          const t = tMap[r.ticket_id] || tMap[r.ticket_supabase_id] || {}
          return { ...r, doc_number: t.doc_number || null, ticket_date: t.created_at || r.created_at, vehicle_plate: t.vehicle_plate || null, seller_name: sellerRow?.name || '—', commission_pct: sellerRow?.commission_pct || r.commission_pct || 0 }
        })
      }, []),

      byPeriod: (params) => tryOr(async () => {
        const dateFrom = params.from || params.dateFrom
        const dateTo   = params.to   || params.dateTo
        const { data: rows, error } = await supabase.from('seller_commissions')
          .select('seller_id, seller_supabase_id, base_amount, commission_pct, commission_amount, created_at')
          .eq('business_id', bid)
        if (error) throw new Error(error.message)
        if (!rows?.length) return []
        const from = dateFrom || '2000-01-01', to = dateTo || '2099-12-31'
        const filtered = rows.filter(r => r.created_at >= from && r.created_at <= to)
        if (!filtered.length) return []
        const sellerUuids = [...new Set(filtered.map(r => r.seller_id).filter(Boolean))]
        const sellerSids  = [...new Set(filtered.map(r => r.seller_supabase_id).filter(Boolean))]
        const sMap = {}
        if (sellerUuids.length) { const { data: sr } = await supabase.from('sellers').select('id, name, commission_pct').in('id', sellerUuids); for (const s of (sr || [])) sMap[s.id] = s }
        if (sellerSids.length) { const { data: sr } = await supabase.from('sellers').select('id, supabase_id, name, commission_pct').in('supabase_id', sellerSids); for (const s of (sr || [])) sMap[s.supabase_id] = s }
        const map = {}
        for (const r of filtered) {
          const sid = r.seller_id || r.seller_supabase_id; const s = sMap[sid] || sMap[r.seller_id] || sMap[r.seller_supabase_id] || {}
          if (!map[sid]) map[sid] = { seller_id: sid, seller_name: s.name || '—', commission_pct: s.commission_pct || r.commission_pct || 0, ticket_count: 0, total_base: 0, total_commission: 0 }
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
        const isUuid = cajeroId?.includes?.('-')
        let q = supabase.from('cajero_commissions').select('*').eq('business_id', bid)
        if (isUuid) q = q.or(`cajero_id.eq.${cajeroId},cajero_supabase_id.eq.${cajeroId}`)
        else q = q.eq('cajero_id', cajeroId)
        if (dateFrom) q = q.gte('created_at', dateFrom)
        if (dateTo)   q = q.lte('created_at', dateTo)
        q = q.order('created_at', { ascending: false }).limit(2000)
        const rows = throwSupaError(await q)
        if (!rows?.length) return []
        const tUuids = [...new Set(rows.map(r => r.ticket_id).filter(Boolean))]
        const tSids  = [...new Set(rows.map(r => r.ticket_supabase_id).filter(Boolean))]
        const tMap = {}
        if (tUuids.length) { const { data: tr } = await supabase.from('tickets').select('id, doc_number, created_at, vehicle_plate').in('id', tUuids); for (const t of (tr || [])) tMap[t.id] = t }
        if (tSids.length)  { const { data: tr } = await supabase.from('tickets').select('id, supabase_id, doc_number, created_at, vehicle_plate').in('supabase_id', tSids); for (const t of (tr || [])) tMap[t.supabase_id] = t }
        let userRow = null
        if (isUuid) {
          const { data: u1 } = await supabase.from('staff').select('name, commission_pct').eq('id', cajeroId).maybeSingle()
          userRow = u1
          if (!u1) { const { data: u2 } = await supabase.from('users').select('name, discount_pct').eq('supabase_id', cajeroId).maybeSingle(); userRow = u2 }
        }
        return rows.map(r => {
          const t = tMap[r.ticket_id] || tMap[r.ticket_supabase_id] || {}
          return { ...r, doc_number: t.doc_number || null, ticket_date: t.created_at || r.created_at, vehicle_plate: t.vehicle_plate || null, cajero_name: userRow?.name || '—', commission_pct: userRow?.commission_pct || r.commission_pct || 0 }
        })
      }, []),

      byPeriod: (params) => tryOr(async () => {
        const dateFrom = params.from || params.dateFrom
        const dateTo   = params.to   || params.dateTo
        const { data: rows, error } = await supabase.from('cajero_commissions')
          .select('cajero_id, cajero_supabase_id, base_amount, commission_pct, commission_amount, created_at')
          .eq('business_id', bid)
        if (error) throw new Error(error.message)
        if (!rows?.length) return []
        const from = dateFrom || '2000-01-01', to = dateTo || '2099-12-31'
        const filtered = rows.filter(r => r.created_at >= from && r.created_at <= to)
        if (!filtered.length) return []
        const cajeroUuids = [...new Set(filtered.map(r => r.cajero_id).filter(Boolean))]
        const cajeroSids  = [...new Set(filtered.map(r => r.cajero_supabase_id).filter(Boolean))]
        const cMap = {}
        if (cajeroUuids.length) { const { data: ur } = await supabase.from('staff').select('id, name, commission_pct').in('id', cajeroUuids); for (const u of (ur || [])) cMap[u.id] = u }
        if (cajeroSids.length)  { const { data: ur } = await supabase.from('users').select('supabase_id, name').in('supabase_id', cajeroSids); for (const u of (ur || [])) cMap[u.supabase_id] = u }
        const map = {}
        for (const r of filtered) {
          const cid = r.cajero_id || r.cajero_supabase_id; const u = cMap[cid] || cMap[r.cajero_id] || cMap[r.cajero_supabase_id] || {}
          if (!map[cid]) map[cid] = { cajero_id: cid, cajero_name: u.name || '—', commission_pct: u.commission_pct || r.commission_pct || 0, ticket_count: 0, total_base: 0, total_commission: 0 }
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
          supabase_id: crypto.randomUUID(),
          business_id: bid,
          denominaciones: typeof data.denominaciones === 'string' ? data.denominaciones : JSON.stringify(data.denominaciones || {}),
        }).select('id').single())
        const diff = Number(data.diferencia || 0)
        if (Math.abs(diff) > 50) {
          await logActivity({ event_type: 'cuadre_discrepancy',
            severity: Math.abs(diff) >= 500 ? 'critical' : 'warn',
            target_type: 'cuadre_caja', target_id: row?.id || null,
            target_name: `Cuadre ${data.date || ''}`.trim(),
            amount: diff,
            old_value: String(data.efectivo_sistema || 0),
            new_value: String(data.efectivo_conteo || 0),
            reason: data.comentario || (diff > 0 ? 'Sobrante' : 'Faltante'),
            metadata: { cierre_total: data.cierre_total, total_cobrado: data.total_cobrado } })
        }
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
        // Direct query — the old RPC `cuadre_daily_summary` was never created on Supabase.
        // Fetch today's paid tickets and aggregate by payment_method in JS.
        const d = date || new Date().toISOString().slice(0, 10)
        const { data: rows } = await supabase.from('tickets')
          .select('total, payment_method')
          .eq('business_id', bid)
          .eq('status', 'cobrado')
          .gte('created_at', `${d}T00:00:00`)
          .lte('created_at', `${d}T23:59:59`)
        if (!rows) return { efectivo: 0, tarjeta: 0, transferencia: 0, cheque: 0, credito: 0, totalVendido: 0, totalCobrado: 0, count: 0 }
        const result = { efectivo: 0, tarjeta: 0, transferencia: 0, cheque: 0, credito: 0, credit: 0 }
        let totalVendido = 0, totalCobrado = 0
        for (const r of rows) {
          const t = Number(r.total || 0)
          const pm = r.payment_method || 'efectivo'
          result[pm] = (result[pm] || 0) + t
          totalVendido += t
          if (pm !== 'credit') totalCobrado += t
        }
        // Normalize: 'credit' → 'credito' for the UI
        result.credito = result.credit || 0
        return { ...result, totalVendido, totalCobrado, count: rows.length }
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
        if ('enabled' in rest) rest.enabled = !!rest.enabled
        if ('active'  in rest) rest.active  = !!rest.active
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
        throwSupaError(await supabase.from('caja_chica').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid }))
        await logActivity({ event_type: 'caja_chica_withdrawal',
          severity: Number(data.amount) >= 2000 ? 'warn' : 'info',
          target_type: 'caja_chica',
          target_name: data.description || data.category || 'Retiro',
          amount: data.amount, reason: data.category || null,
          metadata: { type: data.type, recibo: data.recibo || null, status: data.status } })
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
        throwSupaError(await supabase.from('notas_credito').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid }))
        await logActivity({ event_type: 'nota_credito_created', severity: 'critical',
          target_type: 'nota_credito', target_name: data.ncf || 'NC',
          amount: data.amount, reason: data.motivo || null,
          metadata: { original_ticket_id: data.original_ticket_id || null, itbis_revertido: data.itbis_revertido, forma_devolucion: data.forma_devolucion } })
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
          supabase_id:      crypto.randomUUID(),
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

    // ── WhatsApp (direct UltraMsg API) ──────────────────────────────────────
    // Reads instance + token from app_settings (synced from desktop).
    // Long-term: move to a server-side proxy to avoid token exposure in browser.

    whatsapp: {
      send: ({ to, body }) => tryOr(async () => {
        const { data: rows } = await supabase.from('app_settings').select('key,value')
          .eq('business_id', bid).in('key', ['whatsapp_instance', 'whatsapp_token'])
        const cfg = Object.fromEntries((rows || []).map(r => [r.key, r.value]))
        if (!cfg.whatsapp_instance || !cfg.whatsapp_token) throw new Error('WhatsApp no configurado')
        const r = await fetch(`https://api.ultramsg.com/${cfg.whatsapp_instance}/messages/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${encodeURIComponent(cfg.whatsapp_token)}&to=${encodeURIComponent(to)}&body=${encodeURIComponent(body)}`,
        })
        if (!r.ok) throw new Error(`UltraMsg ${r.status}`)
        return r.json()
      }),

      sendDocument: ({ to, base64, filename, caption }) => tryOr(async () => {
        const { data: rows } = await supabase.from('app_settings').select('key,value')
          .eq('business_id', bid).in('key', ['whatsapp_instance', 'whatsapp_token'])
        const cfg = Object.fromEntries((rows || []).map(r => [r.key, r.value]))
        if (!cfg.whatsapp_instance || !cfg.whatsapp_token) throw new Error('WhatsApp no configurado')
        const r = await fetch(`https://api.ultramsg.com/${cfg.whatsapp_instance}/messages/document`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: [
            `token=${encodeURIComponent(cfg.whatsapp_token)}`,
            `to=${encodeURIComponent(to)}`,
            `filename=${encodeURIComponent(filename || 'recibo.pdf')}`,
            `document=data:application/pdf;base64,${base64}`,
            caption ? `caption=${encodeURIComponent(caption)}` : '',
          ].filter(Boolean).join('&'),
        })
        if (!r.ok) throw new Error(`UltraMsg ${r.status}`)
        return r.json()
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

    // ── DGII e-CF signing proxy ─────────────────────────────────────────────
    // Mirrors window.electronAPI.dgii_ecf so ecf.js works transparently on web.
    // Signs e-CFs server-side via /api/ecf-sign (private key never leaves server).

    dgii_ecf: {
      certInfo: () => tryOr(async () => {
        const { data } = await supabase.from('businesses').select('settings').eq('id', bid).single()
        const s = data?.settings || {}
        return {
          installed: !!(s.ecf_private_key_pem && s.ecf_certificate_pem),
          subject: s.ecf_cert_subject || null,
          expiry: s.ecf_cert_expiry || null,
          expired: s.ecf_cert_expired || false,
          environment: s.dgii_environment || 'certecf',
        }
      }, { installed: false }),

      submit: (invoiceData) => tryWrite(async () => {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) throw new Error('No hay sesión activa')
        const res = await fetch('/api/ecf-sign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body: JSON.stringify({ ...invoiceData, business_id: bid }),
        })
        const result = await res.json()
        if (!result.ok) throw new Error(result.error || 'Error firmando e-CF')
        return result.data
      }),

      authTest: () => tryOr(async () => {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) throw new Error('No hay sesión activa')
        const res = await fetch('/api/ecf-sign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body: JSON.stringify({ business_id: bid, test: true }),
        })
        const result = await res.json()
        return { ok: result.ok, message: result.error || 'Conexión exitosa' }
      }),

      checkStatus: (trackId) => tryOr(async () => {
        return { codigo: 3, estado: 'EN_PROCESO', mensajes: ['Status check not available on web'] }
      }),
    },

    // ── Auto-updater ─────────────────────────────────────────────────────────

    updater: {
      install:  () => Promise.resolve(), // web auto-updates via service worker
      onStatus: () => () => {},          // returns unsubscribe function (no-op)
    },

    // ── Restaurant Mode — Mesas (floor plan) ─────────────────────────────────

    mesas: {
      list: () => tryOr(async () => {
        return throwSupaError(
          await supabase.from('mesas').select('*').eq('business_id', bid).eq('active', true)
            .order('sort_order').order('name')
        )
      }, []),

      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('mesas').insert({
          supabase_id: crypto.randomUUID(),
          name: data.name, zone: data.zone || null,
          capacity: data.capacity != null ? data.capacity : 4,
          status: data.status || 'libre',
          sort_order: data.sort_order || 0,
          active: true,
          business_id: bid,
        }).select('*').single())
        return row
      }),

      update: (id, data) => tryOr(async () => {
        const allowed = ['name','zone','capacity','status','waiter_empleado_supabase_id','guests_count','seated_at','sort_order','active']
        const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
        if ('active' in patch) patch.active = !!patch.active
        if (!Object.keys(patch).length) {
          return (await supabase.from('mesas').select('*').eq('id', id).eq('business_id', bid).maybeSingle())?.data || null
        }
        return throwSupaError(
          await supabase.from('mesas').update(patch).eq('id', id).eq('business_id', bid).select('*').single()
        )
      }),

      setStatus: (id, status, opts = {}) => tryOr(async () => {
        // Fetch seated_at so we stamp only on first transition into 'ocupada'
        const { data: cur } = await supabase.from('mesas')
          .select('seated_at,waiter_empleado_supabase_id,guests_count')
          .eq('id', id).eq('business_id', bid).maybeSingle()
        const patch = { status }
        if (opts.waiter_empleado_supabase_id !== undefined) patch.waiter_empleado_supabase_id = opts.waiter_empleado_supabase_id
        if (opts.guests_count                !== undefined) patch.guests_count                = opts.guests_count
        if (status === 'ocupada' && !(cur && cur.seated_at)) patch.seated_at = new Date().toISOString()
        return throwSupaError(
          await supabase.from('mesas').update(patch).eq('id', id).eq('business_id', bid).select('*').single()
        )
      }),

      delete: (id) => tryOr(async () => {
        // Soft-delete — match services.delete() semantics (LWW-friendly + safe).
        throwSupaError(await supabase.from('mesas').update({ active: false })
          .eq('id', id).eq('business_id', bid))
        return { deleted: true }
      }),
    },

    // ── Restaurant Mode — Modificadores (menu add-ons) ───────────────────────

    modificadores: {
      list: () => tryOr(async () => {
        return throwSupaError(
          await supabase.from('modificadores').select('*').eq('business_id', bid).eq('active', true)
            .order('group_name').order('sort_order').order('name')
        )
      }, []),

      listAll: () => tryOr(async () => {
        return throwSupaError(
          await supabase.from('modificadores').select('*').eq('business_id', bid)
            .order('group_name').order('sort_order').order('name')
        )
      }, []),

      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('modificadores').insert({
          supabase_id: crypto.randomUUID(),
          name: data.name, group_name: data.group_name || null,
          price_delta: Number(data.price_delta || 0),
          min_select: data.min_select != null ? data.min_select : 0,
          max_select: data.max_select != null ? data.max_select : 1,
          default_selected: !!data.default_selected,
          sort_order: data.sort_order || 0,
          active: true,
          business_id: bid,
        }).select('*').single())
        return row
      }),

      update: (id, data) => tryOr(async () => {
        const allowed = ['name','group_name','price_delta','min_select','max_select','default_selected','sort_order','active']
        const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
        if ('default_selected' in patch) patch.default_selected = !!patch.default_selected
        if ('active' in patch)           patch.active           = !!patch.active
        if ('price_delta' in patch)      patch.price_delta      = Number(patch.price_delta || 0)
        if (!Object.keys(patch).length) {
          return (await supabase.from('modificadores').select('*').eq('id', id).eq('business_id', bid).maybeSingle())?.data || null
        }
        return throwSupaError(
          await supabase.from('modificadores').update(patch).eq('id', id).eq('business_id', bid).select('*').single()
        )
      }),

      delete: (id) => tryOr(async () => {
        throwSupaError(await supabase.from('modificadores').update({ active: false })
          .eq('id', id).eq('business_id', bid))
        return { deleted: true }
      }),

      listForService: (serviceSupabaseId) => tryOr(async () => {
        // Two-step — service_modificadores stores supabase_id FKs, no SQL join
        // is possible via the JS client. Empty ids short-circuits to [].
        const { data: links } = await supabase.from('service_modificadores')
          .select('modificador_supabase_id,is_required')
          .eq('business_id', bid).eq('service_supabase_id', serviceSupabaseId)
        const ids = (links || []).map(l => l.modificador_supabase_id).filter(Boolean)
        if (ids.length === 0) return []
        const { data: mods } = await supabase.from('modificadores').select('*')
          .eq('business_id', bid).eq('active', true).in('supabase_id', ids)
          .order('group_name').order('sort_order').order('name')
        const reqMap = Object.fromEntries((links || []).map(l => [l.modificador_supabase_id, !!l.is_required]))
        return (mods || []).map(m => ({ ...m, is_required: !!reqMap[m.supabase_id] }))
      }, []),

      attachToService: (serviceSupabaseId, modificadorSupabaseId, isRequired = 0) => tryOr(async () => {
        throwSupaError(await supabase.from('service_modificadores').insert({
          supabase_id: crypto.randomUUID(),
          service_supabase_id: serviceSupabaseId,
          modificador_supabase_id: modificadorSupabaseId,
          is_required: !!isRequired,
          business_id: bid,
        }))
      }),

      detachFromService: (serviceSupabaseId, modificadorSupabaseId) => tryOr(async () => {
        throwSupaError(await supabase.from('service_modificadores').delete()
          .eq('business_id', bid)
          .eq('service_supabase_id', serviceSupabaseId)
          .eq('modificador_supabase_id', modificadorSupabaseId))
      }),
    },

    // ── Restaurant Mode — KDS (kitchen display) ──────────────────────────────

    kds: {
      listActive: () => tryOr(async () => {
        return throwSupaError(
          await supabase.from('kds_events').select('*')
            .eq('business_id', bid).in('status', ['fired','in_progress','ready'])
            .order('fired_at', { ascending: false })
        )
      }, []),

      fire: (data) => tryOr(async () => {
        // Resolve ticket_item_supabase_id the same way desktop does, so the
        // FK stays intact even when the caller only hands us the integer id.
        let tiSid = data.ticket_item_supabase_id || null
        if (!tiSid && data.ticket_item_id) {
          const { data: ti } = await supabase.from('ticket_items').select('supabase_id')
            .eq('id', data.ticket_item_id).eq('business_id', bid).maybeSingle()
          tiSid = ti?.supabase_id || null
        }
        const row = throwSupaError(await supabase.from('kds_events').insert({
          supabase_id: crypto.randomUUID(),
          ticket_item_supabase_id: tiSid,
          mesa_supabase_id: data.mesa_supabase_id || null,
          station: data.station || null,
          status: 'fired',
          fired_at: new Date().toISOString(),
          business_id: bid,
        }).select('*').single())
        return row
      }),

      setStatus: (id, status) => tryOr(async () => {
        const patch = { status }
        const now = new Date().toISOString()
        if (status === 'in_progress') patch.started_at = now
        if (status === 'ready')       patch.ready_at   = now
        if (status === 'bumped')      patch.bumped_at  = now
        return throwSupaError(
          await supabase.from('kds_events').update(patch).eq('id', id).eq('business_id', bid).select('*').single()
        )
      }),
    },

    // ── Restaurant Mode — Ticket-item modifier snapshots ─────────────────────

    restaurant: {
      itemModificadores: {
        list: (ticketItemSupabaseId) => tryOr(async () => {
          return throwSupaError(
            await supabase.from('ticket_item_modificadores').select('*')
              .eq('business_id', bid).eq('ticket_item_supabase_id', ticketItemSupabaseId)
              .order('id')
          )
        }, []),

        snapshot: (ticketItemSupabaseId, _ticketItemId, selections) => tryOr(async () => {
          if (!Array.isArray(selections) || selections.length === 0) return
          const rows = selections.map(s => ({
            supabase_id: crypto.randomUUID(),
            ticket_item_supabase_id: ticketItemSupabaseId,
            modificador_supabase_id: s.modificador_supabase_id || null,
            name_snapshot: s.name_snapshot,
            price_delta_snapshot: Number(s.price_delta_snapshot || 0),
            business_id: bid,
          }))
          throwSupaError(await supabase.from('ticket_item_modificadores').insert(rows))
        }),
      },
    },

    // ── Restaurant Mode — Realtime subscriptions ─────────────────────────────

    subscribeMesas: (callback) => {
      const channel = supabase.channel('mesa-changes')
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'mesas',
          filter: `business_id=eq.${bid}`,
        }, (payload) => callback(payload))
        .subscribe()
      return () => supabase.removeChannel(channel)
    },

    subscribeKdsEvents: (callback) => {
      const channel = supabase.channel('kds-changes')
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'kds_events',
          filter: `business_id=eq.${bid}`,
        }, (payload) => callback(payload))
        .subscribe()
      return () => supabase.removeChannel(channel)
    },

    // ── Vehicles ──────────────────────────────────────────────────────────────

    vehicles: {
      list: () => tryOr(async () => throwSupaError(await supabase.from('vehicles').select('*, clients(name)').eq('business_id', bid).order('created_at', { ascending: false })), []),
      getById: (id) => tryOr(async () => throwSupaError(await supabase.from('vehicles').select('*, clients(name)').eq('id', id).eq('business_id', bid).single())),
      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('vehicles').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid, active: true }).select('id').single())
        return row
      }),
      update: (id, data) => tryOr(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('vehicles').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
      delete: (id) => tryOr(async () => { throwSupaError(await supabase.from('vehicles').update({ active: false }).eq('id', id).eq('business_id', bid)) }),
      byClient: (clientId) => tryOr(async () => throwSupaError(await supabase.from('vehicles').select('*').eq('business_id', bid).eq('client_id', clientId).eq('active', true).order('created_at', { ascending: false })), []),
    },

    // ── Service Bays ────────────────────────────────────────────────────────

    serviceBays: {
      list: () => tryOr(async () => throwSupaError(await supabase.from('service_bays').select('*').eq('business_id', bid).eq('active', true).order('name')), []),
      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('service_bays').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid, active: true }).select('id').single())
        return row
      }),
      update: (id, data) => tryOr(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('service_bays').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
      setStatus: (id, status, workOrderId) => tryOr(async () => { throwSupaError(await supabase.from('service_bays').update({ status, current_work_order_id: workOrderId || null, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)) }),
      delete: (id) => tryOr(async () => { throwSupaError(await supabase.from('service_bays').update({ active: false }).eq('id', id).eq('business_id', bid)) }),
    },

    // ── Work Orders ─────────────────────────────────────────────────────────

    workOrders: {
      list: (params) => tryOr(async () => {
        let q = supabase.from('work_orders').select('*, vehicles(plate,make,model), clients(name), empleados!technician_empleado_id(nombre)').eq('business_id', bid)
        if (params?.status) q = q.eq('status', params.status)
        return throwSupaError(await q.order('created_at', { ascending: false }))
      }, []),
      getById: (id) => tryOr(async () => throwSupaError(await supabase.from('work_orders').select('*, vehicles(plate,make,model,vin,year,color), clients(name,phone,rnc)').eq('id', id).eq('business_id', bid).single())),
      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('work_orders').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid }).select('id').single())
        return row
      }),
      update: (id, data) => tryOr(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('work_orders').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
      setStatus: (id, status) => tryOr(async () => {
        const patch = { status, updated_at: new Date().toISOString() }
        if (status === 'completed') patch.completed_date = new Date().toISOString()
        throwSupaError(await supabase.from('work_orders').update(patch).eq('id', id).eq('business_id', bid))
      }),
      delete: (id) => tryOr(async () => { throwSupaError(await supabase.from('work_orders').delete().eq('id', id).eq('business_id', bid)) }),
    },

    // ── Work Order Items ────────────────────────────────────────────────────

    workOrderItems: {
      byOrder: (workOrderId) => tryOr(async () => throwSupaError(await supabase.from('work_order_items').select('*').eq('business_id', bid).eq('work_order_id', workOrderId).order('created_at')), []),
      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('work_order_items').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid }).select('id').single())
        return row
      }),
      update: (id, data) => tryOr(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('work_order_items').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
      delete: (id) => tryOr(async () => { throwSupaError(await supabase.from('work_order_items').delete().eq('id', id).eq('business_id', bid)) }),
    },

    // ── Appointments ────────────────────────────────────────────────────────

    appointments: {
      list: (params) => tryOr(async () => {
        let q = supabase.from('appointments').select('*, clients(name,phone), empleados(nombre,tipo)').eq('business_id', bid)
        if (params?.date) q = q.eq('date', params.date)
        if (params?.empleadoId) q = q.eq('empleado_id', params.empleadoId)
        if (params?.status) q = q.eq('status', params.status)
        return throwSupaError(await q.order('date').order('start_time'))
      }, []),
      byDate: (date) => tryOr(async () => throwSupaError(await supabase.from('appointments').select('*, clients(name,phone), empleados(nombre,tipo)').eq('business_id', bid).eq('date', date).order('start_time')), []),
      byEmpleado: (empleadoId) => tryOr(async () => throwSupaError(await supabase.from('appointments').select('*, clients(name,phone)').eq('business_id', bid).eq('empleado_id', empleadoId).order('date', { ascending: false }).limit(50)), []),
      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('appointments').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid }).select('id').single())
        return row
      }),
      update: (id, data) => tryOr(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('appointments').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
      setStatus: (id, status) => tryOr(async () => { throwSupaError(await supabase.from('appointments').update({ status, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)) }),
      delete: (id) => tryOr(async () => { throwSupaError(await supabase.from('appointments').delete().eq('id', id).eq('business_id', bid)) }),
    },

    // ── Stylist Schedules ───────────────────────────────────────────────────

    stylistSchedules: {
      list: () => tryOr(async () => throwSupaError(await supabase.from('stylist_schedules').select('*, empleados(nombre,tipo)').eq('business_id', bid).eq('active', true).order('empleado_id').order('day_of_week')), []),
      byEmpleado: (empleadoId) => tryOr(async () => throwSupaError(await supabase.from('stylist_schedules').select('*').eq('business_id', bid).eq('empleado_id', empleadoId).eq('active', true).order('day_of_week')), []),
      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('stylist_schedules').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid, active: true }).select('id').single())
        return row
      }),
      update: (id, data) => tryOr(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('stylist_schedules').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
      delete: (id) => tryOr(async () => { throwSupaError(await supabase.from('stylist_schedules').update({ active: false }).eq('id', id).eq('business_id', bid)) }),
    },

    // ── Loans ───────────────────────────────────────────────────────────────

    loans: {
      list: (params) => tryOr(async () => {
        let q = supabase.from('loans').select('*, clients(name,phone,rnc)').eq('business_id', bid)
        if (params?.status) q = q.eq('status', params.status)
        if (params?.clientId) q = q.eq('client_id', params.clientId)
        return throwSupaError(await q.order('created_at', { ascending: false }))
      }, []),
      getById: (id) => tryOr(async () => throwSupaError(await supabase.from('loans').select('*, clients(name,phone,rnc)').eq('id', id).eq('business_id', bid).single())),
      byClient: (clientId) => tryOr(async () => throwSupaError(await supabase.from('loans').select('*').eq('business_id', bid).eq('client_id', clientId).order('created_at', { ascending: false })), []),
      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('loans').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid }).select('id').single())
        await logActivity({ event_type: 'loan_created', severity: 'warn', target_type: 'loan', target_id: row.id, amount: Number(data.principal), metadata: { term_months: data.term_months, interest_rate: data.interest_rate } })
        return row
      }),
      update: (id, data) => tryOr(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('loans').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
      setStatus: (id, status) => tryOr(async () => { throwSupaError(await supabase.from('loans').update({ status, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)) }),
    },

    // ── Loan Payments ───────────────────────────────────────────────────────

    loanPayments: {
      byLoan: (loanId) => tryOr(async () => throwSupaError(await supabase.from('loan_payments').select('*').eq('business_id', bid).eq('loan_id', loanId).order('payment_date', { ascending: false })), []),
      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('loan_payments').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid }).select('id').single())
        if (data.loan_id) {
          const { data: loan } = await supabase.from('loans').select('total_paid').eq('id', data.loan_id).eq('business_id', bid).single()
          if (loan) await supabase.from('loans').update({ total_paid: (loan.total_paid || 0) + Number(data.amount), updated_at: new Date().toISOString() }).eq('id', data.loan_id).eq('business_id', bid)
        }
        return row
      }),
      update: (id, data) => tryOr(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('loan_payments').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
    },

    // ── Pawn Items ──────────────────────────────────────────────────────────

    pawnItems: {
      list: (params) => tryOr(async () => {
        let q = supabase.from('pawn_items').select('*, clients(name), loans(principal,status)').eq('business_id', bid)
        if (params?.status) q = q.eq('status', params.status)
        return throwSupaError(await q.order('created_at', { ascending: false }))
      }, []),
      getById: (id) => tryOr(async () => throwSupaError(await supabase.from('pawn_items').select('*, clients(name), loans(principal,status)').eq('id', id).eq('business_id', bid).single())),
      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('pawn_items').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid }).select('id').single())
        return row
      }),
      update: (id, data) => tryOr(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('pawn_items').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
      setStatus: (id, status) => tryOr(async () => {
        throwSupaError(await supabase.from('pawn_items').update({ status, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid))
        if (status === 'forfeited') await logActivity({ event_type: 'pawn_forfeited', severity: 'critical', target_type: 'pawn_item', target_id: id })
      }),
    },

    // ── Realtime subscriptions (Supabase Realtime) ───────────────────────────

    realtime: {
      subscribeQueue: (callback) => {
        const channel = supabase.channel('queue-changes')
          .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'queue',
            filter: `business_id=eq.${bid}`,
          }, (payload) => callback(payload))
          .subscribe()
        return () => supabase.removeChannel(channel)
      },

      subscribeTickets: (callback) => {
        const channel = supabase.channel('ticket-changes')
          .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'tickets',
            filter: `business_id=eq.${bid}`,
          }, (payload) => callback(payload))
          .subscribe()
        return () => supabase.removeChannel(channel)
      },

      unsubscribeAll: () => {
        supabase.removeAllChannels()
      },
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
    // print method for web — opens an HTML print preview with the browser's
    // native print dialog (shows "Microsoft Print to PDF" + any other printers).
    // Falls back gracefully when qz-tray isn't running.
    print: async ({ data, printerName }) => {
      // If data is an ESC/POS binary string, strip control chars and render as text
      const text = typeof data === 'string'
        ? data.replace(/[\x00-\x1F\x7F]/g, '').replace(/\n/g, '<br>')
        : 'Test print'
      const w = window.open('', '_blank', 'width=400,height=600')
      if (!w) return { success: false, error: 'Popup blocked' }
      w.document.write(`<!DOCTYPE html><html><head><title>Terminal X — Print</title>
        <style>body{font-family:'Courier New',monospace;font-size:12px;padding:20px;max-width:80mm;margin:0 auto;white-space:pre-wrap;}</style>
        </head><body>${text}</body></html>`)
      w.document.close()
      w.focus()
      w.print()
      return { success: true }
    },

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
