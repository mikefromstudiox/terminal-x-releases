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

-- The view must expose auth_user_id + seller_id before the rule can
-- reference NEW.auth_user_id / NEW.seller_id. Existing view doesn't include
-- them, so redefine it here first (idempotent CREATE OR REPLACE).
-- CREATE OR REPLACE VIEW can only APPEND columns, not reorder. Preserve the
-- existing column order and add auth_user_id at the end.
-- Match the existing public users VIEW column order exactly, append auth_user_id.
-- Existing order: id, business_id, name, username, pin_hash, role,
-- discount_pct, commission_pct, cedula, start_date, employee_id, active,
-- created_at, updated_at, supabase_id.
CREATE OR REPLACE VIEW users AS
  SELECT id, business_id, name, username, pin_hash, role,
         discount_pct, commission_pct, cedula, start_date,
         employee_id, active, created_at, updated_at, supabase_id,
         auth_user_id
    FROM staff;

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
    active         = NEW.active,
    supabase_id    = NEW.supabase_id,
    cedula         = NEW.cedula,
    start_date     = NEW.start_date,
    employee_id    = NEW.employee_id,
    created_at     = NEW.created_at,
    updated_at     = NEW.updated_at
  WHERE staff.id = OLD.id
  RETURNING staff.id, staff.business_id, staff.name, staff.username, staff.pin_hash,
            staff.role, staff.discount_pct, staff.commission_pct, staff.cedula,
            staff.start_date, staff.employee_id, staff.active, staff.created_at,
            staff.updated_at, staff.supabase_id, staff.auth_user_id;
