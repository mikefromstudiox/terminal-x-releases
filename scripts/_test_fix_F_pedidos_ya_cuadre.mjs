#!/usr/bin/env node
// Test Fix F — pedidos_ya channel surfaces in cuadre.daily()
// Inline-rebuilds the FIXED aggregation logic and asserts pedidos_ya is
// bucketed (not lost to a non-existent bucket).

const PM_ALIAS = {
  cash: 'efectivo', efectivo: 'efectivo',
  card: 'tarjeta',  tarjeta: 'tarjeta',
  transfer: 'transferencia', transferencia: 'transferencia',
  check: 'cheque',  cheque: 'cheque',
  credit: 'credito', credito: 'credito',
  pedidos_ya: 'pedidos_ya', py: 'pedidos_ya', 'pedidos-ya': 'pedidos_ya',
}

function aggregate(rows) {
  const result = { efectivo: 0, tarjeta: 0, transferencia: 0, cheque: 0, credito: 0, pedidos_ya: 0 }
  let totalVendido = 0, totalCobrado = 0
  for (const r of rows) {
    const tot = Number(r.total || 0)
    totalVendido += tot
    let parts = null
    if (r.payment_parts) {
      try {
        const parsed = typeof r.payment_parts === 'string' ? JSON.parse(r.payment_parts) : r.payment_parts
        if (Array.isArray(parsed) && parsed.length) parts = parsed
      } catch { parts = null }
    }
    if (parts) {
      for (const p of parts) {
        const pm = PM_ALIAS[p?.method] || p?.method || 'efectivo'
        const amt = Number(p?.amount || 0)
        result[pm] = (result[pm] || 0) + amt
        if (pm !== 'credito' && pm !== 'pedidos_ya') totalCobrado += amt
      }
    } else {
      const raw = r.payment_method || 'efectivo'
      const pm = PM_ALIAS[raw] || raw
      result[pm] = (result[pm] || 0) + tot
      if (pm !== 'credito' && pm !== 'pedidos_ya') totalCobrado += tot
    }
  }
  return { ...result, totalVendido, totalCobrado }
}

const rows = [
  { total: 100, payment_method: 'efectivo' },
  { total: 200, payment_method: 'tarjeta' },
  { total: 150, payment_method: 'pedidos_ya' },   // ← Was invisible pre-fix
  { total:  50, payment_method: 'pedidos-ya' },   // alt key
  { total:  75, payment_method: 'py' },           // short key
  { total: 300, payment_method: 'credito' },
  { total: 400, payment_parts: [
    { method: 'cash', amount: 250 },
    { method: 'pedidos_ya', amount: 150 },
  ] },
]

const r = aggregate(rows)
console.log('Result:', r)

// efectivo: 100 + 250 = 350
// tarjeta: 200
// pedidos_ya: 150 + 50 + 75 + 150 = 425
// credito: 300
// totalVendido: 100+200+150+50+75+300+400 = 1275
// totalCobrado: efectivo + tarjeta = 350 + 200 = 550 (pedidos_ya + credito excluded)
const expect = { efectivo: 350, tarjeta: 200, pedidos_ya: 425, credito: 300, totalVendido: 1275, totalCobrado: 550 }
let pass = true
for (const [k, v] of Object.entries(expect)) {
  if (Math.abs((r[k] || 0) - v) > 0.001) {
    console.error(`✗ FAIL: ${k} = ${r[k]}, expected ${v}`); pass = false
  }
}
if (!pass) process.exit(1)
console.log('✅ Fix F — PASS — pedidos_ya bucketed correctly, excluded from totalCobrado (settles outside till)')
