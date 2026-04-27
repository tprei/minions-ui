import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/preact'
import { NodeDetailPopup } from '../../src/components/NodeDetailPopup'
import type { ApiDagGraph, ApiSession, FeedbackMetadata } from '../../src/api/types'

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

  it('renders View Logs button when onViewLogs is provided', () => {
    const session = makeSession({ id: 's-logs', slug: 'logs-slug' })
    const onViewLogs = vi.fn()
    render(
      <NodeDetailPopup
        session={session}
        onClose={vi.fn()}
        onViewLogs={onViewLogs}
        sessions={[session]}
        dags={[]}
      />
    )
    const btn = document.querySelector('[data-testid="node-detail-view-logs-btn"]') as HTMLButtonElement | null
    expect(btn).toBeTruthy()
    fireEvent.click(btn!)
    expect(onViewLogs).toHaveBeenCalledWith('s-logs')
  })

  it('omits View Logs button when onViewLogs is not provided', () => {
    const session = makeSession()
    render(
      <NodeDetailPopup
        session={session}
        onClose={vi.fn()}
        sessions={[session]}
        dags={[]}
      />
    )
    expect(document.querySelector('[data-testid="node-detail-view-logs-btn"]')).toBeFalsy()
  })

  it('renders stage badge for ship coordinator sessions', () => {
    const coordinator = makeSession({
      id: 'coord',
      slug: 'feature-coordinator',
      mode: 'ship',
      stage: 'dag',
    })
    render(
      <NodeDetailPopup
        session={coordinator}
        onClose={vi.fn()}
        sessions={[coordinator]}
        dags={[]}
      />
    )
    const stageBadge = document.querySelector('[data-testid="node-detail-ship-stage"]')
    expect(stageBadge).toBeTruthy()
    expect(stageBadge!.textContent).toContain('dag')
  })

  it('renders workers list with status chips for ship coordinator with children', () => {
    const coordinator = makeSession({
      id: 'coord',
      slug: 'coordinator',
      mode: 'ship',
      stage: 'dag',
      childIds: ['w1', 'w2'],
    })
    const worker1 = makeSession({
      id: 'w1',
      slug: 'worker-one',
      parentId: 'coord',
      status: 'completed',
    })
    const worker2 = makeSession({
      id: 'w2',
      slug: 'worker-two',
      parentId: 'coord',
      status: 'running',
    })
    render(
      <NodeDetailPopup
        session={coordinator}
        onClose={vi.fn()}
        sessions={[coordinator, worker1, worker2]}
        dags={[]}
      />
    )
    const hierarchy = document.querySelector('[data-testid="node-detail-hierarchy"]')!
    expect(hierarchy.innerHTML).toContain('Workers')
    expect(hierarchy.innerHTML).toContain('worker-one')
    expect(hierarchy.innerHTML).toContain('worker-two')
    expect(hierarchy.innerHTML).toContain('Done')
    expect(hierarchy.innerHTML).toContain('Running')
  })

  it('does not render workers as inline links for ship coordinators', () => {
    const coordinator = makeSession({
      id: 'coord',
      slug: 'coordinator',
      mode: 'ship',
      stage: 'plan',
      childIds: ['w1'],
    })
    const worker1 = makeSession({
      id: 'w1',
      slug: 'worker-one',
      parentId: 'coord',
      status: 'pending',
    })
    render(
      <NodeDetailPopup
        session={coordinator}
        onClose={vi.fn()}
        sessions={[coordinator, worker1]}
        dags={[]}
      />
    )
    const hierarchy = document.querySelector('[data-testid="node-detail-hierarchy"]')!
    expect(hierarchy.innerHTML).toContain('Workers')
    expect(hierarchy.innerHTML).not.toContain('Child')
  })

  it('renders rebase conflict error message when DAG node status is rebase-conflict', () => {
    const session = makeSession({ id: 'sess-1', slug: 'conflict-session', status: 'running' })
    const dag = makeDag({
      nodes: {
        'node-a': {
          id: 'node-a',
          slug: 'conflict-session',
          status: 'rebase-conflict',
          dependencies: [],
          dependents: [],
          session,
          error: 'Rebase failed: merge conflict in src/app.ts',
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
    const errorBox = document.querySelector('[data-testid="node-detail-rebase-error"]')
    expect(errorBox).toBeTruthy()
    expect(errorBox!.textContent).toContain('Rebase Conflict')
    expect(errorBox!.textContent).toContain('Rebase failed: merge conflict in src/app.ts')
  })

  it('renders retry rebase button when DAG node status is rebase-conflict', () => {
    const session = makeSession({ id: 'sess-1', slug: 'conflict-session', status: 'running' })
    const dag = makeDag({
      nodes: {
        'node-a': {
          id: 'node-a',
          slug: 'conflict-session',
          status: 'rebase-conflict',
          dependencies: [],
          dependents: [],
          session,
          error: 'Rebase conflict detected',
        },
      },
    })
    const onRetryRebase = vi.fn()
    render(
      <NodeDetailPopup
        session={session}
        onClose={vi.fn()}
        sessions={[session]}
        dags={[dag]}
        onRetryRebase={onRetryRebase}
      />
    )
    const retryBtn = document.querySelector('[data-testid="node-detail-retry-rebase-btn"]') as HTMLButtonElement | null
    expect(retryBtn).toBeTruthy()
    fireEvent.click(retryBtn!)
    expect(onRetryRebase).toHaveBeenCalledWith('dag-xyz', 'node-a')
  })

  it('does not render retry button when onRetryRebase is not provided', () => {
    const session = makeSession({ id: 'sess-1', slug: 'conflict-session', status: 'running' })
    const dag = makeDag({
      nodes: {
        'node-a': {
          id: 'node-a',
          slug: 'conflict-session',
          status: 'rebase-conflict',
          dependencies: [],
          dependents: [],
          session,
          error: 'Rebase conflict detected',
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
    expect(document.querySelector('[data-testid="node-detail-retry-rebase-btn"]')).toBeFalsy()
  })

  it('renders rebasing status indicator when DAG node status is rebasing', () => {
    const session = makeSession({ id: 'sess-1', slug: 'rebasing-session', status: 'running' })
    const dag = makeDag({
      nodes: {
        'node-a': {
          id: 'node-a',
          slug: 'rebasing-session',
          status: 'rebasing',
          dependencies: [],
          dependents: [],
          session,
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
    const rebasingBox = document.querySelector('[data-testid="node-detail-rebasing-status"]')
    expect(rebasingBox).toBeTruthy()
    expect(rebasingBox!.textContent).toContain('Rebasing in progress')
  })

  it('does not render rebase error when no error is present', () => {
    const session = makeSession({ id: 'sess-1', slug: 'conflict-session', status: 'running' })
    const dag = makeDag({
      nodes: {
        'node-a': {
          id: 'node-a',
          slug: 'conflict-session',
          status: 'rebase-conflict',
          dependencies: [],
          dependents: [],
          session,
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
    expect(document.querySelector('[data-testid="node-detail-rebase-error"]')).toBeFalsy()
  })
})

describe('NodeDetailPopup mobile bottom sheet', () => {
  const originalMatchMedia = window.matchMedia

  beforeEach(() => {
    vi.clearAllMocks()
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 767px)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  })

  afterEach(() => {
    cleanup()
    window.matchMedia = originalMatchMedia
  })

  it('renders as bottom sheet on mobile', () => {
    const session = makeSession()
    render(<NodeDetailPopup session={session} onClose={vi.fn()} />)
    const sheet = document.querySelector('.absolute.bottom-0.left-0.right-0')
    expect(sheet).toBeTruthy()
    expect(sheet!.className).toContain('rounded-t-2xl')
  })

  it('shows drag handle on mobile', () => {
    const session = makeSession()
    render(<NodeDetailPopup session={session} onClose={vi.fn()} />)
    const handle = document.querySelector('.w-10.h-1.rounded-full')
    expect(handle).toBeTruthy()
  })

  it('renders as right-side slide-over on desktop', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query !== '(max-width: 767px)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    const session = makeSession()
    const { container } = render(<NodeDetailPopup session={session} onClose={vi.fn()} />)
    const slideover = container.querySelector('[data-testid="node-detail-slideover"]')
    expect(slideover).toBeTruthy()
    expect(slideover!.className).toContain('h-full')
    expect(slideover!.className).toContain('border-l')
    const handle = container.querySelector('.w-10.h-1.rounded-full')
    expect(handle).toBeFalsy()
  })

  it('does not render a backdrop overlay on desktop (canvas stays interactive)', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query !== '(max-width: 767px)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    const session = makeSession()
    const { container } = render(<NodeDetailPopup session={session} onClose={vi.fn()} />)
    const overlays = container.querySelectorAll('[class*="bg-black/"]')
    expect(overlays.length).toBe(0)

    const wrapper = container.querySelector('[role="dialog"]')!.parentElement!
    expect(wrapper.className).toContain('pointer-events-none')
    expect(wrapper.className).toContain('right-0')
  })

  it('desktop slide-over panel itself remains clickable while wrapper passes events through', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query !== '(max-width: 767px)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    const session = makeSession()
    const { container } = render(<NodeDetailPopup session={session} onClose={vi.fn()} />)
    const slideover = container.querySelector('[data-testid="node-detail-slideover"]') as HTMLElement
    expect(slideover.className).toContain('pointer-events-auto')
  })

  it('desktop slide-over closes on Escape key', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query !== '(max-width: 767px)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    const session = makeSession()
    const onClose = vi.fn()
    render(<NodeDetailPopup session={session} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

describe('NodeDetailPopup feedback sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders feedback badge when session has feedback metadata', () => {
    const feedbackMeta: FeedbackMetadata = {
      kind: 'feedback',
      vote: 'down',
      reason: 'incorrect',
      sourceSessionId: 'source-1',
      sourceSessionSlug: 'source-slug',
      sourceMessageBlockId: 'block-123',
    }
    const session = makeSession({
      id: 'feedback-1',
      slug: 'feedback-minion',
      metadata: feedbackMeta as unknown as Record<string, unknown>,
    })
    render(<NodeDetailPopup session={session} onClose={vi.fn()} sessions={[session]} dags={[]} />)
    const badge = document.querySelector('[data-testid="feedback-badge"]')
    expect(badge).toBeTruthy()
    expect(badge!.textContent).toContain('Feedback')
  })

  it('does not render feedback badge for non-feedback sessions', () => {
    const session = makeSession({ id: 's1', slug: 'normal-session' })
    render(<NodeDetailPopup session={session} onClose={vi.fn()} sessions={[session]} dags={[]} />)
    expect(document.querySelector('[data-testid="feedback-badge"]')).toBeFalsy()
  })

  it('renders feedback meta row with thumbs down and reason', () => {
    const feedbackMeta: FeedbackMetadata = {
      kind: 'feedback',
      vote: 'down',
      reason: 'incorrect',
      sourceSessionId: 'source-1',
      sourceSessionSlug: 'source-slug',
      sourceMessageBlockId: 'block-123',
    }
    const sourceSession = makeSession({ id: 'source-1', slug: 'source-slug' })
    const feedbackSession = makeSession({
      id: 'feedback-1',
      slug: 'feedback-minion',
      metadata: feedbackMeta as unknown as Record<string, unknown>,
    })
    render(
      <NodeDetailPopup
        session={feedbackSession}
        onClose={vi.fn()}
        sessions={[sourceSession, feedbackSession]}
        dags={[]}
      />
    )
    const hierarchy = document.querySelector('[data-testid="node-detail-hierarchy"]')
    expect(hierarchy).toBeTruthy()
    expect(hierarchy!.textContent).toContain('👎')
    expect(hierarchy!.textContent).toContain('Incorrect')
    expect(hierarchy!.textContent).toContain('source-slug')
  })

  it('renders feedback meta row with thumbs up', () => {
    const feedbackMeta: FeedbackMetadata = {
      kind: 'feedback',
      vote: 'up',
      sourceSessionId: 'source-1',
      sourceSessionSlug: 'source-slug',
      sourceMessageBlockId: 'block-123',
    }
    const sourceSession = makeSession({ id: 'source-1', slug: 'source-slug' })
    const feedbackSession = makeSession({
      id: 'feedback-1',
      slug: 'feedback-minion',
      metadata: feedbackMeta as unknown as Record<string, unknown>,
    })
    render(
      <NodeDetailPopup
        session={feedbackSession}
        onClose={vi.fn()}
        sessions={[sourceSession, feedbackSession]}
        dags={[]}
      />
    )
    const hierarchy = document.querySelector('[data-testid="node-detail-hierarchy"]')
    expect(hierarchy).toBeTruthy()
    expect(hierarchy!.textContent).toContain('👍')
  })

  it('renders all feedback reason labels correctly', () => {
    const reasons: Array<{ reason: FeedbackMetadata['reason']; label: string }> = [
      { reason: 'incorrect', label: 'Incorrect' },
      { reason: 'off_topic', label: 'Off Topic' },
      { reason: 'too_verbose', label: 'Too Verbose' },
      { reason: 'unsafe', label: 'Unsafe' },
      { reason: 'other', label: 'Other' },
    ]

    reasons.forEach(({ reason, label }) => {
      const feedbackMeta: FeedbackMetadata = {
        kind: 'feedback',
        vote: 'down',
        reason,
        sourceSessionId: 'source-1',
        sourceSessionSlug: 'source-slug',
        sourceMessageBlockId: 'block-123',
      }
      const session = makeSession({ id: 'fb-1', slug: 'feedback-minion', metadata: feedbackMeta as unknown as Record<string, unknown> })
      const { container } = render(<NodeDetailPopup session={session} onClose={vi.fn()} sessions={[session]} dags={[]} />)
      expect(container.textContent).toContain(label)
      cleanup()
    })
  })

  it('renders comment when present', () => {
    const feedbackMeta: FeedbackMetadata = {
      kind: 'feedback',
      vote: 'down',
      reason: 'other',
      comment: 'This was not what I expected',
      sourceSessionId: 'source-1',
      sourceSessionSlug: 'source-slug',
      sourceMessageBlockId: 'block-123',
    }
    const session = makeSession({ id: 'fb-1', slug: 'feedback-minion', metadata: feedbackMeta as unknown as Record<string, unknown> })
    render(<NodeDetailPopup session={session} onClose={vi.fn()} sessions={[session]} dags={[]} />)
    expect(document.body.textContent).toContain('This was not what I expected')
  })

  it('clicking source session link navigates to source session', () => {
    const feedbackMeta: FeedbackMetadata = {
      kind: 'feedback',
      vote: 'down',
      reason: 'incorrect',
      sourceSessionId: 'source-1',
      sourceSessionSlug: 'source-slug',
      sourceMessageBlockId: 'block-123',
    }
    const sourceSession = makeSession({ id: 'source-1', slug: 'source-slug' })
    const feedbackSession = makeSession({
      id: 'feedback-1',
      slug: 'feedback-minion',
      metadata: feedbackMeta as unknown as Record<string, unknown>,
    })
    const onSelectSession = vi.fn()
    render(
      <NodeDetailPopup
        session={feedbackSession}
        onClose={vi.fn()}
        sessions={[sourceSession, feedbackSession]}
        dags={[]}
        onSelectSession={onSelectSession}
      />
    )
    const link = document.querySelector('[data-testid="node-detail-session-link-source-1"]') as HTMLButtonElement
    expect(link).toBeTruthy()
    fireEvent.click(link)
    expect(onSelectSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'source-1' }))
  })
})
