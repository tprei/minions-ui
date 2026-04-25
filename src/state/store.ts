import { signal } from '@preact/signals'
import type { ApiClient } from '../api/client'
import type {
  ResourceSnapshot,
  RuntimeConfigResponse,
  RuntimeOverrides,
  SseEvent,
} from '../api/types'
import type { SseStatus } from '../api/sse'
import type { ConnectionStore, DiffStats } from './types'
import { loadSnapshot, saveSnapshot } from './persist'
import { createTranscriptStore, type TranscriptStore } from './transcript'

export function createConnectionStore(client: ApiClient, connectionId: string): ConnectionStore {
  const sessions = signal<import('../api/types').ApiSession[]>([])
  const dags = signal<import('../api/types').ApiDagGraph[]>([])
  const status = signal<SseStatus>('connecting')
  const error = signal<string | null>(null)
  const version = signal<import('../api/types').VersionInfo | null>(null)
  const stale = signal<boolean>(false)
  const diffStatsBySessionId = signal<Map<string, DiffStats>>(new Map())
  const diffStatsInFlight = new Set<string>()
  const transcripts = new Map<string, TranscriptStore>()
  const resourceSnapshot = signal<ResourceSnapshot | null>(null)
  const runtimeConfig = signal<RuntimeConfigResponse | null>(null)

  function getTranscript(sessionId: string): TranscriptStore | null {
    const existing = transcripts.get(sessionId)
    if (existing) return existing
    const sess = sessions.value.find((s) => s.id === sessionId)
    if (!sess) return null
    const store = createTranscriptStore({ client, slug: sess.slug })
    transcripts.set(sessionId, store)
    return store
  }

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

  function applySessionCreated(session: import('../api/types').ApiSession) {
    const idx = sessions.value.findIndex((s) => s.id === session.id)
    if (idx !== -1) {
      const updated = [...sessions.value]
      updated[idx] = session
      sessions.value = updated
    } else {
      sessions.value = [...sessions.value, session]
    }
    scheduleSnapshot()
  }

  function applySessionDeleted(sessionId: string) {
    if (!sessions.value.some((s) => s.id === sessionId)) return
    sessions.value = sessions.value.filter((s) => s.id !== sessionId)
    if (diffStatsBySessionId.value.has(sessionId)) {
      const next = new Map(diffStatsBySessionId.value)
      next.delete(sessionId)
      diffStatsBySessionId.value = next
    }
    scheduleSnapshot()
  }

  function applyDagSnapshot(dag: import('../api/types').ApiDagGraph) {
    const idx = dags.value.findIndex((d) => d.id === dag.id)
    if (idx !== -1) {
      const updated = [...dags.value]
      updated[idx] = dag
      dags.value = updated
    } else {
      dags.value = [...dags.value, dag]
    }
    scheduleSnapshot()
  }

  function onEvent(event: SseEvent) {
    switch (event.type) {
      case 'session_created':
        applySessionCreated(event.session)
        break
      case 'session_updated': {
        const idx = sessions.value.findIndex((s) => s.id === event.session.id)
        if (idx !== -1) {
          const updated = [...sessions.value]
          updated[idx] = event.session
          sessions.value = updated
        } else {
          sessions.value = [...sessions.value, event.session]
        }
        scheduleSnapshot()
        if (diffStatsBySessionId.value.has(event.session.id)) {
          void loadDiffStats(event.session.id)
        }
        break
      }
      case 'session_deleted': {
        applySessionDeleted(event.sessionId)
        break
      }
      case 'dag_created':
        applyDagSnapshot(event.dag)
        break
      case 'dag_updated': {
        applyDagSnapshot(event.dag)
        break
      }
      case 'dag_deleted':
        dags.value = dags.value.filter((d) => d.id !== event.dagId)
        scheduleSnapshot()
        break
      case 'transcript_event': {
        const store = transcripts.get(event.sessionId)
        if (store) store.applyEvent(event.event)
        break
      }
      case 'resource':
        resourceSnapshot.value = event.snapshot
        break
      case 'session_screenshot_captured':
        break
    }
  }

  async function refreshRuntimeConfig() {
    try {
      runtimeConfig.value = await client.getRuntimeConfig()
    } catch (e) {
      if (e instanceof Error && e.message.includes('not enabled')) return
      // Non-fatal — the drawer just won't open until this succeeds.
    }
  }

  async function updateRuntimeConfig(patch: RuntimeOverrides): Promise<void> {
    runtimeConfig.value = await client.patchRuntimeConfig(patch)
  }

  const handle = client.openEventStream({
    onEvent,
    onStatusChange(s: SseStatus) {
      status.value = s
    },
    onReconnect() {
      void refresh()
      for (const ts of transcripts.values()) {
        void ts.reconcile()
      }
    },
  })

  // iOS 18 can leave EventSource stuck in OPEN state with no error after
  // backgrounding; these listeners force a reconnect when the app resumes.
  let hiddenSince: number | null = null
  const RECONNECT_HIDDEN_MS = 5000

  function onVisibilityChange() {
    if (typeof document === 'undefined') return
    if (document.visibilityState === 'hidden') {
      hiddenSince = Date.now()
      return
    }
    const since = hiddenSince
    hiddenSince = null
    if (since === null) return
    if (Date.now() - since < RECONNECT_HIDDEN_MS) return
    handle.reconnect()
  }

  function onPageShow(event: PageTransitionEvent) {
    if (event.persisted) handle.reconnect()
  }

  function onOnline() {
    handle.reconnect()
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('online', onOnline)
  }

  void refresh()

  return {
    connectionId,
    client,
    sessions,
    dags,
    status,
    reconnectAt: handle.reconnectAt,
    error,
    version,
    stale,
    diffStatsBySessionId,
    resourceSnapshot,
    runtimeConfig,
    loadDiffStats,
    refresh,
    async sendCommand(cmd) {
      const result = await client.sendCommand(cmd)
      if (result.success) {
        error.value = null
      } else {
        error.value = result.error ?? 'Command failed'
      }
      return result
    },
    getTranscript,
    applySessionCreated,
    applySessionDeleted,
    refreshRuntimeConfig,
    updateRuntimeConfig,
    dispose() {
      if (snapshotTimer !== null) {
        clearTimeout(snapshotTimer)
        snapshotTimer = null
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('pageshow', onPageShow)
        window.removeEventListener('online', onOnline)
      }
      for (const ts of transcripts.values()) ts.dispose()
      transcripts.clear()
      handle.close()
    },
  }
}
