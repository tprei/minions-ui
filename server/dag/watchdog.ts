import type { DagGraph } from "./dag"
import type { EngineEventBus } from "../events/bus"

export type StallReason = "deadline" | "no-progress"
export type StallAction = "retry" | "fail-forward"

export interface StallEvent {
  graph: DagGraph
  reason: StallReason
  sinceMs: number
  runningNodeIds: string[]
  stallCount: number
}

export interface DagWatchdogOpts {
  bus: EngineEventBus
  stallThresholdMs?: number
  checkIntervalMs?: number
  maxRetries?: number
  onStall: (event: StallEvent, action: StallAction) => Promise<void>
  now?: () => number
  setIntervalFn?: typeof setInterval
  clearIntervalFn?: typeof clearInterval
}

export interface DagWatchdog {
  arm(graph: DagGraph): void
  notifyProgress(dagId: string, at?: number): void
  notifyResolved(dagId: string, at?: number): void
  disarm(dagId: string): void
  tick(at?: number): Promise<void>
  shutdown(): void
}

interface WatchEntry {
  graph: DagGraph
  lastProgressAt: number
  stallCount: number
  inFlight: boolean
}

const DEFAULT_STALL_THRESHOLD_MS = 30 * 60 * 1000
const DEFAULT_CHECK_INTERVAL_MS = 60 * 1000
const DEFAULT_MAX_RETRIES = 1

export function createDagWatchdog(opts: DagWatchdogOpts): DagWatchdog {
  const stallThresholdMs = opts.stallThresholdMs ?? DEFAULT_STALL_THRESHOLD_MS
  const checkIntervalMs = opts.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES
  const now = opts.now ?? (() => Date.now())
  const setIntervalImpl = opts.setIntervalFn ?? setInterval
  const clearIntervalImpl = opts.clearIntervalFn ?? clearInterval

  const entries = new Map<string, WatchEntry>()
  let timer: ReturnType<typeof setInterval> | null = null

  function ensureTimer(): void {
    if (timer != null) return
    if (entries.size === 0) return
    timer = setIntervalImpl(() => {
      void tick()
    }, checkIntervalMs)
    if (typeof timer === "object" && timer && "unref" in timer && typeof (timer as { unref?: () => void }).unref === "function") {
      ;(timer as { unref: () => void }).unref()
    }
  }

  function maybeClearTimer(): void {
    if (entries.size === 0 && timer != null) {
      clearIntervalImpl(timer)
      timer = null
    }
  }

  function arm(graph: DagGraph): void {
    const existing = entries.get(graph.id)
    entries.set(graph.id, {
      graph,
      lastProgressAt: existing?.lastProgressAt ?? now(),
      stallCount: existing?.stallCount ?? 0,
      inFlight: false,
    })
    ensureTimer()
  }

  function notifyProgress(dagId: string, at?: number): void {
    const entry = entries.get(dagId)
    if (!entry) return
    entry.lastProgressAt = at ?? now()
  }

  function notifyResolved(dagId: string, at?: number): void {
    const entry = entries.get(dagId)
    if (!entry) return
    entry.lastProgressAt = at ?? now()
    entry.stallCount = 0
  }

  function disarm(dagId: string): void {
    entries.delete(dagId)
    maybeClearTimer()
  }

  async function tick(at?: number): Promise<void> {
    const t = at ?? now()
    const work: Array<Promise<void>> = []
    for (const entry of entries.values()) {
      if (entry.inFlight) continue
      const elapsed = t - entry.lastProgressAt
      const deadlineHit = entry.graph.deadlineMs != null && t >= entry.graph.deadlineMs
      const stalled = elapsed >= stallThresholdMs

      if (!deadlineHit && !stalled) continue

      const reason: StallReason = deadlineHit ? "deadline" : "no-progress"
      const sinceMs = deadlineHit
        ? Math.max(0, t - (entry.graph.deadlineMs ?? t))
        : elapsed

      entry.stallCount += 1
      const action: StallAction =
        reason === "deadline" || entry.stallCount > maxRetries
          ? "fail-forward"
          : "retry"

      const runningNodeIds = entry.graph.nodes
        .filter((n) => n.status === "running")
        .map((n) => n.id)

      opts.bus.emit({
        kind: "dag.stalled",
        dagId: entry.graph.id,
        reason,
        sinceMs,
        runningNodeIds,
        action,
        stallCount: entry.stallCount,
      })

      entry.inFlight = true
      entry.lastProgressAt = t

      const stallEvent: StallEvent = {
        graph: entry.graph,
        reason,
        sinceMs,
        runningNodeIds,
        stallCount: entry.stallCount,
      }

      work.push(
        Promise.resolve()
          .then(() => opts.onStall(stallEvent, action))
          .catch((err) => {
            console.error(`[watchdog] onStall handler failed for dag ${entry.graph.id}:`, err)
          })
          .finally(() => {
            entry.inFlight = false
          }),
      )
    }
    await Promise.all(work)
  }

  function shutdown(): void {
    entries.clear()
    if (timer != null) {
      clearIntervalImpl(timer)
      timer = null
    }
  }

  return { arm, notifyProgress, notifyResolved, disarm, tick, shutdown }
}
