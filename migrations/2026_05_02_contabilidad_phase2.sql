-- Terminal X — Contabilidad Phase 2 Slice 1 (full firm-side schema).
-- 14 new tables: COA + journal entries/lines, auto-post rules, bank accounts +
-- statement lines, fixed assets, retentions emitidas/recibidas, payroll
-- periods/lines, TSS filings, tasks, foreign payments. Mirrors the SQLite
-- schema added to electron/database.js in the same slice. Every table:
-- supabase_id UUID + business_id + updated_at + RLS enabled with anon revoked
-- from writes, scoped by business_id JWT claim. Idempotent — safe to re-run.
-- Helper public.tg_set_updated_at() is created by Phase 1 migration.

-- ── accounting_chart_of_accounts ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accounting_chart_of_accounts ( id BIGSERIAL PRIMARY KEY, supabase_id UUID NOT NULL UNIQUE, business_id UUID NOT NULL, accounting_client_id BIGINT, accounting_client_supabase_id UUID, code TEXT NOT NULL, parent_id BIGINT, parent_supabase_id UUID, name TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT 'activo' CHECK (type IN ('activo','pasivo','patrimonio','ingreso','costo','gasto')), is_postable SMALLINT NOT NULL DEFAULT 1, currency TEXT NOT NULL DEFAULT 'DOP', notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );
CREATE INDEX IF NOT EXISTS idx_acc_coa_biz ON public.accounting_chart_of_accounts(business_id);
CREATE INDEX IF NOT EXISTS idx_acc_coa_client ON public.accounting_chart_of_accounts(business_id, accounting_client_id);
CREATE INDEX IF NOT EXISTS idx_acc_coa_parent ON public.accounting_chart_of_accounts(business_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_acc_coa_code ON public.accounting_chart_of_accounts(business_id, accounting_client_id, code);
DROP TRIGGER IF EXISTS tg_acc_coa_updated_at ON public.accounting_chart_of_accounts; CREATE TRIGGER tg_acc_coa_updated_at BEFORE UPDATE ON public.accounting_chart_of_accounts FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
ALTER TABLE public.accounting_chart_of_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_acc_coa_select ON public.accounting_chart_of_accounts; CREATE POLICY p_acc_coa_select ON public.accounting_chart_of_accounts FOR SELECT TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
DROP POLICY IF EXISTS p_acc_coa_write ON public.accounting_chart_of_accounts; CREATE POLICY p_acc_coa_write ON public.accounting_chart_of_accounts FOR ALL TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id','')) WITH CHECK (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
REVOKE INSERT, UPDATE, DELETE ON public.accounting_chart_of_accounts FROM anon;

-- ── accounting_journal_entries ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accounting_journal_entries ( id BIGSERIAL PRIMARY KEY, supabase_id UUID NOT NULL UNIQUE, business_id UUID NOT NULL, accounting_client_id BIGINT, accounting_client_supabase_id UUID, fecha DATE, description TEXT, type TEXT NOT NULL DEFAULT 'manual' CHECK (type IN ('manual','auto_sales','auto_purchase','auto_payroll','auto_depreciation','adjustment','closing')), reference_doc_supabase_id UUID, status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','reversed')), posted_by_user_id BIGINT, period_year INT, period_month INT, totals_debit NUMERIC(16,2) NOT NULL DEFAULT 0, totals_credit NUMERIC(16,2) NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );
CREATE INDEX IF NOT EXISTS idx_acc_je_biz ON public.accounting_journal_entries(business_id);
CREATE INDEX IF NOT EXISTS idx_acc_je_client ON public.accounting_journal_entries(business_id, accounting_client_id);
CREATE INDEX IF NOT EXISTS idx_acc_je_period ON public.accounting_journal_entries(business_id, accounting_client_id, period_year DESC, period_month DESC);
CREATE INDEX IF NOT EXISTS idx_acc_je_fecha ON public.accounting_journal_entries(business_id, fecha);
DROP TRIGGER IF EXISTS tg_acc_je_updated_at ON public.accounting_journal_entries; CREATE TRIGGER tg_acc_je_updated_at BEFORE UPDATE ON public.accounting_journal_entries FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
ALTER TABLE public.accounting_journal_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_acc_je_select ON public.accounting_journal_entries; CREATE POLICY p_acc_je_select ON public.accounting_journal_entries FOR SELECT TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
DROP POLICY IF EXISTS p_acc_je_write ON public.accounting_journal_entries; CREATE POLICY p_acc_je_write ON public.accounting_journal_entries FOR ALL TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id','')) WITH CHECK (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
REVOKE INSERT, UPDATE, DELETE ON public.accounting_journal_entries FROM anon;

-- ── accounting_journal_lines ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accounting_journal_lines ( id BIGSERIAL PRIMARY KEY, supabase_id UUID NOT NULL UNIQUE, business_id UUID NOT NULL, journal_entry_id BIGINT, journal_entry_supabase_id UUID, account_id BIGINT, account_supabase_id UUID, debit NUMERIC(16,2) NOT NULL DEFAULT 0, credit NUMERIC(16,2) NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'DOP', exchange_rate NUMERIC(16,6) NOT NULL DEFAULT 1, memo TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );
CREATE INDEX IF NOT EXISTS idx_acc_jl_biz ON public.accounting_journal_lines(business_id);
CREATE INDEX IF NOT EXISTS idx_acc_jl_entry ON public.accounting_journal_lines(business_id, journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_acc_jl_account ON public.accounting_journal_lines(business_id, account_id);
CREATE INDEX IF NOT EXISTS idx_acc_jl_entry_account ON public.accounting_journal_lines(business_id, journal_entry_id, account_id);
DROP TRIGGER IF EXISTS tg_acc_jl_updated_at ON public.accounting_journal_lines; CREATE TRIGGER tg_acc_jl_updated_at BEFORE UPDATE ON public.accounting_journal_lines FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
ALTER TABLE public.accounting_journal_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_acc_jl_select ON public.accounting_journal_lines; CREATE POLICY p_acc_jl_select ON public.accounting_journal_lines FOR SELECT TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
DROP POLICY IF EXISTS p_acc_jl_write ON public.accounting_journal_lines; CREATE POLICY p_acc_jl_write ON public.accounting_journal_lines FOR ALL TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id','')) WITH CHECK (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
REVOKE INSERT, UPDATE, DELETE ON public.accounting_journal_lines FROM anon;

-- ── accounting_coa_auto_post_rules ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accounting_coa_auto_post_rules ( id BIGSERIAL PRIMARY KEY, supabase_id UUID NOT NULL UNIQUE, business_id UUID NOT NULL, accounting_client_id BIGINT, accounting_client_supabase_id UUID, event TEXT NOT NULL CHECK (event IN ('sale','purchase','payment','refund','payroll','depreciation')), condition_json TEXT, debit_account_id BIGINT, debit_account_supabase_id UUID, credit_account_id BIGINT, credit_account_supabase_id UUID, priority INT NOT NULL DEFAULT 100, active SMALLINT NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );
CREATE INDEX IF NOT EXISTS idx_acc_apr_biz ON public.accounting_coa_auto_post_rules(business_id);
CREATE INDEX IF NOT EXISTS idx_acc_apr_client ON public.accounting_coa_auto_post_rules(business_id, accounting_client_id);
CREATE INDEX IF NOT EXISTS idx_acc_apr_event ON public.accounting_coa_auto_post_rules(business_id, accounting_client_id, event, priority);
DROP TRIGGER IF EXISTS tg_acc_apr_updated_at ON public.accounting_coa_auto_post_rules; CREATE TRIGGER tg_acc_apr_updated_at BEFORE UPDATE ON public.accounting_coa_auto_post_rules FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
ALTER TABLE public.accounting_coa_auto_post_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_acc_apr_select ON public.accounting_coa_auto_post_rules; CREATE POLICY p_acc_apr_select ON public.accounting_coa_auto_post_rules FOR SELECT TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
DROP POLICY IF EXISTS p_acc_apr_write ON public.accounting_coa_auto_post_rules; CREATE POLICY p_acc_apr_write ON public.accounting_coa_auto_post_rules FOR ALL TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id','')) WITH CHECK (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
REVOKE INSERT, UPDATE, DELETE ON public.accounting_coa_auto_post_rules FROM anon;

-- ── accounting_bank_accounts ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accounting_bank_accounts ( id BIGSERIAL PRIMARY KEY, supabase_id UUID NOT NULL UNIQUE, business_id UUID NOT NULL, accounting_client_id BIGINT, accounting_client_supabase_id UUID, banco TEXT NOT NULL DEFAULT 'otro' CHECK (banco IN ('bhd_leon','banreservas','banco_popular','scotiabank','otro')), account_no_last4 TEXT, account_type TEXT NOT NULL DEFAULT 'checking' CHECK (account_type IN ('checking','savings')), currency TEXT NOT NULL DEFAULT 'DOP', opening_balance NUMERIC(16,2) NOT NULL DEFAULT 0, active SMALLINT NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );
CREATE INDEX IF NOT EXISTS idx_acc_ba_biz ON public.accounting_bank_accounts(business_id);
CREATE INDEX IF NOT EXISTS idx_acc_ba_client ON public.accounting_bank_accounts(business_id, accounting_client_id);
DROP TRIGGER IF EXISTS tg_acc_ba_updated_at ON public.accounting_bank_accounts; CREATE TRIGGER tg_acc_ba_updated_at BEFORE UPDATE ON public.accounting_bank_accounts FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
ALTER TABLE public.accounting_bank_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_acc_ba_select ON public.accounting_bank_accounts; CREATE POLICY p_acc_ba_select ON public.accounting_bank_accounts FOR SELECT TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
DROP POLICY IF EXISTS p_acc_ba_write ON public.accounting_bank_accounts; CREATE POLICY p_acc_ba_write ON public.accounting_bank_accounts FOR ALL TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id','')) WITH CHECK (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
REVOKE INSERT, UPDATE, DELETE ON public.accounting_bank_accounts FROM anon;

-- ── accounting_bank_statement_lines ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accounting_bank_statement_lines ( id BIGSERIAL PRIMARY KEY, supabase_id UUID NOT NULL UNIQUE, business_id UUID NOT NULL, bank_account_id BIGINT, bank_account_supabase_id UUID, fecha DATE, descripcion TEXT, referencia TEXT, debit NUMERIC(16,2) NOT NULL DEFAULT 0, credit NUMERIC(16,2) NOT NULL DEFAULT 0, balance NUMERIC(16,2), matched_journal_line_id BIGINT, matched_journal_line_supabase_id UUID, match_status TEXT NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('unmatched','matched','ignored','adjustment')), raw_row TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );
CREATE INDEX IF NOT EXISTS idx_acc_bsl_biz ON public.accounting_bank_statement_lines(business_id);
CREATE INDEX IF NOT EXISTS idx_acc_bsl_account ON public.accounting_bank_statement_lines(business_id, bank_account_id);
CREATE INDEX IF NOT EXISTS idx_acc_bsl_status ON public.accounting_bank_statement_lines(business_id, bank_account_id, match_status);
DROP TRIGGER IF EXISTS tg_acc_bsl_updated_at ON public.accounting_bank_statement_lines; CREATE TRIGGER tg_acc_bsl_updated_at BEFORE UPDATE ON public.accounting_bank_statement_lines FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
ALTER TABLE public.accounting_bank_statement_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_acc_bsl_select ON public.accounting_bank_statement_lines; CREATE POLICY p_acc_bsl_select ON public.accounting_bank_statement_lines FOR SELECT TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
DROP POLICY IF EXISTS p_acc_bsl_write ON public.accounting_bank_statement_lines; CREATE POLICY p_acc_bsl_write ON public.accounting_bank_statement_lines FOR ALL TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id','')) WITH CHECK (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
REVOKE INSERT, UPDATE, DELETE ON public.accounting_bank_statement_lines FROM anon;

-- ── accounting_fixed_assets ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accounting_fixed_assets ( id BIGSERIAL PRIMARY KEY, supabase_id UUID NOT NULL UNIQUE, business_id UUID NOT NULL, accounting_client_id BIGINT, accounting_client_supabase_id UUID, name TEXT NOT NULL DEFAULT '', categoria TEXT NOT NULL DEFAULT 'cat_2' CHECK (categoria IN ('cat_1','cat_2','cat_3')), fecha_adquisicion DATE, costo NUMERIC(16,2) NOT NULL DEFAULT 0, vida_util_meses INT NOT NULL DEFAULT 0, valor_residual NUMERIC(16,2) NOT NULL DEFAULT 0, depreciacion_acumulada NUMERIC(16,2) NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','sold','written_off')), sold_at DATE, sold_amount NUMERIC(16,2), notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );
CREATE INDEX IF NOT EXISTS idx_acc_fa_biz ON public.accounting_fixed_assets(business_id);
CREATE INDEX IF NOT EXISTS idx_acc_fa_client ON public.accounting_fixed_assets(business_id, accounting_client_id);
DROP TRIGGER IF EXISTS tg_acc_fa_updated_at ON public.accounting_fixed_assets; CREATE TRIGGER tg_acc_fa_updated_at BEFORE UPDATE ON public.accounting_fixed_assets FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
ALTER TABLE public.accounting_fixed_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_acc_fa_select ON public.accounting_fixed_assets; CREATE POLICY p_acc_fa_select ON public.accounting_fixed_assets FOR SELECT TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
DROP POLICY IF EXISTS p_acc_fa_write ON public.accounting_fixed_assets; CREATE POLICY p_acc_fa_write ON public.accounting_fixed_assets FOR ALL TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id','')) WITH CHECK (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
REVOKE INSERT, UPDATE, DELETE ON public.accounting_fixed_assets FROM anon;

-- ── accounting_retentions_emitidas ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accounting_retentions_emitidas ( id BIGSERIAL PRIMARY KEY, supabase_id UUID NOT NULL UNIQUE, business_id UUID NOT NULL, accounting_client_id BIGINT, accounting_client_supabase_id UUID, fecha DATE, beneficiario_rnc TEXT, beneficiario_nombre TEXT, tipo TEXT NOT NULL DEFAULT 'servicios_no_dom' CHECK (tipo IN ('alquiler','honorarios','dividendos','servicios_no_dom')), base NUMERIC(16,2) NOT NULL DEFAULT 0, tasa NUMERIC(8,4) NOT NULL DEFAULT 0, retencion NUMERIC(16,2) NOT NULL DEFAULT 0, ncf_emitido TEXT, comprobante_url TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );
CREATE INDEX IF NOT EXISTS idx_acc_re_biz ON public.accounting_retentions_emitidas(business_id);
CREATE INDEX IF NOT EXISTS idx_acc_re_client ON public.accounting_retentions_emitidas(business_id, accounting_client_id);
DROP TRIGGER IF EXISTS tg_acc_re_updated_at ON public.accounting_retentions_emitidas; CREATE TRIGGER tg_acc_re_updated_at BEFORE UPDATE ON public.accounting_retentions_emitidas FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
ALTER TABLE public.accounting_retentions_emitidas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_acc_re_select ON public.accounting_retentions_emitidas; CREATE POLICY p_acc_re_select ON public.accounting_retentions_emitidas FOR SELECT TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
DROP POLICY IF EXISTS p_acc_re_write ON public.accounting_retentions_emitidas; CREATE POLICY p_acc_re_write ON public.accounting_retentions_emitidas FOR ALL TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id','')) WITH CHECK (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
REVOKE INSERT, UPDATE, DELETE ON public.accounting_retentions_emitidas FROM anon;

-- ── accounting_retentions_recibidas ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accounting_retentions_recibidas ( id BIGSERIAL PRIMARY KEY, supabase_id UUID NOT NULL UNIQUE, business_id UUID NOT NULL, accounting_client_id BIGINT, accounting_client_supabase_id UUID, fecha DATE, retenedor_rnc TEXT, retenedor_nombre TEXT, tipo TEXT, base NUMERIC(16,2) NOT NULL DEFAULT 0, tasa NUMERIC(8,4) NOT NULL DEFAULT 0, retencion NUMERIC(16,2) NOT NULL DEFAULT 0, comprobante_url TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );
CREATE INDEX IF NOT EXISTS idx_acc_rr_biz ON public.accounting_retentions_recibidas(business_id);
CREATE INDEX IF NOT EXISTS idx_acc_rr_client ON public.accounting_retentions_recibidas(business_id, accounting_client_id);
DROP TRIGGER IF EXISTS tg_acc_rr_updated_at ON public.accounting_retentions_recibidas; CREATE TRIGGER tg_acc_rr_updated_at BEFORE UPDATE ON public.accounting_retentions_recibidas FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
ALTER TABLE public.accounting_retentions_recibidas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_acc_rr_select ON public.accounting_retentions_recibidas; CREATE POLICY p_acc_rr_select ON public.accounting_retentions_recibidas FOR SELECT TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
DROP POLICY IF EXISTS p_acc_rr_write ON public.accounting_retentions_recibidas; CREATE POLICY p_acc_rr_write ON public.accounting_retentions_recibidas FOR ALL TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id','')) WITH CHECK (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
REVOKE INSERT, UPDATE, DELETE ON public.accounting_retentions_recibidas FROM anon;

-- ── accounting_payroll_periods ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accounting_payroll_periods ( id BIGSERIAL PRIMARY KEY, supabase_id UUID NOT NULL UNIQUE, business_id UUID NOT NULL, accounting_client_id BIGINT, accounting_client_supabase_id UUID, year INT NOT NULL, month INT NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','paid')), totals_json TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );
CREATE INDEX IF NOT EXISTS idx_acc_pp_biz ON public.accounting_payroll_periods(business_id);
CREATE INDEX IF NOT EXISTS idx_acc_pp_client ON public.accounting_payroll_periods(business_id, accounting_client_id);
CREATE INDEX IF NOT EXISTS idx_acc_pp_period ON public.accounting_payroll_periods(business_id, accounting_client_id, year DESC, month DESC);
DROP TRIGGER IF EXISTS tg_acc_pp_updated_at ON public.accounting_payroll_periods; CREATE TRIGGER tg_acc_pp_updated_at BEFORE UPDATE ON public.accounting_payroll_periods FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
ALTER TABLE public.accounting_payroll_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_acc_pp_select ON public.accounting_payroll_periods; CREATE POLICY p_acc_pp_select ON public.accounting_payroll_periods FOR SELECT TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
DROP POLICY IF EXISTS p_acc_pp_write ON public.accounting_payroll_periods; CREATE POLICY p_acc_pp_write ON public.accounting_payroll_periods FOR ALL TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id','')) WITH CHECK (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
REVOKE INSERT, UPDATE, DELETE ON public.accounting_payroll_periods FROM anon;

-- ── accounting_payroll_lines ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accounting_payroll_lines ( id BIGSERIAL PRIMARY KEY, supabase_id UUID NOT NULL UNIQUE, business_id UUID NOT NULL, payroll_period_id BIGINT, payroll_period_supabase_id UUID, employee_name TEXT, employee_cedula TEXT, employee_nss TEXT, salario_base NUMERIC(16,2) NOT NULL DEFAULT 0, dependientes INT NOT NULL DEFAULT 0, afp NUMERIC(16,2) NOT NULL DEFAULT 0, ars NUMERIC(16,2) NOT NULL DEFAULT 0, sfs NUMERIC(16,2) NOT NULL DEFAULT 0, riesgos_laborales NUMERIC(16,2) NOT NULL DEFAULT 0, isr NUMERIC(16,2) NOT NULL DEFAULT 0, otras_deducciones NUMERIC(16,2) NOT NULL DEFAULT 0, neto NUMERIC(16,2) NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );
CREATE INDEX IF NOT EXISTS idx_acc_pl_biz ON public.accounting_payroll_lines(business_id);
CREATE INDEX IF NOT EXISTS idx_acc_pl_period ON public.accounting_payroll_lines(business_id, payroll_period_id);
DROP TRIGGER IF EXISTS tg_acc_pl_updated_at ON public.accounting_payroll_lines; CREATE TRIGGER tg_acc_pl_updated_at BEFORE UPDATE ON public.accounting_payroll_lines FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
ALTER TABLE public.accounting_payroll_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_acc_pl_select ON public.accounting_payroll_lines; CREATE POLICY p_acc_pl_select ON public.accounting_payroll_lines FOR SELECT TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
DROP POLICY IF EXISTS p_acc_pl_write ON public.accounting_payroll_lines; CREATE POLICY p_acc_pl_write ON public.accounting_payroll_lines FOR ALL TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id','')) WITH CHECK (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
REVOKE INSERT, UPDATE, DELETE ON public.accounting_payroll_lines FROM anon;

-- ── accounting_tss_filings ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accounting_tss_filings ( id BIGSERIAL PRIMARY KEY, supabase_id UUID NOT NULL UNIQUE, business_id UUID NOT NULL, accounting_client_id BIGINT, accounting_client_supabase_id UUID, year INT NOT NULL, month INT NOT NULL, filename TEXT, file_supabase_id UUID, status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','radicado')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );
CREATE INDEX IF NOT EXISTS idx_acc_tss_biz ON public.accounting_tss_filings(business_id);
CREATE INDEX IF NOT EXISTS idx_acc_tss_client ON public.accounting_tss_filings(business_id, accounting_client_id);
CREATE INDEX IF NOT EXISTS idx_acc_tss_period ON public.accounting_tss_filings(business_id, accounting_client_id, year DESC, month DESC);
DROP TRIGGER IF EXISTS tg_acc_tss_updated_at ON public.accounting_tss_filings; CREATE TRIGGER tg_acc_tss_updated_at BEFORE UPDATE ON public.accounting_tss_filings FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
ALTER TABLE public.accounting_tss_filings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_acc_tss_select ON public.accounting_tss_filings; CREATE POLICY p_acc_tss_select ON public.accounting_tss_filings FOR SELECT TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
DROP POLICY IF EXISTS p_acc_tss_write ON public.accounting_tss_filings; CREATE POLICY p_acc_tss_write ON public.accounting_tss_filings FOR ALL TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id','')) WITH CHECK (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
REVOKE INSERT, UPDATE, DELETE ON public.accounting_tss_filings FROM anon;

-- ── accounting_tasks ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accounting_tasks ( id BIGSERIAL PRIMARY KEY, supabase_id UUID NOT NULL UNIQUE, business_id UUID NOT NULL, accounting_client_id BIGINT, accounting_client_supabase_id UUID, title TEXT NOT NULL DEFAULT '', description TEXT, assigned_to_user_id BIGINT, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','review','done')), priority TEXT NOT NULL DEFAULT 'med' CHECK (priority IN ('low','med','high')), due_date DATE, parent_obligation_supabase_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );
CREATE INDEX IF NOT EXISTS idx_acc_tk_biz ON public.accounting_tasks(business_id);
CREATE INDEX IF NOT EXISTS idx_acc_tk_client ON public.accounting_tasks(business_id, accounting_client_id);
CREATE INDEX IF NOT EXISTS idx_acc_tk_status ON public.accounting_tasks(business_id, accounting_client_id, status, due_date);
DROP TRIGGER IF EXISTS tg_acc_tk_updated_at ON public.accounting_tasks; CREATE TRIGGER tg_acc_tk_updated_at BEFORE UPDATE ON public.accounting_tasks FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
ALTER TABLE public.accounting_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_acc_tk_select ON public.accounting_tasks; CREATE POLICY p_acc_tk_select ON public.accounting_tasks FOR SELECT TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
DROP POLICY IF EXISTS p_acc_tk_write ON public.accounting_tasks; CREATE POLICY p_acc_tk_write ON public.accounting_tasks FOR ALL TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id','')) WITH CHECK (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
REVOKE INSERT, UPDATE, DELETE ON public.accounting_tasks FROM anon;

-- ── accounting_foreign_payments (609) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accounting_foreign_payments ( id BIGSERIAL PRIMARY KEY, supabase_id UUID NOT NULL UNIQUE, business_id UUID NOT NULL, accounting_client_id BIGINT, accounting_client_supabase_id UUID, fecha DATE, beneficiario_id TEXT, beneficiario_pais TEXT, beneficiario_nombre TEXT, tipo_renta TEXT, moneda TEXT NOT NULL DEFAULT 'USD', monto_moneda_pago NUMERIC(16,2) NOT NULL DEFAULT 0, tasa_cambio NUMERIC(16,6) NOT NULL DEFAULT 1, monto_local NUMERIC(16,2) NOT NULL DEFAULT 0, isr_retenido NUMERIC(16,2) NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );
CREATE INDEX IF NOT EXISTS idx_acc_fp_biz ON public.accounting_foreign_payments(business_id);
CREATE INDEX IF NOT EXISTS idx_acc_fp_client ON public.accounting_foreign_payments(business_id, accounting_client_id);
DROP TRIGGER IF EXISTS tg_acc_fp_updated_at ON public.accounting_foreign_payments; CREATE TRIGGER tg_acc_fp_updated_at BEFORE UPDATE ON public.accounting_foreign_payments FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
ALTER TABLE public.accounting_foreign_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_acc_fp_select ON public.accounting_foreign_payments; CREATE POLICY p_acc_fp_select ON public.accounting_foreign_payments FOR SELECT TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
DROP POLICY IF EXISTS p_acc_fp_write ON public.accounting_foreign_payments; CREATE POLICY p_acc_fp_write ON public.accounting_foreign_payments FOR ALL TO authenticated USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id','')) WITH CHECK (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));
REVOKE INSERT, UPDATE, DELETE ON public.accounting_foreign_payments FROM anon;
