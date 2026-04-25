import { useEffect, useState } from 'react'

// DeadlineCountdown — large crimson days-remaining widget.
// Self-contained, zero deps. Recomputes on mount + every minute so the count
// stays accurate without React's clock drifting on long-lived tabs.
//
// Default deadline: Ley 32-23 mandatory date for all DR taxpayers
// (May 15, 2026 in Santo Domingo time, UTC−4).
//
// Props:
//   - targetDate: ISO string. Default '2026-05-15T00:00:00-04:00'.
//   - lang: 'es' | 'en'. Default 'es'.

const COPY = {
  es: {
    label: 'DÍAS RESTANTES',
    sub: 'para Ley 32-23 obligatoria · 15 mayo 2026',
    today: 'OBLIGATORIO HOY',
    overdue: (d) => `VENCIDO HACE ${d} DÍA${d === 1 ? '' : 'S'}`,
  },
  en: {
    label: 'DAYS LEFT',
    sub: 'until Law 32-23 is mandatory · May 15, 2026',
    today: 'MANDATORY TODAY',
    overdue: (d) => `${d} DAY${d === 1 ? '' : 'S'} OVERDUE`,
  },
}

function computeDays(targetIso) {
  const target = new Date(targetIso).getTime()
  if (!Number.isFinite(target)) return 0
  const diff = target - Date.now()
  return Math.ceil(diff / 86400000)
}

export default function DeadlineCountdown({
  targetDate = '2026-05-15T00:00:00-04:00',
  lang = 'es',
}) {
  const t = COPY[lang] || COPY.es
  const [days, setDays] = useState(() => computeDays(targetDate))

  useEffect(() => {
    setDays(computeDays(targetDate))
    const id = setInterval(() => setDays(computeDays(targetDate)), 60_000)
    return () => clearInterval(id)
  }, [targetDate])

  const isToday = days === 0
  const isOverdue = days < 0
  const display = isOverdue ? Math.abs(days) : days

  return (
    <div className="inline-flex flex-col items-center text-center">
      {isToday ? (
        <>
          <div className="text-5xl sm:text-6xl md:text-7xl font-black tracking-tight text-[#b3001e] tabular-nums leading-none">
            {t.today}
          </div>
          <p className="mt-3 text-xs sm:text-sm font-semibold text-white/70">{t.sub}</p>
        </>
      ) : isOverdue ? (
        <>
          <div className="text-5xl sm:text-6xl md:text-7xl font-black tracking-tight text-[#b3001e] tabular-nums leading-none">
            {t.overdue(display)}
          </div>
          <p className="mt-3 text-xs sm:text-sm font-semibold text-white/70">{t.sub}</p>
        </>
      ) : (
        <>
          <div className="text-7xl sm:text-8xl md:text-9xl font-black tracking-tighter text-[#b3001e] tabular-nums leading-none">
            {display}
          </div>
          <p className="mt-3 text-[11px] sm:text-xs font-extrabold tracking-[3px] uppercase text-white">
            {t.label}
          </p>
          <p className="mt-2 text-xs sm:text-sm font-medium text-white/60">{t.sub}</p>
        </>
      )}
    </div>
  )
}
