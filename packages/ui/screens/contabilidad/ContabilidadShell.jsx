// ContabilidadShell — wrapper for the firm-side suite (Phase 1 + Phase 2 Slice 3).
// Mounted by the per-tenant app shell when business_type === 'contabilidad'.
// Provides the inner sidebar and routes to the screen barrel.
import { useState } from 'react'
import { Inbox, Building2, Calendar, FileText, Folder, Banknote, BookOpen, Landmark } from 'lucide-react'
import Bandeja from './Bandeja.jsx'
import Cartera from './Cartera.jsx'
import Calendario from './Calendario.jsx'
import Comprobantes from './Comprobantes.jsx'
import Vault from './Vault.jsx'
import Honorarios from './Honorarios.jsx'
import LibroMayor from './LibroMayor.jsx'
import Banco from './Banco.jsx'
import { usePlan, isComingSoonFeature } from '../../hooks/usePlan'

const TABS = [
  { id: 'bandeja',     label: 'Bandeja',      icon: Inbox,      Component: Bandeja },
  { id: 'cartera',     label: 'Cartera',      icon: Building2,  Component: Cartera },
  { id: 'calendario',  label: 'Calendario',   icon: Calendar,   Component: Calendario },
  { id: 'comprobantes',label: 'Comprobantes', icon: FileText,   Component: Comprobantes },
  { id: 'libro_mayor', label: 'Libro Mayor',  icon: BookOpen,   Component: LibroMayor, featureKey: 'contabilidad_libro_mayor' },
  { id: 'banco',       label: 'Banco',        icon: Landmark,   Component: Banco,      featureKey: 'contabilidad_banco' },
  { id: 'vault',       label: 'Vault',        icon: Folder,     Component: Vault },
  { id: 'honorarios',  label: 'Honorarios',   icon: Banknote,   Component: Honorarios },
]

export default function ContabilidadShell({ initialTab = 'bandeja' } = {}) {
  const [tab, setTab] = useState(initialTab)
  const { hasFeature } = usePlan()
  const Active = TABS.find(t => t.id === tab)?.Component || Bandeja
  return (
    <div className="flex flex-col md:flex-row min-h-full">
      <aside className="md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-black/10 dark:border-white/10 bg-white dark:bg-black">
        <nav className="flex md:flex-col gap-1 p-3 overflow-x-auto">
          {TABS.map(t => {
            const Icon = t.icon
            const active = tab === t.id
            const soon = t.featureKey && isComingSoonFeature(t.featureKey) && !hasFeature(t.featureKey)
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold transition-colors whitespace-nowrap text-left
                  ${active
                    ? 'bg-[#b3001e]/15 border border-[#b3001e]/30 text-[#b3001e]'
                    : 'text-black/70 dark:text-white/70 hover:bg-[#b3001e]/5 hover:text-[#b3001e] border border-transparent'}`}>
                <Icon size={14} className={active ? 'text-[#b3001e]' : 'text-black/50 dark:text-white/50'} />
                <span className="flex-1">{t.label}</span>
                {soon && (
                  <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full border border-[#b3001e]/30 text-[#b3001e]">
                    Próx.
                  </span>
                )}
              </button>
            )
          })}
        </nav>
      </aside>
      <div className="flex-1 min-w-0">
        <Active />
      </div>
    </div>
  )
}
