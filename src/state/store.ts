import { signal } from '@preact/signals'
import type { ApiClient } from '../api/client'
import type { SseEvent } from '../api/types'
import type { SseStatus } from '../api/sse'
import type { ConnectionStore, DiffStats } from './types'
import { loadSnapshot, saveSnapshot } from './persist'

export function createConnectionStore(client: ApiClient, connectionId: string): ConnectionStore {
  const sessions = signal<import('../api/types').ApiSession[]>([])
  const dags = signal<import('../api/types').ApiDagGraph[]>([])
  const status = signal<SseStatus>('connecting')
  const error = signal<string | null>(null)
  const version = signal<import('../api/types').VersionInfo | null>(null)
  const stale = signal<boolean>(false)
  const diffStatsBySessionId = signal<Map<string, DiffStats>>(new Map())
  const diffStatsInFlight = new Set<string>()

  async function loadDiffStats(sessionId: string): Promise<void> {
    if (diffStatsInFlight.has(sessionId)) return
    diffStatsInFlight.add(sessionId)
    try {
      const diff = await client.getDiff(sessionId)
      const next = new Map(diffStatsBySessionId.value)
      next.set(sessionId, {
        filesChanged: diff.stats.filesChanged,
        insertions: diff.stats.insertions,
        deletions: diff.stats.deletions,
        truncated: diff.truncated,
      })
      diffStatsBySessionId.value = next
    } catch {
      // swallow — header falls back to branch/cwd without stats
    } finally {
      diffStatsInFlight.delete(sessionId)
    }
  }

  let snapshotTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleSnapshot() {
    if (snapshotTimer !== null) return
    snapshotTimer = setTimeout(() => {
      snapshotTimer = null
      const v = version.value
      if (!v) return
      void saveSnapshot(connectionId, {
        sessions: sessions.value,
        dags: dags.value,
        version: v,
      })
    }, 1000)
  }

  void loadSnapshot(connectionId).then((snap) => {
    if (!snap) return
    if (sessions.value.length === 0) sessions.value = snap.sessions
    if (dags.value.length === 0) dags.value = snap.dags
    if (!version.value) version.value = snap.version
    stale.value = true
  })

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
      stale.value = false
      scheduleSnapshot()
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  function onEvent(event: SseEvent) {
    switch (event.type) {
      case 'session_created':
        sessions.value = [...sessions.value, event.session]
        scheduleSnapshot()
        break
      case 'session_updated': {
        const idx = sessions.value.findIndex((s) => s.id === event.session.id)
        if (idx !== -1) {
          const updated = [...sessions.value]
          updated[idx] = event.session
          sessions.value = updated
          scheduleSnapshot()
        }
        if (diffStatsBySessionId.value.has(event.session.id)) {
          void loadDiffStats(event.session.id)
        }
        break
      }
      case 'session_deleted': {
        sessions.value = sessions.value.filter((s) => s.id !== event.sessionId)
        if (diffStatsBySessionId.value.has(event.sessionId)) {
          const next = new Map(diffStatsBySessionId.value)
          next.delete(event.sessionId)
          diffStatsBySessionId.value = next
        }
        scheduleSnapshot()
        break
      }
      case 'dag_created':
        dags.value = [...dags.value, event.dag]
        scheduleSnapshot()
        break
      case 'dag_updated': {
        const idx = dags.value.findIndex((d) => d.id === event.dag.id)
        if (idx !== -1) {
          const updated = [...dags.value]
          updated[idx] = event.dag
          dags.value = updated
          scheduleSnapshot()
        }
        break
      }
      case 'dag_deleted':
        dags.value = dags.value.filter((d) => d.id !== event.dagId)
        scheduleSnapshot()
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
    client,
    sessions,
    dags,
    status,
    error,
    version,
    stale,
    diffStatsBySessionId,
    loadDiffStats,
    refresh,
    sendCommand(cmd) {
      return client.sendCommand(cmd)
    },
    dispose() {
      if (snapshotTimer !== null) {
        clearTimeout(snapshotTimer)
        snapshotTimer = null
      }
      handle.close()
    },
  }
}
