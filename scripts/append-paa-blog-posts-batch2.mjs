// Phase 5 batch 2 — 6 PAA-driven posts.
// Same shape as scripts/append-paa-blog-posts.mjs (run once, dedupe by slug).
//
// Coverage map vs PAA inventory:
// - Cluster 1 (Facturador Gratuito mechanics) → como-funciona-facturador-gratuito-dgii
// - Cluster 2 (Ley 32-23 deadline)            → calendario-ley-32-23-15-mayo-2026
// - Cluster 3 (How to become Emisor)          → como-ser-emisor-electronico-dgii-paso-a-paso
// - Cluster 5 (Types of e-CF)                 → tipos-de-ecf-e31-e32-e33-e34-e43
// - Cluster 6 (Carwash POS)                   → mejor-pos-carwash-republica-dominicana
// - Vertical retail (parallel to restaurant)  → mejor-pos-tienda-colmado-republica-dominicana

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(__dirname, '..', 'packages', 'ui', 'landing', 'data', 'blogPosts.json');
const TODAY = '2026-05-03';

// ─── Post 4: How the DGII Free Invoicer works ───────────────────────────────
const POST_4 = {
  slug: 'como-funciona-facturador-gratuito-dgii',
  title_es: '¿Cómo funciona el Facturador Gratuito de DGII? Guía completa 2026',
  title_en: 'How does the DGII Free Invoicer work? Complete 2026 guide',
  excerpt_es: 'Cap, requisitos, cómo solicitar acceso en Oficina Virtual, qué hace y qué no hace. Todo lo que necesitas saber del Facturador Gratuito antes de decidir si te sirve.',
  excerpt_en: 'Cap, requirements, how to request access in Oficina Virtual, what it does and what it does not. Everything you need to know about the Free Invoicer before deciding if it works for you.',
  author: 'Equipo Terminal X', date: TODAY, category: 'guías', tags: ['DGII', 'Facturador-Gratuito', 'guías'], readMinutes: 8,
  og_image: '/og/blog-como-funciona-facturador-gratuito-dgii.png',
  body_html_es: `<p>El Facturador Gratuito de DGII es una herramienta web (no una app, no un programa de descarga) operada desde Oficina Virtual que <strong>permite emitir e-CFs hasta aproximadamente 150 al mes</strong>, gratis, sin software adicional ni cargo por comprobante. Es la opción que la DGII ofrece para que ningún contribuyente se quede sin cumplir con la Ley 32-23 por motivos económicos.</p>
<p>Esta guía explica cómo funciona, quién puede usarlo, cómo solicitar acceso paso a paso y qué limitaciones esperar.</p>
<h2 id="que-es">¿Qué es el Facturador Gratuito?</h2>
<p>Es un módulo dentro del portal Oficina Virtual (OFV) de DGII (oficinavirtual.dgii.gov.do) que te permite generar, firmar y enviar comprobantes fiscales electrónicos sin pagar por el software ni por cada e-CF emitido. La firma digital la hace la propia DGII en tu nombre usando un certificado que te entrega gratis al activarte como usuario.</p>
<h2 id="quien-puede-usarlo">¿Quién puede usar el Facturador Gratuito?</h2>
<p>Cualquier contribuyente con RNC activo y NCF asignado, según la Norma General DGII vigente. En la práctica, está pensado para:</p>
<ul><li>Pequeñas y micro empresas (Mipymes) con bajo volumen de facturación.</li><li>Profesionales independientes (médicos, abogados, contadores en práctica privada).</li><li>Personas físicas con RNC.</li><li>Empresas en arranque que aún no tienen un sistema POS.</li></ul>
<p>No hay restricción por sector económico. El único filtro es el volumen — pasando las ~150 facturas/mes el sistema deja de ser viable.</p>
<h2 id="cuantas-facturas">¿Cuántas facturas puedo emitir al mes?</h2>
<p>Aproximadamente <strong>150 facturas mensuales</strong> según la propia DGII. La palabra "aproximadamente" no es accidental: el cap puede ajustarse mediante aviso informativo, sin reforma legal ni periodo de transición. Un negocio que crece cerca del techo debería tener un plan B antes de chocar con él.</p>
<h2 id="costo">¿Cuánto cuesta el Facturador Gratuito?</h2>
<p>Cero pesos. Es 100% gratis: software, firma digital, envío a DGII y el certificado de firma incluido. No hay mensualidad, no hay cargo por comprobante, no hay costo de instalación.</p>
<p>Lo único que cuesta dinero es el tiempo: cada factura se entra a mano en Oficina Virtual y los formatos 606/607 se llenan a mano cada mes.</p>
<h2 id="solicitar-acceso">¿Cómo solicito acceso en Oficina Virtual?</h2>
<p>Asumiendo que ya tienes RNC activo y usuario en OFV:</p>
<ol><li>Entra a <a href="https://oficinavirtual.dgii.gov.do" target="_blank" rel="noreferrer">oficinavirtual.dgii.gov.do</a> con tu usuario y contraseña.</li><li>Menú → <strong>Facturación Electrónica</strong> → <strong>Solicitud de Facturador Gratuito</strong>.</li><li>Completa la declaración jurada con los datos de tu negocio (razón social, dirección, sector, volumen estimado).</li><li>Acepta los términos y envía. La DGII responde con la aprobación en 1 a 5 días hábiles.</li><li>Cuando recibas la confirmación, entra a OFV → <strong>Mi cuenta</strong> → <strong>Asignación de Roles</strong> y asigna el rol "Emisor Facturador Gratuito" a los usuarios que vayan a emitir.</li><li>Listo. Ya puedes emitir e-CFs desde el menú <strong>Emisión de Comprobantes Fiscales Electrónicos</strong>.</li></ol>
<h2 id="dolares-exento">¿Permite facturar en dólares o exento?</h2>
<p><strong>Solo opera en pesos dominicanos (DOP)</strong>. No tiene multi-moneda. Si vendes en USD (turismo, exportación, hoteles, e-commerce internacional), tienes que convertir cada factura manualmente a la tasa del día y emitirla en pesos, manteniendo aparte un registro paralelo en USD para tu auditoría.</p>
<p>Para comprobantes <strong>exentos</strong> (zona franca, exportación, ventas a entidades exoneradas) sí permite el indicador correspondiente, pero el flujo se vuelve más manual — la mayoría de proveedores serios automatizan estos casos.</p>
<h2 id="certificado">¿El certificado digital gratuito sirve solo para el Facturador Gratuito?</h2>
<p>Sí. El certificado que te entrega la DGII al activarte como usuario del Facturador Gratuito está vinculado al uso dentro del portal — no puedes exportarlo y usarlo en otro sistema. Si después decides migrar a un POS, necesitas comprar un certificado Viafirma aparte (RD$2,360 al año) o usar uno que tu nuevo proveedor te incluya en el plan (Terminal X lo incluye).</p>
<h2 id="no-puedo-entrar">¿Por qué no puedo entrar al Facturador Gratuito?</h2>
<p>Las causas más comunes de "no me deja entrar":</p>
<ul><li><strong>Tu solicitud no está aprobada todavía.</strong> Verifica el estatus en OFV → Mi Cuenta → Solicitudes.</li><li><strong>El usuario que intenta emitir no tiene el rol asignado.</strong> El dueño del RNC tiene que asignar el rol "Emisor Facturador Gratuito" a cada usuario.</li><li><strong>Tu RNC tiene una alerta o restricción.</strong> Pasa por una sucursal DGII o llama al 809-689-3444 para verificar.</li><li><strong>Problema temporal del portal.</strong> OFV se cae periódicamente; reintenta en 30 minutos.</li></ul>
<h2 id="que-no-hace">Lo que el Facturador Gratuito NO hace</h2>
<p>Antes de comprometerte, ten claro que <strong>el Facturador Gratuito es un emisor, no un POS</strong>. No tiene:</p>
<ul><li>Inventario, códigos de barra, control de stock</li><li>Cobro por tarjeta o cuadre de caja</li><li>Reportes de ventas, top productos, comisiones</li><li>Cola offline cuando se cae internet</li><li>App móvil</li><li>API o webhooks para integrar con otros sistemas</li><li>Multi-moneda (USD)</li><li>Generación automática de 606/607 (te toca a mano)</li></ul>
<p>Si esas cosas no te aplican, el Facturador Gratuito te alcanza. Si te aplica al menos una, eventualmente migrarás a un sistema más completo. Tenemos una <a href="/blog/mejor-alternativa-facturador-gratuito-dgii-2026">comparativa de las 5 mejores alternativas certificadas</a>.</p>
<h2 id="faq">Preguntas frecuentes</h2>
<details><summary><strong>¿Cuántas facturas puedo emitir al mes con el Facturador Gratuito?</strong></summary><p>Aproximadamente 150 al mes según la propia DGII. El cap puede ajustarse por aviso informativo, así que no es estable como base de operación a largo plazo.</p></details>
<details><summary><strong>¿Quién puede usar el Facturador Gratuito de la DGII?</strong></summary><p>Cualquier contribuyente con RNC activo y NCF asignado. Pensado especialmente para Mipymes, profesionales independientes y empresas en arranque con bajo volumen.</p></details>
<details><summary><strong>¿Cuánto cuesta el Facturador Gratuito?</strong></summary><p>Cero pesos. Es 100% gratis: software, firma digital, envío a DGII y certificado de firma incluido. No hay mensualidad ni cargo por comprobante.</p></details>
<details><summary><strong>¿Cómo solicito autorización para el Facturador Gratuito en la OFV?</strong></summary><p>En oficinavirtual.dgii.gov.do → Facturación Electrónica → Solicitud de Facturador Gratuito. Completa la declaración jurada y la DGII aprueba en 1 a 5 días hábiles.</p></details>
<details><summary><strong>¿El Facturador Gratuito permite facturar exento o en dólares?</strong></summary><p>Exento sí, pero el flujo es manual. En dólares no — solo opera en DOP. Si vendes en USD tienes que convertir cada factura manualmente.</p></details>
<details><summary><strong>¿El certificado digital gratuito de la DGII sirve solo para el Facturador Gratuito?</strong></summary><p>Sí. Está vinculado al portal. Si migras a otro sistema necesitas un certificado Viafirma aparte (RD$2,360/año) o uno incluido en el plan de tu nuevo proveedor.</p></details>
<details><summary><strong>¿Por qué no puedo entrar al Facturador Gratuito DGII?</strong></summary><p>Las causas comunes son: solicitud sin aprobar, rol no asignado al usuario, alerta en el RNC, o caída temporal del portal. Verifica primero en OFV → Mi Cuenta → Solicitudes y Roles.</p></details>
<h2 id="alternativa">Si te queda corto</h2>
<p>Cuando llegues al techo de 150 facturas/mes, o necesites POS, inventario, app móvil o multi-moneda, mira las <a href="/blog/mejor-alternativa-facturador-gratuito-dgii-2026">alternativas certificadas en RD</a>. Terminal X arranca en RD$995/mes con 7 días gratis: <a href="https://terminalxpos.com/signup?plan=facturacion">terminalxpos.com/signup</a> o WhatsApp <strong>+1 (809) 828-2971</strong>.</p>`,
  body_html_en: `<p>The DGII Free Invoicer is a web tool (not an app, not a download) operated from Oficina Virtual that <strong>lets you issue up to ~150 e-CFs per month</strong>, free, with no extra software and no per-receipt fee. It is the option DGII offers so no taxpayer is left unable to comply with Law 32-23 for cost reasons.</p>
<p>This guide covers how it works, who can use it, how to request access step by step, and what limitations to expect.</p>
<h2 id="what-is-it">What is the Free Invoicer?</h2>
<p>It is a module inside DGII's Oficina Virtual portal (oficinavirtual.dgii.gov.do) that lets you generate, sign and send electronic fiscal receipts without paying for software or per e-CF. DGII itself digitally signs on your behalf using a certificate it grants you for free when activated.</p>
<h2 id="who-can-use">Who can use the Free Invoicer?</h2>
<p>Any taxpayer with an active RNC and assigned NCF, per current DGII norms. In practice, it is built for:</p>
<ul><li>Small and micro businesses (Mipymes) with low invoicing volume</li><li>Independent professionals (doctors, lawyers, accountants in private practice)</li><li>Individuals with RNC</li><li>Startup-stage businesses without a POS yet</li></ul>
<h2 id="how-many">How many invoices per month?</h2>
<p>Approximately <strong>150 per month</strong> per DGII itself. The word "approximately" is not accidental — the cap can be adjusted by informational notice, no legal reform or transition period. A growing business should have a plan B before hitting the ceiling.</p>
<h2 id="cost">How much does the Free Invoicer cost?</h2>
<p>Zero pesos. 100% free: software, digital signature, sending to DGII and the signing certificate included. No monthly fee, no per-receipt charge, no install cost.</p>
<p>The only thing it costs is time — every invoice is entered by hand in Oficina Virtual and the 606/607 forms are filled by hand each month.</p>
<h2 id="how-to-request">How do I request access in Oficina Virtual?</h2>
<p>Assuming you already have an active RNC and OFV user:</p>
<ol><li>Log into <a href="https://oficinavirtual.dgii.gov.do" target="_blank" rel="noreferrer">oficinavirtual.dgii.gov.do</a> with your user and password.</li><li>Menu → <strong>Facturación Electrónica</strong> → <strong>Solicitud de Facturador Gratuito</strong>.</li><li>Fill in the sworn declaration with your business data (legal name, address, sector, estimated volume).</li><li>Accept terms and submit. DGII responds with approval in 1 to 5 business days.</li><li>When you receive confirmation, go to OFV → <strong>My Account</strong> → <strong>Role Assignment</strong> and assign the "Emisor Facturador Gratuito" role to users who will issue.</li><li>Done. You can issue e-CFs from <strong>Emisión de Comprobantes Fiscales Electrónicos</strong>.</li></ol>
<h2 id="usd-exempt">Does it allow USD or exempt invoicing?</h2>
<p><strong>It only operates in Dominican pesos (DOP).</strong> No multi-currency. If you sell in USD (tourism, exports, hotels, international e-commerce), you have to convert every invoice manually at the daily rate and issue it in pesos, while keeping a parallel USD record for audit.</p>
<p>For <strong>exempt</strong> receipts (free trade zone, exports, sales to exempt entities) it does allow the indicator, but the flow becomes more manual — most serious providers automate these cases.</p>
<h2 id="certificate">Does the free DGII certificate work only for the Free Invoicer?</h2>
<p>Yes. The certificate DGII grants you when activating in the Free Invoicer is bound to use inside the portal — you cannot export it and use it in another system. If you later migrate to a POS, you need a separate Viafirma certificate (RD$2,360/year) or one included by your new provider (Terminal X includes it).</p>
<h2 id="cant-enter">Why can I not enter the Free Invoicer?</h2>
<p>Most common causes of "it will not let me in":</p>
<ul><li><strong>Your application is not approved yet.</strong> Check status in OFV → My Account → Applications.</li><li><strong>The user trying to issue does not have the role assigned.</strong> The RNC owner has to assign the "Emisor Facturador Gratuito" role to each user.</li><li><strong>Your RNC has an alert or restriction.</strong> Visit a DGII branch or call 809-689-3444 to verify.</li><li><strong>Temporary portal issue.</strong> OFV goes down periodically; retry in 30 minutes.</li></ul>
<h2 id="what-it-doesnt">What the Free Invoicer does NOT do</h2>
<p>Before committing, be clear that <strong>the Free Invoicer is an issuer, not a POS</strong>. It does not have:</p>
<ul><li>Inventory, barcodes, stock control</li><li>Card payments or cash drawer reconciliation</li><li>Sales reports, top products, commissions</li><li>Offline queue for when internet drops</li><li>Mobile app</li><li>API or webhooks to integrate with other systems</li><li>Multi-currency (USD)</li><li>Automatic 606/607 generation (manual)</li></ul>
<p>If those do not apply, the Free Invoicer is enough. If at least one does, you will eventually migrate to a more complete system. We have a <a href="/en/blog/mejor-alternativa-facturador-gratuito-dgii-2026">comparison of the 5 best certified alternatives</a>.</p>
<h2 id="faq">Frequently asked questions</h2>
<details><summary><strong>How many invoices per month with the Free Invoicer?</strong></summary><p>Roughly 150/month per DGII itself. The cap can shift by informational notice, so it is not stable as a long-term operational base.</p></details>
<details><summary><strong>Who can use the DGII Free Invoicer?</strong></summary><p>Any taxpayer with an active RNC and assigned NCF. Built for Mipymes, independent professionals and startup-stage low-volume businesses.</p></details>
<details><summary><strong>How much does the Free Invoicer cost?</strong></summary><p>Zero pesos. 100% free: software, digital signature, sending to DGII and signing certificate included. No monthly or per-receipt fee.</p></details>
<details><summary><strong>How do I request authorization for the Free Invoicer in OFV?</strong></summary><p>oficinavirtual.dgii.gov.do → Facturación Electrónica → Solicitud de Facturador Gratuito. Fill the sworn declaration; DGII approves in 1 to 5 business days.</p></details>
<details><summary><strong>Does the Free Invoicer allow exempt or USD invoicing?</strong></summary><p>Exempt yes, but the flow is manual. USD no — only DOP. If you sell in USD you must convert each invoice by hand.</p></details>
<details><summary><strong>Does the free DGII certificate only work for the Free Invoicer?</strong></summary><p>Yes. It is bound to the portal. If you migrate you need a separate Viafirma certificate (RD$2,360/year) or one included in your new provider's plan.</p></details>
<details><summary><strong>Why can I not enter the DGII Free Invoicer?</strong></summary><p>Common causes: application not approved, role not assigned to user, RNC alert, or temporary portal outage. Check first in OFV → My Account → Applications and Roles.</p></details>
<h2 id="alternative">If it falls short</h2>
<p>When you hit 150 invoices/month, or need POS, inventory, mobile app or multi-currency, look at <a href="/en/blog/mejor-alternativa-facturador-gratuito-dgii-2026">certified DR alternatives</a>. Terminal X starts at RD$995/mo with 7 days free: <a href="https://terminalxpos.com/en/signup?plan=facturacion">terminalxpos.com/en/signup</a> or WhatsApp <strong>+1 (809) 828-2971</strong>.</p>`,
  faq: [
    { q_es: '¿Cuántas facturas puedo emitir al mes con el Facturador Gratuito?', a_es: 'Aproximadamente 150 al mes según la propia DGII. El cap puede ajustarse por aviso informativo, así que no es estable como base de operación a largo plazo.', q_en: 'How many invoices per month with the DGII Free Invoicer?', a_en: 'Roughly 150/month per DGII itself. The cap can shift by informational notice, so it is not stable as a long-term operational base.' },
    { q_es: '¿Quién puede usar el Facturador Gratuito de la DGII?', a_es: 'Cualquier contribuyente con RNC activo y NCF asignado. Pensado especialmente para Mipymes, profesionales independientes y empresas en arranque con bajo volumen.', q_en: 'Who can use the DGII Free Invoicer?', a_en: 'Any taxpayer with an active RNC and assigned NCF. Built for Mipymes, independent professionals and startup-stage low-volume businesses.' },
    { q_es: '¿Cuánto cuesta el Facturador Gratuito?', a_es: 'Cero pesos. 100% gratis: software, firma digital, envío a DGII y certificado de firma incluido. No hay mensualidad ni cargo por comprobante.', q_en: 'How much does the DGII Free Invoicer cost?', a_en: 'Zero pesos. 100% free: software, digital signature, sending to DGII and certificate included. No monthly or per-receipt fee.' },
    { q_es: '¿Cómo solicito autorización para el Facturador Gratuito en la OFV?', a_es: 'oficinavirtual.dgii.gov.do → Facturación Electrónica → Solicitud de Facturador Gratuito. Completa la declaración jurada y la DGII aprueba en 1 a 5 días hábiles.', q_en: 'How do I request Free Invoicer authorization in OFV?', a_en: 'oficinavirtual.dgii.gov.do → Facturación Electrónica → Solicitud de Facturador Gratuito. Fill the sworn declaration; DGII approves in 1 to 5 business days.' },
    { q_es: '¿El Facturador Gratuito permite facturar exento o en dólares?', a_es: 'Exento sí, pero el flujo es manual. En dólares no — solo opera en DOP. Si vendes en USD tienes que convertir cada factura manualmente.', q_en: 'Does the Free Invoicer allow exempt or USD invoicing?', a_en: 'Exempt yes, but the flow is manual. USD no — only DOP. If you sell in USD you must convert each invoice by hand.' },
    { q_es: '¿Por qué no puedo entrar al Facturador Gratuito DGII?', a_es: 'Causas comunes: solicitud sin aprobar, rol no asignado al usuario, alerta en el RNC, o caída temporal del portal. Verifica primero en OFV → Mi Cuenta → Solicitudes y Roles.', q_en: 'Why can I not enter the DGII Free Invoicer?', a_en: 'Common causes: application not approved, role not assigned to user, RNC alert, or temporary portal outage. Check first in OFV → My Account → Applications and Roles.' },
  ],
};

// ─── Post 5: Law 32-23 calendar ─────────────────────────────────────────────
const POST_5 = {
  slug: 'calendario-ley-32-23-15-mayo-2026',
  title_es: 'Calendario Ley 32-23: ¿qué pasa el 15 de mayo de 2026 con tu RNC?',
  title_en: 'Law 32-23 calendar: what happens on May 15, 2026 with your RNC?',
  excerpt_es: 'Fechas obligatorias por tipo de contribuyente, multas por no cumplir, incentivos fiscales por adoptar antes y los 4 pasos para prepararte sin pagar de más.',
  excerpt_en: 'Mandatory dates by taxpayer type, penalties for non-compliance, tax incentives for early adoption and the 4 steps to prepare without overpaying.',
  author: 'Equipo Terminal X', date: TODAY, category: 'compliance', tags: ['Ley 32-23', 'compliance', 'DGII'], readMinutes: 7,
  og_image: '/og/blog-calendario-ley-32-23-15-mayo-2026.png',
  body_html_es: `<p>El <strong>15 de mayo de 2026</strong> es la fecha límite para que pequeños, micro y no clasificados contribuyentes en República Dominicana emitan exclusivamente factura electrónica (e-CF) bajo la Ley 32-23. Después de esa fecha, una factura sin e-CF deja un agujero en tu Formato 607 que la DGII verá en el cruce contra los 606 de tus clientes — ahí empiezan las multas.</p>
<p>Esta guía te da el calendario completo, las multas reales, los incentivos fiscales que casi nadie aprovecha y los 4 pasos para prepararte si todavía no estás listo.</p>
<h2 id="calendario">Calendario completo Ley 32-23</h2>
<p>| Tipo de contribuyente | Fecha obligatoria | Estatus 2026 | |---|---|---| | Grandes Contribuyentes Nacionales | 15 enero 2024 | <strong>YA OBLIGATORIO</strong> | | Grandes Contribuyentes Locales | 15 enero 2025 | <strong>YA OBLIGATORIO</strong> | | Medianos Contribuyentes | 15 enero 2025 | <strong>YA OBLIGATORIO</strong> | | Pequeños, Micro y No Clasificados | <strong>15 mayo 2026</strong> | <strong>FECHA LÍMITE</strong> | | Sector Público | Ya cumple en flujos B2G | <strong>YA OBLIGATORIO</strong> |</p>
<h2 id="quien-aplica">¿A quién aplica?</h2>
<p>A todo contribuyente con RNC activo. <strong>No hay excepción por sector ni por tamaño después del 15 de mayo de 2026</strong>. Si emites factura en RD, después de esa fecha emites e-CF.</p>
<p>Lo que varía es la herramienta — Facturador Gratuito (con cap), PSFE intermediario, o Emisor Electrónico Directo. <a href="/blog/mejor-alternativa-facturador-gratuito-dgii-2026">Comparamos las 5 alternativas certificadas aquí</a>.</p>
<h2 id="multas">¿Qué multas establece la Ley 32-23?</h2>
<p>La Ley 32-23 y su Reglamento de Aplicación remiten al Código Tributario para las sanciones. En la práctica, lo más común que se aplica es:</p>
<ul><li><strong>Emisión sin comprobante autorizado:</strong> multa entre 5 y 30 salarios mínimos del sector público (rango aproximado RD$50,000 a RD$300,000) por inobservancia, según Art. 257 del Código Tributario.</li><li><strong>Recargos automáticos por mora</strong> si la factura genera ITBIS no declarado: 10% del monto + interés mensual.</li><li><strong>Suspensión del RNC</strong> en casos reincidentes — quedas inhabilitado para emitir cualquier factura.</li></ul>
<p>La cifra exacta depende de la norma vigente al momento de la fiscalización. Lo más práctico: <strong>el costo de cumplir es siempre menor al costo de no cumplir</strong>.</p>
<h2 id="incentivos">Incentivos fiscales por adoptar antes de la fecha</h2>
<p>La Ley 32-23 establece beneficios fiscales para quienes se certifican como Emisor Electrónico antes del plazo obligatorio. Los principales (vigentes según la Ley):</p>
<ul><li><strong>Crédito fiscal del ITBIS</strong> sobre la inversión en software y hardware certificado para e-CF — recuperas el 18% pagado en la compra.</li><li><strong>Deducción adicional</strong> de los costos de implementación en el ISR del año de adopción.</li><li><strong>Tratamiento preferencial</strong> en procesos de auditoría y fiscalización.</li></ul>
<p>Estos beneficios se aplican vía declaración anual. Habla con tu contador para activarlos correctamente.</p>
<h2 id="sector-publico">¿La Ley 32-23 obliga al sector público?</h2>
<p>Sí. El Estado dominicano (ministerios, ayuntamientos, institutos autónomos) ya recibe e-CF en sus flujos de compras. Si vendes al gobierno, tienes que emitir <strong>E45 (Gubernamental)</strong> obligatoriamente — el Facturador Gratuito ya lo soporta.</p>
<h2 id="que-pasa">¿Qué pasa si no me adapto antes del 15 de mayo de 2026?</h2>
<ol><li><strong>Tu primera factura del 16 de mayo en papel</strong> queda registrada como "comprobante no autorizado" en el cruce DGII.</li><li><strong>Tus clientes pierden el crédito fiscal</strong> de tu factura — y dejan de comprarte.</li><li><strong>DGII te notifica</strong> con un período corto para regularizar (típicamente 30 días).</li><li><strong>Si no regularizas:</strong> multa entre 5 y 30 salarios mínimos del sector público + recargos.</li><li><strong>En casos reincidentes:</strong> suspensión del RNC.</li></ol>
<h2 id="como-prepararte">Cómo prepararte en 4 pasos</h2>
<ol><li><strong>Decide tu herramienta</strong>: Facturador Gratuito (si emites &lt;100/mes), PSFE intermediario (con cargo por comprobante), o Emisor Electrónico Directo (sin cargo, ej: Terminal X).</li><li><strong>Postula tu RNC</strong> en Oficina Virtual → Facturación Electrónica. Aprobación toma 1 a 5 días hábiles.</li><li><strong>Configura tu sistema</strong> y pasa el set de pruebas de la DGII (12 sets para Emisor Directo, automático con el Facturador Gratuito).</li><li><strong>Emite tu primer e-CF real</strong> al menos 30 días antes del 15 de mayo de 2026 para tener tiempo de corregir cualquier error sin presión.</li></ol>
<h2 id="faq">Preguntas frecuentes</h2>
<details><summary><strong>¿A quién aplica la Ley 32-23 de facturación electrónica?</strong></summary><p>A todo contribuyente con RNC activo en la República Dominicana. No hay excepción por sector ni por tamaño después del 15 de mayo de 2026.</p></details>
<details><summary><strong>¿Cuándo es obligatoria la factura electrónica para Mipymes en RD?</strong></summary><p>El 15 de mayo de 2026 es la fecha límite para pequeños, micro y no clasificados contribuyentes. Grandes y medianos ya cumplen desde 2024 y 2025.</p></details>
<details><summary><strong>¿Qué multas establece la Ley 32-23 por no facturar electrónicamente?</strong></summary><p>Multa entre 5 y 30 salarios mínimos del sector público (RD$50,000 a RD$300,000) por emisión sin comprobante autorizado, más recargos por mora del 10% si genera ITBIS no declarado, y suspensión del RNC en casos reincidentes.</p></details>
<details><summary><strong>¿Qué incentivos fiscales da la Ley 32-23 por implementar antes?</strong></summary><p>Crédito fiscal del ITBIS pagado en la compra de software/hardware certificado, deducción adicional en ISR del año de adopción, y tratamiento preferencial en auditorías. Activa con tu contador en la declaración anual.</p></details>
<details><summary><strong>¿La Ley 32-23 obliga al sector público también?</strong></summary><p>Sí. El Estado ya recibe e-CF tipo E45 (Gubernamental). Si vendes al gobierno, este tipo es obligatorio.</p></details>
<details><summary><strong>¿Qué pasa si no me adapto a la Ley 32-23 antes del plazo?</strong></summary><p>Tus facturas en papel quedan como "no autorizadas" en el cruce DGII. Tus clientes pierden crédito fiscal. DGII te notifica con 30 días para regularizar; si no lo haces, multa + recargos + posible suspensión del RNC.</p></details>
<h2 id="empezar">Empezar hoy, no el 14 de mayo</h2>
<p>Migrar bajo presión es siempre más caro que migrar con tiempo. Terminal X te da 7 días gratis del plan Pro MAX, configura tu certificado Viafirma, postula tu RNC y te lleva al primer e-CF real en menos de una semana. Entra a <a href="https://terminalxpos.com/signup">terminalxpos.com/signup</a> o WhatsApp <strong>+1 (809) 828-2971</strong>.</p>`,
  body_html_en: `<p><strong>May 15, 2026</strong> is the deadline for small, micro and unclassified taxpayers in the Dominican Republic to issue exclusively electronic invoices (e-CF) under Law 32-23. After that date, a paper invoice leaves a hole in your Form 607 that DGII will see when crossing your customers' 606s — that is where the fines start.</p>
<p>This guide gives you the full calendar, the actual fines, the tax incentives almost nobody uses, and the 4 steps to prepare if you are not ready yet.</p>
<h2 id="calendar">Full Law 32-23 calendar</h2>
<p>| Taxpayer type | Mandatory date | 2026 status | |---|---|---| | National Large Taxpayers | January 15, 2024 | <strong>ALREADY MANDATORY</strong> | | Local Large Taxpayers | January 15, 2025 | <strong>ALREADY MANDATORY</strong> | | Medium Taxpayers | January 15, 2025 | <strong>ALREADY MANDATORY</strong> | | Small, Micro and Unclassified | <strong>May 15, 2026</strong> | <strong>DEADLINE</strong> | | Public Sector | Already in B2G flows | <strong>ALREADY MANDATORY</strong> |</p>
<h2 id="who">Who does it apply to?</h2>
<p>Every taxpayer with an active RNC. <strong>No exception by sector or size after May 15, 2026</strong>. If you invoice in DR, after that date you issue e-CF.</p>
<p>What varies is the tool — Free Invoicer (with cap), PSFE intermediary, or Direct Electronic Issuer. <a href="/en/blog/mejor-alternativa-facturador-gratuito-dgii-2026">We compare the 5 certified alternatives here</a>.</p>
<h2 id="penalties">What penalties does Law 32-23 impose?</h2>
<p>Law 32-23 and its Application Regulation refer to the Tax Code for sanctions. In practice, the most common applied are:</p>
<ul><li><strong>Issuance without authorized receipt:</strong> fine of 5 to 30 public-sector minimum wages (approx range RD$50,000 to RD$300,000) per non-compliance, per Article 257 of the Tax Code.</li><li><strong>Automatic late charges</strong> if the invoice generates undeclared ITBIS: 10% of the amount + monthly interest.</li><li><strong>RNC suspension</strong> in repeat cases — you become disabled from issuing any invoice.</li></ul>
<p>The exact figure depends on the rule in force at audit time. Practical takeaway: <strong>the cost of compliance is always less than the cost of non-compliance</strong>.</p>
<h2 id="incentives">Tax incentives for early adoption</h2>
<p>Law 32-23 grants tax benefits for those who certify as Electronic Issuer before the mandatory date. The main ones in force:</p>
<ul><li><strong>ITBIS tax credit</strong> on the investment in certified e-CF software and hardware — you recover the 18% paid on purchase.</li><li><strong>Additional deduction</strong> of implementation costs in the ISR of the adoption year.</li><li><strong>Preferential treatment</strong> in audit and fiscal review processes.</li></ul>
<p>These benefits apply via annual declaration. Talk to your accountant to activate them correctly.</p>
<h2 id="public-sector">Does Law 32-23 apply to the public sector too?</h2>
<p>Yes. The Dominican State (ministries, municipalities, autonomous institutes) already receives e-CFs in its purchase flows. If you sell to the government, you must mandatorily issue <strong>E45 (Government)</strong> — the Free Invoicer already supports it.</p>
<h2 id="what-happens">What happens if I do not adapt before May 15, 2026?</h2>
<ol><li><strong>Your first paper invoice on May 16</strong> is recorded as "non-authorized receipt" in the DGII cross-check.</li><li><strong>Your customers lose the tax credit</strong> from your invoice — and stop buying from you.</li><li><strong>DGII notifies you</strong> with a short period to regularize (typically 30 days).</li><li><strong>If you do not regularize:</strong> fine of 5 to 30 public-sector minimum wages + late charges.</li><li><strong>In repeat cases:</strong> RNC suspension.</li></ol>
<h2 id="how-to-prepare">How to prepare in 4 steps</h2>
<ol><li><strong>Pick your tool</strong>: Free Invoicer (if you issue &lt;100/month), PSFE intermediary (per-receipt fee), or Direct Electronic Issuer (no fee, e.g. Terminal X).</li><li><strong>Postulate your RNC</strong> in Oficina Virtual → Electronic Invoicing. Approval takes 1 to 5 business days.</li><li><strong>Configure your system</strong> and pass DGII's test set (12 sets for Direct Issuer, automatic with the Free Invoicer).</li><li><strong>Issue your first real e-CF</strong> at least 30 days before May 15, 2026 so you have time to fix any error without pressure.</li></ol>
<h2 id="faq">Frequently asked questions</h2>
<details><summary><strong>Who does Law 32-23 apply to?</strong></summary><p>Every taxpayer with an active RNC in the Dominican Republic. No exception by sector or size after May 15, 2026.</p></details>
<details><summary><strong>When is electronic invoicing mandatory for SMBs in DR?</strong></summary><p>May 15, 2026 is the deadline for small, micro and unclassified taxpayers. Large and medium have been compliant since 2024 and 2025.</p></details>
<details><summary><strong>What penalties does Law 32-23 impose for non-compliance?</strong></summary><p>Fine of 5 to 30 public-sector minimum wages (RD$50,000 to RD$300,000) for issuance without authorized receipt, plus 10% late charges if it generates undeclared ITBIS, and RNC suspension in repeat cases.</p></details>
<details><summary><strong>What tax incentives does Law 32-23 give for early adoption?</strong></summary><p>ITBIS tax credit on certified software/hardware purchases, additional deduction in the ISR of the adoption year, and preferential treatment in audits. Activate with your accountant on the annual declaration.</p></details>
<details><summary><strong>Does Law 32-23 apply to the public sector?</strong></summary><p>Yes. The State already receives E45 (Government) e-CFs. If you sell to the government, this type is mandatory.</p></details>
<details><summary><strong>What happens if I do not adapt to Law 32-23 before the deadline?</strong></summary><p>Your paper invoices are recorded as "non-authorized" in the DGII cross-check. Your customers lose tax credit. DGII gives 30 days to regularize; if you do not, fine + late charges + possible RNC suspension.</p></details>
<h2 id="start">Start today, not on May 14</h2>
<p>Migrating under pressure is always more expensive than migrating with time. Terminal X gives you 7 days free of Pro MAX, sets up your Viafirma certificate, postulates your RNC and gets you to a first real e-CF in under a week. <a href="https://terminalxpos.com/en/signup">terminalxpos.com/en/signup</a> or WhatsApp <strong>+1 (809) 828-2971</strong>.</p>`,
  faq: [
    { q_es: '¿A quién aplica la Ley 32-23 de facturación electrónica?', a_es: 'A todo contribuyente con RNC activo en la República Dominicana. No hay excepción por sector ni por tamaño después del 15 de mayo de 2026.', q_en: 'Who does Law 32-23 on electronic invoicing apply to?', a_en: 'Every taxpayer with an active RNC in the Dominican Republic. No exception by sector or size after May 15, 2026.' },
    { q_es: '¿Cuándo es obligatoria la factura electrónica para Mipymes en RD?', a_es: 'El 15 de mayo de 2026 es la fecha límite para pequeños, micro y no clasificados contribuyentes. Grandes y medianos ya cumplen desde 2024 y 2025.', q_en: 'When is electronic invoicing mandatory for SMBs in DR?', a_en: 'May 15, 2026 is the deadline for small, micro and unclassified taxpayers. Large and medium have been compliant since 2024 and 2025.' },
    { q_es: '¿Qué multas establece la Ley 32-23 por no facturar electrónicamente?', a_es: 'Multa entre 5 y 30 salarios mínimos del sector público (RD$50,000 a RD$300,000), recargos del 10% si genera ITBIS no declarado, y suspensión del RNC en casos reincidentes.', q_en: 'What penalties does Law 32-23 impose for non-compliance?', a_en: 'Fine of 5 to 30 public-sector minimum wages (RD$50,000–RD$300,000), 10% late charges if it generates undeclared ITBIS, and RNC suspension in repeat cases.' },
    { q_es: '¿Qué incentivos fiscales da la Ley 32-23 por implementar antes?', a_es: 'Crédito fiscal del ITBIS pagado en software/hardware certificado, deducción adicional en ISR del año de adopción, y tratamiento preferencial en auditorías.', q_en: 'What tax incentives does Law 32-23 give for early adoption?', a_en: 'ITBIS tax credit on certified software/hardware, additional deduction in the ISR of the adoption year, and preferential treatment in audits.' },
    { q_es: '¿La Ley 32-23 obliga al sector público también?', a_es: 'Sí. El Estado ya recibe e-CF tipo E45 (Gubernamental). Si vendes al gobierno, este tipo es obligatorio.', q_en: 'Does Law 32-23 apply to the public sector?', a_en: 'Yes. The State already receives E45 (Government) e-CFs. If you sell to the government, this type is mandatory.' },
    { q_es: '¿Qué pasa si no me adapto antes del plazo?', a_es: 'Facturas en papel quedan como no autorizadas en el cruce DGII. Tus clientes pierden crédito fiscal. DGII da 30 días para regularizar; si no, multa + recargos + posible suspensión del RNC.', q_en: 'What happens if I do not adapt before the deadline?', a_en: 'Paper invoices are recorded as non-authorized in the DGII cross-check. Customers lose tax credit. DGII gives 30 days to regularize; otherwise fine + late charges + possible RNC suspension.' },
  ],
};

// ─── Post 6: How to become a Direct Electronic Issuer ───────────────────────
const POST_6 = {
  slug: 'como-ser-emisor-electronico-dgii-paso-a-paso',
  title_es: 'Cómo ser Emisor Electrónico DGII paso a paso (Guía 2026)',
  title_en: 'How to become a DGII Electronic Issuer step by step (2026 guide)',
  excerpt_es: 'Los 5 pasos reales para certificarte como Emisor Electrónico ante la DGII: certificado, postulación, set de pruebas, asignación de roles y paso a producción. Sin sorpresas.',
  excerpt_en: 'The 5 real steps to certify as an Electronic Issuer with DGII: certificate, postulation, test set, role assignment and move to production. No surprises.',
  author: 'Equipo Terminal X', date: TODAY, category: 'guías', tags: ['DGII', 'guías', 'emisor-electrónico'], readMinutes: 8,
  og_image: '/og/blog-como-ser-emisor-electronico-dgii-paso-a-paso.png',
  body_html_es: `<p>Convertirte en <strong>Emisor Electrónico Directo ante la DGII</strong> es un proceso de 5 pasos que toma entre 5 y 15 días hábiles si lo haces solo, o 1 a 3 días si te apoyas en un proveedor certificado. Esta guía describe cada paso, los requisitos exactos y los errores comunes que demoran la postulación.</p>
<h2 id="que-significa">¿Qué significa ser Emisor Electrónico?</h2>
<p>Significa que tu RNC está habilitado por la DGII para firmar y enviar e-CF directamente desde tu sistema, sin intermediario PSFE. Eso te elimina el cargo por comprobante (RD$5–RD$15 por e-CF en promedio) y te da control total del flujo. Terminal X es uno de los pocos sistemas certificados en RD bajo esta modalidad (DGII Cert #42483).</p>
<h2 id="paso-1">Paso 1: Comprar el certificado digital Viafirma</h2>
<p>El certificado es la pieza criptográfica que firma cada e-CF. La DGII solo acepta certificados emitidos por <strong>Viafirma</strong> (la única entidad acreditada en RD para esto). Costo: aproximadamente <strong>RD$2,360 al año</strong>.</p>
<p>Cómo comprarlo:</p>
<ol><li>Entra a viafirma.com.do o llama al 809-732-1112.</li><li>Escoge "Certificado de Persona Jurídica" (para empresa) o "Persona Física" (para profesional independiente).</li><li>Sube cédula del representante + RNC + acta constitutiva (si es empresa).</li><li>Pago vía transferencia o tarjeta.</li><li>Te entregan el archivo <code>.p12</code> con la contraseña por correo encriptado en 1 a 3 días hábiles.</li></ol>
<p><strong>Atajo:</strong> Terminal X incluye y administra el certificado Viafirma en todos los planes — no tienes que comprarlo aparte ni renovarlo manualmente cada año.</p>
<h2 id="paso-2">Paso 2: Postular tu RNC en Oficina Virtual</h2>
<ol><li>Entra a <a href="https://oficinavirtual.dgii.gov.do" target="_blank" rel="noreferrer">oficinavirtual.dgii.gov.do</a>.</li><li>Menú → <strong>Facturación Electrónica</strong> → <strong>Postulación Emisor Electrónico</strong>.</li><li>Completa la declaración jurada con datos del negocio + del proveedor de software (si usas Terminal X o Indexa, los datos te los entrega tu proveedor).</li><li>Sube el certificado <code>.p12</code>.</li><li>Envía. La DGII responde con la habilitación al ambiente de <strong>pre-certificación</strong> en 1 a 5 días hábiles.</li></ol>
<p><strong>Errores comunes que rebotan la postulación:</strong> RazonSocial con tildes diferentes a las del registro de RNC, certificado vencido o emitido a otro RNC, archivo <code>.p12</code> corrupto.</p>
<h2 id="paso-3">Paso 3: Configurar tu sistema</h2>
<p>Tu sistema (Terminal X, Indexa, Visual Pyme, etc.) tiene que cargar el certificado, configurar tus secuencias e-CF iniciales, conectar a los endpoints de pre-certificación de la DGII y generar XML válido por cada tipo de comprobante (E31, E32, E33, E34, E43).</p>
<p>Si usas un proveedor certificado, este paso lo hace tu equipo en 30 a 60 minutos. Si lo programas tú mismo, son entre 2 y 4 semanas — la integración con DGII tiene varios detalles técnicos (firma RSA-SHA256 con namespace canonicalization, IndicadorEnvioDiferido, etc.) que cuesta calibrar.</p>
<h2 id="paso-4">Paso 4: Pasar el set de pruebas DGII (12 sets)</h2>
<p>La DGII te entrega <strong>12 sets de pruebas</strong> con escenarios obligatorios que tu sistema debe emitir, recibir respuesta y procesar correctamente:</p>
<ol><li>E31 al consumidor con RNC válido</li><li>E32 al consumidor final por menos de RD$250,000</li><li>E32 (RFCE multipart) al consumidor final</li><li>E33 nota de débito sobre un E31 previo</li><li>E34 nota de crédito sobre un E32 previo</li><li>E43 gastos menores</li><li>E45 gubernamental</li><li>Anulación ANECF de un rango no usado</li><li>Comprobante diferido (IndicadorEnvioDiferido=1) por contingencia</li><li>Aprobación comercial recibida del comprador (en E31)</li><li>Re-envío de comprobante rechazado tras corrección</li><li>Consulta de estatus del comprobante</li></ol>
<p>Cada set se ejecuta en el ambiente <strong>certecf</strong> (pre-producción) y la DGII verifica los XMLs recibidos. Si todos pasan, te aprueban para producción.</p>
<p><strong>Tip:</strong> Terminal X ya pasó los 12 sets en 2024 y mantiene la certificación. Si usas Terminal X, este paso ya está hecho — solo tu RNC se postula.</p>
<h2 id="paso-5">Paso 5: Asignar roles + pasar a producción</h2>
<p>Una vez aprobada la pre-certificación:</p>
<ol><li>OFV → <strong>Mi Cuenta</strong> → <strong>Asignación de Roles</strong> → asigna "Emisor Electrónico Producción" a los usuarios que vayan a operar el sistema.</li><li>En tu sistema, cambia el ambiente de <code>certecf</code> a <code>ecf</code> (producción).</li><li>Emite el primer e-CF real. La DGII lo confirma en menos de 10 segundos.</li></ol>
<h2 id="indotel">¿Necesito certificado INDOTEL?</h2>
<p>No. La DGII solo exige certificado Viafirma para firma de e-CFs. INDOTEL acredita firmas digitales para otros usos (contratos, identificación), pero <strong>no es requerido para Ley 32-23</strong>.</p>
<h2 id="cuanto-tarda">¿Cuánto tarda la DGII en aprobar?</h2>
<ul><li><strong>Postulación inicial:</strong> 1 a 5 días hábiles.</li><li><strong>Set de pruebas (con sistema certificado):</strong> 1 día.</li><li><strong>Set de pruebas (programando solo):</strong> 2 a 4 semanas.</li><li><strong>Paso a producción tras pruebas exitosas:</strong> 1 a 3 días hábiles.</li></ul>
<h2 id="faq">Preguntas frecuentes</h2>
<details><summary><strong>¿Qué requisitos pide la DGII para ser Emisor Electrónico?</strong></summary><p>RNC activo, certificado Viafirma, sistema (propio o de proveedor) que genere XML válido y se conecte a los endpoints de DGII, y la postulación aprobada en Oficina Virtual.</p></details>
<details><summary><strong>¿Cómo me habilito como Emisor Electrónico paso a paso?</strong></summary><p>1) Compra certificado Viafirma. 2) Postula tu RNC en OFV → Facturación Electrónica → Postulación Emisor. 3) Configura tu sistema. 4) Pasa los 12 sets de pruebas. 5) Asigna roles y emite el primer e-CF de producción.</p></details>
<details><summary><strong>¿Cómo solicito secuencias de e-NCF en la Oficina Virtual?</strong></summary><p>Las secuencias e-CF se asignan automáticamente cuando tu RNC es aprobado como Emisor Electrónico. No tienes que solicitarlas aparte como con los NCF en papel — empiezas en E310000000001 y cada e-CF emitido incrementa la secuencia.</p></details>
<details><summary><strong>¿Cómo obtengo el certificado digital para facturar electrónico?</strong></summary><p>Comprándolo a Viafirma (viafirma.com.do o 809-732-1112). Costo aproximado RD$2,360/año. Algunos proveedores como Terminal X lo incluyen y lo administran sin costo adicional.</p></details>
<details><summary><strong>¿Cómo paso el set de pruebas de certificación DGII?</strong></summary><p>Ejecutando los 12 escenarios obligatorios contra el ambiente certecf de DGII. Con un sistema certificado (ej: Terminal X) ya está pasado. Programando solo, calcula 2 a 4 semanas de iteración.</p></details>
<details><summary><strong>¿Cómo asigno roles de usuario después de la declaración jurada?</strong></summary><p>OFV → Mi Cuenta → Asignación de Roles. El dueño del RNC asigna "Emisor Electrónico Producción" a cada usuario que vaya a operar el sistema.</p></details>
<details><summary><strong>¿Necesito certificado INDOTEL para emitir e-CF?</strong></summary><p>No. La DGII solo exige certificado Viafirma. INDOTEL acredita firmas para otros usos pero no es requerido para Ley 32-23.</p></details>
<details><summary><strong>¿Cuánto tarda la DGII en aprobar un Emisor Electrónico?</strong></summary><p>Postulación inicial: 1 a 5 días. Pruebas con sistema certificado: 1 día. Programando tu propio sistema: 2 a 4 semanas. Paso a producción: 1 a 3 días después de pasar pruebas.</p></details>
<h2 id="atajo">El atajo: Terminal X lo hace por ti</h2>
<p>En vez de 5 a 15 días, te damos el certificado Viafirma activado, postulamos tu RNC, ya pasamos los 12 sets de pruebas (Cert #42483) y configuramos los roles contigo en una sola sesión remota. <strong>Tiempo total: 1 a 3 días</strong>. Entra a <a href="https://terminalxpos.com/signup?plan=facturacion">terminalxpos.com/signup</a> o WhatsApp <strong>+1 (809) 828-2971</strong>.</p>`,
  body_html_en: `<p>Becoming a <strong>Direct Electronic Issuer with DGII</strong> is a 5-step process that takes 5 to 15 business days if you do it solo, or 1 to 3 days with a certified provider. This guide covers each step, the exact requirements and the common mistakes that delay postulation.</p>
<h2 id="what-it-means">What does Electronic Issuer mean?</h2>
<p>It means your RNC is enabled by DGII to sign and send e-CFs directly from your system, with no PSFE intermediary. That eliminates the per-receipt fee (RD$5–RD$15 per e-CF on average) and gives you full control. Terminal X is one of the few systems certified in DR under this mode (DGII Cert #42483).</p>
<h2 id="step-1">Step 1: Buy the Viafirma digital certificate</h2>
<p>The certificate is the cryptographic piece that signs each e-CF. DGII only accepts certificates from <strong>Viafirma</strong> (the only accredited entity in DR). Cost: approximately <strong>RD$2,360 per year</strong>.</p>
<p>How to buy it:</p>
<ol><li>Go to viafirma.com.do or call 809-732-1112.</li><li>Choose "Legal Person Certificate" (for company) or "Individual Person" (for independent professional).</li><li>Upload representative ID + RNC + incorporation deed (if a company).</li><li>Pay via transfer or card.</li><li>You receive the <code>.p12</code> file with password by encrypted email in 1 to 3 business days.</li></ol>
<p><strong>Shortcut:</strong> Terminal X includes and manages the Viafirma certificate in every plan — no separate purchase, no manual annual renewal.</p>
<h2 id="step-2">Step 2: Postulate your RNC in Oficina Virtual</h2>
<ol><li>Go to <a href="https://oficinavirtual.dgii.gov.do" target="_blank" rel="noreferrer">oficinavirtual.dgii.gov.do</a>.</li><li>Menu → <strong>Facturación Electrónica</strong> → <strong>Postulación Emisor Electrónico</strong>.</li><li>Fill the sworn declaration with business data + software provider data (if you use Terminal X or Indexa, your provider gives you the data).</li><li>Upload the <code>.p12</code> certificate.</li><li>Submit. DGII responds with enablement to the <strong>pre-certification</strong> environment in 1 to 5 business days.</li></ol>
<p><strong>Common mistakes that bounce the postulation:</strong> RazonSocial with different accents than the RNC registry, expired certificate or issued to a different RNC, corrupt <code>.p12</code> file.</p>
<h2 id="step-3">Step 3: Configure your system</h2>
<p>Your system (Terminal X, Indexa, Visual Pyme, etc.) has to load the certificate, configure your initial e-CF sequences, connect to DGII's pre-certification endpoints and generate valid XML for each receipt type (E31, E32, E33, E34, E43).</p>
<p>With a certified provider, your team does this step in 30 to 60 minutes. If you build it yourself, 2 to 4 weeks — the DGII integration has several technical details (RSA-SHA256 signing with namespace canonicalization, IndicadorEnvioDiferido, etc.) that take time to calibrate.</p>
<h2 id="step-4">Step 4: Pass the DGII test set (12 sets)</h2>
<p>DGII gives you <strong>12 test sets</strong> with mandatory scenarios your system must issue, receive response and process correctly:</p>
<ol><li>E31 to consumer with valid RNC</li><li>E32 to final consumer below RD$250,000</li><li>E32 (RFCE multipart) to final consumer</li><li>E33 debit note over a previous E31</li><li>E34 credit note over a previous E32</li><li>E43 minor expenses</li><li>E45 government</li><li>ANECF cancellation of an unused range</li><li>Deferred receipt (IndicadorEnvioDiferido=1) for contingency</li><li>Commercial approval received from buyer (on E31)</li><li>Resend of rejected receipt after correction</li><li>Receipt status query</li></ol>
<p>Each set runs in the <strong>certecf</strong> environment (pre-prod) and DGII verifies the received XMLs. If all pass, you are approved for production.</p>
<p><strong>Tip:</strong> Terminal X already passed the 12 sets in 2024 and maintains certification. If you use Terminal X, this step is done — only your RNC postulates.</p>
<h2 id="step-5">Step 5: Assign roles + go to production</h2>
<p>Once pre-certification is approved:</p>
<ol><li>OFV → <strong>My Account</strong> → <strong>Role Assignment</strong> → assign "Emisor Electrónico Producción" to users who will operate.</li><li>In your system, switch the environment from <code>certecf</code> to <code>ecf</code> (production).</li><li>Issue the first real e-CF. DGII confirms in under 10 seconds.</li></ol>
<h2 id="indotel">Do I need an INDOTEL certificate?</h2>
<p>No. DGII only requires the Viafirma certificate for e-CF signing. INDOTEL accredits digital signatures for other uses (contracts, identification), but <strong>it is not required for Law 32-23</strong>.</p>
<h2 id="how-long">How long does DGII take to approve?</h2>
<ul><li><strong>Initial postulation:</strong> 1 to 5 business days.</li><li><strong>Test set (with certified system):</strong> 1 day.</li><li><strong>Test set (programming alone):</strong> 2 to 4 weeks.</li><li><strong>Move to production after passing tests:</strong> 1 to 3 business days.</li></ul>
<h2 id="faq">Frequently asked questions</h2>
<details><summary><strong>What requirements does DGII ask to be Electronic Issuer?</strong></summary><p>Active RNC, Viafirma certificate, system (own or provider) that generates valid XML and connects to DGII endpoints, and approved postulation in Oficina Virtual.</p></details>
<details><summary><strong>How do I enable myself as Electronic Issuer step by step?</strong></summary><p>1) Buy Viafirma certificate. 2) Postulate your RNC in OFV → Facturación Electrónica → Postulación Emisor. 3) Configure your system. 4) Pass the 12 test sets. 5) Assign roles and issue the first production e-CF.</p></details>
<details><summary><strong>How do I request e-NCF sequences in Oficina Virtual?</strong></summary><p>e-CF sequences are auto-assigned when your RNC is approved as Electronic Issuer. You do not request them separately like paper NCFs — you start at E310000000001 and each e-CF issued increments the sequence.</p></details>
<details><summary><strong>How do I get the digital certificate to invoice electronically?</strong></summary><p>By buying it from Viafirma (viafirma.com.do or 809-732-1112). Approximate cost RD$2,360/year. Some providers like Terminal X include and manage it at no extra cost.</p></details>
<details><summary><strong>How do I pass the DGII certification test set?</strong></summary><p>By executing the 12 mandatory scenarios against DGII's certecf environment. With a certified system (e.g. Terminal X) it is already done. Programming alone, count on 2 to 4 weeks of iteration.</p></details>
<details><summary><strong>How do I assign user roles after the sworn declaration?</strong></summary><p>OFV → My Account → Role Assignment. The RNC owner assigns "Emisor Electrónico Producción" to each user who will operate the system.</p></details>
<details><summary><strong>Do I need an INDOTEL certificate to issue e-CF?</strong></summary><p>No. DGII only requires the Viafirma certificate. INDOTEL accredits signatures for other uses but is not required for Law 32-23.</p></details>
<details><summary><strong>How long does DGII take to approve an Electronic Issuer?</strong></summary><p>Initial postulation: 1 to 5 days. Tests with certified system: 1 day. Programming your own system: 2 to 4 weeks. Move to production: 1 to 3 days after passing tests.</p></details>
<h2 id="shortcut">The shortcut: Terminal X does it for you</h2>
<p>Instead of 5 to 15 days, we give you the activated Viafirma certificate, postulate your RNC, already passed the 12 test sets (Cert #42483) and configure roles with you in a single remote session. <strong>Total time: 1 to 3 days</strong>. <a href="https://terminalxpos.com/en/signup?plan=facturacion">terminalxpos.com/en/signup</a> or WhatsApp <strong>+1 (809) 828-2971</strong>.</p>`,
  faq: [
    { q_es: '¿Qué requisitos pide la DGII para ser Emisor Electrónico?', a_es: 'RNC activo, certificado Viafirma, sistema (propio o de proveedor) que genere XML válido y se conecte a los endpoints de DGII, y la postulación aprobada en Oficina Virtual.', q_en: 'What requirements does DGII ask to be Electronic Issuer?', a_en: 'Active RNC, Viafirma certificate, system (own or provider) that generates valid XML and connects to DGII endpoints, and approved postulation in Oficina Virtual.' },
    { q_es: '¿Cómo me habilito como Emisor Electrónico paso a paso?', a_es: '1) Compra certificado Viafirma. 2) Postula tu RNC en OFV → Postulación Emisor. 3) Configura tu sistema. 4) Pasa los 12 sets de pruebas. 5) Asigna roles y emite el primer e-CF de producción.', q_en: 'How do I enable myself as Electronic Issuer step by step?', a_en: '1) Buy Viafirma certificate. 2) Postulate RNC in OFV → Postulación Emisor. 3) Configure your system. 4) Pass the 12 test sets. 5) Assign roles and issue first production e-CF.' },
    { q_es: '¿Cómo obtengo el certificado digital para facturar electrónico?', a_es: 'Comprándolo a Viafirma (viafirma.com.do o 809-732-1112). Costo aproximado RD$2,360/año. Terminal X lo incluye y administra sin costo adicional.', q_en: 'How do I get the digital certificate to invoice electronically?', a_en: 'By buying from Viafirma (viafirma.com.do or 809-732-1112). Approximate cost RD$2,360/year. Terminal X includes and manages it at no extra cost.' },
    { q_es: '¿Cómo paso el set de pruebas de certificación DGII?', a_es: 'Ejecutando los 12 escenarios obligatorios contra el ambiente certecf de DGII. Con un sistema certificado ya está pasado. Programando solo, calcula 2 a 4 semanas.', q_en: 'How do I pass the DGII certification test set?', a_en: 'By executing the 12 mandatory scenarios against DGII certecf. With a certified system it is already done. Programming alone, count 2 to 4 weeks.' },
    { q_es: '¿Necesito certificado INDOTEL para emitir e-CF?', a_es: 'No. La DGII solo exige certificado Viafirma. INDOTEL acredita firmas para otros usos pero no es requerido para Ley 32-23.', q_en: 'Do I need an INDOTEL certificate to issue e-CF?', a_en: 'No. DGII only requires Viafirma. INDOTEL accredits signatures for other uses but is not required for Law 32-23.' },
    { q_es: '¿Cuánto tarda la DGII en aprobar un Emisor Electrónico?', a_es: 'Postulación: 1 a 5 días. Pruebas con sistema certificado: 1 día. Programando solo: 2 a 4 semanas. Paso a producción: 1 a 3 días después de pasar pruebas.', q_en: 'How long does DGII take to approve an Electronic Issuer?', a_en: 'Postulation: 1 to 5 days. Tests with certified system: 1 day. Programming alone: 2 to 4 weeks. Move to production: 1 to 3 days after tests.' },
  ],
};

// ─── Post 7: Types of e-CF ──────────────────────────────────────────────────
const POST_7 = {
  slug: 'tipos-de-ecf-e31-e32-e33-e34-e43',
  title_es: 'Los 10 tipos de e-CF en RD: E31, E32, E33, E34, E43, E47 y cuándo usar cada uno',
  title_en: 'The 10 types of e-CF in DR: E31, E32, E33, E34, E43, E47 and when to use each',
  excerpt_es: 'E31 es para B2B con crédito fiscal, E32 para consumidor final, E33 nota de débito, E34 nota de crédito, E43 gastos menores. Tabla completa de los 10 tipos con cuándo usar cada uno.',
  excerpt_en: 'E31 is for B2B tax credit, E32 for final consumer, E33 debit note, E34 credit note, E43 minor expenses. Complete table of the 10 types with when to use each.',
  author: 'Equipo Terminal X', date: TODAY, category: 'guías', tags: ['DGII', 'e-CF', 'tipos'], readMinutes: 7,
  og_image: '/og/blog-tipos-de-ecf-e31-e32-e33-e34-e43.png',
  body_html_es: `<p>La DGII define <strong>10 tipos de comprobante fiscal electrónico (e-CF)</strong> bajo la Ley 32-23, cada uno con un propósito específico. Los más comunes en operación diaria son E31 (Crédito Fiscal B2B), E32 (Consumo Final) y E34 (Nota de Crédito). Esta guía explica cada tipo, cuándo usarlo y la diferencia con los NCF en papel.</p>
<h2 id="ncf-vs-ecf">Diferencia entre NCF y e-CF</h2>
<p>El <strong>NCF</strong> (Número de Comprobante Fiscal) es el formato impreso en papel térmico, con prefijo de letra B y 8 dígitos (ej: B0100000147). El <strong>e-CF</strong> es el formato electrónico XML firmado digitalmente y enviado a DGII en línea, con prefijo E y 10 dígitos (ej: E310000000147). Ambos tienen la misma validez legal — el e-CF lo reemplaza progresivamente según el calendario Ley 32-23.</p>
<h2 id="tabla-completa">Los 10 tipos de e-CF</h2>
<p>| Tipo | Nombre | Cuándo se usa | Lleva RNC comprador | |---|---|---|---| | <strong>E31</strong> | Crédito Fiscal | B2B donde el cliente reclama crédito fiscal de ITBIS | Sí (obligatorio) | | <strong>E32</strong> | Consumo Final (RFCE) | Venta al consumidor final por monto menor a RD$250,000 | No | | <strong>E33</strong> | Nota de Débito | Cargo adicional sobre un comprobante previo | Sí | | <strong>E34</strong> | Nota de Crédito | Devolución total o parcial sobre un comprobante previo | Sí | | <strong>E41</strong> | Compras | Comprobante de compra a un no-contribuyente formal | No | | <strong>E43</strong> | Gastos Menores | Compras pequeñas a proveedores no fiscales | No | | <strong>E44</strong> | Regímenes Especiales | Operaciones bajo Zona Franca u otro régimen | Variable | | <strong>E45</strong> | Gubernamental | Ventas al sector público | Sí (RNC del Estado) | | <strong>E47</strong> | Pagos al Exterior | Pagos internacionales por servicios o regalías | No (es NIF/extranjero) | | <strong>ANECF</strong> | Anulación | Anula un rango de secuencias no usadas | N/A |</p>
<h2 id="e31">E31 — Crédito Fiscal (B2B)</h2>
<p>El más común para ventas entre empresas. El comprador (con RNC) usa el ITBIS de la factura como crédito en su propia declaración. <strong>Obligatorio cuando el monto es ≥ RD$250,000</strong> aunque el cliente sea consumidor final.</p>
<p>Datos requeridos: RNC + razón social del comprador (validados contra registro DGII), descripción del bien/servicio, base imponible, ITBIS desglosado, total.</p>
<h2 id="e32">E32 — Consumo Final / RFCE</h2>
<p>Para venta al consumidor final por <strong>menos de RD$250,000</strong>. No requiere RNC del comprador. El ITBIS no se le devuelve a nadie — es el flujo más común en restaurantes, retail, carwash y servicios al público.</p>
<p>Detalle técnico: el envío del E32 a DGII usa <strong>multipart/form-data</strong> (no application/xml directo), con el archivo XML en el campo <code>xml</code>, nombre <code>{RNC}{eNCF}.xml</code>. Por eso se le llama también <strong>RFCE</strong> (Resumen de Factura de Consumo Electrónico). Si tu sistema no diferencia este caso, los E32 te van a rebotar.</p>
<h2 id="e33-e34">E33 (Nota de Débito) y E34 (Nota de Crédito)</h2>
<p><strong>E33 Nota de Débito:</strong> agrega un cargo a un comprobante previo (cobro de mora, ajuste de precio hacia arriba, etc.). Referencia el e-NCF original.</p>
<p><strong>E34 Nota de Crédito:</strong> rebaja un comprobante previo (devolución de producto, cancelación parcial, descuento posterior). Referencia el e-NCF original. Es el flujo correcto para devoluciones — <strong>nunca anules el original</strong>, emite E34.</p>
<h2 id="e43">E43 — Gastos Menores</h2>
<p>Cuando tu negocio compra a proveedores no formales (parqueo, propinas, gastos pequeños sin RNC). Particularmente importante para <strong>restaurantes</strong> que tienen muchos gastos menores recurrentes que necesitan deducir fiscalmente.</p>
<p>Terminal X tiene flujo dedicado para E43 desde el módulo de gastos.</p>
<h2 id="e45">E45 — Gubernamental</h2>
<p>Obligatorio cuando vendes al Estado dominicano (ministerios, ayuntamientos, institutos autónomos). Lleva el RNC de la entidad gubernamental compradora. El Facturador Gratuito ya lo soporta.</p>
<h2 id="anecf">ANECF — Anulación</h2>
<p>NO es para anular un e-CF ya emitido — eso se hace con E34 (Nota de Crédito). ANECF anula un <strong>rango de secuencias no usadas</strong>, por ejemplo si cambias de proveedor de software y quieres "saltar" del E310000000147 al E310000000200.</p>
<p>Terminal X envía ANECF automáticamente cuando anulas un e-CF que aún no había sido usado en una factura real.</p>
<h2 id="reemplaza-ncf">¿El e-CF reemplaza totalmente al NCF en papel?</h2>
<p>Sí, progresivamente según el calendario Ley 32-23. Después del 15 de mayo de 2026 todo contribuyente con RNC activo debe emitir e-CF. Los NCF en papel ya emitidos siguen válidos hasta agotar la secuencia o expirar; lo que ya no se permite es solicitar nuevas secuencias B01/B02 después de la fecha obligatoria.</p>
<h2 id="validez">¿El e-CF tiene la misma validez legal que la factura en papel?</h2>
<p>Sí. La Ley 32-23 le da al e-CF la misma fuerza probatoria fiscal que el NCF impreso. De hecho la firma digital RSA-SHA256 + el código de seguridad + el QR le dan trazabilidad superior — es más difícil falsificar un e-CF que un NCF.</p>
<h2 id="codigo-seguridad">¿Qué es el código de seguridad del e-CF?</h2>
<p>Son los <strong>primeros 6 caracteres del SignatureValue</strong> de la firma digital del e-CF (en base64, sin SHA-256 adicional). Sirve para que cualquier persona pueda verificar el comprobante en el portal de DGII (<a href="https://ecf.dgii.gov.do" target="_blank" rel="noreferrer">ecf.dgii.gov.do/ecf/ConsultaTimbre</a>) ingresando RNC + e-NCF + código de seguridad. Aparece en el QR del comprobante impreso.</p>
<h2 id="consultar">¿Cómo consulto un e-CF en DGII?</h2>
<p>Tres formas:</p>
<ol><li><strong>Escanea el QR</strong> del comprobante con tu celular — abre directamente la página de validación.</li><li><strong>Entra a <a href="https://ecf.dgii.gov.do/ecf/ConsultaTimbre" target="_blank" rel="noreferrer">ecf.dgii.gov.do</a></strong> e ingresa RNC del emisor + e-NCF + código de seguridad.</li><li><strong>Desde tu Oficina Virtual</strong> → Facturación Electrónica → Consulta de e-CF.</li></ol>
<h2 id="emitir-e34">¿Cómo emito una nota de crédito electrónica (E34)?</h2>
<p>Desde tu sistema POS, ubica el e-CF original a devolver, selecciona "Devolución" o "Nota de Crédito", elige las líneas a devolver (parcial o total), y emite. El sistema genera el E34 referenciando el e-NCF original, lo firma y lo envía a DGII. El cliente recibe el comprobante por WhatsApp o correo.</p>
<h2 id="faq">Preguntas frecuentes</h2>
<details><summary><strong>¿Cuál es la diferencia entre NCF y e-CF?</strong></summary><p>NCF es el formato en papel impreso (prefijo B, 8 dígitos, ej: B0100000147). e-CF es el formato electrónico XML firmado digitalmente (prefijo E, 10 dígitos, ej: E310000000147). Misma validez legal; e-CF lo reemplaza progresivamente según Ley 32-23.</p></details>
<details><summary><strong>¿Qué tipos de e-CF existen?</strong></summary><p>10 tipos: E31 (Crédito Fiscal), E32 (Consumo Final RFCE), E33 (Nota de Débito), E34 (Nota de Crédito), E41 (Compras), E43 (Gastos Menores), E44 (Regímenes Especiales), E45 (Gubernamental), E47 (Pagos al Exterior), y ANECF (Anulación de rango).</p></details>
<details><summary><strong>¿Qué es el código de seguridad del e-CF?</strong></summary><p>Son los primeros 6 caracteres del SignatureValue de la firma digital (base64). Sirve para validar el comprobante en el portal DGII. Aparece en el QR del e-CF impreso.</p></details>
<details><summary><strong>¿Cómo verifico un e-CF en el portal DGII?</strong></summary><p>Escanea el QR con el celular, o entra a ecf.dgii.gov.do/ecf/ConsultaTimbre e ingresa RNC del emisor + e-NCF + código de seguridad.</p></details>
<details><summary><strong>¿El e-CF reemplaza totalmente al NCF en papel?</strong></summary><p>Sí, progresivamente según el calendario Ley 32-23. Después del 15 de mayo de 2026 todo contribuyente con RNC activo emite e-CF. Los NCF B01/B02 ya emitidos siguen válidos hasta agotar.</p></details>
<details><summary><strong>¿El e-CF tiene la misma validez legal que la factura en papel?</strong></summary><p>Sí. La Ley 32-23 le da igual fuerza probatoria. La firma digital RSA-SHA256 + código de seguridad + QR le dan trazabilidad superior al papel.</p></details>
<details><summary><strong>¿Cómo emito una nota de crédito electrónica (E33 o E34)?</strong></summary><p>Desde tu sistema, ubica el e-CF original, selecciona "Devolución" (E34) o "Cargo adicional" (E33), elige las líneas, y emite. El sistema referencia el e-NCF original, firma y envía a DGII automáticamente.</p></details>
<h2 id="empezar">Probar Terminal X 7 días gratis</h2>
<p>Terminal X emite los 10 tipos de e-CF directos a DGII (Cert #42483), con el certificado Viafirma incluido y la postulación de tu RNC en menos de 3 días. <a href="https://terminalxpos.com/signup?plan=facturacion">terminalxpos.com/signup</a> o WhatsApp <strong>+1 (809) 828-2971</strong>.</p>`,
  body_html_en: `<p>DGII defines <strong>10 types of electronic fiscal receipt (e-CF)</strong> under Law 32-23, each with a specific purpose. The most common in daily operation are E31 (B2B Tax Credit), E32 (Final Consumer) and E34 (Credit Note). This guide explains each type, when to use it and the difference vs paper NCFs.</p>
<h2 id="ncf-vs-ecf">Difference between NCF and e-CF</h2>
<p>The <strong>NCF</strong> (Fiscal Receipt Number) is the format printed on thermal paper, with prefix B and 8 digits (e.g. B0100000147). The <strong>e-CF</strong> is the digitally signed XML format sent to DGII online, with prefix E and 10 digits (e.g. E310000000147). Both have the same legal validity — the e-CF progressively replaces the NCF per the Law 32-23 calendar.</p>
<h2 id="full-table">The 10 e-CF types</h2>
<p>| Type | Name | When to use | Carries buyer RNC | |---|---|---|---| | <strong>E31</strong> | Tax Credit | B2B where customer claims ITBIS tax credit | Yes (mandatory) | | <strong>E32</strong> | Final Consumer (RFCE) | Sale to final consumer below RD$250,000 | No | | <strong>E33</strong> | Debit Note | Additional charge over a previous receipt | Yes | | <strong>E34</strong> | Credit Note | Total or partial refund over a previous receipt | Yes | | <strong>E41</strong> | Purchases | Purchase receipt from non-formal taxpayer | No | | <strong>E43</strong> | Minor Expenses | Small purchases from non-fiscal suppliers | No | | <strong>E44</strong> | Special Regimes | Free Trade Zone or other regimes | Variable | | <strong>E45</strong> | Government | Sales to public sector | Yes (State RNC) | | <strong>E47</strong> | Foreign Payments | International payments for services or royalties | No (NIF/foreign) | | <strong>ANECF</strong> | Cancellation | Cancels a range of unused sequences | N/A |</p>
<h2 id="e31">E31 — Tax Credit (B2B)</h2>
<p>The most common for B2B sales. The buyer (with RNC) uses the invoice ITBIS as credit in their own declaration. <strong>Mandatory when amount ≥ RD$250,000</strong> even if the customer is a final consumer.</p>
<p>Required data: buyer RNC + legal name (validated against DGII registry), good/service description, taxable base, itemized ITBIS, total.</p>
<h2 id="e32">E32 — Final Consumer / RFCE</h2>
<p>For sale to final consumer <strong>below RD$250,000</strong>. No buyer RNC required. The ITBIS is not credited back to anyone — it is the most common flow in restaurants, retail, carwash and services.</p>
<p>Technical detail: E32 send to DGII uses <strong>multipart/form-data</strong> (not direct application/xml), with the XML file in the <code>xml</code> field, named <code>{RNC}{eNCF}.xml</code>. That is why it is also called <strong>RFCE</strong> (Electronic Final-Consumer Invoice Summary). If your system does not handle this case, E32s bounce.</p>
<h2 id="e33-e34">E33 (Debit Note) and E34 (Credit Note)</h2>
<p><strong>E33 Debit Note:</strong> adds a charge to a previous receipt (late-fee collection, upward price adjustment). References the original e-NCF.</p>
<p><strong>E34 Credit Note:</strong> reduces a previous receipt (product return, partial cancellation, after-the-fact discount). References the original e-NCF. This is the correct flow for returns — <strong>never cancel the original</strong>, issue an E34.</p>
<h2 id="e43">E43 — Minor Expenses</h2>
<p>When your business buys from non-formal suppliers (parking, tips, small expenses without RNC). Particularly important for <strong>restaurants</strong> with many recurring minor expenses to deduct fiscally.</p>
<h2 id="e45">E45 — Government</h2>
<p>Mandatory when you sell to the Dominican State (ministries, municipalities, autonomous institutes). Carries the buying government entity RNC. The Free Invoicer already supports it.</p>
<h2 id="anecf">ANECF — Cancellation</h2>
<p>NOT for canceling an already-issued e-CF — that is done with E34 (Credit Note). ANECF cancels a <strong>range of unused sequences</strong>, e.g. if you switch software providers and want to "skip" from E310000000147 to E310000000200.</p>
<p>Terminal X sends ANECF automatically when you cancel an e-CF that was not yet used in a real invoice.</p>
<h2 id="replaces-ncf">Does e-CF fully replace paper NCF?</h2>
<p>Yes, progressively per the Law 32-23 calendar. After May 15, 2026 every taxpayer with active RNC must issue e-CF. Already-issued paper NCFs remain valid until the sequence runs out or expires; what is no longer allowed is requesting new B01/B02 sequences after the mandatory date.</p>
<h2 id="legal-validity">Does e-CF have the same legal validity as the paper invoice?</h2>
<p>Yes. Law 32-23 grants e-CF equal probative force. The RSA-SHA256 digital signature + security code + QR give it superior traceability — an e-CF is harder to forge than an NCF.</p>
<h2 id="security-code">What is the e-CF security code?</h2>
<p>The <strong>first 6 characters of the SignatureValue</strong> of the e-CF digital signature (base64, no extra SHA-256). Used so anyone can verify the receipt on the DGII portal (<a href="https://ecf.dgii.gov.do" target="_blank" rel="noreferrer">ecf.dgii.gov.do/ecf/ConsultaTimbre</a>) by entering RNC + e-NCF + security code. Appears in the QR of the printed receipt.</p>
<h2 id="how-to-verify">How do I check an e-CF in DGII?</h2>
<p>Three ways:</p>
<ol><li><strong>Scan the QR</strong> on the receipt with your phone — opens the validation page directly.</li><li><strong>Go to <a href="https://ecf.dgii.gov.do/ecf/ConsultaTimbre" target="_blank" rel="noreferrer">ecf.dgii.gov.do</a></strong> and enter issuer RNC + e-NCF + security code.</li><li><strong>From your Oficina Virtual</strong> → Facturación Electrónica → Consulta de e-CF.</li></ol>
<h2 id="how-to-issue-e34">How do I issue a credit note (E34)?</h2>
<p>From your POS, find the original e-CF to refund, select "Return" or "Credit Note", choose the lines to refund (partial or total), and issue. The system generates the E34 referencing the original e-NCF, signs it and sends to DGII. The customer receives the receipt by WhatsApp or email.</p>
<h2 id="faq">Frequently asked questions</h2>
<details><summary><strong>What is the difference between NCF and e-CF?</strong></summary><p>NCF is the printed paper format (prefix B, 8 digits, e.g. B0100000147). e-CF is the digitally signed electronic XML (prefix E, 10 digits, e.g. E310000000147). Same legal validity; e-CF progressively replaces NCF per Law 32-23.</p></details>
<details><summary><strong>What types of e-CF exist?</strong></summary><p>10 types: E31 (Tax Credit), E32 (Final Consumer RFCE), E33 (Debit Note), E34 (Credit Note), E41 (Purchases), E43 (Minor Expenses), E44 (Special Regimes), E45 (Government), E47 (Foreign Payments), and ANECF (Range Cancellation).</p></details>
<details><summary><strong>What is the e-CF security code?</strong></summary><p>The first 6 characters of the SignatureValue of the digital signature (base64). Used to validate the receipt in the DGII portal. Appears in the QR of the printed e-CF.</p></details>
<details><summary><strong>How do I check an e-CF in the DGII portal?</strong></summary><p>Scan the QR with a phone, or go to ecf.dgii.gov.do/ecf/ConsultaTimbre and enter issuer RNC + e-NCF + security code.</p></details>
<details><summary><strong>Does e-CF fully replace the paper NCF?</strong></summary><p>Yes, progressively per the Law 32-23 calendar. After May 15, 2026 every taxpayer with active RNC issues e-CF. Already-issued B01/B02 NCFs remain valid until used up.</p></details>
<details><summary><strong>Does the e-CF have the same legal validity as the paper invoice?</strong></summary><p>Yes. Law 32-23 grants equal probative force. The RSA-SHA256 digital signature + security code + QR give it superior traceability over paper.</p></details>
<details><summary><strong>How do I issue an electronic credit note (E33 or E34)?</strong></summary><p>From your system, find the original e-CF, select "Return" (E34) or "Additional charge" (E33), choose the lines, and issue. The system references the original e-NCF, signs and sends to DGII automatically.</p></details>
<h2 id="start">Try Terminal X 7 days free</h2>
<p>Terminal X issues all 10 e-CF types directly to DGII (Cert #42483), with the Viafirma certificate included and your RNC postulated in under 3 days. <a href="https://terminalxpos.com/en/signup?plan=facturacion">terminalxpos.com/en/signup</a> or WhatsApp <strong>+1 (809) 828-2971</strong>.</p>`,
  faq: [
    { q_es: '¿Cuál es la diferencia entre NCF y e-CF?', a_es: 'NCF es el formato en papel impreso (prefijo B, 8 dígitos). e-CF es el formato electrónico XML firmado digitalmente (prefijo E, 10 dígitos). Misma validez legal.', q_en: 'What is the difference between NCF and e-CF?', a_en: 'NCF is the printed paper format (prefix B, 8 digits). e-CF is the digitally signed electronic XML (prefix E, 10 digits). Same legal validity.' },
    { q_es: '¿Qué tipos de e-CF existen?', a_es: '10 tipos: E31 (Crédito Fiscal), E32 (Consumo Final RFCE), E33 (Nota de Débito), E34 (Nota de Crédito), E41 (Compras), E43 (Gastos Menores), E44 (Regímenes Especiales), E45 (Gubernamental), E47 (Pagos al Exterior), ANECF (Anulación).', q_en: 'What types of e-CF exist?', a_en: '10 types: E31 (Tax Credit), E32 (Final Consumer RFCE), E33 (Debit Note), E34 (Credit Note), E41 (Purchases), E43 (Minor Expenses), E44 (Special Regimes), E45 (Government), E47 (Foreign Payments), ANECF.' },
    { q_es: '¿Qué es el código de seguridad del e-CF?', a_es: 'Los primeros 6 caracteres del SignatureValue de la firma digital (base64). Sirve para validar el comprobante en el portal DGII. Aparece en el QR.', q_en: 'What is the e-CF security code?', a_en: 'The first 6 characters of the SignatureValue of the digital signature (base64). Used to validate the receipt in the DGII portal. Appears in the QR.' },
    { q_es: '¿Cómo verifico un e-CF en el portal DGII?', a_es: 'Escanea el QR con el celular, o entra a ecf.dgii.gov.do/ecf/ConsultaTimbre e ingresa RNC del emisor + e-NCF + código de seguridad.', q_en: 'How do I check an e-CF in the DGII portal?', a_en: 'Scan the QR with a phone, or go to ecf.dgii.gov.do/ecf/ConsultaTimbre and enter issuer RNC + e-NCF + security code.' },
    { q_es: '¿El e-CF reemplaza totalmente al NCF en papel?', a_es: 'Sí, progresivamente según el calendario Ley 32-23. Después del 15 de mayo de 2026 todo contribuyente con RNC activo emite e-CF.', q_en: 'Does e-CF fully replace the paper NCF?', a_en: 'Yes, progressively per the Law 32-23 calendar. After May 15, 2026 every taxpayer with active RNC issues e-CF.' },
    { q_es: '¿El e-CF tiene la misma validez legal que la factura en papel?', a_es: 'Sí. La Ley 32-23 le da igual fuerza probatoria. La firma digital RSA-SHA256 + código de seguridad + QR le dan trazabilidad superior al papel.', q_en: 'Does e-CF have the same legal validity as the paper invoice?', a_en: 'Yes. Law 32-23 grants equal probative force. The digital signature + security code + QR give it superior traceability over paper.' },
    { q_es: '¿Cómo emito una nota de crédito electrónica (E33 o E34)?', a_es: 'Desde tu sistema, ubica el e-CF original, selecciona "Devolución" (E34) o "Cargo adicional" (E33), elige las líneas, y emite. El sistema firma y envía a DGII automáticamente.', q_en: 'How do I issue an electronic credit note (E33 or E34)?', a_en: 'From your system, find the original e-CF, select "Return" (E34) or "Additional charge" (E33), choose the lines, and issue. The system signs and sends to DGII automatically.' },
  ],
};

// ─── Post 8: Best carwash POS ───────────────────────────────────────────────
const POST_8 = {
  slug: 'mejor-pos-carwash-republica-dominicana',
  title_es: '¿Cuál es el mejor POS para carwash en República Dominicana en 2026?',
  title_en: 'What is the best carwash POS in the Dominican Republic in 2026?',
  excerpt_es: 'Cola de servicios, comisiones por lavador, memberships, e-CF directo a DGII y modo offline. Comparación honesta entre Terminal X y la competencia para lavaderos dominicanos.',
  excerpt_en: 'Service queue, per-washer commissions, memberships, direct DGII e-CF and offline mode. Honest comparison between Terminal X and competitors for Dominican carwashes.',
  author: 'Equipo Terminal X', date: TODAY, category: 'carwash', tags: ['carwash', 'POS', 'comparación'], readMinutes: 7,
  og_image: '/og/blog-mejor-pos-carwash-republica-dominicana.png',
  body_html_es: `<p>Para un lavadero dominicano en 2026 lo que cambia el resultado mensual no es la mensualidad del POS — es <strong>cuánto tiempo te ahorra y cuántos errores de comisión te quita</strong>. La respuesta corta: <strong>Terminal X plan Pro RD$2,990/mes</strong> es el único POS dominicano construido específicamente para carwash, con cola visual, comisiones automáticas, memberships y e-CF directo a DGII (sin cargo por comprobante).</p>
<h2 id="que-necesita-carwash">Lo que necesita un lavadero dominicano</h2>
<ol><li><strong>Cola de servicios visual</strong> — vehículos pendientes, en proceso, terminados — visible para cajera y lavadores.</li><li><strong>Búsqueda por placa</strong> con historial completo del cliente.</li><li><strong>Asignación de lavador</strong> por servicio (1 o varios — split commissions).</li><li><strong>Comisiones automáticas</strong> al cobrar, configurables por servicio.</li><li><strong>Memberships</strong> (lavados ilimitados o cupo mensual) con débito automático.</li><li><strong>e-CF directo a DGII</strong> (E32 al consumidor final, E31 si es flota corporativa).</li><li><strong>Cuadre de caja</strong> diario con varianza efectivo / tarjeta / transferencia.</li><li><strong>Modo offline</strong> para cuando se cae la luz en pleno fin de semana.</li><li><strong>Tarjetas de Autorización Gerencial</strong> para descuentos y voids sin que el dueño esté presente.</li></ol>
<h2 id="terminal-x-carwash">1. Terminal X — Pro RD$2,990/mes</h2>
<p><strong>Cumple los nueve.</strong> Construido específicamente para carwash dominicanos. Cliente real: clientes activos en Santo Domingo y Santiago.</p>
<ul><li>Cola visual con servicios pendientes, en proceso, terminados</li><li>Asignación de lavador por servicio con split commissions</li><li>Búsqueda por placa con historial completo</li><li>Memberships mensuales con débito recurrente</li><li>Comisiones automáticas (% configurable o RD$ fijo)</li><li>Servicios <code>no_commission</code> para items de reventa (productos)</li><li>e-CF E31/E32 directo a DGII (Cert #42483)</li><li>Cuadre de caja con varianza por método de pago</li><li>Modo offline 72h con cola automática</li><li>Tarjetas de Autorización Gerencial Code128 + PIN fallback</li><li>Modo Kiosko con auto-bloqueo</li><li>Resumen diario al dueño por correo (Pro MAX)</li></ul>
<p><strong>Hardware típico:</strong> 1 PC mostrador + 1 impresora térmica + 1 cajón = RD$25,000 una sola vez.</p>
<h2 id="starsisa-carwash">2. StarSISA — desde RD$2,500/mes</h2>
<p>Software desktop con módulo carwash conocido en RD desde hace más de 10 años. Tiene cola y comisiones, pero <strong>los tickets duplicados</strong> son un problema reportado consistentemente por clientes que migran. e-CF vía PSFE (cargo por comprobante).</p>
<h2 id="otros-carwash">3. WilPOS, Visual Pyme, otros</h2>
<p>WilPOS y Visual Pyme son más fuertes en retail que en carwash. No tienen cola de servicios visual ni asignación de lavador. Para carwash de un solo box pueden funcionar; para 3+ lavadores se quedan cortos.</p>
<h2 id="comparativa-carwash">Comparativa rápida (carwash)</h2>
<p>| | Terminal X | StarSISA | WilPOS | Visual Pyme | |---|---|---|---|---| | Cola de servicios visual | ✓ | ✓ | ✗ | ✗ | | Asignación de lavador | ✓ | ✓ | ✗ | ✗ | | Comisiones automáticas | ✓ | ✓ (con bug duplicados) | parcial | parcial | | Búsqueda por placa | ✓ | ✓ | ✗ | ✗ | | Memberships con débito | ✓ | ✗ | ✗ | ✗ | | Modo offline | ✓ (72h) | ✓ (desktop) | limitado | ✓ | | e-CF directo (sin PSFE) | <strong>✓</strong> | ✗ | ✗ | ✗ | | Tarjetas Autorización Gerencial | ✓ | ✗ | ✗ | ✗ | | Modo Kiosko | ✓ | ✗ | ✗ | ✗ | | Desde | RD$2,990/mes | RD$2,500/mes + PSFE | RD$1,500/mes + PSFE | RD$3,000/mes + PSFE |</p>
<h2 id="costo-real">El costo real para un carwash de barrio</h2>
<p>200 vehículos/mes × 1 e-CF cada uno = 200 e-CFs/mes. Con un PSFE a RD$10/comprobante = RD$2,000/mes EXTRA en cargos:</p>
<ul><li><strong>WilPOS RD$1,500/mes + PSFE RD$2,000 = RD$3,500/mes (sin cola, sin memberships)</strong></li><li><strong>StarSISA RD$2,500/mes + PSFE RD$2,000 = RD$4,500/mes (con bug de duplicados)</strong></li><li><strong>Terminal X Pro RD$2,990/mes (todo incluido) = RD$2,990/mes</strong></li></ul>
<p>Diferencia anual: <strong>~RD$18,000 a favor de Terminal X</strong> + ahorro en tiempo de cuadre + cero errores de comisión por duplicados.</p>
<h2 id="faq">Preguntas frecuentes</h2>
<details><summary><strong>¿Cuál es el mejor sistema POS para car wash en RD?</strong></summary><p>Terminal X plan Pro (RD$2,990/mes) es el único POS dominicano construido específicamente para carwash, con cola visual, comisiones automáticas, memberships y e-CF directo a DGII sin cargo por comprobante.</p></details>
<details><summary><strong>¿Cómo manejo comisiones de lavadores en un POS de carwash?</strong></summary><p>Terminal X calcula la comisión automáticamente al cobrar cada servicio según el lavador asignado. Soporta % o monto fijo, configurable por servicio. Multi-lavador soporta split (ej: 60/40 entre dos lavadores). Servicios marcados <code>no_commission</code> se excluyen.</p></details>
<details><summary><strong>¿Hay POS para carwash que emita e-CF a la DGII?</strong></summary><p>Sí. Terminal X emite e-CF E32 (consumidor final) y E31 (flota corporativa con RNC) directos a DGII al cobrar, sin pasar por PSFE intermediario.</p></details>
<details><summary><strong>¿Cuánto cuesta un sistema de facturación para car wash?</strong></summary><p>Software desde RD$2,990/mes (Terminal X Pro). Hardware: PC + impresora térmica + cajón = RD$25,000 una sola vez. Total año 1: ~RD$60,880 sin sorpresas.</p></details>
<details><summary><strong>¿Qué POS de carwash funciona sin internet?</strong></summary><p>Terminal X funciona 100% offline (cola de 72h con IndicadorEnvioDiferido automático). StarSISA y Visual Pyme funcionan offline en versión desktop pero no automatizan el reenvío diferido.</p></details>
<details><summary><strong>¿POS para carwash con cola de servicio y cuadre de caja?</strong></summary><p>Terminal X tiene cola visual con drag-to-reorder, estados pendiente/en proceso/terminado, asignación de lavador, y cuadre de caja diario con varianza por método de pago (efectivo, tarjeta, transferencia).</p></details>
<h2 id="empezar">Probar 7 días gratis</h2>
<p>Terminal X te da 7 días gratis del plan Pro MAX (incluye comisiones, memberships, dashboard del dueño, tarjetas Code128). Sin tarjeta. Configuramos remoto contigo. <a href="https://terminalxpos.com/signup?plan=pro">terminalxpos.com/signup</a> o WhatsApp <strong>+1 (809) 828-2971</strong>.</p>`,
  body_html_en: `<p>For a Dominican carwash in 2026 what changes the monthly result is not the POS subscription — it is <strong>how much time it saves you and how many commission errors it removes</strong>. Short answer: <strong>Terminal X Pro plan at RD$2,990/mo</strong> is the only Dominican POS built specifically for carwash, with visual queue, automatic commissions, memberships and direct DGII e-CF (no per-receipt fee).</p>
<h2 id="what-carwash-needs">What a Dominican carwash needs</h2>
<ol><li><strong>Visual service queue</strong> — pending, in-progress, completed vehicles — visible to cashier and washers.</li><li><strong>License plate search</strong> with full customer history.</li><li><strong>Washer assignment</strong> per service (1 or several — split commissions).</li><li><strong>Automatic commissions</strong> at checkout, configurable per service.</li><li><strong>Memberships</strong> (unlimited or monthly quota) with auto-debit.</li><li><strong>Direct DGII e-CF</strong> (E32 to final consumer, E31 if corporate fleet).</li><li><strong>Daily cash close</strong> with cash / card / transfer variance.</li><li><strong>Offline mode</strong> for when power drops on a busy weekend.</li><li><strong>Manager Authorization Cards</strong> for discounts and voids without owner present.</li></ol>
<h2 id="terminal-x">1. Terminal X — Pro RD$2,990/mo</h2>
<p><strong>Hits all nine.</strong> Built specifically for Dominican carwashes. Real customers active in Santo Domingo and Santiago.</p>
<ul><li>Visual queue with pending / in-progress / completed services</li><li>Per-service washer assignment with split commissions</li><li>License plate search with full history</li><li>Monthly memberships with recurring debit</li><li>Automatic commissions (configurable % or fixed RD$)</li><li><code>no_commission</code> services for resold items (products)</li><li>e-CF E31/E32 direct to DGII (Cert #42483)</li><li>Cash close with per-method variance</li><li>72-hour offline mode with automatic queue</li><li>Manager Authorization Cards Code128 + PIN fallback</li><li>Kiosk mode with auto-lock</li><li>Daily owner digest by email (Pro MAX)</li></ul>
<p><strong>Typical hardware:</strong> 1 counter PC + 1 thermal printer + 1 cash drawer = RD$25,000 one time.</p>
<h2 id="starsisa">2. StarSISA — from RD$2,500/mo</h2>
<p>Desktop software with carwash module known in DR for over 10 years. Has queue and commissions, but <strong>duplicate tickets</strong> is a consistently reported issue from migrating customers. e-CF via PSFE (per-receipt fee).</p>
<h2 id="others">3. WilPOS, Visual Pyme, others</h2>
<p>WilPOS and Visual Pyme are stronger in retail than carwash. No visual service queue or washer assignment. For a single-box carwash they can work; for 3+ washers they fall short.</p>
<h2 id="comparison">Quick comparison (carwash)</h2>
<p>| | Terminal X | StarSISA | WilPOS | Visual Pyme | |---|---|---|---|---| | Visual service queue | ✓ | ✓ | ✗ | ✗ | | Washer assignment | ✓ | ✓ | ✗ | ✗ | | Automatic commissions | ✓ | ✓ (with duplicate bug) | partial | partial | | Plate search | ✓ | ✓ | ✗ | ✗ | | Memberships with debit | ✓ | ✗ | ✗ | ✗ | | Offline mode | ✓ (72h) | ✓ (desktop) | limited | ✓ | | Direct e-CF (no PSFE) | <strong>✓</strong> | ✗ | ✗ | ✗ | | Manager Auth Cards | ✓ | ✗ | ✗ | ✗ | | Kiosk Mode | ✓ | ✗ | ✗ | ✗ | | From | RD$2,990/mo | RD$2,500/mo + PSFE | RD$1,500/mo + PSFE | RD$3,000/mo + PSFE |</p>
<h2 id="real-cost">Real cost for a neighborhood carwash</h2>
<p>200 vehicles/month × 1 e-CF each = 200 e-CFs/mo. With a PSFE at RD$10/receipt = RD$2,000/mo EXTRA in fees:</p>
<ul><li><strong>WilPOS RD$1,500/mo + PSFE RD$2,000 = RD$3,500/mo (no queue, no memberships)</strong></li><li><strong>StarSISA RD$2,500/mo + PSFE RD$2,000 = RD$4,500/mo (with duplicate bug)</strong></li><li><strong>Terminal X Pro RD$2,990/mo (all included) = RD$2,990/mo</strong></li></ul>
<p>Annual difference: <strong>~RD$18,000 in favor of Terminal X</strong> + cash-close time savings + zero duplicate-commission errors.</p>
<h2 id="faq">Frequently asked questions</h2>
<details><summary><strong>What is the best POS for carwash in DR?</strong></summary><p>Terminal X Pro (RD$2,990/mo) is the only Dominican POS built specifically for carwash, with visual queue, automatic commissions, memberships and direct DGII e-CF — no per-receipt fee.</p></details>
<details><summary><strong>How do I manage washer commissions in a carwash POS?</strong></summary><p>Terminal X calculates commission automatically at checkout per assigned washer. Supports % or fixed amount, configurable per service. Multi-washer supports split (e.g. 60/40 between two). Services marked <code>no_commission</code> are excluded.</p></details>
<details><summary><strong>Is there a carwash POS that issues e-CF to DGII?</strong></summary><p>Yes. Terminal X issues e-CF E32 (final consumer) and E31 (corporate fleet with RNC) directly to DGII at checkout, with no PSFE intermediary.</p></details>
<details><summary><strong>How much does a carwash invoicing system cost?</strong></summary><p>Software from RD$2,990/mo (Terminal X Pro). Hardware: PC + thermal printer + cash drawer = RD$25,000 one-time. Year-1 total: ~RD$60,880 with no surprises.</p></details>
<details><summary><strong>What carwash POS works without internet?</strong></summary><p>Terminal X works 100% offline (72-hour queue with automatic IndicadorEnvioDiferido). StarSISA and Visual Pyme work offline in desktop but do not automate deferred resends.</p></details>
<details><summary><strong>Carwash POS with service queue and cash close?</strong></summary><p>Terminal X has visual queue with drag-to-reorder, pending/in-progress/completed states, washer assignment, and daily cash close with per-method variance (cash, card, transfer).</p></details>
<h2 id="start">7 days free trial</h2>
<p>Terminal X gives you 7 days free of Pro MAX (commissions, memberships, owner dashboard, Code128 cards). No card. Remote setup with you. <a href="https://terminalxpos.com/en/signup?plan=pro">terminalxpos.com/en/signup</a> or WhatsApp <strong>+1 (809) 828-2971</strong>.</p>`,
  faq: [
    { q_es: '¿Cuál es el mejor sistema POS para car wash en RD?', a_es: 'Terminal X plan Pro (RD$2,990/mes) es el único POS dominicano construido específicamente para carwash, con cola visual, comisiones automáticas, memberships y e-CF directo a DGII sin cargo por comprobante.', q_en: 'What is the best POS for carwash in DR?', a_en: 'Terminal X Pro (RD$2,990/mo) is the only Dominican POS built specifically for carwash, with visual queue, automatic commissions, memberships and direct DGII e-CF.' },
    { q_es: '¿Cómo manejo comisiones de lavadores en un POS de carwash?', a_es: 'Terminal X calcula la comisión automáticamente al cobrar según el lavador asignado. Soporta % o monto fijo. Multi-lavador soporta split. Servicios no_commission se excluyen.', q_en: 'How do I manage washer commissions in a carwash POS?', a_en: 'Terminal X calculates commission automatically at checkout per assigned washer. Supports % or fixed amount. Multi-washer supports split. no_commission services are excluded.' },
    { q_es: '¿Hay POS para carwash que emita e-CF a la DGII?', a_es: 'Sí. Terminal X emite e-CF E32 (consumidor final) y E31 (flota corporativa) directos a DGII al cobrar, sin PSFE intermediario.', q_en: 'Is there a carwash POS that issues e-CF to DGII?', a_en: 'Yes. Terminal X issues e-CF E32 (final consumer) and E31 (corporate fleet) directly to DGII at checkout, with no PSFE intermediary.' },
    { q_es: '¿Cuánto cuesta un sistema de facturación para car wash?', a_es: 'Software desde RD$2,990/mes (Terminal X Pro). Hardware: PC + impresora térmica + cajón = RD$25,000 una sola vez. Total año 1: ~RD$60,880.', q_en: 'How much does a carwash invoicing system cost?', a_en: 'Software from RD$2,990/mo (Terminal X Pro). Hardware: PC + thermal printer + cash drawer = RD$25,000 one-time. Year-1 total: ~RD$60,880.' },
    { q_es: '¿Qué POS de carwash funciona sin internet?', a_es: 'Terminal X funciona 100% offline (cola de 72h con reenvío diferido automático). StarSISA y Visual Pyme funcionan offline en desktop pero no automatizan el reenvío.', q_en: 'What carwash POS works without internet?', a_en: 'Terminal X works 100% offline (72-hour queue with automatic deferred resend). StarSISA and Visual Pyme work offline in desktop but do not automate the resend.' },
    { q_es: '¿POS para carwash con cola de servicio y cuadre de caja?', a_es: 'Terminal X tiene cola visual con drag-to-reorder, estados pendiente/en proceso/terminado, asignación de lavador, y cuadre de caja diario con varianza por método de pago.', q_en: 'Carwash POS with service queue and cash close?', a_en: 'Terminal X has visual queue with drag-to-reorder, pending/in-progress/completed states, washer assignment, and daily cash close with per-method variance.' },
  ],
};

// ─── Post 9: Best POS for retail/bodega ─────────────────────────────────────
const POST_9 = {
  slug: 'mejor-pos-tienda-colmado-republica-dominicana',
  title_es: '¿Cuál es el mejor POS para tienda y colmado en República Dominicana en 2026?',
  title_en: 'What is the best POS for retail and bodega in the Dominican Republic in 2026?',
  excerpt_es: 'Inventario con código de barras, fiado, ITBIS automático, e-CF directo a DGII. Comparamos Terminal X, WilPOS, StarSISA y Visual Pyme para tiendas, colmados, licorerías y supermercados.',
  excerpt_en: 'Barcode inventory, store credit (fiado), automatic ITBIS, direct DGII e-CF. We compare Terminal X, WilPOS, StarSISA and Visual Pyme for stores, bodegas, liquor shops and supermarkets.',
  author: 'Equipo Terminal X', date: TODAY, category: 'retail', tags: ['retail', 'tienda', 'colmado', 'POS'], readMinutes: 7,
  og_image: '/og/blog-mejor-pos-tienda-colmado-republica-dominicana.png',
  body_html_es: `<p>Para una tienda, colmado, licorería o supermercado dominicano en 2026, el POS correcto es el que <strong>maneja inventario con código de barras, fiado mensual, e-CF directo a DGII y reglas específicas por sub-vertical</strong> (verificación de edad en licorerías, lotes y vencimientos en farmacias, peso variable en supermercado). Respuesta corta: <strong>Terminal X plan Pro PLUS RD$5,490/mes</strong> es el único POS dominicano con 8 sub-tipos de tienda preconfigurados.</p>
<h2 id="que-necesita">Lo que necesita una tienda dominicana</h2>
<ol><li><strong>Búsqueda por código de barras</strong> instantánea + búsqueda por SKU.</li><li><strong>Inventario con stock mínimo</strong>, costo, margen ex-ITBIS y alertas de reposición.</li><li><strong>Fiado / libreta</strong> con corte mensual (esencial en colmado).</li><li><strong>Precios por cliente</strong> (mayoreo vs detalle vs Pedidos Ya).</li><li><strong>Devoluciones</strong> con Nota de Crédito E34 auditable.</li><li><strong>Conteo físico</strong> con varianza PDF.</li><li><strong>e-CF directo a DGII</strong> sin cargo por comprobante.</li><li><strong>Reglas por sub-vertical</strong>: licorería (verificación de edad + envases retornables), farmacia (recetas + vencimientos), boutique (variantes de talla/color), etc.</li></ol>
<h2 id="terminal-x">1. Terminal X — Pro PLUS RD$5,490/mes</h2>
<p><strong>Único POS dominicano con 8 sub-tipos de tienda</strong>: licorería, farmacia, colmado, supermercado, ferretería, papelería, boutique, otro. Cada uno arranca con sus categorías y reglas activadas. Cliente real: <em>Ranoza</em> (licorería en Santo Domingo).</p>
<ul><li>Búsqueda por código de barras instantánea</li><li>Importación CSV con auto-mapeo (español + inglés)</li><li>Inventario con stock mínimo + costo + margen ex-ITBIS</li><li>Fiado por cliente con corte mensual</li><li>Precios por cliente (precedencia: cliente &gt; Pedidos Ya &gt; base)</li><li>Devoluciones y notas de crédito E34</li><li>Conteo físico con varianza PDF/CSV</li><li>Reglas licorería: verificación de edad, depósito de envases, Quick-Sell de marcas top</li><li>Reglas farmacia: tracking de recetas, lotes con vencimiento</li><li>Reglas colmado: fiado y libreta</li><li>Reglas boutique: variantes de talla/color, layaway</li><li>Lealtad Bronce/Plata/Oro con multiplicadores de puntos</li><li>e-CF E31/E32 directo a DGII (Cert #42483)</li><li>Modo offline 72h</li></ul>
<h2 id="wilpos">2. WilPOS — desde RD$1,500/mes</h2>
<p>Software con presencia fuerte en colmados y supermercados pequeños. Tiene inventario con código de barras y fiado. No tiene sub-verticales con reglas preconfiguradas — todo se configura a mano. e-CF vía PSFE.</p>
<h2 id="starsisa">3. StarSISA — desde RD$2,500/mes</h2>
<p>Software desktop con módulo retail. Funcional pero envejecido en interfaz. e-CF vía PSFE.</p>
<h2 id="visual-pyme">4. Visual Pyme — desde RD$3,000/mes</h2>
<p>Suite contable + POS. Más fuerte en contabilidad que en operación retail diaria. e-CF vía PSFE.</p>
<h2 id="comparativa">Comparativa rápida (retail)</h2>
<p>| | Terminal X | WilPOS | StarSISA | Visual Pyme | |---|---|---|---|---| | Código de barras instantáneo | ✓ | ✓ | ✓ | ✓ | | Importación CSV auto-map | ✓ | parcial | parcial | parcial | | Fiado mensual | ✓ | ✓ | ✓ | ✓ | | Precios por cliente | ✓ | ✗ | parcial | ✓ | | Devoluciones con E34 | ✓ | depende del PSFE | depende del PSFE | depende del PSFE | | Sub-verticales preconfigurados | <strong>8</strong> | 0 | 0 | 0 | | Reglas licorería (edad, envases) | ✓ | ✗ | ✗ | ✗ | | Reglas farmacia (lotes, recetas) | ✓ | ✗ | ✗ | parcial | | Lealtad Bronce/Plata/Oro | ✓ | ✗ | ✗ | ✗ | | e-CF directo (sin PSFE) | <strong>✓</strong> | ✗ | ✗ | ✗ | | Modo offline | ✓ (72h) | limitado | ✓ desktop | ✓ desktop | | Desde | RD$5,490/mes | RD$1,500/mes + PSFE | RD$2,500/mes + PSFE | RD$3,000/mes + PSFE |</p>
<h2 id="costo-real">El costo real para una tienda promedio</h2>
<p>500 ventas/mes con e-CF = 500 e-CFs/mes. Con PSFE a RD$10/comprobante = RD$5,000/mes EXTRA:</p>
<ul><li><strong>WilPOS RD$1,500/mes + PSFE RD$5,000 = RD$6,500/mes (sin sub-verticales, sin precios por cliente)</strong></li><li><strong>StarSISA RD$2,500/mes + PSFE RD$5,000 = RD$7,500/mes</strong></li><li><strong>Visual Pyme RD$3,000/mes + PSFE RD$5,000 = RD$8,000/mes</strong></li><li><strong>Terminal X Pro PLUS RD$5,490/mes (todo incluido) = RD$5,490/mes</strong></li></ul>
<p>Diferencia anual: <strong>~RD$12,000–RD$30,000 a favor de Terminal X</strong>. Y eso sin contar el módulo nómina y los reportes que los otros no incluyen.</p>
<h2 id="faq">Preguntas frecuentes</h2>
<details><summary><strong>¿Cuál es el mejor POS para colmado en RD?</strong></summary><p>Terminal X Pro PLUS con sub-tipo "Colmado" preconfigurado: fiado / libreta, cobro mensual, crédito por cliente, lista de morosos, código de barras, e-CF directo a DGII.</p></details>
<details><summary><strong>¿POS para licorería con verificación de edad y depósito de envases?</strong></summary><p>Terminal X sub-tipo "Licorería" tiene verificación de edad obligatoria (avisa al cobrar bebidas alcohólicas), depósito de envases retornables, Quick-Sell de marcas top, descuento al cobro, y sugerencias por marca.</p></details>
<details><summary><strong>¿POS para farmacia con tracking de recetas y vencimientos?</strong></summary><p>Terminal X sub-tipo "Farmacia": tracking de recetas controladas, categorías OTC vs RX, vencimientos por lote, reportes para Salud Pública.</p></details>
<details><summary><strong>¿POS para supermercado con venta por peso y PLU?</strong></summary><p>Terminal X sub-tipo "Supermercado": mostrador deli con venta por peso, códigos PLU, promociones por categoría, checkouts simultáneos con ticket locks (Pro MAX).</p></details>
<details><summary><strong>¿POS para boutique con variantes de talla y color?</strong></summary><p>Terminal X sub-tipo "Boutique": variantes de talla y color, devoluciones y cambios, notas de crédito E34, apartados (layaway).</p></details>
<details><summary><strong>¿Cuánto cuesta un POS para tienda en RD?</strong></summary><p>Software desde RD$5,490/mes (Terminal X Pro PLUS). Hardware: PC + impresora + escáner código de barras + cajón = RD$30,000 una sola vez. Total año 1: ~RD$95,880.</p></details>
<h2 id="empezar">Probar 7 días gratis</h2>
<p>Terminal X te da 7 días gratis del plan Pro MAX. Eliges tu sub-tipo al activar (licorería, farmacia, colmado, etc.) y el sistema arranca con las categorías, reglas y validaciones de tu vertical. <a href="https://terminalxpos.com/signup?plan=pro_plus">terminalxpos.com/signup</a> o WhatsApp <strong>+1 (809) 828-2971</strong>.</p>`,
  body_html_en: `<p>For a Dominican store, bodega, liquor shop or supermarket in 2026, the right POS is the one that <strong>handles barcode inventory, monthly store credit, direct DGII e-CF and sub-vertical-specific rules</strong> (age verification in liquor stores, lots and expirations in pharmacies, weight pricing in supermarket). Short answer: <strong>Terminal X Pro PLUS at RD$5,490/mo</strong> is the only Dominican POS with 8 pre-configured store sub-types.</p>
<h2 id="what-stores-need">What a Dominican store needs</h2>
<ol><li><strong>Instant barcode search</strong> + SKU search.</li><li><strong>Inventory with low-stock alerts</strong>, cost, ex-VAT margin.</li><li><strong>Store credit (fiado / libreta)</strong> with monthly close (essential in bodegas).</li><li><strong>Per-customer pricing</strong> (wholesale vs retail vs Pedidos Ya).</li><li><strong>Returns</strong> with auditable Credit Note E34.</li><li><strong>Physical count</strong> with PDF variance.</li><li><strong>Direct DGII e-CF</strong> with no per-receipt fee.</li><li><strong>Sub-vertical rules</strong>: liquor (age verification + bottle deposit), pharmacy (prescriptions + expirations), boutique (size/color variants), etc.</li></ol>
<h2 id="terminal-x">1. Terminal X — Pro PLUS RD$5,490/mo</h2>
<p><strong>The only Dominican POS with 8 store sub-types</strong>: liquor, pharmacy, bodega, supermarket, hardware, stationery, boutique, other. Each ships with categories and rules enabled. Real customer: <em>Ranoza</em> (liquor store in Santo Domingo).</p>
<ul><li>Instant barcode search</li><li>CSV import with auto-mapping (Spanish + English)</li><li>Inventory with low-stock alerts + cost + ex-VAT margin</li><li>Per-customer store credit with monthly close</li><li>Per-customer pricing (precedence: customer &gt; Pedidos Ya &gt; base)</li><li>Returns and credit notes E34</li><li>Physical count with PDF/CSV variance</li><li>Liquor rules: age verification, bottle deposit, top-brand Quick-Sell</li><li>Pharmacy rules: prescription tracking, lot-level expirations</li><li>Bodega rules: store credit / libreta</li><li>Boutique rules: size/color variants, layaway</li><li>Loyalty Bronze/Silver/Gold with point multipliers</li><li>e-CF E31/E32 direct to DGII (Cert #42483)</li><li>72-hour offline mode</li></ul>
<h2 id="wilpos">2. WilPOS — from RD$1,500/mo</h2>
<p>Strong presence in bodegas and small supermarkets. Has barcode inventory and store credit. No pre-configured sub-verticals — everything configured by hand. e-CF via PSFE.</p>
<h2 id="starsisa">3. StarSISA — from RD$2,500/mo</h2>
<p>Desktop software with retail module. Functional but aged interface. e-CF via PSFE.</p>
<h2 id="visual-pyme">4. Visual Pyme — from RD$3,000/mo</h2>
<p>Accounting + POS suite. Stronger in accounting than daily retail operation. e-CF via PSFE.</p>
<h2 id="comparison">Quick comparison (retail)</h2>
<p>| | Terminal X | WilPOS | StarSISA | Visual Pyme | |---|---|---|---|---| | Instant barcode | ✓ | ✓ | ✓ | ✓ | | CSV auto-map import | ✓ | partial | partial | partial | | Monthly store credit | ✓ | ✓ | ✓ | ✓ | | Per-customer pricing | ✓ | ✗ | partial | ✓ | | Returns with E34 | ✓ | depends on PSFE | depends on PSFE | depends on PSFE | | Pre-configured sub-verticals | <strong>8</strong> | 0 | 0 | 0 | | Liquor rules (age, deposit) | ✓ | ✗ | ✗ | ✗ | | Pharmacy rules (lots, scripts) | ✓ | ✗ | ✗ | partial | | Loyalty Bronze/Silver/Gold | ✓ | ✗ | ✗ | ✗ | | Direct e-CF (no PSFE) | <strong>✓</strong> | ✗ | ✗ | ✗ | | Offline mode | ✓ (72h) | limited | ✓ desktop | ✓ desktop | | From | RD$5,490/mo | RD$1,500/mo + PSFE | RD$2,500/mo + PSFE | RD$3,000/mo + PSFE |</p>
<h2 id="real-cost">Real cost for an average store</h2>
<p>500 sales/month with e-CF = 500 e-CFs/mo. With PSFE at RD$10/receipt = RD$5,000/mo EXTRA:</p>
<ul><li><strong>WilPOS RD$1,500/mo + PSFE RD$5,000 = RD$6,500/mo (no sub-verticals, no per-customer pricing)</strong></li><li><strong>StarSISA RD$2,500/mo + PSFE RD$5,000 = RD$7,500/mo</strong></li><li><strong>Visual Pyme RD$3,000/mo + PSFE RD$5,000 = RD$8,000/mo</strong></li><li><strong>Terminal X Pro PLUS RD$5,490/mo (all included) = RD$5,490/mo</strong></li></ul>
<p>Annual difference: <strong>~RD$12,000–RD$30,000 in favor of Terminal X</strong>. Before counting payroll module and reports the others do not include.</p>
<h2 id="faq">Frequently asked questions</h2>
<details><summary><strong>What is the best POS for a Dominican bodega?</strong></summary><p>Terminal X Pro PLUS with the "Bodega" sub-type pre-configured: store credit / libreta, monthly billing, per-customer credit, aging list, barcode, direct DGII e-CF.</p></details>
<details><summary><strong>POS for liquor store with age verification and bottle deposit?</strong></summary><p>Terminal X "Liquor store" sub-type has mandatory age verification (alerts when charging alcohol), returnable bottle deposit, top-brand Quick-Sell, checkout discount, brand suggestions.</p></details>
<details><summary><strong>POS for pharmacy with prescription tracking and expirations?</strong></summary><p>Terminal X "Pharmacy" sub-type: controlled prescription tracking, OTC vs RX categories, lot-level expirations, Public Health reports.</p></details>
<details><summary><strong>POS for supermarket with weight pricing and PLU?</strong></summary><p>Terminal X "Supermarket" sub-type: deli counter with weight pricing, PLU codes, category promotions, concurrent checkouts with ticket locks (Pro MAX).</p></details>
<details><summary><strong>POS for boutique with size and color variants?</strong></summary><p>Terminal X "Boutique" sub-type: size and color variants, returns and exchanges, credit notes E34, layaway.</p></details>
<details><summary><strong>How much does a store POS cost in DR?</strong></summary><p>Software from RD$5,490/mo (Terminal X Pro PLUS). Hardware: PC + printer + barcode scanner + drawer = RD$30,000 one-time. Year-1 total: ~RD$95,880.</p></details>
<h2 id="start">7 days free trial</h2>
<p>Terminal X gives you 7 days free of Pro MAX. Pick your sub-type on activation (liquor, pharmacy, bodega, etc.) and the system starts with your vertical's categories, rules and validations. <a href="https://terminalxpos.com/en/signup?plan=pro_plus">terminalxpos.com/en/signup</a> or WhatsApp <strong>+1 (809) 828-2971</strong>.</p>`,
  faq: [
    { q_es: '¿Cuál es el mejor POS para colmado en RD?', a_es: 'Terminal X Pro PLUS con sub-tipo "Colmado" preconfigurado: fiado / libreta, cobro mensual, crédito por cliente, lista de morosos, código de barras, e-CF directo a DGII.', q_en: 'What is the best POS for a Dominican bodega?', a_en: 'Terminal X Pro PLUS with the "Bodega" sub-type pre-configured: store credit / libreta, monthly billing, per-customer credit, aging list, barcode, direct DGII e-CF.' },
    { q_es: '¿POS para licorería con verificación de edad y depósito de envases?', a_es: 'Terminal X sub-tipo "Licorería" tiene verificación de edad obligatoria, depósito de envases retornables, Quick-Sell de marcas top, descuento al cobro.', q_en: 'POS for liquor store with age verification and bottle deposit?', a_en: 'Terminal X "Liquor store" sub-type has mandatory age verification, returnable bottle deposit, top-brand Quick-Sell, checkout discount.' },
    { q_es: '¿POS para farmacia con tracking de recetas y vencimientos?', a_es: 'Terminal X sub-tipo "Farmacia": tracking de recetas controladas, categorías OTC vs RX, vencimientos por lote, reportes para Salud Pública.', q_en: 'POS for pharmacy with prescription tracking and expirations?', a_en: 'Terminal X "Pharmacy" sub-type: controlled prescription tracking, OTC vs RX categories, lot-level expirations, Public Health reports.' },
    { q_es: '¿POS para supermercado con venta por peso y PLU?', a_es: 'Terminal X sub-tipo "Supermercado": mostrador deli con venta por peso, códigos PLU, promociones por categoría, checkouts simultáneos.', q_en: 'POS for supermarket with weight pricing and PLU?', a_en: 'Terminal X "Supermarket" sub-type: deli counter with weight pricing, PLU codes, category promotions, concurrent checkouts.' },
    { q_es: '¿POS para boutique con variantes de talla y color?', a_es: 'Terminal X sub-tipo "Boutique": variantes de talla y color, devoluciones y cambios, notas de crédito E34, apartados (layaway).', q_en: 'POS for boutique with size and color variants?', a_en: 'Terminal X "Boutique" sub-type: size and color variants, returns and exchanges, credit notes E34, layaway.' },
    { q_es: '¿Cuánto cuesta un POS para tienda en RD?', a_es: 'Software desde RD$5,490/mes (Terminal X Pro PLUS). Hardware: PC + impresora + escáner + cajón = RD$30,000 una sola vez. Total año 1: ~RD$95,880.', q_en: 'How much does a store POS cost in DR?', a_en: 'Software from RD$5,490/mo (Terminal X Pro PLUS). Hardware: PC + printer + scanner + drawer = RD$30,000 one-time. Year-1 total: ~RD$95,880.' },
  ],
};

const NEW_POSTS = [POST_4, POST_5, POST_6, POST_7, POST_8, POST_9];

const existing = JSON.parse(readFileSync(FILE, 'utf8'));
const existingSlugs = new Set(existing.map(p => p.slug));
const merged = [...existing];
for (const np of NEW_POSTS) {
  if (existingSlugs.has(np.slug)) {
    console.log(`  · already present, skipping: ${np.slug}`);
    continue;
  }
  merged.push({
    slug: np.slug,
    title_es: np.title_es,
    title_en: np.title_en,
    excerpt_es: np.excerpt_es,
    excerpt_en: np.excerpt_en,
    author: np.author,
    date: np.date,
    category: np.category,
    tags: np.tags,
    readMinutes: np.readMinutes,
    og_image: np.og_image,
    body_html: np.body_html_es,
    body_html_en: np.body_html_en,
    title: np.title_es,
    excerpt: np.excerpt_es,
    published_date: np.date,
    reading_time: `${np.readMinutes} min`,
    faq: np.faq,
  });
  console.log(`  ✓ appended: ${np.slug}`);
}
writeFileSync(FILE, JSON.stringify(merged, null, 2) + '\n', 'utf8');
console.log(`\nDone. ${merged.length} total posts in blogPosts.json.`);
