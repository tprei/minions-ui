export interface CodexThreadStarted {
  method: 'thread/started'
  params: { thread: { id: string } }
}

export interface CodexTurnStarted {
  method: 'turn/started'
  params: { threadId: string; turnId: string }
}

export interface CodexAgentMessageDelta {
  method: 'item/agentMessage/delta'
  params: { turnId: string; delta: string }
}

export interface CodexAgentMessage {
  method: 'item/agentMessage'
  params: { turnId: string; text: string }
}

export interface CodexReasoningDelta {
  method: 'item/reasoning/delta'
  params: { turnId: string; delta: string }
}

export interface CodexReasoning {
  method: 'item/reasoning'
  params: { turnId: string; text: string }
}

export type CodexToolCallParams =
  | { turnId: string; id: string; name: string; input: Record<string, unknown>; status: 'inProgress' }
  | { turnId: string; id: string; name: string; input: Record<string, unknown>; status: 'completed'; output?: string }
  | { turnId: string; id: string; name: string; input: Record<string, unknown>; status: 'failed'; output?: string }

export interface CodexToolCall {
  method: 'item/toolCall'
  params: CodexToolCallParams
}

export type ThreadItem =
  | { type: 'agentMessage'; id: string; text: string }
  | { type: 'reasoning'; id: string; content?: unknown[]; summary?: unknown[] }
  | {
      type: 'commandExecution'
      id: string
      command: string
      cwd?: unknown
      status: 'inProgress' | 'completed' | 'failed' | 'declined'
      aggregatedOutput?: string | null
      exitCode?: number | null
    }
  | {
      type: 'fileChange'
      id: string
      changes: unknown[]
      status: 'inProgress' | 'completed' | 'failed' | 'declined'
    }
  | { type: 'plan'; id: string; text: string }
  | {
      type: 'mcpToolCall'
      id: string
      server: string
      tool: string
      arguments: unknown
      status: 'inProgress' | 'completed' | 'failed' | 'declined'
      output?: unknown
    }
  | {
      type: 'dynamicToolCall'
      id: string
      tool: string
      arguments: unknown
      status: 'inProgress' | 'completed' | 'failed' | 'declined'
      output?: unknown
    }
  | { type: string; id: string; [key: string]: unknown }

export interface CodexItemStarted {
  method: 'item/started'
  params: { item: ThreadItem; threadId: string; turnId: string }
}

export interface CodexItemCompleted {
  method: 'item/completed'
  params: { item: ThreadItem; threadId: string; turnId: string }
}

export interface CodexTurnCompleted {
  method: 'turn/completed'
  params: {
    threadId?: string
    turn: { id: string; status: 'completed' | 'failed'; error?: { message?: string } | null }
  }
}

export interface CodexTurnFailed {
  method: 'turn/failed'
  params: { turn: { id: string; status: 'failed'; error?: { message: string } } }
}

export interface CodexError {
  method: 'error'
  params: {
    threadId?: string
    turnId?: string
    willRetry?: boolean
    error: { message?: string; codexErrorInfo?: string; additionalDetails?: unknown }
  }
}

export type CodexNotification =
  | CodexThreadStarted
  | CodexTurnStarted
  | CodexAgentMessageDelta
  | CodexAgentMessage
  | CodexReasoningDelta
  | CodexReasoning
  | CodexToolCall
  | CodexItemStarted
  | CodexItemCompleted
  | CodexTurnCompleted
  | CodexTurnFailed
  | CodexError

export interface CodexRpcResponse {
  id: number
  result?: unknown
  error?: { code: number; message: string }
}

export type CodexLine = CodexRpcResponse | CodexNotification
