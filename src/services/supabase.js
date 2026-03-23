/**
 * supabase.js — Supabase client, business registration, ticket sync
 *
 * Supabase is used for:
 *   1. Remote Dashboard — owner sees live revenue from any device
 *   2. Cloud backup of tickets
 *   3. Multi-sucursal (future)
 *
 * Credentials are stored in localStorage and configured in
 * Settings → Respaldo → Supabase.
 *
 * ── Supabase schema (run once in Supabase SQL editor) ─────────────────────
 *
 * create table if not exists businesses (
 *   id         uuid primary key default gen_random_uuid(),
 *   name       text not null,
 *   rnc        text,
 *   created_at timestamptz default now()
 * );
 * alter table businesses enable row level security;
 * create policy "open insert" on businesses for insert with check (true);
 * create policy "open select" on businesses for select using (true);
 * create policy "open update" on businesses for update using (true);
 *
 * create table if not exists tickets (
 *   id             uuid primary key default gen_random_uuid(),
 *   business_id    uuid references businesses(id) on delete cascade not null,
 *   doc_number     text,
 *   client_name    text,
 *   services_json  jsonb,
 *   subtotal       numeric,
 *   itbis          numeric,
 *   ley            numeric,
 *   total          numeric,
 *   ncf            text,
 *   ncf_type       text,
 *   payment_method text,
 *   tipo_venta     text,
 *   cajero         text,
 *   status         text default 'cobrado',
 *   paid_at        timestamptz default now(),
 *   created_at     timestamptz default now()
 * );
 * alter table tickets enable row level security;
 * create policy "open insert" on tickets for insert with check (true);
 * create policy "open select" on tickets for select using (true);
 *
 * ──────────────────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js'

// ── Lazy singleton client ─────────────────────────────────────────────────────
let _client = null

export function getSupabaseClient() {
  const url = getStoredSetting('supabase_url')
  const key = getStoredSetting('supabase_anon_key')
  if (!url || !key) return null
  if (!_client || _client._supabaseUrl !== url) {
    _client = createClient(url, key, {
      auth:     { persistSession: false },
      realtime: { params: { eventsPerSecond: 2 } },
    })
    _client._supabaseUrl = url
  }
  return _client
}

export function resetSupabaseClient() {
  _client = null
}

// ── Settings helpers ──────────────────────────────────────────────────────────
export function getStoredSetting(key) {
  try { return localStorage.getItem(`tx_setting_${key}`) || '' }
  catch { return '' }
}
export function setStoredSetting(key, value) {
  try { localStorage.setItem(`tx_setting_${key}`, value) }
  catch {}
}

// ── Business ID ───────────────────────────────────────────────────────────────
export function getBusinessId() {
  return getStoredSetting('business_id') || null
}

// ── Business registration ─────────────────────────────────────────────────────
/**
 * Called once after Supabase credentials are saved.
 * If this installation already has a business_id stored, checks it still
 * exists in Supabase. If not (first time), creates the row and stores the UUID.
 * Returns { ok, businessId, error }.
 */
export async function ensureBusinessRegistered(api) {
  const sb = getSupabaseClient()
  if (!sb) return { ok: false, error: 'Supabase no configurado' }

  try {
    const existingId = getBusinessId()

    if (existingId) {
      // Verify it still exists
      const { data, error } = await sb
        .from('businesses')
        .select('id')
        .eq('id', existingId)
        .maybeSingle()

      if (!error && data) return { ok: true, businessId: existingId }
      // Row missing (e.g. new Supabase project) — fall through to create
    }

    // Fetch business info from app to use as the name
    let name = 'Mi Negocio'
    let rnc  = null
    try {
      const eApi = api || window.electronAPI
      const biz = await eApi.admin.getEmpresa()
      if (biz?.name) name = biz.name
      if (biz?.rnc)  rnc  = biz.rnc
    } catch {}

    const { data, error } = await sb
      .from('businesses')
      .insert({ name, rnc })
      .select('id')
      .single()

    if (error) return { ok: false, error: error.message }

    setStoredSetting('business_id', data.id)
    return { ok: true, businessId: data.id }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

// ── Connectivity test ─────────────────────────────────────────────────────────
export async function testConnection() {
  const sb = getSupabaseClient()
  if (!sb) return { ok: false, error: 'Credenciales no configuradas' }
  try {
    const { error } = await sb.from('businesses').select('id').limit(1)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

// ── Ticket sync ───────────────────────────────────────────────────────────────
/**
 * Pushes a single cobrado ticket to Supabase.
 * Fire-and-forget — never throws, never blocks the POS flow.
 *
 * ticketData: the data object passed to tickets.create()
 * result:     the return value from tickets.create() { docNumber, ncf, ... }
 */
export async function syncTicket(ticketData, result) {
  const sb         = getSupabaseClient()
  const businessId = getBusinessId()
  if (!sb || !businessId) return

  try {
    await sb.from('tickets').insert({
      business_id:    businessId,
      doc_number:     result?.docNumber  || null,
      client_name:    ticketData.client_name || null,
      total:          ticketData.total,
      payment_method: ticketData.payment_method || null,
      status:         'cobrado',
      paid_at:        new Date().toISOString(),
    })
  } catch {
    // fire-and-forget — never blocks POS flow
  }
}

// ── Dashboard queries ─────────────────────────────────────────────────────────

function startOf(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}
function endOf(date) {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d.toISOString()
}

/**
 * Fetches all dashboard metrics in a single call.
 * Returns { today, yesterday, week, recentTickets, paymentBreakdown }.
 */
export async function fetchDashboardData() {
  const sb         = getSupabaseClient()
  const businessId = getBusinessId()
  if (!sb || !businessId) return null

  const now       = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - 6)

  try {
    // Fetch last 7 days of tickets in one query
    const { data: rows, error } = await sb
      .from('tickets')
      .select('total, itbis, payment_method, doc_number, client_name, ncf, ncf_type, status, paid_at, services_json')
      .eq('business_id', businessId)
      .eq('status', 'cobrado')
      .gte('paid_at', startOf(weekStart))
      .order('paid_at', { ascending: false })

    if (error) throw error

    const todayStr     = now.toDateString()
    const yesterStr    = yesterday.toDateString()

    let todayRevenue   = 0, todayCount   = 0
    let yesterRevenue  = 0, yesterCount  = 0
    let weekRevenue    = 0
    const payMap       = {}

    for (const r of rows) {
      const d   = new Date(r.paid_at)
      const ds  = d.toDateString()
      const amt = Number(r.total)

      weekRevenue += amt

      const pm = r.payment_method || 'efectivo'
      payMap[pm] = (payMap[pm] || 0) + amt

      if (ds === todayStr)  { todayRevenue  += amt; todayCount++  }
      if (ds === yesterStr) { yesterRevenue += amt; yesterCount++ }
    }

    const recentTickets = rows.slice(0, 15).map(r => ({
      doc_number:     r.doc_number,
      client_name:    r.client_name,
      total:          Number(r.total),
      ncf:            r.ncf,
      ncf_type:       r.ncf_type,
      payment_method: r.payment_method,
      paid_at:        r.paid_at,
      services:       Array.isArray(r.services_json)
        ? r.services_json.map(s => s.name).join(', ')
        : '—',
    }))

    const paymentBreakdown = Object.entries(payMap).map(([method, total]) => ({ method, total }))
      .sort((a, b) => b.total - a.total)

    return {
      today:    { revenue: todayRevenue,  count: todayCount  },
      yesterday:{ revenue: yesterRevenue, count: yesterCount },
      week:     { revenue: weekRevenue,   count: rows.length },
      recentTickets,
      paymentBreakdown,
    }
  } catch (e) {
    return { error: e.message }
  }
}
