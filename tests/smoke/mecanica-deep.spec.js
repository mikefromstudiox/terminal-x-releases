// Deep E2E audit — MECANICA vertical
// Walks sidebar, exercises WorkOrders + ServiceBays + Vehicles,
// probes WO->ticket bridge, logout/re-login, captures errors.

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'https://terminalxpos.com';
const EMAIL = 'admin@mechanic.demo.terminalxpos.com';
const PASSWORD = 'Demo2026!';
const PIN = '1234';

const OUT_DIR = path.resolve(__dirname, '..', '..', 'test-results', 'mecanica');
fs.mkdirSync(OUT_DIR, { recursive: true });

const ROUTES = [
  '/pos', '/pos/queue', '/pos/work-orders', '/pos/vehicles',
  '/pos/clients', '/pos/credits', '/pos/inventory', '/pos/reports',
  '/pos/dgii', '/pos/cash-recon', '/pos/petty-cash', '/pos/credit-notes',
  '/pos/empleados', '/pos/empleados/adelantos', '/pos/empleados/pagos',
  '/pos/remote', '/pos/invoicing', '/pos/invoicing/create',
  '/pos/invoicing/history', '/pos/admin', '/pos/sistema',
];

const safe = (s) => s.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root';
const isNoise = (u) => !!u && /google-analytics|googletagmanager|google\.com\/g\/collect|googleadservices|doubleclick|gstatic/.test(u);
const isNoiseText = (t) => !!t && /google-analytics|googletagmanager|gtag/i.test(t);

async function passSupabaseGate(page) {
  const e = page.locator('input[type="email"]').first();
  try { await e.waitFor({ state: 'visible', timeout: 6000 }); } catch { return false; }
  await e.fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  const btn = page.locator('button[type="submit"]').first();
  if (await btn.count()) await btn.click(); else await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('input[type="email"]'), null, { timeout: 25000 }).catch(() => {});
  return true;
}
async function passPinGate(page) {
  try {
    await page.waitForFunction(() => /Ingresa tu PIN/i.test(document.body.innerText || ''), null, { timeout: 8000 });
  } catch { return false; }
  for (const d of PIN.split('')) { await page.keyboard.press(d); await page.waitForTimeout(80); }
  await page.waitForFunction(() => !/Ingresa tu PIN/i.test(document.body.innerText || ''), null, { timeout: 15000 }).catch(() => {});
  return true;
}
async function login(page) {
  await page.goto(`${BASE}/pos`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await passSupabaseGate(page);
  await page.waitForTimeout(800);
  await passPinGate(page);
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  return page.locator('aside, nav').first().isVisible().catch(() => false);
}
async function classify(page) {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1200);
  return page.evaluate(() => {
    const root = document.querySelector('#root') || document.body;
    const text = (root?.innerText || '').trim();
    const len = text.length, lower = text.toLowerCase();
    const hasPinGate = /ingresa tu pin/i.test(text);
    const hasEmailGate = !!document.querySelector('input[type="email"]');
    const hasLock = /disponible en pro|actualizar plan|requiere plan|función bloqueada/i.test(text);
    const hasErr = /algo salió mal|something went wrong|error boundary|unexpected error|ocurrió un error/i.test(text);
    const has404 = /\b404\b|no encontrado|not found/i.test(lower);
    const hasLoader = /cargando|loading/i.test(lower) && len < 100;
    const hasEmpty = /no hay|sin datos|sin registros|aún no/i.test(lower) && len < 600;
    // i18n leak: English strings in Spanish-locale UI (excluding proper nouns / known words)
    const i18nLeak = /\b(Loading|Save|Cancel|Delete|Submit|Create|Edit|Search|Next|Back|Close|Confirm)\b/.test(text) &&
                     !/Guardar|Cancelar|Eliminar|Crear/.test(text);
    return { len, hasPinGate, hasEmailGate, hasLock, hasErr, has404, hasLoader, hasEmpty, i18nLeak, snippet: text.slice(0, 400) };
  });
}

test('mecanica deep audit', async ({ browser }) => {
  test.setTimeout(20 * 60_000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const consoleErrors = [], networkFails = [];
  page.on('console', (m) => { if (m.type() === 'error') { const t = m.text().slice(0, 500); if (!isNoiseText(t)) consoleErrors.push({ t, at: page.url() }); } });
  page.on('pageerror', (e) => consoleErrors.push({ t: `PAGEERROR: ${e.message}`.slice(0, 500), at: page.url() }));
  page.on('requestfailed', (r) => { const u = r.url(); if (!isNoise(u)) networkFails.push({ u: u.slice(0, 240), failure: r.failure()?.errorText, at: page.url() }); });
  page.on('response', (r) => { const u = r.url(); if (isNoise(u)) return; if (r.status() >= 400) networkFails.push({ u: u.slice(0, 240), status: r.status(), at: page.url() }); });

  const authed = await login(page);
  try { await page.screenshot({ path: path.join(OUT_DIR, '00_auth.png') }); } catch {}

  // Sidebar sweep
  const routeReports = {};
  for (const route of ROUTES) {
    const eb = consoleErrors.length, nb = networkFails.length;
    let cls = { status: 'errored', snippet: '', len: 0 }, landed = '';
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 25000 });
      landed = page.url();
      const c = await classify(page);
      let status = 'loaded';
      if (c.hasPinGate || c.hasEmailGate) status = 'auth_lost';
      else if (c.hasErr || c.has404) status = 'errored';
      else if (c.hasLock) status = 'locked';
      else if (c.hasLoader || c.hasEmpty) status = 'empty';
      else if (c.len < 60) status = 'errored';
      cls = { status, ...c };
    } catch (e) { cls = { status: 'errored', snippet: `NAV: ${e.message}`, len: 0 }; }
    try { await page.screenshot({ path: path.join(OUT_DIR, `route_${safe(route)}.png`) }); } catch {}
    routeReports[route] = {
      status: cls.status, bodyLen: cls.len, i18nLeak: !!cls.i18nLeak,
      snippet: cls.snippet, landed,
      newErrors: consoleErrors.slice(eb).slice(0, 3),
      newNetFails: networkFails.slice(nb).slice(0, 3),
    };
    await page.waitForTimeout(250);
  }

  // Deep probe: WorkOrders
  const woProbe = {};
  try {
    await page.goto(`${BASE}/pos/work-orders`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT_DIR, 'wo_main.png'), fullPage: true });
    woProbe.title = await page.locator('h1, h2').first().innerText().catch(() => '');
    woProbe.hasCreateBtn = await page.locator('button:has-text("Nueva"), button:has-text("Crear"), button:has-text("+")').count();
    woProbe.hasBayTab = await page.locator('text=/bah[íi]a|bay|service bay/i').count();
    woProbe.tableRows = await page.locator('table tbody tr, [role="row"]').count();
    // text markers
    woProbe.bodyText = (await page.locator('body').innerText()).slice(0, 2000);
    // Try opening create modal
    const createBtn = page.locator('button:has-text("Nueva"), button:has-text("Crear"), button:has-text("Nueva Orden")').first();
    if (await createBtn.count()) {
      await createBtn.click().catch(() => {});
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(OUT_DIR, 'wo_create_modal.png'), fullPage: true });
      woProbe.modalOpened = await page.locator('[role="dialog"], .modal, form').count() > 0;
      woProbe.modalText = (await page.locator('body').innerText()).slice(0, 2500);
      // Look for labor/parts/vehicle fields
      woProbe.hasLaborField = /labor|mano de obra|horas/i.test(woProbe.modalText);
      woProbe.hasPartsField = /parte|repuesto|piezas/i.test(woProbe.modalText);
      woProbe.hasPlateField = /placa|matr[íi]cula|plate/i.test(woProbe.modalText);
      woProbe.hasVehicleField = /veh[íi]culo|vehicle|auto|carro/i.test(woProbe.modalText);
      woProbe.hasCobrarBridge = /cobrar|facturar|convertir|ticket/i.test(woProbe.modalText);
      // Close modal
      await page.keyboard.press('Escape').catch(() => {});
    }
  } catch (e) { woProbe.error = e.message; }

  // Deep probe: Vehicles / Bays
  const bayProbe = {};
  try {
    await page.goto(`${BASE}/pos/vehicles`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT_DIR, 'vehicles.png'), fullPage: true });
    bayProbe.vehiclesText = (await page.locator('body').innerText()).slice(0, 1500);
    bayProbe.rows = await page.locator('table tbody tr, [role="row"]').count();
  } catch (e) { bayProbe.error = e.message; }

  // Service Bays — look on /pos or dedicated route
  const serviceBaysProbe = {};
  try {
    // Try clicking Bahías from sidebar
    const bayLink = page.locator('a:has-text("Bah"), a:has-text("Bay"), a:has-text("Bahías")').first();
    if (await bayLink.count()) {
      await bayLink.click();
      await page.waitForTimeout(1500);
      serviceBaysProbe.landedUrl = page.url();
      await page.screenshot({ path: path.join(OUT_DIR, 'service_bays.png'), fullPage: true });
      serviceBaysProbe.text = (await page.locator('body').innerText()).slice(0, 1500);
    } else {
      serviceBaysProbe.found = false;
    }
  } catch (e) { serviceBaysProbe.error = e.message; }

  // Probe: WO -> ticket bridge from POS side (is there an "Importar WO" button on /pos?)
  const bridgeProbe = {};
  try {
    await page.goto(`${BASE}/pos`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(1500);
    const posText = (await page.locator('body').innerText()).slice(0, 3000);
    bridgeProbe.posHasWoImport = /orden de trabajo|work order|importar wo|desde wo|wo #|#wo/i.test(posText);
    bridgeProbe.posHasPlateInput = /placa|matr[íi]cula/i.test(posText);
    await page.screenshot({ path: path.join(OUT_DIR, 'pos_main.png'), fullPage: true });
    bridgeProbe.posSnippet = posText.slice(0, 800);
  } catch (e) { bridgeProbe.error = e.message; }

  // Logout + re-login
  const logoutProbe = {};
  try {
    const logoutBtn = page.locator('button:has-text("Salir"), button:has-text("Cerrar sesi"), button:has-text("Logout")').first();
    if (await logoutBtn.count()) {
      await logoutBtn.click().catch(() => {});
      await page.waitForTimeout(2000);
      await page.screenshot({ path: path.join(OUT_DIR, 'after_logout.png') });
      logoutProbe.afterLogoutUrl = page.url();
      logoutProbe.sawLogin = await page.locator('input[type="email"], text=/Ingresa tu PIN/i').count() > 0;
      // Re-login
      const ok = await login(page);
      logoutProbe.reloginOk = ok;
      await page.screenshot({ path: path.join(OUT_DIR, 'after_relogin.png') });
    } else {
      logoutProbe.logoutBtnFound = false;
    }
  } catch (e) { logoutProbe.error = e.message; }

  const report = {
    account: EMAIL,
    ranAt: new Date().toISOString(),
    authed,
    totals: { consoleErrors: consoleErrors.length, networkFails: networkFails.length },
    consoleErrorSample: consoleErrors.slice(0, 25),
    networkFailSample: networkFails.slice(0, 25),
    routes: routeReports,
    woProbe,
    bayProbe,
    serviceBaysProbe,
    bridgeProbe,
    logoutProbe,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  await ctx.close();
});
