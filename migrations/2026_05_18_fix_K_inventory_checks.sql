-- 2026-05-18 Fix K — CHECK constraints on inventory_items. Previously accepted
-- negative price/cost/quantity/min_quantity and empty names (silent garbage data).
ALTER TABLE inventory_items ADD CONSTRAINT chk_inventory_price_nonneg    CHECK (price IS NULL OR price >= 0) NOT VALID;
ALTER TABLE inventory_items ADD CONSTRAINT chk_inventory_cost_nonneg     CHECK (cost  IS NULL OR cost  >= 0) NOT VALID;
ALTER TABLE inventory_items ADD CONSTRAINT chk_inventory_minqty_nonneg   CHECK (min_quantity IS NULL OR min_quantity >= 0) NOT VALID;
ALTER TABLE inventory_items ADD CONSTRAINT chk_inventory_name_not_blank  CHECK (length(trim(name)) > 0) NOT VALID;
ALTER TABLE inventory_items ADD CONSTRAINT chk_inventory_quantity_nonneg CHECK (quantity IS NULL OR quantity >= 0) NOT VALID;
