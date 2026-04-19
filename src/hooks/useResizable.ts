import { useEffect, useRef, useState } from 'preact/hooks'

interface UseResizableOptions {
  storageKey: string
  defaultWidth: number
  min: number
  max: number
}

// Persisted draggable-width hook. Returns the current width + a mouse/touch
// event handler the caller wires onto a <ResizeHandle>. Width is clamped to
// [min, max] and written to localStorage under `storageKey`.
export function useResizable({ storageKey, defaultWidth, min, max }: UseResizableOptions) {
  const [width, setWidth] = useState<number>(() => {
    if (typeof localStorage === 'undefined') return defaultWidth
    const raw = localStorage.getItem(storageKey)
    const n = raw ? Number(raw) : NaN
    if (!Number.isFinite(n)) return defaultWidth
    return Math.min(max, Math.max(min, n))
  })
  const dragging = useRef(false)
  const startX = useRef(0)
  const startW = useRef(0)

  useEffect(() => {
    function onMove(e: MouseEvent | TouchEvent) {
      if (!dragging.current) return
      const clientX = 'touches' in e ? e.touches[0]?.clientX ?? 0 : e.clientX
      const delta = clientX - startX.current
      const next = Math.min(max, Math.max(min, startW.current + delta))
      setWidth(next)
    }
    function onEnd() {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      try {
        localStorage.setItem(storageKey, String(widthRef.current))
      } catch {
        // ignore quota errors
      }
    }
    const widthRef = { current: width }
    const syncRef = () => { widthRef.current = width }
    syncRef()
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onEnd)
    window.addEventListener('touchmove', onMove)
    window.addEventListener('touchend', onEnd)
    window.addEventListener('touchcancel', onEnd)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onEnd)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
    }
  }, [width, min, max, storageKey])

  function onHandleDown(e: MouseEvent | TouchEvent) {
    dragging.current = true
    startX.current = 'touches' in e ? e.touches[0]?.clientX ?? 0 : (e as MouseEvent).clientX
    startW.current = width
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    e.preventDefault()
  }

  function reset() {
    setWidth(defaultWidth)
    try {
      localStorage.removeItem(storageKey)
    } catch {
      // ignore
    }
  }

  return { width, onHandleDown, reset }
}
