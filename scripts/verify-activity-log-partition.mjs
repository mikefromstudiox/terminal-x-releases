#!/usr/bin/env node
import fs from 'node:fs';
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m) continue;
    if (process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv('.env');
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF   = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) { console.error('SQL ERR:', t); throw new Error(t); }
  return JSON.parse(t);
}

console.log('\n── 1) Parent + legacy state ───────────────────────────────────────');
console.log(JSON.stringify(await q(`
  SELECT relname, relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND relname IN ('activity_log','activity_log_legacy_unpartitioned')
  ORDER BY relname;
`), null, 2));

console.log('\n── 2) Partition layout ────────────────────────────────────────────');
const parts = await q(`
  SELECT inhrelid::regclass::text AS partition,
         pg_get_expr(c.relpartbound, inhrelid) AS bounds
  FROM pg_inherits i
  JOIN pg_class c ON c.oid = i.inhrelid
  WHERE inhparent = 'public.activity_log'::regclass
  ORDER BY partition;
`);
console.log(`partition count: ${parts.length}`);
console.log(parts.slice(0, 3));
console.log('...');
console.log(parts.slice(-3));

console.log('\n── 3) Row count parity ────────────────────────────────────────────');
console.log(await q(`
  SELECT (SELECT count(*) FROM public.activity_log)                       AS new_total,
         (SELECT count(*) FROM public.activity_log_legacy_unpartitioned)  AS legacy_total;
`));

console.log('\n── 4) Per-child indexes (sample, first child) ─────────────────────');
const firstChild = parts[0]?.partition;
if (firstChild) {
  console.log(await q(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname='public' AND tablename='${firstChild.replace('public.','')}'
    ORDER BY indexname;
  `));
}

console.log('\n── 5) Parent RLS policies ─────────────────────────────────────────');
console.log(await q(`
  SELECT polname, polcmd FROM pg_policy WHERE polrelid='public.activity_log'::regclass ORDER BY polname;
`));

console.log('\n── 6) Immutability triggers on parent ─────────────────────────────');
console.log(await q(`
  SELECT tgname, tgtype FROM pg_trigger
  WHERE tgrelid='public.activity_log'::regclass AND NOT tgisinternal
  ORDER BY tgname;
`));

console.log('\n── 7) pg_cron job ─────────────────────────────────────────────────');
console.log(await q(`SELECT jobname, schedule, command FROM cron.job WHERE jobname LIKE '%activity_log%partition%';`));

console.log('\n── 8) EXPLAIN — partition pruning + index path ────────────────────');
const sample = await q(`SELECT business_id::text FROM public.activity_log LIMIT 1;`);
const biz = sample[0]?.business_id || '00000000-0000-0000-0000-000000000000';
console.log(`Sample business_id: ${biz}`);
const plan = await q(`
  EXPLAIN (FORMAT TEXT)
  SELECT * FROM public.activity_log
  WHERE business_id = '${biz}' AND created_at > now() - interval '30 days'
  ORDER BY created_at DESC LIMIT 50;
`);
for (const r of plan) console.log(r['QUERY PLAN'] ?? r);
