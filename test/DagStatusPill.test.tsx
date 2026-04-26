import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/preact'
import { DagStatusPill } from '../src/components/DagStatusPill'
import type { ApiDagGraph, ApiDagNode } from '../src/api/types'

function createNode(id: string, status: ApiDagNode['status']): ApiDagNode {
  return {
    id,
    slug: `node-${id}`,
    status,
    dependencies: [],
    dependents: [],
  }
}

function createDag(id: string, nodes: ApiDagNode[]): ApiDagGraph {
  const nodesRecord: Record<string, ApiDagNode> = {}
  for (const node of nodes) {
    nodesRecord[node.id] = node
  }

  return {
    id,
    rootTaskId: nodes[0]?.id ?? 'root',
    nodes: nodesRecord,
    status: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

describe('DagStatusPill', () => {
  it('renders nothing when no DAGs provided', () => {
    const { container } = render(<DagStatusPill dags={[]} />)
    expect(container.textContent).toBe('')
  })

  it('renders nothing when DAG has no nodes', () => {
    const dag = createDag('dag-1', [])
    const { container } = render(<DagStatusPill dags={[dag]} />)
    expect(container.textContent).toBe('')
  })

  it('shows completed/total count', () => {
    const dag = createDag('dag-1', [
      createNode('n1', 'completed'),
      createNode('n2', 'completed'),
      createNode('n3', 'pending'),
      createNode('n4', 'running'),
    ])

    render(<DagStatusPill dags={[dag]} />)
    expect(screen.getByTestId('dag-status-pill').textContent).toContain('2/4')
  })

  it('shows failed count when there are failures', () => {
    const dag = createDag('dag-1', [
      createNode('n1', 'completed'),
      createNode('n2', 'failed'),
      createNode('n3', 'failed'),
      createNode('n4', 'pending'),
    ])

    render(<DagStatusPill dags={[dag]} />)
    expect(screen.getByTestId('dag-status-pill').textContent).toContain('1/4')
    expect(screen.getByTestId('dag-status-pill').textContent).toContain('2 failed')
  })

  it('treats landed status as completed', () => {
    const dag = createDag('dag-1', [
      createNode('n1', 'completed'),
      createNode('n2', 'landed'),
      createNode('n3', 'pending'),
    ])

    render(<DagStatusPill dags={[dag]} />)
    expect(screen.getByTestId('dag-status-pill').textContent).toContain('2/3')
  })

  it('treats ci-failed and rebase-conflict as failed', () => {
    const dag = createDag('dag-1', [
      createNode('n1', 'completed'),
      createNode('n2', 'ci-failed'),
      createNode('n3', 'rebase-conflict'),
      createNode('n4', 'pending'),
    ])

    render(<DagStatusPill dags={[dag]} />)
    expect(screen.getByTestId('dag-status-pill').textContent).toContain('1/4')
    expect(screen.getByTestId('dag-status-pill').textContent).toContain('2 failed')
  })

  it('aggregates stats across multiple DAGs', () => {
    const dag1 = createDag('dag-1', [
      createNode('n1', 'completed'),
      createNode('n2', 'pending'),
    ])
    const dag2 = createDag('dag-2', [
      createNode('n3', 'completed'),
      createNode('n4', 'failed'),
    ])

    render(<DagStatusPill dags={[dag1, dag2]} />)
    expect(screen.getByTestId('dag-status-pill').textContent).toContain('2/4')
    expect(screen.getByTestId('dag-status-pill').textContent).toContain('1 failed')
  })

  it('shows pulsing indicator when there are running nodes', () => {
    const dag = createDag('dag-1', [
      createNode('n1', 'completed'),
      createNode('n2', 'running'),
    ])

    render(<DagStatusPill dags={[dag]} />)
    const pill = screen.getByTestId('dag-status-pill')
    const pulsingDot = pill.querySelector('.animate-pulse')
    expect(pulsingDot).toBeTruthy()
  })

  it('shows pulsing indicator for rebasing status', () => {
    const dag = createDag('dag-1', [
      createNode('n1', 'completed'),
      createNode('n2', 'rebasing'),
    ])

    render(<DagStatusPill dags={[dag]} />)
    const pill = screen.getByTestId('dag-status-pill')
    const pulsingDot = pill.querySelector('.animate-pulse')
    expect(pulsingDot).toBeTruthy()
  })

  it('does not show pulsing indicator when no nodes are running', () => {
    const dag = createDag('dag-1', [
      createNode('n1', 'completed'),
      createNode('n2', 'pending'),
    ])

    render(<DagStatusPill dags={[dag]} />)
    const pill = screen.getByTestId('dag-status-pill')
    const pulsingDot = pill.querySelector('.animate-pulse')
    expect(pulsingDot).toBeFalsy()
  })

  it('includes detailed tooltip with all stats', () => {
    const dag = createDag('dag-1', [
      createNode('n1', 'completed'),
      createNode('n2', 'running'),
      createNode('n3', 'failed'),
      createNode('n4', 'pending'),
      createNode('n5', 'pending'),
    ])

    render(<DagStatusPill dags={[dag]} />)
    const pill = screen.getByTestId('dag-status-pill')
    expect(pill.getAttribute('title')).toBe('DAG progress: 1 completed, 1 running, 1 failed, 2 pending')
  })

  it('handles all completed nodes', () => {
    const dag = createDag('dag-1', [
      createNode('n1', 'completed'),
      createNode('n2', 'landed'),
      createNode('n3', 'completed'),
    ])

    render(<DagStatusPill dags={[dag]} />)
    expect(screen.getByTestId('dag-status-pill').textContent).toContain('3/3')
    expect(screen.queryByText('failed')).toBeFalsy()
  })

  it('handles all failed nodes', () => {
    const dag = createDag('dag-1', [
      createNode('n1', 'failed'),
      createNode('n2', 'ci-failed'),
    ])

    render(<DagStatusPill dags={[dag]} />)
    expect(screen.getByTestId('dag-status-pill').textContent).toContain('0/2')
    expect(screen.getByTestId('dag-status-pill').textContent).toContain('2 failed')
  })

  it('handles skipped nodes as pending', () => {
    const dag = createDag('dag-1', [
      createNode('n1', 'completed'),
      createNode('n2', 'skipped'),
      createNode('n3', 'ci-pending'),
    ])

    render(<DagStatusPill dags={[dag]} />)
    expect(screen.getByTestId('dag-status-pill').textContent).toContain('1/3')
  })
})
