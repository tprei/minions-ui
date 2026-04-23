import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/preact'
import {
  SessionLogsPopup,
  formatLogTimestamp,
  summarizeLogEvent,
} from '../../src/components/SessionLogsPopup'
import { createTranscriptStore } from '../../src/state/transcript'
import type { ApiClient } from '../../src/api/client'
import type {
  TranscriptEvent,
  TranscriptSnapshot,
  UserMessageEvent,
  ToolCallEvent,
  ToolResultEvent,
  StatusEvent,
  TurnStartedEvent,
  TurnCompletedEvent,
  AssistantTextEvent,
  ThinkingEvent,
} from '../../src/api/types'

const baseEvent = (seq: number, turn = 1) => ({
  seq,
  id: `e${seq}`,
  sessionId: 's1',
  turn,
  timestamp: 1_700_000_000_000 + seq,
})

function snapshot(events: TranscriptEvent[]): TranscriptSnapshot {
  return {
    session: { sessionId: 's1', startedAt: 1_700_000_000_000, active: true },
    events,
    highWaterMark: events.length ? events[events.length - 1].seq : 0,
  }
}

function makeClient(snap: TranscriptSnapshot | Promise<TranscriptSnapshot>): ApiClient {
  return {
    getTranscript: () => Promise.resolve(snap as TranscriptSnapshot),
  } as unknown as ApiClient
}

async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

describe('formatLogTimestamp', () => {
  it('produces HH:MM:SS.mmm from an epoch-ms value', () => {
    const d = new Date(2024, 0, 1, 3, 4, 5, 67)
    const formatted = formatLogTimestamp(d.getTime())
    expect(formatted).toBe('03:04:05.067')
  })
})

describe('summarizeLogEvent', () => {
  it('summarizes user_message by collapsing whitespace', () => {
    const e: UserMessageEvent = { ...baseEvent(1), type: 'user_message', text: 'hello\n  world' }
    expect(summarizeLogEvent(e)).toBe('hello world')
  })

  it('summarizes turn_started with trigger', () => {
    const e: TurnStartedEvent = { ...baseEvent(1, 2), type: 'turn_started', trigger: 'user_message' }
    expect(summarizeLogEvent(e)).toBe('turn 2 started (user_message)')
  })

  it('summarizes turn_completed with tokens/cost/duration/errored', () => {
    const e: TurnCompletedEvent = {
      ...baseEvent(1, 3),
      type: 'turn_completed',
      totalTokens: 1200,
      totalCostUsd: 0.0342,
      durationMs: 4500,
      errored: true,
    }
    const summary = summarizeLogEvent(e)
    expect(summary).toContain('turn 3 completed')
    expect(summary).toContain('errored')
    expect(summary).toContain('1200 tokens')
    expect(summary).toContain('$0.0342')
    expect(summary).toContain('4.5s')
  })

  it('prefixes assistant_text with … when not final', () => {
    const final: AssistantTextEvent = {
      ...baseEvent(1), type: 'assistant_text', blockId: 'b', text: 'done', final: true,
    }
    const streaming: AssistantTextEvent = {
      ...baseEvent(2), type: 'assistant_text', blockId: 'b', text: 'partial', final: false,
    }
    expect(summarizeLogEvent(final)).toBe('done')
    expect(summarizeLogEvent(streaming)).toBe('…partial')
  })

  it('prefixes thinking with … when not final', () => {
    const t: ThinkingEvent = {
      ...baseEvent(1), type: 'thinking', blockId: 'b', text: 'hmm', final: false,
    }
    expect(summarizeLogEvent(t)).toBe('…hmm')
  })

  it('summarizes tool_call with name and title', () => {
    const e: ToolCallEvent = {
      ...baseEvent(1),
      type: 'tool_call',
      call: { toolUseId: 'u1', name: 'Bash', kind: 'bash', title: 'echo hi', input: {} },
    }
    expect(summarizeLogEvent(e)).toBe('Bash — echo hi')
  })

  it('summarizes tool_result with status, text, truncated', () => {
    const ok: ToolResultEvent = {
      ...baseEvent(1), type: 'tool_result', toolUseId: 'u1',
      result: { status: 'ok', text: 'all good', truncated: true },
    }
    const summary = summarizeLogEvent(ok)
    expect(summary).toContain('ok')
    expect(summary).toContain('all good')
    expect(summary).toContain('(truncated)')
  })

  it('summarizes tool_result error using the error field', () => {
    const bad: ToolResultEvent = {
      ...baseEvent(1), type: 'tool_result', toolUseId: 'u1',
      result: { status: 'error', error: 'boom', text: 'ignored' },
    }
    const summary = summarizeLogEvent(bad)
    expect(summary).toContain('error')
    expect(summary).toContain('boom')
    expect(summary).not.toContain('ignored')
  })

  it('summarizes status with severity, kind, and message', () => {
    const e: StatusEvent = {
      ...baseEvent(1), type: 'status', severity: 'warn', kind: 'stream_stalled', message: 'retrying',
    }
    expect(summarizeLogEvent(e)).toBe('[warn] stream_stalled: retrying')
  })
})

describe('SessionLogsPopup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('shows loading state before the first snapshot resolves', () => {
    const client = {
      getTranscript: () => new Promise<TranscriptSnapshot>(() => {}),
    } as unknown as ApiClient
    const store = createTranscriptStore({ client, slug: 's' })
    render(<SessionLogsPopup sessionSlug="slug-a" transcript={store} onClose={vi.fn()} />)
    expect(screen.getByTestId('session-logs-loading')).toBeTruthy()
  })

  it('shows empty state when the snapshot contains no events', async () => {
    const client = makeClient(snapshot([]))
    const store = createTranscriptStore({ client, slug: 's' })
    render(<SessionLogsPopup sessionSlug="slug-a" transcript={store} onClose={vi.fn()} />)
    await flush()
    await waitFor(() => expect(screen.queryByTestId('session-logs-loading')).toBeNull())
    expect(screen.getByTestId('session-logs-empty')).toBeTruthy()
  })

  it('renders one row per event with type and seq data attributes', async () => {
    const events: TranscriptEvent[] = [
      { ...baseEvent(1), type: 'user_message', text: 'hi there' },
      {
        ...baseEvent(2),
        type: 'tool_call',
        call: { toolUseId: 'u1', name: 'Bash', kind: 'bash', title: 'ls', input: {} },
      },
      {
        ...baseEvent(3),
        type: 'status',
        severity: 'error',
        kind: 'session_error',
        message: 'oops',
      },
    ]
    const store = createTranscriptStore({ client: makeClient(snapshot(events)), slug: 's' })
    render(<SessionLogsPopup sessionSlug="slug-a" transcript={store} onClose={vi.fn()} />)
    await flush()
    await waitFor(() => {
      const rows = screen.getAllByTestId('session-logs-row')
      expect(rows).toHaveLength(3)
    })
    const rows = screen.getAllByTestId('session-logs-row')
    expect(rows[0].getAttribute('data-event-type')).toBe('user_message')
    expect(rows[0].getAttribute('data-event-seq')).toBe('1')
    expect(rows[1].getAttribute('data-event-type')).toBe('tool_call')
    expect(rows[2].getAttribute('data-event-type')).toBe('status')
    expect(rows[2].textContent).toContain('oops')
  })

  it('filters rows when a type pill is toggled off', async () => {
    const events: TranscriptEvent[] = [
      { ...baseEvent(1), type: 'user_message', text: 'hi' },
      { ...baseEvent(2), type: 'thinking', blockId: 'b', text: 'pondering', final: true },
    ]
    const store = createTranscriptStore({ client: makeClient(snapshot(events)), slug: 's' })
    render(<SessionLogsPopup sessionSlug="slug-a" transcript={store} onClose={vi.fn()} />)
    await flush()
    await waitFor(() => expect(screen.getAllByTestId('session-logs-row')).toHaveLength(2))
    fireEvent.click(screen.getByTestId('session-logs-filter-thinking'))
    await waitFor(() => expect(screen.getAllByTestId('session-logs-row')).toHaveLength(1))
    const row = screen.getByTestId('session-logs-row')
    expect(row.getAttribute('data-event-type')).toBe('user_message')
  })

  it('shows no-match state when filter excludes all events', async () => {
    const events: TranscriptEvent[] = [
      { ...baseEvent(1), type: 'user_message', text: 'hi' },
    ]
    const store = createTranscriptStore({ client: makeClient(snapshot(events)), slug: 's' })
    render(<SessionLogsPopup sessionSlug="slug-a" transcript={store} onClose={vi.fn()} />)
    await flush()
    await waitFor(() => expect(screen.getByTestId('session-logs-row')).toBeTruthy())
    fireEvent.click(screen.getByTestId('session-logs-filter-none'))
    await waitFor(() => expect(screen.getByTestId('session-logs-no-match')).toBeTruthy())
  })

  it('selecting "All" after "None" restores every event type', async () => {
    const events: TranscriptEvent[] = [
      { ...baseEvent(1), type: 'user_message', text: 'hi' },
      { ...baseEvent(2), type: 'thinking', blockId: 'b', text: 'x', final: true },
    ]
    const store = createTranscriptStore({ client: makeClient(snapshot(events)), slug: 's' })
    render(<SessionLogsPopup sessionSlug="slug-a" transcript={store} onClose={vi.fn()} />)
    await flush()
    await waitFor(() => expect(screen.getAllByTestId('session-logs-row')).toHaveLength(2))
    fireEvent.click(screen.getByTestId('session-logs-filter-none'))
    await waitFor(() => expect(screen.getByTestId('session-logs-no-match')).toBeTruthy())
    fireEvent.click(screen.getByTestId('session-logs-filter-all'))
    await waitFor(() => expect(screen.getAllByTestId('session-logs-row')).toHaveLength(2))
  })

  it('invokes onClose when the close button is clicked', async () => {
    const onClose = vi.fn()
    const store = createTranscriptStore({ client: makeClient(snapshot([])), slug: 's' })
    render(<SessionLogsPopup sessionSlug="slug-a" transcript={store} onClose={onClose} />)
    await flush()
    fireEvent.click(screen.getByTestId('session-logs-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('invokes onClose when Escape is pressed', async () => {
    const onClose = vi.fn()
    const store = createTranscriptStore({ client: makeClient(snapshot([])), slug: 's' })
    render(<SessionLogsPopup sessionSlug="slug-a" transcript={store} onClose={onClose} />)
    await flush()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders the session slug in the title', async () => {
    const store = createTranscriptStore({ client: makeClient(snapshot([])), slug: 's' })
    render(<SessionLogsPopup sessionSlug="bold-meadow" transcript={store} onClose={vi.fn()} />)
    await flush()
    expect(screen.getByText(/bold-meadow/)).toBeTruthy()
  })

  it('shows filtered-of-total count in the header', async () => {
    const events: TranscriptEvent[] = [
      { ...baseEvent(1), type: 'user_message', text: 'a' },
      { ...baseEvent(2), type: 'user_message', text: 'b' },
      { ...baseEvent(3), type: 'thinking', blockId: 'b', text: 'x', final: true },
    ]
    const store = createTranscriptStore({ client: makeClient(snapshot(events)), slug: 's' })
    render(<SessionLogsPopup sessionSlug="slug-a" transcript={store} onClose={vi.fn()} />)
    await flush()
    await waitFor(() => {
      expect(screen.getByTestId('session-logs-count').textContent).toContain('3 of 3')
    })
    fireEvent.click(screen.getByTestId('session-logs-filter-thinking'))
    await waitFor(() => {
      expect(screen.getByTestId('session-logs-count').textContent).toContain('2 of 3')
    })
  })
})
