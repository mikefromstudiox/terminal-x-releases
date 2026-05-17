#!/usr/bin/env node
// Wipe test sales history for a business while preserving the operational
// catalog. KEEPS: services, inventory_items + current stock, clients, empleados,
// staff, app_settings, licenses, categories. WIPES: tickets, ticket_items,
// caja_chica, credit_payments, all commission tables, payroll_runs,
// inventory_transactions, journal_entries, and resets ncf_sequences to 0.
//
// Use ONLY when a client is in test mode and explicitly approves wiping their
// sales history. Reports counts first, then deletes in FK-safe order.
//
// Usage:
//   node scripts/wipe-test-data.mjs --business-id=<UUID> --dry-run
//   node scripts/wipe-test-data.mjs --business-id=<UUID> --confirm

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))

const argv = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)=?(.*)$/); return m ? [m[1], m[2] || true] : [a, true]
}))

const bid = argv['business-id']
if (!bid) { console.error('Required: --business-id=<UUID>'); process.exit(1) }
const dry = !!argv['dry-run']
const confirm = !!argv.confirm
if (!dry && !confirm) { console.error('Must pass --dry-run OR --confirm'); process.exit(1) }

const s = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data: biz } = await s.from('businesses').select('id, name, is_demo').eq('id', bid).maybeSingle()
if (!biz) { console.error('Business not found'); process.exit(1) }
console.log(`=== wipe-test-data ===`)
console.log(`business: ${biz.name} (${biz.id}) [is_demo=${biz.is_demo}]`)
console.log(`mode: ${dry ? 'DRY-RUN' : 'EXECUTE'}\n`)

// FK-safe delete order. Child tables before parents.
const WIPE_TABLES = [
  'journal_entries',
  'credit_payments',
  'washer_commissions',
  'seller_commissions',
  'cajero_commissions',
  'mechanic_commissions',
  'payroll_runs',
  'ticket_items',
  'tickets',
  'inventory_transactions',
  'caja_chica',
  'cuadre',
  'notas',
  'queue',
  'queue_deletions',
]

console.log('── COUNT (current state) ──')
const counts = {}
for (const t of WIPE_TABLES) {
  try {
    const { count } = await s.from(t).select('id', { count: 'exact', head: true }).eq('business_id', bid)
    counts[t] = count || 0
    console.log(`  ${t.padEnd(28)}: ${counts[t]}`)
  } catch (e) {
    counts[t] = -1
    console.log(`  ${t.padEnd(28)}: (table missing or error)`)
  }
}

console.log('\n── PRESERVED (will NOT touch) ──')
for (const t of ['services', 'inventory_items', 'clients', 'staff', 'empleados', 'app_settings', 'licenses']) {
  try {
    const { count } = await s.from(t).select('id', { count: 'exact', head: true }).eq('business_id', bid)
    console.log(`  ${t.padEnd(28)}: ${count || 0}  (kept)`)
  } catch {}
}

if (dry) {
  console.log('\n[DRY-RUN] no writes performed. Run with --confirm to execute.')
  process.exit(0)
}

console.log('\n── DELETING ──')
let totalDeleted = 0
const errors = []
for (const t of WIPE_TABLES) {
  if (counts[t] === 0 || counts[t] === -1) {
    console.log(`  ${t.padEnd(28)}: skip (${counts[t] === -1 ? 'table missing' : 'empty'})`)
    continue
  }
  try {
    const { error } = await s.from(t).delete().eq('business_id', bid)
    if (error) {
      console.log(`  ${t.padEnd(28)}: ERROR — ${error.message}`)
      errors.push({ table: t, error: error.message })
    } else {
      console.log(`  ${t.padEnd(28)}: deleted ${counts[t]} rows`)
      totalDeleted += counts[t]
    }
  } catch (e) {
    console.log(`  ${t.padEnd(28)}: ERROR — ${e.message}`)
    errors.push({ table: t, error: e.message })
  }
}

// Reset NCF sequences to current_number=0 so she starts fresh
console.log('\n── RESET NCF sequences (current_number → 0) ──')
const { data: seqs } = await s.from('ncf_sequences').select('id, type, current_number').eq('business_id', bid)
for (const seq of (seqs || [])) {
  const { error } = await s.from('ncf_sequences').update({ current_number: 0, updated_at: new Date().toISOString() }).eq('id', seq.id)
  if (error) console.log(`  ${seq.type}: ERROR — ${error.message}`)
  else console.log(`  ${seq.type}: was ${seq.current_number} → 0`)
}

console.log(`\n=== WIPE COMPLETE ===`)
console.log(`total rows deleted: ${totalDeleted}`)
console.log(`errors: ${errors.length}`)
if (errors.length) {
  console.log('\nerror detail:')
  for (const e of errors) console.log(`  ${e.table}: ${e.error}`)
}
console.log(`=====================`)
