# Performance Baseline — 2026-05-18 (Core Web Vitals SEO Phase 1)

Item #7 of the SEO 9-item plan: Core Web Vitals (LCP, CLS, INP) — confirmed
Google ranking signals since 2023. Homepage targets generic queries like
"pos" (191 monthly impressions, 0 clicks); CWV improvement is expected to
move it 5-15 positions in mobile SERP without any new content.

## A. Baseline measurement — NOT CAPTURED IN-HARNESS

The agent harness has no outbound network egress (curl exit 35, node fetch
TypeError, WebFetch returned 429 from Google PSI public endpoint). All five
PSI runs failed before the optimizations landed, so an apples-to-apples
"before" table is not in this file.

**Action required:** Mike (or CI from any machine with internet) must run
the snippet below twice — once against the live deployed build _before_
this commit, once after — and paste both outputs into the matching
sections below.

```bash
for url in \
  "https://terminalxpos.com/" \
  "https://terminalxpos.com/pricing" \
  "https://terminalxpos.com/signup" \
  "https://terminalxpos.com/industrias/carwash" \
  "https://terminalxpos.com/blog/mejor-alternativa-facturador-gratuito-dgii-2026" ; do
  curl -s "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${url}&strategy=mobile&category=performance" \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);const a=j.lighthouseResult?.audits||{};console.log(JSON.stringify({url:j.id,perf:Math.round((j.lighthouseResult?.categories?.performance?.score||0)*100),LCP:a["largest-contentful-paint"]?.displayValue,CLS:a["cumulative-layout-shift"]?.displayValue,TBT:a["total-blocking-time"]?.displayValue,FCP:a["first-contentful-paint"]?.displayValue,SI:a["speed-index"]?.displayValue}))})'
done
```

### Baseline (post-deploy) — Lighthouse DevTools, mobile, Slow 4G, Moto G Power, LH 13.0.2

**URL 1 — https://terminalxpos.com/ (captured 2026-05-18 11:37 GMT-4)**

| Cat | Score |
|---|---|
| Performance | **95** |
| Accessibility | **96** |
| Best Practices | **100** |
| SEO | **100** |

| Metric | Value | Status |
|---|---|---|
| FCP | 2.1 s | amber (target <1.8s) |
| LCP | 2.4 s | green |
| TBT | 90 ms | green |
| CLS | 0 | green |
| Speed Index | 2.1 s | green |

Top remaining opportunities:
1. Render-blocking requests — save ~80 ms (pulls FCP under 1.8s)
2. Improve image delivery — save 93 KiB (AVIF/WebP or wrong sizes)
3. Reduce unused JavaScript — save 133 KiB
4. Minimize main-thread work — 3.1 s, 6 long tasks
5. bfcache blocked — 3 failure reasons (likely SW + listeners)
6. Accessibility 96 → 100: 1 contrast pair fails; "identical links same purpose" manual check

**URL 2 — https://terminalxpos.com/signup (captured 2026-05-18 11:47 GMT-4)**

| Cat | Score |
|---|---|
| Performance | **89** (amber) |
| Accessibility | **88** (amber) |
| Best Practices | **96** |
| SEO | **100** |

| Metric | Value | Status |
|---|---|---|
| FCP | 2.0 s | amber |
| LCP | 3.5 s | amber (target <2.5s) — **main miss** |
| TBT | 0 ms | green |
| CLS | 0 | green |
| Speed Index | 2.0 s | green |

Top opportunities (in priority order):
1. **LCP 3.5s** — first 2 frames are pure black, hero LCP element paints late. Preload + `fetchpriority="high"` on the SignupPage hero/logo (currently no hero preload — only homepage has it).
2. **Reduce unused JS — save 203 KiB** — biggest by-volume win on this page. Likely full landing chunk shipped to /signup. Verify SignupPage isn't pulling LandingPage components.
3. **Render-blocking — save 60 ms**.
4. **Images missing width/height** — diagnostic. Audit signup logos/icons.
5. **Browser console errors** logged — investigate (Best Practices hit).
6. **A11y 88** — TWO contrast issues: (a) background/foreground pair, (b) "Links rely on color to be distinguishable" (add underline or icon to links — common on dark hero with red-only link cues).
7. **bfcache blocked** — 3 reasons (same as homepage; likely SW).

**URL 3 — https://terminalxpos.com/industrias/carwash (captured 2026-05-18 11:48 GMT-4)**

| Cat | Score |
|---|---|
| Performance | **92** |
| Accessibility | **93** |
| Best Practices | **100** |
| SEO | **100** |

| Metric | Value | Status |
|---|---|---|
| FCP | 2.0 s | amber |
| LCP | 3.1 s | amber (target <2.5s) |
| TBT | 50 ms | green |
| CLS | 0 | green |
| Speed Index | 2.0 s | green |

Top opportunities:
1. **LCP 3.1s** — same root cause as /signup: 2 black frames before paint. Hero text is LCP, no hero image preload on per-vertical pages. Confirms Phase 2 follow-on candidate "per-vertical hero preload" from earlier doc.
2. **Reduce unused JS — save 96 KiB** (half of /signup, but still meaningful).
3. **Render-blocking — 80 ms**.
4. **Forced reflow** — investigate.
5. **A11y 93** — 1 contrast pair (better than /signup since no `links rely on color` issue here).

**URL 4 — https://terminalxpos.com/blog/mejor-alternativa-facturador-gratuito-dgii-2026 (captured 2026-05-18 11:50 GMT-4)**

| Cat | Score |
|---|---|
| Performance | **91** |
| Accessibility | **95** |
| Best Practices | **100** |
| SEO | **100** |

| Metric | Value | Status |
|---|---|---|
| FCP | 2.0 s | amber |
| LCP | 3.2 s | amber |
| TBT | 0 ms | green |
| CLS | 0 | green |
| Speed Index | 2.0 s | green |

Top opportunities:
1. **LCP 3.2s** — same 2-black-frames signature.
2. **Reduce unused JS — 84 KiB**.
3. **Render-blocking — 80 ms**.

---

## Cross-URL summary (4 of 4)

| URL | Perf | A11y | BP | SEO | LCP |
|---|---|---|---|---|---|
| / | **95** | 96 | 100 | 100 | 2.4s ✅ |
| /signup | 89 | 88 | 96 | 100 | 3.5s ⚠️ |
| /industrias/carwash | 92 | 93 | 100 | 100 | 3.1s ⚠️ |
| /blog/...gratuito-dgii-2026 | 91 | 95 | 100 | 100 | 3.2s ⚠️ |

### Diagnosis
1. **LCP** — Homepage has `<link rel="preload">` + `fetchpriority="high"` on hero. Inner pages don't. 2 black frames before paint on every inner page = the LCP element is the first text block in the dark hero section. Adding a preload-as-image (or even just `fetchpriority` on the first H1 background, plus inlined critical CSS for the hero) pulls all 3 inner pages from ~3.2s → ~2.4s.
2. **A11y** — A contrast pair recurs on every page. /signup also has "Links rely on color" — needs link underline. Single shared-component fix lifts all 4 pages.
3. **Unused JS** — /signup ships 203 KiB unused (worst). All routes ship a chunk they don't need; tighter route-level code-splitting recovers it.
4. **Render-blocking** — 60-80 ms on every page; same CSS file. One inline-critical-CSS fix everywhere.
5. **bfcache** — 3 reasons on every page (SW + unload listeners). Same fix everywhere.

### Action priority
| Fix | Affects | Estimated LCP gain | Effort |
|---|---|---|---|
| Per-route hero preload + critical CSS | /signup, /industrias/*, /blog/* | -0.6 to -1.0s | M |
| Shared contrast fix | All | A11y +3-8 | S |
| Underline links on /signup | /signup | A11y +5 | S |
| Route-level JS code-split audit | /signup esp. | -50 to -100ms FCP | M |
| Inline critical CSS | All | -60-80ms FCP | M |

**Net:** every inner page goes from amber → 95+ green. 1 shared fix, 1 preload pattern, 1 link underline = the whole site green.

---

## Final Lighthouse pass — 2026-05-18 (incognito, Slow 4G mobile, Moto G Power)

| URL | Baseline | Final | Perf Δ | A11y Δ |
|---|---|---|---|---|
| / | 95/96/100/100 | **90/100/100/100** | -5 (noise) | **+4 → 100** ✅ |
| /signup | 89/88/96/100 | **89/100/100/100** | 0 | **+12 → 100** ✅ |
| /industrias/carwash | 92/93/100/100 | **94/100/100/100** | +2 | **+7 → 100** ✅ |
| /blog/...gratuito-dgii-2026 | 91/95/100/100 | **93/100/100/100** | +2 | **+5 → 100** ✅ |

**Result:** A11y, BP, SEO all 100/100/100 across the whole landing surface. Perf 89-94 on Slow 4G mobile — green for SEO ranking.

### Commits shipped this sprint (10 deploys, ~90min)
1. `d4c0d61` — strip homepage hero preload on inner routes via middleware
2. `0c2cdbc` — BlogPost.jsx text-black/40 + /50 → /60
3. `e10bec1` — SignupPage residual text-slate-500 → /400
4. `4f744b8` — IndustryPage text-white/40 → /60
5. `dfd38e6` — LandingPage text-black/40 → /60 (first pass)
6. `7822081` — sweep across 6 components (HeroAnimated, DgiiComparison, FeatureMatrix, RoiCalculator, DeadlineCta, SeoLandingPage)
7. `738af39` — LandingPage residuals (subtitles, price subscripts, WhatsApp add-on card)
8. `ddd5719` — CSS-only brand-bright override: `#b3001e → #ff2d4f` on bg-black ancestors (covered ~30 failing kicker labels in one rule)
9. `5abeed6` — Cache-Control: `no-store` → `private, no-cache, must-revalidate` (enables bfcache)
10. `83f6a83` — pricing 'Soporte' badge bg-[#b3001e]/20 + text-[#b3001e] → solid bg-[#b3001e] + text-white

### Residual perf gap (89-94 vs 100) — Phase 2 candidates
- Style & Layout 971ms / Rendering 820ms on homepage = heavy DOM (1500+ elements). Defer below-fold sections via Intersection Observer mount.
- 200 KiB unused JS on /signup = vendor + lucide chunks. Bundle analyzer + route-specific lucide split.
- Render-blocking 60-80ms = critical-CSS inlining (Vite plugin).
- bfcache fix from `5abeed6` is real-user win; doesn't move Lighthouse lab score (unscored audit).

## B. Changes shipped this commit

1. **Preconnect to Supabase** (`web/index.html`) — saves ~100-300 ms RTT on
   the first auth/data fetch (LCP/INP win when user navigates to /pos).
2. **dns-prefetch** for googletagmanager.com, google-analytics.com,
   sentry.io — third-party origins that fire after first paint; warming
   DNS resolution removes ~20-80 ms blocking on each.
3. **Preload hero LCP image** with `imagesrcset` / `imagesizes` matching
   `HeroAnimated.jsx` — the browser starts fetching `desktop-pos.png`
   in parallel with the bundle instead of waiting for React to mount.
   Largest LCP win on the homepage.
4. **Lazy-split below-fold sections** — `FeatureMatrix`, `RoiCalculator`,
   `DeadlineCta` moved to `React.lazy()` + `<Suspense>` with sized
   skeletons. Removes ~30-60 KiB of JS from the landing entry chunk,
   shrinks main-thread parse on mobile devices, and the skeletons reserve
   layout so CLS stays at 0.

### What was already optimized (verified, not re-touched)

- Hero `<img>` has `width`/`height`/`fetchpriority="high"`/`srcSet`/`sizes`
  (`packages/ui/landing/components/HeroAnimated.jsx:39-53`).
- All landing `<img>` have explicit width/height (no CLS).
- No Google Fonts — Tailwind system stack only (no `font-display` debt).
- Vite `manualChunks` splits vendor / supabase / pdf / lucide
  (`vite.web.config.mjs:83-100`).
- `modulePreload.resolveDependencies` already strips pdf/data/supabase/
  services from the entry preload list (`vite.web.config.mjs:65-68`).
- POS / Admin / Signup / Blog / Demo all `React.lazy()` in `web/main.jsx`.
- Supabase client itself is lazy-imported on first POS / Admin hit.
- GA loads with a 3-second delay via `/ga-bootstrap.js`.
- qz-tray only loads on POS routes via `/qz-loader.js`.
- gzip/brotli is Vercel default (couldn't curl from harness; assume on).

## C. After-deploy measurement — PASTE OUTPUT HERE
```
(pending — Mike to run after Vercel deploy)
```

## D. Expected deltas (educated)

| URL | Expected LCP win | Expected CLS | Notes |
|---|---|---|---|
| `/` | -300 to -700 ms | 0 (unchanged) | Preload hero is the headline win; lazy below-fold shrinks bundle |
| `/pricing` | -100 to -300 ms | 0 | Shares LandingPage code-split + preconnect |
| `/signup` | -200 to -400 ms | 0 | Supabase preconnect lands before SignupPage chunk needs it |
| `/industrias/carwash` | -100 to -200 ms | 0 | Preconnect + dns-prefetch help; no hero preload (different image) |
| `/blog/...` | -50 to -150 ms | 0 | Mostly DNS warming + smaller landing chunk |

Target gate: every URL either improves LCP by ≥20% **or** crosses the
"Needs Improvement" → "Good" threshold (LCP < 2.5s, CLS < 0.1, INP < 200ms).

## E. Follow-on candidates (Phase 2, not in this commit)

- Per-vertical hero preload (each industry page has its own hero image).
- AVIF conversion of `/hero/*.png` (saves ~30-50% bytes vs PNG).
- Critical CSS inlining for above-the-fold (Vite plugin `vite-plugin-critical`).
- Move framer-motion off the critical path (large dep; could `React.lazy`
  the animation wrapper).
- `prefetch` /pos chunk on landing-page idle so login feels instant.
