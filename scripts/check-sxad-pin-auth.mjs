import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter(Boolean).filter(l => !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
);
const SR = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ANON = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const BIZ = '1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79';

console.log('\n=== Service-role view of staff for SXAD ===');
const { data: staff, error: e1 } = await SR.from('staff')
  .select('id, supabase_id, business_id, username, pin_hash, role, nombre, cedula, active, deleted_at')
  .eq('business_id', BIZ);
if (e1) console.log('  ERROR:', e1);
else {
  console.log(`  ${staff.length} staff rows:`);
  for (const s of staff) {
    console.log(`    ${s.username?.padEnd(20) || '(no username)'}  role=${s.role}  active=${s.active}  pin_hash=${s.pin_hash ? 'set' : 'NULL'}  deleted=${s.deleted_at || 'no'}`);
  }
}

console.log('\n=== Anon-role view (what desktop/web client sees during PIN verify) ===');
const { data: anonStaff, error: e2 } = await ANON.from('staff')
  .select('id, supabase_id, username, pin_hash, role')
  .eq('business_id', BIZ);
if (e2) console.log('  ❌ ANON BLOCKED:', e2.code, e2.message);
else console.log(`  ${anonStaff?.length || 0} rows visible to anon`);

console.log('\n=== users VIEW (renderer uses this) ===');
const { data: users, error: e3 } = await SR.from('users')
  .select('*').eq('business_id', BIZ);
if (e3) console.log('  ERROR:', e3);
else {
  console.log(`  ${users.length} users view rows`);
  for (const u of users.slice(0, 5)) {
    console.log(`    ${u.username?.padEnd(20) || '(?)'}  role=${u.role}  pin_hash=${u.pin_hash ? 'set' : 'NULL'}`);
  }
}

console.log('\n=== RLS policies on staff + users ===');
const { data: pols } = await SR.rpc('pg_policies', {}).catch(async () => {
  // Fallback: direct query
  const { data } = await SR.from('pg_policies').select('*').in('tablename', ['staff', 'users']);
  return { data };
});
if (pols) {
  for (const p of pols) console.log(`  ${p.tablename}.${p.policyname}  cmd=${p.cmd}  roles=${p.roles}`);
} else {
  console.log('  (could not read pg_policies directly)');
}

console.log('\n=== empleados check (PIN resolution joins via staff.employee_id → empleados) ===');
const { data: emps } = await SR.from('empleados').select('supabase_id, nombre, tipo, role').eq('business_id', BIZ);
console.log(`  ${emps?.length || 0} empleados in SXAD`);
