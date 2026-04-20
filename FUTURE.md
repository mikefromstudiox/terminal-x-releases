# FUTURE — Terminal X (backlog, attack after core is stable)

## Onboarding (defer)

- **Training manual update** — nueva sección "Primer día del cliente licorería" (setup real, no demo). Incluir flujo de inventario import, configuración de NCF real, test de impresora, enrolar cajeros, set PIN, e-CF walkthrough.
- **Onboarding checklist PDF para el cliente** — paso a paso de lo que necesita traer/decidir antes de la instalación:
  - Inventario actual (Excel/CSV con SKU, barcode, nombre, categoría, precio, costo, stock)
  - Cédulas, salarios y roles de empleados
  - Impresora térmica (modelo, conexión USB o red)
  - Scanner USB
  - PC/laptop (specs mínimas, Windows 10/11)
  - WiFi estable (SSID, password — para pre-configurar Chrome/app)
  - RNC del negocio + certificado Viafirma si ya lo tiene
  - Decisiones: tipo de cajero (cuántos), descuentos permitidos, horarios de turno
- **Migración de inventario** — script que tome CSV del cliente y lo mapee a `inventory_items` con auto-detección de categorías (por keyword matching).
- **Templates de WhatsApp/email** — bienvenida al cliente, recordatorio de pago mensual, alerta de stock bajo, recibo de e-CF con QR.
- **Seed demo "30 días de actividad"** — script que inserta historial ficticio al crear un tenant nuevo para que el admin vea el sistema "vivo" desde día 1 de uso real (no el demo compartido).
- ~~**Backup automático diario**~~ — ✅ SHIPPED v2.12.1: nightly SQLite→Supabase Storage at 3 AM, 14d retention, SQLCipher-aware, manual trigger UI in Sistema → Mi Empresa.

## Done in v2.12.1 (2026-04-20) — moved out of FUTURE

- ✅ SQLCipher SQLite encryption at rest (HKDF/HWID + safeStorage)
- ✅ Sentry telemetry (DSN-gated, PII-scrubbed)
- ✅ Apertura de turno prompt
- ✅ Kiosk idle auto-lock
- ✅ Loyalty tiers Bronce/Plata/Oro
- ✅ Licorería deposit/bottle-return
- ✅ Mecánica WO→ticket bridge
- ✅ Concesionario DealBuilder→CobrarModal+E31 routing
- ✅ Admin License Rebind UI
- ✅ DGII EN_PROCESO reconciler
- ✅ xml-crypto v6 fe receiver port (committed, NOT deployed — needs real DGII XML for testing)
- ✅ Inventory clamp symmetry
- ✅ Cert history audit table
- ✅ Print queue USB retry + banner
- ✅ GitHub: secret scanning + Dependabot + branch protection on main

## Still pending (Tier 0 external deps)

- **EV cert installer signing** — requires procurement (~$300-400/yr DigiCert/Sectigo). Ship after first paying client revenue covers it.
- **pgsodium envelope-encrypt `.p12`** in Supabase — needs operational rollout plan + key rotation runbook before flipping
- **xml-crypto v6 deploy** to fe.terminalxpos.com — gated on a real DGII-signed sample XML to validate the port doesn't break inbound ARECF/ACECF
- **3 HIGH Dependabot alerts** — lodash code injection, xlsx ReDoS, xlsx prototype pollution. Handed to a parallel Claude terminal.
- **CSP `'unsafe-inline'` removal** from style-src — needs nonce middleware (same problem strict-dynamic had on script-src)

## Priority (what we're doing NOW instead)

1. Printing on owner's Studio X Car Wash PC (not printing receipts)
2. Scanning setup on the real POS for the new licorería client
3. Multi-POS real-time (3 atomic RPCs: allocate_ncf, allocate_doc_number, deduct_inventory) — so 2 POS + admin PC work simultaneously at the licorería without NCF collisions or stock negatives
4. Offline login on desktop (agent in progress)
5. Network diagnostic panel (agent in progress)
6. Retry + humanized errors (agent in progress)

## Revisit date

After the licorería client is fully installed and operating for 2+ weeks. Re-read this file then.

---

## Plan-Gating Catalog (what we can sell)

Running list of features worth gating by plan. Whether we land the licorería client or not, this is the product roadmap that turns Terminal X into a real multi-tier SaaS. Update this as we build.

### Pro MAX exclusives (RD$6,990/mo)
- **Multi-POS simultáneo** — 2+ POS desktop + admin web en el mismo negocio, con NCF/doc_number/inventory sincronizados en tiempo real. Pro y Pro PLUS = 1 POS. Pro MAX = ilimitado.
  - Feature flag: `multi_pos_enabled`
  - Upsell trigger: owner intenta instalar segundo POS → modal "Necesitas Pro MAX para multi-POS".
- **Oversell detection + reconciliation** — detección de ventas simultáneas que dejan stock en negativo, con workflow del dueño para resolver. Solo útil en multi-POS.
- **Dashboard remoto multi-sucursal** — ver ventas de varias licorerías/carwashes en un solo admin. Requiere el backend de blocks ya diseñado para multi-device.
- **Backup automático diario a R2** — snapshot cada 24h a Cloudflare R2 del cliente. Disaster recovery real.
- **Kiosk fullscreen mode** — ya existe, mover detrás de Pro MAX.
- **Comisiones avanzadas** — por categoría de producto, por hora del día, por sucursal.
- **Nómina avanzada** — ley 16-92 completa, liquidaciones auto, retenciones ISR escalonadas. (Pro PLUS ya tiene básica.)
- **Soporte prioritario** — respuesta WhatsApp < 1h en horario laboral + noches + fin de semana.

### Pro PLUS exclusives (RD$4,490/mo)
- **e-CF directo a DGII** — ya está. No tocar.
- **Inventario con alertas de stock bajo** — ya está.
- **Créditos + Notas de Crédito** — ya está.
- **Importar CSV masivo** — ya está.
- **Dashboard remoto (1 sucursal)** — solo la suya. Multi-sucursal es Pro MAX.
- **Diagnóstico de red** — panel que acabamos de construir. Gratis por ahora, considerar gate si uso excede.

### Pro base (RD$2,490/mo)
- POS completo
- NCF B01/B02 paper
- Viafirma incluido (upsell a Pro PLUS para emitir e-CF real)
- 1 POS device
- Reportes básicos diario/mensual
- Cuadre de Caja + Caja Chica

### Plan-bump triggers (cuándo empujar al siguiente plan)
- Pro → Pro PLUS: intenta configurar e-CF, agrega 5to empleado con comisión, tiene >100 productos.
- Pro PLUS → Pro MAX: intenta instalar 2do POS, pide multi-sucursal, pide backups automáticos.

### Feature flag implementation pattern
- Each gateable feature has a key in `PLAN_FEATURES` (`packages/ui/context/PlanContext.jsx` or similar).
- Desktop AND web check `plan.features.includes('multi_pos')` before showing UI.
- Dev override forces pro_max (already in code per CLAUDE.md).
- Remote config (`validate.js`) returns feature set from Supabase `plans` table — Mike can bump a feature to a lower plan without releasing code.

### Add-ons / one-time services (on top of monthly)
- **Certificación e-CF Completa** — RD$45,000 one-time.
- **Completa + Terminal X** — RD$55,000 one-time (incluye 3 meses Pro MAX gratis).
- **Asesoría e-CF** — RD$15,000 one-time.
- **Instalación en sitio** — RD$5,000-10,000 según ciudad.
- **Training presencial 4 horas** — RD$8,000.
- **Migración de inventario** (si tienen Excel/Siigo/STARSISA) — RD$3,000.
- **Setup multi-sucursal** — RD$15,000 por sucursal adicional.

## Why we're doing this even if we lose the client

Every feature we build here makes Terminal X a REAL distributed POS platform — not a demo, not a solo-shop tool. This is what separates Terminal X from STARSISA/Siigo/Alegra in the DR market. The licorería client is the forcing function; the code survives regardless.

- Multi-POS distributed architecture → sellable to every DR business with 2+ terminals (restaurants, pharmacies, supermercados).
- Offline-first block allocation → sellable as "funciona sin internet" (huge in DR interior).
- Oversell detection → sellable as "nunca más descuadres con tus empleados".
- Diagnostic panel → reduces support calls, reduces churn.

