// Demo walkthrough E2E — 9 demo accounts × every sidebar link on terminalxpos.com
// Captures console errors, 4xx/5xx, main content length, logout/re-login sanity.
// Emits per-account report + consolidated markdown table to user memory.
//
// Usage: npx playwright test tests/e2e/demo-walkthrough.spec.js --reporter=list

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..', '..');
const BASE      = 'https://terminalxpos.com';
const PASSWORD  = 'Demo2026!';
const PIN       = '1234';

const DEMOS = [
  { key: 'carwash',    email: 'admin@carwash.demo.terminalxpos.com'    },
  { key: 'retail',     email: 'admin@retail.demo.terminalxpos.com'     },
  { key: 'restaurant', email: 'admin@restaurant.demo.terminalxpos.com' },
  { key: 'salon',      email: 'admin@salon.demo.terminalxpos.com'      },
  { key: 'hybrid',     email: 'admin@hybrid.demo.terminalxpos.com'     },
  { key: 'mechanic',   email: 'admin@mechanic.demo.terminalxpos.com'   },
  { key: 'service',    email: 'admin@service.demo.terminalxpos.com'    },
  { key: 'prestamos',  email: 'admin@prestamos.demo.terminalxpos.com'  },
  { key: 'dealership', email: 'admin@dealership.demo.terminalxpos.com' },
];

const RESULTS_DIR    = path.join(ROOT, 'tests', 'e2e', 'results');
const MEMORY_REPORT  = 'C:\\Users\\City\\.claude\\projects\\A--Studio-X-HUB-Terminal-X\\memory\\project_demo_e2e_20260419.md';
const LOCAL_REPORT   = path.join(ROOT, 'tests', 'e2e', 'report.json');
fs.mkdirSync(RESULTS_DIR, { recursive: true });

const safe = (s) => s.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root';

function isNoiseUrl(url) {
  if (!url) return false;
  // Analytics + font CDNs + harmless probes
  if (/google-analytics\.com|googletagmanager\.com|google\.com\/g\/collect|googleadservices\.com|doubleclick\.net|gstatic\.com|fonts\.googleapis|fonts\.gstatic/i.test(url)) return true;
  // /api/validate HEAD/GET 405 is a harmless SW/browser probe (documented in project_csp_strict_dynamic_outage.md context)
  if (/\/api\/validate(\?|$)/i.test(url)) return true;
  return false;
}
function isNoiseText(text) {
  if (!text) return false;
  if (/google-analytics|googletagmanager|google\.com\/g\/collect|gtag|Failed to load resource.*gstatic/i.test(text)) return true;
  // Harmless probe noise
  if (/\/api\/validate.*(405|Method Not Allowed)/i.test(text)) return true;
  // CSP violations against analytics already handled above; ignore console-only GA chatter
  if (/\[GA\]|Google Analytics/i.test(text)) return true;
  return false;
}

async function passSupabaseGate(page, email) {
  const emailInput = page.locator('input[type="email"]').first();
  try { await emailInput.waitFor({ state: 'visible', timeout: 8000 }); }
  catch { return false; }
  await emailInput.fill(email);
  const pw = page.locator('input[type="password"]').first();
  await pw.fill(PASSWORD);
  const submit = page.locator('button[type="submit"]').first();
  if (await submit.count()) await submit.click();
  else await pw.press('Enter');
  await page.waitForFunction(
    () => !document.querySelector('input[type="email"]'),
    null, { timeout: 25_000 }
  ).catch(() => {});
  return true;
}

async function passPinGate(page) {
  try {
    await page.waitForFunction(
      () => /Ingresa tu PIN|Iniciar sesión con usuario/i.test(document.body.innerText || ''),
      null, { timeout: 10_000 }
    );
  } catch { return false; }
  for (const d of PIN.split('')) {
    await page.keyboard.press(d);
    await page.waitForTimeout(80);
  }
  await page.waitForFunction(
    () => !/Ingresa tu PIN/i.test(document.body.innerText || ''),
    null, { timeout: 15_000 }
  ).catch(() => {});
  return true;
}

async function fullLogin(page, email) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto(`${BASE}/pos`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await passSupabaseGate(page, email);
    await page.waitForTimeout(1200);
    await passPinGate(page);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    const ok = await page.locator('aside').first().isVisible().catch(() => false);
    if (ok) return true;
    // Wipe and retry once
    await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} });
    await page.waitForTimeout(1500);
  }
  return false;
}

// Expand every collapsible parent in the sidebar so nested NavLinks render.
async function expandSidebarCollapsibles(page) {
  try {
    // Click every chevron/caret toggle up to 3 passes
    for (let pass = 0; pass < 3; pass++) {
      const clicked = await page.evaluate(() => {
        const aside = document.querySelector('aside');
        if (!aside) return 0;
        const btns = Array.from(aside.querySelectorAll('button'));
        let n = 0;
        for (const b of btns) {
          const aria = b.getAttribute('aria-expanded');
          if (aria === 'false') { b.click(); n++; continue; }
          // Fallback: buttons containing a rotated chevron icon
          const hasChevron = b.querySelector('svg');
          const label = (b.innerText || '').trim();
          // Only click top-level parent labels — heuristic: short label, has chevron, not "Colapsar"
          if (hasChevron && label && label.length < 24 && !/colapsar|soporte|reportar|cerrar/i.test(label)) {
            // Skip if already followed by visible children (has sibling ul/div with <a>)
            const next = b.nextElementSibling;
            if (next && next.querySelector('a[href^="/pos"]')) continue;
            b.click(); n++;
          }
        }
        return n;
      });
      if (!clicked) break;
      await page.waitForTimeout(250);
    }
  } catch {}
}

// Collect sidebar links in-page, filtered to /pos/* hrefs, deduped.
// Falls back to a canonical route list if the sidebar exposes too few anchors.
const FALLBACK_ROUTES = [
  { href: '/pos',                    label: 'POS' },
  { href: '/pos/queue',              label: 'Cola' },
  { href: '/pos/clients',            label: 'Clientes' },
  { href: '/pos/credits',            label: 'Creditos' },
  { href: '/pos/reports',            label: 'Reportes' },
  { href: '/pos/inventory',          label: 'Inventario' },
  { href: '/pos/dgii',               label: 'DGII' },
  { href: '/pos/cash-recon',         label: 'Cuadre' },
  { href: '/pos/petty-cash',         label: 'Caja Chica' },
  { href: '/pos/credit-notes',       label: 'Notas de Credito' },
  { href: '/pos/empleados',          label: 'Empleados' },
  { href: '/pos/empleados/adelantos',label: 'Adelantos' },
  { href: '/pos/empleados/pagos',    label: 'Pagos' },
  { href: '/pos/remote',             label: 'Remoto' },
  { href: '/pos/invoicing',          label: 'Facturacion' },
  { href: '/pos/invoicing/create',   label: 'Crear Factura' },
  { href: '/pos/invoicing/history',  label: 'Historial' },
  { href: '/pos/admin',              label: 'Admin' },
  { href: '/pos/sistema',            label: 'Sistema' },
  { href: '/pos/memberships',        label: 'Membresias' },
  { href: '/pos/work-orders',        label: 'Ordenes' },
  { href: '/pos/vehicles',           label: 'Vehiculos' },
  { href: '/pos/appointments',       label: 'Citas' },
  { href: '/pos/loans',              label: 'Prestamos' },
  { href: '/pos/mesas',              label: 'Mesas' },
  { href: '/pos/menu-builder',       label: 'Menu Builder' },
  { href: '/kds',                    label: 'KDS' },
];
// Routes that are not real top-level (handled as sub-nav / tabs inside parent screens) — exclude from sweep
const HARNESS_EXCLUDE = new Set([
  '/pos/kds',
  '/pos/menu',
  '/pos/empleados/adelantos',
  '/pos/empleados/pagos',
]);

async function collectSidebarLinks(page) {
  await expandSidebarCollapsibles(page);
  const fromDom = await page.evaluate(() => {
    const aside = document.querySelector('aside') || document.querySelector('nav');
    if (!aside) return [];
    const anchors = Array.from(aside.querySelectorAll('a[href]'));
    const seen = new Set();
    const out = [];
    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      if (!href.startsWith('/pos') && !href.startsWith('/kds')) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      const label = (a.innerText || a.textContent || '').trim().slice(0, 60) || href;
      out.push({ href, label });
    }
    return out;
  });
  // If sidebar only exposed a handful, union with fallback (limited to /pos routes).
  if (fromDom.length < 8) {
    const seen = new Set(fromDom.map(l => l.href));
    for (const f of FALLBACK_ROUTES) if (!seen.has(f.href)) fromDom.push(f);
  }
  // Filter harness-known bad URLs
  return fromDom.filter(l => !HARNESS_EXCLUDE.has(l.href));
}

async function tryLogout(page) {
  // 1) click any button/link that says Cerrar sesión / Salir / Logout
  const candidates = [
    'text=/Cerrar sesión/i',
    'text=/Salir/i',
    'text=/Logout/i',
    'button[aria-label*="logout" i]',
    'button[title*="salir" i]',
  ];
  for (const sel of candidates) {
    const loc = page.locator(sel).first();
    if (await loc.count().catch(() => 0)) {
      try {
        await loc.click({ timeout: 3000 });
        await page.waitForTimeout(1200);
        // confirm dialog?
        const yes = page.locator('text=/Sí|Confirmar|Cerrar sesión/i').first();
        if (await yes.count().catch(() => 0)) {
          await yes.click({ timeout: 2000 }).catch(() => {});
        }
        await page.waitForTimeout(800);
        return true;
      } catch {}
    }
  }
  // 2) fallback: wipe storage and reload
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} });
  await page.goto(`${BASE}/pos`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  return false;
}

test.describe.configure({ mode: 'serial' });

const globalFindings = {};

for (const demo of DEMOS) {
  test(`demo walkthrough ${demo.key}`, async ({ browser }) => {
    test.setTimeout(20 * 60_000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    const consoleErrors = [];
    const networkFails  = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text().slice(0, 500);
      if (isNoiseText(text)) return;
      consoleErrors.push({ text, at: page.url() });
    });
    page.on('pageerror', (err) => {
      consoleErrors.push({ text: `PAGEERROR: ${err.message}`.slice(0, 500), at: page.url() });
    });
    page.on('requestfailed', (req) => {
      const url = req.url();
      if (isNoiseUrl(url)) return;
      networkFails.push({ url: url.slice(0, 240), failure: req.failure()?.errorText, status: 'failed', at: page.url() });
    });
    page.on('response', (res) => {
      const url = res.url();
      if (isNoiseUrl(url)) return;
      const s = res.status();
      if (s >= 400) networkFails.push({ url: url.slice(0, 240), status: s, at: page.url() });
    });

    const shotDir = path.join(RESULTS_DIR, demo.key);
    fs.mkdirSync(shotDir, { recursive: true });

    // ---- First login ----
    const authed = await fullLogin(page, demo.email);
    try { await page.screenshot({ path: path.join(shotDir, '_auth.png') }); } catch {}

    const pages = {};
    let links = [];

    if (authed) {
      try { await page.goto(`${BASE}/pos`, { waitUntil: 'domcontentloaded' }); } catch {}
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      links = await collectSidebarLinks(page);

      for (const link of links) {
        const errBefore = consoleErrors.length;
        const netBefore = networkFails.length;
        let pathname = '';
        let bodyLen  = 0;
        let hasMain  = false;
        let navOk    = true;
        try {
          await page.goto(`${BASE}${link.href}`, { waitUntil: 'domcontentloaded', timeout: 25_000 });
          await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
          await page.waitForTimeout(900);
          const info = await page.evaluate(() => {
            const root = document.querySelector('main')
                      || document.querySelector('#root > div > div:last-child')
                      || document.querySelector('#root') || document.body;
            const text = (root?.innerText || '').trim();
            const sidebarEl = document.querySelector('[data-sidebar]') || document.querySelector('aside') || document.querySelector('nav');
            const navLinkCount = sidebarEl ? sidebarEl.querySelectorAll('a[href]').length : 0;
            const hasSidebar = !!sidebarEl && navLinkCount >= 5;
            // Real error surfaces: red alert, toast-error, NotFound component, 404/500 text
            const bodyText = (document.body?.innerText || '');
            const hasErrorBanner = !!document.querySelector('[role="alert"].error, .bg-red-500, .bg-red-600, [data-error-banner]')
                                || /404\s*-\s*not found|500\s*-\s*server error|algo sal.o mal|página no encontrada/i.test(bodyText);
            return {
              pathname: location.pathname,
              len: text.length,
              hasMain: !!document.querySelector('main'),
              hasSidebar,
              navLinkCount,
              hasErrorBanner,
            };
          });
          pathname = info.pathname;
          bodyLen  = info.len;
          hasMain  = info.hasMain;
          var hasSidebar = info.hasSidebar;
          var hasErrorBanner = info.hasErrorBanner;
          var navLinkCount = info.navLinkCount;
        } catch (e) {
          navOk = false;
          pathname = link.href;
          var hasSidebar = false;
          var hasErrorBanner = false;
          var navLinkCount = 0;
        }

        const newConsole = consoleErrors.slice(errBefore);
        const newNet     = networkFails.slice(netBefore);
        const n4xx5xx    = newNet.filter(n => typeof n.status === 'number' && n.status >= 400).length;

        // OK if (bodyLen>700 OR sidebar has >=5 links) AND no actual error banner
        const renderOk = !hasErrorBanner && (bodyLen > 700 || hasSidebar);
        const pass = navOk && renderOk && newConsole.length === 0 && n4xx5xx === 0;
        if (!pass) {
          try { await page.screenshot({ path: path.join(shotDir, `${safe(link.href)}.png`) }); } catch {}
        }

        pages[link.href] = {
          label: link.label,
          pathname,
          navOk,
          bodyLen,
          hasSidebar,
          hasErrorBanner,
          navLinkCount,
          hasContent: bodyLen > 700 || hasSidebar,
          consoleErrorsNew: newConsole.length,
          networkFailsNew:  newNet.length,
          http4xx5xxNew:    n4xx5xx,
          pass,
          sampleConsole: newConsole.slice(0, 3),
          sampleNet:     newNet.slice(0, 3),
        };
      }
    }

    // ---- Logout + re-login sanity ----
    let loggedOut = false;
    let loginReachable = false;
    let noFailedFetch = true;
    let reLoginOk = false;
    try {
      loggedOut = await tryLogout(page);
      await page.goto(`${BASE}/pos`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(1500);
      const bodyText = await page.evaluate(() => document.body?.innerText || '');
      loginReachable = !!(await page.locator('input[type="email"]').count().catch(() => 0))
                    || /Ingresa tu PIN/i.test(bodyText);
      noFailedFetch = !/failed to fetch/i.test(bodyText);
      // re-login
      reLoginOk = await fullLogin(page, demo.email);
    } catch (e) {
      consoleErrors.push({ text: `LOGOUT_FLOW: ${e.message}`, at: page.url() });
    }

    const summary = {
      account: demo.email,
      key: demo.key,
      authed,
      ranAt: new Date().toISOString(),
      sidebarLinkCount: links.length,
      pages,
      logout: { loggedOut, loginReachable, noFailedFetch, reLoginOk },
      totals: {
        consoleErrors: consoleErrors.length,
        networkFails:  networkFails.length,
      },
    };
    fs.writeFileSync(path.join(shotDir, 'report.json'), JSON.stringify(summary, null, 2));
    globalFindings[demo.key] = summary;
    try {
      const prior = fs.existsSync(LOCAL_REPORT) ? JSON.parse(fs.readFileSync(LOCAL_REPORT, 'utf8')) : {};
      prior[demo.key] = summary;
      fs.writeFileSync(LOCAL_REPORT, JSON.stringify(prior, null, 2));
    } catch {}

    await ctx.close();
  });
}

test.afterAll(async () => {
  // Build consolidated markdown from LOCAL_REPORT (handles retries/partial runs)
  let data = {};
  try { data = JSON.parse(fs.readFileSync(LOCAL_REPORT, 'utf8')); } catch {}
  const keys = Object.keys(data);
  if (!keys.length) return;

  // Union of all page hrefs seen across demos
  const allPages = new Set();
  for (const k of keys) for (const p of Object.keys(data[k].pages || {})) allPages.add(p);
  const pageList = Array.from(allPages).sort();

  const lines = [];
  lines.push('---');
  lines.push('name: Demo walkthrough E2E — 2026-04-19');
  lines.push('description: Per-account × per-sidebar-page pass/fail matrix from tests/e2e/demo-walkthrough.spec.js against terminalxpos.com.');
  lines.push('type: project');
  lines.push('---');
  lines.push('');
  lines.push(`Ran: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Authentication + Logout');
  lines.push('');
  lines.push('| Account | Authed | Logout Reached Login | No "failed to fetch" | Re-login OK | Console Errs | Network Fails |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const k of keys) {
    const s = data[k];
    lines.push(`| ${s.key} | ${s.authed ? 'PASS' : 'FAIL'} | ${s.logout?.loginReachable ? 'PASS' : 'FAIL'} | ${s.logout?.noFailedFetch ? 'PASS' : 'FAIL'} | ${s.logout?.reLoginOk ? 'PASS' : 'FAIL'} | ${s.totals?.consoleErrors ?? 0} | ${s.totals?.networkFails ?? 0} |`);
  }
  lines.push('');
  lines.push('## Sidebar Pages — per account');
  lines.push('');
  lines.push('Cell = `pass` | `FAIL(ceN/netN)` where ceN = new console errors, netN = new 4xx/5xx or failed requests. `-` = link not present for that vertical.');
  lines.push('');
  const header = ['Page', ...keys].join(' | ');
  lines.push(`| ${header} |`);
  lines.push('|' + new Array(keys.length + 1).fill('---').join('|') + '|');
  for (const href of pageList) {
    const row = [href];
    for (const k of keys) {
      const p = data[k].pages?.[href];
      if (!p) { row.push('-'); continue; }
      if (p.pass) row.push('pass');
      else row.push(`FAIL(ce${p.consoleErrorsNew}/net${p.http4xx5xxNew || p.networkFailsNew})`);
    }
    lines.push(`| ${row.join(' | ')} |`);
  }
  lines.push('');
  lines.push('## Notable errors (first 3 per failing page)');
  lines.push('');
  for (const k of keys) {
    const s = data[k];
    const fails = Object.entries(s.pages || {}).filter(([, v]) => !v.pass);
    if (!fails.length) continue;
    lines.push(`### ${k}`);
    for (const [href, v] of fails) {
      lines.push(`- **${href}** — bodyLen=${v.bodyLen}, navOk=${v.navOk}`);
      for (const c of (v.sampleConsole || [])) lines.push(`  - console: \`${(c.text || '').replace(/`/g, "'").slice(0, 160)}\``);
      for (const n of (v.sampleNet     || [])) lines.push(`  - net: [${n.status || n.failure}] ${n.url}`);
    }
    lines.push('');
  }

  try {
    fs.mkdirSync(path.dirname(MEMORY_REPORT), { recursive: true });
    fs.writeFileSync(MEMORY_REPORT, lines.join('\n'), 'utf8');
  } catch (e) {
    // fallback: drop next to local report
    fs.writeFileSync(path.join(ROOT, 'tests', 'e2e', 'project_demo_e2e_20260419.md'), lines.join('\n'), 'utf8');
  }
});
