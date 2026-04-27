import { useSignal } from '@preact/signals'
import {
  disableLocalNotifications,
  enableLocalNotifications,
  getLocalNotificationsPermission,
  isLocalNotificationsSupported,
  localNotificationsEnabled,
} from './local-notifications'

interface NotificationsToggleProps {
  variant?: 'header' | 'menu'
}

export function NotificationsToggle({ variant = 'header' }: NotificationsToggleProps) {
  if (!isLocalNotificationsSupported()) return null

  const enabled = localNotificationsEnabled()
  const busy = useSignal(false)

  const handleToggle = async () => {
    if (busy.value) return
    busy.value = true
    try {
      if (enabled.value) {
        disableLocalNotifications()
      } else {
        await enableLocalNotifications()
      }
    } finally {
      busy.value = false
    }
  }

  const permission = getLocalNotificationsPermission()
  const denied = permission === 'denied'

  if (variant === 'menu') {
    return (
      <button
        type="button"
        onClick={() => void handleToggle()}
        disabled={busy.value || (denied && !enabled.value)}
        class="w-full flex items-center gap-3 px-3 py-2 text-sm text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
        data-testid="menu-notifications-toggle"
      >
        <span aria-hidden="true">{enabled.value ? '🔔' : '🔕'}</span>
        <span>{denied && !enabled.value ? 'Notifications blocked' : enabled.value ? 'Notifications on' : 'Enable notifications'}</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => void handleToggle()}
      disabled={busy.value || (denied && !enabled.value)}
      class="rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 min-h-[44px] min-w-[44px] flex items-center justify-center text-xs hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
      title={
        denied && !enabled.value
          ? 'Browser permission blocked — re-enable in browser settings'
          : enabled.value
            ? 'Notifications on (click to disable)'
            : 'Enable browser notifications for session updates'
      }
      aria-label={enabled.value ? 'Disable notifications' : 'Enable notifications'}
      aria-pressed={enabled.value}
      data-testid="header-notifications-toggle"
    >
      <span aria-hidden="true">{enabled.value ? '🔔' : '🔕'}</span>
    </button>
  )
}
