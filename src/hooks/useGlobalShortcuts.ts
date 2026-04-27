import { useEffect, useRef } from 'preact/hooks'

export interface GlobalShortcutHandlers {
  onOpenPalette: () => void
  onOpenHelp: () => void
  onNewTask?: () => void
  onSwitchView?: (view: 'list' | 'canvas' | 'ship' | 'kanban') => void
  onRefresh?: () => void
}

export function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return false
}

export function useGlobalShortcuts(handlers: GlobalShortcutHandlers): void {
  const ref = useRef(handlers)
  ref.current = handlers

  useEffect(() => {
    let pendingChord: 'g' | null = null
    let chordTimer: ReturnType<typeof setTimeout> | null = null

    const clearChord = () => {
      pendingChord = null
      if (chordTimer) {
        clearTimeout(chordTimer)
        chordTimer = null
      }
    }

    const handler = (e: KeyboardEvent) => {
      const h = ref.current
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        clearChord()
        h.onOpenPalette()
        return
      }

      if (isTextInputTarget(e.target)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (pendingChord === 'g') {
        const next = e.key.toLowerCase()
        if (next === 'l' && h.onSwitchView) {
          e.preventDefault()
          h.onSwitchView('list')
        } else if (next === 'c' && h.onSwitchView) {
          e.preventDefault()
          h.onSwitchView('canvas')
        } else if (next === 's' && h.onSwitchView) {
          e.preventDefault()
          h.onSwitchView('ship')
        } else if (next === 'k' && h.onSwitchView) {
          e.preventDefault()
          h.onSwitchView('kanban')
        }
        clearChord()
        return
      }

      if (e.key === '?') {
        e.preventDefault()
        h.onOpenHelp()
        return
      }
      if (e.key === 'n' && h.onNewTask) {
        e.preventDefault()
        h.onNewTask()
        return
      }
      if (e.key === 'r' && h.onRefresh) {
        e.preventDefault()
        h.onRefresh()
        return
      }
      if (e.key === 'g') {
        e.preventDefault()
        pendingChord = 'g'
        chordTimer = setTimeout(clearChord, 1500)
        return
      }
    }

    document.addEventListener('keydown', handler)
    return () => {
      document.removeEventListener('keydown', handler)
      clearChord()
    }
  }, [])
}
