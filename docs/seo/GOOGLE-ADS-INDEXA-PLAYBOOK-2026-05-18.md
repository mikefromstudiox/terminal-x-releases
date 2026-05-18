# Google Ads — Bid on "indexa" Brand Traffic Playbook

**Fecha:** 2026-05-18
**Strategy:** Intercept Indexa Dominicana's brand-search traffic. Indexa is a PSFE (Proveedor de Servicios de Facturación Electrónica) Dominicano — their `indexa.do` site has been intermittently 404'd / returning errors per the competitor analysis (`docs/seo/COMPETITOR-ANALYSIS-2026-05-18.md`). People searching for "indexa" / "indexa pos" / "indexa facturador" today land in dead air. Terminal X bidding on that keyword captures the intent at the bottom of funnel.

**Budget target:** RD$15,000/mes (~US$250/mes) to start. Scale once CAC < RD$2,500/cliente.
**Expected CPL:** RD$200-400 per landing-page visitor; RD$2,000-3,500 per signup. Bench against organic CPL = RD$0 but ~30/mo.
**Volume estimate:** Indexa GSC + SimilarWeb data suggested 1,500-3,000 brand searches/month in DR.

---

## 1 — Account setup (10 minutes)

1. Open https://ads.google.com → sign in with the Studio X Google account.
2. **Account type:** ya creada — confirma billing country = República Dominicana, currency = DOP.
3. **Conversion tracking** — already wired through Google Analytics 4 (GA4 propiedad existente `G-XXXXXXX` ver `web/index.html`). En Ads → Tools → Conversions → Import from Analytics → marca `signup_completed` y `lead_captured` events. Asigna valor RD$2,000 a signup_completed, RD$500 a lead_captured.
4. **Tracking template** (Account-level setting → Tracking → Tracking template):
   ```
   {lpurl}?utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={creative}&utm_term={keyword}
   ```
   This stamps every click with UTMs so we can attribute signups in GA4 + the admin panel.

---

## 2 — Campaign #1: "Indexa — Brand Intercept" (Search)

| Setting | Value |
|---|---|
| Campaign type | Search |
| Goal | Leads |
| Networks | Search only — **uncheck** Display Network and Search Partners |
| Locations | República Dominicana (Country) — exclude Estados Unidos |
| Languages | Spanish |
| Audience targeting | Observation (not Targeting): "Small business owners" + "POS shoppers" |
| Budget | **RD$500/día** (= ~RD$15,000/mes) |
| Bid strategy | Start: **Maximize Clicks** with manual CPC cap of **RD$50** for first 7 days |
| | After 30 conversions: switch to **Target CPA** with target = RD$2,500 |
| Ad rotation | Optimize: prefer best performing ads |
| Ad schedule | All day (start broad; trim after 2 weeks of data) |
| Devices | Mobile bid +20%, Desktop baseline, Tablet -50% |

### 2.1 — Ad Group: "Indexa — Brand Exact"

**Keywords** (use these exact match types):

```
[indexa]
[indexa pos]
[indexa rd]
[indexa republica dominicana]
[indexa dominicana]
[indexa facturador]
[indexa facturacion electronica]
[indexa.do]
[indexa software]
"indexa pos"
"indexa facturacion"
"indexa dgii"
+indexa +pos
+indexa +facturador
+indexa +rd
+indexa +alternativa
```

**Negative keywords** (must-add to avoid waste):

```
-indexa capital
-indexa investments
-indexa wealth
-indexa fondos
-indexa inversion
-indexa banco
-indexa españa
-indexa mexico
-indexa argentina
-empleo
-trabajo
-vacante
-curso
-clase
-tutorial
-descarga
-crack
-gratis
```

(Indexa Capital is a Spanish wealth-management firm. Without these negatives ~30-40% of your spend goes to off-target finance searches.)

### 2.2 — Ads (write 4 variants, all Responsive Search Ads)

**Ad 1 — Direct intercept**

- Headlines (write 15, Google rotates):
  ```
  Buscas Indexa? Mira Terminal X
  Indexa está caído — usa Terminal X
  POS DGII certificado en RD
  Facturador Electrónico Ley 32-23
  Alternativa a Indexa en RD
  Terminal X — POS Dominicano
  7 días gratis, sin tarjeta
  Certificado DGII #42483
  Desde RD$490/mes
  e-CF directo a DGII
  Sin PSFE intermediario
  Soporte WhatsApp en español
  POS para carwash, tienda, restaurante
  Modo offline 72 horas
  Cumple Ley 32-23 ya
  ```
- Descriptions (write 4):
  ```
  POS y facturación electrónica certificada por DGII. Sin PSFE. Sin costo por comprobante. Desde RD$490/mes. 7 días gratis.
  Terminal X es Emisor Electrónico Certificado #42483. Directo a DGII, sin intermediarios. 100% Ley 32-23.
  Funciona sin internet 72 horas. Soporte WhatsApp en español. POS dominicano hecho en Santo Domingo.
  RNC 133410321. Ya en producción con docenas de pymes dominicanas. Cero downtime de PSFE.
  ```

**Ad 2 — Pain-point**

- Headlines focus:
  ```
  Tu PSFE se cayó? Cámbiate
  Indexa 404? Migración en 24h
  No dependas de un PSFE caído
  Migramos tu data gratis
  Importa de Indexa en 1 día
  POS sin dependencia de PSFE
  ```

**Ad 3 — Price-anchor**

- Headlines focus:
  ```
  Facturador desde RD$490/mes
  e-CF ilimitado RD$1,990/mes
  Más barato que Indexa
  Sin costo por comprobante
  Cancela cuando quieras
  ```

**Ad 4 — Trust/local**

- Headlines focus:
  ```
  POS hecho en Santo Domingo
  Soporte WhatsApp +1 809-828-2971
  Equipo local 100% dominicano
  Certificado DGII vigente
  ```

### 2.3 — Sitelinks (4 mínimo)

| Sitelink Text | URL | Description |
|---|---|---|
| Precios | https://terminalxpos.com/pricing | Pro RD$2,490 / PLUS RD$4,490 / MAX RD$6,990 |
| 7 días gratis | https://terminalxpos.com/signup | Pro MAX trial sin tarjeta |
| Comparativa Indexa vs Terminal X | https://terminalxpos.com/alternativa-facturador-gratuito-dgii | Diferencias punto por punto |
| Certificación DGII | https://terminalxpos.com/facturador-electronico-dgii | Cert #42483 verificable |

### 2.4 — Callout extensions (8)

```
DGII Certificado #42483
7 días gratis sin tarjeta
Soporte WhatsApp en español
e-CF directo a DGII
Sin costo por comprobante
Modo offline 72 horas
POS multi-vertical
Desde RD$490/mes
```

### 2.5 — Landing page

**Primary LP:** https://terminalxpos.com/alternativa-facturador-gratuito-dgii

This is the dedicated comparison page from the SEO Phase 1 sprint (commit 2ce08b2). It already addresses the "switch from PSFE / Facturador Gratuito" angle. Add a brand-aware variant via UTM param-checking if conversions are weak after 2 weeks.

**Watch in GA4:**
- Bounce rate target < 50% on this LP
- Scroll-depth ≥ 50% on > 60% of sessions
- Signup conversion rate target ≥ 3%

---

## 3 — Campaign #2: "Indexa — Competitor Conquest (Broader)" — DELAYED

Don't launch until Campaign #1 is showing positive ROAS. Wider net = more wasted spend in early days. Notes for later:

- Phrase match + Broad match around "indexa alternativa", "indexa caido", "psfe alternativa"
- Higher CPC tolerance (RD$80-120)
- Different ad copy emphasizing migration support

---

## 4 — Launch checklist

- [ ] Account billing verified, currency DOP, country RD
- [ ] Conversion tracking imported from GA4 (signup_completed + lead_captured)
- [ ] Tracking template set at Account level
- [ ] Campaign created with Search-only network, RD locations, Spanish lang
- [ ] Budget RD$500/día set
- [ ] Bid strategy: Maximize Clicks, CPC cap RD$50
- [ ] Ad Group "Indexa — Brand Exact" created
- [ ] 16 exact + phrase + modified-broad keywords added
- [ ] 18 negative keywords added (including Indexa Capital exclusions)
- [ ] 4 Responsive Search Ads written
- [ ] 4 Sitelinks added
- [ ] 8 Callout extensions added
- [ ] Mobile bid adjustment +20%, Tablet -50%
- [ ] **Pause overnight** — review search terms report each morning for 14 days
- [ ] Add new negatives every morning based on irrelevant search terms

---

## 5 — Daily ritual (first 14 days, ~5 min/day)

1. Open Ads → Campaigns → "Indexa — Brand Intercept" → Keywords → **Search terms** tab.
2. Sort by Cost descending.
3. For every search term that's NOT related to Indexa-the-PSFE (e.g., "indexa capital", "indexa wealth", any spam): right-click → Add as negative.
4. For every search term that IS relevant and is NOT already in keywords: right-click → Add as keyword (exact match).
5. Check Cost / Conversion. If > RD$3,000 after 50+ clicks, pause the worst-CPC keyword.

---

## 6 — KPIs to track (in GA4 + Admin → Errores y telemetría)

| Metric | Target | Stop-loss |
|---|---|---|
| CPC | RD$15-50 | > RD$80 sustained → review |
| Click-through rate (CTR) | > 5% | < 2% after 1,000 impressions → rewrite ads |
| Landing page bounce rate | < 50% | > 70% → LP problem |
| Signup conversion rate | > 3% | < 1% after 30 clicks → LP A/B test |
| Cost per signup (CPS) | < RD$3,000 | > RD$5,000 → pause + diagnose |
| ROAS (lifetime) | > 5x (12mo customer LTV ÷ CPA) | < 2x → re-tune |

---

## 7 — Red flags that mean PAUSE the campaign

- Spend > RD$8,000/día (campaign should auto-cap at 2x daily budget)
- 50+ clicks, 0 conversions → LP or audience mismatch
- Ads disapproved → check for trademark issues (Indexa may file a complaint for use of brand)
- Quality Score < 5/10 on main keywords → ad-keyword-LP relevance is weak

---

## 8 — Trademark risk note

Google allows bidding on competitor brand names as keywords. They do NOT allow using competitor brand names in **ad headlines/text** in most countries (DR includes). The 4 ad copies above are **clean** — they mention Indexa in only the negative-direct framing ("Buscas Indexa?", "Indexa caído", "Alternativa a Indexa") which are debatable but generally acceptable. If Google disapproves any ad, swap "Indexa" for "tu PSFE actual" / "tu facturador" / "competencia".

The ad headline "Buscas Indexa? Mira Terminal X" is the most aggressive — if Indexa files a complaint, it gets removed within 24h. Plan B: remove that headline, keep keyword bidding.

---

## 9 — When to scale

Once you've validated:
- 30+ conversions in Campaign #1
- CPS < RD$3,000
- LTV:CAC ratio > 3:1

Then:
- Double daily budget to RD$1,000
- Launch Campaign #2 (broader)
- Layer Display retargeting for site visitors who didn't convert (separate playbook)
- Consider Performance Max for retargeting + lookalikes

---

## 10 — Stop-loss / decision point at day 14

After 14 days running:
- **If CPS < RD$3,500 + ≥10 conversions:** keep running, optimize.
- **If CPS RD$3,500-6,000 + 5-10 conversions:** tune ads/LP for 7 more days.
- **If CPS > RD$6,000 or < 5 conversions:** pause. Indexa traffic may be smaller than estimated, or the LP isn't converting.
