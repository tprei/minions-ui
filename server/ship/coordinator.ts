import type { ShipStage, AttentionReason, QuickAction } from '../../shared/api-types'
import { prepared } from '../db/sqlite'
import { getEventBus } from '../events/bus'
import type { PlanActionCtx } from '../commands/plan-actions'

// Stage directive constants
export const DIRECTIVE_PLAN = [
  'You have completed the thinking phase. Now create an implementation plan.',
  '',
  'Break the work into concrete, parallelizable tasks in DAG format:',
  '```dag',
  'id: unique-slug',
  'title: One-line task description',
  'dependsOn: [other-task-id]  # empty if no dependencies',
  '---',
  'Detailed instructions for this task...',
  '```',
  '',
  'Output ≥1 DAG task blocks covering all the work identified during thinking.',
].join('\n')

export const DIRECTIVE_VERIFY = [
  'All implementation tasks have completed. Review the work and verify quality.',
  '',
  '1. Check that all planned changes were made correctly.',
  '2. Review test coverage and results.',
  '3. Verify no regressions or breaking changes.',
  '4. Confirm the solution addresses the original request.',
  '',
  'If issues are found, describe what needs fixing. Otherwise confirm the work is complete.',
].join('\n')

// State transition matrix
const TRANSITIONS: Record<ShipStage, ShipStage[]> = {
  think: ['plan'],
  plan: ['dag'],
  dag: ['verify'],
  verify: ['done'],
  done: [],
}

// Per-session mutex to serialize concurrent transitions
const mutexes = new Map<string, Promise<void>>()

async function withMutex<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  // Wait for any pending operation on this session
  while (mutexes.has(sessionId)) {
    await mutexes.get(sessionId)
  }

  // Create a new promise for this operation
  let resolve: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  mutexes.set(sessionId, promise)

  try {
    return await fn()
  } finally {
    mutexes.delete(sessionId)
    resolve!()
  }
}

export interface AdvanceResult {
  ok: boolean
  from?: ShipStage
  to?: ShipStage
  reason?: string
}

/**
 * Advance a ship coordinator session through its stage lifecycle.
 *
 * State machine: think → plan → dag → verify → done
 *
 * Transitions:
 * - think → plan: injects DIRECTIVE_PLAN via registry.reply
 * - plan → dag: no-op (DAG spawn handled by plan-actions)
 * - dag → verify: injects DIRECTIVE_VERIFY via registry.reply
 * - verify → done: marks session complete, no injection
 *
 * @param sessionId - The coordinator session ID
 * @param to - Optional explicit target stage (defaults to next stage)
 * @param ctx - Plan action context with db, registry, scheduler
 * @returns Result with ok flag and transition details
 */
export async function advanceShip(
  sessionId: string,
  to: ShipStage | undefined,
  ctx: PlanActionCtx,
): Promise<AdvanceResult> {
  return withMutex(sessionId, async () => {
    const row = prepared.getSession(ctx.db, sessionId)
    if (!row) {
      return { ok: false, reason: 'session not found' }
    }
    if (row.mode !== 'ship') {
      return { ok: false, reason: `session mode is ${row.mode}, not ship` }
    }

    const currentStage = (row.stage as ShipStage | null) ?? 'think'

    // If target stage is specified, validate it
    if (to) {
      // Idempotent repeat: already at target stage
      if (currentStage === to) {
        return { ok: true, from: currentStage, to: currentStage }
      }

      // Check if transition is valid
      const allowedNext = TRANSITIONS[currentStage]
      if (!allowedNext || !allowedNext.includes(to)) {
        return {
          ok: false,
          reason: `invalid transition from ${currentStage} to ${to}`,
        }
      }
    }

    // Compute next stage
    const nextStage = to ?? TRANSITIONS[currentStage]?.[0]
    if (!nextStage) {
      return {
        ok: false,
        reason: `no valid next stage from ${currentStage}`,
      }
    }

    // Idempotent repeat check
    if (currentStage === nextStage) {
      return { ok: true, from: currentStage, to: nextStage }
    }

    // Perform the transition
    const now = Date.now()
    ctx.db.run(
      'UPDATE sessions SET stage = ?, updated_at = ? WHERE id = ?',
      [nextStage, now, sessionId],
    )

    // Emit SSE event
    const updatedRow = prepared.getSession(ctx.db, sessionId)
    if (updatedRow) {
      const bus = getEventBus()
      // rowToApi is not exported, so we'll emit via the registry's snapshot mechanism
      // The registry already has access to rowToApi and will emit properly
      // We just need to trigger it - this is a bit indirect but avoids duplicating rowToApi
      // Actually, let's just construct the minimal session object ourselves
      const childRows = ctx.db
        .query<{ id: string }, [string]>(
          'SELECT id FROM sessions WHERE parent_id = ? ORDER BY created_at ASC',
        )
        .all(sessionId)
      const childIds = childRows.map((r) => r.id)

      bus.emit({
        kind: 'session.snapshot',
        session: {
          id: updatedRow.id,
          slug: updatedRow.slug,
          status: updatedRow.status === 'waiting_input' ? 'running' : updatedRow.status,
          command: updatedRow.command,
          repo: updatedRow.repo ?? undefined,
          branch: updatedRow.branch ?? undefined,
          createdAt: new Date(updatedRow.created_at).toISOString(),
          updatedAt: new Date(updatedRow.updated_at).toISOString(),
          parentId: updatedRow.parent_id ?? undefined,
          childIds,
          needsAttention: updatedRow.needs_attention,
          attentionReasons: updatedRow.attention_reasons as AttentionReason[],
          quickActions: updatedRow.quick_actions as QuickAction[],
          mode: updatedRow.mode,
          stage: nextStage,
          conversation: [],
          transcriptUrl: `/api/sessions/${updatedRow.slug}/transcript`,
        },
      })
    }

    // Inject directive for certain transitions
    if (currentStage === 'think' && nextStage === 'plan') {
      await ctx.registry.reply(sessionId, DIRECTIVE_PLAN)
    } else if (currentStage === 'dag' && nextStage === 'verify') {
      await ctx.registry.reply(sessionId, DIRECTIVE_VERIFY)
    }

    return { ok: true, from: currentStage, to: nextStage }
  })
}
