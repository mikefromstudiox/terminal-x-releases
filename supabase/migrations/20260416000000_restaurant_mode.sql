-- ============================================================================
-- Phase 2 — Restaurant Mode data model
-- Adds: services.printer_route/is_menu_item/course/station
--       tickets.tip_amount/fulfillment_type/mesa_supabase_id
--       mesas, modificadores, service_modificadores, ticket_item_modificadores, kds_events
--
-- Reuses the generic trg_set_updated_at_insert() defined in
-- 20260414000001_updated_at_sync_fix.sql — do NOT redefine.
-- ============================================================================

-- ── Additive columns on existing tables ─────────────────────────────────────
ALTER TABLE services ADD COLUMN IF NOT EXISTS printer_route TEXT DEFAULT 'receipt';
ALTER TABLE services ADD COLUMN IF NOT EXISTS is_menu_item BOOLEAN DEFAULT false;
ALTER TABLE services ADD COLUMN IF NOT EXISTS course TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS station TEXT;

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tip_amount NUMERIC(12,2) DEFAULT 0;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS fulfillment_type TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS mesa_supabase_id UUID;

-- ── mesas ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mesas (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id                 UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  business_id                 UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name                        TEXT NOT NULL,
  zone                        TEXT,
  capacity                    INTEGER DEFAULT 4,
  status                      TEXT NOT NULL DEFAULT 'libre',
  waiter_empleado_supabase_id UUID,
  guests_count                INTEGER DEFAULT 0,
  seated_at                   TIMESTAMPTZ,
  sort_order                  INTEGER DEFAULT 0,
  active                      BOOLEAN NOT NULL DEFAULT true,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE mesas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mesas_select" ON mesas;
DROP POLICY IF EXISTS "mesas_insert" ON mesas;
DROP POLICY IF EXISTS "mesas_update" ON mesas;
DROP POLICY IF EXISTS "mesas_delete" ON mesas;
CREATE POLICY "mesas_select" ON mesas FOR SELECT USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "mesas_insert" ON mesas FOR INSERT WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "mesas_update" ON mesas FOR UPDATE USING (business_id IN (SELECT my_business_ids())) WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "mesas_delete" ON mesas FOR DELETE USING (business_id IN (SELECT my_business_ids()));
DROP TRIGGER IF EXISTS trg_mesas_updated_at_insert ON mesas;
CREATE TRIGGER trg_mesas_updated_at_insert BEFORE INSERT ON mesas FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at_insert();

-- ── modificadores ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS modificadores (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id       UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  business_id       UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  group_name        TEXT,
  price_delta       NUMERIC(12,2) NOT NULL DEFAULT 0,
  min_select        INTEGER DEFAULT 0,
  max_select        INTEGER DEFAULT 1,
  default_selected  BOOLEAN NOT NULL DEFAULT false,
  sort_order        INTEGER DEFAULT 0,
  active            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE modificadores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "modificadores_select" ON modificadores;
DROP POLICY IF EXISTS "modificadores_insert" ON modificadores;
DROP POLICY IF EXISTS "modificadores_update" ON modificadores;
DROP POLICY IF EXISTS "modificadores_delete" ON modificadores;
CREATE POLICY "modificadores_select" ON modificadores FOR SELECT USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "modificadores_insert" ON modificadores FOR INSERT WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "modificadores_update" ON modificadores FOR UPDATE USING (business_id IN (SELECT my_business_ids())) WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "modificadores_delete" ON modificadores FOR DELETE USING (business_id IN (SELECT my_business_ids()));
DROP TRIGGER IF EXISTS trg_modificadores_updated_at_insert ON modificadores;
CREATE TRIGGER trg_modificadores_updated_at_insert BEFORE INSERT ON modificadores FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at_insert();

-- ── service_modificadores ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS service_modificadores (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id             UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  business_id             UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  service_supabase_id     UUID NOT NULL,
  modificador_supabase_id UUID NOT NULL,
  is_required             BOOLEAN NOT NULL DEFAULT false,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE service_modificadores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_modificadores_select" ON service_modificadores;
DROP POLICY IF EXISTS "service_modificadores_insert" ON service_modificadores;
DROP POLICY IF EXISTS "service_modificadores_update" ON service_modificadores;
DROP POLICY IF EXISTS "service_modificadores_delete" ON service_modificadores;
CREATE POLICY "service_modificadores_select" ON service_modificadores FOR SELECT USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "service_modificadores_insert" ON service_modificadores FOR INSERT WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "service_modificadores_update" ON service_modificadores FOR UPDATE USING (business_id IN (SELECT my_business_ids())) WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "service_modificadores_delete" ON service_modificadores FOR DELETE USING (business_id IN (SELECT my_business_ids()));
DROP TRIGGER IF EXISTS trg_service_modificadores_updated_at_insert ON service_modificadores;
CREATE TRIGGER trg_service_modificadores_updated_at_insert BEFORE INSERT ON service_modificadores FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at_insert();
CREATE INDEX IF NOT EXISTS idx_sm_service ON service_modificadores(service_supabase_id);
CREATE INDEX IF NOT EXISTS idx_sm_modificador ON service_modificadores(modificador_supabase_id);

-- ── ticket_item_modificadores ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticket_item_modificadores (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id             UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  business_id             UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  ticket_item_supabase_id UUID NOT NULL,
  modificador_supabase_id UUID,
  name_snapshot           TEXT NOT NULL,
  price_delta_snapshot    NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE ticket_item_modificadores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tim_select" ON ticket_item_modificadores;
DROP POLICY IF EXISTS "tim_insert" ON ticket_item_modificadores;
DROP POLICY IF EXISTS "tim_update" ON ticket_item_modificadores;
DROP POLICY IF EXISTS "tim_delete" ON ticket_item_modificadores;
CREATE POLICY "tim_select" ON ticket_item_modificadores FOR SELECT USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "tim_insert" ON ticket_item_modificadores FOR INSERT WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "tim_update" ON ticket_item_modificadores FOR UPDATE USING (business_id IN (SELECT my_business_ids())) WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "tim_delete" ON ticket_item_modificadores FOR DELETE USING (business_id IN (SELECT my_business_ids()));
DROP TRIGGER IF EXISTS trg_ticket_item_modificadores_updated_at_insert ON ticket_item_modificadores;
CREATE TRIGGER trg_ticket_item_modificadores_updated_at_insert BEFORE INSERT ON ticket_item_modificadores FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at_insert();
CREATE INDEX IF NOT EXISTS idx_tim_ticket_item ON ticket_item_modificadores(ticket_item_supabase_id);

-- ── kds_events ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kds_events (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id             UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  business_id             UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  ticket_item_supabase_id UUID NOT NULL,
  mesa_supabase_id        UUID,
  station                 TEXT,
  status                  TEXT NOT NULL DEFAULT 'fired',
  fired_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at              TIMESTAMPTZ,
  ready_at                TIMESTAMPTZ,
  bumped_at               TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE kds_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "kds_events_select" ON kds_events;
DROP POLICY IF EXISTS "kds_events_insert" ON kds_events;
DROP POLICY IF EXISTS "kds_events_update" ON kds_events;
DROP POLICY IF EXISTS "kds_events_delete" ON kds_events;
CREATE POLICY "kds_events_select" ON kds_events FOR SELECT USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "kds_events_insert" ON kds_events FOR INSERT WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "kds_events_update" ON kds_events FOR UPDATE USING (business_id IN (SELECT my_business_ids())) WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "kds_events_delete" ON kds_events FOR DELETE USING (business_id IN (SELECT my_business_ids()));
DROP TRIGGER IF EXISTS trg_kds_events_updated_at_insert ON kds_events;
CREATE TRIGGER trg_kds_events_updated_at_insert BEFORE INSERT ON kds_events FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at_insert();
CREATE INDEX IF NOT EXISTS idx_kds_events_status ON kds_events(status);
CREATE INDEX IF NOT EXISTS idx_kds_events_ticket_item ON kds_events(ticket_item_supabase_id);

-- ── tickets.mesa lookup index ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tickets_mesa_supabase_id ON tickets(mesa_supabase_id);
