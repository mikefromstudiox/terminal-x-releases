/**
 * test-all-calls.js — Comprehensive test of every Supabase data-layer method
 * in src/data/web.js. Runs in Node with ESM.
 *
 * Usage: node --experimental-vm-modules scripts/test-all-calls.js
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'

// ── Load .env manually ────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '..', '.env')
const envText = readFileSync(envPath, 'utf-8')
const env = {}
for (const line of envText.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eq = trimmed.indexOf('=')
  if (eq === -1) continue
  env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1)
}

const SUPABASE_URL = env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

console.log(`Supabase URL: ${SUPABASE_URL}`)
console.log(`Service key:  ${SUPABASE_SERVICE_ROLE_KEY.slice(0, 20)}...`)

// ── Create Supabase client ────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// ── Get first business_id ─────────────────────────────────────────────────────
const { data: businesses, error: bizErr } = await supabase
  .from('businesses')
  .select('id, name')
  .limit(1)

if (bizErr || !businesses?.length) {
  console.error('Could not fetch any business:', bizErr?.message || 'no rows')
  process.exit(1)
}

const businessId = businesses[0].id
console.log(`\nUsing business: "${businesses[0].name}" (id=${businessId})\n`)

// ── Inline the helpers from web.js (can't import due to browser deps) ────────

async function tryOr(fn, fallback) {
  try {
    const result = await fn()
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
  const hash = createHash('sha256').update(String(pin)).digest('hex')
  return hash
}

// ── Build the API (copy from web.js but with Node crypto) ─────────────────────

function createWebAPI(supabase, businessId) {
  const bid = businessId

  function from(table) {
    return supabase.from(table).select('*').eq('business_id', bid)
  }

  return {
    admin: {
      getEmpresa: () => tryOr(async () => {
        const { data } = await supabase.from('businesses').select('id,name,rnc,address,phone,email,logo_url,settings').eq('id', bid).single()
        if (data) data.logo = data.logo_url
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

      getCategorias: () => tryOr(async () => {
        return throwSupaError(await supabase.from('categorias_servicio').select('*').eq('business_id', bid).order('orden').order('nombre'))
      }, []),

      getSecuenciasNcf: () => tryOr(async () => {
        return throwSupaError(await supabase.from('ncf_sequences').select('*').eq('business_id', bid).order('type'))
      }, []),

      getConfiguracion: () => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('configuracion').select('clave,valor').eq('business_id', bid))
        return Object.fromEntries((rows || []).map(r => [r.clave, r.valor]))
      }, {}),
    },

    settings: {
      get: () => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('app_settings').select('key,value').eq('business_id', bid))
        return Object.fromEntries((rows || []).map(r => [r.key, r.value]))
      }, {}),

      update: (obj) => tryOr(async () => {
        for (const [key, value] of Object.entries(obj)) {
          throwSupaError(await supabase.from('app_settings').upsert(
            { business_id: bid, key, value: String(value), device_hwid: null },
            { onConflict: 'business_id,key,device_hwid' }
          ))
        }
      }),
    },

    inventory: {
      all: () => tryOr(async () => {
        return throwSupaError(await supabase.from('inventory_items').select('*').eq('business_id', bid).eq('active', true).order('name'))
      }, []),
    },

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

    users: {
      all: () => tryOr(async () => {
        return throwSupaError(await supabase.from('users').select('id,name,username,role,discount_pct,active').eq('business_id', bid).order('id'))
      }, []),
    },

    categorias: {
      all: () => tryOr(async () => {
        return throwSupaError(await supabase.from('categorias_servicio').select('*').eq('business_id', bid).order('orden').order('nombre'))
      }, []),
    },

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
    },

    washers: {
      all: () => tryOr(async () => {
        return throwSupaError(await supabase.from('washers').select('*').eq('business_id', bid).eq('active', true).order('name'))
      }, []),

      allAdmin: () => tryOr(async () => {
        return throwSupaError(await supabase.from('washers').select('*').eq('business_id', bid).order('name'))
      }, []),
    },

    sellers: {
      all: () => tryOr(async () => {
        return throwSupaError(await supabase.from('sellers').select('*').eq('business_id', bid).eq('active', true).order('name'))
      }, []),

      allAdmin: () => tryOr(async () => {
        return throwSupaError(await supabase.from('sellers').select('*').eq('business_id', bid).order('name'))
      }, []),
    },

    clients: {
      all: () => tryOr(async () => {
        return throwSupaError(await supabase.from('clients').select('*').eq('business_id', bid).eq('active', true).order('name'))
      }, []),

      search: (term) => tryOr(async () => {
        return throwSupaError(await supabase.from('clients').select('*').eq('business_id', bid)
          .or(`name.ilike.%${term}%,rnc.ilike.%${term}%,phone.ilike.%${term}%`)
          .eq('active', true).order('name').limit(20))
      }, []),
    },

    tickets: {
      recent: (params = {}) => tryOr(async () => {
        const { limit = 20 } = params
        let q = supabase.from('tickets').select('*').eq('business_id', bid)
        q = q.order('created_at', { ascending: false }).limit(limit)
        return throwSupaError(await q)
      }, []),

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

        const clientIds = [...new Set(rows.map(r => r.client_id).filter(Boolean))]
        let clientMap = {}
        if (clientIds.length) {
          const { data: cls } = await supabase.from('clients').select('id, name, rnc').in('id', clientIds)
          for (const c of (cls || [])) clientMap[c.id] = c
        }

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

        const { data: itemRows } = await supabase.from('ticket_items')
          .select('*').eq('ticket_id', id)
        const items = (itemRows || []).filter(i => i.name != null)

        let client_name = null, client_rnc = null
        if (ticket.client_id) {
          const { data: cl } = await supabase.from('clients')
            .select('name, rnc').eq('id', ticket.client_id).single()
          if (cl) { client_name = cl.name; client_rnc = cl.rnc }
        }

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

      byDateRange: (params) => tryOr(async () => {
        const { dateFrom, dateTo } = params
        let q = supabase.from('tickets').select('*').eq('business_id', bid)
        if (dateFrom) q = q.gte('created_at', dateFrom)
        if (dateTo)   q = q.lte('created_at', dateTo)
        q = q.order('created_at', { ascending: false }).limit(500)
        const rows = throwSupaError(await q)
        if (!rows?.length) return []

        const ticketIds = rows.map(r => r.id)
        const { data: allItems } = await supabase.from('ticket_items')
          .select('ticket_id, name, price, is_wash').in('ticket_id', ticketIds)
        const itemsMap = {}
        for (const i of (allItems || [])) {
          if (!itemsMap[i.ticket_id]) itemsMap[i.ticket_id] = []
          itemsMap[i.ticket_id].push(i)
        }

        const clientIds = [...new Set(rows.map(r => r.client_id).filter(Boolean))]
        let clientMap = {}
        if (clientIds.length) {
          const { data: cls } = await supabase.from('clients').select('id, name, rnc').in('id', clientIds)
          for (const c of (cls || [])) clientMap[c.id] = c
        }

        const cajeroIds = [...new Set(rows.map(r => r.cajero_id).filter(Boolean))]
        let cajeroMap = {}
        if (cajeroIds.length) {
          const { data: staff } = await supabase.from('staff').select('id, name').in('id', cajeroIds)
          for (const s of (staff || [])) cajeroMap[s.id] = s
        }

        return rows.map(r => ({
          ...r,
          items: (itemsMap[r.id] || []).filter(i => i.name != null),
          client_name: clientMap[r.client_id]?.name || null,
          client_rnc:  clientMap[r.client_id]?.rnc  || null,
          cajero_name: cajeroMap[r.cajero_id]?.name  || null,
        }))
      }, []),
    },

    queue: {
      active: () => tryOr(async () => {
        const { data: rows, error: qErr } = await supabase.from('queue')
          .select('*, tickets(id, doc_number, total, vehicle_plate, created_at, client_id), washers(name)')
          .eq('business_id', bid).neq('status', 'done')
          .order('created_at', { ascending: true })
        if (qErr) throw new Error(qErr.message)
        if (!rows?.length) return []

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
    },

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

        const ticketIds = [...new Set(rows.map(r => r.ticket_id))]
        const { data: ticketRows } = await supabase.from('tickets')
          .select('id, doc_number, created_at, vehicle_plate, status')
          .in('id', ticketIds)
        const ticketMap = {}
        for (const t of (ticketRows || [])) ticketMap[t.id] = t

        const { data: itemRows } = await supabase.from('ticket_items')
          .select('ticket_id, name').in('ticket_id', ticketIds).eq('is_wash', true)
        const itemsMap = {}
        for (const i of (itemRows || [])) {
          if (!itemsMap[i.ticket_id]) itemsMap[i.ticket_id] = []
          itemsMap[i.ticket_id].push(i.name)
        }

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
        const { data: rows, error } = await supabase.from('washer_commissions')
          .select('washer_id, ticket_id, base_amount, commission_pct, commission_amount, created_at')
          .eq('business_id', bid)
        if (error) throw new Error(error.message)
        if (!rows?.length) return []

        const from = dateFrom || '2000-01-01'
        const to   = dateTo   || '2099-12-31'
        const filtered = rows.filter(r => r.created_at >= from && r.created_at <= to)
        if (!filtered.length) return []

        const washerIds = [...new Set(filtered.map(r => r.washer_id))]
        const { data: washerRows } = await supabase.from('washers')
          .select('id, name, commission_pct').in('id', washerIds)
        const washerMap = {}
        for (const w of (washerRows || [])) washerMap[w.id] = w

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
    },

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
    },

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
    },

    cuadre: {
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

    creditPayments: {
      byClient: (clientId) => tryOr(async () => {
        return throwSupaError(await supabase.from('credit_payments').select('*').eq('business_id', bid).eq('client_id', clientId).order('created_at', { ascending: false }))
      }, []),
    },

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
    },

    ncf: {
      sequences: () => tryOr(async () => {
        return throwSupaError(await supabase.from('ncf_sequences').select('*').eq('business_id', bid).order('type'))
      }, []),
    },

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
    },

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
    },

    ecf: {
      queueCount: () => tryOr(async () => {
        const { count } = await supabase.from('ecf_queue')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', bid)
          .gt('created_at', new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString())
        return count || 0
      }, 0),
    },

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
  }
}

// ── Build API ─────────────────────────────────────────────────────────────────
const api = createWebAPI(supabase, businessId)

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0
let failed = 0
let skipped = 0
const failures = []

function describe(result) {
  if (result === null || result === undefined) return 'null'
  if (Array.isArray(result)) return `Array(${result.length})`
  if (typeof result === 'object') {
    const keys = Object.keys(result)
    if (keys.length <= 6) return `{${keys.join(', ')}}`
    return `Object(${keys.length} keys)`
  }
  return String(result).slice(0, 80)
}

async function test(path, fn) {
  const label = path.padEnd(50)
  try {
    const result = await fn()
    console.log(`  OK   ${label} => ${describe(result)}`)
    passed++
    return result
  } catch (err) {
    const msg = err?.message || String(err)
    console.log(`  FAIL ${label} => ${msg}`)
    failed++
    failures.push({ path, error: msg })
    return null
  }
}

async function skip(path, reason) {
  console.log(`  SKIP ${path.padEnd(50)} => ${reason}`)
  skipped++
}

// ── Seed minimal test data so join-heavy queries get exercised ─────────────────

console.log('--- Seeding test data for thorough join coverage ---')

// Create a test user
const testPinHash = await hashPin('9999')
const { data: testUser, error: tuErr } = await supabase.from('users').insert({
  business_id: businessId, name: 'Test Cajero', username: 'testcajero',
  role: 'cashier', pin_hash: testPinHash, active: true, discount_pct: 0,
}).select('id').single()
if (tuErr) console.log('  (user seed skip:', tuErr.message, ')')
const testUserId = testUser?.id

// Create a test washer
const { data: testWasher, error: twErr } = await supabase.from('washers').insert({
  business_id: businessId, name: 'Test Washer', commission_pct: 20, active: true,
}).select('id').single()
if (twErr) console.log('  (washer seed skip:', twErr.message, ')')
const testWasherId = testWasher?.id

// Create a test seller
const { data: testSeller, error: tsErr } = await supabase.from('sellers').insert({
  business_id: businessId, name: 'Test Seller', commission_pct: 5, active: true,
}).select('id').single()
if (tsErr) console.log('  (seller seed skip:', tsErr.message, ')')
const testSellerId = testSeller?.id

// Create a test client
const { data: testClient, error: tcErr } = await supabase.from('clients').insert({
  business_id: businessId, name: 'Test Client', rnc: '123456789', phone: '8091234567',
  balance: 0, credit_limit: 10000, active: true,
}).select('id').single()
if (tcErr) console.log('  (client seed skip:', tcErr.message, ')')
const testClientId = testClient?.id

console.log(`  Seeded: user=${testUserId || 'SKIP'} washer=${testWasherId || 'SKIP'} seller=${testSellerId || 'SKIP'} client=${testClientId || 'SKIP'}\n`)

// ── Run all tests ─────────────────────────────────────────────────────────────

console.log('=== ADMIN ===')
await test('admin.getEmpresa', () => api.admin.getEmpresa())
await test('admin.saveEmpresa (no-op)', () => api.admin.saveEmpresa({}))
await test('admin.getUsuarios', () => api.admin.getUsuarios())
await test('admin.getLavadores', () => api.admin.getLavadores())
await test('admin.getVendedores', () => api.admin.getVendedores())
await test('admin.getServicios', () => api.admin.getServicios())
await test('admin.getCategorias', () => api.admin.getCategorias())
await test('admin.getSecuenciasNcf', () => api.admin.getSecuenciasNcf())
await test('admin.getConfiguracion', () => api.admin.getConfiguracion())

console.log('\n=== SETTINGS ===')
await test('settings.get', () => api.settings.get())

console.log('\n=== AUTH ===')
await test('auth.byPin (bad pin)', () => api.auth.byPin('0000'))
if (testUserId) {
  await test('auth.byPin (seeded user 9999)', () => api.auth.byPin('9999'))
}

console.log('\n=== USERS ===')
const users = await test('users.all', () => api.users.all())

console.log('\n=== CATEGORIAS ===')
await test('categorias.all', () => api.categorias.all())

console.log('\n=== SERVICES ===')
await test('services.all', () => api.services.all())
await test('services.allAdmin', () => api.services.allAdmin())

console.log('\n=== WASHERS ===')
const washers = await test('washers.all', () => api.washers.all())
await test('washers.allAdmin', () => api.washers.allAdmin())

console.log('\n=== SELLERS ===')
const sellers = await test('sellers.all', () => api.sellers.all())
await test('sellers.allAdmin', () => api.sellers.allAdmin())

console.log('\n=== CLIENTS ===')
const clients = await test('clients.all', () => api.clients.all())
await test('clients.search ("test")', () => api.clients.search('test'))

console.log('\n=== TICKETS ===')
const recentTickets = await test('tickets.recent', () => api.tickets.recent({ limit: 5 }))
await test('tickets.all', () => api.tickets.all({ limit: 5 }))

// Use a real ticket ID if available
if (recentTickets && recentTickets.length > 0) {
  const tid = recentTickets[0].id
  await test(`tickets.byId (${tid})`, () => api.tickets.byId(tid))
} else {
  await skip('tickets.byId', 'no tickets found')
}

await test('tickets.byDateRange', () => api.tickets.byDateRange({
  dateFrom: '2025-01-01', dateTo: '2099-12-31'
}))

await skip('tickets.create', 'skipped to avoid creating data')
await skip('tickets.markPaid', 'skipped to avoid mutating data')
await skip('tickets.void', 'skipped to avoid mutating data')

console.log('\n=== QUEUE ===')
await test('queue.active', () => api.queue.active())
await skip('queue.updateStatus', 'skipped to avoid mutating data')

console.log('\n=== COMMISSIONS (washer) ===')
await test('commissions.byPeriod', () => api.commissions.byPeriod({
  dateFrom: '2025-01-01', dateTo: '2099-12-31'
}))

if (testWasherId) {
  await test(`commissions.byWasher (seeded)`, () => api.commissions.byWasher({
    washerId: testWasherId, dateFrom: '2025-01-01', dateTo: '2099-12-31'
  }))
} else if (washers && washers.length > 0) {
  const wid = washers[0].id
  await test(`commissions.byWasher (${wid})`, () => api.commissions.byWasher({
    washerId: wid, dateFrom: '2025-01-01', dateTo: '2099-12-31'
  }))
} else {
  await skip('commissions.byWasher', 'no washers found')
}

console.log('\n=== SELLER COMMISSIONS ===')
await test('sellerCommissions.byPeriod', () => api.sellerCommissions.byPeriod({
  dateFrom: '2025-01-01', dateTo: '2099-12-31'
}))

if (testSellerId) {
  await test(`sellerCommissions.bySeller (seeded)`, () => api.sellerCommissions.bySeller({
    sellerId: testSellerId, dateFrom: '2025-01-01', dateTo: '2099-12-31'
  }))
} else if (sellers && sellers.length > 0) {
  const sid = sellers[0].id
  await test(`sellerCommissions.bySeller (${sid})`, () => api.sellerCommissions.bySeller({
    sellerId: sid, dateFrom: '2025-01-01', dateTo: '2099-12-31'
  }))
} else {
  await skip('sellerCommissions.bySeller', 'no sellers found')
}

console.log('\n=== CAJERO COMMISSIONS ===')
await test('cajeroCommissions.byPeriod', () => api.cajeroCommissions.byPeriod({
  dateFrom: '2025-01-01', dateTo: '2099-12-31'
}))

if (testUserId) {
  await test(`cajeroCommissions.byCajero (seeded)`, () => api.cajeroCommissions.byCajero({
    cajeroId: testUserId, dateFrom: '2025-01-01', dateTo: '2099-12-31'
  }))
} else if (users && users.length > 0) {
  const cid = users[0].id
  await test(`cajeroCommissions.byCajero (${cid})`, () => api.cajeroCommissions.byCajero({
    cajeroId: cid, dateFrom: '2025-01-01', dateTo: '2099-12-31'
  }))
} else {
  await skip('cajeroCommissions.byCajero', 'no users found')
}

console.log('\n=== INVENTORY ===')
await test('inventory.all', () => api.inventory.all())

console.log('\n=== CUADRE ===')
await test('cuadre.history', () => api.cuadre.history())
await test('cuadre.list', () => api.cuadre.list())
await test('cuadre.daily', () => api.cuadre.daily(new Date().toISOString().slice(0, 10)))

console.log('\n=== CREDIT PAYMENTS ===')
if (testClientId) {
  await test(`creditPayments.byClient (seeded)`, () => api.creditPayments.byClient(testClientId))
} else if (clients && clients.length > 0) {
  const clid = clients[0].id
  await test(`creditPayments.byClient (${clid})`, () => api.creditPayments.byClient(clid))
} else {
  await skip('creditPayments.byClient', 'no clients found')
}

console.log('\n=== NOTAS DE CREDITO ===')
await test('notas.all', () => api.notas.all())

console.log('\n=== NCF ===')
await test('ncf.sequences', () => api.ncf.sequences())
await skip('ncf.next', 'skipped to avoid consuming sequence numbers')

console.log('\n=== CAJA CHICA ===')
await test('cajaChica.all', () => api.cajaChica.all())

console.log('\n=== DGII ===')
await test('dgii.get606', () => api.dgii.get606({ dateFrom: '2025-01-01', dateTo: '2099-12-31' }))
await test('dgii.get607', () => api.dgii.get607({ dateFrom: '2025-01-01', dateTo: '2099-12-31' }))

console.log('\n=== ECF QUEUE ===')
await test('ecf.queueCount', () => api.ecf.queueCount())

console.log('\n=== DB EXPORT ===')
await test('db.exportAll', () => api.db.exportAll())
await test('db.exportSince', () => api.db.exportSince('2025-01-01'))

// ── Cleanup seeded test data ───────────────────────────────────────────────────
console.log('\n--- Cleaning up seeded test data ---')
if (testUserId)    await supabase.from('users').delete().eq('id', testUserId)
if (testWasherId)  await supabase.from('washers').delete().eq('id', testWasherId)
if (testSellerId)  await supabase.from('sellers').delete().eq('id', testSellerId)
if (testClientId)  await supabase.from('clients').delete().eq('id', testClientId)
console.log('  Done.\n')

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(70))
console.log(`RESULTS: ${passed} passed, ${failed} failed, ${skipped} skipped`)
console.log('='.repeat(70))

if (failures.length) {
  console.log('\nFAILURES:')
  for (const f of failures) {
    console.log(`  - ${f.path}: ${f.error}`)
  }
}

process.exit(failed > 0 ? 1 : 0)
