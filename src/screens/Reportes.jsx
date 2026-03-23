import { useState } from 'react'
import { BarChart2, Calendar, DollarSign } from 'lucide-react'
import { useLang } from '../i18n'
import DailyReport from './reports/DailyReport'
import MonthlyReport from './reports/MonthlyReport'
import WorkerReport from './reports/WorkerReport'

const TABS = [
  { id: 'daily',      es: 'Diario',     en: 'Daily',       icon: BarChart2  },
  { id: 'monthly',    es: 'Mensual',    en: 'Monthly',     icon: Calendar   },
  { id: 'comisiones', es: 'Comisiones', en: 'Commissions', icon: DollarSign },
]

export default function Reportes() {
  const { lang, t } = useLang()
  const [tab, setTab] = useState('daily')

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="shrink-0 px-3 md:px-6 py-3 md:py-4 border-b border-slate-200">
        <h2 className="text-[14px] md:text-[16px] font-bold text-slate-800">{t('nav_reports')}</h2>
      </div>

      <div className="shrink-0 flex border-b border-slate-200 px-2 md:px-6 overflow-x-auto scrollbar-none">
        {TABS.map(({ id, es, en, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 md:px-4 py-3 text-xs md:text-[13px] font-semibold border-b-2 transition-colors shrink-0 whitespace-nowrap ${
              tab === id ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}>
            <Icon size={14} />
            {lang === 'es' ? es : en}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === 'daily'      && <DailyReport />}
        {tab === 'monthly'    && <MonthlyReport />}
        {tab === 'comisiones' && <WorkerReport />}
      </div>
    </div>
  )
}
