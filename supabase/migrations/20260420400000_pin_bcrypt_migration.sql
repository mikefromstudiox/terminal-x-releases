-- 20260420400000_pin_bcrypt_migration.sql
-- Sprint 10 — PIN security hardening (S-H4/H5/H6)
--
-- Context: staff.pin_hash is an unsalted SHA-256 of a 4-6 digit PIN. The entire
-- keyspace (10_000 + 100_000 + 1_000_000 = 1.11M candidates) collapses to a
-- precomputed rainbow table in milliseconds if the DB is ever exfiltrated, and
-- rows across installs hash identically — one leaked PIN → every client hit.
--
-- This migration adds the columns needed for a bcrypt-with-per-row-salt
-- upgrade. The app code (electron/database.js + packages/data/web.js) detects
-- `pin_hash_algo='sha256'` rows, accepts the legacy hash on the next login,
-- then rewrites the row in place with a bcrypt hash and flips the algo flag.
--
-- Lockout: pin_failed_attempts counts consecutive wrong guesses per row.
-- Hitting 5 sets pin_locked_until = now() + 5 minutes. A successful login
-- resets both to zero.
--
-- Safe to run against prod: every column has a default or NULL, no backfill
-- required. Legacy rows continue to authenticate until first successful login.

BEGIN;

ALTER TABLE staff ADD COLUMN IF NOT EXISTS pin_hash_algo       TEXT    DEFAULT 'sha256';
ALTER TABLE staff ADD COLUMN IF NOT EXISTS pin_salt             TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS pin_failed_attempts  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS pin_locked_until     TIMESTAMPTZ;

-- Any existing row that lacks the flag is legacy SHA-256. Normalise so the
-- app's algo dispatch never has to treat NULL as a special case.
UPDATE staff SET pin_hash_algo = 'sha256' WHERE pin_hash_algo IS NULL;

COMMIT;
