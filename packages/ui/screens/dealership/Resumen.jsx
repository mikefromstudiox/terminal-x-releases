/**
 * Resumen.jsx — Concesionario landing dashboard.
 *
 * KPI tiles + recent activity for the dealership vertical.
 * Default route when business_type === 'dealership'.
 */

import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  CarFront, DollarSign, TrendingUp, Users, Calendar, AlertTriangle,
  Loader2, ArrowRight, Trophy, FileText, Clock, ShieldCheck, Wrench, Banknote,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'
import WabaStubBanner from '../../components/WabaStubBanner'

function fmtRD(n) {
  return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}
function daysSince(iso) {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}
function startOfMonthISO() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString()
}

export default function Resumen() {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const [loading, setLoading] = useState(true)
  const [units, setUnits] = useState([])
  const [deals, setDeals] = useState([])
  const [overdueLeads, setOverdueLeads] = useState([])
  const [expiringDocs, setExpiringDocs] = useState([])
  // v2.16.4 Sprint 2B H3 — warranty KPIs.
  const [warrantiesExpiring, setWarrantiesExpiring] = useState([])
  const [openClaims, setOpenClaims] = useState(0)
  // v2.16.4 Sprint 2C H5 — bank pre-approvals KPI.
  const [preapprovalsActive, setPreapprovalsActive] = useState(0)

  useEffect(() => { (async () => {
    setLoading(true)
    const monthStart = startOfMonthISO()
    // H7 — allSettled so one slow / failing endpoint doesn't blank the dashboard.
    const settled = await Promise.allSettled([
      api.vehicleInventory.list(),
      api.salesDeals.list(),
      api.leads.overdue?.() ?? Promise.resolve([]),
      api.vehicleDocuments?.expiringSoon?.(30) ?? Promise.resolve([]),
      // v2.16.4 Sprint 2B H3 — warranty tiles. allSettled keeps the dashboard
      // alive if either query fails (table missing on a stale install, etc).
      api.vehicleWarranty?.expiringSoon?.({ days: 30 }) ?? Promise.resolve([]),
      api.vehicleWarranty?.list?.() ?? Promise.resolve([]),
      // v2.16.4 Sprint 2C H5 — pre-approvals tile (pre_aprobada AND not expired).
      api.bankPreapproval?.list?.({ status: 'pre_aprobada' }) ?? Promise.resolve([]),
    ])
    const [uR, dR, olR, edR, wsR, wlR, paR] = settled
    if (uR.status === 'rejected')  console.warn('[Resumen] vehicleInventory.list rejected', uR.reason)
    if (dR.status === 'rejected')  console.warn('[Resumen] salesDeals.list rejected', dR.reason)
    if (olR.status === 'rejected') console.warn('[Resumen] leads.overdue rejected', olR.reason)
    if (edR.status === 'rejected') console.warn('[Resumen] vehicleDocuments.expiringSoon rejected', edR.reason)
    if (wsR.status === 'rejected') console.warn('[Resumen] vehicleWarranty.expiringSoon rejected', wsR.reason)
    if (wlR.status === 'rejected') console.warn('[Resumen] vehicleWarranty.list rejected', wlR.reason)
    if (paR.status === 'rejected') console.warn('[Resumen] bankPreapproval.list rejected', paR.reason)
    const u  = uR.status === 'fulfilled' ? (uR.value ?? []) : []
    const d  = dR.status === 'fulfilled' ? (dR.value ?? []) : []
    const ol = olR.status === 'fulfilled' ? (olR.value ?? []) : []
    const ed = edR.status === 'fulfilled' ? (edR.value ?? []) : []
    const ws = wsR.status === 'fulfilled' ? (wsR.value ?? []) : []
    const wl = wlR.status === 'fulfilled' ? (wlR.value ?? []) : []
    const pa = paR.status === 'fulfilled' ? (paR.value ?? []) : []
    setUnits(u)
    setDeals(d.filter(x => x.closed_at && x.closed_at >= monthStart))
    setOverdueLeads(ol)
    setExpiringDocs(ed)
    setWarrantiesExpiring(ws)
    // open claims = sum of claim entries across all active/claimed warranties
    // whose status is open/in_progress. Robust against string-encoded claims
    // arriving from a fresh pull before parse — Array.isArray gates it.
    let oc = 0
    for (const w of wl) {
      const arr = Array.isArray(w.claims) ? w.claims : []
      for (const c of arr) {
        if (c?.status === 'open' || c?.status === 'in_progress') oc++
      }
    }
    setOpenClaims(oc)
    // Active = pre_aprobada AND (no expiry OR not yet expired). Owners only see
    // offers actually usable today, not stale "won-but-expired" rows.
    const nowTs = Date.now()
    const activePre = pa.filter(r => !r.expires_at || new Date(r.expires_at).getTime() > nowTs).length
    setPreapprovalsActive(activePre)
    setLoading(false)
  })() }, []) // eslint-disable-line

  const kpis = useMemo(() => {
    const available = units.filter(u => u.status === 'available')
    const sold = units.filter(u => u.status === 'sold')
    // H7 — exclude units with no listing_date so partial data doesn't deflate avg.
    const validDays = available.map(u => daysSince(u.listing_date)).filter(n => n != null)
    const avgDaysOnLot = validDays.length === 0 ? null : Math.round(validDays.reduce((s, n) => s + n, 0) / validDays.length)
    const dealsClosed = deals.length
    const financed = deals.reduce((s, d) => s + (Number(d.financed_amount) || 0), 0)
    const grossSales = deals.reduce((s, d) => s + (Number(d.sale_price) || 0), 0)
    const commissions = deals.reduce((s, d) => s + (Number(d.commission_amount) || 0), 0)
    const commissionsUnpaid = deals.filter(d => !d.commission_paid).reduce((s, d) => s + (Number(d.commission_amount) || 0), 0)
    return {
      available: available.length,
      avgDaysOnLot,
      sold: sold.length,
      dealsClosed,
      grossSales,
      financed,
      commissions,
      commissionsUnpaid,
    }
  }, [units, deals])

  if (loading) return <div className="p-12 text-center"><Loader2 className="animate-spin mx-auto" /></div>

  const recentDeals = deals.slice(0, 5)

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* v2.16.7 — WABA-status honesty banner (whatsapp_auto stub). */}
      <WabaStubBanner />
      <div className="mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-3"><CarFront size={32} />{L('Concesionario', 'Dealership')}</h1>
        <p className="text-sm text-black/70 mt-1">{L('Resumen del mes y seguimiento operativo.', 'Monthly summary and operations.')}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Tile to="/vehicle-inventory" icon={CarFront} label={L('Disponibles', 'Available')} value={kpis.available} sub={kpis.avgDaysOnLot == null ? '—' : L(`${kpis.avgDaysOnLot}d en lote (prom)`, `${kpis.avgDaysOnLot}d on lot avg`)} />
        <Tile to="/deal-builder"      icon={Trophy}   label={L('Ventas (mes)', 'Deals (mo)')} value={kpis.dealsClosed} sub={fmtRD(kpis.grossSales)} />
        <Tile                          icon={DollarSign} label={L('Financiado (mes)', 'Financed (mo)')} value={fmtRD(kpis.financed)} />
        <Tile                          icon={TrendingUp} label={L('Comisiones (mes)', 'Commissions (mo)')} value={fmtRD(kpis.commissions)} sub={kpis.commissionsUnpaid > 0 ? L(`${fmtRD(kpis.commissionsUnpaid)} pendiente`, `${fmtRD(kpis.commissionsUnpaid)} unpaid`) : null} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <AlertCard
          to="/sales-pipeline"
          icon={AlertTriangle}
          label={L('Seguimientos vencidos', 'Overdue follow-ups')}
          count={overdueLeads.length}
          tone={overdueLeads.length > 0 ? 'red' : 'ok'}
        />
        <AlertCard
          to="/test-drives"
          icon={Calendar}
          label={L('Pruebas de manejo', 'Test drives')}
          count={null}
          subtitle={L('Ver registro', 'View log')}
          tone="neutral"
        />
        <AlertCard
          icon={FileText}
          label={L('Docs por vencer (30d)', 'Docs expiring (30d)')}
          count={expiringDocs.length}
          tone={expiringDocs.length > 0 ? 'amber' : 'ok'}
        />
      </div>

      {/* v2.16.4 Sprint 2B H3 — warranty KPI row + Sprint 2C H5 pre-approval tile */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <AlertCard
          to="/warranties"
          icon={ShieldCheck}
          label={L('Garantias por vencer (30d)', 'Warranties expiring (30d)')}
          count={warrantiesExpiring.length}
          tone={warrantiesExpiring.length > 0 ? 'red' : 'ok'}
        />
        <AlertCard
          to="/warranties"
          icon={Wrench}
          label={L('Reclamos abiertos', 'Open claims')}
          count={openClaims}
          tone={openClaims > 0 ? 'amber' : 'ok'}
        />
        <AlertCard
          to="/preapprovals"
          icon={Banknote}
          label={L('Pre-aprobaciones activas', 'Active pre-approvals')}
          count={preapprovalsActive}
          tone={preapprovalsActive > 0 ? 'neutral' : 'ok'}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border border-black p-4">
          <h2 className="font-bold mb-3 flex items-center gap-2"><Trophy size={18}/>{L('Últimas Ventas', 'Recent Deals')}</h2>
          {recentDeals.length === 0 ? (
            <p className="text-sm text-black/50">{L('Aún sin ventas este mes.', 'No deals this month yet.')}</p>
          ) : (
            <ul className="divide-y divide-black/10">
              {recentDeals.map(d => (
                <li key={d.id} className="py-2 flex items-center justify-between text-sm">
                  <div>
                    <div className="font-semibold">{d.clients?.name || '—'}</div>
                    <div className="text-xs text-black/60">{new Date(d.closed_at).toLocaleDateString('es-DO')}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold">{fmtRD(d.sale_price)}</div>
                    {d.commission_amount > 0 && <div className="text-xs text-black/60">{L('com.', 'comm.')} {fmtRD(d.commission_amount)}</div>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border border-black p-4">
          <h2 className="font-bold mb-3 flex items-center gap-2"><Clock size={18}/>{L('Seguimientos Pendientes', 'Pending Follow-ups')}</h2>
          {overdueLeads.length === 0 ? (
            <p className="text-sm text-black/50">{L('Todo al día.', 'All caught up.')}</p>
          ) : (
            <ul className="divide-y divide-black/10">
              {overdueLeads.slice(0, 6).map(l => (
                <li key={l.id} className="py-2 flex items-center justify-between text-sm">
                  <div>
                    <div className="font-semibold">{l.name}</div>
                    <div className="text-xs text-[#b3001e]">{L('Vencido', 'Overdue')} · {new Date(l.next_followup_at).toLocaleDateString('es-DO')}</div>
                  </div>
                  <Link to="/sales-pipeline" className="text-xs underline">{L('Abrir', 'Open')}</Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function Tile({ to, icon: Icon, label, value, sub }) {
  const inner = (
    <div className="border border-black p-4 bg-white hover:bg-black hover:text-white transition-colors h-full">
      <div className="flex items-center justify-between">
        <Icon size={20} className="opacity-70"/>
        {to && <ArrowRight size={14} className="opacity-50"/>}
      </div>
      <div className="text-2xl font-bold mt-3">{value}</div>
      <div className="text-xs uppercase tracking-wide opacity-70">{label}</div>
      {sub && <div className="text-xs mt-1 opacity-60">{sub}</div>}
    </div>
  )
  return to ? <Link to={to}>{inner}</Link> : inner
}

function AlertCard({ to, icon: Icon, label, count, subtitle, tone }) {
  const cls = tone === 'red' ? 'border-[#b3001e] bg-[#b3001e] text-white'
    : tone === 'amber' ? 'border-black bg-black text-white'
    : 'border-black bg-white text-black'
  const inner = (
    <div className={`border p-4 ${cls} h-full flex items-center justify-between`}>
      <div className="flex items-center gap-3">
        <Icon size={20}/>
        <div>
          <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
          {count !== null && <div className="text-xl font-bold">{count}</div>}
          {subtitle && <div className="text-xs opacity-80">{subtitle}</div>}
        </div>
      </div>
      {to && <ArrowRight size={16}/>}
    </div>
  )
  return to ? <Link to={to}>{inner}</Link> : inner
}
