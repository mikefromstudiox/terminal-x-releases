-- 2026-04-26 Supabase linter WARN cleanup
-- Fixes:
--   1) function_search_path_mutable (23 functions) — pin search_path to public,pg_catalog
--   2) public_bucket_allows_listing (4 buckets) — drop broad anon/public SELECT policies
--      on storage.objects. Buckets are public=true, so direct URL access continues to
--      work; we only kill the ability to LIST file names.
--
-- NOT fixed here (intentional):
--   - extension_in_public (btree_gist): backs exclusion constraints
--     ncf_blocks_no_overlap and doc_blocks_no_overlap. Moving requires dropping those
--     constraints + recreating with the new schema-qualified operator class. Defer.
--   - auth_leaked_password_protection: Dashboard toggle (Auth → Policies → Password Strength).

BEGIN;

-- ───────────────────────────── 1) FUNCTION SEARCH_PATH ─────────────────────────────
ALTER FUNCTION public.app_settings_bump_updated_at()                              SET search_path = public, pg_catalog;
ALTER FUNCTION public.ecf_cert_history_set_updated_at()                           SET search_path = public, pg_catalog;
ALTER FUNCTION public.loyalty_tier_for(numeric)                                   SET search_path = public, pg_catalog;
ALTER FUNCTION public.set_updated_at()                                            SET search_path = public, pg_catalog;
ALTER FUNCTION public.tg_set_updated_at()                                         SET search_path = public, pg_catalog;
ALTER FUNCTION public.tg_touch_updated_at()                                       SET search_path = public, pg_catalog;
ALTER FUNCTION public.touch_updated_at()                                          SET search_path = public, pg_catalog;
ALTER FUNCTION public.trg_activity_log_immutable()                                SET search_path = public, pg_catalog;
ALTER FUNCTION public.trg_aseguradoras_set_updated_at()                           SET search_path = public, pg_catalog;
ALTER FUNCTION public.trg_insurance_batches_set_updated_at()                      SET search_path = public, pg_catalog;
ALTER FUNCTION public.trg_mechanic_commissions_set_updated_at()                   SET search_path = public, pg_catalog;
ALTER FUNCTION public.trg_mesas_rev_guard()                                       SET search_path = public, pg_catalog;
ALTER FUNCTION public.trg_parts_orders_set_updated_at()                           SET search_path = public, pg_catalog;
ALTER FUNCTION public.trg_set_updated_at()                                        SET search_path = public, pg_catalog;
ALTER FUNCTION public.trg_set_updated_at_insert()                                 SET search_path = public, pg_catalog;
ALTER FUNCTION public.trg_suppliers_set_updated_at()                              SET search_path = public, pg_catalog;
ALTER FUNCTION public.trg_tickets_rev_guard()                                     SET search_path = public, pg_catalog;
ALTER FUNCTION public.trg_touch_updated_at()                                      SET search_path = public, pg_catalog;
ALTER FUNCTION public.trg_vehicle_documents_set_updated_at()                      SET search_path = public, pg_catalog;
ALTER FUNCTION public.update_updated_at()                                         SET search_path = public, pg_catalog;
ALTER FUNCTION public.merge_business_settings(uuid, jsonb)                        SET search_path = public, pg_catalog;
ALTER FUNCTION public.validate_ticket_prices(uuid, jsonb)                         SET search_path = public, pg_catalog;
ALTER FUNCTION public.create_ticket_validated(
  uuid, jsonb, uuid, jsonb, uuid, uuid, text, text, text, text, text, numeric, jsonb, numeric
) SET search_path = public, pg_catalog;

-- ───────────────────────────── 2) STORAGE BUCKET LIST POLICIES ─────────────────────
-- All 4 buckets are public=true; dropping anon/public SELECT policies on storage.objects
-- removes LIST capability without breaking direct-URL fetches.

DROP POLICY IF EXISTS "business-logos_public_read"     ON storage.objects;
DROP POLICY IF EXISTS "business_logos_anon_select"     ON storage.objects;
DROP POLICY IF EXISTS "mechanic-photos anon all"       ON storage.objects;
DROP POLICY IF EXISTS "pawn-photos public read"        ON storage.objects;
DROP POLICY IF EXISTS "pawn-photos_public_read"        ON storage.objects;
DROP POLICY IF EXISTS "vehicle-photos public read"     ON storage.objects;
DROP POLICY IF EXISTS "vehicle-photos_public_read"     ON storage.objects;

COMMIT;
