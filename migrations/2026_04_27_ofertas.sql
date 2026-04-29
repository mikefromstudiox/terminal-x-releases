-- ─────────────────────────────────────────────────────────────────────────────
-- 2026_04_27_ofertas.sql
--
-- Terminal X v2.16.x — Ofertas (product bundles).
--
-- Adds `ofertas` (parent) + `oferta_items` (components) tables for
-- multi-product bundles at a custom promo price. POS sells by exploding the
-- bundle into one ticket_item per component + an automatic discount line, so
-- inventory + ITBIS + commission paths stay unchanged. Each cart line carries
-- the new `ticket_items.oferta_supabase_id` so reports can group/undo a sold
-- bundle.
--
-- Idempotent — safe to re-run on prod. RLS scoped by business_id, anon
-- revoked from writes during desktop sync (service-role bypass).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ofertas (
  id            BIGSERIAL PRIMARY KEY,
  supabase_id   UUID NOT NULL DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  price         NUMERIC(14,2) NOT NULL DEFAULT 0,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at     TIMESTAMPTZ,
  ends_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_ofertas_biz_supabase_id') THEN
    ALTER TABLE ofertas ADD CONSTRAINT uq_ofertas_biz_supabase_id UNIQUE (business_id, supabase_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_ofertas_supabase_id') THEN
    ALTER TABLE ofertas ADD CONSTRAINT uq_ofertas_supabase_id UNIQUE (supabase_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ofertas_biz_active ON ofertas (business_id, active);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ofertas_updated_at') THEN
    CREATE TRIGGER trg_ofertas_updated_at
      BEFORE UPDATE ON ofertas
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS oferta_items (
  id                          BIGSERIAL PRIMARY KEY,
  supabase_id                 UUID NOT NULL DEFAULT gen_random_uuid(),
  business_id                 UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  oferta_supabase_id          UUID NOT NULL,
  service_supabase_id         UUID,
  inventory_item_supabase_id  UUID,
  qty                         NUMERIC(14,4) NOT NULL DEFAULT 1,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_oferta_items_one_of CHECK (
    (service_supabase_id IS NOT NULL AND inventory_item_supabase_id IS NULL)
    OR (service_supabase_id IS NULL AND inventory_item_supabase_id IS NOT NULL)
  )
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_oferta_items_biz_supabase_id') THEN
    ALTER TABLE oferta_items ADD CONSTRAINT uq_oferta_items_biz_supabase_id UNIQUE (business_id, supabase_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_oferta_items_oferta') THEN
    ALTER TABLE oferta_items ADD CONSTRAINT fk_oferta_items_oferta
      FOREIGN KEY (oferta_supabase_id) REFERENCES ofertas(supabase_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_oferta_items_oferta ON oferta_items (oferta_supabase_id);
CREATE INDEX IF NOT EXISTS idx_oferta_items_biz ON oferta_items (business_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_oferta_items_updated_at') THEN
    CREATE TRIGGER trg_oferta_items_updated_at
      BEFORE UPDATE ON oferta_items
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

ALTER TABLE ticket_items ADD COLUMN IF NOT EXISTS oferta_supabase_id UUID;
CREATE INDEX IF NOT EXISTS idx_ticket_items_oferta_supabase_id ON ticket_items (oferta_supabase_id) WHERE oferta_supabase_id IS NOT NULL;

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE ofertas ENABLE ROW LEVEL SECURITY;
ALTER TABLE oferta_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ofertas_anon_select ON ofertas;
CREATE POLICY ofertas_anon_select ON ofertas
  FOR SELECT TO anon USING (business_id IS NOT NULL);
DROP POLICY IF EXISTS ofertas_anon_insert ON ofertas;
CREATE POLICY ofertas_anon_insert ON ofertas
  FOR INSERT TO anon WITH CHECK (business_id IS NOT NULL);
DROP POLICY IF EXISTS ofertas_anon_update ON ofertas;
CREATE POLICY ofertas_anon_update ON ofertas
  FOR UPDATE TO anon USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);
DROP POLICY IF EXISTS ofertas_anon_delete ON ofertas;
CREATE POLICY ofertas_anon_delete ON ofertas
  FOR DELETE TO anon USING (business_id IS NOT NULL);

DROP POLICY IF EXISTS oferta_items_anon_select ON oferta_items;
CREATE POLICY oferta_items_anon_select ON oferta_items
  FOR SELECT TO anon USING (business_id IS NOT NULL);
DROP POLICY IF EXISTS oferta_items_anon_insert ON oferta_items;
CREATE POLICY oferta_items_anon_insert ON oferta_items
  FOR INSERT TO anon WITH CHECK (business_id IS NOT NULL);
DROP POLICY IF EXISTS oferta_items_anon_update ON oferta_items;
CREATE POLICY oferta_items_anon_update ON oferta_items
  FOR UPDATE TO anon USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);
DROP POLICY IF EXISTS oferta_items_anon_delete ON oferta_items;
CREATE POLICY oferta_items_anon_delete ON oferta_items
  FOR DELETE TO anon USING (business_id IS NOT NULL);

-- Authenticated role policies (web users logged in via signInWithPassword)
DROP POLICY IF EXISTS ofertas_auth_select ON ofertas;
CREATE POLICY ofertas_auth_select ON ofertas FOR SELECT TO authenticated USING (business_id IS NOT NULL);
DROP POLICY IF EXISTS ofertas_auth_insert ON ofertas;
CREATE POLICY ofertas_auth_insert ON ofertas FOR INSERT TO authenticated WITH CHECK (business_id IS NOT NULL);
DROP POLICY IF EXISTS ofertas_auth_update ON ofertas;
CREATE POLICY ofertas_auth_update ON ofertas FOR UPDATE TO authenticated USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);
DROP POLICY IF EXISTS ofertas_auth_delete ON ofertas;
CREATE POLICY ofertas_auth_delete ON ofertas FOR DELETE TO authenticated USING (business_id IS NOT NULL);

DROP POLICY IF EXISTS oferta_items_auth_select ON oferta_items;
CREATE POLICY oferta_items_auth_select ON oferta_items FOR SELECT TO authenticated USING (business_id IS NOT NULL);
DROP POLICY IF EXISTS oferta_items_auth_insert ON oferta_items;
CREATE POLICY oferta_items_auth_insert ON oferta_items FOR INSERT TO authenticated WITH CHECK (business_id IS NOT NULL);
DROP POLICY IF EXISTS oferta_items_auth_update ON oferta_items;
CREATE POLICY oferta_items_auth_update ON oferta_items FOR UPDATE TO authenticated USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);
DROP POLICY IF EXISTS oferta_items_auth_delete ON oferta_items;
CREATE POLICY oferta_items_auth_delete ON oferta_items FOR DELETE TO authenticated USING (business_id IS NOT NULL);
