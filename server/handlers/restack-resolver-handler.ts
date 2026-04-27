import type { CompletionHandler, HandlerCtx, HandlerResult, SessionCompletedEvent, SessionMetadata } from './types'
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { loadDag } from '../dag/store'

const execFileP = promisify(execFileCb)

export const restackResolverHandler: CompletionHandler = {
  name: 'restack-resolver',
  priority: 10,

  matches(ev: SessionCompletedEvent): boolean {
    return ev.sessionId !== undefined
  },

  async handle(ev: SessionCompletedEvent, ctx: HandlerCtx): Promise<HandlerResult> {
    const row = ctx.db
      .query<{ mode: string; metadata: string; workspace_root: string | null; slug: string }, [string]>(
        'SELECT mode, metadata, workspace_root, slug FROM sessions WHERE id = ?',
      )
      .get(ev.sessionId)

    if (!row) return { handled: false, reason: 'session_not_found' }
    if (row.mode !== 'rebase-resolver') return { handled: false, reason: 'mode_mismatch' }
    if (!row.workspace_root) return { handled: false, reason: 'no_workspace_root' }

    let meta: SessionMetadata
    try {
      meta = JSON.parse(row.metadata) as SessionMetadata
    } catch {
      meta = {}
    }

    const { dagId, dagNodeId, parentBranch, parentSha } = meta
    if (!dagId || !dagNodeId || !parentBranch || !parentSha) {
      console.error(`[restack-resolver-handler] missing metadata for session ${ev.sessionId}`)
      return { handled: false, reason: 'missing_metadata' }
    }

    const graph = loadDag(dagId, ctx.db)
    if (!graph) {
      console.error(`[restack-resolver-handler] DAG ${dagId} not found`)
      return { handled: false, reason: 'dag_not_found' }
    }

    const node = graph.nodes.find((n) => n.id === dagNodeId)
    if (!node) {
      console.error(`[restack-resolver-handler] node ${dagNodeId} not found in DAG ${dagId}`)
      return { handled: false, reason: 'node_not_found' }
    }

    const cwd = path.join(row.workspace_root, row.slug)

    const rebaseStatus = await checkRebaseStatus(cwd)

    if (rebaseStatus === 'in-progress') {
      console.log(`[restack-resolver-handler] rebase still in progress for node ${dagNodeId}`)
      node.status = 'rebase-conflict'
      node.error = 'Resolver completed but rebase is still in progress'
      ctx.bus.emit({
        kind: 'dag.node.restack.completed',
        dagId,
        nodeId: dagNodeId,
        result: 'conflict',
        error: node.error,
      })
      return { handled: true, reason: 'rebase_in_progress' }
    }

    if (rebaseStatus === 'dirty') {
      console.log(`[restack-resolver-handler] workspace is dirty for node ${dagNodeId}`)
      node.status = 'rebase-conflict'
      node.error = 'Resolver completed but workspace has uncommitted changes'
      ctx.bus.emit({
        kind: 'dag.node.restack.completed',
        dagId,
        nodeId: dagNodeId,
        result: 'conflict',
        error: node.error,
      })
      return { handled: true, reason: 'workspace_dirty' }
    }

    let currentSha: string
    try {
      const result = await execFileP('git', ['rev-parse', 'HEAD'], {
        cwd,
        timeout: 10_000,
        encoding: 'utf-8',
      }) as { stdout: string; stderr: string }
      currentSha = result.stdout.trim()
    } catch (err) {
      console.error(`[restack-resolver-handler] failed to get HEAD SHA for ${dagNodeId}:`, err)
      node.status = 'rebase-conflict'
      node.error = `Failed to get HEAD SHA: ${err instanceof Error ? err.message : String(err)}`
      ctx.bus.emit({
        kind: 'dag.node.restack.completed',
        dagId,
        nodeId: dagNodeId,
        result: 'conflict',
        error: node.error,
      })
      return { handled: true, reason: 'head_sha_failed' }
    }

    try {
      await execFileP('git', ['push', '--force-with-lease'], {
        cwd,
        timeout: 60_000,
        encoding: 'utf-8',
      })
    } catch (err) {
      console.error(`[restack-resolver-handler] push failed for node ${dagNodeId}:`, err)
      node.status = 'rebase-conflict'
      node.error = `Push failed: ${err instanceof Error ? err.message : String(err)}`
      ctx.bus.emit({
        kind: 'dag.node.restack.completed',
        dagId,
        nodeId: dagNodeId,
        result: 'conflict',
        error: node.error,
      })
      return { handled: true, reason: 'push_failed' }
    }

    console.log(`[restack-resolver-handler] successfully resolved and pushed node ${dagNodeId}`)
    node.headSha = currentSha
    node.error = undefined

    ctx.bus.emit({
      kind: 'dag.node.restack.completed',
      dagId,
      nodeId: dagNodeId,
      result: 'resolved',
    })

    ctx.bus.emit({
      kind: 'dag.node.pushed',
      dagId,
      nodeId: dagNodeId,
      parentSha: typeof parentSha === 'string' ? parentSha : '',
      newSha: currentSha,
    })
    return { handled: true, reason: 'restack_resolved' }
  },
}

async function checkRebaseStatus(cwd: string): Promise<'clean' | 'dirty' | 'in-progress'> {
  try {
    const statusResult = await execFileP('git', ['status', '--porcelain'], {
      cwd,
      timeout: 10_000,
      encoding: 'utf-8',
    }) as { stdout: string; stderr: string }

    const rebaseDirResult = await execFileP('git', ['rev-parse', '--git-path', 'rebase-merge'], {
      cwd,
      timeout: 10_000,
      encoding: 'utf-8',
    }) as { stdout: string; stderr: string }

    const rebaseDir = path.join(cwd, '.git', path.basename(rebaseDirResult.stdout.trim()))
    const fs = await import('node:fs')
    if (fs.existsSync(rebaseDir)) {
      return 'in-progress'
    }

    if (statusResult.stdout.trim().length > 0) {
      return 'dirty'
    }

    return 'clean'
  } catch (err) {
    console.error(`[restack-resolver-handler] failed to check rebase status:`, err)
    return 'dirty'
  }
}
