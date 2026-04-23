import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter(Boolean).filter(l => !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

for (const tbl of ['adelantos', 'loyalty_transactions', 'mesas', 'modificadores', 'vehicles', 'loans', 'appointments', 'kds_events', 'ecf_submissions', 'api_rate_limits', 'license_rebind_requests']) {
  const { count, error } = await sb.from(tbl).select('*', { count: 'exact', head: true });
  if (error) console.log(`  ❌ ${tbl}: ${error.code} ${error.message}`);
  else console.log(`  ✅ ${tbl}: exists (${count} rows)`);
}
