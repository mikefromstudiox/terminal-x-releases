-- ============================================================
-- Dealership vertical — Terminal X v2.1
-- Idempotent migration. Separate vehicle_inventory table.
-- ============================================================

-- 1) vehicle_inventory — vehicles for sale (NOT customer vehicles)
CREATE TABLE IF NOT EXISTS public.vehicle_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  stock_number TEXT,
  vin TEXT,
  make TEXT,
  model TEXT,
  year INTEGER,
  color TEXT,
  mileage INTEGER DEFAULT 0,
  condition TEXT DEFAULT 'used',          -- new | used | certified
  acquisition_cost NUMERIC(14,2) DEFAULT 0,
  listing_price NUMERIC(14,2) DEFAULT 0,
  status TEXT DEFAULT 'available',         -- available | reserved | sold | in_service
  listing_date TIMESTAMPTZ DEFAULT now(),
  sold_date TIMESTAMPTZ,
  photos_json JSONB DEFAULT '[]'::jsonb,
  title_status TEXT DEFAULT 'clean',       -- clean | salvage | lien | pending
  notes TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_inventory_biz_sid_key') THEN
    ALTER TABLE public.vehicle_inventory ADD CONSTRAINT vehicle_inventory_biz_sid_key UNIQUE (business_id, supabase_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_vehinv_biz_status ON public.vehicle_inventory(business_id, status) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_vehinv_vin ON public.vehicle_inventory(business_id, vin);
CREATE INDEX IF NOT EXISTS idx_vehinv_stock ON public.vehicle_inventory(business_id, stock_number);

-- 2) sales_deals — the big-ticket sale record
CREATE TABLE IF NOT EXISTS public.sales_deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  client_id UUID,
  client_supabase_id UUID,
  vehicle_inventory_id UUID,
  vehicle_inventory_supabase_id UUID,
  salesperson_id UUID,
  salesperson_supabase_id UUID,
  sale_price NUMERIC(14,2) DEFAULT 0,
  trade_in_vehicle_id UUID,
  trade_in_supabase_id UUID,
  trade_in_value NUMERIC(14,2) DEFAULT 0,
  down_payment NUMERIC(14,2) DEFAULT 0,
  financed_amount NUMERIC(14,2) DEFAULT 0,
  term_months INTEGER DEFAULT 0,
  apr NUMERIC(6,3) DEFAULT 0,
  monthly_payment NUMERIC(14,2) DEFAULT 0,
  status TEXT DEFAULT 'draft',             -- draft | pending | closed | cancelled
  ticket_id UUID,
  ticket_supabase_id UUID,
  closed_at TIMESTAMPTZ,
  notes TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_deals_biz_sid_key') THEN
    ALTER TABLE public.sales_deals ADD CONSTRAINT sales_deals_biz_sid_key UNIQUE (business_id, supabase_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_sales_deals_biz_status ON public.sales_deals(business_id, status) WHERE active = true;

-- 3) test_drives
CREATE TABLE IF NOT EXISTS public.test_drives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  client_id UUID,
  client_supabase_id UUID,
  vehicle_inventory_id UUID,
  vehicle_inventory_supabase_id UUID,
  staff_id UUID,
  staff_supabase_id UUID,
  scheduled_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  signed_waiver_url TEXT,
  license_number TEXT,
  notes TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'test_drives_biz_sid_key') THEN
    ALTER TABLE public.test_drives ADD CONSTRAINT test_drives_biz_sid_key UNIQUE (business_id, supabase_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_test_drives_biz ON public.test_drives(business_id, scheduled_at DESC) WHERE active = true;

-- 4) leads — sales pipeline
CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT,
  phone TEXT,
  email TEXT,
  client_id UUID,
  client_supabase_id UUID,
  vehicle_interest_id UUID,
  vehicle_interest_supabase_id UUID,
  salesperson_id UUID,
  salesperson_supabase_id UUID,
  source TEXT,                             -- walk_in | whatsapp | web | referral | other
  stage TEXT DEFAULT 'lead',               -- lead | test_drive | negotiation | financing | closed | lost
  lost_reason TEXT,
  budget NUMERIC(14,2),
  notes TEXT,
  next_follow_up TIMESTAMPTZ,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_biz_sid_key') THEN
    ALTER TABLE public.leads ADD CONSTRAINT leads_biz_sid_key UNIQUE (business_id, supabase_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_leads_biz_stage ON public.leads(business_id, stage) WHERE active = true;

-- 5) RLS
ALTER TABLE public.vehicle_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_deals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_drives       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads             ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE t TEXT; BEGIN
  FOR t IN SELECT unnest(ARRAY['vehicle_inventory','sales_deals','test_drives','leads']) LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_anon_all" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "%1$s_anon_all" ON public.%1$I FOR ALL TO anon USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL)', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_auth_all" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "%1$s_auth_all" ON public.%1$I FOR ALL TO authenticated USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL)', t);
  END LOOP;
END $$;

-- 6) updated_at triggers (reuse existing function if present)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'touch_updated_at') THEN
    CREATE FUNCTION public.touch_updated_at() RETURNS TRIGGER AS $fn$
    BEGIN NEW.updated_at = now(); RETURN NEW; END
    $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

DO $$ DECLARE t TEXT; BEGIN
  FOR t IN SELECT unnest(ARRAY['vehicle_inventory','sales_deals','test_drives','leads']) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_updated BEFORE UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', t);
  END LOOP;
END $$;
