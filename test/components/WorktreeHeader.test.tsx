import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/preact'
import { signal } from '@preact/signals'
import { WorktreeHeader, truncateCwd } from '../../src/components/WorktreeHeader'
import type { ConnectionStore, DiffStats } from '../../src/state/types'
import type { ApiSession, VersionInfo } from '../../src/api/types'

function makeSession(over: Partial<ApiSession> = {}): ApiSession {
  return {
    id: 's1',
    slug: 'brave-fox',
    status: 'running',
    command: '/task foo',
    createdAt: '2026-04-19T00:00:00Z',
    updatedAt: '2026-04-19T00:00:00Z',
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    mode: 'task',
    conversation: [],
    branch: 'feature/x',
    repo: 'https://github.com/acme/widgets',
    ...over,
  }
}

function makeStore(opts: {
  features?: string[]
  initialStats?: Map<string, DiffStats>
  loadDiffStats?: (id: string) => Promise<void>
} = {}): ConnectionStore {
  const version = signal<VersionInfo | null>({
    apiVersion: '1',
    libraryVersion: '1.0.0',
    features: opts.features ?? [],
  })
  const diffStatsBySessionId = signal<Map<string, DiffStats>>(opts.initialStats ?? new Map())
  return {
    connectionId: 'test-conn',
    client: {} as ConnectionStore['client'],
    sessions: signal([]),
    dags: signal([]),
    status: signal('live'),
    error: signal(null),
    version,
    stale: signal(false),
    diffStatsBySessionId,
    loadDiffStats: opts.loadDiffStats ?? (async () => {}),
    refresh: async () => {},
    sendCommand: async () => ({ success: true }),
    dispose: () => {},
  }
}

describe('truncateCwd', () => {
  it('keeps last two segments of a github URL', () => {
    expect(truncateCwd('https://github.com/acme/widgets').display).toBe('acme/widgets')
  })

  it('strips .git suffix', () => {
    expect(truncateCwd('https://github.com/acme/widgets.git').display).toBe('acme/widgets')
  })

  it('strips trailing slashes', () => {
    expect(truncateCwd('/workspace/repos/proj/').display).toBe('repos/proj')
  })

  it('truncates deep paths to last two segments', () => {
    expect(truncateCwd('/a/b/c/d/e').display).toBe('d/e')
  })

  it('returns full path in .full regardless', () => {
    const t = truncateCwd('/a/b/c/d/e')
    expect(t.full).toBe('/a/b/c/d/e')
  })

  it('handles single segment', () => {
    expect(truncateCwd('widgets').display).toBe('widgets')
  })
})

describe('WorktreeHeader', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders branch and truncated cwd', () => {
    const store = makeStore()
    render(<WorktreeHeader session={makeSession()} store={store} />)
    expect(screen.getByTestId('worktree-branch').textContent).toBe('feature/x')
    expect(screen.getByTestId('worktree-cwd').textContent).toBe('acme/widgets')
  })

  it('puts the full repo path in the cwd title attribute', () => {
    const store = makeStore()
    render(<WorktreeHeader session={makeSession()} store={store} />)
    expect(screen.getByTestId('worktree-cwd').getAttribute('title')).toBe(
      'https://github.com/acme/widgets'
    )
  })

  it('returns null when neither branch nor repo is set', () => {
    const store = makeStore()
    const { container } = render(
      <WorktreeHeader session={makeSession({ branch: undefined, repo: undefined })} store={store} />
    )
    expect(container.querySelector('[data-testid="worktree-header"]')).toBeNull()
  })

  it('omits stats badge when diff-viewer feature is disabled', async () => {
    const loadDiffStats = vi.fn().mockResolvedValue(undefined)
    const store = makeStore({ features: [], loadDiffStats })
    render(<WorktreeHeader session={makeSession()} store={store} />)
    expect(screen.queryByTestId('worktree-stats')).toBeNull()
    expect(screen.queryByTestId('worktree-stats-truncated')).toBeNull()
    await Promise.resolve()
    expect(loadDiffStats).not.toHaveBeenCalled()
  })

  it('renders +N −M stats when feature enabled and cache has entry', () => {
    const stats: DiffStats = { filesChanged: 3, insertions: 12, deletions: 4, truncated: false }
    const store = makeStore({
      features: ['diff-viewer'],
      initialStats: new Map([['s1', stats]]),
    })
    render(<WorktreeHeader session={makeSession()} store={store} />)
    const badge = screen.getByTestId('worktree-stats')
    expect(badge.textContent).toContain('+12')
    expect(badge.textContent).toContain('−4')
    expect(badge.getAttribute('title')).toBe('3 files changed, +12 −4')
  })

  it('singularizes the files label when exactly one file changed', () => {
    const stats: DiffStats = { filesChanged: 1, insertions: 2, deletions: 0, truncated: false }
    const store = makeStore({
      features: ['diff-viewer'],
      initialStats: new Map([['s1', stats]]),
    })
    render(<WorktreeHeader session={makeSession()} store={store} />)
    expect(screen.getByTestId('worktree-stats').getAttribute('title')).toBe(
      '1 file changed, +2 −0'
    )
  })

  it('renders "no changes" label when all counters are zero', () => {
    const stats: DiffStats = { filesChanged: 0, insertions: 0, deletions: 0, truncated: false }
    const store = makeStore({
      features: ['diff-viewer'],
      initialStats: new Map([['s1', stats]]),
    })
    render(<WorktreeHeader session={makeSession()} store={store} />)
    expect(screen.getByTestId('worktree-stats').textContent).toContain('no changes')
  })

  it('renders +∞ −∞ when the diff is truncated', () => {
    const stats: DiffStats = { filesChanged: 999, insertions: 0, deletions: 0, truncated: true }
    const store = makeStore({
      features: ['diff-viewer'],
      initialStats: new Map([['s1', stats]]),
    })
    render(<WorktreeHeader session={makeSession()} store={store} />)
    const badge = screen.getByTestId('worktree-stats-truncated')
    expect(badge.textContent).toContain('+∞')
    expect(badge.textContent).toContain('−∞')
    expect(badge.getAttribute('title')).toMatch(/truncated/i)
  })

  it('calls loadDiffStats on mount when feature enabled and cache is empty', async () => {
    const loadDiffStats = vi.fn().mockResolvedValue(undefined)
    const store = makeStore({ features: ['diff-viewer'], loadDiffStats })
    render(<WorktreeHeader session={makeSession()} store={store} />)
    await waitFor(() => expect(loadDiffStats).toHaveBeenCalledWith('s1'))
  })

  it('does not re-fetch when stats are already cached', async () => {
    const loadDiffStats = vi.fn().mockResolvedValue(undefined)
    const stats: DiffStats = { filesChanged: 1, insertions: 1, deletions: 0, truncated: false }
    const store = makeStore({
      features: ['diff-viewer'],
      initialStats: new Map([['s1', stats]]),
      loadDiffStats,
    })
    render(<WorktreeHeader session={makeSession()} store={store} />)
    await Promise.resolve()
    expect(loadDiffStats).not.toHaveBeenCalled()
  })
})
