-- ════════════════════════════════════════════════════════════════════════════
-- 20260427000000_per_license_jwt_lockdown.sql
--
-- Sprint goal: end the "shared anon key" sync model. Desktop clients now
-- exchange their license_key for a per-license JWT (via the mint-license-jwt
-- edge function) that carries user_metadata.business_id. Every sync table's
-- RLS is rewritten to compare row.business_id against that JWT claim, so
-- a leaked anon key (or even a leaked JWT for tenant A) cannot read or
-- write tenant B's data.
--
-- This migration:
--   1) Drops every legacy `rls_anon_sync_*` policy (added by
--      20260421500000_restore_anon_sync_policies.sql) and the prestamos
--      `<tbl>_anon_select` / `<tbl>_anon_modify` policies (added by
--      20260425500000_prestamos_rls_tighten.sql) on EVERY sync table.
--   2) Creates unified `<tbl>_jwt_select` / `<tbl>_jwt_modify` policies
--      bound to ((auth.jwt() -> 'user_metadata') ->> 'business_id')::uuid.
--   3) Tightens storage.objects policies for private buckets (db-backups
--      already strict; pawn-documents, vehicle-documents, loan-documents
--      switch from "anon all" to JWT-claim-bound). Public buckets keep
--      public read but write is bound to the caller's JWT.
--   4) Creates the license_jwt_audit table used by the edge function.
--
-- Carve-outs (NOT touched, by design):
--   • pawn_listings_public_published     — TiendaEmpenos public read
--   • pawn_items_public_published        — TiendaEmpenos public read
--   • pawn_documents_public_foto         — TiendaEmpenos public read
--   • businesses                         — landing pages depend on it
--   • plans, licenses, license_events,
--     license_rebind_requests            — auth surface, not row-tenant data
--   • signup_provisional (if present)    — anon insert allowed for signup
--   • rnc_cache                          — global cache, no business_id
--   • Any policy whose name starts with `public_*` or contains `_public_`
--
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 1 — Audit table (created first; the edge function writes to it).
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.license_jwt_audit (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_key  TEXT,
  business_id  UUID,
  machine_id   TEXT,
  minted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ,
  ip_address   TEXT
);

CREATE INDEX IF NOT EXISTS idx_license_jwt_audit_business_id
  ON public.license_jwt_audit (business_id, minted_at DESC);
CREATE INDEX IF NOT EXISTS idx_license_jwt_audit_license_key
  ON public.license_jwt_audit (license_key, minted_at DESC);

ALTER TABLE public.license_jwt_audit ENABLE ROW LEVEL SECURITY;

-- Lock down: only service_role may read/write. anon and authenticated have
-- no policy → default deny.
DROP POLICY IF EXISTS license_jwt_audit_service_all ON public.license_jwt_audit;
CREATE POLICY license_jwt_audit_service_all
  ON public.license_jwt_audit
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 2 — Per-license JWT lockdown across every sync table.
--
-- The sync_tables array is the union of:
--   • SYNC_TABLES in electron/sync.js (the desktop sync registry)
--   • the original list in 20260421500000_restore_anon_sync_policies.sql
--   • the prestamos surface in 20260425500000_prestamos_rls_tighten.sql
--
-- Tables without a business_id column (or that don't exist yet) are skipped
-- by the IF guards — keeps the migration idempotent across older databases.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
  sync_tables TEXT[] := ARRAY[
    -- root entities / catalogs
    'services','clients','inventory_items','ncf_sequences','ncf_sequences_master',
    'ncf_blocks','doc_number_blocks','doc_number_master','empleados',
    'categorias_servicio','mesas','modificadores','service_modificadores',
    'modifier_groups','vehicles','service_bays','stylist_schedules',
    'vehicle_inventory','sales_deals','leads','test_drives','vehicle_documents',
    'vehicle_titulo','vehicle_reservations','bank_preapprovals',
    'vehicle_warranties','users',

    -- POS / ops
    'tickets','ticket_items','ticket_item_modificadores','queue','queue_deletions',
    'kds_events','work_orders','work_order_items','work_order_photos',
    'appointments','appointment_reminders',

    -- finance / commissions / payroll
    'washer_commissions','seller_commissions','cajero_commissions',
    'mechanic_commissions','credit_payments','cuadre_caja','caja_chica',
    'notas_credito','adelantos','payroll_runs','payroll_settings',
    'salary_changes',

    -- inventory ops
    'inventory_transactions','inventory_oversells','inventory_counts',
    'inventory_count_items','inventory_freshness_log','inventory_discards',

    -- e-CF / NCF
    'ecf_submissions','ecf_queue','ecf_cert_history','anecf_queue',
    'compras_607',

    -- memberships / loyalty / subscriptions
    'memberships','client_memberships','membership_redemptions',
    'wash_combos','subscriptions','service_packages','projects',
    'client_service_rates','client_item_prices','loyalty_transactions',

    -- prestamos surface (already tightened — we re-tighten under unified name)
    'loans','loan_payments','pawn_items','loan_contracts','loan_renewals',
    'pawn_documents','pawn_listings','collections_attempts','loan_schedule',
    'collections_log',

    -- carniceria / restaurant
    'carniceria_corte_categories','carniceria_scales','recurring_orders',
    'promotions','promotion_items','aseguradoras','suppliers','parts_orders',
    'insurance_batches',

    -- misc
    'app_settings','configuracion','activity_log','sales_deals','test_drives',
    'pos_tab_order','pos_tab_hidden'
  ];
  jwt_business_expr CONSTANT TEXT := '((auth.jwt() -> ''user_metadata'') ->> ''business_id'')::uuid';
BEGIN
  FOREACH t IN ARRAY sync_tables LOOP
    -- Table must exist and have a business_id column. The same guard pattern
    -- as 20260421500000_restore_anon_sync_policies.sql.
    IF NOT EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t
    ) THEN
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=t AND column_name='business_id'
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- Drop legacy permissive policies (every name we have used historically)
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'rls_anon_sync_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'rls_anon_sync_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'rls_anon_sync_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'rls_anon_sync_delete', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'rls_anon_select',     t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'rls_anon_update',     t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'rls_anon_delete',     t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_anon_all',      t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_anon_rw',       t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_anon_select',   t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_anon_modify',   t);

    -- Drop the new ones too so re-runs are clean
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_jwt_select',    t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_jwt_modify',    t);

    -- SELECT for anon AND authenticated, scoped to caller's business_id
    EXECUTE format(
      'CREATE POLICY %I ON public.%I
         FOR SELECT TO anon, authenticated
         USING (business_id = %s)',
      t || '_jwt_select', t, jwt_business_expr
    );

    -- INSERT/UPDATE/DELETE scoped to caller's business_id
    EXECUTE format(
      'CREATE POLICY %I ON public.%I
         FOR ALL TO anon, authenticated
         USING      (business_id = %s)
         WITH CHECK (business_id = %s)',
      t || '_jwt_modify', t, jwt_business_expr, jwt_business_expr
    );
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 3 — Re-assert public tienda carve-outs.
-- The Section 2 loop dropped <tbl>_anon_select / <tbl>_anon_modify, but the
-- public_published / public_foto policies live under different names and are
-- not touched by the loop. We re-create them here defensively (idempotent)
-- so this migration is fully self-contained.
-- ────────────────────────────────────────────────────────────────────────────

-- pawn_listings: public can SELECT only published rows
DROP POLICY IF EXISTS pawn_listings_public_published ON public.pawn_listings;
CREATE POLICY pawn_listings_public_published ON public.pawn_listings
  FOR SELECT TO anon
  USING (status = 'published');

-- pawn_items: public can SELECT only rows that back a published listing
DROP POLICY IF EXISTS pawn_items_public_published ON public.pawn_items;
CREATE POLICY pawn_items_public_published ON public.pawn_items
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.pawn_listings pl
      WHERE pl.business_id = pawn_items.business_id
        AND pl.pawn_supabase_id = pawn_items.supabase_id
        AND pl.status = 'published'
    )
  );

-- pawn_documents: public can SELECT only foto docs joined to a published listing
DROP POLICY IF EXISTS pawn_documents_public_foto ON public.pawn_documents;
CREATE POLICY pawn_documents_public_foto ON public.pawn_documents
  FOR SELECT TO anon
  USING (
    doc_type = 'foto'
    AND EXISTS (
      SELECT 1 FROM public.pawn_listings pl
      WHERE pl.business_id = pawn_documents.business_id
        AND pl.pawn_supabase_id = pawn_documents.pawn_supabase_id
        AND pl.status = 'published'
    )
  );


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 4 — Storage objects: tighten anon writes to JWT-bound business_id.
--
-- Strategy:
--   • Public buckets (business-logos, vehicle-photos, pawn-photos):
--       keep "public read" SELECT, but rewrite anon INSERT/UPDATE/DELETE so
--       the path's first segment must equal the caller's JWT business_id.
--   • Private buckets (vehicle-documents, pawn-documents, loan-documents):
--       drop the legacy "anon all" policy entirely. Replace with JWT-bound
--       all-ops gated by path-prefix == caller's business_id.
--   • db-backups: untouched (already service_role only + owner-bound).
--
-- Path convention (matches packages/services/storage.js): the first path
-- segment is the business_id UUID, e.g. "<business_id>/<rest>". We enforce
-- that with split_part(name, '/', 1) = JWT business_id.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  jwt_business_uuid CONSTANT TEXT := '((auth.jwt() -> ''user_metadata'') ->> ''business_id'')::uuid';
  jwt_business_text CONSTANT TEXT := '((auth.jwt() -> ''user_metadata'') ->> ''business_id'')';
  bkt TEXT;
  public_buckets TEXT[]  := ARRAY['business-logos','vehicle-photos','pawn-photos'];
  private_buckets TEXT[] := ARRAY['vehicle-documents','pawn-documents','loan-documents'];
BEGIN
  -- ---- Public buckets ----
  FOREACH bkt IN ARRAY public_buckets LOOP
    -- Drop legacy anon write policies (names from 20260416400000 + 20260425100000 + 20260425200000)
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', bkt || '_anon_insert');
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', bkt || '_anon_update');
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', bkt || '_anon_delete');
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', bkt || '_anon_select');
    EXECUTE format('DROP POLICY IF EXISTS "%s anon write"  ON storage.objects', bkt);
    EXECUTE format('DROP POLICY IF EXISTS "%s anon update" ON storage.objects', bkt);
    EXECUTE format('DROP POLICY IF EXISTS "%s anon delete" ON storage.objects', bkt);
    EXECUTE format('DROP POLICY IF EXISTS "%s anon all"    ON storage.objects', bkt);
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', bkt || '_jwt_select');
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', bkt || '_jwt_write');

    -- Public read stays (recreate idempotently with a known name)
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', bkt || '_public_read');
    EXECUTE format(
      'CREATE POLICY %I ON storage.objects
         FOR SELECT TO anon, authenticated
         USING (bucket_id = %L)',
      bkt || '_public_read', bkt
    );

    -- Writes are JWT-bound: first path segment must equal the caller's business_id
    EXECUTE format(
      'CREATE POLICY %I ON storage.objects
         FOR ALL TO anon, authenticated
         USING      (bucket_id = %L AND split_part(name, ''/'', 1) = %s)
         WITH CHECK (bucket_id = %L AND split_part(name, ''/'', 1) = %s)',
      bkt || '_jwt_write', bkt, jwt_business_text, bkt, jwt_business_text
    );
  END LOOP;

  -- ---- Private buckets ----
  FOREACH bkt IN ARRAY private_buckets LOOP
    -- Drop legacy permissive policies
    EXECUTE format('DROP POLICY IF EXISTS "%s anon all"    ON storage.objects', bkt);
    EXECUTE format('DROP POLICY IF EXISTS "%s anon write"  ON storage.objects', bkt);
    EXECUTE format('DROP POLICY IF EXISTS "%s anon update" ON storage.objects', bkt);
    EXECUTE format('DROP POLICY IF EXISTS "%s anon delete" ON storage.objects', bkt);
    EXECUTE format('DROP POLICY IF EXISTS "%s anon select" ON storage.objects', bkt);
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', bkt || '_anon_all');
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', bkt || '_jwt_all');

    -- All ops require JWT-bound business_id and path-prefix match.
    -- No public read for private buckets.
    EXECUTE format(
      'CREATE POLICY %I ON storage.objects
         FOR ALL TO anon, authenticated
         USING      (bucket_id = %L AND split_part(name, ''/'', 1) = %s)
         WITH CHECK (bucket_id = %L AND split_part(name, ''/'', 1) = %s)',
      bkt || '_jwt_all', bkt, jwt_business_text, bkt, jwt_business_text
    );
  END LOOP;

  -- Suppress unused-var warning for jwt_business_uuid (kept for future use)
  PERFORM jwt_business_uuid;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- DONE. Post-migration the desktop app MUST authenticate with a JWT minted
-- by mint-license-jwt; the bare anon key alone will return zero rows on
-- every sync table and zero objects on every private bucket.
-- ────────────────────────────────────────────────────────────────────────────
