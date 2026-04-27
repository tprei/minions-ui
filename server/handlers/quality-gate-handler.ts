import type { CompletionHandler, HandlerCtx, HandlerResult, SessionCompletedEvent, SessionMetadata } from './types'

export const qualityGateHandler: CompletionHandler = {
  name: 'quality-gate',
  priority: 0,

  matches(): boolean {
    return true
  },

  async handle(ev: SessionCompletedEvent, ctx: HandlerCtx): Promise<HandlerResult> {
    const row = ctx.db
      .query<{ metadata: string; workspace_root: string | null; slug: string }, [string]>(
        'SELECT metadata, workspace_root, slug FROM sessions WHERE id = ?',
      )
      .get(ev.sessionId)

    if (!row) return { handled: false, reason: 'session_not_found' }
    if (!row.workspace_root) return { handled: false, reason: 'no_workspace_root' }

    const cwd = `${row.workspace_root}/${row.slug}`
    const report = await ctx.qualityGates.run(cwd)

    const meta = JSON.parse(row.metadata) as SessionMetadata
    const updatedMeta: SessionMetadata = { ...meta, qualityReport: report }

    ctx.db.run(
      'UPDATE sessions SET metadata = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(updatedMeta), Date.now(), ev.sessionId],
    )

    ctx.bus.emit({
      kind: 'session.quality_gates',
      sessionId: ev.sessionId,
      allPassed: report.allPassed,
      results: report.results,
    })

    if (!report.allPassed) {
      const failed = report.results.filter((r) => !r.passed)
      const feedback = [
        'Quality gates failed:',
        ...failed.map((r) => `- ${r.name}: ${r.output}`),
      ].join('\n')

      const pendingFeedback: string[] = Array.isArray(meta.pendingFeedback) ? meta.pendingFeedback : []
      pendingFeedback.push(feedback)
      const failedMeta: SessionMetadata = { ...updatedMeta, pendingFeedback }

      ctx.db.run(
        'UPDATE sessions SET metadata = ?, updated_at = ? WHERE id = ?',
        [JSON.stringify(failedMeta), Date.now(), ev.sessionId],
      )
    }
    return { handled: true, reason: report.allPassed ? 'gates_passed' : 'gates_failed' }
  },
}
