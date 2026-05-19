-- 2026_05_19 — journal_entries created_at index
--
-- Finding #12 from inaugural schema-suite run. journal_entries had
-- indexes on (business_id, effective_date) and (business_id, account,
-- effective_date) — fine for the spine reports (EstadoResultadosReport
-- filters by effective_date) — but NO index on (business_id, created_at).
--
-- The created_at index matters for sync cursor reads: electron/sync.js
-- pulls journal_entries where created_at > last_synced_at. Without an
-- index, that's a full-table scan on every pull cycle. As the ledger
-- grows (Phase 3.5 scaling test showed 1k-3k concurrent clients on
-- Pro/Micro tier), this scan cost will linearize.

BEGIN;

CREATE INDEX IF NOT EXISTS ix_je_biz_created
  ON public.journal_entries USING btree (business_id, created_at);

COMMIT;
