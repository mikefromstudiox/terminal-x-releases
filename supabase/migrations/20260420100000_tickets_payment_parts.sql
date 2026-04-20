-- v2.10.4 — Sprint 9 — Restaurant split-payment parts persisted on tickets
--
-- CRITICAL E-C3 from today's audit: `payment_parts` was produced in-memory by
-- RestaurantPOS/SplitBillModal but never persisted on the ticket row. Split
-- bills evaporated on void/reports/cuadre — cash/card portions collapsed into
-- the single `payment_method` bucket, so Cuadre and DGII 606 were wrong for
-- every restaurant split.
--
-- Shape:
--   payment_parts = [ { "method": "cash", "amount": 400 },
--                     { "method": "card", "amount": 600 } ]
--
-- NULL = single-method ticket (fall back to tickets.payment_method).
-- Non-NULL = split bill; each part contributes to its own cuadre bucket.
--
-- SQLite twin migration is in electron/database.js (TEXT column, JSON string).
-- Web/desktop both write raw JSON on insert; readers normalize.
--
-- Idempotent: safe to re-apply.

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS payment_parts JSONB;

COMMENT ON COLUMN public.tickets.payment_parts IS
  'Restaurant split-bill payments: array of {method, amount}. NULL for single-method tickets.';

-- No default — NULL is meaningful ("not a split bill").
-- No check constraint — schema is enforced by the writer, not the DB, to keep
-- partial upgrades (older desktop clients pushing NULL) from erroring out.
