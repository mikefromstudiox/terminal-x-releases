-- Migration: HWID rebind approval workflow (S-H9).
--
-- First-activation on an unbound license remains TOFU — any HWID can claim an
-- unbound license (existing behaviour, intentional for desktop onboarding).
-- However, rebinding a license that is already bound to a DIFFERENT HWID now
-- requires explicit admin approval via the license_rebind_requests queue.
--
-- Flow:
--   1. Desktop B hits /api/validate with hwid_B on a license bound to hwid_A.
--   2. validate.js upserts a pending row in license_rebind_requests (TTL 72h)
--      and emits a license_events row with action='rebind_requested'.
--   3. Admin reviews queue in Licenses.jsx → approves or rejects.
--   4. On approve: licenses.hardware_id = hwid_B, licenses.prior_hardware_id =
--      hwid_A, event 'rebind_approved'. Pending row deleted.
--   5. On reject: row deleted, event 'rebind_rejected'.
--
-- Idempotent: safe to re-run.

-- 1. prior_hardware_id column on licenses for the audit trail.
DO $$ BEGIN
  BEGIN
    ALTER TABLE public.licenses ADD COLUMN prior_hardware_id TEXT;
  EXCEPTION WHEN duplicate_column THEN NULL; END;
END $$;

-- 2. Rebind request queue.
CREATE TABLE IF NOT EXISTS public.license_rebind_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id            UUID NOT NULL REFERENCES public.licenses(id) ON DELETE CASCADE,
  requested_hwid        TEXT NOT NULL,
  current_hwid          TEXT,
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at            TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '72 hours'),
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected','expired')),
  approved_by_admin_id  UUID REFERENCES public.admin_users(id) ON DELETE SET NULL,
  approved_at           TIMESTAMPTZ,
  ip                    TEXT,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dedupe pending requests for the SAME (license, hwid) pair. A second hit from
-- the same desktop within the 72h window bumps updated_at instead of flooding
-- the queue.
CREATE UNIQUE INDEX IF NOT EXISTS uq_license_rebind_pending
  ON public.license_rebind_requests(license_id, requested_hwid)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_license_rebind_status
  ON public.license_rebind_requests(status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_license_rebind_license
  ON public.license_rebind_requests(license_id);

-- 3. RLS: no client access. Admin panel uses service role (bypasses RLS);
-- no anon/authenticated policies are written, so everything is denied.
ALTER TABLE public.license_rebind_requests ENABLE ROW LEVEL SECURITY;

-- 4. Extend license_events.action vocabulary. No CHECK constraint on action
-- today (free-form TEXT), so the new event types require no schema change —
-- documenting the canonical strings here for discoverability:
--
--   'rebind_requested' : hwid B attempted to validate on license bound to A
--   'rebind_approved'  : admin approved the rebind, licenses.hardware_id updated
--   'rebind_rejected'  : admin rejected, pending row deleted
--
-- Keep this comment block in sync with validate.js + panel.js.

COMMENT ON TABLE public.license_rebind_requests IS
  'Pending HWID rebind requests — closes S-H9 first-activation-TOFU gap. Admin approval required to move licenses.hardware_id from HWID A to HWID B.';
