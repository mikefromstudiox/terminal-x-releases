// Terminal X production POS smoke test.
// Logs into all 9 demo accounts via SupabaseAuthGate (email+password)
// then through the App-level Login (PIN 1234), then sweeps every key route.
//
// Usage: npx playwright test tests/smoke --reporter=list

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'https://terminalxpos.com';
const PASSWORD = 'Demo2026!';
const PIN = '1234';

const DEMOS = [
  { key: 'carwash',     email: 'admin@carwash.demo.terminalxpos.com',     vertical: 'carwash'      },
  { key: 'retail',      email: 'admin@retail.demo.terminalxpos.com',      vertical: 'tienda'       },
  { key: 'restaurant',  email: 'admin@restaurant.demo.terminalxpos.com',  vertical: 'restaurante'  },
  { key: 'salon',       email: 'admin@salon.demo.terminalxpos.com',       vertical: 'salon'        },
  { key: 'hybrid',      email: 'admin@hybrid.demo.terminalxpos.com',      vertical: 'hibrido'      },
  { key: 'mechanic',    email: 'admin@mechanic.demo.terminalxpos.com',    vertical: 'mecanica'     },
  { key: 'service',     email: 'admin@service.demo.terminalxpos.com',     vertical: 'servicios'    },
  { key: 'prestamos',   email: 'admin@prestamos.demo.terminalxpos.com',   vertical: 'prestamos'    },
  { key: 'dealership',  email: 'admin@dealership.demo.terminalxpos.com',  vertical: 'concesionario'},
];

// Routes — universal (apply to every demo) + vertical-specific
const UNIVERSAL_ROUTES = [
  '/pos',
  '/pos/queue',
  '/pos/clients',
  '/pos/credits',
  '/pos/reports',
  '/pos/inventory',
  '/pos/dgii',
  '/pos/cash-recon',
  '/pos/petty-cash',
  '/pos/credit-notes',
  '/pos/empleados',
  '/pos/empleados/adelantos',
  '/pos/empleados/pagos',
  '/pos/remote',
  '/pos/invoicing',
  '/pos/invoicing/create',
  '/pos/invoicing/history',
  '/pos/admin',
  '/pos/sistema',
];

const VERTICAL_ROUTES = {
  carwash:     ['/pos/memberships'],
  mechanic:    ['/pos/work-orders', '/pos/vehicles'],
  dealership:  ['/pos/vehicles'],
  salon:       ['/pos/appointments'],
  prestamos:   ['/pos/loans'],
  restaurant:  ['/pos/mesas', '/pos/menu', '/pos/kds'],
};

const RESULTS_DIR = path.join(__dirname, 'results');
const SHOTS_DIR   = path.join(__dirname, 'screenshots');
fs.mkdirSync(RESULTS_DIR, { recursive: true });
fs.mkdirSync(SHOTS_DIR,   { recursive: true });

const REPORT_PATH = path.join(__dirname, 'report.json');
function loadReport() {
  try { return JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8')); } catch { return {}; }
}
function saveReport(r) { fs.writeFileSync(REPORT_PATH, JSON.stringify(r, null, 2)); }

const safe = (s) => s.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root';

// Filter out Google Analytics / GTM noise — not app bugs
function isNoise(url) {
  if (!url) return false;
  return /google-analytics\.com|googletagmanager\.com|google\.com\/g\/collect|googleadservices\.com|doubleclick\.net|gstatic\.com/.test(url);
}
function isNoiseText(text) {
  if (!text) return false;
  return /google-analytics|googletagmanager|google\.com\/g\/collect|gtag/i.test(text);
}

async function passSupabaseGate(page, email) {
  const emailInput = page.locator('input[type="email"]').first();
  let visible = false;
  try {
    await emailInput.waitFor({ state: 'visible', timeout: 6000 });
    visible = true;
  } catch {}
  if (!visible) return false;

  await emailInput.fill(email);
  const pwInput = page.locator('input[type="password"]').first();
  await pwInput.fill(PASSWORD);
  const submit = page.locator('button[type="submit"]').first();
  if (await submit.count()) {
    await submit.click();
  } else {
    await pwInput.press('Enter');
  }
  // Wait for email gate to disappear
  await page.waitForFunction(
    () => !document.querySelector('input[type="email"]'),
    null,
    { timeout: 25_000 }
  ).catch(() => {});
  return true;
}

async function passPinGate(page) {
  // Look for the PIN keypad — buttons labelled with single digits 0-9
  // OR the password-mode link
  let pinPresent = false;
  try {
    // The PIN screen contains "Ingresa tu PIN" text
    await page.waitForFunction(
      () => /Ingresa tu PIN|Iniciar sesión con usuario/i.test(document.body.innerText || ''),
      null,
      { timeout: 8000 }
    );
    pinPresent = true;
  } catch {}
  if (!pinPresent) return false;

  // Type the PIN with the keyboard — Login.jsx attaches a window keydown listener
  for (const d of PIN.split('')) {
    await page.keyboard.press(d);
    await page.waitForTimeout(80);
  }
  // Login auto-submits at 4 digits. Wait for either redirect or PIN error.
  await page.waitForFunction(
    () => !/Ingresa tu PIN/i.test(document.body.innerText || ''),
    null,
    { timeout: 15_000 }
  ).catch(() => {});
  return true;
}

async function login(page, email) {
  await page.goto(`${BASE}/pos`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
  await passSupabaseGate(page, email);
  await page.waitForTimeout(800);
  await passPinGate(page);
  await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
  // Confirm sidebar/app shell is up
  const ok = await page.locator('aside, nav').first().isVisible().catch(() => false);
  return ok;
}

async function classifyRoute(page) {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const info = await page.evaluate(() => {
    const root = document.querySelector('#root') || document.body;
    const text = (root?.innerText || '').trim();
    const len  = text.length;
    const lower = text.toLowerCase();

    const hasPinGate = /ingresa tu pin/i.test(text);
    const hasEmailGate = !!document.querySelector('input[type="email"]');
    const hasLockKeyword =
      /disponible en pro|actualizar plan|requiere plan|función bloqueada|upgrade your plan/i.test(text);
    const hasErrorBoundary =
      /algo salió mal|something went wrong|error boundary|stack trace|unexpected error|ocurrió un error/i.test(text);
    const has404 =
      /\b404\b|no encontrado|not found|página no existe/i.test(lower);
    const hasLoader =
      /cargando|loading|please wait/i.test(lower) && len < 100;
    const hasSidebar = !!document.querySelector('aside, nav');
    const hasEmpty =
      /no hay|sin datos|sin registros|sin cola|aún no/i.test(lower) && len < 600;

    return { len, hasPinGate, hasEmailGate, hasLockKeyword, hasErrorBoundary, has404, hasLoader, hasSidebar, hasEmpty, snippet: text.slice(0, 280) };
  });

  let status = 'loaded';
  if (info.hasPinGate || info.hasEmailGate) status = 'auth_lost';
  else if (info.hasErrorBoundary || info.has404) status = 'errored';
  else if (info.hasLockKeyword) status = 'locked';
  else if (info.hasLoader) status = 'empty';
  else if (info.hasEmpty) status = 'empty';
  else if (info.len < 60) status = 'errored';
  return { status, ...info };
}

for (const demo of DEMOS) {
  test(`smoke ${demo.key} (${demo.email})`, async ({ browser }) => {
    test.setTimeout(15 * 60_000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    const consoleErrors = [];
    const networkFails = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text().slice(0, 500);
        if (!isNoiseText(text)) consoleErrors.push({ text, at: page.url() });
      }
    });
    page.on('pageerror', (err) => {
      consoleErrors.push({ text: `PAGEERROR: ${err.message}`.slice(0, 500), at: page.url() });
    });
    page.on('requestfailed', (req) => {
      const url = req.url();
      if (isNoise(url)) return;
      networkFails.push({ url: url.slice(0, 240), failure: req.failure()?.errorText, at: page.url() });
    });
    page.on('response', (res) => {
      const url = res.url();
      if (isNoise(url)) return;
      if (res.status() >= 500) {
        networkFails.push({ url: url.slice(0, 240), status: res.status(), at: page.url() });
      }
    });

    const authed = await login(page, demo.email);

    const shotDir = path.join(SHOTS_DIR, demo.key);
    fs.mkdirSync(shotDir, { recursive: true });
    try { await page.screenshot({ path: path.join(shotDir, '_auth.png'), fullPage: false }); } catch {}

    const routes = [...UNIVERSAL_ROUTES, ...(VERTICAL_ROUTES[demo.key] || [])];
    const perRoute = {};

    for (const route of routes) {
      const errCountBefore = consoleErrors.length;
      const netCountBefore = networkFails.length;
      let landedUrl = '';
      let cls = { status: 'errored', snippet: '', len: 0 };
      try {
        await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 25_000 });
        landedUrl = page.url();
        cls = await classifyRoute(page);
      } catch (e) {
        cls = { status: 'errored', snippet: `NAV_ERROR: ${e.message}`.slice(0, 240), len: 0 };
      }
      const shotPath = path.join(shotDir, `${safe(route)}.png`);
      try { await page.screenshot({ path: shotPath, fullPage: false }); } catch {}

      perRoute[route] = {
        status: cls.status,
        snippet: cls.snippet,
        bodyLen: cls.len,
        landedUrl,
        urlMatched: landedUrl.includes(route),
        newConsoleErrors: consoleErrors.slice(errCountBefore).slice(0, 5),
        newNetworkFails:  networkFails.slice(netCountBefore).slice(0, 5),
        screenshot: path.relative(path.join(__dirname, '..', '..'), shotPath).replace(/\\/g, '/'),
      };
      await page.waitForTimeout(300);
    }

    const out = {
      account: demo.email,
      key: demo.key,
      authed,
      ranAt: new Date().toISOString(),
      routes: perRoute,
      totalConsoleErrors: consoleErrors.length,
      totalNetworkFails: networkFails.length,
    };
    fs.writeFileSync(path.join(RESULTS_DIR, `${demo.key}.json`), JSON.stringify(out, null, 2));

    const r = loadReport();
    r[demo.key] = out;
    saveReport(r);

    await ctx.close();
  });
}
