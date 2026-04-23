// Shared drawer-kick auto-detect loop. Cycles through every ESC/POS drawer-kick
// variant with a 1.6s pause so a human can spot which one pops the till.
//
// Usage:
//   const ctl = runDrawerAutoDetect({ printerApi, printer, onProgress, onExhausted })
//   // when user confirms "Se abrio": ctl.getCurrent() returns { idx, hex }
//   ctl.cancel()
//
// onProgress({ idx, total, hex }) fires each time a new variant is fired.
// onExhausted() fires if all variants cycled without confirmation.

export function runDrawerAutoDetect({ printerApi, printer, onProgress, onExhausted }) {
  const state = { cancelled: false, timer: null, currentIdx: null, currentHex: null }
  let total = 8

  ;(async () => {
    for (let i = 0; i < total; i++) {
      if (state.cancelled) return
      try {
        const r = await printerApi?.fireDrawerVariant?.(i, printer || undefined)
        if (r?.total) total = r.total
        state.currentIdx = i
        state.currentHex = r?.hex || null
        onProgress?.({ idx: i, total, hex: r?.hex || null })
      } catch {}
      await new Promise(res => { state.timer = setTimeout(res, 1600) })
    }
    if (!state.cancelled) {
      state.currentIdx = null
      state.currentHex = null
      onExhausted?.()
    }
  })()

  return {
    cancel() {
      state.cancelled = true
      if (state.timer) clearTimeout(state.timer)
      state.currentIdx = null
      state.currentHex = null
    },
    getCurrent() {
      return { idx: state.currentIdx, hex: state.currentHex }
    },
  }
}
