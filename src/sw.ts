/// <reference lib="webworker" />
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope

interface NotificationAction {
  action: string
  title: string
  icon?: string
}

interface PushPayload {
  title?: string
  body?: string
  tag?: string
  url?: string
  icon?: string
  badge?: string
  renotify?: boolean
  requireInteraction?: boolean
  sessionId?: string
  connectionId?: string
  baseUrl?: string
  token?: string
  actions?: NotificationAction[]
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
  const options: NotificationOptions & { renotify?: boolean; actions?: NotificationAction[] } = {
    body: payload.body ?? '',
    tag: payload.tag,
    icon: payload.icon ?? DEFAULT_ICON,
    badge: payload.badge ?? DEFAULT_BADGE,
    data: {
      url: payload.url ?? '/',
      sessionId: payload.sessionId,
      connectionId: payload.connectionId,
      baseUrl: payload.baseUrl,
      token: payload.token,
    },
    renotify: payload.tag ? (payload.renotify ?? true) : undefined,
    requireInteraction: payload.requireInteraction ?? false,
    actions: payload.actions ?? [],
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

interface NotificationData {
  url?: string
  sessionId?: string
  connectionId?: string
  baseUrl?: string
  token?: string
}

async function sendMessageToApi(
  baseUrl: string,
  token: string,
  text: string,
  sessionId?: string,
): Promise<void> {
  const endpoint = `${baseUrl}/api/messages`
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text, sessionId }),
    })
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`)
    }
  } catch (error) {
    console.error('[SW] Failed to send message to API:', error)
    throw error
  }
}

self.addEventListener('notificationclick', (event) => {
  const data = (event.notification.data ?? {}) as NotificationData
  const action = event.action

  if (action && data.baseUrl && data.token) {
    event.notification.close()
    const actionHandlers: Record<string, () => Promise<void>> = {
      reply: async () => {
        await sendMessageToApi(data.baseUrl!, data.token!, 'Continue', data.sessionId)
      },
      approve: async () => {
        await sendMessageToApi(data.baseUrl!, data.token!, 'Approved', data.sessionId)
      },
      retry: async () => {
        await sendMessageToApi(data.baseUrl!, data.token!, '/retry', data.sessionId)
      },
      dismiss: async () => {},
    }

    const handler = actionHandlers[action]
    if (handler) {
      event.waitUntil(handler())
      return
    }
  }

  event.notification.close()
  const target = data.url ?? '/'
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
