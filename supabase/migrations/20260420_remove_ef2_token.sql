-- Remove dead ef2_token placeholder from businesses.settings JSONB.
-- ef2_token was introduced during early ef2.do exploration and never wired in production.
-- This migration strips the key from existing rows. Idempotent, non-destructive —
-- other keys inside settings are preserved. No schema columns are dropped.

UPDATE businesses
SET settings = settings - 'ef2_token'
WHERE settings ? 'ef2_token';
