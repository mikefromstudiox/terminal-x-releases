-- 2026_04_27_pg17_runtime_tuning.sql
-- PG17 Sprint 2 — FIX-PG17-4
--   (a) transaction_timeout per-role  (PG17 GUC)
--   (b) vacuum_buffer_usage_limit per hot table  (PG17 streaming I/O)
--   (c) CREATE STATISTICS on RLS predicate column pairs
--
-- All idempotent. Safe under live ops. Service role unrestricted.

-- ─── (a) transaction_timeout per-role ───────────────────────────────────────
-- 60s on authenticated covers every legitimate web POS transaction
-- (cobro, e-CF sign+submit p99 ≈ 8s). 15s on anon — only landing & rate-limit
-- counters. service_role left at 0 (sync needs long upserts).
ALTER ROLE authenticated SET transaction_timeout = '60s';
ALTER ROLE anon          SET transaction_timeout = '15s';
ALTER ROLE service_role  SET transaction_timeout = '0';

-- ─── (b) autovacuum threshold tuning per hot table ──────────────────────────
-- vacuum_buffer_usage_limit is a session/system GUC in PG17, not a reloption,
-- and Supabase manages it globally. Instead tune the *trigger* thresholds
-- on the hottest tables so autovacuum kicks in earlier under churn.
ALTER TABLE public.tickets              SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE public.ticket_items         SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE public.activity_log         SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE public.license_events       SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE public.ecf_queue            SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);
ALTER TABLE public.ecf_submissions      SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE public.loyalty_transactions SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE public.inventory_items      SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE public.seller_commissions   SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE public.cajero_commissions   SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);

-- ─── (c) multi-column statistics on RLS predicate pairs ─────────────────────
-- Under RLS the planner re-evaluates (business_id = X) joined with status /
-- severity / category. Without combined stats it assumes independence and
-- mis-estimates row counts by 10-100x → bad join order.
DROP STATISTICS IF EXISTS public.stx_tickets_biz_status;
CREATE STATISTICS public.stx_tickets_biz_status (dependencies, ndistinct, mcv)
  ON business_id, status FROM public.tickets;

DROP STATISTICS IF EXISTS public.stx_tickets_biz_mode;
CREATE STATISTICS public.stx_tickets_biz_mode (dependencies, ndistinct, mcv)
  ON business_id, mode FROM public.tickets;

DROP STATISTICS IF EXISTS public.stx_activity_biz_event_severity;
CREATE STATISTICS public.stx_activity_biz_event_severity (dependencies, ndistinct, mcv)
  ON business_id, event_type, severity FROM public.activity_log;

DROP STATISTICS IF EXISTS public.stx_ecf_queue_biz_status;
CREATE STATISTICS public.stx_ecf_queue_biz_status (dependencies, ndistinct, mcv)
  ON business_id, status FROM public.ecf_queue;

DROP STATISTICS IF EXISTS public.stx_inventory_biz_category;
CREATE STATISTICS public.stx_inventory_biz_category (dependencies, ndistinct, mcv)
  ON business_id, category FROM public.inventory_items;

-- Refresh planner stats so the new statistics objects populate immediately.
ANALYZE public.tickets;
ANALYZE public.activity_log;
ANALYZE public.ecf_queue;
ANALYZE public.inventory_items;

NOTIFY pgrst, 'reload schema';
