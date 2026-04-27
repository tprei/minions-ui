import type { SessionRegistry } from '../session/registry'
import type { Database } from 'bun:sqlite'
import { prepared } from '../db/sqlite'
import { recordAuditEvent } from '../audit/audit-log'
import { eventRowToTranscript } from '../api/wire-mappers'
import type { FeedbackVote, FeedbackReason, TranscriptEvent } from '../../shared/api-types'

export interface SubmitFeedbackInput {
  sourceSessionId: string
  sourceSessionSlug: string
  sourceMessageBlockId: string
  vote: FeedbackVote
  reason?: FeedbackReason
  comment?: string
}

export interface FeedbackCommandCtx {
  registry: SessionRegistry
  db: Database
}

export interface FeedbackCommandResult {
  ok: boolean
  childSessionId?: string
  error?: string
}

function renderTranscript(events: TranscriptEvent[]): string {
  const lines: string[] = []

  for (const event of events) {
    if (event.type === 'user_message') {
      lines.push(`## User`)
      lines.push(``)
      lines.push(event.text)
      lines.push(``)
    } else if (event.type === 'assistant_text' && event.final) {
      lines.push(`## Assistant`)
      lines.push(``)
      lines.push(event.text)
      lines.push(``)
    }
  }

  return lines.join('\n')
}

function buildFeedbackPrompt(
  input: SubmitFeedbackInput,
  transcript: string,
  ratedReply: string,
): string {
  const lines: string[] = []

  if (input.vote === 'up') {
    lines.push(`# Positive feedback received`)
    lines.push(``)
    lines.push(`A user upvoted an assistant reply in session ${input.sourceSessionSlug}.`)
    lines.push(``)
    lines.push(`## Your task`)
    lines.push(``)
    lines.push(`1. Analyze the rated reply and the full conversation context`)
    lines.push(`2. Identify what worked well — was it the approach, the tone, the level of detail, the technical accuracy, or something else?`)
    lines.push(`3. Propose a concrete feedback memory entry that captures this success pattern for future reference`)
    lines.push(``)
    lines.push(`The memory should help future agents repeat this success. Focus on the WHY — what made this response valuable?`)
    lines.push(``)
  } else {
    lines.push(`# Negative feedback received`)
    lines.push(``)
    lines.push(`A user downvoted an assistant reply in session ${input.sourceSessionSlug}.`)
    lines.push(``)
    if (input.reason) {
      const reasonLabels: Record<FeedbackReason, string> = {
        incorrect: 'Incorrect',
        off_topic: 'Off topic',
        too_verbose: 'Too verbose',
        unsafe: 'Unsafe',
        other: 'Other',
      }
      lines.push(`**Reason:** ${reasonLabels[input.reason]}`)
      lines.push(``)
    }
    if (input.comment) {
      lines.push(`**User comment:**`)
      lines.push(``)
      lines.push(`> ${input.comment}`)
      lines.push(``)
    }
    lines.push(`## Your task`)
    lines.push(``)
    lines.push(`1. Diagnose what went wrong in the rated reply`)
    lines.push(`2. Locate the root cause — was it a misunderstanding, missing context, wrong approach, or something else?`)
    lines.push(`3. Propose a feedback memory entry to avoid this failure pattern in the future`)
    lines.push(`4. If applicable, identify the specific fix or change that would prevent recurrence`)
    lines.push(``)
    lines.push(`The memory should help future agents avoid this mistake. Focus on the WHY and HOW TO APPLY.`)
    lines.push(``)
  }

  lines.push(`## Rated reply`)
  lines.push(``)
  lines.push(`\`\`\``)
  lines.push(ratedReply)
  lines.push(`\`\`\``)
  lines.push(``)
  lines.push(`## Full conversation transcript`)
  lines.push(``)
  lines.push(transcript)

  return lines.join('\n')
}

export async function handleSubmitFeedback(
  input: SubmitFeedbackInput,
  ctx: FeedbackCommandCtx,
): Promise<FeedbackCommandResult> {
  if (!input.sourceSessionId) {
    return { ok: false, error: 'sourceSessionId required' }
  }
  if (!input.vote) {
    return { ok: false, error: 'vote required' }
  }

  const sourceRow = prepared.getSession(ctx.db, input.sourceSessionId)
  if (!sourceRow) {
    return { ok: false, error: `session ${input.sourceSessionId} not found` }
  }

  const eventRows = prepared.listEvents(ctx.db, input.sourceSessionId, -1)
  const events = eventRows.map((row) => eventRowToTranscript({
    session_id: row.session_id,
    seq: row.seq,
    turn: row.turn,
    type: row.type,
    timestamp: row.timestamp,
    payload: JSON.stringify(row.payload)
  }))

  recordAuditEvent(ctx.db, {
    action: 'message_feedback',
    sessionId: input.sourceSessionId,
    metadata: {
      vote: input.vote,
      reason: input.reason,
      comment: input.comment,
      sourceMessageBlockId: input.sourceMessageBlockId,
    },
  })

  if (!sourceRow.repo) {
    return { ok: true }
  }

  const ratedReply = events
    .filter((e) => e.type === 'assistant_text' && e.final && e.blockId === input.sourceMessageBlockId)
    .map((e) => (e as Extract<TranscriptEvent, { type: 'assistant_text' }>).text)
    .join('\n\n')

  const transcript = renderTranscript(events)
  const prompt = buildFeedbackPrompt(input, transcript, ratedReply)

  const { session } = await ctx.registry.create({
    mode: 'task',
    prompt,
    repo: sourceRow.repo,
    parentId: sourceRow.id,
    metadata: {
      kind: 'feedback',
      vote: input.vote,
      reason: input.reason,
      comment: input.comment,
      sourceSessionId: input.sourceSessionId,
      sourceSessionSlug: input.sourceSessionSlug,
      sourceMessageBlockId: input.sourceMessageBlockId,
    },
  })

  return { ok: true, childSessionId: session.id }
}
