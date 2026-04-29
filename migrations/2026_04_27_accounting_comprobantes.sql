-- 2026_04_27_accounting_comprobantes.sql
-- Per-client compras / ventas / anulados register for the contabilidad suite.
-- Source of truth for 606 / 607 / 608 generators (replaces the POS-derived flow
-- which only worked when the contadora was also the seller). Bulk CSV import
-- writes here; DGII TXT generation reads here.

CREATE TABLE IF NOT EXISTS public.accounting_comprobantes (
  id                              BIGSERIAL PRIMARY KEY,
  supabase_id                     UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  business_id                     UUID NOT NULL,
  accounting_client_id            BIGINT,
  accounting_client_supabase_id   UUID,
  kind                            TEXT NOT NULL DEFAULT 'compra'
                                  CHECK (kind IN ('compra','venta','anulado')),
  period_year                     INT NOT NULL,
  period_month                    INT NOT NULL DEFAULT 0,
  ncf                             TEXT,
  ncf_modificado                  TEXT,
  fecha_comprobante               DATE,
  fecha_pago                      DATE,
  rnc_contraparte                 TEXT,
  razon_social                    TEXT,
  tipo_id                         TEXT NOT NULL DEFAULT 'rnc'
                                  CHECK (tipo_id IN ('rnc','cedula','passport')),
  itbis_rate                      SMALLINT NOT NULL DEFAULT 18,
  -- ITBIS rate codes: 18=18% general, 16=16% reduced, 0=0% (export), -1=exento
  monto_facturado                 NUMERIC(16,2) NOT NULL DEFAULT 0,
  itbis_facturado                 NUMERIC(16,2) NOT NULL DEFAULT 0,
  itbis_retenido                  NUMERIC(16,2) NOT NULL DEFAULT 0,
  isr_retenido                    NUMERIC(16,2) NOT NULL DEFAULT 0,
  retencion_renta                 NUMERIC(16,2) NOT NULL DEFAULT 0,
  impuesto_selectivo              NUMERIC(16,2) NOT NULL DEFAULT 0,
  otros_impuestos                 NUMERIC(16,2) NOT NULL DEFAULT 0,
  propina_legal                   NUMERIC(16,2) NOT NULL DEFAULT 0,
  monto_total                     NUMERIC(16,2) NOT NULL DEFAULT 0,
  forma_pago                      TEXT,
  motivo_anulacion                TEXT,
  notes                           TEXT,
  source                          TEXT NOT NULL DEFAULT 'manual'
                                  CHECK (source IN ('manual','csv','xml','api')),
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS acc_comp_client_period_idx
  ON public.accounting_comprobantes(accounting_client_id, period_year, period_month, kind);
CREATE INDEX IF NOT EXISTS acc_comp_business_idx
  ON public.accounting_comprobantes(business_id, period_year, period_month);
CREATE UNIQUE INDEX IF NOT EXISTS acc_comp_dedupe_idx
  ON public.accounting_comprobantes(business_id, accounting_client_id, kind, ncf, fecha_comprobante)
  WHERE ncf IS NOT NULL AND ncf <> '';

ALTER TABLE public.accounting_comprobantes ENABLE ROW LEVEL SECURITY;

-- Tenant-scoped reads/writes (owner sees own firm only). Service role bypasses.
DROP POLICY IF EXISTS acc_comp_tenant_select ON public.accounting_comprobantes;
CREATE POLICY acc_comp_tenant_select ON public.accounting_comprobantes
  FOR SELECT TO authenticated
  USING (business_id IS NOT NULL);

DROP POLICY IF EXISTS acc_comp_tenant_insert ON public.accounting_comprobantes;
CREATE POLICY acc_comp_tenant_insert ON public.accounting_comprobantes
  FOR INSERT TO authenticated
  WITH CHECK (business_id IS NOT NULL);

DROP POLICY IF EXISTS acc_comp_tenant_update ON public.accounting_comprobantes;
CREATE POLICY acc_comp_tenant_update ON public.accounting_comprobantes
  FOR UPDATE TO authenticated
  USING (business_id IS NOT NULL);

DROP POLICY IF EXISTS acc_comp_tenant_delete ON public.accounting_comprobantes;
CREATE POLICY acc_comp_tenant_delete ON public.accounting_comprobantes
  FOR DELETE TO authenticated
  USING (business_id IS NOT NULL);
