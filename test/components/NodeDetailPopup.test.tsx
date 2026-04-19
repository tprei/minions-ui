import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/preact'
import { NodeDetailPopup } from '../../src/components/NodeDetailPopup'
import type { ApiDagGraph, ApiSession } from '../../src/api/types'

function createSession(overrides: Partial<ApiSession> = {}): ApiSession {
  return {
    id: 'session-1',
    slug: 'bold-meadow',
    status: 'running',
    command: '/task Add feature',
    repo: 'https://github.com/org/repo',
    branch: 'feature-branch',
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

function createDag(overrides: Partial<ApiDagGraph> = {}): ApiDagGraph {
  return {
    id: 'dag-1',
    rootTaskId: 'node-1',
    nodes: {},
    status: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('NodeDetailPopup hierarchy', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders without hierarchy section when session has no parent/children/dag', () => {
    const session = createSession()
    render(<NodeDetailPopup session={session} onClose={vi.fn()} />)
    expect(document.querySelector('[data-testid="node-detail-hierarchy"]')).toBeNull()
  })

  it('renders parent as a linkified chip when parent session is present', () => {
    const parent = createSession({ id: 'parent-1', slug: 'parent-task', childIds: ['child-1'] })
    const child = createSession({ id: 'child-1', slug: 'child-task', parentId: 'parent-1' })
    const onNavigate = vi.fn()
    render(
      <NodeDetailPopup
        session={child}
        sessions={[parent, child]}
        onClose={vi.fn()}
        onNavigate={onNavigate}
      />,
    )
    const hierarchy = document.querySelector('[data-testid="node-detail-hierarchy"]')
    expect(hierarchy).toBeTruthy()
    expect(hierarchy?.textContent).toContain('Parent')
    const link = document.querySelector('[data-testid="node-detail-link-parent-1"]') as HTMLButtonElement
    expect(link).toBeTruthy()
    expect(link.textContent).toBe('parent-task')
    fireEvent.click(link)
    expect(onNavigate).toHaveBeenCalledWith('parent-1')
  })

  it('shows parent id as plain text when parent session is missing from sessions list', () => {
    const child = createSession({ id: 'child-1', slug: 'child-task', parentId: 'missing-parent' })
    render(
      <NodeDetailPopup
        session={child}
        sessions={[child]}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
      />,
    )
    expect(document.body.innerHTML).toContain('missing-parent')
    expect(document.querySelector('[data-testid="node-detail-link-missing-parent"]')).toBeNull()
  })

  it('renders children as linkified chips and pluralizes label', () => {
    const parent = createSession({
      id: 'parent-1',
      slug: 'parent-task',
      childIds: ['child-1', 'child-2'],
    })
    const child1 = createSession({ id: 'child-1', slug: 'child-one', parentId: 'parent-1' })
    const child2 = createSession({ id: 'child-2', slug: 'child-two', parentId: 'parent-1' })
    const onNavigate = vi.fn()
    render(
      <NodeDetailPopup
        session={parent}
        sessions={[parent, child1, child2]}
        onClose={vi.fn()}
        onNavigate={onNavigate}
      />,
    )
    const hierarchy = document.querySelector('[data-testid="node-detail-hierarchy"]')
    expect(hierarchy?.textContent).toContain('Children (2)')
    const link1 = document.querySelector('[data-testid="node-detail-link-child-1"]') as HTMLButtonElement
    const link2 = document.querySelector('[data-testid="node-detail-link-child-2"]') as HTMLButtonElement
    expect(link1.textContent).toBe('child-one')
    expect(link2.textContent).toBe('child-two')
    fireEvent.click(link2)
    expect(onNavigate).toHaveBeenCalledWith('child-2')
  })

  it('renders singular Child label when only one child exists', () => {
    const parent = createSession({ id: 'parent-1', slug: 'parent-task', childIds: ['child-1'] })
    const child = createSession({ id: 'child-1', slug: 'child-task', parentId: 'parent-1' })
    render(
      <NodeDetailPopup
        session={parent}
        sessions={[parent, child]}
        onClose={vi.fn()}
      />,
    )
    const hierarchy = document.querySelector('[data-testid="node-detail-hierarchy"]')
    expect(hierarchy?.textContent).toContain('Child')
    expect(hierarchy?.textContent).not.toContain('Children (')
  })

  it('renders missing child id as non-linkified text', () => {
    const parent = createSession({
      id: 'parent-1',
      slug: 'parent-task',
      childIds: ['missing-child'],
    })
    render(
      <NodeDetailPopup
        session={parent}
        sessions={[parent]}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
      />,
    )
    expect(document.body.innerHTML).toContain('missing-child')
    expect(document.querySelector('[data-testid="node-detail-link-missing-child"]')).toBeNull()
  })

  it('renders DAG id and node status when session belongs to a DAG', () => {
    const session = createSession({ id: 'dag-session-1', slug: 'dag-root' })
    const dag = createDag({
      id: 'my-dag-id',
      nodes: {
        'node-1': {
          id: 'node-1',
          slug: 'dag-root',
          status: 'completed',
          dependencies: [],
          dependents: [],
          session,
        },
      },
    })
    render(
      <NodeDetailPopup
        session={session}
        sessions={[session]}
        dags={[dag]}
        onClose={vi.fn()}
      />,
    )
    const hierarchy = document.querySelector('[data-testid="node-detail-hierarchy"]')
    expect(hierarchy?.textContent).toContain('my-dag-id')
    expect(hierarchy?.textContent).toContain('DAG node')
    expect(hierarchy?.textContent).toContain('Done')
  })

  it('does not render DAG section when session is not part of any DAG', () => {
    const session = createSession()
    const otherSession = createSession({ id: 'other' })
    const dag = createDag({
      id: 'unrelated-dag',
      nodes: {
        'node-1': {
          id: 'node-1',
          slug: 'unrelated',
          status: 'running',
          dependencies: [],
          dependents: [],
          session: otherSession,
        },
      },
    })
    render(
      <NodeDetailPopup
        session={session}
        sessions={[session, otherSession]}
        dags={[dag]}
        onClose={vi.fn()}
      />,
    )
    expect(document.querySelector('[data-testid="node-detail-hierarchy"]')).toBeNull()
    expect(document.body.innerHTML).not.toContain('unrelated-dag')
  })

  it('renders DAG-specific status distinct from session status (landed)', () => {
    const session = createSession({ id: 'dag-session-1', slug: 'dag-tail', status: 'completed' })
    const dag = createDag({
      id: 'ship-dag',
      nodes: {
        'node-1': {
          id: 'node-1',
          slug: 'dag-tail',
          status: 'landed',
          dependencies: [],
          dependents: [],
          session,
        },
      },
    })
    render(
      <NodeDetailPopup
        session={session}
        sessions={[session]}
        dags={[dag]}
        onClose={vi.fn()}
      />,
    )
    expect(document.body.innerHTML).toContain('Landed')
  })

  it('renders children without navigation links when onNavigate is omitted', () => {
    const parent = createSession({ id: 'parent-1', slug: 'parent-task', childIds: ['child-1'] })
    const child = createSession({ id: 'child-1', slug: 'child-task', parentId: 'parent-1' })
    render(
      <NodeDetailPopup
        session={parent}
        sessions={[parent, child]}
        onClose={vi.fn()}
      />,
    )
    expect(document.body.innerHTML).toContain('child-task')
    expect(document.querySelector('[data-testid="node-detail-link-child-1"]')).toBeNull()
  })

  it('closes on Escape key', () => {
    const onClose = vi.fn()
    const session = createSession()
    render(<NodeDetailPopup session={session} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
