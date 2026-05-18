#!/usr/bin/env node
// Test Fix G — Reject imbalanced posted journal entries.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import crypto from 'crypto'
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const BIZ = '334c7e17-f344-443b-b339-46f083b8ebfb' // Demo Contabilidad
await sb.from('accounting_journal_entries').delete().eq('business_id', BIZ).eq('description', 'FIX_G_TEST')

// TEST 1: imbalanced POSTED → reject
const t1 = await sb.from('accounting_journal_entries').insert({
  supabase_id: crypto.randomUUID(), business_id: BIZ,
  fecha: '2026-05-18', description: 'FIX_G_TEST', type: 'manual',
  status: 'posted', period_year: 2026, period_month: 5,
  totals_debit: 100, totals_credit: 50,
}).select('id').single()
if (!t1.error || !/journal_entry_imbalanced/i.test(t1.error.message)) {
  console.error('✗ TEST 1 FAIL — imbalanced posted entry accepted'); process.exit(1)
}
console.log(`✓ TEST 1 PASS — imbalanced rejected: ${t1.error.message.slice(0, 70)}`)

// TEST 2: balanced posted → accept
const t2 = await sb.from('accounting_journal_entries').insert({
  supabase_id: crypto.randomUUID(), business_id: BIZ,
  fecha: '2026-05-18', description: 'FIX_G_TEST', type: 'manual',
  status: 'posted', period_year: 2026, period_month: 5,
  totals_debit: 100, totals_credit: 100,
}).select('id').single()
if (t2.error) { console.error('✗ TEST 2 FAIL — balanced rejected:', t2.error.message); process.exit(1) }
console.log('✓ TEST 2 PASS — balanced posted entry accepted')

// TEST 3: imbalanced DRAFT → accept (draft allowed)
const t3 = await sb.from('accounting_journal_entries').insert({
  supabase_id: crypto.randomUUID(), business_id: BIZ,
  fecha: '2026-05-18', description: 'FIX_G_TEST', type: 'manual',
  status: 'draft', period_year: 2026, period_month: 5,
  totals_debit: 100, totals_credit: 25,
}).select('id').single()
if (t3.error) { console.error('✗ TEST 3 FAIL — draft imbalance blocked:', t3.error.message); process.exit(1) }
console.log('✓ TEST 3 PASS — draft imbalance allowed (work in progress)')

// TEST 4: tolerance 0.005
const t4 = await sb.from('accounting_journal_entries').insert({
  supabase_id: crypto.randomUUID(), business_id: BIZ,
  fecha: '2026-05-18', description: 'FIX_G_TEST', type: 'manual',
  status: 'posted', period_year: 2026, period_month: 5,
  totals_debit: 100.003, totals_credit: 100.000,
}).select('id').single()
if (t4.error) { console.error('✗ TEST 4 FAIL — rounding-tolerance rejected:', t4.error.message); process.exit(1) }
console.log('✓ TEST 4 PASS — 0.003 tolerance accepted (rounding noise)')

// Cleanup
await sb.from('accounting_journal_entries').delete().eq('business_id', BIZ).eq('description', 'FIX_G_TEST')
console.log('\n✅ Fix G — PASS')
