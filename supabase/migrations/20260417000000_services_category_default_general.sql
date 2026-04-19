-- Change services.category default from 'Lavado' to 'General'.
-- Existing rows are untouched; the data-cleanup script handles legacy rows
-- that were inserted without an explicit category under the old default.
ALTER TABLE services ALTER COLUMN category SET DEFAULT 'General';
