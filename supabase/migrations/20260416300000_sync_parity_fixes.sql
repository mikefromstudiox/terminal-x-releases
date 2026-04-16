-- ============================================================================
-- 20260416300000_sync_parity_fixes.sql
-- Fixes sync parity gaps found in 2026-04-15 audit:
--   1. Add supabase_id to tables missing it
--   2. Add UNIQUE(business_id, supabase_id) constraints for PostgREST upsert
--   3. Add void_by/void_at to tickets
--   4. Add created_at to ticket_items
--   5. Fix staff/users VIEW rules to include all sync columns
--   6. Add supabase_id to payroll_runs
-- ============================================================================

-- ── 1. Add supabase_id where missing ──────────────────────────────────────────
-- Most tables got supabase_id via ad-hoc SQL on 2026-04-11. These are
-- idempotent (IF NOT EXISTS / safe to re-run).

DO $$ BEGIN
  -- Tables that may be missing supabase_id column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='supabase_id') THEN
    ALTER TABLE tickets ADD COLUMN supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ticket_items' AND column_name='supabase_id') THEN
    ALTER TABLE ticket_items ADD COLUMN supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='queue' AND column_name='supabase_id') THEN
    ALTER TABLE queue ADD COLUMN supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='services' AND column_name='supabase_id') THEN
    ALTER TABLE services ADD COLUMN supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='washers' AND column_name='supabase_id') THEN
    ALTER TABLE washers ADD COLUMN supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sellers' AND column_name='supabase_id') THEN
    ALTER TABLE sellers ADD COLUMN supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clients' AND column_name='supabase_id') THEN
    ALTER TABLE clients ADD COLUMN supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_items' AND column_name='supabase_id') THEN
    ALTER TABLE inventory_items ADD COLUMN supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ncf_sequences' AND column_name='supabase_id') THEN
    ALTER TABLE ncf_sequences ADD COLUMN supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='empleados' AND column_name='supabase_id') THEN
    ALTER TABLE empleados ADD COLUMN supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='categorias_servicio' AND column_name='supabase_id') THEN
    ALTER TABLE categorias_servicio ADD COLUMN supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='washer_commissions' AND column_name='supabase_id') THEN
    ALTER TABLE washer_commissions ADD COLUMN supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='seller_commissions' AND column_name='supabase_id') THEN
    ALTER TABLE seller_commissions ADD COLUMN supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cajero_commissions' AND column_name='supabase_id') THEN
    ALTER TABLE cajero_commissions ADD COLUMN supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='credit_payments' AND column_name='supabase_id') THEN
    ALTER TABLE credit_payments ADD COLUMN supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cuadre_caja' AND column_name='supabase_id') THEN
    ALTER TABLE cuadre_caja ADD COLUMN supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='caja_chica' AND column_name='supabase_id') THEN
    ALTER TABLE caja_chica ADD COLUMN supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notas_credito' AND column_name='supabase_id') THEN
    ALTER TABLE notas_credito ADD COLUMN supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_transactions' AND column_name='supabase_id') THEN
    ALTER TABLE inventory_transactions ADD COLUMN supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='compras_607' AND column_name='supabase_id') THEN
    ALTER TABLE compras_607 ADD COLUMN supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payroll_runs' AND column_name='supabase_id') THEN
    ALTER TABLE payroll_runs ADD COLUMN supabase_id UUID;
  END IF;
  -- tickets: void_by, void_at
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='void_by') THEN
    ALTER TABLE tickets ADD COLUMN void_by TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='void_at') THEN
    ALTER TABLE tickets ADD COLUMN void_at TIMESTAMPTZ;
  END IF;
  -- ticket_items: created_at
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ticket_items' AND column_name='created_at') THEN
    ALTER TABLE ticket_items ADD COLUMN created_at TIMESTAMPTZ DEFAULT now();
  END IF;
  -- payroll_runs: empleado_supabase_id
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payroll_runs' AND column_name='empleado_supabase_id') THEN
    ALTER TABLE payroll_runs ADD COLUMN empleado_supabase_id UUID;
  END IF;
  -- staff: sync columns (supabase_id, cedula, start_date, employee_id)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='staff' AND column_name='supabase_id') THEN
    ALTER TABLE staff ADD COLUMN supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='staff' AND column_name='cedula') THEN
    ALTER TABLE staff ADD COLUMN cedula TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='staff' AND column_name='start_date') THEN
    ALTER TABLE staff ADD COLUMN start_date DATE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='staff' AND column_name='employee_id') THEN
    ALTER TABLE staff ADD COLUMN employee_id UUID;
  END IF;
END $$;

-- ── 2. Backfill supabase_id on existing rows ─────────────────────────────────
UPDATE services SET supabase_id = gen_random_uuid() WHERE supabase_id IS NULL;
UPDATE washers SET supabase_id = gen_random_uuid() WHERE supabase_id IS NULL;
UPDATE sellers SET supabase_id = gen_random_uuid() WHERE supabase_id IS NULL;
UPDATE clients SET supabase_id = gen_random_uuid() WHERE supabase_id IS NULL;
UPDATE inventory_items SET supabase_id = gen_random_uuid() WHERE supabase_id IS NULL;
UPDATE ncf_sequences SET supabase_id = gen_random_uuid() WHERE supabase_id IS NULL;
UPDATE empleados SET supabase_id = gen_random_uuid() WHERE supabase_id IS NULL;
UPDATE categorias_servicio SET supabase_id = gen_random_uuid() WHERE supabase_id IS NULL;
UPDATE staff SET supabase_id = gen_random_uuid() WHERE supabase_id IS NULL;
UPDATE tickets SET supabase_id = gen_random_uuid() WHERE supabase_id IS NULL;
UPDATE ticket_items SET supabase_id = gen_random_uuid() WHERE supabase_id IS NULL;
UPDATE queue SET supabase_id = gen_random_uuid() WHERE supabase_id IS NULL;
UPDATE washer_commissions SET supabase_id = gen_random_uuid() WHERE supabase_id IS NULL;
UPDATE seller_commissions SET supabase_id = gen_random_uuid() WHERE supabase_id IS NULL;
UPDATE cajero_commissions SET supabase_id = gen_random_uuid() WHERE supabase_id IS NULL;
UPDATE credit_payments SET supabase_id = gen_random_uuid() WHERE supabase_id IS NULL;
UPDATE cuadre_caja SET supabase_id = gen_random_uuid() WHERE supabase_id IS NULL;
UPDATE caja_chica SET supabase_id = gen_random_uuid() WHERE supabase_id IS NULL;
UPDATE notas_credito SET supabase_id = gen_random_uuid() WHERE supabase_id IS NULL;
UPDATE inventory_transactions SET supabase_id = gen_random_uuid() WHERE supabase_id IS NULL;
UPDATE compras_607 SET supabase_id = gen_random_uuid() WHERE supabase_id IS NULL;
UPDATE payroll_runs SET supabase_id = gen_random_uuid() WHERE supabase_id IS NULL;

-- ── 3. UNIQUE constraints for PostgREST on_conflict ──────────────────────────
-- Using ALTER TABLE ADD CONSTRAINT (not CREATE UNIQUE INDEX) so PostgREST
-- accepts them as on_conflict targets.

-- Helper: drop-if-exists to make idempotent
DO $$ BEGIN
  -- services
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_services_biz_sid') THEN
    ALTER TABLE services ADD CONSTRAINT uq_services_biz_sid UNIQUE (business_id, supabase_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_washers_biz_sid') THEN
    ALTER TABLE washers ADD CONSTRAINT uq_washers_biz_sid UNIQUE (business_id, supabase_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_sellers_biz_sid') THEN
    ALTER TABLE sellers ADD CONSTRAINT uq_sellers_biz_sid UNIQUE (business_id, supabase_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_clients_biz_sid') THEN
    ALTER TABLE clients ADD CONSTRAINT uq_clients_biz_sid UNIQUE (business_id, supabase_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_inventory_items_biz_sid') THEN
    ALTER TABLE inventory_items ADD CONSTRAINT uq_inventory_items_biz_sid UNIQUE (business_id, supabase_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_ncf_sequences_biz_sid') THEN
    ALTER TABLE ncf_sequences ADD CONSTRAINT uq_ncf_sequences_biz_sid UNIQUE (business_id, supabase_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_empleados_biz_sid') THEN
    ALTER TABLE empleados ADD CONSTRAINT uq_empleados_biz_sid UNIQUE (business_id, supabase_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_categorias_servicio_biz_sid') THEN
    ALTER TABLE categorias_servicio ADD CONSTRAINT uq_categorias_servicio_biz_sid UNIQUE (business_id, supabase_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_staff_biz_sid') THEN
    ALTER TABLE staff ADD CONSTRAINT uq_staff_biz_sid UNIQUE (business_id, supabase_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_tickets_biz_sid') THEN
    ALTER TABLE tickets ADD CONSTRAINT uq_tickets_biz_sid UNIQUE (business_id, supabase_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_ticket_items_biz_sid') THEN
    ALTER TABLE ticket_items ADD CONSTRAINT uq_ticket_items_biz_sid UNIQUE (business_id, supabase_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_queue_biz_sid') THEN
    ALTER TABLE queue ADD CONSTRAINT uq_queue_biz_sid UNIQUE (business_id, supabase_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_washer_commissions_biz_sid') THEN
    ALTER TABLE washer_commissions ADD CONSTRAINT uq_washer_commissions_biz_sid UNIQUE (business_id, supabase_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_seller_commissions_biz_sid') THEN
    ALTER TABLE seller_commissions ADD CONSTRAINT uq_seller_commissions_biz_sid UNIQUE (business_id, supabase_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_cajero_commissions_biz_sid') THEN
    ALTER TABLE cajero_commissions ADD CONSTRAINT uq_cajero_commissions_biz_sid UNIQUE (business_id, supabase_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_credit_payments_biz_sid') THEN
    ALTER TABLE credit_payments ADD CONSTRAINT uq_credit_payments_biz_sid UNIQUE (business_id, supabase_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_cuadre_caja_biz_sid') THEN
    ALTER TABLE cuadre_caja ADD CONSTRAINT uq_cuadre_caja_biz_sid UNIQUE (business_id, supabase_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_caja_chica_biz_sid') THEN
    ALTER TABLE caja_chica ADD CONSTRAINT uq_caja_chica_biz_sid UNIQUE (business_id, supabase_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_notas_credito_biz_sid') THEN
    ALTER TABLE notas_credito ADD CONSTRAINT uq_notas_credito_biz_sid UNIQUE (business_id, supabase_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_inventory_transactions_biz_sid') THEN
    ALTER TABLE inventory_transactions ADD CONSTRAINT uq_inventory_transactions_biz_sid UNIQUE (business_id, supabase_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_compras_607_biz_sid') THEN
    ALTER TABLE compras_607 ADD CONSTRAINT uq_compras_607_biz_sid UNIQUE (business_id, supabase_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_payroll_runs_biz_sid') THEN
    ALTER TABLE payroll_runs ADD CONSTRAINT uq_payroll_runs_biz_sid UNIQUE (business_id, supabase_id);
  END IF;
  -- Restaurant tables (already have UNIQUE(supabase_id), need (business_id, supabase_id))
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_mesas_biz_sid') THEN
    ALTER TABLE mesas ADD CONSTRAINT uq_mesas_biz_sid UNIQUE (business_id, supabase_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_modificadores_biz_sid') THEN
    ALTER TABLE modificadores ADD CONSTRAINT uq_modificadores_biz_sid UNIQUE (business_id, supabase_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_service_modificadores_biz_sid') THEN
    ALTER TABLE service_modificadores ADD CONSTRAINT uq_service_modificadores_biz_sid UNIQUE (business_id, supabase_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_ticket_item_modificadores_biz_sid') THEN
    ALTER TABLE ticket_item_modificadores ADD CONSTRAINT uq_ticket_item_modificadores_biz_sid UNIQUE (business_id, supabase_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_kds_events_biz_sid') THEN
    ALTER TABLE kds_events ADD CONSTRAINT uq_kds_events_biz_sid UNIQUE (business_id, supabase_id);
  END IF;
END $$;

-- ── 4. Recreate users VIEW + RULES with ALL sync columns ────────────────────
CREATE OR REPLACE VIEW users AS SELECT * FROM staff;

CREATE OR REPLACE RULE users_insert AS ON INSERT TO users
  DO INSTEAD INSERT INTO staff VALUES (NEW.*) RETURNING *;

CREATE OR REPLACE RULE users_update AS ON UPDATE TO users
  DO INSTEAD UPDATE staff SET
    business_id    = NEW.business_id,
    auth_user_id   = NEW.auth_user_id,
    name           = NEW.name,
    username       = NEW.username,
    pin_hash       = NEW.pin_hash,
    role           = NEW.role,
    discount_pct   = NEW.discount_pct,
    commission_pct = NEW.commission_pct,
    seller_id      = NEW.seller_id,
    active         = NEW.active,
    supabase_id    = NEW.supabase_id,
    cedula         = NEW.cedula,
    start_date     = NEW.start_date,
    employee_id    = NEW.employee_id,
    created_at     = NEW.created_at,
    updated_at     = NEW.updated_at
  WHERE staff.id = OLD.id RETURNING *;

CREATE OR REPLACE RULE users_delete AS ON DELETE TO users
  DO INSTEAD DELETE FROM staff WHERE staff.id = OLD.id;

-- ── 5. Create ecf_submissions + queue_deletions if missing ───────────────────
CREATE TABLE IF NOT EXISTS ecf_submissions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id      UUID,
  business_id      UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  ticket_supabase_id UUID,
  encf             TEXT,
  tipo_ecf         TEXT,
  track_id         TEXT,
  status           TEXT,
  environment      TEXT DEFAULT 'testecf',
  submitted_at     TIMESTAMPTZ DEFAULT now(),
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_ecf_submissions_biz_sid UNIQUE (business_id, supabase_id)
);

CREATE TABLE IF NOT EXISTS queue_deletions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id      UUID,
  business_id      UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  queue_id         UUID,
  ticket_id        UUID,
  deleted_by       TEXT,
  deleted_at       TIMESTAMPTZ DEFAULT now(),
  reason           TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_queue_deletions_biz_sid UNIQUE (business_id, supabase_id)
);

-- Enable RLS on new tables
ALTER TABLE ecf_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_deletions ENABLE ROW LEVEL SECURITY;

-- Permissive policies (same pattern as other tables)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ecf_submissions' AND policyname='ecf_submissions_anon_all') THEN
    CREATE POLICY ecf_submissions_anon_all ON ecf_submissions FOR ALL TO anon USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='queue_deletions' AND policyname='queue_deletions_anon_all') THEN
    CREATE POLICY queue_deletions_anon_all ON queue_deletions FOR ALL TO anon USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);
  END IF;
END $$;

-- updated_at triggers for new tables
CREATE OR REPLACE FUNCTION trg_set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_ecf_submissions_updated_at') THEN
    CREATE TRIGGER trg_ecf_submissions_updated_at BEFORE UPDATE ON ecf_submissions FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_queue_deletions_updated_at') THEN
    CREATE TRIGGER trg_queue_deletions_updated_at BEFORE UPDATE ON queue_deletions FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
  END IF;
END $$;
