import { useState } from 'react'
import { BarChart2, Calendar, DollarSign, Package, Wine, Clock } from 'lucide-react'
import { useLang } from '../i18n'
import { useBusinessType } from '../hooks/useBusinessType.jsx'
import DailyReport from './reports/DailyReport'
import MonthlyReport from './reports/MonthlyReport'
import WorkerReport from './reports/WorkerReport'
import ProductsReport from './reports/ProductsReport'
import BottleDepositReport from './reports/BottleDepositReport'
import ConcesionarioCommissionsReport from './reports/ConcesionarioCommissionsReport'
import InventoryAgingReport from './reports/InventoryAgingReport'
import TestDriveFunnelReport from './reports/TestDriveFunnelReport'

const TABS = [
  { id: 'daily',      es: 'Diario',     en: 'Daily',       icon: BarChart2  },
  { id: 'monthly',    es: 'Mensual',    en: 'Monthly',     icon: Calendar   },
  { id: 'productos',  es: 'Productos',  en: 'Products',    icon: Package,   businessTypes: ['retail', 'dealership', 'restaurant', 'hybrid', 'licoreria', 'carniceria'] },
  { id: 'depositos',  es: 'Depósitos',  en: 'Deposits',    icon: Wine,      businessTypes: ['licoreria'] },
  // v2.14.36 — Comisiones is now feature-gated. Service-based businesses
  // see it by default (carwash/mechanic/salon/hybrid/dealership/restaurant/
  // service); tienda subtypes default off but the owner can flip the
  // `commissions` feature flag in Mi Empresa to expose the tab.
  { id: 'comisiones', es: 'Comisiones', en: 'Commissions', icon: DollarSign, feature: 'commissions' },
  // v2.16.2 — H1 per-vendedor commissions report, dealership-only.
  { id: 'comisiones_concesionario', es: 'Comisiones Vendedores', en: 'Salesperson Commissions', icon: DollarSign, businessTypes: ['dealership'] },
  // v2.16.5 — Sprint 2D M7 — inventory aging.
  { id: 'aging_concesionario', es: 'Antigüedad Inventario', en: 'Inventory Aging', icon: Clock, businessTypes: ['dealership'] },
  // v2.16.2 Sprint 2E — test-drive funnel report (dealership-only).
  { id: 'funnel_concesionario', es: 'Funnel Conversion', en: 'Conversion Funnel', icon: BarChart2, businessTypes: ['dealership'] },
]

export default function Reportes() {
  const { lang, t } = useLang()
  const { businessType, hasFeature } = useBusinessType()
  const [tab, setTab] = useState('daily')

  const visibleTabs = TABS.filter(t => {
    if (t.businessTypes && !t.businessTypes.includes(businessType)) return false
    if (t.feature && !hasFeature(t.feature)) return false
    return true
  })

  return (
    <div className="h-full flex flex-col bg-white dark:bg-white/5">
      <div className="shrink-0 px-3 md:px-6 py-3 md:py-4 border-b border-slate-200 dark:border-white/10">
        <h2 className="text-[14px] md:text-[16px] font-bold text-slate-800 dark:text-white">{t('nav_reports')}</h2>
      </div>

      <div className="shrink-0 flex border-b border-slate-200 dark:border-white/10 px-2 md:px-6 overflow-x-auto scrollbar-none">
        {visibleTabs.map(({ id, es, en, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 md:px-4 py-3 text-xs md:text-[13px] font-semibold border-b-2 transition-colors shrink-0 whitespace-nowrap ${
              tab === id ? 'border-slate-800 text-slate-800 dark:border-white dark:text-white' : 'border-transparent text-slate-500 dark:text-white/60 hover:text-slate-700 dark:hover:text-white'
            }`}>
            <Icon size={14} />
            {lang === 'es' ? es : en}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === 'daily'      && <DailyReport />}
        {tab === 'monthly'    && <MonthlyReport />}
        {tab === 'productos'  && <ProductsReport />}
        {tab === 'depositos'  && <BottleDepositReport />}
        {tab === 'comisiones' && <WorkerReport />}
        {tab === 'comisiones_concesionario' && <ConcesionarioCommissionsReport />}
        {tab === 'aging_concesionario' && <InventoryAgingReport />}
        {tab === 'funnel_concesionario' && <TestDriveFunnelReport />}
      </div>
    </div>
  )
}
