import { beforeEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { EngineEventBus, resetEventBus } from '../events/bus'
import { openDatabase, runMigrations } from '../db/sqlite'
import { resolvePrLifecycleAction, wirePrLifecycle } from './pr-lifecycle'

function seedSession(
  db: Database,
  id: string,
  opts: {
    mode?: string
    prUrl?: string | null
    metadata?: Record<string, unknown>
    status?: string
  } = {},
): void {
  const now = Date.now()
  db.run(
    `INSERT INTO sessions (id, slug, status, command, mode, repo, branch, bare_dir, pr_url, parent_id, variant_group_id, claude_session_id, workspace_root, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_sleep_until, quota_retry_count, metadata, pipeline_advancing)
     VALUES (?, 'session-slug', ?, 'cmd', ?, null, null, null, ?, null, null, null, null, ?, ?, 0, '[]', '[]', '[]', null, 0, ?, 0)`,
    [id, opts.status ?? 'running', opts.mode ?? 'task', opts.prUrl ?? null, now, now, JSON.stringify(opts.metadata ?? {})],
  )
}

describe('pr lifecycle', () => {
  let db: Database

  beforeEach(() => {
    resetEventBus()
    db = openDatabase(':memory:')
    runMigrations(db)
  })

  test('resolvePrLifecycleAction stores pr_url and claims babysit for task mode', () => {
    seedSession(db, 'sess-1', { mode: 'task', prUrl: null })

    const action = resolvePrLifecycleAction(
      db,
      'sess-1',
      'Work complete.\nPR: https://github.com/acme/repo/pull/12',
    )

    expect(action).not.toBeNull()
    expect(action?.babysitClaimed).toBe(true)
    expect(action?.explicitPrLine).toBe(true)
    expect(action?.prUrl).toBe('https://github.com/acme/repo/pull/12')

    const row = db
      .query<{ pr_url: string | null; metadata: string }, [string]>(
        'SELECT pr_url, metadata FROM sessions WHERE id = ?',
      )
      .get('sess-1')

    expect(row?.pr_url).toBe('https://github.com/acme/repo/pull/12')
    const meta = row ? (JSON.parse(row.metadata) as Record<string, unknown>) : {}
    expect(typeof meta['ciBabysitStartedAt']).toBe('number')
    expect(meta['ciBabysitTrigger']).toBe('stream')
  })

  test('resolvePrLifecycleAction does not claim babysit outside task modes', () => {
    seedSession(db, 'sess-plan', { mode: 'plan', prUrl: null })

    const action = resolvePrLifecycleAction(
      db,
      'sess-plan',
      'Done.\nPR: https://github.com/acme/repo/pull/22',
    )

    expect(action).not.toBeNull()
    expect(action?.babysitClaimed).toBe(false)

    const row = db
      .query<{ pr_url: string | null; metadata: string }, [string]>(
        'SELECT pr_url, metadata FROM sessions WHERE id = ?',
      )
      .get('sess-plan')
    expect(row?.pr_url).toBe('https://github.com/acme/repo/pull/22')
    const meta = row ? (JSON.parse(row.metadata) as Record<string, unknown>) : {}
    expect(meta['ciBabysitStartedAt']).toBeUndefined()
  })

  test('resolvePrLifecycleAction does not claim babysit when already started', () => {
    seedSession(db, 'sess-started', {
      mode: 'task',
      prUrl: null,
      metadata: { ciBabysitStartedAt: Date.now() - 10_000, ciBabysitTrigger: 'stream' },
    })

    const action = resolvePrLifecycleAction(
      db,
      'sess-started',
      'PR: https://github.com/acme/repo/pull/77',
    )

    expect(action).not.toBeNull()
    expect(action?.babysitClaimed).toBe(false)
  })

  test('wirePrLifecycle triggers babysit and auto-stop for explicit PR line', async () => {
    seedSession(db, 'sess-wire', { mode: 'task', prUrl: null })
    const bus = new EngineEventBus()
    const babysitCalls: Array<{ sessionId: string; prUrl: string }> = []
    const stopCalls: Array<{ sessionId: string; reason?: string }> = []

    const unbind = wirePrLifecycle({
      bus,
      db,
      ciBabysitter: {
        async babysitPR(sessionId, prUrl) {
          babysitCalls.push({ sessionId, prUrl })
        },
        async queueDeferredBabysit() {},
        async babysitDagChildCI() {},
      },
      stopSession: async (sessionId, reason) => {
        stopCalls.push({ sessionId, reason })
      },
    })

    bus.emit({
      kind: 'session.stream',
      sessionId: 'sess-wire',
      event: {
        seq: 1,
        id: 'evt-1',
        sessionId: 'sess-wire',
        turn: 1,
        timestamp: Date.now(),
        type: 'assistant_text',
        blockId: 'b1',
        text: 'Implemented.\nPR: https://github.com/acme/repo/pull/9',
        final: true,
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 20))
    unbind()

    expect(babysitCalls).toEqual([{ sessionId: 'sess-wire', prUrl: 'https://github.com/acme/repo/pull/9' }])
    expect(stopCalls).toEqual([{ sessionId: 'sess-wire', reason: 'auto_exit_after_pr' }])
  })
})

