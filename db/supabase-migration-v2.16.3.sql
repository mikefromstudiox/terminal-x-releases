-- Terminal X v2.16.3 — Carnicería hardening release
-- Adds: corte catalog, freshness batches, discards, recurring orders,
--       multi-scale registry, generic promotions + DR seasonal seed.
-- Extends: inventory_items (prepacked, expires_at, received_at, corte_category_supabase_id)
--          ticket_items (preparation_notes)
-- Idempotent. Safe to re-run.

BEGIN;

-- ── 1. Cortes catalog (with photo + nutrition) ──────────────────────────────
CREATE TABLE IF NOT EXISTS carniceria_corte_categories (
  id BIGSERIAL PRIMARY KEY,
  supabase_id UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,
  business_id UUID NOT NULL,
  nombre TEXT NOT NULL,
  nombre_dr_popular TEXT,
  tooltip_traduccion TEXT,
  especie TEXT NOT NULL CHECK (especie IN ('pollo','res','cerdo','viscera','embutidos','mariscos','otros')),
  photo_url TEXT,
  nutrition_json JSONB,
  sort_order INT DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_corte_cat_biz ON carniceria_corte_categories(business_id, active);

-- ── 2. inventory_items extension ────────────────────────────────────────────
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS prepacked BOOLEAN DEFAULT false;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS corte_category_supabase_id UUID;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS expires_at DATE;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS received_at DATE;

-- ── 3. Freshness batches + discards ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_freshness_log (
  id BIGSERIAL PRIMARY KEY,
  supabase_id UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,
  business_id UUID NOT NULL,
  inventory_item_supabase_id UUID NOT NULL,
  batch_lote TEXT,
  received_at DATE NOT NULL,
  expires_at DATE NOT NULL,
  qty_received NUMERIC(10,3) NOT NULL,
  qty_remaining NUMERIC(10,3) NOT NULL,
  unit TEXT DEFAULT 'lb',
  auto_discount_applied BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fresh_biz_item ON inventory_freshness_log(business_id, inventory_item_supabase_id);
CREATE INDEX IF NOT EXISTS idx_fresh_expires ON inventory_freshness_log(expires_at) WHERE qty_remaining > 0;

CREATE TABLE IF NOT EXISTS inventory_discards (
  id BIGSERIAL PRIMARY KEY,
  supabase_id UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,
  business_id UUID NOT NULL,
  inventory_item_supabase_id UUID NOT NULL,
  freshness_log_supabase_id UUID,
  qty NUMERIC(10,3) NOT NULL,
  unit TEXT DEFAULT 'lb',
  motivo TEXT NOT NULL,
  photo_url TEXT,
  empleado_supabase_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_disc_biz_date ON inventory_discards(business_id, created_at DESC);

-- ── 4. ticket_items.preparation_notes ───────────────────────────────────────
ALTER TABLE ticket_items ADD COLUMN IF NOT EXISTS preparation_notes TEXT;

-- ── 5. Mayoreo recurring orders ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recurring_orders (
  id BIGSERIAL PRIMARY KEY,
  supabase_id UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,
  business_id UUID NOT NULL,
  client_supabase_id UUID NOT NULL,
  nombre TEXT NOT NULL,
  dia_semana INT CHECK (dia_semana BETWEEN 0 AND 6),
  items_json JSONB NOT NULL,
  total_estimado NUMERIC(12,2),
  whatsapp_confirmar BOOLEAN DEFAULT true,
  last_sent_at TIMESTAMPTZ,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recurring_biz_dia ON recurring_orders(business_id, dia_semana, active);

-- ── 6. Multi-scale registry ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS carniceria_scales (
  id BIGSERIAL PRIMARY KEY,
  supabase_id UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,
  business_id UUID NOT NULL,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('plataforma','banco','otra')),
  device_path TEXT,
  protocol TEXT DEFAULT 'generic' CHECK (protocol IN ('cas-pdii','toledo','generic','mock')),
  baud_rate INT DEFAULT 9600,
  capacidad_max_lb NUMERIC(10,3),
  tare_default NUMERIC(10,3) DEFAULT 0,
  active_default BOOLEAN DEFAULT false,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scales_biz ON carniceria_scales(business_id, active);

-- ── 7. Generic promotions + items ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS promotions (
  id BIGSERIAL PRIMARY KEY,
  supabase_id UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,
  business_id UUID NOT NULL,
  name TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('pct','fijo','bundle','auto_50_vence')),
  discount_pct NUMERIC(5,2),
  discount_fixed NUMERIC(12,2),
  min_purchase NUMERIC(12,2),
  start_date DATE,
  end_date DATE,
  season_key TEXT,
  banner_text TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_promos_biz_active ON promotions(business_id, active);
CREATE INDEX IF NOT EXISTS idx_promos_season ON promotions(business_id, season_key) WHERE season_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promos_window ON promotions(business_id, start_date, end_date) WHERE active;

CREATE TABLE IF NOT EXISTS promotion_items (
  id BIGSERIAL PRIMARY KEY,
  supabase_id UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,
  business_id UUID NOT NULL,
  promotion_id BIGINT REFERENCES promotions(id) ON DELETE CASCADE,
  promotion_supabase_id UUID NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('inventory_item','service','corte_category')),
  item_supabase_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Defensive ALTER for installs that ran an earlier draft of this migration.
ALTER TABLE promotion_items ADD COLUMN IF NOT EXISTS business_id UUID;
CREATE INDEX IF NOT EXISTS idx_promo_items_promo ON promotion_items(promotion_supabase_id);

-- ── 8. updated_at triggers ──────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'carniceria_corte_categories','inventory_freshness_log','inventory_discards',
    'recurring_orders','carniceria_scales','promotions','promotion_items'
  ]) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at()', t, t);
  END LOOP;
END;
$$;

-- ── 9. RLS policies ─────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'carniceria_corte_categories','inventory_freshness_log','inventory_discards',
    'recurring_orders','carniceria_scales','promotions','promotion_items'
  ]) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "business_read_%I" ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "business_write_%I" ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY "business_read_%I" ON %I FOR SELECT USING (business_id = COALESCE(current_setting(''request.jwt.claims'', true)::json->>''business_id'', current_setting(''request.headers'', true)::json->>''x-business-id'')::uuid)',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "business_write_%I" ON %I FOR ALL USING (business_id = COALESCE(current_setting(''request.jwt.claims'', true)::json->>''business_id'', current_setting(''request.headers'', true)::json->>''x-business-id'')::uuid)',
      t, t
    );
  END LOOP;
END;
$$;

-- ── 10. Storage buckets ─────────────────────────────────────────────────────
-- Run via Supabase dashboard or storage API; SQL placeholders only.
-- corte-photos             public,  path {business_id}/cortes/{corte_supabase_id}.jpg
-- inventory-discard-photos private, path {business_id}/discards/{YYYY-MM-DD}/{discard_supabase_id}.jpg
-- (Created lazily by db-backup.js upload pattern; see electron/db-backup.js.)

COMMIT;
