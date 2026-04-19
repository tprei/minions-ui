import { render, screen, fireEvent, act } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { installMockEventSource } from './sse-mock'
import type { VersionInfo, ApiSession, ApiDagGraph } from '../src/api/types'

vi.mock('virtual:pwa-register/preact', () => ({
  useRegisterSW: vi.fn().mockReturnValue({}),
}))

vi.mock('idb-keyval', () => ({
  get: vi.fn().mockResolvedValue(undefined),
  set: vi.fn().mockResolvedValue(undefined),
  del: vi.fn().mockResolvedValue(undefined),
}))

interface CapturedCanvasProps {
  sessions: ApiSession[]
  dags: ApiDagGraph[]
  isActionLoading: boolean
  accentColor?: string
  onSendReply: (sessionId: string, message: string) => Promise<void>
  onStopMinion: (sessionId: string) => Promise<void>
  onCloseSession: (sessionId: string) => Promise<void>
  onOpenThread: (session: ApiSession) => void
  onOpenChat?: (sessionId: string) => void
}

const captured: { props: CapturedCanvasProps | null } = { props: null }

vi.mock('../src/components/UniverseCanvas', () => ({
  UniverseCanvas: vi.fn((props: CapturedCanvasProps) => {
    captured.props = props
    return (
      <div data-testid="mock-universe-canvas">
        <span data-testid="mock-universe-sessions-count">{props.sessions.length}</span>
        <span data-testid="mock-universe-dags-count">{props.dags.length}</span>
        <span data-testid="mock-universe-action-loading">{String(props.isActionLoading)}</span>
        <span data-testid="mock-universe-accent">{props.accentColor ?? ''}</span>
      </div>
    )
  }),
}))

const VERSION: VersionInfo = { apiVersion: '1', libraryVersion: '0.1.0', features: [] }

function stubFetch(sessions: ApiSession[] = [], dags: ApiDagGraph[] = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/version')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({ data: VERSION }),
        })
      }
      if (url.includes('/api/sessions')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({ data: sessions }),
        })
      }
      if (url.includes('/api/dags')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({ data: dags }),
        })
      }
      if (url.includes('/api/messages') || url.includes('/api/commands')) {
        const body = init?.body ? JSON.parse(init.body as string) : {}
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({ data: { ok: true, ...body } }),
        })
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'NF',
        json: () => Promise.resolve({ data: null }),
      })
    })
  )
}

function session(over: Partial<ApiSession> = {}): ApiSession {
  return {
    id: 's1',
    slug: 'brave-fox',
    status: 'running',
    command: '/task foo',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    mode: 'task',
    conversation: [],
    ...over,
  }
}

function setMatchMedia(matches: boolean) {
  const listeners = new Set<(e: { matches: boolean }) => void>()
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn(() => ({
      matches,
      addEventListener: (_: string, listener: (e: { matches: boolean }) => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: (e: { matches: boolean }) => void) => listeners.delete(listener),
    })),
  })
}

const conn = {
  id: 'c1',
  label: 'My Minion',
  baseUrl: 'https://example.com',
  token: 'tok',
  color: '#ff00ff',
}

describe('App view mode toggle', () => {
  let mock: ReturnType<typeof installMockEventSource>

  beforeEach(() => {
    captured.props = null
    localStorage.clear()
    mock = installMockEventSource()
    vi.resetModules()
  })

  afterEach(() => {
    mock.restore()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('defaults to list view and exposes both toggle buttons', async () => {
    setMatchMedia(true)
    localStorage.setItem(
      'minions-ui:connections:v1',
      JSON.stringify({ version: 1, connections: [conn], activeId: 'c1' })
    )
    stubFetch([session()])
    const App = (await import('../src/App')).default
    render(<App />)

    const listBtn = await screen.findByTestId('view-toggle-list')
    const canvasBtn = screen.getByTestId('view-toggle-canvas')
    expect(listBtn.getAttribute('aria-pressed')).toBe('true')
    expect(canvasBtn.getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByTestId('mock-universe-canvas')).toBeNull()
  })

  it('switches to canvas pane on desktop when Canvas button is clicked', async () => {
    setMatchMedia(true)
    localStorage.setItem(
      'minions-ui:connections:v1',
      JSON.stringify({ version: 1, connections: [conn], activeId: 'c1' })
    )
    const dag: ApiDagGraph = {
      id: 'd1',
      rootTaskId: 'n1',
      nodes: {},
      status: 'running',
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    }
    stubFetch([session()], [dag])
    const App = (await import('../src/App')).default
    render(<App />)

    await screen.findByTestId('view-toggle-canvas')
    fireEvent.click(screen.getByTestId('view-toggle-canvas'))

    expect(screen.getByTestId('canvas-pane')).toBeTruthy()
    expect(screen.getByTestId('mock-universe-canvas')).toBeTruthy()
    expect(screen.getByTestId('mock-universe-sessions-count').textContent).toBe('1')
    expect(screen.getByTestId('mock-universe-dags-count').textContent).toBe('1')
    expect(screen.getByTestId('mock-universe-accent').textContent).toBe('#ff00ff')
  })

  it('renders canvas as full-screen modal on mobile and closes via close button', async () => {
    setMatchMedia(false)
    localStorage.setItem(
      'minions-ui:connections:v1',
      JSON.stringify({ version: 1, connections: [conn], activeId: 'c1' })
    )
    stubFetch([session()])
    const App = (await import('../src/App')).default
    render(<App />)

    await screen.findByTestId('view-toggle-canvas')
    fireEvent.click(screen.getByTestId('view-toggle-canvas'))

    const modal = screen.getByTestId('canvas-modal')
    expect(modal).toBeTruthy()
    expect(modal.getAttribute('role')).toBe('dialog')
    expect(modal.getAttribute('aria-modal')).toBe('true')
    expect(screen.queryByTestId('canvas-pane')).toBeNull()
    expect(screen.getByTestId('mock-universe-canvas')).toBeTruthy()

    fireEvent.click(screen.getByTestId('canvas-modal-close'))

    expect(screen.queryByTestId('canvas-modal')).toBeNull()
    expect(screen.getByTestId('view-toggle-list').getAttribute('aria-pressed')).toBe('true')
  })

  it('wires onOpenChat to switch to list view and select the session', async () => {
    setMatchMedia(true)
    localStorage.setItem(
      'minions-ui:connections:v1',
      JSON.stringify({ version: 1, connections: [conn], activeId: 'c1' })
    )
    stubFetch([session({ conversation: [{ role: 'user', text: 'hello' }] })])
    const App = (await import('../src/App')).default
    render(<App />)

    await screen.findByTestId('view-toggle-canvas')
    fireEvent.click(screen.getByTestId('view-toggle-canvas'))
    expect(captured.props).not.toBeNull()

    act(() => {
      captured.props!.onOpenChat!('s1')
    })

    const conv = await screen.findByTestId('conversation-view')
    expect(conv.textContent).toContain('hello')
    expect(screen.queryByTestId('canvas-pane')).toBeNull()
    expect(screen.getByTestId('view-toggle-list').getAttribute('aria-pressed')).toBe('true')
  })

  it('wires onSendReply to POST /api/messages with sessionId', async () => {
    setMatchMedia(true)
    localStorage.setItem(
      'minions-ui:connections:v1',
      JSON.stringify({ version: 1, connections: [conn], activeId: 'c1' })
    )
    stubFetch([session()])
    const App = (await import('../src/App')).default
    render(<App />)

    await screen.findByTestId('view-toggle-canvas')
    fireEvent.click(screen.getByTestId('view-toggle-canvas'))
    expect(captured.props).not.toBeNull()

    await captured.props!.onSendReply('s1', 'hi from canvas')

    const fetchMock = (globalThis as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch
    const messageCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/messages'))
    expect(messageCall).toBeTruthy()
    const init = messageCall![1] as RequestInit
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({ text: 'hi from canvas', sessionId: 's1' })
  })

  it('wires onStopMinion and onCloseSession to POST /api/commands', async () => {
    setMatchMedia(true)
    localStorage.setItem(
      'minions-ui:connections:v1',
      JSON.stringify({ version: 1, connections: [conn], activeId: 'c1' })
    )
    stubFetch([session()])
    const App = (await import('../src/App')).default
    render(<App />)

    await screen.findByTestId('view-toggle-canvas')
    fireEvent.click(screen.getByTestId('view-toggle-canvas'))
    expect(captured.props).not.toBeNull()

    await captured.props!.onStopMinion('s1')
    await captured.props!.onCloseSession('s1')

    const fetchMock = (globalThis as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch
    const commandCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/commands'))
    expect(commandCalls.length).toBe(2)
    const bodies = commandCalls.map((c) => JSON.parse((c[1] as RequestInit).body as string))
    expect(bodies).toEqual([
      { action: 'stop', sessionId: 's1' },
      { action: 'close', sessionId: 's1' },
    ])
  })

  it('toggles isActionLoading while a command is in flight', async () => {
    setMatchMedia(true)
    localStorage.setItem(
      'minions-ui:connections:v1',
      JSON.stringify({ version: 1, connections: [conn], activeId: 'c1' })
    )

    let resolveStop: ((value: unknown) => void) | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/version')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: () => Promise.resolve({ data: VERSION }),
          })
        }
        if (url.includes('/api/sessions')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: () => Promise.resolve({ data: [session()] }),
          })
        }
        if (url.includes('/api/dags')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: () => Promise.resolve({ data: [] }),
          })
        }
        if (url.includes('/api/commands')) {
          return new Promise((resolve) => {
            resolveStop = (val) =>
              resolve({
                ok: true,
                status: 200,
                statusText: 'OK',
                json: () => Promise.resolve({ data: val }),
              })
          })
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'NF',
          json: () => Promise.resolve({ data: null }),
        })
      })
    )

    const App = (await import('../src/App')).default
    render(<App />)

    await screen.findByTestId('view-toggle-canvas')
    fireEvent.click(screen.getByTestId('view-toggle-canvas'))
    expect(captured.props).not.toBeNull()

    expect(screen.getByTestId('mock-universe-action-loading').textContent).toBe('false')

    const pending = captured.props!.onStopMinion('s1')
    await Promise.resolve()

    expect(screen.getByTestId('mock-universe-action-loading').textContent).toBe('true')

    resolveStop!({ success: true })
    await pending

    expect(screen.getByTestId('mock-universe-action-loading').textContent).toBe('false')
  })
})
