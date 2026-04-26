/**
 * TiendaEmpenos.jsx — v2.16.2 public pawn-store listing.
 *
 * Routes (added in web/main.jsx):
 *   /tienda-empenos/:businessId               → grid of all published listings
 *   /tienda-empenos/:businessId/:slug         → single item detail
 *
 * No auth required. Uses Supabase anon key. Reads pawn_listings JOINed with
 * pawn_items + pawn_documents (foto only, public bucket). Mobile-first
 * responsive. SEO <title> + <meta description> via document API.
 *
 * NOTE: We use businessId (UUID) as the path slug because the businesses
 * table has no `slug` column today. If/when one is added, swap the lookup
 * here without changing the route shape (still tienda-empenos/:businessSlug).
 */

import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'

const CRIMSON = '#b3001e'

// Lazy-load Supabase using the env-baked credentials
async function getAnonClient() {
  if (typeof window !== 'undefined' && window.__txTiendaSupabase) return window.__txTiendaSupabase
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(url, key, { auth: { persistSession: false } })
  if (typeof window !== 'undefined') window.__txTiendaSupabase = sb
  return sb
}

function fmtRD(n) {
  return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function setSEO(title, description) {
  if (typeof document === 'undefined') return
  document.title = title
  let m = document.querySelector('meta[name="description"]')
  if (!m) { m = document.createElement('meta'); m.setAttribute('name', 'description'); document.head.appendChild(m) }
  m.setAttribute('content', description || '')
}

function toWa(phone, msg) {
  if (!phone) return null
  const digits = String(phone).replace(/\D/g, '')
  if (!digits) return null
  const num = digits.length === 10 ? '1' + digits : digits
  return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`
}

// ── Header (shared) ─────────────────────────────────────────────────────────
function StoreHeader({ business }) {
  return (
    <header className="bg-black text-white px-4 py-5 md:px-8 md:py-7 border-b-2" style={{ borderColor: CRIMSON }}>
      <div className="max-w-6xl mx-auto flex items-center gap-4">
        {business?.logo_url ? (
          <img src={business.logo_url} alt={business?.name || ''} className="w-14 h-14 md:w-16 md:h-16 object-contain rounded-xl bg-white/5 p-1" />
        ) : (
          <div className="w-14 h-14 md:w-16 md:h-16 rounded-xl bg-white/10 flex items-center justify-center text-white/40 font-black text-2xl">X</div>
        )}
        <div className="min-w-0">
          <p className="text-[10px] md:text-[11px] font-bold uppercase tracking-[3px]" style={{ color: CRIMSON }}>Tienda de Empeños</p>
          <h1 className="text-[18px] md:text-[24px] font-black truncate">{business?.name || 'Tienda'}</h1>
          {business?.phone && <p className="text-[11px] md:text-[12px] text-white/50 mt-0.5">{business.phone}</p>}
        </div>
      </div>
    </header>
  )
}

// ── List view ───────────────────────────────────────────────────────────────
export function TiendaEmpenosList() {
  const { businessId } = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [business, setBusiness] = useState(null)
  const [items, setItems] = useState([])

  useEffect(() => { (async () => {
    setLoading(true); setError(null)
    try {
      const sb = await getAnonClient()
      if (!sb) throw new Error('Supabase no configurado')

      const [{ data: biz }, { data: listings }] = await Promise.all([
        sb.from('businesses').select('id,name,logo_url,phone,email').eq('id', businessId).maybeSingle(),
        sb.from('pawn_listings')
          .select('id, supabase_id, list_price, slug, status, published_at, pawn_supabase_id, notes')
          .eq('business_id', businessId)
          .eq('status', 'published')
          .order('published_at', { ascending: false }),
      ])
      setBusiness(biz || null)

      const sids = (listings || []).map(l => l.pawn_supabase_id).filter(Boolean)
      let pawnMap = {}, photoMap = {}
      if (sids.length) {
        const [{ data: pawns }, { data: docs }] = await Promise.all([
          sb.from('pawn_items')
            .select('id, supabase_id, description, ticket_code, estimated_value')
            .eq('business_id', businessId)
            .in('supabase_id', sids),
          sb.from('pawn_documents')
            .select('pawn_supabase_id, file_url, doc_type, created_at')
            .eq('business_id', businessId)
            .eq('doc_type', 'foto')
            .in('pawn_supabase_id', sids)
            .order('created_at', { ascending: true }),
        ])
        pawnMap = Object.fromEntries((pawns || []).map(p => [p.supabase_id, p]))
        for (const d of docs || []) {
          if (!photoMap[d.pawn_supabase_id]) photoMap[d.pawn_supabase_id] = []
          photoMap[d.pawn_supabase_id].push(d.file_url)
        }
      }

      const enriched = (listings || []).map(l => ({
        ...l,
        pawn: pawnMap[l.pawn_supabase_id] || null,
        photos: photoMap[l.pawn_supabase_id] || [],
      })).filter(l => l.pawn) // hide listings whose pawn record was removed

      setItems(enriched)

      const t = `Tienda de Empeños — ${biz?.name || 'Studio X'}`
      const d = `${enriched.length} artículos disponibles. Visite la tienda y consulte por WhatsApp.`
      setSEO(t, d)
    } catch (e) {
      setError(e?.message || 'Error cargando tienda')
    } finally { setLoading(false) }
  })() }, [businessId])

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-slate-200 rounded-full animate-spin" style={{ borderTopColor: CRIMSON }} />
      </div>
    )
  }

  if (error || !business) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-2xl font-black text-slate-800 mb-2">Tienda no disponible</p>
          <p className="text-sm text-slate-500">{error || 'Verifique el enlace e intente de nuevo.'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <StoreHeader business={business} />

      <main className="max-w-6xl mx-auto px-4 py-6 md:px-8 md:py-10">
        {items.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl px-6 py-16 text-center">
            <p className="text-[16px] font-bold text-slate-700 mb-1">No hay artículos publicados</p>
            <p className="text-[13px] text-slate-500">Vuelva pronto — actualizamos el inventario constantemente.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
            {items.map(it => (
              <Link
                key={it.id}
                to={`/tienda-empenos/${businessId}/${it.slug || it.supabase_id}`}
                className="group bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-xl transition-all hover:-translate-y-0.5"
              >
                <div className="aspect-[4/3] bg-slate-100 overflow-hidden">
                  {it.photos[0] ? (
                    <img src={it.photos[0]} alt={it.pawn.description || ''} loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-300 text-sm">Sin foto</div>
                  )}
                </div>
                <div className="px-4 py-3">
                  <p className="text-[13px] font-bold text-slate-800 truncate group-hover:text-[#b3001e]">{it.pawn.description || 'Artículo'}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[18px] font-black tabular-nums" style={{ color: CRIMSON }}>{fmtRD(it.list_price)}</span>
                    <span className="text-[11px] font-semibold text-slate-500 group-hover:text-[#b3001e]">Ver detalles →</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>

      <footer className="max-w-6xl mx-auto px-4 py-6 text-center text-[11px] text-slate-400">
        Powered by Terminal X
      </footer>
    </div>
  )
}

// ── Detail view ─────────────────────────────────────────────────────────────
export function TiendaEmpenosDetail() {
  const { businessId, slug } = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [business, setBusiness] = useState(null)
  const [listing, setListing] = useState(null)
  const [pawn, setPawn] = useState(null)
  const [photos, setPhotos] = useState([])
  const [activePhoto, setActivePhoto] = useState(0)

  useEffect(() => { (async () => {
    setLoading(true); setError(null)
    try {
      const sb = await getAnonClient()
      if (!sb) throw new Error('Supabase no configurado')

      const { data: biz } = await sb.from('businesses').select('id,name,logo_url,phone,email').eq('id', businessId).maybeSingle()
      setBusiness(biz || null)

      // Try slug first, fall back to supabase_id (so direct UUID links also work)
      let { data: lst } = await sb.from('pawn_listings')
        .select('id, supabase_id, list_price, slug, status, published_at, pawn_supabase_id, notes')
        .eq('business_id', businessId)
        .eq('status', 'published')
        .eq('slug', slug)
        .maybeSingle()
      if (!lst) {
        const r = await sb.from('pawn_listings')
          .select('id, supabase_id, list_price, slug, status, published_at, pawn_supabase_id, notes')
          .eq('business_id', businessId)
          .eq('status', 'published')
          .eq('supabase_id', slug)
          .maybeSingle()
        lst = r.data
      }
      if (!lst) throw new Error('Artículo no encontrado o ya no está disponible')
      setListing(lst)

      const [{ data: pawnRow }, { data: docs }] = await Promise.all([
        sb.from('pawn_items')
          .select('id, supabase_id, description, ticket_code, estimated_value')
          .eq('business_id', businessId)
          .eq('supabase_id', lst.pawn_supabase_id)
          .maybeSingle(),
        sb.from('pawn_documents')
          .select('file_url, doc_type, created_at')
          .eq('business_id', businessId)
          .eq('pawn_supabase_id', lst.pawn_supabase_id)
          .eq('doc_type', 'foto')
          .order('created_at', { ascending: true }),
      ])
      setPawn(pawnRow || null)
      setPhotos((docs || []).map(d => d.file_url))

      const t = `${pawnRow?.description || 'Artículo'} — ${biz?.name || 'Tienda'}`
      const d = `${pawnRow?.description || 'Artículo'} disponible por ${fmtRD(lst.list_price)}. Consulte por WhatsApp.`
      setSEO(t, d)
    } catch (e) {
      setError(e?.message || 'Error')
    } finally { setLoading(false) }
  })() }, [businessId, slug])

  const waUrl = useMemo(() => {
    if (!business?.phone || !pawn) return null
    const msg = `Hola, me interesa el artículo "${pawn.description || 'sin descripción'}" (${fmtRD(listing?.list_price)})`
    return toWa(business.phone, msg)
  }, [business, pawn, listing])

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-slate-200 rounded-full animate-spin" style={{ borderTopColor: CRIMSON }} />
      </div>
    )
  }

  if (error || !pawn || !listing) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-2xl font-black text-slate-800 mb-2">Artículo no disponible</p>
          <p className="text-sm text-slate-500 mb-4">{error || 'Es posible que ya se haya vendido.'}</p>
          <Link to={`/tienda-empenos/${businessId}`} className="inline-block px-5 py-2 rounded-lg text-white text-sm font-bold" style={{ background: CRIMSON }}>
            Ver más artículos
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <StoreHeader business={business} />

      <main className="max-w-5xl mx-auto px-4 py-5 md:px-8 md:py-8">
        <Link to={`/tienda-empenos/${businessId}`} className="inline-flex items-center gap-1 text-[12px] font-semibold text-slate-500 hover:text-[#b3001e] mb-4">
          ← Todos los artículos
        </Link>

        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden md:grid md:grid-cols-2">
          {/* Photo carousel */}
          <div className="bg-slate-100">
            <div className="aspect-square md:aspect-auto md:h-full">
              {photos[activePhoto] ? (
                <img src={photos[activePhoto]} alt={pawn.description || ''}
                  className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-300 text-sm">Sin foto disponible</div>
              )}
            </div>
            {photos.length > 1 && (
              <div className="flex gap-2 px-3 py-3 overflow-x-auto bg-white border-t border-slate-200">
                {photos.map((p, i) => (
                  <button key={i} onClick={() => setActivePhoto(i)}
                    className={`shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition ${
                      i === activePhoto ? 'border-[#b3001e]' : 'border-transparent opacity-70 hover:opacity-100'
                    }`}>
                    <img src={p} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Body */}
          <div className="px-5 py-6 md:px-8 md:py-8 flex flex-col">
            <p className="text-[10px] font-bold uppercase tracking-[3px]" style={{ color: CRIMSON }}>Disponible</p>
            <h1 className="text-[22px] md:text-[26px] font-black text-slate-800 mt-1 leading-tight">{pawn.description || 'Artículo'}</h1>
            <p className="text-[36px] md:text-[40px] font-black mt-4 tabular-nums" style={{ color: CRIMSON }}>{fmtRD(listing.list_price)}</p>

            <div className="mt-6 space-y-3 text-[13px] text-slate-600">
              {listing.notes && <p className="leading-relaxed">{listing.notes}</p>}
              <p className="text-[11px] text-slate-400">Ref: {pawn.ticket_code || pawn.supabase_id?.slice(0, 8)}</p>
            </div>

            <div className="mt-auto pt-6">
              {waUrl ? (
                <a href={waUrl} target="_blank" rel="noopener noreferrer"
                  className="block w-full text-center px-5 py-3.5 rounded-xl text-white text-[14px] font-bold transition-colors"
                  style={{ background: '#25D366' }}>
                  Consultar por WhatsApp
                </a>
              ) : (
                <div className="text-center px-5 py-3.5 rounded-xl bg-slate-100 text-slate-400 text-[13px] font-semibold">
                  Visite la tienda para consultar
                </div>
              )}
              {business?.phone && <p className="text-center text-[11px] text-slate-400 mt-2">{business.phone}</p>}
            </div>
          </div>
        </div>
      </main>

      <footer className="max-w-6xl mx-auto px-4 py-6 text-center text-[11px] text-slate-400">
        Powered by Terminal X
      </footer>
    </div>
  )
}

// Default export is the list view (used by route /tienda-empenos/:businessId)
export default TiendaEmpenosList
