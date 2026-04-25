export type ProviderEvent =
  | { kind: 'text_delta'; text: string; parentToolUseId?: string | null }
  | { kind: 'thinking_block'; text: string; signature?: string; parentToolUseId?: string | null }
  | { kind: 'tool_use'; id: string; name: string; input: Record<string, unknown>; parentToolUseId?: string | null; stopReason?: string | null }
  | { kind: 'tool_result'; toolUseId: string; content: unknown; parentToolUseId?: string | null }
  | { kind: 'turn_complete'; totalTokens: number | null; totalCostUsd: number | null; numTurns: number | null }
  | { kind: 'error'; error: string }
  | { kind: 'session_id'; sessionId: string }

export interface Image {
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  dataBase64: string
}

export interface ModeConfig {
  systemPrompt: string
  model: string
  disallowedTools: string[]
  autoExitOnComplete: boolean
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
  sandbox?: 'read-only' | 'workspace-write'
}

export interface SpawnArgsOpts {
  sessionId: string
  mode: string
  cwd: string
  workspaceHome: string
  parentHome: string
  modeConfig: ModeConfig
  resumeSessionId?: string
  mcpConfig?: { mcpServers: Record<string, unknown> }
}

// Mutable cursor each provider owns. Extend this with provider-specific fields.
export type ParserState = object

export interface AgentProvider {
  readonly name: 'claude' | 'codex'
  buildSpawnArgs(opts: SpawnArgsOpts): { argv: string[]; env: NodeJS.ProcessEnv }
  serializeInitialInput(prompt: string, images: Image[] | undefined, opts: SpawnArgsOpts): string
  serializeUserReply(prompt: string, images: Image[] | undefined, ctx: { providerSessionId: string | undefined }): string
  parseLine(line: string, state: ParserState): { events: ProviderEvent[]; sessionId?: string }
  resumeArgs(sessionId: string): string[]
  isQuotaError(stderr: string): boolean
  onProviderEvent?(event: ProviderEvent, ctx: { providerSessionId: string | undefined }): string[] | null
}
