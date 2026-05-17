#!/usr/bin/env node
// demo-login-smoke.mjs — Log in to every demo account and exercise the app
// against the freshly-deployed terminalxpos.com. Records pre/post snapshots
// of client_errors so we know exactly what surfaced during this run.
//
// Usage: node scripts/demo-login-smoke.mjs

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
config({ path: join(__dirname, '..', '.env') })

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const ANON_KEY     = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

// Vertical keys here are CANONICAL English (matches packages/config/businessTypes.js
// BUSINESS_TYPE_KEYS). The smoke probes log in by email — the vertical field is
// just a label for the report column.
const DEMO_ACCOUNTS = [
  { vertical: 'carwash',      email: 'admin@carwash.demo.terminalxpos.com'      },
  { vertical: 'retail',       email: 'admin@retail.demo.terminalxpos.com'       },
  { vertical: 'restaurant',   email: 'admin@restaurant.demo.terminalxpos.com'   },
  { vertical: 'salon',        email: 'admin@salon.demo.terminalxpos.com'        },
  { vertical: 'mechanic',     email: 'admin@mechanic.demo.terminalxpos.com'     },
  { vertical: 'service',      email: 'admin@service.demo.terminalxpos.com'      },
  { vertical: 'prestamos',    email: 'admin@prestamos.demo.terminalxpos.com'    },
  { vertical: 'dealership',   email: 'admin@dealership.demo.terminalxpos.com'   },
  { vertical: 'food_truck',   email: 'foodtruck@demo.terminalxpos.com'          },
  { vertical: 'contabilidad', email: 'admin@contabilidad.demo.terminalxpos.com' },
  { vertical: 'carniceria',   email: 'admin@carniceria.demo.terminalxpos.com'   },
  { vertical: 'licoreria',    email: 'admin@licoreria.demo.terminalxpos.com'    },
]
const PASSWORD = 'Demo2026!'

const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

function isoNow() { return new Date().toISOString() }
function ms(start) { return ((Date.now() - start) / 1000).toFixed(1) + 's' }

async function snapshotErrors() {
  const { data, error } = await svc
    .from('client_errors')
    .select('id, created_at, business_id, message, route, severity, metadata')
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) { console.warn('snapshotErrors:', error.message); return null }
  return data?.[0]?.created_at || '1970-01-01T00:00:00Z'
}

async function exerciseAccount({ vertical, email }) {
  const t0 = Date.now()
  const sb = createClient(SUPABASE_URL, ANON_KEY)
  const result = { vertical, email, ok: false, steps: [], elapsed: '' }

  try {
    // 1. Auth
    const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email, password: PASSWORD })
    if (authErr) throw new Error('signIn: ' + authErr.message)
    result.steps.push('auth ok (' + auth.user.id.slice(0, 8) + ')')

    // The web POS reads business_id from JWT app_metadata. If it's missing,
    // half the app silently 0-rows.
    const claims = auth.session?.access_token
      ? JSON.parse(Buffer.from(auth.session.access_token.split('.')[1], 'base64').toString())
      : {}
    const bid = claims.app_metadata?.business_id || claims.user_metadata?.business_id
    if (!bid) throw new Error('no business_id in JWT')
    result.steps.push('bid ' + bid.slice(0, 8))

    // 2. Hit the surfaces a logged-in owner first sees on /pos:
    //    businesses (header), services (POS grid), settings (config), tickets (today).
    const probes = [
      ['businesses',    sb.from('businesses').select('id,name,settings').eq('id', bid).maybeSingle()],
      ['services',      sb.from('services').select('id').eq('business_id', bid).limit(50)],
      ['app_settings',  sb.from('app_settings').select('key,value').eq('business_id', bid).eq('is_device_local', false).limit(100)],
      ['tickets',       sb.from('tickets').select('id').eq('business_id', bid).order('created_at',{ascending:false}).limit(20)],
      ['ncf_sequences', sb.from('ncf_sequences').select('type,current_number').eq('business_id', bid)],
      ['staff',         sb.from('staff').select('id,role').eq('business_id', bid).limit(20)],
      ['activity_log',  sb.from('activity_log').select('id,event_type').eq('business_id', bid).order('created_at',{ascending:false}).limit(10)],
    ]
    for (const [name, q] of probes) {
      const { data, error } = await q
      if (error) result.steps.push(`✗ ${name}: ${error.code || ''} ${error.message}`)
      else result.steps.push(`✓ ${name} (${Array.isArray(data) ? data.length : (data ? 1 : 0)})`)
    }

    await sb.auth.signOut()
    result.ok = !result.steps.some(s => s.startsWith('✗'))
  } catch (err) {
    result.steps.push('ERR: ' + (err?.message || String(err)))
    result.ok = false
  }
  result.elapsed = ms(t0)
  return result
}

async function diffErrorsSince(sinceIso) {
  const { data, error } = await svc
    .from('client_errors')
    .select('id, created_at, business_id, message, route, severity, metadata')
    .gt('created_at', sinceIso)
    .order('created_at', { ascending: true })
    .limit(500)
  if (error) { console.warn('diff:', error.message); return [] }
  return data || []
}

;(async () => {
  console.log('\n=== demo-login-smoke @', isoNow(), '===\n')
  const baseline = await snapshotErrors()
  console.log('client_errors baseline last-id ts:', baseline, '\n')

  const results = []
  for (const a of DEMO_ACCOUNTS) {
    process.stdout.write(a.vertical.padEnd(14))
    const r = await exerciseAccount(a)
    results.push(r)
    process.stdout.write((r.ok ? ' PASS' : ' FAIL').padEnd(7) + r.elapsed + '\n')
    for (const s of r.steps) {
      if (s.startsWith('✗') || s.startsWith('ERR')) console.log('   ', s)
    }
  }

  console.log('\n=== summary ===')
  console.log(`  ${results.filter(r => r.ok).length} / ${results.length} pass`)

  // Wait briefly for any in-flight error inserts to land.
  await new Promise(r => setTimeout(r, 2000))
  const fresh = await diffErrorsSince(baseline)
  console.log(`\n=== client_errors since baseline: ${fresh.length} new ===`)
  for (const e of fresh) {
    const tag = (e.severity || 'error').padEnd(7)
    const route = (e.route || e.metadata?.category || '-').padEnd(40)
    console.log(`  ${tag} ${route} ${(e.message || '').slice(0, 120)}`)
  }
  if (fresh.length === 0) console.log('  (clean — no new errors during smoke)')

  process.exit(results.every(r => r.ok) && fresh.length === 0 ? 0 : 1)
})().catch(err => { console.error(err); process.exit(2) })
