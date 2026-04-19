import { describe, it, expect } from 'vitest'
import type { ApiDagGraph, ApiDagNode, ApiSession } from '../../src/api/types'
import {
  SHIP_COLUMN_ORDER,
  buildShipPipelineSummary,
  classifyNodeForShip,
  isShipPipeline,
  selectShipPipelines,
} from '../../src/components/ship-pipeline'

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

describe('ship-pipeline', () => {
  describe('classifyNodeForShip', () => {
    it('maps pending/running/failed to the Running column', () => {
      expect(classifyNodeForShip('pending')).toBe('running')
      expect(classifyNodeForShip('running')).toBe('running')
      expect(classifyNodeForShip('failed')).toBe('running')
    })

    it('maps completed to the Review column', () => {
      expect(classifyNodeForShip('completed')).toBe('review')
    })

    it('maps ci-pending/ci-failed to the CI column', () => {
      expect(classifyNodeForShip('ci-pending')).toBe('ci')
      expect(classifyNodeForShip('ci-failed')).toBe('ci')
    })

    it('maps landed/skipped to the Landed column', () => {
      expect(classifyNodeForShip('landed')).toBe('landed')
      expect(classifyNodeForShip('skipped')).toBe('landed')
    })
  })

  describe('isShipPipeline', () => {
    it('returns false for an empty DAG', () => {
      expect(isShipPipeline(makeDag({ id: 'd1' }))).toBe(false)
    })

    it('returns false for a plain running/pending DAG with no ship markers', () => {
      const dag = makeDag({
        id: 'd1',
        nodes: {
          n1: makeNode({ id: 'n1', status: 'running' }),
          n2: makeNode({ id: 'n2', status: 'pending' }),
        },
      })
      expect(isShipPipeline(dag)).toBe(false)
    })

    it('returns true when any node has a landed status', () => {
      const dag = makeDag({
        id: 'd1',
        nodes: {
          n1: makeNode({ id: 'n1', status: 'completed' }),
          n2: makeNode({ id: 'n2', status: 'landed' }),
        },
      })
      expect(isShipPipeline(dag)).toBe(true)
    })

    it('returns true when any node is in CI', () => {
      expect(
        isShipPipeline(
          makeDag({
            id: 'd1',
            nodes: { n1: makeNode({ id: 'n1', status: 'ci-pending' }) },
          }),
        ),
      ).toBe(true)
      expect(
        isShipPipeline(
          makeDag({
            id: 'd2',
            nodes: { n1: makeNode({ id: 'n1', status: 'ci-failed' }) },
          }),
        ),
      ).toBe(true)
    })

    it('returns true when any node session has mode=ship-think', () => {
      const session = makeSession({ id: 's1', slug: 'ship-plan', mode: 'ship-think' })
      const dag = makeDag({
        id: 'd1',
        nodes: {
          n1: makeNode({ id: 'n1', status: 'running', session }),
        },
      })
      expect(isShipPipeline(dag)).toBe(true)
    })
  })

  describe('buildShipPipelineSummary', () => {
    it('groups nodes into the four columns and counts totals', () => {
      const dag = makeDag({
        id: 'd1',
        nodes: {
          a: makeNode({ id: 'a', status: 'running' }),
          b: makeNode({ id: 'b', status: 'completed' }),
          c: makeNode({ id: 'c', status: 'ci-pending' }),
          d: makeNode({ id: 'd', status: 'ci-failed' }),
          e: makeNode({ id: 'e', status: 'landed' }),
          f: makeNode({ id: 'f', status: 'skipped' }),
          g: makeNode({ id: 'g', status: 'failed' }),
          h: makeNode({ id: 'h', status: 'pending' }),
        },
      })

      const summary = buildShipPipelineSummary(dag)
      expect(summary.total).toBe(8)
      expect(summary.landedCount).toBe(2)
      expect(summary.columns.running.map((n) => n.id).sort()).toEqual(['a', 'g', 'h'])
      expect(summary.columns.review.map((n) => n.id)).toEqual(['b'])
      expect(summary.columns.ci.map((n) => n.id).sort()).toEqual(['c', 'd'])
      expect(summary.columns.landed.map((n) => n.id).sort()).toEqual(['e', 'f'])
    })

    it('exposes the four columns in the canonical order', () => {
      expect(SHIP_COLUMN_ORDER).toEqual(['running', 'review', 'ci', 'landed'])
    })
  })

  describe('selectShipPipelines', () => {
    it('filters out non-ship DAGs', () => {
      const plain = makeDag({
        id: 'plain',
        nodes: { n: makeNode({ id: 'n', status: 'running' }) },
      })
      const ship = makeDag({
        id: 'ship',
        nodes: { n: makeNode({ id: 'n', status: 'landed' }) },
      })
      const summaries = selectShipPipelines([plain, ship])
      expect(summaries.map((s) => s.dag.id)).toEqual(['ship'])
    })

    it('sorts pipelines by updatedAt descending', () => {
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
      const summaries = selectShipPipelines([older, newer])
      expect(summaries.map((s) => s.dag.id)).toEqual(['newer', 'older'])
    })
  })
})
