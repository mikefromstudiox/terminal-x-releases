// Vercel Edge Middleware — CSP nonce injection + per-route SEO meta + JSON-LD.
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
//   3. For HTML routes that map to a known marketing page, swaps in
//      route-specific <title>, <meta description>, <link canonical>, OG/Twitter
//      tags, and reciprocal es-DO ↔ en hreflang alternates (URL pair, not
//      `?lang=` parameter — Google's preferred pattern).
//   4. Injects route-specific JSON-LD:
//        - BreadcrumbList on every per-route page (auto-generated from path)
//        - Article + FAQPage on blog posts (when post.faq exists)
//        - Product per tier (6 entries) + AggregateOffer on /pricing
//        - Service per /industrias/:slug
//        - WebSite + SearchAction on '/' homepage (primes sitelink searchbox)
//      Prices are canonical per memory/reference_pricing_locked_20260512.md —
//      do NOT regress to 995 / 2,990 / 5,490 / 9,990.
//   5. For non-HTML routes the matcher excludes them entirely so the static
//      header in `vercel.json` keeps owning CSP for assets, /api, etc.

export const config = {
  matcher: [
    '/((?!api/|assets/|icons/|hero/|logos/|preview/|screenshots/|_next/|.*\\.(?:js|mjs|css|png|jpg|jpeg|webp|svg|gif|ico|xml|txt|json|woff|woff2|ttf|map)$).*)',
  ],
};

function generateNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

const SITE = 'https://terminalxpos.com';

// Industries — names drive BreadcrumbList JSON-LD per language.
const INDUSTRY_NAMES_ES = {
  facturacion: 'Facturación electrónica DGII',
  carwash: 'POS para carwash',
  tiendas: 'POS para tiendas y retail',
  restaurantes: 'POS para restaurantes',
  mecanica: 'POS para mecánica y talleres',
  salon: 'POS para salones y barberías',
  concesionario: 'POS para concesionarios',
  prestamos: 'Préstamos y empeños',
  servicios: 'POS para servicios profesionales',
  empresas: 'Nómina TSS / INFOTEP / ISR',
  contabilidad: 'Software para contadores y firmas contables',
  food_truck: 'POS para food trucks',
  carniceria: 'POS para carnicerías',
  hybrid: 'POS híbrido multi-vertical',
};
const INDUSTRY_NAMES_EN = {
  facturacion: 'DGII e-invoicing',
  carwash: 'Carwash POS',
  tiendas: 'Retail POS',
  restaurantes: 'Restaurant POS',
  mecanica: 'Auto repair POS',
  salon: 'Salon & barber POS',
  concesionario: 'Auto dealership POS',
  prestamos: 'Loans & pawnshop',
  servicios: 'Professional services POS',
  empresas: 'Payroll TSS / INFOTEP / ISR',
  contabilidad: 'Software for accountants and accounting firms',
  food_truck: 'Food truck POS',
  carniceria: 'Butcher shop POS',
  hybrid: 'Hybrid multi-vertical POS',
};

// SEO Phase-1 landing pages — power FAQPage JSON-LD. Keys = pathname.
// Curated Q&A (NEVER auto-extracted from body), source lives in
// packages/ui/landing/data/seoLandingPages.js — this mirror exists only so the
// middleware (edge runtime, no shared imports) can emit schema.org without
// pulling the whole landing bundle.
const SEO_LANDING_FAQS = {
  '/sistema-pos': [
    { q: '¿Qué es un sistema POS?',
      a: 'Un sistema POS es el software con el que tu negocio registra ventas, emite factura, descarga inventario, calcula ITBIS y reporta a DGII. Reemplaza la caja registradora tradicional y se integra con impresora térmica, lector de código de barras y gaveta de dinero.' },
    { q: '¿Cuánto cuesta un sistema POS en República Dominicana?',
      a: 'En RD el rango va desde RD$2,490/mes (Terminal X Pro, plan básico de cajero único) hasta RD$15,000/mes en sistemas legacy con cobro por comprobante. Terminal X Pro PLUS (RD$4,490) y Pro MAX (RD$6,990) incluyen e-CF DGII directo sin cobro por factura.' },
    { q: '¿Necesito un POS para mi negocio si soy pequeño?',
      a: 'Si emites factura, sí. Después del 15 de mayo de 2026 toda la pequeña y micro empresa debe emitir e-CF según Ley 32-23. El Facturador Gratuito de DGII te resuelve hasta ~150 facturas al mes; arriba de eso, necesitas un POS profesional.' },
    { q: '¿El POS funciona sin internet?',
      a: 'Terminal X sí, durante hasta 72 horas. Sigues cobrando, imprimiendo recibos y registrando ventas en local. Cuando vuelve internet, los e-CF se firman y envían a DGII con el indicador de envío diferido (IndicadorEnvioDiferido=1).' },
    { q: '¿Puedo emitir e-CF directamente desde el POS?',
      a: 'Sí, Terminal X es Emisor Electrónico certificado DGII (#42483). No necesitas PSFE intermediario. Firmamos tus e-CF con tu certificado Viafirma y los enviamos directo a DGII. Sin cobro por comprobante, sin límite mensual.' },
    { q: '¿Cuánto tarda en quedar instalado?',
      a: 'En el plan Pro la configuración la haces tú en menos de 30 minutos. En Pro PLUS y Pro MAX nuestro equipo te configura todo de forma remota: catálogo, NCFs, empleados, comisiones, impresora. Onboarding del mismo día con Pro MAX.' },
    { q: '¿Cómo migro desde mi POS actual (StarSISA, WilPOS, otro)?',
      a: 'Importamos tu catálogo de productos, clientes, secuencias de NCF y registro de empleados. Para clientes Pro PLUS y Pro MAX la migración la hace nuestro equipo. Tenemos guías específicas para migrar desde StarSISA, WilPOS y el Facturador Gratuito de DGII.' },
  ],
  '/software-pos': [
    { q: '¿Qué stack usa el software POS de Terminal X?',
      a: 'React 19 + Vite 5 + Tailwind 4 en frontend. Electron 41 con better-sqlite3-multiple-ciphers (SQLCipher) para escritorio. PWA con Service Worker + IndexedDB para web. Postgres 17 vía Supabase. xml-crypto v6 para firma e-CF.' },
    { q: '¿Tiene API pública?',
      a: 'Sí, endpoints autenticados con Supabase JWT en /api/panel y /api/fe. Crea ventas, consulta inventario, lanza webhooks. Para integración profunda con tu ERP/CRM/e-commerce, el equipo Pro MAX arma el connector específico.' },
    { q: '¿Cómo funciona la sincronización multi-terminal?',
      a: 'Bidireccional cada 5 minutos + en cada evento de venta, pago o anulación. UUID compartido (supabase_id) en todas las tablas. Last-Write-Wins por updated_at + trigger.' },
    { q: '¿Dónde se guarda el certificado .p12?',
      a: 'Solo en local, cifrado at-rest con SQLCipher derivado de tu HWID. Nunca lo subimos a nuestro servidor. La firma e-CF se hace en tu propia máquina con xml-crypto.' },
    { q: '¿Funciona en Mac, Linux o solo Windows?',
      a: 'El instalador empaquetado va para Windows. En Mac empaquetamos DMG bajo pedido (Pro MAX). En Linux usamos la PWA web — funciona idéntico en Chrome/Firefox.' },
    { q: '¿Cómo manejan el modo offline con e-CF?',
      a: 'Ley 32-23 permite hasta 72 horas de envío diferido (IndicadorEnvioDiferido=1). Terminal X encola el e-CF localmente, sigue imprimiendo factura, y al volver la red firma y envía con el indicador puesto.' },
    { q: '¿Cómo aseguran el aislamiento entre clientes (multi-tenant)?',
      a: 'Postgres RLS (Row Level Security) en cada tabla con políticas que filtran por business_id leído del JWT app_metadata. Auditoría completa antes de cada release.' },
    { q: '¿Hay export de datos si quiero salirme?',
      a: 'Sí. Cada reporte tiene export CSV. La base SQLite local es tuya. Si te vas, te llevas todo. Sin lock-in.' },
  ],
  '/alternativa-facturador-gratuito-dgii': [
    { q: '¿Por qué dejar el Facturador Gratuito si es gratis?',
      a: 'Porque deja de ser gratis cuando le sumas las horas de tu personal cargando facturas a mano, llenando 606/607 campo por campo, atendiendo errores manualmente y operando sin contingencia offline. Para 50 facturas al día el costo oculto supera de lejos los RD$490/mes de Terminal X Facturación.' },
    { q: '¿Pierdo mis secuencias de NCF si migro?',
      a: 'No. Tu RNC y tus secuencias DGII son tuyas — viven en el portal de DGII. Terminal X continúa la numeración exactamente donde el Gratuito la dejó.' },
    { q: '¿Cuánto demora la migración?',
      a: '7 días con migración guiada incluida (planes Pro PLUS y superiores). El equipo de Terminal X migra catálogo, clientes, NCFs, secuencias, certificado Viafirma y entrena a tu cajero.' },
    { q: '¿Terminal X es Emisor Electrónico Directo o intermediario?',
      a: 'Directo. Cert DGII #42483. Firmamos los e-CF con tu propio certificado Viafirma y enviamos directo a DGII sin intermediario.' },
    { q: '¿Cuánto cuesta?',
      a: 'Plan Facturación desde RD$490/mes, plan Plus a RD$990/mes con todos los e-CF incluidos sin cobro por comprobante. Anual con 15% OFF. 7 días gratis sin tarjeta.' },
    { q: '¿Y si no me convence, puedo volver al Gratuito?',
      a: 'Sí. Tu RNC y tus secuencias siguen activas en DGII. Puedes apagar Terminal X cuando quieras. Sin contrato.' },
    { q: '¿Maneja el formato 606 y 607?',
      a: 'Sí, exportados de un clic listos para subir al portal de DGII. Sin armarlos a mano en Excel cada mes.' },
    { q: '¿Funciona si vendo en USD?',
      a: 'Sí. Multi-moneda DOP + USD con tasa configurable. El Gratuito solo opera en pesos.' },
  ],
  '/facturador-electronico-dgii': [
    { q: '¿Qué es un facturador electrónico DGII?',
      a: 'Es la herramienta con la que tu negocio emite Comprobantes Fiscales Electrónicos (e-CF) firmados digitalmente y los envía a DGII en línea, cumpliendo Ley 32-23. Reemplaza al NCF impreso en papel.' },
    { q: '¿Cuál es la diferencia entre un facturador electrónico y un POS?',
      a: 'El facturador electrónico se enfoca en emitir e-CF. Un POS además registra ventas, descarga inventario, calcula comisiones, imprime recibo térmico y maneja caja chica. Terminal X ofrece ambos.' },
    { q: '¿Tengo que usar el Facturador Gratuito de DGII?',
      a: 'No. La Ley 32-23 te obliga a emitir e-CF, no a usar una herramienta específica. Puedes elegir entre el Facturador Gratuito de DGII, un PSFE intermediario o un Emisor Electrónico Directo como Terminal X.' },
    { q: '¿Terminal X es PSFE o Emisor Directo?',
      a: 'Emisor Electrónico Directo. Cert DGII #42483. Firmamos con tu propio Viafirma y enviamos directo a DGII sin intermediario.' },
    { q: '¿Tengo que comprar el certificado Viafirma aparte?',
      a: 'En planes Plus+ el Viafirma viene incluido (valor RD$2,360/año). En plan Pro o Facturación básico lo gestionas tú con la autoridad certificadora.' },
    { q: '¿Qué pasa el 15 de mayo de 2026?',
      a: 'Entra en vigencia obligatoria la Ley 32-23 para pequeñas, micro y no clasificadas. A partir de esa fecha, toda factura emitida sin e-CF queda fuera de norma.' },
    { q: '¿Qué pasa si se cae internet en plena venta?',
      a: 'Terminal X imprime y registra la venta en local, encola el e-CF, y al volver internet lo firma y envía con IndicadorEnvioDiferido=1 (envío diferido 72h permitido por DGII).' },
    { q: '¿Cómo migro desde el Facturador Gratuito?',
      a: 'En 7 días el equipo de Terminal X migra catálogo, clientes, secuencias y certificado Viafirma sin que tu operación se detenga. Guía en /blog/migrar-facturador-gratuito-dgii.' },
  ],
};

// Blog posts — power Article schema. Keys = slug (same in both languages).
const BLOG_POSTS = {
  'migrar-facturador-gratuito-dgii': {
    headline_es: 'Cómo migrar del Facturador Gratuito de DGII en 7 días',
    excerpt_es: 'Plan día por día para mover tu RNC del Facturador Gratuito a Terminal X sin perder secuencias ni romper el cierre mensual.',
    headline_en: 'How to migrate from the DGII free e-invoicer in 7 days',
    excerpt_en: 'Day-by-day plan to move your RNC off the DGII free invoicer onto Terminal X without losing sequence numbers or breaking month-end close.',
    datePublished: '2026-04-25',
    image: '/blog/og/migrar-facturador-gratuito.png',
    readMinutes: 8,
  },
  'ley-32-23-explicada': {
    headline_es: 'Ley 32-23 explicada para pequeños contribuyentes',
    excerpt_es: 'Qué es el e-CF, qué pasa el 15 de mayo de 2026 y los 10 tipos de comprobante electrónico que tu negocio debe conocer.',
    headline_en: 'Dominican Law 32-23 explained for small taxpayers',
    excerpt_en: 'What an e-CF is, what happens on May 15, 2026, and the 10 electronic receipt types every Dominican business needs to know.',
    datePublished: '2026-04-25',
    image: '/blog/og/ley-32-23-explicada.png',
    readMinutes: 10,
  },
  '10-cosas-facturador-gratuito-no-dice': {
    headline_es: 'Las 10 cosas que el Facturador Gratuito de DGII NO te dice',
    excerpt_es: 'El cap puede cambiar por aviso, no hay API, no hay app móvil y los formatos 606 y 607 se llenan a mano. La lista completa, sin filtros.',
    headline_en: '10 things the DGII free e-invoicer will not tell you',
    excerpt_en: 'The monthly cap can shift by notice, there is no API, no mobile app, and forms 606 / 607 must be filled by hand. The full list, unfiltered.',
    datePublished: '2026-04-25',
    image: '/blog/og/10-cosas-gratuito.png',
    readMinutes: 12,
  },
  // PAA-driven posts (2026-05-03). Each carries `faq` so the middleware can
  // inject a FAQPage JSON-LD block alongside the Article schema, doubling
  // SERP eligibility (rich snippet + expandable Q&A).
  'mejor-alternativa-facturador-gratuito-dgii-2026': {
    headline_es: '¿Cuál es la mejor alternativa al Facturador Gratuito DGII en 2026?',
    excerpt_es: 'Pasaste las 150 facturas del Facturador Gratuito o estás por pasarlas. Comparamos las 5 alternativas reales certificadas en RD: precios, qué incluyen y cuál conviene.',
    headline_en: 'What is the best alternative to the DGII Free Invoicer in 2026?',
    excerpt_en: 'You hit the 150-invoice cap of the DGII Free Invoicer or you are about to. We compare the 5 real certified alternatives in DR: pricing, features and which one fits.',
    datePublished: '2026-05-03',
    image: '/og/blog-mejor-alternativa-facturador-gratuito-dgii-2026.png',
    readMinutes: 9,
    faq: [
      { q_es: '¿Qué pasa cuando paso las 150 facturas del Facturador Gratuito?', a_es: 'Llegas al cap mensual y no puedes emitir más e-CF en ese mes. La DGII puede ajustar el cap por aviso informativo, así que no es estable como base de operación. Lo recomendable es migrar antes de chocar con el techo.', q_en: 'What happens when I pass the 150-invoice cap of the DGII Free Invoicer?', a_en: 'You hit the monthly cap and cannot issue more e-CFs that month. DGII can adjust the cap by informational notice, so it is not stable as an operational base. Migrate before hitting the ceiling.' },
      { q_es: '¿Puedo migrar del Facturador Gratuito sin perder mis secuencias?', a_es: 'Sí. Las secuencias e-CF son por RNC, no por proveedor. Al migrar, tu nuevo sistema continúa la secuencia desde donde quedó la última emitida en el Facturador Gratuito.', q_en: 'Can I migrate from the Free Invoicer without losing my sequences?', a_en: 'Yes. e-CF sequences are per RNC, not per provider. When you migrate, your new system continues the sequence from where the last issuance ended.' },
      { q_es: '¿Las alternativas al Facturador Gratuito incluyen el certificado Viafirma?', a_es: 'Depende. Terminal X lo incluye y lo renueva automáticamente. La mayoría de los PSFE te exigen comprarlo aparte (RD$2,360 al año).', q_en: 'Do the alternatives to the Free Invoicer include the Viafirma certificate?', a_en: 'It depends. Terminal X includes it and auto-renews. Most PSFEs make you buy it separately (RD$2,360/year).' },
      { q_es: '¿Cuánto tarda configurar una alternativa al Facturador Gratuito?', a_es: 'Con configuración remota guiada, una sesión de 30 a 60 minutos. La postulación a DGII como Emisor Electrónico tarda 2 a 5 días hábiles.', q_en: 'How long does setting up an alternative to the Free Invoicer take?', a_en: 'With remote guided setup, a 30 to 60 minute session. DGII Electronic Issuer postulation takes 2 to 5 business days.' },
      { q_es: '¿Necesito desconectar mi RNC del Facturador Gratuito antes de migrar?', a_es: 'No. El RNC sigue habilitado como Emisor Electrónico (esa habilitación es del RNC, no del Facturador Gratuito). Puedes mantener el Facturador Gratuito como respaldo.', q_en: 'Do I need to disconnect my RNC from the Free Invoicer before migrating?', a_en: 'No. The RNC stays enabled as Electronic Issuer (that enablement belongs to the RNC, not to the Free Invoicer). You can keep the Free Invoicer as a contingency backup.' },
    ],
  },
  'cuanto-cuesta-sistema-pos-republica-dominicana': {
    headline_es: '¿Cuánto cuesta un sistema POS en República Dominicana en 2026?',
    excerpt_es: 'Software, hardware, certificado Viafirma, soporte, capacitación. Te damos el rango real por tipo de negocio (carwash, restaurante, tienda, salón, concesionario).',
    headline_en: 'How much does a POS system cost in the Dominican Republic in 2026?',
    excerpt_en: 'Software, hardware, Viafirma certificate, support, training. We give you the real cost range by business type (carwash, restaurant, retail, salon, dealership).',
    datePublished: '2026-05-03',
    image: '/og/blog-cuanto-cuesta-sistema-pos-republica-dominicana.png',
    readMinutes: 8,
    faq: [
      { q_es: '¿Cuánto cuesta un POS para pequeño negocio en RD?', a_es: 'Para un negocio chico (1 caja, 1–3 empleados): software desde RD$995/mes + hardware RD$20,000–RD$30,000 una sola vez. Total año 1: RD$32,000–RD$45,000.', q_en: 'How much does a POS for a small business cost in DR?', a_en: 'For a small business (1 register, 1–3 employees): software from RD$995/mo + hardware RD$20,000–RD$30,000 one-time. Year-1 total: RD$32,000–RD$45,000.' },
      { q_es: '¿Cuánto cuesta la impresora térmica y la gaveta?', a_es: 'Impresora térmica 80mm USB: RD$8,000–RD$18,000 (Epson TM-T20 es lo más confiable). Gaveta: RD$3,000–RD$8,000. Combo típico: RD$15,000.', q_en: 'How much do the thermal printer and cash drawer cost?', a_en: 'USB 80mm thermal printer: RD$8,000–RD$18,000 (Epson TM-T20 is the most reliable). Cash drawer: RD$3,000–RD$8,000. Typical combo: RD$15,000.' },
      { q_es: '¿Hay POS sin comisión por transacción en RD?', a_es: 'Sí. Terminal X es Emisor Electrónico Directo a DGII — no cobra por comprobante. Los PSFE intermediarios cobran RD$5–RD$15 por cada e-CF.', q_en: 'Are there POS without per-transaction fees in DR?', a_en: 'Yes. Terminal X is a Direct Electronic Issuer with DGII — no per-receipt fee. PSFE intermediaries charge RD$5–RD$15 per e-CF issued.' },
      { q_es: '¿Cuánto cuesta el certificado Viafirma aparte?', a_es: 'Aproximadamente RD$2,360 al año si lo compras directo. Terminal X lo incluye en todos los planes y lo renueva automáticamente.', q_en: 'How much does the Viafirma certificate cost separately?', a_en: 'Roughly RD$2,360 per year if you buy it direct from Viafirma. Terminal X includes it in every plan and auto-renews it.' },
      { q_es: '¿Pago por documento o suscripción mensual: cuál conviene?', a_es: 'Si emites menos de 50 facturas/mes, pago por documento. Si emites más de 100, suscripción mensual sin cargo por comprobante es siempre más barato. A 500 facturas/mes el ahorro es RD$2,500–RD$7,500/mes.', q_en: 'Per-document or monthly subscription: which is better?', a_en: 'Under 50 invoices/month: per-document is cheaper. Over 100: a monthly subscription with no per-receipt fee is always cheaper. At 500/month savings are RD$2,500–RD$7,500/month.' },
    ],
  },
  'como-funciona-facturador-gratuito-dgii': {
    headline_es: '¿Cómo funciona el Facturador Gratuito de DGII? Guía completa 2026',
    excerpt_es: 'Cap, requisitos, cómo solicitar acceso en Oficina Virtual, qué hace y qué no hace.',
    headline_en: 'How does the DGII Free Invoicer work? Complete 2026 guide',
    excerpt_en: 'Cap, requirements, how to request access in Oficina Virtual, what it does and does not.',
    datePublished: '2026-05-03',
    image: '/og/blog-como-funciona-facturador-gratuito-dgii.png',
    readMinutes: 8,
    faq: [
      { q_es: '¿Cuántas facturas al mes con el Facturador Gratuito?', a_es: 'Aproximadamente 150 al mes según la propia DGII. El cap puede ajustarse por aviso informativo.', q_en: 'How many invoices per month with the DGII Free Invoicer?', a_en: 'Roughly 150/month per DGII itself. The cap can shift by informational notice.' },
      { q_es: '¿Quién puede usar el Facturador Gratuito?', a_es: 'Cualquier contribuyente con RNC activo y NCF asignado. Pensado para Mipymes y profesionales independientes.', q_en: 'Who can use the DGII Free Invoicer?', a_en: 'Any taxpayer with an active RNC and assigned NCF. Built for Mipymes and independent professionals.' },
      { q_es: '¿Cuánto cuesta el Facturador Gratuito?', a_es: 'Cero pesos. 100% gratis: software, firma digital, envío a DGII y certificado incluido.', q_en: 'How much does the Free Invoicer cost?', a_en: 'Zero pesos. 100% free: software, digital signature, sending to DGII and certificate included.' },
      { q_es: '¿Cómo solicito autorización en la OFV?', a_es: 'oficinavirtual.dgii.gov.do → Facturación Electrónica → Solicitud Facturador Gratuito. Aprobación en 1 a 5 días.', q_en: 'How do I request authorization in OFV?', a_en: 'oficinavirtual.dgii.gov.do → Facturación Electrónica → Solicitud Facturador Gratuito. Approval in 1 to 5 days.' },
      { q_es: '¿Permite facturar exento o en dólares?', a_es: 'Exento sí, manual. En dólares no — solo opera en DOP.', q_en: 'Does it allow exempt or USD invoicing?', a_en: 'Exempt yes, manual. USD no — only DOP.' },
      { q_es: '¿El certificado gratuito sirve solo para el Facturador Gratuito?', a_es: 'Sí. Está vinculado al portal. Si migras necesitas un Viafirma aparte (RD$2,360/año) o uno incluido en otro plan.', q_en: 'Does the free certificate work only for the Free Invoicer?', a_en: 'Yes. It is bound to the portal. If you migrate you need a separate Viafirma (RD$2,360/year) or one included in another plan.' },
      { q_es: '¿Por qué no puedo entrar al Facturador Gratuito?', a_es: 'Causas comunes: solicitud sin aprobar, rol no asignado, alerta en RNC, o caída temporal del portal.', q_en: 'Why can I not enter the Free Invoicer?', a_en: 'Common causes: application not approved, role not assigned, RNC alert, or temporary portal outage.' },
    ],
  },
  'calendario-ley-32-23-15-mayo-2026': {
    headline_es: 'Calendario Ley 32-23: ¿qué pasa el 15 de mayo de 2026 con tu RNC?',
    excerpt_es: 'Fechas obligatorias por tipo de contribuyente, multas por no cumplir, incentivos fiscales y los 4 pasos para prepararte.',
    headline_en: 'Law 32-23 calendar: what happens on May 15, 2026 with your RNC?',
    excerpt_en: 'Mandatory dates by taxpayer type, penalties, tax incentives and the 4 steps to prepare.',
    datePublished: '2026-05-03',
    image: '/og/blog-calendario-ley-32-23-15-mayo-2026.png',
    readMinutes: 7,
    faq: [
      { q_es: '¿A quién aplica la Ley 32-23?', a_es: 'A todo contribuyente con RNC activo en RD. Sin excepción por sector o tamaño después del 15 de mayo de 2026.', q_en: 'Who does Law 32-23 apply to?', a_en: 'Every taxpayer with an active RNC in DR. No exception by sector or size after May 15, 2026.' },
      { q_es: '¿Cuándo es obligatoria para Mipymes en RD?', a_es: '15 de mayo de 2026 para pequeños, micro y no clasificados. Grandes y medianos ya cumplen desde 2024 y 2025.', q_en: 'When is it mandatory for SMBs in DR?', a_en: 'May 15, 2026 for small, micro and unclassified. Large and medium have been compliant since 2024 and 2025.' },
      { q_es: '¿Qué multas por no facturar electrónicamente?', a_es: 'Multa entre 5 y 30 salarios mínimos del sector público (RD$50,000–RD$300,000), recargos del 10% si genera ITBIS no declarado, y suspensión del RNC en reincidencia.', q_en: 'What penalties for non-compliance?', a_en: 'Fine of 5 to 30 public-sector minimum wages (RD$50,000–RD$300,000), 10% late charges if it generates undeclared ITBIS, and RNC suspension in repeat cases.' },
      { q_es: '¿Qué incentivos por implementar antes?', a_es: 'Crédito fiscal del ITBIS pagado en software/hardware certificado, deducción adicional en ISR, y tratamiento preferencial en auditorías.', q_en: 'What incentives for early adoption?', a_en: 'ITBIS tax credit on certified software/hardware, additional deduction in ISR, and preferential audit treatment.' },
      { q_es: '¿Aplica al sector público?', a_es: 'Sí. El Estado ya recibe e-CF E45. Si vendes al gobierno este tipo es obligatorio.', q_en: 'Does it apply to the public sector?', a_en: 'Yes. The State already receives E45 e-CFs. If you sell to government this type is mandatory.' },
      { q_es: '¿Qué pasa si no me adapto antes del plazo?', a_es: 'Facturas en papel quedan no autorizadas en el cruce DGII. Clientes pierden crédito fiscal. DGII da 30 días; si no, multa + recargos + posible suspensión RNC.', q_en: 'What happens if I do not adapt before the deadline?', a_en: 'Paper invoices recorded as non-authorized in the DGII cross-check. Customers lose tax credit. DGII gives 30 days; otherwise fine + late charges + possible RNC suspension.' },
    ],
  },
  'como-ser-emisor-electronico-dgii-paso-a-paso': {
    headline_es: 'Cómo ser Emisor Electrónico DGII paso a paso (Guía 2026)',
    excerpt_es: 'Los 5 pasos reales: certificado Viafirma, postulación en OFV, set de pruebas, asignación de roles y paso a producción.',
    headline_en: 'How to become a DGII Electronic Issuer step by step (2026 guide)',
    excerpt_en: 'The 5 real steps: Viafirma certificate, OFV postulation, test set, role assignment and move to production.',
    datePublished: '2026-05-03',
    image: '/og/blog-como-ser-emisor-electronico-dgii-paso-a-paso.png',
    readMinutes: 8,
    faq: [
      { q_es: '¿Qué requisitos pide la DGII para ser Emisor Electrónico?', a_es: 'RNC activo, certificado Viafirma, sistema que genere XML válido y se conecte a endpoints DGII, y postulación aprobada en OFV.', q_en: 'What requirements does DGII ask?', a_en: 'Active RNC, Viafirma certificate, system that generates valid XML and connects to DGII endpoints, and approved OFV postulation.' },
      { q_es: '¿Cómo me habilito paso a paso?', a_es: '1) Compra Viafirma. 2) Postula RNC en OFV. 3) Configura sistema. 4) Pasa los 12 sets de pruebas. 5) Asigna roles y emite primer e-CF de producción.', q_en: 'How do I enable myself step by step?', a_en: '1) Buy Viafirma. 2) Postulate RNC in OFV. 3) Configure system. 4) Pass the 12 test sets. 5) Assign roles and issue first production e-CF.' },
      { q_es: '¿Cómo obtengo el certificado digital?', a_es: 'Comprándolo a Viafirma (viafirma.com.do o 809-732-1112). RD$2,360/año. Terminal X lo incluye y administra.', q_en: 'How do I get the digital certificate?', a_en: 'By buying from Viafirma (viafirma.com.do or 809-732-1112). RD$2,360/year. Terminal X includes and manages it.' },
      { q_es: '¿Cómo paso el set de pruebas?', a_es: 'Ejecutando los 12 escenarios obligatorios contra certecf de DGII. Con sistema certificado ya está pasado. Programando solo, 2 a 4 semanas.', q_en: 'How do I pass the certification test set?', a_en: 'By executing the 12 mandatory scenarios against DGII certecf. With certified system it is done. Programming alone, 2 to 4 weeks.' },
      { q_es: '¿Necesito certificado INDOTEL?', a_es: 'No. La DGII solo exige Viafirma. INDOTEL es para otros usos.', q_en: 'Do I need an INDOTEL certificate?', a_en: 'No. DGII only requires Viafirma. INDOTEL is for other uses.' },
      { q_es: '¿Cuánto tarda la DGII en aprobar?', a_es: 'Postulación: 1 a 5 días. Pruebas con sistema certificado: 1 día. Programando solo: 2 a 4 semanas. Producción: 1 a 3 días después de pruebas.', q_en: 'How long does DGII take to approve?', a_en: 'Postulation: 1 to 5 days. Tests with certified system: 1 day. Programming alone: 2 to 4 weeks. Production: 1 to 3 days after tests.' },
    ],
  },
  'tipos-de-ecf-e31-e32-e33-e34-e43': {
    headline_es: 'Los 10 tipos de e-CF en RD: E31, E32, E33, E34, E43, E47 y cuándo usar cada uno',
    excerpt_es: 'Tabla completa de los 10 tipos de comprobante fiscal electrónico DGII con cuándo usar cada uno.',
    headline_en: 'The 10 types of e-CF in DR: E31, E32, E33, E34, E43, E47 and when to use each',
    excerpt_en: 'Complete table of the 10 electronic fiscal receipt types with when to use each.',
    datePublished: '2026-05-03',
    image: '/og/blog-tipos-de-ecf-e31-e32-e33-e34-e43.png',
    readMinutes: 7,
    faq: [
      { q_es: '¿Cuál es la diferencia entre NCF y e-CF?', a_es: 'NCF es papel impreso (prefijo B, 8 dígitos). e-CF es XML electrónico firmado digitalmente (prefijo E, 10 dígitos). Misma validez legal.', q_en: 'What is the difference between NCF and e-CF?', a_en: 'NCF is printed paper (prefix B, 8 digits). e-CF is digitally signed XML (prefix E, 10 digits). Same legal validity.' },
      { q_es: '¿Qué tipos de e-CF existen?', a_es: '10 tipos: E31, E32 (RFCE), E33, E34, E41, E43, E44, E45, E47, y ANECF.', q_en: 'What types of e-CF exist?', a_en: '10 types: E31, E32 (RFCE), E33, E34, E41, E43, E44, E45, E47, and ANECF.' },
      { q_es: '¿Qué es el código de seguridad del e-CF?', a_es: 'Los primeros 6 caracteres del SignatureValue de la firma digital (base64). Sirve para validar en el portal DGII.', q_en: 'What is the e-CF security code?', a_en: 'The first 6 characters of the SignatureValue of the digital signature (base64). Used to validate in the DGII portal.' },
      { q_es: '¿Cómo verifico un e-CF en el portal DGII?', a_es: 'Escanea el QR con el celular, o entra a ecf.dgii.gov.do/ecf/ConsultaTimbre con RNC + e-NCF + código de seguridad.', q_en: 'How do I check an e-CF in the DGII portal?', a_en: 'Scan the QR with a phone, or go to ecf.dgii.gov.do/ecf/ConsultaTimbre with RNC + e-NCF + security code.' },
      { q_es: '¿El e-CF reemplaza totalmente al NCF en papel?', a_es: 'Sí, progresivamente según calendario Ley 32-23. Después del 15 de mayo de 2026 todo contribuyente con RNC activo emite e-CF.', q_en: 'Does e-CF fully replace paper NCF?', a_en: 'Yes, progressively per Law 32-23 calendar. After May 15, 2026 every active-RNC taxpayer issues e-CF.' },
      { q_es: '¿El e-CF tiene la misma validez legal?', a_es: 'Sí. Ley 32-23 le da igual fuerza probatoria. Firma digital + código de seguridad + QR le dan trazabilidad superior al papel.', q_en: 'Does e-CF have the same legal validity?', a_en: 'Yes. Law 32-23 grants equal probative force. Digital signature + security code + QR give superior traceability over paper.' },
      { q_es: '¿Cómo emito una nota de crédito (E33 o E34)?', a_es: 'Desde tu sistema, ubica el e-CF original, selecciona "Devolución" (E34) o "Cargo adicional" (E33), elige líneas, y emite.', q_en: 'How do I issue an electronic credit note (E33 or E34)?', a_en: 'From your system, find the original e-CF, select "Return" (E34) or "Additional charge" (E33), choose lines, and issue.' },
    ],
  },
  'mejor-pos-carwash-republica-dominicana': {
    headline_es: '¿Cuál es el mejor POS para carwash en República Dominicana en 2026?',
    excerpt_es: 'Cola de servicios, comisiones por lavador, memberships, e-CF directo a DGII y modo offline. Comparación honesta para lavaderos dominicanos.',
    headline_en: 'What is the best carwash POS in the Dominican Republic in 2026?',
    excerpt_en: 'Service queue, per-washer commissions, memberships, direct DGII e-CF and offline mode. Honest comparison for Dominican carwashes.',
    datePublished: '2026-05-03',
    image: '/og/blog-mejor-pos-carwash-republica-dominicana.png',
    readMinutes: 7,
    faq: [
      { q_es: '¿Cuál es el mejor POS para car wash en RD?', a_es: 'Terminal X plan Pro (RD$2,990/mes), único POS dominicano construido específicamente para carwash con cola visual, comisiones automáticas, memberships y e-CF directo a DGII.', q_en: 'What is the best POS for carwash in DR?', a_en: 'Terminal X Pro (RD$2,990/mo), the only Dominican POS built specifically for carwash with visual queue, automatic commissions, memberships and direct DGII e-CF.' },
      { q_es: '¿Cómo manejo comisiones de lavadores?', a_es: 'Terminal X calcula la comisión automáticamente al cobrar según el lavador asignado. Soporta % o monto fijo. Multi-lavador con split.', q_en: 'How do I manage washer commissions?', a_en: 'Terminal X calculates commission automatically at checkout per assigned washer. Supports % or fixed amount. Multi-washer with split.' },
      { q_es: '¿Hay POS para carwash que emita e-CF a DGII?', a_es: 'Sí. Terminal X emite E32 (consumidor final) y E31 (flota corporativa) directos a DGII al cobrar, sin PSFE.', q_en: 'Is there a carwash POS that issues e-CF to DGII?', a_en: 'Yes. Terminal X issues E32 (final consumer) and E31 (corporate fleet) directly to DGII at checkout, no PSFE.' },
      { q_es: '¿Cuánto cuesta un sistema para car wash?', a_es: 'Software desde RD$2,990/mes (Terminal X Pro). Hardware: PC + impresora + cajón = RD$25,000 una sola vez. Total año 1: ~RD$60,880.', q_en: 'How much does a carwash invoicing system cost?', a_en: 'Software from RD$2,990/mo (Terminal X Pro). Hardware: PC + printer + drawer = RD$25,000 one-time. Year-1 total: ~RD$60,880.' },
      { q_es: '¿Qué POS de carwash funciona sin internet?', a_es: 'Terminal X funciona 100% offline (cola de 72h con reenvío diferido automático).', q_en: 'What carwash POS works without internet?', a_en: 'Terminal X works 100% offline (72-hour queue with automatic deferred resend).' },
      { q_es: '¿POS con cola de servicio y cuadre de caja?', a_es: 'Terminal X tiene cola visual con drag-to-reorder, asignación de lavador, y cuadre de caja diario con varianza por método de pago.', q_en: 'POS with service queue and cash close?', a_en: 'Terminal X has visual queue with drag-to-reorder, washer assignment, and daily cash close with per-method variance.' },
    ],
  },
  'mejor-pos-tienda-colmado-republica-dominicana': {
    headline_es: '¿Cuál es el mejor POS para tienda y colmado en República Dominicana en 2026?',
    excerpt_es: 'Inventario código de barras, fiado, ITBIS automático, e-CF directo. Terminal X con 8 sub-tipos de tienda preconfigurados.',
    headline_en: 'What is the best POS for retail and bodega in the Dominican Republic in 2026?',
    excerpt_en: 'Barcode inventory, store credit, automatic ITBIS, direct e-CF. Terminal X with 8 pre-configured store sub-types.',
    datePublished: '2026-05-03',
    image: '/og/blog-mejor-pos-tienda-colmado-republica-dominicana.png',
    readMinutes: 7,
    faq: [
      { q_es: '¿Cuál es el mejor POS para colmado en RD?', a_es: 'Terminal X Pro PLUS con sub-tipo "Colmado": fiado/libreta, cobro mensual, crédito por cliente, lista de morosos, código de barras, e-CF directo.', q_en: 'What is the best POS for a Dominican bodega?', a_en: 'Terminal X Pro PLUS with "Bodega" sub-type: store credit/libreta, monthly billing, per-customer credit, aging list, barcode, direct e-CF.' },
      { q_es: '¿POS para licorería con verificación de edad?', a_es: 'Terminal X sub-tipo "Licorería" tiene verificación de edad, depósito de envases retornables, Quick-Sell de marcas top, descuento al cobro.', q_en: 'POS for liquor store with age verification?', a_en: 'Terminal X "Liquor" sub-type has age verification, returnable bottle deposit, top-brand Quick-Sell, checkout discount.' },
      { q_es: '¿POS para farmacia con recetas y vencimientos?', a_es: 'Terminal X sub-tipo "Farmacia": tracking de recetas controladas, OTC vs RX, vencimientos por lote, reportes para Salud Pública.', q_en: 'POS for pharmacy with prescriptions and expirations?', a_en: 'Terminal X "Pharmacy" sub-type: controlled prescription tracking, OTC vs RX, lot-level expirations, Public Health reports.' },
      { q_es: '¿POS para supermercado con peso y PLU?', a_es: 'Terminal X sub-tipo "Supermercado": deli con venta por peso, códigos PLU, promociones por categoría, checkouts simultáneos.', q_en: 'POS for supermarket with weight and PLU?', a_en: 'Terminal X "Supermarket" sub-type: deli with weight pricing, PLU codes, category promotions, concurrent checkouts.' },
      { q_es: '¿POS para boutique con variantes de talla?', a_es: 'Terminal X sub-tipo "Boutique": variantes de talla y color, devoluciones y cambios, notas de crédito E34, apartados (layaway).', q_en: 'POS for boutique with size variants?', a_en: 'Terminal X "Boutique" sub-type: size and color variants, returns and exchanges, credit notes E34, layaway.' },
      { q_es: '¿Cuánto cuesta un POS para tienda en RD?', a_es: 'Software desde RD$5,490/mes (Terminal X Pro PLUS). Hardware: PC + impresora + escáner + cajón = RD$30,000 una sola vez. Total año 1: ~RD$95,880.', q_en: 'How much does a store POS cost in DR?', a_en: 'Software from RD$5,490/mo (Terminal X Pro PLUS). Hardware: PC + printer + scanner + drawer = RD$30,000 one-time. Year-1 total: ~RD$95,880.' },
    ],
  },
  'mejor-pos-restaurante-republica-dominicana': {
    headline_es: '¿Cuál es el mejor POS para restaurante en República Dominicana en 2026?',
    excerpt_es: 'KDS, mesas, propinas Ley 16-92, modo offline, e-CF directo a DGII y Pro MAX por RD$9,990/mes. Terminal X vs StarSISA, WilPOS y Visual Pyme.',
    headline_en: 'What is the best restaurant POS in the Dominican Republic in 2026?',
    excerpt_en: 'KDS, tables, Law 16-92 tips, offline mode, direct DGII e-CF and Pro MAX at RD$9,990/mo. Terminal X vs StarSISA, WilPOS and Visual Pyme.',
    datePublished: '2026-05-03',
    image: '/og/blog-mejor-pos-restaurante-republica-dominicana.png',
    readMinutes: 8,
    faq: [
      { q_es: '¿POS para restaurante que aplique el 10% de Ley 16-92 correctamente?', a_es: 'Terminal X aplica el 10% de Servicio Ley 16-92 con desglose ITBIS correcto en el ticket y en el e-CF. Configurable: incluido en consumo, agregado al subtotal, o opcional al pedir cuenta.', q_en: 'Is there a restaurant POS that applies Law 16-92 10% correctly?', a_en: 'Terminal X applies the 10% Service Charge per Law 16-92 with proper ITBIS breakout on the ticket and on the e-CF. Configurable: included, added to subtotal, or optional at bill time.' },
      { q_es: '¿POS de restaurante con KDS y manejo de mesas?', a_es: 'Sí. Terminal X tiene plano de mesas visual, cuenta abierta por mesa, KDS con cronómetro, ruteo de impresoras (cocina caliente / fría / bar), mover y juntar mesas.', q_en: 'Restaurant POS with KDS and table management?', a_en: 'Yes. Terminal X has a visual floor plan, open tabs per table, KDS with timer, per-category printer routing (hot/cold/bar), table move/merge.' },
      { q_es: '¿POS para restaurante que funcione sin internet?', a_es: 'Sí. Terminal X funciona 100% offline. Los e-CFs se encolan localmente y se envían a DGII con IndicadorEnvioDiferido cuando vuelve la conexión, hasta 72 horas.', q_en: 'Restaurant POS that works offline?', a_en: 'Yes. Terminal X works 100% offline. e-CFs queue locally and send to DGII with IndicadorEnvioDiferido when the connection is back, up to 72 hours.' },
      { q_es: '¿Cuánto cuesta un POS para restaurante en RD?', a_es: 'Software desde RD$5,490/mes (Terminal X Pro PLUS, todo incluido). Hardware: 1 PC + 2 impresoras + 1 tablet KDS = RD$45,000 una sola vez. Total año 1: ~RD$110,880.', q_en: 'How much does a restaurant POS cost in DR?', a_en: 'Software from RD$5,490/mo (Terminal X Pro PLUS, all-included). Hardware: 1 PC + 2 printers + 1 KDS tablet = RD$45,000 one-time. Year-1 total: ~RD$110,880.' },
      { q_es: '¿POS para restaurante que emita e-CF automáticamente?', a_es: 'Sí. Terminal X firma y envía el e-CF a DGII al cobrar — el mesero no hace nada extra. Si DGII está caído, encola y reenvía cuando vuelve la red.', q_en: 'Restaurant POS that issues e-CF automatically?', a_en: 'Yes. Terminal X signs and sends the e-CF to DGII at checkout — the server does nothing extra. If DGII is down, it queues and resends when the network is back.' },
    ],
  },
  // ─── Phase-1 SEO sprint blog posts (2026-05-18) — Spanish-only ───
  'cuanto-cuesta-un-pos-en-republica-dominicana': {
    headline_es: '¿Cuánto cuesta un POS en República Dominicana? Precios reales 2026',
    excerpt_es:  'Software, hardware, Viafirma y soporte. Rango real por vertical, sin promesas infladas.',
    headline_en: '¿Cuánto cuesta un POS en República Dominicana? Precios reales 2026',
    excerpt_en:  'Software, hardware, Viafirma y soporte. Rango real por vertical, sin promesas infladas.',
    datePublished: '2026-05-18',
    image: '/og-image.png',
    readMinutes: 9,
  },
  'diferencia-pos-y-facturador-gratuito-dgii': {
    headline_es: 'Diferencia entre un POS y el Facturador Gratuito de DGII (2026)',
    excerpt_es:  'Uno cumple Ley 32-23 y nada más. El otro lleva la operación completa. Cuándo basta uno y cuándo necesitas el otro.',
    headline_en: 'Diferencia entre un POS y el Facturador Gratuito de DGII (2026)',
    excerpt_en:  'Uno cumple Ley 32-23 y nada más. El otro lleva la operación completa. Cuándo basta uno y cuándo necesitas el otro.',
    datePublished: '2026-05-18',
    image: '/og-image.png',
    readMinutes: 7,
  },
  'migrar-de-starsisa-a-terminal-x': {
    headline_es: 'Cómo migrar de StarSISA a Terminal X · Guía paso a paso 2026',
    excerpt_es:  'Plan de 7 días para mover catálogo, secuencias DGII, comisiones y entrenamiento sin interrumpir la operación.',
    headline_en: 'Cómo migrar de StarSISA a Terminal X · Guía paso a paso 2026',
    excerpt_en:  'Plan de 7 días para mover catálogo, secuencias DGII, comisiones y entrenamiento sin interrumpir la operación.',
    datePublished: '2026-05-18',
    image: '/og-image.png',
    readMinutes: 10,
  },
  'pos-para-car-wash-en-rd': {
    headline_es: 'POS para Car Wash en RD · Cola, comisiones y memberships',
    excerpt_es:  'Lo que un carwash dominicano realmente necesita: cola visual, lavadores asignados, memberships y e-CF DGII directo.',
    headline_en: 'POS para Car Wash en RD · Cola, comisiones y memberships',
    excerpt_en:  'Lo que un carwash dominicano realmente necesita: cola visual, lavadores asignados, memberships y e-CF DGII directo.',
    datePublished: '2026-05-18',
    image: '/og-image.png',
    readMinutes: 8,
  },
  'que-es-un-emisor-electronico-dgii': {
    headline_es: '¿Qué es un Emisor Electrónico DGII? Guía completa 2026',
    excerpt_es:  'Diferencia entre Emisor Directo, PSFE intermediario y Facturador Gratuito. Cuál te conviene según volumen y costo.',
    headline_en: '¿Qué es un Emisor Electrónico DGII? Guía completa 2026',
    excerpt_en:  'Diferencia entre Emisor Directo, PSFE intermediario y Facturador Gratuito. Cuál te conviene según volumen y costo.',
    datePublished: '2026-05-18',
    image: '/og-image.png',
    readMinutes: 8,
  },
  'precios-pos-rd-2026': {
    headline_es: 'Precios POS en RD 2026 · Comparación completa por plan y vertical',
    excerpt_es:  'Cuánto cuesta un POS dominicano en 2026 por vertical y por plan. Terminal X, StarSISA, WilPOS, Indexa lado a lado.',
    headline_en: 'Precios POS en RD 2026 · Comparación completa por plan y vertical',
    excerpt_en:  'Cuánto cuesta un POS dominicano en 2026 por vertical y por plan. Terminal X, StarSISA, WilPOS, Indexa lado a lado.',
    datePublished: '2026-05-18',
    image: '/og-image.png',
    readMinutes: 9,
  },
};

// Industry slugs — same in both languages (URL path differs: /industrias/SLUG vs /en/industries/SLUG).
const INDUSTRY_SLUGS = Object.keys(INDUSTRY_NAMES_ES);
const BLOG_SLUGS = Object.keys(BLOG_POSTS);

// ─── Per-route meta. Spanish-language paths under /, English under /en/. ────
const ROUTE_META = {
  // ES — homepage now also injects a keyword-led title (Sprint B SEO).
  '/': {
    lang: 'es',
    title: 'Terminal X — Sistema POS y Facturación Electrónica DGII para República Dominicana',
    desc:  'Terminal X: sistema POS dominicano certificado DGII para carwash, restaurante, tienda, salón, mecánica y concesionario. e-CF directo, modo offline 72h. Desde RD$490/mes. Prueba 7 días gratis.',
  },
  '/pricing': {
    lang: 'es',
    title: 'Terminal X — Precios POS y Facturación DGII desde RD$490/mes',
    desc:  'Planes Terminal X: Facturación RD$490, Plus RD$990, Pro RD$2,490, Pro PLUS RD$4,490, Pro MAX RD$6,990. e-CF DGII directo, sin cobro por comprobante. 7 días gratis.',
  },
  '/signup': {
    lang: 'es',
    title: 'Terminal X — 7 días gratis · POS y Facturación DGII certificado en RD',
    desc:  'Activa el sistema POS dominicano en minutos. 7 días gratis Pro MAX con e-CF DGII, inventario, comisiones y nómina. Sin tarjeta. Prueba 7 días gratis.',
  },
  // Phase-1 SEO sprint landing pages (2026-05-18).
  '/sistema-pos': {
    lang: 'es',
    title: 'Terminal X — Sistema POS para República Dominicana (DGII Cert #42483)',
    desc:  'Sistema POS dominicano certificado DGII para carwash, restaurante, tienda, salón, mecánica y concesionario. e-CF directo, modo offline 72h. Prueba 7 días gratis.',
  },
  '/software-pos': {
    lang: 'es',
    title: 'Software POS DGII para RD · API, offline, SQLCipher — Terminal X',
    desc:  'Software POS técnico para RD: API REST, modo offline 72h, SQLCipher en local, sync bidireccional Postgres, e-CF firma local. Evalúa el stack en 7 días gratis.',
  },
  '/alternativa-facturador-gratuito-dgii': {
    lang: 'es',
    title: 'Alternativa al Facturador Gratuito de DGII · Terminal X desde RD$490/mes',
    desc:  'Cuando superes las 150 facturas mensuales del Facturador Gratuito DGII, migra a Terminal X: API, offline 72h, formato 606/607, multi-moneda. Desde RD$490/mes.',
  },
  '/facturador-electronico-dgii': {
    lang: 'es',
    title: 'Facturador Electrónico DGII certificado · Cert #42483 — Terminal X',
    desc:  'Facturador electrónico DGII (Cert #42483). Emite e-CF E31, E32, E33, E34 y E43 directo a DGII sin PSFE intermediario ni cobro por comprobante. Desde RD$490/mes.',
  },
  '/blog': {
    lang: 'es',
    title: 'Blog · Terminal X — Facturación electrónica y POS en RD',
    desc:  'Guías prácticas sobre Ley 32-23, Facturador Gratuito DGII, e-CF, POS para carwash, tiendas y restaurantes en República Dominicana.',
  },
  '/industrias/facturacion': { lang: 'es',
    title: 'POS para Facturación electrónica DGII en RD · Terminal X Emisor Directo',
    desc:  'Reemplaza el Facturador Gratuito DGII. e-CF E31/E32/E33/E34/E43, formatos 606/607, RNC 900K, cola offline 72h y certificado Viafirma incluido. Desde RD$490/mes.',
  },
  '/industrias/carwash': { lang: 'es',
    title: 'POS para carwash en RD · Terminal X — cola, comisiones y memberships',
    desc:  'POS para carwash dominicano: cola visual, lavadores asignados, comisiones automáticas, memberships y dashboard del dueño en vivo. Prueba 7 días gratis.',
  },
  '/industrias/tiendas': { lang: 'es',
    title: 'POS para tiendas, licorerías y colmados en RD · Terminal X',
    desc:  'POS para tiendas con código de barras, 8 sub-verticales (licorería, farmacia, colmado, supermercado, ferretería, papelería, boutique). e-CF DGII directo desde RD$2,490/mes.',
  },
  '/industrias/restaurantes': { lang: 'es',
    title: 'POS para restaurantes en RD · Terminal X — KDS, mesas y propinas',
    desc:  'POS para restaurante dominicano: mesas abiertas, KDS con cronómetro, modificadores, ruteo cocina/bar, split-bill, propinas Ley 16-92 y e-CF al instante.',
  },
  '/industrias/mecanica': { lang: 'es',
    title: 'POS para talleres y mecánica · Terminal X — órdenes y bahías',
    desc:  'Órdenes de trabajo con repuestos y mano de obra, bahías de servicio, historial vehicular por placa, conversión WO→ticket con E31 sobre RD$250K.',
  },
  '/industrias/salon': { lang: 'es',
    title: 'POS para salones y barberías en RD · Terminal X — citas y comisiones',
    desc:  'Agenda con horarios por estilista, citas con cliente preferido, comisiones por servicio, retail upsell y recordatorios por WhatsApp 24h y 1h antes.',
  },
  '/industrias/concesionario': { lang: 'es',
    title: 'POS para concesionarios de autos en RD · Terminal X',
    desc:  'Inventario con fotos, pipeline kanban de leads, DealBuilder con cuota mensual en vivo, E31 fiscal sobre RD$250K, matriculas INTRANT y comisiones.',
  },
  '/industrias/prestamos': { lang: 'es',
    title: 'Sistema para préstamos y empeños en RD · Terminal X',
    desc:  'Préstamos con amortización francesa o alemana, mora automática, empeños con regla de decomiso, cobranza priorizada y vitrina pública de prendas vencidas.',
  },
  '/industrias/servicios': { lang: 'es',
    title: 'POS para servicios profesionales en RD · Terminal X',
    desc:  'Para consultores, IT, limpieza y contadores: catálogo de servicios, cotización, factura electrónica E31/E32, cobro flexible y recibos por WhatsApp.',
  },
  '/industrias/empresas': { lang: 'es',
    title: 'Nómina TSS / INFOTEP / ISR DR-2026 · Terminal X',
    desc:  'Nómina quincenal y mensual masiva en un click. TSS con topes 2026, INFOTEP 1%, ISR escala DGII 2026 y cesantía Ley 16-92 con pasivo acumulado.',
  },
  '/blog/migrar-facturador-gratuito-dgii': { lang: 'es',
    title: 'Cómo migrar del Facturador Gratuito DGII en 7 días · Terminal X',
    desc:  'Guía paso a paso para mover tu negocio del Facturador Gratuito de DGII a un Emisor Electrónico certificado en una semana. Sin perder facturas.',
  },
  '/blog/ley-32-23-explicada': { lang: 'es',
    title: 'Ley 32-23 explicada para pequeños contribuyentes · Terminal X',
    desc:  'Qué cambia con la Ley de Facturación Electrónica 32-23, fechas obligatorias, multas y cómo prepararte si eres MIPYME en República Dominicana.',
  },
  '/blog/10-cosas-facturador-gratuito-no-dice': { lang: 'es',
    title: 'Las 10 cosas que el Facturador Gratuito DGII NO te dice · Terminal X',
    desc:  'Lo que el Facturador Gratuito de DGII no menciona: límites de comprobantes, falta de inventario, sin POS, sin reportes 606/607 y otros 6 problemas.',
  },
  '/blog/mejor-alternativa-facturador-gratuito-dgii-2026': { lang: 'es',
    title: 'Mejor alternativa al Facturador Gratuito DGII en 2026 · Terminal X',
    desc:  'Comparamos las 5 alternativas certificadas en RD: Terminal X, Indexa, WilPOS, Visual Pyme, StarSISA. Precios, qué incluyen y cuál conviene a tu negocio.',
  },
  '/blog/cuanto-cuesta-sistema-pos-republica-dominicana': { lang: 'es',
    title: '¿Cuánto cuesta un sistema POS en República Dominicana? · Terminal X',
    desc:  'Software, hardware, certificado Viafirma, soporte. El rango real por tipo de negocio (carwash, restaurante, tienda, salón, concesionario) sin promesas infladas.',
  },
  '/blog/mejor-pos-restaurante-republica-dominicana': { lang: 'es',
    title: 'Mejor POS para restaurante en República Dominicana 2026 · Terminal X',
    desc:  'KDS, mesas, propinas Ley 16-92, modo offline, e-CF directo a DGII. Comparación honesta entre Terminal X, StarSISA, WilPOS y Visual Pyme.',
  },
  '/blog/como-funciona-facturador-gratuito-dgii': { lang: 'es',
    title: '¿Cómo funciona el Facturador Gratuito DGII? Guía completa 2026 · Terminal X',
    desc:  'Cap mensual, requisitos, cómo solicitar acceso en Oficina Virtual paso a paso, qué hace y qué no hace el Facturador Gratuito de DGII en 2026.',
  },
  '/blog/calendario-ley-32-23-15-mayo-2026': { lang: 'es',
    title: 'Calendario Ley 32-23: ¿qué pasa el 15 mayo 2026 con tu RNC? · Terminal X',
    desc:  'Fechas obligatorias por tipo de contribuyente, multas, incentivos fiscales y los 4 pasos para prepararte antes del 15 de mayo de 2026.',
  },
  '/blog/como-ser-emisor-electronico-dgii-paso-a-paso': { lang: 'es',
    title: 'Cómo ser Emisor Electrónico DGII paso a paso (Guía 2026) · Terminal X',
    desc:  'Los 5 pasos reales: certificado Viafirma, postulación en OFV, set de pruebas, asignación de roles y paso a producción. Tiempos exactos.',
  },
  '/blog/tipos-de-ecf-e31-e32-e33-e34-e43': { lang: 'es',
    title: 'Los 10 tipos de e-CF: E31, E32, E33, E34, E43, E47 y cuándo usar cada uno · Terminal X',
    desc:  'Tabla completa de los 10 tipos de comprobante fiscal electrónico DGII (E31 crédito fiscal, E32 consumo final, E33 débito, E34 crédito, E43 gastos menores).',
  },
  '/blog/mejor-pos-carwash-republica-dominicana': { lang: 'es',
    title: 'Mejor POS para carwash en República Dominicana 2026 · Terminal X',
    desc:  'Cola de servicios, comisiones por lavador automáticas, memberships, e-CF directo a DGII y modo offline. Comparación honesta para lavaderos dominicanos.',
  },
  '/blog/mejor-pos-tienda-colmado-republica-dominicana': { lang: 'es',
    title: 'Mejor POS para tienda y colmado en República Dominicana 2026 · Terminal X',
    desc:  'Inventario código de barras, fiado, ITBIS automático, e-CF directo a DGII. Terminal X con 8 sub-tipos de tienda preconfigurados (licorería, farmacia, colmado, supermercado, ferretería, papelería, boutique).',
  },

  // ─── Phase-1 SEO sprint blog posts (2026-05-18) ───
  '/blog/cuanto-cuesta-un-pos-en-republica-dominicana': { lang: 'es',
    title: '¿Cuánto cuesta un POS en República Dominicana? Precios reales 2026 · Terminal X',
    desc:  'Software, hardware, certificado Viafirma, soporte e implementación. Rango real por tipo de negocio (carwash, restaurante, tienda, salón, concesionario) sin promesas infladas.',
  },
  '/blog/diferencia-pos-y-facturador-gratuito-dgii': { lang: 'es',
    title: 'Diferencia entre un POS y el Facturador Gratuito de DGII (2026) · Terminal X',
    desc:  '¿Necesitas POS o solo facturador electrónico? La diferencia real entre el Facturador Gratuito de DGII y un sistema POS profesional como Terminal X en 2026.',
  },
  '/blog/migrar-de-starsisa-a-terminal-x': { lang: 'es',
    title: 'Migrar de StarSISA a Terminal X · Guía paso a paso 2026',
    desc:  'Cómo migrar de StarSISA a Terminal X sin perder ventas: importación de catálogo, secuencias DGII, comisiones y entrenamiento en una semana. Alternativa StarSISA en RD.',
  },
  '/blog/pos-para-car-wash-en-rd': { lang: 'es',
    title: 'POS para Car Wash en RD · Cola, comisiones y memberships — Terminal X',
    desc:  'POS especializado para car wash dominicanos: cola visual, asignación de lavadores, comisiones automáticas por servicio, memberships y e-CF DGII directo.',
  },
  '/blog/que-es-un-emisor-electronico-dgii': { lang: 'es',
    title: '¿Qué es un Emisor Electrónico DGII? Guía completa 2026 · Terminal X',
    desc:  'Qué significa ser Emisor Electrónico Directo en RD, cómo se diferencia de un PSFE intermediario, cuánto cuesta certificarse y qué herramientas cumplen Ley 32-23.',
  },
  '/blog/precios-pos-rd-2026': { lang: 'es',
    title: 'Precios POS en RD 2026 · Comparación completa por plan y vertical — Terminal X',
    desc:  'Cuánto cuesta un POS dominicano en 2026 por vertical (carwash, restaurante, tienda, salón) y por plan (autoservicio, asistido, ejecutivo dedicado). Sin sorpresas.',
  },

  // ─── EN ───
  '/en': { lang: 'en',
    title: 'Terminal X — POS & DGII Electronic Invoicing for the Dominican Republic',
    desc:  'Terminal X: POS and DGII-certified e-CF (Cert #42483) for the Dominican Republic. No PSFE middleman, no per-receipt fee. Carwash, retail, restaurants. From RD$490/mo. 7-day free trial.',
  },
  '/en/pricing': { lang: 'en',
    title: 'Terminal X — POS & DGII e-invoicing pricing from RD$490/mo',
    desc:  'Terminal X plans: Invoicing Pro RD$490, Pro PLUS RD$990, Pro MAX RD$1,990, POS Pro RD$2,490, POS Pro PLUS RD$4,490, POS Pro MAX RD$6,990. 7 days free, no contract.',
  },
  '/en/signup': { lang: 'en',
    title: 'Terminal X — Sign up · 7-day free Pro MAX trial',
    desc:  'Activate Terminal X in minutes. 7 days free on the Pro MAX plan with every feature: DGII e-CF, POS, payroll and reports. No card, no contract.',
  },
  '/en/blog': { lang: 'en',
    title: 'Blog · Terminal X — Electronic invoicing & POS in the Dominican Republic',
    desc:  'Practical guides on Law 32-23, the DGII free invoicer, e-CF, POS for carwashes, retail and restaurants in the Dominican Republic.',
  },
  '/en/industries/facturacion': { lang: 'en',
    title: 'DGII electronic invoicing · Terminal X (Certified Issuer)',
    desc:  'Replace the DGII free invoicer. e-CF E31/E32/E33/E34/E43, 606/607 reports, 900K RNC lookup, 72-hour offline queue, Viafirma certificate included.',
  },
  '/en/industries/carwash': { lang: 'en',
    title: 'Carwash POS for the Dominican Republic · Terminal X',
    desc:  'Specialized POS for Dominican carwashes: visual queue, washer assignment, automatic commissions, memberships and live owner dashboard.',
  },
  '/en/industries/tiendas': { lang: 'en',
    title: 'Retail POS for liquor stores, pharmacies, bodegas · Terminal X',
    desc:  'Barcode inventory, 8 sub-verticals (liquor, pharmacy, bodega, supermarket, hardware, stationery, boutique, other). Direct DGII e-CF.',
  },
  '/en/industries/restaurantes': { lang: 'en',
    title: 'Restaurant POS in the Dominican Republic · Terminal X — KDS, tables, tips',
    desc:  'Service POS for the DR: open table tabs, KDS with timer, item modifiers, kitchen/bar routing, split-bill, tips and instant E43.',
  },
  '/en/industries/mecanica': { lang: 'en',
    title: 'Auto repair shop POS · Terminal X — work orders & service bays',
    desc:  'Work orders with parts and labor itemized, service bays, vehicle history by license plate, WO→ticket conversion with E31 over RD$250K.',
  },
  '/en/industries/salon': { lang: 'en',
    title: 'Salon & barber shop POS in the Dominican Republic · Terminal X',
    desc:  'Per-stylist schedules, preferred-stylist booking, per-service commissions, retail upsell and WhatsApp reminders 24h and 1h before the appointment.',
  },
  '/en/industries/concesionario': { lang: 'en',
    title: 'Auto dealership POS for the Dominican Republic · Terminal X',
    desc:  'Vehicle inventory with photos, kanban lead pipeline, DealBuilder with live monthly payment, E31 fiscal receipt over RD$250K, INTRANT registration, commissions.',
  },
  '/en/industries/prestamos': { lang: 'en',
    title: 'Loan & pawnshop software for the Dominican Republic · Terminal X',
    desc:  'Loans with French or German amortization, automatic late-fee, pawn items with default rules, prioritized collections and a public storefront for forfeited items.',
  },
  '/en/industries/servicios': { lang: 'en',
    title: 'Professional services POS for the Dominican Republic · Terminal X',
    desc:  'For consultants, IT, cleaning and accountants: service catalog, formal quotes, electronic invoice E31/E32, flexible payment and WhatsApp receipts.',
  },
  '/en/industries/empresas': { lang: 'en',
    title: 'Payroll TSS / INFOTEP / ISR DR-2026 · Terminal X',
    desc:  'Bi-weekly and monthly bulk payroll in one click. TSS with 2026 caps, INFOTEP 1%, progressive ISR per DGII 2026 and Law 16-92 severance accrual.',
  },
  '/en/blog/migrar-facturador-gratuito-dgii': { lang: 'en',
    title: 'How to migrate from the DGII free e-invoicer in 7 days · Terminal X',
    desc:  'Step-by-step guide to move your business from the DGII free invoicer to a certified Electronic Issuer in one week. Without losing receipts.',
  },
  '/en/blog/ley-32-23-explicada': { lang: 'en',
    title: 'Dominican Law 32-23 explained for small taxpayers · Terminal X',
    desc:  'What changes with the Electronic Invoicing Law 32-23: deadlines, fines and how to prepare if you are an SMB in the Dominican Republic.',
  },
  '/en/blog/10-cosas-facturador-gratuito-no-dice': { lang: 'en',
    title: '10 things the DGII free e-invoicer will not tell you · Terminal X',
    desc:  'What the DGII free invoicer does not mention: receipt caps, no inventory, no POS, no 606/607 reports and 6 other problems.',
  },
  '/en/blog/mejor-alternativa-facturador-gratuito-dgii-2026': { lang: 'en',
    title: 'Best alternative to the DGII Free Invoicer in 2026 · Terminal X',
    desc:  'We compare the 5 certified alternatives in DR: Terminal X, Indexa, WilPOS, Visual Pyme, StarSISA. Pricing, features and which one fits your business.',
  },
  '/en/blog/cuanto-cuesta-sistema-pos-republica-dominicana': { lang: 'en',
    title: 'How much does a POS system cost in the Dominican Republic? · Terminal X',
    desc:  'Software, hardware, Viafirma certificate, support. The real cost range by business type (carwash, restaurant, retail, salon, dealership) without inflated promises.',
  },
  '/en/blog/mejor-pos-restaurante-republica-dominicana': { lang: 'en',
    title: 'Best restaurant POS in the Dominican Republic 2026 · Terminal X',
    desc:  'KDS, tables, Law 16-92 tips, offline mode, direct DGII e-CF. Honest comparison between Terminal X, StarSISA, WilPOS and Visual Pyme.',
  },
  '/en/blog/como-funciona-facturador-gratuito-dgii': { lang: 'en',
    title: 'How does the DGII Free Invoicer work? Complete 2026 guide · Terminal X',
    desc:  'Monthly cap, requirements, how to request access in Oficina Virtual step by step, what it does and does not in 2026.',
  },
  '/en/blog/calendario-ley-32-23-15-mayo-2026': { lang: 'en',
    title: 'Law 32-23 calendar: what happens on May 15, 2026 with your RNC? · Terminal X',
    desc:  'Mandatory dates by taxpayer type, penalties for non-compliance, tax incentives and the 4 steps to prepare before May 15, 2026.',
  },
  '/en/blog/como-ser-emisor-electronico-dgii-paso-a-paso': { lang: 'en',
    title: 'How to become a DGII Electronic Issuer step by step (2026 guide) · Terminal X',
    desc:  'The 5 real steps: Viafirma certificate, OFV postulation, 12-set test, role assignment and move to production. Exact timelines.',
  },
  '/en/blog/tipos-de-ecf-e31-e32-e33-e34-e43': { lang: 'en',
    title: 'The 10 types of e-CF: E31, E32, E33, E34, E43, E47 and when to use each · Terminal X',
    desc:  'Complete table of the 10 DGII electronic fiscal receipt types (E31 tax credit, E32 final consumer, E33 debit, E34 credit, E43 minor expenses).',
  },
  '/en/blog/mejor-pos-carwash-republica-dominicana': { lang: 'en',
    title: 'Best carwash POS in the Dominican Republic 2026 · Terminal X',
    desc:  'Service queue, automatic per-washer commissions, memberships, direct DGII e-CF and offline mode. Honest comparison for Dominican carwashes.',
  },
  '/en/blog/mejor-pos-tienda-colmado-republica-dominicana': { lang: 'en',
    title: 'Best POS for retail and bodega in the Dominican Republic 2026 · Terminal X',
    desc:  'Barcode inventory, store credit, automatic ITBIS, direct DGII e-CF. Terminal X with 8 pre-configured store sub-types (liquor, pharmacy, bodega, supermarket, hardware, stationery, boutique).',
  },
};

// Map a path to its per-route OG image generated by scripts/generate-og-images.mjs.
// Falls back to the site-wide /og-image.png when no route-specific file exists.
function ogImageFor(pathname) {
  const slug = pathname.split('/').pop() || '';
  if (pathname.startsWith('/en/industries/')) return `${SITE}/og/en-industries-${slug}.png`;
  if (pathname.startsWith('/industrias/'))    return `${SITE}/og/industrias-${slug}.png`;
  if (pathname.startsWith('/en/blog/'))       return `${SITE}/og/en-blog-${slug}.png`;
  if (pathname.startsWith('/blog/'))          return `${SITE}/og/blog-${slug}.png`;
  if (pathname === '/en/pricing')             return `${SITE}/og/en-pricing.png`;
  if (pathname === '/pricing')                return `${SITE}/og/pricing.png`;
  if (pathname === '/en/signup')              return `${SITE}/og/en-signup.png`;
  if (pathname === '/signup')                 return `${SITE}/og/signup.png`;
  if (pathname === '/en/blog')                return `${SITE}/og/en-blog.png`;
  if (pathname === '/blog')                   return `${SITE}/og/blog.png`;
  return null; // home etc — keep default /og-image.png
}

function lookupRouteMeta(pathname) {
  if (Object.prototype.hasOwnProperty.call(ROUTE_META, pathname)) {
    return ROUTE_META[pathname];
  }
  if (pathname.endsWith('/') && pathname.length > 1) {
    const trimmed = pathname.slice(0, -1);
    if (Object.prototype.hasOwnProperty.call(ROUTE_META, trimmed)) {
      return ROUTE_META[trimmed];
    }
  }
  // Special-case home: '/' has no entry but should still get hreflang block.
  if (pathname === '/') {
    return { lang: 'es', title: null, desc: null }; // signals "hreflang+ld only"
  }
  return null;
}

// Map a path to its bilingual sibling URL pair so hreflang stays reciprocal.
function getLanguagePair(pathname) {
  // EN → ES mapping
  if (pathname === '/en' || pathname === '/en/') return { es: '/', en: '/en' };
  if (pathname === '/en/pricing') return { es: '/pricing', en: '/en/pricing' };
  if (pathname === '/en/signup') return { es: '/signup', en: '/en/signup' };
  if (pathname === '/en/blog') return { es: '/blog', en: '/en/blog' };
  if (pathname.startsWith('/en/blog/')) {
    const slug = pathname.slice('/en/blog/'.length);
    return { es: `/blog/${slug}`, en: `/en/blog/${slug}` };
  }
  if (pathname.startsWith('/en/industries/')) {
    const slug = pathname.slice('/en/industries/'.length);
    return { es: `/industrias/${slug}`, en: `/en/industries/${slug}` };
  }
  // ES → EN mapping
  if (pathname === '/') return { es: '/', en: '/en' };
  if (pathname === '/pricing') return { es: '/pricing', en: '/en/pricing' };
  if (pathname === '/signup') return { es: '/signup', en: '/en/signup' };
  if (pathname === '/blog') return { es: '/blog', en: '/en/blog' };
  if (pathname.startsWith('/blog/')) {
    const slug = pathname.slice('/blog/'.length);
    return { es: `/blog/${slug}`, en: `/en/blog/${slug}` };
  }
  if (pathname.startsWith('/industrias/')) {
    const slug = pathname.slice('/industrias/'.length);
    return { es: `/industrias/${slug}`, en: `/en/industries/${slug}` };
  }
  // Phase-1 SEO sprint pages — Spanish-only for now (EN follows in Phase 2).
  // Self-pair both hreflang slots so we never emit a 404 alternate.
  if (
    pathname === '/sistema-pos' ||
    pathname === '/software-pos' ||
    pathname === '/alternativa-facturador-gratuito-dgii' ||
    pathname === '/facturador-electronico-dgii'
  ) {
    return { es: pathname, en: pathname };
  }
  return null;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildBreadcrumb(pathname, meta) {
  const lang = meta.lang || 'es';
  const T = (es, en) => (lang === 'en' ? en : es);
  const items = [{ name: 'Terminal X', url: lang === 'en' ? `${SITE}/en` : SITE }];

  const isIndustry = pathname.startsWith('/industrias/') || pathname.startsWith('/en/industries/');
  const isBlogPost = pathname.startsWith('/blog/') || pathname.startsWith('/en/blog/');
  const isBlogIndex = pathname === '/blog' || pathname === '/en/blog';

  if (isIndustry) {
    const slug = pathname.split('/').pop();
    const names = lang === 'en' ? INDUSTRY_NAMES_EN : INDUSTRY_NAMES_ES;
    const hub = lang === 'en' ? `${SITE}/en/#vertical-features` : `${SITE}/#vertical-features`;
    items.push({ name: T('Industrias', 'Industries'), url: hub });
    items.push({ name: names[slug] || slug, url: `${SITE}${pathname}` });
  } else if (isBlogPost) {
    const slug = pathname.split('/').pop();
    const post = BLOG_POSTS[slug];
    items.push({ name: 'Blog', url: lang === 'en' ? `${SITE}/en/blog` : `${SITE}/blog` });
    items.push({
      name: post ? (lang === 'en' ? post.headline_en : post.headline_es) : slug,
      url: `${SITE}${pathname}`,
    });
  } else if (isBlogIndex) {
    items.push({ name: 'Blog', url: `${SITE}${pathname}` });
  } else if (pathname === '/pricing' || pathname === '/en/pricing') {
    items.push({ name: T('Precios', 'Pricing'), url: `${SITE}${pathname}` });
  } else if (pathname === '/signup' || pathname === '/en/signup') {
    items.push({ name: T('Crear cuenta', 'Sign up'), url: `${SITE}${pathname}` });
  } else if (pathname === '/sistema-pos') {
    items.push({ name: 'Sistema POS', url: `${SITE}${pathname}` });
  } else if (pathname === '/software-pos') {
    items.push({ name: 'Software POS', url: `${SITE}${pathname}` });
  } else if (pathname === '/alternativa-facturador-gratuito-dgii') {
    items.push({ name: 'Alternativa al Facturador Gratuito DGII', url: `${SITE}${pathname}` });
  } else if (pathname === '/facturador-electronico-dgii') {
    items.push({ name: 'Facturador Electrónico DGII', url: `${SITE}${pathname}` });
  } else {
    return null;
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}

function buildArticleSchema(pathname, meta) {
  const isBlogPost = pathname.startsWith('/blog/') || pathname.startsWith('/en/blog/');
  if (!isBlogPost) return null;
  const slug = pathname.split('/').pop();
  const post = BLOG_POSTS[slug];
  if (!post) return null;
  const lang = meta.lang || 'es';
  const headline = lang === 'en' ? post.headline_en : post.headline_es;
  const excerpt = lang === 'en' ? post.excerpt_en : post.excerpt_es;
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline,
    description: excerpt,
    image: `${SITE}${post.image}`,
    datePublished: post.datePublished,
    dateModified: post.datePublished,
    author: { '@type': 'Organization', name: 'Terminal X', url: SITE },
    publisher: {
      '@type': 'Organization',
      name: 'Terminal X',
      logo: { '@type': 'ImageObject', url: `${SITE}/icons/icon-512.png` },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE}${pathname}` },
    inLanguage: lang === 'en' ? 'en' : 'es-DO',
    timeRequired: `PT${post.readMinutes}M`,
  };
}

// FAQPage JSON-LD for blog posts that ship with a `faq` array. Lifts the
// post into Google's expandable Q&A rich snippet (4× SERP real estate).
// Only posts that have curated FAQs are eligible — never auto-extracted from
// body HTML, since hallucinated answers tarnish ranking.
function buildFAQPageSchema(pathname, meta) {
  // 1. SEO Phase-1 landing pages (Spanish-only, curated FAQ map above).
  if (SEO_LANDING_FAQS[pathname]) {
    const faqs = SEO_LANDING_FAQS[pathname];
    return {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      inLanguage: 'es-DO',
      mainEntity: faqs.map(qa => ({
        '@type': 'Question',
        name: qa.q,
        acceptedAnswer: { '@type': 'Answer', text: qa.a },
      })),
    };
  }
  // 2. Blog posts with curated `faq` arrays.
  const isBlogPost = pathname.startsWith('/blog/') || pathname.startsWith('/en/blog/');
  if (!isBlogPost) return null;
  const slug = pathname.split('/').pop();
  const post = BLOG_POSTS[slug];
  if (!post || !Array.isArray(post.faq) || post.faq.length === 0) return null;
  const lang = meta.lang || 'es';
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: lang === 'en' ? 'en' : 'es-DO',
    mainEntity: post.faq.map(qa => ({
      '@type': 'Question',
      name: lang === 'en' ? qa.q_en : qa.q_es,
      acceptedAnswer: {
        '@type': 'Answer',
        text: lang === 'en' ? qa.a_en : qa.a_es,
      },
    })),
  };
}

// Canonical prices — memory/reference_pricing_locked_20260512.md.
// Do NOT regress to the legacy 995 / 2,990 / 5,490 / 9,990 numbers.
const PRICING_PLANS = [
  { slug: 'facturacion',      name: 'Facturación Pro',      price: 490,  url: '/signup?plan=facturacion-pro',      desc_es: '50 e-CFs/mes · directo a DGII sin PSFE · 1 usuario',                          desc_en: '50 e-CFs/month · direct to DGII without PSFE · 1 user' },
  { slug: 'facturacion-plus', name: 'Facturación Pro PLUS', price: 990,  url: '/signup?plan=facturacion-pro-plus', desc_es: '250 e-CFs/mes · multi-usuario · multi-moneda · 606/607',                       desc_en: '250 e-CFs/month · multi-user · multi-currency · 606/607' },
  { slug: 'facturacion-max',  name: 'Facturación Pro MAX',  price: 1990, desc_es: 'e-CFs ilimitados · multi-sucursal · API · soporte prioritario',                 url: '/signup?plan=facturacion-pro-max', desc_en: 'Unlimited e-CFs · multi-location · API · priority support' },
  { slug: 'pos-pro',          name: 'POS Pro',              price: 2490, url: '/signup?plan=pos-pro',              desc_es: 'POS completo · NCF papel · cuadre + caja chica · 2 usuarios',                  desc_en: 'Full POS · paper NCF · cash reconciliation + petty cash · 2 users' },
  { slug: 'pos-pro-plus',     name: 'POS Pro PLUS',         price: 4490, url: '/signup?plan=pos-pro-plus',         desc_es: 'POS + e-CF directo a DGII · Viafirma incluido · 5 usuarios · comisiones',      desc_en: 'POS + e-CF direct to DGII · Viafirma included · 5 users · commissions' },
  { slug: 'pos-pro-max',      name: 'POS Pro MAX',          price: 6990, url: '/signup?plan=pos-pro-max',          desc_es: 'Todo + nómina TSS/INFOTEP/ISR · usuarios ilimitados · dashboard remoto',       desc_en: 'Everything + payroll TSS/INFOTEP/ISR · unlimited users · remote dashboard' },
];

// Product schema per tier on /pricing — Google indexes each Offer individually
// so per-tier emission yields more rich-result eligibility than a single
// AggregateOffer rollup. NOTE: no aggregateRating on any node — we have no
// verified review corpus; fabricating one risks Search Console manual action.
function buildProductSchema(pathname, meta) {
  if (pathname !== '/pricing' && pathname !== '/en/pricing') return null;
  const lang = meta.lang || 'es';
  return PRICING_PLANS.map(p => ({
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${SITE}${pathname}#${p.slug}`,
    name: `Terminal X ${p.name}`,
    description: lang === 'en' ? p.desc_en : p.desc_es,
    brand: { '@type': 'Organization', '@id': `${SITE}/#organization`, name: 'Terminal X' },
    image: `${SITE}/og-image.png`,
    category: 'BusinessApplication > PointOfSale',
    offers: {
      '@type': 'Offer',
      price: String(p.price),
      priceCurrency: 'DOP',
      availability: 'https://schema.org/InStock',
      url: `${SITE}${p.url}`,
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price: String(p.price),
        priceCurrency: 'DOP',
        billingDuration: 'P1M',
        unitCode: 'MON',
      },
      seller: { '@type': 'Organization', '@id': `${SITE}/#organization` },
    },
  }));
}

// Service schema per /industrias/:slug — surfaces the vertical as a discrete
// service in SERP, linked back to the Organization + pricing page.
function buildServiceSchema(pathname, meta) {
  const isIndustry = pathname.startsWith('/industrias/') || pathname.startsWith('/en/industries/');
  if (!isIndustry) return null;
  const lang = meta.lang || 'es';
  const slug = pathname.split('/').pop();
  const names = lang === 'en' ? INDUSTRY_NAMES_EN : INDUSTRY_NAMES_ES;
  const name = names[slug];
  if (!name) return null;
  const pricingUrl = lang === 'en' ? `${SITE}/en/pricing` : `${SITE}/pricing`;
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name,
    serviceType: lang === 'en' ? `POS system for ${name}` : `Sistema POS para ${name}`,
    description: meta.desc || name,
    provider: { '@type': 'Organization', '@id': `${SITE}/#organization`, name: 'Terminal X' },
    areaServed: { '@type': 'Country', name: 'Dominican Republic' },
    inLanguage: lang === 'en' ? 'en' : 'es-DO',
    url: `${SITE}${pathname}`,
    offers: {
      '@type': 'Offer',
      url: pricingUrl,
      priceCurrency: 'DOP',
      availability: 'https://schema.org/InStock',
    },
  };
}

// WebSite + SearchAction on '/' — primes Google sitelink searchbox.
// `/blog?q=` is the declared target even before in-app search is wired; Google
// indexes the action and surfaces the box once enough authority accrues.
function buildWebSiteSchema(pathname) {
  if (pathname !== '/' && pathname !== '/en' && pathname !== '/en/') return null;
  const isEn = pathname.startsWith('/en');
  const base = isEn ? `${SITE}/en` : SITE;
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE}/#website`,
    url: base,
    name: 'Terminal X',
    inLanguage: isEn ? 'en' : 'es-DO',
    publisher: { '@type': 'Organization', '@id': `${SITE}/#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${base}/blog?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

// Routes where the homepage hero-image preload (desktop-pos.png) is actually
// rendered as the LCP. Everywhere else, strip the preload tag to recover
// ~93 KiB of wasted bandwidth on each pageload — measured 2026-05-18.
const HERO_PRELOAD_ROUTES = new Set(['/', '/en', '/en/']);

function injectRouteMeta(html, pathname, meta) {
  const pair = getLanguagePair(pathname) || { es: pathname, en: pathname };
  const lang = meta.lang || 'es';
  const canonical = `${SITE}${pathname}`;

  let out = html;

  // Per-route title / description / OG / Twitter — only if meta has values.
  if (meta.title) {
    const t = escapeHtml(meta.title);
    const d = escapeHtml(meta.desc || '');
    out = out.replace(/<title>[^<]*<\/title>/i, `<title>${t}</title>`);
    out = out.replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i, `<meta name="description" content="${d}" />`);
    out = out.replace(/<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:title" content="${t}" />`);
    out = out.replace(/<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:description" content="${d}" />`);
    out = out.replace(/<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/i, `<meta name="twitter:title" content="${t}" />`);
    out = out.replace(/<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/i, `<meta name="twitter:description" content="${d}" />`);
  }

  // Canonical + og:url always (even for `/` which has no overridden title).
  out = out.replace(/<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i, `<link rel="canonical" href="${canonical}" />`);
  out = out.replace(/<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:url" content="${canonical}" />`);

  // Per-route OG image swap (and matching twitter:image). Falls back when no
  // route-specific PNG exists — index.html default /og-image.png stays.
  const ogImg = ogImageFor(pathname);
  if (ogImg) {
    out = out.replace(/<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:image" content="${ogImg}" />`);
    out = out.replace(/<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?>/i, `<meta name="twitter:image" content="${ogImg}" />`);
  }

  // og:locale per language.
  const ogLocale = lang === 'en' ? 'en_US' : 'es_DO';
  out = out.replace(/<meta\s+property="og:locale"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:locale" content="${ogLocale}" />`);

  // <html lang="..."> per language.
  const htmlLang = lang === 'en' ? 'en' : 'es-DO';
  out = out.replace(/<html\s+lang="[^"]*">/i, `<html lang="${htmlLang}">`);

  // Reciprocal hreflang pair — Google requires self-reference + every alternate.
  // URL pair, NOT `?lang=en` parameter (Google's strong preference per
  // https://developers.google.com/search/docs/specialty/international/localized-versions).
  const hreflangBlock = [
    `<link rel="alternate" hreflang="es-DO" href="${SITE}${pair.es}" />`,
    `<link rel="alternate" hreflang="en" href="${SITE}${pair.en}" />`,
    `<link rel="alternate" hreflang="x-default" href="${SITE}${pair.es}" />`,
  ].join('\n    ');
  out = out.replace(
    /<link\s+rel="alternate"\s+hreflang="es-DO"[^>]*>\s*<link\s+rel="alternate"\s+hreflang="en"[^>]*>\s*<link\s+rel="alternate"\s+hreflang="x-default"[^>]*>/i,
    hreflangBlock,
  );

  // Inject route-specific JSON-LD before </head>.
  const ldBlocks = [];
  const breadcrumb = buildBreadcrumb(pathname, meta);
  if (breadcrumb) ldBlocks.push(JSON.stringify(breadcrumb));
  const article = buildArticleSchema(pathname, meta);
  if (article) ldBlocks.push(JSON.stringify(article));
  const product = buildProductSchema(pathname, meta);
  if (product) {
    // Per-tier emission returns an array; flatten each Product into its own
    // <script> tag so Google can pick them up individually.
    const products = Array.isArray(product) ? product : [product];
    for (const p of products) ldBlocks.push(JSON.stringify(p));
  }
  const faqPage = buildFAQPageSchema(pathname, meta);
  if (faqPage) ldBlocks.push(JSON.stringify(faqPage));
  const service = buildServiceSchema(pathname, meta);
  if (service) ldBlocks.push(JSON.stringify(service));
  const website = buildWebSiteSchema(pathname);
  if (website) ldBlocks.push(JSON.stringify(website));
  if (ldBlocks.length) {
    const tags = ldBlocks
      .map((j) => `<script type="application/ld+json">${j}</script>`)
      .join('\n    ');
    out = out.replace('</head>', `    ${tags}\n  </head>`);
  }

  return out;
}

function buildCsp(nonce) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline' https:`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.supabase.co https://www.google-analytics.com https://www.googletagmanager.com",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://www.google-analytics.com https://www.googletagmanager.com https://region1.google-analytics.com wss://localhost:8181 wss://localhost:8282 wss://localhost:8383 wss://localhost:8484 wss://localhost.qz.io:8181 wss://localhost.qz.io:8282 wss://localhost.qz.io:8383 wss://localhost.qz.io:8484 https://localhost.qz.io:8181 https://localhost.qz.io:8282 https://localhost.qz.io:8383 https://localhost.qz.io:8484",
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

  const originResponse = await fetch(request);
  const contentType = originResponse.headers.get('content-type') || '';
  const isHtml = contentType.includes('text/html');

  if (!isHtml) {
    const headers = new Headers(originResponse.headers);
    headers.set('Content-Security-Policy', csp);
    return new Response(originResponse.body, {
      status: originResponse.status,
      statusText: originResponse.statusText,
      headers,
    });
  }

  const body = await originResponse.text();
  let injected = body.split('__CSP_NONCE__').join(nonce);

  const url = new URL(request.url);

  // Strip the homepage hero-image preload on every non-home route — saves
  // ~93 KiB of wasted bandwidth per pageload on /signup, /industrias/*,
  // /blog/*, etc. where desktop-pos.png is never rendered. Runs before
  // injectRouteMeta so it fires for ALL non-home routes, even those without
  // route meta entries. (CWV: bandwidth + LCP win on inner pages, 2026-05-18.)
  if (!HERO_PRELOAD_ROUTES.has(url.pathname)) {
    injected = injected.replace(
      /<!--TX_HERO_PRELOAD_START-->[\s\S]*?<!--TX_HERO_PRELOAD_END-->/,
      '',
    );
  }

  const meta = lookupRouteMeta(url.pathname);
  if (meta) {
    injected = injectRouteMeta(injected, url.pathname, meta);
  }

  const headers = new Headers(originResponse.headers);
  headers.set('Content-Security-Policy', csp);
  // CRITICAL: Cache-Control MUST be 'no-store' to prevent Vercel Edge from
  // caching the rewritten HTML body. The body carries a nonce; the CSP
  // header is regenerated per-request. If the edge serves a cached body
  // with one nonce while sending a freshly-built CSP with a different
  // nonce, the browser blocks every script → white screen for every visitor.
  //
  // This happened on 5abeed6 (bfcache optimization attempt). Reverted on
  // 2026-05-18 after live nonce-mismatch outage.
  //
  // Also explicitly disable the Vercel CDN cache layer to be safe (private
  // + no-cache alone isn't enough — Vercel needs the explicit directive).
  headers.set('Cache-Control', 'no-store, must-revalidate');
  headers.set('CDN-Cache-Control', 'no-store');
  headers.set('Vercel-CDN-Cache-Control', 'no-store');
  headers.delete('content-length');

  return new Response(injected, {
    status: originResponse.status,
    statusText: originResponse.statusText,
    headers,
  });
}
