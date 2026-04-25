import { claudeProvider } from './claude/provider.js'
import { makeCodexProvider } from './codex/provider.js'
import type { AgentProvider } from './types.js'

export function getProvider(name?: string): AgentProvider {
  const resolved = name ?? process.env['AGENT_PROVIDER'] ?? 'claude'
  if (resolved === 'claude') return claudeProvider
  if (resolved === 'codex') return makeCodexProvider()
  throw new Error(`Unknown AGENT_PROVIDER: ${resolved}`)
}
