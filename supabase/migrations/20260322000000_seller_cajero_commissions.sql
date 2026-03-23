-- Migration 005: Add seller_commissions, cajero_commissions tables,
-- commission_pct column to staff, and "users" view alias for web compatibility

-- ── Add commission_pct to staff ───────────────────────────────────────────────
ALTER TABLE staff ADD COLUMN IF NOT EXISTS commission_pct NUMERIC(5,2) NOT NULL DEFAULT 0;

-- ── "users" view — web.js queries from('users'), Supabase table is "staff" ──
CREATE OR REPLACE VIEW users AS SELECT * FROM staff;

-- Allow inserts/updates/deletes through the view
CREATE OR REPLACE RULE users_insert AS ON INSERT TO users
  DO INSTEAD INSERT INTO staff VALUES (NEW.*) RETURNING *;
CREATE OR REPLACE RULE users_update AS ON UPDATE TO users
  DO INSTEAD UPDATE staff SET
    business_id   = NEW.business_id,
    auth_user_id  = NEW.auth_user_id,
    name          = NEW.name,
    username      = NEW.username,
    pin_hash      = NEW.pin_hash,
    role          = NEW.role,
    discount_pct  = NEW.discount_pct,
    commission_pct = NEW.commission_pct,
    seller_id     = NEW.seller_id,
    active        = NEW.active,
    updated_at    = NEW.updated_at
  WHERE staff.id = OLD.id RETURNING *;
CREATE OR REPLACE RULE users_delete AS ON DELETE TO users
  DO INSTEAD DELETE FROM staff WHERE staff.id = OLD.id;

-- ── Seller Commissions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seller_commissions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  seller_id           UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  ticket_id           UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  base_amount         NUMERIC(12,2) NOT NULL,
  commission_pct      NUMERIC(5,2) NOT NULL,
  commission_amount   NUMERIC(12,2) NOT NULL,
  paid                BOOLEAN NOT NULL DEFAULT false,
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Cajero Commissions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cajero_commissions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  cajero_id           UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  ticket_id           UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  base_amount         NUMERIC(12,2) NOT NULL,
  commission_pct      NUMERIC(5,2) NOT NULL,
  commission_amount   NUMERIC(12,2) NOT NULL,
  paid                BOOLEAN NOT NULL DEFAULT false,
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_seller_comm_business ON seller_commissions(business_id);
CREATE INDEX IF NOT EXISTS idx_seller_comm_seller ON seller_commissions(seller_id);
CREATE INDEX IF NOT EXISTS idx_seller_comm_ticket ON seller_commissions(ticket_id);
CREATE INDEX IF NOT EXISTS idx_seller_comm_paid ON seller_commissions(business_id, paid) WHERE paid = false;
CREATE INDEX IF NOT EXISTS idx_seller_comm_date ON seller_commissions(business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cajero_comm_business ON cajero_commissions(business_id);
CREATE INDEX IF NOT EXISTS idx_cajero_comm_cajero ON cajero_commissions(cajero_id);
CREATE INDEX IF NOT EXISTS idx_cajero_comm_ticket ON cajero_commissions(ticket_id);
CREATE INDEX IF NOT EXISTS idx_cajero_comm_paid ON cajero_commissions(business_id, paid) WHERE paid = false;
CREATE INDEX IF NOT EXISTS idx_cajero_comm_date ON cajero_commissions(business_id, created_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE seller_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cajero_commissions ENABLE ROW LEVEL SECURITY;

-- seller_commissions
CREATE POLICY "seller_comm_select" ON seller_commissions FOR SELECT
  USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "seller_comm_insert" ON seller_commissions FOR INSERT
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "seller_comm_update" ON seller_commissions FOR UPDATE
  USING (business_id IN (SELECT my_business_ids()))
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "seller_comm_delete" ON seller_commissions FOR DELETE
  USING (business_id IN (SELECT my_business_ids()));

-- cajero_commissions
CREATE POLICY "cajero_comm_select" ON cajero_commissions FOR SELECT
  USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "cajero_comm_insert" ON cajero_commissions FOR INSERT
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "cajero_comm_update" ON cajero_commissions FOR UPDATE
  USING (business_id IN (SELECT my_business_ids()))
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "cajero_comm_delete" ON cajero_commissions FOR DELETE
  USING (business_id IN (SELECT my_business_ids()));

-- ── local_id for sync ─────────────────────────────────────────────────────────
ALTER TABLE seller_commissions ADD COLUMN IF NOT EXISTS local_id INTEGER;
ALTER TABLE cajero_commissions ADD COLUMN IF NOT EXISTS local_id INTEGER;
