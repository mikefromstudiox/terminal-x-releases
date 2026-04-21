-- Extend BEFORE UPDATE triggers to tables missed by 20260419300000.
-- Pull cursor `updated_at > last_pull_at` skips rows whose UPDATE forgot
-- to stamp updated_at — symptom: the row is changed in cloud but desktop
-- never sees it.

DO $$
DECLARE
  t text;
  targets text[] := ARRAY[
    'loyalty_transactions',
    'inventory_oversells',
    'work_order_items',
    'anecf_queue'
  ];
BEGIN
  FOREACH t IN ARRAY targets LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name=t AND column_name='updated_at'
    ) THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema='public' AND table_name=t AND table_type='BASE TABLE'
    ) THEN CONTINUE; END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_touch_updated_at ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%I_touch_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.trg_touch_updated_at()', t, t);
  END LOOP;
END $$;
