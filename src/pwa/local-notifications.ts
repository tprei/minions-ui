import { signal, type ReadonlySignal } from '@preact/signals'

const ENABLED_KEY = 'minions-ui:local-notifications-enabled:v1'

export type LocalNotificationPermission = NotificationPermission | 'unsupported'

const enabledSignal = signal<boolean>(loadEnabled())

function loadEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1'
  } catch {
    return false
  }
}

function saveEnabled(value: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, value ? '1' : '0')
  } catch {
    // ignore
  }
}

export function isLocalNotificationsSupported(): boolean {
  return typeof Notification !== 'undefined'
}

export function getLocalNotificationsPermission(): LocalNotificationPermission {
  if (!isLocalNotificationsSupported()) return 'unsupported'
  return Notification.permission
}

export function localNotificationsEnabled(): ReadonlySignal<boolean> {
  return enabledSignal
}

export function isLocalNotificationsEnabled(): boolean {
  return enabledSignal.value
}

export async function requestLocalNotificationsPermission(): Promise<LocalNotificationPermission> {
  if (!isLocalNotificationsSupported()) return 'unsupported'
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission
  }
  return Notification.requestPermission()
}

export async function enableLocalNotifications(): Promise<{
  ok: boolean
  permission: LocalNotificationPermission
}> {
  const permission = await requestLocalNotificationsPermission()
  const ok = permission === 'granted'
  if (ok) {
    enabledSignal.value = true
    saveEnabled(true)
  }
  return { ok, permission }
}

export function disableLocalNotifications(): void {
  enabledSignal.value = false
  saveEnabled(false)
}

export interface LocalNotificationOptions {
  title: string
  body?: string
  tag?: string
  onClick?: () => void
}

export interface LocalNotificationContext {
  documentVisible?: boolean
}

function isDocumentHidden(ctx?: LocalNotificationContext): boolean {
  if (ctx?.documentVisible !== undefined) return !ctx.documentVisible
  if (typeof document === 'undefined') return true
  return document.visibilityState !== 'visible'
}

export function showLocalNotification(
  opts: LocalNotificationOptions,
  ctx?: LocalNotificationContext,
): Notification | null {
  if (!isLocalNotificationsEnabled()) return null
  if (!isLocalNotificationsSupported()) return null
  if (Notification.permission !== 'granted') return null
  if (!isDocumentHidden(ctx)) return null

  try {
    const notification = new Notification(opts.title, {
      body: opts.body,
      tag: opts.tag,
      icon: '/minion.svg',
      badge: '/minion.svg',
    })
    if (opts.onClick) {
      notification.onclick = () => {
        try {
          window.focus()
        } catch {
          // ignore
        }
        opts.onClick?.()
        notification.close()
      }
    }
    return notification
  } catch {
    return null
  }
}

export function __resetLocalNotificationsForTests(): void {
  enabledSignal.value = false
  try {
    localStorage.removeItem(ENABLED_KEY)
  } catch {
    // ignore
  }
}
