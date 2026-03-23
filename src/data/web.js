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

import { enqueueTicket } from '../services/offline-queue'

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
        const row = throwSupaError(await supabase.from('users').insert({ ...rest, pin_hash, business_id: bid }).select('id').single())
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
        const row = throwSupaError(await supabase.from('users').insert({ ...rest, pin_hash, business_id: bid, active: true }).select('id').single())
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
          price: data.price, aplica_itbis: data.aplica_itbis ?? 1,
          is_wash: data.is_wash ?? 1, active: true, sort_order: data.sort_order || 0,
          business_id: bid,
        }).select('id').single())
        return { id: row.id }
      }),

      update: (data) => tryOr(async () => {
        const { id, ...rest } = data
        const allowed = ['name', 'name_en', 'category', 'categoria_id', 'price', 'aplica_itbis', 'is_wash', 'active', 'sort_order']
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
          .select('*, ticket_items(name, price, is_wash)')
          .eq('business_id', bid).eq('client_id', clientId)
          .eq('tipo_venta', 'credito').eq('status', 'pendiente')
          .order('created_at', { ascending: true })
        return (tickets || []).map(t => ({
          ...t,
          items: (t.ticket_items || []).filter(i => i.name != null),
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
        let q = supabase.from('tickets')
          .select('*, clients!client_id(name, rnc), staff!cajero_id(name)')
          .eq('business_id', bid)
        if (dateFrom) q = q.gte('created_at', dateFrom)
        if (dateTo)   q = q.lte('created_at', dateTo)
        if (status)   q = q.eq('status', status)
        q = q.order('created_at', { ascending: false }).limit(safeLimit)
        const rows = throwSupaError(await q)
        return (rows || []).map(r => ({
          ...r,
          client_name: r.clients?.name || null,
          client_rnc:  r.clients?.rnc  || null,
          cajero_name: r.staff?.name   || null,
          clients: undefined,
          staff: undefined,
        }))
      }, []),

      byId: (id) => tryOr(async () => {
        const { data: ticket } = await supabase.from('tickets')
          .select('*, clients!client_id(name, rnc), staff!cajero_id(name), ticket_items(*)')
          .eq('id', id).eq('business_id', bid).single()
        if (!ticket) return null
        let ecf_result = {}
        try { ecf_result = typeof ticket.ecf_result === 'string' ? JSON.parse(ticket.ecf_result) : (ticket.ecf_result || {}) } catch {}
        let washer_ids = []
        try { washer_ids = typeof ticket.washer_ids === 'string' ? JSON.parse(ticket.washer_ids) : (ticket.washer_ids || []) } catch {}
        return {
          ...ticket,
          client_name: ticket.clients?.name || null,
          client_rnc:  ticket.clients?.rnc  || null,
          cajero_name: ticket.users?.name   || null,
          items: ticket.ticket_items || [],
          ecf_result,
          washer_ids,
          clients: undefined,
          staff: undefined,
          ticket_items: undefined,
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

            // Insert ticket items
            const items = data.items || []
            if (items.length && ticket?.id) {
              await supabase.from('ticket_items').insert(
                items.map(i => ({
                  business_id: bid,
                  ticket_id:   ticket.id,
                  service_id:  i.service_id || null,
                  name:        i.name,
                  price:       i.price,
                  itbis:       i.itbis || 0,
                  is_wash:     i.is_wash ?? true,
                }))
              )
            }

            // Commission calculations
            const bevSub = data.beverage_subtotal || 0
            const commBase = parseFloat(((data.subtotal - bevSub) / 1.28).toFixed(2)) // 1 + 0.18 ITBIS + 0.10 Ley
            const bevBase  = bevSub > 0 ? parseFloat((bevSub / 1.28).toFixed(2)) : 0

            // Washer commissions (same as desktop database.js)
            if (ticket?.id && Array.isArray(data.washer_ids) && data.washer_ids.length) {
              try {
                const { data: washerRows } = await supabase.from('washers')
                  .select('id, commission_pct').in('id', data.washer_ids)
                for (const w of (washerRows || [])) {
                  const pct = w.commission_pct || 0
                  const amt = parseFloat((commBase * pct / 100).toFixed(2))
                  await supabase.from('washer_commissions').insert({
                    business_id: bid, washer_id: w.id, ticket_id: ticket.id,
                    base_amount: commBase, commission_pct: pct, commission_amount: amt, paid: false,
                  })
                }
              } catch { /* commission insert failed — non-fatal */ }
            }

            // Seller commission — same base as washers (services excluding beverages)
            if (ticket?.id && data.seller_id) {
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

            // Cajero commission — on beverages/snacks only
            if (ticket?.id && data.cajero_id && bevBase > 0) {
              try {
                const { data: cajero } = await supabase.from('users')
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
        return throwSupaError(await q)
      }, []),
    },

    // ── Queue ────────────────────────────────────────────────────────────────

    queue: {
      active: () => tryOr(async () => {
        // Fetch queue rows with ticket data (no deep nested joins — PostgREST limitation)
        const { data: rows, error: qErr } = await supabase.from('queue')
          .select('*, tickets(id, doc_number, total, vehicle_plate, created_at, client_id), washers(name)')
          .eq('business_id', bid).neq('status', 'done')
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
    },

    // ── Commissions ──────────────────────────────────────────────────────────

    commissions: {
      byWasher: (params) => tryOr(async () => {
        const { washerId, dateFrom, dateTo } = params
        let q = supabase.from('washer_commissions')
          .select('*, tickets!ticket_id(doc_number, created_at, vehicle_plate, status), washers!washer_id(name, commission_pct)')
          .eq('business_id', bid).eq('washer_id', washerId)
        if (dateFrom) q = q.gte('tickets.created_at', dateFrom)
        if (dateTo)   q = q.lte('tickets.created_at', dateTo)
        q = q.order('created_at', { ascending: false }).limit(2000)
        const rows = throwSupaError(await q)
        return (rows || []).map(r => ({
          ...r,
          doc_number:     r.tickets?.doc_number  || null,
          ticket_date:    r.tickets?.created_at   || null,
          vehicle_plate:  r.tickets?.vehicle_plate || null,
          washer_name:    r.washers?.name          || null,
          commission_pct: r.washers?.commission_pct || 0,
          tickets: undefined,
          washers: undefined,
        }))
      }, []),

      byPeriod: (params) => tryOr(async () => {
        const { dateFrom, dateTo } = params
        // Direct query instead of RPC (no custom Postgres function needed)
        const { data: rows, error } = await supabase.from('washer_commissions')
          .select('washer_id, base_amount, commission_amount, washers!washer_id(name, commission_pct), tickets!ticket_id(created_at, status)')
          .eq('business_id', bid)
        if (error) throw new Error(error.message)
        // Filter by date and status in JS (PostgREST nested filters are limited)
        const from = dateFrom || '2000-01-01'
        const to   = dateTo   || '2099-12-31'
        const filtered = (rows || []).filter(r =>
          r.tickets?.status === 'cobrado' &&
          r.tickets?.created_at >= from &&
          r.tickets?.created_at <= to
        )
        // Group by washer
        const map = {}
        for (const r of filtered) {
          const wid = r.washer_id
          if (!map[wid]) map[wid] = { washer_id: wid, washer_name: r.washers?.name || '', commission_pct: r.washers?.commission_pct || 0, ticket_count: 0, total_base: 0, total_commission: 0 }
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
        const { sellerId, dateFrom, dateTo } = params
        let q = supabase.from('seller_commissions')
          .select('*, tickets!ticket_id(doc_number, created_at, vehicle_plate, status), sellers!seller_id(name, commission_pct)')
          .eq('business_id', bid).eq('seller_id', sellerId)
        if (dateFrom) q = q.gte('created_at', dateFrom)
        if (dateTo)   q = q.lte('created_at', dateTo)
        q = q.order('created_at', { ascending: false }).limit(2000)
        const rows = throwSupaError(await q)
        return (rows || []).map(r => ({
          ...r,
          doc_number:     r.tickets?.doc_number   || null,
          ticket_date:    r.tickets?.created_at    || null,
          vehicle_plate:  r.tickets?.vehicle_plate || null,
          seller_name:    r.sellers?.name           || null,
          commission_pct: r.sellers?.commission_pct || 0,
          tickets: undefined, sellers: undefined,
        }))
      }, []),

      byPeriod: (params) => tryOr(async () => {
        const { dateFrom, dateTo } = params
        const { data: rows, error } = await supabase.from('seller_commissions')
          .select('seller_id, base_amount, commission_amount, sellers!seller_id(name, commission_pct), tickets!ticket_id(created_at, status)')
          .eq('business_id', bid)
        if (error) throw new Error(error.message)
        const from = dateFrom || '2000-01-01', to = dateTo || '2099-12-31'
        const filtered = (rows || []).filter(r => r.tickets?.status === 'cobrado' && r.tickets?.created_at >= from && r.tickets?.created_at <= to)
        const map = {}
        for (const r of filtered) {
          const sid = r.seller_id
          if (!map[sid]) map[sid] = { seller_id: sid, seller_name: r.sellers?.name || '', commission_pct: r.sellers?.commission_pct || 0, ticket_count: 0, total_base: 0, total_commission: 0 }
          map[sid].ticket_count++
          map[sid].total_base       += r.base_amount || 0
          map[sid].total_commission += r.commission_amount || 0
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
        const { cajeroId, dateFrom, dateTo } = params
        let q = supabase.from('cajero_commissions')
          .select('*, tickets!ticket_id(doc_number, created_at, vehicle_plate, status), users!cajero_id(name, commission_pct)')
          .eq('business_id', bid).eq('cajero_id', cajeroId)
        if (dateFrom) q = q.gte('created_at', dateFrom)
        if (dateTo)   q = q.lte('created_at', dateTo)
        q = q.order('created_at', { ascending: false }).limit(2000)
        const rows = throwSupaError(await q)
        return (rows || []).map(r => ({
          ...r,
          doc_number:     r.tickets?.doc_number   || null,
          ticket_date:    r.tickets?.created_at    || null,
          vehicle_plate:  r.tickets?.vehicle_plate || null,
          cajero_name:    r.users?.name             || null,
          commission_pct: r.users?.commission_pct   || 0,
          tickets: undefined, users: undefined,
        }))
      }, []),

      byPeriod: (params) => tryOr(async () => {
        const { dateFrom, dateTo } = params
        const { data: rows, error } = await supabase.from('cajero_commissions')
          .select('cajero_id, base_amount, commission_amount, users!cajero_id(name, commission_pct), tickets!ticket_id(created_at, status)')
          .eq('business_id', bid)
        if (error) throw new Error(error.message)
        const from = dateFrom || '2000-01-01', to = dateTo || '2099-12-31'
        const filtered = (rows || []).filter(r => r.tickets?.status === 'cobrado' && r.tickets?.created_at >= from && r.tickets?.created_at <= to)
        const map = {}
        for (const r of filtered) {
          const cid = r.cajero_id
          if (!map[cid]) map[cid] = { cajero_id: cid, cajero_name: r.users?.name || '', commission_pct: r.users?.commission_pct || 0, ticket_count: 0, total_base: 0, total_commission: 0 }
          map[cid].ticket_count++
          map[cid].total_base       += r.base_amount || 0
          map[cid].total_commission += r.commission_amount || 0
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

    // ── ef2.do API proxy (via Edge Function) ─────────────────────────────────

    ef2: {
      fetch: (params) => tryOr(async () => {
        const { data, error } = await supabase.functions.invoke('ef2-proxy', {
          body: { ...params, business_id: bid },
        })
        if (error) throw error
        return data
      }),
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
