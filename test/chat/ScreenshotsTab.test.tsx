import { render, screen, fireEvent, waitFor, act } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ScreenshotsTab } from '../../src/chat/ScreenshotsTab'
import type { ApiClient } from '../../src/api/client'
import type { ScreenshotEntry, ScreenshotList } from '../../src/api/types'

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

function makeEntry(file: string, capturedAt = '2026-04-19T00:00:00Z'): ScreenshotEntry {
  return { file, url: `/api/screenshots/${file}`, capturedAt, size: 100 }
}

let createdUrls: string[] = []
let revokedUrls: string[] = []

beforeEach(() => {
  createdUrls = []
  revokedUrls = []
  let counter = 0
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn((_blob: Blob) => {
      const url = `blob:mock-${counter++}`
      createdUrls.push(url)
      return url
    }),
    revokeObjectURL: vi.fn((url: string) => {
      revokedUrls.push(url)
    }),
  })
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    })
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ScreenshotsTab', () => {
  it('shows loading state then renders thumbnails', async () => {
    let resolveList: (v: ScreenshotList) => void
    const listScreenshots = vi.fn().mockReturnValue(
      new Promise<ScreenshotList>((r) => { resolveList = r })
    )
    const fetchScreenshotBlob = vi.fn().mockResolvedValue(new Blob(['fake'], { type: 'image/png' }))
    const client = makeClient({ listScreenshots, fetchScreenshotBlob })

    render(<ScreenshotsTab sessionId="s-1" sessionUpdatedAt="t1" client={client} />)
    expect(screen.getByTestId('screenshots-loading')).toBeTruthy()

    act(() => {
      resolveList!({ sessionId: 's-1', screenshots: [makeEntry('a.png'), makeEntry('b.png')] })
    })
    await waitFor(() => expect(screen.getByTestId('screenshots-tab')).toBeTruthy())
    expect(screen.getAllByTestId('screenshot-thumb')).toHaveLength(2)
    await waitFor(() => expect(fetchScreenshotBlob).toHaveBeenCalledTimes(2))
  })

  it('renders empty state when no screenshots', async () => {
    const listScreenshots = vi.fn().mockResolvedValue({ sessionId: 's-1', screenshots: [] })
    const client = makeClient({ listScreenshots })
    render(<ScreenshotsTab sessionId="s-1" sessionUpdatedAt="t1" client={client} />)
    await waitFor(() => expect(screen.getByTestId('screenshots-empty')).toBeTruthy())
  })

  it('shows error when list fetch fails', async () => {
    const listScreenshots = vi.fn().mockRejectedValue(new Error('nope'))
    const client = makeClient({ listScreenshots })
    render(<ScreenshotsTab sessionId="s-1" sessionUpdatedAt="t1" client={client} />)
    await waitFor(() => expect(screen.getByTestId('screenshots-error')).toBeTruthy())
    expect(screen.getByText(/nope/)).toBeTruthy()
  })

  it('creates blob URLs for screenshots and revokes them on unmount', async () => {
    const listScreenshots = vi.fn().mockResolvedValue({
      sessionId: 's-1',
      screenshots: [makeEntry('a.png'), makeEntry('b.png')],
    })
    const fetchScreenshotBlob = vi.fn().mockResolvedValue(new Blob(['x'], { type: 'image/png' }))
    const client = makeClient({ listScreenshots, fetchScreenshotBlob })
    const { unmount } = render(
      <ScreenshotsTab sessionId="s-1" sessionUpdatedAt="t1" client={client} />
    )
    await waitFor(() => expect(createdUrls.length).toBe(2))
    unmount()
    expect(revokedUrls).toEqual(expect.arrayContaining(createdUrls))
    expect(revokedUrls.length).toBe(createdUrls.length)
  })

  it('revokes blob URLs for files no longer in the list after refetch', async () => {
    let call = 0
    const listScreenshots = vi.fn().mockImplementation(() => {
      call++
      if (call === 1) {
        return Promise.resolve({
          sessionId: 's-1',
          screenshots: [makeEntry('a.png'), makeEntry('b.png')],
        })
      }
      return Promise.resolve({ sessionId: 's-1', screenshots: [makeEntry('a.png')] })
    })
    const fetchScreenshotBlob = vi.fn().mockResolvedValue(new Blob(['x']))
    const client = makeClient({ listScreenshots, fetchScreenshotBlob })

    const { rerender } = render(
      <ScreenshotsTab sessionId="s-1" sessionUpdatedAt="t1" client={client} />
    )
    await waitFor(() => expect(createdUrls.length).toBe(2))
    const initialUrls = [...createdUrls]

    rerender(<ScreenshotsTab sessionId="s-1" sessionUpdatedAt="t2" client={client} />)
    await waitFor(() => expect(revokedUrls.length).toBeGreaterThanOrEqual(1))
    expect(revokedUrls).toContain(initialUrls[1])
  })

  it('opens lightbox on thumb click and closes on close button', async () => {
    const listScreenshots = vi.fn().mockResolvedValue({
      sessionId: 's-1',
      screenshots: [makeEntry('a.png')],
    })
    const fetchScreenshotBlob = vi.fn().mockResolvedValue(new Blob(['x']))
    const client = makeClient({ listScreenshots, fetchScreenshotBlob })
    render(<ScreenshotsTab sessionId="s-1" sessionUpdatedAt="t1" client={client} />)
    await waitFor(() => expect(screen.getByTestId('screenshot-thumb')).toBeTruthy())
    fireEvent.click(screen.getByTestId('screenshot-thumb'))
    expect(screen.getByTestId('screenshot-lightbox')).toBeTruthy()
    fireEvent.click(screen.getByTestId('screenshot-lightbox-close'))
    expect(screen.queryByTestId('screenshot-lightbox')).toBeNull()
  })

  it('navigates with next/prev buttons when multiple screenshots', async () => {
    const listScreenshots = vi.fn().mockResolvedValue({
      sessionId: 's-1',
      screenshots: [makeEntry('a.png'), makeEntry('b.png'), makeEntry('c.png')],
    })
    const fetchScreenshotBlob = vi.fn().mockResolvedValue(new Blob(['x']))
    const client = makeClient({ listScreenshots, fetchScreenshotBlob })
    render(<ScreenshotsTab sessionId="s-1" sessionUpdatedAt="t1" client={client} />)
    await waitFor(() => expect(screen.getAllByTestId('screenshot-thumb')).toHaveLength(3))
    fireEvent.click(screen.getAllByTestId('screenshot-thumb')[0])
    const lightbox = screen.getByTestId('screenshot-lightbox')
    expect(lightbox.textContent).toContain('a.png')
    fireEvent.click(screen.getByTestId('screenshot-lightbox-next'))
    expect(screen.getByTestId('screenshot-lightbox').textContent).toContain('b.png')
    fireEvent.click(screen.getByTestId('screenshot-lightbox-prev'))
    expect(screen.getByTestId('screenshot-lightbox').textContent).toContain('a.png')
  })

  it('refetches when sessionUpdatedAt changes', async () => {
    const listScreenshots = vi.fn().mockResolvedValue({ sessionId: 's-1', screenshots: [] })
    const client = makeClient({ listScreenshots })
    const { rerender } = render(<ScreenshotsTab sessionId="s-1" sessionUpdatedAt="t1" client={client} />)
    await waitFor(() => expect(listScreenshots).toHaveBeenCalledTimes(1))
    rerender(<ScreenshotsTab sessionId="s-1" sessionUpdatedAt="t2" client={client} />)
    await waitFor(() => expect(listScreenshots).toHaveBeenCalledTimes(2))
  })
})
