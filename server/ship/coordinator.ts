import type { ShipStage, AttentionReason, QuickAction } from '../../shared/api-types'
import { prepared } from '../db/sqlite'
import { getEventBus } from '../events/bus'
import { handleDag, type PlanActionCtx } from '../commands/plan-actions'
import { listDags } from '../dag/store'
import { buildVerifyDirective, type VerifyTask } from './verification'

// Stage directive constants
export const DIRECTIVE_PLAN = [
  'You have completed the thinking phase. Now create an implementation plan.',
  '',
  'Break the work into concrete, parallelizable tasks as a JSON DAG array:',
  '```json',
  '[',
  '  {',
  '    "id": "unique-slug",',
  '    "title": "One-line task description",',
  '    "description": "Detailed instructions for this task.",',
  '    "dependsOn": []',
  '  }',
  ']',
  '```',
  '',
  'Output at least one task object covering all the work identified during thinking.',
].join('\n')

export const DIRECTIVE_VERIFY = buildVerifyDirective([])

function buildVerifyDirectiveForSession(sessionId: string, ctx: PlanActionCtx): string {
  const dag = listDags(ctx.db).find((g) => g.rootSessionId === sessionId)
  if (!dag) return DIRECTIVE_VERIFY

  const tasks: VerifyTask[] = dag.nodes.map((node) => {
    let branch: string | null = node.branch ?? null
    let prUrl: string | null = node.prUrl ?? null
    if ((!branch || !prUrl) && node.sessionId) {
      const childRow = prepared.getSession(ctx.db, node.sessionId)
      if (childRow) {
        if (!branch) branch = childRow.branch ?? null
        if (!prUrl) prUrl = childRow.pr_url ?? null
      }
    }
    return {
      title: node.title || node.id,
      description: node.description ?? '',
      branch,
      prUrl,
    }
  })

  return buildVerifyDirective(tasks)
}

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
  dagId?: string
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

    let dagId: string | undefined
    if (currentStage === 'plan' && nextStage === 'dag') {
      const dagResult = await handleDag('', sessionId, ctx)
      if (!dagResult.ok) {
        return { ok: false, from: currentStage, to: nextStage, reason: dagResult.reason ?? 'could not start ship DAG' }
      }
      dagId = dagResult.dagId
    }

    const now = Date.now()
    if (nextStage === 'done') {
      ctx.db.run(
        'UPDATE sessions SET stage = ?, status = ?, updated_at = ? WHERE id = ?',
        [nextStage, 'completed', now, sessionId],
      )
    } else {
      ctx.db.run(
        'UPDATE sessions SET stage = ?, updated_at = ? WHERE id = ?',
        [nextStage, now, sessionId],
      )
    }

    console.log('[ship]', sessionId, 'stage', currentStage, '->', nextStage)

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
      const directive = buildVerifyDirectiveForSession(sessionId, ctx)
      await ctx.registry.reply(sessionId, directive)
    }

    return { ok: true, from: currentStage, to: nextStage, dagId }
  })
}
