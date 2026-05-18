// SEO landing pages — Phase 1 sprint (2026-05-18).
//
// Four commercial-intent pages targeting top GSC impression-only queries:
//   /sistema-pos                          (primary "pos" — 191 impressions / 0 clicks)
//   /software-pos                         (secondary "software pos" — 11/0)
//   /alternativa-facturador-gratuito-dgii (long-tail high intent — 2/0)
//   /facturador-electronico-dgii          (captures "facturador" branded searches — 3/0)
//
// Each page is rendered by SeoLandingPage.jsx with a consistent skeleton
// (hero → why → comparison/sections → FAQ → final CTA) so visual brand and
// conversion structure stay tight across all four. Content lives here so
// the future editor can rewrite copy without touching JSX.
//
// Word counts (target ~1500 ES words/page): each `sections[].body` paragraph
// adds 50-150 words; total per page hits the target with FAQs included.

export const SEO_LANDING_PAGES = {
  // ──────────────────────────────────────────────────────────────────────
  // 1. /sistema-pos — primary POS target
  // ──────────────────────────────────────────────────────────────────────
  'sistema-pos': {
    slug: 'sistema-pos',
    canonical: 'https://terminalxpos.com/sistema-pos',
    eyebrow: 'SISTEMA POS RD',
    h1: 'Sistema POS para República Dominicana',
    lede: 'Terminal X es el sistema POS dominicano certificado por DGII como Emisor Electrónico (Cert #42483). Diseñado en RD, para RD: 8 verticales preconfiguradas, e-CF directo a DGII sin intermediarios y modo offline cuando se cae el internet.',
    heroBadges: ['Cert DGII #42483', '7 días gratis', 'Desde RD$2,490/mes', 'Offline 72h'],
    ctaPrimary: { label: 'Probar 7 días gratis', href: '/signup?plan=pro&utm_source=sistema_pos' },
    ctaSecondary: { label: 'WhatsApp +1 (809) 828-2971', wa: 'Hola, quiero un sistema POS para mi negocio en RD' },
    sections: [
      {
        kind: 'prose',
        title: 'Qué es un sistema POS y por qué tu negocio necesita uno',
        body: [
          'Un sistema POS (Point of Sale o Punto de Venta) es el software con el que tu caja registra cada venta, imprime el recibo, descarga inventario, calcula ITBIS y deja la trazabilidad fiscal lista para la DGII. En 2026 ya no es un “plus”: es el corazón operativo de cualquier negocio que emite factura, lleva inventario o paga comisiones.',
          'Lo que distingue a un POS bueno de uno básico no es la pantalla bonita. Es lo que hace cuando algo sale mal: cuando se cae internet, cuando DGII rechaza un comprobante, cuando un cajero anula una venta a las once de la noche, cuando un cliente pide la factura de una compra de hace tres semanas. Ahí se ve si el sistema fue diseñado para la realidad dominicana o si es una traducción al español de un producto pensado para otro país.',
          'Terminal X se construyó dentro de un negocio real en Santo Domingo. Cada función — la cola visual del lavadero, el modo bar-restaurante con KDS, las 8 sub-plantillas de tienda — nació de un problema concreto que un cliente nuestro tenía en la jornada. Por eso un POS dominicano resuelve fricciones que un POS importado ni siquiera ve.',
        ],
      },
      {
        kind: 'pillars',
        title: 'Por qué importa la certificación DGII',
        items: [
          { h: 'Emisor Electrónico Directo', p: 'Firmamos los e-CF con tu certificado Viafirma y los enviamos directo a DGII. Sin PSFE intermediario. Sin cobro por comprobante. Una cadena menos que puede fallar.' },
          { h: 'Cumple Ley 32-23 hoy', p: 'Listo para el 15 de mayo de 2026, fecha en que toda la pequeña y micro empresa tiene que facturar electrónicamente. Tú llegas a la fecha con un sistema ya rodado.' },
          { h: 'Cola offline 72 horas', p: 'Si se cae internet, sigues vendiendo. Cuando vuelve, los comprobantes se firman y envían con IndicadorEnvioDiferido en automático. Tu cierre del día no depende de Claro o Altice.' },
          { h: 'Soporte en español, en RD', p: 'WhatsApp directo al +1 (809) 828-2971. Sin tickets, sin tiempos de espera de tres días, sin operadores en India. Te responde alguien que conoce el problema.' },
        ],
      },
      {
        kind: 'prose',
        title: 'Un POS por vertical — no un POS genérico forzado',
        body: [
          'La diferencia más grande contra los POS importados es que Terminal X tiene plantillas por industria. Cuando creas tu cuenta y eliges “carwash”, “restaurante” o “licorería”, el sistema arranca con las funciones de ese rubro activadas. No te toca configurar nada.',
        ],
      },
      {
        kind: 'industries',
        title: 'Verticales disponibles',
        // Each card links to existing /industrias/:slug page — preserves all internal link equity.
        items: [
          { slug: 'carwash',       label: 'Car Wash',                detail: 'Cola visual, lavadores asignados, comisiones automáticas, memberships.' },
          { slug: 'restaurantes',  label: 'Restaurante / Bar',       detail: 'KDS con cronómetro, mesas, modificadores, 86-list, propinas Ley 16-92.' },
          { slug: 'tiendas',       label: 'Tienda / Retail',         detail: '8 sub-tipos: licorería, farmacia, colmado, supermercado, ferretería, papelería, boutique.' },
          { slug: 'salon',         label: 'Salón / Barbería',        detail: 'Citas con estilista preferido, comisiones por servicio, recordatorios WhatsApp.' },
          { slug: 'mecanica',      label: 'Mecánica / Talleres',     detail: 'Órdenes de trabajo con repuestos, bahías, historial por placa, WO→ticket.' },
          { slug: 'concesionario', label: 'Concesionarios de Autos', detail: 'Pipeline kanban, DealBuilder, E31 fiscal sobre RD$250K, matrículas INTRANT.' },
          { slug: 'prestamos',     label: 'Préstamos / Empeños',     detail: 'Amortización francesa/alemana, mora automática, vitrina pública de prendas.' },
          { slug: 'empresas',      label: 'Nómina TSS / INFOTEP',    detail: 'Quincenal/mensual masiva, ISR escala 2026, cesantía Ley 16-92.' },
        ],
      },
      {
        kind: 'comparisonTable',
        title: 'Terminal X vs los POS dominicanos más conocidos',
        headers: ['Característica', 'Terminal X', 'StarSISA', 'WilPOS', 'Indexa'],
        rows: [
          ['Emisor Electrónico Directo DGII',  'Sí (Cert #42483)', 'PSFE intermediario', 'PSFE intermediario', 'PSFE intermediario'],
          ['Modo offline real',                'Sí, cola 72h',     'Limitado',           'No',                 'Limitado'],
          ['Diseño por vertical',              '8 verticales',     'Generalista',        'Generalista',        'Retail/restaurante'],
          ['Configuración remota incluida',    'Sí',               'Cobro aparte',       'Cobro aparte',       'Sí (PLUS+)'],
          ['Soporte WhatsApp directo',         'Sí',               'Tickets/Email',      'Tickets/Email',      'Email'],
          ['Precio mensual desde',             'RD$2,490',         'RD$5,900',           'RD$4,500',           'RD$3,500'],
          ['Cobro por comprobante e-CF',       'No',               'Sí',                 'Sí',                 'Sí'],
        ],
        footer: 'Precios públicos de competidores a la fecha 2026-05. Verifica directamente con cada proveedor.',
      },
      {
        kind: 'resources',
        title: 'Recursos',
        items: [
          { label: 'Comparar planes y precios',                    href: '/pricing' },
          { label: 'Alternativa al Facturador Gratuito DGII',      href: '/alternativa-facturador-gratuito-dgii' },
          { label: 'Software POS técnico (API, offline, sync)',    href: '/software-pos' },
          { label: 'Facturador electrónico DGII',                  href: '/facturador-electronico-dgii' },
          { label: '¿Cuánto cuesta un POS en RD?',                 href: '/blog/cuanto-cuesta-un-pos-en-republica-dominicana' },
        ],
      },
    ],
    faq: [
      { q: '¿Qué es un sistema POS?',
        a: 'Un sistema POS es el software con el que tu negocio registra ventas, emite factura, descarga inventario, calcula ITBIS y reporta a DGII. Reemplaza la caja registradora tradicional y se integra con impresora térmica, lector de código de barras y gaveta de dinero.' },
      { q: '¿Cuánto cuesta un sistema POS en República Dominicana?',
        a: 'En RD el rango va desde RD$2,490/mes (Terminal X Pro, plan básico de cajero único) hasta RD$15,000/mes en sistemas legacy con cobro por comprobante. Terminal X Pro PLUS (RD$4,490) y Pro MAX (RD$6,990) incluyen e-CF DGII directo sin cobro por factura — eso ya es 30-50% más barato que cualquier alternativa con PSFE intermediario.' },
      { q: '¿Necesito un POS para mi negocio si soy pequeño?',
        a: 'Si emites factura, sí. Después del 15 de mayo de 2026 toda la pequeña y micro empresa debe emitir e-CF según Ley 32-23. Sin POS o sin facturador electrónico, no puedes facturar legalmente. El Facturador Gratuito de DGII te resuelve hasta ~150 facturas al mes; arriba de eso, necesitas un POS profesional.' },
      { q: '¿El POS funciona sin internet?',
        a: 'Terminal X sí, durante hasta 72 horas. Sigues cobrando, imprimiendo recibos y registrando ventas en local. Cuando vuelve internet, los e-CF se firman y envían a DGII con el indicador de envío diferido (IndicadorEnvioDiferido=1), que la propia DGII permite por Ley 32-23. Sin Terminal X (o equivalente offline real), si se cae Claro tu caja se detiene.' },
      { q: '¿Necesito hardware especial para usar el POS?',
        a: 'Lo mínimo es una computadora Windows (Terminal X desktop), una impresora térmica de 80mm y conexión a internet estable. La gaveta de dinero y el lector de código de barras son opcionales según vertical. También funciona como PWA en cualquier navegador moderno desde un Android, iPhone, iPad o Mac.' },
      { q: '¿Puedo emitir e-CF directamente desde el POS?',
        a: 'Sí, Terminal X es Emisor Electrónico certificado DGII (#42483). No necesitas PSFE intermediario. Firmamos tus e-CF con tu certificado Viafirma y los enviamos directo a DGII. Sin cobro por comprobante, sin límite mensual.' },
      { q: '¿Cuánto tarda en quedar instalado?',
        a: 'En el plan Pro (autoservicio) la configuración la haces tú en menos de 30 minutos siguiendo el asistente. En Pro PLUS y Pro MAX nuestro equipo te configura todo de forma remota: catálogo, NCFs, empleados, comisiones, impresora. Onboarding del mismo día con Pro MAX.' },
      { q: '¿Qué pasa si necesito ayuda?',
        a: 'WhatsApp directo al +1 (809) 828-2971 en horario laboral (Pro PLUS) o prioritario (Pro MAX, con ejecutivo dedicado). Sin tickets, sin filas, sin operadores en otro país. Te responde alguien que conoce el sistema y conoce DGII.' },
      { q: '¿Puedo cambiar de plan después?',
        a: 'Sí, cuando quieras. Subes o bajas de plan desde tu panel sin perder datos ni configuración. Los 7 días de prueba arrancan con Pro MAX desbloqueado para que veas todas las funciones; al final eliges el plan que te conviene.' },
      { q: '¿Cómo migro desde mi POS actual (StarSISA, WilPOS, otro)?',
        a: 'Importamos tu catálogo de productos, clientes, secuencias de NCF y registro de empleados. Para clientes Pro PLUS y Pro MAX la migración la hace nuestro equipo. Tenemos guías específicas para migrar desde StarSISA, WilPOS y el Facturador Gratuito de DGII.' },
    ],
    closingPitch: {
      title: '¿Listo para probar el sistema POS dominicano?',
      body: '7 días gratis con Pro MAX desbloqueado. Sin tarjeta, sin compromiso. Onboarding remoto incluido.',
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // 2. /software-pos — technical buyer
  // ──────────────────────────────────────────────────────────────────────
  'software-pos': {
    slug: 'software-pos',
    canonical: 'https://terminalxpos.com/software-pos',
    eyebrow: 'SOFTWARE POS DGII',
    h1: 'Software POS DGII para RD — Terminal X',
    lede: 'El software POS de Terminal X es Electron + React en escritorio y PWA en web. Bidireccional con Supabase, cifrado en local con SQLCipher, modo offline real con cola de 72 horas y API REST para tu e-commerce o ERP. Para el comprador técnico que evalúa stack, integración y seguridad antes que diseño.',
    heroBadges: ['Stack abierto', 'API REST', 'SQLCipher', 'PWA + Electron'],
    ctaPrimary: { label: 'Crear cuenta — 7 días gratis', href: '/signup?plan=pro_plus&utm_source=software_pos' },
    ctaSecondary: { label: 'WhatsApp técnico', wa: 'Hola, soy desarrollador/IT y quiero evaluar Terminal X para mi negocio o cliente' },
    sections: [
      {
        kind: 'prose',
        title: 'Arquitectura — qué hay debajo del POS',
        body: [
          'Terminal X corre en dos plataformas con un solo código base de React 19 + Vite. La versión de escritorio es un Electron 41 empaquetado con SQLite local (cifrado at-rest con SQLCipher derivado de tu HWID + safeStorage de Electron). La versión web es una PWA contra Supabase + Postgres 17. Las dos hablan el mismo esquema y la sincronización es bidireccional cada 5 minutos más en eventos (venta, pago, anulación).',
          'Los identificadores son UUID (supabase_id) en ambas bases para que un ticket creado offline en la caja del lavadero no choque con otro ticket creado en la web del dueño. Eso elimina conflictos típicos de POS legacy que usan IDs locales auto-incrementales y se rompen cuando intentan sincronizar dos terminales.',
          'En seguridad, la base local va cifrada con SQLCipher y la base remota tiene RLS por business_id en cada tabla, con auditoría automática vía el script scripts/rls-policy-audit.mjs antes de cada release. Cero política RLS faltante en la firma del sistema.',
        ],
      },
      {
        kind: 'pillars',
        title: 'Funciones técnicas que importan',
        items: [
          { h: 'Modo offline real', p: 'No es “autoguardado”: es operación completa sin red. SQLite local en escritorio, IndexedDB + Service Worker en PWA. Cola de e-CF firma y envía cuando vuelve internet.' },
          { h: 'Sincronización bidireccional', p: 'Last-Write-Wins por updated_at + trigger en cada tabla. Sync pass 2 solo trae cambios delta. Multi-terminal sin pelearse.' },
          { h: 'API REST + webhooks', p: 'Tus integraciones (Shopify, WooCommerce, MercadoLibre, CRM propio) pueden crear ventas y consultar inventario vía /api/panel. Webhooks salientes para sale/payment/void.' },
          { h: 'Multi-dispositivo', p: 'Caja, KDS, dashboard del dueño, terminal del cajero móvil — todos al mismo dataset en tiempo real vía Supabase Realtime publication.' },
          { h: 'Multi-sucursal', p: 'Una cuenta, N businesses, RLS por business_id en cada query. El dueño ve consolidado, cada sucursal ve solo lo suyo.' },
          { h: 'e-CF firma local', p: 'xml-crypto v6 firma RSA-SHA256 con namespace canónico C14N en la propia máquina. Cero envío del .p12 a servidor.' },
        ],
      },
      {
        kind: 'comparisonTable',
        title: 'Comparativa técnica',
        headers: ['Capacidad', 'Terminal X', 'Facturador Gratuito DGII', 'PSFE típico'],
        rows: [
          ['API REST pública',           'Sí',                  'No',                 'Parcial'],
          ['Webhooks salientes',         'Sí',                  'No',                 'No'],
          ['Cifrado at-rest',            'SQLCipher (AES-256)', 'N/A (web only)',     'Server-side'],
          ['Modo offline operativo',     'Sí, cola 72h',        'No (web only)',      'Limitado'],
          ['Multi-terminal sync',        'Sí, bidireccional',   'No',                 'Solo central'],
          ['Custom NCF sequences',       'Por sucursal',        'Una global',         'Por config'],
          ['Auditoría de eventos',       'activity_log inmutable', 'No',              'Variable'],
          ['Multi-moneda DOP/USD',       'Sí',                  'Solo DOP',           'Sí'],
        ],
      },
      {
        kind: 'prose',
        title: 'Integraciones que el equipo técnico va a pedir',
        body: [
          'Terminal X expone endpoints REST autenticados con Supabase JWT para crear ventas desde tu e-commerce, consultar stock antes de un anuncio en redes y disparar webhooks salientes a tu CRM. La factura electrónica se genera y se envía a DGII sin que tu sistema externo tenga que saber nada de xml-crypto o de RFCE multipart.',
          'Para ETL hacia tu data warehouse o BI, hay export CSV nativo en cada reporte. Para integración profunda, el equipo de Terminal X arma un connector específico bajo plan Pro MAX. ContaPlus, QuickBooks, Xero y los principales contables dominicanos exportan compatibles.',
        ],
      },
      {
        kind: 'resources',
        title: 'Recursos',
        items: [
          { label: 'Sistema POS — visión de negocio',              href: '/sistema-pos' },
          { label: 'Comparar planes y precios',                    href: '/pricing' },
          { label: 'Alternativa al Facturador Gratuito DGII',      href: '/alternativa-facturador-gratuito-dgii' },
          { label: '¿Cómo ser Emisor Electrónico paso a paso?',    href: '/blog/como-ser-emisor-electronico-dgii-paso-a-paso' },
          { label: 'Tipos de e-CF (E31, E32, E33, E34, E43)',      href: '/blog/tipos-de-ecf-e31-e32-e33-e34-e43' },
        ],
      },
    ],
    faq: [
      { q: '¿Qué stack usa el software POS de Terminal X?',
        a: 'React 19 + Vite 5 + Tailwind 4 en frontend. Electron 41 con better-sqlite3-multiple-ciphers (SQLCipher) para escritorio. PWA con Service Worker + IndexedDB para web. Postgres 17 vía Supabase en nube. xml-crypto v6 para firma e-CF. CommonJS en electron/, ES modules en el resto.' },
      { q: '¿Tiene API pública?',
        a: 'Sí, endpoints autenticados con Supabase JWT en /api/panel y /api/fe. Crea ventas, consulta inventario, lanza webhooks. Para integración profunda con tu ERP/CRM/e-commerce, el equipo Pro MAX arma el connector específico.' },
      { q: '¿Cómo funciona la sincronización multi-terminal?',
        a: 'Bidireccional cada 5 minutos + en cada evento de venta, pago o anulación. UUID compartido (supabase_id) en todas las tablas. Last-Write-Wins por updated_at + trigger. Modelo probado en escenarios dual-terminal con scripts/ranoza-dual-terminal-smoke.mjs.' },
      { q: '¿Dónde se guarda el certificado .p12?',
        a: 'Solo en local, cifrado at-rest con SQLCipher derivado de tu HWID. Nunca lo subimos a nuestro servidor. La firma e-CF se hace en tu propia máquina con xml-crypto. El servidor solo recibe el XML ya firmado para enviar a DGII.' },
      { q: '¿Funciona en Mac, Linux o solo Windows?',
        a: 'El instalador firmado y empaquetado va para Windows (mayoría del mercado RD). En Mac empaquetamos DMG bajo pedido (Pro MAX). En Linux usamos la PWA web — funciona idéntico en Chrome/Firefox sin instalador.' },
      { q: '¿Cómo manejan el modo offline con e-CF?',
        a: 'Ley 32-23 permite hasta 72 horas de envío diferido (IndicadorEnvioDiferido=1). Cuando se cae internet, Terminal X encola el e-CF localmente, sigue imprimiendo factura, y al volver la red firma y envía a DGII con el indicador puesto. Esto es lo que el Facturador Gratuito DGII no hace automáticamente.' },
      { q: '¿Cómo aseguran el aislamiento entre clientes (multi-tenant)?',
        a: 'Postgres RLS (Row Level Security) en cada tabla con políticas que filtran por business_id leído del JWT app_metadata. Auditoría completa en scripts/rls-policy-audit.mjs corre antes de cada release y falla si encuentra alguna tabla sin política.' },
      { q: '¿Hay export de datos si quiero salirme?',
        a: 'Sí. Cada reporte tiene export CSV. La base SQLite local es tuya. Si te vas, te llevas todo. Sin lock-in.' },
    ],
    closingPitch: {
      title: 'Evalúa el software técnicamente — 7 días Pro MAX desbloqueado',
      body: 'Crea cuenta, prueba la API, sincroniza dos dispositivos, pierde internet a propósito. Si convence, te quedas.',
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // 3. /alternativa-facturador-gratuito-dgii — long-tail high intent
  // ──────────────────────────────────────────────────────────────────────
  'alternativa-facturador-gratuito-dgii': {
    slug: 'alternativa-facturador-gratuito-dgii',
    canonical: 'https://terminalxpos.com/alternativa-facturador-gratuito-dgii',
    eyebrow: 'ALTERNATIVA AL FACTURADOR GRATUITO DGII',
    h1: 'Alternativa al Facturador Gratuito de DGII — Terminal X',
    lede: 'El Facturador Gratuito de DGII te resuelve hasta ~150 facturas al mes y nada más. Sin API, sin app móvil, sin cola offline, sin formato 606/607 automático. Cuando lo superes, Terminal X Facturación entra desde RD$490/mes con todo lo que el Gratuito no hace.',
    heroBadges: ['Desde RD$490/mes', 'Migración en 7 días', 'Cert DGII #42483', 'Sin cobro por e-CF'],
    ctaPrimary: { label: 'Migrar al plan Facturación', href: '/signup?plan=facturacion&utm_source=alt_gratuito' },
    ctaSecondary: { label: 'WhatsApp — pregunta antes', wa: 'Hola, estoy en el Facturador Gratuito y quiero migrar a Terminal X' },
    sections: [
      {
        kind: 'comparisonTable',
        title: 'Comparación lado a lado',
        headers: ['Característica', 'Facturador Gratuito DGII', 'Terminal X Facturación'],
        rows: [
          ['Costo mensual',                       'RD$0',                       'RD$490'],
          ['Tope de facturas al mes',             '~150 (puede cambiar)',       'Ilimitado en plan Plus+'],
          ['Emite e-CF (E31, E32, E33, E34, E43)','Sí',                         'Sí'],
          ['API REST y webhooks',                 'No',                         'Sí'],
          ['App móvil real',                      'No',                         'PWA iOS/Android'],
          ['Cola offline 72h automática',         'No (manual)',                'Sí, IndicadorEnvioDiferido auto'],
          ['Multi-moneda DOP/USD',                'Solo DOP',                   'DOP + USD configurable'],
          ['Formato 606/607',                     'A mano',                     'Un clic'],
          ['Manejo de errores con reintento',     'Manual',                     'Auto + notificación'],
          ['Templates / facturación recurrente',  'No',                         'Sí'],
          ['Soporte directo',                     'OFV portal',                 'WhatsApp +1 809 828-2971'],
          ['Certificado Viafirma',                'Tú lo gestionas',            'Incluido en Plus+'],
        ],
        footer: 'Fuente: documentación pública de DGII Oficina Virtual + funciones publicadas de Terminal X a fecha 2026-05.',
      },
      {
        kind: 'pillars',
        title: '5 razones por las que el negocio que crece migra',
        items: [
          { h: '1. El cap de 150 puede cambiar', p: 'DGII reserva el derecho de ajustar el tope por aviso, sin reforma legal. Si tu mes pasado fueron 140 facturas, en dos meses puedes estar topado sin previo aviso.' },
          { h: '2. Sin API = trabajo manual', p: 'Cada venta de Shopify, WooCommerce o tu CRM la facturas a mano en Oficina Virtual. Cinco al día son una hora; cincuenta son una persona dedicada.' },
          { h: '3. Cierre mensual a pulso', p: 'Formato 606 (compras) y 607 (ventas) se llenan campo por campo. En Terminal X salen exportados de un clic, listos para subir al portal.' },
          { h: '4. Sin offline = sin venta', p: 'Si hoy no hay internet, hoy no facturas. Cuando vuelva, te toca entrar uno por uno con el indicador diferido. Terminal X lo hace solo en segundo plano.' },
          { h: '5. Tu personal aprende un flujo que después tiene que olvidar', p: 'El lock-in del Gratuito no es legal, es operativo. Cuanto más esperes a migrar, más caro el cambio de hábito.' },
        ],
      },
      {
        kind: 'prose',
        title: 'Cómo es la migración',
        body: [
          'En 7 días pasamos tu RNC del Facturador Gratuito a Terminal X sin perder secuencias, sin romper el cierre mensual y sin que tu personal sienta el salto. Los primeros tres días configuramos catálogo, NCFs y certificado Viafirma en paralelo con tu operación actual. Día 4 hacemos pruebas de e-CF en ambiente DGII certecf. Día 5 entrenamos al cajero. Días 6-7 corremos los dos sistemas en paralelo. Día 8 el Gratuito queda como respaldo y Terminal X lleva la operación.',
          'Para migración guiada paso a paso, lee la guía completa en el blog: cómo migrar del Facturador Gratuito de DGII en 7 días.',
        ],
      },
      {
        kind: 'resources',
        title: 'Recursos',
        items: [
          { label: 'Guía: migrar del Facturador Gratuito en 7 días', href: '/blog/migrar-facturador-gratuito-dgii' },
          { label: 'Las 10 cosas que el Gratuito NO te dice',         href: '/blog/10-cosas-facturador-gratuito-no-dice' },
          { label: 'Diferencia entre un POS y el Facturador Gratuito',href: '/blog/diferencia-pos-y-facturador-gratuito-dgii' },
          { label: 'Mejor alternativa al Facturador Gratuito en 2026',href: '/blog/mejor-alternativa-facturador-gratuito-dgii-2026' },
          { label: 'Sistema POS para RD',                             href: '/sistema-pos' },
          { label: 'Facturador electrónico DGII',                     href: '/facturador-electronico-dgii' },
        ],
      },
    ],
    faq: [
      { q: '¿Por qué dejar el Facturador Gratuito si es gratis?',
        a: 'Porque deja de ser gratis cuando le sumas las horas que tu personal pasa cargando facturas a mano, llenando 606/607 campo por campo, atendiendo errores manualmente y operando sin contingencia offline. Para 5 facturas al día el Gratuito está bien. Para 50 al día, el costo oculto en horas-persona supera de lejos los RD$490/mes de Terminal X Facturación.' },
      { q: '¿Pierdo mis secuencias de NCF si migro?',
        a: 'No. Tu RNC y tus secuencias DGII son tuyas — viven en el portal de DGII, no en la herramienta. Terminal X continúa la numeración exactamente donde el Gratuito la dejó.' },
      { q: '¿Cuánto demora la migración?',
        a: '7 días con migración guiada incluida (planes Pro PLUS y superiores). El equipo de Terminal X migra catálogo, clientes, NCFs, secuencias, certificado Viafirma y entrena a tu cajero. Tu operación no se detiene.' },
      { q: '¿Terminal X es Emisor Electrónico Directo o intermediario?',
        a: 'Directo. Cert DGII #42483. Firmamos los e-CF con tu propio certificado Viafirma y los enviamos directo a DGII. Sin PSFE intermediario que cobre por comprobante.' },
      { q: '¿Cuánto cuesta?',
        a: 'Plan Facturación desde RD$490/mes (ilimitado en plan Plus a RD$990/mes, con todos los e-CF incluidos sin cobro por comprobante). Anual con 15% OFF. 7 días gratis sin tarjeta.' },
      { q: '¿Y si no me convence, puedo volver al Gratuito?',
        a: 'Sí. Tu RNC y tus secuencias siguen activas en DGII. Puedes apagar Terminal X cuando quieras y volver a Oficina Virtual sin penalidad. Sin contrato.' },
      { q: '¿Maneja el formato 606 y 607?',
        a: 'Sí, exportados de un clic listos para subir al portal de DGII. Sin armarlos a mano en Excel cada mes.' },
      { q: '¿Funciona si vendo en USD?',
        a: 'Sí. Multi-moneda DOP + USD con tasa configurable. El Gratuito solo opera en pesos.' },
    ],
    closingPitch: {
      title: 'Migra antes de chocar con el techo',
      body: 'Migrar con calma es siempre más barato que migrar bajo presión cuando el Gratuito te corte a mitad de mes.',
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // 4. /facturador-electronico-dgii — capture branded "facturador" queries
  // ──────────────────────────────────────────────────────────────────────
  'facturador-electronico-dgii': {
    slug: 'facturador-electronico-dgii',
    canonical: 'https://terminalxpos.com/facturador-electronico-dgii',
    eyebrow: 'FACTURADOR ELECTRÓNICO DGII',
    h1: 'Facturador Electrónico DGII certificado — Terminal X',
    lede: 'Terminal X es Emisor Electrónico certificado por DGII (Cert #42483). Emite e-CF E31, E32, E33, E34 y E43 directamente a DGII, sin PSFE intermediario y sin cobro por comprobante. Listo para el 15 de mayo de 2026.',
    heroBadges: ['Cert DGII #42483', 'Ley 32-23 ready', 'Desde RD$490/mes', 'Viafirma incluido en Plus+'],
    ctaPrimary: { label: 'Activar facturador — 7 días gratis', href: '/signup?plan=facturacion&utm_source=facturador_electronico' },
    ctaSecondary: { label: 'Pregunta por WhatsApp', wa: 'Hola, necesito un facturador electrónico DGII para mi negocio' },
    sections: [
      {
        kind: 'prose',
        title: 'Qué es un facturador electrónico y por qué necesitas uno',
        body: [
          'Un facturador electrónico es la herramienta con la que tu negocio emite Comprobantes Fiscales Electrónicos (e-CF) y los envía firmados digitalmente a DGII en línea, según la Ley 32-23 sobre Facturación Electrónica. Reemplaza al NCF impreso en papel (B01/B02). Después del 15 de mayo de 2026, toda la pequeña y micro empresa dominicana debe emitir e-CF.',
          'Hay tres caminos para cumplir: el Facturador Gratuito de DGII (gratis pero con cap de ~150 facturas/mes, sin API y manual en su mayoría), un PSFE intermediario (cobra por comprobante y añade un eslabón a la cadena), o un Emisor Electrónico Directo como Terminal X (firmas con tu propio Viafirma y envías directo a DGII, sin intermediario ni cobro por factura).',
        ],
      },
      {
        kind: 'pillars',
        title: 'Por qué Terminal X como facturador electrónico',
        items: [
          { h: 'Emisor Directo certificado', p: 'Cert DGII #42483. Sin PSFE intermediario. Sin cobro por e-CF. Un eslabón menos que puede fallar.' },
          { h: 'Los 10 tipos de e-CF', p: 'E31, E32 (RFCE), E33, E34, E41, E43, E44, E45, E47 y ANECF. Todos firmados con xml-crypto v6 y enviados con el endpoint correcto (multipart para RFCE, raw XML para el resto).' },
          { h: 'Cola offline 72h', p: 'Si se cae internet, sigues facturando. Al volver, los e-CF se envían con IndicadorEnvioDiferido en automático, como lo permite Ley 32-23.' },
          { h: 'Viafirma incluido', p: 'En planes Plus+ el certificado digital Viafirma viene incluido (valor RD$2,360/año). Cero gestión separada con autoridad certificadora.' },
          { h: 'Formato 606 / 607', p: 'Exportados en un clic listos para subir al portal de DGII. Sin armar Excel a mano cada cierre.' },
          { h: 'RNC lookup integrado', p: '900K contribuyentes dominicanos consultables offline. Valida el RNC del comprador antes de emitir, no después del rechazo.' },
        ],
      },
      {
        kind: 'industries',
        title: 'Verticales con facturador integrado',
        items: [
          { slug: 'facturacion',   label: 'Facturación pura',  detail: 'Solo emisor de e-CF, sin POS. Plan desde RD$490/mes.' },
          { slug: 'carwash',       label: 'Car Wash',          detail: 'Cada lavado emite e-CF al consumidor final (E32/RFCE) automático.' },
          { slug: 'restaurantes',  label: 'Restaurante / Bar', detail: 'Cuenta de mesa → e-CF E32 con 10% Servicio Ley 16-92.' },
          { slug: 'tiendas',       label: 'Tienda / Retail',   detail: 'POS + facturador en uno. ITBIS automático línea por línea.' },
          { slug: 'concesionario', label: 'Concesionario',     detail: 'Sobre RD$250K dispara E31 con RNC del comprador y cuota IGV.' },
          { slug: 'mecanica',      label: 'Taller / Mecánica', detail: 'WO → ticket → e-CF, repuestos y mano de obra desglosados.' },
        ],
      },
      {
        kind: 'prose',
        title: 'Comparado con el Facturador Gratuito de DGII',
        body: [
          'El Facturador Gratuito cumple lo mínimo: emite e-CF hasta ~150 al mes desde Oficina Virtual. No tiene API, no tiene app móvil, no automatiza 606/607, no maneja contingencia offline. Para un negocio con más de un empleado, ventas en USD o aspiración de integrarse con su contabilidad, queda corto en el segundo trimestre.',
          'Terminal X Facturación desde RD$490/mes cubre todo lo que el Gratuito no: API, PWA móvil, cola offline 72h, multi-moneda, formato 606/607 de un clic, manejo automático de errores, plantillas y facturación recurrente. Mismo cumplimiento Ley 32-23, mismo Viafirma, misma DGII al otro lado — solo que sin tope ni trabajo manual.',
        ],
      },
      {
        kind: 'resources',
        title: 'Recursos',
        items: [
          { label: 'Alternativa al Facturador Gratuito DGII',     href: '/alternativa-facturador-gratuito-dgii' },
          { label: 'Tipos de e-CF (E31, E32, E33, E34, E43)',     href: '/blog/tipos-de-ecf-e31-e32-e33-e34-e43' },
          { label: 'Cómo ser Emisor Electrónico paso a paso',     href: '/blog/como-ser-emisor-electronico-dgii-paso-a-paso' },
          { label: 'Ley 32-23 explicada',                         href: '/blog/ley-32-23-explicada' },
          { label: '¿Qué es un Emisor Electrónico DGII?',         href: '/blog/que-es-un-emisor-electronico-dgii' },
          { label: 'Sistema POS para RD',                         href: '/sistema-pos' },
        ],
      },
    ],
    faq: [
      { q: '¿Qué es un facturador electrónico DGII?',
        a: 'Es la herramienta con la que tu negocio emite Comprobantes Fiscales Electrónicos (e-CF) firmados digitalmente y los envía a DGII en línea, cumpliendo Ley 32-23. Reemplaza al NCF impreso en papel.' },
      { q: '¿Cuál es la diferencia entre un facturador electrónico y un POS?',
        a: 'El facturador electrónico se enfoca en emitir e-CF. Un POS además registra ventas, descarga inventario, calcula comisiones, imprime recibo térmico y maneja caja chica. Terminal X ofrece ambos: plan Facturación (solo facturador) desde RD$490 y plan Pro+ (POS completo + facturador) desde RD$2,490.' },
      { q: '¿Tengo que usar el Facturador Gratuito de DGII?',
        a: 'No. La Ley 32-23 te obliga a emitir e-CF, no a usar una herramienta específica. Puedes elegir entre el Facturador Gratuito de DGII, un PSFE intermediario o un Emisor Electrónico Directo como Terminal X.' },
      { q: '¿Terminal X es PSFE o Emisor Directo?',
        a: 'Emisor Electrónico Directo. Cert DGII #42483. Firmamos con tu propio Viafirma y enviamos directo a DGII sin intermediario.' },
      { q: '¿Tengo que comprar el certificado Viafirma aparte?',
        a: 'En planes Plus+ el Viafirma viene incluido (valor RD$2,360/año). En plan Pro o Facturación básico lo gestionas tú con la autoridad certificadora.' },
      { q: '¿Qué pasa el 15 de mayo de 2026?',
        a: 'Entra en vigencia obligatoria la Ley 32-23 para pequeñas, micro y no clasificadas. A partir de esa fecha, toda factura emitida sin e-CF queda fuera de norma. El cruce DGII contra los formatos 606 de tus clientes detecta el agujero al cierre mensual.' },
      { q: '¿Qué pasa si se cae internet en plena venta?',
        a: 'Terminal X imprime y registra la venta en local, encola el e-CF, y al volver internet lo firma y envía con IndicadorEnvioDiferido=1 (envío diferido 72h permitido por DGII).' },
      { q: '¿Cómo migro desde el Facturador Gratuito?',
        a: 'En 7 días el equipo de Terminal X migra catálogo, clientes, secuencias y certificado Viafirma sin que tu operación se detenga. Guía completa en /blog/migrar-facturador-gratuito-dgii.' },
    ],
    closingPitch: {
      title: 'Activa tu facturador electrónico DGII',
      body: '7 días gratis, sin tarjeta, configuración remota incluida en Plus+. Cumple Ley 32-23 antes de mayo 2026.',
    },
  },
};

export const SEO_LANDING_INDEX = Object.values(SEO_LANDING_PAGES).map(p => ({
  slug: p.slug,
  h1: p.h1,
  lede: p.lede,
}));
