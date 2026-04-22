import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { openEventStream } from '../../src/api/sse'
import type { SseEvent } from '../../src/api/types'
import { installMockEventSource } from '../sse-mock'

describe('openEventStream', () => {
  let mock: ReturnType<typeof installMockEventSource>

  beforeEach(() => {
    mock = installMockEventSource()
  })

  afterEach(() => {
    mock.restore()
  })

  function getLastInstance() {
    const url = mock.constructedUrls[mock.constructedUrls.length - 1]
    return mock.instances.get(url)!
  }

  it('creates EventSource with correct URL including token', () => {
    openEventStream({
      baseUrl: 'http://localhost:8080',
      token: 'test-token',
      handlers: { onEvent: vi.fn() },
    })

    expect(mock.constructedUrls).toHaveLength(1)
    expect(mock.constructedUrls[0]).toBe('http://localhost:8080/api/events?token=test-token')
  })

  it('creates EventSource without token when empty', () => {
    openEventStream({
      baseUrl: 'http://localhost:8080',
      token: '',
      handlers: { onEvent: vi.fn() },
    })

    expect(mock.constructedUrls[0]).toBe('http://localhost:8080/api/events')
  })

  it('starts with connecting status', () => {
    const handle = openEventStream({
      baseUrl: 'http://localhost:8080',
      token: 'test-token',
      handlers: { onEvent: vi.fn() },
    })

    expect(handle.status.value).toBe('connecting')
  })

  it('transitions to live on successful connection', () => {
    const onStatusChange = vi.fn()
    const handle = openEventStream({
      baseUrl: 'http://localhost:8080',
      token: 'test-token',
      handlers: { onEvent: vi.fn(), onStatusChange },
    })

    getLastInstance().simulateOpen()

    expect(handle.status.value).toBe('live')
    expect(onStatusChange).toHaveBeenCalledWith('live')
  })

  it('calls onReconnect when connection opens', () => {
    const onReconnect = vi.fn()
    openEventStream({
      baseUrl: 'http://localhost:8080',
      token: 'test-token',
      handlers: { onEvent: vi.fn(), onReconnect },
    })

    getLastInstance().simulateOpen()

    expect(onReconnect).toHaveBeenCalledTimes(1)
  })

  it('parses and forwards valid SSE events', () => {
    const onEvent = vi.fn()
    openEventStream({
      baseUrl: 'http://localhost:8080',
      token: 'test-token',
      handlers: { onEvent },
    })

    const event: SseEvent = { type: 'session', payload: { id: '123', state: 'running' } as any }
    getLastInstance().push(event)

    expect(onEvent).toHaveBeenCalledWith(event)
  })

  it('handles malformed JSON gracefully', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onEvent = vi.fn()

    openEventStream({
      baseUrl: 'http://localhost:8080',
      token: 'test-token',
      handlers: { onEvent },
    })

    const es = getLastInstance()
    const e = new MessageEvent('message', { data: 'not valid json' })
    es.onmessage?.(e)

    expect(onEvent).not.toHaveBeenCalled()
    expect(consoleWarn).toHaveBeenCalledWith('[sse] failed to parse message', 'not valid json')

    consoleWarn.mockRestore()
  })

  it('transitions to retrying status on error', () => {
    const handle = openEventStream({
      baseUrl: 'http://localhost:8080',
      token: 'test-token',
      handlers: { onEvent: vi.fn() },
    })

    getLastInstance().simulateError()

    expect(handle.status.value).toBe('retrying')
  })

  it('closes EventSource on error', () => {
    openEventStream({
      baseUrl: 'http://localhost:8080',
      token: 'test-token',
      handlers: { onEvent: vi.fn() },
    })

    const es = getLastInstance()
    const closeSpy = vi.spyOn(es, 'close')
    es.simulateError()

    expect(closeSpy).toHaveBeenCalled()
  })

  it('transitions to closed status when closed', () => {
    const handle = openEventStream({
      baseUrl: 'http://localhost:8080',
      token: 'test-token',
      handlers: { onEvent: vi.fn() },
    })

    handle.close()

    expect(handle.status.value).toBe('closed')
  })

  it('closes EventSource when handle is closed', () => {
    const handle = openEventStream({
      baseUrl: 'http://localhost:8080',
      token: 'test-token',
      handlers: { onEvent: vi.fn() },
    })

    const es = getLastInstance()
    const closeSpy = vi.spyOn(es, 'close')

    handle.close()

    expect(closeSpy).toHaveBeenCalled()
  })
})
