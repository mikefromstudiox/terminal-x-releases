-- 2026-05-08 — Ranoza dual-terminal go-live safety net
--
-- Two structural guarantees that defend against client-side regressions if
-- any future caller ever bypasses atomic_next_ncf or opens cuadre twice:
--
-- 1. uq_tickets_biz_ncf — a (business_id, ncf) pair must be unique. NCF is
--    the legal/fiscal identifier; the DB rejects any duplicate even if the
--    JS allocator regresses. Partial index so SIN-NCF rows (ncf IS NULL) are
--    not constrained.
--
-- 2. uq_cuadre_caja_one_open_per_day — at most one OPEN cash-shift per
--    business per date. testSHIELD's dual-terminal harness reproduced two
--    open rows live; this index makes that impossible at the DB level.
--
-- Verified 2026-05-08 against live pg_catalog: zero existing duplicates on
-- either constraint, so creation will succeed without dedup.

CREATE UNIQUE INDEX IF NOT EXISTS uq_tickets_biz_ncf
  ON public.tickets (business_id, ncf)
  WHERE ncf IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cuadre_caja_one_open_per_day
  ON public.cuadre_caja (business_id, date)
  WHERE status = 'abierto';
