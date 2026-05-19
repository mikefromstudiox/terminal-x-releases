-- 2026_05_19 — Storage RLS: swap user_metadata → app_metadata
--
-- Surfaced by the inaugural stress-suite run as
-- `stress.rls.app_metadata_canonical.zero_user_metadata_refs`. Six storage
-- bucket policies on storage.objects were still reading the client-modifiable
-- `user_metadata.business_id` JWT claim — the canonical guard is
-- `app_metadata.business_id` (set server-side, not user-writable).
--
-- Why this is a real security risk: Supabase Auth lets clients call
-- supabase.auth.updateUser({ data: { business_id: '<other-biz>' } }) and that
-- write lands in user_metadata. A crafted JWT could then read/write any
-- other business's storage objects (loan docs, pawn photos, vehicle docs).
-- app_metadata is server-only; the desktop sync engine + auth-guard set it
-- and clients cannot mutate it.
--
-- Six policies (all storage.objects, all FOR ALL):
--   business-logos_jwt_write, loan-documents_jwt_all,
--   pawn-documents_jwt_all,  pawn-photos_jwt_write,
--   vehicle-documents_jwt_all, vehicle-photos_jwt_write
--
-- Mirrors the 2026-04-29 sweep that migrated public.* policies. No-downtime
-- — authed sessions already have both metadata maps in their JWT after
-- that earlier swap; only the policy expression changes.

BEGIN;

DROP POLICY IF EXISTS "business-logos_jwt_write"  ON storage.objects;
DROP POLICY IF EXISTS "loan-documents_jwt_all"    ON storage.objects;
DROP POLICY IF EXISTS "pawn-documents_jwt_all"    ON storage.objects;
DROP POLICY IF EXISTS "pawn-photos_jwt_write"     ON storage.objects;
DROP POLICY IF EXISTS "vehicle-documents_jwt_all" ON storage.objects;
DROP POLICY IF EXISTS "vehicle-photos_jwt_write"  ON storage.objects;

CREATE POLICY "business-logos_jwt_write" ON storage.objects FOR ALL
  USING      (bucket_id = 'business-logos'    AND split_part(name, '/', 1) = ((auth.jwt() -> 'app_metadata') ->> 'business_id'))
  WITH CHECK (bucket_id = 'business-logos'    AND split_part(name, '/', 1) = ((auth.jwt() -> 'app_metadata') ->> 'business_id'));

CREATE POLICY "loan-documents_jwt_all" ON storage.objects FOR ALL
  USING      (bucket_id = 'loan-documents'    AND split_part(name, '/', 1) = ((auth.jwt() -> 'app_metadata') ->> 'business_id'))
  WITH CHECK (bucket_id = 'loan-documents'    AND split_part(name, '/', 1) = ((auth.jwt() -> 'app_metadata') ->> 'business_id'));

CREATE POLICY "pawn-documents_jwt_all" ON storage.objects FOR ALL
  USING      (bucket_id = 'pawn-documents'    AND split_part(name, '/', 1) = ((auth.jwt() -> 'app_metadata') ->> 'business_id'))
  WITH CHECK (bucket_id = 'pawn-documents'    AND split_part(name, '/', 1) = ((auth.jwt() -> 'app_metadata') ->> 'business_id'));

CREATE POLICY "pawn-photos_jwt_write" ON storage.objects FOR ALL
  USING      (bucket_id = 'pawn-photos'       AND split_part(name, '/', 1) = ((auth.jwt() -> 'app_metadata') ->> 'business_id'))
  WITH CHECK (bucket_id = 'pawn-photos'       AND split_part(name, '/', 1) = ((auth.jwt() -> 'app_metadata') ->> 'business_id'));

CREATE POLICY "vehicle-documents_jwt_all" ON storage.objects FOR ALL
  USING      (bucket_id = 'vehicle-documents' AND split_part(name, '/', 1) = ((auth.jwt() -> 'app_metadata') ->> 'business_id'))
  WITH CHECK (bucket_id = 'vehicle-documents' AND split_part(name, '/', 1) = ((auth.jwt() -> 'app_metadata') ->> 'business_id'));

CREATE POLICY "vehicle-photos_jwt_write" ON storage.objects FOR ALL
  USING      (bucket_id = 'vehicle-photos'    AND split_part(name, '/', 1) = ((auth.jwt() -> 'app_metadata') ->> 'business_id'))
  WITH CHECK (bucket_id = 'vehicle-photos'    AND split_part(name, '/', 1) = ((auth.jwt() -> 'app_metadata') ->> 'business_id'));

COMMIT;

-- Post-migration verify (run manually if applying via psql):
--   SELECT count(*) FROM pg_policies WHERE qual LIKE '%user_metadata%' OR with_check LIKE '%user_metadata%';
-- Expected: 0
