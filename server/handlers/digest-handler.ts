import { spawnSync } from 'node:child_process'
import type { CompletionHandler, HandlerCtx, SessionCompletedEvent } from './types'

export const digestHandler: CompletionHandler = {
  name: 'digest',
  priority: 0,

  matches(): boolean {
    return true
  },

  async handle(ev: SessionCompletedEvent, ctx: HandlerCtx): Promise<void> {
    const row = ctx.db
      .query<{ pr_url: string | null; workspace_root: string | null; slug: string }, [string]>(
        'SELECT pr_url, workspace_root, slug FROM sessions WHERE id = ?',
      )
      .get(ev.sessionId)

    if (!row?.pr_url || !row.workspace_root) return

    const body = await ctx.digest.build(ev.sessionId, ctx.db)
    if (!body) return

    const cwd = `${row.workspace_root}/${row.slug}`

    const result = spawnSync('gh', ['pr', 'comment', row.pr_url, '--body', body], {
      cwd,
      encoding: 'utf8',
    })

    if (result.status !== 0) {
      throw new Error(`gh pr comment failed: ${result.stderr}`)
    }
  },
}
