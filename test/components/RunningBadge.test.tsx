import { render, screen } from '@testing-library/preact'
import { signal } from '@preact/signals'
import { describe, it, expect, vi } from 'vitest'
import { RunningBadge } from '../../src/components/RunningBadge'
import type { ConnectionStore } from '../../src/state/types'
import type { ApiDagGraph, ApiSession, VersionInfo } from '../../src/api/types'

function mkSession(id: string, status: ApiSession['status']): ApiSession {
  return {
    id,
    slug: id,
    status,
    command: '',
    createdAt: '2026-04-19T00:00:00Z',
    updatedAt: '2026-04-19T00:00:00Z',
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    mode: 'task',
    conversation: [],
  }
}

function makeStore(sessions: ApiSession[]): ConnectionStore {
  return {
    connectionId: 'c1',
    client: {} as ConnectionStore['client'],
    sessions: signal<ApiSession[]>(sessions),
    dags: signal<ApiDagGraph[]>([]),
    status: signal('live'),
    reconnectAt: signal<number | null>(null),
    error: signal<string | null>(null),
    version: signal<VersionInfo | null>(null),
    stale: signal(false),
    diffStatsBySessionId: signal(new Map()),
    resourceSnapshot: signal(null),
    runtimeConfig: signal(null),
    memoryProposalsCount: signal(0),
    attentionSessionIds: signal(new Set<string>()),
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

describe('RunningBadge', () => {
  it('renders nothing when no sessions are active', () => {
    const { container } = render(
      <RunningBadge store={makeStore([mkSession('a', 'completed')])} />
    )
    expect(container.textContent).toBe('')
    expect(screen.queryByTestId('running-badge')).toBeNull()
  })

  it('shows the running count when at least one session is active', () => {
    render(
      <RunningBadge
        store={makeStore([
          mkSession('a', 'running'),
          mkSession('b', 'pending'),
          mkSession('c', 'completed'),
        ])}
      />
    )
    const badge = screen.getByTestId('running-badge')
    expect(badge.getAttribute('data-running-count')).toBe('2')
    expect(badge.textContent).toContain('2')
  })

  it('calls onSelect with the first running session id when clicked', () => {
    const onSelect = vi.fn()
    render(
      <RunningBadge
        store={makeStore([
          mkSession('a', 'completed'),
          mkSession('b', 'running'),
          mkSession('c', 'pending'),
        ])}
        onSelect={onSelect}
      />
    )
    screen.getByTestId('running-badge').click()
    expect(onSelect).toHaveBeenCalledWith('b')
  })

  it('is disabled without onSelect', () => {
    render(<RunningBadge store={makeStore([mkSession('a', 'running')])} />)
    const badge = screen.getByTestId('running-badge') as HTMLButtonElement
    expect(badge.disabled).toBe(true)
  })
})
