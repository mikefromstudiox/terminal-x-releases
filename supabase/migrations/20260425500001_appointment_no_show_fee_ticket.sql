-- Terminal X v2.16.3 — voidNoShowFee join key
-- Adds the direct link from an appointment to the no-show fee ticket
-- (E32 charged at no-show time). The void helper resolves the original
-- e-CF in O(1) via this column instead of scanning tickets by date.
--
-- Backfill: NULL until next no-show fee is charged. handleNoShowCobrarConfirm
-- in packages/ui/screens/salon/Appointments.jsx stamps it on charge.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS no_show_fee_ticket_supabase_id UUID;

CREATE INDEX IF NOT EXISTS appointments_no_show_fee_ticket_idx
  ON appointments (no_show_fee_ticket_supabase_id)
  WHERE no_show_fee_ticket_supabase_id IS NOT NULL;
