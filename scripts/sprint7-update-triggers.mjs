#!/usr/bin/env node
// Sprint 7 — BEFORE UPDATE triggers on every synced table so `updated_at`
// advances automatically when an UPDATE statement doesn't explicitly set it.
//
// Without this, LWW sync silently drops propagation: desktop/web mutate a
// row without touching updated_at, the row is skipped by the next pull's
// `updated_at > last_pull_at` cursor, and the opposite end stays stale.
//
// Audit finding (2026-04-19 Y-H1..H4) enumerated 10 tables that only had
// BEFORE INSERT triggers from migration 20260414000001. This migration:
//   1. Creates a shared function `trg_touch_updated_at()`.
//   2. Cross-references electron/sync.js SYNC_TABLES with pg_trigger, then
//      attaches a BEFORE UPDATE trigger on every synced table missing one.
//   3. Skips `users` (VIEW on staff), app_settings (device-local subset),
//      and tables we don't actually UPDATE from sync writes.
//
// Idempotent: uses CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const APPLY = process.argv.includes('--apply')

const ENV = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .map(l => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
    .filter(Boolean)
    .map(m => [m[1], m[2].replace(/^"(.*)"$/, '$1')])
)
const ref = new URL(ENV.SUPABASE_URL).hostname.split('.')[0]

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ENV.SUPABASE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })
  const text = await r.text()
  if (!r.ok) {
    console.error(`SQL FAILED:\n${sql.slice(0, 200)}\n-> ${text.slice(0, 400)}`)
    return null
  }
  try { return JSON.parse(text) } catch { return text }
}

// Tables flagged by the 2026-04-19 sync audit (Y-H1..H4) as missing BEFORE
// UPDATE trigger but having BEFORE INSERT from the 2026-04-14 hardening.
const AUDIT_TABLES = [
  'kds_events',
  'mesas',
  'modificadores',
  'service_modificadores',
  'ticket_item_modificadores',
  'subscriptions',
  'service_packages',
  'projects',
  'client_service_rates',
  'client_item_prices',
]

// Every table in electron/sync.js SYNC_TABLES that carries updated_at and
// is pushed/pulled. `users` is excluded (it's a VIEW on staff; staff is
// included). `app_settings` is device-local keys too and handled by its
// own whitelist, but business-level settings also get updated_at — include
// it so the row-level touch fires.
const ALL_SYNCED_TABLES = [
  // Phase 1 — root entities
  'services',
  'clients',
  'inventory_items',
  'ncf_sequences',
  'empleados',
  'categorias_servicio',
  'mesas',
  'modificadores',
  'vehicles',
  'service_bays',
  'stylist_schedules',
  'staff',                // users VIEW → staff base
  'activity_log',
  'service_modificadores',
  // Phase 2 — transactional
  'tickets',
  'work_orders',
  'appointments',
  'loans',
  'ticket_items',
  'ticket_item_modificadores',
  'kds_events',
  'queue',
  'washer_commissions',
  'seller_commissions',
  'cajero_commissions',
  'credit_payments',
  'cuadre_caja',
  'caja_chica',
  'notas_credito',
  'inventory_transactions',
  'compras_607',
  'adelantos',
  'payroll_runs',
  'salary_changes',
  'ecf_submissions',
  'queue_deletions',
  'memberships',
  'wash_combos',
  'subscriptions',
  'service_packages',
  'projects',
  'client_service_rates',
  'client_item_prices',
  'loan_payments',
  'pawn_items',
  'loan_schedule',
  'collections_log',
  'inventory_counts',
  'inventory_count_items',
  'app_settings',
]

const MIGRATION_FILENAME = '20260419300000_sync_update_triggers.sql'
const MIGRATION_PATH = path.join(ROOT, 'supabase', 'migrations', MIGRATION_FILENAME)

function renderMigration() {
  const lines = []
  lines.push('-- 20260419300000_sync_update_triggers.sql')
  lines.push('-- Sprint 7 — BEFORE UPDATE triggers on every synced table.')
  lines.push('--')
  lines.push('-- The 2026-04-14 hardening added BEFORE INSERT triggers so updated_at is')
  lines.push('-- never NULL, but did NOT add BEFORE UPDATE. When an UPDATE statement')
  lines.push('-- omits updated_at, the column keeps its old value and LWW sync skips')
  lines.push('-- the row (pull cursor is `updated_at > last_pull_at`). Findings Y-H1..H4')
  lines.push('-- of the 2026-04-19 audit trace this to 10 tables minimum; this migration')
  lines.push('-- applies the fix uniformly to every synced table.')
  lines.push('')
  lines.push('BEGIN;')
  lines.push('')
  lines.push('-- Shared tick function. SECURITY DEFINER not needed — trigger fires as')
  lines.push('-- row owner, and NEW.updated_at is a simple column assignment.')
  lines.push('CREATE OR REPLACE FUNCTION public.trg_touch_updated_at()')
  lines.push('RETURNS trigger')
  lines.push('LANGUAGE plpgsql')
  lines.push('AS $$')
  lines.push('BEGIN')
  lines.push("  -- Always advance on UPDATE so LWW sync sees the row. If the caller")
  lines.push("  -- explicitly supplied a newer value (e.g., a client-side clock),")
  lines.push("  -- honor it; otherwise stamp now().")
  lines.push('  IF NEW.updated_at IS NULL OR NEW.updated_at <= OLD.updated_at THEN')
  lines.push('    NEW.updated_at := now();')
  lines.push('  END IF;')
  lines.push('  RETURN NEW;')
  lines.push('END;')
  lines.push('$$;')
  lines.push('')
  lines.push('DO $do$')
  lines.push('DECLARE')
  lines.push('  t text;')
  lines.push('  targets text[] := ARRAY[')
  const list = ALL_SYNCED_TABLES.map(t => `    '${t}'`).join(',\n')
  lines.push(list)
  lines.push('  ];')
  lines.push('BEGIN')
  lines.push('  FOREACH t IN ARRAY targets LOOP')
  lines.push("    -- Skip anything that isn't an actual base table with updated_at.")
  lines.push('    IF NOT EXISTS (')
  lines.push('      SELECT 1 FROM information_schema.columns')
  lines.push("       WHERE table_schema='public' AND table_name=t AND column_name='updated_at'")
  lines.push('    ) THEN CONTINUE; END IF;')
  lines.push('    IF NOT EXISTS (')
  lines.push('      SELECT 1 FROM information_schema.tables')
  lines.push("       WHERE table_schema='public' AND table_name=t AND table_type='BASE TABLE'")
  lines.push('    ) THEN CONTINUE; END IF;')
  lines.push('')
  lines.push("    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_touch_updated_at ON public.%I', t, t);")
  lines.push("    EXECUTE format('CREATE TRIGGER trg_%I_touch_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.trg_touch_updated_at()', t, t);")
  lines.push('  END LOOP;')
  lines.push('END')
  lines.push('$do$;')
  lines.push('')
  lines.push('COMMIT;')
  lines.push('')
  return lines.join('\n')
}

async function run() {
  console.log(`\n=== Sprint 7 — BEFORE UPDATE triggers ===`)
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`)

  // Write migration file
  const sql = renderMigration()
  fs.writeFileSync(MIGRATION_PATH, sql)
  console.log(`Wrote ${MIGRATION_FILENAME} (${sql.length} bytes, ${ALL_SYNCED_TABLES.length} candidate tables)`)

  if (!APPLY) {
    console.log('Dry-run complete. Re-run with --apply to execute against prod.')
    return
  }

  // ── BEFORE count ──
  const auditList = AUDIT_TABLES.map(t => `'${t}'`).join(',')
  const beforeAudit = await q(`
    SELECT c.relname AS tbl, tg.tgname
      FROM pg_trigger tg
      JOIN pg_class c ON c.oid = tg.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname IN (${auditList})
       AND tg.tgname LIKE '%updated_at%'
       AND NOT tg.tgisinternal
       AND (tg.tgtype & 16) = 16
     ORDER BY c.relname, tg.tgname;
  `)
  console.log(`\nBEFORE apply — UPDATE triggers on audit tables: ${beforeAudit?.length ?? 0}`)
  for (const row of (beforeAudit || [])) console.log(`  - ${row.tbl}.${row.tgname}`)

  const beforeAll = await q(`
    SELECT COUNT(*)::int AS n
      FROM pg_trigger tg
      JOIN pg_class c ON c.oid = tg.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND tg.tgname LIKE '%touch_updated_at%'
       AND NOT tg.tgisinternal;
  `)
  console.log(`BEFORE apply — total trg_touch_updated_at triggers: ${beforeAll?.[0]?.n ?? 0}`)

  // ── APPLY ──
  console.log('\nApplying migration...')
  const res = await q(sql)
  if (res === null) {
    console.error('Apply FAILED.')
    process.exit(1)
  }
  console.log('Apply OK.')

  // ── VERIFY ──
  const afterAudit = await q(`
    SELECT c.relname AS tbl, tg.tgname
      FROM pg_trigger tg
      JOIN pg_class c ON c.oid = tg.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname IN (${auditList})
       AND tg.tgname LIKE '%touch_updated_at%'
       AND NOT tg.tgisinternal
       AND (tg.tgtype & 16) = 16
     ORDER BY c.relname;
  `)
  console.log(`\nAFTER apply — UPDATE triggers on audit tables: ${afterAudit?.length ?? 0}/${AUDIT_TABLES.length}`)
  const covered = new Set((afterAudit || []).map(r => r.tbl))
  for (const t of AUDIT_TABLES) {
    console.log(`  ${covered.has(t) ? 'OK  ' : 'MISS'}  ${t}`)
  }

  const afterAll = await q(`
    SELECT COUNT(*)::int AS n
      FROM pg_trigger tg
      JOIN pg_class c ON c.oid = tg.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND tg.tgname LIKE '%touch_updated_at%'
       AND NOT tg.tgisinternal;
  `)
  console.log(`AFTER apply — total trg_touch_updated_at triggers: ${afterAll?.[0]?.n ?? 0}`)

  // List all tables with BEFORE UPDATE updated_at coverage (touch + legacy)
  const everywhere = await q(`
    SELECT c.relname AS tbl, tg.tgname
      FROM pg_trigger tg
      JOIN pg_class c ON c.oid = tg.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND tg.tgname LIKE '%updated_at%'
       AND NOT tg.tgisinternal
       AND (tg.tgtype & 16) = 16
     ORDER BY c.relname, tg.tgname;
  `)
  console.log(`\nFull BEFORE UPDATE updated_at trigger inventory (${everywhere?.length ?? 0}):`)
  for (const row of (everywhere || [])) console.log(`  - ${row.tbl}.${row.tgname}`)
}

run().catch(e => { console.error(e); process.exit(1) })
