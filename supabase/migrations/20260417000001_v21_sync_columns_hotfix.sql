BEGIN;

-- C1: Recreate users VIEW so PostgREST PULL keeps working for desktop sync
-- (sync.js:1075 still pulls from 'users' — view-as-staff is the 1-line fix)
CREATE OR REPLACE VIEW public.users AS
  SELECT id, business_id, name, username, pin_hash, role, discount_pct, commission_pct,
         cedula, start_date, employee_id, active, created_at, updated_at, supabase_id
  FROM public.staff;

-- C2: tickets columns the desktop pushes since v2.1
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS washer_empleado_supabase_ids JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS seller_empleado_supabase_id UUID;
-- Backfill from legacy columns if they still exist
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='washer_ids') THEN
    EXECUTE $sql$ UPDATE tickets SET washer_empleado_supabase_ids = COALESCE(washer_ids,'[]'::jsonb) WHERE (washer_empleado_supabase_ids IS NULL OR washer_empleado_supabase_ids='[]'::jsonb) AND washer_ids IS NOT NULL $sql$;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='seller_supabase_id') THEN
    EXECUTE $sql$ UPDATE tickets SET seller_empleado_supabase_id = seller_supabase_id WHERE seller_empleado_supabase_id IS NULL AND seller_supabase_id IS NOT NULL $sql$;
  END IF;
END $$;

-- C3: queue column the desktop pushes since v2.1
ALTER TABLE public.queue ADD COLUMN IF NOT EXISTS empleado_supabase_id UUID;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='queue' AND column_name='washer_supabase_id') THEN
    EXECUTE $sql$ UPDATE queue SET empleado_supabase_id = washer_supabase_id WHERE empleado_supabase_id IS NULL AND washer_supabase_id IS NOT NULL $sql$;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_queue_empleado ON queue(empleado_supabase_id);

-- HIGH H1: missing updated_at triggers on activity_log + adelantos
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='set_updated_at') THEN
    DROP TRIGGER IF EXISTS trg_activity_log_updated_at ON public.activity_log;
    CREATE TRIGGER trg_activity_log_updated_at BEFORE UPDATE ON public.activity_log
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    DROP TRIGGER IF EXISTS trg_adelantos_updated_at ON public.adelantos;
    CREATE TRIGGER trg_adelantos_updated_at BEFORE UPDATE ON public.adelantos
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- HIGH H2: drop wide-open `using true` businesses policies (anon could read every tenant)
DROP POLICY IF EXISTS rls_businesses_anon_select ON public.businesses;
DROP POLICY IF EXISTS rls_businesses_anon_update ON public.businesses;
DROP POLICY IF EXISTS rls_businesses_auth ON public.businesses;

-- HIGH H3: drop wide-open commission policies
DROP POLICY IF EXISTS cajero_commissions_all ON public.cajero_commissions;
DROP POLICY IF EXISTS rls_seller_comm_anon_select ON public.seller_commissions;
DROP POLICY IF EXISTS rls_seller_comm_auth ON public.seller_commissions;
DROP POLICY IF EXISTS rls_washer_comm_anon_select ON public.washer_commissions;
DROP POLICY IF EXISTS rls_washer_comm_auth ON public.washer_commissions;

COMMIT;
