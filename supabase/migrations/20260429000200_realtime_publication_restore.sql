-- ════════════════════════════════════════════════════════════════════════════
-- 20260429000200_realtime_publication_restore.sql
--
-- Corrects the over-aggressive trim in 20260429000100. That migration only
-- audited the WEB subscriber list (5 tables) but missed the DESKTOP sync's
-- startRealtime() in electron/sync.js, which subscribes to ~70 tables to
-- drive instant cross-device pullNow() (vs. the 30-min jittered poll).
-- Dropping those tables from supabase_realtime caused a real cross-device
-- propagation degradation on ~19 entities.
--
-- This migration:
--   1) Restores every table dropped in 20260429000100 EXCEPT
--      activity_log_legacy_unpartitioned (legacy partitioning leftover, no
--      consumer in any code path).
--   2) Keeps the 3 NEW tables added in 20260429000100 (mesas, kds_events,
--      ticket_locks) — those subscriptions were broken before and now work.
--
-- Idempotent. After this migration the publication has the union of the
-- desktop sync.js subscriber set plus the 3 web-side additions, minus the
-- single legacy-only table. This is the "correct" baseline; future trims
-- must coordinate with electron/sync.js startRealtime() table list.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  -- Restore every desktop-subscribed table that was wrongly dropped.
  restore_list TEXT[] := ARRAY[
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
  FOREACH t IN ARRAY restore_list
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name = t)
       AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename = t)
    THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      RAISE NOTICE 'realtime publication: restored %', t;
    END IF;
  END LOOP;
END $$;
