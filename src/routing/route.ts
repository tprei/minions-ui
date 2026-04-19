import { signal } from '@preact/signals'

export type Route =
  | { name: 'home' }
  | { name: 'session'; sessionId: string }
  | { name: 'variants'; groupId: string }

function parseHash(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  const parts = raw.split('/').filter(Boolean)

  if (parts[0] === 'session' && parts[1]) {
    return { name: 'session', sessionId: parts[1] }
  }
  if (parts[0] === 'variants' && parts[1]) {
    return { name: 'variants', groupId: parts[1] }
  }
  return { name: 'home' }
}

export const route = signal<Route>(parseHash(window.location.hash))

function onHashChange() {
  route.value = parseHash(window.location.hash)
}

window.addEventListener('hashchange', onHashChange)

export function navigate(to: Route): void {
  let hash: string
  switch (to.name) {
    case 'session':
      hash = `#session/${to.sessionId}`
      break
    case 'variants':
      hash = `#variants/${to.groupId}`
      break
    default:
      hash = '#'
  }
  window.location.hash = hash
}
