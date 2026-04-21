import { describe, it, expect, beforeEach } from "bun:test"
import { Database } from "bun:sqlite"
import { openDatabase, runMigrations } from "../db/sqlite"
import { startSplit } from "./split"
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

describe("startSplit", () => {
  let db: Database

  beforeEach(() => {
    db = makeTestDb()
  })

  it("creates a DAG with all nodes having empty dependsOn", async () => {
    const items: DagInput[] = [
      { id: "auth", title: "Auth service", description: "Build auth", dependsOn: [] },
      { id: "api", title: "API layer", description: "Build API", dependsOn: [] },
      { id: "ui", title: "UI components", description: "Build UI", dependsOn: [] },
    ]

    const scheduler = makeScheduler()
    const result = await startSplit("root-session", items, { db, scheduler })

    expect(result.dagId).toBeTruthy()
    const graph = loadDag(result.dagId, db)
    expect(graph).not.toBeNull()
    expect(graph!.nodes).toHaveLength(3)
    for (const node of graph!.nodes) {
      expect(node.dependsOn).toEqual([])
    }
  })

  it("strips existing dependsOn — all nodes run in parallel", async () => {
    const items: DagInput[] = [
      { id: "a", title: "A", description: "Do A", dependsOn: [] },
      { id: "b", title: "B", description: "Do B", dependsOn: ["a"] },
      { id: "c", title: "C", description: "Do C", dependsOn: ["b"] },
    ]

    const scheduler = makeScheduler()
    const result = await startSplit("root-session", items, { db, scheduler })

    const graph = loadDag(result.dagId, db)
    expect(graph).not.toBeNull()
    for (const node of graph!.nodes) {
      expect(node.dependsOn).toEqual([])
    }
  })

  it("calls scheduler.start with the dag id", async () => {
    const items: DagInput[] = [
      { id: "task-1", title: "Task 1", description: "Do task 1", dependsOn: [] },
    ]

    const scheduler = makeScheduler()
    const result = await startSplit("root-session", items, { db, scheduler })

    expect(scheduler.startedDagIds).toHaveLength(1)
    expect(scheduler.startedDagIds[0]).toBe(result.dagId)
  })

  it("saves dag with correct node titles and descriptions", async () => {
    const items: DagInput[] = [
      { id: "feat-a", title: "Feature A", description: "Implement feature A", dependsOn: [] },
      { id: "feat-b", title: "Feature B", description: "Implement feature B", dependsOn: [] },
    ]

    const scheduler = makeScheduler()
    const result = await startSplit("root-session", items, { db, scheduler })

    const graph = loadDag(result.dagId, db)
    expect(graph!.nodes[0]!.title).toBe("Feature A")
    expect(graph!.nodes[1]!.title).toBe("Feature B")
    expect(graph!.nodes[0]!.description).toBe("Implement feature A")
  })

  it("sets all nodes to ready status since none have dependencies", async () => {
    const items: DagInput[] = [
      { id: "x", title: "X", description: "Do X", dependsOn: [] },
      { id: "y", title: "Y", description: "Do Y", dependsOn: [] },
    ]

    const scheduler = makeScheduler()
    const result = await startSplit("root-session", items, { db, scheduler })

    const graph = loadDag(result.dagId, db)
    for (const node of graph!.nodes) {
      expect(node.status).toBe("ready")
    }
  })
})
