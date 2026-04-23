import { describe, test, expect, spyOn } from 'bun:test'
import { parseClaudeLine, translateLine, serializeUserMessage, makeLineReader } from './stream-json.js'
import type { ClaudeStreamLine } from './stream-json-types.js'

// ---------------------------------------------------------------------------
// parseClaudeLine
// ---------------------------------------------------------------------------

describe('parseClaudeLine', () => {
  test('returns null on empty string', () => {
    expect(parseClaudeLine('')).toBeNull()
  })

  test('returns null on whitespace-only string', () => {
    expect(parseClaudeLine('   \t  ')).toBeNull()
  })

  test('returns null on non-JSON and warns', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseClaudeLine('not json {')).toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  test('parses valid JSON object', () => {
    const line = JSON.stringify({ type: 'system', session_id: 'abc' })
    const result = parseClaudeLine(line)
    expect(result).toEqual({ type: 'system', session_id: 'abc' })
  })

  test('trims whitespace before parsing', () => {
    const line = '  ' + JSON.stringify({ type: 'system' }) + '  '
    const result = parseClaudeLine(line)
    expect(result).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// translateLine — session_id handling
// ---------------------------------------------------------------------------

describe('translateLine — session_id', () => {
  const systemLine: ClaudeStreamLine = { type: 'system', session_id: 'sess-1' }

  test('emits session_id event on first occurrence', () => {
    const { events, sessionId } = translateLine(systemLine, undefined)
    expect(events).toEqual([{ kind: 'session_id', sessionId: 'sess-1' }])
    expect(sessionId).toBe('sess-1')
  })

  test('does not emit session_id again when same id arrives', () => {
    const { events, sessionId } = translateLine(systemLine, 'sess-1')
    expect(events).toHaveLength(0)
    expect(sessionId).toBe('sess-1')
  })

  test('emits session_id again when id changes', () => {
    const { events, sessionId } = translateLine({ type: 'system', session_id: 'sess-2' }, 'sess-1')
    expect(events).toEqual([{ kind: 'session_id', sessionId: 'sess-2' }])
    expect(sessionId).toBe('sess-2')
  })

  test('session_id event is prepended before other events', () => {
    const line: ClaudeStreamLine = {
      type: 'stream_event',
      session_id: 'new-sess',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } },
    }
    const { events } = translateLine(line, undefined)
    expect(events[0]).toEqual({ kind: 'session_id', sessionId: 'new-sess' })
    expect(events[1]).toMatchObject({ kind: 'text_delta', text: 'hello' })
  })
})

// ---------------------------------------------------------------------------
// translateLine — stream_event
// ---------------------------------------------------------------------------

describe('translateLine — stream_event', () => {
  test('emits text_delta for content_block_delta with text_delta', () => {
    const line: ClaudeStreamLine = {
      type: 'stream_event',
      parent_tool_use_id: null,
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } },
    }
    const { events } = translateLine(line, undefined)
    expect(events).toEqual([{ kind: 'text_delta', text: 'world', parentToolUseId: null }])
  })

  test('emits nothing for other event types', () => {
    const line: ClaudeStreamLine = {
      type: 'stream_event',
      event: { type: 'content_block_start', content_block: { type: 'text' } },
    }
    const { events } = translateLine(line, undefined)
    expect(events).toHaveLength(0)
  })

  test('emits nothing when delta text is empty', () => {
    const line: ClaudeStreamLine = {
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '' } },
    }
    const { events } = translateLine(line, undefined)
    expect(events).toHaveLength(0)
  })

  test('passes parentToolUseId through', () => {
    const line: ClaudeStreamLine = {
      type: 'stream_event',
      parent_tool_use_id: 'tu-abc',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } },
    }
    const { events } = translateLine(line, undefined)
    expect(events).toEqual([{ kind: 'text_delta', text: 'hi', parentToolUseId: 'tu-abc' }])
  })
})

// ---------------------------------------------------------------------------
// translateLine — assistant
// ---------------------------------------------------------------------------

describe('translateLine — assistant', () => {
  test('emits thinking_block for thinking content', () => {
    const line: ClaudeStreamLine = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'hmm', signature: 'sig-x' }],
      },
    }
    const { events } = translateLine(line, undefined)
    expect(events).toEqual([
      { kind: 'thinking_block', text: 'hmm', signature: 'sig-x', parentToolUseId: undefined },
    ])
  })

  test('emits tool_use for tool_use content', () => {
    const line: ClaudeStreamLine = {
      type: 'assistant',
      message: {
        role: 'assistant',
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu-1', name: 'bash', input: { cmd: 'ls' } }],
      },
    }
    const { events } = translateLine(line, undefined)
    expect(events).toEqual([
      {
        kind: 'tool_use',
        id: 'tu-1',
        name: 'bash',
        input: { cmd: 'ls' },
        parentToolUseId: undefined,
        stopReason: 'tool_use',
      },
    ])
  })

  test('mixed thinking + two tool_uses: last tool_use gets stopReason', () => {
    const line: ClaudeStreamLine = {
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        stop_reason: 'tool_use',
        content: [
          { type: 'thinking', thinking: 'plan', signature: undefined },
          { type: 'tool_use', id: 'tu-1', name: 'read', input: {} },
          { type: 'tool_use', id: 'tu-2', name: 'write', input: { text: 'x' } },
        ],
      },
    }
    const { events } = translateLine(line, undefined)

    expect(events).toHaveLength(3)

    expect(events[0]).toMatchObject({ kind: 'thinking_block', text: 'plan' })

    const firstTool = events[1]
    expect(firstTool).toMatchObject({ kind: 'tool_use', id: 'tu-1', name: 'read' })
    expect((firstTool as { stopReason?: unknown }).stopReason).toBeUndefined()

    const lastTool = events[2]
    expect(lastTool).toMatchObject({ kind: 'tool_use', id: 'tu-2', name: 'write', stopReason: 'tool_use' })
  })

  test('emits synthetic turn_complete when no thinking/tool_use but stop_reason set', () => {
    const line: ClaudeStreamLine = {
      type: 'assistant',
      message: {
        role: 'assistant',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'done' }],
      },
    }
    const { events } = translateLine(line, undefined)
    expect(events).toEqual([
      { kind: 'turn_complete', totalTokens: null, totalCostUsd: null, numTurns: null },
    ])
  })

  test('drops tool_use missing name and warns', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    const line: ClaudeStreamLine = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu-bad', name: '', input: {} }],
      },
    }
    const { events } = translateLine(line, undefined)
    expect(events).toHaveLength(0)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  test('does not emit turn_complete when only thinking and stop_reason', () => {
    const line: ClaudeStreamLine = {
      type: 'assistant',
      message: {
        role: 'assistant',
        stop_reason: 'end_turn',
        content: [{ type: 'thinking', thinking: 'thought', signature: undefined }],
      },
    }
    const { events } = translateLine(line, undefined)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'thinking_block' })
  })
})

// ---------------------------------------------------------------------------
// translateLine — user
// ---------------------------------------------------------------------------

describe('translateLine — user', () => {
  test('emits tool_result for tool_result blocks', () => {
    const line: ClaudeStreamLine = {
      type: 'user',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'result text' }],
      },
    }
    const { events } = translateLine(line, undefined)
    expect(events).toEqual([
      { kind: 'tool_result', toolUseId: 'tu-1', content: 'result text', parentToolUseId: null },
    ])
  })

  test('falls back to id when tool_use_id missing', () => {
    const line: ClaudeStreamLine = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', id: 'fallback-id', content: 42 }],
      },
    }
    const { events } = translateLine(line, undefined)
    expect(events).toEqual([
      { kind: 'tool_result', toolUseId: 'fallback-id', content: 42, parentToolUseId: undefined },
    ])
  })

  test('drops tool_result missing both tool_use_id and id and warns', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    const line: ClaudeStreamLine = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', content: 'orphaned' }],
      },
    }
    const { events } = translateLine(line, undefined)
    expect(events).toHaveLength(0)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  test('skips non-tool_result blocks', () => {
    const line: ClaudeStreamLine = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
      },
    }
    const { events } = translateLine(line, undefined)
    expect(events).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// translateLine — result
// ---------------------------------------------------------------------------

describe('translateLine — result', () => {
  test('emits error on is_error=true', () => {
    const line: ClaudeStreamLine = {
      type: 'result',
      is_error: true,
      result: 'something went wrong',
    }
    const { events } = translateLine(line, undefined)
    expect(events).toEqual([{ kind: 'error', error: 'something went wrong' }])
  })

  test('emits Unknown error when result missing on error', () => {
    const line: ClaudeStreamLine = {
      type: 'result',
      is_error: true,
    }
    const { events } = translateLine(line, undefined)
    expect(events).toEqual([{ kind: 'error', error: 'Unknown error' }])
  })

  test('emits turn_complete on success with usage', () => {
    const line: ClaudeStreamLine = {
      type: 'result',
      total_cost_usd: 0.05,
      num_turns: 3,
      usage: { input_tokens: 100, output_tokens: 200 },
    }
    const { events } = translateLine(line, undefined)
    expect(events).toEqual([
      { kind: 'turn_complete', totalTokens: 300, totalCostUsd: 0.05, numTurns: 3 },
    ])
  })

  test('emits turn_complete with null totalTokens when usage absent', () => {
    const line: ClaudeStreamLine = {
      type: 'result',
      total_cost_usd: 0.01,
      num_turns: 1,
    }
    const { events } = translateLine(line, undefined)
    expect(events).toEqual([
      { kind: 'turn_complete', totalTokens: null, totalCostUsd: 0.01, numTurns: 1 },
    ])
  })

  test('sums partial usage tokens (only output_tokens set)', () => {
    const line: ClaudeStreamLine = {
      type: 'result',
      usage: { output_tokens: 50 },
    }
    const { events } = translateLine(line, undefined)
    expect(events[0]).toMatchObject({ kind: 'turn_complete', totalTokens: 50 })
  })
})

// ---------------------------------------------------------------------------
// translateLine — system
// ---------------------------------------------------------------------------

describe('translateLine — system', () => {
  test('emits no events for system line (no session_id)', () => {
    const line: ClaudeStreamLine = { type: 'system' }
    const { events } = translateLine(line, undefined)
    expect(events).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// serializeUserMessage
// ---------------------------------------------------------------------------

describe('serializeUserMessage', () => {
  test('text-only produces correct shape (round-trip)', () => {
    const line = serializeUserMessage('hello world')
    const parsed = JSON.parse(line)
    expect(parsed).toEqual({
      type: 'user',
      session_id: '',
      message: { role: 'user', content: 'hello world' },
      parent_tool_use_id: null,
    })
  })

  test('passes parentToolUseId through', () => {
    const line = serializeUserMessage('hi', undefined, 'tu-parent')
    const parsed = JSON.parse(line)
    expect(parsed.parent_tool_use_id).toBe('tu-parent')
  })

  test('with images: text first, image blocks after', () => {
    const line = serializeUserMessage('caption', [
      { mediaType: 'image/png', dataBase64: 'abc==' },
      { mediaType: 'image/jpeg', dataBase64: 'def==' },
    ])
    const parsed = JSON.parse(line)
    const content = parsed.message.content as unknown[]
    expect(content).toHaveLength(3)
    expect(content[0]).toEqual({ type: 'text', text: 'caption' })
    expect(content[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'abc==' },
    })
    expect(content[2]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'def==' },
    })
  })

  test('empty images array produces text-only content', () => {
    const line = serializeUserMessage('only text', [])
    const parsed = JSON.parse(line)
    expect(typeof parsed.message.content).toBe('string')
    expect(parsed.message.content).toBe('only text')
  })

  test('produces no trailing newline', () => {
    const line = serializeUserMessage('test')
    expect(line.endsWith('\n')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// makeLineReader
// ---------------------------------------------------------------------------

describe('makeLineReader', () => {
  test('delivers complete lines', () => {
    const lines: string[] = []
    const reader = makeLineReader((l) => lines.push(l))
    reader('hello\nworld\n')
    expect(lines).toEqual(['hello', 'world'])
  })

  test('assembles lines across chunk boundaries', () => {
    const lines: string[] = []
    const reader = makeLineReader((l) => lines.push(l))
    reader('hel')
    reader('lo\nwor')
    reader('ld\n')
    expect(lines).toEqual(['hello', 'world'])
  })

  test('skips empty lines', () => {
    const lines: string[] = []
    const reader = makeLineReader((l) => lines.push(l))
    reader('\n\nfoo\n\n')
    expect(lines).toEqual(['foo'])
  })

  test('handles CRLF line endings', () => {
    const lines: string[] = []
    const reader = makeLineReader((l) => lines.push(l))
    reader('line1\r\nline2\r\n')
    expect(lines).toEqual(['line1', 'line2'])
  })

  test('buffers partial line without emitting', () => {
    const lines: string[] = []
    const reader = makeLineReader((l) => lines.push(l))
    reader('no newline yet')
    expect(lines).toHaveLength(0)
    reader('\n')
    expect(lines).toEqual(['no newline yet'])
  })

  test('accepts Buffer input', () => {
    const lines: string[] = []
    const reader = makeLineReader((l) => lines.push(l))
    reader(Buffer.from('buffered\n'))
    expect(lines).toEqual(['buffered'])
  })

  test('multiple lines in single chunk', () => {
    const lines: string[] = []
    const reader = makeLineReader((l) => lines.push(l))
    reader('a\nb\nc\n')
    expect(lines).toEqual(['a', 'b', 'c'])
  })
})
