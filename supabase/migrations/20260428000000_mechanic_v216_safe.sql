-- 20260428000000_mechanic_v216_safe.sql
--
-- Replacement for the broken 20260427100000_mechanic_v216_polish.sql.
--
-- Why this exists:
--   The original polish migration's M6 block tried to backfill an
--   `empleados.commission_pct` column from `empleados.comision_pct`. On
--   production the canonical column is `comision_pct` (Spanish) and
--   `commission_pct` was never created — the migration aborted before
--   M2 (parts_orders FK) and H5 (mechanic_commissions table) could run.
--
-- What this migration does:
--   - M2: formalize parts_orders.supplier_supabase_id → suppliers.supabase_id
--         FK so PostgREST embeds resolve correctly.
--   - H5: create the mechanic_commissions freezing table (mirrors
--         seller_commissions / cajero_commissions; stamped at WO close so
--         retroactive comision_pct edits never rewrite historical payroll).
--
-- What this migration does NOT do:
--   - Touch empleados.comision_pct in any way (no rename, no backfill, no
--     ALTER, no UPDATE). Spanish column name is the canonical standard.
--   - Affect any other vertical (no salon, carwash, restaurant, etc.).
--
-- Idempotent. Safe to re-run.

BEGIN;

-- ── M2: parts_orders.supplier_supabase_id formal FK to suppliers ───────────
-- Without a real FK, PostgREST embed `parts_orders?select=*,suppliers(nombre)`
-- silently returns null instead of joining on the UUID. Adding ON DELETE SET
-- NULL preserves history rows when a supplier is deleted.
DO $$
DECLARE
  parts_has_col BOOLEAN;
  sup_has_col   BOOLEAN;
  fk_present    BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'parts_orders' AND column_name = 'supplier_supabase_id'
  ) INTO parts_has_col;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'suppliers' AND column_name = 'supabase_id'
  ) INTO sup_has_col;
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'parts_orders_supplier_supabase_fk'
  ) INTO fk_present;
  IF parts_has_col AND sup_has_col AND NOT fk_present THEN
    -- Null-out orphan references first so the FK creation can't fail.
    UPDATE public.parts_orders po
       SET supplier_supabase_id = NULL
     WHERE po.supplier_supabase_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.suppliers s WHERE s.supabase_id = po.supplier_supabase_id);
    ALTER TABLE public.parts_orders
      ADD CONSTRAINT parts_orders_supplier_supabase_fk
      FOREIGN KEY (supplier_supabase_id) REFERENCES public.suppliers(supabase_id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── H5: mechanic_commissions — freeze comisión at WO close ─────────────────
-- Mirrors seller_commissions/cajero_commissions pattern. Stamped once at WO
-- close so retroactive `comision_pct` edits on the empleado row don't
-- rewrite historical payroll. Sync push: SQLite mirror + LWW on `paid` flag.
--
-- NOTE: this table's `commission_pct` column is a SNAPSHOT of the empleado's
-- comision_pct value at WO-close time. It lives here intentionally (frozen),
-- separate from the live `empleados.comision_pct` column which can be edited
-- without affecting historical rows. No rename happening on empleados.
CREATE TABLE IF NOT EXISTS public.mechanic_commissions (
  id BIGSERIAL PRIMARY KEY,
  supabase_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  work_order_supabase_id UUID NOT NULL,
  technician_empleado_supabase_id UUID NOT NULL,
  ticket_supabase_id UUID,
  base_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  commission_pct NUMERIC(6,3) NOT NULL DEFAULT 0,
  calc_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid BOOLEAN NOT NULL DEFAULT false,
  paid_at TIMESTAMPTZ,
  paid_by_supabase_id UUID,
  manual_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.mechanic_commissions
    ADD CONSTRAINT mechanic_commissions_business_supabase_uk UNIQUE (business_id, supabase_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- One commission row per (work_order, technician) — prevents double-stamping
  -- if WO close fires twice (e.g. retry after sync hiccup).
  ALTER TABLE public.mechanic_commissions
    ADD CONSTRAINT mechanic_commissions_wo_tech_uk
    UNIQUE (business_id, work_order_supabase_id, technician_empleado_supabase_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS mechanic_commissions_biz_paid_idx
  ON public.mechanic_commissions (business_id, paid, created_at DESC);
CREATE INDEX IF NOT EXISTS mechanic_commissions_tech_idx
  ON public.mechanic_commissions (technician_empleado_supabase_id);

ALTER TABLE public.mechanic_commissions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY mechanic_commissions_anon_select ON public.mechanic_commissions
    FOR SELECT TO anon USING (business_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY mechanic_commissions_anon_insert ON public.mechanic_commissions
    FOR INSERT TO anon WITH CHECK (business_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY mechanic_commissions_anon_update ON public.mechanic_commissions
    FOR UPDATE TO anon USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY mechanic_commissions_anon_delete ON public.mechanic_commissions
    FOR DELETE TO anon USING (business_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.trg_mechanic_commissions_set_updated_at() RETURNS TRIGGER AS $func$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$func$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS mechanic_commissions_set_updated_at ON public.mechanic_commissions;
CREATE TRIGGER mechanic_commissions_set_updated_at
  BEFORE UPDATE ON public.mechanic_commissions
  FOR EACH ROW EXECUTE FUNCTION public.trg_mechanic_commissions_set_updated_at();

COMMIT;
