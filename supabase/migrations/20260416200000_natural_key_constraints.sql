-- Natural key constraints on entity tables.
-- Prevents duplicate entities on Supabase regardless of supabase_id.
-- Uses (business_id, name/nombre) as the natural identity.

CREATE UNIQUE INDEX IF NOT EXISTS uq_services_natural ON services(business_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_categorias_natural ON categorias_servicio(business_id, nombre);
CREATE UNIQUE INDEX IF NOT EXISTS uq_washers_natural ON washers(business_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sellers_natural ON sellers(business_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_empleados_natural ON empleados(business_id, nombre);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_natural ON inventory_items(business_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mesas_natural ON mesas(business_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_modificadores_natural ON modificadores(business_id, name, group_name);
