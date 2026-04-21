import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/preact'
import { Transcript } from '../../../src/chat/transcript/Transcript'
import { createTranscriptStore } from '../../../src/state/transcript'
import type { ApiClient } from '../../../src/api/client'
import type {
  TranscriptEvent,
  TranscriptSnapshot,
  ToolCallEvent,
  ToolResultEvent,
} from '../../../src/api/types'

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

const baseEvent = (seq: number, turn = 1) => ({
  seq,
  id: `e${seq}`,
  sessionId: 's1',
  turn,
  timestamp: 1_700_000_000 + seq,
})

function snapshot(events: TranscriptEvent[]): TranscriptSnapshot {
  return {
    session: { sessionId: 's1', startedAt: 1_700_000_000, active: true },
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

describe('Transcript', () => {
  it('shows loading on initial render', () => {
    let resolve: (v: TranscriptSnapshot) => void = () => {}
    const client = {
      getTranscript: () => new Promise<TranscriptSnapshot>((r) => { resolve = r }),
    } as unknown as ApiClient
    const store = createTranscriptStore({ client, slug: 's' })
    render(<Transcript store={store} />)
    expect(screen.getByTestId('transcript-loading')).toBeTruthy()
    resolve(snapshot([]))
  })

  it('renders empty state when transcript loaded with no events', async () => {
    const client = makeClient(snapshot([]))
    const store = createTranscriptStore({ client, slug: 's' })
    render(<Transcript store={store} />)
    await flush()
    await waitFor(() => expect(screen.queryByTestId('transcript-loading')).toBeNull())
    expect(screen.getByText('No transcript activity yet.')).toBeTruthy()
  })

  it('renders a turn separator and rows for a basic transcript', async () => {
    const events: TranscriptEvent[] = [
      { ...baseEvent(1), type: 'user_message', text: 'hi' },
      { ...baseEvent(2), type: 'assistant_text', blockId: 'b1', text: 'hello back', final: true },
    ]
    const client = makeClient(snapshot(events))
    const store = createTranscriptStore({ client, slug: 's' })
    render(<Transcript store={store} />)
    await flush()
    await waitFor(() => expect(screen.getByTestId('transcript-turn-separator')).toBeTruthy())
    expect(screen.getByTestId('transcript-user-message').textContent).toContain('hi')
    expect(screen.getByTestId('transcript-assistant-text').textContent).toContain('hello back')
  })

  it('renders tool call paired with its result', async () => {
    const call: ToolCallEvent = {
      ...baseEvent(1),
      type: 'tool_call',
      call: {
        toolUseId: 'tu1',
        name: 'Bash',
        kind: 'bash',
        title: 'echo hello',
        input: { cmd: 'echo hello' },
      },
    }
    const result: ToolResultEvent = {
      ...baseEvent(2),
      type: 'tool_result',
      toolUseId: 'tu1',
      result: { status: 'ok', text: 'hello' },
    }
    const client = makeClient(snapshot([call, result]))
    const store = createTranscriptStore({ client, slug: 's' })
    render(<Transcript store={store} />)
    await flush()
    await waitFor(() => expect(screen.getByTestId('transcript-tool-call')).toBeTruthy())
    expect(screen.getByTestId('transcript-tool-status-ok')).toBeTruthy()
  })

  it('reflects live SSE events appended to the store', async () => {
    const initial: TranscriptEvent[] = [
      { ...baseEvent(1), type: 'user_message', text: 'first' },
    ]
    const client = makeClient(snapshot(initial))
    const store = createTranscriptStore({ client, slug: 's' })
    render(<Transcript store={store} />)
    await flush()
    await waitFor(() => expect(screen.getByTestId('transcript-user-message')).toBeTruthy())

    store.applyEvent({
      ...baseEvent(2),
      type: 'assistant_text',
      blockId: 'b1',
      text: 'streaming',
      final: false,
    })

    await waitFor(() => expect(screen.getByTestId('transcript-assistant-text')).toBeTruthy())
    expect(screen.getByTestId('transcript-streaming-indicator')).toBeTruthy()
  })

  it('wraps consecutive tool calls in a single grouped frame', async () => {
    const calls: ToolCallEvent[] = [1, 2, 3].map((i) => ({
      ...baseEvent(i),
      type: 'tool_call',
      call: {
        toolUseId: `tu${i}`,
        name: 'Bash',
        kind: 'bash',
        title: `cmd ${i}`,
        input: {},
      },
    }))
    const client = makeClient(snapshot(calls))
    const store = createTranscriptStore({ client, slug: 's' })
    render(<Transcript store={store} />)
    await flush()
    await waitFor(() => expect(screen.getAllByTestId('transcript-tool-call').length).toBe(3))
    const groups = screen.getAllByTestId('transcript-tool-group')
    expect(groups.length).toBe(1)
    expect(groups[0].querySelectorAll('[data-testid="transcript-tool-call"]').length).toBe(3)
  })

  it('collapses tool groups by default when there are more than 5 calls', async () => {
    const calls: ToolCallEvent[] = Array.from({ length: 8 }, (_, i) => ({
      ...baseEvent(i + 1),
      type: 'tool_call',
      call: {
        toolUseId: `tu${i}`,
        name: 'Bash',
        kind: 'bash',
        title: `cmd ${i}`,
        input: {},
      },
    }))
    const client = makeClient(snapshot(calls))
    const store = createTranscriptStore({ client, slug: 's' })
    render(<Transcript store={store} />)
    await flush()
    await waitFor(() => expect(screen.getByTestId('transcript-tool-group')).toBeTruthy())
    const group = screen.getByTestId('transcript-tool-group')
    expect(group.getAttribute('data-open')).toBe('false')
    expect(group.querySelectorAll('[data-testid="transcript-tool-call"]').length).toBe(0)
    expect(screen.getByText('8 tool calls')).toBeTruthy()

    fireEvent.click(screen.getByTestId('transcript-tool-group-toggle'))
    await waitFor(() =>
      expect(group.querySelectorAll('[data-testid="transcript-tool-call"]').length).toBe(8),
    )
  })

  it('renders a lone tool call as a standalone card, not grouped', async () => {
    const call: ToolCallEvent = {
      ...baseEvent(1),
      type: 'tool_call',
      call: {
        toolUseId: 'tu1',
        name: 'Bash',
        kind: 'bash',
        title: 'echo',
        input: {},
      },
    }
    const client = makeClient(snapshot([call]))
    const store = createTranscriptStore({ client, slug: 's' })
    render(<Transcript store={store} />)
    await flush()
    await waitFor(() => expect(screen.getByTestId('transcript-tool-call')).toBeTruthy())
    expect(screen.queryByTestId('transcript-tool-group')).toBeNull()
  })

  it('renders an error banner when fetch fails and exposes Retry', async () => {
    let attempts = 0
    const client = {
      getTranscript: vi.fn().mockImplementation(() => {
        attempts++
        if (attempts === 1) return Promise.reject(new Error('boom'))
        return Promise.resolve(snapshot([]))
      }),
    } as unknown as ApiClient
    const store = createTranscriptStore({ client, slug: 's' })
    render(<Transcript store={store} />)
    await flush()
    await waitFor(() => expect(screen.getByTestId('transcript-error')).toBeTruthy())
    expect(screen.getByText(/boom/)).toBeTruthy()

    fireEvent.click(screen.getByText('Retry'))
    await flush()
    await waitFor(() => expect(screen.queryByTestId('transcript-error')).toBeNull())
  })
})
