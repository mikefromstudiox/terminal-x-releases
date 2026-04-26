#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

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
const URL_  = process.env.SUPABASE_URL;
const REF   = (URL_||'').match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1];
if (!TOKEN || !REF) { console.error('Missing token/ref'); process.exit(2); }

const sqlPath = process.argv[2] || 'db/supabase-migration-v2.16.8-activity-log-partition-brin.sql';
const sql = fs.readFileSync(sqlPath, 'utf8');

console.log(`Applying ${sqlPath} (${sql.length} bytes) to project ${REF} ...`);

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
  body: JSON.stringify({ query: sql }),
});
const txt = await res.text();
console.log('HTTP', res.status);
console.log(txt.slice(0, 4000));
process.exit(res.ok ? 0 : 1);
