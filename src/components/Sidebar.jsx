import { NavLink } from 'react-router-dom'
import { useState } from 'react'
import {
  ShoppingCart, ClipboardList, Users, CreditCard,
  BarChart2, Calendar, DollarSign, Archive,
  FileText, PiggyBank, FileMinus, Settings,
  ChevronLeft, ChevronRight, LogOut, Globe,
  Cloud, CloudOff, RefreshCw, KeyRound,
} from 'lucide-react'
import { useLang } from '../i18n'
import { useAuth } from '../context/AuthContext'
import { useLayout } from '../context/LayoutContext'
import { useBackup } from '../context/BackupContext'
import { useLicense } from '../context/LicenseContext'
import LanguageToggle from './LanguageToggle'

// Roles: undefined = all, array = only those roles
const NAV = [
  { to: '/pos',              icon: ShoppingCart, key: 'nav_pos',          badge: 0 },
  { to: '/queue',            icon: ClipboardList,key: 'nav_queue',        badge: 0 },
  { to: '/clients',          icon: Users,        key: 'nav_clients',      badge: 0 },
  { to: '/credits',          icon: CreditCard,   key: 'nav_credits',      badge: 0, roles: ['owner','manager','cfo','accountant'] },
  { to: '/reports/daily',    icon: BarChart2,    key: 'nav_daily',        badge: 0, roles: ['owner','manager','cfo','accountant'] },
  { to: '/reports/monthly',  icon: Calendar,     key: 'nav_monthly',      badge: 0, roles: ['owner','manager','cfo','accountant'] },
  { to: '/reports/workers',  icon: DollarSign,   key: 'nav_worker_report',badge: 0, roles: ['owner','manager','cfo','accountant'] },
  { to: '/cash-recon',       icon: Archive,      key: 'nav_cash_recon',   badge: 0, roles: ['owner','manager','cfo','accountant'] },
  { to: '/dgii',             icon: FileText,     key: 'nav_dgii',         badge: 0, roles: ['owner','manager','cfo','accountant'] },
  { to: '/petty-cash',       icon: PiggyBank,    key: 'nav_petty',        badge: 0, roles: ['owner','manager','cfo','accountant'] },
  { to: '/credit-notes',     icon: FileMinus,    key: 'nav_credit_notes', badge: 0, roles: ['owner','manager','cfo','accountant'] },
  { to: '/admin',            icon: Settings,     key: 'nav_admin',        badge: 0, roles: ['owner','manager'] },
  { to: '/remote',           icon: Globe,        key: 'nav_remote',       badge: 0, roles: ['owner','cfo','accountant'] },
  { to: '/license-admin',    icon: KeyRound,     key: 'nav_license_admin',badge: 0, roles: ['owner'] },
]

function NavItem({ to, icon: Icon, label, badge, collapsed }) {
  return (
    <NavLink
      to={to}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        `flex items-center rounded-xl transition-all group select-none ${
          collapsed ? 'justify-center w-10 h-10 mx-auto' : 'relative gap-3 px-3 py-2.5 w-full'
        } ${
          isActive
            ? `bg-[#f0f6ff] text-[#0C447C]${collapsed ? '' : ' border-l-2 border-[#378ADD]'}`
            : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
        }`
      }
    >
      {collapsed ? (
        /* Icon wrapper — position:relative here so badge anchors to the icon, not the nav item */
        <span className="relative flex items-center justify-center w-[22px] h-[22px]">
          <Icon size={17} strokeWidth={1.75} />
          {badge > 0 && (
            <span className="absolute top-0 right-0 w-4 h-4 rounded-full flex items-center justify-center leading-none pointer-events-none"
              style={{ background: '#E24B4A', color: '#fff', fontSize: 9, fontWeight: 500 }}>
              {badge}
            </span>
          )}
        </span>
      ) : (
        <>
          <Icon size={17} strokeWidth={1.75} className="shrink-0" />
          <span className="text-[13px] font-medium flex-1 leading-none">{label}</span>
          {badge > 0 && (
            <span className="w-[18px] h-[18px] text-[10px] bg-[#E24B4A] text-white font-bold rounded-full flex items-center justify-center leading-none">
              {badge}
            </span>
          )}
        </>
      )}
      {/* Tooltip when collapsed */}
      {collapsed && (
        <span className="pointer-events-none absolute left-full ml-3 px-2.5 py-1.5 bg-slate-800 text-white text-xs rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg">
          {label}
        </span>
      )}
    </NavLink>
  )
}

function ConnectionDot({ collapsed }) {
  const { status, configured } = useBackup()
  const { lang } = useLang()
  if (!configured) return null

  const meta = {
    online:  { dot: 'bg-emerald-400', label: lang === 'es' ? 'En línea'       : 'Online',       Icon: Cloud    },
    syncing: { dot: 'bg-amber-400 animate-pulse', label: lang === 'es' ? 'Sincronizando' : 'Syncing', Icon: RefreshCw },
    offline: { dot: 'bg-red-400',     label: lang === 'es' ? 'Sin conexión'   : 'Offline',      Icon: CloudOff },
  }[status] || { dot: 'bg-slate-300', label: '', Icon: Cloud }

  if (collapsed) {
    return (
      <div title={meta.label} className="flex justify-center">
        <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 px-3 py-1">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} />
      <span className="text-[11px] text-slate-400">{meta.label}</span>
    </div>
  )
}

function LicenseDot({ collapsed }) {
  const { result, isReadOnly } = useLicense()
  const { lang } = useLang()
  if (!result) return null

  const isExpired  = result.status === 'expired' || result.status === 'grace'
  const isWarning  = result.warning
  if (!isExpired && !isWarning && !isReadOnly) return null

  const dot   = isReadOnly || isExpired ? 'bg-red-400' : 'bg-amber-400'
  const label = isReadOnly
    ? (lang === 'es' ? 'Licencia inválida'  : 'Invalid license')
    : isExpired
      ? (lang === 'es' ? 'Licencia vencida' : 'License expired')
      : result.warningMsg || ''

  if (collapsed) {
    return (
      <div title={label} className="flex justify-center">
        <span className={`w-2 h-2 rounded-full ${dot}`} />
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 px-3 py-1">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
      <span className="text-[11px] text-slate-400 truncate">{label}</span>
    </div>
  )
}

export default function Sidebar() {
  const { t, lang } = useLang()
  const { user, logout } = useAuth()
  const { collapsed, setCollapsed } = useLayout()
  const { result } = useLicense()

  // Filter nav items by role
  const visibleNav = NAV.filter(item =>
    !item.roles || item.roles.includes(user?.role)
  )

  return (
    <aside className={`${
      collapsed ? 'w-[48px]' : 'w-[220px]'
    } bg-white border-r border-slate-100 flex flex-col h-full shrink-0 transition-all duration-200 overflow-visible`}>

      {/* ── Brand header ───────────────────────────────────────────────────── */}
      <div className={`flex items-center border-b border-slate-100 shrink-0 h-14 ${
        collapsed ? 'justify-center' : 'px-4'
      }`}>
        {collapsed
          ? <img src="/assets/logo.png" alt="TX" className="w-8 h-8 object-contain" draggable={false} />
          : <div className="flex items-center gap-2">
              <span className="text-[#0C447C] font-black text-[15px] tracking-[3px]">TERMINAL</span>
              <img src="/assets/logo.png" alt="X" className="h-6 w-auto object-contain" draggable={false} />
            </div>
        }
      </div>

      {/* ── Nav ───────────────────────────────────────────────────────────── */}
      <nav className={`flex-1 py-3 space-y-0.5 ${collapsed ? 'px-2 overflow-visible' : 'px-3 overflow-y-auto'}`}>
        {visibleNav.map(item => (
          <NavItem
            key={item.to}
            to={item.to}
            icon={item.icon}
            label={t(item.key)}
            badge={item.badge}
            collapsed={collapsed}
          />
        ))}
      </nav>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <div className="border-t border-slate-100 shrink-0 p-2 space-y-1">
        <ConnectionDot collapsed={collapsed} />
        <LicenseDot collapsed={collapsed} />
        {/* User info */}
        {!collapsed && (
          <div className="px-2 py-1">
            <p className="text-slate-700 text-[13px] font-semibold truncate">{user?.name}</p>
            <p className="text-slate-400 text-[11px] capitalize">{user?.role}</p>
          </div>
        )}

        {/* Lang + Logout */}
        <div className={`flex items-center ${collapsed ? 'flex-col gap-1' : 'justify-between px-1'}`}>
          {!collapsed && <LanguageToggle />}
          <button
            onClick={logout}
            title={t('logout')}
            className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
          >
            <LogOut size={15} />
          </button>
        </div>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(c => !c)}
          className={`flex items-center rounded-xl text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors ${
            collapsed ? 'w-8 h-8 justify-center mx-auto' : 'w-full gap-2 px-3 py-2'
          }`}
        >
          {collapsed
            ? <ChevronRight size={15} />
            : <>
                <ChevronLeft size={15} />
                <span className="text-[12px]">{lang === 'es' ? 'Colapsar' : 'Collapse'}</span>
              </>
          }
        </button>
      </div>
    </aside>
  )
}
