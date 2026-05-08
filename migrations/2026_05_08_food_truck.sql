-- ─────────────────────────────────────────────────────────────────────────────
-- 2026_05_08_food_truck.sql
--
-- Terminal X v2.17 — Food Truck vertical (Phase 1).
--
-- Adds:
--   - food_truck_locations  (favorite stops with optional GPS)
--   - waste_log             (spoilage / breakage / food cost loss)
--   - cuadre_caja           +columns: start_location_supabase_id, start_lat,
--                                     start_lng, start_notes
--   - tickets               +column:  food_truck_location_supabase_id
--
-- Policies follow the canonical "<table>_insert + <table>_jwt_modify +
-- <table>_jwt_select" pattern used by mesas / restaurant_reservations / every
-- POS object. Idempotent — safe to re-run via Supabase Management API.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── food_truck_locations ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS food_truck_locations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id  UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  lat          DOUBLE PRECISION,
  lng          DOUBLE PRECISION,
  notes        TEXT,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_food_truck_locations_biz_sid') THEN
    ALTER TABLE food_truck_locations
      ADD CONSTRAINT uq_food_truck_locations_biz_sid UNIQUE (business_id, supabase_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_food_truck_locations_biz_active
  ON food_truck_locations (business_id, active);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_food_truck_locations_updated_at') THEN
    CREATE TRIGGER trg_food_truck_locations_updated_at
      BEFORE UPDATE ON food_truck_locations
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

ALTER TABLE food_truck_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS food_truck_locations_insert ON food_truck_locations;
CREATE POLICY food_truck_locations_insert ON food_truck_locations
  FOR INSERT TO public
  WITH CHECK (business_id IN (SELECT my_business_ids()));

DROP POLICY IF EXISTS food_truck_locations_jwt_modify ON food_truck_locations;
CREATE POLICY food_truck_locations_jwt_modify ON food_truck_locations
  FOR ALL TO anon, authenticated
  USING      (business_id = (((auth.jwt() -> 'app_metadata') ->> 'business_id'))::uuid)
  WITH CHECK (business_id = (((auth.jwt() -> 'app_metadata') ->> 'business_id'))::uuid);

DROP POLICY IF EXISTS food_truck_locations_jwt_select ON food_truck_locations;
CREATE POLICY food_truck_locations_jwt_select ON food_truck_locations
  FOR SELECT TO anon, authenticated
  USING (
    (business_id = (NULLIF(((auth.jwt() -> 'app_metadata') ->> 'business_id'), ''))::uuid)
    OR (business_id IN (SELECT my_business_ids()))
  );


-- ── waste_log ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS waste_log (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id                 UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  business_id                 UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  inventory_item_supabase_id  UUID,
  qty                         NUMERIC NOT NULL,
  unit                        TEXT,
  reason                      TEXT NOT NULL,
  photo_url                   TEXT,
  occurred_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cuadre_supabase_id          UUID,
  created_by                  TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_waste_log_biz_sid') THEN
    ALTER TABLE waste_log
      ADD CONSTRAINT uq_waste_log_biz_sid UNIQUE (business_id, supabase_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_waste_log_biz_occurred
  ON waste_log (business_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_waste_log_item
  ON waste_log (business_id, inventory_item_supabase_id);
-- Append-mostly: BRIN keeps the time-ranged report queries cheap.
CREATE INDEX IF NOT EXISTS brin_waste_log_created
  ON waste_log USING BRIN (created_at);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_waste_log_updated_at') THEN
    CREATE TRIGGER trg_waste_log_updated_at
      BEFORE UPDATE ON waste_log
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

ALTER TABLE waste_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS waste_log_insert ON waste_log;
CREATE POLICY waste_log_insert ON waste_log
  FOR INSERT TO public
  WITH CHECK (business_id IN (SELECT my_business_ids()));

DROP POLICY IF EXISTS waste_log_jwt_modify ON waste_log;
CREATE POLICY waste_log_jwt_modify ON waste_log
  FOR ALL TO anon, authenticated
  USING      (business_id = (((auth.jwt() -> 'app_metadata') ->> 'business_id'))::uuid)
  WITH CHECK (business_id = (((auth.jwt() -> 'app_metadata') ->> 'business_id'))::uuid);

DROP POLICY IF EXISTS waste_log_jwt_select ON waste_log;
CREATE POLICY waste_log_jwt_select ON waste_log
  FOR SELECT TO anon, authenticated
  USING (
    (business_id = (NULLIF(((auth.jwt() -> 'app_metadata') ->> 'business_id'), ''))::uuid)
    OR (business_id IN (SELECT my_business_ids()))
  );


-- ── cuadre_caja: truck shift breadcrumbs ───────────────────────────────────
ALTER TABLE cuadre_caja ADD COLUMN IF NOT EXISTS start_location_supabase_id UUID;
ALTER TABLE cuadre_caja ADD COLUMN IF NOT EXISTS start_lat                  DOUBLE PRECISION;
ALTER TABLE cuadre_caja ADD COLUMN IF NOT EXISTS start_lng                  DOUBLE PRECISION;
ALTER TABLE cuadre_caja ADD COLUMN IF NOT EXISTS start_notes                TEXT;


-- ── tickets: per-ticket location stamp (mobile clients eat-and-go) ─────────
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS food_truck_location_supabase_id UUID;
CREATE INDEX IF NOT EXISTS idx_tickets_food_truck_location
  ON tickets (business_id, food_truck_location_supabase_id)
  WHERE food_truck_location_supabase_id IS NOT NULL;
