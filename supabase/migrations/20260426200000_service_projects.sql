-- ════════════════════════════════════════════════════════════════════════════
-- 20260426200000_service_projects.sql
-- Servicios vertical — minimal `service_projects` table so the e2e strict
-- assertion can pass. RLS uses the per-license JWT claim pattern (see
-- 20260427000001_per_license_jwt_lockdown.sql); the legacy
-- `business_id IS NOT NULL` policies are NOT created here.
-- All idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS service_projects (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id                   UUID,
  business_id                   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_supabase_id            UUID,
  project_name                  TEXT NOT NULL,
  description                   TEXT,
  status                        TEXT DEFAULT 'active' CHECK (status IN ('quoted','active','completed','cancelled','on_hold')),
  billing_type                  TEXT DEFAULT 'project' CHECK (billing_type IN ('hourly','project','visit','subscription')),
  estimated_hours               NUMERIC(8,2),
  hourly_rate                   NUMERIC(10,2),
  fixed_price                   NUMERIC(12,2),
  total_billed                  NUMERIC(12,2) DEFAULT 0,
  total_paid                    NUMERIC(12,2) DEFAULT 0,
  started_at                    TIMESTAMPTZ,
  due_date                      TEXT,
  completed_at                  TIMESTAMPTZ,
  assigned_empleado_supabase_id UUID,
  notes                         TEXT,
  created_at                    TIMESTAMPTZ DEFAULT now(),
  updated_at                    TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_service_projects_biz_sid UNIQUE (business_id, supabase_id)
);

CREATE INDEX IF NOT EXISTS idx_service_projects_business_id
  ON service_projects (business_id);
CREATE INDEX IF NOT EXISTS idx_service_projects_client
  ON service_projects (client_supabase_id);
CREATE INDEX IF NOT EXISTS idx_service_projects_status
  ON service_projects (business_id, status);

-- ────────────────────────────────────────────────────────────────────────────
-- RLS — JWT-claim policies (matching 20260427000001 pattern)
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE service_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_projects_jwt_select ON service_projects;
DROP POLICY IF EXISTS service_projects_jwt_modify ON service_projects;

CREATE POLICY service_projects_jwt_select ON service_projects
  FOR SELECT TO anon, authenticated
  USING (business_id = ((auth.jwt() -> 'user_metadata') ->> 'business_id')::uuid);

CREATE POLICY service_projects_jwt_modify ON service_projects
  FOR ALL TO anon, authenticated
  USING (business_id = ((auth.jwt() -> 'user_metadata') ->> 'business_id')::uuid)
  WITH CHECK (business_id = ((auth.jwt() -> 'user_metadata') ->> 'business_id')::uuid);

-- ────────────────────────────────────────────────────────────────────────────
-- updated_at trigger
-- ────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_service_projects_updated_at ON service_projects;
CREATE TRIGGER trg_service_projects_updated_at
  BEFORE UPDATE ON service_projects
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
