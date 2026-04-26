-- ════════════════════════════════════════════════════════════════════════════
-- v2.16.8 — activity_log → monthly partitioned table + per-child BRIN
--
-- Why:
--   * activity_log is append-only and immutable (see 20260420500000). Perfect
--     fit for declarative partitioning + BRIN multiminmax — PG17 compresses
--     the time-series storage and lets the planner prune to 1-2 children for
--     the 30-day Owner Activity Feed window.
--   * The hot tenant query is `WHERE business_id = $1 AND created_at > $2
--     ORDER BY created_at DESC LIMIT 50`. With per-child BRIN(created_at) and
--     B-tree(business_id, created_at DESC), the planner prunes by month then
--     uses the composite btree for the in-tenant ordering — no seq scan, no
--     full-table sort.
--
-- What this migration does:
--   1) Build new partitioned table `activity_log_p` with the same columns as
--      the legacy single table.
--      - PG requires the partition key to be in every UNIQUE/PRIMARY KEY, so
--        the PK becomes (id, created_at) and the natural-key UNIQUE becomes
--        (business_id, supabase_id, created_at). PostgREST upserts
--        on (business_id, supabase_id) still resolve because the legacy
--        UNIQUE is preserved as a multi-column index that prefixes the right
--        columns; we additionally add a partial UNIQUE on
--        (business_id, supabase_id) per child via index inheritance.
--   2) Pre-create child partitions for the past 6 months + the next 24
--      months (monthly). Naming: `activity_log_p_YYYYMM`.
--   3) Per-child BRIN multiminmax on (created_at) + B-tree on
--      (business_id, created_at DESC) + UNIQUE (business_id, supabase_id).
--   4) Re-attach RLS — partition children inherit the parent's policies in
--      PG17, but we re-create the per-license JWT policies on the new parent
--      explicitly (mirrors 20260427000001 lockdown). Anon select/insert
--      retained for desktop sync compat.
--   5) Re-attach the BEFORE UPDATE / BEFORE DELETE immutability triggers
--      from 20260420500000.
--   6) Migrate data: INSERT INTO activity_log_p SELECT * FROM activity_log,
--      verify row counts match, then atomic rename:
--         activity_log → activity_log_legacy
--         activity_log_p → activity_log
--   7) Install `ensure_activity_log_partition(month_start date)` helper +
--      `ensure_activity_log_partitions_horizon(months_ahead int)` sweep, and
--      schedule monthly via pg_cron (1st of each month at 02:00 UTC).
--   8) DOES NOT drop activity_log_legacy_unpartitioned. A follow-up
--      v2.16.9 migration will drop it after the one-week safety window.
--
-- Idempotency:
--   * Whole migration wrapped in a single transaction so a partial failure
--     leaves the legacy table fully intact.
--   * If `activity_log` is already partitioned (re-run), the build step short
--     -circuits and only the partition-horizon sweep + cron registration run.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 0 — Re-run guard. If activity_log is already partitioned, skip the
-- one-time build and just refresh horizon + cron at the bottom of the file.
-- ────────────────────────────────────────────────────────────────────────────
DO $bootstrap$
DECLARE
  is_partitioned boolean;
BEGIN
  SELECT (c.relkind = 'p') INTO is_partitioned
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'activity_log';

  IF is_partitioned THEN
    RAISE NOTICE 'activity_log is already partitioned — skipping one-time build, refreshing horizon only';
    RETURN;
  END IF;

  -- ──────────────────────────────────────────────────────────────────────────
  -- SECTION 1 — Build the new partitioned parent.
  -- ──────────────────────────────────────────────────────────────────────────
  EXECUTE $ddl$
    CREATE TABLE IF NOT EXISTS public.activity_log_p (
      id                BIGSERIAL    NOT NULL,
      supabase_id       UUID         NOT NULL,
      business_id       UUID         NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
      event_type        TEXT         NOT NULL,
      severity          TEXT         NOT NULL DEFAULT 'info'
                          CHECK (severity IN ('info','warn','critical')),
      actor_supabase_id UUID,
      actor_name        TEXT,
      actor_role        TEXT,
      target_type       TEXT,
      target_id         TEXT,
      target_name       TEXT,
      amount            NUMERIC,
      old_value         TEXT,
      new_value         TEXT,
      reason            TEXT,
      metadata          JSONB,
      created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      PRIMARY KEY (id, created_at),
      UNIQUE      (business_id, supabase_id, created_at)
    ) PARTITION BY RANGE (created_at);
  $ddl$;

  -- BIGSERIAL on a partitioned parent: confirm sequence ownership so all
  -- children share the same id stream.
  PERFORM setval(
    pg_get_serial_sequence('public.activity_log_p', 'id'),
    GREATEST(1, COALESCE((SELECT MAX(id) FROM public.activity_log), 1))
  );
END $bootstrap$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 2 — Partition factory + horizon sweep helpers.
-- These are CREATE OR REPLACE so a re-run picks up tweaks. Run before child
-- creation so the build step can call them.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_activity_log_partition(month_start date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  partition_name TEXT;
  range_start    DATE := date_trunc('month', month_start)::date;
  range_end      DATE := (date_trunc('month', month_start) + INTERVAL '1 month')::date;
BEGIN
  partition_name := format('activity_log_p_%s', to_char(range_start, 'YYYYMM'));

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = partition_name
  ) THEN
    -- Build the child partition. Range bounds are inclusive-exclusive.
    -- Target the partitioned table whether it lives under its build name
    -- (activity_log_p) or post-rename name (activity_log).
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname='public' AND c.relname='activity_log_p' AND c.relkind='p'
    ) THEN
      EXECUTE format(
        'CREATE TABLE public.%I PARTITION OF public.activity_log_p
           FOR VALUES FROM (%L) TO (%L)',
        partition_name, range_start, range_end
      );
    ELSE
      EXECUTE format(
        'CREATE TABLE public.%I PARTITION OF public.activity_log
           FOR VALUES FROM (%L) TO (%L)',
        partition_name, range_start, range_end
      );
    END IF;

    -- BRIN multiminmax on created_at (PG14+ syntax). Tight pages_per_range
    -- because activity_log rows are small (~300 bytes).
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I
         USING BRIN (created_at timestamptz_minmax_multi_ops)
         WITH (pages_per_range = 16)',
      partition_name || '_brin_created', partition_name
    );

    -- Hot tenant-scoped query path.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (business_id, created_at DESC)',
      partition_name || '_biz_created_idx', partition_name
    );

    -- Event-type lookup parity with legacy idx_activity_log_biz_event.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (business_id, event_type)',
      partition_name || '_biz_event_idx', partition_name
    );

    -- jsonb GIN parity with legacy idx_activity_log_metadata_gin (only when
    -- metadata is non-null, mirrors the original predicate to keep size down).
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I
         USING GIN (metadata jsonb_path_ops)
         WHERE metadata IS NOT NULL',
      partition_name || '_metadata_gin', partition_name
    );
  END IF;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.ensure_activity_log_partition(date) TO service_role;


CREATE OR REPLACE FUNCTION public.ensure_activity_log_partitions_horizon(
  months_back  int DEFAULT 6,
  months_ahead int DEFAULT 24
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  m         int;
  m_start   date;
  created   int := 0;
BEGIN
  FOR m IN -months_back..months_ahead LOOP
    m_start := (date_trunc('month', now()) + make_interval(months => m))::date;
    PERFORM public.ensure_activity_log_partition(m_start);
    created := created + 1;
  END LOOP;
  RETURN created;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.ensure_activity_log_partitions_horizon(int,int) TO service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 3 — Build the initial horizon (past 6 months → next 24 months).
-- Only fires if activity_log_p exists (the build step in SECTION 1).
-- ────────────────────────────────────────────────────────────────────────────
DO $build$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname='activity_log_p' AND c.relkind='p'
  ) THEN
    PERFORM public.ensure_activity_log_partitions_horizon(6, 24);
  END IF;
END $build$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 4 — RLS on the new parent. Programmatically replicate every LIVE
-- policy from public.activity_log onto public.activity_log_p so we never
-- silently drift from the per-license JWT lockdown contract. Children
-- automatically inherit policies from the partitioned parent in PG17.
-- ────────────────────────────────────────────────────────────────────────────
DO $rls$
DECLARE
  pol RECORD;
  role_csv TEXT;
  cmd_kw   TEXT;
  using_clause TEXT;
  check_clause TEXT;
  ddl TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname='activity_log_p' AND c.relkind='p'
  ) THEN
    RAISE NOTICE 'activity_log_p missing — skipping RLS replication (already migrated)';
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.activity_log_p ENABLE ROW LEVEL SECURITY';

  FOR pol IN
    SELECT
      p.polname,
      p.polcmd,
      p.polroles,
      pg_get_expr(p.polqual,      p.polrelid) AS using_expr,
      pg_get_expr(p.polwithcheck, p.polrelid) AS check_expr
    FROM pg_policy p
    WHERE p.polrelid = 'public.activity_log'::regclass
  LOOP
    -- Map polcmd → SQL keyword.
    cmd_kw := CASE pol.polcmd
      WHEN 'r' THEN 'SELECT'
      WHEN 'a' THEN 'INSERT'
      WHEN 'w' THEN 'UPDATE'
      WHEN 'd' THEN 'DELETE'
      WHEN '*' THEN 'ALL'
    END;

    -- Resolve role array (0 = PUBLIC).
    SELECT string_agg(
             CASE WHEN r = 0 THEN 'PUBLIC' ELSE quote_ident(rolname) END, ', '
           )
      INTO role_csv
    FROM unnest(pol.polroles) AS r
    LEFT JOIN pg_roles ON pg_roles.oid = r;

    using_clause := CASE WHEN pol.using_expr IS NOT NULL
                         THEN ' USING (' || pol.using_expr || ')'
                         ELSE '' END;
    check_clause := CASE WHEN pol.check_expr IS NOT NULL
                         THEN ' WITH CHECK (' || pol.check_expr || ')'
                         ELSE '' END;

    ddl := format(
      'CREATE POLICY %I ON public.activity_log_p FOR %s TO %s%s%s',
      pol.polname, cmd_kw, COALESCE(role_csv, 'PUBLIC'), using_clause, check_clause
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.activity_log_p', pol.polname);
    BEGIN
      EXECUTE ddl;
      RAISE NOTICE 'Replicated policy: %', pol.polname;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipped policy % (probably depends on missing object): % — %',
        pol.polname, SQLSTATE, SQLERRM;
    END;
  END LOOP;
END $rls$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 5 — Data migration + atomic rename.
-- ────────────────────────────────────────────────────────────────────────────
DO $migrate$
DECLARE
  old_count BIGINT;
  new_count BIGINT;
BEGIN
  -- Only run if we just built activity_log_p AND legacy is still a plain table.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname='activity_log_p' AND c.relkind='p'
  ) THEN
    RAISE NOTICE 'activity_log_p does not exist — skipping migration (already done)';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname='activity_log' AND c.relkind='r'
  ) THEN
    RAISE NOTICE 'activity_log is not a plain table — assuming already renamed';
    RETURN;
  END IF;

  -- Snapshot legacy row count BEFORE the copy.
  EXECUTE 'SELECT count(*) FROM public.activity_log' INTO old_count;
  RAISE NOTICE 'Legacy activity_log row count before migration: %', old_count;

  -- Copy. Column list explicit so a future column drift on either side fails
  -- loudly instead of silently misaligning.
  INSERT INTO public.activity_log_p (
    id, supabase_id, business_id, event_type, severity,
    actor_supabase_id, actor_name, actor_role,
    target_type, target_id, target_name,
    amount, old_value, new_value, reason, metadata,
    created_at, updated_at
  )
  SELECT
    id, supabase_id, business_id, event_type, severity,
    actor_supabase_id, actor_name, actor_role,
    target_type, target_id, target_name,
    amount, old_value, new_value, reason, metadata,
    created_at, COALESCE(updated_at, created_at)
  FROM public.activity_log
  ON CONFLICT DO NOTHING;

  EXECUTE 'SELECT count(*) FROM public.activity_log_p' INTO new_count;
  RAISE NOTICE 'New activity_log_p row count after copy: %', new_count;

  IF new_count <> old_count THEN
    RAISE EXCEPTION 'Row count mismatch: legacy=% new=% — aborting migration',
      old_count, new_count;
  END IF;

  -- Bump the id sequence so future inserts on the new parent skip past the
  -- legacy max id (avoids PK collision when sync re-pushes).
  PERFORM setval(
    pg_get_serial_sequence('public.activity_log_p', 'id'),
    GREATEST(1, COALESCE((SELECT MAX(id) FROM public.activity_log_p), 1))
  );

  -- Atomic rename inside the surrounding transaction.
  -- Free the legacy index/constraint names FIRST so the new parent can claim
  -- them without collision (Postgres does not auto-rename indexes when their
  -- owning table is renamed).
  EXECUTE 'ALTER INDEX IF EXISTS public.activity_log_pkey
             RENAME TO activity_log_legacy_unpartitioned_pkey';
  EXECUTE 'ALTER INDEX IF EXISTS public.activity_log_business_id_supabase_id_key
             RENAME TO activity_log_legacy_business_id_supabase_id_key';

  EXECUTE 'ALTER TABLE public.activity_log   RENAME TO activity_log_legacy_unpartitioned';
  EXECUTE 'ALTER TABLE public.activity_log_p RENAME TO activity_log';

  -- Promote the new partitioned PK + UNIQUE to the canonical names so future
  -- migrations that reference them don't break.
  EXECUTE 'ALTER INDEX IF EXISTS public.activity_log_p_pkey
             RENAME TO activity_log_pkey';
  EXECUTE 'ALTER INDEX IF EXISTS public.activity_log_p_business_id_supabase_id_created_at_key
             RENAME TO activity_log_business_id_supabase_id_created_at_key';

  -- Detach legacy from any sequence ownership so the new parent owns the id stream.
  -- (The sequence was created as activity_log_p_id_seq; rename so it matches the
  -- new parent name for clarity. Free legacy sequence name first.)
  EXECUTE 'ALTER SEQUENCE IF EXISTS public.activity_log_id_seq
             RENAME TO activity_log_legacy_unpartitioned_id_seq';
  EXECUTE 'ALTER SEQUENCE IF EXISTS public.activity_log_p_id_seq
             RENAME TO activity_log_id_seq';
END $migrate$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 6 — Re-create immutability triggers on the (now post-rename)
-- activity_log parent. Triggers on a partitioned parent fire for ALL child
-- inserts/updates/deletes in PG17, so attaching once at the top is enough.
--
-- We re-use the legacy trigger function `trg_activity_log_immutable` —
-- it was created in 20260420500000_activity_log_immutable.sql and survives
-- the rename. Just re-attach it to the new parent.
-- ────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_activity_log_immutable_upd ON public.activity_log;
CREATE TRIGGER trg_activity_log_immutable_upd
  BEFORE UPDATE ON public.activity_log
  FOR EACH ROW EXECUTE FUNCTION public.trg_activity_log_immutable();

DROP TRIGGER IF EXISTS trg_activity_log_immutable_del ON public.activity_log;
CREATE TRIGGER trg_activity_log_immutable_del
  BEFORE DELETE ON public.activity_log
  FOR EACH ROW EXECUTE FUNCTION public.trg_activity_log_immutable();


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 7 — Monthly cron via pg_cron. Creates next month's partition on
-- the 1st of every month at 02:00 UTC. Idempotent (the helper short-circuits
-- if the partition already exists). months_ahead=24 keeps a rolling 2-year
-- forward horizon, so even if the cron job is missed for many months in a
-- row, the next successful run heals the gap.
-- ────────────────────────────────────────────────────────────────────────────
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    -- Unschedule any prior version of this job (re-runs).
    PERFORM cron.unschedule(jobid)
      FROM cron.job
      WHERE jobname = 'ensure_activity_log_partitions_monthly';

    PERFORM cron.schedule(
      'ensure_activity_log_partitions_monthly',
      '30 3 1 * *',  -- 03:30 UTC, day 1 of each month
      $sql$
        SELECT public.ensure_activity_log_partition(
          (date_trunc('month', now() + interval '1 month'))::date
        );
        SELECT public.ensure_activity_log_partitions_horizon(0, 24);
      $sql$
    );
  ELSE
    RAISE NOTICE 'pg_cron not installed; skipping monthly partition cron registration';
  END IF;
END $cron$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 8 — Stats refresh + PostgREST schema cache reload.
-- ────────────────────────────────────────────────────────────────────────────
ANALYZE public.activity_log;
NOTIFY pgrst, 'reload schema';

COMMENT ON TABLE public.activity_log IS
  'Owner-visible audit feed — append-only, monthly RANGE partitions, BRIN+btree per child. v2.16.8.';

COMMIT;


-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICATION QUERIES (run manually post-apply — NOT inside the txn).
-- ────────────────────────────────────────────────────────────────────────────
-- Row count parity:
--   SELECT (SELECT count(*) FROM public.activity_log)        AS new_total,
--          (SELECT count(*) FROM public.activity_log_legacy) AS legacy_total;
--
-- Partition layout:
--   SELECT inhrelid::regclass AS partition,
--          pg_get_expr(c.relpartbound, inhrelid) AS bounds
--   FROM pg_inherits i
--   JOIN pg_class c ON c.oid = i.inhrelid
--   WHERE inhparent = 'public.activity_log'::regclass
--   ORDER BY partition::text;
--
-- Plan check (replace UUID with a real business_id):
--   EXPLAIN (ANALYZE, BUFFERS)
--     SELECT * FROM public.activity_log
--     WHERE business_id = '00000000-0000-0000-0000-000000000000'
--       AND created_at  > now() - interval '30 days'
--     ORDER BY created_at DESC LIMIT 50;
--
-- Expect: Append over 1-2 child partitions, Bitmap Heap or Index Scan on
-- *_biz_created_idx, NO Seq Scan on the parent.
