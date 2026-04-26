-- 2026_04_27_v21612_commission_employment_window.sql
-- Punch-list item #4: Nómina commission imports must respect empleados.start_date.
--
-- Roberto Gomez case: he quit and rejoined 2025-12-21. The bulk historical
-- commission import created 11 monthly rows for him (May 2025 → March 2026)
-- — including 7 months he wasn't even employed. Manual cleanup deleted those
-- 7 rows today (cloud-side), but the import script lives outside the repo
-- and can re-bug-bite next quarter. Server-side enforcement guarantees no
-- script (current or future) can backfill commissions outside an
-- employment window.
--
-- Trigger BEFORE INSERT/UPDATE on the 4 commission tables. Compares
-- NEW.created_at to empleados.start_date. Rejects with clear error.
-- Idempotent.
--
-- NOTE: only enforced when empleado_supabase_id is set AND the empleado
-- has a non-null start_date. Existing rows aren't touched.

CREATE OR REPLACE FUNCTION public.guard_commission_employment_window()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_start_date date;
  v_nombre     text;
BEGIN
  IF NEW.empleado_supabase_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.created_at IS NULL THEN RETURN NEW; END IF;

  SELECT start_date, nombre
    INTO v_start_date, v_nombre
    FROM public.empleados
    WHERE supabase_id = NEW.empleado_supabase_id
      AND business_id = NEW.business_id
    LIMIT 1;

  IF v_start_date IS NOT NULL AND (NEW.created_at AT TIME ZONE 'UTC')::date < v_start_date THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format(
        'commission row predates empleado.start_date — %s started %s, row created_at=%s. ' ||
        'Likely a backfill import that ignored employment window. ' ||
        'For rehires, update empleados.start_date to the most recent rehire date or split into ' ||
        'multiple empleado rows by employment period.',
        COALESCE(v_nombre, NEW.empleado_supabase_id::text),
        v_start_date,
        NEW.created_at::text
      );
  END IF;

  RETURN NEW;
END $fn$;

-- Apply to the four commission tables. Drop existing triggers first so
-- re-running this migration is idempotent.
DROP TRIGGER IF EXISTS trg_washer_comm_employment_window   ON public.washer_commissions;
DROP TRIGGER IF EXISTS trg_seller_comm_employment_window   ON public.seller_commissions;
DROP TRIGGER IF EXISTS trg_cajero_comm_employment_window   ON public.cajero_commissions;
DROP TRIGGER IF EXISTS trg_mechanic_comm_employment_window ON public.mechanic_commissions;

CREATE TRIGGER trg_washer_comm_employment_window
  BEFORE INSERT OR UPDATE ON public.washer_commissions
  FOR EACH ROW EXECUTE FUNCTION public.guard_commission_employment_window();

CREATE TRIGGER trg_seller_comm_employment_window
  BEFORE INSERT OR UPDATE ON public.seller_commissions
  FOR EACH ROW EXECUTE FUNCTION public.guard_commission_employment_window();

CREATE TRIGGER trg_cajero_comm_employment_window
  BEFORE INSERT OR UPDATE ON public.cajero_commissions
  FOR EACH ROW EXECUTE FUNCTION public.guard_commission_employment_window();

CREATE TRIGGER trg_mechanic_comm_employment_window
  BEFORE INSERT OR UPDATE ON public.mechanic_commissions
  FOR EACH ROW EXECUTE FUNCTION public.guard_commission_employment_window();

NOTIFY pgrst, 'reload schema';
