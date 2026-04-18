import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { installMockEventSource } from './sse-mock'
import type { ApiSession, ApiDagGraph, VersionInfo } from '../src/api/types'

const VERSION: VersionInfo = { apiVersion: '1', libraryVersion: '0.1.0', features: [] }
const SESSIONS: ApiSession[] = []
const DAGS: ApiDagGraph[] = []

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    if (url.includes('/api/version')) {
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: VERSION }) })
    }
    if (url.includes('/api/sessions')) {
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: SESSIONS }) })
    }
    if (url.includes('/api/dags')) {
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ data: DAGS }) })
    }
    return Promise.resolve({ ok: false, status: 404, statusText: 'NF', json: () => Promise.resolve({ data: null }) })
  }))
}

const STORAGE_KEY = 'minions-ui:connections:v1'

describe('connections store', () => {
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
  })

  it('localStorage roundtrip: add two connections, re-import returns same data', async () => {
    const { addConnection, connections, disposeAll } = await import('../src/connections/store')

    addConnection({ label: 'A', baseUrl: 'https://a.example.com', token: 'ta' })
    addConnection({ label: 'B', baseUrl: 'https://b.example.com', token: 'tb' })

    expect(connections.value).toHaveLength(2)
    disposeAll()

    const stored = localStorage.getItem(STORAGE_KEY)
    expect(stored).not.toBeNull()
    const parsed = JSON.parse(stored!) as { connections: { label: string }[] }
    expect(parsed.connections).toHaveLength(2)
    expect(parsed.connections.map((c) => c.label)).toEqual(['A', 'B'])
  })

  it('migrate from unknown shape returns empty state without throw', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 99, junk: true }))

    const { connections, activeId, disposeAll } = await import('../src/connections/store')

    expect(connections.value).toHaveLength(0)
    expect(activeId.value).toBeNull()
    disposeAll()
  })

  it('setActive(b) after setActive(a) disposes a\'s store', async () => {
    const { addConnection, setActive, disposeAll } = await import('../src/connections/store')
    const { createConnectionStore } = await import('../src/state/store')

    const disposeSpy = vi.fn()
    const origCreate = createConnectionStore

    vi.spyOn(await import('../src/state/store'), 'createConnectionStore').mockImplementation((client) => {
      const store = origCreate(client)
      const origDispose = store.dispose.bind(store)
      store.dispose = () => {
        disposeSpy()
        origDispose()
      }
      return store
    })

    const connA = addConnection({ label: 'A', baseUrl: 'https://a.example.com', token: 'ta' })
    const connB = addConnection({ label: 'B', baseUrl: 'https://b.example.com', token: 'tb' })

    setActive(connA.id)
    setActive(connB.id)

    expect(disposeSpy).toHaveBeenCalledTimes(1)
    disposeAll()
  })
})
