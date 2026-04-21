import type { TopicMessage } from "./types"

export interface JudgeOption {
  id: string
  title: string
  description: string
}

export interface JudgeAdvocateResult {
  optionId: string
  role: "for" | "against"
  argument: string
  sources: string[]
}

export interface JudgeDecision {
  chosenOptionId: string
  reasoning: string
  summary: string
  tradeoffs: string[]
}

export interface JudgeExtractionResult {
  options: JudgeOption[]
  error?: string
  errorMessage?: string
}

export async function extractJudgeOptions(
  conversation: TopicMessage[],
  directive: string | undefined,
  profile: unknown,
): Promise<JudgeExtractionResult> {
  void conversation
  void directive
  void profile
  return { options: [] }
}
