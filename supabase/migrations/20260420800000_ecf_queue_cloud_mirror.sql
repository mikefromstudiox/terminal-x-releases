-- 20260420800000_ecf_queue_cloud_mirror.sql
-- Sprint 10 — Cloud-mirror the offline e-CF queue (Recovery RTO HIGH finding).
--
-- Problem: ecf_queue lives only in local SQLite. If a PC dies mid-queue
-- (e-CFs signed-but-not-submitted, still within the DGII 72h contingency
-- window), those fiscal obligations vanish with the disk — the client
-- already handed paper to the customer, but DGII never sees the e-CF.
--
-- Fix: align Supabase ecf_queue with local schema so sync.js can push the
-- pending queue on every 5-min cycle, and a fresh install pulls the
-- queue + processDgiiQueue() resumes submission. Dedup is enforced by a
-- partial unique index on (business_id, encf) — DGII itself rejects a
-- dupe encf submission, so the natural key is authoritative.
--
-- This migration is idempotent. Runs cleanly on the live Supabase where
-- ecf_queue already exists with the legacy ef2.do shape (url_path,
-- body_json, token, last_error) — new columns are additive.

BEGIN;

-- 1. Additive columns — keep legacy ones (url_path/body_json/token/last_error)
--    so in-flight legacy ef2.do rows still round-trip through the schema.
ALTER TABLE public.ecf_queue
  ADD COLUMN IF NOT EXISTS supabase_id        UUID,
  ADD COLUMN IF NOT EXISTS ticket_supabase_id UUID,
  ADD COLUMN IF NOT EXISTS encf               TEXT,
  ADD COLUMN IF NOT EXISTS tipo_ecf           TEXT,
  ADD COLUMN IF NOT EXISTS xml_signed         TEXT,
  ADD COLUMN IF NOT EXISTS environment        TEXT NOT NULL DEFAULT 'certecf',
  ADD COLUMN IF NOT EXISTS status             TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS track_id           TEXT,
  ADD COLUMN IF NOT EXISTS submitted_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ NOT NULL DEFAULT now();

-- 2. Status domain. Legacy rows that predate this migration were all
--    implicitly 'pending' so the default above is safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ecf_queue_status_chk'
       AND conrelid = 'public.ecf_queue'::regclass
  ) THEN
    ALTER TABLE public.ecf_queue
      ADD CONSTRAINT ecf_queue_status_chk
      CHECK (status IN ('pending','submitted','failed'));
  END IF;
END $$;

-- 3. supabase_id uniqueness so (business_id, supabase_id) upserts work.
--    Backfill NULLs first so the unique index can be created.
UPDATE public.ecf_queue
   SET supabase_id = gen_random_uuid()
 WHERE supabase_id IS NULL;

ALTER TABLE public.ecf_queue
  ALTER COLUMN supabase_id SET NOT NULL,
  ALTER COLUMN supabase_id SET DEFAULT gen_random_uuid();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'uq_ecf_queue_biz_supabase_id'
       AND conrelid = 'public.ecf_queue'::regclass
  ) THEN
    ALTER TABLE public.ecf_queue
      ADD CONSTRAINT uq_ecf_queue_biz_supabase_id
      UNIQUE (business_id, supabase_id);
  END IF;
END $$;

-- 4. NCF natural-key dedup (partial — only live rows with an encf).
--    Guarantees two devices can't race-push the same e-CF under different
--    supabase_id values. NULL encf rows (legacy ef2.do) are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ecf_queue_biz_encf
  ON public.ecf_queue (business_id, encf)
  WHERE encf IS NOT NULL;

-- 5. Pending-scan index — processDgiiQueue filters by status+business.
CREATE INDEX IF NOT EXISTS idx_ecf_queue_pending
  ON public.ecf_queue (business_id, status, created_at)
  WHERE status = 'pending';

-- 6. updated_at monotonic trigger for LWW pull strategy.
DROP TRIGGER IF EXISTS trg_ecf_queue_touch ON public.ecf_queue;
CREATE TRIGGER trg_ecf_queue_touch
  BEFORE UPDATE ON public.ecf_queue
  FOR EACH ROW EXECUTE FUNCTION public.trg_touch_updated_at();

COMMIT;
