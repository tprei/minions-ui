import type { ProviderEvent } from '../types.js'
import type { CodexLine } from './stream-types.js'

export function parseCodexLine(raw: string): CodexLine | null {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  try {
    return JSON.parse(trimmed) as CodexLine
  } catch {
    console.warn('[codex-stream] Failed to parse line:', trimmed.slice(0, 200))
    return null
  }
}

export function translateCodexLine(
  raw: CodexLine,
): { events: ProviderEvent[]; sessionId?: string } {
  const events: ProviderEvent[] = []
  let sessionId: string | undefined

  if ('id' in raw) {
    if (raw.error) {
      events.push({ kind: 'error', error: raw.error.message })
    }
    return { events, sessionId }
  }

  switch (raw.method) {
    case 'thread/started': {
      const threadId = raw.params.thread.id
      if (!threadId) {
        events.push({ kind: 'error', error: 'thread/started: missing thread.id' })
        break
      }
      events.push({ kind: 'session_id', sessionId: threadId })
      sessionId = threadId
      break
    }

    case 'turn/started':
      break

    case 'item/agentMessage/delta': {
      const delta = raw.params.delta
      if (!delta) {
        events.push({ kind: 'error', error: 'item/agentMessage/delta: missing delta field' })
        break
      }
      events.push({ kind: 'text_delta', text: delta })
      break
    }

    case 'item/agentMessage':
      break

    case 'item/reasoning/delta':
      // Reasoning deltas are discarded; the final item/reasoning carries the full text.
      // TranscriptTranslator.handleThinkingBlock emits final:true on every call and does
      // not accumulate, so streaming deltas would produce fragmented thinking blocks.
      break

    case 'item/reasoning': {
      const text = raw.params.text
      if (!text) {
        events.push({ kind: 'error', error: 'item/reasoning: missing text field' })
        break
      }
      events.push({ kind: 'thinking_block', text })
      break
    }

    case 'item/toolCall': {
      const p = raw.params
      if (p.status === 'inProgress') {
        if (!p.id || !p.name || p.input === undefined) {
          events.push({ kind: 'error', error: 'item/toolCall inProgress: missing required field (id, name, or input)' })
          break
        }
        events.push({ kind: 'tool_use', id: p.id, name: p.name, input: p.input })
      } else if (p.status === 'completed') {
        if (!p.id) {
          events.push({ kind: 'error', error: 'item/toolCall completed: missing id' })
          break
        }
        events.push({ kind: 'tool_result', toolUseId: p.id, content: p.output ?? null })
      } else if (p.status === 'failed') {
        if (!p.id) {
          events.push({ kind: 'error', error: 'item/toolCall failed: missing id' })
          break
        }
        events.push({ kind: 'tool_result', toolUseId: p.id, content: { error: p.output ?? 'tool failed' } })
      }
      break
    }

    case 'turn/completed':
      events.push({ kind: 'turn_complete', totalTokens: null, totalCostUsd: null, numTurns: null })
      break

    case 'turn/failed': {
      const turn = raw.params.turn
      events.push({ kind: 'error', error: turn.error?.message ?? 'turn failed' })
      break
    }

    default: {
      const method = (raw as unknown as { method: string }).method
      console.warn('[codex-stream] Unknown notification method:', method)
      break
    }
  }

  return { events, sessionId }
}
