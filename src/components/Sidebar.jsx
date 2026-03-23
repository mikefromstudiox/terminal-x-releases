import { NavLink, useLocation } from 'react-router-dom'
import logoImg from '../assets/logo.png'
import { useState, useEffect } from 'react'
import { useAPI } from '../context/DataContext'
import {
  ShoppingCart, ClipboardList, Users, CreditCard,
  Archive, FileText, PiggyBank, FileMinus, Settings,
  ChevronLeft, ChevronRight, LogOut, Monitor, Globe,
  Cloud, CloudOff, RefreshCw, Sun, Moon, Package,
  BarChart3, Menu, X,
} from 'lucide-react'
import { useLang } from '../i18n'
import { useAuth } from '../context/AuthContext'
import { useLayout } from '../context/LayoutContext'
import { useBackup } from '../context/BackupContext'
import { useLicense } from '../context/LicenseContext'
import LanguageToggle from './LanguageToggle'

// Roles: undefined = all, array = only those roles
const NAV = [
  { to: '/pos',          icon: ShoppingCart, key: 'nav_pos',          badge: 0 },
  { to: '/queue',        icon: ClipboardList,key: 'nav_queue',        badge: 0 },
  { to: '/clients',      icon: Users,        key: 'nav_clients',      badge: 0 },
  { to: '/credits',      icon: CreditCard,   key: 'nav_credits',      badge: 0, roles: ['owner','manager','cfo','accountant'] },
  { to: '/inventory',    icon: Package,      key: 'nav_inventory',    badge: 0, roles: ['owner','manager','cfo','accountant'] },
  { to: '/cash-recon',   icon: Archive,      key: 'nav_cash_recon',   badge: 0, roles: ['owner','manager','cfo','accountant'] },
  { to: '/dgii',         icon: FileText,     key: 'nav_dgii',         badge: 0, roles: ['owner','manager','cfo','accountant'] },
  { to: '/petty-cash',   icon: PiggyBank,    key: 'nav_petty',        badge: 0, roles: ['owner','manager','cfo','accountant'] },
  { to: '/credit-notes', icon: FileMinus,    key: 'nav_credit_notes', badge: 0, roles: ['owner','manager','cfo','accountant'] },
  { to: '/remote',       icon: Globe,        key: 'nav_remote',       badge: 0, roles: ['owner','manager'] },
  { to: '/admin',        icon: Settings,     key: 'nav_admin',        badge: 0, roles: ['owner','manager'] },
  { to: '/sistema',      icon: Monitor,      key: 'nav_sistema',      badge: 0, roles: ['owner'] },
]

// Bottom nav shows these 4 routes + a Menu button for the rest
const BOTTOM_NAV_ROUTES = ['/pos', '/queue', '/clients', '/reports/daily']

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
    online:  { dot: 'bg-emerald-400', label: lang === 'es' ? 'En linea'       : 'Online',       Icon: Cloud    },
    syncing: { dot: 'bg-amber-400 animate-pulse', label: lang === 'es' ? 'Sincronizando' : 'Syncing', Icon: RefreshCw },
    offline: { dot: 'bg-red-400',     label: lang === 'es' ? 'Sin conexion'   : 'Offline',      Icon: CloudOff },
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
    ? (lang === 'es' ? 'Licencia invalida'  : 'Invalid license')
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

// ── Bottom Nav Item (mobile) ──────────────────────────────────────────────────
function BottomNavItem({ to, icon: Icon, label, isActive }) {
  return (
    <NavLink to={to} className="flex flex-col items-center justify-center flex-1 py-1">
      <Icon size={20} strokeWidth={1.75} className={isActive ? 'text-sky-400' : 'text-slate-400'} />
      <span className={`text-[10px] mt-0.5 ${isActive ? 'text-sky-400 font-medium' : 'text-slate-400'}`}>
        {label}
      </span>
    </NavLink>
  )
}

// ── Mobile Bottom Navigation ──────────────────────────────────────────────────
function MobileBottomNav({ visibleNav, ecfQueue }) {
  const { t, lang } = useLang()
  const { user, logout } = useAuth()
  const { darkMode, toggleDark } = useLayout()
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Close drawer on route change
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  // Bottom nav items: POS, Queue, Clients, Reports, Menu
  const bottomItems = [
    { to: '/pos',            icon: ShoppingCart,  key: 'nav_pos' },
    { to: '/queue',          icon: ClipboardList, key: 'nav_queue' },
    { to: '/clients',        icon: Users,         key: 'nav_clients' },
    { to: '/reports/daily',  icon: BarChart3,     key: 'nav_reports', label: lang === 'es' ? 'Reportes' : 'Reports' },
  ]

  // Items that go into the drawer = all visible nav items NOT in bottom bar
  const drawerItems = visibleNav.filter(item => !BOTTOM_NAV_ROUTES.includes(item.to))

  const currentPath = location.pathname
  const isMenuActive = drawerOpen || drawerItems.some(item => currentPath.startsWith(item.to))

  return (
    <>
      {/* Backdrop */}
      {drawerOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* Slide-up drawer */}
      <div className={`fixed bottom-16 left-0 right-0 z-50 md:hidden transition-transform duration-200 ${
        drawerOpen ? 'translate-y-0' : 'translate-y-full'
      }`}>
        <div className="bg-slate-800 border-t border-slate-700 rounded-t-2xl max-h-[60vh] overflow-y-auto">
          {/* Drawer header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
            <span className="text-white text-sm font-semibold">{lang === 'es' ? 'Menu' : 'Menu'}</span>
            <button onClick={() => setDrawerOpen(false)} className="text-slate-400 hover:text-white p-1">
              <X size={18} />
            </button>
          </div>

          {/* Nav items */}
          <nav className="py-2 px-3 space-y-0.5">
            {drawerItems.map(item => {
              const Icon = item.icon
              const isActive = currentPath.startsWith(item.to)
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
                    isActive ? 'bg-slate-700 text-sky-400' : 'text-slate-300 hover:bg-slate-700/50'
                  }`}
                >
                  <Icon size={17} strokeWidth={1.75} className="shrink-0" />
                  <span className="text-[13px] font-medium flex-1">
                    {t(item.key)}
                  </span>
                  {item.to === '/dgii' && ecfQueue > 0 && (
                    <span className="w-[18px] h-[18px] text-[10px] bg-[#E24B4A] text-white font-bold rounded-full flex items-center justify-center leading-none">
                      {ecfQueue}
                    </span>
                  )}
                </NavLink>
              )
            })}
          </nav>

          {/* Footer: user info, dark mode, logout */}
          <div className="border-t border-slate-700 px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white text-[13px] font-semibold">{user?.name}</p>
                <p className="text-slate-400 text-[11px] capitalize">{user?.role}</p>
              </div>
              <div className="flex items-center gap-1">
                <LanguageToggle />
                <button
                  onClick={toggleDark}
                  className="p-2 rounded-lg text-slate-400 hover:text-amber-400 transition-colors"
                >
                  {darkMode ? <Sun size={15} /> : <Moon size={15} />}
                </button>
                <button
                  onClick={logout}
                  className="p-2 rounded-lg text-slate-400 hover:text-red-400 transition-colors"
                >
                  <LogOut size={15} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom navigation bar */}
      <div className="fixed bottom-0 left-0 right-0 h-16 bg-slate-800 border-t border-slate-700 flex justify-around items-center z-50 md:hidden">
        {bottomItems.map(item => (
          <BottomNavItem
            key={item.to}
            to={item.to}
            icon={item.icon}
            label={item.label || t(item.key)}
            isActive={currentPath.startsWith(item.to)}
          />
        ))}
        {/* Menu button */}
        <button
          onClick={() => setDrawerOpen(o => !o)}
          className="flex flex-col items-center justify-center flex-1 py-1"
        >
          <Menu size={20} strokeWidth={1.75} className={isMenuActive ? 'text-sky-400' : 'text-slate-400'} />
          <span className={`text-[10px] mt-0.5 ${isMenuActive ? 'text-sky-400 font-medium' : 'text-slate-400'}`}>
            {lang === 'es' ? 'Mas' : 'More'}
          </span>
        </button>
      </div>
    </>
  )
}

// ── Main Sidebar Export ───────────────────────────────────────────────────────
export default function Sidebar() {
  const api = useAPI()
  const { t, lang } = useLang()
  const { user, logout } = useAuth()
  const { collapsed, setCollapsed, darkMode, toggleDark } = useLayout()
  const { result } = useLicense()
  const [ecfQueue, setEcfQueue] = useState(0)

  useEffect(() => {
    async function poll() {
      const count = await api?.ecf?.queueCount?.() ?? 0
      setEcfQueue(count)
    }
    poll()
    const id = setInterval(poll, 30_000)
    return () => clearInterval(id)
  }, [])

  // Filter nav items by role
  const visibleNav = NAV.filter(item =>
    !item.roles || item.roles.includes(user?.role)
  )

  return (
    <>
      {/* ── Desktop sidebar (hidden on mobile) ──────────────────────────────── */}
      <aside className={`hidden md:flex ${
        collapsed ? 'w-[48px]' : 'w-[220px]'
      } bg-white dark:bg-zinc-900 border-r border-slate-100 dark:border-zinc-800 flex-col h-full shrink-0 transition-all duration-200 overflow-visible`}>

        {/* ── Brand header ─────────────────────────────────────────────────── */}
        <div className={`flex items-center border-b border-slate-100 dark:border-zinc-800 shrink-0 h-14 ${
          collapsed ? 'justify-center' : 'px-4'
        }`}>
          {collapsed
            ? <img src={logoImg} alt="TX" className="w-8 h-8 object-contain" draggable={false} />
            : <div className="flex items-center gap-2">
                <span className="text-[#0C447C] font-black text-[15px] tracking-[3px]">TERMINAL</span>
                <img src={logoImg} alt="X" className="h-6 w-auto object-contain" draggable={false} />
              </div>
          }
        </div>

        {/* ── Nav ──────────────────────────────────────────────────────────── */}
        <nav className={`flex-1 py-3 space-y-0.5 ${collapsed ? 'px-2 overflow-visible' : 'px-3 overflow-y-auto'}`}>
          {visibleNav.map(item => (
            <NavItem
              key={item.to}
              to={item.to}
              icon={item.icon}
              label={t(item.key)}
              badge={item.to === '/dgii' ? ecfQueue : item.badge}
              collapsed={collapsed}
            />
          ))}
        </nav>

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <div className="border-t border-slate-100 dark:border-zinc-800 shrink-0 p-2 space-y-1">
          <ConnectionDot collapsed={collapsed} />
          <LicenseDot collapsed={collapsed} />
          {/* User info */}
          {!collapsed && (
            <div className="px-2 py-1">
              <p className="text-slate-700 text-[13px] font-semibold truncate">{user?.name}</p>
              <p className="text-slate-400 text-[11px] capitalize">{user?.role}</p>
            </div>
          )}

          {/* Lang + Dark + Logout */}
          <div className={`flex items-center ${collapsed ? 'flex-col gap-1' : 'justify-between px-1'}`}>
            {!collapsed && <LanguageToggle />}
            <button
              onClick={toggleDark}
              title={darkMode ? (lang === 'es' ? 'Modo claro' : 'Light mode') : (lang === 'es' ? 'Modo oscuro' : 'Dark mode')}
              className="p-2 rounded-lg text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
            >
              {darkMode ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button
              onClick={logout}
              title={t('logout')}
              className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            >
              <LogOut size={15} />
            </button>
          </div>

          {/* WhatsApp support */}
          <a
            href="https://wa.me/18098282971?text=Hola%2C%20necesito%20soporte%20con%20Terminal%20X."
            target="_blank"
            rel="noopener noreferrer"
            title={lang === 'es' ? 'Soporte Studio X Tech' : 'Studio X Tech Support'}
            className={`flex items-center rounded-xl text-[#25D366] hover:bg-[#25D366]/10 transition-colors ${
              collapsed ? 'w-8 h-8 justify-center mx-auto' : 'w-full gap-2 px-3 py-2'
            }`}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-[15px] h-[15px] shrink-0">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
              <path d="M12 0C5.373 0 0 5.373 0 12c0 2.054.519 4 1.426 5.703L0 24l6.439-1.399A11.938 11.938 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-4.964-1.347l-.356-.211-3.698.803.827-3.607-.232-.371A9.818 9.818 0 1112 21.818z"/>
            </svg>
            {!collapsed && <span className="text-[12px] font-medium">{lang === 'es' ? 'Soporte' : 'Support'}</span>}
          </a>

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

      {/* ── Mobile bottom navigation (hidden on desktop) ────────────────────── */}
      <MobileBottomNav visibleNav={visibleNav} ecfQueue={ecfQueue} />
    </>
  )
}
