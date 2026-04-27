import { spawnSync } from 'node:child_process'
import type { CompletionHandler, HandlerCtx, HandlerResult, SessionCompletedEvent } from './types'
import { HANDLER_PRIORITIES } from './priorities'


export const digestHandler: CompletionHandler = {
  name: 'digest',
  priority: HANDLER_PRIORITIES.OBSERVE,

  matches(): boolean {
    return true
  },

  async handle(ev: SessionCompletedEvent, ctx: HandlerCtx): Promise<HandlerResult> {
    const row = ctx.db
      .query<{ pr_url: string | null; workspace_root: string | null; slug: string }, [string]>(
        'SELECT pr_url, workspace_root, slug FROM sessions WHERE id = ?',
      )
      .get(ev.sessionId)

    if (!row?.pr_url || !row.workspace_root) return { handled: false, reason: 'no_pr_or_workspace' }

    const body = await ctx.digest.build(ev.sessionId, ctx.db)
    if (!body) return { handled: false, reason: 'empty_digest' }

    const cwd = `${row.workspace_root}/${row.slug}`

    const result = spawnSync('gh', ['pr', 'comment', row.pr_url, '--body', body], {
      cwd,
      encoding: 'utf8',
    })

    if (result.status !== 0) {
      throw new Error(`gh pr comment failed: ${result.stderr}`)
    }
    return { handled: true }
  },
}
