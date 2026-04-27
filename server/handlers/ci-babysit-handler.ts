import type { CompletionHandler, HandlerCtx, HandlerResult, SessionCompletedEvent, SessionMetadata } from './types'
import { prepared } from '../db/sqlite'
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { loadDag } from '../dag/store'

const execFileP = promisify(execFileCb)

export const ciBabysitHandler: CompletionHandler = {
  name: 'ci-babysit',
  priority: 0,

  matches(): boolean {
    return true
  },

  async handle(ev: SessionCompletedEvent, ctx: HandlerCtx): Promise<HandlerResult> {
    const row = ctx.db
      .query<{ pr_url: string | null; metadata: string; workspace_root: string | null }, [string]>(
        'SELECT pr_url, metadata, workspace_root FROM sessions WHERE id = ?',
      )
      .get(ev.sessionId)

    if (!row?.pr_url) return { handled: false, reason: 'no_pr_url' }

    let meta: SessionMetadata
    try {
      meta = JSON.parse(row.metadata) as SessionMetadata
    } catch {
      meta = {}
    }

    if (meta.dagNodeId && row.workspace_root) {
      await detectAndEmitPush(ev.sessionId, row.workspace_root, meta, ctx).catch((err) => {
        console.error(`[ci-babysit-handler] push detection failed for ${ev.sessionId}:`, err)
      })
    }

    if (meta.ciBabysitStartedAt) return { handled: false, reason: 'already_babysat' }

    const now = Date.now()
    meta.ciBabysitStartedAt = now
    meta.ciBabysitTrigger = 'completion'
    prepared.updateSession(ctx.db, {
      id: ev.sessionId,
      metadata: { ...meta },
      updated_at: now,
    })

    if (meta.parentThreadId) {
      await ctx.ciBabysitter.queueDeferredBabysit(ev.sessionId, meta.parentThreadId)
      return { handled: true, reason: 'deferred_babysit_queued' }
    }
    await ctx.ciBabysitter.babysitPR(ev.sessionId, row.pr_url)
    return { handled: true, reason: 'babysit_started' }
  },
}

async function detectAndEmitPush(
  sessionId: string,
  workspaceRoot: string,
  meta: SessionMetadata,
  ctx: HandlerCtx,
): Promise<void> {
  if (!meta.dagId || !meta.dagNodeId) return

  const graph = loadDag(meta.dagId, ctx.db)
  if (!graph) return

  const node = graph.nodes.find((n) => n.id === meta.dagNodeId)
  if (!node || !node.branch) return

  const slug = node.branch.startsWith('minion/') ? node.branch.slice('minion/'.length) : node.branch
  const cwd = path.join(workspaceRoot, slug)

  let currentSha: string
  try {
    const result = await execFileP('git', ['rev-parse', 'HEAD'], {
      cwd,
      timeout: 10_000,
      encoding: 'utf-8',
    }) as { stdout: string; stderr: string }
    currentSha = result.stdout.trim()
  } catch (err) {
    console.error(`[ci-babysit-handler] failed to get HEAD SHA for ${node.id}:`, err)
    return
  }

  const lastKnownSha = node.headSha ?? ''
  if (currentSha !== lastKnownSha && currentSha) {
    ctx.bus.emit({
      kind: 'dag.node.pushed',
      dagId: meta.dagId,
      nodeId: meta.dagNodeId,
      parentSha: lastKnownSha,
      newSha: currentSha,
    })
  }
}
