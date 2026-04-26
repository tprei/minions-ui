import { execFile as execFileCb } from "node:child_process"
import { promisify } from "node:util"
import type { CIBabysitter } from "../handlers/types"
import type { SessionRegistry } from "../session/registry"
import type { ExecFn } from "../dag/preflight"
import { fetchPrPreview } from "../github/pr-preview"
import type { CheckRun } from "../github/pr-preview"
import { checkPRMergeability } from "../dag/preflight"
import { buildCIFixPrompt, buildMergeConflictPrompt } from "./prompts"
import type { Database } from "bun:sqlite"

const execFileP = promisify(execFileCb)

const INITIAL_DELAY_MS = 10_000
const MAX_POLL_DELAY_MS = 30_000
const NO_CHECKS_GRACE_MS = 3 * 60 * 1000
const TERMINAL_ERROR_PATTERNS = ["404", "403", "not a pull request", "not found"]

type DelayFn = (ms: number) => Promise<void>

interface BabysitterOpts {
  registry: SessionRegistry
  db: Database
  maxRetries?: number
  execFn?: ExecFn
  delayFn?: DelayFn
}

interface SessionPrRow {
  pr_url: string | null
  workspace_root: string | null
  slug: string
  repo: string | null
}

function builtinExec(): ExecFn {
  return ({ cmd, args, opts }) =>
    execFileP(cmd, args, opts ?? {}) as Promise<{ stdout: string; stderr: string }>
}

function isTerminalError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()
  return TERMINAL_ERROR_PATTERNS.some((pat) => msg.includes(pat))
}

function exponentialDelay(attempt: number): number {
  return Math.floor(Math.random() * Math.min(MAX_POLL_DELAY_MS, INITIAL_DELAY_MS * 2 ** attempt))
}

function allChecksDone(checks: Array<{ status: string }>): boolean {
  return checks.every(
    (c) =>
      c.status === "completed" ||
      c.status === "success" ||
      c.status === "failure" ||
      c.status === "cancelled" ||
      c.status === "skipped" ||
      c.status === "timed_out" ||
      c.status === "action_required" ||
      c.status === "neutral",
  )
}

async function pollUntilDone(
  prUrl: string,
  execFn: ExecFn,
  delayFn: DelayFn,
): Promise<{ passed: boolean; failedChecks: CheckRun[] }> {
  const startedAt = Date.now()
  let attempt = 0

  while (true) {
    await delayFn(exponentialDelay(attempt))
    attempt++

    let preview: Awaited<ReturnType<typeof fetchPrPreview>>
    try {
      preview = await fetchPrPreview(prUrl, execFn)
    } catch (err) {
      if (isTerminalError(err)) throw err
      continue
    }

    const { checks } = preview

    if (checks.length === 0) {
      if (Date.now() - startedAt > NO_CHECKS_GRACE_MS) {
        return { passed: true, failedChecks: [] }
      }
      continue
    }

    if (!allChecksDone(checks)) continue

    const failedChecks = checks.filter(
      (c) =>
        c.conclusion === "failure" ||
        c.conclusion === "timed_out" ||
        c.conclusion === "action_required",
    )
    return { passed: failedChecks.length === 0, failedChecks }
  }
}

export function createRealCIBabysitter(opts: BabysitterOpts): CIBabysitter {
  const { registry, db, maxRetries = 3 } = opts
  const execFn = opts.execFn ?? builtinExec()
  const delayFn: DelayFn =
    opts.delayFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))

  async function spawnFixSession(
    sessionId: string,
    prompt: string,
  ): Promise<string> {
    const row = db
      .query<SessionPrRow, [string]>(
        "SELECT pr_url, workspace_root, slug, repo FROM sessions WHERE id = ?",
      )
      .get(sessionId)

    if (!row?.repo) {
      throw new Error(`Cannot spawn fix session: session ${sessionId} has no repo`)
    }

    const { session } = await registry.create({
      mode: "task",
      prompt,
      repo: row.repo,
      parentId: sessionId,
      workspaceRoot: row.workspace_root ?? undefined,
    })

    return session.id
  }

  async function handleConflicts(
    sessionId: string,
    prUrl: string,
    retryCount: number,
  ): Promise<boolean> {
    if (retryCount >= maxRetries) return false

    const mergeResult = await checkPRMergeability(prUrl, execFn)
    if (mergeResult.mergeable) return true

    const conflictPaths = mergeResult.conflictPaths ?? []
    const prompt = buildMergeConflictPrompt(prUrl, conflictPaths)

    await spawnFixSession(sessionId, prompt)
    return false
  }

  async function babysitPR(sessionId: string, prUrl: string): Promise<void> {
    let previousFailCount = Infinity

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const mergeResult = await checkPRMergeability(prUrl, execFn).catch(() => ({
        mergeable: false,
        conflictPaths: undefined as string[] | undefined,
      }))

      if (!mergeResult.mergeable) {
        const resolved = await handleConflicts(sessionId, prUrl, attempt).catch(() => false)
        if (!resolved) return
      }

      let pollResult: {
        passed: boolean
        failedChecks: CheckRun[]
      }
      try {
        pollResult = await pollUntilDone(prUrl, execFn, delayFn)
      } catch (err) {
        if (isTerminalError(err)) return
        return
      }

      if (pollResult.passed) return

      const currentFailCount = pollResult.failedChecks.length
      if (currentFailCount >= previousFailCount && attempt > 0) {
        return
      }
      previousFailCount = currentFailCount

      if (attempt >= maxRetries) return

      const prompt = buildCIFixPrompt(prUrl, pollResult.failedChecks)
      await spawnFixSession(sessionId, prompt).catch(() => undefined)
      await delayFn(INITIAL_DELAY_MS)
    }
  }

  async function queueDeferredBabysit(
    sessionId: string,
    parentThreadId: string,
  ): Promise<void> {
    const row = db
      .query<{ pr_url: string | null }, [string]>(
        "SELECT pr_url FROM sessions WHERE id = ?",
      )
      .get(sessionId)

    if (!row?.pr_url) return

    const prUrl = row.pr_url

    void Promise.resolve().then(() =>
      babysitPR(sessionId, prUrl).catch((err: unknown) => {
        console.error(
          `[ci-babysitter] deferred babysit failed for ${sessionId} (parent ${parentThreadId}):`,
          err,
        )
      }),
    )
  }

  async function babysitDagChildCI(sessionId: string, prUrl: string): Promise<void> {
    await babysitPR(sessionId, prUrl)
  }

  return { babysitPR, queueDeferredBabysit, babysitDagChildCI }
}
