#!/usr/bin/env node
// demo-vertical-audit.mjs — full vertical wiring audit.
//
// For each demo account: read its business_type / subtype / hybrid_components /
// plan / vertical-specific tables — then compute what /pos should render and
// what sidebar items the user should see. Flags any drift.
//
// Usage: NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/demo-vertical-audit.mjs

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
config({ path: join(__dirname, '..', '.env') })

const URL  = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const SVC  = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !ANON || !SVC) { console.error('missing env'); process.exit(1) }

const DEMOS = [
  { vertical: 'carwash',      email: 'admin@carwash.demo.terminalxpos.com'      },
  { vertical: 'retail',       email: 'admin@retail.demo.terminalxpos.com'       },
  { vertical: 'restaurant',   email: 'admin@restaurant.demo.terminalxpos.com'   },
  { vertical: 'salon',        email: 'admin@salon.demo.terminalxpos.com'        },
  { vertical: 'mechanic',     email: 'admin@mechanic.demo.terminalxpos.com'     },
  { vertical: 'service',      email: 'admin@service.demo.terminalxpos.com'      },
  { vertical: 'loans',        email: 'admin@prestamos.demo.terminalxpos.com'    },
  { vertical: 'dealership',   email: 'admin@dealership.demo.terminalxpos.com'   },
  { vertical: 'food_truck',   email: 'foodtruck@demo.terminalxpos.com'          },
  { vertical: 'accounting',   email: 'admin@contabilidad.demo.terminalxpos.com' },
  { vertical: 'meat_market',  email: 'admin@carniceria.demo.terminalxpos.com'   },
  { vertical: 'licoreria',    email: 'admin@licoreria.demo.terminalxpos.com'    },
]
const PASSWORD = 'Demo2026!'

// Mirror packages/config/businessTypes.js LEGACY_ALIASES so we read the DB
// the same way the production app does. Without this the audit reports false
// drift on demos that still have the old Spanish values in app_settings.
const LEGACY_ALIASES = {
  tienda:'retail', restaurante:'restaurant', hibrido:'hybrid',
  mecanica:'mechanic', mecanico:'mechanic', servicios:'service', otro:'service',
  concesionario:'dealership', barberia:'salon', prestamo:'loans',
  prestamos:'loans', contabilidad:'accounting', carniceria:'meat_market',
}
function normalise(t) {
  if (!t) return 'carwash'
  const s = String(t).toLowerCase().trim()
  if (['carwash','retail','service','restaurant','mechanic','salon','loans','dealership','licoreria','food_truck','meat_market','accounting','hybrid'].includes(s)) return s
  return LEGACY_ALIASES[s] || 'carwash'
}

// ── Replicate the POS routing logic from packages/ui/screens/POS.jsx + useBusinessType.jsx
function flagsFor(type) {
  const has = (k) => type === k
  const stockTracked  = has('retail') || has('dealership') || has('restaurant') || has('food_truck') || has('mechanic') || has('licoreria') || has('meat_market')
  const serviceBased  = has('carwash') || has('service') || has('salon') || has('mechanic')
  return {
    isRetail:     stockTracked,
    isCarWash:    serviceBased,
    isHybrid:     type === 'hybrid',
    isRestaurant: type === 'restaurant',
    isFoodTruck:  type === 'food_truck',
    isLoans:      type === 'loans',
  }
}
function posScreenFor(type, plan) {
  if (plan === 'facturacion' || type === 'accounting') return '/invoicing (redirect)'
  const f = flagsFor(type)
  if (f.isHybrid)      return 'HybridPOS'
  if (f.isFoodTruck)   return 'FoodTruckPOS'
  if (f.isRestaurant)  return 'RestaurantPOS'
  if (f.isLoans)       return 'LendingDashboard'
  if (f.isRetail)      return 'RetailPOS'
  return 'CarWashPOS'
}

// ── Sidebar item expectations per businessType (extracted from Sidebar.jsx)
// Static keys + required businessTypes from the NAV array, used only to compute
// "should show" sets per vertical. Doesn't need exact match with what UI shows
// (role + feature gates still apply), but covers the visible per-vertical items.
const SIDEBAR_ITEMS = [
  { id: 'pos',                          types: null /* always */ },
  { id: 'queue',                         types: ['carwash','service','hybrid']                                            },
  { id: 'mesas',                         types: ['restaurant','hybrid']                                                   },
  { id: 'menu_builder',                  types: ['restaurant','food_truck']                                               },
  { id: 'catalogo',                      types: ['hybrid']                                                                },
  { id: 'kds',                           types: ['restaurant','food_truck','hybrid']                                      },
  { id: 'food_truck_pendientes',         types: ['food_truck']                                                            },
  { id: 'food_truck_locations',          types: ['food_truck']                                                            },
  { id: 'food_truck_waste',              types: ['food_truck']                                                            },
  { id: 'restaurant_salon_dashboard',    types: ['restaurant']                                                            },
  { id: 'restaurant_reservations',       types: ['restaurant']                                                            },
  { id: 'mechanic_resumen',              types: ['mechanic']                                                              },
  { id: 'work_orders',                   types: ['mechanic']                                                              },
  { id: 'cotizaciones',                  types: ['mechanic']                                                              },
  { id: 'suministros',                   types: ['mechanic']                                                              },
  { id: 'aseguradoras',                  types: ['mechanic']                                                              },
  { id: 'vehicles',                      types: ['mechanic']                                                              },
  { id: 'concesionario_resumen',         types: ['dealership']                                                            },
  { id: 'vehicle_inventory',             types: ['dealership']                                                            },
  { id: 'deal_builder',                  types: ['dealership']                                                            },
  { id: 'sales_pipeline',                types: ['dealership']                                                            },
  { id: 'reservations',                  types: ['dealership']                                                            },
  { id: 'warranties',                    types: ['dealership']                                                            },
  { id: 'preapprovals',                  types: ['dealership']                                                            },
  { id: 'test_drives',                   types: ['dealership']                                                            },
  { id: 'matriculas',                    types: ['dealership']                                                            },
  { id: 'service_bays',                  types: ['mechanic']                                                              },
  { id: 'mechanic_productivity',         types: ['mechanic']                                                              },
  { id: 'salon_resumen',                 types: ['salon']                                                                 },
  { id: 'appointments',                  types: ['salon','mechanic']                                                      },
  { id: 'salon_memberships',             types: ['salon']                                                                 },
  { id: 'stylist_schedules',             types: ['salon']                                                                 },
  { id: 'salon_whatsapp_log',            types: ['salon']                                                                 },
  { id: 'lending',                       types: ['loans']                                                             },
  { id: 'carniceria_cortes',             types: ['meat_market']                                                            },
  { id: 'carniceria_frescura',           types: ['meat_market']                                                            },
  { id: 'carniceria_mayoreo',            types: ['meat_market']                                                            },
  { id: 'carniceria_resumen',            types: ['meat_market']                                                            },
  { id: 'service_hub',                   types: ['service']                                                               },
  { id: 'ctb_portfolio',                 types: ['accounting']                                                          },
  { id: 'ctb_bandeja',                   types: ['accounting']                                                          },
  { id: 'ctb_cartera',                   types: ['accounting']                                                          },
  { id: 'ctb_calendario',                types: ['accounting']                                                          },
  { id: 'ctb_tareas',                    types: ['accounting']                                                          },
  { id: 'ctb_comprobantes',              types: ['accounting']                                                          },
  { id: 'ctb_libro_mayor',               types: ['accounting']                                                          },
  { id: 'ctb_banco',                     types: ['accounting']                                                          },
  { id: 'ctb_nomina',                    types: ['accounting']                                                          },
  { id: 'ctb_activos',                   types: ['accounting']                                                          },
  { id: 'ctb_reportes',                  types: ['accounting']                                                          },
  { id: 'ctb_vault',                     types: ['accounting']                                                          },
  { id: 'ctb_honorarios',                types: ['accounting']                                                          },
  { id: 'clients',                       types: null                                                                      },
  { id: 'caja',                          types: null                                                                      },
  { id: 'inventory',                     types: null /* role-gated */                                                     },
  { id: 'reports',                       types: null                                                                      },
  { id: 'empleados',                     types: null                                                                      },
  { id: 'invoicing',                     types: null /* feature-gated */                                                  },
  { id: 'dgii',                          types: null /* feature-gated */                                                  },
  { id: 'config',                        types: null                                                                      },
]
function sidebarItemsFor(type) {
  return SIDEBAR_ITEMS.filter(it => it.types === null || it.types.includes(type)).map(it => it.id)
}

// ── Vertical-specific tables we expect rows in to consider the data wired
// Actual live table names (verified via pg_catalog 2026-05-17). The salon
// appointments live in the shared `appointments` table (no per-vertical
// salon_appointments). The carniceria cortes catalog is
// `carniceria_corte_categories` (not corte_catalog).
const VERTICAL_DATA_PROBES = {
  carwash:     ['services'],
  retail:      ['services','inventory_items'],
  restaurant:  ['services','mesas','restaurant_reservations'],
  salon:       ['services','appointments','stylist_schedules'],
  mechanic:    ['services','work_orders','vehicles','service_bays'],
  service:     ['services'],
  loans:       ['loans','pawn_items'],
  dealership:  ['vehicle_inventory','sales_deals','test_drives'],
  food_truck:  ['services','food_truck_locations'],
  meat_market: ['services','inventory_items','carniceria_corte_categories'],
  licoreria:   ['services','inventory_items'],
  accounting:  ['accounting_clients'],
}

const svc = createClient(URL, SVC, { auth: { persistSession: false } })

function decodeJwt(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()) } catch { return {} }
}

async function probeOne(d) {
  const result = {
    vertical: d.vertical, email: d.email,
    auth: null, bid: null,
    plan: null, configured_type: null, subtype: null, hybrid: null,
    counts: {}, expected_pos: null, actual_data: 'pending',
    drift: [],
  }
  const sb = createClient(URL, ANON)
  try {
    const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email: d.email, password: PASSWORD })
    if (authErr) { result.drift.push('AUTH FAIL: ' + authErr.message); return result }
    result.auth = 'ok'
    const claims = decodeJwt(auth.session.access_token)
    const bid = claims.app_metadata?.business_id
    if (!bid) { result.drift.push('NO business_id in JWT'); return result }
    result.bid = bid

    // 1. businesses row → plan + name
    const { data: biz } = await sb.from('businesses').select('id,name,plan,settings').eq('id', bid).maybeSingle()
    result.plan = biz?.plan || '(none)'
    result.business_name = biz?.name

    // 2. app_settings → business_type + subtype + hybrid_components
    const { data: settings } = await sb.from('app_settings').select('key,value').eq('business_id', bid).eq('is_device_local', false)
    const kv = Object.fromEntries((settings || []).map(r => [r.key, r.value]))
    const rawType = kv.business_type || biz?.settings?.business_type || '(missing)'
    result.configured_type   = rawType
    result.normalized_type   = normalise(rawType)
    result.subtype           = kv.tienda_subtype || kv.dealership_subtype || null
    result.hybrid            = kv.hybrid_components || null

    // 3. compute expected POS screen + sidebar from the NORMALIZED type
    //    (matches what useBusinessType() returns at runtime)
    result.expected_pos = posScreenFor(result.normalized_type, result.plan)
    result.expected_sidebar = sidebarItemsFor(result.normalized_type)

    // 4. probe vertical-specific tables — does this vertical's data exist?
    const probes = VERTICAL_DATA_PROBES[d.vertical] || ['services']
    for (const tbl of probes) {
      try {
        const r = await sb.from(tbl).select('id', { count: 'exact', head: true }).eq('business_id', bid)
        result.counts[tbl] = r.count ?? 0
      } catch (err) {
        result.counts[tbl] = `ERR ${err.code || ''}`
      }
    }

    // 5. drift checks
    if (result.normalized_type !== d.vertical) {
      result.drift.push(`normalized business_type='${result.normalized_type}' but demo is '${d.vertical}'`)
    }
    if (result.configured_type !== result.normalized_type) {
      result.drift.push(`legacy stored value '${result.configured_type}' (lives via LEGACY_ALIASES → '${result.normalized_type}'); update app_settings.business_type to canonical key`)
    }
    if (result.plan !== 'pro_max' && result.plan !== 'pro_plus' && d.vertical !== 'contabilidad') {
      result.drift.push(`plan='${result.plan}' — vertical features may be gated off`)
    }
    // expected vertical-specific rows
    for (const tbl of probes) {
      if (result.counts[tbl] === 0) result.drift.push(`${tbl} = 0 rows (expected for ${d.vertical})`)
    }

    await sb.auth.signOut()
  } catch (err) {
    result.drift.push('EXCEPTION: ' + (err?.message || String(err)))
  }
  return result
}

;(async () => {
  console.log('\n=== demo-vertical-audit @', new Date().toISOString(), '===\n')
  const results = []
  for (const d of DEMOS) {
    process.stdout.write(d.vertical.padEnd(14))
    const r = await probeOne(d)
    results.push(r)
    process.stdout.write((r.drift.length === 0 ? ' OK ' : ' ⚠ ').padEnd(5) + `plan=${r.plan} type=${r.configured_type} → ${r.expected_pos}\n`)
  }

  // ── Matrix ──────────────────────────────────────────────────────────────
  console.log('\n\n=== MATRIX ===\n')
  const cols = ['Vertical','Plan','Configured','Subtype','POS screen','Sidebar items','Probes']
  console.log(cols.join(' | '))
  console.log(cols.map(c => '---').join(' | '))
  for (const r of results) {
    const probesSummary = Object.entries(r.counts).map(([k,v])=> `${k}:${v}`).join(', ')
    const sidebarSummary = r.expected_sidebar ? `${r.expected_sidebar.length} items` : '-'
    console.log([
      r.vertical, r.plan || '?', r.configured_type || '?', r.subtype || '-',
      r.expected_pos || '?', sidebarSummary, probesSummary,
    ].join(' | '))
  }

  // ── Per-vertical breakdown ──────────────────────────────────────────────
  console.log('\n\n=== PER-VERTICAL BREAKDOWN ===\n')
  for (const r of results) {
    console.log(`\n── ${r.vertical.toUpperCase()} (${r.business_name || '?'}) ──`)
    console.log(`  auth:      ${r.auth || 'FAIL'}`)
    console.log(`  plan:      ${r.plan}`)
    console.log(`  type:      ${r.configured_type}${r.subtype ? ` / ${r.subtype}` : ''}${r.hybrid ? ` [${r.hybrid}]` : ''}`)
    console.log(`  POS:       ${r.expected_pos}`)
    if (r.expected_sidebar) {
      const verticalSpecific = r.expected_sidebar.filter(s => !['pos','clients','caja','inventory','reports','empleados','invoicing','dgii','config'].includes(s))
      console.log(`  Sidebar:   ${verticalSpecific.length ? verticalSpecific.join(', ') : '(only generic items)'}`)
    }
    console.log(`  Data:      ${Object.entries(r.counts).map(([k,v])=>`${k}=${v}`).join('  ')}`)
    if (r.drift.length) {
      console.log(`  ⚠ DRIFT:`)
      for (const d of r.drift) console.log(`     - ${d}`)
    } else {
      console.log(`  ✓ wired`)
    }
  }

  const clean = results.filter(r => r.drift.length === 0).length
  console.log(`\n\n=== ${clean} / ${results.length} verticals cleanly wired ===\n`)
  process.exit(clean === results.length ? 0 : 1)
})().catch(err => { console.error(err); process.exit(2) })
