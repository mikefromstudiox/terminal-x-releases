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
import { withRetry, isSupabaseRetryable } from './retry.js'
import { humanizeNetworkError } from './networkError.js'

// ── Lazy singleton client ─────────────────────────────────────────────────────
let _client = null

export function getSupabaseClient() {
  let url = getStoredSetting('supabase_url')
  let key = getStoredSetting('supabase_anon_key')
  // Web fallback — on terminalxpos.com the credentials are baked in via Vite
  // env, not stored in localStorage. Without this fallback Remote Dashboard
  // reports "Supabase no configurado" even though Supabase is working fine
  // for the rest of the app.
  if ((!url || !key) && typeof import.meta !== 'undefined' && import.meta.env) {
    url = url || import.meta.env.VITE_SUPABASE_URL || ''
    key = key || import.meta.env.VITE_SUPABASE_ANON_KEY || ''
  }
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
  try {
    const v = localStorage.getItem(`tx_setting_${key}`)
    // Guard against literal "null"/"undefined" strings that sneak in when
    // code does String(x) on a nullish value. PostgREST rejects these as
    // UUID inputs ("invalid input syntax for type uuid: 'null'").
    if (v === null || v === 'null' || v === 'undefined' || v === '') return ''
    return v
  } catch { return '' }
}
export function setStoredSetting(key, value) {
  try {
    if (value == null || value === 'null' || value === 'undefined') {
      localStorage.removeItem(`tx_setting_${key}`)
      return
    }
    localStorage.setItem(`tx_setting_${key}`, String(value))
  } catch {}
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
      // Verify it still exists (retry transient network failures)
      const { data, error } = await withRetry(
        () => sb.from('businesses').select('id').eq('id', existingId).maybeSingle(),
        { label: 'supabase.ensureBusiness.verify', isRetryable: isSupabaseRetryable },
      )

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

    const { data, error } = await withRetry(
      () => sb.from('businesses').insert({ name, rnc }).select('id').single(),
      { label: 'supabase.ensureBusiness.insert', isRetryable: isSupabaseRetryable },
    )

    if (error) return { ok: false, error: humanizeNetworkError(error, { context: 'ensureBusiness.insert' }) }

    setStoredSetting('business_id', data.id)
    return { ok: true, businessId: data.id }
  } catch (e) {
    return { ok: false, error: humanizeNetworkError(e, { context: 'ensureBusiness' }) }
  }
}

// ── Connectivity test ─────────────────────────────────────────────────────────
export async function testConnection() {
  // Prefer the services-side client (desktop populates localStorage on boot).
  // Fall back to the shared web client stashed on window by web/main.jsx.
  const sb = getSupabaseClient()
    || (typeof window !== 'undefined' ? window.__txSupabase : null)
  if (!sb) return { ok: false, error: 'Credenciales no configuradas' }
  try {
    const { error } = await withRetry(
      () => sb.from('businesses').select('id').limit(1),
      { label: 'supabase.testConnection', isRetryable: isSupabaseRetryable },
    )
    if (error) return { ok: false, error: humanizeNetworkError(error, { context: 'testConnection' }) }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: humanizeNetworkError(e, { context: 'testConnection' }) }
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
export async function fetchDashboardData({ since } = {}) {
  const sb         = getSupabaseClient()
  const businessId = getBusinessId()
  if (!sb || !businessId) return null

  const now       = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - 6)

  // Clamp the week window by the caller-provided `since` cutoff (go-live).
  // When go-live is within the last 7 days, we start from the cutoff instead.
  const fromIso = (() => {
    const weekIso = startOf(weekStart)
    if (!since) return weekIso
    return weekIso > since ? weekIso : since
  })()

  try {
    // Fetch last 7 days of tickets in one query
    const { data: rows, error } = await sb
      .from('tickets')
      .select('total, itbis, payment_method, doc_number, client_name, ncf, ncf_type, status, paid_at, services_json, cajero_name')
      .eq('business_id', businessId)
      .eq('status', 'cobrado')
      .gte('paid_at', fromIso)
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
      cajero:         r.cajero_name || r.cajero || null,
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
    return { error: humanizeNetworkError(e, { context: 'dashboard.fetch' }) }
  }
}
