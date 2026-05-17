/**
 * Terminal X · JSON-LD structured data generators
 *
 * Each function returns a JSON-stringified Schema.org payload, ready to drop
 * inside <script type="application/ld+json">…</script>. Keep these pure / static —
 * no runtime data, no Supabase, no async. They are consumed by both the SSR
 * shell (web/index.html) and any future per-route head injection.
 *
 * Source of truth for prices: packages/ui/landing/data (mirror with usePlan.jsx).
 * Source of truth for FAQ: packages/ui/landing/LandingPage.jsx (verbatim).
 */

const SITE_URL = 'https://terminalxpos.com'
const ORG_NAME = 'Studio X SRL'
const ORG_RNC = '133410321'
const SUPPORT_PHONE = '+18098282971'
const LOGO_URL = `${SITE_URL}/icons/icon-512.png`
const OG_IMAGE_URL = `${SITE_URL}/og-image.png`

/* -------------------------------------------------------------------------- */
/* SoftwareApplication                                                         */
/* -------------------------------------------------------------------------- */

const TIERS = [
  { name: 'Facturación Pro',       price: '490',  desc: '50 e-CFs/mes · directo a DGII sin PSFE · 1 usuario' },
  { name: 'Facturación Pro PLUS',  price: '990',  desc: '250 e-CFs/mes · multi-usuario · multi-moneda · 606/607' },
  { name: 'Facturación Pro MAX',   price: '1990', desc: 'e-CFs ilimitados · multi-sucursal · API · soporte prioritario' },
  { name: 'POS Pro',               price: '2490', desc: 'POS completo · NCF papel · cuadre + caja chica · 2 usuarios' },
  { name: 'POS Pro PLUS',          price: '4490', desc: 'POS + e-CF directo a DGII · Viafirma incluido · 5 usuarios · comisiones' },
  { name: 'POS Pro MAX',           price: '6990', desc: 'Todo + nómina TSS/INFOTEP/ISR · usuarios ilimitados · dashboard remoto' },
]

export function softwareApplicationLd() {
  const offers = TIERS.map(t => ({
    '@type': 'Offer',
    name: `Terminal X ${t.name}`,
    description: t.desc,
    price: t.price,
    priceCurrency: 'DOP',
    priceSpecification: {
      '@type': 'UnitPriceSpecification',
      price: t.price,
      priceCurrency: 'DOP',
      unitCode: 'MON',
      referenceQuantity: { '@type': 'QuantitativeValue', value: '1', unitCode: 'MON' },
    },
    availability: 'https://schema.org/InStock',
    url: `${SITE_URL}/signup?plan=${t.name.toLowerCase().replace(/\s+/g, '-')}`,
  }))

  const data = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Terminal X',
    alternateName: 'Terminal X POS',
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'PointOfSale',
    operatingSystem: 'Windows, Web, iOS, Android (PWA)',
    url: SITE_URL,
    image: OG_IMAGE_URL,
    description:
      'POS y facturación electrónica e-CF certificada por DGII (Cert #42483) para República Dominicana. Sin PSFE, sin costo por comprobante. Carwash, tiendas, restaurantes, servicios. Modo offline 72h, WhatsApp, RNC lookup 900K, formato 606/607.',
    softwareVersion: '2.14',
    inLanguage: ['es-DO', 'en'],
    offers,
    author: {
      '@type': 'Organization',
      name: ORG_NAME,
      url: 'https://studioxrd.com',
      taxID: ORG_RNC,
    },
    featureList: [
      'Facturación electrónica e-CF certificada DGII',
      'POS multi-vertical (carwash, tienda, restaurante, servicios)',
      'Modo offline 72h con cola automática',
      'RNC lookup 900K + fallback megaplus.com.do',
      'Formato 606 / 607 export 1-click',
      'Nómina TSS / INFOTEP / ISR DR-2026',
      'Loyalty Bronce / Plata / Oro',
      'WhatsApp envío automático post-cobro',
      'Multi-usuario con 5 roles',
      'ANECF voiding + Validar Certificado nonce',
    ].join(', '),
  }
  return JSON.stringify(data)
}

/* -------------------------------------------------------------------------- */
/* FAQPage — verbatim from LandingPage.jsx FAQ.es (10 Q&A)                     */
/* -------------------------------------------------------------------------- */

const FAQ_ES = [
  // Facturación tier (desde RD$490/mo) — must mirror LandingPage.jsx FAQ.es
  { q: 'Que incluye el plan Facturacion desde RD$490/mes?', a: 'Es la linea de solo facturacion electronica para negocios que ya usan otro POS o no necesitan cobrar en mostrador. Tres planes: Pro RD$490/mes (50 e-CFs/mes), Pro PLUS RD$990/mes (250 e-CFs/mes, multi-usuario, multi-moneda) y Pro MAX RD$1,990/mes (e-CFs ilimitados, multi-sucursal, API). Todos incluyen: emision directa de e-CF E31/E32/E33/E34 a DGII sin intermediarios PSFE, exportacion 606/607 para tu contador, RNC lookup local y envio por WhatsApp. El certificado Viafirma se incluye en Pro PLUS y Pro MAX.' },
  { q: 'Que pasa si emito una factura sin internet?', a: 'Terminal X la guarda en una cola local cifrada y la firma con IndicadorEnvioDiferido=1 cuando vuelva la conexion — exactamente como permite la DGII bajo la regla de 72 horas diferidas. La factura nunca se pierde y el comprobante sigue siendo valido.' },
  { q: 'Puedo emitir notas de credito (E33/E34) con el plan Facturacion?', a: 'Si. El plan Facturacion incluye emision de notas de credito E33 y E34 referenciando el e-NCF original. Las facturas anuladas se envian automaticamente a la cola de ANECF para que DGII las reciba como anuladas.' },
  { q: 'Puedo exportar 606 y 607 con el plan Facturacion?', a: 'Si — y es la razon principal por la que un plan de solo facturacion sirve en Republica Dominicana. Cada mes generas el TXT formato 606 (Compras) y 607 (Ventas) listo para subir al portal DGII. Tu contador no necesita armar nada a mano.' },
  { q: 'Que pasa cuando se vence mi certificado e-CF?', a: 'Terminal X te avisa con un banner rojo en el dashboard 30 dias antes del vencimiento, y bloquea la emision el dia que vence para que nunca subas un comprobante con certificado caducado. Cuando renuevas con Viafirma, instalas el nuevo .p12 y todo sigue. Sin sorpresas, sin multas.' },
  { q: 'Puedo manejar varias tasas de ITBIS y descuentos en una factura?', a: 'Si. Cada linea de la factura tiene su propia tasa (18% general, 16% reducida, 0% exportacion o Exento) y descuento por linea en porcentaje. Ademas puedes aplicar un descuento global en RD$ o porcentaje sobre el subtotal — todo con desglose correcto en el e-CF (MontoGravadoI1, MontoGravadoI2, MontoExento, MontoTotalDescuento).' },
  { q: 'Puedo cambiar de plan en cualquier momento?', a: 'Si, puedes subir o bajar de plan en cualquier momento desde el panel de administracion. El cambio se aplica inmediatamente.' },
  { q: 'Hay contrato anual obligatorio?', a: 'No. Puedes pagar mes a mes sin compromiso. El plan anual tiene 15% de descuento pero no es obligatorio.' },
  { q: 'Que pasa si me quedo sin internet?', a: 'Todo sigue funcionando 100% offline. Puedes cobrar, imprimir facturas, ver reportes. Se sincroniza automaticamente cuando vuelve la conexion (hasta 72 horas de cola).' },
  { q: 'Necesito comprar impresora especial?', a: 'Terminal X funciona con cualquier impresora termica 80mm USB. Si necesitas hardware nuevo, te lo vendemos a precio de costo: Impresora 2connect USB v6 RD$3,600, Impresora 2connect USB+LAN+Bluetooth+WiFi v10 RD$4,200, Lector 2D RD$1,400, Lector 2D inalambrico RD$2,000, Cajon 4 billetes/5 monedas RD$2,120, Cajon 5 billetes/8 monedas RD$3,170. El hardware NO esta incluido en la suscripcion mensual.' },
  { q: 'Que es e-CF y por que lo necesito?', a: 'e-CF (Comprobante Fiscal Electronico) es el nuevo formato obligatorio de la DGII bajo la Ley 32-23. Todos los negocios deben migrar antes de mayo 2026. Terminal X es el unico POS que se conecta directo a la DGII, sin intermediarios ni costos adicionales.' },
  { q: 'Funciona para mi tipo de negocio?', a: 'Si. Terminal X tiene modo Car Wash (cola de servicios, lavadores, comisiones), modo Tienda/Retail (inventario con codigo de barras, carrito con cantidades, stock automatico), y modo Servicios (talleres, salones, barber shops). El sistema se adapta automaticamente.' },
  { q: 'Como funciona el soporte?', a: 'Pro: autoservicio con guias. Pro PLUS: nuestro equipo te configura todo remotamente y soporte por WhatsApp en horario laboral. Pro MAX: ejecutivo dedicado + soporte prioritario + visita tecnica mensual.' },
  { q: 'Puedo manejar la nomina sin contratar un contador externo?', a: 'Si, y es una de las ventajas mas grandes de Pro MAX. Terminal X incluye nomina in-house completa: pagos quincenales o mensuales masivos en un click, calculo automatico de TSS (SFS + AFP con topes oficiales 2026), INFOTEP 1%, ISR progresivo (escalas DGII 2026), reportes listos para subir al portal TSS y DGII, recibos formales de pago, y log automatico de cambios de salario. Un contador externo en RD cobra entre RD$8,000 y RD$15,000/mes solo por esto — Pro MAX lo incluye por RD$6,990/mes.' },
  { q: 'Soy contador y manejo varios clientes — Terminal X me sirve?', a: 'Si — Pro MAX esta especificamente disenado para tu flujo. Tienes un cockpit Portfolio que muestra los 32 clientes en una sola pantalla con semaforo de obligaciones (verde radicado, ambar listo, rojo vencido). El sistema baja automaticamente cada noche los e-CFs recibidos de cada cliente desde el portal DGII Oficina Virtual (auto-pull). Generas el 606, 607, 608, 609, IR-17 e IR-13 de TODOS tus clientes con UN click — descarga un ZIP listo para subir. Conciliacion automatica detecta NCFs que faltan grabar. IT-1 mensual calculado con casillas listas para copiar. Anticipos ISR PJ calculados por Art. 314. Activos fijos con flujo de venta. Pago masivo bancario para BHD Leon y Banreservas. Modo Ver como cliente auditado para soporte directo. Cada cliente extra es solo un RNC mas — sin limite. Perla, nuestra contadora piloto, paso de 3 dias por cierre a 4 horas.' },
  { q: 'Como funciona el auto-pull de DGII?', a: 'En el panel Portfolio configuras la sesion DGII de cada cliente (pegas el ASP.NET_SessionId desde DevTools — F12 → Application → Cookies — o usas usuario/contrasena que el sistema cifra con AES-256-GCM). Cada noche a las 03:00 AST, un cron worker se conecta al portal DGII Oficina Virtual de cada cliente, descarga la lista de e-CFs Recibidos via la pagina ConsultaRCF.aspx, exporta el XLS, lo parsea, y guarda los registros. La proxima manana ves todos los comprobantes nuevos listos para clasificar. Cuando un cliente no te ha enviado un comprobante que el portal DGII si tiene registrado, el boton Conciliar con DGII lo detecta y te ofrece importarlo con un click, o generar un mensaje WhatsApp con los NCFs exactos que faltan.' },
  { q: 'Puedo importar datos de mi sistema anterior?', a: 'Si. Nuestro equipo puede importar tu historial de ventas, clientes y productos desde Starsisa, WilPOS u otros sistemas.' },
  { q: 'Que pasa si mi proveedor de facturacion electronica (PSFE) se cae?', a: 'Nada — porque no usamos uno. Terminal X es Emisor Electronico directo ante DGII. No dependemos de ef2.do, Indexa, ni ningun otro PSFE. Tu sistema firma y transmite los e-CF directamente al portal de DGII. Si un PSFE se cae, tus competidores dejan de facturar. Tu no.' },
]

export function faqPageLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: 'es-DO',
    mainEntity: FAQ_ES.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  }
  return JSON.stringify(data)
}

/* -------------------------------------------------------------------------- */
/* Organization                                                                */
/* -------------------------------------------------------------------------- */

export function organizationLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: 'Terminal X',
    legalName: ORG_NAME,
    url: SITE_URL,
    logo: { '@type': 'ImageObject', url: LOGO_URL, width: 512, height: 512 },
    image: OG_IMAGE_URL,
    taxID: ORG_RNC,
    vatID: ORG_RNC,
    foundingDate: '2024',
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Santo Domingo',
      addressRegion: 'Distrito Nacional',
      addressCountry: 'DO',
    },
    contactPoint: [
      {
        '@type': 'ContactPoint',
        telephone: SUPPORT_PHONE,
        contactType: 'customer support',
        areaServed: 'DO',
        availableLanguage: ['Spanish', 'English'],
      },
      {
        '@type': 'ContactPoint',
        telephone: SUPPORT_PHONE,
        contactType: 'sales',
        areaServed: 'DO',
        availableLanguage: ['Spanish', 'English'],
      },
    ],
    sameAs: [
      'https://studioxrd.com',
      'https://studioxrdtech.com',
      'https://studioxmedia.io',
      'https://studioxdetailing.com',
      `https://wa.me/${SUPPORT_PHONE.replace(/[^0-9]/g, '')}`,
    ],
  }
  return JSON.stringify(data)
}

/* -------------------------------------------------------------------------- */
/* LocalBusiness — extends Organization, geo + 24/7 SaaS hours                 */
/* -------------------------------------------------------------------------- */

export function localBusinessLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': `${SITE_URL}/#localbusiness`,
    name: 'Terminal X',
    legalName: ORG_NAME,
    url: SITE_URL,
    logo: LOGO_URL,
    image: OG_IMAGE_URL,
    telephone: SUPPORT_PHONE,
    priceRange: 'RD$490–RD$6,990',
    taxID: ORG_RNC,
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Santo Domingo',
      addressRegion: 'Distrito Nacional',
      addressCountry: 'DO',
    },
    geo: { '@type': 'GeoCoordinates', latitude: 18.4861, longitude: -69.9312 },
    areaServed: { '@type': 'Country', name: 'Dominican Republic' },
    openingHoursSpecification: [
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
        opens: '00:00',
        closes: '23:59',
      },
    ],
    parentOrganization: { '@id': `${SITE_URL}/#organization` },
  }
  return JSON.stringify(data)
}

/* -------------------------------------------------------------------------- */
/* All-in-one helper                                                           */
/* -------------------------------------------------------------------------- */

export function allStructuredData() {
  return [softwareApplicationLd(), faqPageLd(), organizationLd(), localBusinessLd()]
}
