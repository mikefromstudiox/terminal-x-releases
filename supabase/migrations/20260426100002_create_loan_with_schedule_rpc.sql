-- ════════════════════════════════════════════════════════════════════════════
-- H6 — Atomic loan creation RPC
--
-- Replaces the two-step (loans INSERT, then loan_schedule INSERT) flow in
-- packages/data/web.js loans.create with a single transactional Postgres
-- function. If the schedule INSERT loop fails, the loan row is rolled back
-- automatically (function bodies run in an implicit transaction). This
-- eliminates orphan loan rows.
--
-- Auth model: SECURITY DEFINER bypasses RLS internally so we can insert under
-- anon. Re-imposes the same isolation rule as the RLS tighten migration
-- (20260425500000_prestamos_rls_tighten.sql) by checking
--   auth.jwt() -> 'user_metadata' ->> 'business_id' = p_business_id
--
-- Idempotent — CREATE OR REPLACE.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_loan_with_schedule(
  p_business_id UUID,
  p_loan        JSONB,
  p_schedule    JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_loan_supabase_id UUID;
  v_jwt_biz          UUID;
  v_row              JSONB;
BEGIN
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'business_id required';
  END IF;

  -- Re-impose RLS-equivalent isolation on the SECURITY DEFINER path.
  BEGIN
    v_jwt_biz := ((auth.jwt() -> 'user_metadata') ->> 'business_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_jwt_biz := NULL;
  END;

  IF v_jwt_biz IS NULL OR v_jwt_biz IS DISTINCT FROM p_business_id THEN
    RAISE EXCEPTION 'business_id mismatch with auth context';
  END IF;

  v_loan_supabase_id := (p_loan ->> 'supabase_id')::uuid;
  IF v_loan_supabase_id IS NULL THEN
    RAISE EXCEPTION 'loan.supabase_id required';
  END IF;

  -- Insert the loan row.
  INSERT INTO loans (
    supabase_id, business_id, client_supabase_id, principal, term_months,
    interest_rate, monthly_payment, status, disbursed_at, next_due_date,
    total_paid, total_interest, amortization_method, renewal_count, notes,
    created_at, updated_at
  ) VALUES (
    v_loan_supabase_id, p_business_id,
    NULLIF(p_loan ->> 'client_supabase_id','')::uuid,
    (p_loan ->> 'principal')::numeric,
    (p_loan ->> 'term_months')::int,
    (p_loan ->> 'interest_rate')::numeric,
    COALESCE((p_loan ->> 'monthly_payment')::numeric, 0),
    COALESCE(p_loan ->> 'status', 'active'),
    NULLIF(p_loan ->> 'disbursed_at','')::timestamptz,
    p_loan ->> 'next_due_date',
    COALESCE((p_loan ->> 'total_paid')::numeric, 0),
    COALESCE((p_loan ->> 'total_interest')::numeric, 0),
    COALESCE(p_loan ->> 'amortization_method', 'interest_only'),
    COALESCE((p_loan ->> 'renewal_count')::int, 0),
    p_loan ->> 'notes',
    COALESCE(NULLIF(p_loan ->> 'created_at','')::timestamptz, now()),
    now()
  );

  -- Insert schedule rows (if any).
  IF p_schedule IS NOT NULL AND jsonb_typeof(p_schedule) = 'array'
     AND jsonb_array_length(p_schedule) > 0 THEN
    FOR v_row IN SELECT * FROM jsonb_array_elements(p_schedule)
    LOOP
      INSERT INTO loan_schedule (
        supabase_id, business_id, loan_supabase_id, installment_no,
        due_date, principal_due, interest_due, total_due, paid_amount,
        paid_at, status, created_at, updated_at
      ) VALUES (
        COALESCE(NULLIF(v_row ->> 'supabase_id','')::uuid, gen_random_uuid()),
        p_business_id, v_loan_supabase_id,
        (v_row ->> 'installment_no')::int,
        v_row ->> 'due_date',
        COALESCE((v_row ->> 'principal_due')::numeric, 0),
        COALESCE((v_row ->> 'interest_due')::numeric, 0),
        COALESCE((v_row ->> 'total_due')::numeric, 0),
        COALESCE((v_row ->> 'paid_amount')::numeric, 0),
        NULLIF(v_row ->> 'paid_at',''),
        COALESCE(v_row ->> 'status', 'pending'),
        now(), now()
      );
    END LOOP;
  END IF;

  RETURN v_loan_supabase_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_loan_with_schedule(UUID, JSONB, JSONB)
  TO anon, authenticated;
