/// <reference lib="webworker" />
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope

interface PushPayload {
  title?: string
  body?: string
  tag?: string
  url?: string
  icon?: string
  badge?: string
  renotify?: boolean
}

const DEFAULT_TITLE = 'Minion update'
const DEFAULT_ICON = '/icons/icon-192.png'
const DEFAULT_BADGE = '/icons/icon-192.png'

function parsePushPayload(event: PushEvent): PushPayload {
  if (!event.data) return {}
  try {
    const json = event.data.json() as unknown
    if (json && typeof json === 'object') return json as PushPayload
    return {}
  } catch {
    const text = event.data.text()
    return text ? { body: text } : {}
  }
}

precacheAndRoute(self.__WB_MANIFEST)

registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//],
  }),
)

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('push', (event) => {
  const payload = parsePushPayload(event)
  const title = payload.title?.trim() || DEFAULT_TITLE
  const options: NotificationOptions & { renotify?: boolean } = {
    body: payload.body ?? '',
    tag: payload.tag,
    icon: payload.icon ?? DEFAULT_ICON,
    badge: payload.badge ?? DEFAULT_BADGE,
    data: { url: payload.url ?? '/' },
    renotify: payload.tag ? (payload.renotify ?? true) : undefined,
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data as { url?: string } | undefined)?.url ?? '/'
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(async (windows) => {
        const targetUrl = new URL(target, self.location.origin).href
        for (const w of windows) {
          if (w.url === targetUrl && 'focus' in w) {
            return w.focus()
          }
        }
        for (const w of windows) {
          if ('navigate' in w && 'focus' in w) {
            try {
              await w.navigate(targetUrl)
              return w.focus()
            } catch {
              // fall through to opening a fresh window
            }
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl)
        }
        return null
      }),
  )
})
