-- Anticipos ISR (PJ) — extiende accounting_clients con los datos del IR-2 del
-- año anterior necesarios para calcular la cuota mensual (Art. 314 CT).
-- Idempotente: seguro re-correr vía Supabase Management API.

ALTER TABLE public.accounting_clients
  ADD COLUMN IF NOT EXISTS anticipo_ingresos_brutos_previos NUMERIC(16,2) NOT NULL DEFAULT 0;

ALTER TABLE public.accounting_clients
  ADD COLUMN IF NOT EXISTS anticipo_isr_previo NUMERIC(16,2) NOT NULL DEFAULT 0;

ALTER TABLE public.accounting_clients
  ADD COLUMN IF NOT EXISTS anticipo_had_loss SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE public.accounting_clients
  ADD COLUMN IF NOT EXISTS anticipo_base_year INT;

COMMENT ON COLUMN public.accounting_clients.anticipo_ingresos_brutos_previos IS 'IR-2 año anterior — ingresos brutos para método 1 (1.5% TET). Art. 314 CT.';
COMMENT ON COLUMN public.accounting_clients.anticipo_isr_previo               IS 'IR-2 año anterior — ISR liquidado para método 2.';
COMMENT ON COLUMN public.accounting_clients.anticipo_had_loss                  IS '1 = año anterior cerró en pérdida fiscal → anticipo = 0.';
COMMENT ON COLUMN public.accounting_clients.anticipo_base_year                 IS 'Año fiscal del IR-2 base usado para calcular el anticipo del año en curso.';
