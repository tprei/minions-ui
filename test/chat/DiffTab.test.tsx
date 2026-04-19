import { render, screen, fireEvent, waitFor, act } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DiffTab } from '../../src/chat/DiffTab'
import type { ApiClient } from '../../src/api/client'
import type { WorkspaceDiff } from '../../src/api/types'

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
    openEventStream: vi.fn(() => ({ close: vi.fn(), status: { value: 'live' } })) as unknown as ApiClient['openEventStream'],
    ...overrides,
  } as ApiClient
}

const SAMPLE_DIFF: WorkspaceDiff = {
  sessionId: 's-1',
  branch: 'feature',
  baseBranch: 'main',
  patch: [
    'diff --git a/foo.ts b/foo.ts',
    '--- a/foo.ts',
    '+++ b/foo.ts',
    '@@ -1,2 +1,3 @@',
    ' keep',
    '-old',
    '+new',
    '+extra',
  ].join('\n'),
  truncated: false,
  stats: { filesChanged: 1, insertions: 2, deletions: 1 },
}

beforeEach(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    })
  }
})

describe('DiffTab', () => {
  it('shows loading state then renders diff', async () => {
    let resolve: (v: WorkspaceDiff) => void
    const getDiff = vi.fn().mockReturnValue(new Promise<WorkspaceDiff>((r) => { resolve = r }))
    const client = makeClient({ getDiff })
    render(<DiffTab sessionId="s-1" sessionUpdatedAt="2026-04-19T00:00:00Z" client={client} />)
    expect(screen.getByTestId('diff-loading')).toBeTruthy()
    act(() => { resolve!(SAMPLE_DIFF) })
    await waitFor(() => expect(screen.getByTestId('diff-tab')).toBeTruthy())
    expect(screen.getByText(/feature/)).toBeTruthy()
    const tab = screen.getByTestId('diff-tab')
    expect(tab.textContent).toContain('+2')
    expect(tab.textContent).toContain('-1')
  })

  it('renders add/del/context lines with correct test ids', async () => {
    const getDiff = vi.fn().mockResolvedValue(SAMPLE_DIFF)
    const client = makeClient({ getDiff })
    render(<DiffTab sessionId="s-1" sessionUpdatedAt="t1" client={client} />)
    await waitFor(() => expect(screen.getByTestId('diff-tab')).toBeTruthy())
    expect(screen.getAllByTestId('diff-line-add')).toHaveLength(2)
    expect(screen.getAllByTestId('diff-line-del')).toHaveLength(1)
    expect(screen.getAllByTestId('diff-line-context')).toHaveLength(1)
  })

  it('shows error state when fetch fails', async () => {
    const getDiff = vi.fn().mockRejectedValue(new Error('boom'))
    const client = makeClient({ getDiff })
    render(<DiffTab sessionId="s-1" sessionUpdatedAt="t1" client={client} />)
    await waitFor(() => expect(screen.getByTestId('diff-error')).toBeTruthy())
    expect(screen.getByText(/boom/)).toBeTruthy()
  })

  it('shows truncated banner when diff is truncated', async () => {
    const getDiff = vi.fn().mockResolvedValue({ ...SAMPLE_DIFF, truncated: true })
    const client = makeClient({ getDiff })
    render(<DiffTab sessionId="s-1" sessionUpdatedAt="t1" client={client} />)
    await waitFor(() => expect(screen.getByTestId('diff-truncated-banner')).toBeTruthy())
  })

  it('refetches when sessionUpdatedAt changes', async () => {
    const getDiff = vi.fn().mockResolvedValue(SAMPLE_DIFF)
    const client = makeClient({ getDiff })
    const { rerender } = render(<DiffTab sessionId="s-1" sessionUpdatedAt="t1" client={client} />)
    await waitFor(() => expect(getDiff).toHaveBeenCalledTimes(1))
    rerender(<DiffTab sessionId="s-1" sessionUpdatedAt="t2" client={client} />)
    await waitFor(() => expect(getDiff).toHaveBeenCalledTimes(2))
  })

  it('copies patch to clipboard when Copy button is clicked', async () => {
    const getDiff = vi.fn().mockResolvedValue(SAMPLE_DIFF)
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const client = makeClient({ getDiff })
    render(<DiffTab sessionId="s-1" sessionUpdatedAt="t1" client={client} />)
    await waitFor(() => expect(screen.getByTestId('diff-copy-btn')).toBeTruthy())
    fireEvent.click(screen.getByTestId('diff-copy-btn'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SAMPLE_DIFF.patch))
  })

  it('collapses and expands per-file sections', async () => {
    const getDiff = vi.fn().mockResolvedValue(SAMPLE_DIFF)
    const client = makeClient({ getDiff })
    render(<DiffTab sessionId="s-1" sessionUpdatedAt="t1" client={client} />)
    await waitFor(() => expect(screen.getByTestId('diff-tab')).toBeTruthy())
    expect(screen.getAllByTestId('diff-line-add').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByTestId('diff-file-toggle'))
    await waitFor(() => expect(screen.queryByTestId('diff-line-add')).toBeNull())
  })

  it('shows empty state when no files changed', async () => {
    const getDiff = vi.fn().mockResolvedValue({
      ...SAMPLE_DIFF,
      patch: '',
      stats: { filesChanged: 0, insertions: 0, deletions: 0 },
    })
    const client = makeClient({ getDiff })
    render(<DiffTab sessionId="s-1" sessionUpdatedAt="t1" client={client} />)
    await waitFor(() => expect(screen.getByTestId('diff-empty')).toBeTruthy())
  })
})
