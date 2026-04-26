-- Terminal X v2.16.1 patch — Salón silent-failure audit fixes (CRITICAL #2,#4,#7).
-- Schema additions only. Companion: electron/database.js v2.16.1 patch block.
--
-- Fixes:
--   #2  Per-line stylist persistence on ticket_items.empleado_supabase_id
--       (commission split per line, not per ticket).
--   #4  inventory_items.salon_upsell + salon_upsell_order columns
--       (CobrarModal upsell tile selector + ordering).
--   #7  Public-booking double-booking race — DB-level partial unique index
--       on (business_id, empleado_supabase_id, date, start_time) for live
--       (non-cancelled, non-no_show) appointments.

-- =========================================================================
-- 1. ticket_items.empleado_supabase_id — per-line commission credit
-- =========================================================================
ALTER TABLE ticket_items
  ADD COLUMN IF NOT EXISTS empleado_supabase_id UUID;

CREATE INDEX IF NOT EXISTS ticket_items_empleado_idx
  ON ticket_items (empleado_supabase_id)
  WHERE empleado_supabase_id IS NOT NULL;

-- =========================================================================
-- 2. inventory_items.salon_upsell + salon_upsell_order — curated upsell tiles
-- =========================================================================
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS salon_upsell BOOLEAN DEFAULT false;

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS salon_upsell_order INTEGER;

CREATE INDEX IF NOT EXISTS inventory_items_salon_upsell_idx
  ON inventory_items (business_id, salon_upsell_order)
  WHERE salon_upsell = true;

-- =========================================================================
-- 3. appointments — partial unique index to block double-bookings
--    (concurrent public-booking POSTs racing on the same slot)
-- =========================================================================
CREATE UNIQUE INDEX IF NOT EXISTS appointments_no_double_book_idx
  ON appointments (business_id, empleado_supabase_id, date, start_time)
  WHERE status NOT IN ('cancelled', 'no_show');
