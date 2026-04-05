-- ── Item cost tracking for profit margin reporting ───────────────────────────
-- Adds `cost` to services (unit cost set by owner) and to ticket_items
-- (snapshotted at sale time so historical profit reports stay accurate
-- even when service costs change later).

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS cost numeric(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE ticket_items
  ADD COLUMN IF NOT EXISTS cost numeric(12, 2) NOT NULL DEFAULT 0;
