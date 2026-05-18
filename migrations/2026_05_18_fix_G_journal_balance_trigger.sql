-- 2026-05-18 Fix G — Reject imbalanced posted journal entries.
CREATE OR REPLACE FUNCTION trg_je_balance_check() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IN ('posted', 'reversed') THEN
    IF ABS(COALESCE(NEW.totals_debit,0) - COALESCE(NEW.totals_credit,0)) > 0.005 THEN
      RAISE EXCEPTION 'journal_entry_imbalanced: debit=% credit=% diff=%',
        NEW.totals_debit, NEW.totals_credit, (NEW.totals_debit - NEW.totals_credit)
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_je_balance_check_ins ON accounting_journal_entries;
DROP TRIGGER IF EXISTS trg_je_balance_check_upd ON accounting_journal_entries;
CREATE TRIGGER trg_je_balance_check_ins
  BEFORE INSERT ON accounting_journal_entries
  FOR EACH ROW EXECUTE FUNCTION trg_je_balance_check();
CREATE TRIGGER trg_je_balance_check_upd
  BEFORE UPDATE ON accounting_journal_entries
  FOR EACH ROW EXECUTE FUNCTION trg_je_balance_check();
