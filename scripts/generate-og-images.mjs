// Generate per-route OG images at build time.
//
// Why static (not @vercel/og): we are at 9/12 Vercel Hobby functions.
// Static PNG generation via sharp adds no runtime cost and keeps the function
// budget intact. Output goes into web/public/og/, served as a static asset
// straight from Vercel CDN with long cache.
//
// Run with: node scripts/generate-og-images.mjs
// Re-run after editing ROUTES (or any title text) and commit the new PNGs.

import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'web', 'public', 'og');
mkdirSync(OUT_DIR, { recursive: true });

const W = 1200, H = 630;
const CRIMSON = '#b3001e';

// Each entry → one PNG. Filename = `${key}.png`.
// Keep h1 ≤ 56 chars and eyebrow ≤ 32 chars to avoid line-wrap blowing the box.
const ROUTES = [
  // Spanish industries
  { key: 'industrias-facturacion',   eyebrow: 'FACTURACIÓN ELECTRÓNICA',  h1: 'Reemplaza el Facturador Gratuito DGII' },
  { key: 'industrias-carwash',       eyebrow: 'POS PARA CARWASH',          h1: 'Cola en vivo, comisiones, memberships' },
  { key: 'industrias-tiendas',       eyebrow: 'POS PARA TIENDAS Y RETAIL', h1: 'Una plataforma. 8 tipos de tienda.' },
  { key: 'industrias-restaurantes',  eyebrow: 'POS PARA RESTAURANTES',     h1: 'KDS, mesas, propinas. Listo para servir.' },
  { key: 'industrias-mecanica',      eyebrow: 'POS PARA TALLERES',         h1: 'Órdenes de trabajo y bahías de servicio' },
  { key: 'industrias-salon',         eyebrow: 'POS PARA SALONES',          h1: 'Citas, estilistas, comisiones' },
  { key: 'industrias-concesionario', eyebrow: 'POS PARA CONCESIONARIOS',   h1: 'Vende más autos con menos papel' },
  { key: 'industrias-prestamos',     eyebrow: 'PRÉSTAMOS Y EMPEÑOS',       h1: 'Préstamos, empeños y cobranza' },
  { key: 'industrias-servicios',     eyebrow: 'SERVICIOS PROFESIONALES',   h1: 'Cotización, factura, cobro. Sin lío.' },
  { key: 'industrias-empresas',      eyebrow: 'NÓMINA TSS / ISR DR-2026',  h1: 'Nómina sin Excel, con cesantía 16-92' },

  // English industries
  { key: 'en-industries-facturacion',   eyebrow: 'DGII E-INVOICING',         h1: 'Replace the DGII free invoicer' },
  { key: 'en-industries-carwash',       eyebrow: 'CARWASH POS',              h1: 'Live queue, commissions, memberships' },
  { key: 'en-industries-tiendas',       eyebrow: 'RETAIL POS',               h1: 'One platform. Eight kinds of store.' },
  { key: 'en-industries-restaurantes',  eyebrow: 'RESTAURANT POS',           h1: 'KDS, tables, tips. Ready for service.' },
  { key: 'en-industries-mecanica',      eyebrow: 'AUTO REPAIR POS',          h1: 'Work orders and service bays' },
  { key: 'en-industries-salon',         eyebrow: 'SALON & BARBER POS',       h1: 'Appointments, stylists, commissions' },
  { key: 'en-industries-concesionario', eyebrow: 'AUTO DEALERSHIP POS',      h1: 'Sell more cars with less paper' },
  { key: 'en-industries-prestamos',     eyebrow: 'LOANS & PAWNSHOP',         h1: 'Loans, pawn and collections' },
  { key: 'en-industries-servicios',     eyebrow: 'PROFESSIONAL SERVICES POS', h1: 'Quote, invoice, charge. No hassle.' },
  { key: 'en-industries-empresas',      eyebrow: 'PAYROLL TSS / ISR DR-2026', h1: 'Payroll without Excel, Law 16-92 ready' },

  // Pricing + signup
  { key: 'pricing',     eyebrow: 'PRECIOS',  h1: 'Desde RD$995/mes. 7 días gratis.' },
  { key: 'en-pricing',  eyebrow: 'PRICING',  h1: 'From RD$995/mo. 7-day free trial.' },
  { key: 'signup',      eyebrow: 'CREAR CUENTA', h1: '7 días gratis Pro MAX. Sin tarjeta.' },
  { key: 'en-signup',   eyebrow: 'SIGN UP',  h1: '7-day Pro MAX free. No card required.' },

  // Blog
  { key: 'blog',        eyebrow: 'BLOG',     h1: 'Facturación electrónica y POS en RD' },
  { key: 'en-blog',     eyebrow: 'BLOG',     h1: 'Electronic invoicing and POS in DR' },
  { key: 'blog-migrar-facturador-gratuito-dgii',     eyebrow: 'GUÍA · MIGRACIÓN', h1: 'Migra del Facturador Gratuito DGII en 7 días' },
  { key: 'blog-ley-32-23-explicada',                  eyebrow: 'COMPLIANCE',      h1: 'Ley 32-23 explicada para pequeños contribuyentes' },
  { key: 'blog-10-cosas-facturador-gratuito-no-dice', eyebrow: 'COMPARACIÓN',     h1: 'Las 10 cosas que el Facturador Gratuito NO te dice' },
  { key: 'en-blog-migrar-facturador-gratuito-dgii',     eyebrow: 'GUIDE · MIGRATION', h1: 'Migrate from the DGII free invoicer in 7 days' },
  { key: 'en-blog-ley-32-23-explicada',                  eyebrow: 'COMPLIANCE',       h1: 'Dominican Law 32-23 explained for small taxpayers' },
  { key: 'en-blog-10-cosas-facturador-gratuito-no-dice', eyebrow: 'COMPARISON',       h1: '10 things the DGII free invoicer will not tell you' },

  // 2026-05-03 — PAA-driven posts (Phase 5)
  { key: 'blog-mejor-alternativa-facturador-gratuito-dgii-2026',     eyebrow: 'COMPARACIÓN',        h1: 'Mejor alternativa al Facturador Gratuito DGII en 2026' },
  { key: 'blog-cuanto-cuesta-sistema-pos-republica-dominicana',      eyebrow: 'PRECIOS',            h1: 'Cuánto cuesta un sistema POS en RD en 2026' },
  { key: 'blog-mejor-pos-restaurante-republica-dominicana',          eyebrow: 'POS RESTAURANTE',    h1: 'Mejor POS para restaurante en RD en 2026' },
  { key: 'en-blog-mejor-alternativa-facturador-gratuito-dgii-2026',  eyebrow: 'COMPARISON',         h1: 'Best alternative to the DGII free invoicer in 2026' },
  { key: 'en-blog-cuanto-cuesta-sistema-pos-republica-dominicana',   eyebrow: 'PRICING',            h1: 'How much a POS system costs in DR in 2026' },
  { key: 'en-blog-mejor-pos-restaurante-republica-dominicana',       eyebrow: 'RESTAURANT POS',     h1: 'Best restaurant POS in DR in 2026' },

  // Phase 5 batch 2 — 6 PAA-driven posts
  { key: 'blog-como-funciona-facturador-gratuito-dgii',              eyebrow: 'GUÍA · FACTURADOR GRATUITO', h1: 'Cómo funciona el Facturador Gratuito DGII' },
  { key: 'blog-calendario-ley-32-23-15-mayo-2026',                    eyebrow: 'LEY 32-23 · CALENDARIO',     h1: 'Calendario Ley 32-23 — qué pasa el 15 de mayo' },
  { key: 'blog-como-ser-emisor-electronico-dgii-paso-a-paso',         eyebrow: 'GUÍA · DGII',                h1: 'Cómo ser Emisor Electrónico DGII paso a paso' },
  { key: 'blog-tipos-de-ecf-e31-e32-e33-e34-e43',                     eyebrow: 'TIPOS DE E-CF',              h1: 'E31, E32, E33, E34, E43 y cuándo usar cada uno' },
  { key: 'blog-mejor-pos-carwash-republica-dominicana',               eyebrow: 'POS CARWASH',                h1: 'Mejor POS para carwash en RD en 2026' },
  { key: 'blog-mejor-pos-tienda-colmado-republica-dominicana',        eyebrow: 'POS TIENDA · COLMADO',       h1: 'Mejor POS para tienda y colmado en RD' },
  { key: 'en-blog-como-funciona-facturador-gratuito-dgii',            eyebrow: 'GUIDE · FREE INVOICER',      h1: 'How the DGII Free Invoicer works' },
  { key: 'en-blog-calendario-ley-32-23-15-mayo-2026',                  eyebrow: 'LAW 32-23 CALENDAR',         h1: 'Law 32-23 calendar — what happens May 15' },
  { key: 'en-blog-como-ser-emisor-electronico-dgii-paso-a-paso',       eyebrow: 'GUIDE · DGII',               h1: 'Become DGII Electronic Issuer step by step' },
  { key: 'en-blog-tipos-de-ecf-e31-e32-e33-e34-e43',                   eyebrow: 'TYPES OF E-CF',              h1: 'E31, E32, E33, E34, E43 and when to use each' },
  { key: 'en-blog-mejor-pos-carwash-republica-dominicana',             eyebrow: 'CARWASH POS',                h1: 'Best carwash POS in DR in 2026' },
  { key: 'en-blog-mejor-pos-tienda-colmado-republica-dominicana',      eyebrow: 'RETAIL · BODEGA POS',        h1: 'Best retail and bodega POS in DR' },
];

// Word-wrap a single line of text into N visual lines that fit within maxChars.
// Crude but predictable — we don't need a font-metric layout engine here, we
// just need to avoid lines spilling outside the safe box.
function wrap(text, maxChars) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (candidate.length <= maxChars) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;');
}

function buildSvg({ eyebrow, h1 }) {
  const eyebrowText = escapeXml(eyebrow);
  const titleLines = wrap(h1, 28); // ~28 chars per line at 78px

  // Title block layout: vertical-center within title area (y=210..540), each line ~92px tall.
  const lineHeight = 92;
  const totalHeight = titleLines.length * lineHeight;
  const titleStartY = 360 - totalHeight / 2; // approx mid of [210..540]

  const titleSvg = titleLines
    .map((l, i) => {
      const y = titleStartY + i * lineHeight + 70; // baseline offset
      return `<text x="80" y="${y}" font-family="Inter, Arial, sans-serif" font-weight="900" font-size="78" fill="#ffffff" letter-spacing="-2">${escapeXml(l)}</text>`;
    })
    .join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <!-- background: deep black with a faint crimson radial accent -->
  <defs>
    <radialGradient id="bg" cx="85%" cy="15%" r="80%">
      <stop offset="0%" stop-color="${CRIMSON}" stop-opacity="0.22"/>
      <stop offset="55%" stop-color="${CRIMSON}" stop-opacity="0.04"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#000000"/>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- crimson rule under the eyebrow -->
  <rect x="80" y="160" width="60" height="6" fill="${CRIMSON}"/>

  <!-- eyebrow -->
  <text x="80" y="140" font-family="Inter, Arial, sans-serif" font-weight="800" font-size="22" letter-spacing="6" fill="${CRIMSON}">${eyebrowText}</text>

  <!-- h1 -->
  ${titleSvg}

  <!-- footer brand row -->
  <rect x="0" y="540" width="${W}" height="2" fill="#ffffff" opacity="0.08"/>
  <text x="80" y="595" font-family="Inter, Arial, sans-serif" font-weight="900" font-size="36" letter-spacing="4" fill="#ffffff">TERMINAL</text>
  <!-- crimson square X mark -->
  <rect x="320" y="565" width="42" height="42" rx="6" fill="${CRIMSON}"/>
  <text x="341" y="600" font-family="Inter, Arial, sans-serif" font-weight="900" font-size="32" fill="#ffffff" text-anchor="middle">X</text>
  <text x="${W - 80}" y="595" font-family="Inter, Arial, sans-serif" font-weight="700" font-size="22" letter-spacing="2" fill="#ffffff" opacity="0.55" text-anchor="end">terminalxpos.com  ·  Cert DGII #42483</text>
</svg>`;
}

let made = 0;
for (const route of ROUTES) {
  const svg = buildSvg(route);
  const outPath = resolve(OUT_DIR, `${route.key}.png`);
  await sharp(Buffer.from(svg, 'utf8'))
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  made++;
  console.log(`  ✓ ${route.key}.png`);
}
console.log(`\nGenerated ${made} OG images → ${OUT_DIR}`);
