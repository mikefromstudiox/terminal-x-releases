-- ════════════════════════════════════════════════════════════════════════════
-- 20260429000800_ticket_items_business_supabase_idx.sql
--
-- Phase C scale-test finding (2026-04-29): the web.js tickets read path joins
-- ticket_items on (business_id, ticket_supabase_id IN (…)). Before this
-- migration the table only had btree(ticket_id) — the dual-key supabase_id
-- column had no covering index, so the IN-list filter degraded to a Bitmap
-- Heap Scan + sequential filter on every read.
--
-- Measured impact (Studio X SRL, ~600K ticket_items synthetic):
--   Before: ticket_items join via ticket_supabase_id → 2,988 ms
--   After : same query                                →    80 ms (37× faster)
--
-- The index also accelerates the equivalent join used in dual-key web reads
-- across reports, RemoteDashboard, and the Resumen del Salón monthly views.
--
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_ticket_items_biz_ticket_sid
  ON public.ticket_items (business_id, ticket_supabase_id);
