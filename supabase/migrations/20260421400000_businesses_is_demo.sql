-- v2.14 admin isolation: flag demo seed accounts so admin queries can hide them
-- by default without depending on email-pattern LIKEs at read time.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_businesses_is_demo ON businesses(is_demo) WHERE is_demo = false;

UPDATE businesses
   SET is_demo = true
 WHERE email LIKE 'admin@%.demo.terminalxpos.com'
   AND is_demo = false;
