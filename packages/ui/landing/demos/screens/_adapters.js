// Adapters from each vertical's lightweight seed shapes into the richer
// shapes the 1:1-copy demo screens expect. Pure data transforms — no React.

export function toClientsDemoShape(clients = []) {
  return clients.map((c, i) => ({
    id:           c.id ?? i,
    name:         c.name,
    rnc:          c.rnc || '',
    phone:        c.phone || '',
    email:        c.email || '',
    address:      c.address || '',
    tier:         c.loyalty === 'Oro' ? 'gold'
                  : c.loyalty === 'Plata' ? 'silver'
                  : c.loyalty === 'Bronce' ? 'bronze'
                  : 'bronze',
    totalVisits:  c.visits || c.totalVisits || 1,
    totalSpent:   c.totalSpent || (c.points ? c.points * 50 : (c.visits || 1) * 600),
    balance:      c.balance || 0,
    creditLimit:  c.creditLimit || (c.rnc?.startsWith('131') ? 25000 : 0),
    lastService:  c.last_visit || c.lastService || '2026-04-25',
    history:      c.history || [
      { date: '2026-04-25', ticketNo: `T-${1000 + (c.id || i)}`, service: 'Servicio reciente', amount: Math.round((c.totalSpent || 600) * 0.4), method: 'Efectivo' },
      { date: '2026-04-15', ticketNo: `T-${900 + (c.id || i)}`,  service: 'Servicio anterior', amount: Math.round((c.totalSpent || 600) * 0.3), method: 'Tarjeta' },
    ],
  }))
}

// Generate a default transactions seed for ReportesDemo from a vertical's
// today metrics. Spreads ticketsCount tickets across the day with mixed
// payment methods proportional to ventasCash / ventasTarjeta / ventasTransfer.
export function toReportesTxSeed({ today = {}, clients = [], items = [], cashier = 'Maria' }) {
  const n = Math.min(today.ticketsCount || 12, 20)
  const cash = today.ventasCash || 0
  const card = today.ventasTarjeta || 0
  const xfer = today.ventasTransfer || 0
  const total = today.ventasTotal || (cash + card + xfer)
  const avg = total / n
  const out = []
  let now = Date.now()
  for (let i = 0; i < n; i++) {
    const r = Math.random()
    const method = r < (cash / total) ? 'cash' : r < ((cash + card) / total) ? 'card' : r < ((cash + card + xfer) / total) ? 'transfer' : 'credit'
    const amount = Math.round(avg * (0.5 + Math.random() * 1.5) / 50) * 50
    const subtotal = parseFloat((amount / 1.18).toFixed(2))
    const itbis = parseFloat((amount - subtotal).toFixed(2))
    const client = clients[i % clients.length]
    const itm = items[i % Math.max(1, items.length)] || { name: 'Servicio' }
    out.push({
      id: i + 1,
      ticketNo: `T-${String(2000 + i).padStart(4, '0')}`,
      client: client?.name || 'Walk-in',
      vehicle: '—',
      services: [{ name: itm.name }],
      cashier,
      date: new Date(now - i * 11 * 60_000),
      subtotal,
      itbis,
      total: amount,
      payMethod: method,
      estado: i === n - 2 ? 'nula' : 'normal',
    })
  }
  return out
}
