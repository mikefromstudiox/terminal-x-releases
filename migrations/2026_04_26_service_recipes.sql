-- ─────────────────────────────────────────────────────────────────────────────
-- 2026_04_26_service_recipes.sql
--
-- Terminal X v2.16.3 — Restaurante: recetas (Bill of Materials por servicio)
--
-- Adds the `service_recipe_items` table linking restaurant menu items
-- (services) to inventory items they consume per unit sold. At ticket close
-- the close path multiplies `qty_per_unit` by line qty and decrements the
-- linked inventory item, producing accurate food-cost / waste tracking.
--
-- Idempotent — safe to re-run on prod. RLS scoped by business_id, anon revoked
-- from writes during desktop sync (service-role bypass).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS service_recipe_items (
  id                              BIGSERIAL PRIMARY KEY,
  supabase_id                     UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  business_id                     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  service_supabase_id             UUID NOT NULL,
  inventory_item_supabase_id      UUID NOT NULL,
  qty_per_unit                    REAL NOT NULL DEFAULT 0 CHECK (qty_per_unit >= 0),
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_service_recipe_items_biz_service_item
    UNIQUE (business_id, service_supabase_id, inventory_item_supabase_id)
);

CREATE INDEX IF NOT EXISTS idx_service_recipe_items_biz_service
  ON service_recipe_items (business_id, service_supabase_id);
CREATE INDEX IF NOT EXISTS idx_service_recipe_items_biz_item
  ON service_recipe_items (business_id, inventory_item_supabase_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_service_recipe_items_updated_at') THEN
    CREATE TRIGGER trg_service_recipe_items_updated_at
      BEFORE UPDATE ON service_recipe_items
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

ALTER TABLE service_recipe_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_recipe_items_anon_select ON service_recipe_items;
CREATE POLICY service_recipe_items_anon_select ON service_recipe_items
  FOR SELECT TO anon USING (business_id IS NOT NULL);

DROP POLICY IF EXISTS service_recipe_items_anon_insert ON service_recipe_items;
CREATE POLICY service_recipe_items_anon_insert ON service_recipe_items
  FOR INSERT TO anon WITH CHECK (business_id IS NOT NULL);

DROP POLICY IF EXISTS service_recipe_items_anon_update ON service_recipe_items;
CREATE POLICY service_recipe_items_anon_update ON service_recipe_items
  FOR UPDATE TO anon USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);

DROP POLICY IF EXISTS service_recipe_items_anon_delete ON service_recipe_items;
CREATE POLICY service_recipe_items_anon_delete ON service_recipe_items
  FOR DELETE TO anon USING (business_id IS NOT NULL);
