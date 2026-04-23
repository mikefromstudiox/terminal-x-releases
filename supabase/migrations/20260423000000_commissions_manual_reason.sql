-- v2.14 — manual commission entry: owner can add a commission row
-- without a backing ticket (standalone liquidación entry).
-- manual_reason is nullable; rows with manual_reason IS NOT NULL are
-- treated as manually-entered and get pencil/trash affordances in the UI.

ALTER TABLE washer_commissions
  ADD COLUMN IF NOT EXISTS manual_reason TEXT;

ALTER TABLE seller_commissions
  ADD COLUMN IF NOT EXISTS manual_reason TEXT;

ALTER TABLE cajero_commissions
  ADD COLUMN IF NOT EXISTS manual_reason TEXT;
