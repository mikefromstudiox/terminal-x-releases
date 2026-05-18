-- Last-batch followup — block last-owner self-downgrade + self-deactivation.
CREATE OR REPLACE FUNCTION trg_staff_last_owner_guard() RETURNS TRIGGER AS $$
DECLARE _other_owners int;
BEGIN
  IF current_setting('role', true) IN ('service_role','postgres') THEN RETURN NEW; END IF;
  IF NEW.role IS NOT DISTINCT FROM OLD.role THEN RETURN NEW; END IF;
  IF OLD.role = 'owner' AND NEW.role <> 'owner' THEN
    SELECT COUNT(*) INTO _other_owners FROM staff
    WHERE business_id = NEW.business_id AND active = true AND role = 'owner' AND id <> NEW.id;
    IF _other_owners = 0 THEN
      RAISE EXCEPTION 'last_owner_cannot_self_downgrade: at least one active owner required'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
DROP TRIGGER IF EXISTS trg_staff_last_owner_guard ON staff;
CREATE TRIGGER trg_staff_last_owner_guard
  BEFORE UPDATE OF role, active ON staff
  FOR EACH ROW EXECUTE FUNCTION trg_staff_last_owner_guard();

CREATE OR REPLACE FUNCTION trg_staff_last_owner_deactivate_guard() RETURNS TRIGGER AS $$
DECLARE _other_owners int;
BEGIN
  IF current_setting('role', true) IN ('service_role','postgres') THEN RETURN NEW; END IF;
  IF NEW.active IS NOT DISTINCT FROM OLD.active THEN RETURN NEW; END IF;
  IF OLD.role = 'owner' AND OLD.active = true AND NEW.active = false THEN
    SELECT COUNT(*) INTO _other_owners FROM staff
    WHERE business_id = NEW.business_id AND active = true AND role = 'owner' AND id <> NEW.id;
    IF _other_owners = 0 THEN
      RAISE EXCEPTION 'last_owner_cannot_deactivate: at least one active owner required'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
DROP TRIGGER IF EXISTS trg_staff_last_owner_deactivate_guard ON staff;
CREATE TRIGGER trg_staff_last_owner_deactivate_guard
  BEFORE UPDATE OF active ON staff
  FOR EACH ROW EXECUTE FUNCTION trg_staff_last_owner_deactivate_guard();
