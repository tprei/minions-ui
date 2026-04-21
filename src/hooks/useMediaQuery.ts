import { useSignal } from '@preact/signals'
import type { Signal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

export function useMediaQuery(query: string): Signal<boolean> {
  const initial = typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  const result = useSignal(initial)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia(query)
    result.value = mq.matches
    const handler = (e: MediaQueryListEvent) => {
      result.value = e.matches
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [query])

  return result
}
