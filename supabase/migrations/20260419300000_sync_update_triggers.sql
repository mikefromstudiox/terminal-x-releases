-- 20260419300000_sync_update_triggers.sql
-- Sprint 7 — BEFORE UPDATE triggers on every synced table.
--
-- The 2026-04-14 hardening added BEFORE INSERT triggers so updated_at is
-- never NULL, but did NOT add BEFORE UPDATE. When an UPDATE statement
-- omits updated_at, the column keeps its old value and LWW sync skips
-- the row (pull cursor is `updated_at > last_pull_at`). Findings Y-H1..H4
-- of the 2026-04-19 audit trace this to 10 tables minimum; this migration
-- applies the fix uniformly to every synced table.

BEGIN;

-- Shared tick function. SECURITY DEFINER not needed — trigger fires as
-- row owner, and NEW.updated_at is a simple column assignment.
CREATE OR REPLACE FUNCTION public.trg_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Always advance on UPDATE so LWW sync sees the row. If the caller
  -- explicitly supplied a newer value (e.g., a client-side clock),
  -- honor it; otherwise stamp now().
  IF NEW.updated_at IS NULL OR NEW.updated_at <= OLD.updated_at THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DO $do$
DECLARE
  t text;
  targets text[] := ARRAY[
    'services',
    'clients',
    'inventory_items',
    'ncf_sequences',
    'empleados',
    'categorias_servicio',
    'mesas',
    'modificadores',
    'vehicles',
    'service_bays',
    'stylist_schedules',
    'staff',
    'activity_log',
    'service_modificadores',
    'tickets',
    'work_orders',
    'appointments',
    'loans',
    'ticket_items',
    'ticket_item_modificadores',
    'kds_events',
    'queue',
    'washer_commissions',
    'seller_commissions',
    'cajero_commissions',
    'credit_payments',
    'cuadre_caja',
    'caja_chica',
    'notas_credito',
    'inventory_transactions',
    'compras_607',
    'adelantos',
    'payroll_runs',
    'salary_changes',
    'ecf_submissions',
    'queue_deletions',
    'memberships',
    'wash_combos',
    'subscriptions',
    'service_packages',
    'projects',
    'client_service_rates',
    'client_item_prices',
    'loan_payments',
    'pawn_items',
    'loan_schedule',
    'collections_log',
    'inventory_counts',
    'inventory_count_items',
    'app_settings'
  ];
BEGIN
  FOREACH t IN ARRAY targets LOOP
    -- Skip anything that isn't an actual base table with updated_at.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name=t AND column_name='updated_at'
    ) THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema='public' AND table_name=t AND table_type='BASE TABLE'
    ) THEN CONTINUE; END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_touch_updated_at ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%I_touch_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.trg_touch_updated_at()', t, t);
  END LOOP;
END
$do$;

COMMIT;
