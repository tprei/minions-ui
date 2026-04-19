import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within, cleanup } from '@testing-library/preact'
import type { ApiSession, ApiDagGraph, ApiDagNode } from '../../src/api/types'
import { SessionList } from '../../src/components/SessionList'

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

describe('DagSummaryCard (per-DAG summary at list top)', () => {
  it('renders a progress bar at the top of the DAG group', () => {
    const a = makeSession({ id: 'a', slug: 'a' })
    const b = makeSession({ id: 'b', slug: 'b' })
    const dag = makeDag({
      id: 'dag-1',
      nodes: {
        n1: makeDagNode({ id: 'n1', slug: 'a', status: 'landed', session: a }),
        n2: makeDagNode({ id: 'n2', slug: 'b', status: 'landed', session: b }),
      },
    })
    render(<SessionList sessions={[a, b]} dags={[dag]} activeSessionId={null} onSelect={() => {}} />)
    const bar = screen.getByTestId('dag-progress-dag-1')
    expect(bar.getAttribute('aria-valuenow')).toBe('100')
    expect(bar.getAttribute('role')).toBe('progressbar')
  })

  it('shows 0% progress when no node is landed yet', () => {
    const a = makeSession({ id: 'a', slug: 'a' })
    const dag = makeDag({
      id: 'dag-0',
      nodes: {
        n1: makeDagNode({ id: 'n1', slug: 'a', status: 'running', session: a }),
      },
    })
    render(<SessionList sessions={[a]} dags={[dag]} activeSessionId={null} onSelect={() => {}} />)
    expect(screen.getByTestId('dag-progress-dag-0').getAttribute('aria-valuenow')).toBe('0')
  })

  it('shows running pill when at least one node is running', () => {
    const a = makeSession({ id: 'a', slug: 'a' })
    const dag = makeDag({
      id: 'dag-r',
      nodes: {
        n1: makeDagNode({ id: 'n1', slug: 'a', status: 'running', session: a }),
      },
    })
    render(<SessionList sessions={[a]} dags={[dag]} activeSessionId={null} onSelect={() => {}} />)
    expect(screen.getByTestId('dag-pill-running-dag-r').textContent).toContain('1')
  })

  it('shows failed pill when at least one node failed or ci-failed', () => {
    const a = makeSession({ id: 'a', slug: 'a' })
    const b = makeSession({ id: 'b', slug: 'b' })
    const dag = makeDag({
      id: 'dag-f',
      nodes: {
        n1: makeDagNode({ id: 'n1', slug: 'a', status: 'failed', session: a }),
        n2: makeDagNode({ id: 'n2', slug: 'b', status: 'ci-failed', session: b }),
      },
    })
    render(<SessionList sessions={[a, b]} dags={[dag]} activeSessionId={null} onSelect={() => {}} />)
    expect(screen.getByTestId('dag-pill-failed-dag-f').textContent).toContain('2')
  })

  it('shows landed/total count in the card header', () => {
    const a = makeSession({ id: 'a', slug: 'a' })
    const b = makeSession({ id: 'b', slug: 'b' })
    const dag = makeDag({
      id: 'dag-header',
      nodes: {
        n1: makeDagNode({ id: 'n1', slug: 'a', status: 'landed', session: a }),
        n2: makeDagNode({ id: 'n2', slug: 'b', status: 'running', session: b }),
      },
    })
    render(<SessionList sessions={[a, b]} dags={[dag]} activeSessionId={null} onSelect={() => {}} />)
    const card = screen.getByTestId('dag-subheader-dag-header')
    expect(within(card).getByText(/1\/2 landed/)).toBeTruthy()
    expect(within(card).getByText(/50%/)).toBeTruthy()
  })
})
