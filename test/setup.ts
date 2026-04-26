import { cleanup } from '@testing-library/preact'
import { afterEach, vi } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'

// jsdom's Blob implementation omits `arrayBuffer()`, `text()`, and `stream()`.
// Swap in node's buffer-module Blob (full spec) so fetch round-trip tests can
// read binary response bodies.
if (typeof (globalThis.Blob as unknown as { prototype: { arrayBuffer?: unknown } }).prototype.arrayBuffer !== 'function') {
  globalThis.Blob = NodeBlob as unknown as typeof globalThis.Blob
}

afterEach(() => {
  cleanup()
})

if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
}

if (typeof window !== 'undefined' && typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    public pointerId: number
    public width: number
    public height: number
    public pressure: number
    public tiltX: number
    public tiltY: number
    public pointerType: string
    public isPrimary: boolean

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params)
      this.pointerId = params.pointerId ?? 0
      this.width = params.width ?? 1
      this.height = params.height ?? 1
      this.pressure = params.pressure ?? 0
      this.tiltX = params.tiltX ?? 0
      this.tiltY = params.tiltY ?? 0
      this.pointerType = params.pointerType ?? 'mouse'
      this.isPrimary = params.isPrimary ?? false
    }
  }
  (globalThis as { PointerEvent?: typeof PointerEventPolyfill }).PointerEvent = PointerEventPolyfill
}
