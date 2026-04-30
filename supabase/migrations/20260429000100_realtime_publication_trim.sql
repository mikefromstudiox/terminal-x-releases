-- ════════════════════════════════════════════════════════════════════════════
-- 20260429000100_realtime_publication_trim.sql
--
-- Phase C scaling fix: trim supabase_realtime to ONLY the tables the app
-- actually subscribes to. Pre-trim state had 22 tables, 17 of which had no
-- consumer in the codebase — every UPDATE/INSERT on those tables was being
-- broadcast to every connected client and counted against the Pro plan's
-- 2500 msg/s budget for nothing.
--
-- Real subscribers (audited via grep on .channel\( and postgres_changes):
--   • queue              — packages/data/web.js subscribeQueue
--   • tickets            — packages/data/web.js subscribeTickets
--   • mesas              — packages/data/web.js subscribeMesas (was NOT in pub!)
--   • kds_events         — packages/data/web.js subscribeKdsEvents (was NOT in pub!)
--   • ticket_locks       — packages/services/inventoryLock.js subscribeLocks (was NOT in pub!)
--
-- Net change: 22 → 5 tables in publication. Estimated msg/s budget reclaim
-- at 1000 active sessions: ~75%. Three previously-broken realtime UI flows
-- (mesas live updates, KDS live, ticket-lock contention) start working.
--
-- Idempotent: each ADD/DROP guarded by pg_publication_tables EXISTS check.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  -- Tables that MUST stay in the publication (real consumers exist).
  keep TEXT[] := ARRAY[
    'queue', 'tickets', 'mesas', 'kds_events', 'ticket_locks'
  ];
  -- Tables currently in the publication that have NO consumer — drop them.
  drop_list TEXT[] := ARRAY[
    'activity_log_legacy_unpartitioned',
    'caja_chica',
    'cajero_commissions',
    'categorias_servicio',
    'clients',
    'compras_607',
    'credit_payments',
    'cuadre_caja',
    'empleados',
    'inventory_items',
    'inventory_transactions',
    'ncf_sequences',
    'notas_credito',
    'payroll_runs',
    'salary_changes',
    'seller_commissions',
    'services',
    'staff',
    'ticket_items',
    'washer_commissions'
  ];
  t TEXT;
BEGIN
  -- Add the 3 missing tables (mesas, kds_events, ticket_locks) if they exist
  -- and aren't already in the publication.
  FOREACH t IN ARRAY keep
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name = t)
       AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename = t)
    THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      RAISE NOTICE 'realtime publication: added %', t;
    END IF;
  END LOOP;

  -- Drop the unsubscribed tables.
  FOREACH t IN ARRAY drop_list
  LOOP
    IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename = t)
    THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
      RAISE NOTICE 'realtime publication: dropped %', t;
    END IF;
  END LOOP;
END $$;

-- Verification (commented; uncomment to inspect after apply):
-- SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' ORDER BY tablename;
