import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import type { SseEvent, ResourceSnapshot } from '../../shared/api-types'
import type { EngineEvent } from '../events/types'
import { getEventBus } from '../events/bus'
import { getDb, prepared } from '../db/sqlite'
import { sessionRowToApi, dagToApi, eventRowToTranscript } from './wire-mappers'

export function registerSseRoute(app: Hono, dbProvider?: () => Database): void {
  const resolveDb = dbProvider ?? getDb
  app.get('/api/events', (c) => sseHandler(c, resolveDb))
}

async function sseHandler(c: Context, dbProvider: () => Database): Promise<Response> {
  return streamSSE(c, async (stream) => {
    const db = dbProvider()
    const seenSessionIds = new Set<string>()
    const seenDagIds = new Set<string>()

    const sessionRows = prepared.listSessions(db)
    const sessionMap = new Map(sessionRows.map((r) => [r.id, sessionRowToApi(r)]))

    for (const row of sessionRows) {
      const session = sessionMap.get(row.id)!
      seenSessionIds.add(row.id)
      const evt: SseEvent = { type: 'session_created', session }
      await stream.writeSSE({ data: JSON.stringify(evt), event: 'message' })
    }

    const dagRows = prepared.listDags(db)
    for (const dagRow of dagRows) {
      const nodes = prepared.listDagNodes(db, dagRow.id)
      const dag = dagToApi(dagRow, nodes, sessionMap)
      seenDagIds.add(dagRow.id)
      const evt: SseEvent = { type: 'dag_created', dag }
      await stream.writeSSE({ data: JSON.stringify(evt), event: 'message' })
    }

    const activeSessions = sessionRows.filter(
      (r) => r.status === 'running' || r.status === 'pending' || r.status === 'waiting_input',
    )
    for (const sessionRow of activeSessions) {
      const eventRows = prepared.listEvents(db, sessionRow.id, -1)
      for (const eventRow of eventRows) {
        const transcriptEvent = eventRowToTranscript({
          session_id: eventRow.session_id,
          seq: eventRow.seq,
          turn: eventRow.turn,
          type: eventRow.type,
          timestamp: eventRow.timestamp,
          payload: JSON.stringify(eventRow.payload),
        })
        const evt: SseEvent = { type: 'transcript_event', sessionId: sessionRow.id, event: transcriptEvent }
        await stream.writeSSE({ data: JSON.stringify(evt), event: 'message' })
      }
    }

    const keepaliveTimer = setInterval(() => {
      void stream.writeSSE({ data: '', event: 'keepalive' })
    }, 25_000)

    const unsubscribe = getEventBus().on((engineEvent: EngineEvent) => {
      const sseEvent = projectEvent(engineEvent, seenSessionIds, seenDagIds)
      if (sseEvent !== null) {
        void stream.writeSSE({ data: JSON.stringify(sseEvent), event: 'message' })
      }
    })

    stream.onAbort(() => {
      clearInterval(keepaliveTimer)
      unsubscribe()
    })

    await new Promise<void>((resolve) => {
      stream.onAbort(resolve)
    })
  })
}

function projectEvent(
  event: EngineEvent,
  seenSessionIds: Set<string>,
  seenDagIds: Set<string>,
): SseEvent | null {
  if (event.kind === 'session.snapshot') {
    const isNew = !seenSessionIds.has(event.session.id)
    seenSessionIds.add(event.session.id)
    if (isNew) {
      return { type: 'session_created', session: event.session }
    }
    return { type: 'session_updated', session: event.session }
  }

  if (event.kind === 'session.deleted') {
    seenSessionIds.delete(event.sessionId)
    return { type: 'session_deleted', sessionId: event.sessionId }
  }

  if (event.kind === 'session.stream') {
    return { type: 'transcript_event', sessionId: event.sessionId, event: event.event }
  }

  if (event.kind === 'dag.snapshot') {
    const isNew = !seenDagIds.has(event.dag.id)
    seenDagIds.add(event.dag.id)
    if (isNew) {
      return { type: 'dag_created', dag: event.dag }
    }
    return { type: 'dag_updated', dag: event.dag }
  }

  if (event.kind === 'dag.deleted') {
    seenDagIds.delete(event.dagId)
    return { type: 'dag_deleted', dagId: event.dagId }
  }

  if (event.kind === 'session.screenshot_captured') {
    return {
      type: 'session_screenshot_captured',
      sessionId: event.sessionId,
      filename: event.filename,
      url: event.relativeUrl,
      capturedAt: event.capturedAt,
    }
  }

  if (event.kind === 'resource') {
    const snapshot: ResourceSnapshot = {
      ts: event.timestamp,
      cpu: { usagePercent: event.cpuPct, cpuCount: 1, source: 'cgroup' },
      memory: {
        usedBytes: event.memBytes,
        limitBytes: event.memMaxBytes,
        rssBytes: event.memBytes,
        source: 'cgroup',
      },
      disk: { path: '/', usedBytes: 0, totalBytes: 0 },
      eventLoopLagMs: 0,
      counts: { activeSessions: 0, maxSessions: 0, activeLoops: 0, maxLoops: 0 },
    }
    return { type: 'resource', snapshot }
  }

  return null
}
