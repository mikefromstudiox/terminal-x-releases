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
  { name: 'Facturación',           price: '995',  desc: '50 e-CFs/mes incluidos · RD$15 por extra' },
  { name: 'Facturación Plus',      price: '1990', desc: '200 e-CFs/mes incluidos · RD$10 por extra' },
  { name: 'Facturación Ilimitado', price: '2990', desc: 'e-CFs ilimitados · sin tope' },
  { name: 'Pro',                   price: '2490', desc: 'POS completo · NCF papel · 1 usuario' },
  { name: 'Pro PLUS',              price: '4490', desc: 'POS + e-CF ilimitado · 5 usuarios · loyalty' },
  { name: 'Pro MAX',               price: '6990', desc: 'Todo + nómina · ilimitados usuarios · digest diario' },
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
  { q: 'Puedo cambiar de plan en cualquier momento?', a: 'Si, puedes subir o bajar de plan en cualquier momento desde el panel de administracion. El cambio se aplica inmediatamente.' },
  { q: 'Hay contrato anual obligatorio?', a: 'No. Puedes pagar mes a mes sin compromiso. El plan anual tiene 15% de descuento pero no es obligatorio.' },
  { q: 'Que pasa si me quedo sin internet?', a: 'Todo sigue funcionando 100% offline. Puedes cobrar, imprimir facturas, ver reportes. Se sincroniza automaticamente cuando vuelve la conexion (hasta 72 horas de cola).' },
  { q: 'Necesito comprar impresora especial?', a: 'Terminal X funciona con cualquier impresora termica de 80mm con conexion USB. Nosotros podemos recomendarte e instalarte la impresora y el cajon de dinero.' },
  { q: 'Que es e-CF y por que lo necesito?', a: 'e-CF (Comprobante Fiscal Electronico) es el nuevo formato obligatorio de la DGII bajo la Ley 32-23. Todos los negocios deben migrar antes de mayo 2026. Terminal X es el unico POS que se conecta directo a la DGII, sin intermediarios ni costos adicionales.' },
  { q: 'Funciona para mi tipo de negocio?', a: 'Si. Terminal X tiene modo Car Wash (cola de servicios, lavadores, comisiones), modo Tienda/Retail (inventario con codigo de barras, carrito con cantidades, stock automatico), y modo Servicios (talleres, salones, barber shops). El sistema se adapta automaticamente.' },
  { q: 'Como funciona el soporte?', a: 'Pro: autoservicio con guias. Pro PLUS: nuestro equipo te configura todo remotamente y soporte por WhatsApp en horario laboral. Pro MAX: ejecutivo dedicado + soporte prioritario + visita tecnica mensual.' },
  { q: 'Puedo manejar la nomina sin contratar un contador externo?', a: 'Si, y es una de las ventajas mas grandes de Pro MAX. Terminal X incluye nomina in-house completa: pagos quincenales o mensuales masivos en un click, calculo automatico de TSS (SFS + AFP con topes oficiales 2026), INFOTEP 1%, ISR progresivo (escalas DGII 2026), reportes listos para subir al portal TSS y DGII, recibos formales de pago, y log automatico de cambios de salario. Un contador externo en RD cobra entre RD$8,000 y RD$15,000/mes solo por esto — Pro MAX lo incluye por RD$6,990/mes.' },
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
    priceRange: 'RD$995–RD$6,990',
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
