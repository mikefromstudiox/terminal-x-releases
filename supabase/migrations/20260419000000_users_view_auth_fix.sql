-- ============================================================================
-- 20260419000000_users_view_auth_fix.sql
-- Fix: desktop sync pushes `users` rows WITHOUT `auth_user_id`. The rule
-- installed in 20260416300000_sync_parity_fixes.sql wrote NEW.auth_user_id
-- verbatim, which nulls the column for every staff row that already had an
-- auth link (web logins break on next sync round).
--
-- Fix: COALESCE(NEW.auth_user_id, OLD.auth_user_id) so desktop pushes only
-- overwrite auth_user_id when they explicitly send a non-null value.
-- ============================================================================

CREATE OR REPLACE RULE users_update AS ON UPDATE TO users
  DO INSTEAD UPDATE staff SET
    business_id    = NEW.business_id,
    auth_user_id   = COALESCE(NEW.auth_user_id, OLD.auth_user_id),
    name           = NEW.name,
    username       = NEW.username,
    pin_hash       = NEW.pin_hash,
    role           = NEW.role,
    discount_pct   = NEW.discount_pct,
    commission_pct = NEW.commission_pct,
    seller_id      = NEW.seller_id,
    active         = NEW.active,
    supabase_id    = NEW.supabase_id,
    cedula         = NEW.cedula,
    start_date     = NEW.start_date,
    employee_id    = NEW.employee_id,
    created_at     = NEW.created_at,
    updated_at     = NEW.updated_at
  WHERE staff.id = OLD.id RETURNING *;
