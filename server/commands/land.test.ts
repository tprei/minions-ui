import { describe, it, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { handleLandCommand } from "./land"
import { buildDag } from "../dag/dag"
import { saveDag } from "../dag/store"
import { openDatabase, runMigrations } from "../db/sqlite"
import type { LandingManager, LandSequenceResult, LandSequenceOpts, LandNodeResult } from "../dag/landing"
import type { DagGraph } from "../dag/dag"

function makeDb(): Database {
  const db = openDatabase(":memory:")
  runMigrations(db)
  return db
}

function makeStubManager(impl: Partial<LandingManager>): LandingManager {
  return {
    landNode: async () => ({ ok: false, error: "not implemented" }),
    landSequence: async () => ({
      ok: false,
      mode: "best-effort",
      attempted: 0,
      landed: [],
      failed: [],
      aborted: false,
    }),
    ...impl,
  }
}

describe("handleLandCommand", () => {
  it("forwards mode to landSequence", async () => {
    const db = makeDb()
    const graph = buildDag(
      "dag-1",
      [{ id: "a", title: "A", description: "", dependsOn: [] }],
      "root-session",
      "https://github.com/org/repo",
    )
    graph.nodes[0]!.prUrl = "https://github.com/org/repo/pull/1"
    graph.nodes[0]!.status = "done"
    saveDag(graph, db)

    const seenOpts: LandSequenceOpts[] = []
    const manager = makeStubManager({
      landSequence: async (_ids: string[], _g: DagGraph, opts?: LandSequenceOpts) => {
        seenOpts.push(opts ?? {})
        const landed: LandNodeResult = { ok: true, prUrl: "https://github.com/org/repo/pull/1" }
        const result: LandSequenceResult = {
          ok: true,
          mode: opts?.mode ?? "best-effort",
          attempted: 1,
          landed: [landed],
          failed: [],
          aborted: false,
        }
        return result
      },
    })

    const r = await handleLandCommand("a", "dag-1", { landingManager: manager, db, mode: "all-or-nothing" })
    expect(r.ok).toBe(true)
    expect(r.prUrl).toBe("https://github.com/org/repo/pull/1")
    expect(r.mode).toBe("all-or-nothing")
    expect(seenOpts).toEqual([{ mode: "all-or-nothing" }])
  })

  it("defaults mode to best-effort when not given", async () => {
    const db = makeDb()
    const graph = buildDag(
      "dag-2",
      [{ id: "a", title: "A", description: "", dependsOn: [] }],
      "root-session",
      "https://github.com/org/repo",
    )
    saveDag(graph, db)

    const seen: LandSequenceOpts[] = []
    const manager = makeStubManager({
      landSequence: async (_ids: string[], _g: DagGraph, opts?: LandSequenceOpts) => {
        seen.push(opts ?? {})
        return { ok: true, mode: "best-effort", attempted: 0, landed: [], failed: [], aborted: false }
      },
    })

    await handleLandCommand("a", "dag-2", { landingManager: manager, db })
    expect(seen[0]?.mode).toBe("best-effort")
  })

  it("surfaces rollback summary when present", async () => {
    const db = makeDb()
    const graph = buildDag(
      "dag-3",
      [{ id: "a", title: "A", description: "", dependsOn: [] }],
      "root",
      "https://github.com/org/repo",
    )
    saveDag(graph, db)

    const manager = makeStubManager({
      landSequence: async () => ({
        ok: false,
        mode: "all-or-nothing",
        attempted: 1,
        landed: [],
        failed: [{ ok: false, error: "boom", prUrl: "https://github.com/org/repo/pull/1" }],
        aborted: true,
        rollback: {
          attempted: true,
          fullySuccessful: true,
          entries: [
            { nodeId: "x", reverted: true, prUrl: "https://github.com/org/repo/pull/9" },
          ],
        },
      }),
    })

    const r = await handleLandCommand("a", "dag-3", { landingManager: manager, db, mode: "all-or-nothing" })
    expect(r.ok).toBe(false)
    expect(r.error).toBe("boom")
    expect(r.rolledBack).toBe(1)
    expect(r.rollbackFullySuccessful).toBe(true)
  })

  it("returns error when DAG not found", async () => {
    const db = makeDb()
    const manager = makeStubManager({})
    const r = await handleLandCommand("a", "missing", { landingManager: manager, db })
    expect(r.ok).toBe(false)
    expect(r.error).toContain("not found")
  })
})
