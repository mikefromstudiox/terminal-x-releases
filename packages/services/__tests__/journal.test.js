/**
 * journal.test.js — node --test suite for journal posting helpers.
 *
 * Run:
 *   node --test packages/services/__tests__/journal.test.js
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSaleEntries,
  buildCreditPaymentEntries,
  buildExpenseEntries,
  buildRestockEntries,
  buildPayrollEntries,
  buildCommissionEntries,
  buildReversalEntries,
  _test,
} from '../journal.js'

const { round2, resolveRevenueAccount, assertBalanced } = _test

const biz = { id: 'biz-uuid-1', business_type: 'tienda' }

const ticketCash = (over = {}) => ({
  supabase_id: 'tk-1', business_id: biz.id, total: 118, subtotal: 100, itbis: 18,
  payment_method: 'cash', date: '2026-05-17', created_by_staff_id: 'staff-1', ...over,
})

const item = (over = {}) => ({
  supabase_id: 'ti-1', price: 100, qty: 1, cost: 40, itbis: 18,
  service_supabase_id: 'svc-1', ...over,
})

const svc = (over = {}) => ({
  supabase_id: 'svc-1', category: 'general', aplica_itbis: true, name: 'Item', ...over,
})

const sumD = (rows) => rows.reduce((s, r) => s + Number(r.debit || 0), 0)
const sumC = (rows) => rows.reduce((s, r) => s + Number(r.credit || 0), 0)
const byAcct = (rows, a) => rows.filter((r) => r.account === a)

// ---------------------------------------------------------------------------

test('1. cash sale single line with ITBIS — balances + correct row shape', () => {
  const rows = buildSaleEntries({
    ticket: ticketCash(),
    items: [item()],
    services: [svc()],
    biz,
  })
  assert.equal(rows.length, 5, 'expected 5 rows (revenue, cogs, inventory, itbis, cash)')
  assert.equal(round2(sumD(rows)), round2(sumC(rows)))
  assert.equal(byAcct(rows, 'cash')[0].debit, 118)
  assert.equal(byAcct(rows, 'itbis_payable')[0].credit, 18)
  assert.equal(byAcct(rows, 'revenue.tienda')[0].credit, 100)
  assert.equal(byAcct(rows, 'cogs')[0].debit, 40)
  assert.equal(byAcct(rows, 'inventory')[0].credit, 40)
})

test('2. mixed verticals 3-line ticket — correct revenue per line + balanced', () => {
  const items = [
    { supabase_id: 'a', price: 200, qty: 1, cost: 0, itbis: 30.51, is_wash: true, service_supabase_id: 'sva' },
    { supabase_id: 'b', price: 150, qty: 2, cost: 50, itbis: 45.76, service_supabase_id: 'svb' },
    { supabase_id: 'c', price: 300, qty: 1, cost: 100, itbis: 45.76, service_supabase_id: 'svc' },
  ]
  const services = [
    { supabase_id: 'sva', is_wash: true, aplica_itbis: true },
    { supabase_id: 'svb', is_menu_item: true, category: 'bebida', aplica_itbis: true },
    { supabase_id: 'svc', is_menu_item: true, category: 'comida', aplica_itbis: true },
  ]
  const total = round2(200 + 300 + 300 + 30.51 + 45.76 + 45.76)
  const rows = buildSaleEntries({
    ticket: ticketCash({ total }),
    items, services, biz,
  })
  assert.equal(byAcct(rows, 'revenue.carwash').length, 1)
  assert.equal(byAcct(rows, 'revenue.bar').length, 1)
  assert.equal(byAcct(rows, 'revenue.kitchen').length, 1)
  assert.ok(Math.abs(sumD(rows) - sumC(rows)) <= 0.01)
})

test('3. credit sale — receivable not cash, client_id propagated', () => {
  const rows = buildSaleEntries({
    ticket: ticketCash({ payment_method: 'credito', client_id: 'cli-1' }),
    items: [item()],
    services: [svc()],
    biz,
  })
  assert.equal(byAcct(rows, 'cash').length, 0)
  const r = byAcct(rows, 'receivable')
  assert.equal(r.length, 1)
  assert.equal(r[0].debit, 118)
  assert.equal(r[0].client_id, 'cli-1')
})

test('4. card sale — fee.card + cash less fee, balances', () => {
  const rows = buildSaleEntries({
    ticket: ticketCash({ total: 1180, payment_method: 'card', card_fee: 35.4 }),
    items: [{ ...item(), price: 1000, itbis: 180 }],
    services: [svc()],
    biz,
  })
  assert.equal(byAcct(rows, 'fee.card')[0].debit, 35.4)
  // cash gets total - fee, possibly +/- rounding absorb
  assert.ok(Math.abs(byAcct(rows, 'cash')[0].debit - 1144.6) <= 0.05)
  assert.ok(Math.abs(sumD(rows) - sumC(rows)) <= 0.01)
})

test('5. zero-cost items emit no COGS rows', () => {
  const rows = buildSaleEntries({
    ticket: ticketCash(),
    items: [{ ...item(), cost: 0 }],
    services: [svc()],
    biz,
  })
  assert.equal(byAcct(rows, 'cogs').length, 0)
  assert.equal(byAcct(rows, 'inventory').length, 0)
  assert.ok(Math.abs(sumD(rows) - sumC(rows)) <= 0.01)
})

test('6. ITBIS aggregated to ONE row across multi-line ticket', () => {
  const items = [
    { ...item(), supabase_id: 'a', itbis: 9 },
    { ...item(), supabase_id: 'b', itbis: 9 },
    { ...item(), supabase_id: 'c', itbis: 9 },
  ]
  const rows = buildSaleEntries({
    ticket: ticketCash({ total: 327 }),
    items, services: [svc()], biz,
  })
  const itbis = byAcct(rows, 'itbis_payable')
  assert.equal(itbis.length, 1)
  assert.equal(itbis[0].credit, 27)
})

test('7. buildCreditPaymentEntries — 2 rows balanced, client_id propagated', () => {
  const rows = buildCreditPaymentEntries({
    payment: {
      supabase_id: 'cp-1', business_id: biz.id, amount: 500,
      client_id: 'cli-9', date: '2026-05-17',
    },
    biz,
  })
  assert.equal(rows.length, 2)
  assert.equal(byAcct(rows, 'cash')[0].debit, 500)
  const rec = byAcct(rows, 'receivable')[0]
  assert.equal(rec.credit, 500)
  assert.equal(rec.client_id, 'cli-9')
})

test('8. buildExpenseEntries — utilities maps + fallback to expense.other', () => {
  const utilsRows = buildExpenseEntries({
    row: { supabase_id: 'e1', business_id: biz.id, type: 'luz', amount: 500, date: '2026-05-17' },
    biz,
  })
  assert.equal(byAcct(utilsRows, 'expense.utilities')[0].debit, 500)
  assert.equal(byAcct(utilsRows, 'expense.utilities')[0].category, 'luz')
  assert.equal(byAcct(utilsRows, 'cash')[0].credit, 500)

  const weirdRows = buildExpenseEntries({
    row: { supabase_id: 'e2', business_id: biz.id, type: 'weird', amount: 100 },
    biz,
  })
  assert.equal(byAcct(weirdRows, 'expense.other').length, 1)
})

test('9. buildRestockEntries — cash vs payable, qty=0 returns []', () => {
  const cashRows = buildRestockEntries({
    item: { supabase_id: 'inv-1', business_id: biz.id, name: 'Coca' },
    qty: 10, unitCostPaid: 25, paidInCash: true, biz,
  })
  assert.equal(byAcct(cashRows, 'inventory')[0].debit, 250)
  assert.equal(byAcct(cashRows, 'cash')[0].credit, 250)

  const credRows = buildRestockEntries({
    item: { supabase_id: 'inv-2', business_id: biz.id }, qty: 5, unitCostPaid: 10,
    paidInCash: false, biz,
  })
  assert.equal(byAcct(credRows, 'payable')[0].credit, 50)

  const noop = buildRestockEntries({ item: {}, qty: 0, unitCostPaid: 10, paidInCash: true, biz })
  assert.equal(noop.length, 0)
})

test('10. buildPayrollEntries + buildCommissionEntries — 2 rows each, balanced', () => {
  const pay = buildPayrollEntries({
    run: { supabase_id: 'pr-1', business_id: biz.id, total: 25000, period_end: '2026-05-15' },
    biz,
  })
  assert.equal(pay.length, 2)
  assert.equal(byAcct(pay, 'payroll_expense')[0].debit, 25000)
  assert.equal(byAcct(pay, 'cash')[0].credit, 25000)

  const com = buildCommissionEntries({
    payout: { supabase_id: 'co-1', business_id: biz.id, amount: 1500, employee_id: 'emp-1' },
    biz,
  })
  assert.equal(com.length, 2)
  assert.equal(byAcct(com, 'commission_expense')[0].debit, 1500)
  assert.equal(byAcct(com, 'commission_expense')[0].employee_id, 'emp-1')
})

test('11. buildReversalEntries — sum original + reversal === 0 per account', () => {
  const original = buildSaleEntries({
    ticket: ticketCash(),
    items: [item()],
    services: [svc()],
    biz,
  })
  // Simulate persisted IDs.
  original.forEach((r, i) => { r.id = 1000 + i })
  const reversal = buildReversalEntries({ originalRows: original })

  assert.equal(reversal.length, original.length)
  // All reversal rows have a reversal_of_id pointing at original.
  for (const r of reversal) {
    assert.ok(r.reversal_of_id != null)
  }
  // Single tx_group_id, distinct from original.
  const revGroups = new Set(reversal.map((r) => r.tx_group_id))
  assert.equal(revGroups.size, 1)
  assert.notEqual([...revGroups][0], original[0].tx_group_id)

  // Net by account = 0.
  const merged = [...original, ...reversal]
  const byAcctNet = {}
  for (const r of merged) {
    byAcctNet[r.account] = (byAcctNet[r.account] || 0) + Number(r.debit || 0) - Number(r.credit || 0)
  }
  for (const [acct, net] of Object.entries(byAcctNet)) {
    assert.ok(Math.abs(net) <= 0.01, `account ${acct} did not net to 0: ${net}`)
  }
})

test('12. ITBIS rounding within 5¢ tolerance — absorbed into cash row', () => {
  // Force a 1-cent drift: ticket.total off by 0.01 from sum of items+itbis.
  // gross 100, derived itbis = 100 - 100/1.18 = 15.2542 → rounds to 15.25.
  // revenue line = 84.75. Total ought to be 100.00. We set ticket.total = 100.01.
  const rows = buildSaleEntries({
    ticket: ticketCash({ total: 100.01, itbis: undefined }),
    items: [{ supabase_id: 't1', price: 100, qty: 1, cost: 0, service_supabase_id: 'svc-1' }],
    services: [svc()],
    biz,
  })
  assert.ok(Math.abs(sumD(rows) - sumC(rows)) <= 0.01)
})

test('13. ITBIS rounding beyond 5¢ — throws', () => {
  assert.throws(
    () => buildSaleEntries({
      ticket: ticketCash({ total: 200 }), // wildly off from item sum
      items: [{ supabase_id: 't1', price: 100, qty: 1, cost: 0, itbis: 18, service_supabase_id: 'svc-1' }],
      services: [svc()],
      biz,
    }),
    /unbalanced|rounding drift/i
  )
})

test('14. revenue classifier waterfall — each branch hits the right account', () => {
  assert.equal(resolveRevenueAccount({ is_wash: true }, null), 'revenue.carwash')
  assert.equal(resolveRevenueAccount({}, { is_menu_item: true, category: 'comida' }), 'revenue.kitchen')
  assert.equal(resolveRevenueAccount({}, { is_menu_item: true, category: 'bebida' }), 'revenue.bar')
  assert.equal(resolveRevenueAccount({ is_product: true }, {}), 'revenue.tienda')
  assert.equal(resolveRevenueAccount({}, { is_service: true }), 'revenue.service')
  // fallback heuristic
  assert.equal(resolveRevenueAccount({ cost: 10 }, {}), 'revenue.tienda')
  assert.equal(resolveRevenueAccount({ cost: 0 }, {}), 'revenue.service')
})

test('15. reversal preserves source linkage (source_table + source_id + source_line_id)', () => {
  const original = buildSaleEntries({
    ticket: ticketCash(),
    items: [item()],
    services: [svc()],
    biz,
  })
  const reversal = buildReversalEntries({ originalRows: original })
  for (let i = 0; i < original.length; i++) {
    assert.equal(reversal[i].source_table, original[i].source_table)
    assert.equal(reversal[i].source_id, original[i].source_id)
    assert.equal(reversal[i].source_line_id, original[i].source_line_id)
    assert.equal(reversal[i].account, original[i].account)
  }
})
