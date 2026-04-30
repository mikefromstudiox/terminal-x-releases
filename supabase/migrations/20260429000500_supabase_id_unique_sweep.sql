-- ════════════════════════════════════════════════════════════════════════════
-- 20260429000500_supabase_id_unique_sweep.sql
--
-- Standardize every sync table on `UNIQUE (supabase_id)` so PostgREST upserts
-- with `onConflict: 'supabase_id'` work uniformly. Today many tables only
-- carry `(business_id, supabase_id)` — PostgREST refuses to use that as a
-- single-column conflict target. The lending queue (packages/data/lendingQueue.js
-- line 197) dispatches to many tables generically with `onConflict: 'supabase_id'`
-- and silently fails or duplicates on every table without a single-col
-- constraint.
--
-- supabase_id is a UUID v4 generated client-side via crypto.randomUUID().
-- The collision probability is mathematically zero, so the constraint is a
-- no-op for data integrity but provides the exact PostgREST surface our
-- upsert callers expect.
--
-- Skipped:
--   - activity_log + activity_log_p_*  (partitioned — unique constraint
--     would require including partition key)
--   - tables that already carry a single-col UNIQUE (supabase_id)
--
-- The DO block iterates all candidate tables and only adds the constraint
-- if no duplicate `supabase_id` rows exist (it will RAISE NOTICE and skip
-- on dups so the migration never fails atomically).
--
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  rec RECORD;
  dup_count INT;
  cname TEXT;
BEGIN
  FOR rec IN
    WITH tables_with_supabase_id AS (
      SELECT c.table_name
        FROM information_schema.columns c
        JOIN information_schema.tables t USING (table_schema, table_name)
       WHERE c.table_schema='public' AND c.column_name='supabase_id'
         AND t.table_type='BASE TABLE'
         AND c.table_name NOT LIKE 'activity_log%'
    ),
    single_col_unique_supabase AS (
      SELECT t.relname AS table_name
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname='public' AND c.contype='u' AND array_length(c.conkey,1)=1
         AND (SELECT a.attname FROM pg_attribute a WHERE a.attrelid=t.oid AND a.attnum=c.conkey[1])='supabase_id'
    )
    SELECT t.table_name
      FROM tables_with_supabase_id t
      LEFT JOIN single_col_unique_supabase s USING (table_name)
     WHERE s.table_name IS NULL
     ORDER BY 1
  LOOP
    -- Check for dups before adding the constraint. UUIDs shouldn't collide
    -- but defensively guard against any bad seed/import data.
    EXECUTE format('SELECT count(*) FROM (SELECT supabase_id FROM public.%I WHERE supabase_id IS NOT NULL GROUP BY supabase_id HAVING count(*) > 1) d', rec.table_name)
      INTO dup_count;
    IF dup_count > 0 THEN
      RAISE NOTICE 'skip %: % duplicate supabase_id rows', rec.table_name, dup_count;
      CONTINUE;
    END IF;

    cname := rec.table_name || '_supabase_id_uniq';
    -- Constraint may already exist with a different name (e.g.
    -- `<table>_supabase_id_key` from generated SQL). Check by structure.
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname='public' AND t.relname = rec.table_name
         AND c.contype='u' AND array_length(c.conkey,1)=1
         AND (SELECT a.attname FROM pg_attribute a WHERE a.attrelid=t.oid AND a.attnum=c.conkey[1])='supabase_id'
    ) THEN
      BEGIN
        EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (supabase_id)', rec.table_name, cname);
        RAISE NOTICE 'added UNIQUE(supabase_id) on %', rec.table_name;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'failed on %: %', rec.table_name, SQLERRM;
      END;
    END IF;
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- Targeted constraints needed by specific contabilidad.js callers.
-- ────────────────────────────────────────────────────────────────────────────

-- accounting_comprobantes — used in packages/data/contabilidad.js:1172
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.accounting_comprobantes'::regclass
       AND conname='accounting_comprobantes_dedupe_uniq'
  ) THEN
    -- NULLS NOT DISTINCT: ncf and fecha_comprobante can be NULL for some
    -- legacy rows; we want NULLs to collide so retries are idempotent.
    ALTER TABLE public.accounting_comprobantes
      ADD CONSTRAINT accounting_comprobantes_dedupe_uniq
      UNIQUE NULLS NOT DISTINCT (business_id, accounting_client_id, kind, ncf, fecha_comprobante);
  END IF;
END $$;
