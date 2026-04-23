-- Kill sha256 drift at the Supabase level.
-- Any future INSERT into staff that omits pin_hash_algo will now default to
-- 'bcrypt' instead of 'sha256'. The verify path still accepts legacy sha256
-- rows (auto-upgrades on first successful login per 20260420400000 migration)
-- but nothing NEW can be born as sha256.

ALTER TABLE public.staff ALTER COLUMN pin_hash_algo SET DEFAULT 'bcrypt';

-- Belt-and-suspenders: backfill any NULL algos by detecting the hash format.
-- 60-char strings starting with '$2' are bcrypt; 64-char lowercase hex are sha256.
UPDATE public.staff
   SET pin_hash_algo = 'bcrypt'
 WHERE pin_hash_algo IS NULL
   AND pin_hash LIKE '$2%'
   AND length(pin_hash) = 60;

UPDATE public.staff
   SET pin_hash_algo = 'sha256'
 WHERE pin_hash_algo IS NULL
   AND length(pin_hash) = 64
   AND pin_hash ~ '^[0-9a-f]{64}$';
