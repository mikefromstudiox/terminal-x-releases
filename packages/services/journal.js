/**
 * journal.js — pure double-entry posting helpers.
 *
 * Zero I/O. Zero deps beyond node:crypto. ESM only.
 *
 * Every build* function returns an array of journal_entries-shaped rows that:
 *   - balance to within RD$0.01 (Σdebit === Σcredit per call),
 *   - share a single tx_group_id (one logical posting),
 *   - carry deterministic supabase_id + source linkage so the desktop ↔ Supabase
 *     sync layer can upsert them idempotently.
 *
 * Callers (electron/database.js, web.js, scripts/backfill-journal.mjs) own the
 * persistence + FK resolution. This module never touches the DB.
 */

// Universal randomUUID — browser `crypto.randomUUID()` (web POS, dist-web)
// and Node 19+ global crypto (electron main, scripts/, vercel functions) both
// expose it on globalThis.crypto. No `node:crypto` import — that fails the
// Vite browser bundle (see commit message Phase 3 wire-forward).
function randomUUID() {
  const g = (typeof globalThis !== 'undefined' ? globalThis : {})
  if (g.crypto && typeof g.crypto.randomUUID === 'function') return g.crypto.randomUUID()
  // Fallback for older Node — best-effort RFC4122 v4 from Math.random.
  // Production targets all have crypto.randomUUID; this exists only so unit
  // tests on legacy node never throw before they fail loudly elsewhere.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const todayISO = () => new Date().toISOString().slice(0, 10)

const toDateOnly = (v) => {
  if (!v) return todayISO()
  const s = String(v)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const d = new Date(s)
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : todayISO()
}

const isoNow = () => new Date().toISOString()

function entry(base, overrides) {
  const row = {
    supabase_id: randomUUID(),
    business_id: base.business_id,
    location_id: base.location_id ?? null,
    tx_group_id: base.tx_group_id,
    posted_at: base.posted_at,
    effective_date: base.effective_date,
    vertical: base.vertical ?? null,
    source_table: base.source_table,
    source_id: base.source_id ?? null,
    source_line_id: null,
    account: null,
    category: null,
    employee_id: null,
    client_id: null,
    debit: 0,
    credit: 0,
    description: null,
    metadata: {},
    reversal_of_id: null,
    created_by: base.created_by ?? null,
    ...overrides,
  }
  row.debit = round2(row.debit)
  row.credit = round2(row.credit)
  return row
}

/**
 * Revenue classifier waterfall (locked per Phase 2 spec):
 *   1. is_wash flag on item or service          → revenue.carwash
 *   2. menu item, category='comida'             → revenue.kitchen
 *   3. menu item (anything else)                → revenue.bar
 *   4. product (sku/is_product/has cost)        → revenue.tienda
 *   5. service                                  → revenue.service
 */
function resolveRevenueAccount(item, service) {
  if (item?.is_wash === true || service?.is_wash === true) return 'revenue.carwash'
  if (service?.is_menu_item === true) {
    return service?.category === 'comida' ? 'revenue.kitchen' : 'revenue.bar'
  }
  if (service?.is_product === true || item?.is_product === true) return 'revenue.tienda'
  if (service?.is_service === true || item?.is_service === true) return 'revenue.service'
  // Fallback heuristic: has cost → product, else service.
  return Number(item?.cost) > 0 ? 'revenue.tienda' : 'revenue.service'
}

function sumDebit(rows) { return rows.reduce((s, r) => s + Number(r.debit || 0), 0) }
function sumCredit(rows) { return rows.reduce((s, r) => s + Number(r.credit || 0), 0) }

function assertBalanced(rows, label, tolerance = 0.01) {
  const d = sumDebit(rows)
  const c = sumCredit(rows)
  const diff = Math.abs(d - c)
  if (diff > tolerance) {
    throw new Error(
      `[journal] ${label} unbalanced: debit=${d.toFixed(2)} credit=${c.toFixed(2)} diff=${diff.toFixed(4)}`
    )
  }
  return rows
}

function normalizePaymentMethod(m) {
  const s = String(m || '').toLowerCase().trim()
  if (s === 'efectivo' || s === 'cash') return 'cash'
  if (s === 'tarjeta' || s === 'card') return 'card'
  if (s === 'credito' || s === 'crédito' || s === 'credit') return 'credit'
  return s || 'cash'
}

// ---------------------------------------------------------------------------
// buildSaleEntries
// ---------------------------------------------------------------------------

/**
 * Build journal rows for a single ticket (cash | card | credit).
 * Returns balanced rows (cash/receivable adjusted by up to RD$0.05 to absorb
 * per-item ITBIS rounding drift; anything >5¢ throws).
 */
export function buildSaleEntries({ ticket, items, services, biz }) {
  if (!ticket || !Array.isArray(items) || items.length === 0) return []

  const business_id = ticket.business_id || biz?.id
  const tx_group_id = ticket.supabase_id || randomUUID()
  const posted_at = isoNow()
  const effective_date = toDateOnly(ticket.date || ticket.created_at)
  const vertical = biz?.business_type || ticket.vertical || null
  const created_by = ticket.created_by_staff_id || ticket.created_by || null

  const base = {
    business_id,
    location_id: ticket.location_id ?? null,
    tx_group_id,
    posted_at,
    effective_date,
    vertical,
    source_table: 'tickets',
    source_id: ticket.supabase_id || null,
    created_by,
  }

  const svcMap = new Map(
    (services || []).map((s) => [s.supabase_id || s.id, s])
  )

  const rows = []
  let totalItbis = 0

  for (const it of items) {
    const svc = svcMap.get(it.service_supabase_id || it.service_id) || null
    const qty = Number(it.qty || 1)
    const priceLine = round2(Number(it.price || 0) * qty)
    const discount = Number(it.discount || 0)

    // ITBIS resolution:
    //   - If `it.itbis` explicit AND `it.price_includes_itbis === false` (or
    //     no aplica_itbis), price is NET → gross contribution = price + itbis.
    //   - If `aplica_itbis === true` (DR default — price tag is gross-inclusive),
    //     itbis is the embedded 18%: itbis = gross - gross/1.18.
    //   - Otherwise no itbis.
    // Contract (Terminal X ticket_items convention):
    //   - If `it.itbis` is supplied explicitly, `price` is NET (ex-ITBIS) and
    //     gross contribution to ticket.total = price + itbis.
    //   - Else if service.aplica_itbis === true, `price` is GROSS (inclusive)
    //     and itbis is the embedded 18% portion (gross - gross/1.18).
    //   - Else no ITBIS.
    let gross
    let itbisLine
    if (it.itbis != null) {
      itbisLine = round2(Number(it.itbis))
      gross = round2(priceLine - discount + itbisLine)
    } else if (svc?.aplica_itbis === true) {
      gross = round2(priceLine - discount)
      itbisLine = round2(gross - gross / 1.18)
    } else {
      gross = round2(priceLine - discount)
      itbisLine = 0
    }
    const revenueLine = round2(gross - itbisLine)
    totalItbis = round2(totalItbis + itbisLine)

    const account = resolveRevenueAccount(it, svc)

    rows.push(
      entry(base, {
        source_line_id: it.supabase_id || null,
        account,
        category: svc?.category ?? null,
        credit: revenueLine,
        description: svc?.name || it.name || null,
        metadata: { qty, gross, itbis: itbisLine },
      })
    )

    const unitCost = Number(it.cost || 0)
    if (unitCost > 0 && qty > 0) {
      const cogs = round2(unitCost * qty)
      rows.push(
        entry(base, {
          source_line_id: it.supabase_id || null,
          account: 'cogs',
          category: svc?.category ?? null,
          debit: cogs,
          description: `COGS: ${svc?.name || it.name || ''}`.trim(),
        })
      )
      rows.push(
        entry(base, {
          source_line_id: it.supabase_id || null,
          account: 'inventory',
          category: svc?.category ?? null,
          credit: cogs,
          description: `Inventory: ${svc?.name || it.name || ''}`.trim(),
        })
      )
    }
  }

  // Aggregate ITBIS to a single payable row.
  if (totalItbis > 0) {
    rows.push(
      entry(base, {
        account: 'itbis_payable',
        credit: totalItbis,
        description: 'ITBIS 18%',
      })
    )
  }

  // Settlement.
  const method = normalizePaymentMethod(ticket.payment_method)
  const total = round2(Number(ticket.total || 0))
  let settlementRows = []
  if (method === 'credit') {
    settlementRows.push(
      entry(base, {
        account: 'receivable',
        debit: total,
        client_id: ticket.client_id || null,
        description: 'Venta a crédito',
      })
    )
  } else if (method === 'card') {
    const fee = round2(Number(ticket.card_fee || 0) ||
      (ticket.card_fee_pct ? total * Number(ticket.card_fee_pct) : 0))
    const cashPart = round2(total - fee)
    if (cashPart > 0) {
      settlementRows.push(entry(base, {
        account: 'cash',
        debit: cashPart,
        description: 'Venta tarjeta (neto)',
      }))
    }
    if (fee > 0) {
      settlementRows.push(entry(base, {
        account: 'fee.card',
        debit: fee,
        description: 'Comisión tarjeta',
      }))
    }
  } else {
    settlementRows.push(entry(base, {
      account: 'cash',
      debit: total,
      description: 'Venta efectivo',
    }))
  }
  rows.push(...settlementRows)

  // Rounding reconciliation: absorb up to 5¢ into the primary settlement row.
  const d = sumDebit(rows)
  const c = sumCredit(rows)
  const diff = round2(d - c)
  if (Math.abs(diff) > 0 && Math.abs(diff) <= 0.05 && settlementRows.length > 0) {
    // Pick the largest settlement row to absorb the drift.
    const primary = settlementRows.reduce((a, b) => (a.debit >= b.debit ? a : b))
    primary.debit = round2(primary.debit - diff)
  } else if (Math.abs(diff) > 0.05) {
    throw new Error(
      `[journal] buildSaleEntries#${tx_group_id} ITBIS rounding drift exceeds 5¢: diff=${diff.toFixed(4)}`
    )
  }

  return assertBalanced(rows, `buildSaleEntries#${tx_group_id}`)
}

// ---------------------------------------------------------------------------
// buildCreditPaymentEntries
// ---------------------------------------------------------------------------

export function buildCreditPaymentEntries({ payment, biz }) {
  if (!payment) return []
  const business_id = payment.business_id || biz?.id
  const tx_group_id = payment.supabase_id || randomUUID()
  const amount = round2(Number(payment.amount || 0))
  if (amount <= 0) return []

  const base = {
    business_id,
    location_id: payment.location_id ?? null,
    tx_group_id,
    posted_at: isoNow(),
    effective_date: toDateOnly(payment.date || payment.created_at),
    vertical: biz?.business_type || null,
    source_table: 'credit_payments',
    source_id: payment.supabase_id || null,
    created_by: payment.created_by_staff_id || payment.created_by || null,
  }

  const rows = [
    entry(base, {
      account: 'cash',
      debit: amount,
      description: 'Cobro a crédito',
    }),
    entry(base, {
      account: 'receivable',
      credit: amount,
      client_id: payment.client_id || null,
      description: 'Aplicación de cobro',
    }),
  ]

  return assertBalanced(rows, `buildCreditPaymentEntries#${tx_group_id}`)
}

// ---------------------------------------------------------------------------
// buildExpenseEntries
// ---------------------------------------------------------------------------

const EXPENSE_MAP = {
  utilities: 'expense.utilities',
  luz: 'expense.utilities', agua: 'expense.utilities', internet: 'expense.utilities',
  rent: 'expense.rent', alquiler: 'expense.rent',
  supplies: 'expense.supplies', insumos: 'expense.supplies',
  fuel: 'expense.fuel', combustible: 'expense.fuel',
  maintenance: 'expense.maintenance', reparaciones: 'expense.maintenance',
  marketing: 'expense.marketing', publicidad: 'expense.marketing',
  legal_fiscal: 'expense.legal_fiscal', contador: 'expense.legal_fiscal', abogado: 'expense.legal_fiscal',
  refund: 'refund', devolucion: 'refund',
  py_fee: 'fee.py', pedidos_ya: 'fee.py',
  card_fee: 'fee.card',
  owner_draw: 'owner_draw',
}

export function buildExpenseEntries({ row, biz }) {
  if (!row) return []
  const business_id = row.business_id || biz?.id
  const tx_group_id = row.supabase_id || randomUUID()
  const amount = round2(Number(row.amount || 0))
  if (amount <= 0) return []

  const type = String(row.type || '').toLowerCase()
  const account = EXPENSE_MAP[type] || 'expense.other'

  const base = {
    business_id,
    location_id: row.location_id ?? null,
    tx_group_id,
    posted_at: isoNow(),
    effective_date: toDateOnly(row.date || row.created_at),
    vertical: biz?.business_type || null,
    source_table: 'caja_chica',
    source_id: row.supabase_id || null,
    created_by: row.created_by_staff_id || row.created_by || null,
  }

  const rows = [
    entry(base, {
      account,
      category: row.type || null,
      debit: amount,
      description: row.description || row.concepto || null,
    }),
    entry(base, {
      account: 'cash',
      credit: amount,
      description: 'Salida caja chica',
    }),
  ]

  return assertBalanced(rows, `buildExpenseEntries#${tx_group_id}`)
}

// ---------------------------------------------------------------------------
// buildRestockEntries
// ---------------------------------------------------------------------------

export function buildRestockEntries({ item, qty, unitCostPaid, paidInCash, biz }) {
  const q = Number(qty || 0)
  const u = Number(unitCostPaid || 0)
  if (q <= 0 || u <= 0) return []

  const business_id = item?.business_id || biz?.id
  const tx_group_id = randomUUID()
  const total = round2(q * u)

  const base = {
    business_id,
    location_id: item?.location_id ?? null,
    tx_group_id,
    posted_at: isoNow(),
    effective_date: todayISO(),
    vertical: biz?.business_type || null,
    source_table: 'inventory_movements',
    source_id: item?.supabase_id || null,
    created_by: null,
  }

  const rows = [
    entry(base, {
      account: 'inventory',
      debit: total,
      description: `Restock: ${item?.name || ''}`.trim(),
      metadata: { item_supabase_id: item?.supabase_id || null, qty: q, unit_cost_paid: u },
    }),
    entry(base, {
      account: paidInCash ? 'cash' : 'payable',
      credit: total,
      description: paidInCash ? 'Pago restock efectivo' : 'Restock a crédito',
    }),
  ]

  return assertBalanced(rows, `buildRestockEntries#${tx_group_id}`)
}

// ---------------------------------------------------------------------------
// buildPayrollEntries
// ---------------------------------------------------------------------------

export function buildPayrollEntries({ run, biz }) {
  if (!run) return []
  const business_id = run.business_id || biz?.id
  const tx_group_id = run.supabase_id || randomUUID()
  const amount = round2(Number(run.total ?? run.total_payroll ?? run.amount ?? 0))
  if (amount <= 0) return []

  const base = {
    business_id,
    location_id: run.location_id ?? null,
    tx_group_id,
    posted_at: isoNow(),
    effective_date: toDateOnly(run.period_end || run.date || run.created_at),
    vertical: biz?.business_type || null,
    source_table: 'payroll_runs',
    source_id: run.supabase_id || null,
    created_by: run.created_by_staff_id || run.created_by || null,
  }

  const rows = [
    entry(base, {
      account: 'payroll_expense',
      debit: amount,
      description: `Nómina ${run.period_label || ''}`.trim(),
    }),
    entry(base, {
      account: 'cash',
      credit: amount,
      description: 'Pago nómina',
    }),
  ]

  return assertBalanced(rows, `buildPayrollEntries#${tx_group_id}`)
}

// ---------------------------------------------------------------------------
// buildCommissionEntries
// ---------------------------------------------------------------------------

export function buildCommissionEntries({ payout, biz }) {
  if (!payout) return []
  const business_id = payout.business_id || biz?.id
  const tx_group_id = payout.supabase_id || randomUUID()
  const amount = round2(Number(payout.amount || 0))
  if (amount <= 0) return []

  const base = {
    business_id,
    location_id: payout.location_id ?? null,
    tx_group_id,
    posted_at: isoNow(),
    effective_date: toDateOnly(payout.date || payout.created_at),
    vertical: biz?.business_type || null,
    source_table: 'commission_payouts',
    source_id: payout.supabase_id || null,
    created_by: payout.created_by_staff_id || payout.created_by || null,
  }

  const employee_id = payout.employee_id || payout.staff_id || null

  const rows = [
    entry(base, {
      account: 'commission_expense',
      debit: amount,
      employee_id,
      description: 'Comisión pagada',
    }),
    entry(base, {
      account: 'cash',
      credit: amount,
      employee_id,
      description: 'Pago comisión',
    }),
  ]

  return assertBalanced(rows, `buildCommissionEntries#${tx_group_id}`)
}

// ---------------------------------------------------------------------------
// buildReversalEntries
// ---------------------------------------------------------------------------

/**
 * Mirror every supplied row with debit↔credit swapped, fresh supabase_id,
 * one shared NEW tx_group_id (distinct from originals so per-group balance
 * audits flag unmatched single-sided reversals), and reversal_of_id pointing
 * at whichever ID the caller has (bigint `id` if persisted, else supabase_id).
 */
export function buildReversalEntries({ originalRows }) {
  if (!Array.isArray(originalRows) || originalRows.length === 0) return []
  const reversalGroup = randomUUID()
  const now = isoNow()
  const rows = originalRows
    .filter((r) => Number(r.debit || 0) > 0 || Number(r.credit || 0) > 0)
    .map((orig) => {
      const ref = orig.id ?? orig.supabase_id ?? null
      return {
        supabase_id: randomUUID(),
        business_id: orig.business_id,
        location_id: orig.location_id ?? null,
        tx_group_id: reversalGroup,
        posted_at: now,
        effective_date: orig.effective_date,
        vertical: orig.vertical ?? null,
        source_table: orig.source_table,
        source_id: orig.source_id ?? null,
        source_line_id: orig.source_line_id ?? null,
        account: orig.account,
        category: orig.category ?? null,
        employee_id: orig.employee_id ?? null,
        client_id: orig.client_id ?? null,
        debit: round2(orig.credit || 0),
        credit: round2(orig.debit || 0),
        description: `Reversal: ${orig.description ?? ''}`.trim(),
        metadata: { ...(orig.metadata || {}), reversed_from: ref },
        reversal_of_id: ref,
        created_by: orig.created_by ?? null,
      }
    })
  return assertBalanced(rows, `buildReversalEntries#${reversalGroup}`)
}

// ---------------------------------------------------------------------------
// Test surface (intentionally minimal — keeps public API clean)
// ---------------------------------------------------------------------------

export const _test = {
  round2,
  toDateOnly,
  resolveRevenueAccount,
  normalizePaymentMethod,
  assertBalanced,
  EXPENSE_MAP,
}
