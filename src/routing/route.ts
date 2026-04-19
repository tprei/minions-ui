import { signal } from '@preact/signals'
import type { ReadonlySignal } from '@preact/signals'

export type Route =
  | { name: 'home' }
  | { name: 'session'; sessionSlug: string }
  | { name: 'group'; groupId: string }

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#?\/*/, '')
  if (!raw) return { name: 'home' }
  const segments = raw.split('/').filter(Boolean)
  if (segments.length === 2 && segments[0] === 's') {
    return { name: 'session', sessionSlug: decodeURIComponent(segments[1]) }
  }
  if (segments.length === 2 && segments[0] === 'g') {
    return { name: 'group', groupId: decodeURIComponent(segments[1]) }
  }
  return { name: 'home' }
}

export function formatRoute(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/'
    case 'session':
      return `#/s/${encodeURIComponent(route.sessionSlug)}`
    case 'group':
      return `#/g/${encodeURIComponent(route.groupId)}`
  }
}

export interface Router {
  route: ReadonlySignal<Route>
  navigate(route: Route): void
  dispose(): void
}

export function createRouter(win: Window = window): Router {
  const route = signal<Route>(parseHash(win.location.hash))

  const onHashChange = () => {
    route.value = parseHash(win.location.hash)
  }
  win.addEventListener('hashchange', onHashChange)

  return {
    route,
    navigate(next: Route) {
      const hash = formatRoute(next)
      if (win.location.hash === hash) {
        route.value = next
        return
      }
      win.location.hash = hash
    },
    dispose() {
      win.removeEventListener('hashchange', onHashChange)
    },
  }
}
