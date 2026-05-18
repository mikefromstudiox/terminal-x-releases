-- 2026-05-18 Fixes T + AA + inbox confidence range — misc DB CHECKs.
ALTER TABLE staff ADD CONSTRAINT chk_staff_username_not_blank CHECK (length(trim(username)) > 0) NOT VALID;
ALTER TABLE accounting_journal_lines ADD CONSTRAINT chk_je_line_debit_xor_credit
  CHECK (NOT (COALESCE(debit,0) > 0 AND COALESCE(credit,0) > 0)) NOT VALID;
ALTER TABLE accounting_inbox ADD CONSTRAINT chk_inbox_confidence_range
  CHECK (classification_confidence >= 0 AND classification_confidence <= 1) NOT VALID;
