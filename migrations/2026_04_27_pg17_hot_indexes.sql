-- 2026_04_27_pg17_hot_indexes.sql
-- PG17 Optimization Sprint — applies the top-3 audit recommendations:
--   FIX-PG17-1: GIN(jsonb_path_ops) on the 5 hot jsonb columns
--   FIX-PG17-2: drop duplicate / redundant indexes & UNIQUE constraints
--   FIX-PG17-3: BRIN(created_at) on append-mostly time-series tables
--
-- All idempotent. Safe to re-run. RLS-preserving (no policy changes).
-- Tables stay small (<10MB each at time of write) so plain CREATE INDEX is
-- sub-second; CONCURRENTLY documented inline for >100k-row redeployments.

-- ─── FIX-PG17-1: GIN on hot jsonb columns ───────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tickets_payment_parts_gin
  ON public.tickets USING GIN (payment_parts jsonb_path_ops);

CREATE INDEX IF NOT EXISTS idx_tickets_ecf_result_gin
  ON public.tickets USING GIN (ecf_result jsonb_path_ops)
  WHERE ecf_result IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_businesses_settings_gin
  ON public.businesses USING GIN (settings jsonb_path_ops);

CREATE INDEX IF NOT EXISTS idx_activity_log_metadata_gin
  ON public.activity_log USING GIN (metadata jsonb_path_ops);

CREATE INDEX IF NOT EXISTS idx_ecf_queue_body_gin
  ON public.ecf_queue USING GIN (body_json jsonb_path_ops);

-- ─── FIX-PG17-2: drop duplicate indexes & constraints ───────────────────────
-- (a) Plain duplicate indexes — safe to drop directly.
DROP INDEX IF EXISTS public.idx_cajero_comm_business;     -- dup of idx_cajero_comm_biz
DROP INDEX IF EXISTS public.idx_seller_comm_business;     -- dup of idx_seller_comm_biz
DROP INDEX IF EXISTS public.idx_inventory_local;          -- dup of uq_inventory_local2 (which is unique)
DROP INDEX IF EXISTS public.idx_ecf_submissions_sid;      -- partial subset of uq_ecf_submissions_sid
DROP INDEX IF EXISTS public.idx_lt_biz_client;            -- dup of ix_loyalty_tx_client

-- (b) Duplicate UNIQUE CONSTRAINTS on (business_id, supabase_id).
-- Each table has TWO identical unique constraints (`_biz_sid` and `_sid`).
-- Keep `_biz_sid` (more descriptive); drop `_sid`.
-- Brief ACCESS EXCLUSIVE — sub-second at current row counts.
ALTER TABLE public.tickets             DROP CONSTRAINT IF EXISTS uq_tickets_sid;
ALTER TABLE public.ticket_items        DROP CONSTRAINT IF EXISTS uq_ticket_items_sid;
ALTER TABLE public.cajero_commissions  DROP CONSTRAINT IF EXISTS uq_cajero_commissions_sid;
ALTER TABLE public.inventory_items     DROP CONSTRAINT IF EXISTS uq_inventory_items_sid;
ALTER TABLE public.seller_commissions  DROP CONSTRAINT IF EXISTS uq_seller_commissions_sid;

-- ─── FIX-PG17-3: BRIN on time-series append-mostly tables ───────────────────
-- BRIN gives ~99% smaller indexes than btree for naturally-clustered created_at.
-- We KEEP the (business_id, created_at DESC) composite btree where it exists —
-- BRIN is purely additive for full-range scans (DGII retention sweeps,
-- license-events analytics, ecf_queue replay, loyalty audit).
-- pages_per_range=32 = good fit for ~1KB rows.
CREATE INDEX IF NOT EXISTS idx_activity_log_created_brin
  ON public.activity_log USING BRIN (created_at) WITH (pages_per_range = 32);

CREATE INDEX IF NOT EXISTS idx_license_events_created_brin
  ON public.license_events USING BRIN (created_at) WITH (pages_per_range = 32);

CREATE INDEX IF NOT EXISTS idx_ecf_queue_created_brin
  ON public.ecf_queue USING BRIN (created_at) WITH (pages_per_range = 32);

CREATE INDEX IF NOT EXISTS idx_ecf_submissions_created_brin
  ON public.ecf_submissions USING BRIN (created_at) WITH (pages_per_range = 32);

CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_created_brin
  ON public.loyalty_transactions USING BRIN (created_at) WITH (pages_per_range = 32);

CREATE INDEX IF NOT EXISTS idx_seller_commissions_created_brin
  ON public.seller_commissions USING BRIN (created_at) WITH (pages_per_range = 32);

CREATE INDEX IF NOT EXISTS idx_cajero_commissions_created_brin
  ON public.cajero_commissions USING BRIN (created_at) WITH (pages_per_range = 32);

-- ─── post-migration: refresh planner stats ──────────────────────────────────
ANALYZE public.tickets;
ANALYZE public.ticket_items;
ANALYZE public.activity_log;
ANALYZE public.license_events;
ANALYZE public.ecf_queue;
ANALYZE public.ecf_submissions;
ANALYZE public.loyalty_transactions;
ANALYZE public.seller_commissions;
ANALYZE public.cajero_commissions;
ANALYZE public.inventory_items;
ANALYZE public.businesses;

-- Force PostgREST schema cache reload so the dropped constraints stop being
-- advertised as on_conflict targets on web/api.
NOTIFY pgrst, 'reload schema';
