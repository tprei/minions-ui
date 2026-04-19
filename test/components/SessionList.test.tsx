import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/preact'
import type { ApiSession, ApiDagGraph, ApiDagNode } from '../../src/api/types'
import {
  SessionList,
  buildDagStatusIndex,
  buildDagGroups,
  getEffectiveStatus,
  shortRepo,
} from '../../src/components/SessionList'
import { buildSessionIndex } from '../../src/state/hierarchy'

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

beforeEach(() => {
  cleanup()
})

describe('shortRepo', () => {
  it('extracts owner/repo from an ssh git URL', () => {
    expect(shortRepo('git@github.com:acme/widgets.git')).toBe('acme/widgets')
  })

  it('extracts owner/repo from an https URL', () => {
    expect(shortRepo('https://github.com/acme/widgets.git')).toBe('acme/widgets')
  })

  it('returns the input when it does not match the pattern', () => {
    expect(shortRepo('')).toBe('')
  })
})

describe('buildDagStatusIndex', () => {
  it('maps session ids to their DAG node status', () => {
    const session = makeSession({ id: 's1', slug: 'one' })
    const dag = makeDag({
      id: 'd1',
      nodes: {
        n1: makeDagNode({ id: 'n1', slug: 'one', status: 'landed', session }),
      },
    })
    const index = buildDagStatusIndex([dag])
    expect(index.get('s1')).toBe('landed')
  })

  it('is empty when no DAG nodes have sessions', () => {
    const dag = makeDag({
      id: 'd1',
      nodes: { n1: makeDagNode({ id: 'n1', slug: 'x', status: 'pending' }) },
    })
    expect(buildDagStatusIndex([dag]).size).toBe(0)
  })
})

describe('getEffectiveStatus', () => {
  it('prefers DAG node status over session status', () => {
    const session = makeSession({ id: 's1', slug: 'one', status: 'completed' })
    const index = new Map([['s1', 'landed' as const]])
    expect(getEffectiveStatus(session, index)).toBe('landed')
  })

  it('falls back to session status when not in DAG index', () => {
    const session = makeSession({ id: 's1', slug: 'one', status: 'failed' })
    expect(getEffectiveStatus(session, new Map())).toBe('failed')
  })
})

describe('buildDagGroups', () => {
  it('produces a group per DAG with landed/total counts', () => {
    const a = makeSession({ id: 'a', slug: 'a' })
    const b = makeSession({ id: 'b', slug: 'b' })
    const dag = makeDag({
      id: 'd1',
      nodes: {
        n1: makeDagNode({ id: 'n1', slug: 'a', status: 'landed', session: a }),
        n2: makeDagNode({ id: 'n2', slug: 'b', status: 'running', session: b }),
      },
    })
    const index = buildSessionIndex([a, b])
    const groups = buildDagGroups([dag], index)
    expect(groups).toHaveLength(1)
    expect(groups[0].total).toBe(2)
    expect(groups[0].landed).toBe(1)
    expect(groups[0].sessions.map((s) => s.id).sort()).toEqual(['a', 'b'])
  })

  it('skips DAGs with no nodes', () => {
    expect(buildDagGroups([makeDag({ id: 'empty' })], new Map())).toEqual([])
  })

  it('sorts groups by DAG updatedAt desc', () => {
    const d1 = makeDag({
      id: 'old',
      updatedAt: '2024-01-01T00:00:00Z',
      nodes: { n1: makeDagNode({ id: 'n1', slug: 'n1' }) },
    })
    const d2 = makeDag({
      id: 'new',
      updatedAt: '2024-06-01T00:00:00Z',
      nodes: { n1: makeDagNode({ id: 'n1', slug: 'n1' }) },
    })
    const groups = buildDagGroups([d1, d2], new Map())
    expect(groups.map((g) => g.dag.id)).toEqual(['new', 'old'])
  })
})

describe('SessionList', () => {
  it('shows empty-state hint when there are no sessions', () => {
    render(<SessionList sessions={[]} dags={[]} activeSessionId={null} onSelect={() => {}} />)
    expect(screen.getByText(/No sessions yet/)).toBeTruthy()
  })

  it('renders a standalone group for solo sessions', () => {
    const sessions = [
      makeSession({ id: 's1', slug: 'alpha' }),
      makeSession({ id: 's2', slug: 'beta' }),
    ]
    render(
      <SessionList
        sessions={sessions}
        dags={[]}
        activeSessionId={null}
        onSelect={() => {}}
      />,
    )
    const group = screen.getByTestId('session-group-standalone')
    expect(within(group).getByTestId('session-item-s1')).toBeTruthy()
    expect(within(group).getByTestId('session-item-s2')).toBeTruthy()
    expect(screen.queryByTestId('session-group-tree')).toBeNull()
    expect(screen.queryByTestId('session-group-dag')).toBeNull()
  })

  it('renders a tree group with nested children indented by depth', () => {
    const sessions = [
      makeSession({ id: 'root', slug: 'root', childIds: ['mid'] }),
      makeSession({ id: 'mid', slug: 'mid', parentId: 'root', childIds: ['leaf'] }),
      makeSession({ id: 'leaf', slug: 'leaf', parentId: 'mid' }),
    ]
    render(
      <SessionList
        sessions={sessions}
        dags={[]}
        activeSessionId={null}
        onSelect={() => {}}
      />,
    )
    const treeGroup = screen.getByTestId('session-group-tree')
    expect(within(treeGroup).getByTestId('session-item-root')).toBeTruthy()
    expect(within(treeGroup).getByTestId('session-item-mid')).toBeTruthy()
    expect(within(treeGroup).getByTestId('session-item-leaf')).toBeTruthy()

    const rootRow = within(treeGroup).getByTestId('session-item-root').parentElement
    const midRow = within(treeGroup).getByTestId('session-item-mid').parentElement
    const leafRow = within(treeGroup).getByTestId('session-item-leaf').parentElement
    expect(rootRow?.getAttribute('data-depth')).toBe('0')
    expect(midRow?.getAttribute('data-depth')).toBe('1')
    expect(leafRow?.getAttribute('data-depth')).toBe('2')
  })

  it('renders a DAG group with a subheader showing landed/total', () => {
    const a = makeSession({ id: 'a', slug: 'a' })
    const b = makeSession({ id: 'b', slug: 'b' })
    const dag = makeDag({
      id: 'dag-abc-1234',
      nodes: {
        n1: makeDagNode({ id: 'n1', slug: 'a', status: 'landed', session: a }),
        n2: makeDagNode({ id: 'n2', slug: 'b', status: 'running', session: b }),
      },
    })
    render(
      <SessionList
        sessions={[a, b]}
        dags={[dag]}
        activeSessionId={null}
        onSelect={() => {}}
      />,
    )
    const dagGroup = screen.getByTestId('session-group-dag')
    const sub = within(dagGroup).getByTestId('dag-subheader-dag-abc-1234')
    expect(sub.textContent).toContain('1/2 landed')
    expect(within(dagGroup).getByTestId('session-item-a')).toBeTruthy()
    expect(within(dagGroup).getByTestId('session-item-b')).toBeTruthy()
  })

  it('uses DAG node status label for DAG-owned sessions (e.g. landed)', () => {
    const a = makeSession({ id: 'a', slug: 'a', status: 'completed' })
    const dag = makeDag({
      id: 'd1',
      nodes: {
        n1: makeDagNode({ id: 'n1', slug: 'a', status: 'landed', session: a }),
      },
    })
    render(
      <SessionList
        sessions={[a]}
        dags={[dag]}
        activeSessionId={null}
        onSelect={() => {}}
      />,
    )
    const row = screen.getByTestId('session-item-a')
    expect(row.textContent?.toLowerCase()).toContain('landed')
  })

  it('places DAG, Tree, and Standalone in separate groups simultaneously', () => {
    const dagSession = makeSession({ id: 'dagS', slug: 'dagS' })
    const parent = makeSession({ id: 'p', slug: 'p', childIds: ['c'] })
    const child = makeSession({ id: 'c', slug: 'c', parentId: 'p' })
    const solo = makeSession({ id: 'solo', slug: 'solo' })
    const dag = makeDag({
      id: 'd1',
      nodes: {
        n1: makeDagNode({ id: 'n1', slug: 'dagS', status: 'running', session: dagSession }),
      },
    })

    render(
      <SessionList
        sessions={[dagSession, parent, child, solo]}
        dags={[dag]}
        activeSessionId={null}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByTestId('session-group-dag')).toBeTruthy()
    expect(screen.getByTestId('session-group-tree')).toBeTruthy()
    expect(screen.getByTestId('session-group-standalone')).toBeTruthy()

    expect(
      within(screen.getByTestId('session-group-dag')).getByTestId('session-item-dagS'),
    ).toBeTruthy()
    expect(
      within(screen.getByTestId('session-group-tree')).getByTestId('session-item-p'),
    ).toBeTruthy()
    expect(
      within(screen.getByTestId('session-group-standalone')).getByTestId(
        'session-item-solo',
      ),
    ).toBeTruthy()
  })

  it('collapses and re-expands a group when the section header is toggled', () => {
    const sessions = [makeSession({ id: 's1', slug: 'alpha' })]
    render(
      <SessionList
        sessions={sessions}
        dags={[]}
        activeSessionId={null}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByTestId('session-item-s1')).toBeTruthy()

    fireEvent.click(screen.getByTestId('group-toggle-standalone'))
    expect(screen.queryByTestId('session-item-s1')).toBeNull()

    fireEvent.click(screen.getByTestId('group-toggle-standalone'))
    expect(screen.getByTestId('session-item-s1')).toBeTruthy()
  })

  it('invokes onSelect with the clicked session id', () => {
    const onSelect = vi.fn()
    const sessions = [makeSession({ id: 's1', slug: 'alpha' })]
    render(
      <SessionList
        sessions={sessions}
        dags={[]}
        activeSessionId={null}
        onSelect={onSelect}
      />,
    )
    fireEvent.click(screen.getByTestId('session-item-s1'))
    expect(onSelect).toHaveBeenCalledWith('s1')
  })
})
