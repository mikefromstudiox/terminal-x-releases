-- 2026_04_27_v21612_merge_natural_keys.sql
-- Punch-list item #3: MERGE RPC for ncf_sequences / app_settings was
-- falling through with 23505 (duplicate key) when a desktop pushed a row
-- with a NEW supabase_id but a (business_id, type) or (business_id, key)
-- combo that already existed cloud-side. The MERGE matched on supabase_id
-- only — natural-key collision passed unhandled into INSERT, which 23505d.
--
-- Fix: extend sync_merge_upsert with an optional p_natural_key column.
-- When provided, MERGE matches on (business_id, supabase_id) OR
-- (business_id, p_natural_key). On natural-key match, supabase_id is
-- HEALED to the cloud's existing value so future syncs converge on a
-- single canonical row.
--
-- Idempotent. Backwards-compatible (clients that don't pass p_natural_key
-- get the original behaviour).

CREATE OR REPLACE FUNCTION public.sync_merge_upsert(
  p_table        text,
  p_rows         jsonb,
  p_business_id  uuid,
  p_append_only  boolean DEFAULT false,
  p_natural_key  text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_allowed CONSTANT text[] := ARRAY[
    'activity_log','adelantos','app_settings','appointment_reminders','appointments',
    'aseguradoras','bank_preapprovals','caja_chica','cajero_commissions',
    'carniceria_corte_categories','carniceria_scales','categorias_servicio',
    'client_item_prices','client_memberships','client_service_rates','clients',
    'collections_log','credit_payments','cuadre_caja','ecf_queue','ecf_submissions',
    'empleados','inventory_count_items','inventory_counts','inventory_discards',
    'inventory_freshness_log','inventory_items','inventory_oversells','inventory_transactions',
    'kds_events','leads','loan_payments','loan_schedule','loans','loyalty_transactions',
    'mechanic_commissions','membership_redemptions','memberships','mesas','modificadores',
    'ncf_sequences','notas_credito','parts_orders','pawn_items','payroll_runs',
    'projects','promotion_items','promotions','queue','queue_deletions','recurring_orders',
    'restaurant_reservations','salary_changes','sales_deals','seller_commissions',
    'service_bays','service_modificadores','service_packages','service_recipe_items',
    'services','staff','stylist_schedules','subscriptions','suppliers','test_drives',
    'ticket_item_modificadores','ticket_items','tickets','vehicle_documents',
    'vehicle_inventory','vehicle_reservations','vehicle_titulo','vehicle_warranties',
    'vehicles','wash_combos','washer_commissions','work_order_photos','work_orders'
  ];
  -- Allowlist of natural-key columns by table. Hardcoded server-side so a
  -- malicious client can't pass an arbitrary column name (SQL-injection-safe
  -- via quote_ident, but defense-in-depth).
  v_nk_allowed CONSTANT jsonb := jsonb_build_object(
    'ncf_sequences', 'type',
    'app_settings',  'key',
    'aseguradoras',  'nombre',
    'suppliers',     'nombre',
    'carniceria_scales', 'nombre',
    'recurring_orders',  'nombre',
    'promotions',    'name'
  );
  v_row_keys      text[];
  v_typed_cols    text;
  v_insert_cols   text;
  v_set_clause    text;
  v_sql           text;
  v_inserted      int := 0;
  v_updated       int := 0;
  v_nk_col        text;  -- validated natural-key column name (NULL = no NK match)
BEGIN
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'sync_merge_upsert: p_business_id is required';
  END IF;
  IF NOT (p_table = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'sync_merge_upsert: table % not in allowlist', p_table;
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN jsonb_build_object('inserted', 0, 'updated', 0);
  END IF;

  -- Validate optional natural key against the allowlist for this table.
  IF p_natural_key IS NOT NULL THEN
    IF (v_nk_allowed ->> p_table) = p_natural_key THEN
      v_nk_col := p_natural_key;
    ELSE
      -- Caller-passed natural key not allowed for this table; ignore silently
      -- (legacy on_conflict path was supabase_id-only anyway).
      v_nk_col := NULL;
    END IF;
  END IF;

  SELECT array_agg(k) INTO v_row_keys FROM jsonb_object_keys(p_rows->0) AS k;

  WITH cols AS (
    SELECT a.attname,
           pg_catalog.format_type(a.atttypid, a.atttypmod) AS typ,
           a.attnum
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = p_table
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.attname = ANY (v_row_keys)
      AND a.attname NOT IN ('business_id','id')
  )
  SELECT
    string_agg(format('%I %s', attname, typ), ', ' ORDER BY attnum),
    string_agg(quote_ident(attname),          ', ' ORDER BY attnum),
    string_agg(format('%I = src.%I', attname, attname), ', ' ORDER BY attnum)
      FILTER (WHERE attname NOT IN ('supabase_id','created_at'))
  INTO v_typed_cols, v_insert_cols, v_set_clause
  FROM cols;

  IF v_typed_cols IS NULL THEN
    RAISE EXCEPTION 'sync_merge_upsert: no matching columns for table %', p_table;
  END IF;

  IF p_append_only THEN
    -- append-only path unchanged — natural key isn't meaningful for
    -- audit-trail tables (activity_log) where every insert is intended.
    v_sql := format($q$
      WITH src AS (
        SELECT %1$L::uuid AS business_id, j.*
        FROM jsonb_to_recordset($1) AS j(%2$s)
      ),
      m AS (
        MERGE INTO public.%3$I tgt
        USING src
        ON tgt.business_id = src.business_id AND tgt.supabase_id = src.supabase_id
        WHEN NOT MATCHED THEN
          INSERT (business_id, %4$s) VALUES (src.business_id, %5$s)
        RETURNING merge_action() AS act
      )
      SELECT
        count(*) FILTER (WHERE act = 'INSERT')::int,
        count(*) FILTER (WHERE act = 'UPDATE')::int
      FROM m
    $q$,
      p_business_id,
      v_typed_cols,
      p_table,
      v_insert_cols,
      (SELECT string_agg(format('src.%I', k), ', ') FROM unnest(string_to_array(v_insert_cols, ', ')) AS k)
    );
  ELSIF v_nk_col IS NOT NULL THEN
    -- Natural-key path: match on (business_id, supabase_id) OR
    -- (business_id, natural_key). On natural-key-only match, also UPDATE
    -- the supabase_id to heal local→cloud drift.
    v_sql := format($q$
      WITH src AS (
        SELECT %1$L::uuid AS business_id, j.*
        FROM jsonb_to_recordset($1) AS j(%2$s)
      ),
      m AS (
        MERGE INTO public.%3$I tgt
        USING src
        ON tgt.business_id = src.business_id
           AND (tgt.supabase_id = src.supabase_id OR tgt.%6$I = src.%6$I)
        WHEN MATCHED THEN UPDATE SET supabase_id = src.supabase_id, %4$s
        WHEN NOT MATCHED THEN
          INSERT (business_id, %5$s) VALUES (src.business_id, %7$s)
        RETURNING merge_action() AS act
      )
      SELECT
        count(*) FILTER (WHERE act = 'INSERT')::int,
        count(*) FILTER (WHERE act = 'UPDATE')::int
      FROM m
    $q$,
      p_business_id,
      v_typed_cols,
      p_table,
      COALESCE(v_set_clause, 'supabase_id = src.supabase_id'),
      v_insert_cols,
      v_nk_col,
      (SELECT string_agg(format('src.%I', k), ', ')
         FROM unnest(string_to_array(replace(v_insert_cols, ' ', ''), ',')) AS k)
    );
  ELSE
    -- Original supabase_id-only path (backwards compatible).
    v_sql := format($q$
      WITH src AS (
        SELECT %1$L::uuid AS business_id, j.*
        FROM jsonb_to_recordset($1) AS j(%2$s)
      ),
      m AS (
        MERGE INTO public.%3$I tgt
        USING src
        ON tgt.business_id = src.business_id AND tgt.supabase_id = src.supabase_id
        WHEN MATCHED THEN UPDATE SET %4$s
        WHEN NOT MATCHED THEN
          INSERT (business_id, %5$s) VALUES (src.business_id, %6$s)
        RETURNING merge_action() AS act
      )
      SELECT
        count(*) FILTER (WHERE act = 'INSERT')::int,
        count(*) FILTER (WHERE act = 'UPDATE')::int
      FROM m
    $q$,
      p_business_id,
      v_typed_cols,
      p_table,
      COALESCE(v_set_clause, 'supabase_id = src.supabase_id'),
      v_insert_cols,
      (SELECT string_agg(format('src.%I', k), ', ')
         FROM unnest(string_to_array(replace(v_insert_cols, ' ', ''), ',')) AS k)
    );
  END IF;

  EXECUTE v_sql INTO v_inserted, v_updated USING p_rows;

  RETURN jsonb_build_object(
    'inserted', COALESCE(v_inserted, 0),
    'updated',  COALESCE(v_updated, 0),
    'table',    p_table,
    'count',    jsonb_array_length(p_rows),
    'natural_key_used', v_nk_col
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.sync_merge_upsert(text, jsonb, uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_merge_upsert(text, jsonb, uuid, boolean, text)
  TO service_role, authenticated;

-- Drop the old 4-arg signature now that the 5-arg one is live and
-- backward-compatible (default p_natural_key=NULL preserves prior behaviour).
DROP FUNCTION IF EXISTS public.sync_merge_upsert(text, jsonb, uuid, boolean);

NOTIFY pgrst, 'reload schema';
