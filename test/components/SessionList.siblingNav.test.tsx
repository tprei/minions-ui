import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/preact'
import type { ApiSession, ApiDagGraph, ApiDagNode } from '../../src/api/types'
import {
  SessionList,
  buildDagGroups,
  getSiblingIds,
  getSiblingTarget,
} from '../../src/components/SessionList'
import { buildSessionIndex, classifySessions } from '../../src/state/hierarchy'

function makeSession(overrides: Partial<ApiSession> & { id: string; slug: string }): ApiSession {
  return {
    status: 'running',
    command: '/task test',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    mode: 'task',
    conversation: [],
    ...overrides,
  }
}

function makeDag(overrides: Partial<ApiDagGraph> & { id: string }): ApiDagGraph {
  return {
    rootTaskId: 'node-1',
    nodes: {},
    status: 'running',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeDagNode(
  overrides: Partial<ApiDagNode> & { id: string; slug: string },
): ApiDagNode {
  return {
    status: 'running',
    dependencies: [],
    dependents: [],
    ...overrides,
  }
}

beforeEach(() => cleanup())

describe('getSiblingTarget', () => {
  it('wraps forward from the last sibling to the first', () => {
    expect(getSiblingTarget('c', ['a', 'b', 'c'], 1)).toBe('a')
  })

  it('wraps backward from the first sibling to the last', () => {
    expect(getSiblingTarget('a', ['a', 'b', 'c'], -1)).toBe('c')
  })

  it('returns null when activeId is not in the list', () => {
    expect(getSiblingTarget('z', ['a', 'b'], 1)).toBeNull()
  })

  it('returns null when activeId is null', () => {
    expect(getSiblingTarget(null, ['a', 'b'], 1)).toBeNull()
  })

  it('returns null when siblings is empty', () => {
    expect(getSiblingTarget('a', [], 1)).toBeNull()
  })
})

describe('getSiblingIds', () => {
  it('returns DAG peers when the active session is in a DAG group', () => {
    const a = makeSession({ id: 'a', slug: 'a' })
    const b = makeSession({ id: 'b', slug: 'b' })
    const solo = makeSession({ id: 'solo', slug: 'solo' })
    const dag = makeDag({
      id: 'd1',
      nodes: {
        n1: makeDagNode({ id: 'n1', slug: 'a', session: a }),
        n2: makeDagNode({ id: 'n2', slug: 'b', session: b }),
      },
    })
    const cls = classifySessions([a, b, solo], [dag])
    const groups = buildDagGroups([dag], buildSessionIndex([a, b]))
    const ids = getSiblingIds('a', groups, cls.parentChildRoots, cls.sessionById, cls.standalone)
    expect(ids.sort()).toEqual(['a', 'b'])
  })

  it('returns other children of the same parent when the active session is in a tree', () => {
    const root = makeSession({ id: 'root', slug: 'root', childIds: ['c1', 'c2'] })
    const c1 = makeSession({ id: 'c1', slug: 'c1', parentId: 'root' })
    const c2 = makeSession({ id: 'c2', slug: 'c2', parentId: 'root' })
    const cls = classifySessions([root, c1, c2], [])
    const ids = getSiblingIds('c1', [], cls.parentChildRoots, cls.sessionById, cls.standalone)
    expect(ids.sort()).toEqual(['c1', 'c2'])
  })

  it('returns all tree roots when active session is a root', () => {
    const rootA = makeSession({ id: 'rootA', slug: 'rootA', childIds: ['cA'] })
    const cA = makeSession({ id: 'cA', slug: 'cA', parentId: 'rootA' })
    const rootB = makeSession({ id: 'rootB', slug: 'rootB', childIds: ['cB'] })
    const cB = makeSession({ id: 'cB', slug: 'cB', parentId: 'rootB' })
    const cls = classifySessions([rootA, cA, rootB, cB], [])
    const ids = getSiblingIds('rootA', [], cls.parentChildRoots, cls.sessionById, cls.standalone)
    expect(ids.sort()).toEqual(['rootA', 'rootB'])
  })

  it('returns standalone peers when the active session is standalone', () => {
    const a = makeSession({ id: 'a', slug: 'a' })
    const b = makeSession({ id: 'b', slug: 'b' })
    const cls = classifySessions([a, b], [])
    const ids = getSiblingIds('a', [], cls.parentChildRoots, cls.sessionById, cls.standalone)
    expect(ids.sort()).toEqual(['a', 'b'])
  })

  it('returns empty array when the active session does not exist', () => {
    const a = makeSession({ id: 'a', slug: 'a' })
    const cls = classifySessions([a], [])
    expect(getSiblingIds('missing', [], cls.parentChildRoots, cls.sessionById, cls.standalone)).toEqual([])
  })
})

describe('SessionList keyboard sibling navigation', () => {
  it('pressing "]" moves selection to the next standalone sibling', () => {
    const onSelect = vi.fn()
    const sessions = [
      makeSession({ id: 's1', slug: 's1', updatedAt: '2024-01-02T00:00:00Z' }),
      makeSession({ id: 's2', slug: 's2', updatedAt: '2024-01-01T00:00:00Z' }),
    ]
    render(<SessionList sessions={sessions} dags={[]} activeSessionId="s1" onSelect={onSelect} />)
    fireEvent.keyDown(document, { key: ']' })
    expect(onSelect).toHaveBeenCalledWith('s2')
  })

  it('pressing "[" wraps backward to the last standalone sibling', () => {
    const onSelect = vi.fn()
    const sessions = [
      makeSession({ id: 's1', slug: 's1', updatedAt: '2024-01-02T00:00:00Z' }),
      makeSession({ id: 's2', slug: 's2', updatedAt: '2024-01-01T00:00:00Z' }),
    ]
    render(<SessionList sessions={sessions} dags={[]} activeSessionId="s1" onSelect={onSelect} />)
    fireEvent.keyDown(document, { key: '[' })
    expect(onSelect).toHaveBeenCalledWith('s2')
  })

  it('does nothing when no session is active', () => {
    const onSelect = vi.fn()
    const sessions = [makeSession({ id: 's1', slug: 's1' })]
    render(<SessionList sessions={sessions} dags={[]} activeSessionId={null} onSelect={onSelect} />)
    fireEvent.keyDown(document, { key: ']' })
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('ignores [/] keys while focus is in an input', () => {
    const onSelect = vi.fn()
    const sessions = [
      makeSession({ id: 's1', slug: 's1' }),
      makeSession({ id: 's2', slug: 's2' }),
    ]
    render(
      <div>
        <input data-testid="some-input" />
        <SessionList sessions={sessions} dags={[]} activeSessionId="s1" onSelect={onSelect} />
      </div>,
    )
    const input = screen.getByTestId('some-input')
    ;(input as HTMLInputElement).focus()
    fireEvent.keyDown(input, { key: ']' })
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('ignores [/] when a modifier key is pressed', () => {
    const onSelect = vi.fn()
    const sessions = [
      makeSession({ id: 's1', slug: 's1' }),
      makeSession({ id: 's2', slug: 's2' }),
    ]
    render(<SessionList sessions={sessions} dags={[]} activeSessionId="s1" onSelect={onSelect} />)
    fireEvent.keyDown(document, { key: ']', metaKey: true })
    expect(onSelect).not.toHaveBeenCalled()
  })
})
