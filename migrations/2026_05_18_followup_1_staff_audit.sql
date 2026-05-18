-- Followup #1 — staff table audit trigger (mirror of trg_empleados_change_audit).
CREATE OR REPLACE FUNCTION trg_staff_change_audit() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    INSERT INTO activity_log (supabase_id, business_id, event_type, severity, target_type, target_id, target_name, old_value, new_value, created_at, updated_at)
    VALUES (gen_random_uuid(), NEW.business_id, 'staff_role_change', 'critical',
      'staff', NEW.id::text, NEW.name || ' (@' || NEW.username || ')',
      OLD.role, NEW.role, NOW(), NOW());
  END IF;
  IF NEW.pin_hash IS DISTINCT FROM OLD.pin_hash THEN
    INSERT INTO activity_log (supabase_id, business_id, event_type, severity, target_type, target_id, target_name, created_at, updated_at)
    VALUES (gen_random_uuid(), NEW.business_id, 'staff_pin_change', 'critical',
      'staff', NEW.id::text, NEW.name || ' (@' || NEW.username || ')',
      NOW(), NOW());
  END IF;
  IF NEW.active IS DISTINCT FROM OLD.active THEN
    INSERT INTO activity_log (supabase_id, business_id, event_type, severity, target_type, target_id, target_name, old_value, new_value, created_at, updated_at)
    VALUES (gen_random_uuid(), NEW.business_id,
      CASE WHEN NEW.active THEN 'staff_reactivated' ELSE 'staff_deactivated' END,
      'warn', 'staff', NEW.id::text, NEW.name || ' (@' || NEW.username || ')',
      OLD.active::text, NEW.active::text, NOW(), NOW());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_staff_change_audit ON staff;
CREATE TRIGGER trg_staff_change_audit
  AFTER UPDATE OF role, pin_hash, active ON staff
  FOR EACH ROW EXECUTE FUNCTION trg_staff_change_audit();
