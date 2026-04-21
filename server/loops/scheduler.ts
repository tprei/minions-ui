import type { Database } from 'bun:sqlite'
import type { SessionRegistry } from '../session/registry'
import type { LoopScheduler as LoopSchedulerInterface } from '../handlers/types'
import { DEFAULT_LOOPS, type LoopDefinition } from './definitions'
import { upsertLoop, getLoop, listLoops, setLoopEnabled, setLoopInterval, recordLoopRun, dumpLoopsJson } from './store'
import { buildLoopPrompt } from './prompt-builder'

const MAX_CONSECUTIVE_FAILURES = 5
const BACKOFF_BASE_MS = 10 * 60 * 1000
const BACKOFF_CAP_MS = 24 * 60 * 60 * 1000
const STAGGER_MS = 30 * 1000

export interface LoopSchedulerOpts {
  db: Database
  registry: SessionRegistry
  workspaceRoot: string
  repo: string
  maxConcurrentSessions: number
  getInteractiveSessionCount: () => number
}

export class LoopScheduler implements LoopSchedulerInterface {
  private readonly db: Database
  private readonly registry: SessionRegistry
  private readonly workspaceRoot: string
  private readonly repo: string
  private readonly maxConcurrentSessions: number
  private readonly getInteractiveSessionCount: () => number
  private readonly definitions = new Map<string, LoopDefinition>()
  private timer: ReturnType<typeof setInterval> | null = null
  private lastKickAt = new Map<string, number>()
  private activeLoopSessions = new Map<string, string>()

  constructor(opts: LoopSchedulerOpts) {
    this.db = opts.db
    this.registry = opts.registry
    this.workspaceRoot = opts.workspaceRoot
    this.repo = opts.repo
    this.maxConcurrentSessions = opts.maxConcurrentSessions
    this.getInteractiveSessionCount = opts.getInteractiveSessionCount

    for (const def of DEFAULT_LOOPS) {
      this.definitions.set(def.id, def)
      upsertLoop(this.db, def)
    }
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.tick(Date.now())
    }, 60_000)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async tick(now: number): Promise<void> {
    const interactiveCount = this.getInteractiveSessionCount()
    const reserved = this.maxConcurrentSessions - interactiveCount
    if (reserved < 2) return

    const rows = listLoops(this.db)
    let staggerOffset = 0

    for (const row of rows) {
      if (!row.enabled) continue
      if (this.activeLoopSessions.has(row.id)) continue

      const backoffMs = this.computeBackoff(row.consecutive_failures)
      const intervalMs = Math.max(row.interval_ms, backoffMs)
      const nextRunAt = (row.last_run_at ?? 0) + intervalMs

      if (now + staggerOffset < nextRunAt) continue

      this.lastKickAt.set(row.id, now)
      staggerOffset += STAGGER_MS
      void this.kickLoop(row.id)
    }
  }

  async kickLoop(loopId: string): Promise<void> {
    const def = this.definitions.get(loopId)
    if (!def) return

    const row = getLoop(this.db, loopId)
    if (!row?.enabled) return

    const existingPrUrl = row.last_pr_url ?? undefined

    const prompt = buildLoopPrompt(def, [], existingPrUrl)

    try {
      const { session } = await this.registry.create({
        mode: 'task',
        prompt,
        repo: this.repo,
        workspaceRoot: this.workspaceRoot,
      })

      this.activeLoopSessions.set(loopId, session.id)

      const sessionDb = this.db
      sessionDb.run(
        `UPDATE sessions SET metadata = json_set(COALESCE(metadata, '{}'), '$.loopId', ?) WHERE id = ?`,
        [loopId, session.id],
      )
    } catch {
      await this.recordOutcome(loopId, 'errored')
    }
  }

  async recordOutcome(loopId: string, state: string): Promise<void> {
    const row = getLoop(this.db, loopId)
    if (!row) return

    this.activeLoopSessions.delete(loopId)

    const succeeded = state === 'completed'
    const newFailures = succeeded ? 0 : row.consecutive_failures + 1

    recordLoopRun(this.db, loopId, newFailures, null)

    if (newFailures >= MAX_CONSECUTIVE_FAILURES) {
      setLoopEnabled(this.db, loopId, false)
    }

    try {
      dumpLoopsJson(this.db, this.workspaceRoot)
    } catch {
      // best-effort; filesystem errors don't affect scheduler correctness
    }
  }

  listLoops(): LoopDefinition[] {
    return listLoops(this.db).map((row) => {
      const def = this.definitions.get(row.id)
      if (!def) {
        return {
          id: row.id,
          title: row.id,
          description: '',
          intervalMs: row.interval_ms,
          branchPrefix: `minions/loops/${row.id}`,
          promptTemplate: '',
        }
      }
      return { ...def, intervalMs: row.interval_ms }
    })
  }

  enable(id: string): void {
    setLoopEnabled(this.db, id, true)
  }

  disable(id: string): void {
    setLoopEnabled(this.db, id, false)
  }

  setInterval(id: string, ms: number): void {
    setLoopInterval(this.db, id, ms)
  }

  private computeBackoff(consecutiveFailures: number): number {
    if (consecutiveFailures === 0) return 0
    return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * Math.pow(2, consecutiveFailures - 1))
  }
}
