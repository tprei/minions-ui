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
