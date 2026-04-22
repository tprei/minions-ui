import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import type { SessionRegistry } from '../session/registry'
import type { Database } from 'bun:sqlite'
import { prepared } from '../db/sqlite'

const execFileP = promisify(execFileCb)

export type DoneExecFn = (
  cmd: string,
  args: string[],
  opts: { timeout: number; encoding: 'utf-8' },
) => Promise<{ stdout: string; stderr: string }>

const defaultExec: DoneExecFn = (cmd, args, opts) =>
  execFileP(cmd, args, opts) as Promise<{ stdout: string; stderr: string }>

export interface DoneCommandCtx {
  registry: SessionRegistry
  db: Database
  execFile?: DoneExecFn
}

export interface DoneCommandResult {
  ok: boolean
  sessionId?: string
  prUrl?: string
  merged?: boolean
  error?: string
}

export async function handleDoneCommand(
  sessionId: string | undefined,
  ctx: DoneCommandCtx,
): Promise<DoneCommandResult> {
  let resolvedId = sessionId
  if (!resolvedId) {
    const rows = prepared.listSessions(ctx.db)
    const active = rows.find((r) => r.status === 'running' || r.status === 'waiting_input')
    if (!active) return { ok: false, error: 'no active session; provide sessionId' }
    resolvedId = active.id
  }

  const row = prepared.getSession(ctx.db, resolvedId)
  if (!row) return { ok: false, error: `session ${resolvedId} not found` }

  if (!row.pr_url) {
    return {
      ok: false,
      sessionId: resolvedId,
      error: `session ${resolvedId} has no PR to merge; use /close to discard`,
    }
  }

  const exec = ctx.execFile ?? defaultExec
  try {
    await exec('gh', ['pr', 'merge', row.pr_url, '--squash', '--delete-branch'], {
      timeout: 120_000,
      encoding: 'utf-8',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, sessionId: resolvedId, prUrl: row.pr_url, error: `merge failed: ${msg}` }
  }

  await ctx.registry.close(resolvedId)
  return { ok: true, sessionId: resolvedId, prUrl: row.pr_url, merged: true }
}
