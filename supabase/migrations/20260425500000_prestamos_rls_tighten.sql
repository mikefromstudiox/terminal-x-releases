-- ⚠️  SUPERSEDED 2026-04-27 by 20260427000001_per_license_jwt_lockdown.sql
-- ⚠️  Every `<tbl>_anon_select` / `<tbl>_anon_modify` policy this file
-- ⚠️  creates was DROPPED in the 20260427000001 lockdown and replaced by
-- ⚠️  the per-license JWT family reading app_metadata.business_id.
-- ⚠️  Also: this file's body references user_metadata as the claim path —
-- ⚠️  that is OBSOLETE. Live policies read app_metadata. See
-- ⚠️  docs/MIGRATION-AUDIT-2026-05-01.md and 20260429000050_jwt_metadata_path_swap.sql.
-- ⚠️  DO NOT trust this file as a description of current RLS posture.
-- ⚠️  Audited 2026-05-01.
--
-- ════════════════════════════════════════════════════════════════════════════
-- C2 — Prestamos RLS tightening (anon JWT-claim scoping)
--
-- Problem: every prestamos table currently has a permissive policy of the form
--   CREATE POLICY <tbl>_anon_all FOR ALL TO anon USING (business_id IS NOT NULL)
-- This lets ANY authenticated-with-anon-key client read/write ANY business's
-- cartera. We tighten anon access to the caller's own business_id, derived
-- from the JWT user_metadata claim that the app sets at login
-- (see scripts/demo-e2e-smoke.mjs:92 → auth.user.user_metadata.business_id,
-- and packages/data/web.js where the same claim path is used).
--
-- Scope: ONLY the prestamos surface. We do NOT touch other verticals' RLS.
-- Tables: loans, loan_payments, pawn_items, loan_contracts, loan_renewals,
--         pawn_documents, pawn_listings, collections_attempts, loan_schedule,
--         collections_log.
--
-- Public tienda carve-outs (TiendaEmpenos.jsx reads anonymously, no login):
--   pawn_listings  → public SELECT WHERE status='published'
--   pawn_items     → public SELECT only of rows joined to a published listing
--   pawn_documents → public SELECT WHERE doc_type='foto' AND joined-to-published
--   businesses     → UNCHANGED (other verticals depend on its policy)
--
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════


-- JWT claim helper expression (kept inline to avoid a helper function dep):
--   ((auth.jwt() -> 'user_metadata') ->> 'business_id')::uuid


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 1: Drop legacy permissive policies and create tightened ones
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'loans',
    'loan_payments',
    'pawn_items',
    'loan_contracts',
    'loan_renewals',
    'pawn_documents',
    'pawn_listings',
    'collections_attempts',
    'loan_schedule',
    'collections_log'
  ] LOOP
    -- Skip tables that don't yet exist (loan_schedule + collections_log are
    -- created by Migration B in the same apply batch; if applied in order
    -- they exist by the time this runs, but guard anyway).
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name=tbl) THEN
      RAISE NOTICE 'skip: table % not present', tbl;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

    -- Drop legacy permissive policies (any name we have historically used)
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_anon_all',  tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_anon_rw',   tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'rls_anon_select',   tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'rls_anon_update',   tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'rls_anon_delete',   tbl);

    -- Drop the tightened ones too so the CREATE below is re-runnable
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_anon_select', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_anon_modify', tbl);

    -- SELECT scoped to caller's business_id
    EXECUTE format(
      'CREATE POLICY %I ON %I
         FOR SELECT TO anon
         USING (business_id = ((auth.jwt() -> ''user_metadata'') ->> ''business_id'')::uuid)',
      tbl || '_anon_select', tbl
    );

    -- INSERT/UPDATE/DELETE scoped to caller's business_id
    EXECUTE format(
      'CREATE POLICY %I ON %I
         FOR ALL TO anon
         USING      (business_id = ((auth.jwt() -> ''user_metadata'') ->> ''business_id'')::uuid)
         WITH CHECK (business_id = ((auth.jwt() -> ''user_metadata'') ->> ''business_id'')::uuid)',
      tbl || '_anon_modify', tbl
    );
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 2: Public tienda carve-outs (anonymous, NO login)
-- TiendaEmpenos.jsx reads pawn_listings + pawn_items + pawn_documents with
-- only the env-baked anon key, no signInWithPassword. The tightened policies
-- above would deny those reads (no JWT user_metadata.business_id present →
-- the cast would yield NULL and never match). Add narrow public SELECT
-- policies bound to status='published' / doc_type='foto'.
-- ────────────────────────────────────────────────────────────────────────────

-- pawn_listings: public can SELECT only published rows
DROP POLICY IF EXISTS pawn_listings_public_published ON pawn_listings;
CREATE POLICY pawn_listings_public_published ON pawn_listings
  FOR SELECT TO anon
  USING (status = 'published');

-- pawn_items: public can SELECT only rows that back a published listing
DROP POLICY IF EXISTS pawn_items_public_published ON pawn_items;
CREATE POLICY pawn_items_public_published ON pawn_items
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM pawn_listings pl
      WHERE pl.business_id = pawn_items.business_id
        AND pl.pawn_supabase_id = pawn_items.supabase_id
        AND pl.status = 'published'
    )
  );

-- pawn_documents: public can SELECT only foto docs joined to a published listing
DROP POLICY IF EXISTS pawn_documents_public_foto ON pawn_documents;
CREATE POLICY pawn_documents_public_foto ON pawn_documents
  FOR SELECT TO anon
  USING (
    doc_type = 'foto'
    AND EXISTS (
      SELECT 1 FROM pawn_listings pl
      WHERE pl.business_id = pawn_documents.business_id
        AND pl.pawn_supabase_id = pawn_documents.pawn_supabase_id
        AND pl.status = 'published'
    )
  );


-- businesses: intentionally UNCHANGED — other verticals' public surfaces
-- (landing pages, demo-e2e-smoke, etc.) depend on its existing policy.
