import { retryClaudeExtraction } from '../dag/claude-extract'
import { loggers } from '../dag/logger'
import type { ProviderProfile } from '../../shared/api-types'

interface ConversationMessage {
  role: string
  text: string
}

const SUMMARIZE_SYSTEM_PROMPT =
  'Summarize this conversation in ≤500 chars, plain prose, no markdown.'

export async function summarizeConversation(
  conv: ConversationMessage[],
  profile?: ProviderProfile,
): Promise<string> {
  const task = conv
    .map((m) => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.text}`)
    .join('\n\n')

  const result = await retryClaudeExtraction(
    task,
    SUMMARIZE_SYSTEM_PROMPT,
    (output) => output.slice(0, 500),
    {
      profile,
      log: loggers.dagExtract,
    },
  )

  return result.data ?? result.errorMessage ?? ''
}
