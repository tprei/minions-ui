import { render, screen, fireEvent } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { installMockEventSource } from './sse-mock'
import type { VersionInfo, ApiSession, ApiDagGraph } from '../src/api/types'
import App, { viewMode } from '../src/App'
import { connections, activeId, disposeAll } from '../src/connections/store'
import { recordVariantGroup, resetVariantGroupsForTests } from '../src/groups/store'

vi.mock('virtual:pwa-register/preact', () => ({
  useRegisterSW: vi.fn().mockReturnValue({}),
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

function seedConnection() {
  connections.value = [
    { id: 'c1', label: 'My Minion', baseUrl: 'https://example.com', token: 'tok', color: '#3b82f6' },
  ]
  activeId.value = 'c1'
}

describe('App', () => {
  let mock: ReturnType<typeof installMockEventSource>

  beforeEach(() => {
    localStorage.clear()
    mock = installMockEventSource()
    viewMode.value = 'list'
    disposeAll()
    connections.value = []
    activeId.value = null
    resetVariantGroupsForTests()
  })

  afterEach(() => {
    connections.value = []
    activeId.value = null
    disposeAll()
    mock.restore()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('renders empty state "Connect a minion" when no connections', async () => {
    stubFetch()
    render(<App />)
    expect(screen.getByText('Connect a minion')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add connection' })).toBeTruthy()
  })

  it('renders header and session list when connection exists', async () => {
    seedConnection()
    stubFetch([session()])
    render(<App />)
    expect(screen.getByText('My Minion')).toBeTruthy()
    await screen.findByText('brave-fox')
  })

  it('clicking a session in the sidebar opens the chat pane inline', async () => {
    seedConnection()
    stubFetch([session()])
    render(<App />)

    const item = await screen.findByTestId('session-item-s1')
    fireEvent.click(item)

    await screen.findByTestId('transcript-upgrade-notice')
  })

  it('renders the variant group view when the hash is #/g/:groupId', async () => {
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
    recordVariantGroup('c1', {
      groupId: 'g-route',
      prompt: 'routed prompt',
      mode: 'task',
      variantSessionIds: ['s1', 's2'],
      createdAt: '2026-04-19T00:00:00Z',
    })
    seedConnection()
    window.location.hash = '#/g/g-route'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    try {
      render(<App />)
      const view = await screen.findByTestId('variant-group-view', {}, { timeout: 5000 })
      expect(view).toBeTruthy()
      expect(screen.getByTestId('variant-group-prompt').textContent).toBe('routed prompt')
    } finally {
      window.location.hash = ''
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    }
  })

  it('renders attention pills and filters the session list when a pill is clicked', async () => {
    seedConnection()
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

  it('hides the Clean button when the minion does not advertise the messages feature', async () => {
    seedConnection()
    stubFetch([session()])
    render(<App />)
    await screen.findByText('My Minion')
    expect(screen.queryByTestId('header-clean-btn')).toBeNull()
  })

  it('clicking Clean sends /clean via /api/messages after confirmation', async () => {
    const versionWithMessages: VersionInfo = {
      apiVersion: '1',
      libraryVersion: '1.110.0',
      features: ['messages'],
    }
    const postedBodies: unknown[] = []
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/version')) {
        return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: versionWithMessages }) })
      }
      if (url.includes('/api/sessions')) {
        return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: [session()] }) })
      }
      if (url.includes('/api/dags')) {
        return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: [] }) })
      }
      if (url.includes('/api/messages') && init?.method === 'POST') {
        postedBodies.push(JSON.parse(String(init.body)))
        return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: { ok: true, sessionId: null } }) })
      }
      return Promise.resolve({ ok: false, status: 404, statusText: 'NF', json: () => Promise.resolve({ data: null }) })
    }))
    seedConnection()
    render(<App />)

    const cleanBtn = await screen.findByTestId('header-clean-btn')
    fireEvent.click(cleanBtn)

    const dialog = await screen.findByRole('dialog')
    const confirmBtn = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent === 'Clean',
    )
    expect(confirmBtn).toBeTruthy()
    fireEvent.click(confirmBtn!)

    await vi.waitFor(() => {
      expect(postedBodies.length).toBeGreaterThan(0)
    })
    const body = postedBodies[0] as { text: string; sessionId?: string }
    expect(body.text).toBe('/clean')
    expect(body.sessionId).toBeUndefined()
  })

  it('switching sessions keeps the chat pane mounted', async () => {
    seedConnection()
    stubFetch([
      session({ id: 's1', slug: 'brave-fox' }),
      session({ id: 's2', slug: 'swift-cat' }),
    ])
    render(<App />)

    fireEvent.click(await screen.findByTestId('session-item-s1'))
    await screen.findByTestId('transcript-upgrade-notice')

    fireEvent.click(screen.getByTestId('session-item-s2'))
    await screen.findByTestId('transcript-upgrade-notice')
  })
})
