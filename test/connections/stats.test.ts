import { describe, it, expect } from 'vitest'
import { computeConnectionStats } from '../../src/connections/stats'
import type { ApiSession, ApiDagGraph, ApiDagNode } from '../../src/api/types'

function createSession(overrides: Partial<ApiSession> = {}): ApiSession {
  return {
    id: 'session-1',
    slug: 'test',
    status: 'running',
    command: '/task test',
    mode: 'task',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    conversation: [],
    ...overrides,
  }
}

function createDagNode(overrides: Partial<ApiDagNode> = {}): ApiDagNode {
  return {
    id: 'node-1',
    slug: 'node-1',
    status: 'pending',
    dependencies: [],
    dependents: [],
    ...overrides,
  }
}

function createDag(overrides: Partial<ApiDagGraph> = {}): ApiDagGraph {
  return {
    id: 'dag-1',
    rootTaskId: 'root-1',
    nodes: {},
    status: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('computeConnectionStats', () => {
  it('returns zero unread count when no sessions need attention', () => {
    const sessions = [createSession(), createSession({ id: 'session-2' })]
    const dags: ApiDagGraph[] = []

    const stats = computeConnectionStats(sessions, dags)

    expect(stats.unreadCount).toBe(0)
  })

  it('counts sessions needing attention', () => {
    const sessions = [
      createSession({ needsAttention: true, attentionReasons: ['failed'] }),
      createSession({ id: 'session-2', needsAttention: true, attentionReasons: ['ci_fix'] }),
      createSession({ id: 'session-3', needsAttention: false }),
    ]
    const dags: ApiDagGraph[] = []

    const stats = computeConnectionStats(sessions, dags)

    expect(stats.unreadCount).toBe(2)
  })

  it('returns null dagProgress when no DAGs exist', () => {
    const sessions: ApiSession[] = []
    const dags: ApiDagGraph[] = []

    const stats = computeConnectionStats(sessions, dags)

    expect(stats.dagProgress).toBeNull()
  })

  it('computes DAG progress correctly', () => {
    const sessions: ApiSession[] = []
    const dags = [
      createDag({
        nodes: {
          'node-1': createDagNode({ id: 'node-1', status: 'completed' }),
          'node-2': createDagNode({ id: 'node-2', status: 'landed' }),
          'node-3': createDagNode({ id: 'node-3', status: 'running' }),
          'node-4': createDagNode({ id: 'node-4', status: 'pending' }),
          'node-5': createDagNode({ id: 'node-5', status: 'failed' }),
        },
      }),
    ]

    const stats = computeConnectionStats(sessions, dags)

    expect(stats.dagProgress).toEqual({
      done: 2,
      total: 5,
      failed: 1,
      running: 1,
    })
  })

  it('aggregates multiple DAGs', () => {
    const sessions: ApiSession[] = []
    const dags = [
      createDag({
        id: 'dag-1',
        nodes: {
          'node-1': createDagNode({ id: 'node-1', status: 'completed' }),
          'node-2': createDagNode({ id: 'node-2', status: 'running' }),
        },
      }),
      createDag({
        id: 'dag-2',
        nodes: {
          'node-3': createDagNode({ id: 'node-3', status: 'landed' }),
          'node-4': createDagNode({ id: 'node-4', status: 'failed' }),
          'node-5': createDagNode({ id: 'node-5', status: 'ci-failed' }),
        },
      }),
    ]

    const stats = computeConnectionStats(sessions, dags)

    expect(stats.dagProgress).toEqual({
      done: 2,
      total: 5,
      failed: 2,
      running: 1,
    })
  })

  it('counts ci-pending and rebasing as running', () => {
    const sessions: ApiSession[] = []
    const dags = [
      createDag({
        nodes: {
          'node-1': createDagNode({ id: 'node-1', status: 'ci-pending' }),
          'node-2': createDagNode({ id: 'node-2', status: 'rebasing' }),
          'node-3': createDagNode({ id: 'node-3', status: 'running' }),
        },
      }),
    ]

    const stats = computeConnectionStats(sessions, dags)

    expect(stats.dagProgress).toEqual({
      done: 0,
      total: 3,
      failed: 0,
      running: 3,
    })
  })

  it('counts ci-failed as failed', () => {
    const sessions: ApiSession[] = []
    const dags = [
      createDag({
        nodes: {
          'node-1': createDagNode({ id: 'node-1', status: 'ci-failed' }),
          'node-2': createDagNode({ id: 'node-2', status: 'failed' }),
        },
      }),
    ]

    const stats = computeConnectionStats(sessions, dags)

    expect(stats.dagProgress).toEqual({
      done: 0,
      total: 2,
      failed: 2,
      running: 0,
    })
  })

  it('combines unread and DAG stats correctly', () => {
    const sessions = [
      createSession({ needsAttention: true, attentionReasons: ['failed'] }),
      createSession({ id: 'session-2', needsAttention: true, attentionReasons: ['interrupted'] }),
    ]
    const dags = [
      createDag({
        nodes: {
          'node-1': createDagNode({ status: 'completed' }),
          'node-2': createDagNode({ status: 'failed' }),
          'node-3': createDagNode({ status: 'running' }),
        },
      }),
    ]

    const stats = computeConnectionStats(sessions, dags)

    expect(stats.unreadCount).toBe(2)
    expect(stats.dagProgress).toEqual({
      done: 1,
      total: 3,
      failed: 1,
      running: 1,
    })
  })
})
