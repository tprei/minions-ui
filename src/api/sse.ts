import { signal } from '@preact/signals'
import type { Signal } from '@preact/signals'
import type { SseEvent } from './types'

export type SseStatus = 'connecting' | 'live' | 'retrying' | 'closed'

export interface SseHandlers {
  onEvent: (event: SseEvent) => void
  onStatusChange?: (status: SseStatus) => void
  onReconnect?: () => void
}

export interface EventStreamHandle {
  close(): void
  status: Signal<SseStatus>
}

export function openEventStream(opts: {
  baseUrl: string
  token: string
  handlers: SseHandlers
}): EventStreamHandle {
  const { baseUrl, token, handlers } = opts
  const status = signal<SseStatus>('connecting')
  let es: EventSource | null = null
  let attempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false

  function setStatus(s: SseStatus) {
    status.value = s
    handlers.onStatusChange?.(s)
  }

  function buildUrl(): string {
    const base = `${baseUrl}/api/events`
    if (!token) return base
    return `${base}?token=${encodeURIComponent(token)}`
  }

  function connect() {
    if (closed) return
    setStatus('connecting')
    es = new EventSource(buildUrl())

    es.onopen = () => {
      attempt = 0
      setStatus('live')
      handlers.onReconnect?.()
    }

    es.onerror = () => {
      es?.close()
      es = null
      if (closed) return
      setStatus('retrying')
      const delay = Math.floor(Math.random() * Math.min(30000, 500 * 2 ** attempt))
      attempt++
      reconnectTimer = setTimeout(connect, delay)
    }

    es.onmessage = (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data as string) as SseEvent
        handlers.onEvent(event)
      } catch {
        console.warn('[sse] failed to parse message', e.data)
      }
    }
  }

  connect()

  return {
    status,
    close() {
      if (closed) return
      closed = true
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      es?.close()
      es = null
      setStatus('closed')
    },
  }
}
