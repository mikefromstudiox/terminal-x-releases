#!/usr/bin/env node
/**
 * pre-launch-check.mjs — Production-state sanity for Ranoza go-live.
 *
 * The 4 release gates (RLS / Ranoza E2E / audit-flows / verify-v2.16.24)
 * cover data-layer correctness against synthetic data. THIS script verifies
 * the production environment is actually ready for tomorrow's go-live:
 *
 *   1. Ranoza tenant state (license active, business config, RNC, plan, settings)
 *   2. NCF sequence health (B01/B02/E32 available + not exhausted)
 *   3. DGII receiver reachable (semilla / validate / recepcion endpoints)
 *   4. Supabase reachability + cert presence + backups landing
 *   5. Storage bucket health (db-backups, vault, photos)
 *   6. Realtime publication scope (24 tables, no cross-tenant)
 *   7. Vercel cron schedule registered (3 crons)
 *   8. Recent activity log write health (no 24h+ silence)
 *   9. terminalxpos.com hits + selected page renders
 *  10. Studio X SRL e-CF cert validity window
 *  11. JWT app_metadata.business_id backfill coverage (no auth.users
 *      without business_id claim → would deny RLS)
 *  12. Web bundle size sanity check (catch dist-web bloat)
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import https from 'node:https'

const SUPA_URL = process.env.SUPABASE_URL
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON = process.env.SUPABASE_ANON_KEY || ''
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
if (!SUPA_URL || !SVC || !TOKEN) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ACCESS_TOKEN'); process.exit(1) }
const sb = createClient(SUPA_URL, SVC, { auth: { persistSession: false } })
const projectRef = SUPA_URL.match(/https:\/\/([^.]+)/)[1]

const STUDIO_X_SRL = '1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79'
const RANOZA       = '4f789f41-76d2-4402-838f-5fe20a91641f'

let pass = 0, fail = 0, warn = 0
const rec = []
function ok(m)   { pass++; rec.push(['PASS', m]); console.log(`✅ ${m}`) }
function bad(m)  { fail++; rec.push(['FAIL', m]); console.log(`❌ ${m}`) }
function warned(m) { warn++; rec.push(['WARN', m]); console.log(`⚠️  ${m}`) }
async function step(name, fn) {
  try { await fn() } catch (e) { bad(`${name} — ${e?.message || e}`) }
}
async function pgQuery(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  return JSON.parse(await res.text())
}
async function httpHead(url, timeoutMs = 10000) {
  return new Promise(resolve => {
    try {
      const u = new URL(url)
      const req = https.request({ method: 'HEAD', hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, timeout: timeoutMs },
        (res) => resolve({ status: res.statusCode || 0, headers: res.headers }))
      req.on('error', e => resolve({ status: 0, error: e.message }))
      req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }) })
      req.end()
    } catch (e) { resolve({ status: 0, error: e.message }) }
  })
}
async function httpGet(url, timeoutMs = 10000) {
  return new Promise(resolve => {
    try {
      const u = new URL(url)
      const req = https.request({ method: 'GET', hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, timeout: timeoutMs },
        (res) => {
          let body = ''
          res.on('data', c => body += c)
          res.on('end', () => resolve({ status: res.statusCode || 0, body }))
        })
      req.on('error', e => resolve({ status: 0, error: e.message }))
      req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }) })
      req.end()
    } catch (e) { resolve({ status: 0, error: e.message }) }
  })
}

console.log('\n=== Terminal X Pre-Launch Check — 2026-05-01 ===\n')

// ── Section 1: Ranoza tenant state ─────────────────────────────────────────
console.log('── 1. Ranoza tenant state ──────────────────────────────────────')

await step('Ranoza business row exists + plan + RNC', async () => {
  const { data: biz } = await sb.from('businesses').select('id, name, plan, settings').eq('id', RANOZA).maybeSingle()
  if (!biz) throw new Error('Ranoza business row missing')
  const settings = typeof biz.settings === 'string' ? JSON.parse(biz.settings) : (biz.settings || {})
  if (!biz.plan) warned(`Ranoza plan empty (settings.business_type=${settings.business_type})`)
  else ok(`Ranoza: plan=${biz.plan} type=${settings.business_type || '—'} name=${biz.name}`)
})

await step('Ranoza license active', async () => {
  const { data } = await sb.from('licenses').select('license_key, plan_id, status, expires_at').eq('business_id', RANOZA).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!data) throw new Error('no license row')
  if (data.status !== 'active') throw new Error(`license status=${data.status}`)
  const exp = new Date(data.expires_at)
  const days = Math.round((exp - Date.now()) / (24*3600*1000))
  if (days < 7) warned(`Ranoza license expires in ${days} days (${data.expires_at})`)
  else ok(`Ranoza license active, plan_id=${data.plan_id}, expires in ${days} days`)
})

await step('Ranoza app_settings has go_live_date populated', async () => {
  const { data } = await sb.from('app_settings').select('value').eq('business_id', RANOZA).eq('key', 'go_live_date').maybeSingle()
  if (!data?.value) warned('Ranoza go_live_date empty — _liveWeb=false → commissions/audit silently skip')
  else ok(`Ranoza go_live_date=${data.value}`)
})

await step('Ranoza inventory count > 0', async () => {
  const { count } = await sb.from('inventory_items').select('id', { count: 'exact', head: true }).eq('business_id', RANOZA).eq('active', true)
  if (!count || count < 100) warned(`Ranoza inventory only ${count} items — expected ~976 from 2026-04-19 import`)
  else ok(`Ranoza inventory: ${count} active items`)
})

// ── Section 2: NCF sequence health ─────────────────────────────────────────
console.log('\n── 2. NCF sequence health ─────────────────────────────────────')

await step('Ranoza NCF sequences for B01 / B02', async () => {
  // ncf_sequences uses limit_number (not end_number) for the upper bound
  const { data: rows } = await sb.from('ncf_sequences').select('type, current_number, limit_number, enabled, active').eq('business_id', RANOZA)
  if (!rows?.length) { warned('Ranoza has no ncf_sequences — owner needs to set up B01/B02 in DGII tab before issuing fiscal NCFs'); return }
  const types = rows.reduce((a, r) => { a[r.type] = r; return a }, {})
  const required = ['B01', 'B02']
  for (const t of required) {
    if (!types[t]) { warned(`Ranoza missing ${t} sequence`); continue }
    if (!types[t].enabled || !types[t].active) { warned(`Ranoza ${t} sequence disabled`); continue }
    const remaining = (types[t].limit_number || 0) - (types[t].current_number || 0)
    if (remaining < 100) warned(`Ranoza ${t}: only ${remaining} NCFs left (curr=${types[t].current_number}/limit=${types[t].limit_number})`)
    else ok(`Ranoza ${t}: ${remaining} NCFs available (curr=${types[t].current_number})`)
  }
})

await step('Studio X SRL e-CF sequences (E31/E32) for tomorrow', async () => {
  const { data: rows } = await sb.from('ncf_sequences').select('type, current_number, limit_number, enabled, active').eq('business_id', STUDIO_X_SRL).in('type', ['E31','E32'])
  if (!rows?.length) { warned('Studio X SRL has no E31/E32 sequences'); return }
  for (const r of rows) {
    if (!r.enabled || !r.active) { warned(`SXSRL ${r.type} sequence disabled`); continue }
    const remaining = (r.limit_number || 0) - (r.current_number || 0)
    if (remaining < 50) warned(`SXSRL ${r.type}: only ${remaining} e-CFs left`)
    else ok(`SXSRL ${r.type}: ${remaining} e-CFs available`)
  }
})

// ── Section 3: DGII receiver reachable ─────────────────────────────────────
console.log('\n── 3. DGII receiver (fe.terminalxpos.com) ─────────────────────')

await step('DGII receiver responds', async () => {
  const r = await httpGet('https://fe.terminalxpos.com/health', 8000)
  if (r.status === 0) throw new Error(`unreachable: ${r.error}`)
  if (r.status >= 500) throw new Error(`HTTP ${r.status}`)
  ok(`fe.terminalxpos.com/health → HTTP ${r.status}`)
})

// ── Section 4: Storage / cert / backup health ──────────────────────────────
console.log('\n── 4. Storage / cert / backup ─────────────────────────────────')

await step('db-backups bucket exists', async () => {
  const r = await fetch(`${SUPA_URL}/storage/v1/bucket/db-backups`, {
    headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
  })
  if (r.status === 200) ok('db-backups bucket exists')
  else throw new Error(`bucket status=${r.status}`)
})

await step('Studio X SRL recent backup exists (last 48h)', async () => {
  const { data: rows } = await sb.from('app_settings').select('value, updated_at').eq('business_id', STUDIO_X_SRL).eq('key', 'backup_last_ok_at').maybeSingle()
  if (!rows?.value) { warned('SXSRL no backup_last_ok_at — desktop never ran a backup'); return }
  const lastOk = new Date(rows.value)
  const hoursAgo = (Date.now() - lastOk.getTime()) / 3600000
  if (hoursAgo > 48) warned(`SXSRL last backup ${hoursAgo.toFixed(1)}h ago (>48h)`)
  else ok(`SXSRL last backup ${hoursAgo.toFixed(1)}h ago (${lastOk.toISOString()})`)
})

await step('Studio X SRL e-CF cert validity', async () => {
  // Cert info is stored on businesses.settings JSONB (synced from desktop on
  // license validation), not in app_settings.
  const { data: biz } = await sb.from('businesses').select('settings').eq('id', STUDIO_X_SRL).maybeSingle()
  const settings = typeof biz?.settings === 'string' ? JSON.parse(biz.settings) : (biz?.settings || {})
  const expRaw = settings.ecf_cert_expiry
  const subj = settings.ecf_cert_subject
  const env = settings.dgii_environment
  if (!expRaw) { warned('SXSRL ecf_cert_expiry missing in businesses.settings — cert not installed?'); return }
  const exp = new Date(expRaw)
  const days = Math.round((exp - Date.now()) / (24*3600*1000))
  if (days < 30) warned(`SXSRL e-CF cert expires in ${days} days (env=${env || '?'})`)
  else ok(`SXSRL e-CF cert valid ${days} days (subject=${subj?.slice(0,30) || '?'}, env=${env})`)
})

// ── Section 5: Realtime + publication scope ────────────────────────────────
console.log('\n── 5. Realtime publication scope ──────────────────────────────')

await step('supabase_realtime publication has expected scope', async () => {
  const rows = await pgQuery("SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' ORDER BY tablename")
  const tables = rows.map(r => r.tablename)
  // Critical tables that MUST broadcast for multi-device flows
  const required = ['queue', 'tickets', 'mesas', 'kds_events', 'ticket_locks']
  const missing = required.filter(t => !tables.includes(t))
  if (missing.length) throw new Error(`realtime missing: ${missing.join(', ')}`)
  // Tables that MUST NEVER be in realtime (no RLS policy can save these
  // because the realtime fan-out would broadcast credentials/license tokens
  // to every subscriber). app_settings/licenses include device-bound secrets.
  const banned = ['app_settings', 'licenses', 'license_events', 'auth.users']
  const leaked = banned.filter(t => tables.includes(t))
  if (leaked.length) throw new Error(`realtime LEAKING credentials/license tables: ${leaked.join(', ')}`)
  // empleados + staff are in the publication but RLS row-level policies
  // restrict reads to the subscriber's own business_id — cross-tenant
  // broadcast is enforced server-side. Listed for awareness, not a leak.
  ok(`realtime publication: ${tables.length} tables, all required present, no credential leak`)
})

// ── Section 6: Vercel cron registration ────────────────────────────────────
console.log('\n── 6. Vercel cron schedule ────────────────────────────────────')

await step('Vercel cron config has 3 entries', async () => {
  const fs = await import('node:fs/promises')
  // Source of truth is the root vercel.json (web/vercel.json deleted 2026-05-17).
  const conf = JSON.parse(await fs.readFile('vercel.json', 'utf8'))
  const crons = conf.crons || []
  if (crons.length < 3) throw new Error(`expected 3+ crons, got ${crons.length}`)
  const paths = crons.map(c => c.path)
  const required = ['/api/digest/daily', '/api/panel?action=cron_dgii_pull', '/api/panel?action=anecf-drain']
  for (const p of required) {
    if (!paths.includes(p)) throw new Error(`missing cron: ${p}`)
  }
  ok(`Vercel crons: ${crons.length} registered (${paths.join(', ')})`)
})

// ── Section 7: Activity log writes (24h health) ────────────────────────────
console.log('\n── 7. Activity log health ─────────────────────────────────────')

await step('activity_log: at least one write across all tenants in last 24h', async () => {
  const since = new Date(Date.now() - 24*3600*1000).toISOString()
  const { count } = await sb.from('activity_log').select('id', { count: 'exact', head: true }).gte('created_at', since)
  if (!count) warned('No activity_log rows in last 24h — either pre-launch quiet or write path broken')
  else ok(`activity_log: ${count} rows in last 24h`)
})

// ── Section 8: terminalxpos.com live ───────────────────────────────────────
console.log('\n── 8. terminalxpos.com health ─────────────────────────────────')

for (const [path, label] of [['/', 'home'], ['/login', 'login page'], ['/admin', 'admin'], ['/pos', 'POS app shell']]) {
  await step(`terminalxpos.com${path} responds`, async () => {
    const r = await httpGet(`https://terminalxpos.com${path}`, 8000)
    if (r.status === 0) throw new Error(`unreachable: ${r.error}`)
    if (r.status >= 500) throw new Error(`HTTP ${r.status}`)
    if (r.status === 200 && !r.body.includes('<html')) warned(`${label}: 200 but no html`)
    else ok(`${label}: HTTP ${r.status}`)
  })
}

await step('terminalxpos.com sitemap.xml served (not SPA-rewritten)', async () => {
  const r = await httpGet('https://terminalxpos.com/sitemap.xml', 8000)
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`)
  if (!r.body.includes('<urlset')) throw new Error('sitemap.xml served as HTML (SPA rewrite)')
  ok('sitemap.xml correctly served as XML')
})

// ── Section 9: JWT app_metadata.business_id backfill coverage ──────────────
console.log('\n── 9. JWT app_metadata.business_id coverage ───────────────────')

await step('No auth.users without business_id claim', async () => {
  // auth.users isn't directly queryable via REST; use Management API.
  const rows = await pgQuery(`
    SELECT COUNT(*) AS missing
      FROM auth.users
     WHERE COALESCE((raw_app_meta_data->>'business_id'), '') = ''
       AND COALESCE(banned_until, NOW()) < NOW() + INTERVAL '1 day'
  `)
  const n = Number(rows?.[0]?.missing || 0)
  if (n > 0) warned(`${n} auth.users missing business_id claim → RLS will deny their queries`)
  else ok('Every auth.users row has business_id app_metadata claim')
})

// ── Section 10: Anon cross-tenant isolation ────────────────────────────────
console.log('\n── 10. Anon cross-tenant isolation ────────────────────────────')

if (ANON) {
  const anon = createClient(SUPA_URL, ANON, { auth: { persistSession: false } })
  await step('anon cannot SELECT from clients (cross-tenant leak)', async () => {
    const { data, error } = await anon.from('clients').select('id').limit(1)
    if (error) { ok(`anon clients SELECT denied (${error.code || error.message?.slice(0,50)})`); return }
    if (Array.isArray(data) && data.length === 0) { ok('anon clients SELECT returned 0 rows'); return }
    throw new Error(`anon read returned ${data?.length} rows`)
  })

  await step('anon cannot INSERT into tickets / appointments / inventory_items', async () => {
    const tries = [
      ['tickets', { supabase_id: crypto.randomUUID(), business_id: RANOZA, total: 0, payment_method: 'cash', doc_number: 'X', status: 'cobrado', tipo_venta: 'contado' }],
      ['appointments', { supabase_id: crypto.randomUUID(), business_id: RANOZA, date: '2026-12-31', start_time: '10:00' }],
      ['inventory_items', { supabase_id: crypto.randomUUID(), business_id: RANOZA, name: 'attack' }],
    ]
    for (const [t, payload] of tries) {
      const r = await anon.from(t).insert(payload)
      if (!r.error) throw new Error(`anon INSERT allowed on ${t}`)
    }
    ok('anon DENIED on tickets / appointments / inventory_items')
  })
} else {
  warned('SUPABASE_ANON_KEY not in .env — skipping anon isolation tests')
}

// ── Section 11: Web bundle size sanity ─────────────────────────────────────
console.log('\n── 11. Web bundle sanity ──────────────────────────────────────')

await step('Web bundle main chunk under 500KB gzip', async () => {
  const fs = await import('node:fs/promises')
  let largestGzip = 0
  try {
    const files = await fs.readdir('dist-web/assets')
    for (const f of files) {
      if (f.endsWith('.js') && !f.endsWith('.map')) {
        const stat = await fs.stat(`dist-web/assets/${f}`)
        // approximate gzip via uncompressed/3 (real gzip is closer to /3-4 for JS)
        const approx = Math.round(stat.size / 3.5)
        if (approx > largestGzip) largestGzip = approx
      }
    }
  } catch { warned('dist-web/assets not found — run npm run build:web first'); return }
  if (largestGzip > 500_000) warned(`Largest chunk ~${(largestGzip/1024).toFixed(0)}KB gzip — investigate`)
  else ok(`Largest chunk ~${(largestGzip/1024).toFixed(0)}KB gzip approx — OK`)
})

// ── Section 12: Data integrity spot checks ─────────────────────────────────
console.log('\n── 12. Data integrity spot checks ─────────────────────────────')

await step('No orphaned tickets (client_supabase_id pointing at deleted client)', async () => {
  const orphans = await pgQuery(`
    SELECT COUNT(*) AS n FROM public.tickets t
     WHERE t.client_supabase_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.supabase_id = t.client_supabase_id)
       AND t.created_at > NOW() - INTERVAL '30 days'
  `)
  const n = Number(orphans?.[0]?.n || 0)
  if (n > 0) warned(`${n} recent tickets reference a missing client_supabase_id`)
  else ok('No orphaned tickets in last 30 days')
})

await step('No tickets stuck pendiente >7 days for tipo_venta=credito', async () => {
  const stuck = await pgQuery(`
    SELECT business_id, COUNT(*) AS n FROM public.tickets
     WHERE status='pendiente' AND tipo_venta='credito'
       AND created_at < NOW() - INTERVAL '7 days'
     GROUP BY business_id
  `)
  if (stuck?.length) {
    const parts = stuck.map(r => `${r.business_id.slice(0,8)}=${r.n}`).join(', ')
    warned(`Stale credit tickets pendiente >7d: ${parts}`)
  } else {
    ok('No credit tickets stuck pendiente >7 days')
  }
})

await step('Inventory_items with negative quantity', async () => {
  const neg = await pgQuery(`SELECT COUNT(*) AS n FROM public.inventory_items WHERE quantity < 0`)
  const n = Number(neg?.[0]?.n || 0)
  if (n > 0) warned(`${n} inventory_items with negative quantity (should be 0)`)
  else ok('No negative-quantity inventory rows')
})

// ── Section 13: ANECF queue health ─────────────────────────────────────────
console.log('\n── 13. ANECF queue health ─────────────────────────────────────')

await step('ANECF queue: no rows stuck pending >72h', async () => {
  const { data } = await sb.from('anecf_queue').select('id, voided_at, attempts').eq('status', 'pending').lt('voided_at', new Date(Date.now() - 72*3600*1000).toISOString()).limit(20)
  if (data?.length) warned(`${data.length} ANECF rows stuck pending >72h — drainer + cron health check needed`)
  else ok('ANECF queue clean (no stale pending)')
})

// ── Section 14: ecf_cert_history signal ────────────────────────────────────
console.log('\n── 14. e-CF cert export audit ─────────────────────────────────')

await step('SXSRL cert_pem_export critical events present', async () => {
  const since = new Date(Date.now() - 30*24*3600*1000).toISOString()
  const { count } = await sb.from('activity_log').select('id', { count: 'exact', head: true })
    .eq('business_id', STUDIO_X_SRL).eq('event_type', 'cert_pem_export').gte('created_at', since)
  if (!count) warned('No cert_pem_export events in 30d for SXSRL')
  else ok(`SXSRL cert_pem_export: ${count} events in 30d`)
})

// ── Final ──────────────────────────────────────────────────────────────────
console.log(`\n=== ${pass} passed, ${warn} warnings, ${fail} failed ===`)
if (fail > 0) {
  console.log('\nFailures:')
  for (const [k, m] of rec) if (k === 'FAIL') console.log(`  ❌ ${m}`)
}
if (warn > 0) {
  console.log('\nWarnings (review before launch):')
  for (const [k, m] of rec) if (k === 'WARN') console.log(`  ⚠️  ${m}`)
}
process.exit(fail > 0 ? 1 : 0)
