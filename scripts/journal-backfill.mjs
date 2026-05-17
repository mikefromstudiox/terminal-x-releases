#!/usr/bin/env node
/**
 * journal-backfill.mjs — Phase 4 historical replay of operational rows into
 * journal_entries. Service-role (RLS bypass). Idempotent: per (business_id,
 * source_table, source_id) we skip if any non-reversal row already exists.
 *
 * CLI
 *   node scripts/journal-backfill.mjs                       # all biz, real table, 12mo
 *   node scripts/journal-backfill.mjs --dry-run             # log only
 *   node scripts/journal-backfill.mjs --staging             # → journal_entries_backfill_staging
 *   node scripts/journal-backfill.mjs --business-id=<UUID>
 *   node scripts/journal-backfill.mjs --months=6
 *   node scripts/journal-backfill.mjs --resume              # honour progress.json
 *   node scripts/journal-backfill.mjs --reset-progress      # wipe progress.json
 *
 * Rules
 *   - Append-only. Never updates / deletes journal_entries.
 *   - Skips biz with app_settings.journal_entries_v1='true' UNLESS no journal rows yet.
 *   - ABORTS biz when is_demo=false AND journal_entries.source_table='tickets' rows
 *     already exist (risk of double-posting forward writes).
 *   - Verifies per month: |Σrevenue.* − Σ(tickets.subtotal non-void)| ≤ RD$5 etc.
 *     Failing biz halts before insert; no partial commit.
 *   - 5000-row HTTP chunks, sequential biz, 100ms inter-biz sleep.
 */

import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildSaleEntries,
  buildReversalEntries,
  buildExpenseEntries,
  buildPayrollEntries,
  buildCommissionEntries,
  buildCreditPaymentEntries,
  buildRestockEntries,
} from '../packages/services/journal.js'

// ── env / args ──────────────────────────────────────────────────────────────
const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) { console.error('FATAL: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env'); process.exit(1) }

const args = process.argv.slice(2)
const ARG = {
  dryRun: args.includes('--dry-run'),
  staging: args.includes('--staging'),
  resume: args.includes('--resume'),
  resetProgress: args.includes('--reset-progress'),
  businessId: (args.find(a => a.startsWith('--business-id=')) || '').split('=')[1] || null,
  months: Number(((args.find(a => a.startsWith('--months=')) || '--months=12').split('=')[1]) || 12),
}

const TARGET_TABLE = ARG.staging ? 'journal_entries_backfill_staging' : 'journal_entries'
const CHUNK = 500            // builder batch
const HTTP_CHUNK = 5000       // hard cap per insert request (per plan)
const SLEEP_MS = 100
const PAGE = 500

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROGRESS_FILE = path.join(__dirname, 'journal-backfill-progress.json')

const sb = createClient(URL, KEY, { auth: { persistSession: false } })

// ── utils ───────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const ymd = (d) => new Date(d).toISOString().slice(0, 10)
const monthKey = (d) => String(d || '').slice(0, 7)

function loadProgress() {
  if (!ARG.resume) return {}
  try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')) } catch { return {} }
}
function saveProgress(p) {
  try { fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2)) } catch (e) { console.warn('progress save failed:', e.message) }
}
if (ARG.resetProgress) { try { fs.unlinkSync(PROGRESS_FILE) } catch {} }

function throwOnError({ error, data }, label) {
  if (error) throw new Error(`[${label}] ${error.message || error.code || JSON.stringify(error)}`)
  return data
}

async function pagedSelect(table, applyFilters) {
  const out = []
  let from = 0
  while (true) {
    let q = sb.from(table).select('*').range(from, from + PAGE - 1).order('created_at', { ascending: true })
    q = applyFilters(q) || q
    const data = throwOnError(await q, `pagedSelect:${table}`)
    if (!data?.length) break
    out.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return out
}

// ── staging table bootstrap ─────────────────────────────────────────────────
async function ensureStagingTable() {
  if (!ARG.staging) return
  // We avoid raw SQL via REST; rely on a pre-created staging table mirroring
  // journal_entries minus FK constraints. If absent, instruct the operator.
  const probe = await sb.from(TARGET_TABLE).select('id', { count: 'exact', head: true }).limit(1)
  if (probe.error) {
    console.error('')
    console.error('  Staging table missing. Apply this SQL ONCE via Management API or psql:')
    console.error('')
    console.error('  CREATE TABLE IF NOT EXISTS journal_entries_backfill_staging (LIKE journal_entries INCLUDING DEFAULTS INCLUDING CONSTRAINTS);')
    console.error('  ALTER TABLE journal_entries_backfill_staging')
    console.error('    DROP CONSTRAINT IF EXISTS journal_entries_backfill_staging_business_id_fkey,')
    console.error('    DROP CONSTRAINT IF EXISTS journal_entries_backfill_staging_client_id_fkey,')
    console.error('    DROP CONSTRAINT IF EXISTS journal_entries_backfill_staging_employee_id_fkey,')
    console.error('    DROP CONSTRAINT IF EXISTS journal_entries_backfill_staging_reversal_of_id_fkey,')
    console.error('    DROP CONSTRAINT IF EXISTS journal_entries_backfill_staging_reversed_by_id_fkey;')
    console.error('')
    process.exit(2)
  }
}

// ── biz scope ───────────────────────────────────────────────────────────────
async function loadBusinesses() {
  if (ARG.businessId) {
    const { data } = await sb.from('businesses').select('id, name, is_demo, settings').eq('id', ARG.businessId).limit(1)
    return data || []
  }
  const { data } = await sb.from('businesses').select('id, name, is_demo, settings').order('created_at', { ascending: true })
  return data || []
}

async function getFlag(bid, key) {
  const { data } = await sb.from('app_settings').select('value').eq('business_id', bid).eq('key', key).maybeSingle()
  return data?.value || null
}

async function bizHasJournalRowsForSource(bid, source_table) {
  const { count } = await sb.from(TARGET_TABLE).select('id', { count: 'exact', head: true })
    .eq('business_id', bid).eq('source_table', source_table)
  return (count || 0) > 0
}

// ── operational reads (12-month window) ─────────────────────────────────────
function windowFrom() {
  const d = new Date()
  d.setMonth(d.getMonth() - ARG.months)
  return d.toISOString()
}

async function loadTickets(bid, since) {
  return pagedSelect('tickets', q => q.eq('business_id', bid).gte('created_at', since))
}
async function loadTicketItems(bid, ticketSids) {
  if (!ticketSids.length) return new Map()
  const map = new Map()
  // Chunk IN(...) to keep URL ≤ ~2KB
  const CH = 100
  for (let i = 0; i < ticketSids.length; i += CH) {
    const batch = ticketSids.slice(i, i + CH)
    const { data } = await sb.from('ticket_items').select('*').eq('business_id', bid).in('ticket_supabase_id', batch)
    for (const it of (data || [])) {
      const list = map.get(it.ticket_supabase_id) || []
      list.push(it); map.set(it.ticket_supabase_id, list)
    }
  }
  return map
}
async function loadServices(bid, svcSids) {
  if (!svcSids.length) return new Map()
  const map = new Map()
  const CH = 100
  const ids = [...new Set(svcSids.filter(Boolean))]
  for (let i = 0; i < ids.length; i += CH) {
    const batch = ids.slice(i, i + CH)
    const { data } = await sb.from('services')
      .select('supabase_id, is_wash, aplica_itbis, is_menu_item, category, is_product, is_service')
      .eq('business_id', bid).in('supabase_id', batch)
    for (const s of (data || [])) map.set(s.supabase_id, s)
  }
  return map
}
const loadCajaChica       = (bid, since) => pagedSelect('caja_chica',       q => q.eq('business_id', bid).gte('created_at', since))
const loadPayrollRuns     = (bid, since) => pagedSelect('payroll_runs',     q => q.eq('business_id', bid).gte('paid_at', since))
const loadCreditPayments  = (bid, since) => pagedSelect('credit_payments',  q => q.eq('business_id', bid).gte('created_at', since))

async function loadCommissionsPaid(bid, since) {
  const out = []
  for (const t of ['washer_commissions', 'seller_commissions', 'cajero_commissions', 'mechanic_commissions']) {
    try {
      const rows = await pagedSelect(t, q => q.eq('business_id', bid).eq('paid', true).gte('paid_at', since))
      for (const r of rows) out.push({ ...r, _src_table: t })
    } catch (e) {
      // Some commission tables may not be populated; ignore missing column gracefully
      console.warn(`  commission load skip ${t}: ${e.message}`)
    }
  }
  return out
}

async function loadInventoryRestocks(bid, since) {
  // type values vary across verticals; capture broad set.
  const rows = await pagedSelect('inventory_transactions', q =>
    q.eq('business_id', bid).gte('created_at', since).gt('delta', 0))
  return rows
}

async function loadInventoryItems(bid, itemSids) {
  if (!itemSids.length) return new Map()
  const out = new Map()
  const CH = 100
  const ids = [...new Set(itemSids.filter(Boolean))]
  for (let i = 0; i < ids.length; i += CH) {
    const batch = ids.slice(i, i + CH)
    const { data } = await sb.from('inventory_items')
      .select('supabase_id, name, cost').eq('business_id', bid).in('supabase_id', batch)
    for (const it of (data || [])) out.set(it.supabase_id, it)
  }
  return out
}

// ── derived row construction ────────────────────────────────────────────────
function _bizType(biz) {
  const s = biz.settings
  if (!s) return null
  if (typeof s === 'object') return s.business_type || null
  try { return JSON.parse(s || '{}').business_type || null } catch { return null }
}
function buildAllSaleRows(biz, tickets, itemsByTicket, svcMap) {
  const rows = []
  const bizArg = { id: biz.id, business_type: _bizType(biz) }
  for (const t of tickets) {
    if (t.status === 'nula') continue   // voids handled separately
    const items = itemsByTicket.get(t.supabase_id) || []
    if (!items.length) continue
    try {
      const built = buildSaleEntries({
        ticket: {
          supabase_id: t.supabase_id, business_id: biz.id,
          total: Number(t.total || 0), itbis: Number(t.itbis || 0),
          payment_method: t.tipo_venta === 'credito' ? 'credit' : (t.payment_method || 'cash'),
          tipo_venta: t.tipo_venta,
          client_id: t.client_supabase_id || null,
          created_at: t.paid_at || t.created_at,
          date: t.paid_at || t.created_at,
          created_by: t.cajero_supabase_id || null,
          location_id: t.location_id || null,
        },
        items: items.map(i => ({
          supabase_id: i.supabase_id, service_supabase_id: i.service_supabase_id,
          qty: Number(i.quantity || 1), price: Number(i.price || 0), cost: Number(i.cost || 0),
          itbis: i.itbis != null ? Number(i.itbis) : null,
          name: i.name, is_wash: !!i.is_wash,
        })),
        services: [...svcMap.values()],
        biz: bizArg,
      })
      rows.push(...built)
    } catch (e) {
      console.warn(`  sale build skip ticket=${t.supabase_id}: ${e.message}`)
    }
  }
  return rows
}

function buildVoidRows(biz, voidedTickets, itemsByTicket, svcMap) {
  // For backfill we synthesize an "original" sale row set via buildSaleEntries
  // (because we don't have prior journal_entries to mirror), then reverse it.
  // Net effect on the books: zero for voided tickets — matches operational truth.
  const rows = []
  const bizArg = { id: biz.id, business_type: _bizType(biz) }
  for (const t of voidedTickets) {
    const items = itemsByTicket.get(t.supabase_id) || []
    if (!items.length) continue
    try {
      const original = buildSaleEntries({
        ticket: {
          supabase_id: t.supabase_id, business_id: biz.id,
          total: Number(t.total || 0), itbis: Number(t.itbis || 0),
          payment_method: t.tipo_venta === 'credito' ? 'credit' : (t.payment_method || 'cash'),
          tipo_venta: t.tipo_venta,
          client_id: t.client_supabase_id || null,
          created_at: t.paid_at || t.created_at,
          date: t.paid_at || t.created_at,
          created_by: t.cajero_supabase_id || null,
          location_id: t.location_id || null,
        },
        items: items.map(i => ({
          supabase_id: i.supabase_id, service_supabase_id: i.service_supabase_id,
          qty: Number(i.quantity || 1), price: Number(i.price || 0), cost: Number(i.cost || 0),
          itbis: i.itbis != null ? Number(i.itbis) : null,
          name: i.name, is_wash: !!i.is_wash,
        })),
        services: [...svcMap.values()],
        biz: bizArg,
      })
      rows.push(...original)
      rows.push(...buildReversalEntries({ originalRows: original }))
    } catch (e) {
      console.warn(`  void build skip ticket=${t.supabase_id}: ${e.message}`)
    }
  }
  return rows
}

function buildExpenseRows(biz, rows) {
  const out = []
  for (const r of rows) {
    if (String(r.type || '').toLowerCase() !== 'gasto' && Number(r.amount) <= 0) continue
    try { out.push(...buildExpenseEntries({ row: { ...r, type: r.category || r.type }, biz })) }
    catch (e) { console.warn(`  caja_chica skip ${r.supabase_id}: ${e.message}`) }
  }
  return out
}

function buildPayrollRows(biz, rows) {
  const out = []
  for (const r of rows) {
    const total = Number(r.net || r.base || 0) + Number(r.commissions || 0) + Number(r.bonuses || 0)
    if (total <= 0) continue
    try { out.push(...buildPayrollEntries({ run: { ...r, total, date: r.paid_at, period_label: `${r.period_start}→${r.period_end}` }, biz })) }
    catch (e) { console.warn(`  payroll skip ${r.supabase_id}: ${e.message}`) }
  }
  return out
}

function buildCommissionRows(biz, rows) {
  const out = []
  for (const r of rows) {
    try {
      out.push(...buildCommissionEntries({
        payout: {
          supabase_id: r.supabase_id,
          business_id: biz.id,
          amount: Number(r.commission_amount || 0),
          employee_id: r.empleado_supabase_id || r.cajero_supabase_id || null,
          date: r.paid_at, created_at: r.paid_at || r.created_at,
        }, biz,
      }))
      // tag source_table so verification + dedupe can route by family
      for (const row of out.slice(-2)) row.source_table = r._src_table || 'commission_payouts'
    } catch (e) { console.warn(`  commission skip ${r.supabase_id}: ${e.message}`) }
  }
  return out
}

function buildCreditPaymentRows(biz, rows) {
  const out = []
  for (const r of rows) {
    try {
      out.push(...buildCreditPaymentEntries({ payment: {
        supabase_id: r.supabase_id, business_id: biz.id,
        amount: Number(r.amount || 0), client_id: r.client_supabase_id || null,
        date: r.created_at, created_at: r.created_at,
      }, biz }))
    } catch (e) { console.warn(`  credit_payment skip ${r.supabase_id}: ${e.message}`) }
  }
  return out
}

function buildRestockRows(biz, txns, itemMap) {
  const out = []
  for (const r of txns) {
    const item = itemMap.get(r.item_supabase_id)
    const unit = Number(item?.cost || 0)
    if (!item || unit <= 0) continue
    try {
      out.push(...buildRestockEntries({
        item: { supabase_id: item.supabase_id, name: item.name, business_id: biz.id },
        qty: Number(r.delta || 0), unitCostPaid: unit, paidInCash: true, biz,
      }))
      for (const row of out.slice(-2)) {
        row.source_id = r.supabase_id          // anchor to inventory_transactions row
        row.effective_date = ymd(r.created_at)
      }
    } catch (e) { console.warn(`  restock skip ${r.supabase_id}: ${e.message}`) }
  }
  return out
}

// ── idempotency: drop rows whose (business_id,source_table,source_id) already exist ──
async function filterAlreadyPosted(bid, rows) {
  if (!rows.length) return rows
  // Group source_ids by table, ask Supabase which already exist for THIS biz.
  const byTable = new Map()
  for (const r of rows) {
    if (!r.source_id) continue
    const set = byTable.get(r.source_table) || new Set()
    set.add(r.source_id); byTable.set(r.source_table, set)
  }
  const blocked = new Map()    // table → Set(source_id)
  for (const [tbl, set] of byTable.entries()) {
    const ids = [...set]
    const CH = 100
    for (let i = 0; i < ids.length; i += CH) {
      const batch = ids.slice(i, i + CH)
      const { data } = await sb.from(TARGET_TABLE).select('source_id')
        .eq('business_id', bid).eq('source_table', tbl)
        .is('reversal_of_id', null).in('source_id', batch)
      for (const x of (data || [])) {
        const s = blocked.get(tbl) || new Set(); s.add(x.source_id); blocked.set(tbl, s)
      }
    }
  }
  return rows.filter(r => {
    if (!r.source_id) return true
    const s = blocked.get(r.source_table); return !s || !s.has(r.source_id)
  })
}

// ── verification ────────────────────────────────────────────────────────────
function verifyAgainstOps(biz, derivedRows, opsContext) {
  const { tickets, ticketItems, cajaChica } = opsContext
  const TOL = 5.00

  // Build month buckets
  const months = new Map()
  const bumpDerived = (m, acc, val) => {
    const o = months.get(m) || { rev: 0, cogs: 0, exp: 0, itbis: 0 }
    o[acc] = round2((o[acc] || 0) + val); months.set(m, o)
  }
  const bumpOps = (m, key, val) => {
    const o = months.get(m) || { rev: 0, cogs: 0, exp: 0, itbis: 0 }
    o[`ops_${key}`] = round2((o[`ops_${key}`] || 0) + val); months.set(m, o)
  }

  for (const r of derivedRows) {
    const m = monthKey(r.effective_date)
    if (r.account?.startsWith('revenue.') && r.credit > 0) bumpDerived(m, 'rev', r.credit)
    if (r.account === 'cogs' && r.debit > 0)               bumpDerived(m, 'cogs', r.debit)
    if (r.account?.startsWith('expense.') && r.debit > 0)  bumpDerived(m, 'exp', r.debit)
    if (r.account === 'itbis_payable' && r.credit > 0)     bumpDerived(m, 'itbis', r.credit)
  }
  for (const t of tickets) {
    if (t.status === 'nula') continue
    const m = monthKey(t.paid_at || t.created_at)
    bumpOps(m, 'rev', Number(t.subtotal || 0))
    bumpOps(m, 'itbis', Number(t.itbis || 0))
    const items = ticketItems.get(t.supabase_id) || []
    for (const it of items) bumpOps(m, 'cogs', Number(it.cost || 0) * Number(it.quantity || 1))
  }
  for (const c of cajaChica) {
    if (String(c.type || '').toLowerCase() === 'ingreso') continue
    const m = monthKey(c.created_at)
    bumpOps(m, 'exp', Number(c.amount || 0))
  }

  const deltas = []
  for (const [m, v] of [...months.entries()].sort()) {
    const row = {
      month: m,
      rev_derived: round2(v.rev || 0), rev_ops: round2(v.ops_rev || 0), drev: round2((v.rev || 0) - (v.ops_rev || 0)),
      cogs_derived: round2(v.cogs || 0), cogs_ops: round2(v.ops_cogs || 0), dcogs: round2((v.cogs || 0) - (v.ops_cogs || 0)),
      exp_derived: round2(v.exp || 0), exp_ops: round2(v.ops_exp || 0), dexp: round2((v.exp || 0) - (v.ops_exp || 0)),
      itbis_derived: round2(v.itbis || 0), itbis_ops: round2(v.ops_itbis || 0), ditbis: round2((v.itbis || 0) - (v.ops_itbis || 0)),
    }
    deltas.push(row)
  }
  const breach = deltas.find(d => Math.abs(d.drev) > TOL || Math.abs(d.dcogs) > TOL || Math.abs(d.dexp) > TOL || Math.abs(d.ditbis) > TOL)
  return { deltas, breach }
}

// ── insert in HTTP_CHUNK batches ────────────────────────────────────────────
async function insertChunked(rows, label) {
  let inserted = 0
  for (let i = 0; i < rows.length; i += HTTP_CHUNK) {
    const chunk = rows.slice(i, i + HTTP_CHUNK)
    const { error } = await sb.from(TARGET_TABLE).insert(chunk)
    if (error) throw new Error(`[${label}] insert chunk @${i}: ${error.message}`)
    inserted += chunk.length
  }
  return inserted
}

// ── imbalance audit ─────────────────────────────────────────────────────────
async function imbalanceAudit(bid) {
  // PostgREST has no aggregate group-by; pull all rows we just inserted and tally JS-side.
  // Bounded: the rows we just wrote share a fresh tx_group_id per source row.
  const groups = new Map()
  let from = 0
  while (true) {
    const { data } = await sb.from(TARGET_TABLE)
      .select('tx_group_id, debit, credit')
      .eq('business_id', bid).range(from, from + 999)
    if (!data?.length) break
    for (const r of data) {
      const o = groups.get(r.tx_group_id) || { d: 0, c: 0 }
      o.d += Number(r.debit || 0); o.c += Number(r.credit || 0)
      groups.set(r.tx_group_id, o)
    }
    if (data.length < 1000) break
    from += 1000
  }
  let imbalanced = 0
  for (const [, v] of groups) if (Math.abs(v.d - v.c) > 0.01) imbalanced++
  return { groups: groups.size, imbalanced }
}

// ── per-business runner ─────────────────────────────────────────────────────
async function runForBusiness(biz, progress, summary) {
  const t0 = Date.now()
  const bid = biz.id
  console.log(`\n── ${biz.name} (${bid}) [demo=${biz.is_demo}] ──`)

  // Skip / abort gates
  const flag = await getFlag(bid, 'journal_entries_v1')
  const flagOn = (String(flag || '').toLowerCase() === 'true')
  const ticketsAlreadyPosted = await bizHasJournalRowsForSource(bid, 'tickets')

  if (flagOn && ticketsAlreadyPosted) {
    console.log('  SKIP — forward-posting active AND journal_entries already populated. Refusing to double-post.')
    summary.push({ biz: biz.name, status: 'skipped_flag_on', rows: 0, elapsedMs: Date.now() - t0 })
    return
  }
  if (biz.is_demo === false && ticketsAlreadyPosted) {
    console.log('  ABORT — non-demo biz with existing journal_entries.tickets rows. Manual review required.')
    summary.push({ biz: biz.name, status: 'aborted_real_with_rows', rows: 0, elapsedMs: Date.now() - t0 })
    return
  }

  const since = windowFrom()
  console.log(`  window: ${ymd(since)} → now`)

  // Read ops data
  const tickets = await loadTickets(bid, since)
  const tSids = tickets.map(t => t.supabase_id).filter(Boolean)
  const itemsByTicket = await loadTicketItems(bid, tSids)
  const svcSids = []
  for (const list of itemsByTicket.values()) for (const it of list) if (it.service_supabase_id) svcSids.push(it.service_supabase_id)
  const svcMap = await loadServices(bid, svcSids)
  const cajaChica = await loadCajaChica(bid, since)
  const payroll  = await loadPayrollRuns(bid, since)
  const commissions = await loadCommissionsPaid(bid, since)
  const creditPays  = await loadCreditPayments(bid, since)
  const restockTxns = await loadInventoryRestocks(bid, since)
  const itemMap = await loadInventoryItems(bid, restockTxns.map(r => r.item_supabase_id))

  console.log(`  reads: tickets=${tickets.length} items=${[...itemsByTicket.values()].reduce((s, l) => s + l.length, 0)} caja=${cajaChica.length} payroll=${payroll.length} comm=${commissions.length} credPay=${creditPays.length} restock=${restockTxns.length}`)

  // Build derived rows
  const live = tickets.filter(t => t.status !== 'nula')
  const voids = tickets.filter(t => t.status === 'nula')
  const built = []
  built.push(...buildAllSaleRows(biz, live, itemsByTicket, svcMap))
  built.push(...buildVoidRows(biz, voids, itemsByTicket, svcMap))
  built.push(...buildExpenseRows(biz, cajaChica))
  built.push(...buildPayrollRows(biz, payroll))
  built.push(...buildCommissionRows(biz, commissions))
  built.push(...buildCreditPaymentRows(biz, creditPays))
  built.push(...buildRestockRows(biz, restockTxns, itemMap))

  console.log(`  built: ${built.length} rows`)

  // Verification
  const v = verifyAgainstOps(biz, built, { tickets, ticketItems: itemsByTicket, cajaChica })
  console.log(`  monthly delta table (RD$):`)
  console.table(v.deltas.map(d => ({
    month: d.month,
    rev_derived: d.rev_derived, rev_ops: d.rev_ops, Δrev: d.drev,
    cogs_derived: d.cogs_derived, cogs_ops: d.cogs_ops, Δcogs: d.dcogs,
    exp_derived: d.exp_derived, exp_ops: d.exp_ops, Δexp: d.dexp,
    itbis_derived: d.itbis_derived, itbis_ops: d.itbis_ops, Δitbis: d.ditbis,
  })))
  if (v.breach) {
    console.log(`  HALT — delta breach > RD$5.00 in ${v.breach.month}. Not committing for this biz.`)
    summary.push({ biz: biz.name, status: 'halt_delta_breach', rows: 0, elapsedMs: Date.now() - t0, breach: v.breach })
    return
  }

  // Source-counts (for dry-run report)
  const bySrc = built.reduce((a, r) => (a[r.source_table] = (a[r.source_table] || 0) + 1, a), {})

  if (ARG.dryRun) {
    console.log(`  DRY-RUN — would insert ${built.length} rows by source_table:`, bySrc)
    summary.push({ biz: biz.name, status: 'dry_ok', rows: built.length, bySrc, elapsedMs: Date.now() - t0 })
    return
  }

  // Idempotency filter
  const filtered = await filterAlreadyPosted(bid, built)
  console.log(`  after idempotency filter: ${filtered.length} rows (skipped ${built.length - filtered.length})`)

  if (!filtered.length) {
    summary.push({ biz: biz.name, status: 'no_new_rows', rows: 0, elapsedMs: Date.now() - t0 })
    return
  }

  const inserted = await insertChunked(filtered, `je.backfill.${biz.name}`)
  console.log(`  INSERTED: ${inserted} rows`)
  summary.push({ biz: biz.name, status: 'inserted', rows: inserted, bySrc, elapsedMs: Date.now() - t0 })

  progress[bid] = { name: biz.name, lastRunISO: new Date().toISOString(), rows: inserted }
  saveProgress(progress)
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== journal-backfill ===')
  console.log('  target:', TARGET_TABLE, '| dryRun:', ARG.dryRun, '| staging:', ARG.staging, '| months:', ARG.months)
  await ensureStagingTable()
  const businesses = await loadBusinesses()
  console.log('  businesses:', businesses.length)

  const progress = loadProgress()
  const summary = []
  for (const biz of businesses) {
    if (ARG.resume && progress[biz.id]) {
      console.log(`-- ${biz.name} already in progress.json — skip (use --reset-progress to clear)`)
      continue
    }
    try {
      await runForBusiness(biz, progress, summary)
    } catch (e) {
      console.error(`  ERROR ${biz.name}:`, e.message)
      summary.push({ biz: biz.name, status: 'error', error: e.message })
    }
    await sleep(SLEEP_MS)
  }

  // Final imbalance audit if we actually wrote
  if (!ARG.dryRun) {
    console.log('\n── imbalance audit ──')
    for (const biz of businesses) {
      const r = await imbalanceAudit(biz.id)
      console.log(`  ${biz.name}: tx_groups=${r.groups} imbalanced=${r.imbalanced}`)
    }
  }

  console.log('\n── SUMMARY ──')
  console.table(summary.map(s => ({
    biz: s.biz, status: s.status, rows: s.rows || 0,
    sources: s.bySrc ? Object.entries(s.bySrc).map(([k, v]) => `${k}:${v}`).join(' ') : '',
    ms: s.elapsedMs || 0,
  })))
  console.log('OK')
}

main().catch(e => { console.error('FATAL', e); process.exit(99) })
