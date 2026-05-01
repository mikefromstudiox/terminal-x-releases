#!/usr/bin/env node
/**
 * schema-snapshot.mjs — Live Supabase schema snapshot generator
 *
 * Queries the LIVE Terminal X Supabase project (csppjsoirjflumaiipqw) via the
 * Management API and writes a comprehensive markdown reference document to
 *   docs/SCHEMA-SNAPSHOT.md
 *
 * Run BEFORE every release, or whenever the schema has changed, or when
 * you (a future agent) are about to "report" a schema-related bug — read
 * the snapshot first; it is the source of truth.
 *
 * Read-only. Only SELECTs against pg_catalog / information_schema. No DDL.
 *
 *   node scripts/schema-snapshot.mjs
 *   node scripts/schema-snapshot.mjs --diff    # show diff vs previous snapshot
 *
 * Reads SUPABASE_ACCESS_TOKEN from .env. Project ref hardcoded.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

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

const PROJECT_REF = 'csppjsoirjflumaiipqw'
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN

if (!TOKEN) {
  console.error('SUPABASE_ACCESS_TOKEN missing in .env')
  process.exit(2)
}

const OUT_FILE = path.join(ROOT, 'docs', 'SCHEMA-SNAPSHOT.md')
const PREV_FILE = OUT_FILE + '.prev'

const FLAG_DIFF = process.argv.includes('--diff')

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })
  const txt = await r.text()
  if (!r.ok) throw new Error(`Query failed (${r.status}): ${txt.slice(0, 500)}\nSQL: ${sql.slice(0, 300)}`)
  try { return JSON.parse(txt) } catch { return [] }
}

const log = (...a) => console.log('[snapshot]', ...a)

// ── helpers ────────────────────────────────────────────────────────────────
const esc = (s) => (s == null ? '' : String(s).replace(/\|/g, '\\|').replace(/\n/g, ' '))
const codeBlock = (sql, lang = 'sql') => '```' + lang + '\n' + sql.trim() + '\n```'

// ── §1 Tables ──────────────────────────────────────────────────────────────
const Q_TABLES = `
  SELECT c.relname AS table_name,
         COALESCE(s.n_live_tup, 0) AS rough_rows,
         c.relrowsecurity AS rls_enabled
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
  WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND c.relispartition = false
  ORDER BY c.relname;
`
const Q_COLUMNS = `
  SELECT table_name, column_name, data_type, udt_name,
         is_nullable, column_default, is_generated, generation_expression,
         ordinal_position
  FROM information_schema.columns
  WHERE table_schema = 'public'
  ORDER BY table_name, ordinal_position;
`
const Q_CONSTRAINTS = `
  SELECT conrelid::regclass::text AS table_name,
         conname,
         contype,            -- p=PK, u=UNIQUE, f=FK, c=CHECK
         pg_get_constraintdef(oid) AS definition,
         confdeltype, confupdtype
  FROM pg_constraint
  WHERE connamespace = 'public'::regnamespace
  ORDER BY conrelid::regclass::text, contype, conname;
`
const Q_INDEXES = `
  SELECT schemaname, tablename, indexname, indexdef
  FROM pg_indexes
  WHERE schemaname = 'public'
  ORDER BY tablename, indexname;
`

async function sectionTables() {
  log('§1 tables…')
  const tables = await q(Q_TABLES)
  const cols   = await q(Q_COLUMNS)
  const cons   = await q(Q_CONSTRAINTS)
  const idx    = await q(Q_INDEXES)

  const colsByTable = {}
  for (const c of cols) (colsByTable[c.table_name] ||= []).push(c)
  const consByTable = {}
  for (const c of cons) (consByTable[c.table_name] ||= []).push(c)
  const idxByTable = {}
  for (const i of idx) (idxByTable[i.tablename] ||= []).push(i)

  let md = `## §1. Tables\n\nQuery used to enumerate tables:\n\n${codeBlock(Q_TABLES)}\n\n`
  md += `Total tables: **${tables.length}** (RLS enabled: **${tables.filter(t => t.rls_enabled).length}**)\n\n`

  for (const t of tables) {
    const tn = t.table_name
    md += `### \`${tn}\`\n\n`
    md += `- Rough row count (n_live_tup): **${t.rough_rows}**\n`
    md += `- RLS enabled: **${t.rls_enabled ? 'YES' : 'no'}**\n\n`

    md += `**Columns**\n\n`
    md += `| # | column | type | nullable | default | generated |\n`
    md += `|---|--------|------|----------|---------|-----------|\n`
    for (const c of colsByTable[tn] || []) {
      const type = c.data_type === 'USER-DEFINED' ? c.udt_name : c.data_type
      md += `| ${c.ordinal_position} | \`${c.column_name}\` | ${esc(type)} | ${c.is_nullable} | ${esc(c.column_default || '')} | ${c.is_generated !== 'NEVER' ? esc(c.generation_expression || c.is_generated) : ''} |\n`
    }
    md += '\n'

    const tcons = consByTable[tn] || []
    const pk = tcons.filter(c => c.contype === 'p')
    const uq = tcons.filter(c => c.contype === 'u')
    const fk = tcons.filter(c => c.contype === 'f')
    const ck = tcons.filter(c => c.contype === 'c')

    if (pk.length) {
      md += `**Primary Key**\n\n`
      for (const c of pk) md += `- \`${c.conname}\` — ${c.definition}\n`
      md += '\n'
    }
    if (uq.length) {
      md += `**Unique Constraints** _(usable as PostgREST on_conflict targets — these are real CONSTRAINTs, not partial indexes)_\n\n`
      for (const c of uq) md += `- \`${c.conname}\` — ${c.definition}\n`
      md += '\n'
    }
    if (fk.length) {
      md += `**Foreign Keys**\n\n`
      for (const c of fk) {
        const del = ({ a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' })[c.confdeltype] || c.confdeltype
        const upd = ({ a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' })[c.confupdtype] || c.confupdtype
        md += `- \`${c.conname}\` — ${c.definition}  _(ON DELETE ${del}, ON UPDATE ${upd})_\n`
      }
      md += '\n'
    }
    if (ck.length) {
      md += `**Check Constraints**\n\n`
      for (const c of ck) md += `- \`${c.conname}\` — ${c.definition}\n`
      md += '\n'
    }

    const tidx = idxByTable[tn] || []
    if (tidx.length) {
      md += `**Indexes**\n\n`
      for (const i of tidx) {
        const partial = / WHERE /i.test(i.indexdef) ? '  **(PARTIAL — NOT usable as on_conflict target)**' : ''
        const kind = / USING (\w+)/i.exec(i.indexdef)?.[1] || 'btree'
        md += `- \`${i.indexname}\` (${kind})${partial}\n  \`${i.indexdef}\`\n`
      }
      md += '\n'
    }
  }
  return md
}

// ── §2 RLS policies ────────────────────────────────────────────────────────
const Q_POLICIES = `
  SELECT schemaname, tablename, policyname, permissive, roles, cmd,
         qual AS using_clause, with_check
  FROM pg_policies
  WHERE schemaname = 'public'
  ORDER BY tablename, policyname;
`
async function sectionPolicies() {
  log('§2 policies…')
  const rows = await q(Q_POLICIES)
  let md = `## §2. RLS Policies\n\nQuery:\n\n${codeBlock(Q_POLICIES)}\n\n`
  md += `Total policies: **${rows.length}**\n\n`

  // claim-path audit
  const userMeta = rows.filter(r => /user_metadata/i.test((r.using_clause || '') + ' ' + (r.with_check || '')))
  const appMeta  = rows.filter(r => /app_metadata/i.test((r.using_clause || '') + ' ' + (r.with_check || '')))

  md += `### Claim-path audit (post-2026-04-29 swap to \`app_metadata\`)\n\n`
  md += `- Policies referencing \`app_metadata\`: **${appMeta.length}** (CORRECT)\n`
  md += `- Policies referencing \`user_metadata\`: **${userMeta.length}** ${userMeta.length ? '**WRONG — must be migrated**' : '(none — clean)'}\n\n`
  if (userMeta.length) {
    for (const r of userMeta) md += `  - \`${r.tablename}.${r.policyname}\`\n`
    md += '\n'
  }

  const byTable = {}
  for (const r of rows) (byTable[r.tablename] ||= []).push(r)

  for (const t of Object.keys(byTable).sort()) {
    md += `### \`${t}\`\n\n`
    for (const p of byTable[t]) {
      md += `#### \`${p.policyname}\`\n\n`
      md += `- cmd: **${p.cmd}**\n`
      md += `- permissive: ${p.permissive}\n`
      md += `- roles: ${Array.isArray(p.roles) ? p.roles.join(', ') : p.roles}\n`
      const claim = /app_metadata/.test((p.using_clause||'') + ' ' + (p.with_check||'')) ? 'app_metadata'
        : /user_metadata/.test((p.using_clause||'') + ' ' + (p.with_check||'')) ? 'user_metadata (LEGACY)'
        : '—'
      md += `- claim path: ${claim}\n\n`
      if (p.using_clause) md += `**USING**\n\n${codeBlock(p.using_clause, 'sql')}\n\n`
      if (p.with_check)  md += `**WITH CHECK**\n\n${codeBlock(p.with_check, 'sql')}\n\n`
    }
  }
  return md
}

// ── §3 Functions / RPCs ────────────────────────────────────────────────────
const Q_FUNCS = `
  SELECT n.nspname  AS schema,
         p.proname  AS name,
         pg_get_function_identity_arguments(p.oid) AS args,
         pg_get_function_result(p.oid)             AS returns,
         CASE p.prosecdef WHEN true THEN 'DEFINER' ELSE 'INVOKER' END AS security,
         l.lanname AS lang,
         p.prosrc   AS body
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language  l ON l.oid = p.prolang
  WHERE n.nspname = 'public'
  ORDER BY p.proname;
`
const HOT_FUNCS = new Set([
  'atomic_next_ncf','validate_ticket_prices','increment_client_balance',
  'sync_merge_upsert','mint_license_jwt','rls_policy_audit',
  'set_business_id_from_jwt','enforce_business_id','log_activity',
  'ncf_sequence_decrement_if_last','submit_anecf','consume_nonce',
  'staff_verify_pin','license_validate','sync_pull_changes','sync_push_changes',
])
async function sectionFuncs() {
  log('§3 functions…')
  const rows = await q(Q_FUNCS)
  let md = `## §3. Functions / RPCs\n\nQuery:\n\n${codeBlock(Q_FUNCS)}\n\n`
  md += `Total functions: **${rows.length}**\n\n`
  for (const f of rows) {
    const hot = HOT_FUNCS.has(f.name) ? ' **HOT (called from web.js — DO NOT BREAK)**' : ''
    md += `### \`${f.name}(${f.args})\`${hot}\n\n`
    md += `- returns: \`${f.returns}\`\n`
    md += `- security: **${f.security}**\n`
    md += `- language: ${f.lang}\n\n`
    const body = f.body || ''
    const lines = body.split('\n')
    const shown = lines.length > 60 ? lines.slice(0, 60).join('\n') + `\n-- … (${lines.length - 60} more lines truncated)` : body
    md += `${codeBlock(shown, f.lang === 'sql' ? 'sql' : 'plpgsql')}\n\n`
  }
  return md
}

// ── §4 Triggers ────────────────────────────────────────────────────────────
const Q_TRIGGERS = `
  SELECT event_object_table AS table_name,
         trigger_name,
         action_timing,
         string_agg(event_manipulation, ',') AS events,
         action_statement,
         action_condition
  FROM information_schema.triggers
  WHERE trigger_schema = 'public'
  GROUP BY event_object_table, trigger_name, action_timing, action_statement, action_condition
  ORDER BY event_object_table, trigger_name;
`
async function sectionTriggers() {
  log('§4 triggers…')
  const rows = await q(Q_TRIGGERS)
  let md = `## §4. Triggers\n\nQuery:\n\n${codeBlock(Q_TRIGGERS)}\n\n`
  md += `Total triggers: **${rows.length}**\n\n`
  md += `| table | trigger | timing | events | action | condition |\n`
  md += `|-------|---------|--------|--------|--------|-----------|\n`
  for (const t of rows) {
    md += `| \`${t.table_name}\` | \`${t.trigger_name}\` | ${t.action_timing} | ${t.events} | ${esc(t.action_statement)} | ${esc(t.action_condition || '')} |\n`
  }
  md += '\n'
  return md
}

// ── §5 Realtime publication ────────────────────────────────────────────────
const Q_REALTIME = `
  SELECT schemaname, tablename
  FROM pg_publication_tables
  WHERE pubname = 'supabase_realtime'
  ORDER BY schemaname, tablename;
`
async function sectionRealtime() {
  log('§5 realtime…')
  const rows = await q(Q_REALTIME)
  let md = `## §5. Realtime Publication (\`supabase_realtime\`)\n\nQuery:\n\n${codeBlock(Q_REALTIME)}\n\n`
  md += `Total members: **${rows.length}**\n\n`
  md += `| schema | table |\n|--------|-------|\n`
  for (const r of rows) md += `| ${r.schemaname} | \`${r.tablename}\` |\n`
  return md + '\n'
}

// ── §6 JWT claim contract ──────────────────────────────────────────────────
async function sectionJWT() {
  log('§6 JWT claim contract…')
  // Mine policy text for app_metadata->'X' references.
  const rows = await q(`
    SELECT qual, with_check FROM pg_policies WHERE schemaname='public';
  `)
  const claims = new Map()
  const re = /app_metadata'?\s*->>?\s*'([a-z_][a-z0-9_]*)'/gi
  for (const r of rows) {
    const blob = (r.qual || '') + ' ' + (r.with_check || '')
    let m
    while ((m = re.exec(blob))) claims.set(m[1], (claims.get(m[1]) || 0) + 1)
  }
  let md = `## §6. JWT Claim Contract\n\n`
  md += `Every Terminal X RLS policy reads claims from \`auth.jwt() -> 'app_metadata'\` `
  md += `(the **2026-04-29 swap** killed all \`user_metadata\` reads — those would have been client-mutable).\n\n`
  md += `The \`mint-license-jwt\` Edge Function MUST emit every key listed below in \`app_metadata\` `
  md += `or RLS will silently deny.\n\n`
  md += `| claim key | # policies that read it |\n|-----------|-------------------------|\n`
  for (const [k, v] of [...claims.entries()].sort((a, b) => b[1] - a[1])) {
    md += `| \`${k}\` | ${v} |\n`
  }
  md += `\n_(Discovered automatically by regex against every \`pg_policies.qual\` and \`with_check\` blob.)_\n\n`
  md += `### Canonical claim list (manual — kept in sync with mint-license-jwt)\n\n`
  md += `- \`business_id\` — UUID of the business (primary tenant scope)\n`
  md += `- \`role\` — owner | manager | cfo | accountant | cashier | kitchen | none\n`
  md += `- \`license_key\` — TXL-XXXX-XXXX-XXXX\n`
  md += `- \`machine_id\` — HWID (SHA256 of MAC + hostname)\n`
  md += `- \`provider\` — license | staff_pin | web | demo\n\n`
  return md
}

// ── §7 Known PostgREST gotchas ─────────────────────────────────────────────
async function sectionGotchas() {
  return `## §7. Known PostgREST / supabase-js Gotchas

These have all bitten Terminal X in production. Future readers — check this list BEFORE filing a "data is missing" or "insert is silent" bug.

1. **Partial unique indexes can NOT be on_conflict targets.** PostgREST rejects them with \`there is no unique or exclusion constraint matching the ON CONFLICT specification\`. ALWAYS use a real \`UNIQUE CONSTRAINT\` (\`ALTER TABLE … ADD CONSTRAINT … UNIQUE (…)\`), not \`CREATE UNIQUE INDEX … WHERE …\`. See §1 indexes — anything tagged **PARTIAL** above is read-only as an on_conflict target.

2. **\`NULLS NOT DISTINCT\` 3-column unique constraints require ALL 3 columns in \`onConflict\`.** Omitting one causes silent duplicate inserts. Example: \`onConflict: 'business_id,supabase_id,deleted_at'\` not just \`business_id,supabase_id\`.

3. **Empty string for date / timestamp columns = HTTP 400.** \`{ created_at: '' }\` will fail. Send \`null\` or omit the key entirely. Common offender: form inputs that emit \`''\` when blank.

4. **\`.select().single()\` after \`.insert()\` with RLS-restricted SELECT-back returns PGRST116 / 400 even though the row landed.** When the SELECT policy doesn't match the freshly-inserted row, the server returns 400 — not the row. Workaround: \`.select().maybeSingle()\` and tolerate \`null\` on success, OR re-fetch by id, OR add a SELECT policy that matches the insert path.

5. **supabase-js v2 default is \`Prefer: return=minimal\`.** \`await sb.from('x').insert(row)\` returns \`{ data: null }\`. You only get the row back if you chain \`.select()\`. Code that destructures \`data.id\` from a bare \`.insert()\` is always broken — it just hasn't crashed yet because the path was never exercised.

6. **\`.or('col.is.null,col.not.like.X')\` matches ALL rows for destructive ops** (PostgREST quirk). Never use \`.or()\` with \`.delete()\` / \`.update()\` for "everything except X" semantics. Pattern: \`.select('id')\` first, filter in JS, \`.delete().in('id', ids)\`.

7. **Supabase silently drops unknown columns on INSERT/UPDATE.** Adding a column to SQLite without a matching Supabase migration means the field travels through sync.js but vanishes server-side. Always: change sync.js → write Supabase migration → apply BEFORE shipping the desktop release.

8. **Web INSERT without \`supabase_id\` = invisible to desktop pull.** Every web.js mutation MUST set \`supabase_id: crypto.randomUUID()\`. Desktop's pull query filters on \`supabase_id IS NOT NULL\`.

9. **Service role bypasses RLS.** Sync runs under service_role, so policy bugs only surface for anon / authenticated roles (i.e. real users). Always validate policies with a JWT-bearing client, never with service_role.

10. **Realtime publication must include the table** (see §5). Adding a table without \`ALTER PUBLICATION supabase_realtime ADD TABLE …\` means \`.channel().on('postgres_changes', …)\` silently never fires.

11. **PostgREST schema cache is per-pod and stale until reload.** After a migration, run \`scripts/reload-pgrst-schema.mjs\` or call \`NOTIFY pgrst, 'reload schema'\`. Otherwise new columns 400 with "column does not exist" until the next pod restart.

`
}

// ── header / footer ────────────────────────────────────────────────────────
function header() {
  return `# Terminal X — Supabase Schema Snapshot

> **Source of truth.** Read THIS before claiming a schema-related bug.
> If reality diverges from this file, regenerate the file and read it again.

- **Project ref:** \`${PROJECT_REF}\`
- **Snapshot taken:** ${new Date().toISOString()}
- **Generator:** \`scripts/schema-snapshot.mjs\` (re-run to refresh)
- **Read-only:** every query is a SELECT against \`pg_catalog\` / \`information_schema\` — no DDL.

## Regeneration

\`\`\`powershell
cd "A:\\Studio X HUB\\Terminal X"
node scripts/schema-snapshot.mjs           # overwrite this file
node scripts/schema-snapshot.mjs --diff    # show diff vs previous run
\`\`\`

Requires \`SUPABASE_ACCESS_TOKEN\` in \`.env\` (Management API personal access token).

## Sections

1. [Tables](#1-tables)
2. [RLS Policies](#2-rls-policies)
3. [Functions / RPCs](#3-functions--rpcs)
4. [Triggers](#4-triggers)
5. [Realtime Publication](#5-realtime-publication-supabase_realtime)
6. [JWT Claim Contract](#6-jwt-claim-contract)
7. [Known PostgREST Gotchas](#7-known-postgrest--supabase-js-gotchas)

---

`
}

function footer(stats) {
  return `\n---\n\n## Snapshot Stats\n\n` +
    `- Tables: **${stats.tables}** (RLS-enabled: ${stats.rlsTables})\n` +
    `- Columns: **${stats.columns}**\n` +
    `- Constraints: **${stats.constraints}** (PK: ${stats.pk}, UNIQUE: ${stats.uq}, FK: ${stats.fk}, CHECK: ${stats.ck})\n` +
    `- Indexes: **${stats.indexes}** (partial: ${stats.partialIdx})\n` +
    `- Policies: **${stats.policies}** (\`app_metadata\`: ${stats.appMeta}, \`user_metadata\`: ${stats.userMeta})\n` +
    `- Functions: **${stats.functions}**\n` +
    `- Triggers: **${stats.triggers}**\n` +
    `- Realtime members: **${stats.realtime}**\n\n` +
    `## Changelog\n\n` +
    `When re-running this script, append a brief entry below describing the diff. Use \`--diff\` to surface changes since the last snapshot.\n\n` +
    `| date | who | summary |\n|------|-----|---------|\n` +
    `| ${new Date().toISOString().slice(0,10)} | dataLEAKS | initial snapshot |\n`
}

async function gatherStats() {
  const tables = await q(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE c.relrowsecurity)::int AS rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relispartition=false;`)
  const cols = await q(`SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_schema='public';`)
  const cons = await q(`SELECT contype, COUNT(*)::int AS n FROM pg_constraint WHERE connamespace='public'::regnamespace GROUP BY contype;`)
  const idxs = await q(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE indexdef ILIKE '% WHERE %')::int AS partial FROM pg_indexes WHERE schemaname='public';`)
  const pols = await q(`SELECT COUNT(*)::int AS n,
    COUNT(*) FILTER (WHERE COALESCE(qual,'')||COALESCE(with_check,'') ILIKE '%app_metadata%')::int AS am,
    COUNT(*) FILTER (WHERE COALESCE(qual,'')||COALESCE(with_check,'') ILIKE '%user_metadata%')::int AS um
    FROM pg_policies WHERE schemaname='public';`)
  const fns  = await q(`SELECT COUNT(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public';`)
  const trgs = await q(`SELECT COUNT(DISTINCT (event_object_table||'.'||trigger_name))::int AS n FROM information_schema.triggers WHERE trigger_schema='public';`)
  const rt   = await q(`SELECT COUNT(*)::int AS n FROM pg_publication_tables WHERE pubname='supabase_realtime';`)

  const conMap = Object.fromEntries(cons.map(c => [c.contype, c.n]))
  return {
    tables: tables[0].n, rlsTables: tables[0].rls,
    columns: cols[0].n,
    constraints: (cons.reduce((a,c)=>a+c.n,0)),
    pk: conMap.p||0, uq: conMap.u||0, fk: conMap.f||0, ck: conMap.c||0,
    indexes: idxs[0].n, partialIdx: idxs[0].partial,
    policies: pols[0].n, appMeta: pols[0].am, userMeta: pols[0].um,
    functions: fns[0].n,
    triggers: trgs[0].n,
    realtime: rt[0].n,
  }
}

async function main() {
  // backup previous for --diff
  if (fs.existsSync(OUT_FILE)) fs.copyFileSync(OUT_FILE, PREV_FILE)

  const t0 = Date.now()
  const [s1, s2, s3, s4, s5, s6, s7, stats] = [
    await sectionTables(),
    await sectionPolicies(),
    await sectionFuncs(),
    await sectionTriggers(),
    await sectionRealtime(),
    await sectionJWT(),
    await sectionGotchas(),
    await gatherStats(),
  ]

  const out = header() + s1 + '\n' + s2 + '\n' + s3 + '\n' + s4 + '\n' + s5 + '\n' + s6 + '\n' + s7 + footer(stats)
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
  fs.writeFileSync(OUT_FILE, out, 'utf8')
  log(`wrote ${OUT_FILE} (${(out.length/1024).toFixed(1)} KB) in ${((Date.now()-t0)/1000).toFixed(1)}s`)
  log(`stats: ${JSON.stringify(stats)}`)

  if (FLAG_DIFF && fs.existsSync(PREV_FILE)) {
    const a = fs.readFileSync(PREV_FILE, 'utf8').split('\n')
    const b = out.split('\n')
    const added = b.filter(l => !a.includes(l)).length
    const removed = a.filter(l => !b.includes(l)).length
    log(`diff: +${added} / -${removed} lines vs previous snapshot`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
