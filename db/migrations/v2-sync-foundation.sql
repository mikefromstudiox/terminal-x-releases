-- Terminal X v2.0.0 — Supabase sync foundation migration
-- Written: 2026-04-16
-- Source: docs/CONSOLIDATED-FIX-PLAN.md Phase 1
--
-- Safe to re-run: every statement uses IF NOT EXISTS / DO blocks where possible.
-- Ordered so that each sub-block can be committed independently.

-- ─────────────────────────────────────────────────────────────────────────────
-- F5: UNIQUE (business_id, supabase_id) on queue_deletions + ecf_submissions
-- Required so sync upsert on_conflict='business_id,supabase_id' works.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_queue_deletions_sid'
  ) THEN
    ALTER TABLE queue_deletions
      ADD CONSTRAINT uq_queue_deletions_sid UNIQUE (business_id, supabase_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_ecf_submissions_sid'
  ) THEN
    ALTER TABLE ecf_submissions
      ADD CONSTRAINT uq_ecf_submissions_sid UNIQUE (business_id, supabase_id);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- F6: tickets.void_by should be uuid (was already uuid in this DB; keeping
-- block for idempotency against environments where it is still integer/text).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='tickets'
      AND column_name='void_by' AND data_type <> 'uuid'
  ) THEN
    ALTER TABLE tickets
      ALTER COLUMN void_by TYPE uuid USING NULLIF(void_by::text, '')::uuid;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- F7: collapse duplicate active staff rows per (business_id, username), keep
-- the row with auth_user_id, else oldest. Then add UNIQUE constraint DEFERRABLE.
-- ─────────────────────────────────────────────────────────────────────────────
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY business_id, username
           ORDER BY (auth_user_id IS NOT NULL) DESC, created_at ASC
         ) AS rn
  FROM staff WHERE active = true
)
UPDATE staff SET active = false, updated_at = now()
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Partial unique index is used rather than a full UNIQUE constraint so that
-- soft-deleted (active=false) historical rows do not prevent legitimate future
-- re-uses of a username. Sync never uses (business_id, username) as an
-- on_conflict target — supabase_id is the sync key. This index is strictly a
-- defensive guard against the identity-aliasing bug recurring.
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_biz_username_active
  ON staff (business_id, username) WHERE active = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- F13: drop NOT NULL on legacy typed FK columns that sync never populates.
-- The *_supabase_id columns are the authoritative sync key.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE credit_payments        ALTER COLUMN client_id  DROP NOT NULL;
ALTER TABLE inventory_transactions ALTER COLUMN item_id    DROP NOT NULL;
ALTER TABLE cajero_commissions     ALTER COLUMN cajero_id  DROP NOT NULL;
ALTER TABLE cajero_commissions     ALTER COLUMN ticket_id  DROP NOT NULL;
ALTER TABLE loans                  ALTER COLUMN client_id  DROP NOT NULL;
ALTER TABLE loan_payments          ALTER COLUMN loan_id    DROP NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- F18: inventory_items v2.2 auto-parts columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS oem_part_number  TEXT,
  ADD COLUMN IF NOT EXISTS compatibility    JSONB,
  ADD COLUMN IF NOT EXISTS reorder_quantity INTEGER,
  ADD COLUMN IF NOT EXISTS supplier         TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- F12: helper to deep-merge business settings JSONB
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION merge_business_settings(p_business_id uuid, p_patch jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  UPDATE businesses
     SET settings   = COALESCE(settings, '{}'::jsonb) || COALESCE(p_patch, '{}'::jsonb),
         updated_at = now()
   WHERE id = p_business_id
  RETURNING settings;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- F19: drop legacy typed tickets.client_id / cajero_id (text) — only the
-- *_supabase_id variants are authoritative.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE tickets DROP COLUMN IF EXISTS client_id;
ALTER TABLE tickets DROP COLUMN IF EXISTS cajero_id;
