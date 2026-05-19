-- 2026_05_19 — Add ofertas + oferta_items to supabase_realtime publication
--
-- Finding #10 from inaugural schema-suite run. ofertas + oferta_items
-- existed in public schema with full RLS + supabase_id columns, but
-- were missing from the supabase_realtime publication — meaning the
-- desktop / web POS could NOT subscribe to combo/bundle changes via
-- Realtime. Out-of-band mutations (admin edits a combo, another POS
-- creates one) would only appear after the next 5-min sync pull,
-- producing 'where did that combo go?' moments for cashiers.
--
-- Other vertical-critical tables (mesas, tickets, ticket_items,
-- service_recipe_items, etc.) are already in the publication — these
-- two slipped through when the ofertas feature shipped.

BEGIN;

ALTER PUBLICATION supabase_realtime ADD TABLE public.ofertas, public.oferta_items;

COMMIT;

-- Verify:
--   SELECT tablename FROM pg_publication_tables
--   WHERE pubname='supabase_realtime' AND tablename IN ('ofertas','oferta_items');
-- Expected: 2 rows.
