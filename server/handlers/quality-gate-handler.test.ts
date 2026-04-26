import { describe, test, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { EngineEventBus, resetEventBus } from '../events/bus'
import { openDatabase, runMigrations } from '../db/sqlite'
import { qualityGateHandler } from './quality-gate-handler'
import type { HandlerCtx, SessionCompletedEvent, QualityGates, QualityReport } from './types'
import { createSessionRegistry } from '../session/registry'
import {
  createNoopDagScheduler,
  createNoopLoopScheduler,
  createNoopDigestBuilder,
  createNoopCIBabysitter,
  createNoopProfileStore,
  createNoopReplyQueueFactory,
  createDefaultConfig,
} from './stubs'
import type { EngineEvent } from '../events/types'

function makeQualityGates(report: QualityReport): QualityGates {
  return { run: async () => report }
}

function gate(name: string, passed: boolean, output: string): QualityReport['results'][number] {
  return { name, passed, output, command: ['npm', 'run', name], required: true, skipped: false, durationMs: 1 }
}

function makeCtx(db: Database, bus: EngineEventBus, gates: QualityGates): HandlerCtx {
  return {
    db,
    registry: createSessionRegistry({ getDb: () => db }),
    bus,
    scheduler: createNoopDagScheduler(),
    loopScheduler: createNoopLoopScheduler(),
    ciBabysitter: createNoopCIBabysitter(),
    qualityGates: gates,
    digest: createNoopDigestBuilder(),
    profileStore: createNoopProfileStore(),
    replyQueue: createNoopReplyQueueFactory(),
    config: createDefaultConfig(),
  }
}

function seedSession(db: Database, id: string, workspaceRoot: string | null = '/ws', metadata: Record<string, unknown> = {}): void {
  const now = Date.now()
  db.run(
    `INSERT INTO sessions (id, slug, status, command, mode, repo, branch, bare_dir, pr_url, parent_id, variant_group_id, claude_session_id, workspace_root, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_sleep_until, quota_retry_count, metadata, pipeline_advancing)
     VALUES (?, 'my-slug', 'completed', 'cmd', 'task', null, null, null, null, null, null, null, ?, ?, ?, 0, '[]', '[]', '[]', null, 0, ?, 0)`,
    [id, workspaceRoot, now, now, JSON.stringify(metadata)],
  )
}

describe('qualityGateHandler', () => {
  let db: Database
  let bus: EngineEventBus

  beforeEach(() => {
    resetEventBus()
    db = openDatabase(':memory:')
    runMigrations(db)
    bus = new EngineEventBus()
  })

  test('emits session.quality_gates event when allPassed', async () => {
    seedSession(db, 'sess-qg')
    const report: QualityReport = { allPassed: true, results: [gate('lint', true, 'ok')] }
    const ctx = makeCtx(db, bus, makeQualityGates(report))

    const emitted: EngineEvent[] = []
    bus.on((e) => emitted.push(e))

    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-qg', state: 'completed', durationMs: 0 }
    await qualityGateHandler.handle(ev, ctx)

    const qgEv = emitted.find((e) => e.kind === 'session.quality_gates')
    expect(qgEv).toBeDefined()
    if (qgEv?.kind === 'session.quality_gates') {
      expect(qgEv.allPassed).toBe(true)
    }
    const row = db.query<{ metadata: string }, [string]>('SELECT metadata FROM sessions WHERE id = ?').get('sess-qg')
    const meta = JSON.parse(row!.metadata) as { qualityReport?: QualityReport }
    expect(meta.qualityReport?.allPassed).toBe(true)
  })

  test('appends feedback to metadata.pendingFeedback when gates fail', async () => {
    seedSession(db, 'sess-fail-qg')
    const report: QualityReport = {
      allPassed: false,
      results: [gate('typecheck', false, 'type error on line 5')],
    }
    const ctx = makeCtx(db, bus, makeQualityGates(report))

    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-fail-qg', state: 'completed', durationMs: 0 }
    await qualityGateHandler.handle(ev, ctx)

    const row = db.query<{ metadata: string }, [string]>('SELECT metadata FROM sessions WHERE id = ?').get('sess-fail-qg')
    const meta = JSON.parse(row!.metadata) as { pendingFeedback?: string[]; qualityReport?: QualityReport }
    expect(meta.pendingFeedback).toBeDefined()
    expect(meta.pendingFeedback!.length).toBeGreaterThan(0)
    expect(meta.pendingFeedback![0]).toContain('typecheck')
    expect(meta.qualityReport?.allPassed).toBe(false)
  })

  test('does nothing when workspace_root is null', async () => {
    seedSession(db, 'sess-no-ws', null)
    const report: QualityReport = { allPassed: false, results: [] }
    const ctx = makeCtx(db, bus, makeQualityGates(report))

    const emitted: EngineEvent[] = []
    bus.on((e) => emitted.push(e))

    const ev: SessionCompletedEvent = { kind: 'session.completed', sessionId: 'sess-no-ws', state: 'completed', durationMs: 0 }
    await qualityGateHandler.handle(ev, ctx)

    expect(emitted.filter((e) => e.kind === 'session.quality_gates')).toHaveLength(0)
  })
})
