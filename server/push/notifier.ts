import webpush from 'web-push'
import type { EngineEventBus } from '../events/bus'
import { ensureVapidKeys } from './vapid-keys'
import { list, removeById } from './subscriptions'

interface NotifyPayload {
  title: string
  body: string
  url: string
}

async function sendToOne(
  sub: { id: string; endpoint: string; expirationTime: number | null; keys: { p256dh: string; auth: string } },
  payload: NotifyPayload,
): Promise<void> {
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        expirationTime: sub.expirationTime ?? undefined,
        keys: sub.keys,
      },
      JSON.stringify(payload),
    )
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode
    if (status === 404 || status === 410) {
      removeById(sub.id)
    }
  }
}

export function startPushNotifier(bus: EngineEventBus, pwaOrigin?: string): () => void {
  const keys = ensureVapidKeys()
  webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey)

  const origin = pwaOrigin ?? process.env['PWA_ORIGIN'] ?? ''

  return bus.onKind('session.snapshot', (event) => {
    if (!event.session.needsAttention) return
    const reasons = event.session.attentionReasons
    if (reasons.length === 0) return

    const reason = reasons[0] ?? 'needs attention'
    const payload: NotifyPayload = {
      title: 'Minion needs attention',
      body: String(reason).replace(/_/g, ' '),
      url: `${origin}/sessions/${event.session.slug}`,
    }

    const subs = list()
    for (const sub of subs) {
      void sendToOne(sub, payload)
    }
  })
}
