-- ⚠️  SUPERSEDED 2026-04-27 by 20260427000001_per_license_jwt_lockdown.sql
-- ⚠️  Every `rls_anon_sync_*` policy this file creates was DROPPED inside
-- ⚠️  the policy-rebuild loop in 20260427000001 and replaced by the
-- ⚠️  per-license JWT family (`<tbl>_jwt_select` / `<tbl>_jwt_modify` etc).
-- ⚠️  DO NOT trust this file as a description of current RLS posture.
-- ⚠️  Cross-check with `pg_policies` or docs/MIGRATION-AUDIT-2026-05-01.md
-- ⚠️  before reasoning about anon access. Audited 2026-05-01.
--
-- HOTFIX: Sprint 5 hardening (20260419200000) dropped every anon policy but
-- desktop sync ships with the anon key and relies on tenant-scoped writes.
-- my_business_ids() requires auth.uid() so anon got zero rows back. Every
-- desktop-originated push/pull has been silently failing since that migration.
--
-- This restores the pre-hardening baseline: anon may read/write/delete any row
-- on sync tables as long as business_id is populated. This matches the
-- assumption documented at electron/main.js:44-49 and the HARDCODED_SUPABASE_ANON
-- shipped in the installer. Staff and licenses are intentionally excluded —
-- those keep their auth-only policies from the hardening migration.

DO $$
DECLARE
  t text;
  sync_tables text[] := ARRAY[
    'activity_log','adelantos','app_settings','appointments','caja_chica',
    'cajero_commissions','categorias_servicio','client_item_prices',
    'client_service_rates','clients','collections_log','compras_607',
    'configuracion','credit_payments','cuadre_caja','doc_number_blocks',
    'doc_number_master','ecf_queue','ecf_submissions','empleados',
    'inventory_count_items','inventory_counts','inventory_items',
    'inventory_oversells','inventory_transactions','loan_payments',
    'loan_schedule','loans','memberships','modifier_groups','ncf_blocks',
    'ncf_sequences','ncf_sequences_master','notas_credito','pawn_items',
    'payroll_runs','payroll_settings','projects','queue','queue_deletions',
    'salary_changes','sales_deals','seller_commissions','service_bays',
    'service_packages','services','stylist_schedules','subscriptions',
    'test_drives','ticket_items','tickets','vehicle_inventory','vehicles',
    'wash_combos','washer_commissions','work_order_items','work_orders',
    'ecf_cert_history','loyalty_transactions','anecf_queue','pos_tab_order',
    'pos_tab_hidden'
  ];
BEGIN
  FOREACH t IN ARRAY sync_tables LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t) THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='business_id') THEN CONTINUE; END IF;

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'rls_anon_sync_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'rls_anon_sync_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'rls_anon_sync_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'rls_anon_sync_delete', t);

    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO anon USING (business_id IS NOT NULL)', 'rls_anon_sync_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO anon WITH CHECK (business_id IS NOT NULL)', 'rls_anon_sync_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO anon USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL)', 'rls_anon_sync_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO anon USING (business_id IS NOT NULL)', 'rls_anon_sync_delete', t);
  END LOOP;
END $$;
