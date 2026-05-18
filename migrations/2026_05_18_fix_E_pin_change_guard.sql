-- 2026-05-18 Fix E — PIN-change at the DB layer requires owner OR self.
-- Closes the gap where a manager session could UPDATE another user's pin_hash
-- directly via PostgREST, bypassing the UI-only ManagerAuthGate.
-- service_role bypasses for resets / migrations / sync.

CREATE OR REPLACE FUNCTION trg_staff_pin_guard() RETURNS TRIGGER AS $$
DECLARE
  caller_uid uuid;
  caller_staff RECORD;
BEGIN
  IF current_setting('role', true) IN ('service_role', 'postgres') THEN
    RETURN NEW;
  END IF;
  IF NEW.pin_hash IS NOT DISTINCT FROM OLD.pin_hash THEN
    RETURN NEW;
  END IF;

  caller_uid := auth.uid();
  IF caller_uid IS NULL THEN
    RAISE EXCEPTION 'pin_change_requires_authenticated_session' USING ERRCODE = '42501';
  END IF;

  SELECT s.id, s.role INTO caller_staff
  FROM staff s
  WHERE s.auth_user_id = caller_uid AND s.business_id = NEW.business_id AND s.active = true
  LIMIT 1;

  IF caller_staff.id IS NULL THEN
    RAISE EXCEPTION 'caller_not_in_target_business' USING ERRCODE = '42501';
  END IF;

  -- Self-change OK (web.js verifies oldPin before this fires).
  IF caller_staff.id = NEW.id THEN
    RETURN NEW;
  END IF;

  -- Non-self PIN reset is owner-only. Managers must escalate via a service-role
  -- endpoint after passing ManagerAuthGate; that path bypasses this trigger.
  IF caller_staff.role <> 'owner' THEN
    RAISE EXCEPTION 'only_owner_can_reset_another_users_pin' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_staff_pin_guard_on_update ON staff;
CREATE TRIGGER trg_staff_pin_guard_on_update
  BEFORE UPDATE OF pin_hash ON staff
  FOR EACH ROW
  EXECUTE FUNCTION trg_staff_pin_guard();
