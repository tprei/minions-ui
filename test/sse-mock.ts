import { vi } from 'vitest'
import type { SseEvent } from '../src/api/types'

export class MockEventSource {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2

  readyState: number = MockEventSource.CONNECTING
  url: string
  withCredentials = false

  onopen: ((e: Event) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null

  private listeners = new Map<string, ((e: Event) => void)[]>()

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.set(url, this)
    MockEventSource.constructedUrls.push(url)
  }

  static instances = new Map<string, MockEventSource>()
  static constructedUrls: string[] = []

  addEventListener(type: string, listener: (e: Event) => void) {
    const existing = this.listeners.get(type) ?? []
    this.listeners.set(type, [...existing, listener])
  }

  removeEventListener(type: string, listener: (e: Event) => void) {
    const existing = this.listeners.get(type) ?? []
    this.listeners.set(type, existing.filter((l) => l !== listener))
  }

  dispatchEvent(event: Event): boolean {
    const handlers = this.listeners.get(event.type) ?? []
    for (const h of handlers) h(event)
    return true
  }

  close() {
    this.readyState = MockEventSource.CLOSED
  }

  simulateOpen() {
    this.readyState = MockEventSource.OPEN
    const e = new Event('open')
    this.onopen?.(e)
    const handlers = this.listeners.get('open') ?? []
    for (const h of handlers) h(e)
  }

  push(event: SseEvent) {
    const data = JSON.stringify(event)
    const e = new MessageEvent('message', { data })
    this.onmessage?.(e)
    const handlers = this.listeners.get('message') ?? []
    for (const h of handlers) h(e)
  }

  simulateError() {
    this.readyState = MockEventSource.CLOSED
    const e = new Event('error')
    this.onerror?.(e)
    const handlers = this.listeners.get('error') ?? []
    for (const h of handlers) h(e)
  }
}

export function installMockEventSource(): {
  instances: Map<string, MockEventSource>
  constructedUrls: string[]
  restore(): void
} {
  MockEventSource.instances.clear()
  MockEventSource.constructedUrls = []

  const original = (globalThis as Record<string, unknown>).EventSource
  vi.stubGlobal('EventSource', MockEventSource)

  return {
    instances: MockEventSource.instances,
    constructedUrls: MockEventSource.constructedUrls,
    restore() {
      vi.stubGlobal('EventSource', original)
    },
  }
}
