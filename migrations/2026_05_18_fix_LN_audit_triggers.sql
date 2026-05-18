-- 2026-05-18 Fix L + N — DB-level audit trail triggers.
-- L: inventory_items.price/cost changes → activity_log (severity=warn)
-- N: empleados.salary/role changes → activity_log (severity=critical)
-- Closes silent-fraud surfaces where price changes / salary edits / role
-- escalations bypassed activity_log because audit was UI-only.

CREATE OR REPLACE FUNCTION trg_inventory_price_audit() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.price IS DISTINCT FROM OLD.price OR NEW.cost IS DISTINCT FROM OLD.cost THEN
    INSERT INTO activity_log (
      supabase_id, business_id, event_type, severity,
      target_type, target_id, target_name,
      old_value, new_value, metadata, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), NEW.business_id,
      CASE WHEN NEW.price IS DISTINCT FROM OLD.price AND NEW.cost IS DISTINCT FROM OLD.cost THEN 'inventory_price_cost_change'
           WHEN NEW.price IS DISTINCT FROM OLD.price THEN 'inventory_price_change'
           ELSE 'inventory_cost_change' END,
      'warn', 'inventory_item', NEW.id::text, NEW.name,
      jsonb_build_object('price', OLD.price, 'cost', OLD.cost)::text,
      jsonb_build_object('price', NEW.price, 'cost', NEW.cost)::text,
      jsonb_build_object('sku', NEW.sku), NOW(), NOW()
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_inventory_price_audit ON inventory_items;
CREATE TRIGGER trg_inventory_price_audit
  AFTER UPDATE OF price, cost ON inventory_items
  FOR EACH ROW EXECUTE FUNCTION trg_inventory_price_audit();

CREATE OR REPLACE FUNCTION trg_empleados_change_audit() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.salary IS DISTINCT FROM OLD.salary THEN
    INSERT INTO activity_log (supabase_id, business_id, event_type, severity, target_type, target_id, target_name, amount, old_value, new_value, created_at, updated_at)
    VALUES (gen_random_uuid(), NEW.business_id, 'empleado_salary_change', 'critical',
      'empleado', NEW.id::text, NEW.nombre, NEW.salary,
      OLD.salary::text, NEW.salary::text, NOW(), NOW());
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    INSERT INTO activity_log (supabase_id, business_id, event_type, severity, target_type, target_id, target_name, old_value, new_value, created_at, updated_at)
    VALUES (gen_random_uuid(), NEW.business_id, 'empleado_role_change', 'critical',
      'empleado', NEW.id::text, NEW.nombre, OLD.role, NEW.role, NOW(), NOW());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_empleados_change_audit ON empleados;
CREATE TRIGGER trg_empleados_change_audit
  AFTER UPDATE OF salary, role ON empleados
  FOR EACH ROW EXECUTE FUNCTION trg_empleados_change_audit();
