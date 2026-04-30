-- 2026_04_30 — close the orphan-on-ticket-delete gap.
--
-- Bug: every commission/item/queue row sync-pushed from a desktop ticket lands
-- on Supabase with `ticket_id = NULL` and `ticket_supabase_id = <uuid>`.
-- The pre-existing FKs all point at `tickets.id` (integer), so when a ticket
-- is deleted/voided, cascade only fires on rows where ticket_id is non-null.
-- Synced rows persist as orphans and silently inflate liquidación / reports.
--
-- Fix: add a parallel CASCADE FK on `ticket_supabase_id` for every dependent
-- table, plus the missing FK on `washer_commissions.ticket_id` (which had
-- been omitted entirely — orphans there bypassed cascade in BOTH directions).
--
-- Pre-flight: this migration WILL fail if any orphan rows exist. Sweep them
-- first with the audit query:
--
--   SELECT 'washer'  AS tbl, count(*) FROM washer_commissions  WHERE ticket_supabase_id IS NOT NULL AND ticket_supabase_id NOT IN (SELECT supabase_id FROM tickets WHERE supabase_id IS NOT NULL)
--   UNION ALL
--   SELECT 'seller'        , count(*) FROM seller_commissions  WHERE ticket_supabase_id IS NOT NULL AND ticket_supabase_id NOT IN (SELECT supabase_id FROM tickets WHERE supabase_id IS NOT NULL)
--   UNION ALL
--   SELECT 'cajero'        , count(*) FROM cajero_commissions  WHERE ticket_supabase_id IS NOT NULL AND ticket_supabase_id NOT IN (SELECT supabase_id FROM tickets WHERE supabase_id IS NOT NULL)
--   UNION ALL
--   SELECT 'ticket_items'  , count(*) FROM ticket_items        WHERE ticket_supabase_id IS NOT NULL AND ticket_supabase_id NOT IN (SELECT supabase_id FROM tickets WHERE supabase_id IS NOT NULL)
--   UNION ALL
--   SELECT 'queue'         , count(*) FROM queue               WHERE ticket_supabase_id IS NOT NULL AND ticket_supabase_id NOT IN (SELECT supabase_id FROM tickets WHERE supabase_id IS NOT NULL)
--   UNION ALL
--   SELECT 'ecf_queue'     , count(*) FROM ecf_queue           WHERE ticket_supabase_id IS NOT NULL AND ticket_supabase_id NOT IN (SELECT supabase_id FROM tickets WHERE supabase_id IS NOT NULL);

ALTER TABLE washer_commissions
  ADD CONSTRAINT washer_commissions_ticket_id_fkey
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE;

ALTER TABLE washer_commissions
  ADD CONSTRAINT washer_commissions_ticket_supabase_id_fkey
    FOREIGN KEY (ticket_supabase_id) REFERENCES tickets(supabase_id) ON DELETE CASCADE;

ALTER TABLE seller_commissions
  ADD CONSTRAINT seller_commissions_ticket_supabase_id_fkey
    FOREIGN KEY (ticket_supabase_id) REFERENCES tickets(supabase_id) ON DELETE CASCADE;

ALTER TABLE cajero_commissions
  ADD CONSTRAINT cajero_commissions_ticket_supabase_id_fkey
    FOREIGN KEY (ticket_supabase_id) REFERENCES tickets(supabase_id) ON DELETE CASCADE;

ALTER TABLE ticket_items
  ADD CONSTRAINT ticket_items_ticket_supabase_id_fkey
    FOREIGN KEY (ticket_supabase_id) REFERENCES tickets(supabase_id) ON DELETE CASCADE;

ALTER TABLE queue
  ADD CONSTRAINT queue_ticket_supabase_id_fkey
    FOREIGN KEY (ticket_supabase_id) REFERENCES tickets(supabase_id) ON DELETE CASCADE;

-- ecf_queue: SET NULL to preserve the deferred-submission audit trail when
-- a ticket is voided. The ecf_queue row stays so we still know what was
-- enqueued, but it no longer pretends to belong to a ticket.
ALTER TABLE ecf_queue
  ADD CONSTRAINT ecf_queue_ticket_supabase_id_fkey
    FOREIGN KEY (ticket_supabase_id) REFERENCES tickets(supabase_id) ON DELETE SET NULL;
