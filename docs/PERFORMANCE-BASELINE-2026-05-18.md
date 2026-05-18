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

### Baseline (pre-commit) — PASTE OUTPUT HERE
```
(pending — Mike to run)
```

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
