-- Terminal X — Contabilidad Phase 1 (firm-side suite scaffold).
-- Mirrors the SQLite tables introduced in electron/database.js for the same
-- migration. Every table: supabase_id UUID + business_id + updated_at + RLS
-- enabled with anon revoked from writes, scoped by business_id.
-- Idempotent: safe to re-run via Supabase Management API.

-- ── helper: updated_at trigger fn (idempotent) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

-- ── accounting_clients (firm-side cartera) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accounting_clients ( id BIGSERIAL PRIMARY KEY, supabase_id UUID NOT NULL UNIQUE, business_id UUID NOT NULL, client_business_supabase_id UUID, nombre_comercial TEXT NOT NULL DEFAULT '', rnc TEXT, cedula TEXT, tipo_persona TEXT NOT NULL DEFAULT 'pj' CHECK (tipo_persona IN ('pf','pj','eirl')), regimen TEXT NOT NULL DEFAULT 'ordinario', fecha_cierre_mes INT, fecha_cierre_dia INT, honorarios_mensuales NUMERIC(14,2) NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'DOP', assigned_to_user_id BIGINT, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')), notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );
CREATE INDEX IF NOT EXISTS idx_acc_clients_biz ON public.accounting_clients(business_id);
CREATE INDEX IF NOT EXISTS idx_acc_clients_status ON public.accounting_clients(business_id, status);
DROP TRIGGER IF EXISTS tg_acc_clients_updated_at ON public.accounting_clients; CREATE TRIGGER tg_acc_clients_updated_at BEFORE UPDATE ON public.accounting_clients FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
ALTER TABLE public.accounting_clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_acc_clients_select ON public.accounting_clients; CREATE POLICY p_acc_clients_select ON public.accounting_clients FOR SELECT TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
DROP POLICY IF EXISTS p_acc_clients_write ON public.accounting_clients; CREATE POLICY p_acc_clients_write ON public.accounting_clients FOR ALL TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id','')) WITH CHECK (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
REVOKE INSERT, UPDATE, DELETE ON public.accounting_clients FROM anon;

-- ── accounting_inbox ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accounting_inbox ( id BIGSERIAL PRIMARY KEY, supabase_id UUID NOT NULL UNIQUE, business_id UUID NOT NULL, accounting_client_id BIGINT, source TEXT NOT NULL DEFAULT 'dropzone' CHECK (source IN ('dropzone','email','whatsapp','api')), original_filename TEXT NOT NULL DEFAULT 'sin-nombre', mime TEXT NOT NULL DEFAULT 'application/octet-stream', size BIGINT NOT NULL DEFAULT 0, r2_key TEXT, ocr_status TEXT NOT NULL DEFAULT 'pending' CHECK (ocr_status IN ('pending','done','failed')), ocr_text TEXT, classified_type TEXT NOT NULL DEFAULT 'otro' CHECK (classified_type IN ('ecf_xml','factura_pdf','retencion','banco_estado','tss','csv','contrato','otro')), classification_confidence NUMERIC(5,4) NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'unclassified' CHECK (status IN ('unclassified','classified','posted','archived')), posted_journal_entry_id BIGINT, posted_at TIMESTAMPTZ, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );
CREATE INDEX IF NOT EXISTS idx_acc_inbox_biz_status ON public.accounting_inbox(business_id, status);
CREATE INDEX IF NOT EXISTS idx_acc_inbox_client ON public.accounting_inbox(business_id, accounting_client_id);
DROP TRIGGER IF EXISTS tg_acc_inbox_updated_at ON public.accounting_inbox; CREATE TRIGGER tg_acc_inbox_updated_at BEFORE UPDATE ON public.accounting_inbox FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
ALTER TABLE public.accounting_inbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_acc_inbox_select ON public.accounting_inbox; CREATE POLICY p_acc_inbox_select ON public.accounting_inbox FOR SELECT TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
DROP POLICY IF EXISTS p_acc_inbox_write ON public.accounting_inbox; CREATE POLICY p_acc_inbox_write ON public.accounting_inbox FOR ALL TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id','')) WITH CHECK (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
REVOKE INSERT, UPDATE, DELETE ON public.accounting_inbox FROM anon;

-- ── accounting_obligations_calendar ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accounting_obligations_calendar ( id BIGSERIAL PRIMARY KEY, supabase_id UUID NOT NULL UNIQUE, business_id UUID NOT NULL, accounting_client_id BIGINT NOT NULL, form_type TEXT NOT NULL, period_year INT NOT NULL, period_month INT NOT NULL DEFAULT 0, due_date DATE NOT NULL, status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','en_revision','firmado','radicado','pagado','vencido')), filed_at TIMESTAMPTZ, filed_by_user_id BIGINT, dgii_constancia_no TEXT, attachment_supabase_id UUID, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CONSTRAINT u_acc_obligations UNIQUE(business_id, accounting_client_id, form_type, period_year, period_month) );
CREATE INDEX IF NOT EXISTS idx_acc_obl_biz_due ON public.accounting_obligations_calendar(business_id, due_date);
CREATE INDEX IF NOT EXISTS idx_acc_obl_client ON public.accounting_obligations_calendar(business_id, accounting_client_id);
DROP TRIGGER IF EXISTS tg_acc_obl_updated_at ON public.accounting_obligations_calendar; CREATE TRIGGER tg_acc_obl_updated_at BEFORE UPDATE ON public.accounting_obligations_calendar FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
ALTER TABLE public.accounting_obligations_calendar ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_acc_obl_select ON public.accounting_obligations_calendar; CREATE POLICY p_acc_obl_select ON public.accounting_obligations_calendar FOR SELECT TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
DROP POLICY IF EXISTS p_acc_obl_write ON public.accounting_obligations_calendar; CREATE POLICY p_acc_obl_write ON public.accounting_obligations_calendar FOR ALL TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id','')) WITH CHECK (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
REVOKE INSERT, UPDATE, DELETE ON public.accounting_obligations_calendar FROM anon;

-- ── accounting_documents (vault) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accounting_documents ( id BIGSERIAL PRIMARY KEY, supabase_id UUID NOT NULL UNIQUE, business_id UUID NOT NULL, accounting_client_id BIGINT, category TEXT NOT NULL DEFAULT 'otro', period_year INT, period_month INT, filename TEXT NOT NULL DEFAULT 'sin-nombre', r2_key TEXT, mime TEXT NOT NULL DEFAULT 'application/octet-stream', size BIGINT NOT NULL DEFAULT 0, uploaded_by_user_id BIGINT, expires_at DATE, tags TEXT, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );
CREATE INDEX IF NOT EXISTS idx_acc_docs_biz ON public.accounting_documents(business_id);
CREATE INDEX IF NOT EXISTS idx_acc_docs_client ON public.accounting_documents(business_id, accounting_client_id);
DROP TRIGGER IF EXISTS tg_acc_docs_updated_at ON public.accounting_documents; CREATE TRIGGER tg_acc_docs_updated_at BEFORE UPDATE ON public.accounting_documents FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
ALTER TABLE public.accounting_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_acc_docs_select ON public.accounting_documents; CREATE POLICY p_acc_docs_select ON public.accounting_documents FOR SELECT TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
DROP POLICY IF EXISTS p_acc_docs_write ON public.accounting_documents; CREATE POLICY p_acc_docs_write ON public.accounting_documents FOR ALL TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id','')) WITH CHECK (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
REVOKE INSERT, UPDATE, DELETE ON public.accounting_documents FROM anon;

-- ── accounting_billing_plans ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accounting_billing_plans ( id BIGSERIAL PRIMARY KEY, supabase_id UUID NOT NULL UNIQUE, business_id UUID NOT NULL, accounting_client_id BIGINT, monthly_amount NUMERIC(14,2) NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'DOP', bill_day INT NOT NULL DEFAULT 1, ecf_type TEXT NOT NULL DEFAULT 'e32' CHECK (ecf_type IN ('e31','e32')), late_fee_pct NUMERIC(5,2) NOT NULL DEFAULT 0, late_fee_after_days INT NOT NULL DEFAULT 0, active SMALLINT NOT NULL DEFAULT 1, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );
CREATE INDEX IF NOT EXISTS idx_acc_bp_biz ON public.accounting_billing_plans(business_id);
CREATE INDEX IF NOT EXISTS idx_acc_bp_client ON public.accounting_billing_plans(business_id, accounting_client_id);
DROP TRIGGER IF EXISTS tg_acc_bp_updated_at ON public.accounting_billing_plans; CREATE TRIGGER tg_acc_bp_updated_at BEFORE UPDATE ON public.accounting_billing_plans FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
ALTER TABLE public.accounting_billing_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_acc_bp_select ON public.accounting_billing_plans; CREATE POLICY p_acc_bp_select ON public.accounting_billing_plans FOR SELECT TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
DROP POLICY IF EXISTS p_acc_bp_write ON public.accounting_billing_plans; CREATE POLICY p_acc_bp_write ON public.accounting_billing_plans FOR ALL TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id','')) WITH CHECK (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
REVOKE INSERT, UPDATE, DELETE ON public.accounting_billing_plans FROM anon;

-- ── accounting_billing_invoices ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accounting_billing_invoices ( id BIGSERIAL PRIMARY KEY, supabase_id UUID NOT NULL UNIQUE, business_id UUID NOT NULL, accounting_client_id BIGINT, ticket_supabase_id UUID, period_year INT NOT NULL, period_month INT NOT NULL, amount NUMERIC(14,2) NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'DOP', status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','paid','void')), ecf_track_id TEXT, ecf_status TEXT, paid_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );
CREATE INDEX IF NOT EXISTS idx_acc_inv_biz_period ON public.accounting_billing_invoices(business_id, period_year DESC, period_month DESC);
CREATE INDEX IF NOT EXISTS idx_acc_inv_client ON public.accounting_billing_invoices(business_id, accounting_client_id);
CREATE INDEX IF NOT EXISTS idx_acc_inv_status ON public.accounting_billing_invoices(business_id, status);
DROP TRIGGER IF EXISTS tg_acc_inv_updated_at ON public.accounting_billing_invoices; CREATE TRIGGER tg_acc_inv_updated_at BEFORE UPDATE ON public.accounting_billing_invoices FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
ALTER TABLE public.accounting_billing_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_acc_inv_select ON public.accounting_billing_invoices; CREATE POLICY p_acc_inv_select ON public.accounting_billing_invoices FOR SELECT TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
DROP POLICY IF EXISTS p_acc_inv_write ON public.accounting_billing_invoices; CREATE POLICY p_acc_inv_write ON public.accounting_billing_invoices FOR ALL TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id','')) WITH CHECK (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
REVOKE INSERT, UPDATE, DELETE ON public.accounting_billing_invoices FROM anon;

-- ── accounting_csv_mappings ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accounting_csv_mappings ( id BIGSERIAL PRIMARY KEY, supabase_id UUID NOT NULL UNIQUE, business_id UUID NOT NULL, accounting_client_id BIGINT, doc_type TEXT NOT NULL, name TEXT NOT NULL, mapping_json TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );
CREATE INDEX IF NOT EXISTS idx_acc_csv_biz ON public.accounting_csv_mappings(business_id);
DROP TRIGGER IF EXISTS tg_acc_csv_updated_at ON public.accounting_csv_mappings; CREATE TRIGGER tg_acc_csv_updated_at BEFORE UPDATE ON public.accounting_csv_mappings FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
ALTER TABLE public.accounting_csv_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_acc_csv_select ON public.accounting_csv_mappings; CREATE POLICY p_acc_csv_select ON public.accounting_csv_mappings FOR SELECT TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
DROP POLICY IF EXISTS p_acc_csv_write ON public.accounting_csv_mappings; CREATE POLICY p_acc_csv_write ON public.accounting_csv_mappings FOR ALL TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id','')) WITH CHECK (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
REVOKE INSERT, UPDATE, DELETE ON public.accounting_csv_mappings FROM anon;
