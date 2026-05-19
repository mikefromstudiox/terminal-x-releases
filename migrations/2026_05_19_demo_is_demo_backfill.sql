-- 2026_05_19 — Flag 4 demo-named businesses as is_demo=true
--
-- Findings #14 + #15 from inaugural Mega Smoke run.
--   env2.no_demo_is_demo_mismatch: 4 businesses with name 'Demo *' had
--     is_demo=false. Demo-named live rows skew analytics + admin lists.
--   inv.business_has_license_or_is_demo: 'Demo Stress 1 — Inventory'
--     had no license; would have failed the orphan check unless flagged
--     is_demo.
--
-- All 4 were created 2026-05-18 by stress-suite test seeding without
-- setting is_demo. Single UPDATE corrects them. Provisioning code itself
-- doesn't need a patch — these were ad-hoc seeds, not API signups.

BEGIN;

UPDATE public.businesses
   SET is_demo = true, updated_at = now()
 WHERE name IN (
   'Demo Contabilidad — CAR WASH DJ',
   'Demo Stress 1 — Inventory',
   'Demo Stress 2 — Staff Security',
   'Demo Stress 3 — POS Cobro'
 ) AND is_demo = false;

COMMIT;

-- Verify:
--   SELECT count(*) FROM public.businesses WHERE name LIKE 'Demo %' AND is_demo = false;
-- Expected: 0
