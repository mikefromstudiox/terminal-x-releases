// /probar/:vertical — single dispatcher that renders the demo shell with a
// vertical-specific config. Each vertical exports a config from
// ./verticals/<vertical>.jsx with: { label, business, navItems, defaultView,
// render(viewId, ctx) }.

import { useState, lazy, Suspense } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { DemoBanner, Sidebar, useDemoGate } from './_shared'

const VERTICAL_LOADERS = {
  carwash:      () => import('./verticals/carwash'),
  retail:       () => import('./verticals/retail'),
  licoreria:    () => import('./verticals/licoreria'),
  carniceria:   () => import('./verticals/carniceria'),
  service:      () => import('./verticals/service'),
  restaurant:   () => import('./verticals/restaurant'),
  mechanic:     () => import('./verticals/mechanic'),
  salon:        () => import('./verticals/salon'),
  prestamos:    () => import('./verticals/prestamos'),
  dealership:   () => import('./verticals/dealership'),
  contabilidad: () => import('./verticals/contabilidad'),
  hybrid:       () => import('./verticals/hybrid'),
}

export default function Demo() {
  const navigate = useNavigate()
  const { vertical } = useParams()
  const { allowed, resume } = useDemoGate(navigate)

  if (allowed !== true) return null

  const loader = VERTICAL_LOADERS[vertical]
  if (!loader) {
    // Unknown vertical — bounce to /signup so the picker can re-route.
    if (typeof window !== 'undefined') window.location.replace('/signup')
    return null
  }
  const Loaded = lazyVertical(loader)

  return (
    <Suspense fallback={<div className="h-screen w-screen bg-slate-50 flex items-center justify-center"><div className="w-8 h-8 border-2 border-slate-200 border-t-[#b3001e] rounded-full animate-spin" /></div>}>
      <Loaded navigate={navigate} resume={resume} />
    </Suspense>
  )
}

function lazyVertical(loader) {
  return lazy(async () => {
    const mod = await loader()
    return { default: function VerticalShell({ navigate, resume }) {
      return <Shell config={mod.default || mod.config} navigate={navigate} resume={resume} />
    } }
  })
}

function Shell({ config, navigate, resume }) {
  const [view, setView]           = useState(config.defaultView || config.navItems[0]?.id || 'pos')
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div className="h-screen flex flex-col bg-slate-100 overflow-hidden">
      <DemoBanner navigate={navigate} resumeName={resume?.business_name} verticalLabel={config.label} />
      <div className="flex-1 flex min-h-0">
        <Sidebar navItems={config.navItems} view={view} setView={setView} collapsed={collapsed} setCollapsed={setCollapsed} navigate={navigate} business={config.business} />
        <div className="flex-1 flex flex-col min-w-0 bg-slate-50 overflow-hidden">
          {config.render(view, { navigate, business: config.business, setView })}
        </div>
      </div>
    </div>
  )
}
