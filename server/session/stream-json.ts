import type { ClaudeStreamLine, ParsedStreamEvent } from './stream-json-types.js'

export type { ClaudeStreamLine, ParsedStreamEvent } from './stream-json-types.js'

export function parseClaudeLine(raw: string): ClaudeStreamLine | null {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  try {
    return JSON.parse(trimmed) as ClaudeStreamLine
  } catch {
    console.warn('[stream-json] Failed to parse line:', trimmed.slice(0, 200))
    return null
  }
}

export function translateLine(
  raw: ClaudeStreamLine,
  prevSessionId: string | undefined,
): { events: ParsedStreamEvent[]; sessionId: string | undefined } {
  const events: ParsedStreamEvent[] = []
  let sessionId = prevSessionId

  const incomingSessionId = 'session_id' in raw ? (raw.session_id as string | undefined) : undefined
  if (incomingSessionId && incomingSessionId !== prevSessionId) {
    events.push({ kind: 'session_id', sessionId: incomingSessionId })
    sessionId = incomingSessionId
  }

  switch (raw.type) {
    case 'stream_event': {
      const evt = raw.event
      if (
        evt.type === 'content_block_delta' &&
        evt.delta?.type === 'text_delta' &&
        evt.delta.text
      ) {
        events.push({
          kind: 'text_delta',
          text: evt.delta.text,
          parentToolUseId: raw.parent_tool_use_id,
        })
      }
      break
    }

    case 'assistant': {
      const msg = raw.message
      const parentToolUseId = raw.parent_tool_use_id
      const stopReason = msg.stop_reason ?? null

      const toolUseEvents: Array<ParsedStreamEvent & { kind: 'tool_use' }> = []

      for (const block of msg.content) {
        if (block.type === 'thinking') {
          events.push({
            kind: 'thinking_block',
            text: block.thinking,
            signature: block.signature,
            parentToolUseId,
          })
        } else if (block.type === 'tool_use') {
          if (typeof block.name !== 'string' || block.name.length === 0) {
            console.warn('[stream-json] tool_use block missing name — dropping', block.id)
            continue
          }
          toolUseEvents.push({
            kind: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input,
            parentToolUseId,
          })
        }
      }

      for (let i = 0; i < toolUseEvents.length; i++) {
        const toolEvt = toolUseEvents[i]
        if (toolEvt === undefined) continue
        if (i === toolUseEvents.length - 1 && stopReason !== null) {
          events.push({ ...toolEvt, stopReason })
        } else {
          events.push(toolEvt)
        }
      }

      if (toolUseEvents.length === 0 && stopReason !== null) {
        const hasThinking = msg.content.some((b) => b.type === 'thinking')
        if (!hasThinking) {
          events.push({ kind: 'turn_complete', totalTokens: null, totalCostUsd: null, numTurns: null })
        }
      }
      break
    }

    case 'user': {
      const msg = raw.message
      const parentToolUseId = raw.parent_tool_use_id

      for (const block of msg.content) {
        if (block.type !== 'tool_result') continue
        const toolUseId = block.tool_use_id ?? block.id
        if (!toolUseId) {
          console.warn('[stream-json] tool_result block missing tool_use_id and id — dropping')
          continue
        }
        events.push({
          kind: 'tool_result',
          toolUseId,
          content: block.content ?? null,
          parentToolUseId,
        })
      }
      break
    }

    case 'result': {
      if (raw.is_error) {
        events.push({ kind: 'error', error: raw.result ?? 'Unknown error' })
      } else {
        const usage = raw.usage
        const totalTokens =
          usage !== undefined
            ? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
            : null
        events.push({
          kind: 'turn_complete',
          totalTokens,
          totalCostUsd: raw.total_cost_usd ?? null,
          numTurns: raw.num_turns ?? null,
        })
      }
      break
    }

    case 'system':
      break
  }

  return { events, sessionId }
}

export function serializeUserMessage(
  text: string,
  images?: Array<{ mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; dataBase64: string }>,
  parentToolUseId?: string | null,
): string {
  const parent_tool_use_id = parentToolUseId ?? null

  if (!images || images.length === 0) {
    return JSON.stringify({
      type: 'user',
      session_id: '',
      message: { role: 'user', content: text },
      parent_tool_use_id,
    })
  }

  const content: unknown[] = [{ type: 'text', text }]
  for (const img of images) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.dataBase64 },
    })
  }

  return JSON.stringify({
    type: 'user',
    session_id: '',
    message: { role: 'user', content },
    parent_tool_use_id,
  })
}

export function makeLineReader(onLine: (raw: string) => void): (chunk: Buffer | string) => void {
  let buffer = ''

  return function handleChunk(chunk: Buffer | string): void {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')

    let newlineIdx: number
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx).replace(/\r$/, '')
      buffer = buffer.slice(newlineIdx + 1)
      if (line.length > 0) {
        onLine(line)
      }
    }
  }
}
