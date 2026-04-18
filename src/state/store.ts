import { signal } from '@preact/signals'
import type { ApiClient } from '../api/client'
import type { SseEvent } from '../api/types'
import type { SseStatus } from '../api/sse'
import type { ConnectionStore } from './types'

export function createConnectionStore(client: ApiClient): ConnectionStore {
  const sessions = signal<import('../api/types').ApiSession[]>([])
  const dags = signal<import('../api/types').ApiDagGraph[]>([])
  const status = signal<SseStatus>('connecting')
  const error = signal<string | null>(null)
  const version = signal<import('../api/types').VersionInfo | null>(null)

  async function refresh() {
    try {
      const [v, s, d] = await Promise.all([
        client.getVersion(),
        client.getSessions(),
        client.getDags(),
      ])
      version.value = v
      sessions.value = s
      dags.value = d
      error.value = null
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  function onEvent(event: SseEvent) {
    switch (event.type) {
      case 'session_created':
        sessions.value = [...sessions.value, event.session]
        break
      case 'session_updated': {
        const idx = sessions.value.findIndex((s) => s.id === event.session.id)
        if (idx !== -1) {
          const updated = [...sessions.value]
          updated[idx] = event.session
          sessions.value = updated
        }
        break
      }
      case 'session_deleted':
        sessions.value = sessions.value.filter((s) => s.id !== event.sessionId)
        break
      case 'dag_created':
        dags.value = [...dags.value, event.dag]
        break
      case 'dag_updated': {
        const idx = dags.value.findIndex((d) => d.id === event.dag.id)
        if (idx !== -1) {
          const updated = [...dags.value]
          updated[idx] = event.dag
          dags.value = updated
        }
        break
      }
      case 'dag_deleted':
        dags.value = dags.value.filter((d) => d.id !== event.dagId)
        break
    }
  }

  const handle = client.openEventStream({
    onEvent,
    onStatusChange(s: SseStatus) {
      status.value = s
    },
    onReconnect() {
      void refresh()
    },
  })

  void refresh()

  return {
    sessions,
    dags,
    status,
    error,
    version,
    refresh,
    dispose() {
      handle.close()
    },
  }
}
