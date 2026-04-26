-- Terminal X v2.16.2 (item #15) — explicit vertical discriminator on the
-- shared `memberships` table. Up to v2.16.1 salon and carwash rows lived in
-- the same table and were distinguished by which nullable columns were set
-- (`total_sessions IS NOT NULL` for salon, `wash_quota_per_month` set for
-- carwash). A mis-typed row would silently bleed into the wrong vertical's
-- catalog; this migration adds an explicit column + CHECK so future filters
-- become unambiguous.

ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS vertical TEXT
    CHECK (vertical IN ('salon','carwash'));

-- Backfill existing rows. Salon templates are characterised by an active
-- session-based template (the v2.16.1 shape). Carwash rows are the legacy
-- subscription rows with a wash quota.
UPDATE memberships
   SET vertical = 'salon'
 WHERE vertical IS NULL
   AND total_sessions IS NOT NULL
   AND COALESCE(active_template, true) = true;

UPDATE memberships
   SET vertical = 'carwash'
 WHERE vertical IS NULL
   AND wash_quota_per_month IS NOT NULL;

CREATE INDEX IF NOT EXISTS memberships_biz_vertical_idx
  ON memberships (business_id, vertical);
