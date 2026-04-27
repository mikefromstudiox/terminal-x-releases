// contabilidadCoaSeed.js — DR PYME Catálogo Único de Cuentas seed.
//
// Source basis: DGII / IFRS para PYMES — Catálogo Único de Cuentas referenciado
// por la Norma General 13-2014 (DGII) y guía de contabilidad para PYMES en
// República Dominicana publicada por el Instituto de Contadores Públicos
// Autorizados (ICPARD). Estructura de 5 niveles, codificación numérica:
//   1 Activo · 2 Pasivo · 3 Patrimonio · 4 Ingresos · 5 Costos · 6 Gastos
//
// Cada fila: { code, name, type, parent, postable }
//   - postable=false => cabecera (no se asienta directo)
//   - parent referencia el `code` del padre (null para raíz)
//
// Esta semilla cubre las cuentas mínimas que cualquier PYME dominicana usa:
// caja, bancos, cuentas por cobrar, ITBIS por compensar/pagar, retenciones,
// inventario, activos fijos + depreciación acumulada, capital, utilidad
// retenida, ingresos por servicios/ventas, costo de venta, sueldos,
// alquileres, servicios públicos, depreciación, gastos varios.

export const CATALOGO_UNICO_DR = [
  // 1 ACTIVO
  { code: '1',     name: 'ACTIVO',                                  type: 'activo',     parent: null,    postable: false },
  { code: '1.1',   name: 'Activo Corriente',                        type: 'activo',     parent: '1',     postable: false },
  { code: '1.1.01',name: 'Caja General',                            type: 'activo',     parent: '1.1',   postable: true  },
  { code: '1.1.02',name: 'Caja Chica',                              type: 'activo',     parent: '1.1',   postable: true  },
  { code: '1.1.03',name: 'Bancos — Cuenta Corriente DOP',           type: 'activo',     parent: '1.1',   postable: true  },
  { code: '1.1.04',name: 'Bancos — Cuenta de Ahorros DOP',          type: 'activo',     parent: '1.1',   postable: true  },
  { code: '1.1.05',name: 'Bancos — Cuenta en USD',                  type: 'activo',     parent: '1.1',   postable: true  },
  { code: '1.1.10',name: 'Cuentas por Cobrar Clientes',             type: 'activo',     parent: '1.1',   postable: true  },
  { code: '1.1.11',name: 'Cuentas por Cobrar Empleados',            type: 'activo',     parent: '1.1',   postable: true  },
  { code: '1.1.12',name: 'Cuentas por Cobrar Accionistas',          type: 'activo',     parent: '1.1',   postable: true  },
  { code: '1.1.15',name: 'Estimación Cuentas Incobrables',          type: 'activo',     parent: '1.1',   postable: true  },
  { code: '1.1.20',name: 'Inventario de Mercancías',                type: 'activo',     parent: '1.1',   postable: true  },
  { code: '1.1.21',name: 'Inventario de Materia Prima',             type: 'activo',     parent: '1.1',   postable: true  },
  { code: '1.1.22',name: 'Inventario de Productos en Proceso',      type: 'activo',     parent: '1.1',   postable: true  },
  { code: '1.1.30',name: 'ITBIS por Compensar (Adelantado)',        type: 'activo',     parent: '1.1',   postable: true  },
  { code: '1.1.31',name: 'Anticipos / Saldo a Favor ISR',           type: 'activo',     parent: '1.1',   postable: true  },
  { code: '1.1.32',name: 'Retenciones a Favor (IT-1)',              type: 'activo',     parent: '1.1',   postable: true  },
  { code: '1.1.40',name: 'Gastos Pagados por Anticipado',           type: 'activo',     parent: '1.1',   postable: true  },
  { code: '1.2',   name: 'Activo No Corriente',                     type: 'activo',     parent: '1',     postable: false },
  { code: '1.2.01',name: 'Terrenos',                                type: 'activo',     parent: '1.2',   postable: true  },
  { code: '1.2.02',name: 'Edificios',                               type: 'activo',     parent: '1.2',   postable: true  },
  { code: '1.2.03',name: 'Mobiliario y Equipo',                     type: 'activo',     parent: '1.2',   postable: true  },
  { code: '1.2.04',name: 'Equipo de Cómputo',                       type: 'activo',     parent: '1.2',   postable: true  },
  { code: '1.2.05',name: 'Vehículos',                               type: 'activo',     parent: '1.2',   postable: true  },
  { code: '1.2.10',name: 'Depreciación Acumulada Edificios',        type: 'activo',     parent: '1.2',   postable: true  },
  { code: '1.2.11',name: 'Depreciación Acumulada Mobiliario',       type: 'activo',     parent: '1.2',   postable: true  },
  { code: '1.2.12',name: 'Depreciación Acumulada Cómputo',          type: 'activo',     parent: '1.2',   postable: true  },
  { code: '1.2.13',name: 'Depreciación Acumulada Vehículos',        type: 'activo',     parent: '1.2',   postable: true  },

  // 2 PASIVO
  { code: '2',     name: 'PASIVO',                                  type: 'pasivo',     parent: null,    postable: false },
  { code: '2.1',   name: 'Pasivo Corriente',                        type: 'pasivo',     parent: '2',     postable: false },
  { code: '2.1.01',name: 'Cuentas por Pagar Proveedores',           type: 'pasivo',     parent: '2.1',   postable: true  },
  { code: '2.1.02',name: 'Documentos por Pagar',                    type: 'pasivo',     parent: '2.1',   postable: true  },
  { code: '2.1.03',name: 'Sueldos por Pagar',                       type: 'pasivo',     parent: '2.1',   postable: true  },
  { code: '2.1.10',name: 'ITBIS por Pagar',                         type: 'pasivo',     parent: '2.1',   postable: true  },
  { code: '2.1.11',name: 'ISR por Pagar',                           type: 'pasivo',     parent: '2.1',   postable: true  },
  { code: '2.1.12',name: 'Retenciones por Pagar — ISR Asalariados', type: 'pasivo',     parent: '2.1',   postable: true  },
  { code: '2.1.13',name: 'Retenciones por Pagar — Servicios',       type: 'pasivo',     parent: '2.1',   postable: true  },
  { code: '2.1.14',name: 'Retenciones TSS por Pagar (AFP/SFS)',     type: 'pasivo',     parent: '2.1',   postable: true  },
  { code: '2.1.15',name: 'Aportes Patronales TSS por Pagar',        type: 'pasivo',     parent: '2.1',   postable: true  },
  { code: '2.1.20',name: 'Anticipos de Clientes',                   type: 'pasivo',     parent: '2.1',   postable: true  },
  { code: '2.2',   name: 'Pasivo No Corriente',                     type: 'pasivo',     parent: '2',     postable: false },
  { code: '2.2.01',name: 'Préstamos Bancarios Largo Plazo',         type: 'pasivo',     parent: '2.2',   postable: true  },
  { code: '2.2.02',name: 'Documentos por Pagar Largo Plazo',        type: 'pasivo',     parent: '2.2',   postable: true  },

  // 3 PATRIMONIO
  { code: '3',     name: 'PATRIMONIO',                              type: 'patrimonio', parent: null,    postable: false },
  { code: '3.1.01',name: 'Capital Social',                          type: 'patrimonio', parent: '3',     postable: true  },
  { code: '3.1.02',name: 'Aportes para Futuras Capitalizaciones',   type: 'patrimonio', parent: '3',     postable: true  },
  { code: '3.1.10',name: 'Utilidades Retenidas',                    type: 'patrimonio', parent: '3',     postable: true  },
  { code: '3.1.11',name: 'Utilidad del Ejercicio',                  type: 'patrimonio', parent: '3',     postable: true  },
  { code: '3.1.12',name: 'Reserva Legal',                           type: 'patrimonio', parent: '3',     postable: true  },

  // 4 INGRESOS
  { code: '4',     name: 'INGRESOS',                                type: 'ingreso',    parent: null,    postable: false },
  { code: '4.1.01',name: 'Ingresos por Ventas',                     type: 'ingreso',    parent: '4',     postable: true  },
  { code: '4.1.02',name: 'Ingresos por Servicios',                  type: 'ingreso',    parent: '4',     postable: true  },
  { code: '4.1.03',name: 'Devoluciones sobre Ventas',               type: 'ingreso',    parent: '4',     postable: true  },
  { code: '4.1.04',name: 'Descuentos sobre Ventas',                 type: 'ingreso',    parent: '4',     postable: true  },
  { code: '4.2.01',name: 'Otros Ingresos',                          type: 'ingreso',    parent: '4',     postable: true  },
  { code: '4.2.02',name: 'Ingresos Financieros',                    type: 'ingreso',    parent: '4',     postable: true  },

  // 5 COSTOS
  { code: '5',     name: 'COSTOS',                                  type: 'costo',      parent: null,    postable: false },
  { code: '5.1.01',name: 'Costo de Ventas',                         type: 'costo',      parent: '5',     postable: true  },
  { code: '5.1.02',name: 'Costo de Servicios Prestados',            type: 'costo',      parent: '5',     postable: true  },
  { code: '5.1.03',name: 'Compras de Mercancía',                    type: 'costo',      parent: '5',     postable: true  },
  { code: '5.1.04',name: 'Fletes sobre Compras',                    type: 'costo',      parent: '5',     postable: true  },

  // 6 GASTOS
  { code: '6',     name: 'GASTOS',                                  type: 'gasto',      parent: null,    postable: false },
  { code: '6.1',   name: 'Gastos Operativos',                       type: 'gasto',      parent: '6',     postable: false },
  { code: '6.1.01',name: 'Sueldos y Salarios',                      type: 'gasto',      parent: '6.1',   postable: true  },
  { code: '6.1.02',name: 'Aportes Patronales TSS',                  type: 'gasto',      parent: '6.1',   postable: true  },
  { code: '6.1.03',name: 'Bonificaciones',                          type: 'gasto',      parent: '6.1',   postable: true  },
  { code: '6.1.04',name: 'Regalía Pascual / Vacaciones',            type: 'gasto',      parent: '6.1',   postable: true  },
  { code: '6.1.10',name: 'Alquileres',                              type: 'gasto',      parent: '6.1',   postable: true  },
  { code: '6.1.11',name: 'Servicios Públicos — Energía',            type: 'gasto',      parent: '6.1',   postable: true  },
  { code: '6.1.12',name: 'Servicios Públicos — Agua',               type: 'gasto',      parent: '6.1',   postable: true  },
  { code: '6.1.13',name: 'Servicios Públicos — Telecomunicaciones', type: 'gasto',      parent: '6.1',   postable: true  },
  { code: '6.1.14',name: 'Combustibles y Lubricantes',              type: 'gasto',      parent: '6.1',   postable: true  },
  { code: '6.1.20',name: 'Mantenimiento y Reparaciones',            type: 'gasto',      parent: '6.1',   postable: true  },
  { code: '6.1.21',name: 'Útiles de Oficina',                       type: 'gasto',      parent: '6.1',   postable: true  },
  { code: '6.1.22',name: 'Depreciación del Ejercicio',              type: 'gasto',      parent: '6.1',   postable: true  },
  { code: '6.1.23',name: 'Honorarios Profesionales',                type: 'gasto',      parent: '6.1',   postable: true  },
  { code: '6.1.24',name: 'Publicidad y Mercadeo',                   type: 'gasto',      parent: '6.1',   postable: true  },
  { code: '6.1.25',name: 'Seguros',                                 type: 'gasto',      parent: '6.1',   postable: true  },
  { code: '6.1.26',name: 'Impuestos y Tasas',                       type: 'gasto',      parent: '6.1',   postable: true  },
  { code: '6.1.27',name: 'Cuentas Incobrables',                     type: 'gasto',      parent: '6.1',   postable: true  },
  { code: '6.1.30',name: 'Gastos Bancarios y Financieros',          type: 'gasto',      parent: '6.1',   postable: true  },
  { code: '6.1.99',name: 'Gastos Varios',                           type: 'gasto',      parent: '6.1',   postable: true  },
]

export default CATALOGO_UNICO_DR
