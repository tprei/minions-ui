import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/preact'
import { signal } from '@preact/signals'
import { TimelineView } from '../../src/components/TimelineView'
import { createTranscriptStore } from '../../src/state/transcript'
import type { ApiClient } from '../../src/api/client'
import type { ApiSession, TranscriptEvent, TranscriptSnapshot } from '../../src/api/types'
import type { ConnectionStore } from '../../src/state/types'

function makeSession(over: Partial<ApiSession> & { id: string; slug: string }): ApiSession {
  return {
    status: 'running',
    command: '/task test',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    mode: 'task',
    conversation: [],
    ...over,
  }
}

function makeStore(opts: {
  sessions: ApiSession[]
  transcriptForSession?: (id: string) => TranscriptSnapshot | null
}): ConnectionStore {
  const transcripts = new Map<
    string,
    ReturnType<typeof createTranscriptStore>
  >()
  const client: ApiClient = {
    getTranscript: (slug: string) => {
      const session = opts.sessions.find((s) => s.slug === slug)
      const snap = session && opts.transcriptForSession
        ? opts.transcriptForSession(session.id)
        : null
      if (!snap) return new Promise<TranscriptSnapshot>(() => {})
      return Promise.resolve(snap)
    },
  } as unknown as ApiClient
  return {
    sessions: signal(opts.sessions),
    getTranscript: (sessionId: string) => {
      const existing = transcripts.get(sessionId)
      if (existing) return existing
      const sess = opts.sessions.find((s) => s.id === sessionId)
      if (!sess) return null
      const store = createTranscriptStore({ client, slug: sess.slug })
      transcripts.set(sessionId, store)
      return store
    },
  } as unknown as ConnectionStore
}

const baseEvent = (seq: number, turn = 1) => ({
  seq,
  id: `e${seq}`,
  sessionId: 's1',
  turn,
  timestamp: 1_700_000_000_000 + seq,
})

async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

describe('TimelineView', () => {
  beforeEach(() => {
    if (!window.matchMedia) {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn(() => ({
          matches: false,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      })
    }
  })

  afterEach(() => cleanup())

  it('shows the empty state when no session is selected', () => {
    const store = makeStore({ sessions: [makeSession({ id: 's1', slug: 'a' })] })
    render(
      <TimelineView
        store={store}
        sessions={[makeSession({ id: 's1', slug: 'a' })]}
        dags={[]}
        sessionId={null}
        onSelect={vi.fn()}
        isDesktop
      />,
    )
    const empty = screen.getByTestId('timeline-empty')
    expect(empty.textContent).toContain('Select a session')
  })

  it('shows a no-sessions state when there are no sessions at all', () => {
    const store = makeStore({ sessions: [] })
    render(
      <TimelineView
        store={store}
        sessions={[]}
        dags={[]}
        sessionId={null}
        onSelect={vi.fn()}
        isDesktop
      />,
    )
    const empty = screen.getByTestId('timeline-empty')
    expect(empty.textContent).toContain('No sessions yet')
  })

  it('renders the session header and timeline log when a session is selected', async () => {
    const session = makeSession({ id: 's1', slug: 'brave-fox', command: '/task hello' })
    const events: TranscriptEvent[] = [
      { ...baseEvent(1), type: 'user_message', text: 'hi there' },
    ]
    const store = makeStore({
      sessions: [session],
      transcriptForSession: () => ({
        session: { sessionId: 's1', startedAt: 1_700_000_000_000, active: true },
        events,
        highWaterMark: 1,
      }),
    })

    render(
      <TimelineView
        store={store}
        sessions={[session]}
        dags={[]}
        sessionId="s1"
        onSelect={vi.fn()}
        isDesktop
      />,
    )

    expect(screen.getByTestId('timeline-session-header').textContent).toContain('brave-fox')

    await flush()
    await waitFor(() => {
      expect(screen.getAllByTestId('timeline-row')).toHaveLength(1)
    })
    const row = screen.getByTestId('timeline-row')
    expect(row.getAttribute('data-event-type')).toBe('user_message')
  })

  it('renders the desktop sidebar with the session list', () => {
    const session = makeSession({ id: 's1', slug: 'in-sidebar' })
    const store = makeStore({ sessions: [session] })
    render(
      <TimelineView
        store={store}
        sessions={[session]}
        dags={[]}
        sessionId={null}
        onSelect={vi.fn()}
        isDesktop
      />,
    )
    expect(screen.getByTestId('timeline-sidebar')).toBeTruthy()
  })

  it('does not render the desktop sidebar on mobile', () => {
    const session = makeSession({ id: 's1', slug: 'mobile-row' })
    const store = makeStore({ sessions: [session] })
    render(
      <TimelineView
        store={store}
        sessions={[session]}
        dags={[]}
        sessionId={null}
        onSelect={vi.fn()}
        isDesktop={false}
      />,
    )
    expect(screen.queryByTestId('timeline-sidebar')).toBeNull()
    expect(screen.getByTestId('timeline-strip')).toBeTruthy()
  })

  it('toggling a filter pill hides matching events', async () => {
    const session = makeSession({ id: 's1', slug: 'brave-fox' })
    const events: TranscriptEvent[] = [
      { ...baseEvent(1), type: 'user_message', text: 'hi' },
      { ...baseEvent(2), type: 'thinking', blockId: 'b', text: 'pondering', final: true },
    ]
    const store = makeStore({
      sessions: [session],
      transcriptForSession: () => ({
        session: { sessionId: 's1', startedAt: 1_700_000_000_000, active: true },
        events,
        highWaterMark: 2,
      }),
    })

    render(
      <TimelineView
        store={store}
        sessions={[session]}
        dags={[]}
        sessionId="s1"
        onSelect={vi.fn()}
        isDesktop
      />,
    )

    await flush()
    await waitFor(() => expect(screen.getAllByTestId('timeline-row')).toHaveLength(2))
    fireEvent.click(screen.getByTestId('timeline-filter-thinking'))
    await waitFor(() => expect(screen.getAllByTestId('timeline-row')).toHaveLength(1))
    expect(screen.getByTestId('timeline-row').getAttribute('data-event-type')).toBe('user_message')
  })
})
