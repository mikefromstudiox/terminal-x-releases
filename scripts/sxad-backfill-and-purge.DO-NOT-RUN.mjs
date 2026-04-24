// Studio X Auto Detailing — commission backfill + ticket purge.
// ONE-SHOT. Executed 2026-04-23. DO NOT RUN AGAIN.
//
// Phase 1: insert 8 manual commissions (one per worker+role).
// Phase 2: mark all source ticket-derived commission rows as paid.
// Phase 3: purge tickets + ticket_items for SXAD business only.
//
// v2.14.24 — HARD-STOPPED. Prior runs (see commit 0dcca1d + audit
// 2026-04-24) inserted the backfill rows TWO-TO-THREE times because this
// script has no idempotency guard — every run generates a fresh UUID and
// re-INSERTs the same 8 rows. Symptoms showed up as RD$1.7M of bogus
// commission obligation on payroll reports. To prevent re-runs:
//   1) This top-level guard. `process.exit(1)` unless the operator passes
//      `--i-know-this-will-create-duplicates` AND edits the array below.
//   2) Filename suffix .DO-NOT-RUN prevents muscle-memory `node scripts/sxad-*`.
//   3) Future backfill scripts MUST check for an existing row with matching
//      (empleado_supabase_id, manual_reason, created_at) before INSERT.

if (!process.argv.includes('--i-know-this-will-create-duplicates')) {
  console.error('')
  console.error('  ✋ STOP. This script is a one-shot backfill that has already run.')
  console.error('     Re-running it duplicates historical commission data.')
  console.error('     See TICKET-FLOW-AUDIT-2026-04-24 / commit 0dcca1d.')
  console.error('     If you REALLY need to run it, pass --i-know-this-will-create-duplicates')
  console.error('     and add a before-INSERT check for (empleado_supabase_id, manual_reason).')
  console.error('')
  process.exit(1)
}

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter(Boolean).filter(l => !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BIZ = '1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79';

const DRY = process.argv.includes('--dry');
const REASON = 'Backfill v2.14.1: consolidated historical commissions (pre-purge)';
const NOW = new Date().toISOString();

// 8 confirmed workers (user confirmed 2026-04-23)
const BACKFILL = [
  { table: 'washer_commissions', empleado_supabase_id: null, nombre: 'Alejandro Barrie Santos',    commission_amount: 229664.22, base_amount: 765547.40, commission_pct: 30, earliest: '2025-05-31T12:00:00-04:00' },
  { table: 'washer_commissions', empleado_supabase_id: null, nombre: 'Angel Miguel Barrie Santos', commission_amount: 212796.26, base_amount: 709320.86, commission_pct: 30, earliest: '2025-05-31T12:00:00-04:00' },
  { table: 'seller_commissions', empleado_supabase_id: null, nombre: 'Jonnathan Garcia',           commission_amount: 160405.00, base_amount: 3208099.95, commission_pct: 5, earliest: '2025-05-31T12:00:00-04:00' },
  { table: 'washer_commissions', empleado_supabase_id: null, nombre: 'Franklin Guillen Arias',     commission_amount: 136408.86, base_amount: 454696.15, commission_pct: 30, earliest: '2025-05-31T12:00:00-04:00' },
  { table: 'washer_commissions', empleado_supabase_id: null, nombre: 'Brayan De La Cruz Moreno',   commission_amount: 111218.90, base_amount: 370729.58, commission_pct: 30, earliest: '2025-05-31T12:00:00-04:00' },
  { table: 'washer_commissions', empleado_supabase_id: null, nombre: 'Roberto Gomez',              commission_amount:  83056.82, base_amount: 276856.06, commission_pct: 30, earliest: '2025-12-31T12:00:00-04:00' },
  { table: 'washer_commissions', empleado_supabase_id: null, nombre: 'Carlos Diaz Encarnacion',    commission_amount:   3456.51, base_amount:  11521.70, commission_pct: 30, earliest: '2025-05-31T12:00:00-04:00' },
  { table: 'washer_commissions', empleado_supabase_id: null, nombre: 'Bairol Francisco Gonzalez',  commission_amount:   3277.72, base_amount:  10925.73, commission_pct: 30, earliest: '2025-05-31T12:00:00-04:00' },
];

// Resolve empleado_supabase_id from names
const { data: emps } = await sb.from('empleados').select('supabase_id, nombre, tipo').eq('business_id', BIZ);
for (const r of BACKFILL) {
  const hit = emps.find(e => e.nombre === r.nombre);
  if (!hit) { console.error('Could not resolve empleado:', r.nombre); process.exit(1); }
  r.empleado_supabase_id = hit.supabase_id;
}
console.log(`\nResolved ${BACKFILL.length} empleados. DRY=${DRY}\n`);

// Phase 1: insert manual commissions
console.log('=== Phase 1: Insert manual commissions ===');
for (const r of BACKFILL) {
  const row = {
    supabase_id: randomUUID(),
    business_id: BIZ,
    empleado_supabase_id: r.empleado_supabase_id,
    ticket_supabase_id: null,
    ticket_id: null,
    base_amount: r.base_amount,
    commission_pct: r.commission_pct,
    commission_amount: r.commission_amount,
    paid: false,
    created_at: r.earliest,
    updated_at: NOW,
    manual_reason: REASON,
  };
  if (r.table === 'seller_commissions') row.seller_supabase_id = r.empleado_supabase_id;
  if (r.table === 'washer_commissions') row.washer_supabase_id = r.empleado_supabase_id;
  if (r.table === 'cajero_commissions') row.cajero_supabase_id = r.empleado_supabase_id;

  if (DRY) { console.log(`  [DRY] ${r.table} ← ${r.nombre}  RD$${r.commission_amount}`); continue; }
  const { error } = await sb.from(r.table).insert(row);
  if (error) { console.error('INSERT failed:', r.nombre, error); process.exit(1); }
  console.log(`  OK ${r.table} ← ${r.nombre}  RD$${r.commission_amount}`);
}

// Phase 2: mark source (non-manual) commission rows paid so they don't double-count
console.log('\n=== Phase 2: Mark source commission rows paid ===');
for (const tbl of ['washer_commissions', 'seller_commissions', 'cajero_commissions']) {
  if (DRY) {
    const { count } = await sb.from(tbl).select('*', { count: 'exact', head: true })
      .eq('business_id', BIZ).is('manual_reason', null).or('paid.is.null,paid.eq.false');
    console.log(`  [DRY] ${tbl}: would mark ${count} rows paid`);
    continue;
  }
  const { data, error } = await sb.from(tbl)
    .update({ paid: true, paid_at: NOW, updated_at: NOW })
    .eq('business_id', BIZ)
    .is('manual_reason', null)
    .or('paid.is.null,paid.eq.false')
    .select('id');
  if (error) { console.error(tbl, error); process.exit(1); }
  console.log(`  OK ${tbl}: marked ${data?.length || 0} rows paid`);
}

// Phase 3: purge tickets (cascades ticket_items via FK if set; else explicit)
console.log('\n=== Phase 3: Purge tickets ===');
const { count: preTickets } = await sb.from('tickets').select('*', { count: 'exact', head: true }).eq('business_id', BIZ);
const { count: preItems } = await sb.from('ticket_items').select('*', { count: 'exact', head: true }).eq('business_id', BIZ);
console.log(`  Before: tickets=${preTickets}, ticket_items=${preItems}`);

if (DRY) {
  console.log(`  [DRY] Would delete ${preTickets} tickets and ${preItems} ticket_items`);
} else {
  // Delete children first to avoid FK violation
  const { error: e1 } = await sb.from('ticket_items').delete().eq('business_id', BIZ);
  if (e1) { console.error('ticket_items delete failed:', e1); process.exit(1); }
  const { error: e2 } = await sb.from('payment_parts').delete().eq('business_id', BIZ);
  if (e2 && !/relation.*does not exist/i.test(e2.message)) console.warn('payment_parts delete warn:', e2.message);
  const { error: e3 } = await sb.from('tickets').delete().eq('business_id', BIZ);
  if (e3) { console.error('tickets delete failed:', e3); process.exit(1); }

  const { count: postTickets } = await sb.from('tickets').select('*', { count: 'exact', head: true }).eq('business_id', BIZ);
  const { count: postItems } = await sb.from('ticket_items').select('*', { count: 'exact', head: true }).eq('business_id', BIZ);
  console.log(`  After:  tickets=${postTickets}, ticket_items=${postItems}`);
}

console.log('\n✅ DONE. Next: run same purge on local SQLite via desktop app (script forthcoming).');
