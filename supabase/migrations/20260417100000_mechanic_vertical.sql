-- Mechanic vertical: multi-line WO totals, digital inspection, odometer tracking,
-- parts back-order, estimate customer approval. Idempotent. Safe to re-run.

-- ── vehicles: odometer + service tracking ───────────────────────────────────
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS odometer_km      INTEGER;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_service_km  INTEGER;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_service_at  TIMESTAMPTZ;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS next_service_km  INTEGER;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS next_service_at  TIMESTAMPTZ;

-- ── work_orders: totals breakdown, inspection, approval, parts order ────────
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS labor_total              NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS parts_total              NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS itbis                    NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS total                    NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS inspection_json          JSONB;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS estimate_approved_at     TIMESTAMPTZ;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS customer_signature_url   TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS customer_approval_token  TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS expected_parts_arrival   DATE;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS odometer_in_km           INTEGER;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS odometer_out_km          INTEGER;

CREATE INDEX IF NOT EXISTS idx_work_orders_approval_token
  ON work_orders(customer_approval_token)
  WHERE customer_approval_token IS NOT NULL;

-- ── UNIQUE constraints for supabase_id-first sync (idempotent) ──────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicles_business_supabase_uk') THEN
    ALTER TABLE vehicles ADD CONSTRAINT vehicles_business_supabase_uk UNIQUE (business_id, supabase_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='service_bays_business_supabase_uk') THEN
    ALTER TABLE service_bays ADD CONSTRAINT service_bays_business_supabase_uk UNIQUE (business_id, supabase_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='work_orders_business_supabase_uk') THEN
    ALTER TABLE work_orders ADD CONSTRAINT work_orders_business_supabase_uk UNIQUE (business_id, supabase_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='work_order_items_business_supabase_uk') THEN
    ALTER TABLE work_order_items ADD CONSTRAINT work_order_items_business_supabase_uk UNIQUE (business_id, supabase_id);
  END IF;
END $$;
