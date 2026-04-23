// Preview per-worker unpaid commission totals — Studio X Auto Detailing only.
// Read-only. Prints a table. No inserts.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter(Boolean).filter(l => !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
);

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

// Studio X Auto Detailing
const sxad = { id: '1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79' };
console.log(`\n=== Filtering to: Studio X Auto Detailing (${sxad.id}) ===\n`);

const tables = [
  { name: 'washer_commissions', label: 'LAVADOR' },
  { name: 'seller_commissions', label: 'VENDEDOR' },
  { name: 'cajero_commissions', label: 'CAJERO' },
];

const { data: empleados } = await sb.from('empleados')
  .select('supabase_id, nombre, tipo, business_id, comision_pct')
  .eq('business_id', sxad.id);
const empMap = new Map(empleados.map(e => [e.supabase_id, e]));

const bucket = new Map();

for (const t of tables) {
  const { data, error } = await sb.from(t.name)
    .select('empleado_supabase_id, commission_amount, base_amount, created_at, ticket_supabase_id, paid, manual_reason, business_id')
    .eq('business_id', sxad.id)
    .or('paid.is.null,paid.eq.false');
  if (error) { console.error(t.name, error); continue; }

  for (const row of data) {
    if (row.manual_reason) continue;
    const key = `${row.empleado_supabase_id}|${t.name}`;
    if (!bucket.has(key)) {
      bucket.set(key, {
        empleado_supabase_id: row.empleado_supabase_id,
        table: t.name,
        label: t.label,
        count: 0,
        total_commission: 0,
        total_base: 0,
        earliest: row.created_at,
        latest: row.created_at,
      });
    }
    const b = bucket.get(key);
    b.count++;
    b.total_commission += Number(row.commission_amount || 0);
    b.total_base += Number(row.base_amount || 0);
    if (row.created_at < b.earliest) b.earliest = row.created_at;
    if (row.created_at > b.latest) b.latest = row.created_at;
  }
}

const rows = [...bucket.values()].map(b => {
  const emp = empMap.get(b.empleado_supabase_id);
  return {
    Worker: emp?.nombre || '(not in empleados)',
    Tipo: emp?.tipo || '?',
    Role: b.label,
    'empleado_pct': emp?.comision_pct || 0,
    Tickets: b.count,
    Base: Number(b.total_base.toFixed(2)),
    Commission: Number(b.total_commission.toFixed(2)),
    First: b.earliest?.slice(0, 10),
    Last: b.latest?.slice(0, 10),
  };
}).sort((a, b) => b.Commission - a.Commission);

console.table(rows);

const grandTotal = rows.reduce((s, r) => s + r.Commission, 0);
console.log(`\nGrand total to backfill: RD$ ${grandTotal.toFixed(2)}`);
console.log(`Rows to insert: ${rows.length}`);
