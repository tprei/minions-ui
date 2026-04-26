import { signal } from '@preact/signals'
import type { Signal } from '@preact/signals'
import type { SseEvent } from './types'

export type SseStatus = 'connecting' | 'live' | 'retrying' | 'closed'

export interface SseHandlers {
  onEvent: (event: SseEvent) => void
  onStatusChange?: (status: SseStatus) => void
  onReconnect?: (event: { quiet: boolean }) => void
}

export interface EventStreamHandle {
  close(): void
  reconnect(): void
  status: Signal<SseStatus>
  reconnectAt: Signal<number | null>
}

const QUIET_RECONNECT_DELAY_MS = 1000
const RECENT_ACTIVITY_RECONNECT_MS = 5000

export function openEventStream(opts: {
  baseUrl: string
  token: string
  handlers: SseHandlers
  quietTimeoutMs?: number
}): EventStreamHandle {
  const { baseUrl, token, handlers, quietTimeoutMs = 70_000 } = opts
  const status = signal<SseStatus>('connecting')
  const reconnectAt = signal<number | null>(null)
  let es: EventSource | null = null
  let attempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false
  let lastActivityAt = 0
  let quietReconnectsSinceActivity = 0

  function setStatus(s: SseStatus) {
    status.value = s
    handlers.onStatusChange?.(s)
  }

  function buildUrl(): string {
    const base = `${baseUrl}/api/events`
    if (!token) return base
    return `${base}?token=${encodeURIComponent(token)}`
  }

  function clearWatchdog() {
    if (watchdogTimer === null) return
    clearTimeout(watchdogTimer)
    watchdogTimer = null
  }

  function scheduleWatchdog() {
    clearWatchdog()
    if (closed || quietTimeoutMs <= 0) return
    watchdogTimer = setTimeout(() => {
      if (closed) return
      es?.close()
      es = null
      scheduleReconnect(false)
    }, quietTimeoutMs)
  }

  function markActivity() {
    lastActivityAt = Date.now()
    quietReconnectsSinceActivity = 0
    attempt = 0
    reconnectAt.value = null
    if (status.value !== 'live') {
      setStatus('live')
    }
    scheduleWatchdog()
  }

  function shouldReconnectQuietly(): boolean {
    return status.value === 'live'
      && lastActivityAt > 0
      && Date.now() - lastActivityAt <= RECENT_ACTIVITY_RECONNECT_MS
      && quietReconnectsSinceActivity === 0
  }

  function scheduleReconnect(quiet: boolean) {
    if (closed) return
    if (reconnectTimer !== null) return
    clearWatchdog()
    const delay = quiet
      ? QUIET_RECONNECT_DELAY_MS
      : Math.floor(Math.random() * Math.min(30000, 500 * 2 ** attempt))
    if (quiet) {
      quietReconnectsSinceActivity++
      reconnectAt.value = null
    } else {
      setStatus('retrying')
      attempt++
      reconnectAt.value = Date.now() + delay
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect(quiet)
    }, delay)
  }

  function connect(quiet = false) {
    if (closed) return
    if (!quiet || status.value !== 'live') {
      setStatus('connecting')
    }
    reconnectAt.value = null
    es = new EventSource(buildUrl())

    es.onopen = () => {
      attempt = 0
      reconnectAt.value = null
      setStatus('live')
      scheduleWatchdog()
      handlers.onReconnect?.({ quiet })
    }

    es.onerror = () => {
      es?.close()
      es = null
      if (closed) return
      scheduleReconnect(shouldReconnectQuietly())
    }

    es.onmessage = (e: MessageEvent) => {
      markActivity()
      try {
        const event = JSON.parse(e.data as string) as SseEvent
        handlers.onEvent(event)
      } catch {
        console.warn('[sse] failed to parse message', e.data)
      }
    }

    es.addEventListener('keepalive', markActivity)
  }

  connect()

  return {
    status,
    reconnectAt,
    reconnect() {
      if (closed) return
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      clearWatchdog()
      es?.close()
      es = null
      attempt = 0
      lastActivityAt = 0
      quietReconnectsSinceActivity = 0
      reconnectAt.value = null
      connect()
    },
    close() {
      if (closed) return
      closed = true
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      clearWatchdog()
      reconnectAt.value = null
      es?.close()
      es = null
      setStatus('closed')
    },
  }
}
