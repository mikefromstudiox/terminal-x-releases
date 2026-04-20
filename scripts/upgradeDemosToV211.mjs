/**
 * upgradeDemosToV211.mjs — Upgrade existing Terminal X demo businesses with
 * v2.11.0 feature data so live walkthroughs on terminalxpos.com show every
 * new capability populated and working.
 *
 * Operates on existing demo businesses (matched by name prefix "Demo ").
 * Explicitly excludes Ranoza (business_id 4f789f41-76d2-4402-838f-5fe20a91641f).
 *
 * What it seeds (idempotent per section):
 *  1. Manager Authorization Cards — 20-char tokens for every owner/manager
 *     staff row. Plain tokens saved locally to demo-cards.txt (gitignored).
 *  2. Pedidos Ya prices — 30-40% of inventory_items per retail/tienda/hybrid
 *     demo with a 12-18% markup.
 *  3. Per-client pricing — creates 2-3 "Mayorista {vertical} {n}" clients per
 *     demo, sets client_item_prices on 5 random items per mayorista at ~15%
 *     discount, and grants a loyalty starter balance via loyalty_award.
 *  4. Loyalty — enables loyalty_enabled in app_settings; backfills earn rows
 *     for 10 existing tickets per demo with a client.
 *  5. Conteo Fisico — one completed count per retail/tienda/licoreria/hybrid/
 *     mechanic/restaurante demo, ~15 items, 3 with variance.
 *  6. Daily digest — enables daily_digest_enabled in app_settings.
 *  7. Activity log — 2-3 synthetic manager_override events per demo.
 *
 * Usage: node scripts/upgradeDemosToV211.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import crypto from 'crypto'

// ── Load .env ───────────────────────────────────────────────────────────────
const envPath = resolve(import.meta.dirname, '..', '.env')
try {
  const envContent = readFileSync(envPath, 'utf8')
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
} catch {}

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}
const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

// ── Guard: never touch the real client ──────────────────────────────────────
const RANOZA_ID = '4f789f41-76d2-4402-838f-5fe20a91641f'

// ── Helpers ────────────────────────────────────────────────────────────────
const uuid = () => crypto.randomUUID()
const pick = (a) => a[Math.floor(Math.random() * a.length)]
const rand = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo
const money = (n) => Math.round(n * 100) / 100
const daysAgo = (d) => {
  const dt = new Date()
  dt.setDate(dt.getDate() - d)
  dt.setHours(rand(8, 20), rand(0, 59), rand(0, 59), 0)
  return dt.toISOString()
}
const phone = () => `809${rand(2, 9)}${String(rand(0, 9999999)).padStart(7, '0')}`

// 20-char alphabet matching packages/services/managerAuthToken.js
const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const TOKEN_LENGTH   = 20
function generateMgrToken() {
  const buf = crypto.randomBytes(TOKEN_LENGTH)
  let out = ''
  for (let i = 0; i < TOKEN_LENGTH; i++) out += TOKEN_ALPHABET[buf[i] % TOKEN_ALPHABET.length]
  return out
}
function hashMgrToken(token) {
  const raw = String(token || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex')
}
function formatMgrToken(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return s.match(/.{1,4}/g)?.join('-') || s
}

// Which verticals get inventory-driven features (PY prices, conteo, per-client)
const RETAIL_TYPES = new Set(['tienda', 'hibrido', 'mecanica', 'restaurante', 'licoreria'])

// Map business name → short vertical label for "Mayorista {label} {n}"
function verticalLabel(biz) {
  const t = biz.settings?.business_type || biz.settings?.biz_business_type || 'general'
  const map = {
    carwash: 'Carwash', tienda: 'Retail', restaurante: 'Restaurante',
    salon: 'Salon', hibrido: 'Hibrido', mecanica: 'Mecanica',
    servicios: 'Servicios', prestamos: 'Prestamos', concesionario: 'Dealer',
    licoreria: 'Licoreria',
  }
  return map[t] || t
}

// ── SECTION 1: Manager Authorization Cards ──────────────────────────────────
async function seedManagerCards(biz, cardBook) {
  const counts = { issued: 0, skipped: 0 }
  const { data: staff = [] } = await sb.from('staff')
    .select('id, supabase_id, name, username, role, manager_auth_hash, active')
    .eq('business_id', biz.id)
    .in('role', ['owner', 'manager'])
  for (const s of staff) {
    if (s.manager_auth_hash) { counts.skipped++; continue }
    if (!s.active) { counts.skipped++; continue }
    const token = generateMgrToken()
    const hash = hashMgrToken(token)
    const now = new Date().toISOString()
    const { error } = await sb.from('staff')
      .update({ manager_auth_hash: hash, manager_auth_rotated_at: now, updated_at: now })
      .eq('id', s.id)
    if (error) { console.log(`    [warn] mgr card ${s.username}: ${error.message}`); continue }
    counts.issued++
    cardBook.push({
      business: biz.name, email: biz.email, username: s.username, name: s.name,
      role: s.role, token, formatted: formatMgrToken(token),
    })
  }
  return counts
}

// ── SECTION 2: Pedidos Ya prices ────────────────────────────────────────────
async function seedPedidosYaPrices(biz) {
  const counts = { updated: 0, skipped: 0 }
  const type = biz.settings?.business_type || biz.settings?.biz_business_type
  if (!RETAIL_TYPES.has(type)) return counts
  const { data: items = [] } = await sb.from('inventory_items')
    .select('id, price, price_pedidos_ya')
    .eq('business_id', biz.id)
    .eq('active', true)
  const eligible = items.filter(i => i.price_pedidos_ya == null && Number(i.price) > 0)
  if (!eligible.length) return counts
  // target 30-40% of items
  const targetPct = rand(30, 40) / 100
  const target = Math.max(1, Math.round(items.length * targetPct))
  const shuffled = [...eligible].sort(() => Math.random() - 0.5).slice(0, target)
  for (const it of shuffled) {
    const markup = 1 + (rand(12, 18) / 100)
    const py = money(Number(it.price) * markup)
    const { error } = await sb.from('inventory_items')
      .update({ price_pedidos_ya: py })
      .eq('id', it.id)
    if (error) { console.log(`    [warn] py price ${it.id}: ${error.message}`); continue }
    counts.updated++
  }
  counts.skipped = items.length - counts.updated
  return counts
}

// ── SECTION 3: Mayorista clients + client_item_prices + loyalty seed ───────
async function seedMayoristaClients(biz) {
  const counts = { clients: 0, prices: 0, loyaltyAwarded: 0 }
  const type = biz.settings?.business_type || biz.settings?.biz_business_type
  if (!RETAIL_TYPES.has(type)) return counts
  const label = verticalLabel(biz)

  // Fetch items once
  const { data: items = [] } = await sb.from('inventory_items')
    .select('id, supabase_id, price, name')
    .eq('business_id', biz.id)
    .eq('active', true)
  if (items.length < 3) return counts

  const nMayoristas = rand(2, 3)
  for (let i = 1; i <= nMayoristas; i++) {
    const mayoristaName = `Mayorista ${label} ${i}`
    // idempotent: skip if already exists
    const { data: existing } = await sb.from('clients')
      .select('id, supabase_id').eq('business_id', biz.id).eq('name', mayoristaName).limit(1)
    let client
    if (existing?.length) {
      client = existing[0]
    } else {
      const clientSid = uuid()
      const { data: row, error } = await sb.from('clients').insert({
        business_id: biz.id,
        supabase_id: clientSid,
        name: mayoristaName,
        rnc: `${rand(100, 499)}${String(rand(1000000, 9999999)).padStart(7, '0')}${rand(1, 9)}`,
        phone: phone(),
        email: '',
        credit_limit: 50000,
        balance: 0,
        visits: 0,
        total_spent: 0,
        loyalty_points: 0,
        active: true,
      }).select('id, supabase_id').single()
      if (error) { console.log(`    [warn] mayorista ${mayoristaName}: ${error.message}`); continue }
      client = row
      counts.clients++
    }

    // Up to 5 random items — 15% discount custom price
    const picks = [...items].sort(() => Math.random() - 0.5).slice(0, Math.min(5, items.length))
    const priceRows = []
    for (const it of picks) {
      const { data: existPrice } = await sb.from('client_item_prices')
        .select('id')
        .eq('client_supabase_id', client.supabase_id)
        .eq('inventory_item_supabase_id', it.supabase_id)
        .limit(1)
      if (existPrice?.length) continue
      const custom = money(Number(it.price) * 0.85)
      priceRows.push({
        supabase_id: uuid(),
        business_id: biz.id,
        client_supabase_id: client.supabase_id,
        inventory_item_supabase_id: it.supabase_id,
        custom_price: custom,
        notes: 'Precio mayorista -15%',
      })
    }
    if (priceRows.length) {
      const { error } = await sb.from('client_item_prices').insert(priceRows)
      if (error) console.log(`    [warn] client_item_prices: ${error.message}`)
      else counts.prices += priceRows.length
    }

    // Loyalty starter balance via RPC (idempotent via loyalty_tx ticket-null ledger)
    // Only award once per mayorista: skip if an 'adjust' row already exists for this client.
    const { data: hasAdjust } = await sb.from('loyalty_transactions')
      .select('id')
      .eq('business_id', biz.id)
      .eq('client_supabase_id', client.supabase_id)
      .eq('event_type', 'adjust')
      .limit(1)
    if (!hasAdjust?.length) {
      const starter = rand(2500, 7500)
      const { error } = await sb.rpc('loyalty_adjust', {
        p_business_id: biz.id,
        p_client_supabase_id: client.supabase_id,
        p_delta: starter,
        p_notes: 'Saldo inicial mayorista demo',
      })
      if (error) console.log(`    [warn] loyalty_adjust: ${error.message}`)
      else counts.loyaltyAwarded++
    }
  }
  return counts
}

// ── SECTION 4: Loyalty — enable + backfill ledger ──────────────────────────
async function seedLoyalty(biz) {
  const counts = { awarded: 0, skipped: 0 }

  // Enable loyalty_enabled in app_settings (idempotent via (business_id, key) UNIQUE)
  await ensureAppSetting(biz.id, 'loyalty_enabled', '1')
  await ensureAppSetting(biz.id, 'loyalty_points_ratio', '100')
  await ensureAppSetting(biz.id, 'loyalty_redemption_ratio', '100')

  // Backfill earn rows for last 10 cobrado tickets that have a client.
  const { data: tickets = [] } = await sb.from('tickets')
    .select('supabase_id, total, client_supabase_id, paid_at, created_at')
    .eq('business_id', biz.id)
    .eq('status', 'cobrado')
    .not('client_supabase_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(30)

  const chosen = tickets.slice(0, 10)
  for (const tk of chosen) {
    const points = Math.max(1, Math.round(Number(tk.total || 0) / 100))
    // Idempotency: the DB has a partial unique on (business_id, ticket_supabase_id)
    // WHERE event_type='earn', so a duplicate award() returns the bumped points
    // but the ledger stays single.  We still pre-check to avoid double-bumping
    // clients.loyalty_points.
    const { data: already } = await sb.from('loyalty_transactions')
      .select('id')
      .eq('business_id', biz.id)
      .eq('ticket_supabase_id', tk.supabase_id)
      .eq('event_type', 'earn')
      .limit(1)
    if (already?.length) { counts.skipped++; continue }
    const { error } = await sb.rpc('loyalty_award', {
      p_business_id: biz.id,
      p_client_supabase_id: tk.client_supabase_id,
      p_ticket_supabase_id: tk.supabase_id,
      p_points: points,
      p_notes: 'Acumulacion demo backfill',
    })
    if (error) { console.log(`    [warn] loyalty_award: ${error.message}`); continue }
    counts.awarded++
  }
  return counts
}

// ── SECTION 5: Conteo Fisico ────────────────────────────────────────────────
async function seedConteoFisico(biz) {
  const counts = { inserted: 0 }
  const type = biz.settings?.business_type || biz.settings?.biz_business_type
  const ALLOWED = new Set(['tienda', 'hibrido', 'mecanica', 'restaurante', 'licoreria'])
  if (!ALLOWED.has(type)) return counts

  // Idempotency: skip if there's already a completado count for this biz
  const { data: existing } = await sb.from('inventory_counts')
    .select('id').eq('business_id', biz.id).eq('status', 'completado').limit(1)
  if (existing?.length) return counts

  // Pick a manager name
  const { data: managers = [] } = await sb.from('staff')
    .select('name').eq('business_id', biz.id).in('role', ['owner', 'manager']).limit(5)
  const counterName = managers.length ? pick(managers).name : 'Mike Owner'

  const { data: items = [] } = await sb.from('inventory_items')
    .select('id, supabase_id, sku, name, category, quantity, cost, price')
    .eq('business_id', biz.id)
    .eq('active', true)
    .limit(20)
  if (items.length < 3) return counts

  const picks = [...items].sort(() => Math.random() - 0.5).slice(0, Math.min(15, items.length))
  const startedAt = daysAgo(5)
  const completedAt = new Date(new Date(startedAt).getTime() + 45 * 60 * 1000).toISOString()
  const countSid = uuid()

  // Build item rows
  const itemRows = []
  let totalExpected = 0, totalCounted = 0, totalVariance = 0
  picks.forEach((it, idx) => {
    const expected = Number(it.quantity || 0)
    // 3 of ~15 have variance
    const hasVar = idx < 3
    const delta = hasVar ? pick([-3, -2, -1, 2, 3]) : 0
    const counted = Math.max(0, expected + delta)
    const cost = Number(it.cost || 0)
    const price = Number(it.price || 0)
    totalExpected += expected * cost
    totalCounted += counted * cost
    totalVariance += (counted - expected) * cost
    itemRows.push({
      supabase_id: uuid(),
      business_id: biz.id,
      count_supabase_id: countSid,
      inventory_item_supabase_id: it.supabase_id,
      sku: it.sku,
      name: it.name,
      category: it.category || 'General',
      expected_qty: expected,
      counted_qty: counted,
      unit_cost: cost,
      unit_price: price,
      notes: hasVar ? 'Diferencia detectada' : null,
    })
  })

  // Insert header
  const { error: hdrErr } = await sb.from('inventory_counts').insert({
    supabase_id: countSid,
    business_id: biz.id,
    title: 'Conteo Semanal',
    started_at: startedAt,
    completed_at: completedAt,
    counted_by_name: counterName,
    status: 'completado',
    notes: 'Conteo rutinario de stock',
    total_expected_value: money(totalExpected),
    total_counted_value: money(totalCounted),
    total_variance_value: money(totalVariance),
    created_at: startedAt,
    updated_at: completedAt,
  })
  if (hdrErr) { console.log(`    [warn] inventory_counts: ${hdrErr.message}`); return counts }

  // Insert items (NEVER write variance_* — they are GENERATED STORED in Supabase)
  const { error: itErr } = await sb.from('inventory_count_items').insert(itemRows)
  if (itErr) { console.log(`    [warn] inventory_count_items: ${itErr.message}`); return counts }

  counts.inserted = 1 + itemRows.length
  return counts
}

// ── SECTION 6: Daily digest toggle ──────────────────────────────────────────
async function seedDailyDigest(biz) {
  await ensureAppSetting(biz.id, 'daily_digest_enabled', '1')
  return { enabled: true }
}

// ── SECTION 7: manager_override activity events ────────────────────────────
async function seedManagerOverrides(biz) {
  const counts = { inserted: 0 }
  // Skip if we already seeded manager_override events for this biz
  const { data: existing } = await sb.from('activity_log')
    .select('id').eq('business_id', biz.id).eq('event_type', 'manager_override').limit(1)
  if (existing?.length) return counts

  // Actor = a manager/owner
  const { data: mgrs = [] } = await sb.from('staff')
    .select('supabase_id, name, role').eq('business_id', biz.id).in('role', ['owner', 'manager'])
  const actor = mgrs[0] || { supabase_id: null, name: 'Mike Owner', role: 'owner' }

  const scenarios = [
    { severity: 'info', target_type: 'ticket', target_name: 'Descuento RD$850',   reason: 'Cliente frecuente — descuento aprobado',         amount: 850 },
    { severity: 'warn', target_type: 'ticket', target_name: 'Anulacion T-1042',   reason: 'Anulacion aprobada por error de captura',         amount: 1250 },
    { severity: 'info', target_type: 'ticket', target_name: 'Descuento RD$400',   reason: 'Promocion de apertura — autorizado por gerente', amount: 400 },
  ]
  const n = rand(2, 3)
  const rows = []
  for (let i = 0; i < n; i++) {
    const s = scenarios[i % scenarios.length]
    const created = daysAgo(rand(0, 6))
    rows.push({
      business_id: biz.id,
      supabase_id: uuid(),
      event_type: 'manager_override',
      severity: s.severity,
      target_type: s.target_type,
      target_id: uuid(),
      target_name: s.target_name,
      amount: s.amount,
      old_value: null,
      new_value: null,
      reason: s.reason,
      metadata: { source: 'demo_seed' },
      actor_supabase_id: actor.supabase_id,
      actor_name: actor.name,
      actor_role: actor.role || 'manager',
      created_at: created,
      updated_at: created,
    })
  }
  const { error } = await sb.from('activity_log').insert(rows)
  if (error) { console.log(`    [warn] activity_log manager_override: ${error.message}`); return counts }
  counts.inserted = rows.length
  return counts
}

// ── app_settings helper (upsert on (business_id, key)) ─────────────────────
async function ensureAppSetting(businessId, key, value) {
  // Try insert; on conflict update value.  The natural unique is (business_id, key).
  const { error: insErr } = await sb.from('app_settings')
    .upsert({ business_id: businessId, key, value, updated_at: new Date().toISOString() },
            { onConflict: 'business_id,key' })
  if (insErr) console.log(`    [warn] app_settings ${key}: ${insErr.message}`)
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n[ dataLEAKS ] Upgrade demos → v2.11.0\n')

  // Pull every business whose name starts with "Demo "
  const { data: demos = [], error: listErr } = await sb.from('businesses')
    .select('id, name, email, settings, plan')
    .ilike('name', 'Demo %')
    .order('name')
  if (listErr) { console.error('FATAL listing businesses:', listErr.message); process.exit(1) }

  const targets = demos.filter(b => b.id !== RANOZA_ID)
  console.log(`Found ${targets.length} demo businesses (excluding Ranoza).\n`)

  const cardBook = [] // plain tokens for demo-cards.txt
  const summary = []

  for (const biz of targets) {
    const type = biz.settings?.business_type || biz.settings?.biz_business_type || '?'
    console.log(`→ ${biz.name}  [${type}]`)

    const row = { biz: biz.name, type, id: biz.id }
    try {
      row.cards       = await seedManagerCards(biz, cardBook)
      row.pedidosYa   = await seedPedidosYaPrices(biz)
      row.mayoristas  = await seedMayoristaClients(biz)
      row.loyalty     = await seedLoyalty(biz)
      row.conteo      = await seedConteoFisico(biz)
      row.digest      = await seedDailyDigest(biz)
      row.overrides   = await seedManagerOverrides(biz)
      console.log(`    cards=${row.cards.issued}(+${row.cards.skipped}skip)  py=${row.pedidosYa.updated}  mayoristas=${row.mayoristas.clients}/prices=${row.mayoristas.prices}/loy=${row.mayoristas.loyaltyAwarded}  loyTx=${row.loyalty.awarded}  conteo=${row.conteo.inserted}  overrides=${row.overrides.inserted}`)
    } catch (err) {
      console.log(`    [FAIL] ${err.message}`)
      row.error = err.message
    }
    summary.push(row)
  }

  // ── Write demo-cards.txt ──────────────────────────────────────────────────
  const cardsPath = resolve(import.meta.dirname, '..', 'demo-cards.txt')
  if (cardBook.length) {
    const lines = []
    lines.push('Terminal X — Manager Authorization Cards (DEMO)')
    lines.push(`Generated: ${new Date().toISOString()}`)
    lines.push('NEVER commit this file. Print and distribute physically.')
    lines.push(''.padEnd(96, '='))
    // group by business
    const byBiz = {}
    for (const c of cardBook) {
      byBiz[c.business] = byBiz[c.business] || []
      byBiz[c.business].push(c)
    }
    for (const [bizName, cards] of Object.entries(byBiz)) {
      lines.push('')
      lines.push(`## ${bizName}`)
      lines.push(`   login: ${cards[0].email}  |  password: Demo2026!  |  PIN: 1234`)
      lines.push('')
      for (const c of cards) {
        lines.push(`   ${c.role.toUpperCase().padEnd(8)}  ${c.name.padEnd(24)}  @${c.username.padEnd(14)}  ${c.formatted}`)
        lines.push(`     raw: ${c.token}`)
      }
    }
    lines.push('')
    lines.push(''.padEnd(96, '='))
    writeFileSync(cardsPath, lines.join('\n'), 'utf8')
    console.log(`\n[ok] Wrote ${cardBook.length} manager tokens → ${cardsPath}`)
  } else {
    console.log('\n[info] No new manager cards issued (all already had a hash).')
  }

  // ── Verification pass — count rows per demo ────────────────────────────────
  console.log('\n' + ''.padEnd(96, '='))
  console.log('POST-RUN VERIFICATION')
  console.log(''.padEnd(96, '='))
  for (const s of summary) {
    if (!s.id || s.error) continue
    const [cards, py, loyTx, conteos, overrides, cip] = await Promise.all([
      sb.from('staff').select('id', { count: 'exact', head: true }).eq('business_id', s.id).not('manager_auth_hash', 'is', null),
      sb.from('inventory_items').select('id', { count: 'exact', head: true }).eq('business_id', s.id).not('price_pedidos_ya', 'is', null),
      sb.from('loyalty_transactions').select('id', { count: 'exact', head: true }).eq('business_id', s.id),
      sb.from('inventory_counts').select('id', { count: 'exact', head: true }).eq('business_id', s.id),
      sb.from('activity_log').select('id', { count: 'exact', head: true }).eq('business_id', s.id).eq('event_type', 'manager_override'),
      sb.from('client_item_prices').select('id', { count: 'exact', head: true }).eq('business_id', s.id),
    ])
    console.log(`${s.biz.padEnd(30)} | cards=${cards.count||0}  py=${py.count||0}  loyTx=${loyTx.count||0}  conteos=${conteos.count||0}  mgrOverride=${overrides.count||0}  cip=${cip.count||0}`)
  }
  console.log(''.padEnd(96, '='))
  console.log(`\nDone. ${summary.filter(s => !s.error).length}/${summary.length} demos upgraded.\n`)
}

main().catch(err => { console.error('FATAL:', err); process.exit(1) })
