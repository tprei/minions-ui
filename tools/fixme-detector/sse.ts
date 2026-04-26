import { EventSource } from 'eventsource'
import type { SseEvent } from '../../shared/api-types'

export type SseStatus = 'connecting' | 'live' | 'retrying' | 'closed'

export interface SseHandlers {
  onEvent: (event: SseEvent) => void
  onStatusChange?: (status: SseStatus) => void
  onReconnect?: (event: { quiet: boolean }) => void
}

export interface EventStreamHandle {
  close(): void
  reconnect(): void
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
  let status: SseStatus = 'connecting'
  let es: EventSource | null = null
  let attempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false
  let lastActivityAt = 0
  let quietReconnectsSinceActivity = 0

  function setStatus(s: SseStatus) {
    status = s
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
    if (status !== 'live') setStatus('live')
    scheduleWatchdog()
  }

  function shouldReconnectQuietly(): boolean {
    return (
      status === 'live'
      && lastActivityAt > 0
      && Date.now() - lastActivityAt <= RECENT_ACTIVITY_RECONNECT_MS
      && quietReconnectsSinceActivity === 0
    )
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
    } else {
      setStatus('retrying')
      attempt++
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect(quiet)
    }, delay)
  }

  function connect(quiet = false) {
    if (closed) return
    if (!quiet || status !== 'live') setStatus('connecting')
    es = new EventSource(buildUrl())

    es.onopen = () => {
      attempt = 0
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

    es.onmessage = (e) => {
      markActivity()
      try {
        const event = JSON.parse(e.data as string) as SseEvent
        handlers.onEvent(event)
      } catch {
        console.warn('[sse] failed to parse message', e.data)
      }
    }

    es.addEventListener('keepalive', () => markActivity())
  }

  connect()

  return {
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
      es?.close()
      es = null
      setStatus('closed')
    },
  }
}
