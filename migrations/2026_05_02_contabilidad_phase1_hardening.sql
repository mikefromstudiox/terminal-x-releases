-- Terminal X — Contabilidad Phase 1 hardening (Phase 2 Slice 1).
-- Adds accounting_client_supabase_id companion FK to every Phase 1 child table
-- so cross-device firms can resolve clients via UUID after a desktop rebuild
-- and so web/desktop dual-key joins land. Idempotent ALTER TABLE … ADD COLUMN
-- IF NOT EXISTS — safe to re-run via Supabase Management API.

ALTER TABLE public.accounting_inbox                  ADD COLUMN IF NOT EXISTS accounting_client_supabase_id UUID;
ALTER TABLE public.accounting_obligations_calendar   ADD COLUMN IF NOT EXISTS accounting_client_supabase_id UUID;
ALTER TABLE public.accounting_documents              ADD COLUMN IF NOT EXISTS accounting_client_supabase_id UUID;
ALTER TABLE public.accounting_billing_plans          ADD COLUMN IF NOT EXISTS accounting_client_supabase_id UUID;
ALTER TABLE public.accounting_billing_invoices       ADD COLUMN IF NOT EXISTS accounting_client_supabase_id UUID;
ALTER TABLE public.accounting_csv_mappings           ADD COLUMN IF NOT EXISTS accounting_client_supabase_id UUID;

CREATE INDEX IF NOT EXISTS idx_acc_inbox_client_sid ON public.accounting_inbox(business_id, accounting_client_supabase_id);
CREATE INDEX IF NOT EXISTS idx_acc_obl_client_sid   ON public.accounting_obligations_calendar(business_id, accounting_client_supabase_id);
CREATE INDEX IF NOT EXISTS idx_acc_docs_client_sid  ON public.accounting_documents(business_id, accounting_client_supabase_id);
CREATE INDEX IF NOT EXISTS idx_acc_bp_client_sid    ON public.accounting_billing_plans(business_id, accounting_client_supabase_id);
CREATE INDEX IF NOT EXISTS idx_acc_inv_client_sid   ON public.accounting_billing_invoices(business_id, accounting_client_supabase_id);
CREATE INDEX IF NOT EXISTS idx_acc_csv_client_sid   ON public.accounting_csv_mappings(business_id, accounting_client_supabase_id);

-- Backfill the new column for rows already present (joining on the BIGINT FK).
UPDATE public.accounting_inbox                ch SET accounting_client_supabase_id = p.supabase_id FROM public.accounting_clients p WHERE ch.accounting_client_id = p.id AND ch.accounting_client_supabase_id IS NULL;
UPDATE public.accounting_obligations_calendar ch SET accounting_client_supabase_id = p.supabase_id FROM public.accounting_clients p WHERE ch.accounting_client_id = p.id AND ch.accounting_client_supabase_id IS NULL;
UPDATE public.accounting_documents            ch SET accounting_client_supabase_id = p.supabase_id FROM public.accounting_clients p WHERE ch.accounting_client_id = p.id AND ch.accounting_client_supabase_id IS NULL;
UPDATE public.accounting_billing_plans        ch SET accounting_client_supabase_id = p.supabase_id FROM public.accounting_clients p WHERE ch.accounting_client_id = p.id AND ch.accounting_client_supabase_id IS NULL;
UPDATE public.accounting_billing_invoices     ch SET accounting_client_supabase_id = p.supabase_id FROM public.accounting_clients p WHERE ch.accounting_client_id = p.id AND ch.accounting_client_supabase_id IS NULL;
UPDATE public.accounting_csv_mappings         ch SET accounting_client_supabase_id = p.supabase_id FROM public.accounting_clients p WHERE ch.accounting_client_id = p.id AND ch.accounting_client_supabase_id IS NULL;
