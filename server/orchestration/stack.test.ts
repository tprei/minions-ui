import { describe, it, expect, beforeEach } from "bun:test"
import { Database } from "bun:sqlite"
import { openDatabase, runMigrations } from "../db/sqlite"
import { startStack } from "./stack"
import { loadDag } from "../dag/store"
import type { DagInput } from "../dag/dag"

function makeTestDb(): Database {
  const db = openDatabase(":memory:")
  runMigrations(db)
  return db
}

function makeScheduler(): { startedDagIds: string[]; start: (dagId: string) => Promise<void> } {
  const startedDagIds: string[] = []
  return {
    startedDagIds,
    start: async (dagId: string) => {
      startedDagIds.push(dagId)
    },
  }
}

describe("startStack", () => {
  let db: Database

  beforeEach(() => {
    db = makeTestDb()
  })

  it("creates a linear chain where item[i] depends on item[i-1]", async () => {
    const items: DagInput[] = [
      { id: "step-0", title: "Schema", description: "Create DB schema", dependsOn: [] },
      { id: "step-1", title: "Services", description: "Implement services", dependsOn: [] },
      { id: "step-2", title: "API", description: "Wire up API", dependsOn: [] },
      { id: "step-3", title: "Tests", description: "Write tests", dependsOn: [] },
    ]

    const scheduler = makeScheduler()
    const result = await startStack("root-session", items, { db, scheduler })

    const graph = loadDag(result.dagId, db)
    expect(graph).not.toBeNull()
    expect(graph!.nodes).toHaveLength(4)

    expect(graph!.nodes[0]!.dependsOn).toEqual([])
    expect(graph!.nodes[1]!.dependsOn).toEqual(["step-0"])
    expect(graph!.nodes[2]!.dependsOn).toEqual(["step-1"])
    expect(graph!.nodes[3]!.dependsOn).toEqual(["step-2"])
  })

  it("replaces existing dependsOn with the linear chain", async () => {
    const items: DagInput[] = [
      { id: "a", title: "A", description: "Do A", dependsOn: [] },
      { id: "b", title: "B", description: "Do B", dependsOn: ["a"] },
      { id: "c", title: "C", description: "Do C", dependsOn: [] },
    ]

    const scheduler = makeScheduler()
    const result = await startStack("root-session", items, { db, scheduler })

    const graph = loadDag(result.dagId, db)
    expect(graph!.nodes[0]!.dependsOn).toEqual([])
    expect(graph!.nodes[1]!.dependsOn).toEqual(["a"])
    expect(graph!.nodes[2]!.dependsOn).toEqual(["b"])
  })

  it("calls scheduler.start with the dag id", async () => {
    const items: DagInput[] = [
      { id: "step-0", title: "First", description: "Do first", dependsOn: [] },
      { id: "step-1", title: "Second", description: "Do second", dependsOn: [] },
    ]

    const scheduler = makeScheduler()
    const result = await startStack("root-session", items, { db, scheduler })

    expect(scheduler.startedDagIds).toHaveLength(1)
    expect(scheduler.startedDagIds[0]).toBe(result.dagId)
  })

  it("single item has no dependencies", async () => {
    const items: DagInput[] = [
      { id: "only-task", title: "Only task", description: "Do it", dependsOn: [] },
    ]

    const scheduler = makeScheduler()
    const result = await startStack("root-session", items, { db, scheduler })

    const graph = loadDag(result.dagId, db)
    expect(graph!.nodes).toHaveLength(1)
    expect(graph!.nodes[0]!.dependsOn).toEqual([])
  })

  it("first node is ready, subsequent nodes are pending", async () => {
    const items: DagInput[] = [
      { id: "step-0", title: "First", description: "Do first", dependsOn: [] },
      { id: "step-1", title: "Second", description: "Do second", dependsOn: [] },
      { id: "step-2", title: "Third", description: "Do third", dependsOn: [] },
    ]

    const scheduler = makeScheduler()
    const result = await startStack("root-session", items, { db, scheduler })

    const graph = loadDag(result.dagId, db)
    expect(graph!.nodes[0]!.status).toBe("ready")
    expect(graph!.nodes[1]!.status).toBe("pending")
    expect(graph!.nodes[2]!.status).toBe("pending")
  })
})
