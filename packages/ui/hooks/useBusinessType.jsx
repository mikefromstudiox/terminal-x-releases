import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import { useAPI } from '../context/DataContext'

const BusinessTypeContext = createContext(null)

export function BusinessTypeProvider({ children }) {
  const api = useAPI()
  const [businessType, setType] = useState('carwash')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const settings = await api?.settings?.get?.()
        if (!cancelled && settings?.business_type) setType(settings.business_type)
      } catch {}
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [api])

  const setBusinessType = useCallback(async (type) => {
    setType(type)
    try { await api?.settings?.update?.({ business_type: type }) } catch {}
  }, [api])

  const isRetail = businessType === 'tienda'
  const isCarWash = businessType === 'carwash'

  return (
    <BusinessTypeContext.Provider value={{ businessType, isRetail, isCarWash, setBusinessType, loading }}>
      {children}
    </BusinessTypeContext.Provider>
  )
}

export function useBusinessType() {
  const ctx = useContext(BusinessTypeContext)
  if (!ctx) return { businessType: 'carwash', isRetail: false, isCarWash: true, setBusinessType: () => {}, loading: false }
  return ctx
}
