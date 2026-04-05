import { createContext, useContext, useState, useEffect } from 'react'
import { useAPI } from '../context/DataContext'
import { es } from './es'
import { en } from './en'

const translations = { es, en }

const LangContext = createContext(null)

export function LangProvider({ children }) {
  const api = useAPI()
  const [lang, setLangState] = useState('es')

  // Load persisted language on mount
  useEffect(() => {
    if (!api?.settings?.get) return
    api.settings.get().then(s => {
      if (s?.app_lang === 'en') setLangState('en')
    }).catch(() => {})
  }, [])

  // setLang applies immediately and persists to DB
  function setLang(l) {
    setLangState(l)
    api?.settings?.update?.({ app_lang: l })?.catch?.(() => {})
  }

  function t(key) {
    return translations[lang][key] ?? key
  }

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LangContext.Provider>
  )
}

export function useLang() {
  const ctx = useContext(LangContext)
  if (!ctx) throw new Error('useLang must be used within LangProvider')
  return ctx
}
