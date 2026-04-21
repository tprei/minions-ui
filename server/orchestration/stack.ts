import { randomUUID } from "node:crypto"
import type { Database } from "bun:sqlite"
import type { DagInput } from "../dag/dag"
import { buildDag } from "../dag/dag"
import { saveDag } from "../dag/store"

export interface StackScheduler {
  start(dagId: string): Promise<void>
}

export interface StackOpts {
  db: Database
  scheduler: StackScheduler
  repo?: string
  parentThreadId?: number
}

export interface StackResult {
  dagId: string
}

export async function startStack(
  rootSessionId: string,
  items: DagInput[],
  opts: StackOpts,
): Promise<StackResult> {
  const dagId = randomUUID()
  const parentThreadId = opts.parentThreadId ?? 0
  const repo = opts.repo ?? ""

  const linearItems: DagInput[] = items.map((item, i) => ({
    ...item,
    id: item.id !== "" ? item.id : `step-${i}`,
    dependsOn: i > 0 ? [items[i - 1]?.id ?? `step-${i - 1}`] : [],
  }))

  const graph = buildDag(dagId, linearItems, parentThreadId, repo)

  void rootSessionId

  saveDag(graph, opts.db)
  await opts.scheduler.start(dagId)

  return { dagId }
}
