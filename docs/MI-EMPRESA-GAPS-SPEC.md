# Mi Empresa & Sistema → Preferencias — Customization Gaps Spec

**File:** `A:\Studio X HUB\Terminal X\docs\MI-EMPRESA-GAPS-SPEC.md`
**Owner:** Mike (XGH SRL)
**Audience:** implementer (desktop Claude / web Claude)
**Status:** Spec only — no code in this doc. Becomes the implementation backlog for v2.16.27 and v2.17.0.
**Brand rules:** black, white, `#b3001e` crimson only — no gray. All UI strings es-DO. Mobile-first. No fake data, no placeholder content. WhatsApp `+18098282971` is the support CTA when something blocks the flow.

---

## 0 — Why this spec exists

Terminal X is being resold across 7 verticals (carwash, tienda + 8 subtypes, restaurant, salon/barbería, mecánica, concesionario, carniceria) plus loan-shop (préstamos) add-on. Every vertical has a different "knob" the owner wants to flip without calling support: deposit amount, public-booking slug, fiscal mode, receipt footer, hidden POS tabs, etc.

A previous audit identified 13 customization keys that are present in `app_settings` and/or the cloud-sync whitelist but have **no UI control** today, or whose UI is half-built and confusing. The result: clients call WhatsApp for things that should be self-serve, and resold deployments require Mike to SSH/SQL settings into place by hand.

This spec ranks those gaps by client impact, defines the exact UI to build for each, defines validation + plan-gating + Spanish copy, and tells the implementer which 3 ship as a fast v2.16.27 batch and which need a design pass first.

---

## A. Executive priority list

Ranked by client-facing impact, not by code effort. Top items convert/retain customers and stop Mike's WhatsApp from buzzing. Lower items are polish.

| # | Gap | Why it ranks here |
|---|---|---|
| 1 | **`fiscal_mode` toggle in Mi Empresa** (E-series vs B-series) | Single biggest fiscal lever. Currently buried behind a 3-click NCF Sequences tab + relies on the user understanding ecf-vs-legacy. Wrong default = wrong NCF on the first sale = client loses trust on day one. **Critical.** |
| 2 | **Receipt branding: `invoice_footer` + `logo_url`** | Every client in their first onboarding hour asks "cómo le pongo mi pie de página al recibo." Used by Facturación v2.16.5 PDFs and by ESC/POS receipt builder, but no editor — keys are written by hand by Mike during install. **High retention impact.** |
| 3 | **`biz_email` + `biz_website` in Mi Empresa form** | Already in the cloud-sync whitelist, already rendered on receipts and on Facturación PDFs when present, but the Mi Empresa form has no inputs. Owners enter address/phone/RNC and assume email/website come from somewhere else. **Easy win.** |
| 4 | **`mgr_gate_*` whitelist verification + UI completeness** | The Toggles exist in Sistema → Preferencias but several mgr_gate_* keys are not in `BUSINESS_SETTING_KEYS` — silent failure: owner flips it, sync drops it as "rogue device key in business slot," other registers never see the change. **Silent data loss.** |
| 5 | **Salon: `salon_require_deposit` / `salon_deposit_amount_dop` / `salon_no_show_fee_dop` form polish** | Form exists in `SalonSettings` but the field copy is unclear and there is no "what does this do" hint. Salons are paying clients today; getting deposits right = revenue protection. |
| 6 | **`salon_public_booking_slug` editable** | Salons want a pretty URL (`/book/laisla` not `/book/abc-123`). Currently auto-generated and locked. Two-line text input + uniqueness check unblocks every barber shop. |
| 7 | **`mechanic_tow_fee_default` exposure** | Already wired in Sistema for `isMechanic`, but the field is not present for hybrid (e.g. carwash + mecánica) businesses. Add to hybrid path. Lower priority. |
| 8 | **`feature_mamajuana_tracking_enabled` / `feature_serial_number_tracking_enabled` toggles** | Subtype-level features that today only flip via SQL. Add to BusinessFeatureToggles section in MiEmpresa. Low priority but completes the per-business override story. |

**Excluded from priority list (intentionally):**
- `pos_tab_order` / `pos_tab_hidden` — power-user feature, design-first, ships in v2.17.x.
- `tienda_subtype` re-pivot — destructive, see Anti-Patterns §D.
- `hybrid_components` re-pivot — same destructive concerns as subtype.
- `default_form_pago` — cashier preference, lives in Sistema (device-local, already present in `DEVICE_LOCAL_CLOUD_MIRROR_KEYS`); no Mi Empresa UI needed.

---

## B. Per-gap spec

For each priority item: setting key, schema location, UI placement, control type, defaults, plan-gate, validation, desktop+web scope, rationale, Spanish copy.

---

### B.1 — `fiscal_mode` toggle in Mi Empresa (PRIORITY 1)

**Setting key:** `fiscal_mode` (canonical) — values `'ecf'` | `'legacy'`. Sister key `facturacion_mode` is already in the whitelist as a forward-compat alias; spec uses `fiscal_mode` as the writer and treats `facturacion_mode` as a read-only mirror until v2.17 cleanup.

**Schema location:**
- Whitelist: `packages/services/settingsWhitelist.js` line 69 + `electron/settingsWhitelist.js` line 71. Already present, already cloud-synced. **No whitelist change needed.**
- Read sites: Admin.jsx line 1157 (FiscalNCF tab loads it), CobrarModal NCF-default selector, web invoicing.
- Default: `'ecf'` for businesses provisioned after 2026-04-01 (post-DGII-cert era). `'legacy'` for older trial accounts. Owner toggles on demand.

**Where the new UI control should sit:**
- File: `packages/ui/screens/Admin.jsx`, inside `MiEmpresa()` component (currently lines 1732-1970).
- New section: insert a NEW `<CollapsibleSection>` directly above the existing `Fiscal / NCF` collapsible (line 1946) titled **"Modo de Comprobantes"**.
- Reason it does NOT belong inside the existing `FiscalNCF` collapsible: that one is a power-user tab (NCF sequences, .p12 cert install, ANECF). The fiscal_mode flip needs to be visible to non-technical owners on first open.

**Control type:** segmented toggle (two crimson pill buttons, white text on selected, white background + crimson border on unselected). NO dropdown — toggle reads faster on mobile. NO checkbox — too ambiguous.

**Default value + valid options:**
- Default: `'ecf'` (E-series Comprobantes Fiscales Electrónicos).
- Valid options: `'ecf'` | `'legacy'`.
- No third value. No empty state — defaults to `'ecf'` if app_settings row is missing.

**Plan-gate:** None directly. ECF feature is gated to Pro PLUS / Pro MAX in `usePlan().hasFeature('ecf')`, but the toggle itself MUST be visible on every plan — Pro clients flipping to `'legacy'` is the supported path for businesses still on B01/B02.
- If the user is on Pro and tries to switch to `'ecf'`, show an upgrade-hook modal pointing at `/admin#plan` instead of saving.

**Validation rules:**
- Flipping `'ecf' → 'legacy'` requires a confirm modal: *"Esto cambiará todos los comprobantes nuevos a NCF B01/B02. Los e-CF emitidos previamente quedan intactos. ¿Continuar?"*
- Flipping `'legacy' → 'ecf'` requires:
  1. Cert installed (read `dgii.certInfo()` — if false, redirect to FiscalNCF tab with toast "Instala el certificado .p12 antes de activar e-CF.").
  2. RNC populated and 9 digits.
  3. NCF sequences with `type IN ('E31','E32','E33','E34')` exist with `enabled=1`.
- On save: write `fiscal_mode` AND mirror to `facturacion_mode` for the v2.17 read-side compat window.
- Emit `activity_log` row: `event_type='fiscal_mode_change'`, severity `critical`, `old_value` / `new_value`, actor from `setActiveUser`.

**Desktop + web scope:** **Both.** Desktop CobrarModal reads it for NCF-default selection; web invoicing reads it for the same purpose. Single source of truth = cloud-synced `app_settings.fiscal_mode`. No separate web-only path.

**Rationale (one paragraph):**
The fiscal_mode flip is the single most consequential setting in the app — it determines whether the next sale prints a paper-only NCF or generates a signed XML e-CF and submits it to DGII. Today the only way to flip it is to open Mi Empresa → Fiscal/NCF (collapsed by default), scroll past three e-CF sub-panels, and click a tiny segmented control next to "Modo de comprobantes." Half the trial signups never find it and end up issuing B01s when they meant to issue E31s. Promoting it to a dedicated top-of-form section in Mi Empresa with a confirm modal cuts onboarding support tickets in half and removes the only setting that requires an SSH session to fix when wrong.

**Sample Spanish copy:**
- Section title: **"Modo de Comprobantes"**
- Helper text under title: *"Define qué tipo de factura emite tu negocio por defecto. Cámbialo en cualquier momento — no afecta facturas ya emitidas."*
- Pill labels: **"Comprobante Electrónico (e-CF)"** / **"NCF Tradicional (B01/B02)"**
- Hint line under each pill (only show on the selected one):
  - e-CF: *"Recomendado. Se firma y envía a DGII automáticamente. Cumple con la Ley 32-23 (obligatorio desde mayo 2026)."*
  - legacy: *"Solo papel. No firma electrónica. Asegúrate de que tu RNC tenga secuencias B01/B02 vigentes."*
- Confirm modal (e-CF → legacy):
  - Title: *"¿Cambiar a NCF tradicional?"*
  - Body: *"Esto cambia todos los comprobantes nuevos a NCF B01/B02 en papel. Los e-CF que ya emitiste quedan intactos en DGII. Esta acción se registra en el historial de actividad."*
  - Buttons: **"Cancelar"** / **"Sí, cambiar a NCF"** (crimson)

---

### B.2 — Receipt branding: `invoice_footer` + `logo_url` (PRIORITY 2)

**Setting keys:** `invoice_footer` (string), `logo_url` (string URL OR data URL). Already cloud-synced.

**Schema location:**
- Whitelist: `packages/services/settingsWhitelist.js` lines 22-23, `electron/settingsWhitelist.js` lines 25-26. **No whitelist change needed.**
- Read sites: Facturación v2.16.5 PDF builder (`packages/services/pdf.js`), ESC/POS receipt builder (`packages/services/printer.js`), web Invoicing.

**Where the new UI control should sit:**
- File: `packages/ui/screens/Admin.jsx`, inside `MiEmpresa()`.
- Insertion point: directly under the existing "Logo del Negocio" block (line 1849-1869) — that block today only writes `businesses.logo` (the local DB column). The new block writes `logo_url` (the cloud-synced setting used by Facturación PDFs). Co-locate them under a single header **"Marca y Recibos"** so the user understands they are two different image targets.
- Add a third field below: **"Pie de página de recibos / facturas"** — multiline textarea, 2 rows.

**Control types:**
1. `logo_url` — image upload (re-use `handleLogoFile` pattern at line 1774-1782). Convert to data URL OR upload to Supabase Storage `business-assets/logos/{business_id}.png` if file > 100KB. Max 500 KB. Accept PNG/JPG/SVG (SVG only when uploading direct URL; data URLs from `<input type=file>` stay PNG/JPG only — SVG sanitization is out of scope for v2.16.27).
2. `invoice_footer` — `<textarea>`, rows=2, maxLength=180. Plain text only (newlines OK, no HTML).

**Default values + valid range:**
- `logo_url`: empty (falls back to `businesses.logo` thumbnail used on ESC/POS receipts).
- `invoice_footer`: empty. Suggested examples shown as placeholder: *"Gracias por su preferencia. Garantía válida con esta factura."*
- Validation: 0-180 chars. Strip leading/trailing whitespace. Replace `\r\n` with `\n`.

**Plan-gate:**
- `invoice_footer`: available on every plan.
- `logo_url` (Facturación-tier branding on PDFs): Pro PLUS or higher. Pro clients see the input but with a lock badge and an upgrade hook ("Disponible en Pro PLUS — actualiza tu plan").
- ESC/POS receipts always render the local `businesses.logo` regardless of plan — so Pro clients still get a logo on their thermal print.

**Validation rules:**
- File size > 500 KB → toast error in es-DO: *"El logo no debe superar 500 KB. Comprime la imagen e intenta de nuevo."*
- Footer > 180 chars → live char counter turns crimson, save button disabled.
- No backend rejection of unicode emoji in footer (clients legitimately use ★ or ✓).

**Desktop + web scope:** **Both.** Desktop is the primary editor (Mi Empresa lives in Admin which is identical between desktop and web Vercel build); web Vercel deploy reads through the same `api.settings.update` path.

**Rationale:**
The Facturación tier (RD$2,490+) was sold partly on "tu marca en cada factura PDF." Today that promise is half-kept: the PDF builder reads `logo_url` and `invoice_footer`, but there is no UI to set them — Mike has been hand-pasting URLs into Supabase via `app_settings` on every new client. Surfacing both inputs inside Mi Empresa under a single "Marca y Recibos" header eliminates 100% of that manual work and unlocks the upsell path: a Pro user sees the locked field, clicks the upgrade hook, lands on `/admin#plan`. Two inputs and a textarea — highest ratio of conversion impact to engineering effort in this entire spec.

**Sample Spanish copy:**
- Section title: **"Marca y Recibos"**
- Sub-helper: *"El logo aparece en facturas PDF y en el ticket impreso. El pie de página solo en facturas PDF."*
- Field label (logo_url): **"Logo para facturas PDF (Pro PLUS)"**
- Field hint: *"PNG o JPG, fondo transparente recomendado. Máx. 500 KB. Se renderiza arriba en la franja crimson."*
- Field label (invoice_footer): **"Pie de página de la factura"**
- Field hint: *"Hasta 180 caracteres. Aparece debajo de los totales en cada factura PDF."*
- Placeholder: *"Gracias por su preferencia. Garantía válida con esta factura."*

---

### B.3 — `biz_email` + `biz_website` in Mi Empresa form (PRIORITY 3)

**Setting keys:** `biz_email`, `biz_website`. Already cloud-synced.

**Schema location:**
- Whitelist: both at line 15 of `packages/services/settingsWhitelist.js` and line 19 of `electron/settingsWhitelist.js`. **No whitelist change needed.**
- Storage: written into `businesses.settings` JSON blob (same pattern as `biz_address` / `biz_city`).
- Read sites: ESC/POS header builder optionally renders email/website if non-empty; Facturación PDF header renders both.

**Where the UI sits:**
- File: `packages/ui/screens/Admin.jsx`, inside `MiEmpresa()`, in the `fields` array at line 1825-1831. Append two more entries.

**Control types:** plain `<input type="email">` and `<input type="url">`.

**Defaults + validation:**
- Default: empty.
- `biz_email` validation: must match `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` if non-empty.
- `biz_website` validation: if non-empty and missing scheme, prepend `https://` on save. Reject if not URL-shaped.
- Both fields are optional.

**Plan-gate:** None.

**Desktop + web scope:** Both (same Admin.jsx component).

**Rationale:**
The whitelist already includes these keys. The receipt builder already renders them. The PDF generator already renders them. Only the form is missing — a 5-minute task. This is pure backlog hygiene that pays off on every onboarding because clients consistently ask "y mi correo y mi web, ¿dónde los pongo?" before they finish the first guided tour.

**Sample Spanish copy:**
- Field label: **"Correo electrónico"** / placeholder `info@minegocio.com`
- Field hint: *"Aparece en facturas PDF y en el recibo impreso si está configurado."*
- Field label: **"Sitio web"** / placeholder `https://minegocio.com`

---

### B.4 — `mgr_gate_*` whitelist verification + UI completeness (PRIORITY 4)

**Setting keys (audit list — verify each is in the cloud whitelist):**
- `mgr_gate_enabled_discount_big`
- `mgr_gate_enabled_void`
- `mgr_gate_enabled_credit_note`
- `mgr_gate_enabled_inv_adjust`
- `mgr_gate_enabled_price_edit`
- (forward-compat) any future `mgr_gate_enabled_*` toggle

**Schema location — THIS IS THE BUG:**
- `packages/services/settingsWhitelist.js` and `electron/settingsWhitelist.js` — search for `mgr_gate`. **NONE of the mgr_gate keys are present in either whitelist file as of v2.16.26.** The toggles in `packages/ui/screens/Sistema.jsx` lines 575-588 read/write to `app_settings` via `cfg`/`set`, but because the keys are not whitelisted, the cloud sync layer (`pullAppSettings` / `pushAppSettings`) classifies them as "unknown — default to device-local," meaning a flip on one register never reaches the other registers.
- Also: the canonical rules table is `packages/services/managerGateRules.js`. The UI list and the rules list MUST stay in sync.

**Fix:**
1. Add a single block to BOTH whitelist files (keep them identical):
   ```js
   // Manager Authorization gates — owner toggles which sensitive ops require
   // manager card/PIN. Cloud-synced so flipping on web propagates to every
   // register. Add new keys here whenever a new mgr_gate_enabled_<op> ships.
   'mgr_gate_enabled_discount_big',
   'mgr_gate_enabled_void',
   'mgr_gate_enabled_credit_note',
   'mgr_gate_enabled_inv_adjust',
   'mgr_gate_enabled_price_edit',
   ```
2. Add a unit-test stub in `scripts/audit-flows.mjs` that diffs the keys present in `Sistema.jsx` against `BUSINESS_SETTING_KEYS` and fails if any `mgr_gate_*` key in the UI is missing from the whitelist. This prevents regression — adding a new gate without whitelisting it would fail CI.

**UI changes:** none — the existing toggles in `Sistema.jsx` lines 567-589 are correct as a UX layout. The bug is purely the whitelist gap.

**Default value:** all five gates default to `'1'` (enabled). Owner can opt out per gate.

**Plan-gate:** none — manager auth is a security baseline, available on every plan.

**Validation:** boolean toggles, stored as `'1'` / `'0'` strings (matches current convention).

**Desktop + web scope:** **Both.** This is the entire point of the fix — the toggles are visually identical on desktop and web today, but only the desktop one persists locally; cloud sync silently drops the value. Both sides need the whitelist fix.

**Rationale:**
This is a silent-data-loss bug. The owner believes they disabled the manager-gate on credit notes; on every other register (web POS, second desktop), the gate is still enabled. Cashiers call WhatsApp. Mike SSHes in. Confidence in the platform erodes. Adding five strings to the whitelist files is 30 seconds of work; the audit-flows guard rail is what locks the fix in. **This is the highest-leverage fix in the entire spec per byte of code changed.**

**Sample Spanish copy:** N/A — no UI strings change. Existing labels in Sistema.jsx are correct.

---

### B.5 — Salon: `salon_require_deposit` / `salon_deposit_amount_dop` / `salon_no_show_fee_dop` polish (PRIORITY 5)

**Setting keys:** all three already cloud-synced (whitelist line 61).

**Schema location:** `packages/services/settingsWhitelist.js` line 61, `electron/settingsWhitelist.js` line 61. **No whitelist change.**

**Where the UI sits:**
- File: `packages/ui/screens/Admin.jsx`, inside `SalonSettings` component (referenced at line 1963 inside MiEmpresa, defined elsewhere in the file around line 1521).
- The form exists but lacks structure: deposit toggle and deposit amount are loose, no-show fee has no helper text, and the sequence-of-events copy is missing.

**Control types:**
1. `salon_require_deposit`: toggle (re-use existing `<Toggle>` component).
2. `salon_deposit_amount_dop`: `<Input type="number">`, min=0, step=50, suffix label "RD$" rendered to the right.
3. `salon_no_show_fee_dop`: same pattern.

**Default values + range:**
- `salon_require_deposit`: `'false'`. Plan-gate Pro PLUS.
- `salon_deposit_amount_dop`: `300`. Range 0-10000.
- `salon_no_show_fee_dop`: `300`. Range 0-10000. Plan-gate Pro MAX (`salon_no_show_deposit` feature key).

**Plan-gate:**
- `salon_require_deposit` + `salon_deposit_amount_dop`: Pro PLUS (`memberships` group / `salon_walk_in` peer).
- `salon_no_show_fee_dop`: Pro MAX (matches `salon_no_show_deposit` plan key).

**Validation:**
- If `salon_require_deposit === 'true'` and `salon_deposit_amount_dop` is 0 or empty → toast error on save: *"Si exiges depósito, define un monto mayor que cero."*
- No-show fee independent of deposit toggle. Can be set without requiring deposit (some salons charge no-show but don't pre-collect).

**Desktop + web scope:** Both. Public-booking page (web only) reads these to compute the deposit charge at booking time; Salon dashboard (both desktop + web) reads `salon_no_show_fee_dop` for the fast-fee button on the no-show modal.

**Rationale:**
Salon clients are paying RD$4,490+ for the salon plan and ask in their first week "cómo le cobro al que no llega." The keys are correctly synced and the public-booking page reads them, but the Mi Empresa form is a flat list of three numeric fields with terse labels and no copy explaining the booking-flow consequence. Re-laying it out as "Política de depósitos" with a one-paragraph intro and a worked example bumps activation rates on the salon plan and is a 20-line UI change.

**Sample Spanish copy:**
- Section title: **"Política de depósitos y no-shows"**
- Intro: *"Cobra un depósito al reservar para reducir las inasistencias. Si el cliente no llega, conviértelo en cargo de no-show automáticamente."*
- Toggle label: **"Exigir depósito al reservar"**
- Toggle hint: *"El depósito se cobra al confirmar la cita en la página pública."*
- Amount label: **"Monto del depósito (RD$)"**
- Amount hint: *"Se acredita al servicio cuando el cliente llega."*
- No-show label: **"Cargo por no-show (RD$)"**
- No-show hint: *"Se aplica al marcar la cita como no-show. Disponible en Pro MAX."*

---

### B.6 — `salon_public_booking_slug` editable (PRIORITY 6)

**Setting key:** `salon_public_booking_slug`. Already whitelisted (line 62).

**Schema location:** `packages/services/settingsWhitelist.js` line 62. **No whitelist change.**

**Where the UI sits:**
- File: `packages/ui/screens/Admin.jsx` inside `SalonSettings`. Currently a slug is generated from the business name on first save and the input is read-only / muted. Make it editable.

**Control type:** `<input type="text">` with live preview of the resulting URL: `terminalxpos.com/book/{slug}`.

**Default value:** auto-generated on first save from `slugify(biz_name)`. Owner may overwrite.

**Validation:**
- Lowercase only. Allowed: `[a-z0-9-]`. Min 3, max 32 chars. No leading/trailing dash. No double-dash.
- Uniqueness check on save via `api.salon.checkSlug(slug)` — Supabase RPC that selects from `app_settings` where `key='salon_public_booking_slug' AND value=$1 AND business_id != current_business_id()`.
- If taken, show inline error: *"Esta URL ya está en uso. Prueba con otra."*
- On change, debounce 500ms and live-validate without saving.

**Plan-gate:** Pro PLUS (matches `public_booking` feature key).

**Desktop + web scope:** Both. Web booking page reads the slug to render the URL.

**Rationale:**
Barbershops sell on social media and want a memorable URL: `/book/laisla` not `/book/la-isla-barber-shop-srl-9f2a`. Three lines of input + a debounce + a Supabase uniqueness check. The slug is already a real cloud-synced field — the only work is unlocking the input and adding validation. Activation impact: every barber shop that sees the QR code in Mi Empresa will customize the slug if given the chance.

**Sample Spanish copy:**
- Field label: **"URL pública de reservas"**
- Live preview: `terminalxpos.com/book/{slug}`
- Hint: *"Solo letras minúsculas, números y guiones. Tu cliente la verá en el código QR y en redes sociales."*
- Error (taken): *"Esta URL ya está en uso. Prueba con otra."*
- Error (invalid chars): *"Solo letras minúsculas, números y guiones (a-z, 0-9, -)."*

---

### B.7 — `mechanic_tow_fee_default` exposure on hybrid (PRIORITY 7)

**Setting key:** `mechanic_tow_fee_default`. Already whitelisted (line 65), already in `Sistema.jsx` line 657-674.

**Bug:** the `<SettingSection>` is gated by `isMechanic` (line 657). Hybrid businesses with `mecanica` in their `hybrid_components` CSV but a different primary `business_type` never see the field.

**Fix:** change the gate from `isMechanic` to `isMechanic || hasFeature('mecanica_workorders')`. The feature key already resolves true when `hybrid_components` contains `mecanica`.

**Where:** `packages/ui/screens/Sistema.jsx` line 657.

**Default + range:** `'500'`, range 0-50000.

**Plan-gate:** none (mecánica core is Pro+).

**Desktop + web scope:** Both.

**Rationale:**
A carwash that bolts on mechanic services (hybrid) wants to set its tow fee. Today the field hides because `business_type='carwash'`. One-line gate change. Trivial.

**Sample Spanish copy:** existing copy is correct, no change.

---

### B.8 — `feature_mamajuana_tracking_enabled` / `feature_serial_number_tracking_enabled` toggles (PRIORITY 8)

**Setting keys:** both already cloud-synced (lines 45, 53).

**Where the UI sits:**
- File: `packages/ui/screens/Admin.jsx`, inside `BusinessFeatureToggles` component (around line 1977). That component already iterates a `featureList` array and renders one toggle per feature. Add two more entries.

**Control type:** toggle (re-use existing pattern).

**Defaults:**
- `feature_mamajuana_tracking_enabled`: subtype default `licoreria` = true; everyone else false.
- `feature_serial_number_tracking_enabled`: subtype default `ferreteria` = true; everyone else false.

**Plan-gate:** Pro PLUS (matches `tienda_subtype` template plan-gate).

**Validation:** none. Pure toggle.

**Desktop + web scope:** Both.

**Rationale:**
These two features are subtype defaults but have NO per-business override UI today, so a colmado (subtype `colmado`) that happens to also sell mamajuana cannot enable the tracker without SQL. Two toggles in BusinessFeatureToggles. 5 minutes.

**Sample Spanish copy:**
- Mamajuana: **"Trazabilidad de mamajuana"** / *"Lleva control del lote, fecha de envasado y maceración. Recomendado para licorerías que envasan en casa."*
- Serial: **"Números de serie / IMEI"** / *"Captura el número de serie en cada venta. Útil para electrónica, herramientas eléctricas y celulares."*

---

## C. Implementation order

### Ship in v2.16.27 (3 items, 1 day of work, no design pass needed)

1. **B.4 — `mgr_gate_*` whitelist fix.** 5 strings × 2 files + 1 audit-flows test. No UI work. Critical silent-data-loss fix. Ship first.
2. **B.3 — `biz_email` + `biz_website` form fields.** Two `<input>`s appended to existing `fields` array in MiEmpresa. Existing save path handles them via the `mergedSettings` JSON merge. ~10 lines of JSX.
3. **B.7 — `mechanic_tow_fee_default` hybrid gate fix.** One-line change in Sistema.jsx (`isMechanic` → `isMechanic || hasFeature('mecanica_workorders')`).

These three together are a clean v2.16.27 release: one whitelist+sync correctness fix, one form completeness fix, one gate correctness fix. No new components, no new strings beyond two field labels, no plan-gate logic changes, no migrations. Verify by running `node scripts/audit-flows.mjs` (already in the repo per CLAUDE.md release gate) and `node scripts/ranoza-e2e-smoke.mjs` and confirm both pass before tagging.

### Ship in v2.16.28 (2 items, 2-3 days, light design pass)

4. **B.2 — Receipt branding `invoice_footer` + `logo_url`.** Needs the "Marca y Recibos" section layout decision (one collapsible vs two), the upgrade-hook UX for Pro plans, and the upload destination decision (data URL vs Supabase Storage). Spec the section once, build once.
5. **B.5 — Salon deposit/no-show form polish.** Layout + copy refresh of the existing fields, plus the validation rule that blocks saving "require deposit but amount=0." No new keys.

### Ship in v2.17.0 (3 items, design-first)

6. **B.1 — `fiscal_mode` toggle in Mi Empresa.** This is critical but needs the dedicated section design + the confirm modal + the cert-installed precondition check + the activity_log emission + the plan-gate-on-flip-to-ecf logic. It is high-stakes — wrong default at the modal could change a business's NCFs unintentionally. Worth doing carefully, not fast.
7. **B.6 — `salon_public_booking_slug` editable.** Needs the Supabase uniqueness RPC, the debounce UX, and the live-preview component. Build once carefully with the RPC; never build twice.
8. **B.8 — Mamajuana / Serial toggles.** Trivial code, but ship after B.6 because both touch BusinessFeatureToggles and we want one merged PR per file in v2.17 to keep diffs reviewable.

### Explicitly NOT in scope

- `pos_tab_order` / `pos_tab_hidden` — needs a drag-and-drop UI (react-dnd or @dnd-kit), preview pane, and reset-to-default flow. Park until a paying client asks. v2.17.x candidate at earliest.
- `tienda_subtype` re-pivot — see Anti-Patterns §D.
- `hybrid_components` re-pivot — see Anti-Patterns §D.
- `default_form_pago` — already in DEVICE_LOCAL_CLOUD_MIRROR_KEYS, already lives in Sistema → Preferencias → Métodos de Pago. No gap.

---

## D. Anti-patterns — what NOT to do

### D.1 Do NOT expose `tienda_subtype` re-pivot without a destructive-migration confirmation flow

`tienda_subtype` controls which feature defaults, default categories, and product field schema apply. Flipping `licoreria → ferreteria` after a year of operation would:

- Leave 900+ products in obsolete categories ("Rones," "Cervezas") with no migration path.
- Disable `feature_mamajuana_tracking_enabled` UI but leave the underlying `mamajuana_lots` rows orphaned in SQLite + Supabase.
- Switch RetailPOS's product grid layout to "ferreteria" (SKU-first, picture-second), which is jarring for cashiers who are still seeing the same product list as yesterday.

If we ever expose this, it must be:
1. Behind a confirm modal with explicit text: *"Cambiar de Licorería a Ferretería reasignará 14 categorías y desactivará 3 funciones específicas de licorería. Esta acción NO se puede deshacer automáticamente. ¿Continuar?"*
2. Backed by a one-shot migration script that the user runs manually (likely from `/admin/maintenance`) that produces a CSV of orphaned rows and a SQL diff, so Mike can review before commit.
3. Disabled entirely on Pro plan (only Pro PLUS+ owners can re-pivot).

For v2.16/v2.17: leave it locked at FirstTimeSetup. The onboarding wizard is the ONE place you change subtype.

### D.2 Do NOT expose `hybrid_components` re-pivot without the same guardrail

Same reasoning as D.1. Toggling `hybrid_components` from `"carwash,salon"` to `"carwash"` would orphan stylist_schedules and salon_appointments tables; the reverse adds tabs but does not seed default categories. Locked at FirstTimeSetup until we can ship a migration playbook.

### D.3 Do NOT add any setting toggle without first verifying it is in the whitelist

This is the lesson from B.4. Every new owner-facing toggle MUST be added to BOTH `packages/services/settingsWhitelist.js` AND `electron/settingsWhitelist.js` in lockstep. The audit-flows guard rail introduced in B.4 should grow to flag any UI key write that doesn't have a whitelist entry.

### D.4 Do NOT split a setting into desktop-only and web-only forms

If a setting needs to be edited on both desktop and web, edit it in one component (`MiEmpresa` lives in `packages/ui/screens/Admin.jsx`, which both desktop and web consume). Do not duplicate the form into a `web/admin/MiEmpresa.web.jsx`. The cloud-sync layer is the source of truth — UI parity falls out of using one component.

### D.5 Do NOT use gray on any of these new controls

Brand rule: black, white, `#b3001e` only. No gray.
- Disabled state: opacity-40 on the crimson, NOT switch to gray.
- Hint text: `text-slate-500` is allowed in DARK MODE (`dark:text-white/60`) per the existing pattern, but in light mode use `text-black/60` — there is NO `text-slate-400` in any of the existing crimson sections. Match the pattern around line 1846 of Admin.jsx: `text-slate-400 dark:text-white/40` is the legacy pattern; new code should use `text-black/40 dark:text-white/40` for true brand purity.
- Selected pill: `bg-[#b3001e] text-white`.
- Unselected pill: `bg-white text-black border border-black/10` (light) / `bg-white/5 text-white border border-white/10` (dark).

### D.6 Do NOT silently overwrite non-empty fields when applying subtype defaults

When a feature toggle has a subtype-default of `true` and the owner explicitly sets the override to `false`, never recompute defaults on a subtype change without preserving the override. The existing `useBusinessType().hasFeature(name)` reader correctly prefers the override; new save paths must continue to write the override key (`feature_*_enabled`) and never overwrite it from the subtype template.

### D.7 Do NOT hand-edit `app_settings` in production for client requests

After v2.16.27 ships, the answer to "client wants their tow fee to be 750" is "send them the screen URL." Mike should not be SSHing into Supabase to set a key that the UI now exposes. If a client's request requires a SQL edit AFTER v2.16.27 ships, that is a spec gap — file a follow-up against this doc.

### D.8 Do NOT inline-translate Spanish strings

All new strings live in es-DO Spanish in the JSX directly (no i18n key indirection — the codebase uses inline `L(es, en)` ternaries via `useLang()`). Match the existing pattern. Do not introduce a `messages.es.json` for these new strings.

---

## Verification checklist (run before tagging v2.16.27)

- [ ] `npm run build:web` passes.
- [ ] `npx vite build` (desktop) passes.
- [ ] `node scripts/audit-flows.mjs` passes — including the new mgr_gate guard rail.
- [ ] `node scripts/ranoza-e2e-smoke.mjs` 22/22 PASS.
- [ ] `node scripts/rls-policy-audit.mjs` exit 0.
- [ ] Manual: open Admin → Mi Empresa on web POS, confirm `biz_email` and `biz_website` save → reload → values persist.
- [ ] Manual: flip a `mgr_gate_*` toggle on web Sistema, log into desktop, confirm the toggle is reflected (was the silent-loss bug).
- [ ] Manual: hybrid carwash+mecánica account sees the tow-fee field in Sistema.
- [ ] Brand audit: zero `bg-gray-*` / `text-gray-*` / `border-gray-*` classes added.

---

## Owner sign-off

Mike reviews this spec, marks each of the 8 items as YES / DEFER / KILL. Implementation begins on the YES set in priority order. v2.16.27 ships within 24h of sign-off if items 1-3 of section C are approved.

End of spec.
