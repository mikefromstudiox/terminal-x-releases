-- Phase 3.5 scaling test exposed write contention on the BRIN summary index.
-- BRIN is great for OLAP scans on append-mostly tables, but under sustained
-- burst writes (50+ concurrent businesses inserting simultaneously) the
-- summary-block update path becomes a contention point.
--
-- Swap BRIN → partial B-tree on (business_id, effective_date). B-trees handle
-- hot-append insert patterns better (fastpath rightmost-leaf locking) and
-- still serve date-range Reportes queries well thanks to compound business_id
-- prefix. Read penalty on full-month scans is negligible at our scale.

drop index if exists ix_je_biz_eff_date_brin;

create index if not exists ix_je_biz_eff_date on journal_entries (business_id, effective_date desc);
