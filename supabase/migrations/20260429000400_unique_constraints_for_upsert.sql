-- ════════════════════════════════════════════════════════════════════════════
-- 20260429000400_unique_constraints_for_upsert.sql
--
-- Make every PostgREST `onConflict` target referenced in production code a
-- REAL UNIQUE CONSTRAINT (not a partial index, not "trust me it's unique").
-- PostgREST rejects partial indexes as conflict targets — every such caller
-- silently fell back to creating duplicate rows or failing with
-- "no unique or exclusion constraint matching the ON CONFLICT specification".
-- At fleet scale this corrupts data; closing it now.
--
-- Pre-flight (verified 2026-04-29):
--   ncf_sequences  (business_id, type)                                : 0 dups
--   ticket_locks   (business_id, inventory_item_supabase_id, device_id): 0 dups
--   crm_leads      (business_id)                                       : 0 dups
--   staff          (business_id, auth_user_id)                         : 0 non-NULL dups
--                                                                       NULL auth_user_id rows
--                                                                       are treated as distinct
--                                                                       under default NULLS
--                                                                       DISTINCT, so are not
--                                                                       duplicates for
--                                                                       constraint purposes.
--
-- Idempotent: each ADD CONSTRAINT guarded by IF NOT EXISTS check.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- ncf_sequences: callers upsert with onConflict='business_id,type'.
  -- Existing constraint is (business_id, type, prefix) — close but the type
  -- prefix is essentially deterministic from type for our flow, so a 2-col
  -- constraint is the right surface for the upsert pattern in panel.js,
  -- signup/provision.js, web.js, etc.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.ncf_sequences'::regclass
       AND conname  = 'ncf_sequences_business_type_uniq'
  ) THEN
    ALTER TABLE public.ncf_sequences
      ADD CONSTRAINT ncf_sequences_business_type_uniq UNIQUE (business_id, type);
  END IF;

  -- ticket_locks: inventoryLock.js upserts with the 3-col target. No dups.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.ticket_locks'::regclass
       AND conname  = 'ticket_locks_business_item_device_uniq'
  ) THEN
    ALTER TABLE public.ticket_locks
      ADD CONSTRAINT ticket_locks_business_item_device_uniq
      UNIQUE (business_id, inventory_item_supabase_id, device_id);
  END IF;

  -- crm_leads: signup/provision.js upserts with onConflict='business_id'.
  -- One CRM lead per business is the intended invariant.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.crm_leads'::regclass
       AND conname  = 'crm_leads_business_uniq'
  ) THEN
    ALTER TABLE public.crm_leads
      ADD CONSTRAINT crm_leads_business_uniq UNIQUE (business_id);
  END IF;

  -- staff: panel.js upserts on (business_id, auth_user_id). NULLS DISTINCT
  -- (default) means rows without auth_user_id (PIN-only employees) are not
  -- compared against each other — multiple are allowed. Once an
  -- auth_user_id is set, it must be unique within the business.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.staff'::regclass
       AND conname  = 'staff_business_auth_user_uniq'
  ) THEN
    ALTER TABLE public.staff
      ADD CONSTRAINT staff_business_auth_user_uniq UNIQUE (business_id, auth_user_id);
  END IF;
END $$;
