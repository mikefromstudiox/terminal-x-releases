-- Supabase migration: commissions system
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)

-- 0. Add business_id to washer_commissions if missing (original schema didn't have it)
ALTER TABLE washer_commissions ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);

-- 0b. RLS + policy for washer_commissions
ALTER TABLE washer_commissions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "washer_commissions_all" ON washer_commissions FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 1. Add commission_pct to staff table (users)
ALTER TABLE staff ADD COLUMN IF NOT EXISTS commission_pct REAL NOT NULL DEFAULT 0;

-- 2. Add beverage_subtotal to tickets
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS beverage_subtotal REAL NOT NULL DEFAULT 0;

-- 3. Seller commissions table
CREATE TABLE IF NOT EXISTS seller_commissions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       UUID NOT NULL REFERENCES businesses(id),
  seller_id         UUID NOT NULL REFERENCES sellers(id),
  ticket_id         UUID NOT NULL REFERENCES tickets(id),
  base_amount       REAL NOT NULL,
  commission_pct    REAL NOT NULL,
  commission_amount REAL NOT NULL,
  paid              BOOLEAN NOT NULL DEFAULT false,
  paid_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Cajero commissions table
CREATE TABLE IF NOT EXISTS cajero_commissions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       UUID NOT NULL REFERENCES businesses(id),
  cajero_id         UUID NOT NULL REFERENCES staff(id),
  ticket_id         UUID NOT NULL REFERENCES tickets(id),
  base_amount       REAL NOT NULL,
  commission_pct    REAL NOT NULL,
  commission_amount REAL NOT NULL,
  paid              BOOLEAN NOT NULL DEFAULT false,
  paid_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. RLS policies (match existing pattern)
ALTER TABLE seller_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cajero_commissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "seller_commissions_all" ON seller_commissions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "cajero_commissions_all" ON cajero_commissions FOR ALL USING (true) WITH CHECK (true);

-- 6. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_seller_comm_biz ON seller_commissions(business_id);
CREATE INDEX IF NOT EXISTS idx_seller_comm_seller ON seller_commissions(seller_id);
CREATE INDEX IF NOT EXISTS idx_seller_comm_ticket ON seller_commissions(ticket_id);
CREATE INDEX IF NOT EXISTS idx_cajero_comm_biz ON cajero_commissions(business_id);
CREATE INDEX IF NOT EXISTS idx_cajero_comm_cajero ON cajero_commissions(cajero_id);
CREATE INDEX IF NOT EXISTS idx_cajero_comm_ticket ON cajero_commissions(ticket_id);
