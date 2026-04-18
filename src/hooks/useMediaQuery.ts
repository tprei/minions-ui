import { signal } from '@preact/signals'
import type { Signal } from '@preact/signals'

export function useMediaQuery(query: string): Signal<boolean> {
  const mq = window.matchMedia(query)
  const result = signal(mq.matches)
  mq.addEventListener('change', (e) => {
    result.value = e.matches
  })
  return result
}
