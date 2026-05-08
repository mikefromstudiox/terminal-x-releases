-- 2026-05-08 — Keep staff.role and empleados.role in lockstep.
--
-- Background: AuthContext.resolveRole() reads `empleados.role` for UI gating
-- when `staff.employee_id` resolves to an empleado, but the staff row is the
-- one the api.users.update() write path mutates. The two columns can and do
-- drift (Ranoza's Michelle Rodriguez sat at staff.role='manager' /
-- empleados.role='cashier' for weeks; promoting one alone was a no-op for
-- the UI).
--
-- Fix: bidirectional triggers that mirror role changes between the two
-- tables, joined by case-insensitive name within the same business. Catches
-- every write source (UI, desktop sync, ad-hoc SQL, future migrations)
-- without requiring callers to know the dual-write rule.
--
-- Recursion guard: each trigger only fires when role actually changes
-- (`IS DISTINCT FROM OLD.role`) and the mirrored UPDATE filters by the
-- same condition, so the second-hop trigger sees zero affected rows and
-- doesn't fire its inner UPDATE.

CREATE OR REPLACE FUNCTION public.sync_role_staff_to_empleados()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    UPDATE empleados
       SET role = NEW.role, updated_at = now()
     WHERE business_id = NEW.business_id
       AND lower(nombre) = lower(NEW.name)
       AND role IS DISTINCT FROM NEW.role;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_role_empleados_to_staff()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    UPDATE staff
       SET role = NEW.role, updated_at = now()
     WHERE business_id = NEW.business_id
       AND lower(name) = lower(NEW.nombre)
       AND role IS DISTINCT FROM NEW.role;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_staff_role_to_empleados ON public.staff;
CREATE TRIGGER trg_staff_role_to_empleados
  AFTER UPDATE OF role ON public.staff
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_role_staff_to_empleados();

DROP TRIGGER IF EXISTS trg_empleados_role_to_staff ON public.empleados;
CREATE TRIGGER trg_empleados_role_to_staff
  AFTER UPDATE OF role ON public.empleados
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_role_empleados_to_staff();

-- Heal any current drift (no-op today; defensive against future re-application).
UPDATE empleados e
   SET role = s.role, updated_at = now()
  FROM staff s
 WHERE e.business_id = s.business_id
   AND lower(e.nombre) = lower(s.name)
   AND e.active = true
   AND s.active = true
   AND e.role IS DISTINCT FROM s.role;
