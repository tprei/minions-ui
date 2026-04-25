import { buildIsolatedEnv } from '../../env.js'
import { applyClaudeEnv } from './env.js'
import { isQuotaError } from '../../quota-detection.js'
import { parseClaudeLine, translateLine, serializeUserMessage } from './stream.js'
import type { AgentProvider, Image, ParserState, ProviderEvent, SpawnArgsOpts } from '../types.js'

interface ClaudeParserState {
  providerSessionId: string | undefined
}

export const claudeProvider: AgentProvider = {
  name: 'claude',

  buildSpawnArgs(opts: SpawnArgsOpts): { argv: string[]; env: NodeJS.ProcessEnv } {
    const argv: string[] = [
      'claude',
      '--print',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--dangerously-skip-permissions',
      ...(opts.modeConfig.disallowedTools.length
        ? ['--disallowed-tools', ...opts.modeConfig.disallowedTools]
        : []),
      ...(opts.mcpConfig && Object.keys(opts.mcpConfig.mcpServers).length
        ? ['--mcp-config', JSON.stringify(opts.mcpConfig)]
        : []),
      '--append-system-prompt', opts.modeConfig.systemPrompt,
      '--model', opts.modeConfig.model,
      ...(opts.resumeSessionId ? ['--resume', opts.resumeSessionId] : []),
    ]
    const env = buildIsolatedEnv({ workspaceHome: opts.workspaceHome })
    applyClaudeEnv(env, { workspaceHome: opts.workspaceHome, parentHome: opts.parentHome })
    return { argv, env }
  },

  serializeInitialInput: (prompt: string, images: Image[] | undefined): string =>
    serializeUserMessage(prompt, images),

  serializeUserReply: (prompt: string, images: Image[] | undefined): string =>
    serializeUserMessage(prompt, images),

  parseLine(line: string, state: ParserState): { events: ProviderEvent[]; sessionId?: string } {
    const claudeState = state as unknown as ClaudeParserState
    const raw = parseClaudeLine(line)
    if (!raw) return { events: [] }
    const { events, sessionId } = translateLine(raw, claudeState.providerSessionId)
    claudeState.providerSessionId = sessionId
    return { events, sessionId }
  },

  resumeArgs: (sessionId: string): string[] => ['--resume', sessionId],

  isQuotaError: (stderr: string): boolean => isQuotaError(stderr),
}
