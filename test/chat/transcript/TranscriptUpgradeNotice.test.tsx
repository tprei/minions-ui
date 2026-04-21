import { render, screen } from '@testing-library/preact'
import { signal } from '@preact/signals'
import { describe, it, expect, vi } from 'vitest'
import { TranscriptUpgradeNotice } from '../../../src/chat/transcript/TranscriptUpgradeNotice'
import type { ConnectionStore } from '../../../src/state/types'
import type { VersionInfo, ApiSession, ApiDagGraph } from '../../../src/api/types'

function makeStore(version: VersionInfo | null): ConnectionStore {
  return {
    connectionId: 'c1',
    client: {} as ConnectionStore['client'],
    sessions: signal<ApiSession[]>([]),
    dags: signal<ApiDagGraph[]>([]),
    status: signal('live'),
    reconnectAt: signal<number | null>(null),
    error: signal<string | null>(null),
    version: signal<VersionInfo | null>(version),
    stale: signal(false),
    diffStatsBySessionId: signal(new Map()),
    loadDiffStats: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    sendCommand: vi.fn(async () => ({ success: true })),
    getTranscript: vi.fn(() => null),
    applySessionCreated: vi.fn(),
    applySessionDeleted: vi.fn(),
    dispose: vi.fn(),
  }
}

describe('TranscriptUpgradeNotice', () => {
  it('explains the missing transcript feature flag and echoes the running version', () => {
    const store = makeStore({ apiVersion: '1', libraryVersion: '1.118.7', features: [] })
    render(<TranscriptUpgradeNotice store={store} />)
    const notice = screen.getByTestId('transcript-upgrade-notice')
    expect(notice.textContent).toContain('transcript')
    expect(notice.textContent).toContain('/api/version')
    expect(notice.textContent).toContain('1.118.7')
  })

  it('falls back to "unknown" when the minion has not reported a version yet', () => {
    const store = makeStore(null)
    render(<TranscriptUpgradeNotice store={store} />)
    const notice = screen.getByTestId('transcript-upgrade-notice')
    expect(notice.textContent).toContain('unknown')
  })
})
