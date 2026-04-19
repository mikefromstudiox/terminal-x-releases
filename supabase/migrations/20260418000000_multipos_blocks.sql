-- ============================================================================
-- Multi-POS + Offline Architecture (Section 5 of docs/MULTI-POS-ARCHITECTURE.md)
-- - Pre-allocated NCF / doc_number blocks per device (HWID)
-- - Authoritative post-sync inventory deduct with oversell detection
-- - tickets.origin_hwid for per-device forensic trace
-- Rerunnable: all DDL guarded by IF NOT EXISTS / CREATE OR REPLACE.
-- ============================================================================

-- 1) Extensions ---------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 2) Master sequence per (business_id, ncf_type) -----------------------------
CREATE TABLE IF NOT EXISTS ncf_sequences_master (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  ncf_type    TEXT NOT NULL,
  prefix      TEXT NOT NULL,
  range_start BIGINT NOT NULL,
  range_end   BIGINT NOT NULL,
  next_global BIGINT NOT NULL,
  exhausted   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ncf_seq_master_unique UNIQUE (business_id, ncf_type)
);
CREATE INDEX IF NOT EXISTS idx_ncf_seq_master_biz ON ncf_sequences_master(business_id);

-- 3) ncf_blocks ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ncf_blocks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id    UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  hwid           TEXT NOT NULL,
  device_label   TEXT,
  ncf_type       TEXT NOT NULL,
  prefix         TEXT NOT NULL,
  range_start    BIGINT NOT NULL,
  range_end      BIGINT NOT NULL,
  next_available BIGINT NOT NULL,
  size           INT NOT NULL,
  allocated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  exhausted_at   TIMESTAMPTZ,
  last_used_at   TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ncf_blocks_unique_bid   UNIQUE (business_id, supabase_id),
  CONSTRAINT ncf_blocks_range_valid  CHECK (range_end >= range_start AND next_available >= range_start AND next_available <= range_end + 1)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ncf_blocks_no_overlap') THEN
    ALTER TABLE ncf_blocks ADD CONSTRAINT ncf_blocks_no_overlap
      EXCLUDE USING gist (business_id WITH =, ncf_type WITH =, int8range(range_start, range_end, '[]') WITH &&);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ncf_blocks_biz_hwid_type ON ncf_blocks(business_id, hwid, ncf_type) WHERE exhausted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ncf_blocks_biz_type      ON ncf_blocks(business_id, ncf_type);

-- 4) doc_number master + blocks ---------------------------------------------
-- Chose a dedicated doc_number_master table (not a businesses column) so we can
-- scope by 'ticket' | 'quote' | 'work_order' in the future without schema churn.
CREATE TABLE IF NOT EXISTS doc_number_master (
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  scope       TEXT NOT NULL DEFAULT 'ticket',
  next_global BIGINT NOT NULL DEFAULT 1,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, scope)
);

CREATE TABLE IF NOT EXISTS doc_number_blocks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id    UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  hwid           TEXT NOT NULL,
  device_label   TEXT,
  scope          TEXT NOT NULL DEFAULT 'ticket',
  range_start    BIGINT NOT NULL,
  range_end      BIGINT NOT NULL,
  next_available BIGINT NOT NULL,
  size           INT NOT NULL,
  allocated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  exhausted_at   TIMESTAMPTZ,
  last_used_at   TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT doc_blocks_unique_bid  UNIQUE (business_id, supabase_id),
  CONSTRAINT doc_blocks_range_valid CHECK (range_end >= range_start AND next_available >= range_start AND next_available <= range_end + 1)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'doc_blocks_no_overlap') THEN
    ALTER TABLE doc_number_blocks ADD CONSTRAINT doc_blocks_no_overlap
      EXCLUDE USING gist (business_id WITH =, scope WITH =, int8range(range_start, range_end, '[]') WITH &&);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_doc_blocks_biz_hwid_scope ON doc_number_blocks(business_id, hwid, scope) WHERE exhausted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_doc_blocks_biz_scope      ON doc_number_blocks(business_id, scope);

-- 5) tickets.origin_hwid -----------------------------------------------------
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS origin_hwid         TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS origin_device_label TEXT;
CREATE INDEX IF NOT EXISTS idx_tickets_origin_hwid ON tickets(business_id, origin_hwid);

-- 6) inventory_oversells -----------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_oversells (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id         UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  ticket_supabase_id  UUID,
  item_supabase_id    UUID,
  item_name           TEXT,
  requested_qty       NUMERIC NOT NULL,
  actual_qty          NUMERIC NOT NULL,
  detected_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at         TIMESTAMPTZ,
  resolved_by         UUID,
  resolved_by_name    TEXT,
  resolution_notes    TEXT,
  resolution_type     TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT oversells_unique_bid UNIQUE (business_id, supabase_id)
);
CREATE INDEX IF NOT EXISTS idx_oversells_unresolved ON inventory_oversells(business_id) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_oversells_biz_resolved ON inventory_oversells(business_id, resolved_at);

-- 7) Triggers (reuse update_updated_at() from initial migration) -------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ncf_blocks_upd') THEN
    CREATE TRIGGER trg_ncf_blocks_upd BEFORE UPDATE ON ncf_blocks
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ncf_seq_master_upd') THEN
    CREATE TRIGGER trg_ncf_seq_master_upd BEFORE UPDATE ON ncf_sequences_master
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_doc_blocks_upd') THEN
    CREATE TRIGGER trg_doc_blocks_upd BEFORE UPDATE ON doc_number_blocks
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_doc_master_upd') THEN
    CREATE TRIGGER trg_doc_master_upd BEFORE UPDATE ON doc_number_master
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_oversells_upd') THEN
    CREATE TRIGGER trg_oversells_upd BEFORE UPDATE ON inventory_oversells
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ============================================================================
-- RPCs
-- ============================================================================

-- allocate_ncf_block ---------------------------------------------------------
CREATE OR REPLACE FUNCTION allocate_ncf_block(
  p_business_id UUID,
  p_hwid        TEXT,
  p_ncf_type    TEXT,
  p_size        INT DEFAULT 500
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  partial      ncf_blocks%ROWTYPE;
  m            ncf_sequences_master%ROWTYPE;
  ns           RECORD;
  new_start    BIGINT;
  new_end      BIGINT;
  out_row      ncf_blocks%ROWTYPE;
BEGIN
  IF p_business_id IS NULL OR p_hwid IS NULL OR p_ncf_type IS NULL THEN
    RAISE EXCEPTION 'business_id, hwid and ncf_type are required';
  END IF;
  IF p_size < 1 OR p_size > 10000 THEN
    RAISE EXCEPTION 'block size out of range (1..10000)';
  END IF;

  -- 1) Reuse a partially consumed block already owned by this HWID.
  SELECT * INTO partial
    FROM ncf_blocks
   WHERE business_id = p_business_id
     AND hwid        = p_hwid
     AND ncf_type    = p_ncf_type
     AND exhausted_at IS NULL
     AND next_available <= range_end
   ORDER BY range_start ASC
   LIMIT 1
   FOR UPDATE;
  IF FOUND THEN
    RETURN row_to_json(partial);
  END IF;

  -- 2) Ensure master row exists. If not, bootstrap from legacy ncf_sequences.
  SELECT * INTO m
    FROM ncf_sequences_master
   WHERE business_id = p_business_id AND ncf_type = p_ncf_type
   FOR UPDATE;

  IF NOT FOUND THEN
    SELECT prefix, current_number, limit_number
      INTO ns
      FROM ncf_sequences
     WHERE business_id = p_business_id AND type = p_ncf_type
     LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'no master or legacy sequence for business=% type=%', p_business_id, p_ncf_type;
    END IF;
    INSERT INTO ncf_sequences_master(business_id, ncf_type, prefix, range_start, range_end, next_global)
    VALUES (p_business_id, p_ncf_type, ns.prefix, 1, GREATEST(ns.limit_number, 100000), COALESCE(ns.current_number, 0) + 1)
    RETURNING * INTO m;
  END IF;

  IF m.exhausted OR m.next_global > m.range_end THEN
    UPDATE ncf_sequences_master SET exhausted = true WHERE id = m.id;
    RAISE EXCEPTION 'NCF range exhausted for %', p_ncf_type;
  END IF;

  new_start := m.next_global;
  new_end   := LEAST(m.next_global + p_size - 1, m.range_end);

  INSERT INTO ncf_blocks(business_id, hwid, ncf_type, prefix,
                         range_start, range_end, next_available, size)
  VALUES (p_business_id, p_hwid, p_ncf_type, m.prefix,
          new_start, new_end, new_start, (new_end - new_start + 1)::INT)
  RETURNING * INTO out_row;

  UPDATE ncf_sequences_master
     SET next_global = new_end + 1,
         exhausted   = (new_end + 1 > range_end)
   WHERE id = m.id;

  RETURN row_to_json(out_row);
END $$;

-- allocate_doc_number_block --------------------------------------------------
CREATE OR REPLACE FUNCTION allocate_doc_number_block(
  p_business_id UUID,
  p_hwid        TEXT,
  p_size        INT DEFAULT 200,
  p_scope       TEXT DEFAULT 'ticket'
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  partial   doc_number_blocks%ROWTYPE;
  m         doc_number_master%ROWTYPE;
  new_start BIGINT;
  new_end   BIGINT;
  out_row   doc_number_blocks%ROWTYPE;
BEGIN
  IF p_business_id IS NULL OR p_hwid IS NULL THEN
    RAISE EXCEPTION 'business_id and hwid are required';
  END IF;
  IF p_size < 1 OR p_size > 10000 THEN
    RAISE EXCEPTION 'block size out of range (1..10000)';
  END IF;

  -- Reuse partial
  SELECT * INTO partial
    FROM doc_number_blocks
   WHERE business_id = p_business_id
     AND hwid        = p_hwid
     AND scope       = p_scope
     AND exhausted_at IS NULL
     AND next_available <= range_end
   ORDER BY range_start ASC
   LIMIT 1
   FOR UPDATE;
  IF FOUND THEN
    RETURN row_to_json(partial);
  END IF;

  -- Lock/seed master
  SELECT * INTO m
    FROM doc_number_master
   WHERE business_id = p_business_id AND scope = p_scope
   FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO doc_number_master(business_id, scope, next_global)
    VALUES (p_business_id, p_scope, 1)
    RETURNING * INTO m;
  END IF;

  new_start := m.next_global;
  new_end   := m.next_global + p_size - 1;

  INSERT INTO doc_number_blocks(business_id, hwid, scope,
                                range_start, range_end, next_available, size)
  VALUES (p_business_id, p_hwid, p_scope,
          new_start, new_end, new_start, (new_end - new_start + 1)::INT)
  RETURNING * INTO out_row;

  UPDATE doc_number_master SET next_global = new_end + 1
   WHERE business_id = p_business_id AND scope = p_scope;

  RETURN row_to_json(out_row);
END $$;

-- deduct_inventory_atomic ----------------------------------------------------
CREATE OR REPLACE FUNCTION deduct_inventory_atomic(
  p_business_id        UUID,
  p_ticket_supabase_id UUID,
  p_hwid               TEXT,
  p_items              JSON
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  it         JSONB;
  item_sid   UUID;
  req_qty    NUMERIC;
  item_nm    TEXT;
  post_qty   NUMERIC;
  pre_qty    NUMERIC;
  oversells  JSONB := '[]'::JSONB;
BEGIN
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'business_id required';
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items::JSONB) LOOP
    item_sid := (it->>'item_supabase_id')::UUID;
    req_qty  := (it->>'qty')::NUMERIC;
    item_nm  := it->>'name';

    -- Guarded deduct
    UPDATE inventory_items
       SET quantity   = quantity - req_qty,
           updated_at = now()
     WHERE business_id = p_business_id
       AND supabase_id = item_sid
       AND quantity   >= req_qty
    RETURNING quantity INTO post_qty;

    IF NOT FOUND THEN
      -- Oversell: read current qty, then forcibly deduct anyway
      SELECT quantity, COALESCE(item_nm, name)
        INTO pre_qty, item_nm
        FROM inventory_items
       WHERE business_id = p_business_id AND supabase_id = item_sid;

      UPDATE inventory_items
         SET quantity   = quantity - req_qty,
             updated_at = now()
       WHERE business_id = p_business_id
         AND supabase_id = item_sid
      RETURNING quantity INTO post_qty;

      INSERT INTO inventory_oversells(business_id, ticket_supabase_id, item_supabase_id,
                                      item_name, requested_qty, actual_qty)
      VALUES (p_business_id, p_ticket_supabase_id, item_sid,
              item_nm, req_qty, COALESCE(pre_qty, 0));

      oversells := oversells || jsonb_build_object(
        'item_supabase_id', item_sid,
        'item_name',        item_nm,
        'requested_qty',    req_qty,
        'actual_qty',       COALESCE(pre_qty, 0),
        'post_qty',         COALESCE(post_qty, 0)
      );
    END IF;
  END LOOP;

  RETURN json_build_object('ok', true, 'oversells', oversells);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('ok', false, 'error', SQLERRM);
END $$;

-- resolve_oversell -----------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_oversell(
  p_oversell_id     UUID,
  p_resolved_by     UUID,
  p_resolved_by_name TEXT,
  p_notes           TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  UPDATE inventory_oversells
     SET resolved_at      = now(),
         resolved_by      = p_resolved_by,
         resolved_by_name = p_resolved_by_name,
         resolution_notes = p_notes
   WHERE supabase_id = p_oversell_id
      OR id          = p_oversell_id;
END $$;

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE ncf_blocks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ncf_sequences_master  ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_number_blocks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_number_master     ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_oversells   ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ncf_blocks' AND policyname='ncf_blocks_anon_rw') THEN
    CREATE POLICY ncf_blocks_anon_rw ON ncf_blocks FOR ALL TO anon, authenticated
      USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ncf_sequences_master' AND policyname='ncf_seq_master_anon_rw') THEN
    CREATE POLICY ncf_seq_master_anon_rw ON ncf_sequences_master FOR ALL TO anon, authenticated
      USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='doc_number_blocks' AND policyname='doc_blocks_anon_rw') THEN
    CREATE POLICY doc_blocks_anon_rw ON doc_number_blocks FOR ALL TO anon, authenticated
      USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='doc_number_master' AND policyname='doc_master_anon_rw') THEN
    CREATE POLICY doc_master_anon_rw ON doc_number_master FOR ALL TO anon, authenticated
      USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='inventory_oversells' AND policyname='oversells_anon_rw') THEN
    CREATE POLICY oversells_anon_rw ON inventory_oversells FOR ALL TO anon, authenticated
      USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);
  END IF;
END $$;

-- Grants so anon/authenticated can call SECURITY DEFINER RPCs
GRANT EXECUTE ON FUNCTION allocate_ncf_block(UUID, TEXT, TEXT, INT)          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION allocate_doc_number_block(UUID, TEXT, INT, TEXT)   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION deduct_inventory_atomic(UUID, UUID, TEXT, JSON)    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION resolve_oversell(UUID, UUID, TEXT, TEXT)           TO anon, authenticated;
