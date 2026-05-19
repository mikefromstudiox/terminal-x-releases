-- 2026_05_19 — Add UNIQUE constraints on natural-key columns
--
-- Finding #2 from inaugural schema-suite run. 16 natural-key UNIQUE
-- constraints were missing. Of those:
--   - 11 tables have the correct natural-key columns AND zero existing dupes
--     → safe to add the constraints in this migration
--   - 5 tables (modificadores, service_packages, wash_combos, memberships,
--     recurring_orders) have column-name mismatches in the suite or require
--     product decisions on the natural key shape (e.g. memberships with
--     active-period scoping) → DEFERRED to a follow-up migration after
--     schema-suite assertions are updated
--   - app_settings(business_id,key) has 25 live dupes → DEFERRED to a
--     dedup-then-constraint migration that's not co-located with this
--     no-dedup-needed batch.
--
-- Why this matters: a missing UNIQUE constraint lets dual-terminal sync,
-- concurrent web-mutation, or restoring-from-backup silently insert
-- duplicate rows with the same natural key. The dupe rows then drift
-- (one gets edited, the other doesn't), so reports show inconsistent
-- numbers and the cashier can pick "the wrong copy" of a service.
-- This is the same class of bug that produced the 3 Michaels / 3
-- Enriques staff dupes that triggered the v2.0.0 architecture rewrite
-- (see docs/CONSOLIDATED-FIX-PLAN.md F7).
--
-- Each constraint is named `uq_<table>_biz_<col>` for grep-ability and
-- matches existing supabase_id-pair constraint naming (`uq_<tbl>_biz_sid`).
-- All scoped by business_id so different businesses can each have their
-- own "Lavado Básico" service.
--
-- Pre-flight (already verified live before this migration was written):
--   SELECT COALESCE(SUM(cnt-1),0)::int AS extra
--     FROM (SELECT business_id, <col> FROM public.<tbl>
--           WHERE business_id IS NOT NULL AND <col> IS NOT NULL
--           GROUP BY business_id, <col> HAVING count(*)>1) g;
-- All 11 returned 0.

BEGIN;

ALTER TABLE public.services            ADD CONSTRAINT uq_services_biz_name            UNIQUE (business_id, name);
ALTER TABLE public.empleados           ADD CONSTRAINT uq_empleados_biz_cedula         UNIQUE (business_id, cedula);
ALTER TABLE public.inventory_items     ADD CONSTRAINT uq_inventory_items_biz_sku      UNIQUE (business_id, sku);
ALTER TABLE public.promotions          ADD CONSTRAINT uq_promotions_biz_name          UNIQUE (business_id, name);
ALTER TABLE public.categorias_servicio ADD CONSTRAINT uq_categorias_servicio_biz_nom  UNIQUE (business_id, nombre);
ALTER TABLE public.vehicle_inventory   ADD CONSTRAINT uq_vehicle_inventory_biz_vin    UNIQUE (business_id, vin);
ALTER TABLE public.mesas               ADD CONSTRAINT uq_mesas_biz_name               UNIQUE (business_id, name);
ALTER TABLE public.aseguradoras        ADD CONSTRAINT uq_aseguradoras_biz_rnc         UNIQUE (business_id, rnc);
ALTER TABLE public.suppliers           ADD CONSTRAINT uq_suppliers_biz_rnc            UNIQUE (business_id, rnc);
ALTER TABLE public.service_bays        ADD CONSTRAINT uq_service_bays_biz_name        UNIQUE (business_id, name);
ALTER TABLE public.modifier_groups     ADD CONSTRAINT uq_modifier_groups_biz_name     UNIQUE (business_id, name);

COMMIT;

-- Verify (run manually):
--   SELECT conname FROM pg_constraint
--   WHERE conname LIKE 'uq_%_biz_%'
--   AND conrelid IN ('public.services','public.empleados','public.inventory_items',
--                    'public.promotions','public.categorias_servicio','public.vehicle_inventory',
--                    'public.mesas','public.aseguradoras','public.suppliers',
--                    'public.service_bays','public.modifier_groups')::regclass[]
--   ORDER BY conname;
-- Expected: 11 rows.
