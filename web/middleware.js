// Vercel Edge Middleware — CSP nonce injection for the SPA shell.
//
// Why Edge middleware (not a serverless function):
//   - Vercel Hobby is at the 12/12 function cap (see CLAUDE.md). Edge middleware
//     does NOT count against that quota.
//   - Runs at the edge with sub-ms overhead.
//
// What it does:
//   1. Generates a 16-byte cryptographically random nonce per request.
//   2. For HTML responses, fetches the static asset via Vercel's origin, swaps
//      every literal `__CSP_NONCE__` token in the body for the per-request nonce,
//      and sets a `Content-Security-Policy` header with `'strict-dynamic'` plus
//      the matching `'nonce-XXX'`.
//   3. For non-HTML routes the matcher excludes them entirely so the static
//      header in `vercel.json` keeps owning CSP for assets, /api, etc.
//
// strict-dynamic semantics:
//   - Modern browsers ignore host allowlists in script-src once a nonce +
//     strict-dynamic are present. Trust propagates via parser-inserted scripts
//     dynamically attached by the nonced bootstraps (ga-bootstrap.js, qz-loader.js).
//   - `'unsafe-inline'` is kept as the legacy fallback that compliant browsers
//     ignore — without it, CSP1/CSP2-only browsers would hard-block.
//   - `https:` is the legacy host fallback for the same reason.
//
// Deploy: lives at `web/middleware.js`. Vercel auto-detects when the project
// root is `web/` (vite.web.config.mjs sets `root: 'web'`). After build, the
// runner copies it into `dist-web/middleware.js` (see deploy script in
// CLAUDE.md → Web Deploy section).

export const config = {
  // Run only on routes that resolve to the SPA HTML shell.
  // Skip /api, static assets, sitemaps, icons, manifests, service worker.
  matcher: [
    '/((?!api/|assets/|icons/|hero/|logos/|preview/|screenshots/|_next/|.*\\.(?:js|mjs|css|png|jpg|jpeg|webp|svg|gif|ico|xml|txt|json|woff|woff2|ttf|map)$).*)',
  ],
};

function generateNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // base64 (URL-safe not required — CSP accepts standard base64)
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function buildCsp(nonce) {
  return [
    "default-src 'self'",
    // strict-dynamic: trust propagates from nonced bootstraps. unsafe-inline +
    // https: are LEGACY fallbacks that compliant browsers ignore in the
    // presence of strict-dynamic. They prevent hard-block on old browsers.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline' https:`,
    // Tailwind + injected styles still need unsafe-inline for now.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.supabase.co https://www.google-analytics.com",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://www.google-analytics.com https://www.googletagmanager.com https://region1.google-analytics.com",
    "font-src 'self' data:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export default async function middleware(request) {
  const nonce = generateNonce();
  const csp = buildCsp(nonce);

  // Forward the original request to the origin so we get the actual HTML body
  // produced by the SPA rewrite chain in vercel.json.
  const originResponse = await fetch(request);

  const contentType = originResponse.headers.get('content-type') || '';
  const isHtml = contentType.includes('text/html');

  if (!isHtml) {
    // Non-HTML — pass through with CSP header swapped in.
    const headers = new Headers(originResponse.headers);
    headers.set('Content-Security-Policy', csp);
    return new Response(originResponse.body, {
      status: originResponse.status,
      statusText: originResponse.statusText,
      headers,
    });
  }

  // HTML path — read body, inject nonce, return with CSP header.
  const body = await originResponse.text();
  const injected = body.split('__CSP_NONCE__').join(nonce);

  const headers = new Headers(originResponse.headers);
  headers.set('Content-Security-Policy', csp);
  // HTML must not be cached at the edge — nonce is per-request.
  headers.set('Cache-Control', 'no-store, must-revalidate');
  headers.delete('content-length');

  return new Response(injected, {
    status: originResponse.status,
    statusText: originResponse.statusText,
    headers,
  });
}
