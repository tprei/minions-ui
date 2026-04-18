import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { installMockEventSource } from '../sse-mock'
import { nextColor, CONNECTION_PALETTE } from '../../src/theme/colors'

vi.mock('idb-keyval', () => ({
  del: vi.fn().mockResolvedValue(undefined),
  get: vi.fn().mockResolvedValue(undefined),
  set: vi.fn().mockResolvedValue(undefined),
}))

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    if (url.includes('/api/version')) {
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: { apiVersion: '1', libraryVersion: '0.1.0', features: [] } }) })
    }
    if (url.includes('/api/sessions')) {
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: [] }) })
    }
    if (url.includes('/api/dags')) {
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: [] }) })
    }
    return Promise.resolve({ ok: false, status: 404, statusText: 'NF', json: () => Promise.resolve({ data: null }) })
  }))
}

describe('nextColor', () => {
  it('returns first palette color when none taken', () => {
    expect(nextColor([])).toBe(CONNECTION_PALETTE[0])
  })

  it('skips taken colors and returns next available', () => {
    expect(nextColor([CONNECTION_PALETTE[0]])).toBe(CONNECTION_PALETTE[1])
  })

  it('returns palette colors in order', () => {
    const taken: string[] = []
    for (let i = 0; i < CONNECTION_PALETTE.length - 1; i++) {
      const c = nextColor(taken)
      expect(c).toBe(CONNECTION_PALETTE[i])
      taken.push(c)
    }
  })

  it('cycles when all palette colors are taken', () => {
    const allTaken = [...CONNECTION_PALETTE]
    const result = nextColor(allTaken)
    expect(CONNECTION_PALETTE).toContain(result)
  })

  it('cycles via index when all taken', () => {
    const allTaken = [...CONNECTION_PALETTE, ...CONNECTION_PALETTE]
    const result = nextColor(allTaken)
    expect(result).toBe(CONNECTION_PALETTE[allTaken.length % CONNECTION_PALETTE.length])
  })
})

describe('connections store (M5 additions)', () => {
  let mock: ReturnType<typeof installMockEventSource>

  beforeEach(() => {
    localStorage.clear()
    mock = installMockEventSource()
    stubFetch()
    vi.resetModules()
  })

  afterEach(() => {
    mock.restore()
    vi.unstubAllGlobals()
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('addConnection picks nextColor from palette', async () => {
    const { addConnection, connections, disposeAll } = await import('../../src/connections/store')
    const c1 = addConnection({ label: 'A', baseUrl: 'https://a.example.com', token: '' })
    const c2 = addConnection({ label: 'B', baseUrl: 'https://b.example.com', token: '' })
    expect(c1.color).toBe(CONNECTION_PALETTE[0])
    expect(c2.color).toBe(CONNECTION_PALETTE[1])
    expect(connections.value).toHaveLength(2)
    disposeAll()
  })

  it('addConnection with explicit color preserves it', async () => {
    const { addConnection, disposeAll } = await import('../../src/connections/store')
    const c = addConnection({ label: 'A', baseUrl: 'https://a.example.com', token: '', color: '#ff0000' })
    expect(c.color).toBe('#ff0000')
    disposeAll()
  })

  it('removeConnection clears IDB snapshot', async () => {
    const { del } = await import('idb-keyval')
    const { addConnection, removeConnection, disposeAll } = await import('../../src/connections/store')
    const conn = addConnection({ label: 'X', baseUrl: 'https://x.example.com', token: '' })
    removeConnection(conn.id)
    expect(del).toHaveBeenCalledWith(`minions-ui:snapshot:${conn.id}`)
    disposeAll()
  })

  it('removeConnection sets activeId to null when active is removed', async () => {
    const { addConnection, setActive, removeConnection, activeId, disposeAll } = await import('../../src/connections/store')
    const conn = addConnection({ label: 'Y', baseUrl: 'https://y.example.com', token: '' })
    setActive(conn.id)
    expect(activeId.value).toBe(conn.id)
    removeConnection(conn.id)
    expect(activeId.value).toBeNull()
    disposeAll()
  })
})
