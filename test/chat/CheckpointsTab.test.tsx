import { render, screen, waitFor } from '@testing-library/preact'
import { describe, expect, it, vi } from 'vitest'
import { CheckpointsTab } from '../../src/chat/CheckpointsTab'
import type { ApiClient } from '../../src/api/client'
import type { ApiSession, SessionCheckpoint } from '../../src/api/types'

function makeSession(overrides: Partial<ApiSession> = {}): ApiSession {
  return {
    id: 's-1',
    slug: 'test-session',
    status: 'completed',
    command: 'do work',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:01:00Z',
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    mode: 'task',
    conversation: [],
    ...overrides,
  }
}

function makeCheckpoint(overrides: Partial<SessionCheckpoint> = {}): SessionCheckpoint {
  return {
    id: 'cp-1',
    sessionId: 's-1',
    turn: 2,
    kind: 'turn',
    label: 'Turn 2',
    sha: 'abcdef1234567890',
    baseSha: '1234567890abcdef',
    branch: 'minion/test-session',
    createdAt: '2026-04-26T00:02:00Z',
    ...overrides,
  }
}

function makeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    baseUrl: 'https://example.com',
    token: 't',
    getVersion: vi.fn(),
    getSessions: vi.fn(),
    getDags: vi.fn(),
    sendCommand: vi.fn(),
    sendMessage: vi.fn(),
    createSession: vi.fn(),
    createSessionVariants: vi.fn(),
    getPr: vi.fn(),
    getReadiness: vi.fn(),
    listCheckpoints: vi.fn(),
    restoreCheckpoint: vi.fn(),
    getDiff: vi.fn(),
    getTranscript: vi.fn(),
    listScreenshots: vi.fn(),
    fetchScreenshotBlob: vi.fn(),
    getVapidKey: vi.fn(),
    subscribePush: vi.fn(),
    unsubscribePush: vi.fn(),
    getMetrics: vi.fn(),
    getRuntimeConfig: vi.fn(),
    patchRuntimeConfig: vi.fn(),
    getMemories: vi.fn(),
    createMemory: vi.fn(),
    updateMemory: vi.fn(),
    reviewMemory: vi.fn(),
    deleteMemory: vi.fn(),
    openEventStream: vi.fn(),
    ...overrides,
  } as ApiClient
}

describe('CheckpointsTab', () => {
  it('loads and renders checkpoint rows', async () => {
    const client = makeClient({
      listCheckpoints: vi.fn().mockResolvedValue([makeCheckpoint({ dagNodeId: 'node-a' })]),
    })
    render(
      <CheckpointsTab
        session={makeSession()}
        sessionUpdatedAt="2026-04-26T00:01:00Z"
        client={client}
        onRestored={vi.fn()}
      />,
    )

    await waitFor(() => expect(screen.getByTestId('checkpoints-tab')).toBeTruthy())
    expect(screen.getByText('Turn 2')).toBeTruthy()
    expect(screen.getByText('node-a')).toBeTruthy()
    expect(screen.getByTestId('checkpoint-restore-btn')).toBeTruthy()
  })

  it('renders empty state', async () => {
    const client = makeClient({ listCheckpoints: vi.fn().mockResolvedValue([]) })
    render(
      <CheckpointsTab
        session={makeSession()}
        sessionUpdatedAt="t1"
        client={client}
        onRestored={vi.fn()}
      />,
    )

    await waitFor(() => expect(screen.getByTestId('checkpoints-empty')).toBeTruthy())
  })

  it('disables restore while the session is running', async () => {
    const client = makeClient({ listCheckpoints: vi.fn().mockResolvedValue([makeCheckpoint()]) })
    render(
      <CheckpointsTab
        session={makeSession({ status: 'running' })}
        sessionUpdatedAt="t1"
        client={client}
        onRestored={vi.fn()}
      />,
    )

    await waitFor(() => expect(screen.getByTestId('checkpoint-restore-btn')).toBeTruthy())
    expect((screen.getByTestId('checkpoint-restore-btn') as HTMLButtonElement).disabled).toBe(true)
  })
})
