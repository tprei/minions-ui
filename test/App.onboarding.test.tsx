import { render, screen, fireEvent } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { installMockEventSource } from './sse-mock'
import type { VersionInfo, ApiSession, ApiDagGraph } from '../src/api/types'

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
  localStorage.setItem('minions-ui:connections:v1', JSON.stringify({
    version: 1,
    connections: [
      { id: 'c1', label: 'My Minion', baseUrl: 'https://example.com', token: 'tok', color: '#3b82f6' },
    ],
    activeId: 'c1',
  }))
}

function setDesktop(isDesktop: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn(() => ({
      matches: isDesktop,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
}

describe('App onboarding tour and help panel', () => {
  let mock: ReturnType<typeof installMockEventSource>

  beforeEach(() => {
    localStorage.clear()
    mock = installMockEventSource()
    vi.resetModules()
    setDesktop(true)
  })

  afterEach(() => {
    mock.restore()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('auto-shows the tour on first connection when no completion flag is set', { timeout: 15000 }, async () => {
    seedConnection()
    stubFetch([session()])
    const App = (await import('../src/App')).default
    render(<App />)
    expect(await screen.findByTestId('onboarding-tour')).toBeTruthy()
  })

  it('does NOT auto-show the tour when completion flag is already set', { timeout: 15000 }, async () => {
    localStorage.setItem('minions-ui:onboarding-tour:v1', 'completed')
    seedConnection()
    stubFetch([session()])
    const App = (await import('../src/App')).default
    render(<App />)
    await screen.findByText('My Minion')
    expect(screen.queryByTestId('onboarding-tour')).toBeNull()
  })

  it('does NOT auto-show the tour on the connection-empty welcome screen', { timeout: 15000 }, async () => {
    stubFetch()
    const App = (await import('../src/App')).default
    render(<App />)
    expect(screen.getByText('Connect a minion')).toBeTruthy()
    expect(screen.queryByTestId('onboarding-tour')).toBeNull()
  })

  it('Skip persists the completion flag so the tour does not reappear', { timeout: 15000 }, async () => {
    seedConnection()
    stubFetch([session()])
    const App = (await import('../src/App')).default
    render(<App />)
    fireEvent.click(await screen.findByTestId('onboarding-tour-skip'))
    expect(screen.queryByTestId('onboarding-tour')).toBeNull()
    expect(localStorage.getItem('minions-ui:onboarding-tour:v1')).toBe('completed')
  })

  it('header help button opens the HelpPanel on desktop', { timeout: 15000 }, async () => {
    localStorage.setItem('minions-ui:onboarding-tour:v1', 'completed')
    seedConnection()
    stubFetch([session()])
    const App = (await import('../src/App')).default
    render(<App />)
    fireEvent.click(await screen.findByTestId('header-help-btn'))
    expect(await screen.findByTestId('help-panel')).toBeTruthy()
  })

  it('HelpPanel "Replay tour" closes the panel and reopens the tour', { timeout: 15000 }, async () => {
    localStorage.setItem('minions-ui:onboarding-tour:v1', 'completed')
    seedConnection()
    stubFetch([session()])
    const App = (await import('../src/App')).default
    render(<App />)
    fireEvent.click(await screen.findByTestId('header-help-btn'))
    fireEvent.click(await screen.findByTestId('help-panel-replay-tour'))
    expect(screen.queryByTestId('help-panel')).toBeNull()
    expect(await screen.findByTestId('onboarding-tour')).toBeTruthy()
    expect(localStorage.getItem('minions-ui:onboarding-tour:v1')).toBeNull()
  })

  it('mobile menu exposes a Help item that opens the HelpPanel', { timeout: 15000 }, async () => {
    setDesktop(false)
    localStorage.setItem('minions-ui:onboarding-tour:v1', 'completed')
    seedConnection()
    stubFetch([session()])
    const App = (await import('../src/App')).default
    render(<App />)
    fireEvent.click(await screen.findByTestId('header-menu-btn'))
    fireEvent.click(await screen.findByTestId('menu-help'))
    expect(await screen.findByTestId('help-panel')).toBeTruthy()
  })
})
