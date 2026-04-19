-- v2.1.0 Schema Consolidation (Supabase side)
--
-- Idempotent / state-aware. Steps 1-8 use IF EXISTS guards because in this
-- Supabase project the legacy washers/sellers/users objects were already
-- removed earlier and the empleado_supabase_id columns were already added.
-- Only stale indexes (step 9) and tightened RLS (step 10) actually change.
-- Wrapped in a single transaction so any failure rolls everything back.

BEGIN;

-- 1. Move commission_pct from washers/sellers to empleados (only if those tables still exist)
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS comision_pct NUMERIC DEFAULT 0;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='washers') THEN
    EXECUTE $sql$
      UPDATE empleados e SET comision_pct = w.commission_pct
        FROM washers w WHERE e.ref_id = w.id::text AND e.tipo = 'lavador'
        AND (e.comision_pct IS NULL OR e.comision_pct = 0)
    $sql$;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='sellers') THEN
    EXECUTE $sql$
      UPDATE empleados e SET comision_pct = s.commission_pct
        FROM sellers s WHERE e.ref_id = s.id::text AND e.tipo = 'vendedor'
        AND (e.comision_pct IS NULL OR e.comision_pct = 0)
    $sql$;
  END IF;
END $$;

-- 2. Backfill any missing empleados from washers/sellers (only if those tables still exist)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='washers') THEN
    EXECUTE $sql$
      INSERT INTO empleados (supabase_id, business_id, nombre, tipo, ref_id, comision_pct, phone, cedula, start_date, active, created_at, updated_at)
      SELECT gen_random_uuid(), w.business_id, w.name, 'lavador', w.id::text, w.commission_pct, w.phone, w.cedula, COALESCE(w.start_date, CURRENT_DATE), w.active, NOW(), NOW()
      FROM washers w WHERE NOT EXISTS (SELECT 1 FROM empleados e WHERE e.ref_id = w.id::text AND e.tipo = 'lavador' AND e.business_id = w.business_id)
    $sql$;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='sellers') THEN
    EXECUTE $sql$
      INSERT INTO empleados (supabase_id, business_id, nombre, tipo, ref_id, comision_pct, phone, cedula, start_date, active, created_at, updated_at)
      SELECT gen_random_uuid(), s.business_id, s.name, 'vendedor', s.id::text, s.commission_pct, s.phone, s.cedula, COALESCE(NULLIF(s.start_date,'')::date, CURRENT_DATE), s.active, NOW(), NOW()
      FROM sellers s WHERE NOT EXISTS (SELECT 1 FROM empleados e WHERE e.ref_id = s.id::text AND e.tipo = 'vendedor' AND e.business_id = s.business_id)
    $sql$;
  END IF;
END $$;

-- 3. Backfill empleado_supabase_id on commission tables (only if washers/sellers still exist)
ALTER TABLE washer_commissions ADD COLUMN IF NOT EXISTS empleado_supabase_id UUID;
ALTER TABLE seller_commissions ADD COLUMN IF NOT EXISTS empleado_supabase_id UUID;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='washers') THEN
    EXECUTE $sql$
      UPDATE washer_commissions wc SET empleado_supabase_id = e.supabase_id
        FROM empleados e WHERE wc.washer_supabase_id IS NOT NULL AND e.supabase_id IS NOT NULL
        AND e.tipo='lavador' AND e.ref_id = (SELECT w.id::text FROM washers w WHERE w.supabase_id = wc.washer_supabase_id LIMIT 1)
        AND wc.empleado_supabase_id IS NULL
    $sql$;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='sellers') THEN
    EXECUTE $sql$
      UPDATE seller_commissions sc SET empleado_supabase_id = e.supabase_id
        FROM empleados e WHERE sc.seller_supabase_id IS NOT NULL AND e.supabase_id IS NOT NULL
        AND e.tipo='vendedor' AND e.ref_id = (SELECT s.id::text FROM sellers s WHERE s.supabase_id = sc.seller_supabase_id LIMIT 1)
        AND sc.empleado_supabase_id IS NULL
    $sql$;
  END IF;
END $$;

-- 4. Integrity check — abort if any commission row lost its empleado link
DO $$
DECLARE orphans INT;
BEGIN
  SELECT COUNT(*) INTO orphans FROM washer_commissions WHERE washer_supabase_id IS NOT NULL AND empleado_supabase_id IS NULL;
  IF orphans > 0 THEN RAISE EXCEPTION 'ABORT v2.1: % orphan washer_commissions rows', orphans; END IF;
  SELECT COUNT(*) INTO orphans FROM seller_commissions WHERE seller_supabase_id IS NOT NULL AND empleado_supabase_id IS NULL;
  IF orphans > 0 THEN RAISE EXCEPTION 'ABORT v2.1: % orphan seller_commissions rows', orphans; END IF;
END $$;

-- 5. Drop users VIEW
DROP VIEW IF EXISTS users CASCADE;

-- 6. Drop FK on staff.seller_id, then column
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_seller_id_fkey;
ALTER TABLE staff DROP COLUMN IF EXISTS seller_id;

-- 7. Drop legacy washer_id/seller_id INT columns from commission tables
ALTER TABLE washer_commissions DROP COLUMN IF EXISTS washer_id;
ALTER TABLE seller_commissions DROP COLUMN IF EXISTS seller_id;

-- 8. Drop washers + sellers tables
DROP TABLE IF EXISTS washers CASCADE;
DROP TABLE IF EXISTS sellers CASCADE;

-- 9. Drop stale indexes referencing dropped columns
DROP INDEX IF EXISTS idx_tickets_client;
DROP INDEX IF EXISTS idx_tickets_cajero;
DROP INDEX IF EXISTS idx_queue_washer;
DROP INDEX IF EXISTS idx_commissions_washer;
DROP INDEX IF EXISTS idx_credit_pay_client;
DROP INDEX IF EXISTS idx_cuadre_cajero;
DROP INDEX IF EXISTS idx_vehicles_client;
DROP INDEX IF EXISTS idx_loans_client;

-- 10. Tighten staff RLS
DROP POLICY IF EXISTS staff_select ON staff;
DROP POLICY IF EXISTS staff_insert ON staff;
DROP POLICY IF EXISTS staff_update ON staff;
DROP POLICY IF EXISTS staff_delete ON staff;
CREATE POLICY staff_select ON staff FOR SELECT USING (business_id IN (SELECT my_business_ids()) AND business_id IS NOT NULL);
CREATE POLICY staff_insert ON staff FOR INSERT WITH CHECK (business_id IN (SELECT my_business_ids()) AND supabase_id IS NOT NULL);
CREATE POLICY staff_update ON staff FOR UPDATE USING (business_id IN (SELECT my_business_ids())) WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY staff_delete ON staff FOR DELETE USING (business_id IN (SELECT my_business_ids()));

COMMIT;
