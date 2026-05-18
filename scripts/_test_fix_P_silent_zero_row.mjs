#!/usr/bin/env node
// Test Fix P — assertAffected helper detects silent 0-row writes.
// Re-implements the inline helper to verify the contract.

async function assertAffected(query, label, opts = {}) {
  const { data, error } = await query
  if (error) throw error
  const rows = Array.isArray(data) ? data : (data ? [data] : [])
  if (rows.length === 0 && !opts.allowZero) {
    const err = new Error(`silent_zero_row_write: ${label} — RLS denial or row missing`)
    err.code = 'TX_SILENT_ZERO_ROW'
    throw err
  }
  return rows
}

// Stub a query that returns { error: null, data: [] } (silent RLS denial).
const silentDenial = Promise.resolve({ data: [], error: null })
// Stub a successful update.
const success = Promise.resolve({ data: [{ id: 1 }], error: null })
// Stub a real error.
const realError = Promise.resolve({ data: null, error: { message: 'fk_violation', code: '23503' } })

let pass = 0, fail = 0
try { await assertAffected(silentDenial, 'test.update'); console.log('✗ silent denial slipped through'); fail++ }
catch (e) { if (e.code === 'TX_SILENT_ZERO_ROW') { console.log(`✓ silent denial caught: ${e.message}`); pass++ } else { console.log('✗ wrong error:', e.message); fail++ } }

try { const r = await assertAffected(success, 'test.update'); if (r.length === 1) { console.log('✓ successful update returned 1 row'); pass++ } else { fail++ } }
catch (e) { console.log('✗ success path threw:', e.message); fail++ }

try { await assertAffected(realError, 'test.update'); console.log('✗ real error swallowed'); fail++ }
catch (e) { if (e.code === '23503') { console.log('✓ real error re-thrown'); pass++ } else { console.log('✗ unexpected error', e); fail++ } }

try { const r = await assertAffected(silentDenial, 'test.update', { allowZero: true }); if (r.length === 0) { console.log('✓ allowZero opt-out works'); pass++ } else { fail++ } }
catch (e) { console.log('✗ allowZero threw:', e.message); fail++ }

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
