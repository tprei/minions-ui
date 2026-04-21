import { randomUUID } from "node:crypto"
import type { Database } from "bun:sqlite"
import type { DagInput } from "../dag/dag"
import { buildDag } from "../dag/dag"
import { saveDag } from "../dag/store"

export interface SplitScheduler {
  start(dagId: string): Promise<void>
}

export interface SplitOpts {
  db: Database
  scheduler: SplitScheduler
  repo?: string
  parentThreadId?: number
}

export interface SplitResult {
  dagId: string
}

export async function startSplit(
  rootSessionId: string,
  items: DagInput[],
  opts: SplitOpts,
): Promise<SplitResult> {
  const dagId = randomUUID()
  const parentThreadId = opts.parentThreadId ?? 0
  const repo = opts.repo ?? ""

  const parallelItems: DagInput[] = items.map((item) => ({ ...item, dependsOn: [] }))

  const graph = buildDag(dagId, parallelItems, parentThreadId, repo)

  void rootSessionId

  saveDag(graph, opts.db)
  await opts.scheduler.start(dagId)

  return { dagId }
}
