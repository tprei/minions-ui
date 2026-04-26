import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import type { ApiClient } from '../api/client'
import {
  detectPushSupport,
  disablePush,
  enablePush,
  getCurrentSubscription,
  getNotificationPermission,
  isPushFlagEnabled,
  type PushSupport,
} from './push'

interface Props {
  client: ApiClient
  hasFeature: boolean
}

function reasonText(support: PushSupport): string {
  switch (support.kind) {
    case 'flag-disabled':
      return 'Push notifications are disabled in this build (set VITE_ENABLE_PUSH=1).'
    case 'insecure-context':
      return 'Push notifications require HTTPS — open this app on a secure origin.'
    case 'no-service-worker':
      return 'This browser does not expose service workers.'
    case 'no-push-manager':
      return 'This browser does not support the Web Push API.'
    case 'no-notifications':
      return 'This browser does not support the Notifications API.'
    case 'supported':
      return ''
  }
}

export function EnableNotifications({ client, hasFeature }: Props) {
  if (!isPushFlagEnabled()) return null

  const support = useSignal<PushSupport>(detectPushSupport())
  const subscribed = useSignal<boolean>(false)
  const checking = useSignal<boolean>(true)
  const busy = useSignal<boolean>(false)
  const testing = useSignal<boolean>(false)
  const error = useSignal<string | null>(null)
  const status = useSignal<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getCurrentSubscription()
      .then((sub) => {
        if (cancelled) return
        subscribed.value = sub !== null
      })
      .catch(() => {
        if (cancelled) return
        subscribed.value = false
      })
      .finally(() => {
        if (!cancelled) checking.value = false
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!hasFeature) {
    return (
      <div
        class="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-3 text-xs text-slate-600 dark:text-slate-400"
        data-testid="push-feature-missing"
      >
        This minion does not advertise the <code>web-push</code> feature. Update the library on the server to enable notifications.
      </div>
    )
  }

  if (support.value.kind !== 'supported') {
    return (
      <div
        class="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-3 text-xs text-slate-600 dark:text-slate-400"
        data-testid="push-unsupported"
      >
        {reasonText(support.value)}
      </div>
    )
  }

  const permission = getNotificationPermission()
  const denied = permission === 'denied'

  const handleEnable = async () => {
    busy.value = true
    error.value = null
    status.value = null
    try {
      const result = await enablePush(client)
      if (result.ok) {
        subscribed.value = true
        status.value = 'Notifications enabled.'
      } else if (result.reason === 'permission-denied') {
        error.value = 'Notification permission was denied. Re-enable it in your browser settings.'
      } else if (result.reason === 'permission-default') {
        error.value = 'Notification permission was dismissed.'
      } else {
        error.value = result.error ? `Could not enable notifications: ${result.error}` : 'Could not enable notifications.'
      }
    } finally {
      busy.value = false
    }
  }

  const handleDisable = async () => {
    busy.value = true
    error.value = null
    status.value = null
    try {
      const result = await disablePush(client)
      if (result.ok) {
        subscribed.value = false
        status.value = 'Notifications disabled.'
      } else {
        error.value = `Could not disable notifications: ${result.error}`
      }
    } finally {
      busy.value = false
    }
  }

  const handleTest = async () => {
    testing.value = true
    error.value = null
    status.value = null
    try {
      await client.sendTestNotification()
      status.value = 'Test notification sent. Check your device.'
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to send test notification'
    } finally {
      testing.value = false
    }
  }

  return (
    <div class="flex flex-col gap-2" data-testid="push-controls">
      <div class="flex items-center gap-2 flex-wrap">
        {subscribed.value ? (
          <>
            <button
              type="button"
              onClick={() => void handleDisable()}
              disabled={busy.value || checking.value}
              data-testid="push-disable-btn"
              class="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
            >
              {busy.value ? 'Disabling…' : 'Disable notifications'}
            </button>
            <button
              type="button"
              onClick={() => void handleTest()}
              disabled={testing.value || checking.value}
              data-testid="push-test-btn"
              class="rounded-lg border border-indigo-300 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 disabled:opacity-50"
            >
              {testing.value ? 'Sending…' : 'Send test'}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void handleEnable()}
            disabled={busy.value || checking.value || denied}
            data-testid="push-enable-btn"
            class="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy.value ? 'Enabling…' : 'Enable notifications'}
          </button>
        )}
        <span class="text-xs text-slate-500 dark:text-slate-400" data-testid="push-permission">
          permission: {permission}
        </span>
      </div>
      {denied && !subscribed.value && (
        <p class="text-xs text-amber-700 dark:text-amber-300" data-testid="push-denied-hint">
          Browser permission is blocked. Re-enable it in your browser settings, then retry.
        </p>
      )}
      {error.value && (
        <p class="text-xs text-red-600 dark:text-red-400" data-testid="push-error">{error.value}</p>
      )}
      {status.value && (
        <p class="text-xs text-emerald-700 dark:text-emerald-400" data-testid="push-status">{status.value}</p>
      )}
    </div>
  )
}
