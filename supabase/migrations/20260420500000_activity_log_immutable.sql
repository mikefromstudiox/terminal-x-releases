-- activity_log immutability — MEDIUM sync-audit finding.
--
-- The audit feed is append-only by design: every mutation (ticket void,
-- nomina payout, discount > threshold, cuadre discrepancy, etc.) must be
-- preserved verbatim for owner/cfo/accountant review. A stray UPDATE policy
-- let any anon client with a business_id rewrite history. Drop it, drop
-- DELETE just in case, and nail the door shut with a BEFORE trigger so any
-- future policy drift still hits a hard exception at the row level.
--
-- Strict immutability: triggers fire for service_role too. If we ever need
-- to correct a row, do it via SQL console with the trigger disabled, not
-- via a code path. That friction is intentional.

-- 1. Drop UPDATE/DELETE policies that might exist.
DROP POLICY IF EXISTS activity_log_anon_update ON public.activity_log;
DROP POLICY IF EXISTS activity_log_upd_auth   ON public.activity_log;
DROP POLICY IF EXISTS activity_log_del_auth   ON public.activity_log;
DROP POLICY IF EXISTS "activity_log_anon_update" ON public.activity_log;

-- 2. Trigger-level enforcement — defense in depth beyond RLS.
CREATE OR REPLACE FUNCTION public.trg_activity_log_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'activity_log is append-only; UPDATE/DELETE rejected'
    USING ERRCODE = 'feature_not_supported';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_activity_log_immutable_upd ON public.activity_log;
CREATE TRIGGER trg_activity_log_immutable_upd
  BEFORE UPDATE ON public.activity_log
  FOR EACH ROW EXECUTE FUNCTION public.trg_activity_log_immutable();

DROP TRIGGER IF EXISTS trg_activity_log_immutable_del ON public.activity_log;
CREATE TRIGGER trg_activity_log_immutable_del
  BEFORE DELETE ON public.activity_log
  FOR EACH ROW EXECUTE FUNCTION public.trg_activity_log_immutable();
