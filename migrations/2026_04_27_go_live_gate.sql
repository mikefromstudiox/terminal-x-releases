-- v2.16.10 — Go-Live Gate
-- Master TEST → LIVE switch driven by app_settings.go_live_date.
-- While the date is empty or in the future, tickets are flagged is_test=true,
-- never sync from desktop (rowFilter), commissions/credit are skipped, and
-- DGII submission is blocked. On goLiveCommit() in the desktop app, all
-- is_test=true rows are wiped locally and go_live_committed_at is stamped.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;

-- Fast count of test rows for the Sistema confirm modal.
CREATE INDEX IF NOT EXISTS idx_tickets_is_test_per_biz
  ON tickets (business_id)
  WHERE is_test = TRUE;

-- Web POS inserts mirror the gate via packages/data/web.js. No extra columns
-- needed on commissions tables — they're simply not inserted in TEST mode.
