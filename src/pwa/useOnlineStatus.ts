import { signal } from '@preact/signals'
import type { Signal } from '@preact/signals'

const online = signal<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true)

window.addEventListener('online', () => { online.value = true })
window.addEventListener('offline', () => { online.value = false })

export function useOnlineStatus(): Signal<boolean> {
  return online
}
