import { describe, test, expect, spyOn } from 'bun:test'
import { parseCodexLine, translateCodexLine } from './stream.js'

// ---------------------------------------------------------------------------
// parseCodexLine
// ---------------------------------------------------------------------------

describe('parseCodexLine', () => {
  test('returns null on empty string', () => {
    expect(parseCodexLine('')).toBeNull()
  })

  test('returns null on whitespace-only string', () => {
    expect(parseCodexLine('   ')).toBeNull()
  })

  test('returns null on invalid JSON and warns', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseCodexLine('not json')).toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  test('parses valid JSON object', () => {
    const line = JSON.stringify({ method: 'turn/started', params: { threadId: 't1', turnId: 'r1' } })
    expect(parseCodexLine(line)).toEqual({ method: 'turn/started', params: { threadId: 't1', turnId: 'r1' } })
  })
})

// ---------------------------------------------------------------------------
// translateCodexLine — thread/started
// ---------------------------------------------------------------------------

describe('translateCodexLine — thread/started', () => {
  test('emits session_id event and returns sessionId', () => {
    const raw = parseCodexLine(
      JSON.stringify({ method: 'thread/started', params: { thread: { id: 'thr_123' } } }),
    )!
    const { events, sessionId } = translateCodexLine(raw)
    expect(events).toEqual([{ kind: 'session_id', sessionId: 'thr_123' }])
    expect(sessionId).toBe('thr_123')
  })

  test('emits error when thread.id is missing', () => {
    const raw = parseCodexLine(
      JSON.stringify({ method: 'thread/started', params: { thread: {} } }),
    )!
    const { events } = translateCodexLine(raw)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'error' })
  })
})

// ---------------------------------------------------------------------------
// translateCodexLine — turn/started
// ---------------------------------------------------------------------------

describe('translateCodexLine — turn/started', () => {
  test('emits no events', () => {
    const raw = parseCodexLine(
      JSON.stringify({ method: 'turn/started', params: { threadId: 'thr_123', turnId: 'turn_456' } }),
    )!
    const { events, sessionId } = translateCodexLine(raw)
    expect(events).toHaveLength(0)
    expect(sessionId).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// translateCodexLine — item/agentMessage/delta
// ---------------------------------------------------------------------------

describe('translateCodexLine — item/agentMessage/delta', () => {
  test('emits text_delta', () => {
    const raw = parseCodexLine(
      JSON.stringify({ method: 'item/agentMessage/delta', params: { turnId: 'turn_456', delta: 'Hello ' } }),
    )!
    const { events } = translateCodexLine(raw)
    expect(events).toEqual([{ kind: 'text_delta', text: 'Hello ' }])
  })

  test('emits error when delta is missing', () => {
    const raw = parseCodexLine(
      JSON.stringify({ method: 'item/agentMessage/delta', params: { turnId: 'turn_456' } }),
    )!
    const { events } = translateCodexLine(raw)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'error' })
  })
})

// ---------------------------------------------------------------------------
// translateCodexLine — item/agentMessage (final)
// ---------------------------------------------------------------------------

describe('translateCodexLine — item/agentMessage', () => {
  test('emits no events (deltas already carried content)', () => {
    const raw = parseCodexLine(
      JSON.stringify({ method: 'item/agentMessage', params: { turnId: 'turn_456', text: 'Hello world' } }),
    )!
    const { events } = translateCodexLine(raw)
    expect(events).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// translateCodexLine — item/reasoning/delta
// ---------------------------------------------------------------------------

describe('translateCodexLine — item/reasoning/delta', () => {
  test('emits no events (discarded; final item/reasoning carries full text)', () => {
    const raw = parseCodexLine(
      JSON.stringify({ method: 'item/reasoning/delta', params: { turnId: 'turn_456', delta: 'thinking...' } }),
    )!
    const { events } = translateCodexLine(raw)
    expect(events).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// translateCodexLine — item/reasoning (final)
// ---------------------------------------------------------------------------

describe('translateCodexLine — item/reasoning', () => {
  test('emits thinking_block with full text', () => {
    const raw = parseCodexLine(
      JSON.stringify({ method: 'item/reasoning', params: { turnId: 'turn_456', text: 'I should consider...' } }),
    )!
    const { events } = translateCodexLine(raw)
    expect(events).toEqual([{ kind: 'thinking_block', text: 'I should consider...' }])
  })

  test('emits error when text is missing', () => {
    const raw = parseCodexLine(
      JSON.stringify({ method: 'item/reasoning', params: { turnId: 'turn_456' } }),
    )!
    const { events } = translateCodexLine(raw)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'error' })
  })
})

// ---------------------------------------------------------------------------
// translateCodexLine — item/toolCall (inProgress)
// ---------------------------------------------------------------------------

describe('translateCodexLine — item/toolCall status=inProgress', () => {
  test('emits tool_use', () => {
    const raw = parseCodexLine(
      JSON.stringify({
        method: 'item/toolCall',
        params: { turnId: 'turn_456', id: 'call_abc', name: 'shell', input: { cmd: 'ls' }, status: 'inProgress' },
      }),
    )!
    const { events } = translateCodexLine(raw)
    expect(events).toEqual([{ kind: 'tool_use', id: 'call_abc', name: 'shell', input: { cmd: 'ls' } }])
  })

  test('emits error when id is missing', () => {
    const raw = parseCodexLine(
      JSON.stringify({
        method: 'item/toolCall',
        params: { turnId: 'turn_456', name: 'shell', input: {}, status: 'inProgress' },
      }),
    )!
    const { events } = translateCodexLine(raw)
    expect(events[0]).toMatchObject({ kind: 'error' })
  })
})

// ---------------------------------------------------------------------------
// translateCodexLine — item/toolCall (completed)
// ---------------------------------------------------------------------------

describe('translateCodexLine — item/toolCall status=completed', () => {
  test('emits tool_result with output', () => {
    const raw = parseCodexLine(
      JSON.stringify({
        method: 'item/toolCall',
        params: {
          turnId: 'turn_456',
          id: 'call_abc',
          name: 'shell',
          input: {},
          status: 'completed',
          output: 'file.txt',
        },
      }),
    )!
    const { events } = translateCodexLine(raw)
    expect(events).toEqual([{ kind: 'tool_result', toolUseId: 'call_abc', content: 'file.txt' }])
  })

  test('emits tool_result with null content when output absent', () => {
    const raw = parseCodexLine(
      JSON.stringify({
        method: 'item/toolCall',
        params: { turnId: 'turn_456', id: 'call_abc', name: 'shell', input: {}, status: 'completed' },
      }),
    )!
    const { events } = translateCodexLine(raw)
    expect(events).toEqual([{ kind: 'tool_result', toolUseId: 'call_abc', content: null }])
  })
})

// ---------------------------------------------------------------------------
// translateCodexLine — item/toolCall (failed)
// ---------------------------------------------------------------------------

describe('translateCodexLine — item/toolCall status=failed', () => {
  test('emits tool_result with error object containing output', () => {
    const raw = parseCodexLine(
      JSON.stringify({
        method: 'item/toolCall',
        params: {
          turnId: 'turn_456',
          id: 'call_abc',
          name: 'shell',
          input: {},
          status: 'failed',
          output: 'permission denied',
        },
      }),
    )!
    const { events } = translateCodexLine(raw)
    expect(events).toEqual([
      { kind: 'tool_result', toolUseId: 'call_abc', content: { error: 'permission denied' } },
    ])
  })

  test('emits tool_result with default error message when output absent', () => {
    const raw = parseCodexLine(
      JSON.stringify({
        method: 'item/toolCall',
        params: { turnId: 'turn_456', id: 'call_abc', name: 'shell', input: {}, status: 'failed' },
      }),
    )!
    const { events } = translateCodexLine(raw)
    expect(events).toEqual([
      { kind: 'tool_result', toolUseId: 'call_abc', content: { error: 'tool failed' } },
    ])
  })
})

// ---------------------------------------------------------------------------
// translateCodexLine — turn/completed
// ---------------------------------------------------------------------------

describe('translateCodexLine — turn/completed', () => {
  test('emits turn_complete with null cost fields', () => {
    const raw = parseCodexLine(
      JSON.stringify({ method: 'turn/completed', params: { turn: { id: 'turn_456', status: 'completed' } } }),
    )!
    const { events } = translateCodexLine(raw)
    expect(events).toEqual([{ kind: 'turn_complete', totalTokens: null, totalCostUsd: null, numTurns: null }])
  })
})

// ---------------------------------------------------------------------------
// translateCodexLine — turn/failed
// ---------------------------------------------------------------------------

describe('translateCodexLine — turn/failed', () => {
  test('emits error with turn error message', () => {
    const raw = parseCodexLine(
      JSON.stringify({
        method: 'turn/failed',
        params: { turn: { id: 'turn_456', status: 'failed', error: { message: 'context limit exceeded' } } },
      }),
    )!
    const { events } = translateCodexLine(raw)
    expect(events).toEqual([{ kind: 'error', error: 'context limit exceeded' }])
  })

  test('emits fallback error message when error object absent', () => {
    const raw = parseCodexLine(
      JSON.stringify({ method: 'turn/failed', params: { turn: { id: 'turn_456', status: 'failed' } } }),
    )!
    const { events } = translateCodexLine(raw)
    expect(events).toEqual([{ kind: 'error', error: 'turn failed' }])
  })
})

// ---------------------------------------------------------------------------
// translateCodexLine — JSON-RPC error response
// ---------------------------------------------------------------------------

describe('translateCodexLine — JSON-RPC error response', () => {
  test('emits error from JSON-RPC error field', () => {
    const raw = parseCodexLine(
      JSON.stringify({ id: 1, error: { code: -32000, message: 'rate limit exceeded' } }),
    )!
    const { events } = translateCodexLine(raw)
    expect(events).toEqual([{ kind: 'error', error: 'rate limit exceeded' }])
  })

  test('emits no events for successful JSON-RPC response', () => {
    const raw = parseCodexLine(JSON.stringify({ id: 1, result: { ok: true } }))!
    const { events } = translateCodexLine(raw)
    expect(events).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// translateCodexLine — unknown method
// ---------------------------------------------------------------------------

describe('translateCodexLine — unknown method', () => {
  test('emits no events and warns', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    const raw = parseCodexLine(
      JSON.stringify({ method: 'some/futureMethod', params: { foo: 'bar' } }),
    )!
    const { events } = translateCodexLine(raw)
    expect(events).toHaveLength(0)
    expect(warn).toHaveBeenCalledWith('[codex-stream] Unknown notification method:', 'some/futureMethod')
    warn.mockRestore()
  })
})
