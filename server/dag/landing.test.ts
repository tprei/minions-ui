import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
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

let workspaceRoot: string

beforeEach(() => {
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "landing-test-"))
  fs.mkdirSync(path.join(workspaceRoot, "slug-a"), { recursive: true })
  fs.mkdirSync(path.join(workspaceRoot, "slug-b"), { recursive: true })
})

afterEach(() => {
  fs.rmSync(workspaceRoot, { recursive: true, force: true })
})

describe("LandingManager.landNode", () => {
  it("returns error when node not found in graph", async () => {
    const { exec } = makeSuccessExec()
    const bus = makeBus()
    const manager = createLandingManager({ bus, workspaceRoot, execFile: exec })
    const graph = makeGraph()

    const result = await manager.landNode("nonexistent", graph)
    expect(result.ok).toBe(false)
    expect(result.error).toContain("not found")
  })

  it("returns error when node has no PR URL", async () => {
    const { exec } = makeSuccessExec()
    const bus = makeBus()
    const manager = createLandingManager({ bus, workspaceRoot, execFile: exec })
    const graph = buildDag("dag-1", [
      { id: "a", title: "Task A", description: "First task", dependsOn: [] },
    ], "root-session", "repo")
    graph.nodes[0]!.status = "done"

    const result = await manager.landNode("a", graph)
    expect(result.ok).toBe(false)
    expect(result.error).toContain("no PR URL")
  })

  it("retargets all stacked PRs to main via gh api PATCH before merging", async () => {
    const { exec, calls } = makeSuccessExec()
    const bus = makeBus()
    const manager = createLandingManager({ bus, workspaceRoot, execFile: exec })
    const graph = makeGraph()

    await manager.landNode("a", graph)

    const retargetCalls = calls.filter(
      (a) => a[0] === "api" && a.includes("PATCH") && a.some((x) => x === "base=main"),
    )
    expect(retargetCalls.length).toBeGreaterThanOrEqual(1)
    const patchPath = retargetCalls[0]!.find((x) => x.startsWith("/repos/"))
    expect(patchPath).toBe("/repos/org/repo/pulls/1")
  })

  it("calls gh pr merge with squash and delete-branch", async () => {
    const { exec, calls } = makeSuccessExec()
    const bus = makeBus()
    const manager = createLandingManager({ bus, workspaceRoot, execFile: exec })
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
    const manager = createLandingManager({ bus, workspaceRoot, execFile: exec })
    const graph = makeGraph()

    const result = await manager.landNode("a", graph)
    expect(result.ok).toBe(true)
    expect(result.prUrl).toBe("https://github.com/org/repo/pull/1")
    expect(graph.nodes[0]!.status).toBe("landed")
  })

  it("returns ok:false with error when gh pr merge fails", async () => {
    const bus = makeBus()
    const exec: ExecFn = async ({ args }) => {
      if (args[0] === "pr" && args[1] === "merge") throw new Error("PR is not mergeable")
      return { stdout: "", stderr: "" }
    }
    const manager = createLandingManager({ bus, workspaceRoot, execFile: exec })
    const graph = makeGraph()

    const result = await manager.landNode("a", graph)
    expect(result.ok).toBe(false)
    expect(result.error).toContain("merge failed")
  })

  it("emits dag.node.landed event on successful merge", async () => {
    const { exec } = makeSuccessExec()
    const bus = makeBus()
    const manager = createLandingManager({ bus, workspaceRoot, execFile: exec })
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

  it("rebases downstream nodes in their worktree directory after successful merge", async () => {
    const calls: { args: string[]; cwd: string | undefined }[] = []
    const exec: ExecFn = async ({ args, opts }) => {
      calls.push({ args: [...args], cwd: opts?.cwd as string | undefined })
      return { stdout: "", stderr: "" }
    }
    const bus = makeBus()
    const manager = createLandingManager({ bus, workspaceRoot, execFile: exec })
    const graph = makeGraph()

    await manager.landNode("a", graph)

    const fetchCalls = calls.filter((c) => c.args[0] === "fetch")
    const rebaseCalls = calls.filter((c) => c.args[0] === "rebase")

    expect(fetchCalls.length).toBeGreaterThan(0)
    expect(rebaseCalls.length).toBeGreaterThan(0)
    expect(fetchCalls[0]!.cwd).toBe(path.join(workspaceRoot, "slug-b"))
    expect(rebaseCalls[0]!.cwd).toBe(path.join(workspaceRoot, "slug-b"))
  })

  it("skips rebase when downstream worktree directory is missing", async () => {
    const calls: { args: string[] }[] = []
    const exec: ExecFn = async ({ args }) => {
      calls.push({ args: [...args] })
      return { stdout: "", stderr: "" }
    }
    fs.rmSync(path.join(workspaceRoot, "slug-b"), { recursive: true, force: true })

    const bus = makeBus()
    const manager = createLandingManager({ bus, workspaceRoot, execFile: exec })
    const graph = makeGraph()

    const result = await manager.landNode("a", graph)
    expect(result.ok).toBe(true)
    const fetchCalls = calls.filter((c) => c.args[0] === "fetch")
    expect(fetchCalls.length).toBe(0)
  })
})
