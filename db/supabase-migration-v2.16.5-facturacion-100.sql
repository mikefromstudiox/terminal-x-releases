-- ============================================================================
-- v2.16.5 — Facturación tier 100/100 sprint
-- ----------------------------------------------------------------------------
-- Locks down at the database layer the safety guarantees the application is
-- already enforcing. Idempotent: every statement is guarded so it can be
-- re-applied safely.
--
-- Sections:
--   1) seller_commissions / cajero_commissions UNIQUE constraints (FIX-H9)
--   2) tickets.currency / tickets.fx_rate columns (FIX-M2)
--   3) Activity-log events for invoice_voided (FIX-M6 idempotency)
-- ============================================================================

BEGIN;

-- ─── 1) Commission idempotency ─────────────────────────────────────────────
-- Same logical key the renderer enforces in packages/data/web.js:
--   (business_id, ticket_supabase_id, empleado_supabase_id) is unique per
--   commission row. Ticket-less manual adjustments (ticket_supabase_id IS
--   NULL) are intentionally allowed to repeat — that's why we use a partial
--   index and not a table-level constraint.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname  = 'seller_commissions_unique_per_ticket_emp'
  ) THEN
    EXECUTE $sql$
      CREATE UNIQUE INDEX seller_commissions_unique_per_ticket_emp
        ON public.seller_commissions (business_id, ticket_supabase_id, empleado_supabase_id)
       WHERE ticket_supabase_id IS NOT NULL
         AND empleado_supabase_id IS NOT NULL
    $sql$;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname  = 'cajero_commissions_unique_per_ticket_emp'
  ) THEN
    EXECUTE $sql$
      CREATE UNIQUE INDEX cajero_commissions_unique_per_ticket_emp
        ON public.cajero_commissions (business_id, ticket_supabase_id, empleado_supabase_id)
       WHERE ticket_supabase_id IS NOT NULL
         AND empleado_supabase_id IS NOT NULL
    $sql$;
  END IF;
END $$;

-- ─── 2) Multi-currency columns on tickets ──────────────────────────────────
-- Stored alongside the canonical DOP totals so Historial / 606 / 607 stay
-- DGII-correct, and the receipt PDF can re-render the original USD amounts.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'tickets'
       AND column_name  = 'currency'
  ) THEN
    ALTER TABLE public.tickets ADD COLUMN currency text DEFAULT 'DOP';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'tickets'
       AND column_name  = 'fx_rate'
  ) THEN
    ALTER TABLE public.tickets ADD COLUMN fx_rate numeric(12,4) DEFAULT 1;
  END IF;
END $$;

-- Soft constraint: only the currencies the UI emits today.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tickets_currency_chk'
  ) THEN
    ALTER TABLE public.tickets
      ADD CONSTRAINT tickets_currency_chk
      CHECK (currency IS NULL OR currency IN ('DOP', 'USD'));
  END IF;
END $$;

-- ─── 3) invoice_voided activity-log enum / event ───────────────────────────
-- Some installs constrain activity_log.event_type via an enum. If yours uses
-- a CHECK-list, append `invoice_voided`; if it's a free-text column this is
-- a no-op.

DO $$ BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' AND t.typname = 'activity_event_type'
  ) THEN
    -- Postgres has no IF NOT EXISTS for ALTER TYPE … ADD VALUE pre-12, but
    -- ALTER TYPE … ADD VALUE IF NOT EXISTS is supported on 12+.
    BEGIN
      EXECUTE 'ALTER TYPE public.activity_event_type ADD VALUE IF NOT EXISTS ''invoice_voided''';
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

COMMIT;
