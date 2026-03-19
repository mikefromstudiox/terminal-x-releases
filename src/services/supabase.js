/**
 * supabase.js — Supabase client + schema reference
 *
 * Configure SUPABASE_URL and SUPABASE_ANON_KEY in Settings → Respaldo.
 * The client is created lazily on first use so the app works offline
 * with no credentials configured.
 *
 * ── Supabase schema (run these in Supabase SQL editor) ────────────────────
 *
 * -- Enable RLS and create business-scoped tables:
 *
 * create table businesses (
 *   id          uuid primary key default gen_random_uuid(),
 *   name        text not null,
 *   rnc         text unique,
 *   created_at  timestamptz default now()
 * );
 *
 * create table tickets (
 *   id           uuid primary key default gen_random_uuid(),
 *   business_id  uuid references businesses(id) on delete cascade,
 *   ticket_no    text,
 *   client       jsonb,
 *   services     jsonb,
 *   subtotal     numeric,
 *   itbis        numeric,
 *   ley          numeric,
 *   total        numeric,
 *   ncf          text,
 *   ncf_type     text,
 *   forma_pago   text,
 *   tipo         text,
 *   cajero       text,
 *   lavador      text,
 *   estado       text default 'cobrado',
 *   paid_at      timestamptz,
 *   created_at   timestamptz default now()
 * );
 * alter table tickets enable row level security;
 * create policy "Business sees own tickets"
 *   on tickets for all using (business_id = auth.jwt()->>'business_id'::uuid);
 *
 * create table clients (
 *   id           uuid primary key default gen_random_uuid(),
 *   business_id  uuid references businesses(id) on delete cascade,
 *   name         text,
 *   rnc          text,
 *   phone        text,
 *   address      text,
 *   email        text,
 *   credit_limit numeric default 0,
 *   balance      numeric default 0,
 *   created_at   timestamptz default now()
 * );
 * alter table clients enable row level security;
 * create policy "Business sees own clients"
 *   on clients for all using (business_id = auth.jwt()->>'business_id'::uuid);
 *
 * create table backups (
 *   id           uuid primary key default gen_random_uuid(),
 *   business_id  uuid references businesses(id) on delete cascade,
 *   filename     text,
 *   size_bytes   bigint,
 *   type         text default 'auto',   -- 'auto' | 'manual'
 *   status       text default 'ok',
 *   created_at   timestamptz default now()
 * );
 * alter table backups enable row level security;
 * create policy "Business sees own backups"
 *   on backups for all using (business_id = auth.jwt()->>'business_id'::uuid);
 *
 * -- Storage bucket (create in Supabase Dashboard → Storage):
 * --   Name: terminal-x-backups
 * --   Public: false
 * --   Allowed MIME types: application/json, application/octet-stream
 *
 * ──────────────────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js'

// ── Lazy singleton client ─────────────────────────────────────────────────────
let _client = null

/**
 * Returns the Supabase client, creating it if needed.
 * Returns null if credentials are not configured.
 */
export function getSupabaseClient() {
  // Read from runtime settings (stored in localStorage for now;
  // replace with electron-store or SQLite settings table in production)
  const url = getStoredSetting('supabase_url')
  const key = getStoredSetting('supabase_anon_key')

  if (!url || !key) return null

  // Re-create if credentials changed
  if (!_client || _client.supabaseUrl !== url) {
    _client = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
      realtime: {
        params: { eventsPerSecond: 2 },
      },
    })
    _client.supabaseUrl = url  // store for comparison
  }
  return _client
}

/** Invalidate cached client (called when settings change) */
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

// ── Connectivity test ─────────────────────────────────────────────────────────
/**
 * Pings Supabase to verify credentials work.
 * Returns { ok, error }.
 */
export async function testConnection() {
  const sb = getSupabaseClient()
  if (!sb) return { ok: false, error: 'Credenciales no configuradas' }
  try {
    const { error } = await sb.from('backups').select('id').limit(1)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e.message) }
  }
}

// ── Business ID helper ────────────────────────────────────────────────────────
export function getBusinessId() {
  const id = getStoredSetting('business_id')
  if (!id) throw new Error('business_id no configurado — sincronización en la nube no disponible')
  return id
}
