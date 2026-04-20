-- =============================================================================
-- 20260420_deposit_amount.sql
-- Licoreria vertical — bottle / envase deposit flow (Ranoza go-live 2026-04-21)
--
-- Canonical column name in the SQLite schema is `bottle_deposit` (introduced
-- in v2.3). The product spec refers to the same concept as "deposit_amount";
-- we keep the existing name to avoid a rename migration while documenting
-- the alias here. All code paths treat `bottle_deposit` as THE deposit fee
-- column. Generated column `deposit_amount` mirrors it so future analytics
-- can use either name transparently and no writer ever breaks.
--
-- Scope: licoreria subtype only at the app layer. Column is unconditional
-- at the DB layer (default 0) so non-licoreria tenants are unaffected.
-- =============================================================================

-- 1) Per-product deposit fee on inventory_items ------------------------------
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS bottle_deposit NUMERIC(10,2) NOT NULL DEFAULT 0;

-- Read-only alias so queries using the spec'd name `deposit_amount` work.
-- Stored generated column stays in lock-step with `bottle_deposit`.
DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='inventory_items' AND column_name='deposit_amount'
  ) THEN
    EXECUTE 'ALTER TABLE inventory_items
             ADD COLUMN deposit_amount NUMERIC(10,2)
             GENERATED ALWAYS AS (COALESCE(bottle_deposit, 0)) STORED';
  END IF;
END
$mig$;

-- 2) Flag deposit lines on ticket_items --------------------------------------
-- When RetailPOS expands the cart for a licoreria ticket it inserts a
-- "Deposito envase" line right after each inventoried product that carries a
-- deposit. We persist the flag so reports / cuadre / receipts can cleanly
-- segregate deposit revenue from product revenue — no SKU-marker heuristics.
ALTER TABLE ticket_items
  ADD COLUMN IF NOT EXISTS is_deposit BOOLEAN NOT NULL DEFAULT FALSE;

-- Back-fill legacy rows previously tagged only via the synthetic 'DEP' SKU.
UPDATE ticket_items
   SET is_deposit = TRUE
 WHERE is_deposit = FALSE
   AND (UPPER(COALESCE(sku,'')) = 'DEP');

-- 3) Indexes (cheap and high-leverage for the daily-report scan) -------------
CREATE INDEX IF NOT EXISTS idx_ticket_items_is_deposit
  ON ticket_items (ticket_supabase_id)
  WHERE is_deposit = TRUE;

CREATE INDEX IF NOT EXISTS idx_inventory_items_bottle_deposit
  ON inventory_items (business_id)
  WHERE bottle_deposit > 0;

-- 4) RLS — inherit parent table policies; no new policy needed. ---------------
-- (ticket_items + inventory_items already carry tenant-scoped anon/auth
-- policies under the supabase_id architecture.)

COMMENT ON COLUMN inventory_items.bottle_deposit IS
  'Licoreria vertical: per-product bottle/envase deposit fee in RD$. Aliased as deposit_amount.';
COMMENT ON COLUMN ticket_items.is_deposit IS
  'TRUE = synthetic deposit line (envase). Segregates deposit revenue from product revenue.';
