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
} from '../../api/types'

export type TranscriptRow =
  | { kind: 'turn-separator'; turn: number; started?: TurnStartedEvent; completed?: TurnCompletedEvent }
  | { kind: 'user-message'; event: UserMessageEvent }
  | { kind: 'assistant-text'; blockId: string; turn: number; seq: number; event: AssistantTextEvent }
  | { kind: 'thinking'; blockId: string; turn: number; seq: number; event: ThinkingEvent }
  | { kind: 'tool-call'; turn: number; seq: number; call: ToolCallEvent; result: ToolResultEvent | null }
  | { kind: 'tool-result-orphan'; event: ToolResultEvent }
  | { kind: 'status'; event: StatusEvent }

export interface BuildRowsResult {
  rows: TranscriptRow[]
}

export function buildTranscriptRows(events: TranscriptEvent[]): BuildRowsResult {
  if (events.length === 0) return { rows: [] }

  const sorted = [...events].sort((a, b) => a.seq - b.seq)

  const resultsByToolUseId = new Map<string, ToolResultEvent>()
  for (const e of sorted) {
    if (e.type === 'tool_result') {
      const prev = resultsByToolUseId.get(e.toolUseId)
      if (!prev || e.seq > prev.seq) resultsByToolUseId.set(e.toolUseId, e)
    }
  }

  const handledResultIds = new Set<string>()
  const blockSeen = new Map<string, number>()
  const turnState = new Map<number, { started?: TurnStartedEvent; completed?: TurnCompletedEvent }>()

  const rows: TranscriptRow[] = []
  let lastEmittedTurn = -1

  function ensureTurnSeparator(turn: number) {
    if (turn === lastEmittedTurn) return
    const state = turnState.get(turn) ?? {}
    rows.push({ kind: 'turn-separator', turn, started: state.started, completed: state.completed })
    lastEmittedTurn = turn
  }

  for (const e of sorted) {
    if (e.type === 'turn_started') {
      const state = turnState.get(e.turn) ?? {}
      state.started = e
      turnState.set(e.turn, state)
      ensureTurnSeparator(e.turn)
      continue
    }
    if (e.type === 'turn_completed') {
      const state = turnState.get(e.turn) ?? {}
      state.completed = e
      turnState.set(e.turn, state)
      const idx = lastTurnSeparatorIndex(rows, e.turn)
      if (idx >= 0) {
        const sep = rows[idx]
        if (sep.kind === 'turn-separator') sep.completed = e
      }
      continue
    }

    ensureTurnSeparator(e.turn)

    switch (e.type) {
      case 'user_message':
        rows.push({ kind: 'user-message', event: e })
        break
      case 'assistant_text': {
        const prevSeq = blockSeen.get(e.blockId)
        if (prevSeq !== undefined) {
          const idx = rows.findIndex(
            (r) => r.kind === 'assistant-text' && r.blockId === e.blockId,
          )
          if (idx >= 0) {
            const prev = rows[idx]
            if (prev.kind === 'assistant-text') {
              const mergedText = e.final ? e.text : (prev.event.text ?? '') + (e.text ?? '')
              rows[idx] = {
                kind: 'assistant-text',
                blockId: e.blockId,
                turn: e.turn,
                seq: e.seq,
                event: { ...e, text: mergedText },
              }
            }
          }
        } else {
          rows.push({ kind: 'assistant-text', blockId: e.blockId, turn: e.turn, seq: e.seq, event: e })
        }
        blockSeen.set(e.blockId, e.seq)
        break
      }
      case 'thinking': {
        const prevSeq = blockSeen.get(e.blockId)
        if (prevSeq !== undefined) {
          const idx = rows.findIndex((r) => r.kind === 'thinking' && r.blockId === e.blockId)
          if (idx >= 0) {
            const prev = rows[idx]
            if (prev.kind === 'thinking') {
              const mergedText = e.final ? e.text : (prev.event.text ?? '') + (e.text ?? '')
              rows[idx] = {
                kind: 'thinking',
                blockId: e.blockId,
                turn: e.turn,
                seq: e.seq,
                event: { ...e, text: mergedText },
              }
            }
          }
        } else {
          rows.push({ kind: 'thinking', blockId: e.blockId, turn: e.turn, seq: e.seq, event: e })
        }
        blockSeen.set(e.blockId, e.seq)
        break
      }
      case 'tool_call': {
        const result = resultsByToolUseId.get(e.call.toolUseId) ?? null
        if (result) handledResultIds.add(result.id)
        rows.push({ kind: 'tool-call', turn: e.turn, seq: e.seq, call: e, result })
        break
      }
      case 'tool_result':
        // Re-render the matching tool-call row if it already exists (result arrived later)
        if (handledResultIds.has(e.id)) break
        {
          const idx = rows.findIndex(
            (r) => r.kind === 'tool-call' && r.call.call.toolUseId === e.toolUseId,
          )
          if (idx >= 0) {
            const row = rows[idx]
            if (row.kind === 'tool-call') {
              rows[idx] = { ...row, result: e }
              handledResultIds.add(e.id)
            }
          } else {
            rows.push({ kind: 'tool-result-orphan', event: e })
          }
        }
        break
      case 'status':
        rows.push({ kind: 'status', event: e })
        break
    }
  }

  return { rows }
}

function lastTurnSeparatorIndex(rows: TranscriptRow[], turn: number): number {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    if (r.kind === 'turn-separator' && r.turn === turn) return i
  }
  return -1
}

export function formatDuration(ms: number | undefined): string | null {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return null
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds - minutes * 60)
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`
}

export function formatTokens(n: number | undefined): string | null {
  if (n === undefined || !Number.isFinite(n) || n < 0) return null
  if (n < 1000) return `${n}`
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export function formatCostUsd(n: number | undefined): string | null {
  if (n === undefined || !Number.isFinite(n) || n < 0) return null
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

export function triggerLabel(trigger: TurnStartedEvent['trigger']): string {
  switch (trigger) {
    case 'user_message': return 'User message'
    case 'agent_continuation': return 'Continuation'
    case 'command': return 'Command'
    case 'reply_injected': return 'Injected reply'
    case 'resume': return 'Resumed'
  }
}
