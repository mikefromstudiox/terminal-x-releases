// Shared chrome + helpers for all /probar/<vertical> interactive demos.
// One source of truth for sidebar, top bar, demo banner, cobrar modal,
// client picker, loyalty badge, totals row and the signup-gate hook.
//
// Per-vertical demos import from here and only own:
//  - their seed data
//  - their main operational view (POS / mesas / inventory / loans / etc.)
//  - their nav config

import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight, Sparkles, X, Check, ChevronLeft, ChevronRight,
  Moon, RefreshCw, LogOut, Bell, HelpCircle, Search, UserRound,
  CreditCard, Banknote, Smartphone, PiggyBank, Receipt, Printer,
  MessageSquare, ShoppingCart, ChevronRight as Chevron,
} from 'lucide-react'
import logoImg from '../../assets/logo.webp'
import xMark from '../../assets/x-mark.webp'

export const RD  = (n) => 'RD$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
export const RDc = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

// Use this hook in every demo's top-level component to gate access to
// signed-up leads only. Returns null until allowed=true; bounces to /signup
// if no resume payload is found in sessionStorage.
export function useDemoGate(navigate) {
  const [allowed, setAllowed] = useState(null)
  const [resume, setResume]   = useState(null)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('tx_signup_resume')
      if (!raw) { setAllowed(false); return }
      const r = JSON.parse(raw)
      const ok = !!(r && r.email && r.business_name)
      setAllowed(ok)
      if (ok) setResume(r)
    } catch { setAllowed(false) }
  }, [])
  useEffect(() => {
    if (allowed === false) navigate('/signup', { replace: true })
  }, [allowed, navigate])
  return { allowed, resume }
}

export function Row({ label, value, muted }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className={muted ? 'text-slate-400' : 'text-slate-600'}>{label}</span>
      <span className="text-slate-700 tabular-nums">{value}</span>
    </div>
  )
}

export function LoyaltyBadge({ tier }) {
  if (!tier) return null
  const styles = { Oro: 'bg-amber-100 text-amber-800', Plata: 'bg-slate-200 text-slate-700', Bronce: 'bg-orange-100 text-orange-800' }
  return <span className={`text-[8px] font-bold px-1 py-0.5 rounded uppercase tracking-wider ${styles[tier] || 'bg-slate-100 text-slate-700'}`}>{tier}</span>
}

export function DemoBanner({ navigate, resumeName, verticalLabel }) {
  return (
    <div className="bg-[#b3001e] text-white px-3 py-2 flex items-center justify-between gap-3 flex-wrap shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <Link to="/" className="flex items-center gap-1.5 text-white/85 hover:text-white text-[11px] font-bold shrink-0">
          <ArrowLeft size={13} /> Volver
        </Link>
        <span className="text-white/30">·</span>
        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[2px] truncate">
          <Sparkles size={11} /> Modo Demo {verticalLabel ? `· ${verticalLabel}` : ''} {resumeName ? `· ${resumeName}` : ''}
        </span>
      </div>
      <button onClick={() => navigate('/signup?step=3')}
        className="bg-white text-[#b3001e] hover:bg-white/95 px-3 py-1 rounded-md text-[11px] font-bold inline-flex items-center gap-1.5 shrink-0">
        Crear cuenta gratis 7 dias <ArrowRight size={11} />
      </button>
    </div>
  )
}

export function Sidebar({ navItems, view, setView, collapsed, setCollapsed, navigate, business }) {
  return (
    <aside className={`hidden md:flex ${collapsed ? 'w-[48px]' : 'w-[220px]'} bg-black flex-col h-full shrink-0 transition-all duration-200`}>
      <div className={`flex items-center border-b border-white/10 shrink-0 h-14 ${collapsed ? 'justify-center' : 'px-4'}`}>
        {collapsed
          ? <img src={xMark} alt="TX" className="w-8 h-8 object-contain" />
          : <div className="flex items-center gap-0">
              <span className="text-[15px] font-black tracking-[3px] text-white leading-none -mt-1">TERMINAL</span>
              <img src={logoImg} alt="X" className="h-6 w-auto object-contain" />
            </div>
        }
      </div>

      <nav className={`flex-1 py-3 space-y-0.5 overflow-y-auto ${collapsed ? 'px-2' : 'px-3'}`}>
        {navItems.map(it => {
          const Icon = it.icon
          const active = view === it.id
          return (
            <button key={it.id} onClick={() => setView(it.id)}
              title={collapsed ? it.label : undefined}
              className={`w-full flex items-center gap-2.5 ${collapsed ? 'justify-center px-0' : 'px-3'} py-2 rounded-lg transition-colors text-left relative ${active ? 'bg-[#b3001e] text-white' : 'text-white/70 hover:text-white hover:bg-white/5'}`}>
              <Icon size={15} strokeWidth={1.75} className="shrink-0" />
              {!collapsed && <span className="text-[13px] font-medium flex-1 truncate">{it.label}</span>}
              {!collapsed && it.badge > 0 && (
                <span className="text-[9px] font-bold bg-[#E24B4A] text-white rounded-full w-[18px] h-[18px] flex items-center justify-center leading-none">{it.badge}</span>
              )}
              {collapsed && it.badge > 0 && (
                <span className="absolute top-0 right-0 w-2 h-2 rounded-full bg-[#E24B4A]" />
              )}
            </button>
          )
        })}
      </nav>

      <div className="border-t border-white/10 shrink-0 p-2 space-y-1">
        <div className={`flex items-center gap-2 ${collapsed ? 'justify-center' : 'px-3 py-1'}`}>
          <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
          {!collapsed && <span className="text-[11px] text-slate-400">En linea</span>}
        </div>
        {!collapsed && business?.user && (
          <div className="px-2 py-1">
            <p className="text-white text-[13px] font-semibold truncate">{business.user.name}</p>
            <p className="text-white/40 text-[11px] capitalize">{business.user.role}</p>
          </div>
        )}
        <div className={`flex items-center ${collapsed ? 'flex-col gap-1' : 'justify-between px-1'}`}>
          {!collapsed && <button title="Idioma" className="px-2 py-1 rounded text-[10px] font-bold text-white/70">ES</button>}
          <button title="Tema" className="p-2 rounded-lg text-white/40 hover:text-amber-400 hover:bg-white/5"><Moon size={15} /></button>
          <button title="Sincronizar" className="p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/5"><RefreshCw size={15} /></button>
          <button onClick={() => navigate('/signup?step=3')} title="Salir del demo" className="p-2 rounded-lg text-white/40 hover:text-[#b3001e] hover:bg-white/5"><LogOut size={15} /></button>
        </div>
        <a href="https://wa.me/18098282971" target="_blank" rel="noopener noreferrer"
          className={`flex items-center rounded-xl text-[#25D366] hover:bg-[#25D366]/10 transition-colors ${collapsed ? 'w-8 h-8 justify-center mx-auto' : 'w-full gap-2 px-3 py-2'}`}>
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-[15px] h-[15px] shrink-0">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
            <path d="M12 0C5.373 0 0 5.373 0 12c0 2.054.519 4 1.426 5.703L0 24l6.439-1.399A11.938 11.938 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-4.964-1.347l-.356-.211-3.698.803.827-3.607-.232-.371A9.818 9.818 0 1112 21.818z"/>
          </svg>
          {!collapsed && <span className="text-[12px] font-medium">Soporte</span>}
        </a>
        <button onClick={() => setCollapsed(v => !v)}
          className={`flex items-center rounded-xl text-white/40 hover:bg-white/5 hover:text-white/60 transition-colors ${collapsed ? 'w-8 h-8 justify-center mx-auto' : 'w-full gap-2 px-3 py-2'}`}>
          {collapsed ? <ChevronRight size={15} /> : <><ChevronLeft size={15} /><span className="text-[12px]">Colapsar</span></>}
        </button>
      </div>
    </aside>
  )
}

export function TopBar({ business, searchPlaceholder = 'Buscar...' }) {
  const dateStr = new Date().toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'long' })
  return (
    <header className="h-14 bg-white border-b border-slate-200 px-4 flex items-center gap-4 shrink-0">
      <div className="min-w-0">
        <p className="text-[13px] font-bold text-slate-800 truncate leading-tight">{business.name}</p>
        <p className="text-[10px] text-slate-400 truncate">RNC {business.rnc} · {dateStr}</p>
      </div>
      <div className="flex-1 max-w-md ml-4">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input placeholder={searchPlaceholder}
            className="w-full pl-9 pr-3 py-2 text-[13px] rounded-lg border border-slate-200 bg-slate-50 outline-none focus:border-[#b3001e] focus:bg-white placeholder:text-slate-300" />
        </div>
      </div>
      <div className="flex items-center gap-2 ml-auto shrink-0">
        <button title="Notificaciones" className="relative p-2 text-slate-400 hover:text-slate-700">
          <Bell size={16} />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#b3001e]" />
        </button>
        <button title="Ayuda" className="p-2 text-slate-400 hover:text-slate-700"><HelpCircle size={16} /></button>
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-100">
          <div className="w-7 h-7 rounded-full bg-[#b3001e] text-white text-[11px] font-bold flex items-center justify-center">
            {business.user.name.split(' ').map(s => s[0]).slice(0, 2).join('')}
          </div>
          <div className="text-left hidden lg:block">
            <p className="text-[12px] font-bold text-slate-800 leading-none">{business.user.name.split(' ')[0]}</p>
            <p className="text-[9px] text-slate-400 mt-0.5 uppercase tracking-wider">{business.user.role}</p>
          </div>
        </div>
      </div>
    </header>
  )
}

export function ClientPickerModal({ clients, onPick, onClose }) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return clients
    return clients.filter(c => c.name.toLowerCase().includes(s) || (c.rnc || '').includes(s) || (c.phone || '').includes(s))
  }, [q, clients])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white w-[420px] max-w-[92vw] rounded-2xl shadow-2xl max-h-[70vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
          <Search size={14} className="text-slate-400" />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar cliente..."
            className="flex-1 text-[13px] bg-transparent outline-none" />
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <button onClick={() => onPick({ name: 'Consumidor Final', rnc: '', phone: '', points: 0 })}
            className="w-full text-left px-4 py-3 hover:bg-slate-50 border-b border-slate-100 flex items-center gap-2.5">
            <UserRound size={14} className="text-slate-400" />
            <span className="text-[13px] font-semibold text-slate-700">Consumidor Final</span>
          </button>
          {filtered.map(c => (
            <button key={c.id} onClick={() => onPick(c)}
              className="w-full text-left px-4 py-3 hover:bg-[#b3001e]/5 border-b border-slate-50 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-sky-100 text-sky-700 text-[11px] font-bold flex items-center justify-center shrink-0">
                {c.name.split(' ').map(s => s[0]).slice(0, 2).join('')}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-slate-800 truncate flex items-center gap-1.5">{c.name} <LoyaltyBadge tier={c.loyalty} /></p>
                <p className="text-[11px] text-slate-400 truncate">{c.rnc || '—'} · {c.phone || '—'} {c.visits ? `· ${c.visits} visitas` : ''}</p>
              </div>
              {c.points != null && <span className="text-[10px] font-bold text-[#b3001e] tabular-nums">{c.points} pts</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function CobrarModal({ cart, subtotal, itbis, total, client, onClose, onComplete }) {
  const [method, setMethod]       = useState('efectivo')
  const [received, setReceived]   = useState('')
  const [emitirEcf, setEmitirEcf] = useState(true)
  const [ecfType, setEcfType]     = useState(client?.rnc ? 'E31' : 'E32')
  const [rnc, setRnc]             = useState(client?.rnc || '')
  const [autoPrint, setAutoPrint] = useState(true)
  const [whatsappEnvio, setWhatsappEnvio] = useState(true)
  const [step, setStep]           = useState('pago')

  const change = method === 'efectivo' && received ? Math.max(0, Number(received) - total) : 0
  const canConfirm = method !== 'efectivo' || (received && Number(received) >= total)

  function confirm() { setStep('procesando'); setTimeout(() => setStep('exito'), 1100) }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        {step === 'exito' ? (
          <SuccessView total={total} rnc={rnc} ecfType={ecfType} emitirEcf={emitirEcf} onClose={onComplete} />
        ) : step === 'procesando' ? (
          <div className="p-12 text-center">
            <div className="w-12 h-12 mx-auto border-4 border-slate-100 border-t-[#b3001e] rounded-full animate-spin" />
            <p className="text-[14px] font-bold text-slate-800 mt-4">Firmando e-CF y enviando a DGII...</p>
            <p className="text-[11px] text-slate-500 mt-1">RSA-SHA256 · ambiente PRODUCCION · sin PSFE</p>
          </div>
        ) : (
          <>
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-[16px] font-black text-slate-900">Cobrar</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">{cart.length} item(s) · Total {RD(total)}{client ? ` · ${client.name}` : ''}</p>
              </div>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[2px] text-slate-400 mb-2">Metodo de pago</label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { id: 'efectivo', icon: Banknote,   label: 'Efectivo' },
                    { id: 'tarjeta',  icon: CreditCard, label: 'Tarjeta' },
                    { id: 'transfer', icon: Smartphone, label: 'Transferencia' },
                    { id: 'mixto',    icon: PiggyBank,  label: 'Mixto' },
                  ].map(m => {
                    const Icon = m.icon; const sel = method === m.id
                    return (
                      <button key={m.id} onClick={() => setMethod(m.id)}
                        className={`p-3 rounded-xl border-2 flex flex-col items-center gap-1.5 text-[11px] font-bold transition-colors ${sel ? 'border-[#b3001e] bg-[#b3001e]/5 text-[#b3001e]' : 'border-slate-200 hover:border-slate-300 text-slate-600'}`}>
                        <Icon size={18} />
                        {m.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {method === 'efectivo' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-[2px] text-slate-400 mb-1">Recibido</label>
                      <input type="number" value={received} onChange={e => setReceived(e.target.value)} placeholder="0.00"
                        className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-[13px] outline-none focus:border-[#b3001e]" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-[2px] text-slate-400 mb-1">Cambio</label>
                      <div className="px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[13px] font-bold text-slate-800 tabular-nums">{RD(change)}</div>
                    </div>
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {[total, 200, 500, 1000, 2000, 5000].filter((v, i, a) => a.indexOf(v) === i).map(v => (
                      <button key={v} onClick={() => setReceived(String(v))} className="px-3 py-1.5 rounded-md text-[11px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700">
                        {v === total ? 'Exacto' : RD(v)}
                      </button>
                    ))}
                  </div>
                </>
              )}

              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <button onClick={() => setEmitirEcf(v => !v)}
                  className={`w-full px-4 py-3 flex items-center justify-between transition-colors ${emitirEcf ? 'bg-[#b3001e]/5' : 'bg-white'}`}>
                  <div className="text-left">
                    <p className="text-[13px] font-bold text-slate-800 flex items-center gap-2"><Receipt size={14} /> Emitir e-CF a DGII</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">{emitirEcf ? `Tipo ${ecfType} · firmado y enviado directo` : 'Solo NCF de consumo en papel'}</p>
                  </div>
                  <div className={`w-10 h-5 rounded-full relative transition-colors ${emitirEcf ? 'bg-[#b3001e]' : 'bg-slate-300'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${emitirEcf ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </div>
                </button>
                {emitirEcf && (
                  <div className="px-4 py-3 border-t border-slate-200 bg-white space-y-2.5">
                    <div className="flex gap-1.5">
                      {[
                        { v: 'E32', l: 'E32 Consumo' },
                        { v: 'E31', l: 'E31 Cred. Fiscal' },
                        { v: 'E43', l: 'E43 Gastos Men.' },
                      ].map(t => (
                        <button key={t.v} onClick={() => setEcfType(t.v)}
                          className={`px-2.5 py-1 rounded text-[11px] font-bold ${ecfType === t.v ? 'bg-[#b3001e] text-white' : 'bg-slate-100 text-slate-600'}`}>
                          {t.l}
                        </button>
                      ))}
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-[2px] text-slate-400 mb-1">RNC del cliente {ecfType === 'E32' ? '(opcional)' : '(requerido)'}</label>
                      <input value={rnc} onChange={e => setRnc(e.target.value)} placeholder="123-45678-9 o cedula"
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] outline-none focus:border-[#b3001e]" />
                      <p className="text-[10px] text-slate-400 mt-1">Lookup automatico contra 900,000+ contribuyentes locales</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-slate-200 cursor-pointer hover:border-slate-300">
                  <input type="checkbox" checked={autoPrint} onChange={e => setAutoPrint(e.target.checked)} className="accent-[#b3001e]" />
                  <Printer size={13} className="text-slate-500" />
                  <span className="text-[12px] font-semibold text-slate-700">Imprimir recibo</span>
                </label>
                <label className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-slate-200 cursor-pointer hover:border-slate-300">
                  <input type="checkbox" checked={whatsappEnvio} onChange={e => setWhatsappEnvio(e.target.checked)} className="accent-[#b3001e]" />
                  <MessageSquare size={13} className="text-slate-500" />
                  <span className="text-[12px] font-semibold text-slate-700">Enviar por WhatsApp</span>
                </label>
              </div>

              <div className="rounded-xl bg-slate-50 p-4 space-y-1.5">
                <Row label="Subtotal" value={RD(subtotal)} />
                <Row label="ITBIS 18%" value={RD(itbis)} muted />
                <div className="border-t border-slate-200 pt-2 mt-2 flex items-baseline justify-between">
                  <span className="text-[13px] font-bold text-slate-700">Total a cobrar</span>
                  <span className="text-[24px] font-black text-slate-900 tabular-nums">{RD(total)}</span>
                </div>
              </div>

              <button disabled={!canConfirm} onClick={confirm}
                className="w-full py-3.5 rounded-xl bg-[#b3001e] hover:bg-[#8c0017] text-white font-bold disabled:opacity-30 transition-colors flex items-center justify-center gap-2 text-[14px] shadow-lg shadow-[#b3001e]/25">
                Confirmar cobro {RD(total)} <Chevron size={16} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function SuccessView({ total, rnc, ecfType, emitirEcf, onClose }) {
  const eNcf  = useMemo(() => ecfType + String(Math.floor(1000000 + Math.random() * 8999999)).padStart(10, '0'), [ecfType])
  const codSeg = useMemo(() => Array.from({ length: 6 }, () => 'ABCDEFGHIJKLMNPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 35)]).join(''), [])
  const qr    = useMemo(() => Array.from({ length: 64 }, () => Math.random() > 0.45), [])
  return (
    <div className="p-8 text-center">
      <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 flex items-center justify-center">
        <Check size={32} className="text-emerald-700" strokeWidth={3} />
      </div>
      <h3 className="text-[24px] font-black text-slate-900 mt-4">Cobro completado</h3>
      <p className="text-[13px] text-slate-600 mt-1">Por {RD(total)}</p>
      {emitirEcf && (
        <div className="mt-6 mx-auto max-w-sm rounded-xl border border-slate-200 p-5 text-left">
          <p className="text-[10px] font-bold uppercase tracking-[2px] text-emerald-700 flex items-center gap-1 mb-3">
            <Check size={11} /> e-CF aceptado por DGII · Track #{Math.floor(Math.random() * 9000000) + 1000000}
          </p>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[12px]"><span className="text-slate-500">e-NCF</span><span className="font-mono font-bold text-slate-800">{eNcf}</span></div>
            <div className="flex items-center justify-between text-[12px]"><span className="text-slate-500">Codigo seguridad</span><span className="font-mono font-bold text-slate-800">{codSeg}</span></div>
            <div className="flex items-center justify-between text-[12px]"><span className="text-slate-500">Tipo</span><span className="font-bold text-slate-800">{ecfType}</span></div>
            {rnc && <div className="flex items-center justify-between text-[12px]"><span className="text-slate-500">RNC</span><span className="font-mono font-bold text-slate-800">{rnc}</span></div>}
            <div className="flex items-center justify-between text-[12px]"><span className="text-slate-500">Fecha</span><span className="font-bold text-slate-800">{new Date().toLocaleString('es-DO')}</span></div>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-center">
            <div className="w-20 h-20 bg-black grid grid-cols-8 gap-0.5 p-1.5 rounded">
              {qr.map((on, i) => <div key={i} className={on ? 'bg-white' : 'bg-black'} />)}
            </div>
          </div>
          <p className="text-[9px] text-slate-400 text-center mt-2">QR verificable en ecf.dgii.gov.do</p>
        </div>
      )}
      <div className="mt-6 flex items-center justify-center gap-2">
        <button onClick={onClose} className="bg-[#b3001e] hover:bg-[#8c0017] text-white font-bold px-5 py-2.5 rounded-xl text-[13px] inline-flex items-center gap-2">
          Nuevo ticket <ArrowRight size={13} />
        </button>
        <button className="border border-slate-200 hover:border-slate-300 text-slate-700 font-bold px-5 py-2.5 rounded-xl text-[13px]">
          Reimprimir
        </button>
      </div>
    </div>
  )
}

export function SoonView({ title, desc, navigate }) {
  return (
    <div className="p-8">
      <div className="max-w-xl mx-auto bg-white rounded-2xl border border-slate-200 p-10 text-center">
        <div className="w-14 h-14 mx-auto rounded-full bg-[#b3001e]/10 flex items-center justify-center mb-4">
          <Sparkles size={22} className="text-[#b3001e]" />
        </div>
        <h2 className="text-[20px] font-black text-slate-900">{title}</h2>
        <p className="text-[13px] text-slate-600 mt-3 leading-relaxed">{desc}</p>
        <button onClick={() => navigate('/signup?step=3')} className="mt-6 inline-flex items-center gap-2 bg-[#b3001e] hover:bg-[#8c0017] text-white font-bold px-5 py-2.5 rounded-xl text-[13px]">
          Crear cuenta gratis 7 dias <ArrowRight size={13} />
        </button>
      </div>
    </div>
  )
}

// Generic stat tile / table helpers used across vertical reports/dashboards.
export function StatTile({ label, value, sub, accent }) {
  return (
    <div className={`bg-white rounded-2xl border ${accent ? 'border-[#b3001e]/30 ring-1 ring-[#b3001e]/10' : 'border-slate-200'} p-4`}>
      <p className="text-[10px] font-bold uppercase tracking-[2px] text-slate-400">{label}</p>
      <p className="text-[22px] font-black text-slate-900 mt-1.5 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  )
}

export function PageHeader({ title, sub, right }) {
  return (
    <div className="flex items-end justify-between mb-5 gap-4 flex-wrap">
      <div>
        <h2 className="text-[24px] font-black text-slate-900 tracking-tight leading-tight">{title}</h2>
        {sub && <p className="text-[12px] text-slate-500">{sub}</p>}
      </div>
      {right}
    </div>
  )
}

// Generic 2-pane POS view: categories + tile grid + cart + cobrar.
// `vertical` controls minor differences (label of "items", whether to show
// vehicle/client slots, etc).
export function GenericPosView({ business, categories, getItems, clients = [], extraSlots = null, itemNoun = 'producto' }) {
  const [activeCat, setActiveCat] = useState(categories[0]?.id || 'all')
  const [cart, setCart]           = useState([])
  const [showCobrar, setShowCobrar] = useState(false)
  const [client, setClient]       = useState(null)
  const [showPicker, setShowPicker] = useState(false)
  const [hint, setHint]           = useState(true)

  const items = getItems(activeCat) || []
  const subtotal = cart.reduce((s, it) => s + it.price * it.qty, 0)
  const itbis = Math.round(subtotal * 0.18 * 100) / 100
  const total = subtotal + itbis

  function add(p) {
    setCart(c => {
      const ex = c.find(it => it.id === p.id)
      if (ex) return c.map(it => it.id === p.id ? { ...it, qty: it.qty + 1 } : it)
      return [...c, { ...p, qty: 1 }]
    })
  }
  function remove(id) { setCart(c => c.filter(it => it.id !== id)) }
  function changeQty(id, d) { setCart(c => c.map(it => it.id === id ? { ...it, qty: Math.max(1, it.qty + d) } : it)) }
  function clear() { setCart([]); setClient(null) }

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col min-w-0">
        {hint && (
          <div className="mx-3 mt-3 flex items-start gap-3 p-3.5 rounded-xl bg-[#b3001e]/[0.06] border border-[#b3001e]/20">
            <Sparkles size={16} className="text-[#b3001e] mt-0.5 shrink-0" />
            <div className="flex-1 text-[13px] text-slate-700 leading-relaxed">
              <strong className="text-slate-900">Demo interactivo.</strong> Toca un {itemNoun} para agregarlo. Cuando estes listo, dale a Cobrar para ver el flujo de e-CF firmado y enviado a DGII.
            </div>
            <button onClick={() => setHint(false)} className="text-slate-400 hover:text-slate-700"><X size={14} /></button>
          </div>
        )}
        {/* Category tabs — matches real POS.jsx (border-b underline style) */}
        <div className="flex items-center border-b border-slate-200 bg-white shrink-0">
          <div className="flex-1 min-w-0 flex items-center overflow-x-auto">
            {categories.map(cat => {
              const active = activeCat === cat.id
              return (
                <button key={cat.id} onClick={() => setActiveCat(cat.id)}
                  className={`px-4 md:px-5 py-3 md:py-3.5 text-xs md:text-sm font-semibold transition-colors border-b-2 -mb-px shrink-0 min-h-[44px] ${active ? 'border-[#b3001e] text-[#b3001e]' : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'}`}>
                  {cat.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 md:p-4">
          <div className="grid gap-2 md:gap-2.5 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {items.map(p => {
              const selected = cart.some(it => it.id === p.id)
              return (
                <button key={p.id} onClick={() => add(p)}
                  className={`group relative overflow-hidden flex flex-col justify-between p-4 md:p-5 rounded-2xl border text-left transition-all duration-200 min-h-[124px] md:min-h-[132px] ${selected
                    ? 'border-[#b3001e] bg-gradient-to-br from-[#b3001e]/[0.09] via-white to-white shadow-[0_12px_30px_-12px_rgba(179,0,30,0.55),inset_0_1px_0_0_rgba(255,255,255,0.6)]'
                    : 'border-slate-200 bg-white hover:border-[#b3001e] hover:-translate-y-0.5 hover:shadow-[0_14px_32px_-12px_rgba(179,0,30,0.45)]'
                  }`}>
                  <span className={`absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#b3001e] to-transparent transition-opacity ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
                  {selected && <span className="absolute top-2 right-2 z-10 w-5 h-5 rounded-full bg-[#b3001e] text-white flex items-center justify-center ring-2 ring-white"><Check size={12} strokeWidth={3.5} /></span>}
                  <div className="relative">
                    <p className={`text-[14px] md:text-[15px] font-semibold leading-snug line-clamp-2 pr-6 tracking-[-0.01em] ${selected ? 'text-[#b3001e]' : 'text-slate-800'}`}>{p.name}</p>
                    {p.sub && <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-wider">{p.sub}</p>}
                  </div>
                  <div className="relative flex justify-end items-baseline gap-1.5 mt-3 pt-2.5 border-t border-dashed border-slate-200/70">
                    <span className="text-[11px] font-medium text-slate-400 uppercase tracking-[0.1em]">RD$</span>
                    <span className="font-black tabular-nums leading-none tracking-[-0.02em] text-[26px] md:text-[28px] text-[#b3001e]">{RDc(p.price)}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="w-[260px] shrink-0 border-l border-slate-200 flex flex-col bg-white">
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Cliente</label>
            {client ? (
              <div className="flex items-center gap-2 bg-sky-50 border border-sky-200 rounded-lg px-2.5 py-2">
                <UserRound size={14} className="text-sky-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold text-sky-800 truncate flex items-center gap-1.5">
                    <span className="truncate">{client.name}</span>
                    <LoyaltyBadge tier={client.loyalty} />
                  </p>
                  {client.rnc && <p className="text-[10px] text-sky-500">{client.rnc}{client.points != null ? ` · ${client.points} pts` : ''}</p>}
                </div>
                <button onClick={() => setClient(null)} className="text-sky-400 hover:text-sky-600"><X size={12} /></button>
              </div>
            ) : (
              <button onClick={() => setShowPicker(true)}
                className="w-full flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-[12px] text-slate-400 hover:border-sky-300 hover:text-sky-500">
                <UserRound size={14} />
                <span className="truncate">Seleccionar cliente...</span>
              </button>
            )}
          </div>

          {extraSlots}

          <div className="border-t border-slate-100 pt-3" />
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
              Items {cart.length > 0 && <span className="text-[#b3001e]">({cart.length})</span>}
            </label>
            {cart.length === 0 ? (
              <div className="py-6 text-center">
                <ShoppingCart size={20} className="mx-auto text-slate-300 mb-2" />
                <p className="text-[11px] text-slate-400">Toca un {itemNoun}</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {cart.map(it => (
                  <div key={it.id} className="bg-slate-50 rounded-lg p-2 border border-slate-100">
                    <div className="flex items-start justify-between gap-1">
                      <p className="text-[12px] font-semibold text-slate-700 leading-tight flex-1">{it.name}</p>
                      <button onClick={() => remove(it.id)} className="text-slate-300 hover:text-[#b3001e]"><X size={11} /></button>
                    </div>
                    <div className="flex items-center justify-between mt-1.5">
                      <div className="flex items-center gap-0.5">
                        <button onClick={() => changeQty(it.id, -1)} className="w-5 h-5 rounded bg-white border border-slate-200 hover:bg-slate-100 flex items-center justify-center text-slate-600">−</button>
                        <span className="w-6 text-center text-[11px] font-bold text-slate-800">{it.qty}</span>
                        <button onClick={() => changeQty(it.id, 1)} className="w-5 h-5 rounded bg-white border border-slate-200 hover:bg-slate-100 flex items-center justify-center text-slate-600">+</button>
                      </div>
                      <span className="text-[12px] font-bold text-[#b3001e] tabular-nums">{RD(it.price * it.qty)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="border-t border-slate-200 p-3 space-y-2 bg-slate-50">
          <div className="space-y-1">
            <Row label="Subtotal" value={RD(subtotal)} />
            <Row label="ITBIS 18%" value={RD(itbis)} muted />
          </div>
          <div className="border-t border-slate-200 pt-2 flex items-baseline justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total</span>
            <span className="text-[20px] font-black text-slate-900 tabular-nums">{RD(total)}</span>
          </div>
          <div className="flex flex-col gap-2">
            <button disabled={cart.length === 0} onClick={() => clear()}
              className="w-full py-2.5 rounded-xl bg-green-500 hover:bg-green-400 text-white font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98] shadow-md shadow-green-500/20 text-[13px]">
              Encolar
            </button>
            <button disabled={cart.length === 0} onClick={() => setShowCobrar(true)}
              className="w-full py-2.5 rounded-xl bg-[#b3001e] hover:bg-[#8c0017] text-white font-bold disabled:opacity-30 transition-colors flex items-center justify-center gap-2 text-[13px] shadow-md shadow-[#b3001e]/25">
              <CreditCard size={14} /> Cobrar {cart.length > 0 ? RD(total) : ''}
            </button>
          </div>
          {cart.length > 0 && <button onClick={clear} className="w-full py-1.5 text-[11px] text-slate-400 hover:text-[#b3001e] font-semibold">Limpiar ticket</button>}
        </div>
      </div>

      {showPicker && <ClientPickerModal clients={clients} onPick={c => { setClient(c); setShowPicker(false) }} onClose={() => setShowPicker(false)} />}
      {showCobrar && <CobrarModal cart={cart} subtotal={subtotal} itbis={itbis} total={total} client={client} onClose={() => setShowCobrar(false)} onComplete={() => { clear(); setShowCobrar(false) }} />}
    </div>
  )
}

// Generic Reports view — pass tiles array + optional bottom rows.
export function GenericReportsView({ tiles, bottom }) {
  return (
    <div className="p-4">
      <PageHeader title="Reportes" sub={`Hoy · ${new Date().toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'long' })}`}
        right={<div className="flex gap-1.5">
          {['Hoy', 'Semana', 'Mes', 'Personalizado'].map((p, i) => (
            <button key={p} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold ${i === 0 ? 'bg-[#b3001e] text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>{p}</button>
          ))}
        </div>}
      />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {tiles.map((t, i) => <StatTile key={i} {...t} />)}
      </div>
      {bottom}
    </div>
  )
}

// Generic DGII view
export function GenericDgiiView({ ecfToday = 0, queue = 0, certExpires = '2027-03-15' }) {
  return (
    <div className="p-4">
      <PageHeader title="DGII / e-CF" sub="Emisor Electronico Certificado · Solicitud #42483 · Ambiente PRODUCCION" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center gap-1.5 text-emerald-700 mb-2"><Check size={14} /><span className="text-[10px] font-bold uppercase tracking-[2px]">Certificado</span></div>
          <p className="text-[13px] font-bold text-slate-800">Viafirma X.509 RSA-SHA256</p>
          <p className="text-[11px] text-slate-500 mt-1">Vence: {certExpires} · Auto-renovacion</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center gap-1.5 text-emerald-700 mb-2"><Check size={14} /><span className="text-[10px] font-bold uppercase tracking-[2px]">Conexion DGII</span></div>
          <p className="text-[13px] font-bold text-slate-800">Produccion · Sin PSFE</p>
          <p className="text-[11px] text-slate-500 mt-1">Ultima recepcion: hace 2 min</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center gap-1.5 text-slate-700 mb-2"><Receipt size={14} /><span className="text-[10px] font-bold uppercase tracking-[2px]">Hoy</span></div>
          <p className="text-[13px] font-bold text-slate-800">{ecfToday} e-CF emitidos</p>
          <p className="text-[11px] text-slate-500 mt-1">{queue} en cola · 0 rechazados</p>
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-[14px] font-bold text-slate-800">Secuencias e-CF activas</h3>
          <button className="text-[11px] text-[#b3001e] font-bold hover:underline">Solicitar nueva secuencia</button>
        </div>
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="text-left px-5 py-2 font-bold">Tipo</th>
              <th className="text-left px-5 py-2 font-bold">Descripcion</th>
              <th className="text-right px-5 py-2 font-bold">Proximo</th>
              <th className="text-right px-5 py-2 font-bold">Restantes</th>
              <th className="text-right px-5 py-2 font-bold">Estado</th>
            </tr>
          </thead>
          <tbody>
            {[
              { t: 'B02', d: 'Consumo papel (NCF)',  n: 'B0200001847', r: '998,153' },
              { t: 'E31', d: 'Credito Fiscal',       n: 'E310000000234', r: '999,766' },
              { t: 'E32', d: 'Consumo (factura)',    n: 'E320000001847', r: '998,153' },
              { t: 'E33', d: 'Nota de Debito',       n: 'E330000000018', r: '999,982' },
              { t: 'E34', d: 'Nota de Credito',      n: 'E340000000091', r: '999,909' },
              { t: 'E43', d: 'Gastos Menores',       n: 'E430000000007', r: '999,993' },
            ].map(r => (
              <tr key={r.t} className="border-t border-slate-100">
                <td className="px-5 py-3 font-mono font-bold text-[#b3001e]">{r.t}</td>
                <td className="px-5 py-3 text-slate-700">{r.d}</td>
                <td className="px-5 py-3 text-right font-mono text-[11px] text-slate-700">{r.n}</td>
                <td className="px-5 py-3 text-right text-slate-500 tabular-nums">{r.r}</td>
                <td className="px-5 py-3 text-right">
                  <span className="text-[10px] text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">Activo</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Generic Cuadre view
export function GenericCuadreView({ ventasCash = 9200, ticketsCount = 27 }) {
  const counted = ventasCash - 20
  const variance = counted - ventasCash
  return (
    <div className="p-4">
      <PageHeader title="Cuadre de Caja" sub={`Cierre del dia · ${new Date().toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'long' })}`} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="text-[14px] font-bold text-slate-800 mb-4">Conteo de efectivo</h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px]">
            {[
              { d: '2,000', q: 1, t: 2000 }, { d: '1,000', q: 4, t: 4000 },
              { d: '500',   q: 3, t: 1500 }, { d: '200',   q: 4, t: 800 },
              { d: '100',   q: 5, t: 500 },  { d: '50',    q: 4, t: 200 },
              { d: '25',    q: 4, t: 100 },  { d: '10',    q: 6, t: 60 },
              { d: '5',     q: 3, t: 15 },   { d: '1',     q: 5, t: 5 },
            ].map((r, i) => (
              <div key={i} className="flex items-center justify-between border-b border-slate-100 py-1.5">
                <span className="text-slate-500">RD${r.d}</span>
                <span className="text-slate-700">x {r.q}</span>
                <span className="font-bold text-slate-800 tabular-nums">{RD(r.t)}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t-2 border-slate-200 flex items-center justify-between">
            <span className="text-[14px] font-bold text-slate-700">Total contado</span>
            <span className="text-[26px] font-black text-slate-900 tabular-nums">{RD(counted)}</span>
          </div>
        </div>
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <p className="text-[10px] font-bold uppercase tracking-[2px] text-slate-400">Ventas en efectivo</p>
            <p className="text-[22px] font-black text-slate-900 mt-1 tabular-nums">{RD(ventasCash)}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">{ticketsCount} tickets</p>
          </div>
          <div className={`rounded-2xl border p-5 ${variance === 0 ? 'bg-emerald-50 border-emerald-200' : variance > 0 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}>
            <p className={`text-[10px] font-bold uppercase tracking-[2px] ${variance === 0 ? 'text-emerald-700' : variance > 0 ? 'text-amber-700' : 'text-red-700'}`}>Varianza</p>
            <p className={`text-[22px] font-black mt-1 tabular-nums ${variance === 0 ? 'text-emerald-900' : variance > 0 ? 'text-amber-900' : 'text-red-900'}`}>
              {variance >= 0 ? '+' : ''}{RD(variance)}
            </p>
            <p className="text-[11px] text-slate-600 mt-0.5">{variance === 0 ? 'Cuadre exacto' : variance > 0 ? 'Sobrante' : 'Faltante'}</p>
          </div>
          <button className="w-full py-3 rounded-xl bg-[#b3001e] hover:bg-[#8c0017] text-white font-bold text-[13px] inline-flex items-center justify-center gap-2">
            <Check size={14} /> Cerrar cuadre del dia
          </button>
        </div>
      </div>
    </div>
  )
}

// Generic Clients view
export function GenericClientsView({ clients }) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return clients
    return clients.filter(c => c.name.toLowerCase().includes(s) || (c.rnc || '').includes(s) || (c.phone || '').includes(s))
  }, [q, clients])
  return (
    <div className="p-4">
      <PageHeader title="Clientes" sub={`${clients.length} clientes`}
        right={<button className="bg-[#b3001e] hover:bg-[#8c0017] text-white text-[12px] font-bold px-4 py-2 rounded-lg">+ Nuevo cliente</button>}
      />
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <div className="relative max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-[13px] outline-none focus:border-[#b3001e]" />
          </div>
        </div>
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="text-left px-4 py-2.5 font-bold">Cliente</th>
              <th className="text-left px-4 py-2.5 font-bold">RNC / Cedula</th>
              <th className="text-left px-4 py-2.5 font-bold">Telefono</th>
              <th className="text-left px-4 py-2.5 font-bold">Tier</th>
              <th className="text-right px-4 py-2.5 font-bold">Visitas</th>
              <th className="text-right px-4 py-2.5 font-bold">Puntos</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => (
              <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-sky-100 text-sky-700 text-[11px] font-bold flex items-center justify-center shrink-0">{c.name.split(' ').map(s => s[0]).slice(0, 2).join('')}</div>
                    <span className="font-semibold text-slate-800">{c.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-600 font-mono text-[11px]">{c.rnc || '—'}</td>
                <td className="px-4 py-3 text-slate-600">{c.phone || '—'}</td>
                <td className="px-4 py-3"><LoyaltyBadge tier={c.loyalty} /></td>
                <td className="px-4 py-3 text-right text-slate-700 font-semibold tabular-nums">{c.visits || '—'}</td>
                <td className="px-4 py-3 text-right text-[#b3001e] font-bold tabular-nums">{c.points || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
