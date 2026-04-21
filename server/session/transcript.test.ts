import { describe, it, expect } from 'bun:test'
import { TranscriptTranslator } from './transcript'
import type { ParsedStreamEvent } from './stream-json-types'
import type { AssistantTextEvent, TurnCompletedEvent, ToolCallEvent, ToolResultEvent, StatusEvent } from '../../shared/api-types'

function makeTranslator(startingSeq = 0, startingTurn = 0) {
  let seq = 0
  return new TranscriptTranslator({
    sessionId: 'test-session',
    startingSeq,
    startingTurn,
    now: () => 1000,
    idGen: () => `id-${seq++}`,
  })
}

describe('TranscriptTranslator', () => {
  describe('seq monotonicity', () => {
    it('starts at startingSeq and increments strictly', () => {
      const t = makeTranslator(5)
      const userMsg = t.userMessage('hello')
      expect(userMsg.seq).toBe(5)

      const turnStarted = t.startTurn('user_message')
      expect(turnStarted?.seq).toBe(6)

      const events = t.handle({ kind: 'text_delta', text: 'Hi' })
      expect(events[0]?.seq).toBe(7)
    })

    it('seq is strictly monotonic across all event types', () => {
      const t = makeTranslator(0)
      const allEvents = [
        t.userMessage('hello'),
        t.startTurn('user_message'),
        ...t.handle({ kind: 'text_delta', text: 'A' }),
        ...t.handle({ kind: 'text_delta', text: 'B' }),
      ]
      const seqs = allEvents.filter(Boolean).map((e) => e!.seq)
      for (let i = 1; i < seqs.length; i++) {
        expect(seqs[i]).toBe((seqs[i - 1] ?? 0) + 1)
      }
    })
  })

  describe('full happy-path flow', () => {
    it('user_message → turn_started → assistant_text deltas → final + turn_completed', () => {
      const t = makeTranslator(0)

      const userMsg = t.userMessage('hello')
      expect(userMsg.type).toBe('user_message')
      expect((userMsg as { text: string }).text).toBe('hello')

      const turnStarted = t.startTurn('user_message')
      expect(turnStarted?.type).toBe('turn_started')

      const delta1 = t.handle({ kind: 'text_delta', text: 'He' })
      expect(delta1).toHaveLength(1)
      const d1 = delta1[0] as AssistantTextEvent
      expect(d1.type).toBe('assistant_text')
      expect(d1.text).toBe('He')
      expect(d1.final).toBe(false)

      const delta2 = t.handle({ kind: 'text_delta', text: 'llo' })
      const d2 = delta2[0] as AssistantTextEvent
      expect(d2.text).toBe('llo')
      expect(d2.final).toBe(false)
      expect(d2.blockId).toBe(d1.blockId)

      const complete = t.handle({
        kind: 'turn_complete',
        totalTokens: 100,
        totalCostUsd: 0.001,
        numTurns: 1,
      })

      const finalText = complete.find((e) => e.type === 'assistant_text' && (e as AssistantTextEvent).final) as AssistantTextEvent | undefined
      expect(finalText).toBeDefined()
      expect(finalText?.text).toBe('Hello')
      expect(finalText?.blockId).toBe(d1.blockId)

      const turnCompleted = complete.find((e) => e.type === 'turn_completed') as TurnCompletedEvent | undefined
      expect(turnCompleted).toBeDefined()
      expect(turnCompleted?.totalTokens).toBe(100)
      expect(turnCompleted?.totalCostUsd).toBe(0.001)
      expect(turnCompleted?.errored).toBeUndefined()
    })
  })

  describe('turn counter', () => {
    it('increments turn on each startTurn call', () => {
      const t = makeTranslator(0, 0)

      const t1 = t.startTurn('user_message')
      expect(t1?.turn).toBe(1)
      expect(t.currentTurn).toBe(1)

      t.closeTurn()

      const t2 = t.startTurn('agent_continuation')
      expect(t2?.turn).toBe(2)
      expect(t.currentTurn).toBe(2)
    })

    it('startTurn returns null when turn already open', () => {
      const t = makeTranslator()
      t.startTurn('user_message')
      const second = t.startTurn('agent_continuation')
      expect(second).toBeNull()
    })
  })

  describe('tool_use + tool_result pairing', () => {
    it('emits tool_call and tool_result, clears pendingTools', () => {
      const t = makeTranslator()
      t.startTurn('user_message')

      const callEvents = t.handle({
        kind: 'tool_use',
        id: 'tool-1',
        name: 'Bash',
        input: { command: 'echo hello' },
      } satisfies ParsedStreamEvent)

      const toolCall = callEvents.find((e) => e.type === 'tool_call') as ToolCallEvent | undefined
      expect(toolCall).toBeDefined()
      expect(toolCall?.call.toolUseId).toBe('tool-1')
      expect(toolCall?.call.kind).toBe('bash')
      expect(toolCall?.call.name).toBe('Bash')

      const resultEvents = t.handle({
        kind: 'tool_result',
        toolUseId: 'tool-1',
        content: 'hello\n',
      } satisfies ParsedStreamEvent)

      const toolResult = resultEvents.find((e) => e.type === 'tool_result') as ToolResultEvent | undefined
      expect(toolResult).toBeDefined()
      expect(toolResult?.toolUseId).toBe('tool-1')
      expect(toolResult?.result.status).toBe('ok')
      expect(toolResult?.result.text).toBe('hello\n')
    })

    it('tool_result with unknown toolUseId still emits event', () => {
      const t = makeTranslator()
      t.startTurn('user_message')

      const resultEvents = t.handle({
        kind: 'tool_result',
        toolUseId: 'nonexistent-id',
        content: 'some output',
      } satisfies ParsedStreamEvent)

      const toolResult = resultEvents.find((e) => e.type === 'tool_result') as ToolResultEvent | undefined
      expect(toolResult).toBeDefined()
      expect(toolResult?.toolUseId).toBe('nonexistent-id')
    })
  })

  describe('error event', () => {
    it('emits status with severity error and kind session_error', () => {
      const t = makeTranslator()
      const events = t.handle({ kind: 'error', error: 'Something went wrong' } satisfies ParsedStreamEvent)

      expect(events).toHaveLength(1)
      const status = events[0] as StatusEvent
      expect(status.type).toBe('status')
      expect(status.severity).toBe('error')
      expect(status.kind).toBe('session_error')
      expect(status.message).toBe('Something went wrong')
    })
  })

  describe('closeTurn with errored', () => {
    it('emits turn_completed with errored:true', () => {
      const t = makeTranslator()
      t.startTurn('user_message')

      const completed = t.closeTurn(undefined, undefined, true) as TurnCompletedEvent | null
      expect(completed).toBeDefined()
      expect(completed?.type).toBe('turn_completed')
      expect(completed?.errored).toBe(true)
    })

    it('returns null when no turn is open', () => {
      const t = makeTranslator()
      expect(t.closeTurn()).toBeNull()
    })
  })

  describe('truncation', () => {
    it('truncates a 100KB bash result to 64KB with truncated:true and originalBytes set', () => {
      const t = makeTranslator()
      t.startTurn('user_message')

      const large = 'A'.repeat(100 * 1024)

      t.handle({ kind: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: 'cat big' } } satisfies ParsedStreamEvent)

      const resultEvents = t.handle({
        kind: 'tool_result',
        toolUseId: 'bash-1',
        content: large,
      } satisfies ParsedStreamEvent)

      const toolResult = resultEvents.find((e) => e.type === 'tool_result') as ToolResultEvent | undefined
      expect(toolResult).toBeDefined()
      expect(toolResult?.result.truncated).toBe(true)
      expect(toolResult?.result.originalBytes).toBeGreaterThan(64 * 1024)
      expect(Buffer.byteLength(toolResult?.result.text ?? '', 'utf8')).toBeLessThanOrEqual(64 * 1024 + 20)
    })

    it('truncates a 100KB file read result to 32KB', () => {
      const t = makeTranslator()
      t.startTurn('user_message')

      const large = 'B'.repeat(100 * 1024)

      t.handle({ kind: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: '/tmp/big' } } satisfies ParsedStreamEvent)

      const resultEvents = t.handle({
        kind: 'tool_result',
        toolUseId: 'read-1',
        content: large,
      } satisfies ParsedStreamEvent)

      const toolResult = resultEvents.find((e) => e.type === 'tool_result') as ToolResultEvent | undefined
      expect(toolResult?.result.truncated).toBe(true)
      expect(toolResult?.result.originalBytes).toBeGreaterThan(32 * 1024)
      expect(Buffer.byteLength(toolResult?.result.text ?? '', 'utf8')).toBeLessThanOrEqual(32 * 1024 + 20)
    })
  })

  describe('session_id event', () => {
    it('produces no transcript events', () => {
      const t = makeTranslator()
      const events = t.handle({ kind: 'session_id', sessionId: 'claude-abc-123' } satisfies ParsedStreamEvent)
      expect(events).toHaveLength(0)
    })
  })

  describe('thinking_block', () => {
    it('emits thinking event with final:true', () => {
      const t = makeTranslator()
      t.startTurn('user_message')

      const events = t.handle({
        kind: 'thinking_block',
        text: 'Let me think...',
        signature: 'sig-abc',
      } satisfies ParsedStreamEvent)

      expect(events).toHaveLength(1)
      const thinking = events[0]
      expect(thinking?.type).toBe('thinking')
      if (thinking?.type === 'thinking') {
        expect(thinking.text).toBe('Let me think...')
        expect(thinking.final).toBe(true)
        expect(thinking.signature).toBe('sig-abc')
      }
    })
  })

  describe('userMessage with images', () => {
    it('attaches images array', () => {
      const t = makeTranslator()
      const evt = t.userMessage('look at this', ['data:image/png;base64,abc'])
      expect(evt.type).toBe('user_message')
      if (evt.type === 'user_message') {
        expect(evt.images).toEqual(['data:image/png;base64,abc'])
      }
    })
  })
})
