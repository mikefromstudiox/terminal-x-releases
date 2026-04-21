-- L3 — adelantos.approved_by currently stores the approver's display name
-- which drifts when the underlying user renames. Add a stable FK column so
-- audit trails survive rename/delete.

ALTER TABLE public.adelantos
  ADD COLUMN IF NOT EXISTS approved_by_supabase_id UUID;

CREATE INDEX IF NOT EXISTS idx_adelantos_approved_by_sid ON public.adelantos(approved_by_supabase_id);
