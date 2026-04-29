-- Honorarios — late-fee enforcement (Phase 1+).
-- Adds persisted late_fee_amount + paid_late columns to accounting_billing_invoices.
-- Computed at billingInvoiceMarkPaid time when (paid_at - created_at) > plan.late_fee_after_days.
--
-- Formula: late_fee_amount = round(amount * (plan.late_fee_pct / 100), 2)
--
-- Applied via Supabase Management API on 2026-04-27.

ALTER TABLE public.accounting_billing_invoices ADD COLUMN IF NOT EXISTS late_fee_amount NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.accounting_billing_invoices ADD COLUMN IF NOT EXISTS paid_late SMALLINT NOT NULL DEFAULT 0;
