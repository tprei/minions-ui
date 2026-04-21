import type { TopicMessage } from "./types"

export function buildConversationText(
  conversation: TopicMessage[],
  maxAssistantChars: number | undefined,
  maxChars: number,
): string {
  void maxAssistantChars
  void maxChars
  return conversation.map((m) => `${m.role}: ${m.text}`).join("\n")
}

export async function runClaudeExtraction(_prompt: string, _systemPrompt?: string, _opts?: Record<string, unknown>): Promise<string> {
  void _prompt
  void _systemPrompt
  void _opts
  return "{}"
}

export async function retryClaudeExtraction(_prompt: string, _systemPrompt?: string, _opts?: Record<string, unknown>): Promise<string> {
  void _prompt
  void _systemPrompt
  void _opts
  return "{}"
}
