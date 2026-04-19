import { render, screen, fireEvent, within } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { installMockEventSource } from './sse-mock'
import type { VersionInfo, ApiSession, RepoEntry } from '../src/api/types'

vi.mock('virtual:pwa-register/preact', () => ({
  useRegisterSW: vi.fn().mockReturnValue({}),
}))

vi.mock('idb-keyval', () => ({
  get: vi.fn().mockResolvedValue(undefined),
  set: vi.fn().mockResolvedValue(undefined),
  del: vi.fn().mockResolvedValue(undefined),
}))

function stubFetch({
  sessions = [],
  repos = [],
  sendMessage,
}: {
  sessions?: ApiSession[]
  repos?: RepoEntry[]
  sendMessage?: ReturnType<typeof vi.fn>
} = {}) {
  const version: VersionInfo = {
    apiVersion: '1',
    libraryVersion: '0.1.0',
    features: ['messages'],
    repos,
  }
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url.includes('/api/version')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: version }) })
    }
    if (url.includes('/api/sessions')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: sessions }) })
    }
    if (url.includes('/api/dags')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: [] }) })
    }
    if (url.includes('/api/messages')) {
      const body = init?.body ? JSON.parse(init.body as string) : {}
      sendMessage?.(body)
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: { ok: true, sessionId: null } }) })
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ data: null }) })
  })
  vi.stubGlobal('fetch', fetchMock)
}

function seedConnection() {
  localStorage.setItem('minions-ui:connections:v1', JSON.stringify({
    version: 1,
    connections: [
      { id: 'c1', label: 'My Minion', baseUrl: 'https://example.com', token: 'tok', color: '#3b82f6' },
    ],
    activeId: 'c1',
  }))
}

describe('NewTaskBar repo chip strip', () => {
  let mock: ReturnType<typeof installMockEventSource>

  beforeEach(() => {
    localStorage.clear()
    mock = installMockEventSource()
    vi.resetModules()
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    })
  })

  afterEach(() => {
    mock.restore()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('renders a chip per repo plus a "(no repo)" chip, first repo selected by default', async () => {
    seedConnection()
    stubFetch({ repos: [{ alias: 'api', url: 'x' }, { alias: 'web', url: 'y' }] })
    const App = (await import('../src/App')).default
    render(<App />)

    const chips = await screen.findByTestId('new-task-repo-chips')
    expect(within(chips).getByTestId('new-task-repo-chip-api')).toBeTruthy()
    expect(within(chips).getByTestId('new-task-repo-chip-web')).toBeTruthy()
    expect(within(chips).getByTestId('new-task-repo-chip-none')).toBeTruthy()
    await vi.waitFor(() => {
      expect(within(chips).getByTestId('new-task-repo-chip-api').getAttribute('aria-checked')).toBe('true')
    })
    expect(within(chips).getByTestId('new-task-repo-chip-web').getAttribute('aria-checked')).toBe('false')
  })

  it('clicking a repo chip updates the selected repo', async () => {
    seedConnection()
    stubFetch({ repos: [{ alias: 'api', url: 'x' }, { alias: 'web', url: 'y' }] })
    const App = (await import('../src/App')).default
    render(<App />)

    const chips = await screen.findByTestId('new-task-repo-chips')
    fireEvent.click(within(chips).getByTestId('new-task-repo-chip-web'))
    expect(within(chips).getByTestId('new-task-repo-chip-web').getAttribute('aria-checked')).toBe('true')
    expect(within(chips).getByTestId('new-task-repo-chip-api').getAttribute('aria-checked')).toBe('false')
  })

  it('does not render chip strip when no repos are advertised', async () => {
    seedConnection()
    stubFetch({ repos: [] })
    const App = (await import('../src/App')).default
    render(<App />)

    await screen.findByText('My Minion')
    expect(screen.queryByTestId('new-task-repo-chips')).toBeNull()
  })

  it('"(no repo)" chip suppresses repo injection when sending', async () => {
    seedConnection()
    const sendMessage = vi.fn()
    stubFetch({ repos: [{ alias: 'api', url: 'x' }], sendMessage })
    const App = (await import('../src/App')).default
    render(<App />)

    const chips = await screen.findByTestId('new-task-repo-chips')
    fireEvent.click(within(chips).getByTestId('new-task-repo-chip-none'))

    const input = screen.getByPlaceholderText(/New task/)
    fireEvent.input(input, { target: { value: '/task hello' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: '/task hello' }))
    })
  })

  it('selected repo chip is auto-injected into slash command on send', async () => {
    seedConnection()
    const sendMessage = vi.fn()
    stubFetch({ repos: [{ alias: 'api', url: 'x' }], sendMessage })
    const App = (await import('../src/App')).default
    render(<App />)

    await screen.findByTestId('new-task-repo-chips')
    const input = screen.getByPlaceholderText(/New task/)
    fireEvent.input(input, { target: { value: '/task hello world' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: '/task api hello world' }))
    })
  })
})
