import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup, screen } from '@testing-library/preact'
import { ShipPipelineView } from '../../src/components/ShipPipeline'
import type { ApiDagGraph, ApiDagNode, ApiSession } from '../../src/api/types'

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

function makeNode(overrides: Partial<ApiDagNode> & { id: string }): ApiDagNode {
  return {
    slug: overrides.id,
    status: 'pending',
    dependencies: [],
    dependents: [],
    ...overrides,
  }
}

function makeDag(overrides: Partial<ApiDagGraph> & { id: string }): ApiDagGraph {
  return {
    rootTaskId: 'n1',
    nodes: {},
    status: 'running',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('ShipPipelineView', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders the empty state when no ship pipelines exist', () => {
    render(<ShipPipelineView dags={[]} />)
    expect(screen.getByTestId('ship-pipeline-empty')).toBeTruthy()
    expect(document.body.innerHTML).toContain('No ship pipelines yet')
  })

  it('ignores DAGs that have no ship markers', () => {
    const dag = makeDag({
      id: 'plain',
      nodes: {
        a: makeNode({ id: 'a', status: 'running' }),
      },
    })
    render(<ShipPipelineView dags={[dag]} />)
    expect(screen.getByTestId('ship-pipeline-empty')).toBeTruthy()
  })

  it('renders a board with all four columns when a DAG qualifies', () => {
    const dag = makeDag({
      id: 'ship-1',
      nodes: {
        a: makeNode({ id: 'a', status: 'running' }),
        b: makeNode({ id: 'b', status: 'completed' }),
        c: makeNode({ id: 'c', status: 'ci-pending' }),
        d: makeNode({ id: 'd', status: 'landed' }),
      },
    })
    render(<ShipPipelineView dags={[dag]} />)
    expect(screen.getByTestId('ship-pipeline-board-ship-1')).toBeTruthy()
    expect(screen.getByTestId('ship-pipeline-column-running')).toBeTruthy()
    expect(screen.getByTestId('ship-pipeline-column-review')).toBeTruthy()
    expect(screen.getByTestId('ship-pipeline-column-ci')).toBeTruthy()
    expect(screen.getByTestId('ship-pipeline-column-landed')).toBeTruthy()
  })

  it('places each node in its mapped column', () => {
    const dag = makeDag({
      id: 'ship-1',
      nodes: {
        a: makeNode({ id: 'a', slug: 'run-task', status: 'running' }),
        b: makeNode({ id: 'b', slug: 'review-task', status: 'completed' }),
        c: makeNode({ id: 'c', slug: 'ci-task', status: 'ci-pending' }),
        d: makeNode({ id: 'd', slug: 'landed-task', status: 'landed' }),
      },
    })
    render(<ShipPipelineView dags={[dag]} />)
    expect(
      screen.getByTestId('ship-pipeline-column-running').innerHTML,
    ).toContain('run-task')
    expect(
      screen.getByTestId('ship-pipeline-column-review').innerHTML,
    ).toContain('review-task')
    expect(
      screen.getByTestId('ship-pipeline-column-ci').innerHTML,
    ).toContain('ci-task')
    expect(
      screen.getByTestId('ship-pipeline-column-landed').innerHTML,
    ).toContain('landed-task')
  })

  it('shows "Empty" placeholder text for empty columns', () => {
    const dag = makeDag({
      id: 'ship-1',
      nodes: {
        a: makeNode({ id: 'a', status: 'landed' }),
      },
    })
    render(<ShipPipelineView dags={[dag]} />)
    const runningCol = screen.getByTestId('ship-pipeline-column-running')
    expect(runningCol.innerHTML).toContain('Empty')
  })

  it('shows landed progress in the header', () => {
    const dag = makeDag({
      id: 'ship-1',
      nodes: {
        a: makeNode({ id: 'a', status: 'running' }),
        b: makeNode({ id: 'b', status: 'landed' }),
        c: makeNode({ id: 'c', status: 'landed' }),
      },
    })
    render(<ShipPipelineView dags={[dag]} />)
    expect(
      screen.getByTestId('ship-pipeline-board-ship-1').innerHTML,
    ).toContain('2 of 3 landed')
  })

  it('includes ship-think-moded DAGs even without ci/landed nodes', () => {
    const dag = makeDag({
      id: 'planning',
      nodes: {
        a: makeNode({
          id: 'a',
          status: 'running',
          session: makeSession({ id: 's1', slug: 'planner', mode: 'ship-think' }),
        }),
      },
    })
    render(<ShipPipelineView dags={[dag]} />)
    expect(screen.getByTestId('ship-pipeline-board-planning')).toBeTruthy()
  })

  it('renders a PrLink when a node session has a PR url', () => {
    const session = makeSession({
      id: 's1',
      slug: 'pr-task',
      prUrl: 'https://github.com/org/repo/pull/42',
    })
    const dag = makeDag({
      id: 'ship-1',
      nodes: {
        a: makeNode({ id: 'a', slug: 'pr-task', status: 'ci-pending', session }),
      },
    })
    render(<ShipPipelineView dags={[dag]} />)
    expect(document.body.innerHTML).toContain('#42')
  })

  it('calls onOpenChat when a card with a session is clicked', () => {
    const onOpenChat = vi.fn()
    const session = makeSession({ id: 's1', slug: 'clickable' })
    const dag = makeDag({
      id: 'ship-1',
      nodes: {
        a: makeNode({ id: 'a', slug: 'clickable', status: 'landed', session }),
      },
    })
    render(<ShipPipelineView dags={[dag]} onOpenChat={onOpenChat} />)

    fireEvent.click(screen.getByTestId('ship-pipeline-card-a'))
    expect(onOpenChat).toHaveBeenCalledWith('s1')
  })

  it('cards without a session are not clickable', () => {
    const onOpenChat = vi.fn()
    const dag = makeDag({
      id: 'ship-1',
      nodes: {
        a: makeNode({ id: 'a', slug: 'no-session', status: 'landed' }),
      },
    })
    render(<ShipPipelineView dags={[dag]} onOpenChat={onOpenChat} />)

    fireEvent.click(screen.getByTestId('ship-pipeline-card-a'))
    expect(onOpenChat).not.toHaveBeenCalled()
  })

  it('renders multiple ship pipelines, newest first', () => {
    const older = makeDag({
      id: 'older',
      updatedAt: '2024-01-01T00:00:00Z',
      nodes: { n: makeNode({ id: 'n', status: 'landed' }) },
    })
    const newer = makeDag({
      id: 'newer',
      updatedAt: '2024-03-01T00:00:00Z',
      nodes: { n: makeNode({ id: 'n', status: 'landed' }) },
    })
    render(<ShipPipelineView dags={[older, newer]} />)
    const view = screen.getByTestId('ship-pipeline-view')
    const newerIdx = view.innerHTML.indexOf('ship-pipeline-board-newer')
    const olderIdx = view.innerHTML.indexOf('ship-pipeline-board-older')
    expect(newerIdx).toBeGreaterThanOrEqual(0)
    expect(olderIdx).toBeGreaterThan(newerIdx)
  })
})
