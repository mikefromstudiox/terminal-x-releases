-- ════════════════════════════════════════════════════════════════════════════
-- 20260429000900_tickets_active_paid_created_idx.sql
--
-- Covering partial index for the Daily Report / RemoteDashboard query in
-- packages/data/web.js: tickets where business_id=$1 AND status <> 'nula'
-- AND created_at > now() - 30 days, ordered by paid_at DESC NULLS LAST,
-- created_at DESC.
--
-- Without this index the planner uses idx_tickets_created (business_id,
-- created_at DESC) and then has to do a heap fetch + filter + sort on every
-- matching row. At 400K mega-tenant rows the daily report ran in ~12 s
-- (not viable). This index satisfies the WHERE + ORDER BY directly.
--
-- WHERE status <> 'nula' makes it a partial index — voided tickets are
-- never on the daily-report path, so excluding them keeps the index tight.
--
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_tickets_active_paid_created
  ON public.tickets (business_id, paid_at DESC NULLS LAST, created_at DESC)
  WHERE status <> 'nula';
