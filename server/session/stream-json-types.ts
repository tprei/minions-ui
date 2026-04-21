export type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id?: string; id?: string; content?: unknown; input?: unknown }

export interface ClaudeMessage {
  role: 'assistant' | 'user'
  stop_reason?: string | null
  content: ClaudeContentBlock[]
}

export interface ClaudeStreamEventDelta {
  type?: string
  text?: string
  partial_json?: string
}

export interface ClaudeStreamEventInner {
  type: string
  index?: number
  content_block?: { type: string; text?: string; id?: string; name?: string }
  delta?: ClaudeStreamEventDelta
}

export interface ClaudeUsage {
  input_tokens?: number
  output_tokens?: number
}

export type ClaudeStreamLine =
  | { type: 'stream_event'; parent_tool_use_id?: string | null; event: ClaudeStreamEventInner; session_id?: string }
  | { type: 'assistant'; parent_tool_use_id?: string | null; message: ClaudeMessage; session_id?: string }
  | { type: 'user'; parent_tool_use_id?: string | null; message: ClaudeMessage; session_id?: string }
  | { type: 'result'; subtype?: string; result?: string; is_error?: boolean; total_cost_usd?: number; num_turns?: number; usage?: ClaudeUsage; session_id?: string }
  | { type: 'system'; session_id?: string; [k: string]: unknown }

export type ParsedStreamEvent =
  | { kind: 'text_delta'; text: string; parentToolUseId?: string | null }
  | { kind: 'thinking_block'; text: string; signature?: string; parentToolUseId?: string | null }
  | { kind: 'tool_use'; id: string; name: string; input: Record<string, unknown>; parentToolUseId?: string | null; stopReason?: string | null }
  | { kind: 'tool_result'; toolUseId: string; content: unknown; parentToolUseId?: string | null }
  | { kind: 'turn_complete'; totalTokens: number | null; totalCostUsd: number | null; numTurns: number | null }
  | { kind: 'error'; error: string }
  | { kind: 'session_id'; sessionId: string }
