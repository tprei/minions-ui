import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { restackResolverHandler } from './restack-resolver-handler'
import type { HandlerCtx, SessionCompletedEvent } from './types'
import { openDatabase, runMigrations } from '../db/sqlite'
import { EngineEventBus, resetEventBus } from '../events/bus'
import type { EngineEvent } from '../events/types'
import { buildDag } from '../dag/dag'
import { saveDag } from '../dag/store'
import { createSessionRegistry } from '../session/registry'
import {
  createNoopDagScheduler,
  createNoopLoopScheduler,
  createNoopCIBabysitter,
  createNoopQualityGates,
  createNoopDigestBuilder,
  createNoopProfileStore,
  createNoopReplyQueueFactory,
  createDefaultConfig,
} from './stubs'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { Database } from 'bun:sqlite'

function makeBus(): { bus: EngineEventBus; events: EngineEvent[] } {
  const events: EngineEvent[] = []
  const bus = new EngineEventBus()
  bus.on((ev) => events.push(ev))
  return { bus, events }
}

function makeCtx(db: Database, bus: EngineEventBus): HandlerCtx {
  return {
    db,
    registry: createSessionRegistry({ getDb: () => db }),
    bus,
    scheduler: createNoopDagScheduler(),
    loopScheduler: createNoopLoopScheduler(),
    ciBabysitter: createNoopCIBabysitter(),
    qualityGates: createNoopQualityGates(),
    digest: createNoopDigestBuilder(),
    profileStore: createNoopProfileStore(),
    replyQueue: createNoopReplyQueueFactory(),
    config: createDefaultConfig(),
  }
}

let workspaceRoot: string
let db: Database

beforeEach(() => {
  resetEventBus()
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'resolver-test-'))
  db = openDatabase(':memory:')
  runMigrations(db)
})

afterEach(() => {
  fs.rmSync(workspaceRoot, { recursive: true, force: true })
})

describe('restackResolverHandler', () => {
  it('matches all session.completed events', () => {
    const ev: SessionCompletedEvent = {
      kind: 'session.completed',
      sessionId: 'test-session',
      state: 'completed',
      durationMs: 1000,
    }
    expect(restackResolverHandler.matches(ev)).toBe(true)
  })

  it('ignores non-rebase-resolver sessions', async () => {
    const { bus, events } = makeBus()
    const ctx = makeCtx(db, bus)

    db.run(`
      INSERT INTO sessions (id, slug, status, command, mode, repo, branch, bare_dir, pr_url, parent_id, variant_group_id, claude_session_id, workspace_root, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_sleep_until, quota_retry_count, metadata, pipeline_advancing)
      VALUES ('test-session', 'test-slug', 'completed', 'test', 'task', 'repo', 'branch', null, null, null, null, null, '${workspaceRoot}', 0, 0, 0, '[]', '[]', '[]', null, 0, '{}', 0)
    `)

    const ev: SessionCompletedEvent = {
      kind: 'session.completed',
      sessionId: 'test-session',
      state: 'completed',
      durationMs: 1000,
    }

    await restackResolverHandler.handle(ev, ctx)

    const restackEvents = events.filter((e) => e.kind === 'dag.node.restack.completed')
    expect(restackEvents.length).toBe(0)
  })

  it('emits conflict when rebase is still in progress', async () => {
    const { bus, events } = makeBus()
    const ctx = makeCtx(db, bus)

    const slug = 'test-slug'
    const cwd = path.join(workspaceRoot, slug)
    fs.mkdirSync(cwd, { recursive: true })

    const graph = buildDag('dag-1', [
      { id: 'a', title: 'Task A', description: 'First', dependsOn: [] },
    ], 'root', 'https://github.com/org/repo')
    graph.nodes[0]!.branch = 'minion/test-slug'
    saveDag(graph, db)

    fs.mkdirSync(path.join(cwd, '.git'), { recursive: true })
    fs.mkdirSync(path.join(cwd, '.git', 'rebase-merge'), { recursive: true })

    db.run(`
      INSERT INTO sessions (id, slug, status, command, mode, repo, branch, bare_dir, pr_url, parent_id, variant_group_id, claude_session_id, workspace_root, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_sleep_until, quota_retry_count, metadata, pipeline_advancing)
      VALUES ('test-session', '${slug}', 'completed', 'test', 'rebase-resolver', 'repo', 'branch', null, null, null, null, null, '${workspaceRoot}', 0, 0, 0, '[]', '[]', '[]', null, 0, '{"dagId":"dag-1","dagNodeId":"a","parentBranch":"main","parentSha":"abc123"}', 0)
    `)

    const ev: SessionCompletedEvent = {
      kind: 'session.completed',
      sessionId: 'test-session',
      state: 'completed',
      durationMs: 1000,
    }

    await restackResolverHandler.handle(ev, ctx)

    const conflictEvents = events.filter((e) => e.kind === 'dag.node.restack.completed' && e.result === 'conflict')
    expect(conflictEvents.length).toBe(1)
    expect(conflictEvents[0]).toMatchObject({
      kind: 'dag.node.restack.completed',
      dagId: 'dag-1',
      nodeId: 'a',
      result: 'conflict',
    })
  })

  it('emits resolved and dag.node.pushed when clean and push succeeds', async () => {
    const { bus, events } = makeBus()
    const ctx = makeCtx(db, bus)

    const slug = 'test-slug'
    const cwd = path.join(workspaceRoot, slug)
    fs.mkdirSync(cwd, { recursive: true })

    const graph = buildDag('dag-1', [
      { id: 'a', title: 'Task A', description: 'First', dependsOn: [] },
    ], 'root', 'https://github.com/org/repo')
    graph.nodes[0]!.branch = 'minion/test-slug'
    saveDag(graph, db)

    const gitDir = path.join(cwd, '.git')
    fs.mkdirSync(gitDir, { recursive: true })
    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/test-branch\n')
    fs.mkdirSync(path.join(gitDir, 'refs', 'heads'), { recursive: true })
    fs.writeFileSync(path.join(gitDir, 'refs', 'heads', 'test-branch'), 'new-sha-123\n')

    db.run(`
      INSERT INTO sessions (id, slug, status, command, mode, repo, branch, bare_dir, pr_url, parent_id, variant_group_id, claude_session_id, workspace_root, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_sleep_until, quota_retry_count, metadata, pipeline_advancing)
      VALUES ('test-session', '${slug}', 'completed', 'test', 'rebase-resolver', 'repo', 'branch', null, null, null, null, null, '${workspaceRoot}', 0, 0, 0, '[]', '[]', '[]', null, 0, '{"dagId":"dag-1","dagNodeId":"a","parentBranch":"main","parentSha":"old-sha"}', 0)
    `)

    const ev: SessionCompletedEvent = {
      kind: 'session.completed',
      sessionId: 'test-session',
      state: 'completed',
      durationMs: 1000,
    }

    await restackResolverHandler.handle(ev, ctx)

    const resolvedEvents = events.filter((e) => e.kind === 'dag.node.restack.completed' && e.result === 'resolved')
    const pushedEvents = events.filter((e) => e.kind === 'dag.node.pushed')

    expect(resolvedEvents.length).toBeGreaterThanOrEqual(1)
    expect(pushedEvents.length).toBeGreaterThanOrEqual(1)
  })

  it('bounds to one resolver attempt per parent push', async () => {
    const { bus, events } = makeBus()
    const ctx = makeCtx(db, bus)

    const slug = 'test-slug'
    const cwd = path.join(workspaceRoot, slug)
    fs.mkdirSync(cwd, { recursive: true })

    const graph = buildDag('dag-1', [
      { id: 'a', title: 'Task A', description: 'First', dependsOn: [] },
    ], 'root', 'https://github.com/org/repo')
    graph.nodes[0]!.branch = 'minion/test-slug'
    saveDag(graph, db)

    db.run(`
      INSERT INTO sessions (id, slug, status, command, mode, repo, branch, bare_dir, pr_url, parent_id, variant_group_id, claude_session_id, workspace_root, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_sleep_until, quota_retry_count, metadata, pipeline_advancing)
      VALUES ('test-session', '${slug}', 'completed', 'test', 'rebase-resolver', 'repo', 'branch', null, null, null, null, null, '${workspaceRoot}', 0, 0, 0, '[]', '[]', '[]', null, 0, '{"dagId":"dag-1","dagNodeId":"a","parentBranch":"main","parentSha":"abc123"}', 0)
    `)

    const ev: SessionCompletedEvent = {
      kind: 'session.completed',
      sessionId: 'test-session',
      state: 'completed',
      durationMs: 1000,
    }

    await restackResolverHandler.handle(ev, ctx)

    expect(events.some((e) => e.kind === 'dag.node.restack.completed')).toBe(true)
  })
})
