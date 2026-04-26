import webpush from 'web-push'
import { ensureVapidKeys } from './vapid-keys'
import { list, removeById } from './subscriptions'

interface NotifyPayload {
  title: string
  body: string
  url: string
  tag?: string
  urgency?: 'very-low' | 'low' | 'normal' | 'high'
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
      {
        urgency: payload.urgency ?? 'normal',
      },
    )
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode
    if (status === 404 || status === 410) {
      removeById(sub.id)
    }
  }
}

export async function sendTestNotification(origin: string): Promise<void> {
  const keys = ensureVapidKeys()
  webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey)

  const payload: NotifyPayload = {
    title: 'Test notification',
    body: 'Push notifications are working correctly.',
    url: `${origin}/`,
    tag: 'test',
    urgency: 'normal',
  }

  const subs = list()
  if (subs.length === 0) {
    throw new Error('No push subscriptions found')
  }

  await Promise.all(subs.map((sub) => sendToOne(sub, payload)))
}
