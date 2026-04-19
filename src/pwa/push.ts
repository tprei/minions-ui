import type { ApiClient } from '../api/client'
import type { PushSubscriptionJSON } from '../api/types'

export type PushSupport =
  | { kind: 'supported' }
  | { kind: 'flag-disabled' }
  | { kind: 'no-service-worker' }
  | { kind: 'no-push-manager' }
  | { kind: 'no-notifications' }
  | { kind: 'insecure-context' }

export type PushPermission = NotificationPermission | 'unsupported'

export type SubscribeResult =
  | { ok: true; subscription: PushSubscriptionJSON }
  | { ok: false; reason: 'permission-denied' | 'permission-default' | 'unsupported' | 'error'; error?: string }

export function isPushFlagEnabled(): boolean {
  const raw: unknown = import.meta.env?.VITE_ENABLE_PUSH
  if (raw === true) return true
  if (typeof raw === 'string') {
    const v = raw.toLowerCase()
    return v === '1' || v === 'true' || v === 'yes' || v === 'on'
  }
  return false
}

export function detectPushSupport(win: typeof globalThis = globalThis): PushSupport {
  if (!isPushFlagEnabled()) return { kind: 'flag-disabled' }
  const w = win as typeof globalThis & {
    isSecureContext?: boolean
    Notification?: typeof Notification
    PushManager?: typeof PushManager
    navigator?: Navigator
  }
  if (w.isSecureContext === false) return { kind: 'insecure-context' }
  if (!w.navigator || !('serviceWorker' in w.navigator)) return { kind: 'no-service-worker' }
  if (typeof w.PushManager === 'undefined') return { kind: 'no-push-manager' }
  if (typeof w.Notification === 'undefined') return { kind: 'no-notifications' }
  return { kind: 'supported' }
}

export function getNotificationPermission(): PushPermission {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const trimmed = base64.replace(/\s+/g, '')
  if (!trimmed) throw new Error('VAPID key is empty')
  const padding = '='.repeat((4 - (trimmed.length % 4)) % 4)
  const normalized = (trimmed + padding).replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/=]+$/.test(normalized)) {
    throw new Error('VAPID key is not valid base64url')
  }
  const raw = atob(normalized)
  const buffer = new ArrayBuffer(raw.length)
  const out = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function toPushSubscriptionJSON(sub: PushSubscription): PushSubscriptionJSON {
  const json = sub.toJSON() as {
    endpoint?: string
    expirationTime?: number | null
    keys?: { p256dh?: string; auth?: string }
  }
  if (!json.endpoint) throw new Error('Subscription is missing endpoint')
  if (!json.keys?.p256dh || !json.keys?.auth) {
    throw new Error('Subscription is missing p256dh/auth keys')
  }
  return {
    endpoint: json.endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  }
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  const reg = await navigator.serviceWorker.ready
  return reg ?? null
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  const reg = await getRegistration()
  if (!reg) return null
  return reg.pushManager.getSubscription()
}

export async function requestPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied'
  if (Notification.permission !== 'default') return Notification.permission
  return Notification.requestPermission()
}

export async function enablePush(client: ApiClient): Promise<SubscribeResult> {
  const support = detectPushSupport()
  if (support.kind !== 'supported') {
    return { ok: false, reason: 'unsupported', error: support.kind }
  }

  const permission = await requestPermission()
  if (permission === 'denied') return { ok: false, reason: 'permission-denied' }
  if (permission !== 'granted') return { ok: false, reason: 'permission-default' }

  const reg = await getRegistration()
  if (!reg) return { ok: false, reason: 'unsupported', error: 'no-registration' }

  try {
    const { key } = await client.getVapidKey()
    const applicationServerKey = urlBase64ToUint8Array(key)
    const existing = await reg.pushManager.getSubscription()
    if (existing) {
      try {
        await existing.unsubscribe()
      } catch {
        // ignore: a stale subscription may already be invalid; we'll re-subscribe below
      }
    }
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    })
    const json = toPushSubscriptionJSON(sub)
    await client.subscribePush(json)
    return { ok: true, subscription: json }
  } catch (e) {
    return { ok: false, reason: 'error', error: e instanceof Error ? e.message : String(e) }
  }
}

export async function disablePush(client: ApiClient): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const sub = await getCurrentSubscription()
    if (!sub) return { ok: true }
    const json = toPushSubscriptionJSON(sub)
    try {
      await client.unsubscribePush(json.endpoint)
    } catch {
      // ignore: the server may already have purged the subscription; still drop it client-side
    }
    await sub.unsubscribe()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
