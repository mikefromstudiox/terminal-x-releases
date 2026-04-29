import { useEffect, useState, useCallback } from 'react'
import { useAPI } from '../context/DataContext'

const POLL_MS = 60_000

function deriveLive(dateStr) {
  if (!dateStr) return false
  const today = new Date(); today.setHours(0,0,0,0)
  const d = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(d.getTime())) return false
  return d.getTime() <= today.getTime()
}

export function useGoLive() {
  const api = useAPI()
  const [state, setState] = useState({
    isLive: true, goLiveDate: '', committedAt: '', testTicketCount: 0, ready: false,
  })

  const refresh = useCallback(async () => {
    try {
      // Desktop (Electron) path is authoritative when available.
      if (typeof window !== 'undefined' && window?.electronAPI?.app?.isLive) {
        const [isLive, count, settings] = await Promise.all([
          window.electronAPI.app.isLive(),
          window.electronAPI.app.testDataCount?.() ?? Promise.resolve(null),
          window.electronAPI.settings?.get?.() ?? Promise.resolve({}),
        ])
        setState({
          isLive: !!isLive,
          goLiveDate: settings?.go_live_date || '',
          committedAt: settings?.go_live_committed_at || '',
          testTicketCount: count?.tickets || 0,
          ready: true,
        })
        return
      }
      // Web fallback — read settings via the platform API (api.settings.get()).
      let cfg = {}
      try { cfg = (await api?.settings?.get?.()) || {} } catch {}
      const dateStr = cfg.go_live_date || ''
      setState({
        isLive: deriveLive(dateStr),
        goLiveDate: dateStr,
        committedAt: cfg.go_live_committed_at || '',
        testTicketCount: 0,
        ready: true,
      })
    } catch {
      setState(s => ({ ...s, ready: true }))
    }
  }, [api])

  useEffect(() => {
    let alive = true
    refresh()
    const id = setInterval(() => { if (alive) refresh() }, POLL_MS)
    const onFocus = () => { if (alive) refresh() }
    window.addEventListener('focus', onFocus)
    window.addEventListener('tx:settings-changed', onFocus)
    return () => {
      alive = false
      clearInterval(id)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('tx:settings-changed', onFocus)
    }
  }, [refresh])

  return { ...state, refresh }
}
