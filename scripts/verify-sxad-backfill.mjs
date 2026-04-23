import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter(Boolean).filter(l => !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BIZ = '1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79';
const NOW = new Date().toISOString();
const { data: emps } = await sb.from('empleados').select('supabase_id, nombre').eq('business_id', BIZ);
const nameOf = Object.fromEntries(emps.map(e => [e.supabase_id, e.nombre]));

console.log('\n=== A. Mop up stragglers (source rows still unpaid) ===');
for (const tbl of ['washer_commissions', 'seller_commissions', 'cajero_commissions']) {
  const { data: str } = await sb.from(tbl)
    .select('id, empleado_supabase_id, commission_amount, paid, manual_reason')
    .eq('business_id', BIZ)
    .is('manual_reason', null)
    .or('paid.is.null,paid.eq.false');
  if (!str?.length) continue;
  console.log(`  ${tbl}: ${str.length} stragglers →`);
  for (const r of str) console.log(`    ${nameOf[r.empleado_supabase_id] || '(?)'}  RD$${r.commission_amount}  paid=${r.paid}`);
  const ids = str.map(r => r.id);
  const { error } = await sb.from(tbl).update({ paid: true, paid_at: NOW, updated_at: NOW }).in('id', ids);
  if (error) console.error('    mop-up failed:', error);
  else console.log(`    → marked paid`);
}

console.log('\n=== B. Confirm 8 manual backfill rows exist ===');
let total = 0, count = 0;
for (const tbl of ['washer_commissions', 'seller_commissions', 'cajero_commissions']) {
  const { data, error } = await sb.from(tbl)
    .select('empleado_supabase_id, commission_amount, paid, manual_reason, created_at')
    .eq('business_id', BIZ)
    .like('manual_reason', 'Backfill v2.14.1%');
  if (error) { console.error(tbl, error); continue; }
  console.log(`\n  ${tbl}: ${data.length} manual rows`);
  for (const r of data) {
    console.log(`    ${(nameOf[r.empleado_supabase_id] || '?').padEnd(32)}  RD$${r.commission_amount}  paid=${r.paid}  created=${r.created_at?.slice(0,10)}`);
    total += Number(r.commission_amount); count++;
  }
}
console.log(`\n  ${count} manual rows, grand total RD$ ${total.toFixed(2)}`);

console.log('\n=== C. Final state of all commission rows (by paid status) ===');
for (const tbl of ['washer_commissions', 'seller_commissions', 'cajero_commissions']) {
  const { count: unpaidMan } = await sb.from(tbl).select('*', { count: 'exact', head: true })
    .eq('business_id', BIZ).like('manual_reason', 'Backfill v2.14.1%').or('paid.is.null,paid.eq.false');
  const { count: unpaidSrc } = await sb.from(tbl).select('*', { count: 'exact', head: true })
    .eq('business_id', BIZ).is('manual_reason', null).or('paid.is.null,paid.eq.false');
  const { count: paidSrc } = await sb.from(tbl).select('*', { count: 'exact', head: true })
    .eq('business_id', BIZ).is('manual_reason', null).eq('paid', true);
  console.log(`  ${tbl}: unpaid_manual=${unpaidMan} (these show on Nómina) | source unpaid=${unpaidSrc} (should be 0) | source paid=${paidSrc}`);
}

console.log('\n=== D. Tickets should still be 0 ===');
const { count: tc } = await sb.from('tickets').select('*', { count: 'exact', head: true }).eq('business_id', BIZ);
const { count: tic } = await sb.from('ticket_items').select('*', { count: 'exact', head: true }).eq('business_id', BIZ);
console.log(`  tickets=${tc}  ticket_items=${tic}`);
