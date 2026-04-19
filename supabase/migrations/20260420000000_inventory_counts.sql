-- v2.5 — Conteo Fisico (physical inventory count + variance / theft report)
--
-- This mirrors the tables created manually in the live Supabase project on
-- 2026-04-20. Declared here so fresh `supabase db reset` environments
-- (used by the Playwright CI harness + new developer setups) get the same
-- schema without a manual SQL step.
--
-- Schema highlights:
--   - inventory_count_items.variance_* columns are GENERATED STORED so the
--     client never writes them — PostgREST rejects INSERT/UPDATE on
--     generated cols with 428C9, which is the intended guard.
--   - UNIQUE (business_id, supabase_id) per standard sync convention.
--   - RLS allowed by standard anon policy (authenticated + business_id IS NOT NULL).

CREATE TABLE IF NOT EXISTS public.inventory_counts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id           uuid NOT NULL DEFAULT gen_random_uuid(),
  business_id           uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  title                 text NOT NULL DEFAULT 'Conteo Fisico',
  started_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz,
  counted_by_name       text,
  status                text NOT NULL DEFAULT 'abierto' CHECK (status IN ('abierto','completado','cancelado')),
  notes                 text,
  total_expected_value  numeric NOT NULL DEFAULT 0,
  total_counted_value   numeric NOT NULL DEFAULT 0,
  total_variance_value  numeric NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_counts_biz_sid ON public.inventory_counts(business_id, supabase_id);
CREATE INDEX        IF NOT EXISTS ix_inventory_counts_status  ON public.inventory_counts(business_id, status, started_at DESC);

CREATE TABLE IF NOT EXISTS public.inventory_count_items (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id                uuid NOT NULL DEFAULT gen_random_uuid(),
  business_id                uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  count_supabase_id          uuid NOT NULL,
  inventory_item_supabase_id uuid NOT NULL,
  sku                        text,
  name                       text NOT NULL,
  category                   text,
  expected_qty               numeric NOT NULL DEFAULT 0,
  counted_qty                numeric,
  unit_cost                  numeric NOT NULL DEFAULT 0,
  unit_price                 numeric NOT NULL DEFAULT 0,
  variance_qty               numeric GENERATED ALWAYS AS (COALESCE(counted_qty, 0) - expected_qty) STORED,
  variance_cost              numeric GENERATED ALWAYS AS ((COALESCE(counted_qty, 0) - expected_qty) * unit_cost)  STORED,
  variance_price             numeric GENERATED ALWAYS AS ((COALESCE(counted_qty, 0) - expected_qty) * unit_price) STORED,
  notes                      text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_count_items_biz_sid     ON public.inventory_count_items(business_id, supabase_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_count_items_count_item  ON public.inventory_count_items(count_supabase_id, inventory_item_supabase_id);
CREATE INDEX        IF NOT EXISTS ix_inv_count_items_count       ON public.inventory_count_items(business_id, count_supabase_id);

-- updated_at triggers (bump on every UPDATE, matching the sync contract used
-- by every other synced table — see electron/sync.js pass-2 LWW check).
CREATE OR REPLACE FUNCTION public.bump_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_inventory_counts_updated_at ON public.inventory_counts;
CREATE TRIGGER trg_inventory_counts_updated_at BEFORE UPDATE ON public.inventory_counts
  FOR EACH ROW EXECUTE FUNCTION public.bump_updated_at();

DROP TRIGGER IF EXISTS trg_inventory_count_items_updated_at ON public.inventory_count_items;
CREATE TRIGGER trg_inventory_count_items_updated_at BEFORE UPDATE ON public.inventory_count_items
  FOR EACH ROW EXECUTE FUNCTION public.bump_updated_at();

-- RLS — anon/authenticated policies matching the house convention.
ALTER TABLE public.inventory_counts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_count_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_all_inventory_counts      ON public.inventory_counts;
DROP POLICY IF EXISTS anon_all_inventory_count_items ON public.inventory_count_items;

CREATE POLICY anon_all_inventory_counts ON public.inventory_counts
  FOR ALL TO anon, authenticated
  USING (business_id IS NOT NULL)
  WITH CHECK (business_id IS NOT NULL);

CREATE POLICY anon_all_inventory_count_items ON public.inventory_count_items
  FOR ALL TO anon, authenticated
  USING (business_id IS NOT NULL)
  WITH CHECK (business_id IS NOT NULL);

-- Realtime replication (so desktop + other web tabs see changes instantly via
-- the sync.js realtime channel subscription).
ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_counts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_count_items;
