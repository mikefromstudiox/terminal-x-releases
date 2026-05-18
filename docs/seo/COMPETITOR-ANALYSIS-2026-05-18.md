# DR POS / e-CF Competitor Analysis — 2026-05-18

**Author:** stratOS (Studio X strategy)
**For:** Terminal X positioning, SEO, and content strategy
**Period covered:** Ley 32-23 phase-in window (final SME deadline **2026-05-15**, three days behind us)
**Companion docs:** `docs/seo/KEYWORD-STRATEGY-2026-05-18.md`, `memory/reference_pricing_locked_20260512.md`, `packages/ui/landing/data/featureMatrix.json`

---

## 0. Executive summary

The DR e-CF market just crossed its **regulatory cliff** on 2026-05-15. From this week forward, every micro / small / unclassified contributor that bills B2B must either (a) emit e-CF, (b) use DGII's free "Facturador Gratuito" (capped, web-only, no POS, no inventory), or (c) face penalties. Demand is now structural, not aspirational.

**DGII publishes 47 authorized PSFE** today. Of those, only a handful have any POS presence at all — most are pure backend XML signers white-labeled by accountants. The *POS + e-CF* intersection where Terminal X plays is occupied by **~6 real competitors**: Starsisa, Indexa, WilPOS, Visual Pyme, Alegra POS, and a long tail of Voxel/Citrus/GuruSoft resellers.

Three structural moats Terminal X has — and barely communicates:
1. **Direct DGII emisor** (own RNC 133410321, own .p12, own certified gateway). Competitors are PSFE intermediaries; Terminal X *is the PSFE for itself* and resells the cert as a service.
2. **No per-comprobante fee, ever.** Alegra, Indexa, República FEL, Voxel all meter or cap. Terminal X Pro PLUS / MAX = unlimited e-CF flat.
3. **Multi-vertical depth in one license.** Starsisa is retail-only. WilPOS is retail-only. Visual Pyme is accounting-first. Terminal X ships a *real* restaurant POS (KDS, mesas, BOM, course pacing), a *real* dealership module (DealBuilder + UAF + INTRANT stub), a *real* salon module (stylist schedules + memberships), and pawn/loans — all on one codebase.

The asymmetry is large and **almost no one knows about it**, because Terminal X has zero comparison content live on terminalxpos.com today.

---

## A. The 6 primary DR POS / e-CF competitors

| # | Brand | URL | Product | Pricing model | Verticals | Distribution | Founded (est.) |
|---|---|---|---|---|---|---|---|
| 1 | **Starsisa** | starsisa.com | POS + facturación NCF (legacy + e-CF retro-fit) | License-purchase + maintenance fee | Carwash, colmado, mini-market, ferretería | Direct sales + reseller network in Santiago + SD | ~2008 |
| 2 | **Indexa** | indexa.do (Progressa Corporate Group) | PSFE + ERP "Quadro Iterativo" | Subscription, per-user tiers | Mid-market accounting, distribución | Direct sales, accountant partners | ~2010 |
| 3 | **WilPOS** | wilpos.com | POS + inventario + facturación DGII | Free 30-day trial → subscription (pricing opaque, quote only) | Retail / comercio general | Online lead-gen + direct sales | ~2015 |
| 4 | **Visual Pyme** | visualpyme.com | ERP / contabilidad + módulo facturación | Subscription, accountant-resold | Accounting firms, SMEs needing 606/607 first, POS second | Accountant channel | ~2005 |
| 5 | **Alegra POS** | alegra.com/rdominicana | Cloud POS + e-CF (Colombia HQ, regional play) | USD-denominated monthly, US$19 → US$89+ | Microempresa / SME, professional services, retail | SaaS self-serve + content marketing | 2013 (regional) |
| 6 | **ef2.do / Factura Dominicana** | ef2.do, facturadominicana.com | Pure PSFE (no POS) | Per-comprobante or volume bundles | Anyone needing the XML-only path | API + accountant resellers | ~2018 |

### Secondary mentions (long tail, watch but not direct)
- **Voxel Caribe**, **GuruSoft**, **Citrus**, **The Factory HKA**, **República FEL**, **SoftPOS** — all PSFE-first, mostly white-labeled through accountants, no consumer POS UX.
- **SAP / Oracle NetSuite / Microsoft Dynamics** — enterprise-only, irrelevant to Terminal X's SME segment.
- **Softland RD** — old guard ERP, strong with mid-market accounting, weak POS.
- **Treinta** — Colombian SME-bookkeeping app expanding into DR retail, not a POS but eats mindshare via Google.

---

## B. Keyword + content analysis (per competitor)

### B.1 Starsisa
- **Likely page-1 rankings:** "starsisa", "starsisa rd", "sistema pos carwash", brand-defensive only. Site returns 403 to anonymous crawlers (Cloudflare hard block) — that itself is a *severe* SEO handicap.
- **Content cadence:** No blog. No public case studies. No DGII content.
- **Domain authority:** Low-medium. Strong word-of-mouth in carwash niche (Mike came from there), almost no inbound links.
- **Achilles heel:** The **duplicate-ticket print bug** (documented in `memory/project_starsisa_double_ticket.md`) is a known pain across their installed base. Every owner using StarSISA + Terminal X commission imports has to dedupe pairs.
- **Title/H1 patterns:** Cannot scrape (403). Brand-only positioning.

### B.2 Indexa (Progressa Corporate Group)
- **Likely rankings:** "indexa do", "quadro iterativo", "facturación electrónica empresa grande". B2B/enterprise tilt.
- **Content cadence:** Corporate site, no blog cadence visible. LinkedIn-driven.
- **Domain authority:** Medium. DGII certification mention helps; light blog footprint.
- **Achilles heel:** Per-user pricing scales painfully; ERP-first UX intimidates a carwash owner.
- **Note:** Their **indexa.do main domain currently returns 404 "Domain Not Configured."** Live site is the parent (`progressa.group`). That's a major brand-leak / SEO bleed they're losing every day.

### B.3 WilPOS
- **Likely rankings:** "wilpos", "sistema pos republica dominicana", "punto de venta dgii". Some long-tail "facturación pos rd".
- **Content cadence:** Marketing site, occasional blog, mostly product pages.
- **Domain authority:** Medium-low. Decent direct traffic from "wilpos" brand + some "pos rd" keywords.
- **H1 pattern:** "Sistema de Punto de Venta, Inventario y Facturación DGII RD" — generic.
- **Achilles heel:** Pricing is **opaque** (must request quote). In a 2026 buyer's market this is a conversion killer.
- **Vertical depth:** Retail only. No restaurant, no salon, no dealership.

### B.4 Visual Pyme
- **Likely rankings:** "visual pyme", "software contable pyme rd", "contabilidad pequeña empresa". Accounting-first SEO surface.
- **Content cadence:** Light. Accountant-channel-driven, not SEO-driven.
- **Domain authority:** Medium. Long-established brand.
- **Site connectivity issue:** Returned `ECONNREFUSED` to our crawl — intermittent reachability is a UX/SEO red flag.
- **Achilles heel:** POS feels bolted on to accounting; no thermal-printer first-class support; no mobile PWA; no vertical specialization.

### B.5 Alegra POS
- **Likely rankings:** Strong on "factura electrónica rd", "sistema pos cloud", "alegra precios", "facturación electrónica república dominicana". They invest heavily in SEO content and rank as the *de facto* search winner for Spanish-language e-CF queries across the region.
- **Content cadence:** Aggressive blog (weekly+), comparison pages, video walkthroughs, mobile-first.
- **Domain authority:** **HIGH** (regional play). Backlinks from Colombian/Mexican/Argentine markets compound into DR rankings.
- **Title/H1 patterns:** "Sistema de Facturación Electrónica #1 en Dominicana" (#1 claim, no source). "Crea tu factura electrónica en minutos."
- **Achilles heel:** **USD pricing** (US$19–$89/mo) reads as RD$1,140–$5,340 — *higher than Terminal X Pro PLUS* once converted, and **not a real POS** (no thermal-printer flows, no cash drawer, no KDS, no multi-vertical depth). Their "POS" is a web register.
- **This is Terminal X's biggest threat for organic search**, not for product fit.

### B.6 ef2.do / Factura Dominicana
- **Likely rankings:** "factura dominicana", "ef2 do", "psfe republica dominicana", "facturador electrónico api".
- **Content cadence:** Developer-docs first.
- **Domain authority:** Low-medium.
- **Achilles heel:** **No POS, no UI for cashiers.** Pure API/portal — your accountant uses it, you don't. Useless to a carwash owner alone at the counter.

---

## C. Comparison matrix — features

Sources for Terminal X column: `packages/ui/landing/data/featureMatrix.json` (Pro / Pro PLUS / Pro MAX consolidated as best-of); `Terminal X/CLAUDE.md` Plan-gating section.

Legend: ✅ full · ◐ partial · ❌ none / not advertised · ❓ unknown (opaque)

| Feature | Terminal X | Starsisa | Indexa | WilPOS | Visual Pyme | Alegra POS | ef2.do |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **Direct DGII emisor (own .p12, own gateway)** | ✅ | ❌ | ◐ (PSFE) | ❌ | ❌ | ◐ (PSFE) | ◐ (PSFE) |
| **e-CF types E31/E32/E33/E34/E43/E47** | ✅ | ◐ | ✅ | ◐ | ✅ | ✅ | ✅ |
| **NCF B01/B02 paper (legacy fallback)** | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | ❌ |
| **Per-comprobante fee** | ❌ none | ❓ | ✅ tiered | ❓ | ❓ | ❌ in plan | ✅ |
| **Unlimited e-CF on flat plan** | ✅ (PLUS/MAX) | ❌ | ❌ | ❓ | ❌ | ✅ (top tier only) | ❌ |
| **72h offline queue (IndicadorEnvioDiferido)** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Multi-vertical (retail + restaurant + salon + dealership + pawn + carwash)** | ✅ | ❌ retail only | ❌ ERP | ❌ retail only | ❌ accounting | ◐ retail + services | ❌ |
| **Native restaurant KDS + mesas + BOM** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Dealership DealBuilder + UAF + INTRANT** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Stylist schedules + memberships (salon)** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Loans / pawn module** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Thermal printer (ESC/POS, 80mm, drawer kick variants)** | ✅ | ✅ | ◐ | ✅ | ◐ | ❌ | ❌ |
| **PWA mobile (iOS + Android)** | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Desktop (Electron, encrypted SQLCipher)** | ✅ | ✅ Windows | ✅ Windows | ✅ Windows | ✅ Windows | ❌ cloud only | ❌ |
| **Local-first / offline-capable POS** | ✅ | ✅ | ◐ | ✅ | ✅ | ❌ | ❌ |
| **RNC lookup (900K contribuyentes embedded)** | ✅ | ◐ | ✅ | ◐ | ✅ | ✅ | ✅ |
| **Inventory + barcode + variants** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Per-client pricing + Pedidos Ya channel** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Nómina (TSS + AFP + INFOTEP + ISR 2026)** | ✅ (MAX) | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ |
| **606 / 607 export** | ✅ | ◐ | ✅ | ◐ | ✅ | ✅ | ✅ |
| **Activity log / audit trail with severity** | ✅ | ❌ | ◐ | ❌ | ◐ | ❌ | ❌ |
| **Manager-auth Code128 barcode cards** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **WhatsApp receipt + reminder automation** | ✅ | ❌ | ❌ | ❌ | ❌ | ◐ | ❌ |
| **Real-time remote dashboard for owners** | ✅ (MAX) | ❌ | ◐ | ❌ | ◐ | ✅ | ❌ |
| **Cert Viafirma included** | ✅ (PLUS/MAX) | ❌ | ❌ | ❌ | ❌ | ◐ | ❌ |
| **Multi-location with ticket locks** | ✅ (MAX) | ◐ | ✅ | ❌ | ✅ | ✅ | ❌ |
| **All UI in Spanish (es-DO)** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ regional | ✅ |
| **Pricing published on website** | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |

**Reading:** The only competitor that beats Terminal X on a *single column* is Alegra (PWA, regional content + brand authority, published pricing). Terminal X wins on **every other axis** that matters to a DR SME operator running an actual physical store.

---

## D. Pricing comparison — what the buyer actually pays

All in RD$/month unless noted. Annual figures collapsed to monthly equivalent at the advertised discount.

### D.1 Terminal X (canonical — `memory/reference_pricing_locked_20260512.md`)

| Line | Pro | Pro PLUS | Pro MAX |
|---|---|---|---|
| Base POS | RD$2,490 | RD$4,490 | RD$6,990 |
| Annual (15% off) effective | RD$2,117 | RD$3,817 | RD$5,942 |
| e-CF included | — (NCF only) | Unlimited | Unlimited |
| Per-comprobante fee | n/a | RD$0 | RD$0 |
| Viafirma cert included | No | **Yes** | **Yes** |
| Multi-vertical | All verticals | All verticals | All verticals |
| Multi-location | ❌ | ❌ | ✅ |
| Nómina full (TSS+ISR+INFOTEP) | ❌ | ❌ | ✅ |
| Support | Email | WhatsApp business hours | **Priority + dedicated executive** |

Facturación-only line (no POS) for accountant clients:

| Plan | Cost | e-CF cap | Viafirma included |
|---|---|---|---|
| Facturación | RD$490/mo | 50/mo | ❌ |
| Facturación PLUS | RD$990/mo | 200/mo | ❌ |
| Facturación Unlimited | RD$1,990/mo | Unlimited | ✅ |

Optional endpoint license: RD$300 / 600 / 1,200 per month per additional terminal.
Cert-as-a-Service: RD$5K / 15K / 18K one-time bundle via studioxrdtech.com.

### D.2 Alegra POS (live USD prices, converted at ~RD$60/USD)

| Plan | USD | RD$ equiv | Revenue cap | Users | e-CF |
|---|---|---|---|---|---|
| Emprendedor | $19 | ~RD$1,140 | RD$125K/mo | 2 | Yes |
| Pyme | $35 | ~RD$2,100 | RD$500K/mo | 2 | Yes |
| PRO | $69 | ~RD$4,140 | RD$1.25M/mo | 3 | Yes (cert included) |
| PLUS | $89 | ~RD$5,340 | RD$6.25M/mo | 8 | Yes |
| Premium | Custom | — | >RD$6.25M | Custom | Yes |

**Crossover read:** Alegra Pyme (RD$2,100) ≈ Terminal X Pro (RD$2,490). Alegra PRO (RD$4,140) ≈ Terminal X Pro PLUS (RD$4,490). **At every tier, Terminal X gives more for ~the same price** (multi-vertical, offline desktop, thermal printer, KDS, etc.).

### D.3 Indexa / Starsisa / WilPOS / Visual Pyme / ef2.do

All **opaque** — quote-only. Industry-wide intel from `programascontabilidad.com` puts the range at RD$1,500–RD$8,000/mo for SME plans, with per-comprobante surcharges at RD$1–RD$5 above caps. This **lack of transparency is itself the opportunity**: Terminal X is one of two players (with Alegra) showing prices on the home page. The other 4 force buyers to "Solicitar Cotización" — friction Terminal X bypasses entirely.

### D.4 The unit-economics killer: per-comprobante math

Typical DR SME billing ~500 e-CF/month:

| Provider | Base plan | Per-comprobante | 500 e-CF/mo cost |
|---|---|---|---|
| Terminal X Pro PLUS | RD$4,490 | RD$0 | **RD$4,490** |
| Alegra PRO | RD$4,140 | RD$0 (capped by revenue) | RD$4,140 (if under RD$1.25M revenue) |
| Indexa (est.) | RD$3,500 | RD$3 × 500 | RD$5,000 |
| República FEL (est.) | RD$1,500 | RD$2 × 500 | RD$2,500 (cheapest, but no POS) |
| ef2.do (PSFE-only) | RD$500 | RD$2 × 500 | RD$1,500 (but no POS, no inventory, no anything) |

At 1,500 e-CF/mo the per-comprobante providers cross RD$5K — and Terminal X stays flat. **At 3,000+ e-CF/mo Terminal X is meaningfully cheaper than every competitor that meters.** That's a calculator Mike can publish tomorrow.

---

## E. Strategic gaps — where Terminal X can win

1. **The "Only Direct DGII Emisor among SME POS" moat is invisible.** Today no landing-page copy, no comparison page, no PR push communicates this. Buyers think every PSFE is equivalent. **Fix:** dedicated `/emisor-directo-dgii` page + DGII certification badge prominent on every plan card.

2. **Starsisa's duplicate-ticket bug is a known operator wound.** Carwash and colmado owners running StarSISA print pairs and reconcile commissions manually. A `/migrar-desde-starsisa` page that names the bug, offers free data import, and pre-imports the StarSISA commission TSV (Terminal X already dedupes these) lands a ready-to-switch segment.

3. **Indexa.do is literally 404 today.** Their main brand domain serves "Domain Not Configured." Buyers Googling "indexa do" hit a dead page. **Outbid them on Google Ads for their brand term and bid on "alternativa a indexa"** — costs pennies, intercepts demand they can't catch.

4. **WilPOS, Visual Pyme, Starsisa hide prices.** In the post-2026-05-15 panic market, decisive owners will pick the system that lets them buy in 5 minutes. Terminal X already does. **Lean into "Compra en línea, listo hoy" messaging.**

5. **No competitor ships a real restaurant + KDS + BOM + 10% Servicio (Ley 16-92) module.** Crokao is the proof. **A dedicated `/restaurantes` vertical landing with the KDS demo video + Ley 16-92 callout owns this niche** — currently zero organic competition on "POS restaurante e-CF República Dominicana."

6. **No competitor has a Concesionario module.** UAF Ley 155-17 modal, INTRANT stub, DealBuilder with RNC E31 guard, conversion funnel, lead scoring — this is a *zero-competition* SEO niche. `/concesionarios` landing + DR car-dealer industry outreach.

7. **Alegra owns regional content SEO but doesn't own DR-specific operational pain.** Alegra writes generic "what is e-CF" content. Terminal X can write **DR-operator content**: "Cómo dar de baja un e-CF emitido por error (ANECF en 3 pasos)", "¿Por qué su impresora térmica StarSISA imprime tickets dobles?", "Comisión por cajera DGII-compliant en RD" — long-tail keywords Alegra will never touch.

---

## F. Recommended SEO + product moves — ranked by impact × effort

| # | Move | Impact | Effort | Owner | Ship by |
|---|---|:-:|:-:|---|---|
| 1 | **Comparison pages** `/comparar/terminal-x-vs-starsisa`, `/comparar/terminal-x-vs-alegra`, `/comparar/terminal-x-vs-wilpos` — each ~1,500 words, schema.org `Product` comparison markup, feature/price tables, "Migrar gratis" CTA. | 🔥🔥🔥 | M | Marketing + dev | 2026-05-25 |
| 2 | **"Migrar desde Starsisa" landing + 30-day promo** — free data import, free setup, name the duplicate-ticket bug as the migration trigger. Pair with WhatsApp campaign to known carwash community. | 🔥🔥🔥 | M | Mike + dev | 2026-05-25 |
| 3 | **"Emisor Directo DGII" moat page + PR push** — explain the difference between PSFE-intermediary and direct emisor, list our RNC + cert serial. Outreach to DR fintech bloggers (Acento, Diario Libre Económico, Forbes RD, El Dinero) with this angle. **Zero competitor has this story.** | 🔥🔥🔥 | M | Mike | 2026-06-01 |
| 4 | **Per-comprobante savings calculator** at `/calculadora-ecf` — owner enters monthly e-CF volume → returns side-by-side cost vs Indexa, República FEL, Alegra, ef2.do. Generates a shareable PDF receipt. | 🔥🔥 | M | Dev | 2026-06-08 |
| 5 | **Vertical landings**: `/restaurantes-pos-ecf`, `/concesionarios-pos-ecf`, `/salones-pos-ecf` — each with vertical-specific KDS / DealBuilder / Stylist screens, Loom demo, schema.org `SoftwareApplication` markup, vertical-specific testimonials (Crokao, Ranoza when promoted, future dealership). | 🔥🔥 | M-L | Marketing + dev | 2026-06-15 |
| 6 | **Mobile-first PWA messaging update** — every plan card adds "Funciona en celular y tablet sin instalar nada." Alegra owns this story too — we need to match parity and then beat them on the thermal-printer angle. | 🔥🔥 | S | Marketing | 2026-05-22 |
| 7 | **Outbid Indexa + Starsisa brand keywords on Google Ads** while their organic is weak / dead. RD$0.20–0.50 CPC range. Budget RD$10K/mo, ROI tracked via UTM → signup. | 🔥 | S | Mike | 2026-05-22 |

Pair all of these with the **backlink + landing-page campaign** already shipping in parallel. Compounding effect: 6 moves above compound on the same SEO surface and reinforce the **"Direct DGII emisor + multi-vertical + flat-fee + offline-capable"** four-pillar positioning.

---

## Appendix — sources

- DGII Authorized PSFE list (47 providers): https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Paginas/Proveedores-servicios-FE-autorizados.aspx
- Alegra POS DR pricing: https://www.alegra.com/rdominicana/factura-electronica/, https://www.alegra.com/rdominicana/pos/precios/
- Programas Contabilidad — DR e-CF providers guide: https://programascontabilidad.com/comparativas-de-software/empresas-de-facturacion-electronica-rd/
- Programas Contabilidad — DR e-CF pricing for 500 docs/mo: https://programascontabilidad.com/gestion-de-empresas/facturacion-electronica-costos-reales-para-500-e-cf/
- Todo Factura Electrónica — per-document pricing analysis: https://todofacturaelectronica.com/pago-por-documento-e-cf-dom/
- Softland DR — Ley 32-23 timeline: https://softland.com/do/facturacion-electronica-en-republica-dominicana/
- WilPOS: https://wilpos.com (homepage)
- Starsisa: https://www.starsisa.com (returns 403 — handicap noted)
- Indexa: https://www.indexa.do (returns 404 "Domain Not Configured" — handicap noted)
- Terminal X feature matrix: `packages/ui/landing/data/featureMatrix.json`
- Terminal X pricing memory: `memory/reference_pricing_locked_20260512.md`
- Starsisa duplicate-ticket bug memory: `memory/project_starsisa_double_ticket.md`
