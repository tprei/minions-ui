import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn()
  }
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
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

  it('syntax-highlights code tokens for known languages', async () => {
    const tsDiff: WorkspaceDiff = {
      branch: 'feature',
      baseBranch: 'main',
      patch: [
        'diff --git a/foo.ts b/foo.ts',
        '--- a/foo.ts',
        '+++ b/foo.ts',
        '@@ -1,1 +1,2 @@',
        ' const x = 1',
        '+const y = "hello"',
      ].join('\n'),
      truncated: false,
      stats: { filesChanged: 1, insertions: 1, deletions: 0 },
    }
    const getDiff = vi.fn().mockResolvedValue(tsDiff)
    const client = makeClient({ getDiff })
    render(<DiffTab sessionId="s-1" sessionUpdatedAt="t1" client={client} />)
    await waitFor(() => expect(screen.getByTestId('diff-tab')).toBeTruthy())
    const addLine = screen.getByTestId('diff-line-add')
    const kwSpan = Array.from(addLine.querySelectorAll('span')).find(
      (s) => s.textContent === 'const' && s.className.includes('violet'),
    )
    expect(kwSpan).toBeTruthy()
    const strSpan = Array.from(addLine.querySelectorAll('span')).find(
      (s) => s.textContent === '"hello"' && s.className.includes('amber'),
    )
    expect(strSpan).toBeTruthy()
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

const MULTI_FILE_DIFF: WorkspaceDiff = {
  branch: 'feature',
  baseBranch: 'main',
  patch: [
    'diff --git a/src/foo.ts b/src/foo.ts',
    '--- a/src/foo.ts',
    '+++ b/src/foo.ts',
    '@@ -1,2 +1,3 @@',
    ' keep',
    '-old',
    '+new',
    '+extra',
    'diff --git a/src/bar.ts b/src/bar.ts',
    '--- a/src/bar.ts',
    '+++ b/src/bar.ts',
    '@@ -1,1 +1,1 @@',
    '-removed',
    '+added',
    'diff --git a/README.md b/README.md',
    '--- a/README.md',
    '+++ b/README.md',
    '@@ -1,1 +1,2 @@',
    ' line',
    '+more',
  ].join('\n'),
  truncated: false,
  stats: { filesChanged: 3, insertions: 4, deletions: 2 },
}

describe('DiffTab — file tree', () => {
  it('renders the file tree with directory and file rows', async () => {
    const getDiff = vi.fn().mockResolvedValue(MULTI_FILE_DIFF)
    const client = makeClient({ getDiff })
    render(<DiffTab sessionId="s-tree" sessionUpdatedAt="t1" client={client} />)
    await waitFor(() => expect(screen.getByTestId('diff-tab')).toBeTruthy())
    fireEvent.click(screen.getByTestId('diff-tree-toggle'))
    expect(screen.getByTestId('diff-tree')).toBeTruthy()
    const fileRows = screen.getAllByTestId('diff-tree-file')
    expect(fileRows.map((r) => r.getAttribute('data-file-path'))).toEqual(
      expect.arrayContaining(['src/foo.ts', 'src/bar.ts', 'README.md']),
    )
    expect(screen.getAllByTestId('diff-tree-dir').length).toBeGreaterThan(0)
  })

  it('toggles tree visibility via the Files button', async () => {
    const getDiff = vi.fn().mockResolvedValue(MULTI_FILE_DIFF)
    const client = makeClient({ getDiff })
    render(<DiffTab sessionId="s-tree" sessionUpdatedAt="t1" client={client} />)
    await waitFor(() => expect(screen.getByTestId('diff-tab')).toBeTruthy())
    expect(screen.queryByTestId('diff-tree')).toBeNull()
    fireEvent.click(screen.getByTestId('diff-tree-toggle'))
    expect(screen.getByTestId('diff-tree')).toBeTruthy()
    fireEvent.click(screen.getByTestId('diff-tree-toggle'))
    expect(screen.queryByTestId('diff-tree')).toBeNull()
  })

  it('clicking a file in the tree scrolls its file section into view', async () => {
    const scrollSpy = vi.fn()
    Element.prototype.scrollIntoView = scrollSpy
    const getDiff = vi.fn().mockResolvedValue(MULTI_FILE_DIFF)
    const client = makeClient({ getDiff })
    render(<DiffTab sessionId="s-tree" sessionUpdatedAt="t1" client={client} />)
    await waitFor(() => expect(screen.getByTestId('diff-tab')).toBeTruthy())
    fireEvent.click(screen.getByTestId('diff-tree-toggle'))
    const target = screen
      .getAllByTestId('diff-tree-file')
      .find((r) => r.getAttribute('data-file-path') === 'src/bar.ts')
    expect(target).toBeTruthy()
    fireEvent.click(target!)
    expect(scrollSpy).toHaveBeenCalled()
  })

  it('hides the file tree when no files are changed', async () => {
    const getDiff = vi.fn().mockResolvedValue({
      ...SAMPLE_DIFF,
      patch: '',
      stats: { filesChanged: 0, insertions: 0, deletions: 0 },
    })
    const client = makeClient({ getDiff })
    render(<DiffTab sessionId="s-tree-empty" sessionUpdatedAt="t1" client={client} />)
    await waitFor(() => expect(screen.getByTestId('diff-empty')).toBeTruthy())
    expect(screen.queryByTestId('diff-tree-toggle')).toBeNull()
  })

  it('summary shows the standard "+X -Y across N files" format', async () => {
    const getDiff = vi.fn().mockResolvedValue(MULTI_FILE_DIFF)
    const client = makeClient({ getDiff })
    render(<DiffTab sessionId="s-summary" sessionUpdatedAt="t1" client={client} />)
    await waitFor(() => expect(screen.getByTestId('diff-tab')).toBeTruthy())
    const summary = screen.getByTestId('diff-stats-summary')
    expect(summary.textContent).toMatch(/\+4/)
    expect(summary.textContent).toMatch(/-2/)
    expect(summary.textContent).toMatch(/across/)
    expect(summary.textContent).toMatch(/3 files/)
  })
})

describe('DiffTab — viewed checkbox', () => {
  it('marks a file viewed and collapses its hunks', async () => {
    const getDiff = vi.fn().mockResolvedValue(MULTI_FILE_DIFF)
    const client = makeClient({ getDiff })
    render(<DiffTab sessionId="s-viewed" sessionUpdatedAt="t1" client={client} />)
    await waitFor(() => expect(screen.getByTestId('diff-tab')).toBeTruthy())
    const checkboxes = screen.getAllByTestId('diff-file-viewed') as HTMLInputElement[]
    expect(checkboxes).toHaveLength(3)
    expect(screen.getAllByTestId('diff-line-add').length).toBeGreaterThan(0)
    fireEvent.click(checkboxes[0])
    fireEvent.click(checkboxes[1])
    fireEvent.click(checkboxes[2])
    await waitFor(() => expect(screen.queryByTestId('diff-line-add')).toBeNull())
  })

  it('reflects viewed count in the toolbar (X / Y viewed)', async () => {
    const getDiff = vi.fn().mockResolvedValue(MULTI_FILE_DIFF)
    const client = makeClient({ getDiff })
    render(<DiffTab sessionId="s-count" sessionUpdatedAt="t1" client={client} />)
    await waitFor(() => expect(screen.getByTestId('diff-tab')).toBeTruthy())
    expect(screen.getByTestId('diff-stats-viewed').textContent).toMatch(/0\s*\/\s*3/)
    const checkboxes = screen.getAllByTestId('diff-file-viewed') as HTMLInputElement[]
    fireEvent.click(checkboxes[0])
    await waitFor(() =>
      expect(screen.getByTestId('diff-stats-viewed').textContent).toMatch(/1\s*\/\s*3/),
    )
  })

  it('persists viewed state per session in localStorage and restores on remount', async () => {
    const getDiff = vi.fn().mockResolvedValue(MULTI_FILE_DIFF)
    const client = makeClient({ getDiff })
    const first = render(<DiffTab sessionId="persist-A" sessionUpdatedAt="t1" client={client} />)
    await waitFor(() => expect(screen.getByTestId('diff-tab')).toBeTruthy())
    fireEvent.click(screen.getAllByTestId('diff-file-viewed')[0])
    await waitFor(() => {
      expect(window.localStorage.getItem('minions-ui:diff-viewed:persist-A')).toBeTruthy()
    })
    first.unmount()
    cleanup()
    render(<DiffTab sessionId="persist-A" sessionUpdatedAt="t2" client={client} />)
    await waitFor(() => expect(screen.getByTestId('diff-tab')).toBeTruthy())
    const remounted = screen.getAllByTestId('diff-file-viewed') as HTMLInputElement[]
    expect(remounted.filter((c) => c.checked)).toHaveLength(1)
  })

  it('does not leak viewed state across different sessionIds', async () => {
    const getDiff = vi.fn().mockResolvedValue(MULTI_FILE_DIFF)
    const client = makeClient({ getDiff })
    const a = render(<DiffTab sessionId="iso-A" sessionUpdatedAt="t1" client={client} />)
    await waitFor(() => expect(screen.getByTestId('diff-tab')).toBeTruthy())
    fireEvent.click(screen.getAllByTestId('diff-file-viewed')[0])
    await waitFor(() => {
      expect(window.localStorage.getItem('minions-ui:diff-viewed:iso-A')).toBeTruthy()
    })
    a.unmount()
    cleanup()
    render(<DiffTab sessionId="iso-B" sessionUpdatedAt="t1" client={client} />)
    await waitFor(() => expect(screen.getByTestId('diff-tab')).toBeTruthy())
    const checkboxes = screen.getAllByTestId('diff-file-viewed') as HTMLInputElement[]
    expect(checkboxes.every((c) => !c.checked)).toBe(true)
  })
})

describe('DiffTab — line comments', () => {
  it('adds a comment via the inline composer and renders it under the line', async () => {
    const getDiff = vi.fn().mockResolvedValue(SAMPLE_DIFF)
    const client = makeClient({ getDiff })
    render(<DiffTab sessionId="s-comm" sessionUpdatedAt="t1" client={client} />)
    await waitFor(() => expect(screen.getByTestId('diff-tab')).toBeTruthy())
    const addBtns = screen.getAllByTestId('diff-comment-add-btn')
    expect(addBtns.length).toBeGreaterThan(0)
    fireEvent.click(addBtns[0])
    const input = screen.getByTestId('diff-comment-input') as HTMLTextAreaElement
    fireEvent.input(input, { target: { value: 'this looks wrong' } })
    fireEvent.click(screen.getByTestId('diff-comment-submit'))
    await waitFor(() => expect(screen.getByTestId('diff-comment')).toBeTruthy())
    expect(screen.getByTestId('diff-comment').textContent).toContain('this looks wrong')
  })

  it('cancels the composer without adding a comment', async () => {
    const getDiff = vi.fn().mockResolvedValue(SAMPLE_DIFF)
    const client = makeClient({ getDiff })
    render(<DiffTab sessionId="s-cancel" sessionUpdatedAt="t1" client={client} />)
    await waitFor(() => expect(screen.getByTestId('diff-tab')).toBeTruthy())
    fireEvent.click(screen.getAllByTestId('diff-comment-add-btn')[0])
    fireEvent.click(screen.getByTestId('diff-comment-cancel'))
    expect(screen.queryByTestId('diff-comment-input')).toBeNull()
    expect(screen.queryByTestId('diff-comment')).toBeNull()
  })

  it('removes a comment when the delete button is clicked', async () => {
    const getDiff = vi.fn().mockResolvedValue(SAMPLE_DIFF)
    const client = makeClient({ getDiff })
    render(<DiffTab sessionId="s-del" sessionUpdatedAt="t1" client={client} />)
    await waitFor(() => expect(screen.getByTestId('diff-tab')).toBeTruthy())
    fireEvent.click(screen.getAllByTestId('diff-comment-add-btn')[0])
    fireEvent.input(screen.getByTestId('diff-comment-input'), {
      target: { value: 'temporary' },
    })
    fireEvent.click(screen.getByTestId('diff-comment-submit'))
    await waitFor(() => expect(screen.getByTestId('diff-comment')).toBeTruthy())
    fireEvent.click(screen.getByTestId('diff-comment-delete'))
    await waitFor(() => expect(screen.queryByTestId('diff-comment')).toBeNull())
  })

  it('renders comment count badge on the file tree row', async () => {
    const getDiff = vi.fn().mockResolvedValue(SAMPLE_DIFF)
    const client = makeClient({ getDiff })
    render(<DiffTab sessionId="s-tree-count" sessionUpdatedAt="t1" client={client} />)
    await waitFor(() => expect(screen.getByTestId('diff-tab')).toBeTruthy())
    fireEvent.click(screen.getByTestId('diff-tree-toggle'))
    expect(screen.queryByTestId('diff-tree-file-comments')).toBeNull()
    fireEvent.click(screen.getAllByTestId('diff-comment-add-btn')[0])
    fireEvent.input(screen.getByTestId('diff-comment-input'), {
      target: { value: 'note' },
    })
    fireEvent.click(screen.getByTestId('diff-comment-submit'))
    await waitFor(() => expect(screen.getByTestId('diff-tree-file-comments')).toBeTruthy())
    expect(screen.getByTestId('diff-tree-file-comments').textContent).toBe('1')
  })

  it('shows the Copy comments button only when comments exist and copies markdown', async () => {
    const getDiff = vi.fn().mockResolvedValue(SAMPLE_DIFF)
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const client = makeClient({ getDiff })
    render(<DiffTab sessionId="s-cpy-comm" sessionUpdatedAt="t1" client={client} />)
    await waitFor(() => expect(screen.getByTestId('diff-tab')).toBeTruthy())
    expect(screen.queryByTestId('diff-copy-comments-btn')).toBeNull()
    fireEvent.click(screen.getAllByTestId('diff-comment-add-btn')[0])
    fireEvent.input(screen.getByTestId('diff-comment-input'), {
      target: { value: 'review note' },
    })
    fireEvent.click(screen.getByTestId('diff-comment-submit'))
    await waitFor(() => expect(screen.getByTestId('diff-copy-comments-btn')).toBeTruthy())
    fireEvent.click(screen.getByTestId('diff-copy-comments-btn'))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const md = writeText.mock.calls[0][0] as string
    expect(md).toContain('foo.ts')
    expect(md).toContain('review note')
  })

  it('persists comments per session in localStorage', async () => {
    const getDiff = vi.fn().mockResolvedValue(SAMPLE_DIFF)
    const client = makeClient({ getDiff })
    const first = render(<DiffTab sessionId="persist-comm" sessionUpdatedAt="t1" client={client} />)
    await waitFor(() => expect(screen.getByTestId('diff-tab')).toBeTruthy())
    fireEvent.click(screen.getAllByTestId('diff-comment-add-btn')[0])
    fireEvent.input(screen.getByTestId('diff-comment-input'), {
      target: { value: 'persisted note' },
    })
    fireEvent.click(screen.getByTestId('diff-comment-submit'))
    await waitFor(() =>
      expect(window.localStorage.getItem('minions-ui:diff-comments:persist-comm')).toBeTruthy(),
    )
    first.unmount()
    cleanup()
    render(<DiffTab sessionId="persist-comm" sessionUpdatedAt="t2" client={client} />)
    await waitFor(() => expect(screen.getByTestId('diff-tab')).toBeTruthy())
    expect(screen.getByTestId('diff-comment').textContent).toContain('persisted note')
  })
})
