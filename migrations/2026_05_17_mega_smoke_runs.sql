-- 2026-05-17 — Mega Smoke (Layer 6) results table.
--
-- WHY: Layers 1-5 each catch one slice of silent failure. None of them would
-- have caught the FULL set of drift bugs that surfaced 2026-05-17:
--   • CAR WASH DJ provisioned with name='STUDIO X SRL' (wrong cloned row)
--   • NCF B02 not enabled at provisioning (silent until first credit sale)
--   • queue.ticket_id NULL → markPaid silently skipped
--   • CSP nonce desync, /pos 404, /api/* 405, VITE_SUPABASE_* missing
--
-- Layer 6 is the comprehensive net: 100+ scenarios covering every CLASS of
-- bug that has bitten this codebase (infra, env, schema drift, RLS, per-
-- vertical user flows, contabilidad invite flow, plan-gating reference,
-- cron-schedule liveness, sync invariants, e-CF, mesas addon). Runs every
-- 15 min from /api/panel?action=cron_mega_smoke. Failures escalate to
-- client_errors as severity='critical', category='mega_smoke.<scenario>.fail'
-- and Layer 5 (cron_claude_triage) writes a diagnosis + WhatsApps Mike.
-- Throttled: max 5 WhatsApp messages per 15-min window, rolled into one
-- summary beyond that.
--
-- Admin-read only via service role. No RLS policies — anon + authenticated
-- have ALL privileges revoked. The cron writes via service role; admin panel
-- reads via the requireAdmin()-gated /api/panel?action=mega_smoke_history.

CREATE TABLE IF NOT EXISTS public.mega_smoke_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  source              TEXT NOT NULL,  -- 'cron' | 'local' | 'github-actions'
  total_count         INTEGER NOT NULL,
  passed_count        INTEGER NOT NULL,
  failed_count        INTEGER NOT NULL,
  duration_ms         INTEGER NOT NULL,
  failures            JSONB,          -- [{ id, category, name, observed, expected, detail }]
  whatsapp_sent_count INTEGER NOT NULL DEFAULT 0,
  whatsapp_summary    JSONB,          -- { rolled_up: N, sent_ids: [...] } when throttled
  claude_diagnosed_at TIMESTAMPTZ,
  claude_diagnosis    JSONB
);

CREATE INDEX IF NOT EXISTS idx_mega_smoke_runs_ran_at
  ON public.mega_smoke_runs (ran_at DESC);

-- Layer 5 (cron_claude_triage) discovers undiagnosed failure rows via this index.
CREATE INDEX IF NOT EXISTS idx_mega_smoke_runs_undiagnosed
  ON public.mega_smoke_runs (ran_at DESC)
  WHERE claude_diagnosed_at IS NULL AND failed_count > 0;

ALTER TABLE public.mega_smoke_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mega_smoke_runs FROM anon, authenticated;
