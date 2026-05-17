-- Phase 3.5 scaling test surfaced two missing FK indexes on journal_entries.
-- Without these, FK-cascade DELETEs (e.g. business deletion) and void/refund
-- lookups by reversal_of_id had to seq-scan the full ledger, timing out on
-- moderate-volume businesses. Applied ad-hoc during the scaling test cleanup;
-- this migration lands them in source for fresh installs + future replays.
--
-- Partial indexes (WHERE ... is not null) because the vast majority of journal
-- rows have NULL on both columns — only void/refund rows fill them. Partial
-- index = smaller, faster, fewer write writes on insert.

create index if not exists ix_je_reversal_of_id  on journal_entries (reversal_of_id)  where reversal_of_id  is not null;
create index if not exists ix_je_reversed_by_id  on journal_entries (reversed_by_id)  where reversed_by_id  is not null;
