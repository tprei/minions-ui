import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/preact'
import { NodeDetailPopup } from '../../src/components/NodeDetailPopup'
import type { ApiDagGraph, ApiSession } from '../../src/api/types'

function makeSession(overrides: Partial<ApiSession> = {}): ApiSession {
  return {
    id: 'session-1',
    slug: 'bold-meadow',
    status: 'running',
    command: '/task Add feature',
    repo: 'https://github.com/org/repo',
    branch: 'feature-branch',
    threadId: 123,
    chatId: -100,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    mode: 'task',
    conversation: [],
    ...overrides,
  }
}

function makeDag(overrides: Partial<ApiDagGraph> = {}): ApiDagGraph {
  return {
    id: 'dag-xyz',
    rootTaskId: 'node-a',
    nodes: {
      'node-a': {
        id: 'node-a',
        slug: 'root-node',
        status: 'running',
        dependencies: [],
        dependents: ['node-b'],
        session: makeSession({ id: 'sess-a', slug: 'root-node', status: 'running' }),
      },
      'node-b': {
        id: 'node-b',
        slug: 'leaf-node',
        status: 'ci-pending',
        dependencies: ['node-a'],
        dependents: [],
        session: makeSession({ id: 'sess-b', slug: 'leaf-node', status: 'running' }),
      },
    },
    status: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('NodeDetailPopup hierarchy metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders without hierarchy section when session has no parent, children, or DAG', () => {
    const session = makeSession({ id: 's1', slug: 'lone-session' })
    render(
      <NodeDetailPopup
        session={session}
        onClose={vi.fn()}
        sessions={[session]}
        dags={[]}
      />
    )
    expect(document.querySelector('[data-testid="node-detail-hierarchy"]')).toBeFalsy()
  })

  it('renders parent link when session has a parent in sessions list', () => {
    const parent = makeSession({ id: 'p1', slug: 'parent-slug', childIds: ['c1'] })
    const child = makeSession({ id: 'c1', slug: 'child-slug', parentId: 'p1' })
    render(
      <NodeDetailPopup
        session={child}
        onClose={vi.fn()}
        sessions={[parent, child]}
        dags={[]}
      />
    )
    const hierarchy = document.querySelector('[data-testid="node-detail-hierarchy"]')
    expect(hierarchy).toBeTruthy()
    expect(hierarchy!.innerHTML).toContain('Parent')
    expect(hierarchy!.innerHTML).toContain('parent-slug')
  })

  it('clicking parent link invokes onSelectSession with the parent session', () => {
    const parent = makeSession({ id: 'p1', slug: 'parent-slug', childIds: ['c1'] })
    const child = makeSession({ id: 'c1', slug: 'child-slug', parentId: 'p1' })
    const onSelectSession = vi.fn()
    render(
      <NodeDetailPopup
        session={child}
        onClose={vi.fn()}
        sessions={[parent, child]}
        dags={[]}
        onSelectSession={onSelectSession}
      />
    )
    const link = document.querySelector('[data-testid="node-detail-session-link-p1"]') as HTMLButtonElement
    expect(link).toBeTruthy()
    fireEvent.click(link)
    expect(onSelectSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', slug: 'parent-slug' }))
  })

  it('renders child links and uses singular "Child" for one child', () => {
    const parent = makeSession({ id: 'p1', slug: 'parent-slug', childIds: ['c1'] })
    const child = makeSession({ id: 'c1', slug: 'child-slug', parentId: 'p1' })
    render(
      <NodeDetailPopup
        session={parent}
        onClose={vi.fn()}
        sessions={[parent, child]}
        dags={[]}
      />
    )
    const hierarchy = document.querySelector('[data-testid="node-detail-hierarchy"]')!
    expect(hierarchy.innerHTML).toContain('Child')
    expect(hierarchy.innerHTML).not.toContain('Children')
    expect(hierarchy.innerHTML).toContain('child-slug')
  })

  it('renders multiple child links with pluralized label', () => {
    const parent = makeSession({ id: 'p1', slug: 'parent-slug', childIds: ['c1', 'c2'] })
    const c1 = makeSession({ id: 'c1', slug: 'child-one', parentId: 'p1' })
    const c2 = makeSession({ id: 'c2', slug: 'child-two', parentId: 'p1' })
    render(
      <NodeDetailPopup
        session={parent}
        onClose={vi.fn()}
        sessions={[parent, c1, c2]}
        dags={[]}
      />
    )
    const hierarchy = document.querySelector('[data-testid="node-detail-hierarchy"]')!
    expect(hierarchy.innerHTML).toContain('Children')
    expect(hierarchy.innerHTML).toContain('child-one')
    expect(hierarchy.innerHTML).toContain('child-two')
  })

  it('skips unresolved children that are not in sessions list', () => {
    const parent = makeSession({ id: 'p1', slug: 'parent-slug', childIds: ['missing', 'c1'] })
    const c1 = makeSession({ id: 'c1', slug: 'child-one', parentId: 'p1' })
    render(
      <NodeDetailPopup
        session={parent}
        onClose={vi.fn()}
        sessions={[parent, c1]}
        dags={[]}
      />
    )
    const hierarchy = document.querySelector('[data-testid="node-detail-hierarchy"]')!
    expect(hierarchy.innerHTML).toContain('child-one')
    expect(hierarchy.innerHTML).not.toContain('missing')
  })

  it('renders DAG id when session belongs to a DAG node (by session.id match)', () => {
    const dag = makeDag()
    const session = dag.nodes['node-a'].session!
    render(
      <NodeDetailPopup
        session={session}
        onClose={vi.fn()}
        sessions={[session]}
        dags={[dag]}
      />
    )
    const dagId = document.querySelector('[data-testid="node-detail-dag-id"]')
    expect(dagId).toBeTruthy()
    expect(dagId!.textContent).toContain('dag-xyz')
  })

  it('renders DAG node status badge when DAG status differs from session status', () => {
    const dag = makeDag()
    const session = dag.nodes['node-b'].session!
    render(
      <NodeDetailPopup
        session={session}
        onClose={vi.fn()}
        sessions={[session]}
        dags={[dag]}
      />
    )
    const dagStatus = document.querySelector('[data-testid="node-detail-dag-node-status"]')
    expect(dagStatus).toBeTruthy()
    expect(dagStatus!.innerHTML).toContain('CI Pending')
  })

  it('omits DAG node status row when DAG status matches session status', () => {
    const dag = makeDag({
      nodes: {
        'node-a': {
          id: 'node-a',
          slug: 'same-status',
          status: 'running',
          dependencies: [],
          dependents: [],
          session: makeSession({ id: 'sess-a', slug: 'same-status', status: 'running' }),
        },
      },
    })
    const session = dag.nodes['node-a'].session!
    render(
      <NodeDetailPopup
        session={session}
        onClose={vi.fn()}
        sessions={[session]}
        dags={[dag]}
      />
    )
    expect(document.querySelector('[data-testid="node-detail-dag-node-status"]')).toBeFalsy()
    expect(document.querySelector('[data-testid="node-detail-dag-id"]')).toBeTruthy()
  })

  it('resolves DAG by node.id when the DAG node has no attached session (id-match fallback)', () => {
    const session = makeSession({ id: 'node-a', slug: 'bold-meadow' })
    const dag = makeDag({
      nodes: {
        'node-a': {
          id: 'node-a',
          slug: 'bold-meadow',
          status: 'pending',
          dependencies: [],
          dependents: [],
        },
      },
    })
    render(
      <NodeDetailPopup
        session={session}
        onClose={vi.fn()}
        sessions={[session]}
        dags={[dag]}
      />
    )
    const dagId = document.querySelector('[data-testid="node-detail-dag-id"]')
    expect(dagId).toBeTruthy()
    expect(dagId!.textContent).toContain('dag-xyz')
  })

  it('clicking a child link invokes onSelectSession with the child session', () => {
    const parent = makeSession({ id: 'p1', slug: 'parent-slug', childIds: ['c1'] })
    const c1 = makeSession({ id: 'c1', slug: 'child-one', parentId: 'p1' })
    const onSelectSession = vi.fn()
    render(
      <NodeDetailPopup
        session={parent}
        onClose={vi.fn()}
        sessions={[parent, c1]}
        dags={[]}
        onSelectSession={onSelectSession}
      />
    )
    const link = document.querySelector('[data-testid="node-detail-session-link-c1"]') as HTMLButtonElement
    expect(link).toBeTruthy()
    fireEvent.click(link)
    expect(onSelectSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }))
  })

  it('renders non-interactive slug when onSelectSession is not provided', () => {
    const parent = makeSession({ id: 'p1', slug: 'parent-slug', childIds: ['c1'] })
    const child = makeSession({ id: 'c1', slug: 'child-slug', parentId: 'p1' })
    render(
      <NodeDetailPopup
        session={child}
        onClose={vi.fn()}
        sessions={[parent, child]}
        dags={[]}
      />
    )
    expect(document.querySelector('[data-testid="node-detail-session-link-p1"]')).toBeFalsy()
    const hierarchy = document.querySelector('[data-testid="node-detail-hierarchy"]')!
    expect(hierarchy.innerHTML).toContain('parent-slug')
  })

  it('still renders existing meta rows (branch, repo, mode) alongside hierarchy', () => {
    const parent = makeSession({ id: 'p1', slug: 'parent-slug', childIds: ['c1'] })
    const child = makeSession({
      id: 'c1',
      slug: 'child-slug',
      parentId: 'p1',
      branch: 'feat/x',
      repo: 'https://github.com/acme/w',
      mode: 'task',
    })
    render(
      <NodeDetailPopup
        session={child}
        onClose={vi.fn()}
        sessions={[parent, child]}
        dags={[]}
      />
    )
    expect(document.body.innerHTML).toContain('feat/x')
    expect(document.body.innerHTML).toContain('github.com/acme/w')
    expect(document.body.innerHTML).toContain('task')
  })

  it('Escape key triggers onClose', () => {
    const session = makeSession()
    const onClose = vi.fn()
    render(
      <NodeDetailPopup
        session={session}
        onClose={onClose}
        sessions={[session]}
        dags={[]}
      />
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('works without sessions/dags props (backwards-safe optional)', () => {
    const session = makeSession({ parentId: 'other', childIds: ['x'] })
    render(<NodeDetailPopup session={session} onClose={vi.fn()} />)
    expect(document.querySelector('[data-testid="node-detail-hierarchy"]')).toBeFalsy()
  })
})
