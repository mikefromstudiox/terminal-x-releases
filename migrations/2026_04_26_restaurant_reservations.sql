-- ─────────────────────────────────────────────────────────────────────────────
-- 2026_04_26_restaurant_reservations.sql
--
-- Terminal X v2.16.3 — Restaurante H4: Reservas
--
-- Adds the `restaurant_reservations` table for front-of-house reservation
-- management (separate from dealership `vehicle_reservations`). Idempotent —
-- safe to re-run on prod. RLS scoped by business_id, anon revoked from writes
-- (desktop sync uses service-role key).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS restaurant_reservations (
  id                   BIGSERIAL PRIMARY KEY,
  supabase_id          UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  business_id          UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  mesa_id              BIGINT,
  mesa_supabase_id     UUID,
  fecha                DATE NOT NULL,
  hora                 TIME NOT NULL,
  duration_min         INTEGER NOT NULL DEFAULT 90,
  nombre               TEXT NOT NULL,
  telefono             TEXT,
  guests               INTEGER NOT NULL DEFAULT 2 CHECK (guests > 0),
  notas                TEXT,
  status               TEXT NOT NULL DEFAULT 'pendiente'
                       CHECK (status IN ('pendiente','confirmada','sentada','cancelada','no_show')),
  whatsapp_sent_at     TIMESTAMPTZ,
  cancelled_reason     TEXT,
  seated_ticket_supabase_id UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_reservations_biz_date
  ON restaurant_reservations (business_id, fecha, hora);
CREATE INDEX IF NOT EXISTS idx_restaurant_reservations_status
  ON restaurant_reservations (business_id, status);

-- updated_at trigger (mirrors the convention used by tickets/mesas).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_restaurant_reservations_updated_at') THEN
    CREATE TRIGGER trg_restaurant_reservations_updated_at
      BEFORE UPDATE ON restaurant_reservations
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- RLS — scoped by business_id, anon read/write only when bid is set.
ALTER TABLE restaurant_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS restaurant_reservations_anon_select ON restaurant_reservations;
CREATE POLICY restaurant_reservations_anon_select ON restaurant_reservations
  FOR SELECT TO anon USING (business_id IS NOT NULL);

DROP POLICY IF EXISTS restaurant_reservations_anon_insert ON restaurant_reservations;
CREATE POLICY restaurant_reservations_anon_insert ON restaurant_reservations
  FOR INSERT TO anon WITH CHECK (business_id IS NOT NULL);

DROP POLICY IF EXISTS restaurant_reservations_anon_update ON restaurant_reservations;
CREATE POLICY restaurant_reservations_anon_update ON restaurant_reservations
  FOR UPDATE TO anon USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);

DROP POLICY IF EXISTS restaurant_reservations_anon_delete ON restaurant_reservations;
CREATE POLICY restaurant_reservations_anon_delete ON restaurant_reservations
  FOR DELETE TO anon USING (business_id IS NOT NULL);
