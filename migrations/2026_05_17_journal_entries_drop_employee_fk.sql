-- journal_entries.employee_id is polymorphic: for ticket-derived rows it points
-- at staff.id (POS operator), for commission-derived rows it points at
-- empleados.id (commission recipient — washer/seller/cajero/mechanic).
-- The original FK to staff(id) rejected commission rows during Phase 4 backfill.
-- Drop the FK; keep the column as plain uuid. Source-of-truth lookup is via
-- source_table + source_id pair, not a hard FK on this column.

alter table journal_entries drop constraint if exists journal_entries_employee_id_fkey;
