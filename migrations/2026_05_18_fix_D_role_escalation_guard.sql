-- 2026-05-18 Fix D — DB-layer role-escalation guard.
-- BEFORE UPDATE OF role triggers on staff + empleados that reject role changes
-- unless the caller is the same business's owner (or an authorized higher role).
-- Pairs with web.js guardUserMutation (UI guard) for defense in depth: even a
-- crafted PostgREST UPDATE under a valid cashier session can't escalate to
-- owner / cfo. service_role bypasses for sync / migrations / scripts.

CREATE OR REPLACE FUNCTION trg_staff_role_guard() RETURNS TRIGGER AS $$
DECLARE
  caller_uid uuid;
  caller_role text;
  caller_role_level int;
  new_role_level int;
BEGIN
  IF current_setting('role', true) IN ('service_role', 'postgres') THEN
    RETURN NEW;
  END IF;
  IF NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;

  caller_uid := auth.uid();
  IF caller_uid IS NULL THEN
    RAISE EXCEPTION 'role_change_requires_authenticated_session' USING ERRCODE = '42501';
  END IF;

  SELECT s.role INTO caller_role
  FROM staff s
  WHERE s.auth_user_id = caller_uid
    AND s.business_id = NEW.business_id
    AND s.active = true
  LIMIT 1;

  IF caller_role IS NULL THEN
    RAISE EXCEPTION 'caller_not_in_target_business' USING ERRCODE = '42501';
  END IF;

  caller_role_level := CASE caller_role
    WHEN 'owner' THEN 100 WHEN 'cfo' THEN 80 WHEN 'manager' THEN 60
    WHEN 'accountant' THEN 40 WHEN 'cashier' THEN 20 WHEN 'kitchen' THEN 10
    ELSE 0 END;
  new_role_level := CASE NEW.role
    WHEN 'owner' THEN 100 WHEN 'cfo' THEN 80 WHEN 'manager' THEN 60
    WHEN 'accountant' THEN 40 WHEN 'cashier' THEN 20 WHEN 'kitchen' THEN 10
    ELSE 0 END;

  IF NEW.role IN ('owner','cfo') AND caller_role <> 'owner' THEN
    RAISE EXCEPTION 'only_owner_can_assign_role_%', NEW.role USING ERRCODE = '42501';
  END IF;
  IF caller_role <> 'owner' AND new_role_level >= caller_role_level THEN
    RAISE EXCEPTION 'cannot_assign_role_equal_or_higher_than_caller' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_staff_role_guard_on_update ON staff;
CREATE TRIGGER trg_staff_role_guard_on_update
  BEFORE UPDATE OF role ON staff
  FOR EACH ROW
  EXECUTE FUNCTION trg_staff_role_guard();

CREATE OR REPLACE FUNCTION trg_empleados_role_guard() RETURNS TRIGGER AS $$
DECLARE
  caller_uid uuid; caller_role text;
  caller_role_level int; new_role_level int;
BEGIN
  IF current_setting('role', true) IN ('service_role', 'postgres') THEN
    RETURN NEW;
  END IF;
  IF NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;

  caller_uid := auth.uid();
  IF caller_uid IS NULL THEN
    RAISE EXCEPTION 'role_change_requires_authenticated_session' USING ERRCODE = '42501';
  END IF;

  SELECT s.role INTO caller_role
  FROM staff s
  WHERE s.auth_user_id = caller_uid AND s.business_id = NEW.business_id AND s.active = true
  LIMIT 1;

  IF caller_role IS NULL THEN
    RAISE EXCEPTION 'caller_not_in_target_business' USING ERRCODE = '42501';
  END IF;

  caller_role_level := CASE caller_role
    WHEN 'owner' THEN 100 WHEN 'cfo' THEN 80 WHEN 'manager' THEN 60
    WHEN 'accountant' THEN 40 WHEN 'cashier' THEN 20 WHEN 'kitchen' THEN 10 ELSE 0 END;
  new_role_level := CASE NEW.role
    WHEN 'owner' THEN 100 WHEN 'cfo' THEN 80 WHEN 'manager' THEN 60
    WHEN 'accountant' THEN 40 WHEN 'cashier' THEN 20 WHEN 'kitchen' THEN 10 ELSE 0 END;

  IF NEW.role IN ('owner','cfo') AND caller_role <> 'owner' THEN
    RAISE EXCEPTION 'only_owner_can_assign_role_%', NEW.role USING ERRCODE = '42501';
  END IF;
  IF caller_role <> 'owner' AND new_role_level >= caller_role_level THEN
    RAISE EXCEPTION 'cannot_assign_role_equal_or_higher_than_caller' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_empleados_role_guard_on_update ON empleados;
CREATE TRIGGER trg_empleados_role_guard_on_update
  BEFORE UPDATE OF role ON empleados
  FOR EACH ROW
  EXECUTE FUNCTION trg_empleados_role_guard();
