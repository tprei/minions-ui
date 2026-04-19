import { signal } from '@preact/signals'
import type { ReadonlySignal } from '@preact/signals'
import { parseHash } from './route'
import type { Route } from './route'

const internal = signal<Route>(
  typeof window !== 'undefined' ? parseHash(window.location.hash) : { name: 'home' }
)

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    internal.value = parseHash(window.location.hash)
  })
}

export const currentRoute: ReadonlySignal<Route> = internal
