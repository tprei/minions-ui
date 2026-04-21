import type { JudgeOrchestrator, JudgeResult } from '../judge/orchestrator'
import type { Database } from 'bun:sqlite'

export interface JudgeCommandCtx {
  db: Database
  judgeOrchestrator: JudgeOrchestrator
}

export interface JudgeCommandResult {
  ok: boolean
  winnerIdx?: number
  rationale?: string
  error?: string
}

export async function handleJudgeCommand(
  markdown: string,
  sessionId: string,
  ctx: JudgeCommandCtx,
): Promise<JudgeCommandResult> {
  const rows = ctx.db
    .query<{ type: string; payload: string }, [string]>(
      "SELECT type, payload FROM session_events WHERE session_id = ? ORDER BY seq ASC",
    )
    .all(sessionId)

  const conversation: Array<{ role: 'user' | 'assistant'; text: string }> = []
  for (const row of rows) {
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(row.payload) as Record<string, unknown>
    } catch {
      continue
    }
    const text = typeof payload.text === 'string' ? payload.text : ''
    if (!text) continue
    if (row.type === 'assistant_text' || row.type === 'assistant_message' || row.type === 'assistant') {
      conversation.push({ role: 'assistant', text })
    } else if (row.type === 'user_message' || row.type === 'user') {
      conversation.push({ role: 'user', text })
    }
  }

  if (markdown.trim()) {
    conversation.push({ role: 'user', text: markdown })
  }

  let result: JudgeResult
  try {
    result = await ctx.judgeOrchestrator.run(sessionId, { conversation })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  return { ok: true, winnerIdx: result.winnerIdx, rationale: result.rationale }
}
