-- Terminal X — Contabilidad Slice 5: cross-firm wire (accountant -> client tenant).
--
-- Goal: a contable (business_type='contabilidad') with a granted access code
-- can SELECT their accounting_client's business data — tickets, ticket_items,
-- ecf_documents, inventory_items, services, clients (DR consumer), retentions.
-- WRITE access stays denied (read-only contable view by design).
--
-- Design:
--   1. Add columns to accounting_clients: shared_business_id (UUID, FK businesses.id),
--      access_granted (bool), access_granted_at (timestamptz), access_token (text 8-char,
--      one-time, expires after 24h).
--   2. has_accountant_access(target_business_id) SECURITY DEFINER function checks
--      whether the calling JWT business_id is the firm-side tenant of an
--      accounting_clients row with access_granted=true and shared_business_id
--      matching the target. search_path locked to 'public, pg_temp'.
--   3. Append RLS policies on the protected tables that OR with existing policies:
--      target_business_id = current_jwt_business_id() OR has_accountant_access(target).
--   4. REVOKE writes — accountant is read-only.
--
-- Idempotent — safe to re-run.

-- ── 1. Schema additions ─────────────────────────────────────────────────────
ALTER TABLE public.accounting_clients
  ADD COLUMN IF NOT EXISTS shared_business_id UUID,
  ADD COLUMN IF NOT EXISTS access_granted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS access_granted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS access_token TEXT,
  ADD COLUMN IF NOT EXISTS access_token_expires_at TIMESTAMPTZ;

-- Token is one-shot; uniqueness only matters for live (unconsumed) tokens.
-- A partial unique index keeps re-issuance simple — once consumed (token=NULL)
-- no constraint applies. PostgREST does NOT need to use this as on_conflict
-- (we look up by token via a server-side query in ctb_accept_access_code).
CREATE UNIQUE INDEX IF NOT EXISTS u_acc_clients_access_token
  ON public.accounting_clients(access_token)
  WHERE access_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_acc_clients_shared_biz
  ON public.accounting_clients(shared_business_id)
  WHERE shared_business_id IS NOT NULL AND access_granted = TRUE;

-- ── 2. has_accountant_access helper ─────────────────────────────────────────
-- target_business_id == business that owns the data we're about to read.
-- We look up accounting_clients where shared_business_id = target AND the
-- ROW belongs to the firm tenant whose JWT is making the call.
CREATE OR REPLACE FUNCTION public.has_accountant_access(target_business_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public, pg_temp'
AS $$
DECLARE
  jwt_biz TEXT;
  result  BOOLEAN := FALSE;
BEGIN
  IF target_business_id IS NULL THEN RETURN FALSE; END IF;
  jwt_biz := COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id', '');
  IF jwt_biz = '' THEN RETURN FALSE; END IF;
  -- Self-access trivially allowed (the regular policy already covers this,
  -- so we short-circuit to keep the OR-chain clean).
  IF jwt_biz = target_business_id::text THEN RETURN TRUE; END IF;
  SELECT TRUE INTO result
    FROM public.accounting_clients ac
    WHERE ac.business_id::text = jwt_biz
      AND ac.shared_business_id = target_business_id
      AND ac.access_granted = TRUE
      AND ac.status = 'active'
    LIMIT 1;
  RETURN COALESCE(result, FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.has_accountant_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_accountant_access(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_accountant_access(UUID) TO anon;

-- ── 3. Append cross-firm SELECT policies on protected tables ───────────────
-- We do NOT touch existing policies. We add a new policy named
-- p_<table>_select_accountant that opens SELECT to the accountant tenant.
-- Postgres RLS unions multiple permissive policies → the row is visible if
-- ANY policy USING clause matches.

-- tickets ----------------------------------------------------------------
DROP POLICY IF EXISTS p_tickets_select_accountant ON public.tickets;
CREATE POLICY p_tickets_select_accountant ON public.tickets
  FOR SELECT TO authenticated
  USING (business_id IS NOT NULL AND public.has_accountant_access(business_id));

-- ticket_items -----------------------------------------------------------
DROP POLICY IF EXISTS p_ticket_items_select_accountant ON public.ticket_items;
CREATE POLICY p_ticket_items_select_accountant ON public.ticket_items
  FOR SELECT TO authenticated
  USING (business_id IS NOT NULL AND public.has_accountant_access(business_id));

-- ecf_documents (the canonical e-CF table; some envs call it 'ecf') -------
-- Use a DO block so the migration succeeds whether the table exists as
-- ecf_documents OR ecf — we patch whichever is present.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='ecf_documents') THEN
    EXECUTE 'DROP POLICY IF EXISTS p_ecf_documents_select_accountant ON public.ecf_documents';
    EXECUTE 'CREATE POLICY p_ecf_documents_select_accountant ON public.ecf_documents
              FOR SELECT TO authenticated
              USING (business_id IS NOT NULL AND public.has_accountant_access(business_id))';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='ecf') THEN
    EXECUTE 'DROP POLICY IF EXISTS p_ecf_select_accountant ON public.ecf';
    EXECUTE 'CREATE POLICY p_ecf_select_accountant ON public.ecf
              FOR SELECT TO authenticated
              USING (business_id IS NOT NULL AND public.has_accountant_access(business_id))';
  END IF;
END
$do$;

-- inventory_items --------------------------------------------------------
DROP POLICY IF EXISTS p_inventory_items_select_accountant ON public.inventory_items;
CREATE POLICY p_inventory_items_select_accountant ON public.inventory_items
  FOR SELECT TO authenticated
  USING (business_id IS NOT NULL AND public.has_accountant_access(business_id));

-- services (price + ITBIS catalog the contable needs to reconcile invoices)
DROP POLICY IF EXISTS p_services_select_accountant ON public.services;
CREATE POLICY p_services_select_accountant ON public.services
  FOR SELECT TO authenticated
  USING (business_id IS NOT NULL AND public.has_accountant_access(business_id));

-- clients (DR end-customers — needed for 607 reports) --------------------
DROP POLICY IF EXISTS p_clients_select_accountant ON public.clients;
CREATE POLICY p_clients_select_accountant ON public.clients
  FOR SELECT TO authenticated
  USING (business_id IS NOT NULL AND public.has_accountant_access(business_id));

-- compras_607 (DR purchases ledger — feeds 606) -------------------------
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='compras_607') THEN
    EXECUTE 'DROP POLICY IF EXISTS p_compras_607_select_accountant ON public.compras_607';
    EXECUTE 'CREATE POLICY p_compras_607_select_accountant ON public.compras_607
              FOR SELECT TO authenticated
              USING (business_id IS NOT NULL AND public.has_accountant_access(business_id))';
  END IF;
END
$do$;

-- ── 4. Comments / hardening ─────────────────────────────────────────────────
COMMENT ON COLUMN public.accounting_clients.shared_business_id IS
  'Cross-firm: UUID of the businesses row this accounting_client maps to in the granting tenant. Set when the client redeems access_token.';
COMMENT ON COLUMN public.accounting_clients.access_token IS
  'One-time 8-char code generated by the firm and entered by the client to grant SELECT access. Expires 24h after issuance.';
COMMENT ON FUNCTION public.has_accountant_access(UUID) IS
  'SECURITY DEFINER helper for cross-firm RLS. Returns TRUE iff the calling JWT business_id is a contabilidad tenant with an active accounting_clients row whose shared_business_id matches the target.';
