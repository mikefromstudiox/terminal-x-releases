-- ============================================================================
-- Terminal X — Supabase Migration v1.9.1
-- Run this in Supabase SQL Editor (Dashboard → SQL → New Query)
--
-- Fixes:
--   #10: inventory_items column alignment (already correct, no action needed)
--   #11: empleados missing 4 payroll columns + updated_at
--   #12: sellers missing cedula/start_date, users missing supabase_id
--   #20: RLS policies for business_id isolation
--   SYNC: updated_at on all 21 synced tables
-- ============================================================================

-- ── 1. Add missing columns to empleados ─────────────────────────────────────
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS puesto TEXT;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS bank_account TEXT;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS tss_id TEXT;

-- ── 2. Add missing columns to sellers ───────────────────────────────────────
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS cedula TEXT;
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS start_date TEXT;

-- ── 3. Add supabase_id + missing columns to users ──────────────────────────
-- CRITICAL: without supabase_id, the entire users sync is broken
ALTER TABLE users ADD COLUMN IF NOT EXISTS supabase_id UUID;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cedula TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS start_date TEXT;
-- Create unique index for sync upsert on (business_id, supabase_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_biz_supabase_id ON users(business_id, supabase_id);

-- ── 4. Add updated_at to ALL synced tables ──────────────────────────────────
-- Tables that already have updated_at: services, clients, inventory_items, users
-- Tables that need it added:
ALTER TABLE washers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE ncf_sequences ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE categorias_servicio ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE ticket_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE queue ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE washer_commissions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE seller_commissions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE cajero_commissions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE credit_payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE cuadre_caja ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE caja_chica ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE notas_credito ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE compras_607 ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- Backfill updated_at from created_at where available
UPDATE washers SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE sellers SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE ncf_sequences SET updated_at = NOW() WHERE updated_at IS NULL;
UPDATE empleados SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE categorias_servicio SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE tickets SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE ticket_items SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE queue SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE washer_commissions SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE seller_commissions SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE cajero_commissions SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE credit_payments SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE cuadre_caja SET updated_at = NOW() WHERE updated_at IS NULL;
UPDATE caja_chica SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE notas_credito SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE inventory_transactions SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE compras_607 SET updated_at = created_at WHERE updated_at IS NULL;

-- ── 5. Auto-update triggers for updated_at ──────────────────────────────────
-- Supabase uses PostgreSQL — create trigger function once, apply to all tables
CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all synced tables
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'services','washers','sellers','clients','inventory_items','ncf_sequences',
    'empleados','categorias_servicio','users','tickets','ticket_items','queue',
    'washer_commissions','seller_commissions','cajero_commissions',
    'credit_payments','cuadre_caja','caja_chica','notas_credito',
    'inventory_transactions','compras_607'
  ]) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at()', t, t);
  END LOOP;
END;
$$;

-- ── 6. RLS Policies — business_id isolation (#20) ───────────────────────────
-- Enable RLS on all business-scoped tables.
-- Service role key (used by desktop sync) bypasses RLS automatically.
-- Anon key gets restricted to matching business_id.
--
-- NOTE: The web app currently uses anon key WITHOUT Supabase auth.
-- These policies use a permissive approach: anon can read/write rows
-- where business_id matches the request header x-business-id.
-- For production hardening, migrate to Supabase auth + JWT claims.

-- Enable RLS on all tables
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'services','washers','sellers','clients','inventory_items','ncf_sequences',
    'empleados','categorias_servicio','users','tickets','ticket_items','queue',
    'washer_commissions','seller_commissions','cajero_commissions',
    'credit_payments','cuadre_caja','caja_chica','notas_credito',
    'inventory_transactions','compras_607','businesses','payroll_runs',
    'salary_changes','app_settings','configuracion'
  ]) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- Drop existing policies to avoid conflicts
    EXECUTE format('DROP POLICY IF EXISTS "business_read_%I" ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "business_write_%I" ON %I', t, t);
    -- Read: allow if business_id matches
    EXECUTE format(
      'CREATE POLICY "business_read_%I" ON %I FOR SELECT USING (business_id = COALESCE(current_setting(''request.jwt.claims'', true)::json->>''business_id'', current_setting(''request.headers'', true)::json->>''x-business-id'')::uuid, business_id))',
      t, t
    );
    -- Write: allow if business_id matches
    EXECUTE format(
      'CREATE POLICY "business_write_%I" ON %I FOR ALL USING (business_id = COALESCE(current_setting(''request.jwt.claims'', true)::json->>''business_id'', current_setting(''request.headers'', true)::json->>''x-business-id'')::uuid, business_id))',
      t, t
    );
  END LOOP;
END;
$$;

-- ── 7. Verify ───────────────────────────────────────────────────────────────
-- Run this to confirm all columns were added:
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('empleados','sellers','users')
  AND column_name IN ('puesto','email','bank_account','tss_id','cedula','start_date','supabase_id','updated_at')
ORDER BY table_name, column_name;
