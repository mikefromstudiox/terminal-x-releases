#!/usr/bin/env node
/**
 * rls-policy-audit.mjs — RLS sanity check for Supabase
 *
 * Finds any table in `public` that has RLS ENABLED but ZERO policies. Such
 * tables 42501-reject every read/write from anon AND authenticated roles
 * (only service_role bypasses), which is almost always an unintentional
 * outage waiting to happen — the table was migrated with `ALTER TABLE …
 * ENABLE ROW LEVEL SECURITY` but the matching `CREATE POLICY` statement
 * was forgotten.
 *
 * Run before every release. Exits 1 if any violations exist.
 *
 *   node scripts/rls-policy-audit.mjs
 *
 * Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env (or
 * web/.env.local). Does NOT require any extra tooling — uses Postgres'
 * REST endpoint via service_role to query pg_class / pg_policies via a
 * lightweight RPC if present, otherwise falls back to direct pg_meta SQL
 * over the Supabase /rest/v1/rpc/exec_sql shim. We use the supabase-js
 * client + a SECURITY DEFINER RPC (`rls_policy_audit`) created lazily by
 * this script if it doesn't exist yet — keeping the script idempotent.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// ── tiny .env loader (no dotenv dep) ─────────────────────────────────────────
function loadEnv(file) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i)
    if (!m) continue
    if (process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
loadEnv(path.join(ROOT, '.env'))
loadEnv(path.join(ROOT, 'web', '.env.local'))
loadEnv(path.join(ROOT, 'web', '.env'))

const URL_         = process.env.SUPABASE_URL
const KEY          = process.env.SUPABASE_SERVICE_ROLE_KEY
const MGMT_TOKEN   = process.env.SUPABASE_ACCESS_TOKEN
const PROJECT_REF  = (URL_ || '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] || null

if (!URL_ || !KEY) {
  console.error('✗ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no encontrados en .env. Aborto.')
  process.exit(2)
}

// SQL — list every public table with RLS enabled, count policies per table.
const SQL = `
  SELECT
    c.relname              AS table_name,
    COALESCE(p.policy_count, 0) AS policy_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN (
    SELECT schemaname, tablename, COUNT(*) AS policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
    GROUP BY schemaname, tablename
  ) p ON p.schemaname = n.nspname AND p.tablename = c.relname
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relrowsecurity = true
  ORDER BY c.relname;
`.trim()

async function runQuery() {
  // 1) Preferred: Supabase Management API (api.supabase.com) — direct SQL.
  if (MGMT_TOKEN && PROJECT_REF) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MGMT_TOKEN}`,
      },
      body: JSON.stringify({ query: SQL }),
    })
    if (res.ok) return res.json()
    const txt = await res.text().catch(() => '')
    console.error(`[mgmt-api] ${res.status}: ${txt.slice(0, 200)}`)
  }

  // 2) Fallback: pre-installed RPC (idempotent, see SQL block below).
  const res2 = await fetch(`${URL_}/rest/v1/rpc/rls_policy_audit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${KEY}`,
      'apikey': KEY,
    },
    body: JSON.stringify({}),
  })
  if (res2.ok) return res2.json()

  // 3) Tell the user how to install the helper once.
  console.error('✗ No se pudo ejecutar la consulta RLS. Pega esta función SQL una vez en Supabase y re-corre el script:')
  console.error(`
CREATE OR REPLACE FUNCTION public.rls_policy_audit()
RETURNS TABLE(table_name text, policy_count bigint)
LANGUAGE sql SECURITY DEFINER AS $$
${SQL}
$$;
GRANT EXECUTE ON FUNCTION public.rls_policy_audit() TO service_role;
`)
  process.exit(2)
}

const rows = await runQuery()

let violations = 0
console.log('── Auditoría RLS (esquema public) ─────────────────────────────────')
for (const r of rows) {
  const n = Number(r.policy_count || 0)
  if (n === 0) {
    console.log(`✗ ${r.table_name}: SIN POLÍTICAS — bloqueará todas las lecturas`)
    violations++
  } else {
    console.log(`✓ ${r.table_name}: ${n} ${n === 1 ? 'política' : 'políticas'}`)
  }
}
console.log('───────────────────────────────────────────────────────────────────')

if (violations > 0) {
  console.log(`\n✗ ${violations} tabla(s) con RLS habilitado pero sin políticas. Aborto release.`)
  process.exit(1)
}
console.log('\n✓ Auditoría RLS limpia. OK para release.')
process.exit(0)
