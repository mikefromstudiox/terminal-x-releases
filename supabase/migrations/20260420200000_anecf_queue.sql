-- 20260420200000_anecf_queue.sql
-- Sprint 9 — Auto-ANECF queue for voided e-CFs (CRITICAL finding E-C6).
--
-- When a ticket whose NCF is an e-CF (E3x) is voided, we must tell DGII
-- via ANECF (Anulación de Rangos). Previously the void only flipped the
-- local status to 'nula'/'anulado' and the e-CF stayed "valid" at DGII
-- with zero audit trail. This queue persists the pending ANECF so a
-- background processor in electron/main.js flushes it to DGII and keeps
-- per-row status. Mirrors ecf_queue's shape + tenancy model.

BEGIN;

CREATE TABLE IF NOT EXISTS public.anecf_queue (
  id                  BIGSERIAL PRIMARY KEY,
  business_id         UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  ticket_id           BIGINT,                              -- local SQLite id (best-effort)
  ticket_supabase_id  UUID,                                -- canonical join key
  ncf                 TEXT NOT NULL,                       -- e.g. E310000000001
  tipo_ecf            TEXT NOT NULL,                       -- '31','32','33','34',...
  rango_desde         TEXT NOT NULL,
  rango_hasta         TEXT NOT NULL,                       -- equals rango_desde for single-NCF voids
  voided_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at        TIMESTAMPTZ,
  track_id            TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','submitted','failed')),
  error               TEXT,
  attempts            INTEGER NOT NULL DEFAULT 0,
  last_tried          TIMESTAMPTZ,
  environment         TEXT NOT NULL DEFAULT 'certecf',
  supabase_id         UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-tenant idempotency: same business voiding same NCF twice no-ops.
CREATE UNIQUE INDEX IF NOT EXISTS uq_anecf_queue_biz_ncf
  ON public.anecf_queue (business_id, ncf);

CREATE INDEX IF NOT EXISTS idx_anecf_queue_pending
  ON public.anecf_queue (business_id, status, voided_at)
  WHERE status = 'pending';

-- BEFORE UPDATE trigger — keep updated_at monotonic for LWW sync.
DROP TRIGGER IF EXISTS trg_anecf_queue_touch ON public.anecf_queue;
CREATE TRIGGER trg_anecf_queue_touch
  BEFORE UPDATE ON public.anecf_queue
  FOR EACH ROW EXECUTE FUNCTION public.trg_touch_updated_at();

-- RLS — standard my_business_ids() tenancy model (matches ecf_queue).
ALTER TABLE public.anecf_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anecf_queue_select ON public.anecf_queue;
DROP POLICY IF EXISTS anecf_queue_insert ON public.anecf_queue;
DROP POLICY IF EXISTS anecf_queue_update ON public.anecf_queue;
DROP POLICY IF EXISTS anecf_queue_delete ON public.anecf_queue;
DROP POLICY IF EXISTS anecf_queue_anon_all ON public.anecf_queue;

CREATE POLICY anecf_queue_select ON public.anecf_queue
  FOR SELECT TO authenticated
  USING (business_id IN (SELECT public.my_business_ids()));

CREATE POLICY anecf_queue_insert ON public.anecf_queue
  FOR INSERT TO authenticated
  WITH CHECK (business_id IN (SELECT public.my_business_ids()));

CREATE POLICY anecf_queue_update ON public.anecf_queue
  FOR UPDATE TO authenticated
  USING (business_id IN (SELECT public.my_business_ids()))
  WITH CHECK (business_id IN (SELECT public.my_business_ids()));

-- Anon (web, RLS-gated by business_id presence) mirrors ecf_submissions
-- so future web parity works out of the box.
CREATE POLICY anecf_queue_anon_all ON public.anecf_queue
  FOR ALL TO anon
  USING (business_id IS NOT NULL)
  WITH CHECK (business_id IS NOT NULL);

COMMIT;
