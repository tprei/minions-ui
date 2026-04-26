import webpush from 'web-push'
import type { EngineEventBus } from '../events/bus'
import { ensureVapidKeys } from './vapid-keys'
import { list, removeById } from './subscriptions'

interface NotifyPayload {
  title: string
  body: string
  url: string
  tag?: string
  urgency?: 'very-low' | 'low' | 'normal' | 'high'
  data?: Record<string, unknown>
  actions?: Array<{
    action: string
    title: string
    icon?: string
  }>
}

function determineUrgency(reasons: string[]): 'high' | 'normal' {
  if (reasons.includes('failed') || reasons.includes('ci_fix')) return 'high'
  return 'normal'
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

function determineActions(reasons: string[]): Array<{ action: string; title: string; icon?: string }> {
  const actions: Array<{ action: string; title: string; icon?: string }> = []

  if (reasons.includes('waiting_for_feedback')) {
    actions.push({ action: 'approve', title: 'Approve' })
    actions.push({ action: 'reject', title: 'Reject' })
  } else if (reasons.includes('interrupted')) {
    actions.push({ action: 'continue', title: 'Continue' })
  }

  return actions.slice(0, 2)
}

export function startPushNotifier(bus: EngineEventBus, pwaOrigin?: string, apiBaseUrl?: string): () => void {
  const keys = ensureVapidKeys()
  webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey)

  const origin = pwaOrigin ?? process.env['PWA_ORIGIN'] ?? ''
  const apiBase = apiBaseUrl ?? process.env['API_BASE_URL'] ?? origin

  return bus.onKind('session.snapshot', (event) => {
    if (!event.session.needsAttention) return
    const reasons = event.session.attentionReasons
    if (reasons.length === 0) return

    const reason = reasons[0] ?? 'needs attention'
    const urgency = determineUrgency(reasons)
    const actions = determineActions(reasons)

    const payload: NotifyPayload = {
      title: 'Minion needs attention',
      body: String(reason).replace(/_/g, ' '),
      url: `${origin}/sessions/${event.session.slug}`,
      tag: `session-${event.session.id}`,
      urgency,
      actions,
      data: {
        sessionId: event.session.id,
        slug: event.session.slug,
        attentionReasons: reasons,
        baseUrl: apiBase,
        token: process.env['MINION_API_TOKEN'] ?? '',
      },
    }

    const subs = list()
    for (const sub of subs) {
      void sendToOne(sub, payload)
    }
  })
}
