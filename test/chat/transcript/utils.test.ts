import { describe, expect, it } from 'vitest'
import {
  buildTranscriptRows,
  formatCostUsd,
  formatDuration,
  formatTokens,
  triggerLabel,
} from '../../../src/chat/transcript/utils'
import type {
  AssistantTextEvent,
  StatusEvent,
  ThinkingEvent,
  ToolCallEvent,
  ToolResultEvent,
  TranscriptEvent,
  TurnCompletedEvent,
  TurnStartedEvent,
  UserMessageEvent,
} from '../../../src/api/types'

const baseEvent = (seq: number, turn = 1) => ({
  seq,
  id: `e${seq}`,
  sessionId: 's1',
  turn,
  timestamp: 1_700_000_000 + seq,
})

const userMsg = (seq: number, text = 'hello', turn = 1): UserMessageEvent => ({
  ...baseEvent(seq, turn),
  type: 'user_message',
  text,
})

const turnStarted = (seq: number, turn: number, trigger: TurnStartedEvent['trigger'] = 'user_message'): TurnStartedEvent => ({
  ...baseEvent(seq, turn),
  type: 'turn_started',
  trigger,
})

const turnCompleted = (seq: number, turn: number, extras: Partial<TurnCompletedEvent> = {}): TurnCompletedEvent => ({
  ...baseEvent(seq, turn),
  type: 'turn_completed',
  ...extras,
})

const assistantText = (seq: number, blockId: string, text: string, final: boolean, turn = 1): AssistantTextEvent => ({
  ...baseEvent(seq, turn),
  type: 'assistant_text',
  blockId,
  text,
  final,
})

const thinking = (seq: number, blockId: string, text: string, final: boolean, turn = 1): ThinkingEvent => ({
  ...baseEvent(seq, turn),
  type: 'thinking',
  blockId,
  text,
  final,
})

const toolCall = (seq: number, toolUseId: string, name = 'Read', kind: ToolCallEvent['call']['kind'] = 'read', turn = 1): ToolCallEvent => ({
  ...baseEvent(seq, turn),
  type: 'tool_call',
  call: {
    toolUseId,
    name,
    kind,
    title: `${name} ${toolUseId}`,
    input: { path: '/tmp/foo' },
  },
})

const toolResult = (
  seq: number,
  toolUseId: string,
  status: ToolResultEvent['result']['status'] = 'ok',
  text = 'output',
  turn = 1,
): ToolResultEvent => ({
  ...baseEvent(seq, turn),
  type: 'tool_result',
  toolUseId,
  result: { status, text },
})

const status = (seq: number, message = 'msg', severity: StatusEvent['severity'] = 'info', turn = 1): StatusEvent => ({
  ...baseEvent(seq, turn),
  type: 'status',
  severity,
  kind: 'agent_status',
  message,
})

describe('buildTranscriptRows', () => {
  it('returns empty rows for empty events', () => {
    expect(buildTranscriptRows([]).rows).toEqual([])
  })

  it('emits a turn separator before any content row in that turn', () => {
    const events: TranscriptEvent[] = [userMsg(1)]
    const { rows } = buildTranscriptRows(events)
    expect(rows[0].kind).toBe('turn-separator')
    expect(rows[1].kind).toBe('user-message')
  })

  it('attaches turn_started and turn_completed metadata to the separator', () => {
    const events: TranscriptEvent[] = [
      turnStarted(1, 1, 'command'),
      assistantText(2, 'b1', 'hi', true),
      turnCompleted(3, 1, { totalTokens: 1500, totalCostUsd: 0.05, durationMs: 12_345 }),
    ]
    const { rows } = buildTranscriptRows(events)
    const sep = rows[0]
    expect(sep.kind).toBe('turn-separator')
    if (sep.kind === 'turn-separator') {
      expect(sep.started?.trigger).toBe('command')
      expect(sep.completed?.totalTokens).toBe(1500)
      expect(sep.completed?.totalCostUsd).toBe(0.05)
      expect(sep.completed?.durationMs).toBe(12_345)
    }
  })

  it('opens a new separator at every turn boundary', () => {
    const events: TranscriptEvent[] = [
      userMsg(1, 'first', 1),
      userMsg(2, 'second', 2),
      userMsg(3, 'third', 2),
    ]
    const { rows } = buildTranscriptRows(events)
    const separators = rows.filter((r) => r.kind === 'turn-separator')
    expect(separators).toHaveLength(2)
  })

  it('accumulates streaming assistant_text deltas and replaces with full text on final', () => {
    const events: TranscriptEvent[] = [
      assistantText(1, 'b1', 'Hel', false),
      assistantText(2, 'b1', 'lo ', false),
      assistantText(3, 'b1', 'world', false),
      assistantText(4, 'b1', 'Hello world', true),
    ]
    const { rows } = buildTranscriptRows(events)
    const textRows = rows.filter((r) => r.kind === 'assistant-text')
    expect(textRows).toHaveLength(1)
    if (textRows[0].kind === 'assistant-text') {
      expect(textRows[0].event.text).toBe('Hello world')
      expect(textRows[0].event.final).toBe(true)
    }
  })

  it('accumulates partial assistant_text deltas even before the final event arrives', () => {
    const events: TranscriptEvent[] = [
      assistantText(1, 'b1', 'Hel', false),
      assistantText(2, 'b1', 'lo', false),
    ]
    const { rows } = buildTranscriptRows(events)
    const textRows = rows.filter((r) => r.kind === 'assistant-text')
    expect(textRows).toHaveLength(1)
    if (textRows[0].kind === 'assistant-text') {
      expect(textRows[0].event.text).toBe('Hello')
      expect(textRows[0].event.final).toBe(false)
    }
  })

  it('accumulates streaming thinking deltas', () => {
    const events: TranscriptEvent[] = [
      thinking(1, 'th1', 'part', false),
      thinking(2, 'th1', 'ial', false),
      thinking(3, 'th1', ' more', false),
      thinking(4, 'th1', 'partial more', true),
    ]
    const { rows } = buildTranscriptRows(events)
    const thRows = rows.filter((r) => r.kind === 'thinking')
    expect(thRows).toHaveLength(1)
    if (thRows[0].kind === 'thinking') {
      expect(thRows[0].event.text).toBe('partial more')
      expect(thRows[0].event.final).toBe(true)
    }
  })

  it('pairs tool_call with matching tool_result by toolUseId', () => {
    const events: TranscriptEvent[] = [
      toolCall(1, 'tu1'),
      toolResult(2, 'tu1', 'ok', 'output text'),
    ]
    const { rows } = buildTranscriptRows(events)
    const callRows = rows.filter((r) => r.kind === 'tool-call')
    const orphanRows = rows.filter((r) => r.kind === 'tool-result-orphan')
    expect(callRows).toHaveLength(1)
    expect(orphanRows).toHaveLength(0)
    if (callRows[0].kind === 'tool-call') {
      expect(callRows[0].result?.result.text).toBe('output text')
    }
  })

  it('attaches tool_result that arrives before tool_call in the input order via seq sort', () => {
    const events: TranscriptEvent[] = [
      toolResult(2, 'tu1', 'ok', 'arrived first'),
      toolCall(1, 'tu1'),
    ]
    const { rows } = buildTranscriptRows(events)
    const callRows = rows.filter((r) => r.kind === 'tool-call')
    expect(callRows).toHaveLength(1)
    if (callRows[0].kind === 'tool-call') {
      expect(callRows[0].result?.result.text).toBe('arrived first')
    }
    expect(rows.filter((r) => r.kind === 'tool-result-orphan')).toHaveLength(0)
  })

  it('emits an orphan row for tool_result without a matching tool_call', () => {
    const events: TranscriptEvent[] = [toolResult(1, 'missing', 'ok', 'lonely')]
    const { rows } = buildTranscriptRows(events)
    const orphans = rows.filter((r) => r.kind === 'tool-result-orphan')
    expect(orphans).toHaveLength(1)
  })

  it('renders status events as-is', () => {
    const events: TranscriptEvent[] = [status(1, 'ci passed', 'info')]
    const { rows } = buildTranscriptRows(events)
    const statusRows = rows.filter((r) => r.kind === 'status')
    expect(statusRows).toHaveLength(1)
    if (statusRows[0].kind === 'status') {
      expect(statusRows[0].event.message).toBe('ci passed')
    }
  })

  it('preserves seq order across all event kinds', () => {
    const events: TranscriptEvent[] = [
      turnStarted(1, 1),
      userMsg(2, 'q', 1),
      assistantText(3, 'b1', 'a', true, 1),
      toolCall(4, 'tu1', 'Bash', 'bash', 1),
      toolResult(5, 'tu1', 'ok', 'done', 1),
      status(6, 'fyi', 'info', 1),
      turnCompleted(7, 1),
    ]
    const { rows } = buildTranscriptRows(events)
    const kinds = rows.map((r) => r.kind)
    expect(kinds).toEqual([
      'turn-separator',
      'user-message',
      'assistant-text',
      'tool-call',
      'status',
    ])
  })
})

describe('formatDuration', () => {
  it('returns null for invalid input', () => {
    expect(formatDuration(undefined)).toBeNull()
    expect(formatDuration(NaN)).toBeNull()
    expect(formatDuration(-1)).toBeNull()
  })
  it('formats sub-second as ms', () => {
    expect(formatDuration(250)).toBe('250ms')
  })
  it('formats seconds with one decimal under 10s', () => {
    expect(formatDuration(2_500)).toBe('2.5s')
  })
  it('formats seconds without decimal at/over 10s', () => {
    expect(formatDuration(45_000)).toBe('45s')
  })
  it('formats minutes', () => {
    expect(formatDuration(125_000)).toBe('2m 5s')
    expect(formatDuration(180_000)).toBe('3m')
  })
})

describe('formatTokens', () => {
  it('returns null for invalid', () => {
    expect(formatTokens(undefined)).toBeNull()
    expect(formatTokens(NaN)).toBeNull()
    expect(formatTokens(-1)).toBeNull()
  })
  it('formats below 1k as exact', () => {
    expect(formatTokens(750)).toBe('750')
  })
  it('formats k', () => {
    expect(formatTokens(1500)).toBe('1.5k')
    expect(formatTokens(45_000)).toBe('45k')
  })
  it('formats M', () => {
    expect(formatTokens(2_500_000)).toBe('2.5M')
  })
})

describe('formatCostUsd', () => {
  it('returns null for invalid', () => {
    expect(formatCostUsd(undefined)).toBeNull()
    expect(formatCostUsd(-0.1)).toBeNull()
  })
  it('formats small amounts to 4 decimals', () => {
    expect(formatCostUsd(0.0042)).toBe('$0.0042')
  })
  it('formats normal amounts to 2 decimals', () => {
    expect(formatCostUsd(1.23)).toBe('$1.23')
  })
})

describe('triggerLabel', () => {
  it('maps each trigger', () => {
    expect(triggerLabel('user_message')).toBe('User message')
    expect(triggerLabel('agent_continuation')).toBe('Continuation')
    expect(triggerLabel('command')).toBe('Command')
    expect(triggerLabel('reply_injected')).toBe('Injected reply')
    expect(triggerLabel('resume')).toBe('Resumed')
  })
})
