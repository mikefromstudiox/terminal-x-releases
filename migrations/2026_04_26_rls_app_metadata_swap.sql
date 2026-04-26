-- ============================================================
-- Terminal X — RLS Critical Fix: user_metadata → app_metadata
-- Idempotent. Safe to re-run.
-- ============================================================
BEGIN;

-- 1) Rewrite every public.* policy referencing user_metadata
DO $mig$
DECLARE
  r          RECORD;
  new_qual   TEXT;
  new_check  TEXT;
  roles_csv  TEXT;
  cmd_kw     TEXT;
  perm_kw    TEXT;
  rewritten  INT := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, cmd, permissive, roles, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND ( COALESCE(qual,'')       ILIKE '%user_metadata%'
         OR COALESCE(with_check,'') ILIKE '%user_metadata%' )
  LOOP
    new_qual  := CASE WHEN r.qual       IS NULL THEN NULL ELSE replace(r.qual,       'user_metadata', 'app_metadata') END;
    new_check := CASE WHEN r.with_check IS NULL THEN NULL ELSE replace(r.with_check, 'user_metadata', 'app_metadata') END;

    SELECT string_agg(quote_ident(rn), ', ') INTO roles_csv FROM unnest(r.roles) AS rn;
    IF roles_csv IS NULL OR roles_csv = '' THEN roles_csv := 'public'; END IF;

    cmd_kw  := COALESCE(r.cmd, 'ALL');
    perm_kw := CASE WHEN r.permissive = 'RESTRICTIVE' THEN 'AS RESTRICTIVE' ELSE 'AS PERMISSIVE' END;

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                   r.policyname, r.schemaname, r.tablename);

    IF new_qual IS NOT NULL AND new_check IS NOT NULL THEN
      EXECUTE format('CREATE POLICY %I ON %I.%I %s FOR %s TO %s USING (%s) WITH CHECK (%s)',
                     r.policyname, r.schemaname, r.tablename, perm_kw, cmd_kw, roles_csv, new_qual, new_check);
    ELSIF new_qual IS NOT NULL THEN
      EXECUTE format('CREATE POLICY %I ON %I.%I %s FOR %s TO %s USING (%s)',
                     r.policyname, r.schemaname, r.tablename, perm_kw, cmd_kw, roles_csv, new_qual);
    ELSIF new_check IS NOT NULL THEN
      EXECUTE format('CREATE POLICY %I ON %I.%I %s FOR %s TO %s WITH CHECK (%s)',
                     r.policyname, r.schemaname, r.tablename, perm_kw, cmd_kw, roles_csv, new_check);
    END IF;

    rewritten := rewritten + 1;
  END LOOP;

  RAISE NOTICE 'rewrote % policies', rewritten;
END
$mig$;

-- 2) Backfill: copy business_id from raw_user_meta_data → raw_app_meta_data
--    Old user_metadata is left intact so existing sessions stay valid.
UPDATE auth.users
   SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
                         || jsonb_build_object('business_id', raw_user_meta_data->>'business_id')
 WHERE raw_user_meta_data ? 'business_id'
   AND ( raw_app_meta_data->>'business_id' IS DISTINCT FROM raw_user_meta_data->>'business_id' );

COMMIT;

NOTIFY pgrst, 'reload schema';
