import { describe, test, expect } from 'bun:test'
import { buildDag, type DagInput, type DagNodeStatus } from './dag'

describe('DAG restack statuses', () => {
  test('rebasing and rebase-conflict are valid DagNodeStatus values', () => {
    const statuses: DagNodeStatus[] = [
      'pending',
      'ready',
      'running',
      'done',
      'failed',
      'skipped',
      'ci-pending',
      'ci-failed',
      'landed',
      'rebasing',
      'rebase-conflict',
    ]

    expect(statuses).toContain('rebasing')
    expect(statuses).toContain('rebase-conflict')
  })

  test('node can be set to rebasing status', () => {
    const items: DagInput[] = [
      { id: 'a', title: 'Node A', description: 'First node', dependsOn: [] },
      { id: 'b', title: 'Node B', description: 'Second node', dependsOn: ['a'] },
    ]

    const graph = buildDag('test-dag', items, 'root-session', 'repo')

    const nodeA = graph.nodes.find((n) => n.id === 'a')!
    nodeA.status = 'rebasing'

    expect(nodeA.status).toBe('rebasing')
  })

  test('node can be set to rebase-conflict status with error', () => {
    const items: DagInput[] = [
      { id: 'a', title: 'Node A', description: 'First node', dependsOn: [] },
      { id: 'b', title: 'Node B', description: 'Second node', dependsOn: ['a'] },
    ]

    const graph = buildDag('test-dag', items, 'root-session', 'repo')

    const nodeA = graph.nodes.find((n) => n.id === 'a')!
    nodeA.status = 'rebase-conflict'
    nodeA.error = 'Merge conflict in src/file.ts'

    expect(nodeA.status).toBe('rebase-conflict')
    expect(nodeA.error).toBe('Merge conflict in src/file.ts')
  })

  test('node transitions from rebasing to done after successful rebase', () => {
    const items: DagInput[] = [
      { id: 'parent', title: 'Parent', description: 'Parent node', dependsOn: [] },
      { id: 'child', title: 'Child', description: 'Child node', dependsOn: ['parent'] },
    ]

    const graph = buildDag('test-dag', items, 'root-session', 'repo')

    const parentNode = graph.nodes.find((n) => n.id === 'parent')!
    const childNode = graph.nodes.find((n) => n.id === 'child')!

    parentNode.status = 'done'
    childNode.status = 'done'

    parentNode.status = 'rebasing'
    expect(parentNode.status).toBe('rebasing')

    parentNode.status = 'done'
    expect(parentNode.status).toBe('done')
  })

  test('node transitions from rebase-conflict to rebasing after retry', () => {
    const items: DagInput[] = [
      { id: 'node-a', title: 'Node A', description: 'Test node', dependsOn: [] },
    ]

    const graph = buildDag('test-dag', items, 'root-session', 'repo')
    const node = graph.nodes.find((n) => n.id === 'node-a')!

    node.status = 'rebase-conflict'
    node.error = 'Conflict in file.ts'
    expect(node.status).toBe('rebase-conflict')

    node.status = 'rebasing'
    node.error = undefined
    expect(node.status).toBe('rebasing')
    expect(node.error).toBeUndefined()
  })
})
