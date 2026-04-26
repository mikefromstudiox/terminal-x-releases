-- 2026_04_27_v2168_recovery.sql
-- Cloud-side fixes for the v2.16.8 sync issues surfaced by Studio X Car Wash testing:
--   (a) work_order_photos.updated_at column missing → pull 400 42703
--   (b) sync_merge_upsert allowlist missing 'staff' → MERGE rejects, falls back
--       to legacy PostgREST upsert which itself fails RLS for some configs
--   (c) PostgREST schema cache stale for services.in_stock → push 400 PGRST204
--   (d) reload schema after the above
--
-- Idempotent. Safe to re-run.

-- ─── (a) work_order_photos.updated_at + auto-bump trigger ────────────────────
ALTER TABLE public.work_order_photos
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public._touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS work_order_photos_updated_at ON public.work_order_photos;
CREATE TRIGGER work_order_photos_updated_at
  BEFORE UPDATE ON public.work_order_photos
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

-- Backfill any existing rows where the column was just added.
UPDATE public.work_order_photos SET updated_at = COALESCE(updated_at, created_at, now())
  WHERE updated_at IS NULL;

-- ─── (b) Add 'staff' to sync_merge_upsert allowlist ─────────────────────────
-- The desktop pushes the `users` descriptor to Supabase table `staff` (via
-- supabaseTable override). The MERGE RPC's allowlist had `users` but not
-- `staff`, so MERGE rejected with P0001 and the legacy fallback kicked in
-- (which then failed RLS for the same row). Replace the function with the
-- allowlist updated.
CREATE OR REPLACE FUNCTION public.sync_merge_upsert(
  p_table        text,
  p_rows         jsonb,
  p_business_id  uuid,
  p_append_only  boolean DEFAULT false
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
  v_row_keys      text[];
  v_typed_cols    text;
  v_insert_cols   text;
  v_set_clause    text;
  v_sql           text;
  v_inserted      int := 0;
  v_updated       int := 0;
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
  ELSE
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
    'count',    jsonb_array_length(p_rows)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.sync_merge_upsert(text, jsonb, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_merge_upsert(text, jsonb, uuid, boolean)
  TO service_role, authenticated;

-- ─── (c) PostgREST schema cache reload ──────────────────────────────────────
NOTIFY pgrst, 'reload schema';
