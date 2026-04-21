import { render, screen } from '@testing-library/preact'
import { signal } from '@preact/signals'
import { describe, it, expect, vi } from 'vitest'
import { ResourceChip } from '../../src/components/ResourceChip'
import type { ConnectionStore } from '../../src/state/types'
import type { ApiDagGraph, ApiSession, ResourceSnapshot, VersionInfo } from '../../src/api/types'

function makeStore(snapshot: ResourceSnapshot | null): ConnectionStore {
  return {
    connectionId: 'c1',
    client: {} as ConnectionStore['client'],
    sessions: signal<ApiSession[]>([]),
    dags: signal<ApiDagGraph[]>([]),
    status: signal('live'),
    reconnectAt: signal<number | null>(null),
    error: signal<string | null>(null),
    version: signal<VersionInfo | null>(null),
    stale: signal(false),
    diffStatsBySessionId: signal(new Map()),
    resourceSnapshot: signal(snapshot),
    runtimeConfig: signal(null),
    loadDiffStats: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    sendCommand: vi.fn(async () => ({ success: true })),
    getTranscript: vi.fn(() => null),
    applySessionCreated: vi.fn(),
    applySessionDeleted: vi.fn(),
    refreshRuntimeConfig: vi.fn(async () => {}),
    updateRuntimeConfig: vi.fn(async () => {}),
    dispose: vi.fn(),
  }
}

const sample = (cpu: number, memPct: number): ResourceSnapshot => ({
  ts: 0,
  cpu: { usagePercent: cpu, cpuCount: 2, source: 'cgroup' },
  memory: {
    usedBytes: Math.round((memPct / 100) * 1000),
    limitBytes: 1000,
    rssBytes: 100,
    source: 'cgroup',
  },
  disk: { path: '/workspace', usedBytes: 1, totalBytes: 10 },
  eventLoopLagMs: 0,
  counts: { activeSessions: 0, maxSessions: 1, activeLoops: 0, maxLoops: 1 },
})

describe('ResourceChip', () => {
  it('shows waiting state when no snapshot', () => {
    render(<ResourceChip store={makeStore(null)} />)
    expect(screen.getByTestId('resource-chip').textContent).toMatch(/waiting/i)
  })

  it('renders CPU percent when snapshot present', () => {
    render(<ResourceChip store={makeStore(sample(37, 20))} />)
    const chip = screen.getByTestId('resource-chip')
    expect(chip.textContent).toContain('37%')
  })

  it('invokes onOpen when clicked', () => {
    const onOpen = vi.fn()
    render(<ResourceChip store={makeStore(sample(10, 10))} onOpen={onOpen} />)
    const chip = screen.getByTestId('resource-chip')
    chip.click()
    expect(onOpen).toHaveBeenCalled()
  })
})
