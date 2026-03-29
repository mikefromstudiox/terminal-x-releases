-- Update plan pricing and display names to match finalized tiers
-- Pro RD$2,490/mes, Pro PLUS RD$4,490/mes, Pro MAX RD$6,990/mes
-- Annual = 15% off (x12 x 0.85)

-- Remove free tier (no free tier per business decision)
DELETE FROM plans WHERE name = 'free' AND NOT EXISTS (SELECT 1 FROM licenses WHERE plan_id = plans.id);

-- Update Pro
UPDATE plans SET
  display_name  = 'Pro',
  price_monthly = 2490,
  price_yearly  = 25398,
  max_users     = 2,
  features      = '["pos","queue","clients","credits","reports","petty_cash","credit_notes","cash_recon","ncf_b"]'::jsonb
WHERE name = 'pro';

-- Update Pro PLUS
UPDATE plans SET
  display_name  = 'Pro PLUS',
  price_monthly = 4490,
  price_yearly  = 45798,
  max_users     = 5,
  features      = '["pos","queue","clients","credits","reports","petty_cash","credit_notes","cash_recon","ncf_b","ecf","dgii","inventory","commissions"]'::jsonb
WHERE name = 'pro_plus';

-- Update Pro MAX
UPDATE plans SET
  display_name  = 'Pro MAX',
  price_monthly = 6990,
  price_yearly  = 71298,
  max_users     = 999,
  features      = '["pos","queue","clients","credits","reports","petty_cash","credit_notes","cash_recon","ncf_b","ecf","dgii","inventory","commissions","remote_dashboard","whatsapp_receipts"]'::jsonb
WHERE name = 'pro_max';
