// Audit checker — queries Supabase after simulation ends and checks for 3 critical violations:
//  1. Duplicate NCFs — any (ncf, ncf_type) tuple used > 1x within the business
//  2. Duplicate doc_numbers — any doc_number used > 1x within the business
//  3. Oversells — inventory_items.quantity went below zero OR cumulative sold > initial stock
//
// Returns a structured report. Empty arrays = PASS. Anything non-empty = LOUD FAILURE.

import { assertSim } from './fixtures.mjs'

export async function auditBusiness(s, businessId, fixtures) {
  assertSim(fixtures?.businessName)

  // 1. Load all tickets
  const { data: tickets, error: tErr } = await s
    .from('tickets').select('supabase_id, doc_number, ncf, ncf_type, total, status, created_at')
    .eq('business_id', businessId)
  if (tErr) throw new Error('audit tickets: ' + tErr.message)

  // 2. Duplicate NCFs
  const ncfMap = new Map()
  for (const t of tickets || []) {
    if (!t.ncf) continue
    const k = `${t.ncf_type || 'B01'}::${t.ncf}`
    ncfMap.set(k, (ncfMap.get(k) || 0) + 1)
  }
  const duplicateNCFs = [...ncfMap.entries()]
    .filter(([, c]) => c > 1)
    .map(([k, count]) => {
      const [ncf_type, ncf] = k.split('::')
      return { ncf_type, ncf, count }
    })

  // 3. Duplicate doc_numbers
  const docMap = new Map()
  for (const t of tickets || []) {
    if (!t.doc_number) continue
    docMap.set(t.doc_number, (docMap.get(t.doc_number) || 0) + 1)
  }
  const duplicateDocNums = [...docMap.entries()]
    .filter(([, c]) => c > 1)
    .map(([doc_number, count]) => ({ doc_number, count }))

  // 4. Oversells: compare current stock to initial stock from fixtures
  const { data: inv } = await s.from('inventory_items')
    .select('id, sku, name, quantity').eq('business_id', businessId)
  const oversells = []
  for (const row of inv || []) {
    if (row.quantity < 0) {
      oversells.push({ sku: row.sku, name: row.name, current: row.quantity, reason: 'negative stock' })
    }
    const initial = fixtures?.items?.find(i => i.id === row.id)?.qty
    if (initial != null) {
      // Count items sold from ticket_items
      const { data: soldRows } = await s.from('ticket_items')
        .select('quantity').eq('business_id', businessId).eq('inventory_item_supabase_id', row.id)
      const sold = (soldRows || []).reduce((sum, r) => sum + (r.quantity || 1), 0)
      if (sold > initial) {
        oversells.push({
          sku: row.sku, name: row.name,
          initial, sold, over_by: sold - initial,
          reason: 'sold more units than existed'
        })
      }
    }
  }

  return {
    totalTicketsInDb: tickets?.length || 0,
    duplicateNCFs,
    duplicateDocNums,
    oversells
  }
}

// Pretty-print the violations loudly.
export function printViolations(report) {
  const lines = []
  const banner = (msg) => lines.push('\n' + '='.repeat(70) + '\n' + msg + '\n' + '='.repeat(70))
  let failures = 0

  if (report.duplicateNCFs?.length) {
    failures += report.duplicateNCFs.length
    banner(`FAIL: ${report.duplicateNCFs.length} DUPLICATE NCF(s) DETECTED`)
    for (const d of report.duplicateNCFs) {
      lines.push(`   - ${d.ncf_type} ${d.ncf} used ${d.count}x (should be 1)`)
    }
  }
  if (report.duplicateDocNums?.length) {
    failures += report.duplicateDocNums.length
    banner(`FAIL: ${report.duplicateDocNums.length} DUPLICATE DOC NUMBER(s)`)
    for (const d of report.duplicateDocNums) {
      lines.push(`   - ${d.doc_number} used ${d.count}x`)
    }
  }
  if (report.oversells?.length) {
    failures += report.oversells.length
    banner(`FAIL: ${report.oversells.length} OVERSELL(s) DETECTED`)
    for (const o of report.oversells) {
      lines.push(`   - ${o.sku} (${o.name}): ${o.reason}` +
        (o.initial != null ? ` — initial=${o.initial} sold=${o.sold} over_by=${o.over_by}` : ` — current=${o.current}`))
    }
  }
  if (failures === 0) {
    lines.push('\nPASS: no duplicate NCFs, no duplicate doc numbers, no oversells.')
  } else {
    lines.push(`\nTOTAL VIOLATIONS: ${failures}`)
  }
  return lines.join('\n')
}
