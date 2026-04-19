import { describe, it, expect } from 'vitest'
import { buildSessionGroups } from '../../src/state/hierarchy'
import type { ApiDagGraph, ApiSession } from '../../src/api/types'

function mkSession(over: Partial<ApiSession> = {}): ApiSession {
  return {
    id: 's',
    slug: 's',
    status: 'pending',
    command: '',
    createdAt: '2026-04-19T00:00:00Z',
    updatedAt: '2026-04-19T00:00:00Z',
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    mode: 'task',
    conversation: [],
    ...over,
  }
}

describe('buildSessionGroups', () => {
  it('puts DAG parent + its children into one group', () => {
    const parent = mkSession({ id: 'p', slug: 'parent', threadId: 1, childIds: ['c1', 'c2'] })
    const c1 = mkSession({ id: 'c1', slug: 'child-1', parentId: 'p', threadId: 10 })
    const c2 = mkSession({ id: 'c2', slug: 'child-2', parentId: 'p', threadId: 11 })
    const dag: ApiDagGraph = {
      id: 'dag-parent',
      rootTaskId: '1',
      status: 'running',
      createdAt: '',
      updatedAt: '',
      nodes: {
        a: { id: 'a', slug: 'child-1', status: 'completed', dependencies: [], dependents: ['b'], session: c1 },
        b: { id: 'b', slug: 'child-2', status: 'running', dependencies: ['a'], dependents: [], session: c2 },
      },
    }
    const groups = buildSessionGroups([parent, c1, c2], [dag])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ kind: 'dag', parent })
    if (groups[0].kind === 'dag') {
      expect(groups[0].children.map((s) => s.id)).toEqual(['c1', 'c2'])
    }
  })

  it('falls back to a parent-child group when there is no DAG', () => {
    const parent = mkSession({ id: 'p', childIds: ['c'] })
    const child = mkSession({ id: 'c', parentId: 'p' })
    const groups = buildSessionGroups([parent, child], [])
    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBe('parent-child')
  })

  it('groups variant sessions by variantGroupId when they are not in a DAG or tree', () => {
    const v1 = mkSession({ id: 'v1', variantGroupId: 'group-x' })
    const v2 = mkSession({ id: 'v2', variantGroupId: 'group-x' })
    const standalone = mkSession({ id: 'alone' })
    const groups = buildSessionGroups([v1, v2, standalone], [])
    const variant = groups.find((g) => g.kind === 'variant')
    expect(variant).toBeDefined()
    if (variant?.kind === 'variant') {
      expect(variant.groupId).toBe('group-x')
      expect(variant.sessions.map((s) => s.id).sort()).toEqual(['v1', 'v2'])
    }
    expect(groups.find((g) => g.kind === 'standalone')).toBeDefined()
  })

  it('puts unclassified sessions into standalone, newest first', () => {
    const older = mkSession({ id: 'older', updatedAt: '2026-04-18T00:00:00Z' })
    const newer = mkSession({ id: 'newer', updatedAt: '2026-04-19T00:00:00Z' })
    const groups = buildSessionGroups([older, newer], [])
    expect(groups.map((g) => (g.kind === 'standalone' ? g.session.id : null))).toEqual(['newer', 'older'])
  })

  it('does not double-count sessions across groups', () => {
    const parent = mkSession({ id: 'p', childIds: ['c'], threadId: 1 })
    const child = mkSession({ id: 'c', parentId: 'p', threadId: 10, variantGroupId: 'maybe' })
    const dag: ApiDagGraph = {
      id: 'dag-p',
      rootTaskId: '1',
      status: 'running',
      createdAt: '',
      updatedAt: '',
      nodes: {
        a: { id: 'a', slug: 'c', status: 'running', dependencies: [], dependents: [], session: child },
      },
    }
    const groups = buildSessionGroups([parent, child], [dag])
    const seen = new Set<string>()
    for (const g of groups) {
      if (g.kind === 'dag') {
        if (g.parent) seen.add(g.parent.id)
        g.children.forEach((c) => seen.add(c.id))
      } else if (g.kind === 'parent-child') {
        seen.add(g.parent.id)
        g.children.forEach((c) => seen.add(c.id))
      } else if (g.kind === 'variant') {
        g.sessions.forEach((c) => seen.add(c.id))
      } else {
        seen.add(g.session.id)
      }
    }
    expect(seen.size).toBe(2)
  })
})
