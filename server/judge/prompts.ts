import type { TopicMessage } from "../dag/types"

const MAX_CONVERSATION_CHARS = 6000

function summariseConversation(conversation: TopicMessage[]): string {
  const lines: string[] = []
  for (const msg of conversation) {
    const label = msg.role === "user" ? "User" : "Agent"
    const text =
      msg.role === "assistant" && msg.text.length > MAX_CONVERSATION_CHARS
        ? `[truncated]\n…${msg.text.slice(-MAX_CONVERSATION_CHARS)}`
        : msg.text
    lines.push(`${label}: ${text}`)
    lines.push("")
  }
  return lines.join("\n")
}

export function buildExtractorPrompt(conversation: TopicMessage[]): string {
  return [
    "You are extracting distinct positions or approaches from a planning conversation.",
    "Given the conversation below, output a JSON array of position strings.",
    "Each position should be a concise, distinct approach to the problem (1-3 sentences).",
    "Include no surrounding text or markdown fencing — output ONLY the JSON array.",
    'Example: ["Use a monorepo with shared types", "Keep services fully separate with contract tests"]',
    "",
    "## Conversation",
    "",
    summariseConversation(conversation),
  ].join("\n")
}

export function buildAdvocatePrompt(position: string, conversation: TopicMessage[]): string {
  return [
    "You are an advocate for a specific technical position.",
    "Your goal is to make the strongest possible case for your assigned position.",
    "",
    `## Your position`,
    "",
    position,
    "",
    "## Original conversation context",
    "",
    summariseConversation(conversation),
    "",
    "## Your task",
    "",
    "Write a detailed technical argument (300-600 words) defending your position.",
    "Cover: rationale, concrete benefits, trade-offs you accept, and implementation approach.",
    "Be direct and specific. Avoid vague claims.",
    "",
    "Output format (JSON, no fencing):",
    '{"position": "<your assigned position>", "argument": "<your detailed argument>", "score": <self-assessed score 1-10>}',
  ].join("\n")
}

export function buildJudgePrompt(
  advocateOutputs: Array<{ position: string; argument: string; score: number }>,
  conversation: TopicMessage[],
): string {
  const advocateSection = advocateOutputs
    .map(
      (a, i) =>
        `### Advocate ${i} (self-score: ${a.score}/10)\n**Position:** ${a.position}\n\n${a.argument}`,
    )
    .join("\n\n---\n\n")

  return [
    "You are an impartial technical judge evaluating competing arguments.",
    "Select the strongest position based on: technical soundness, concreteness, and suitability for the context.",
    "",
    "## Original conversation context",
    "",
    summariseConversation(conversation),
    "",
    "## Advocate arguments",
    "",
    advocateSection,
    "",
    "## Your task",
    "",
    "Evaluate each argument and select the winner.",
    "Output format (JSON, no fencing):",
    '{"winnerIdx": <0-based index of winning advocate>, "rationale": "<2-4 sentence explanation of why this position wins>"}',
  ].join("\n")
}
