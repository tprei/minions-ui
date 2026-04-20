import { render, screen, fireEvent } from '@testing-library/preact'
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

const VERSION: VersionInfo = { apiVersion: '1', libraryVersion: '0.1.0', features: [] }

function stubFetch(sessions: ApiSession[] = [], dags: ApiDagGraph[] = []) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    if (url.includes('/api/version')) {
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: VERSION }) })
    }
    if (url.includes('/api/sessions')) {
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: sessions }) })
    }
    if (url.includes('/api/dags')) {
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: dags }) })
    }
    return Promise.resolve({ ok: false, status: 404, statusText: 'NF', json: () => Promise.resolve({ data: null }) })
  }))
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

describe('App', () => {
  let mock: ReturnType<typeof installMockEventSource>

  beforeEach(() => {
    localStorage.clear()
    mock = installMockEventSource()
    vi.resetModules()
  })

  afterEach(() => {
    mock.restore()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('renders empty state "Connect a minion" when no connections', async () => {
    stubFetch()
    const App = (await import('../src/App')).default
    render(<App />)
    expect(screen.getByText('Connect a minion')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add connection' })).toBeTruthy()
  })

  it('renders header and session list when connection exists', async () => {
    localStorage.setItem('minions-ui:connections:v1', JSON.stringify({
      version: 1,
      connections: [
        { id: 'c1', label: 'My Minion', baseUrl: 'https://example.com', token: 'tok', color: '#3b82f6' },
      ],
      activeId: 'c1',
    }))
    stubFetch([session()])
    const App = (await import('../src/App')).default
    render(<App />)
    expect(screen.getByText('My Minion')).toBeTruthy()
    await screen.findByText('brave-fox')
  })

  it('clicking a session in the sidebar opens the chat pane inline', async () => {
    localStorage.setItem('minions-ui:connections:v1', JSON.stringify({
      version: 1,
      connections: [
        { id: 'c1', label: 'My Minion', baseUrl: 'https://example.com', token: 'tok', color: '#3b82f6' },
      ],
      activeId: 'c1',
    }))
    stubFetch([session()])
    const App = (await import('../src/App')).default
    render(<App />)

    const item = await screen.findByTestId('session-item-s1')
    fireEvent.click(item)

    // Mock minion advertises no 'transcript' feature, so the chat pane
    // renders the upgrade notice rather than a transcript timeline.
    await screen.findByTestId('transcript-upgrade-notice')
  })

  it('renders the variant group view when the hash is #/g/:groupId', async () => {
    localStorage.setItem('minions-ui:connections:v1', JSON.stringify({
      version: 1,
      connections: [
        { id: 'c1', label: 'My Minion', baseUrl: 'https://example.com', token: 'tok', color: '#3b82f6' },
      ],
      activeId: 'c1',
    }))
    localStorage.setItem(
      'minions-ui:variant-groups:v1',
      JSON.stringify({
        version: 1,
        byConnection: {
          c1: [{
            groupId: 'g-route',
            prompt: 'routed prompt',
            mode: 'task',
            variantSessionIds: ['s1', 's2'],
            createdAt: '2026-04-19T00:00:00Z',
          }],
        },
      })
    )
    const versionWithVariants: VersionInfo = {
      apiVersion: '1',
      libraryVersion: '1.111.0',
      features: ['sessions-create', 'sessions-variants'],
    }
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/version')) {
        return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: versionWithVariants }) })
      }
      if (url.includes('/api/sessions')) {
        return Promise.resolve({
          ok: true, status: 200, statusText: 'OK',
          json: () => Promise.resolve({ data: [session({ id: 's1', slug: 'brave-fox' }), session({ id: 's2', slug: 'swift-cat' })] }),
        })
      }
      if (url.includes('/api/dags')) {
        return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: [] }) })
      }
      return Promise.resolve({ ok: false, status: 404, statusText: 'NF', json: () => Promise.resolve({ data: null }) })
    }))
    window.location.hash = '#/g/g-route'
    try {
      const App = (await import('../src/App')).default
      render(<App />)
      const view = await screen.findByTestId('variant-group-view')
      expect(view).toBeTruthy()
      expect(screen.getByTestId('variant-group-prompt').textContent).toBe('routed prompt')
    } finally {
      window.location.hash = ''
    }
  })

  it('renders attention pills and filters the session list when a pill is clicked', async () => {
    localStorage.setItem('minions-ui:connections:v1', JSON.stringify({
      version: 1,
      connections: [
        { id: 'c1', label: 'My Minion', baseUrl: 'https://example.com', token: 'tok', color: '#3b82f6' },
      ],
      activeId: 'c1',
    }))
    stubFetch([
      session({
        id: 's1',
        slug: 'brave-fox',
        status: 'failed',
        needsAttention: true,
        attentionReasons: ['failed'],
      }),
      session({
        id: 's2',
        slug: 'swift-cat',
        needsAttention: true,
        attentionReasons: ['waiting_for_feedback'],
      }),
      session({ id: 's3', slug: 'calm-owl' }),
    ])
    const App = (await import('../src/App')).default
    render(<App />)

    await screen.findByTestId('attention-bar')
    expect(screen.getByTestId('attention-pill-failed').textContent).toContain('1')
    expect(screen.getByTestId('attention-pill-waiting_for_feedback').textContent).toContain('1')

    expect(await screen.findByTestId('session-item-s3')).toBeTruthy()
    fireEvent.click(screen.getByTestId('attention-pill-failed'))

    expect(screen.getByTestId('session-item-s1')).toBeTruthy()
    expect(screen.queryByTestId('session-item-s2')).toBeNull()
    expect(screen.queryByTestId('session-item-s3')).toBeNull()

    fireEvent.click(screen.getByTestId('attention-clear'))
    expect(screen.getByTestId('session-item-s3')).toBeTruthy()
  })

  it('switching sessions keeps the chat pane mounted', async () => {
    localStorage.setItem('minions-ui:connections:v1', JSON.stringify({
      version: 1,
      connections: [
        { id: 'c1', label: 'My Minion', baseUrl: 'https://example.com', token: 'tok', color: '#3b82f6' },
      ],
      activeId: 'c1',
    }))
    stubFetch([
      session({ id: 's1', slug: 'brave-fox' }),
      session({ id: 's2', slug: 'swift-cat' }),
    ])
    const App = (await import('../src/App')).default
    render(<App />)

    fireEvent.click(await screen.findByTestId('session-item-s1'))
    await screen.findByTestId('transcript-upgrade-notice')

    fireEvent.click(screen.getByTestId('session-item-s2'))
    await screen.findByTestId('transcript-upgrade-notice')
  })
})
