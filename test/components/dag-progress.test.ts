import { describe, it, expect, vi } from 'vitest'
import { topologicalDagOrder } from '../../src/components/universe-layout'
import { formatDagProgressBadge } from '../../src/components/UniverseCanvas'
import type { ApiDagNode } from '../../src/api/types'

vi.mock('@reactflow/core', () => ({
  MarkerType: { ArrowClosed: 'arrowClosed' },
  ReactFlow: () => null,
  ReactFlowProvider: ({ children }: { children: unknown }) => children,
  useReactFlow: () => ({ setCenter: vi.fn(), fitBounds: vi.fn(), fitView: vi.fn() }),
  useNodesState: (init: unknown) => [init, vi.fn(), vi.fn()],
  useEdgesState: (init: unknown) => [init, vi.fn(), vi.fn()],
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom' },
}))

vi.mock('@reactflow/background', () => ({ Background: () => null }))
vi.mock('@reactflow/controls', () => ({ Controls: () => null }))
vi.mock('@reactflow/minimap', () => ({ MiniMap: () => null }))

function node(
  id: string,
  deps: string[] = [],
  status: ApiDagNode['status'] = 'pending',
): ApiDagNode {
  return { id, slug: id, status, dependencies: deps, dependents: [] }
}

describe('topologicalDagOrder', () => {
  it('returns 1-based order for a linear chain', () => {
    const order = topologicalDagOrder([node('c', ['b']), node('b', ['a']), node('a')])
    expect(order.get('a')).toBe(1)
    expect(order.get('b')).toBe(2)
    expect(order.get('c')).toBe(3)
  })

  it('handles diamond dependencies (a -> b,c -> d)', () => {
    const order = topologicalDagOrder([
      node('a'),
      node('b', ['a']),
      node('c', ['a']),
      node('d', ['b', 'c']),
    ])
    expect(order.get('a')).toBe(1)
    expect(order.get('d')).toBe(4)
    expect(order.get('b')).toBeLessThan(order.get('d')!)
    expect(order.get('c')).toBeLessThan(order.get('d')!)
  })

  it('handles independent nodes (preserves input order on ties)', () => {
    const order = topologicalDagOrder([node('x'), node('y'), node('z')])
    expect(order.size).toBe(3)
    expect(new Set([order.get('x'), order.get('y'), order.get('z')])).toEqual(new Set([1, 2, 3]))
  })

  it('skips dangling dependencies that point to missing nodes', () => {
    const order = topologicalDagOrder([node('only', ['ghost'])])
    expect(order.get('only')).toBe(1)
    expect(order.size).toBe(1)
  })

  it('returns an empty map for an empty input', () => {
    expect(topologicalDagOrder([]).size).toBe(0)
  })
})

describe('formatDagProgressBadge', () => {
  it('formats with the human-readable status label', () => {
    expect(formatDagProgressBadge(3, 7, 'running')).toBe('3/7 · Running')
    expect(formatDagProgressBadge(1, 2, 'completed')).toBe('1/2 · Done')
    expect(formatDagProgressBadge(2, 4, 'ci-pending')).toBe('2/4 · CI Pending')
  })

  it('falls back to the raw status when not in STATUS_CONFIG', () => {
    expect(formatDagProgressBadge(1, 1, 'unknown-status')).toBe('1/1 · unknown-status')
  })
})
