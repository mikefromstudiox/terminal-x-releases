// Final repair: distinguish 8 backfill rows from 108 source rows by exact
// (empleado_supabase_id, commission_amount) match. Source rows had ticket
// links null too — can't use that column to differentiate.
//
// Steps:
//  1. Reset all 116 SXAD commission rows → paid=true, manual_reason=null (source state)
//  2. Identify the 8 known backfills and set → paid=false, manual_reason=REASON

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter(Boolean).filter(l => !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BIZ = '1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79';
const REASON = 'Backfill v2.14.1: consolidated historical commissions (pre-purge)';
const NOW = new Date().toISOString();

const { data: emps } = await sb.from('empleados').select('supabase_id, nombre').eq('business_id', BIZ);
const idOf = Object.fromEntries(emps.map(e => [e.nombre, e.supabase_id]));

// The 8 confirmed backfills: exact amounts as inserted
const BACKFILLS = [
  { table: 'washer_commissions', nombre: 'Alejandro Barrie Santos',    amount: 229664.22 },
  { table: 'washer_commissions', nombre: 'Angel Miguel Barrie Santos', amount: 212796.26 },
  { table: 'seller_commissions', nombre: 'Jonnathan Garcia',           amount: 160405.00 },
  { table: 'washer_commissions', nombre: 'Franklin Guillen Arias',     amount: 136408.86 },
  { table: 'washer_commissions', nombre: 'Brayan De La Cruz Moreno',   amount: 111218.90 },
  { table: 'washer_commissions', nombre: 'Roberto Gomez',              amount:  83056.82 },
  { table: 'washer_commissions', nombre: 'Carlos Diaz Encarnacion',    amount:   3456.51 },
  { table: 'washer_commissions', nombre: 'Bairol Francisco Gonzalez',  amount:   3277.72 },
];

// Step 1: reset ALL SXAD commission rows to paid=true + manual_reason=null
console.log('=== Step 1: reset all SXAD commission rows ===');
for (const tbl of ['washer_commissions', 'seller_commissions', 'cajero_commissions']) {
  const { data, error } = await sb.from(tbl)
    .update({ paid: true, paid_at: NOW, manual_reason: null, updated_at: NOW })
    .eq('business_id', BIZ)
    .select('id');
  console.log(`  ${tbl}: reset ${data?.length || 0} rows${error ? ' ERR: '+error.message : ''}`);
}

// Step 2: flip the 8 backfill rows back to manual/unpaid
console.log('\n=== Step 2: flip 8 backfill rows to manual/unpaid ===');
for (const bf of BACKFILLS) {
  const eid = idOf[bf.nombre];
  if (!eid) { console.error('  missing empleado:', bf.nombre); continue; }
  // Find matching row(s) — should be exactly one
  const { data: matches, error: selErr } = await sb.from(bf.table)
    .select('id, commission_amount, paid, manual_reason')
    .eq('business_id', BIZ)
    .eq('empleado_supabase_id', eid)
    .eq('commission_amount', bf.amount);
  if (selErr) { console.error('  select err:', bf.nombre, selErr); continue; }
  if (!matches?.length) { console.error('  NO MATCH:', bf.nombre, bf.amount); continue; }
  if (matches.length > 1) { console.error('  MULTIPLE matches:', bf.nombre, bf.amount, matches); continue; }

  const { error: upErr } = await sb.from(bf.table)
    .update({ paid: false, paid_at: null, manual_reason: REASON, updated_at: NOW })
    .eq('id', matches[0].id);
  if (upErr) { console.error('  update err:', bf.nombre, upErr); continue; }
  console.log(`  OK ${bf.table}: ${bf.nombre}  RD$${bf.amount}  → manual/unpaid`);
}

// Verify final state
console.log('\n=== FINAL STATE ===');
for (const tbl of ['washer_commissions', 'seller_commissions', 'cajero_commissions']) {
  const { count: total } = await sb.from(tbl).select('*', { count: 'exact', head: true }).eq('business_id', BIZ);
  const { count: manualUnpaid } = await sb.from(tbl).select('*', { count: 'exact', head: true })
    .eq('business_id', BIZ).eq('paid', false);
  const { data: pending } = await sb.from(tbl)
    .select('empleado_supabase_id, commission_amount, manual_reason')
    .eq('business_id', BIZ).eq('paid', false);
  console.log(`\n  ${tbl}: total=${total}, unpaid=${manualUnpaid}`);
  for (const r of pending || []) {
    const name = emps.find(e => e.supabase_id === r.empleado_supabase_id)?.nombre || '(?)';
    console.log(`    ${name.padEnd(32)}  RD$${r.commission_amount}  manual="${r.manual_reason ? 'SET' : 'null'}"`);
  }
}

const sumsByTbl = {};
for (const tbl of ['washer_commissions', 'seller_commissions', 'cajero_commissions']) {
  const { data } = await sb.from(tbl)
    .select('commission_amount').eq('business_id', BIZ).eq('paid', false);
  sumsByTbl[tbl] = (data || []).reduce((s, r) => s + Number(r.commission_amount), 0);
}
const grand = Object.values(sumsByTbl).reduce((a, b) => a + b, 0);
console.log(`\n  Grand total pending (this is what Nómina will show): RD$ ${grand.toFixed(2)}`);
console.log(`  (target: RD$ 940,284.29)`);
