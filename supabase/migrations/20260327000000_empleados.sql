-- ============================================================================
-- Empleados table — unified payroll for all worker types (lavador/vendedor/cajero)
-- ============================================================================

CREATE TABLE IF NOT EXISTS empleados (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  tipo        TEXT NOT NULL CHECK(tipo IN ('lavador','vendedor','cajero')),
  ref_id      UUID,
  salary      NUMERIC(12,2) NOT NULL DEFAULT 0,
  start_date  DATE NOT NULL,
  cedula      TEXT,
  phone       TEXT,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE empleados ENABLE ROW LEVEL SECURITY;

CREATE POLICY "empleados_select" ON empleados FOR SELECT
  USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "empleados_insert" ON empleados FOR INSERT
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "empleados_update" ON empleados FOR UPDATE
  USING (business_id IN (SELECT my_business_ids()))
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "empleados_delete" ON empleados FOR DELETE
  USING (business_id IN (SELECT my_business_ids()));
