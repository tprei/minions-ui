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

export interface CodexTurnCompleted {
  method: 'turn/completed'
  params: { turn: { id: string; status: 'completed' } }
}

export interface CodexTurnFailed {
  method: 'turn/failed'
  params: { turn: { id: string; status: 'failed'; error?: { message: string } } }
}

export type CodexNotification =
  | CodexThreadStarted
  | CodexTurnStarted
  | CodexAgentMessageDelta
  | CodexAgentMessage
  | CodexReasoningDelta
  | CodexReasoning
  | CodexToolCall
  | CodexTurnCompleted
  | CodexTurnFailed

export interface CodexRpcResponse {
  id: number
  result?: unknown
  error?: { code: number; message: string }
}

export type CodexLine = CodexRpcResponse | CodexNotification
