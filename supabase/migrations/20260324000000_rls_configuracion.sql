-- ============================================================================
-- Create configuracion table with RLS (used by web.js getConfiguracion/setConfiguracion)
-- ============================================================================

CREATE TABLE configuracion (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  clave       TEXT NOT NULL,
  valor       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, clave)
);

ALTER TABLE configuracion ENABLE ROW LEVEL SECURITY;

CREATE POLICY "configuracion_select" ON configuracion FOR SELECT
  USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "configuracion_insert" ON configuracion FOR INSERT
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "configuracion_update" ON configuracion FOR UPDATE
  USING (business_id IN (SELECT my_business_ids()))
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "configuracion_delete" ON configuracion FOR DELETE
  USING (business_id IN (SELECT my_business_ids()));
