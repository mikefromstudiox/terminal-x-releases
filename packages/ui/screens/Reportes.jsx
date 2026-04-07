import { useState } from 'react'
import { BarChart2, Calendar, DollarSign, Users, Package } from 'lucide-react'
import { useLang } from '../i18n'
import { useBusinessType } from '../hooks/useBusinessType.jsx'
import DailyReport from './reports/DailyReport'
import MonthlyReport from './reports/MonthlyReport'
import WorkerReport from './reports/WorkerReport'
import PayrollReport from './reports/PayrollReport'
import ProductsReport from './reports/ProductsReport'

const TABS = [
  { id: 'daily',      es: 'Diario',     en: 'Daily',       icon: BarChart2  },
  { id: 'monthly',    es: 'Mensual',    en: 'Monthly',     icon: Calendar   },
  { id: 'productos',  es: 'Productos',  en: 'Products',    icon: Package,   businessTypes: ['tienda', 'otro'] },
  { id: 'comisiones', es: 'Comisiones', en: 'Commissions', icon: DollarSign },
  { id: 'nominas',    es: 'Nominas',    en: 'Payroll',     icon: Users      },
]

export default function Reportes() {
  const { lang, t } = useLang()
  const { businessType } = useBusinessType()
  const [tab, setTab] = useState('daily')

  const visibleTabs = TABS.filter(t => !t.businessTypes || t.businessTypes.includes(businessType))

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
        {tab === 'comisiones' && <WorkerReport />}
        {tab === 'nominas'    && <PayrollReport />}
      </div>
    </div>
  )
}
