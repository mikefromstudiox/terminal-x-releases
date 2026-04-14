-- Owner Activity Feed — append-only audit log
-- Captures important owner-visible events: deletions, price changes, ticket voids,
-- notas de credito, payroll payouts, big discounts, inventory adjustments,
-- caja chica withdrawals, cuadre de caja discrepancies.

CREATE TABLE IF NOT EXISTS activity_log (
  id                BIGSERIAL PRIMARY KEY,
  supabase_id       UUID NOT NULL,
  business_id       UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  event_type        TEXT NOT NULL,
  severity          TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warn','critical')),
  actor_supabase_id UUID,
  actor_name        TEXT,
  actor_role        TEXT,
  target_type       TEXT,
  target_id         TEXT,
  target_name       TEXT,
  amount            NUMERIC,
  old_value         TEXT,
  new_value         TEXT,
  reason            TEXT,
  metadata          JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, supabase_id)
);

CREATE INDEX IF NOT EXISTS idx_activity_log_biz_created_at ON activity_log(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_biz_event      ON activity_log(business_id, event_type);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- SELECT policy: only owner / cfo / accountant of the business can read
DROP POLICY IF EXISTS activity_log_select ON activity_log;
CREATE POLICY activity_log_select ON activity_log
  FOR SELECT USING (
    business_id IN (
      SELECT business_id FROM users
      WHERE id = auth.uid() AND role IN ('owner','cfo','accountant')
    )
  );

-- INSERT policy: any authenticated user of the business can append a log row
DROP POLICY IF EXISTS activity_log_insert ON activity_log;
CREATE POLICY activity_log_insert ON activity_log
  FOR INSERT WITH CHECK (
    business_id IN (SELECT business_id FROM users WHERE id = auth.uid())
  );

-- Service role bypasses RLS (for desktop sync push)

COMMENT ON TABLE activity_log IS 'Owner-visible audit feed — append-only. Synced from desktop SQLite + written directly by web PWA mutations.';
