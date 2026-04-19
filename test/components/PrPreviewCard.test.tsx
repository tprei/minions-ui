import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/preact'
import { PrPreviewCard, rollupChecks, PR_PREVIEW_POLL_MS } from '../../src/components/PrPreviewCard'
import type { PrCheck, PrPreview } from '../../src/api/types'
import type { ApiClient } from '../../src/api/client'

function makePr(overrides: Partial<PrPreview> = {}): PrPreview {
  return {
    number: 42,
    url: 'https://github.com/acme/widgets/pull/42',
    title: 'Add shiny feature',
    body: 'Fixes the **bug** everyone cares about.',
    state: 'open',
    draft: false,
    mergeable: true,
    branch: 'feature/shiny',
    baseBranch: 'main',
    author: 'octocat',
    updatedAt: '2026-04-19T00:00:00Z',
    checks: [],
    ...overrides,
  }
}

function makeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    baseUrl: 'https://example.com',
    token: 't',
    getVersion: vi.fn(),
    getSessions: vi.fn(),
    getDags: vi.fn(),
    sendCommand: vi.fn(),
    sendMessage: vi.fn(),
    createSession: vi.fn(),
    createSessionVariants: vi.fn(),
    getPr: vi.fn(),
    getDiff: vi.fn(),
    listScreenshots: vi.fn(),
    fetchScreenshotBlob: vi.fn(),
    getVapidKey: vi.fn(),
    subscribePush: vi.fn(),
    unsubscribePush: vi.fn(),
    openEventStream: vi.fn(),
    ...overrides,
  } as ApiClient
}

describe('rollupChecks', () => {
  it('buckets every PrCheckStatus into pass/fail/pending/neutral', () => {
    const checks: PrCheck[] = [
      { name: 'a', status: 'success' },
      { name: 'b', status: 'failure' },
      { name: 'c', status: 'action_required' },
      { name: 'd', status: 'timed_out' },
      { name: 'e', status: 'cancelled' },
      { name: 'f', status: 'queued' },
      { name: 'g', status: 'in_progress' },
      { name: 'h', status: 'pending' },
      { name: 'i', status: 'neutral' },
      { name: 'j', status: 'skipped' },
      { name: 'k', status: 'stale' },
    ]
    expect(rollupChecks(checks)).toEqual({ pass: 1, fail: 4, pending: 3, neutral: 3, total: 11 })
  })

  it('returns zero rollup on empty input', () => {
    expect(rollupChecks([])).toEqual({ pass: 0, fail: 0, pending: 0, neutral: 0, total: 0 })
  })
})

describe('PrPreviewCard — loading', () => {
  afterEach(() => cleanup())

  it('shows loading card before fetch resolves', () => {
    const client = makeClient({ getPr: vi.fn(() => new Promise<PrPreview>(() => {})) })
    render(<PrPreviewCard sessionId="s-1" prUrl="https://github.com/a/b/pull/1" client={client} />)
    expect(screen.getByTestId('pr-preview-loading')).toBeTruthy()
  })
})

describe('PrPreviewCard — ready state', () => {
  afterEach(() => cleanup())

  it('renders title, number, state badge, and base←head', async () => {
    const pr = makePr()
    const client = makeClient({ getPr: vi.fn(async () => pr) })
    render(<PrPreviewCard sessionId="s-1" prUrl={pr.url} client={client} />)

    await waitFor(() => expect(screen.getByTestId('pr-preview-card')).toBeTruthy())
    expect(screen.getByTestId('pr-title').textContent).toBe('Add shiny feature')
    expect(screen.getByTestId('pr-number').textContent).toBe('#42')
    expect(screen.getByTestId('pr-state-badge').textContent).toBe('OPEN')
    const branches = screen.getByTestId('pr-branches').textContent ?? ''
    expect(branches).toContain('main')
    expect(branches).toContain('feature/shiny')
  })

  it('shows DRAFT pill when draft=true', async () => {
    const pr = makePr({ draft: true })
    const client = makeClient({ getPr: vi.fn(async () => pr) })
    render(<PrPreviewCard sessionId="s-1" prUrl={pr.url} client={client} />)
    await waitFor(() => expect(screen.getByTestId('pr-draft-pill')).toBeTruthy())
  })

  it('renders MERGED badge for merged state', async () => {
    const pr = makePr({ state: 'merged' })
    const client = makeClient({ getPr: vi.fn(async () => pr) })
    render(<PrPreviewCard sessionId="s-1" prUrl={pr.url} client={client} />)
    await waitFor(() => expect(screen.getByTestId('pr-state-badge').textContent).toBe('MERGED'))
  })

  it('renders CLOSED badge for closed state', async () => {
    const pr = makePr({ state: 'closed' })
    const client = makeClient({ getPr: vi.fn(async () => pr) })
    render(<PrPreviewCard sessionId="s-1" prUrl={pr.url} client={client} />)
    await waitFor(() => expect(screen.getByTestId('pr-state-badge').textContent).toBe('CLOSED'))
  })

  it('surfaces conflicts when mergeable is false', async () => {
    const pr = makePr({ mergeable: false })
    const client = makeClient({ getPr: vi.fn(async () => pr) })
    render(<PrPreviewCard sessionId="s-1" prUrl={pr.url} client={client} />)
    await waitFor(() => expect(screen.getByTestId('pr-mergeable-conflict')).toBeTruthy())
  })

  it('renders author login', async () => {
    const pr = makePr({ author: 'hubot' })
    const client = makeClient({ getPr: vi.fn(async () => pr) })
    render(<PrPreviewCard sessionId="s-1" prUrl={pr.url} client={client} />)
    await waitFor(() => expect(screen.getByTestId('pr-author').textContent).toContain('hubot'))
  })

  it('renders checks roll-up', async () => {
    const pr = makePr({
      checks: [
        { name: 'lint', status: 'success' },
        { name: 'test', status: 'success' },
        { name: 'build', status: 'failure' },
        { name: 'deploy', status: 'in_progress' },
      ],
    })
    const client = makeClient({ getPr: vi.fn(async () => pr) })
    render(<PrPreviewCard sessionId="s-1" prUrl={pr.url} client={client} />)
    await waitFor(() => expect(screen.getByTestId('pr-checks-summary')).toBeTruthy())
    expect(screen.getByTestId('pr-checks-pass').textContent).toContain('2 pass')
    expect(screen.getByTestId('pr-checks-fail').textContent).toContain('1 fail')
    expect(screen.getByTestId('pr-checks-pending').textContent).toContain('1 pending')
  })

  it('renders "no checks" when none attached', async () => {
    const pr = makePr({ checks: [] })
    const client = makeClient({ getPr: vi.fn(async () => pr) })
    render(<PrPreviewCard sessionId="s-1" prUrl={pr.url} client={client} />)
    await waitFor(() => expect(screen.getByTestId('pr-checks-empty')).toBeTruthy())
  })

  it('toggles the PR body (markdown-rendered) when expand button clicked', async () => {
    const pr = makePr({ body: 'Fixes the **bug** everyone cares about.' })
    const client = makeClient({ getPr: vi.fn(async () => pr) })
    render(<PrPreviewCard sessionId="s-1" prUrl={pr.url} client={client} />)
    await waitFor(() => expect(screen.getByTestId('pr-body-toggle')).toBeTruthy())
    expect(screen.queryByTestId('pr-body')).toBeNull()

    fireEvent.click(screen.getByTestId('pr-body-toggle'))
    const body = screen.getByTestId('pr-body')
    expect(body.innerHTML).toContain('<strong>bug</strong>')
  })

  it('omits the body toggle when the body is empty', async () => {
    const pr = makePr({ body: '' })
    const client = makeClient({ getPr: vi.fn(async () => pr) })
    render(<PrPreviewCard sessionId="s-1" prUrl={pr.url} client={client} />)
    await waitFor(() => expect(screen.getByTestId('pr-preview-card')).toBeTruthy())
    expect(screen.queryByTestId('pr-body-toggle')).toBeNull()
  })
})

describe('PrPreviewCard — error state', () => {
  afterEach(() => cleanup())

  it('renders an error card and retry link when getPr rejects', async () => {
    const client = makeClient({ getPr: vi.fn(async () => { throw new Error('boom') }) })
    render(<PrPreviewCard sessionId="s-1" prUrl="https://github.com/a/b/pull/1" client={client} />)
    await waitFor(() => expect(screen.getByTestId('pr-preview-error')).toBeTruthy())
    expect(screen.getByTestId('pr-preview-error').textContent).toContain('boom')
    expect(screen.getByTestId('pr-preview-retry')).toBeTruthy()
  })

  it('retry re-invokes getPr and can transition to ready state', async () => {
    let calls = 0
    const pr = makePr()
    const getPr = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error('nope')
      return pr
    })
    const client = makeClient({ getPr })
    render(<PrPreviewCard sessionId="s-1" prUrl={pr.url} client={client} />)
    await waitFor(() => expect(screen.getByTestId('pr-preview-error')).toBeTruthy())
    fireEvent.click(screen.getByTestId('pr-preview-retry'))
    await waitFor(() => expect(screen.getByTestId('pr-preview-card')).toBeTruthy())
    expect(getPr).toHaveBeenCalledTimes(2)
  })
})

describe('PrPreviewCard — polling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('re-polls every PR_PREVIEW_POLL_MS while the PR is open', async () => {
    const pr = makePr({ state: 'open' })
    const getPr = vi.fn(async () => pr)
    const client = makeClient({ getPr })
    render(<PrPreviewCard sessionId="s-1" prUrl={pr.url} client={client} />)

    await vi.waitFor(() => expect(getPr).toHaveBeenCalledTimes(1))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PR_PREVIEW_POLL_MS)
    })
    expect(getPr).toHaveBeenCalledTimes(2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PR_PREVIEW_POLL_MS)
    })
    expect(getPr).toHaveBeenCalledTimes(3)
  })

  it('stops polling once the PR transitions to merged', async () => {
    let callCount = 0
    const getPr = vi.fn(async () => {
      callCount += 1
      return makePr({ state: callCount >= 2 ? 'merged' : 'open' })
    })
    const client = makeClient({ getPr })
    render(<PrPreviewCard sessionId="s-1" prUrl="https://github.com/a/b/pull/1" client={client} />)

    await vi.waitFor(() => expect(getPr).toHaveBeenCalledTimes(1))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PR_PREVIEW_POLL_MS)
    })
    expect(getPr).toHaveBeenCalledTimes(2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PR_PREVIEW_POLL_MS * 3)
    })
    expect(getPr).toHaveBeenCalledTimes(2)
  })

  it('teardown on unmount aborts pending polls', async () => {
    const pr = makePr({ state: 'open' })
    const getPr = vi.fn(async () => pr)
    const client = makeClient({ getPr })
    const { unmount } = render(
      <PrPreviewCard sessionId="s-1" prUrl={pr.url} client={client} />
    )
    await vi.waitFor(() => expect(getPr).toHaveBeenCalledTimes(1))
    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PR_PREVIEW_POLL_MS * 5)
    })
    expect(getPr).toHaveBeenCalledTimes(1)
  })
})
