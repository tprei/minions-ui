import { describe, it, expect } from "bun:test"
import { buildDag } from "./dag"
import { EngineEventBus } from "../events/bus"
import { createLandingManager } from "./landing"
import type { ExecFn } from "./preflight"

function makeSuccessExec(): { exec: ExecFn; calls: string[][] } {
  const calls: string[][] = []
  const exec: ExecFn = async ({ args }) => {
    calls.push([...args])
    return { stdout: "", stderr: "" }
  }
  return { exec, calls }
}

function makeBus(): EngineEventBus {
  return new EngineEventBus()
}

function makeGraph() {
  const graph = buildDag("dag-1", [
    { id: "a", title: "Task A", description: "First task", dependsOn: [] },
    { id: "b", title: "Task B", description: "Second task", dependsOn: ["a"] },
  ], "root-session", "https://github.com/org/repo")
  graph.nodes[0]!.prUrl = "https://github.com/org/repo/pull/1"
  graph.nodes[0]!.branch = "minion/slug-a"
  graph.nodes[0]!.status = "done"
  graph.nodes[1]!.prUrl = "https://github.com/org/repo/pull/2"
  graph.nodes[1]!.branch = "minion/slug-b"
  graph.nodes[1]!.status = "done"
  return graph
}

describe("LandingManager.landNode", () => {
  it("returns error when node not found in graph", async () => {
    const { exec } = makeSuccessExec()
    const bus = makeBus()
    const manager = createLandingManager({ bus, execFile: exec })
    const graph = makeGraph()

    const result = await manager.landNode("nonexistent", graph)
    expect(result.ok).toBe(false)
    expect(result.error).toContain("not found")
  })

  it("returns error when node has no PR URL", async () => {
    const { exec } = makeSuccessExec()
    const bus = makeBus()
    const manager = createLandingManager({ bus, execFile: exec })
    const graph = buildDag("dag-1", [
      { id: "a", title: "Task A", description: "First task", dependsOn: [] },
    ], "root-session", "repo")
    graph.nodes[0]!.status = "done"

    const result = await manager.landNode("a", graph)
    expect(result.ok).toBe(false)
    expect(result.error).toContain("no PR URL")
  })

  it("retargets all stacked PRs to main before merging", async () => {
    const { exec, calls } = makeSuccessExec()
    const bus = makeBus()
    const manager = createLandingManager({ bus, execFile: exec })
    const graph = makeGraph()

    await manager.landNode("a", graph)

    const retargetCalls = calls.filter((a) => a[0] === "pr" && a[1] === "edit" && a.includes("--base") && a.includes("main"))
    expect(retargetCalls.length).toBeGreaterThanOrEqual(1)
  })

  it("calls gh pr merge with squash and delete-branch", async () => {
    const { exec, calls } = makeSuccessExec()
    const bus = makeBus()
    const manager = createLandingManager({ bus, execFile: exec })
    const graph = makeGraph()

    const result = await manager.landNode("a", graph)

    const mergeCall = calls.find((a) => a[0] === "pr" && a[1] === "merge")
    expect(result.ok).toBe(true)
    expect(mergeCall).toBeDefined()
    expect(mergeCall!.includes("--squash")).toBe(true)
    expect(mergeCall!.includes("--delete-branch")).toBe(true)
  })

  it("returns ok:true and sets node status to landed on success", async () => {
    const { exec } = makeSuccessExec()
    const bus = makeBus()
    const manager = createLandingManager({ bus, execFile: exec })
    const graph = makeGraph()

    const result = await manager.landNode("a", graph)
    expect(result.ok).toBe(true)
    expect(result.prUrl).toBe("https://github.com/org/repo/pull/1")
    expect(graph.nodes[0]!.status).toBe("landed")
  })

  it("returns ok:false with error when gh pr merge fails", async () => {
    const bus = makeBus()
    const exec: ExecFn = async ({ args }) => {
      if (args[1] === "merge") throw new Error("PR is not mergeable")
      return { stdout: "", stderr: "" }
    }
    const manager = createLandingManager({ bus, execFile: exec })
    const graph = makeGraph()

    const result = await manager.landNode("a", graph)
    expect(result.ok).toBe(false)
    expect(result.error).toContain("merge failed")
  })

  it("emits dag.node.landed event on successful merge", async () => {
    const { exec } = makeSuccessExec()
    const bus = makeBus()
    const manager = createLandingManager({ bus, execFile: exec })
    const graph = makeGraph()

    const emittedEvents: { kind: string; dagId: string; nodeId: string }[] = []
    bus.onKind("dag.node.landed", (e) => {
      emittedEvents.push({ kind: e.kind, dagId: e.dagId, nodeId: e.nodeId })
    })

    await manager.landNode("a", graph)

    expect(emittedEvents).toHaveLength(1)
    expect(emittedEvents[0]!.dagId).toBe("dag-1")
    expect(emittedEvents[0]!.nodeId).toBe("a")
  })

  it("rebases downstream nodes after successful merge", async () => {
    const { exec, calls } = makeSuccessExec()
    const bus = makeBus()
    const manager = createLandingManager({ bus, execFile: exec })
    const graph = makeGraph()

    await manager.landNode("a", graph)

    const fetchCalls = calls.filter((a) => a[0] === "fetch")
    const rebaseCalls = calls.filter((a) => a[0] === "rebase")

    expect(fetchCalls.length).toBeGreaterThan(0)
    expect(rebaseCalls.length).toBeGreaterThan(0)
  })
})
