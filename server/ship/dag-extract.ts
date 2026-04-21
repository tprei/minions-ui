import type { TopicMessage } from "./types"

export interface DagExtractResult {
  items: { id: string; title: string; description: string; dependsOn: string[] }[]
  error?: string
  errorMessage?: string
}

export async function extractDagItems(
  conversation: TopicMessage[],
  directive: string | undefined,
  profile: unknown,
): Promise<DagExtractResult> {
  void conversation
  void directive
  void profile
  return { items: [] }
}
