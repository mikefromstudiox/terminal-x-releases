-- Phase 4 — SaaS business_type_configs registry (Supabase-authoritative
-- with the hardcoded packages/config/businessTypes.js as offline fallback).

CREATE TABLE IF NOT EXISTS business_type_configs (
  type         TEXT PRIMARY KEY,
  label_es     TEXT NOT NULL,
  label_en     TEXT NOT NULL,
  description_es TEXT,
  description_en TEXT,
  icon         TEXT,
  modules      JSONB NOT NULL DEFAULT '[]'::jsonb,
  ui           JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled      BOOLEAN NOT NULL DEFAULT true,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Public read — every authenticated user can fetch the registry.
-- No INSERT/UPDATE/DELETE policies; ops-only writes via service role.
ALTER TABLE business_type_configs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "btc_select" ON business_type_configs;
CREATE POLICY "btc_select" ON business_type_configs FOR SELECT USING (true);

-- Seed rows (idempotent via ON CONFLICT)
INSERT INTO business_type_configs (type, label_es, label_en, description_es, description_en, icon, modules, ui, enabled)
VALUES
  ('carwash',    'Car Wash',            'Car Wash',            'Lavado de vehículos, detailing, servicios automotrices.', 'Vehicle washing, detailing, automotive services.', 'Car',             '["queue","washers","service_grid","commissions"]'::jsonb,                                                                     '{"showTableMap":false,"enableKDS":false,"showRetailCart":false,"showServiceGrid":true,"showInventory":false,"posSegmentToggle":false}'::jsonb, true),
  ('retail',     'Tienda / Retail',      'Store / Retail',      'Venta de productos con inventario, SKU y código de barras.', 'Product sales with inventory, SKU, and barcode support.', 'Store',   '["inventory","barcode","cart"]'::jsonb,                                                                                         '{"showTableMap":false,"enableKDS":false,"showRetailCart":true,"showServiceGrid":false,"showInventory":true,"posSegmentToggle":false}'::jsonb, true),
  ('service',    'Servicios',            'Services',            'Servicios profesionales, salón, taller, consultoría.',     'Professional services, salon, workshop, consulting.', 'Briefcase','["service_grid"]'::jsonb,                                                                                                     '{"showTableMap":false,"enableKDS":false,"showRetailCart":false,"showServiceGrid":true,"showInventory":false,"posSegmentToggle":false}'::jsonb, true),
  ('restaurant', 'Restaurante / Bar',    'Restaurant / Bar',    'Restaurantes, bares, cafeterías. Mesas, menú, KDS, propinas.', 'Restaurants, bars, cafés. Tables, menu, KDS, tips.', 'UtensilsCrossed','["tables","menu","modifiers","kds","split_pay","multi_printer","tip","commissions"]'::jsonb,                     '{"showTableMap":true,"enableKDS":true,"showRetailCart":false,"showServiceGrid":false,"showInventory":true,"posSegmentToggle":false,"fulfillmentDefault":"dine_in"}'::jsonb, true),
  ('dealership', 'Dealership',           'Dealership',          'Venta de vehículos, con inventario de unidades.',           'Vehicle sales with unit inventory.',                 'CarFront', '["inventory","barcode"]'::jsonb,                                                                                                '{"showTableMap":false,"enableKDS":false,"showRetailCart":true,"showServiceGrid":false,"showInventory":true,"posSegmentToggle":false}'::jsonb, false),
  ('hybrid',     'Híbrido',              'Hybrid',              'Combinación — ej: restaurante con tienda de merch.',        'Combination — e.g. restaurant with merch store.',   'LayoutGrid','["tables","menu","modifiers","kds","split_pay","multi_printer","tip","inventory","barcode","cart","commissions"]'::jsonb, '{"showTableMap":true,"enableKDS":true,"showRetailCart":true,"showServiceGrid":false,"showInventory":true,"posSegmentToggle":true,"fulfillmentDefault":"dine_in"}'::jsonb, true)
ON CONFLICT (type) DO UPDATE SET
  label_es       = EXCLUDED.label_es,
  label_en       = EXCLUDED.label_en,
  description_es = EXCLUDED.description_es,
  description_en = EXCLUDED.description_en,
  icon           = EXCLUDED.icon,
  modules        = EXCLUDED.modules,
  ui             = EXCLUDED.ui,
  enabled        = EXCLUDED.enabled,
  updated_at     = now();
