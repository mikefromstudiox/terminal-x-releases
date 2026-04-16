// Phase 4 — seed data for setupBusinessType() when onboarding a new business.
// Keeps the onboarding experience non-empty: 8 default mesas + realistic RD
// menu so the operator can test the flow end-to-end before typing anything.

export const SAMPLE_MESAS = [
  { name: 'Mesa 1', zone: 'Interior', capacity: 2 },
  { name: 'Mesa 2', zone: 'Interior', capacity: 2 },
  { name: 'Mesa 3', zone: 'Interior', capacity: 4 },
  { name: 'Mesa 4', zone: 'Interior', capacity: 4 },
  { name: 'Mesa 5', zone: 'Interior', capacity: 6 },
  { name: 'Mesa 6', zone: 'Terraza',  capacity: 4 },
  { name: 'Mesa 7', zone: 'Terraza',  capacity: 4 },
  { name: 'Mesa 8', zone: 'Barra',    capacity: 2 },
]

// One entry per business type. Each menu has categorias + items + modificadores.
export const SAMPLE_MENUS = {
  restaurant: {
    categorias: [
      { nombre: 'Entradas',   orden: 1 },
      { nombre: 'Principales', orden: 2 },
      { nombre: 'Pescados',   orden: 3 },
      { nombre: 'Bebidas',    orden: 4 },
      { nombre: 'Cocteles',   orden: 5 },
      { nombre: 'Postres',    orden: 6 },
    ],
    items: [
      // Entradas (course=entrada, printer_route=kitchen)
      { name: 'Yaniqueques', category: 'Entradas',   course: 'entrada',    printer_route: 'kitchen', price: 180,  cost: 60, aplica_itbis: 1 },
      { name: 'Chicharrón de pollo', category: 'Entradas', course: 'entrada', printer_route: 'kitchen', price: 320, cost: 140, aplica_itbis: 1 },
      { name: 'Queso frito', category: 'Entradas', course: 'entrada', printer_route: 'kitchen', price: 260, cost: 90, aplica_itbis: 1 },

      // Principales
      { name: 'La Bandera (pollo)',      category: 'Principales', course: 'principal', printer_route: 'kitchen', price: 380, cost: 140, aplica_itbis: 1 },
      { name: 'La Bandera (res)',        category: 'Principales', course: 'principal', printer_route: 'kitchen', price: 450, cost: 180, aplica_itbis: 1 },
      { name: 'Sancocho dominicano',     category: 'Principales', course: 'principal', printer_route: 'kitchen', price: 520, cost: 210, aplica_itbis: 1 },
      { name: 'Mofongo con longaniza',   category: 'Principales', course: 'principal', printer_route: 'kitchen', price: 440, cost: 170, aplica_itbis: 1 },
      { name: 'Chivo guisado',           category: 'Principales', course: 'principal', printer_route: 'kitchen', price: 560, cost: 240, aplica_itbis: 1 },

      // Pescados
      { name: 'Pescado con coco',        category: 'Pescados', course: 'principal', printer_route: 'kitchen', price: 680, cost: 290, aplica_itbis: 1 },
      { name: 'Camarones al ajillo',     category: 'Pescados', course: 'principal', printer_route: 'kitchen', price: 720, cost: 320, aplica_itbis: 1 },

      // Bebidas (course=bebida, printer_route=bar)
      { name: 'Morir Soñando',           category: 'Bebidas', course: 'bebida', printer_route: 'bar', price: 140, cost: 40, aplica_itbis: 1 },
      { name: 'Jugo de chinola',         category: 'Bebidas', course: 'bebida', printer_route: 'bar', price: 120, cost: 30, aplica_itbis: 1 },
      { name: 'Refresco',                category: 'Bebidas', course: 'bebida', printer_route: 'bar', price:  80, cost: 25, aplica_itbis: 1 },
      { name: 'Agua',                    category: 'Bebidas', course: 'bebida', printer_route: 'bar', price:  60, cost: 15, aplica_itbis: 1 },
      { name: 'Presidente Grande',       category: 'Bebidas', course: 'bebida', printer_route: 'bar', price: 180, cost: 80, aplica_itbis: 1 },

      // Cocteles (course=coctel, printer_route=bar)
      { name: 'Mojito',                  category: 'Cocteles', course: 'coctel', printer_route: 'bar', price: 280, cost: 100, aplica_itbis: 1 },
      { name: 'Cuba Libre',              category: 'Cocteles', course: 'coctel', printer_route: 'bar', price: 250, cost:  90, aplica_itbis: 1 },
      { name: 'Piña colada',             category: 'Cocteles', course: 'coctel', printer_route: 'bar', price: 320, cost: 120, aplica_itbis: 1 },

      // Postres (course=postre, printer_route=kitchen)
      { name: 'Flan de coco',            category: 'Postres', course: 'postre', printer_route: 'kitchen', price: 180, cost: 60, aplica_itbis: 1 },
      { name: 'Tres leches',             category: 'Postres', course: 'postre', printer_route: 'kitchen', price: 220, cost: 70, aplica_itbis: 1 },
      { name: 'Habichuelas con dulce',   category: 'Postres', course: 'postre', printer_route: 'kitchen', price: 160, cost: 50, aplica_itbis: 1 },
    ],
    modificadores: [
      // Punto de cocción (required for steak)
      { name: 'Término medio',   group_name: 'Punto de cocción', price_delta:   0, min_select: 1, max_select: 1, default_selected: 1, sort_order: 1 },
      { name: 'Término bien',    group_name: 'Punto de cocción', price_delta:   0, min_select: 1, max_select: 1, default_selected: 0, sort_order: 2 },
      { name: 'Tres cuartos',    group_name: 'Punto de cocción', price_delta:   0, min_select: 1, max_select: 1, default_selected: 0, sort_order: 3 },
      // Acompañantes (pick one)
      { name: 'Arroz blanco',    group_name: 'Acompañante',      price_delta:   0, min_select: 1, max_select: 1, default_selected: 1, sort_order: 1 },
      { name: 'Arroz moro',      group_name: 'Acompañante',      price_delta:  30, min_select: 1, max_select: 1, default_selected: 0, sort_order: 2 },
      { name: 'Tostones',        group_name: 'Acompañante',      price_delta:  40, min_select: 1, max_select: 1, default_selected: 0, sort_order: 3 },
      { name: 'Yuca hervida',    group_name: 'Acompañante',      price_delta:  30, min_select: 1, max_select: 1, default_selected: 0, sort_order: 4 },
      // Extras (optional multi-select)
      { name: 'Extra queso',     group_name: 'Extras',           price_delta:  60, min_select: 0, max_select: 5, default_selected: 0, sort_order: 1 },
      { name: 'Extra salsa',     group_name: 'Extras',           price_delta:  20, min_select: 0, max_select: 5, default_selected: 0, sort_order: 2 },
      // Notas
      { name: 'Sin cebolla',     group_name: 'Notas',            price_delta:   0, min_select: 0, max_select: 1, default_selected: 0, sort_order: 1 },
      { name: 'Sin ají',         group_name: 'Notas',            price_delta:   0, min_select: 0, max_select: 1, default_selected: 0, sort_order: 2 },
      { name: 'Para llevar',     group_name: 'Notas',            price_delta:   0, min_select: 0, max_select: 1, default_selected: 0, sort_order: 3 },
    ],
    // KDS defaults — written to businesses.settings JSONB
    kds: {
      kds_sound_enabled: true,
      kds_stale_order_seconds: 600,
    },
  },
}
