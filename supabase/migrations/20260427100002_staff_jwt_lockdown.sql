-- ════════════════════════════════════════════════════════════════════════════
-- Staff table JWT lockdown — close the last 4 rls_anon_sync_* policies
-- staff has business_id; JWT-claim isolation is appropriate.
-- The PIN-login flow runs AFTER license JWT is minted, so this is safe.
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS rls_anon_sync_select ON staff;
DROP POLICY IF EXISTS rls_anon_sync_insert ON staff;
DROP POLICY IF EXISTS rls_anon_sync_update ON staff;
DROP POLICY IF EXISTS rls_anon_sync_delete ON staff;

-- Idempotent — drop new ones first if re-running
DROP POLICY IF EXISTS staff_jwt_select ON staff;
DROP POLICY IF EXISTS staff_jwt_modify ON staff;

CREATE POLICY staff_jwt_select ON staff
  FOR SELECT TO anon, authenticated
  USING (business_id = ((auth.jwt() -> 'user_metadata') ->> 'business_id')::uuid);

CREATE POLICY staff_jwt_modify ON staff
  FOR ALL TO anon, authenticated
  USING (business_id = ((auth.jwt() -> 'user_metadata') ->> 'business_id')::uuid)
  WITH CHECK (business_id = ((auth.jwt() -> 'user_metadata') ->> 'business_id')::uuid);
